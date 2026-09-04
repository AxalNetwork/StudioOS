import React, { useCallback, useEffect, useState } from 'react';
import { Card, Pill } from '../../../ui';
import { api } from '../../../lib/api';
import { NothingYet, Unrecorded, ZoneBody, ZoneHeading } from '../expertise/kit';
import { BatchPicker, FromTheLab, NoBatch, StatedLimit, cohortLabel } from './kit';

/**
 * Cohorts · Calendar — the Lab's dates and your own sessions, on one page.
 *
 * THE CARD SAID "both halves exist and nothing joins them", AND IT WAS RIGHT.
 * This is the join, and it needed no migration: `week_windows` has held the
 * Lab's unlock/deadline pairs since migration 156 (16 rows across 4 cycles in
 * production today), and slots and bookings have existed since T13.
 *
 * THE WEEKS ROUTE DELIBERATELY DOES NOT DO THIS. Its comment in
 * `routes/advisors.ts` says joining slots there "would make that card false" —
 * so the join lives on the zone the card is about, and This week stays
 * Lab-sourced entirely.
 *
 * ONLY BOOKED SESSIONS APPEAR. An unbooked slot is availability, not an
 * obligation; putting a free afternoon on the same list as a deadline would
 * make it look like a commitment.
 *
 * `windows_recorded: false` IS AN ERROR STATE, NOT AN EMPTY ONE. A cycle
 * predating migration 156 has no windows at all, and rendering an empty
 * calendar would say the batch has no obligations — the one thing this page
 * must never claim.
 */
const KIND_TONE = { cohort: 'info', client: 'ok', demo_day: 'warn' };
const KIND_LABEL = { cohort: 'Cohort', client: 'Client', demo_day: 'Demo Day' };

export default function CalendarZone() {
  const [assignments, setAssignments] = useState({ loading: true, error: '', items: [] });
  const [cycleId, setCycleId] = useState(null);
  const [data, setData] = useState({ loading: false, error: '', payload: null });

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

  const load = useCallback(async () => {
    if (cycleId == null) return;
    setData((c) => ({ ...c, loading: true, error: '' }));
    try {
      const payload = await api.listMyAdvisorCohortCalendar(cycleId);
      // The Lab's record could not be read. Treating this as an empty calendar
      // would report a failed read as a batch with nothing due.
      if (payload && payload.windows_recorded === false) {
        setData({
          loading: false,
          error: 'The Lab has no week windows recorded for this cohort, so its dates cannot be shown. Cycles created before the Lab began recording them have none.',
          payload: null,
        });
        return;
      }
      setData({ loading: false, error: '', payload });
    } catch (e) {
      setData({ loading: false, error: e?.message || 'This batch’s calendar could not be read.', payload: null });
    }
  }, [cycleId]);
  useEffect(() => { load(); }, [load]);

  const payload = data.payload;
  const counts = payload?.counts || null;
  const items = payload?.items || [];
  const clashing = new Set((payload?.collisions || []).flatMap((c) => [c.a, c.b]));
  const batch = assignments.items.find((a) => a.cohort_cycle_id === cycleId)?.cohort;

  return (
    <div className="space-y-4">
      <ZoneHeading
        title="Calendar"
        blurb="The batch's dates and your own booked sessions, in one place."
      />

      {assignments.items.length > 1 && (
        <BatchPicker items={assignments.items} value={cycleId} onChange={setCycleId} />
      )}

      {/* NESTED, the way ThisWeekZone nests: the outer body owns "can I see any
          batch at all", the inner owns "did this batch's calendar read". Each
          states its own `loading` explicitly — `_zoneGuards` requires it, and
          the reason is that an implicit undefined works only by accident of
          ZoneBody checking loading first. */}
      <ZoneBody
        loading={assignments.loading}
        error={assignments.error}
        onRetry={loadAssignments}
        isEmpty={assignments.items.length === 0}
        empty={<NoBatch />}
      >
      <ZoneBody
        loading={data.loading}
        error={data.error}
        onRetry={load}
        isEmpty={!data.loading && !data.error && items.length === 0}
        empty={(
          <NothingYet
            title="Nothing in the next fourteen days"
            body={`${cohortLabel(batch)} has no deadlines and you have no booked sessions in the next two weeks. This window is deliberate — a calendar showing everything forever is a list, not a calendar.`}
          />
        )}
      >
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          {[
            { label: 'Next 14 days', value: counts?.next_14_days, note: 'cohort and client combined' },
            { label: 'Cohort obligations', value: counts?.cohort_obligations, note: 'unpaid, and non-negotiable' },
            { label: 'Collisions', value: counts?.collisions, note: 'one of the pair must move' },
            // Nothing stores a session brief, so this is absent, not zero.
            { label: 'Missing prep', value: counts?.missing_prep ?? null, note: 'no brief is recorded anywhere' },
          ].map((t) => (
            <Card key={t.label} className="px-3 py-2.5">
              <div className="text-[9px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">{t.label}</div>
              {t.value === null || t.value === undefined
                ? <div className="mt-1.5"><Unrecorded /></div>
                : <div className="mt-1 text-base font-extrabold tabular-nums tracking-tight">{t.value}</div>}
              <div className="mt-1 text-[10px] leading-snug text-axal-ink-3">{t.note}</div>
            </Card>
          ))}
        </div>

        <FromTheLab>
          the batch's dates are the Lab's record, read-only here — your own sessions are yours
        </FromTheLab>

        <Card className="p-4">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <span className="text-sm font-extrabold tracking-tight">Next fourteen days</span>
            <span className="text-[11px] text-axal-ink-3">Soonest first</span>
          </div>
          <ul className="divide-y divide-axal-border-soft">
            {items.map((it) => (
              <li key={it.ref} className="flex items-start justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={KIND_TONE[it.kind] || 'neutral'}>{KIND_LABEL[it.kind] || it.kind}</Pill>
                    {clashing.has(it.ref) && <Pill tone="danger">Collision</Pill>}
                  </div>
                  <div className="mt-1 truncate text-[12.5px] font-semibold">{it.title}</div>
                </div>
                <div className="shrink-0 text-right text-[11px] tabular-nums text-axal-ink-3">
                  <div>{String(it.starts_at || '').slice(0, 10)}</div>
                  <div>{String(it.starts_at || '').slice(11, 16)}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <StatedLimit title="What a collision is, and what is not counted">
          <p>
            A collision is an obligation landing inside a booked session, or two sessions
            overlapping. A week window spans seven days and every session in the month falls
            inside one, so overlapping a window is not a clash — counting it would report
            four collisions a week, forever.
          </p>
          <p>
            Sessions that merely touch — one ending as the next begins — are not a clash
            either. Missing prep is not counted at all: nothing in the product stores a
            session brief, so every session would read as unprepared.
          </p>
        </StatedLimit>
      </ZoneBody>
      </ZoneBody>
    </div>
  );
}
