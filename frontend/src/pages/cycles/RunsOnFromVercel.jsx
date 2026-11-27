import { stamp } from './HostingFromVercel';

/**
 * D1097 (#2962, Vercel part 2) — Solution design's "From Vercel · Runs on"
 * (`id="from-vercel"`), from the module read's `parts.vercel_runtime`: VC4a
 * of `design/incoming/From Vercel Page.dc.html`, under GitHub's "Built with".
 *
 * Each chosen project's framework, runtime, hosting, domain, branch and
 * repository, as Vercel's sync recorded them. It is never merged into the
 * founder's stack: "Built with" stays GitHub's. A fact Vercel did not give is
 * "Not recorded". Who is outside the company reads how many projects, never
 * which. Nothing is drawn when the venture has no Vercel connection.
 * Mounted by `buildParts.jsx`'s `'vercel'` line on `solution-design` (D1311).
 */

export const RUNS_ON_KEYS = [['framework', 'Framework'], ['runtime', 'Runtime'], ['hosting', 'Hosting'], ['domain', 'Domain'], ['branch', 'Branch'], ['repository', 'Repository']];
const NO_CONNECTION = 'Vercel has not brought anything to this venture yet.';

/** The part's state from `parts.vercel_runtime`. */
export function runsOnView(part) {
  if (!part || typeof part !== 'object' || part.state === 'not_recorded') return { state: 'none' };
  if (part.state === 'unreadable') return { state: 'unreadable', reason: part.reason || 'Unreadable: Vercel could not be read. The rest of this page is current.' };
  if (part.state === 'empty') return part.reason === NO_CONNECTION ? { state: 'none' } : { state: 'empty', reason: part.reason || 'No Vercel project is chosen for this venture yet.' };
  const total = Number.isSafeInteger(part.total) ? part.total : 0;
  if (!Array.isArray(part.items)) return { state: 'members_only', total, asOf: stamp(part.as_of) };
  return { state: 'ok', items: part.items.filter((i) => i && typeof i === 'object'), asOf: stamp(part.as_of) };
}

export default function RunsOnFromVercel({ part, reload }) {
  const view = runsOnView(part);
  if (view.state === 'none') return null;
  return (
    <section id="from-vercel" className="flex min-w-0 scroll-mt-4 flex-col gap-3 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900" data-testid="cycle-part-runs-on-vercel" aria-labelledby="runs-on-title">
      <div className="flex flex-wrap items-baseline gap-2.5">
        <h2 id="runs-on-title" className="m-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">From Vercel · Runs on</h2>
        {view.asOf && <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="runs-on-asof">as of {view.asOf}</span>}
      </div>
      {view.state === 'unreadable' && (
        <p role="alert" className="m-0 flex flex-wrap items-center gap-2 text-[12.5px] text-red-700 dark:text-red-300" data-testid="runs-on-unreadable">
          {view.reason}
          {reload && <button type="button" onClick={() => reload()} className="underline">Try again</button>}
        </p>
      )}
      {view.state === 'empty' && <p className={MUTED} data-testid="runs-on-empty">{view.reason}</p>}
      {view.state === 'members_only' && <p className={MUTED} data-testid="runs-on-count">{view.total === 1 ? '1 project' : `${view.total} projects`} from Vercel. Only the company’s members see which.</p>}
      {view.state === 'ok' && view.items.map((item, i) => (
        <dl key={i} className="m-0 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid={`runs-on-${i}`}>
          {RUNS_ON_KEYS.map(([k, label]) => (
            <div key={k} className="flex min-w-0 flex-col gap-0.5">
              <dt className="font-mono text-[10px] uppercase tracking-[.07em] text-axal-muted dark:text-gray-400">{label}</dt>
              <dd className={`m-0 truncate font-mono text-[13px] font-semibold ${item[k] ? 'text-axal-ink dark:text-gray-100' : 'italic font-normal text-axal-muted dark:text-gray-400'}`} data-testid={`runs-on-${i}-${k}`}>{item[k] || 'Not recorded'}</dd>
            </div>
          ))}
        </dl>
      ))}
    </section>
  );
}

const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
