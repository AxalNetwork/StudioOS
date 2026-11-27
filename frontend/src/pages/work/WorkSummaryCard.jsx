import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Failed, INK, LINK, MUTED, PCard, Reading } from '../account/companies/portfolioUi.jsx';
import { workAdapter } from './workAdapter.js';
import { COLUMNS, burnup } from './workModel.js';

/** #4420: Portfolio's project-only ENTRY card; summary and two-week history fail independently. */
export default function WorkSummaryCard({ projectId }) {
  const [state, setState] = useState({ status: 'loading' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    Promise.allSettled([workAdapter.summary(projectId), workAdapter.burnup(projectId, { range: '2w' })]).then(([summary, history]) => {
      if (!alive) return;
      if (summary.status === 'rejected') { setState({ status: 'error' }); return; }
      if (!summary.value.available) { setState({ status: 'off', reason: summary.value.reason }); return; }
      const counts = summary.value.data;
      if (!counts || ![counts.open, counts.closed, ...COLUMNS.map(({key}) => counts.columns?.[key])].every((n) => Number.isSafeInteger(n) && n >= 0)) { setState({ status: 'error' }); return; }
      setState({ status: 'ready', summary: counts, history });
    });
    return () => { alive = false; };
  }, [projectId, tick]);
  const retry = () => setTick((n) => n + 1);
  const history = state.history?.status === 'fulfilled' ? state.history.value : null;
  const graph = history?.available && history.data?.available ? burnup(history.data.series, { width: 260, height: 70 }) : null;
  const historyFailed = state.history?.status === 'rejected' || (history?.available && (!history.data || typeof history.data.available !== 'boolean' || (history.data.available && !Array.isArray(history.data.series))));
  const line = graph && !graph.empty ? `${graph.tiles.completed} of ${graph.tiles.scope} completed · last 2 weeks` : 'Not recorded';
  return (
    <PCard title="Work" testId="project-work-card">
      {state.status === 'loading' ? <Reading /> : null}
      {state.status === 'off' ? <p className={`m-0 ${MUTED}`} data-testid="project-work-off">{state.reason}</p> : null}
      {state.status === 'error' ? <Failed what="Work" onRetry={retry} testId="project-work-unread" /> : null}
      {state.status === 'ready' ? <div className="flex min-w-0 flex-col gap-3">
        <p className={`m-0 font-mono text-[13px] ${INK}`} data-testid="project-work-counts">{state.summary.open} open · {state.summary.closed} closed</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {COLUMNS.map(({key, label}) => <div key={key} className="rounded-lg bg-axal-ground p-2 dark:bg-gray-800"><span className={`block text-[11px] capitalize ${MUTED}`}>{label}</span><b className={`font-mono ${INK}`}>{state.summary.columns[key]}</b></div>)}
        </div>
        {historyFailed ? <Failed what="Work history" onRetry={retry} testId="project-work-history-unread" /> : history && !history.available ? <p className={`m-0 ${MUTED}`}>{history.reason}</p> : <div className="flex flex-wrap items-center gap-3">
          {graph && !graph.empty ? <svg viewBox="0 0 260 70" className="h-[70px] w-[260px] max-w-full" role="img" aria-label={line}>
            <path d={graph.scope} fill="none" stroke="currentColor" className="text-axal-muted dark:text-gray-400" strokeWidth="2" />
            <path d={graph.completed} fill="none" stroke="currentColor" className="text-violet-600 dark:text-violet-400" strokeWidth="2" />
          </svg> : null}
          <p className={`m-0 ${MUTED}`} data-testid="project-work-completed">{line}</p>
        </div>}
      </div> : null}
      <Link className={`${LINK} mt-3 inline-flex`} to={`/projects/${encodeURIComponent(projectId)}/work`}>Open Work ›</Link>
    </PCard>
  );
}
