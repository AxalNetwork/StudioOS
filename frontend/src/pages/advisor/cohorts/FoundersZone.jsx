import React, { useCallback, useEffect, useState } from 'react';
import { Card } from '../../../ui';
import { api } from '../../../lib/api';
import { NothingYet, StatedLimit, Unrecorded, ZoneBody, ZoneHeading } from '../expertise/kit';
import { BatchPicker, FromTheLab, NoBatch, cohortLabel } from './kit';

/**
 * Cohorts · Founders — the batch an admin put this advisor in front of.
 *
 * THE CARD THIS REPLACES WAS FALSE ON THREE COUNTS. It said "Cohort assignment
 * does not exist yet", "Nothing in the product links an advisor to a cohort",
 * and "no table joins them". All three stopped being true when migration 206
 * and its routes shipped, and the file that rendered it says why that matters:
 * a card describing a closed gap tells an advisor a working feature is missing.
 *
 * THE ASSIGNMENT IS THE AUTHORISATION, AND A REFUSAL IS NOT AN EMPTY LIST. The
 * worker returns 403 without an active assignment, whatever the caller's role.
 * That renders as a stated boundary — see `NoBatch` — because "no founders"
 * would report a refusal as a fact about the cohort.
 *
 * WHAT THIS PAGE DOES NOT SHOW, said on the page rather than left as a blank.
 * The canvas asked for company, stage, one live signal each, and the advisor's
 * own next action beside every founder. The read returns `{user_id, name,
 * email}`. Three of those four have no store, so the page says so instead of
 * rendering an empty column that reads as missing data.
 */
/**
 * D393 — THE WEEK LANES, FROM THE LAB'S OWN WEEK RECORD.
 *
 * C1 draws four lanes, one per week, with every founder's card in the lane of
 * the week their cohort is in: "Lanes come from the cohort, not the founder".
 * `GET /me/cohort/:id/weeks` already returns the cycle's windows, the batch's
 * `current_week` (computed server-side from the windows) and each founder's
 * per-week status and deliverable counts, so this is a read of an existing
 * route, not a new one. One batch is on screen at a time (the batch picker is
 * the canvas's per-cohort chips), so every card sits in one lane and the other
 * lanes read "Nobody here yet" — which is true.
 *
 * NO WINDOWS, NO LANES. A cycle with no week windows has no current week, and
 * a board that put everyone in Week 1 would invent the one fact the lanes
 * exist to show. `lanes` is null and the page says why.
 */
export function lanesFrom(weeksPayload, batchFounders) {
  const windows = Array.isArray(weeksPayload?.weeks) ? weeksPayload.weeks : [];
  const current = weeksPayload?.current_week ?? null;
  const byUser = new Map((weeksPayload?.founders || []).map((f) => [Number(f.user_id), f]));
  const cards = (batchFounders || []).map((f) => {
    const row = byUser.get(Number(f.user_id))?.weeks?.[current] || null;
    const done = row ? Number(row.deliverables_done) : null;
    const required = row ? Number(row.deliverables_required) : null;
    // Nothing required this week is not 0% — there is no fraction to show.
    const pct = row && required > 0 ? Math.round((done / required) * 100) : null;
    return {
      user_id: f.user_id,
      name: f.name || null,
      status: row?.status || null,
      done, required, pct,
      behind: pct !== null && pct < 50,
      complete: pct === 100,
    };
  });
  if (!weeksPayload?.windows_recorded || !windows.length) {
    return { lanes: null, cards, reason: 'This cycle has no week windows recorded, so which week the batch is in cannot be derived — and the lanes are that week.' };
  }
  if (current == null) {
    return { lanes: null, cards, reason: 'No week of this cycle has opened yet, so the batch is in no lane.' };
  }
  return {
    lanes: windows.map((w) => ({ week: w.week_number, cards: w.week_number === current ? cards : [] })),
    cards,
    current,
    reason: null,
  };
}

/** The canvas's two view chips over the cards. Per-cohort chips are the batch picker. */
export const FOUNDER_VIEWS = {
  all: () => true,
  behind: (c) => c.behind,
};

function initials(name) {
  return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '·';
}

