import { Link, useLocation } from 'react-router-dom';
import { recordHref } from './recordModel';
import { groupCount, groupTarget, releaseView, releasesCount, shippedMark } from './roadmapGithub';

/**
 * D782 (#2111) — Product roadmap's "From GitHub" part (`id="from-github"`),
 * from the module read's `parts.github`:
 *   - each milestone as a group, with its target, and its items, each with
 *     its Shipped mark linking to the release;
 *   - a Releases strip, newest first, each release with what it shipped.
 *
 * The roadmap's own table is unchanged: these come from the GitHub sync and
 * are labelled as such. An Unreadable read says so, never an empty strip.
 */
export default function RoadmapFromGithub({ github }) {
  const location = useLocation();
  if (!github || typeof github !== 'object') return null;
  const groups = Array.isArray(github.groups) ? github.groups : [];
  const releases = Array.isArray(github.releases) ? github.releases : [];
  const itemHref = (id) => recordHref('build', 'product-roadmap', id, location.search);
  return (
    <section id="from-github" className="flex min-w-0 scroll-mt-4 flex-col gap-3 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900" data-testid="cycle-part-github" aria-labelledby="from-github-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <h2 id="from-github-title" className="m-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">From GitHub</h2>
        <span className="text-[11px] text-axal-faint dark:text-gray-500">Milestones and releases from the GitHub sync</span>
      </div>
      {github.state !== 'ok'
        ? <p className={`m-0 text-[12.5px] ${github.state === 'unreadable' ? 'text-red-700 dark:text-red-300' : 'text-axal-muted dark:text-gray-400'}`} data-testid={`github-${github.state === 'unreadable' ? 'unreadable' : 'none'}`}>
            {github.state === 'unreadable' ? `Unreadable: ${github.reason || 'the read failed.'}` : github.reason || 'No milestone or release from GitHub yet.'}
          </p>
        : (
          <>
            <div className="flex flex-col gap-2" data-testid="github-groups">
              <h3 className={SUB}>Milestones</h3>
              {groups.length === 0
                ? <p className={MUTED} data-testid="github-groups-none">No roadmap item sits in a GitHub milestone.</p>
                : groups.map((g, i) => (
                  <div key={g.title ?? i} className="flex flex-col gap-1 rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-800" data-testid={`github-group-${i}`}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="m-0 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{g.title}</p>
                      <span className="text-[11px] text-axal-muted dark:text-gray-400" data-testid={`github-group-target-${i}`}>{groupTarget(g)} · {groupCount(g)}</span>
                    </div>
                    <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                      {(Array.isArray(g.items) ? g.items : []).map((item, j) => {
                        const mark = shippedMark(item);
                        const href = itemHref(item?.id);
                        return (
                          <li key={item?.id ?? j} className={LINE} data-testid={`github-item-${i}-${j}`}>
                            {href ? <Link to={href} className="hover:underline">{item.title}</Link> : item?.title}
                            {item?.column && <span className="text-axal-faint dark:text-gray-500"> · {item.column}</span>}
                            {mark && (
                              <>
                                {' · '}
                                {mark.href
                                  ? <a href={mark.href} target="_blank" rel="noopener noreferrer" className={SHIPPED} data-testid={`github-shipped-${i}-${j}`}>{mark.text}</a>
                                  : <span className={SHIPPED} data-testid={`github-shipped-${i}-${j}`}>{mark.text}</span>}
                              </>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
            </div>
            <div className="flex flex-col gap-2" data-testid="github-releases">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className={SUB}>Releases</h3>
                <span className="text-[11px] text-axal-faint dark:text-gray-500" data-testid="github-releases-count">{releasesCount(github)}</span>
              </div>
              {releases.length === 0
                ? <p className={MUTED} data-testid="github-releases-none">No release yet.</p>
                : (
                  <ol className="m-0 flex list-none gap-2 overflow-x-auto p-0 pb-1">
                    {releases.map((r, i) => {
                      const v = releaseView(r);
                      return (
                        <li key={r?.id ?? i} className="flex min-w-[180px] max-w-[260px] flex-col gap-0.5 rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-800" data-testid={`github-release-${i}`}>
                          {v.href
                            ? <a href={v.href} target="_blank" rel="noopener noreferrer" className="text-[12.5px] font-semibold text-axal-violet hover:underline dark:text-violet-300">{v.title}</a>
                            : <span className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{v.title}</span>}
                          <span className="text-[11px] text-axal-muted dark:text-gray-400">{v.date}{v.prerelease ? ' · Pre-release' : ''}{v.repository ? ` · ${v.repository}` : ''}</span>
                          <span className={LINE}>{v.shipped}</span>
                          {v.items.length > 0 && (
                            <span className="text-[11px] text-axal-muted dark:text-gray-400">{v.items.join(' · ')}{v.more ? ` and ${v.more} more` : ''}</span>
                          )}
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
const SHIPPED = 'rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10.5px] font-bold text-emerald-800 hover:underline dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200';
