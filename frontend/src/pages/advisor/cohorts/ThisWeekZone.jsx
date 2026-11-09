import React from 'react';
import { Card } from '../../../ui';
import { NothingYet, Pill, Unrecorded, ZoneBody, ZoneHeading } from '../expertise/kit';
import { FromTheLab, NoBatch, StatedLimit, WEEK_TONE, cohortLabel } from './kit';
import { CohortLoading, useCohortWorkspace } from './CohortWorkspace';

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
  // D4813: the cohort is the workspace's (header selector, `?cohort=`), and so
  // is its week record — read once in the provider, so this page and the
  // header's "Week n of 4" cannot disagree about which week it is.
  const ws = useCohortWorkspace();
  const weeks = ws.weeks;
  const load = ws.reloadWeeks;

  const d = weeks.data;
  const current = ws.current;
  const week = d?.current_week ?? null;

  return (
    <div className="space-y-4">
      <ZoneHeading
        title="Where the batch is this week"
        blurb="The Lab's own week record for the cohort you were assigned. Read-only, and about the founders' progress rather than yours."
      />

      <ZoneBody
        loading={ws.assignments.loading}
        error={ws.assignments.error}
        onRetry={ws.reloadAssignments}
        isEmpty={ws.assignments.items.length === 0}
        empty={<NoBatch />}
      >
        {weeks.loading && <CohortLoading what="the week record" />}
        <ZoneBody loading={weeks.loading} error={weeks.error} onRetry={load}
          isEmpty={!d}
          empty={<NothingYet title="Nothing recorded for this cohort" body="The Lab has no week record against this cycle." />}>
          {d && (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Card padding="md">
                  <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Batch</div>
                  <div className="mt-1 text-[16px] font-extrabold">{cohortLabel(current?.cohort || d.cycle)}</div>
                  <div className="mt-0.5 text-[11.5px] text-axal-faint">Cycle is {d.cycle?.status || 'not recorded'}</div>
                </Card>
                <Card variant="accent" padding="md">
                  <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Week</div>
                  <div className="mt-1 text-[22px] font-extrabold tabular-nums">
                    {d.windows_recorded && week != null ? week : <Unrecorded>Not recorded</Unrecorded>}
                  </div>
                  {!d.windows_recorded && (
                    <div className="mt-0.5 text-[11px] leading-relaxed text-axal-faint">
                      This cycle has no week windows recorded, so which week it is in cannot be
                      derived. It is not week one by default.
                    </div>
                  )}
                </Card>
                <Card padding="md">
                  <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Founders</div>
                  <div className="mt-1 text-[22px] font-extrabold tabular-nums">{(d.founders || []).length}</div>
                </Card>
              </div>

              {d.windows_recorded && week != null && (d.founders || []).length > 0 && (
                <Card padding="none" className="mt-3 overflow-x-auto">
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr className="border-b border-axal-hairline text-left dark:border-gray-700">
                        <th className="px-4 py-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Founder</th>
                        <th className="px-4 py-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Week {week}</th>
                        <th className="px-4 py-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Deliverables</th>
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
