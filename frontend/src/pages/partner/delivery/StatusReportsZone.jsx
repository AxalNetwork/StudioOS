import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import {
  ZoneBody, NothingYet, StatedLimit, ZoneHeading, Pill, Unrecorded,
  // `StatCard` went with the three tiles it drew. The strip is the artboard's
  // own four now, and one of them has to draw an absence rather than a number.
  Section, Field, SaveNote,
  UnlinkedZone, isNoPartnerProfile,
  inputClass, buttonClass, ghostButtonClass, formatDay,
} from '../kit';
import { partnerZoneActions } from '../../../workspaces/partnerZoneActions';
import { partnerZoneFilters } from '../../../workspaces/partnerZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import ZoneDraft from '../../../workspaces/ZoneDraft';
import { Eyebrow, Instrument, NotRecorded } from '../../../workspaces/canvasKit';

/**
 * Delivery · Status reports — `/delivery/status-reports`.
 *
 * THE RECURRING CLIENT-FACING UPDATE: shipped, next, blocked. The old card said
 * it "would read the deliverables log and the engagement's blockers, neither of
 * which is recorded" — 208 records both, and the draft below is composed from
 * them rather than typed from memory.
 *
 * THREE OF THE FOUR CHIPS SELECTED NOTHING, AND THE LISTING IS WHY. `With
 * blockers` read `r.blockers`, which the listing never returned; `This cycle`
 * and `Archive` compared against a `period` it never returned either, so the
 * first quietly showed everything and the second nothing. The compose endpoint
 * had been reading blockers live since it was written — the listing simply
 * never joined them. It does now, and the chips select what they name.
 *
 * BLOCKED IS NOT A FIELD, and that is deliberate. Blockers are read live and
 * attached to each report at read time; nothing copies them into the report
 * row. A prose copy would go stale the moment a blocker cleared, and the side
 * is exactly what a stale copy would lose.
 *
 * A CLIENT-SIDE BLOCKER IS NAMED PLAINLY, WITHOUT BEING LEANED ON. That is a
 * copy decision as much as a data one, and the old card said so. The zone shows
 * the side on every blocker and puts the sentence in front of the author rather
 * than writing the report for them: say it, do not make it the excuse.
 *
 * `Median read time` IS THE ARTBOARD'S ONE ABSENT TILE, and the reason here is
 * harder than its "reports do not report their own opens yet": a read needs an
 * open, an open is the client's act, and no client-side surface exists to
 * record one. Timing from the send would measure our own silence.
 *
 * SENDING IS A PERSON'S ACT, RECORDED — NOT A DELIVERY. Nothing in this product
 * emails a client. "Sent" means somebody sent it, by whatever channel they
 * already use. Saying otherwise would be the page claiming a capability the
 * product does not have.
 *
 * A SENT REPORT IS FROZEN. It is a record of what a client already received;
 * editing it in place would make our record disagree with theirs with no trace
 * of the difference. The worker refuses both the edit and the delete, and this
 * page does not offer either.
 */