/** One founder in a lane. No company line: the founders read returns none (see below). */
export function FounderCard({ card }) {
  return (
    <div className={`rounded-[10px] border p-3 ${card.behind ? 'border-red-200 bg-red-50/40 dark:border-red-900' : 'border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900'}`} data-testid="founder-card">
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-lg bg-emerald-100 text-[10px] font-extrabold text-emerald-800">{initials(card.name)}</span>
        <span className="min-w-0 truncate text-[12.5px] font-extrabold">{card.name || <Unrecorded>Name not recorded</Unrecorded>}</span>
      </div>
      {card.pct === null ? (
        <div className="mt-2 text-[10.5px] text-axal-faint">
          {card.required === 0
            ? 'No deliverable is required this week.'
            : <Unrecorded reason="The Lab has no status row for this founder in this week.">Progress not recorded</Unrecorded>}
        </div>
      ) : (
        <>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-axal-hairline">
            <div className={`h-full rounded-full ${card.complete ? 'bg-emerald-600' : card.behind ? 'bg-red-600' : 'bg-amber-600'}`} style={{ width: `${card.pct}%` }} />
          </div>
          <div className="mt-1 text-[10px] font-bold tabular-nums">{`${card.done} of ${card.required} deliverables · ${card.pct}%`}</div>
        </>
      )}
      {card.behind && (
        <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[10px] text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          Behind plan — under half this week&apos;s deliverables
        </div>
      )}
    </div>
  );
}

