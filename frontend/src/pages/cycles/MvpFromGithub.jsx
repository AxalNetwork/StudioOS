import { Link, useLocation } from 'react-router-dom';
import { recordHref } from './recordModel';
import { mustHaveView, releaseCheckView, releaseChecksCount } from './mvpGithub';

/**
 * D782 (#2112) — Prototype / MVP's "From GitHub" part (`id="from-github"`),
 * from the module read's `parts.github`:
 *   - each fed must-have with GitHub's state (Planned, In progress, In review,
 *     Built, Dropped) and its pull request link;
 *   - each release's checks, newest first: the must-haves in it, then those
 *     still open when it was published.
 *
 * The must-haves' own table is unchanged. An Unreadable read says so, never
 * an empty list.
 */
export default function MvpFromGithub({ github }) {
  const location = useLocation();
  if (!github || typeof github !== 'object') return null;
  const must = Array.isArray(github.must_haves) ? github.must_haves : [];
  const releases = Array.isArray(github.releases) ? github.releases : [];
  const itemHref = (id) => recordHref('build', 'prototype-mvp', id, location.search);
  return (
    <section id="from-github" className="flex min-w-0 scroll-mt-4 flex-col gap-3 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900" data-testid="cycle-part-github" aria-labelledby="from-github-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <h2 id="from-github-title" className="m-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">From GitHub</h2>
        <span className="text-[11px] text-axal-faint dark:text-gray-500">Pull requests and releases from the GitHub sync</span>
      </div>
      {github.state !== 'ok'
        ? <p className={`m-0 text-[12.5px] ${github.state === 'unreadable' ? 'text-red-700 dark:text-red-300' : 'text-axal-muted dark:text-gray-400'}`} data-testid={`github-${github.state === 'unreadable' ? 'unreadable' : 'none'}`}>
            {github.state === 'unreadable' ? `Unreadable: ${github.reason || 'the read failed.'}` : github.reason || 'No pull request or release from GitHub yet.'}
          </p>
        : (
          <>
            <div className="flex flex-col gap-1.5" data-testid="github-must-haves">
              <h3 className={SUB}>Must-haves from pull requests</h3>
              {must.length === 0
                ? <p className={MUTED} data-testid="github-must-haves-none">No must-have comes from a pull request yet.</p>
                : (
                  <ul className="m-0 flex list-none flex-col gap-1 p-0">
                    {must.map((m, i) => {
                      const v = mustHaveView(m);
                      const href = itemHref(m?.id);
                      return (
                        <li key={m?.id ?? i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-axal-ground pb-1 last:border-b-0 dark:border-gray-800" data-testid={`github-must-have-${i}`}>
                          <span className={LINE}>{href ? <Link to={href} className="hover:underline">{v.title}</Link> : v.title}</span>
                          <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${PILL[v.tone]}`} data-testid={`github-state-${i}`}>{v.label}</span>
                          {v.href && <a href={v.href} target="_blank" rel="noopener noreferrer" className="text-[11.5px] font-semibold text-axal-violet hover:underline dark:text-violet-300" data-testid={`github-pull-${i}`}>{v.number ? `Pull request ${v.number}` : 'Pull request'}</a>}
                          {v.note && <span className="w-full text-[11px] text-axal-muted dark:text-gray-400">{v.note}</span>}
                        </li>
                      );
                    })}
                  </ul>
                )}
            </div>
            <div className="flex flex-col gap-1.5" data-testid="github-release-checks">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className={SUB}>Release checks</h3>
                <span className="text-[11px] text-axal-faint dark:text-gray-500" data-testid="github-release-checks-count">{releaseChecksCount(github)}</span>
              </div>
              {releases.length === 0
                ? <p className={MUTED} data-testid="github-release-checks-none">No release has checked a must-have yet.</p>
                : (
                  <ol className="m-0 flex list-none flex-col gap-2 p-0">
                    {releases.map((r, i) => {
                      const v = releaseCheckView(r);
                      return (
                        <li key={r?.id ?? i} className="flex flex-col gap-0.5 rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-800" data-testid={`github-release-check-${i}`}>
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            {v.href
                              ? <a href={v.href} target="_blank" rel="noopener noreferrer" className="text-[12.5px] font-semibold text-axal-violet hover:underline dark:text-violet-300">{v.title}</a>
                              : <span className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{v.title}</span>}
                            <span className="text-[11px] text-axal-muted dark:text-gray-400">{v.date}</span>
                          </div>
                          <p className={LINE} data-testid={`github-release-in-${i}`}><span className="font-semibold">In:</span> {v.inText}</p>
                          <p className={LINE} data-testid={`github-release-not-in-${i}`}><span className="font-semibold">Not in:</span> {v.notInText}</p>
                        </li>
                      );
                    })}
                  </ol>
                )}
            </div>
          </>
        )}
    </section>
  );
}

const SUB = 'm-0 text-[11px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400';
const LINE = 'm-0 text-[12px] text-axal-ink/80 dark:text-gray-300';
const MUTED = 'm-0 text-[12px] text-axal-muted dark:text-gray-400';
const PILL = {
  grey: 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
  v1: 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-200',
  warn: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  muted: 'border-gray-200 bg-white text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400',
};
