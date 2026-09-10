import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../lib/api';
import { investorZoneActions } from '../../../workspaces/investorZoneActions';
import { investorZoneFilters } from '../../../workspaces/investorZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import ZoneDraft from '../../../workspaces/ZoneDraft';
import { Eyebrow, Instrument, NotRecorded } from '../../../workspaces/canvasKit';
import { ZoneBody, NothingYet, StatedLimit } from '../../advisor/expertise/kit';
import { dealStage } from '../../../lib/dealFlow';

/**
 * Deals · Closing — canvas **ID4**, `/deals/closing`. COLLECTION.
 *
 * WHAT WAS HERE: three hard-coded rows with a tick and two circles — "Deal
 * reached closing · Recorded", "Signatures and documents · Check deal room",
 * "Wire confirmation · Not recorded here" — and a link out. Two of the three
 * were captions rather than facts: nothing was read to produce them, and they
 * said the same thing on every deal at closing.
 *
 * THE OPS ROW'S FIRST REASON IS FALSE, which makes three zones in a row.
 * `Apply template` was marked unbuilt because "no closing templates are
 * stored". `legal_templates` ships 21 seeded rows with `merge_fields`,
 * `version` and `is_active`, and three of them are the closing paper this
 * artboard names by name — `safe` (SAFE Agreement), `spa` (Stock Purchase
 * Agreement) and `subscription` (Subscription Agreement). The gap is one layer
 * ABOVE the templates: nothing stores a closing CHECKLIST for a template to be
 * applied TO. That is a different sentence and it points somewhere real.
 *
 * `Record wire` is true but was imprecise, and the imprecision costs the next
 * reader a lookup: `capital_calls` DOES carry `amount`, `status`, `due_date`
 * and `paid_date` — but that is an LP paying INTO the fund, not the fund
 * wiring OUT to a company. Different direction, different counterparty. The
 * reason now says which.
 *
 * NO NEW ENDPOINT, AND THAT IS THE POINT. ID3 ended on the rule that a second
 * copy of a scoped query is how a tenancy hole reopens. Everything this page
 * needs is already served and already scoped: `api.listDeals` for the deals at
 * closing, and `api.esignList` — `esign.get('/')`, which puts
 * `esignEnvelopeScope` in the WHERE clause unconditionally and returns
 * `recipient_count`/`signed_count` per envelope. The page joins them on
 * `deal_id` in the browser rather than asking the worker for a third view of
 * rows it already exposes.
 *
 * THE INSTRUMENT IS NOT THE ARTBOARD'S. ID4 draws a "Closing checklist" —
 * Item / State / Owner / Note — and no store holds a closing checklist. The
 * two candidates are `dd_checklist_items` and `diligence_checklists`, and both
 * belong to DILIGENCE: drawing them here would relabel diligence work as
 * closing work, on a screen a fund shows its counsel. D56 also forbids drawing
 * the table as rows of "Not recorded". So the instrument is the collection this
 * stage really has — the executed paper and its signature state — and the
 * checklist's absence is stated in the limits block instead of mimed.
 */

const UNAVAILABLE = Symbol('unavailable');

/** The strip tile, in the anatomy every artboard shares. */
function CloseTile({ label, value, note, tone = '' }) {
  return (
    <div className="rounded-[10px] border border-axal-hairline bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-1.5">
        {value === null
          ? <NotRecorded />
          : <span className={`font-mono text-[16px] font-extrabold tracking-tight ${tone || 'text-axal-ink dark:text-gray-100'}`}>{value}</span>}
      </div>
      <div className="mt-1 text-[10px] leading-snug text-gray-600 dark:text-gray-400">{note}</div>
    </div>
  );
}

/** The row's one control, in the cell whose subject it acts on. */
function OpenDeal({ id, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(`/deals/${id}`)}
      className="text-[10.5px] font-semibold text-axal-violet-deep underline underline-offset-2 hover:text-axal-violet dark:text-violet-300"
    >
      Open deal room
    </button>
  );
}

const day = (v) => (v ? String(v).slice(0, 16).replace('T', ' ') : null);

/**
 * How an envelope's status reads. `completed` is the only one that means the
 * paper is executed; every other value is a stage on the way there, and none
 * of them is a failure, so none is drawn in red.
 */
const STATUS_TONE = { completed: 'ok', sent: 'info', draft: 'neutral', declined: 'danger', voided: 'warn' };

