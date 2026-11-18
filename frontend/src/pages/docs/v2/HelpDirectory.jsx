// D6861 (#6861) — HC8 of the Help Center v2 canvas (D4957): every guide the
// viewer can read, in the 12 recorded areas (the owner's option A), with a
// role filter that dims guides written for other roles and never hides one.
// It lives at `/help?view=all`, on the Help Center's own route, so it mints
// no new address. Every value is the manifest's (`directoryAreas`).
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { guideHref } from '../helpCenter';
import { DIRECTORY_ROLES, defaultDirectoryRole, directoryAreas, roleLabel } from './helpV2';

const LABEL = 'font-mono text-[10px] font-bold uppercase tracking-[0.11em] text-gray-500 dark:text-gray-400';

/** The directory, given the role-filtered manifest and the filter. Exported so a test can draw it. */
export function HelpDirectoryView({ sections, filter, onFilter, onSearch }) {
  const areas = useMemo(() => directoryAreas(sections, filter), [sections, filter]);
  const total = areas.reduce((n, a) => n + a.guides.length, 0);
  const half = Math.ceil(areas.length / 2);
  const columns = [areas.slice(0, half), areas.slice(half)];
  const [q, setQ] = useState('');
  return (
    <div className="mx-auto grid max-w-6xl gap-5 px-4 pb-12 pt-6 md:px-8" data-testid="help-directory">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.11em] text-gray-500 dark:text-gray-400">
        <Link to="/help" className="hover:text-violet-700 dark:hover:text-violet-300">Help</Link>
        <span aria-hidden className="text-gray-300 dark:text-gray-600">/</span>
        <span aria-current="page" className="text-gray-900 dark:text-gray-100">All guides</span>
      </nav>
      <div>
        <h1 className="text-[28px] font-extrabold tracking-tight text-gray-900 dark:text-gray-100">All guides</h1>
        <p className="mt-1.5 text-[13.5px] text-gray-600 dark:text-gray-300" data-testid="help-directory-count">
          {total} guide{total === 1 ? '' : 's'} in {areas.length} area{areas.length === 1 ? '' : 's'}. The filter dims guides for other roles; guides for every account stay as they are.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3.5">
        <span className={LABEL}>Show guides for</span>
        <div role="radiogroup" aria-label="Role filter" className="flex flex-wrap rounded-[10px] border border-gray-200 bg-white p-0.5 dark:border-gray-700 dark:bg-gray-900">
          {DIRECTORY_ROLES.map((r) => (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={filter === r.id}
              onClick={() => onFilter(r.id)}
              className={`min-h-[40px] rounded-[8px] px-3 text-[12.5px] font-semibold ${filter === r.id ? 'bg-violet-600 text-white' : 'text-gray-700 hover:text-violet-700 dark:text-gray-300 dark:hover:text-violet-300'}`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <form role="search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) onSearch(q.trim()); }} className="flex min-w-0 flex-1 items-center gap-2 rounded-[10px] border border-gray-200 bg-white px-3 sm:max-w-[300px] dark:border-gray-700 dark:bg-gray-900">
          <Search size={15} aria-hidden className="text-gray-400" />
          <label htmlFor="help-directory-search" className="sr-only">Search Help</label>
          <input id="help-directory-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Help" className="min-h-[40px] min-w-0 flex-1 bg-transparent text-[13px] text-gray-900 placeholder:text-gray-500 focus:outline-none dark:text-gray-100 dark:placeholder:text-gray-400" />
        </form>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {columns.map((col, i) => (
          <div key={i} className="grid content-start gap-4">
            {col.map((area) => (
              <section key={area.id} id={`area-${area.id}`} aria-labelledby={`dir-${area.id}`} className="scroll-mt-6 rounded-2xl border border-gray-200 bg-white px-5 py-4 dark:border-gray-800 dark:bg-gray-900" data-testid="help-directory-area">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 id={`dir-${area.id}`} className="text-[15px] font-extrabold tracking-tight text-gray-900 dark:text-gray-100">{area.title}</h2>
                  <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400">{area.guides.length} guide{area.guides.length === 1 ? '' : 's'}</span>
                </div>
                <ul className="mt-2.5 grid list-none gap-0 p-0">
                  {area.guides.map((g) => (
                    <li
                      key={g.anchor}
                      className={`flex min-h-[40px] flex-wrap items-center justify-between gap-2 border-t border-gray-100 py-1.5 first:border-t-0 dark:border-gray-800 ${g.dim ? 'opacity-50' : ''}`}
                      data-testid="help-directory-guide"
                      data-dim={g.dim ? 'true' : 'false'}
                    >
                      <Link to={guideHref(g.anchor)} className="min-w-0 text-[13px] font-semibold text-gray-800 hover:text-violet-700 dark:text-gray-200 dark:hover:text-violet-300">
                        {g.title}
                      </Link>
                      <span className="flex flex-none items-center gap-1.5">
                        {g.appliesTo.length > 0 && (
                          <span className="rounded-full border border-gray-200 px-2 py-0.5 font-mono text-[10px] text-gray-600 dark:border-gray-700 dark:text-gray-300">
                            {g.dim ? 'For ' : ''}{g.appliesTo.map(roleLabel).join(', ')}
                          </span>
                        )}
                        {g.noPage && <span className="font-mono text-[10px] text-gray-500 dark:text-gray-400">no page</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ))}
      </div>
      <p className="text-[12px] text-gray-500 dark:text-gray-400">
        Dimmed guides stay readable when your role can open them; a role filter never hides a guide for every account. “No page” marks a guide with no single screen to go to.
      </p>
    </div>
  );
}

export default function HelpDirectory({ sections, role }) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState(() => defaultDirectoryRole(role));
  return (
    <HelpDirectoryView
      sections={sections}
      filter={filter}
      onFilter={setFilter}
      onSearch={(q) => navigate(`/help?q=${encodeURIComponent(q)}`)}
    />
  );
}
