/**
 * D4866 (#4866, Grow v2 GR-10): the Reporting desk's "Readiness for the next update" card, for a founder who
 * writes it. One read of Grow's overview (`readinessModel.js`); each figure in the platform's states (D5129) with
 * its source line, and a link back to Focus, where a stale or missing figure is fixed, with the venture kept.
 * Loading, Unavailable (with Retry) and Refused say so; a failed read never claims the figures are missing.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { cyclesApi } from '../../../lib/api/cycles';
import { DataState, StateChip, Unreadable } from '../../../ui';
import { projectSearch } from '../founderToolNavigation';
import { readinessRows } from './readinessModel';
import { CARD, H2, MUTED } from './DeskBlocks.jsx';

const readGrow = (projectId) => cyclesApi.overview('grow', projectId);

export default function ReportReadiness({ projectId, search = '', read = readGrow, now }) {
  const [state, setState] = useState({ status: 'loading', raw: null });
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!projectId) return undefined;
    let alive = true;
    setState({ status: 'loading', raw: null });
    Promise.resolve().then(() => read(projectId))
      .then((raw) => { if (alive) setState({ status: 'ready', raw }); })
      .catch((e) => { if (alive) setState({ status: e?.status === 403 ? 'refused' : 'unreadable', raw: null }); });
    return () => { alive = false; };
  }, [projectId, read, reload]);

  const head = <h2 id="reporting-readiness-title" className={H2}>Readiness for the next update</h2>;
  if (state.status === 'loading') {
    return <section className={CARD} aria-labelledby="reporting-readiness-title" aria-busy="true" data-testid="reporting-readiness-loading">{head}<div className="h-3 w-48 animate-pulse rounded bg-axal-ground dark:bg-gray-800" /></section>;
  }
  if (state.status === 'refused') {
    return <section className={CARD} aria-labelledby="reporting-readiness-title" data-testid="reporting-readiness-refused">{head}<DataState state="refused" size="block" what="this venture’s Grow figures" /></section>;
  }
  const view = state.status === 'ready' ? readinessRows(state.raw, { now: now ?? Date.now() }) : { state: 'unavailable' };
  if (view.state !== 'ready') {
    return <section className={CARD} aria-labelledby="reporting-readiness-title" data-testid="reporting-readiness-unavailable">{head}
      <Unreadable what="The Grow figures" claim="This is not a claim that nothing is recorded." onRetry={() => setReload((n) => n + 1)} /></section>;
  }
  return (
    <section className={CARD} aria-labelledby="reporting-readiness-title" data-testid="reporting-readiness">
      <div className="flex flex-wrap items-baseline justify-between gap-2">{head}
        <span className={MUTED} data-testid="reporting-readiness-count">{view.ready} of {view.total} figures current</span></div>
      <ul className="m-0 list-none p-0">
        {view.rows.map((r) => (
          <li key={r.key} className="flex flex-col gap-1 border-t border-axal-hairline py-2.5 first:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3 dark:border-gray-800" data-testid={`reporting-readiness-${r.key}`} data-kind={r.kind}>
            <div className="min-w-0"><b className="text-[13px] text-axal-ink dark:text-gray-100">{r.label}</b>
              <p className={MUTED}>{r.detail}</p></div>
            <span className="flex flex-wrap items-center gap-2">
              {r.value ? <span className="font-mono text-[13px] font-bold text-axal-ink dark:text-gray-100">{r.value}</span> : null}
              {r.kind === 'current' ? null : <StateChip kind={r.kind} age={r.age || undefined} />}
            </span>
          </li>
        ))}
      </ul>
      <p className={MUTED}>These are the figures the Grow overview shows today. A stale or missing figure is fixed in <Link className="font-bold text-axal-violet-deep underline dark:text-violet-300" to={'/grow/focus' + projectSearch(search)}>Focus</Link>.</p>
    </section>
  );
}