export default function InvestorClosingZone() {
  const navigate = useNavigate();
  const [deals, setDeals] = useState(null);
  const [envelopes, setEnvelopes] = useState(null);
  const [view, setView] = useState('close');

  const load = useCallback(() => {
    setDeals(null);
    setEnvelopes(null);
    api.listDeals(undefined, 'mine').then(
      (r) => setDeals(Array.isArray(r) ? r : (r?.items || [])),
      () => setDeals(UNAVAILABLE),
    );
    api.esignList().then(
      (r) => setEnvelopes(r?.envelopes || []),
      () => setEnvelopes(UNAVAILABLE),
    );
  }, []);
  useEffect(() => { load(); }, [load]);

  const dealsReady = deals !== null && deals !== UNAVAILABLE;
  const envReady = envelopes !== null && envelopes !== UNAVAILABLE;

  /** The deals this stage is about, from the shared stage map rather than a status test. */
  const closing = useMemo(
    () => (dealsReady ? deals.filter((d) => dealStage(d) === 'closing') : []),
    [dealsReady, deals],
  );

  /** Every envelope raised against one of them, joined on the deal it names. */
  const rows = useMemo(() => {
    if (!envReady) return [];
    const ids = new Set(closing.map((d) => d.id));
    const byId = new Map(closing.map((d) => [d.id, d]));
    return envelopes
      .filter((e) => e.deal_id != null && ids.has(e.deal_id))
      .map((e) => ({ ...e, deal: byId.get(e.deal_id) || null }));
  }, [envReady, envelopes, closing]);

  /**
   * Executed means COMPLETED, and nothing else counts.
   *
   * `signed_count` reaching `recipient_count` is not the same fact: a
   * counter-signature can be recorded while the envelope is still open, and an
   * envelope with no recipients at all would read as fully signed under a
   * ratio. The status column is what the system acts on, so it is what the
   * strip counts.
   */
  const executed = useMemo(() => rows.filter((e) => e.status === 'completed'), [rows]);
  const awaiting = useMemo(() => rows.filter((e) => e.status === 'sent'), [rows]);

  /** Signatures, summed across the envelopes rather than inferred from them. */
  const sigs = useMemo(() => {
    let signed = 0; let required = 0; let unrecorded = 0;
    for (const e of rows) {
      const need = Number(e.recipient_count);
      const got = Number(e.signed_count);
      if (Number.isFinite(need) && need > 0) { required += need; signed += Number.isFinite(got) ? got : 0; }
      else unrecorded += 1;
    }
    return { signed, required, unrecorded };
  }, [rows]);

  const visible = useMemo(() => {
    if (view === 'documents') return rows;
    return rows.filter((e) => e.status !== 'draft');
  }, [view, rows]);

  const rowActions = investorZoneActions('deals/closing', {
    view: {
      header: ['Document', 'Deal', 'State', 'Signatures', 'Completed'],
      rows: visible,
      cells: (e) => [
        e.document_title || e.document_type || '',
        e.deal?.project_name || `Deal #${e.deal_id}`,
        e.status || '',
        `${e.signed_count ?? ''}/${e.recipient_count ?? ''}`,
        day(e.completed_at) || '',
      ],
    },
  });

  const bothFailed = deals === UNAVAILABLE && envelopes === UNAVAILABLE;

  return (
    <>
      <ZoneToolbar
        className="mb-3"
        role="investor"
        filters={investorZoneFilters('deals/closing', { value: view, onChange: setView })}
        actions={rowActions}
      />
      <ZoneBody
        loading={deals === null && envelopes === null}
        error={bothFailed ? 'Neither the deal record nor the signature archive could be read.' : ''}
        onRetry={load}
        isEmpty={dealsReady && closing.length === 0}
        empty={(
          <NothingYet
            title="No deal is at closing"
            body={
              'A deal appears here once it reaches closing, and its paper appears '
              + 'as envelopes are raised against it. The record is readable and holds '
              + 'no deal at this stage, which is a different fact from a record that '
              + 'could not be read.'
            }
          />
        )}
      >
        <div className="space-y-6">
          {/* ══ THE ID4 STRIP ═══════════════════════════════════════════════ */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="closing-strip">
            {(() => {
              const joinedReady = dealsReady && envReady;
              return (
                <>
                  <CloseTile
                    label="At closing"
                    value={dealsReady ? String(closing.length) : null}
                    note={dealsReady
                      ? `${rows.length} document${rows.length === 1 ? '' : 's'} raised against them`
                      : 'the deal record could not be read'}
                  />
                  <CloseTile
                    label="Executed"
                    value={joinedReady ? `${executed.length} of ${rows.length}` : null}
                    note={!envReady
                      ? 'the signature archive could not be read'
                      : !dealsReady
                        ? 'unavailable: the deal record could not be read, so closing-envelope counts cannot be joined'
                        : 'an envelope counts as executed only when its status is completed'}
                  />
                  <CloseTile
                    label="Signatures"
                    value={joinedReady && sigs.required ? `${sigs.signed} of ${sigs.required}` : null}
                    note={!envReady
                      ? 'unreadable'
                      : !dealsReady
                        ? 'unavailable: the deal record could not be read, so signature counts for closing deals cannot be joined'
                        : (sigs.unrecorded
                          ? `${sigs.unrecorded} envelope${sigs.unrecorded === 1 ? ' records' : 's record'} no recipient, and ${sigs.unrecorded === 1 ? 'is' : 'are'} not counted`
                          : 'summed across every envelope on these deals')}
                  />
                  <CloseTile
                    label="Awaiting"
                    value={joinedReady ? String(awaiting.length) : null}
                    note={!envReady
                      ? 'unreadable'
                      : !dealsReady
                        ? 'unavailable: the deal record could not be read, so awaiting counts cannot be joined'
                        : 'sent and not yet completed'}
                    tone={joinedReady && awaiting.length ? 'text-amber-700 dark:text-amber-300' : ''}
                  />
                </>
              );
            })()}
          </div>

          {/* ══ THE COLLECTION THIS STAGE ACTUALLY HAS ══════════════════════ */}
          <Instrument
            testid="closing-paper"
            title="Closing paper"
            meta={view === 'documents' ? 'Every envelope, drafts included' : 'Raised and beyond · drafts hidden'}
            cols="1.6fr 1.1fr .8fr .8fr 1fr"
            head={['Document', 'Deal', 'State', 'Signatures', 'Completed']}
            rows={visible.map((e) => ({
              key: e.id,
              cells: [
                {
                  text: e.document_title || e.document_type || '',
                  sub: e.document_title && e.document_type ? e.document_type : undefined,
                },
                {
                  text: e.deal?.project_name || `Deal #${e.deal_id}`,
                  node: <OpenDeal id={e.deal_id} onOpen={navigate} />,
                },
                { text: '', pill: e.status, pillTone: STATUS_TONE[e.status] || 'neutral' },
                Number.isFinite(Number(e.recipient_count)) && Number(e.recipient_count) > 0
                  ? { text: `${e.signed_count ?? 0} of ${e.recipient_count}` }
                  : { nr: true, sub: 'no recipient recorded' },
                day(e.completed_at) ? { text: day(e.completed_at) } : { nr: true, sub: 'not executed' },
              ],
            }))}
            note={
              'This is the paper, not a checklist — the artboard draws a closing checklist and nothing stores '
              + 'one, so this table shows what the record does hold: every envelope raised against a deal at '
              + 'closing, with how many of its recipients have signed and when it completed. An envelope is '
              + 'executed only when its STATUS says completed; a signature count reaching its recipient count '
              + 'is a different fact, and an envelope that records no recipient at all would read as fully '
              + 'signed under a ratio, so it renders as unrecorded instead.'
            }
          />

          <ZoneDraft
            surface="deals/closing"
            label="Proposal · closing packet cover note"
            accept="Open the note"
            run="Draft the note"
            foot="Screened before it leaves the firm."
            empty="A cover for counsel: what is executed, what is still out, and what the record does not cover — stating plainly that the platform records the movement of money rather than moving it."
            nothingToDraft="No deal is at closing, so there is no packet to write a cover for."
          />

          <StatedLimit title="What closing does not record">
            <p>
              <strong>No closing checklist is stored,</strong> so the
              artboard&rsquo;s Item / State / Owner / Note table is not drawn.
              The two checklist stores that exist —{' '}
              <code>dd_checklist_items</code> and{' '}
              <code>diligence_checklists</code> — belong to DILIGENCE, and
              showing them here would relabel diligence work as closing work on
              a screen a fund hands to counsel.
            </p>
            <p className="mt-2">
              <strong>Templates ARE stored; a checklist to apply one to is
              not.</strong> <code>legal_templates</code> ships the SAFE
              agreement, the stock purchase agreement and the subscription
              agreement with their merge fields and versions. This row used to
              say no closing templates were stored, which was wrong and pointed
              the next reader away from a store that exists. <em>Apply
              template</em> stays unoffered because there is no checklist item
              for a template to fill, not because there is no template.
            </p>
            <p className="mt-2">
              <strong>No wire out is recorded.</strong>{' '}
              <code>capital_calls</code> carries an amount, a status and a paid
              date — but that is an LP paying INTO the fund, not the fund
              transferring OUT to a company. Different direction, different
              counterparty. The platform records the movement of money it is
              told about; it does not move it, and it has no record of this leg
              at all.
            </p>
            <p className="mt-2">
              <strong>Nothing here can be blocking,</strong> because a blocking
              item is a Commit condition and{' '}
              <a className="underline underline-offset-2" href="/deals/commit">the commit room</a>{' '}
              cannot store one either. The artboard&rsquo;s note says its
              blocking item &ldquo;arrived from the Commit vote&rdquo;; that
              hand-off has no store on either side, so no row is drawn as
              gating a transfer.
            </p>
          </StatedLimit>
        </div>
      </ZoneBody>
    </>
  );
}
