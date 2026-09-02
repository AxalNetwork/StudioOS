import React, { useCallback, useEffect, useState } from 'react';
import { Card } from '../../../ui';
import { api } from '../../../lib/api';
import { NothingYet, Unrecorded, ZoneBody, ZoneHeading } from '../expertise/kit';
import { BatchPicker, FromTheLab, NoBatch, StatedLimit, cohortLabel } from './kit';

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
export default function FoundersZone() {
  const [assignments, setAssignments] = useState({ loading: true, error: '', items: [] });
  const [cycleId, setCycleId] = useState(null);
  const [batch, setBatch] = useState({ loading: false, error: '', items: [] });

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
          <Card padding="none" className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-axal-hairline text-left dark:border-gray-700">
                  <th className="px-4 py-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Founder</th>
                  <th className="px-4 py-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Contact</th>
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
          <StatedLimit title="What this page cannot show">
            Company, stage, a live signal per founder, and your own next action beside each of
            them are all asked for by the design and none has a store behind it. They are absent
            rather than empty — the columns are not here at all, so a blank is never mistaken for
            a founder with nothing going on.
          </StatedLimit>
        </ZoneBody>
      </ZoneBody>
    </div>
  );
}