export default function FoundersZone() {
  const [assignments, setAssignments] = useState({ loading: true, error: '', items: [] });
  const [cycleId, setCycleId] = useState(null);
  const [batch, setBatch] = useState({ loading: false, error: '', items: [] });
  const [weeks, setWeeks] = useState({ error: '', payload: null });
  const [view, setView] = useState('all');

  const loadAssignments = useCallback(async () => {
    setAssignments((c) => ({ ...c, loading: true, error: '' }));
    try {
      const res = await api.listMyAdvisorCohorts();
      const items = Array.isArray(res?.items) ? res.items : [];
      setAssignments({ loading: false, error: '', items });
      setCycleId(items[0]?.cohort_cycle_id ?? null);
    } catch (e) {
      setAssignments({ loading: false, error: e?.message || 'Your cohort assignments could not be read.', items: [] });
    }
  }, []);

  useEffect(() => { loadAssignments(); }, [loadAssignments]);

  const loadBatch = useCallback(async () => {
    if (cycleId == null) return;
    setBatch((c) => ({ ...c, loading: true, error: '' }));
    try {
      const res = await api.listMyAdvisorCohortFounders(cycleId);
      setBatch({ loading: false, error: '', items: Array.isArray(res?.items) ? res.items : [] });
      // The lanes' week record. Its own state: a failed week read must not
      // hide the roster, and an unavailable one says so rather than drawing
      // every founder at 0%.
      try {
        const w = await api.listMyAdvisorCohortWeeks(cycleId);
        if (w && w.available === false) setWeeks({ error: w.detail || 'The Lab’s week record could not be read.', payload: null });
        else setWeeks({ error: '', payload: w });
      } catch (err) {
        setWeeks({ error: err?.message || 'The Lab’s week record could not be read.', payload: null });
      }
    } catch (e) {
      // The worker's own sentence — "You are not assigned to this cohort", or
      // the eligibility refusal — reaches `e.message` and is shown as-is. A
      // refusal explains itself better than anything this page could invent.
      setBatch({ loading: false, error: e?.message || 'This batch could not be read.', items: [] });
    }
  }, [cycleId]);

  useEffect(() => { loadBatch(); }, [loadBatch]);

  const current = assignments.items.find((a) => a.cohort_cycle_id === cycleId);

  return (
    <div className="space-y-4">
      <ZoneHeading
        title="The founders you were assigned"
        blurb="An admin decides which cohort you advise. Everything below is the Lab's record and the founder's own — read-only to the practice."
        action={<BatchPicker items={assignments.items} value={cycleId} onChange={setCycleId} />}
      />

      <ZoneBody
        loading={assignments.loading}
        error={assignments.error}
        onRetry={loadAssignments}
        isEmpty={assignments.items.length === 0}
        empty={<NoBatch />}
      >
        <ZoneBody loading={batch.loading} error={batch.error} onRetry={loadBatch}
          isEmpty={batch.items.length === 0}
          empty={(
            <NothingYet
              title={`No founders are recorded in ${cohortLabel(current?.cohort)}`}
              body="You are assigned to this cohort, and the Lab has no members recorded against it. That is the Lab's record as it stands, not a failed read."
            />
          )}>
          {(() => {
            const model = lanesFrom(weeks.payload, batch.items);
            const shown = (c) => (FOUNDER_VIEWS[view] || FOUNDER_VIEWS.all)(c);
            const behind = model.cards.filter((c) => c.behind).length;
            const complete = model.cards.filter((c) => c.complete).length;
            return (
              <div className="mb-4 space-y-3" data-testid="founder-lanes">
                <div className="flex flex-wrap items-center gap-2">
                  {[['all', 'All'], ['behind', 'Behind plan']].map(([key, label]) => (
                    <button key={key} type="button" onClick={() => setView(key)}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${view === key ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-axal-hairline text-axal-muted'}`}>
                      {label}
                    </button>
                  ))}
                  {/* The canvas draws a bulk nudge. Nothing sends a founder a
                      message from a cohort, so it is drawn as the gap it is. */}
                  <button type="button" disabled title="Nothing sends a founder a nudge from a cohort: there is no cohort-to-founder message route."
                    className="rounded-full border border-dashed border-axal-hairline px-2.5 py-1 text-[11px] text-axal-faint">
                    Bulk: nudge behind-plan · not built
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
                  {[
                    { label: 'Assigned', value: model.cards.length, note: `in ${cohortLabel(current?.cohort)}` },
                    { label: 'Behind plan', value: model.lanes ? behind : null, note: 'under half this week’s deliverables' },
                    { label: 'Complete', value: model.lanes ? complete : null, note: 'every deliverable this week in' },
                    { label: 'Flagged', value: null, note: 'nothing records an open question or a missed reply per founder' },
                  ].map((t) => (
                    <Card key={t.label} className="px-3 py-2.5">
                      <div className="text-[9px] font-extrabold uppercase tracking-[.09em] text-axal-faint">{t.label}</div>
                      {t.value === null || t.value === undefined
                        ? <div className="mt-1.5"><Unrecorded /></div>
                        : <div className="mt-1 text-base font-extrabold tabular-nums tracking-tight">{t.value}</div>}
                      <div className="mt-1 text-[10px] leading-snug text-axal-faint">{t.note}</div>
                    </Card>
                  ))}
                </div>
                {weeks.error ? (
                  <p role="alert" className="text-[12px] text-red-700 dark:text-red-300">{weeks.error} The roster below is still the Lab&apos;s record.</p>
                ) : model.lanes ? (
                  <div className="grid grid-cols-1 gap-2.5 md:grid-cols-4">
                    {model.lanes.map((lane) => {
                      const cards = lane.cards.filter(shown);
                      return (
                        <div key={lane.week} data-testid={`lane-${lane.week}`}>
                          <div className="mb-2 flex items-baseline justify-between">
                            <span className="text-[12px] font-extrabold">{`Week ${lane.week}`}{lane.week === model.current ? ' · now' : ''}</span>
                            <span className="text-[11px] font-bold tabular-nums text-axal-faint">{cards.length}</span>
                          </div>
                          <div className="grid gap-2">
                            {cards.map((c) => <FounderCard key={c.user_id} card={c} />)}
                            {cards.length === 0 && (
                              <div className="rounded-[10px] border border-dashed border-axal-hairline p-3 text-center text-[11px] text-axal-faint">Nobody here yet</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[12px] text-axal-muted">{model.reason}</p>
                )}
              </div>
            );
          })()}
          <Card padding="none" className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-axal-hairline text-left dark:border-gray-700">
                  <th className="px-4 py-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Founder</th>
                  <th className="px-4 py-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Contact</th>
                </tr>
              </thead>
              <tbody>
                {batch.items.map((f) => (
                  <tr key={f.user_id} className="border-b border-axal-hairline/60 last:border-0 dark:border-gray-800">
                    <td className="px-4 py-2.5 font-semibold">{f.name || <Unrecorded>Name not recorded</Unrecorded>}</td>
                    <td className="px-4 py-2.5">{f.email || <Unrecorded />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <div className="mt-3"><FromTheLab /></div>
          <StatedLimit title="What a card does not carry">
            Each card is the founder&apos;s name and this week&apos;s deliverables, both the Lab&apos;s record.
            The Lab&apos;s roster records no company for a founder, so none is shown. Behind plan is the
            one flag, read from the deliverable count; an unanswered question or a missed reply is not
            recorded for any founder, so nothing here claims one.
          </StatedLimit>
          {/* COMPANY, STAGE, A LIVE SIGNAL AND YOUR NEXT ACTION ARE NOT DRAWN.
              The design asks for a column each and none has a store behind it.
              They are absent rather than empty: the columns are not here at
              all, so a blank is never mistaken for a founder with nothing going
              on. That rule has not changed — what changed is that the page used
              to say so in a panel beneath the table, which told a reader about
              the design rather than about their cohort. */}
        </ZoneBody>
      </ZoneBody>
    </div>
  );
}