/** The strip tile, in the anatomy the artboards share. */
function ReportTile({ label, value, note, nr = false }) {
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

function ReportCard({ report, busy, onEdit, onSend, onDelete, note }) {
  const sent = report.state === 'sent';
  return (
    <div className="rounded-xl border border-axal-hairline p-4 dark:border-gray-700">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-extrabold tracking-tight">{report.period}</span>
            <span className="text-[12.5px] text-axal-ink-2">
              {report.founder_name || report.need_title || report.engagement_uid}
            </span>
            {sent
              ? <Pill tone="ok">Sent {formatDay(report.sent_at)}</Pill>
              : <Pill tone="warn">Draft</Pill>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!sent && (
            <>
              <button type="button" className={ghostButtonClass} onClick={() => onEdit(report)}>
                Edit
              </button>
              <button
                type="button" className={buttonClass} disabled={busy}
                title="Records that you sent it. Nothing here delivers anything."
                onClick={() => onSend(report)}
              >
                Mark sent
              </button>
            </>
          )}
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Shipped</div>
          <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-axal-ink-2">
            {report.shipped || <Unrecorded>Nothing written</Unrecorded>}
          </p>
        </div>
        <div>
          <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Next</div>
          <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-axal-ink-2">
            {report.next_up || <Unrecorded>Nothing written</Unrecorded>}
          </p>
        </div>
      </div>

      {sent ? (
        <p className="mt-3 text-[11.5px] leading-relaxed text-axal-ink-3">
          This is a record of what the client received, so it is not editable and
          not deletable. Write the next period’s report instead.
        </p>
      ) : (
        <div className="mt-3 flex">
          <button
            type="button" className={`${ghostButtonClass} ml-auto text-red-700 dark:text-red-300`}
            disabled={busy} onClick={() => onDelete(report)}
          >
            Discard draft
          </button>
        </div>
      )}
      <SaveNote note={note?.scope === `rep:${report.id}` ? note : null} />
    </div>
  );
}

/**
 * The shape a composed draft always has, so no field below is read off a null.
 * Every list is an array and every scalar is something the JSX can render.
 */
const EMPTY_DRAFT = {
  period: '',
  existing: null,
  shipped_from_log: [],
  next_from_milestones: [],
  blocked: [],
  blocked_note: null,
};

function Composer({ engagements, busy, onSaved, onError, note }) {
  const [engagementId, setEngagementId] = useState('');
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
  // SEEDED WITH ITS OWN EMPTY SHAPE, with "has it been composed yet" as a
  // separate flag. Every field below reads `draft.<key>` unconditionally, and
  // React builds those children before anything decides whether to show them —
  // so a null here throws on the first render whatever guards it. That is the
  // bug `_zoneGuards.mjs` rule 2 pins shut, and why the shape is written out
  // rather than each of the six reads being made optional.
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [composed, setComposed] = useState(false);
  const [shipped, setShipped] = useState('');
  const [nextUp, setNextUp] = useState('');
  const [loadError, setLoadError] = useState('');

  const compose = useCallback(async () => {
    if (!engagementId) return;
    setLoadError('');
    try {
      const r = await api.getPartnerReportDraft(engagementId, period);
      // Spread over the empty shape rather than replacing it: a response that
      // omitted a list would otherwise reintroduce the undefined this exists
      // to prevent.
      setDraft({ ...EMPTY_DRAFT, ...(r || {}) });
      setComposed(true);
      setShipped(r?.existing?.shipped || '');
      setNextUp(r?.existing?.next_up || '');
    } catch (e) {
      setDraft(EMPTY_DRAFT);
      setComposed(false);
      setLoadError(e?.message || 'The draft could not be composed.');
    }
  }, [engagementId, period]);

  return (
    <div className="rounded-lg border border-axal-hairline bg-axal-surface-2 p-3 dark:border-gray-700">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Engagement">
          <select className={inputClass} value={engagementId}
            onChange={(e) => { setEngagementId(e.target.value); setComposed(false); }}>
            <option value="">Choose one</option>
            {engagements.map((e) => (
              <option key={e.engagement_id} value={e.engagement_id}>
                {e.founder_name || e.need_title || e.engagement_uid}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Period" hint="YYYY-MM">
          <input className={inputClass} value={period} maxLength={7}
            onChange={(e) => { setPeriod(e.target.value); setComposed(false); }} />
        </Field>
        <div className="flex items-end">
          <button type="button" className={ghostButtonClass} disabled={!engagementId} onClick={compose}>
            Compose from the record
          </button>
        </div>
      </div>

      {loadError && (
        <p className="mt-2 text-[12px] text-red-700 dark:text-red-300">{loadError}</p>
      )}

      {composed && (
        <div className="mt-4 space-y-4">
          {draft.existing?.state === 'sent' && (
            <p className="text-[12.5px] font-semibold text-amber-700 dark:text-amber-400">
              A report for {draft.period} was already sent. It cannot be edited —
              choose another period.
            </p>
          )}

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
                Shipped in {draft.period}
              </div>
              {draft.shipped_from_log.length === 0 ? (
                <p className="mt-1 text-[12px] text-axal-ink-3">
                  Nothing in the deliverables log carries a send date in this period.
                </p>
              ) : (
                <ul className="mt-1 space-y-1 text-[12px] text-axal-ink-2">
                  {draft.shipped_from_log.map((x, i) => (
                    <li key={`${x.title}-${i}`}>
                      {x.title}{x.version ? ` (${x.version})` : ''}
                      {!x.opened && <span className="text-axal-ink-3"> · not opened</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
                Next, from open milestones
              </div>
              {draft.next_from_milestones.length === 0 ? (
                <p className="mt-1 text-[12px] text-axal-ink-3">No open milestone.</p>
              ) : (
                <ul className="mt-1 space-y-1 text-[12px] text-axal-ink-2">
                  {draft.next_from_milestones.map((m, i) => (
                    <li key={`${m.title}-${i}`}>
                      {m.title}{m.due_at ? ` · due ${m.due_at}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
                Blocked
              </div>
              {draft.blocked.length === 0 ? (
                <p className="mt-1 text-[12px] text-axal-ink-3">Nothing open.</p>
              ) : (
                <ul className="mt-1 space-y-1 text-[12px] text-axal-ink-2">
                  {draft.blocked.map((b, i) => (
                    <li key={`${b.summary}-${i}`}>
                      <Pill tone={b.side === 'client' ? 'info' : 'warn'}>
                        {b.side === 'client' ? 'Client' : 'Ours'}
                      </Pill>{' '}
                      {b.summary}
                      {b.days_open != null && <span className="text-axal-ink-3"> · {b.days_open}d</span>}
                    </li>
                  ))}
                </ul>
              )}
              {/* Read live, never copied into the report — so it cannot go
                  stale, and the side cannot be lost on the way. */}
              {draft.blocked_note && (
                <p className="mt-2 text-[11.5px] leading-relaxed text-amber-700 dark:text-amber-400">
                  {draft.blocked_note}
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-3">
            <Field label="Shipped" hint="Yours to write. The log above is what the record says was sent.">
              <textarea className={inputClass} rows={3} value={shipped} maxLength={4000}
                onChange={(e) => setShipped(e.target.value)} />
            </Field>
            <Field label="Next" hint="Yours to write. The milestones above are what is open.">
              <textarea className={inputClass} rows={3} value={nextUp} maxLength={4000}
                onChange={(e) => setNextUp(e.target.value)} />
            </Field>
          </div>

          <button
            type="button" className={buttonClass}
            disabled={busy || draft.existing?.state === 'sent' || (!shipped.trim() && !nextUp.trim())}
            onClick={async () => {
              try {
                await api.savePartnerStatusReport(engagementId, draft.period, {
                  shipped, next_up: nextUp,
                });
                await onSaved();
              } catch (e) { onError(e); }
            }}
          >
            Save draft
          </button>
          <SaveNote note={note?.scope === 'compose' ? note : null} />
        </div>
      )}
    </div>
  );
}

export default function PartnerStatusReportsZone() {
  const [state, setState] = useState({ loading: true, error: '', data: null, engagements: null });
  const [view, setView] = useState('this_cycle');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const [r, h] = await Promise.all([
        api.listPartnerStatusReports(),
        api.getPartnerDeliveryHealth(),
      ]);
      setState({
        loading: false,
        error: '',
        data: r || {},
        engagements: Array.isArray(h?.items) ? h.items : [],
      });
    } catch (e) {
      setState({
        loading: false,
        error: e?.message || 'The status reports did not load.',
        data: null, engagements: null,
      });
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
  // NORMALISED ONCE, so every read below can say `r.blockers.length` without a
  // guard. The listing returns the array; this is the belt for a response that
  // predates it, and it keeps "no blockers" and "not returned" from becoming
  // two shapes the JSX has to tell apart.
  const items = (Array.isArray(d?.items) ? d.items : [])
    .map((r) => ({ ...r, blockers: Array.isArray(r.blockers) ? r.blockers : [] }));
  const engagements = state.engagements || [];
  const drafts = items.filter((r) => r.state === 'draft');

  // Hoisted so the gate branch below and the live row draw the SAME row.
  // With nothing loaded the export renders disabled and says so itself,
  // which is what makes a header row over an unreadable store honest.
  // ══ THE `pd4` CHIP ROW, AND THE TWO FIELDS IT WAITED ON ══════════════════
  // `Archive` IS EVERY EARLIER CYCLE, not a deleted state: a report is written
  // against a period and stays against it. `With blockers` reads the blockers
  // the listing now returns per report rather than a flag on the report,
  // because a blocker belongs to the engagement and a report quotes it.
  //
  // Both comparisons used to run against fields the listing never sent —
  // `r.blockers` and `d.period` — so `With blockers` and `Archive` matched
  // nothing and `This cycle` fell through to everything. The chips are the
  // same four; what changed is that the response answers them.
  const period = d?.period || '';
  const visible = (() => {
    if (view === 'this_cycle') return items.filter((r) => !period || r.period === period);
    if (view === 'drafts') return drafts;
    if (view === 'blocked') return items.filter((r) => r.blockers.length > 0);
    if (view === 'archive') return items.filter((r) => period && r.period < period);
    return items;
  })();

  const rowActions = partnerZoneActions('delivery/status-reports', { view: { header: ['Period', 'Founder', 'State', 'Shipped', 'Next up'], rows: visible, cells: (r) => [r.period, r.founder_name, r.state, r.shipped, r.next_up] } });

  if (isNoPartnerProfile(state.error)) {
    return <UnlinkedZone title="Status reports" actions={rowActions} />;
  }

  return (
    <>
      <ZoneToolbar
        className="mb-3"
        role="partner"
        filters={partnerZoneFilters('delivery/status-reports', { value: view, onChange: setView })}
        actions={rowActions}
      />
    <ZoneBody
      loading={state.loading}
      error={state.error}
      onRetry={load}
      isEmpty={items.length === 0 && !composing}
      empty={(
        <NothingYet
          title="No report written yet"
          body={
            'A report is composed from what this engagement already carries — '
            + 'what was shipped in the period, what is open, and what is blocked '
            + 'with whose side it is on. You write the words; the record supplies '
            + 'the facts.'
          }
          action={engagements.length > 0
            ? <button type="button" className={buttonClass} onClick={() => setComposing(true)}>Compose one</button>
            : <Link to="/pipeline/proposals" className="text-[12.5px] font-semibold text-amber-700 underline">Open proposals</Link>}
        />
      )}
    >
      <div className="space-y-6">
        <ZoneHeading
          title="Client status reports"
          blurb={
            'The recurring client-facing update: shipped, next, blocked. Drafted '
            + 'with assistance and sent by a person — and where the blocker is on '
            + 'the client’s side, the report says so plainly without treating it '
            + 'as an excuse.'
          }
          action={engagements.length > 0 && (
            <button type="button" className={ghostButtonClass} onClick={() => setComposing((v) => !v)}>
              {composing ? 'Close' : 'Compose a report'}
            </button>
          )}
        />

        {/* ══ THE `pd4` STRIP ═══════════════════════════════════════════════
            `In draft · Sent this cycle · Naming a blocker · Median read time`,
            each counted over every report rather than the chip-narrowed list. */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <ReportTile
            label="In draft"
            value={String(d?.draft_count ?? 0)}
            note={drafts.length
              ? `${drafts[0].founder_name || drafts[0].need_title || 'a client'} · awaiting send`
              : 'nothing written and unsent'}
          />
          <ReportTile
            label="Sent this cycle"
            value={String(d?.sent_this_cycle ?? 0)}
            note={d?.period ? `period ${d.period}` : 'this period'}
          />
          <ReportTile
            label="Naming a blocker"
            value={String(d?.blocked_count ?? 0)}
            note={d?.client_blocked_count
              ? `${d.client_blocked_count} client-side`
              : 'none on the client’s side'}
          />
          {/* THE ONE TILE THAT CANNOT BE FILLED FROM THIS SIDE. A read needs an
              open and an open is the client's act — the same absence
              `engagement_deliverables.opened_at` has, and refusing it is the
              same decision. */}
          <ReportTile
            label="Median read time"
            nr
            note="nothing records that a client read one"
          />
        </div>

        {d?.delivery_note && (
          <p className="text-[12.5px] leading-relaxed text-axal-ink-2">{d.delivery_note}</p>
        )}

        <Instrument
          testid="report-feed"
          title="Report feed"
          meta="A draft is never sent automatically"
          cols="1fr .9fr .8fr 1.9fr 2.4fr"
          head={['Client', 'Period', 'State', 'Shipped', 'Blocked on']}
          rows={visible.map((r) => {
            const client = r.blockers.filter((b) => b.side === 'client');
            return {
              key: r.id,
              rowClass: r.state === 'draft' ? 'bg-amber-50/50 dark:bg-amber-950/10' : '',
              cells: [
                r.founder_name ? { text: r.founder_name } : { nr: true },
                { text: r.period },
                r.state === 'sent'
                  ? { pill: 'Sent', pillTone: 'ok', sub: r.sent_at ? formatDay(r.sent_at) : undefined }
                  : { pill: 'Draft', pillTone: 'warn' },
                // WHAT THE FIRM WROTE, not what the log says was sent. The two
                // are different claims and the composer keeps them apart.
                r.shipped ? { text: r.shipped } : { nr: true },
                // READ LIVE, NEVER STORED. A blocker cleared since the report
                // was written stops showing here, which is the point.
                r.blockers.length === 0
                  ? { text: '—' }
                  : {
                    text: r.blockers.map((b) => b.summary).join(' · '),
                    ...(client.length ? { pill: 'Blocked', pillTone: 'danger' } : { pill: 'Blocked', pillTone: 'warn' }),
                    sub: client.length
                      ? `${client.length} on the client’s side`
                      : 'on ours',
                  },
              ],
            };
          })}
          note={'A draft names the client as the blocker where that is what happened — the direction that was asked for and not given, the review that has not come — and states plainly that the deadline does not move because of it: not our delay, still our problem. Blockers are read live at this moment rather than copied into the report when it was written, so one cleared since is gone from this row and one raised since is on it; a prose copy would have gone stale the instant either happened, and the side, which is the whole reason the sentence can be said without leaning on it, is exactly what a stale copy loses. And nothing here sends anything: a draft waits for a person, and `Sent` records that a person sent it.'}
        />

        {items.length > 0 && visible.length === 0 && (
          <p className="text-[12px] text-axal-ink-2">
            No report is in this state. {items.length} written in total.
          </p>
        )}

        <ZoneDraft
          surface="delivery/status-reports"
          label="Draft · weekly reports"
          accept="Review the batch"
          run="Draft the batch"
          foot={`${engagements.length} draft${engagements.length === 1 ? '' : 's'}; none send themselves.`}
          empty="One report per engagement drafted from the period’s real activity — shipped items from the deliverables log, next steps from open milestones, and blockers from where the work actually stopped, each with whose side it is on."
          nothingToDraft="No engagement is live, so there is nothing to report on."
        />

        {composing && (
          <Composer
            engagements={engagements}
            busy={busy}
            note={note}
            onSaved={async () => {
              setNote({ ok: true, text: 'Draft saved.', scope: 'compose' });
              await load();
            }}
            onError={(e) => setNote({
              ok: false, text: e?.message || 'That did not save.', scope: 'compose',
            })}
          />
        )}

        <Section title="Reports">
          <div className="space-y-3">
            {items.map((r) => (
              <ReportCard
                key={r.id}
                report={r}
                busy={busy}
                note={note}
                onEdit={() => setComposing(true)}
                onSend={(rep) => run(
                  () => api.sendPartnerStatusReport(rep.id),
                  'Marked sent.', `rep:${rep.id}`,
                )}
                onDelete={(rep) => run(
                  () => api.deletePartnerStatusReport(rep.id),
                  'Draft discarded.', `rep:${rep.id}`,
                )}
              />
            ))}
          </div>
        </Section>

        <StatedLimit title="What “sent” means here">
          <p>
            <strong>It means a person sent it.</strong> Nothing in this product
            emails a client, notifies one, or shows them a report — so marking one
            sent records your act, by whatever channel you already use. A page
            that implied delivery would be claiming a capability the product does
            not have.
          </p>
          <p className="mt-2">
            <strong>A sent report cannot be edited or deleted.</strong> It is a
            record of what a client already received; changing it would make our
            record disagree with theirs with no trace of the difference. Write the
            next period instead.
          </p>
          <p className="mt-2">
            <strong>Blocked is read live, never stored in the report.</strong> The
            draft shows the engagement’s open blockers with their side at the
            moment you compose. A prose copy would go stale the instant one
            cleared — and the side, which is what lets you name a client-side
            blocker plainly rather than swallowing it, is exactly what a stale
            copy loses.
          </p>
        </StatedLimit>
      </div>
    </ZoneBody>
    </>
  );
}
