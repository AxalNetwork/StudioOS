import React, { useState } from 'react';
import { labOperationsApi } from '../../../lib/api/labOperations';
import { LogPage } from './LabActivity';
import { CARD, H2, SUB, useRead } from './labParts';
import { ReadState } from './labOperationsParts';
import { stamp } from './labOperationsModel';
function CapacityCheck({ cohort }) {
  const [tick, setTick] = useState(0);
  const read = useRead(`capacity:${cohort}`, tick, () => labOperationsApi.capacity(cohort).then(r => {
    if (typeof r?.recorded !== 'boolean' || (r.recorded && !['capacity_ok', 'cycle_postponed', 'capacity_unreadable'].includes(r.outcome))) throw new Error('invalid_capacity_result');
    return r;
  }).catch(e => { if (e?.status === 404) return { not_found: true }; throw e; }));
  const d = read.data;
  const words = { capacity_ok: 'Run the cohort', cycle_postponed: 'Move to the following cohort', capacity_unreadable: 'Capacity could not be checked' };
  return <section className={`${CARD} flex flex-col gap-3 p-4`} data-testid="lab-cohort-capacity-result"><h2 className={H2}>Recorded capacity check</h2>
    <ReadState read={read} what="The capacity check" claim="The recorded result could not be read." onRetry={() => setTick(n => n + 1)} testId="lab-cohort-capacity" />
    {d?.not_found ? <p className={SUB}>This cohort was not found.</p> : d && <><p className={SUB}>{d.recorded ? `${words[d.outcome]} · ${stamp(d.at)}` : `Not recorded — ${d.reason}`}</p>
      {d.recorded && <p className={SUB}>{d.approved == null || d.minimum == null ? 'Approved and minimum at the check: Not recorded.' : `${d.approved} approved · minimum ${d.minimum} at the check.`}</p>}</>}
  </section>;
}
function Events({ cohort, type, title }) {
  const [page, setPage] = useState(1), [tick, setTick] = useState(0);
  return <section className={`${CARD} flex min-w-0 flex-col gap-3 p-4`} data-testid={`lab-cohort-${type || 'history'}`}><h2 className={H2}>{title}</h2>
    <LogPage key={`${cohort}:${page}`} query={{ cohort, type, sort: 'newest' }} page={page} setPage={setPage} tick={tick} retry={() => setTick(n => n + 1)} />
  </section>;
}
export default function LabCohortDetails({ cohort }) {
  return <div className="flex min-w-0 flex-col gap-4"><CapacityCheck cohort={cohort} /><Events cohort={cohort} type="messages" title="Messages" /><Events cohort={cohort} type="" title="History" /></div>;
}
