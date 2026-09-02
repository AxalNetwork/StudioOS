import React, { useCallback, useEffect, useState } from 'react';
import { Card } from '../../../ui';
import { api } from '../../../lib/api';
import { NothingYet, Pill, Unrecorded, ZoneBody, ZoneHeading } from '../expertise/kit';
import { BatchPicker, FromTheLab, NoBatch, StatedLimit, WEEK_TONE, cohortLabel } from './kit';

/**
 * Cohorts · This week — where the batch is in the Lab's four-week cycle.
 *
 * THE CARD THIS REPLACES SAID "the weekly view has nothing to aggregate …
 * without a cohort assignment there is no batch to aggregate over." There is a
 * batch now. What is genuinely missing is different and narrower, and the page
 * says which — see the stated limit at the bottom.
 *
 * WHOSE WEEK THIS IS. The Lab's, and the founders'. It is not the advisor's:
 * nothing in the product records what an advisor owes a batch in a given week,
 * so this page reports the batch's progress and makes no claim about the
 * reader's own obligations. That distinction is the whole correction.
 *
 * `windows_recorded: false` IS RENDERED AS ITSELF. A cycle predating migration
 * 156 has no week windows, so there is no "current week" to state. Showing
 * "week 1" for one would invent the single fact this page exists to report.
 */
export default function ThisWeekZone() {
  const [assignments, setAssignments] = useState({ loading: true, error: '', items: [] });
  const [cycleId, setCycleId] = useState(null);
  const [weeks, setWeeks] = useState({ loading: false, error: '', data: null });

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
    setWeeks((c) => ({ ...c, loading: true, error: '' }));
    try {
      const data = await api.listMyAdvisorCohortWeeks(cycleId);
      // `available: false` is the worker saying it could not read the Lab's
      // record. It is an error, never an empty week — treating it as empty
      // would report a failed read as a batch with no progress.
      if (data && data.available === false) {
        setWeeks({ loading: false, error: data.detail || 'The Lab’s week record could not be read.', data: null });
        return;
      }
      setWeeks({ loading: false, error: '', data });
    } catch (e) {
      setWeeks({ loading: false, error: e?.message || 'This batch could not be read.', data: null });
    }
  }, [cycleId]);

  useEffect(() => { load(); }, [load]);

  const d = weeks.data;
  const current = assignments.items.find((a) => a.cohort_cycle_id === cycleId);
  const week = d?.current_week ?? null;

  return (
    <div className="space-y-4">
      <ZoneHeading
        title="Where the batch is this week"
        blurb="The Lab's own week record for the cohort you were assigned. Read-only, and about the founders' progress rather than yours."
        action={<BatchPicker items={assignments.items} value={cycleId} onChange={setCycleId} />}
      />

      <ZoneBody
        loading={assignments.loading}
        error={assignments.error}
        onRetry={loadAssignments}
        isEmpty={assignments.items.length === 0}
        empty={<NoBatch />}
      >
        <ZoneBody loading={weeks.loading} error={weeks.error} onRetry={load}
          isEmpty={!d}
          empty={<NothingYet title="Nothing recorded for this cohort" body="The Lab has no week record against this cycle." />}>
          {d && (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Card padding="md">
                  <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Batch</div>
                  <div className="mt-1 text-[16px] font-extrabold">{cohortLabel(current?.cohort || d.cycle)}</div>
                  <div className="mt-0.5 text-[11.5px] text-axal-ink-3">Cycle is {d.cycle?.status || 'not recorded'}</div>
                </Card>
                <Card variant="accent" padding="md">
                  <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Week</div>
                  <div className="mt-1 text-[22px] font-extrabold tabular-nums">
                    {d.windows_recorded && week != null ? week : <Unrecorded>Not recorded</Unrecorded>}
                  </div>
                  {!d.windows_recorded && (
                    <div className="mt-0.5 text-[11px] leading-relaxed text-axal-ink-3">
                      This cycle has no week windows recorded, so which week it is in cannot be
                      derived. It is not week one by default.
                    </div>
                  )}
                </Card>
                <Card padding="md">
                  <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Founders</div>
                  <div className="mt-1 text-[22px] font-extrabold tabular-nums">{(d.founders || []).length}</div>
                </Card>
              </div>

              {d.windows_recorded && week != null && (d.founders || []).length > 0 && (
                <Card padding="none" className="mt-3 overflow-x-auto">
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr className="border-b border-axal-hairline text-left dark:border-gray-700">
                        <th className="px-4 py-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Founder</th>
                        <th className="px-4 py-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Week {week}</th>
                        <th className="px-4 py-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Deliverables</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.founders.map((f) => {
                        const w = f.weeks?.[week];
                        return (
                          <tr key={f.user_id} className="border-b border-axal-hairline/60 last:border-0 dark:border-gray-800">
                            <td className="px-4 py-2.5 font-semibold">{f.name || <Unrecorded>Name not recorded</Unrecorded>}</td>
                            <td className="px-4 py-2.5">
                              {w ? <Pill tone={WEEK_TONE[w.status] || 'neutral'}>{w.status}</Pill> : <Unrecorded />}
                            </td>
                            <td className="px-4 py-2.5 tabular-nums">
                              {w ? `${w.deliverables_done}/${w.deliverables_required}` : <Unrecorded />}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </Card>
              )}

              <div className="mt-3"><FromTheLab /></div>
              <StatedLimit title="This is the batch's week, not yours">
                Nothing in the product records what an advisor owes a batch in a given week, so
                this page cannot tell you what is due from you. It reports what the Lab has
                decided about the founders and adds no judgement of its own.
              </StatedLimit>
            </>
          )}
        </ZoneBody>
      </ZoneBody>
    </div>
  );
}
