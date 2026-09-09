import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import {
  ZoneBody, NothingYet, StatedLimit, ZoneHeading, Pill,
  Field, SaveNote, UnlinkedZone, isNoPartnerProfile,
  inputClass, buttonClass, ghostButtonClass, moneyDollars,
} from '../kit';
import { partnerZoneActions } from '../../../workspaces/partnerZoneActions';
import { partnerZoneFilters } from '../../../workspaces/partnerZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import ZoneDraft from '../../../workspaces/ZoneDraft';
import { Eyebrow, Instrument, NotRecorded } from '../../../workspaces/canvasKit';

/**
 * Pipeline · Leads — `/pipeline/leads`.
 *
 * WHAT THIS ROUTE USED TO RENDER. `NeedsBoardPage` — the shared marketplace
 * needs board, the same component a founder and an admin see, with a partner
 * export row bolted on. It listed open needs and stopped there: no score, no
 * provenance, no pass, and no way to tell a need this firm had already bid on
 * from one it had never opened.
 *
 * THE THREE SETS ARE THE ARTBOARD'S WHOLE ARGUMENT, and they are enforced
 * rather than asserted: "a lead you already bid is not a lead, and a lead you
 * declined is not one either." A need this firm quoted on is a PROPOSAL and
 * lives on `/pipeline/proposals`; a need with a row in `partner_lead_passes` is
 * a PASS; everything else open is a LEAD. Each read excludes the other two, so
 * no status column has to be kept in step and one client cannot appear twice.
 *
 * A PASS WITHOUT A REASON IS A LEAD YOU RE-EVALUATE NEXT QUARTER. That is the
 * artboard's sentence and migration 233's reason for existing. Nothing recorded
 * a decision NOT to bid, so a need somebody read and declined looked exactly
 * like one nobody had opened, and the firm spent the same hour twice.
 *
 * THE SCORE IS THE FIRM'S OWN RULES, COUNTED — NOT A MODEL. `partner_fit_rules`
 * (209/229) has been the firm's register of what it takes and passes on since
 * it was built, and `/offers/fit-rules` has answered `enforcement: 'none'` all
 * that time with the accurate note that "these rules are a record a person
 * reads before passing on a lead". This zone is the reader. Every receipt on a
 * row names the rule it came from, because a score whose derivation is hidden
 * is a number to argue with rather than one to act on.
 *
 * A FIRM WITH NO RULES GETS NO SCORE. Not fifty, not "unrated but probably
 * fine" — `score: null` with the reason, and the `Strong fit` tile goes absent
 * with it. And an EXCLUDED lead carries no number at all: "we do not do native
 * mobile" is not twenty out of a hundred, and putting it on the same axis would
 * rank a lead the firm has already ruled out above one it merely fits badly.
 */

const REASON_LABEL = {
  below_floor: 'Below floor',
  no_capability: 'No capability',
  scope_mismatch: 'Scope mismatch',
  timing: 'Timing',
  price: 'Price',
  other: 'Other',
};
const RECEIPT_TONE = { hit: 'ok', miss: 'danger', gap: 'neutral' };

/** The strip tile, in the anatomy the artboards share. */
function LeadTile({ label, value, note, nr = false }) {
  return (
    <div className="rounded-[10px] border border-axal-hairline bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-1.5">
        {nr ? <NotRecorded /> : (
          <span className="font-mono text-[16px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{value}</span>
        )}
      </div>
      <div className="mt-1 text-[10px] leading-snug text-gray-600 dark:text-gray-400">{note}</div>
    </div>
  );
}

/**
 * One lead, with the receipt behind its score.
 *
 * THE CARD IS TINTED ONLY ON A STRONG FIT, the way the artboard tints it — and
 * an excluded lead is not tinted red either. It is not a bad lead; it is not a
 * lead, and the row says which rule said so in the firm's own words.
 */
