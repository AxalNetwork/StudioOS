/** D6017 (#6017): V9 experiment cards, shared by the desktop and phone module. */
import { Link } from 'react-router-dom';
import { BuildInLovable } from './lovable/BuildInLovable.jsx';
const STATUS = { planned: 'Planned', running: 'Running', result_needed: 'Result needed', completed: 'Completed with result', stopped: 'Stopped' };
const DIRECTION = { supports: '↑ Supports', contradicts: '↓ Contradicts', inconclusive: 'Inconclusive' };
const text = (value) => value || 'Not recorded';
export default function ValidateExperiments({ part, canWrite, onRetry }) {
  return <section className="space-y-3" aria-labelledby="experiments-v9-title" data-testid="experiments-v9">
    <h2 id="experiments-v9-title" className="text-[17px] font-bold text-axal-ink dark:text-gray-100">Experiments</h2>
    <p className="text-[12.5px] text-axal-muted dark:text-gray-400">Tests that turn a hypothesis into observed evidence.</p>
    {part?.state !== 'ok' || !Array.isArray(part.rows) ? <div role="alert">Experiments unavailable. {onRetry && <button type="button" onClick={onRetry}>Try again</button>}</div>
      : !part.rows.length ? <p>No experiments yet. Open a hypothesis to plan one.</p>
      : <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{part.rows.map((e) => <article key={e.id}
        className={`min-w-0 space-y-3 rounded-xl border bg-white p-4 dark:bg-gray-900 ${['planned', 'stopped'].includes(e.status) ? 'border-dashed border-axal-hairline dark:border-gray-700' : 'border-axal-hairline dark:border-gray-700'}`}>
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-[11px]">{e.code}</span><span className="rounded-full border px-2 py-0.5 text-[11px]">{STATUS[e.status] || 'Not recorded'}</span></div>
        <h3 className="break-words text-[14px] font-bold">{e.title}</h3>
        <dl className="grid grid-cols-[90px_minmax(0,1fr)] gap-2 text-[12.5px]">
          <dt>Method</dt><dd className="break-words">{text(e.method)}</dd><dt>Success bar</dt><dd className="break-words">{text(e.target)}</dd>
          <dt>Observed</dt><dd className="break-words">{text(e.observed)}</dd><dt>Direction</dt><dd>{DIRECTION[e.direction] || 'Not recorded'}</dd>
        </dl>
        {['planned', 'running', 'stopped'].includes(e.status) && <p className="text-[11px] text-axal-muted dark:text-gray-400">{STATUS[e.status]} — doesn’t count as evidence.</p>}
        <Link to={e.href} className="inline-flex min-h-[44px] items-center font-semibold text-axal-violet dark:text-violet-300">{canWrite && e.status === 'result_needed' ? 'Record the result' : 'Open hypothesis'} →</Link>
        {e.lovable && <BuildInLovable lovable={e.lovable} />}
      </article>)}</div>}
  </section>;
}
