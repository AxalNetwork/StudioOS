import { Link } from 'react-router-dom';
import { Unreadable } from '../../ui';
import { CONNECTOR_HREF, EMPTY, partState, reconnectText } from './vercelDeploys';

/**
 * D1098 (#2963) — the frame both Vercel deploy parts share (`id="from-vercel"`):
 * the "From Vercel" heading and VC5's states. Empty names Choose projects;
 * Unreadable says the rest of the page is current, with Try again; Reconnect
 * says how old the figures are and still draws them. Each link goes to
 * Vercel's connector page, where a sync, a choice or a sign-in happens.
 */
export default function VercelPartFrame({ part, sub, testid, reload, children }) {
  const state = partState(part);
  if (!state) return null;
  return (
    <section id="from-vercel" className="flex min-w-0 scroll-mt-4 flex-col gap-3 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900" data-testid={testid} aria-labelledby="from-vercel-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <h2 id="from-vercel-title" className="m-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">From Vercel</h2>
        <span className="text-[11px] text-axal-faint dark:text-gray-500">{sub}</span>
      </div>
      {state === 'unreadable' && (
        <div className="text-[12.5px] text-red-700 dark:text-red-300" data-testid="vercel-unreadable">
          <Unreadable what="Vercel" claim="The rest of this page is current." onRetry={typeof reload === 'function' ? reload : undefined} />
        </div>
      )}
      {state === 'empty' && (
        <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="vercel-empty">
          {EMPTY} <Link to={CONNECTOR_HREF} className="font-semibold text-axal-violet hover:underline dark:text-violet-300">Choose projects</Link>
        </p>
      )}
      {state === 'reconnect' && (
        <p className="m-0 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900 dark:bg-amber-950 dark:text-amber-200" data-testid="vercel-reconnect">
          {reconnectText(part)} <Link to={CONNECTOR_HREF} className="font-semibold underline">Reconnect Vercel</Link>
        </p>
      )}
      {(state === 'ok' || state === 'reconnect') && children}
    </section>
  );
}

export const SUB = 'm-0 text-[11px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400';
export const LINE = 'm-0 text-[12px] text-axal-ink/80 dark:text-gray-300';
export const MUTED = 'm-0 text-[11.5px] text-axal-muted dark:text-gray-400';
export const PILL = {
  grey: 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
  v1: 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-200',
  warn: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  bad: 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200',
  muted: 'border-gray-200 bg-white text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400',
};
export const pillClass = (tone, dashed = false) => `whitespace-nowrap rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${PILL[tone] ?? PILL.grey}${dashed ? ' border-dashed' : ''}`;
