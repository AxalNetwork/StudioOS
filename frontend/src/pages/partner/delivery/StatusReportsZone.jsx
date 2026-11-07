import React, { useCallback, useEffect, useRef, useState } from 'react';
import { EMPTY_DRAFT, draftFrom, latestOnly, saveRequest } from './statusReportDraft';
import { useMutations, useZoneRead } from './useZoneMutations';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import {
  ZoneBody, NothingYet, StatedLimit, ZoneHeading, Pill, Unrecorded,
  // `StatCard` went with the three tiles it drew. The strip is the artboard's
  // own four now, and one of them has to draw an absence rather than a number.
  Section, Field, SaveNote,
  NoPartnerProfile, isNoPartnerProfile,
  inputClass, buttonClass, ghostButtonClass, formatDay,
} from '../kit';
import { partnerZoneActions } from '../../../workspaces/partnerZoneActions';
import { partnerZoneFilters } from '../../../workspaces/partnerZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import ZoneDraft from '../../../workspaces/ZoneDraft';
import { FillFormBar, useScopedFill } from '../../../ui/useScopedFill.jsx';
import { SCOPED_FORMS } from '../../../lib/fillScoped.js';
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

function ReportCard({ report, sending, discarding, onEdit, onSend, onDelete, note }) {
  const busy = sending || discarding;
  const sent = report.state === 'sent';
  return (
    <div className="rounded-xl border border-axal-hairline p-4 dark:border-gray-700">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-extrabold tracking-tight">{report.period}</span>
            <span className="text-[12.5px] text-axal-muted">
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
              <button type="button" className={ghostButtonClass} onClick={() => onEdit(report)}
                aria-label={`Edit the ${report.period} report for ${report.founder_name || report.need_title || report.engagement_uid}`}>
                Edit
              </button>
              <button
                type="button" className={buttonClass} aria-disabled={busy || undefined}
                title="Records that you sent it. Nothing here delivers anything."
                onClick={() => { if (!busy) onSend(report); }}
              >
                {sending ? 'Marking…' : 'Mark sent'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Shipped</div>
          <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-axal-muted">
            {report.shipped || <Unrecorded>Nothing written</Unrecorded>}
          </p>
        </div>
        <div>
          <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Next</div>
          <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-axal-muted">
            {report.next_up || <Unrecorded>Nothing written</Unrecorded>}
          </p>
        </div>
      </div>

      {sent ? (
        <p className="mt-3 text-[11.5px] leading-relaxed text-axal-faint">
          This is a record of what the client received, so it is not editable and
          not deletable. Write the next period’s report instead.
        </p>
      ) : (
        <div className="mt-3 flex">
          <button
            type="button" className={`${ghostButtonClass} ml-auto text-red-700 dark:text-red-300`}
            aria-disabled={busy || undefined} onClick={() => { if (!busy) onDelete(report); }}
          >
            Discard draft
          </button>
        </div>
      )}
      <SaveNote note={note?.scope === `rep:${report.id}` ? note : null} />
    </div>
  );
}

// The shape a composed draft always has lives in `statusReportDraft.js` (#4673), with the
// rule that a draft belongs to the engagement and period it was composed for.

function Composer({ engagements, onSaved, onError, note, focusTick = 0, target = null }) {
  const { run: runSave, isPending: isSaving } = useMutations();
  const shippedRef = useRef(null);
  const [engagementId, setEngagementId] = useState('');
  // D1424 (#3700): the header's "New report" lands the cursor on Engagement.
  const engagementRef = useRef(null);
  useEffect(() => {
    if (!focusTick) return;
    engagementRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    engagementRef.current?.focus?.({ preventScroll: true });
  }, [focusTick]);
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
  // #4673: which composition is current. A response for an older selection is
  // dropped, so it can neither show nor be saved under another engagement.
  const gate = useRef(null);
  if (!gate.current) gate.current = latestOnly();
  // D1329 (#3490, AF19): Fill with Eadwyn on Shipped and Next, from the
  // engagement record at no AI tokens. A saved draft is its record; a new one
  // hangs under its engagement, for this month only (the record's month is the
  // one the Worker reads). A sent report reads its marks only.
  const thisMonth = new Date().toISOString().slice(0, 7);
  const reportId = draft.existing?.id ?? null;
  const fill = useScopedFill({
    scope: SCOPED_FORMS.statusReport,
    record: reportId,
    parent: reportId ? null : (draft.engagement_id != null && draft.period === thisMonth ? Number(draft.engagement_id) : null),
    enabled: composed && (reportId != null || (draft.engagement_id != null && draft.period === thisMonth)),
    values: { shipped, next_up: nextUp },
    onValues: (v) => { if (v.shipped != null) setShipped(v.shipped); if (v.next_up != null) setNextUp(v.next_up); },
  });

  const composeFor = useCallback(async (forEngagement, forPeriod, thenFocus = false) => {
    if (!forEngagement) return;
    setLoadError('');
    const ticket = gate.current.start();
    const asked = { engagement_id: Number(forEngagement), period: forPeriod };
    try {
      const r = await api.getPartnerReportDraft(forEngagement, forPeriod);
      // #4673: the selection moved (or another compose started) while this one
      // was in flight: drop it.
      if (!gate.current.isCurrent(ticket)) return;
      // Spread over the empty shape rather than replacing it: a response that
      // omitted a list would otherwise reintroduce the undefined this exists
      // to prevent. The identity is the one ASKED for, whatever came back.
      setDraft(draftFrom(r, asked));
      setComposed(true);
      setShipped(r?.existing?.shipped || '');
      setNextUp(r?.existing?.next_up || '');
      if (thenFocus) setTimeout(() => shippedRef.current?.focus?.(), 0);
    } catch (e) {
      if (!gate.current.isCurrent(ticket)) return;
      setDraft(EMPTY_DRAFT);
      setComposed(false);
      setLoadError(e?.message || 'The draft could not be composed.');
    }
  }, []);
  const compose = useCallback(() => composeFor(engagementId, period), [composeFor, engagementId, period]);

  // EDIT OPENS THE REPORT THAT WAS CHOSEN (#4698). The button used to open the
  // composer on whatever engagement and period it already held; now the card
  // hands over its own engagement and period, they are set into the selectors,
  // and the report is composed for exactly that pair and focused.
  useEffect(() => {
    if (!target?.tick) return;
    setEngagementId(String(target.engagement_id));
    setPeriod(target.period);
    composeFor(target.engagement_id, target.period, true);
  }, [target?.tick]);

  return (
    <div className="rounded-lg border border-axal-hairline bg-axal-ground p-3 dark:border-gray-700">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Engagement">
          <select ref={engagementRef} className={inputClass} value={engagementId} data-testid="status-report-engagement"
            onChange={(e) => { gate.current.invalidate(); setEngagementId(e.target.value); setComposed(false); }}>
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
            onChange={(e) => { gate.current.invalidate(); setPeriod(e.target.value); setComposed(false); }} />
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
              <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
                Shipped in {draft.period}
              </div>
              {draft.shipped_from_log.length === 0 ? (
                <p className="mt-1 text-[12px] text-axal-faint">
                  Nothing in the deliverables log carries a send date in this period.
                </p>
              ) : (
                <ul className="mt-1 space-y-1 text-[12px] text-axal-muted">
                  {draft.shipped_from_log.map((x, i) => (
                    <li key={`${x.title}-${i}`}>
                      {x.title}{x.version ? ` (${x.version})` : ''}
                      {!x.opened && <span className="text-axal-faint"> · not opened</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
                Next, from open milestones
              </div>
              {draft.next_from_milestones.length === 0 ? (
                <p className="mt-1 text-[12px] text-axal-faint">No open milestone.</p>
              ) : (
                <ul className="mt-1 space-y-1 text-[12px] text-axal-muted">
                  {draft.next_from_milestones.map((m, i) => (
                    <li key={`${m.title}-${i}`}>
                      {m.title}{m.due_at ? ` · due ${m.due_at}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
                Blocked
              </div>
              {draft.blocked.length === 0 ? (
                <p className="mt-1 text-[12px] text-axal-faint">Nothing open.</p>
              ) : (
                <ul className="mt-1 space-y-1 text-[12px] text-axal-muted">
                  {draft.blocked.map((b, i) => (
                    <li key={`${b.summary}-${i}`}>
                      <Pill tone={b.side === 'client' ? 'info' : 'warn'}>
                        {b.side === 'client' ? 'Client' : 'Ours'}
                      </Pill>{' '}
                      {b.summary}
                      {b.days_open != null && <span className="text-axal-faint"> · {b.days_open}d</span>}
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

          <FillFormBar fill={fill} />
          <div className="grid gap-3">
            <Field label="Shipped" hint="Yours to write. The log above is what the record says was sent." fill={{ ctl: fill, name: 'shipped', value: shipped }}>
              <textarea ref={shippedRef} className={inputClass} rows={3} value={shipped} maxLength={4000}
                onChange={(e) => setShipped(e.target.value)} />
            </Field>
            <Field label="Next" hint="Yours to write. The milestones above are what is open." fill={{ ctl: fill, name: 'next_up', value: nextUp }}>
              <textarea className={inputClass} rows={3} value={nextUp} maxLength={4000}
                onChange={(e) => setNextUp(e.target.value)} />
            </Field>
          </div>

          <button
            type="button" className={buttonClass}
            disabled={draft.existing?.state === 'sent' || (!shipped.trim() && !nextUp.trim())}
            aria-disabled={isSaving('save') || undefined}
            onClick={async () => {
              if (isSaving('save')) return;
              // #4673: saved against the draft's own engagement and period,
              // which the Worker checks against the URL it is sent to. Taken
              // now, so a second press while this one is out starts nothing and
              // the words sent are the words that were on screen.
              const sending = saveRequest(draft, { shipped, next_up: nextUp });
              const r = await runSave('save', async () => {
                const saved = await api.savePartnerStatusReport(...sending);
                await fill.afterSave(saved?.id);
              });
              if (r.skipped) return;
              if (r.ok) await onSaved(); else onError(r.error);
            }}
          >
            {isSaving('save') ? 'Saving…' : 'Save draft'}
          </button>
          <SaveNote note={note?.scope === 'compose' ? note : null} />
        </div>
      )}
    </div>
  );
}

export default function PartnerStatusReportsZone() {
  // The skeleton is for the first read. A later one (every save or send) keeps
  // the composer and what is typed in it on screen (#4698).
  const { state: read, load } = useZoneRead(async () => {
    const [r, h] = await Promise.all([
      api.listPartnerStatusReports(),
      api.getPartnerDeliveryHealth(),
    ]);
    return { data: r || {}, engagements: Array.isArray(h?.items) ? h.items : [] };
  }, 'The status reports did not load.');
  const state = {
    loading: read.loading,
    error: read.error,
    data: read.data?.data ?? null,
    engagements: read.data?.engagements ?? null,
  };
  const [view, setView] = useState('this_cycle');
  const [note, setNote] = useState(null);
  const [composing, setComposing] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  // The report Edit was pressed on: its own engagement and period.
  const [editTarget, setEditTarget] = useState(null);
  const { run: runMutation, isPending } = useMutations();

  // One operation per report, so two reports are independent and a second click
  // on the same one starts nothing. A refusal is announced and nothing closes.
  const run = useCallback(async (key, fn, ok, scope) => {
    setNote(null);
    const r = await runMutation(key, fn);
    if (r.skipped) return false;
    if (!r.ok) {
      setNote({ ok: false, text: r.error?.message || 'That did not save.', scope });
      return false;
    }
    setNote({ ok: true, text: ok, scope });
    load();
    return true;
  }, [runMutation, load]);

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

  // D1424 (#3700, PH14s): the zone's primary opens the Composer and focuses
  // it. With no live engagement there is nothing to report on, so it is
  // disabled with that reason rather than opening an empty form.
  const newReport = {
    onClick: () => { setComposing(true); setFocusTick((n) => n + 1); },
    disabled: engagements.length === 0,
    title: engagements.length === 0 ? 'No engagement is live, so there is nothing to report on.' : undefined,
  };
  const rowActions = partnerZoneActions('delivery/status-reports', { handlers: { newReport }, view: { header: ['Period', 'Founder', 'State', 'Shipped', 'Next up'], rows: visible, cells: (r) => [r.period, r.founder_name, r.state, r.shipped, r.next_up] } });

  // NOT AN EARLY RETURN ANY MORE. This was
  //   `if (isNoPartnerProfile(state.error)) return <UnlinkedZone … />;`
  // which drew a card INSTEAD of the zone — on twelve zones, so an admin
  // reading this workspace saw twelve copies of one card and never a page.
  // `ZoneBody` takes the line as a `notice` above its states, and the zone
  // renders underneath in its own empty state, which is also the state that
  // says what this zone holds. The gate itself is untouched: the read still
  // 400s, so `isEmpty` is forced rather than inferred from rows that never
  // arrived, and `error` is cleared so the shared "This did not load" card —
  // the exact confusion `isNoPartnerProfile` exists to prevent — cannot fire.
  const unlinked = isNoPartnerProfile(state.error);

  return (
    <>
      {/* ACTIONS YES, FILTERS NO, when the account cannot read the store.
          An action states what the zone DOES and an export over nothing
          loaded renders disabled and says so; a filter chip is a claim about
          ROWS, and a selectable `Published` over a store this account cannot
          read is the "an empty set reads as an answer" failure
          `zoneFilterBuilder.js` exists to prevent, reached from a new
          direction. `profile_zone_actions.test.mjs` asserts both halves. */}
      <ZoneToolbar
        className="mb-3"
        role="partner"
        filters={unlinked ? [] : partnerZoneFilters('delivery/status-reports', { value: view, onChange: setView })}
        actions={rowActions}
      />
    <ZoneBody
      loading={state.loading}
      error={unlinked ? null : state.error}
      onRetry={load}
      notice={unlinked ? <NoPartnerProfile /> : null}
      isEmpty={unlinked || (items.length === 0 && !composing)}
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
      <div className="space-y-6" aria-busy={read.refreshing || undefined}>
        {read.refreshError && (
          <p role="alert" className="text-[12px] font-semibold text-red-700 dark:text-red-300">
            The reports could not be refreshed just now, so what is shown may be out of date. {read.refreshError}
          </p>
        )}
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
          <p className="text-[12.5px] leading-relaxed text-axal-muted">{d.delivery_note}</p>
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
          <p className="text-[12px] text-axal-muted">
            No report is in this state. {items.length} written in total.
          </p>
        )}

        <ZoneDraft
          surface="delivery/status-reports"
          railOption="draft:weekly-reports"
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
            focusTick={focusTick}
            target={editTarget}
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
            {/* THE SELECTED CHIP'S REPORTS, the set the feed and the export read.
                This list drew every report whatever was chosen, so Mark sent and
                Discard sat on rows the filter had excluded (#4698). */}
            {visible.map((r) => (
              <ReportCard
                key={r.id}
                report={r}
                sending={isPending(`send:${r.id}`)}
                discarding={isPending(`discard:${r.id}`)}
                note={note}
                onEdit={(rep) => {
                  setEditTarget({ engagement_id: rep.engagement_id, period: rep.period, tick: Date.now() + Math.random() });
                  setComposing(true);
                  setFocusTick((n) => n + 1);
                }}
                onSend={(rep) => run(
                  `send:${rep.id}`,
                  () => api.sendPartnerStatusReport(rep.id),
                  'Marked sent.', `rep:${rep.id}`,
                )}
                onDelete={(rep) => run(
                  `discard:${rep.id}`,
                  () => api.deletePartnerStatusReport(rep.id),
                  'Draft discarded.', `rep:${rep.id}`,
                )}
              />
            ))}
            {items.length > 0 && visible.length === 0 && (
              <p className="text-[12px] text-axal-muted">
                No report is in this state, so none is offered here. Choose another chip to reach the other {items.length}.
              </p>
            )}
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
