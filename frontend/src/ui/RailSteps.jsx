import { Link } from 'react-router-dom';

/**
 * D4873 (#4873, part 2) — a page's next steps on the Eadwyn rail, for a host that passes `steps` to
 * `WorkerRail`. They are drawn in place of the page's model block, so the normal workflow shows what to do
 * next, never a model list, a price or a "no row in the rail's model list" line. Every other page renders as
 * before.
 *
 * `steps` is the host's, built from what the page itself read:
 *   { state: 'ready', items: [{ key, tone: 'act' | 'info', text, to, action }], foot }
 *   { state: 'empty', text }         nothing to do: one calm line
 *   { state: 'loading' }
 *   { state: 'unavailable', text, onRetry }   the page's read failed; the page says so in its own blocks
 * A step is a link to where the work is. Nothing here acts: "Nothing changes until you act."
 */
export default function RailSteps({ steps, title }) {
  if (!steps) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="worker-rail-steps" aria-live="polite">
      <span className="fwr-eyebrow">{steps.state === 'ready' ? `${title} · ${steps.items.length}` : title}</span>
      {steps.state === 'loading' ? <p className="fwr-absent" data-testid="worker-rail-steps-loading">Reading this page…</p> : null}
      {steps.state === 'empty' ? <p className="fwr-absent" data-testid="worker-rail-steps-empty"><span aria-hidden="true">✓ </span>{steps.text}</p> : null}
      {steps.state === 'unavailable' ? (
        <div className="flex flex-col gap-1" data-testid="worker-rail-steps-unavailable">
          <p className="fwr-absent" role="status">{steps.text}</p>
          {steps.onRetry ? <button type="button" className="fwr-all-toggle" onClick={steps.onRetry} data-testid="worker-rail-steps-retry">Try again</button> : null}
        </div>
      ) : null}
      {steps.state === 'ready' ? (
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {steps.items.map((s) => (
            <li key={s.key} className="flex flex-col gap-1 rounded-[9px] border border-axal-hairline px-2.5 py-2 dark:border-gray-700" data-testid={`worker-rail-step-${s.key}`}>
              <span className="text-[12.5px] leading-snug text-axal-ink dark:text-gray-100">
                <span aria-hidden="true" className="mr-1 font-mono font-bold">{s.tone === 'act' ? '!' : 'i'}</span>
                <span className="sr-only">{s.tone === 'act' ? 'Needs action: ' : 'Note: '}</span>
                {s.text}
              </span>
              {s.to ? <Link to={s.to} className="self-start text-[12px] font-bold text-axal-violet underline dark:text-violet-300">{`${s.action} →`}</Link> : null}
            </li>
          ))}
        </ol>
      ) : null}
      {steps.state === 'ready' && steps.foot ? <p className="fwr-models-note">{steps.foot}</p> : null}
    </div>
  );
}