function LeadCard({ row, busy, onPass, note }) {
  const [passing, setPassing] = useState(false);
  const [draft, setDraft] = useState({ reason: '', note: '' });
  const strong = row.score != null && row.score >= 80;

  return (
    <div className={`rounded-[11px] border p-4 ${
      row.excluded_by
        ? 'border-axal-hairline bg-axal-surface-2 dark:border-gray-700 dark:bg-gray-900'
        : (strong
          ? 'border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/15'
          : 'border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900')
    }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-extrabold tracking-tight text-axal-ink dark:text-gray-100">
              {row.who || row.title}
            </span>
            {/* PROVENANCE, and there is one kind of it on this build. */}
            <Pill tone="seam">{row.source_label}</Pill>
            {row.days_old != null && (
              <span className="text-[11px] text-axal-ink-3">{row.days_old}d ago</span>
            )}
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-axal-ink-2">
            {row.title}
            {/* DOLLARS STRAIGHT THROUGH. `founder_needs.budget_*` is the old
                REAL-dollars pipeline and `moneyDollars` formats dollars, so a
                `* 100` here — the conversion the SCORE needs, because the fit
                rule's floor is in cents — would print $3.2M over a $32,000
                budget. The two comparisons are in different units and only one
                of them converts. */}
            {row.budget_max != null && ` · up to ${moneyDollars(row.budget_max)}`}
            {row.timeline && ` · ${row.timeline}`}
          </p>
          {row.need && (
            <p className="mt-1 text-[12px] leading-relaxed text-axal-ink-3">{row.need}</p>
          )}
        </div>
        <div className="text-right">
          {/* NOT A NUMBER WHERE THERE IS NO NUMBER. An exclusion and an
              unscorable lead are two different absences and read as two. */}
          {row.excluded_by
            ? <Pill tone="neutral">Excluded</Pill>
            : (row.score == null
              ? <NotRecorded />
              : (
                <span className={`font-mono text-[20px] font-extrabold tracking-tight ${
                  strong ? 'text-emerald-700 dark:text-emerald-400' : 'text-axal-ink dark:text-gray-100'
                }`}
                >
                  {row.score}
                </span>
              ))}
          <div className="text-[10px] font-semibold uppercase tracking-[.07em] text-axal-ink-3">match</div>
        </div>
      </div>

      {/* THE RECEIPT BEHIND EVERY SCORE — the artboard's phrase for it, and the
          reason a score is worth showing at all. */}
      {row.receipts.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {row.receipts.map((r, i) => (
            <Pill key={`${r.label}-${i}`} tone={RECEIPT_TONE[r.kind] || 'neutral'}>{r.label}</Pill>
          ))}
        </div>
      )}
      {row.excluded_by && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-axal-ink-2">{row.excluded_by}</p>
      )}
      {row.score_note && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-axal-ink-2">{row.score_note}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* ACCEPT IS A BID, and a bid is a quote — so it goes where quotes are
            written rather than being a second way to create one here. */}
        <Link to={`/needs/${row.need_uid}`} className={buttonClass}>Accept · bid on it</Link>
        <button type="button" className={ghostButtonClass} onClick={() => setPassing((v) => !v)}>
          {passing ? 'Cancel' : 'Pass'}
        </button>
      </div>

      {passing && (
        <div className="mt-3 rounded-lg border border-axal-hairline bg-axal-surface-2 p-3 dark:border-gray-700">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Reason" hint="A pass without one is a lead you read again next quarter.">
              <select className={inputClass} value={draft.reason}
                onChange={(e) => setDraft({ ...draft, reason: e.target.value })}>
                <option value="">Choose one</option>
                {Object.entries(REASON_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="Note" hint="What the next person reading this lead needs to know.">
              <input className={inputClass} value={draft.note} maxLength={600}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
            </Field>
          </div>
          <button
            type="button" className={`${buttonClass} mt-3`}
            disabled={busy || !draft.reason}
            onClick={async () => {
              await onPass(row, draft);
              setPassing(false);
              setDraft({ reason: '', note: '' });
            }}
          >
            Record the pass
          </button>
          <SaveNote note={note?.scope === `lead:${row.need_id}` ? note : null} />
        </div>
      )}
    </div>
  );
}

export default function PartnerLeadsZone() {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [view, setView] = useState('open');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const r = await api.listPartnerLeads();
      setState({ loading: false, error: '', data: r || {} });
    } catch (e) {
      setState({ loading: false, error: e?.message || 'The lead list did not load.', data: null });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = useCallback(async (fn, ok, scope) => {
    setBusy(true);
    setNote(null);
    try {
      await fn();
      setNote({ ok: true, text: ok, scope });
      await load();
    } catch (e) {
      setNote({ ok: false, text: e?.message || 'That did not save.', scope });
    } finally {
      setBusy(false);
    }
  }, [load]);

  const d = state.data;
  const items = Array.isArray(d?.items) ? d.items : [];
  const passed = Array.isArray(d?.passed) ? d.passed : [];

  // Hoisted so the gate branch below and the live row draw the SAME row.
  // With nothing loaded the export renders disabled and says so itself.
  // ══ THE `p1` CHIP ROW ════════════════════════════════════════════════════
  // `Passed` IS THE ONLY ONE THAT LEAVES THE OPEN LIST, which is the point: it
  // shows the other set, and the table below is where its reasons live. `Warm
  // intros` is prose — every lead here is a marketplace need, so it would
  // select the whole list and call that a filter.
  const visible = (() => {
    if (view === 'strong') return items.filter((r) => r.score != null && r.score >= 80);
    if (view === 'passed') return [];
    return items;
  })();

  const rowActions = partnerZoneActions('pipeline/leads', { view: { header: ['Lead', 'Need', 'Score', 'Source', 'Budget max', 'Timeline'], rows: visible, cells: (r) => [r.who, r.title, r.score, r.source_label, r.budget_max, r.timeline] } });

  if (isNoPartnerProfile(state.error)) {
    return <UnlinkedZone title="Leads" actions={rowActions} />;
  }

  return (
    <>
      <ZoneToolbar
        className="mb-3"
        role="partner"
        filters={partnerZoneFilters('pipeline/leads', { value: view, onChange: setView })}
        actions={rowActions}
      />
      <ZoneBody
        loading={state.loading}
        error={state.error}
        onRetry={load}
        isEmpty={items.length === 0 && passed.length === 0}
        empty={(
          <NothingYet
            title="No open lead right now"
            body={
              'A lead is an open marketplace need this firm has neither bid on '
              + 'nor passed on. Bid and it becomes a proposal; pass and it moves '
              + 'to the table of passes with your reason, so nobody reads it '
              + 'again next quarter.'
            }
            action={<Link to="/needs" className="text-[12.5px] font-semibold text-amber-700 underline">Browse the marketplace</Link>}
          />
        )}
      >
        <div className="space-y-6">
          <ZoneHeading
            title="Leads"
            blurb={
              'Every source, scored against what this firm can actually do, with '
              + 'the provenance that says how it arrived.'
            }
          />

          {/* ══ THE `p1` STRIP ════════════════════════════════════════════════
              `Open leads · Strong fit · Warm path · Passed this quarter`. */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <LeadTile
              label="Open leads"
              value={String(d?.open_count ?? 0)}
              note="none of them already bid"
            />
            {/* NULL, NOT ZERO, when nothing can be scored. "No strong fits" and
                "no rules to judge fit with" are different answers. */}
            <LeadTile
              label="Strong fit"
              value={String(d?.strong_fit_count ?? 0)}
              nr={d?.strong_fit_count == null}
              note={d?.strong_fit_count == null ? 'no rule to score against yet' : '80 or above'}
            />
            {/* TRUE, AND IT IS THE FINDING. Every lead this product can see
                arrived through the marketplace; no investor intro or referral is
                recorded anywhere, so the firm has no warm channel on record. */}
            <LeadTile
              label="Warm path"
              value={String(d?.open_count ?? 0)}
              note="all via the marketplace — no other source is recorded"
            />
            <LeadTile
              label="Passed"
              value={String(d?.passed_count ?? 0)}
              note="all with a reason on record"
            />
          </div>

          {d?.scoring === 'none' && (
            <p className="text-[12.5px] leading-relaxed text-axal-ink-2">{d.scoring_note}</p>
          )}

          {view !== 'passed' && (
            <div className="space-y-3">
              {visible.map((row) => (
                <LeadCard
                  key={row.need_id}
                  row={row}
                  busy={busy}
                  note={note}
                  onPass={(r, draftValue) => run(
                    () => api.passPartnerLead(r.need_id, {
                      reason: draftValue.reason, note: draftValue.note,
                    }),
                    'Pass recorded.', `lead:${r.need_id}`,
                  )}
                />
              ))}
              {items.length > 0 && visible.length === 0 && (
                <p className="text-[12px] text-axal-ink-2">
                  No lead is in this state. {items.length} open in total.
                </p>
              )}
            </div>
          )}

          <ZoneDraft
            surface="pipeline/leads"
            label="Proposal · drafted on accept"
            accept="Open the draft"
            run="Draft the proposal"
            foot="Shaped from your own catalogue and floor."
            empty="For the strongest open lead: a proposal shaped the way this firm actually wins — a retainer rather than a project where the record says retainers are what closes — with the client’s stated budget checked against your floor."
            nothingToDraft="No lead is open, so there is nothing to draft a proposal for."
          />

          {/* ══ THE RECORD THAT STOPS RE-LITIGATION ═══════════════════════════
              The artboard's own label for this table, and its own subtitle. */}
          <Instrument
            testid="passed-leads"
            title="Passed · with reasons"
            meta="Only here · the record that stops re-litigation"
            cols="1.1fr .8fr 1.6fr"
            head={['Lead', 'Reason', 'Note']}
            rows={passed.map((p) => ({
              key: p.id,
              cells: [
                p.who ? { text: p.who, sub: p.title } : { text: p.title },
                { pill: REASON_LABEL[p.reason] || p.reason, pillTone: 'neutral' },
                p.note
                  ? {
                    text: p.note,
                    node: (
                      <button
                        type="button" className={ghostButtonClass} disabled={busy}
                        title="Puts the lead back on the open list. The pass is removed rather than kept as a reversal — the lead is either passed or it is open."
                        onClick={() => run(() => api.unpassPartnerLead(p.need_id), 'Back on the list.', `unpass:${p.need_id}`)}
                      >
                        Un-pass
                      </button>
                    ),
                  }
                  : {
                    nr: true,
                    node: (
                      <button
                        type="button" className={ghostButtonClass} disabled={busy}
                        onClick={() => run(() => api.unpassPartnerLead(p.need_id), 'Back on the list.', `unpass:${p.need_id}`)}
                      >
                        Un-pass
                      </button>
                    ),
                  },
              ],
            }))}
            note={'These never became proposals, which is what separates this table from a loss. A lost bid is on Proposals with its reason; a pass is a bid you chose not to make, and the two live in different tables so neither moves your win rate by accident. A lead you already bid on is not a lead and a lead you declined is not one either — the open list above excludes both, so no client appears in two of the three sets.'}
          />
          <SaveNote note={String(note?.scope || '').startsWith('unpass:') ? note : null} />

          <StatedLimit title="What the score is, and what it is not">
            <p>
              <strong>It is your own rules, counted.</strong> Every receipt on a
              row names the rule it came from — a service you list, a budget
              floor you set, a profile you called best fit on{' '}
              <Link to="/offers/audience-fit" className="underline">Offers · Audience fit</Link>.
              Nothing here is a model, and the matching is a plain search for
              your own words in the client’s, which is why the phrase that
              matched is shown rather than hidden behind a number.
            </p>
            <p className="mt-2">
              <strong>No rules means no score.</strong> A firm that has stated no
              fit rule and listed no service has told this product nothing to
              judge a lead against, so leads read as unscored rather than as
              average. And an excluded lead carries no number at all: “we do not
              do this” is a different answer from a low one, and ranking it
              against fits would put a lead you have already ruled out above one
              you merely fit badly.
            </p>
            <p className="mt-2">
              <strong>Every lead here came from the marketplace.</strong> Nothing
              records a lead arriving through an investor, a referral or a
              conversation, so the provenance chip says the one thing it can say
              truthfully — and the warm-path count is the whole open list rather
              than a channel this firm does not have on record.
            </p>
          </StatedLimit>
        </div>
      </ZoneBody>
    </>
  );
}
