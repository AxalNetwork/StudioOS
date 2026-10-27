import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MoreHorizontal, SlidersHorizontal } from 'lucide-react';
import { adminArticles } from '../../../lib/api';
import Lightbox from '../../../ui/Lightbox';
import {
  AUTHOR_SORTS, DRAWER_WAITS, PAGE_SIZES, authorFacts, authorsView, filterAuthors, pageOf, profilesOf,
} from './statsModel';
import Sheet from '../../../ui/Sheet.jsx';

/**
 * D1297 (#3393) — Content queue › Authors at `/admin/articles/authors`
 * (ART9), with the author drawer (ART10) and the phone (ART18), from D1294's
 * `GET /api/admin/articles/authors`.
 *
 *   - The four tiles from the read's summary.
 *   - Search an author, Profile, "Has articles waiting" and the sort; on a
 *     phone they sit in a bottom sheet behind "Filters and sort".
 *   - A table from `md` up, cards below it; 25, 50 or 100 rows a page.
 *   - Each row's menu: Open author, Open account (Accounts) and Open public
 *     author page. The drawer shows the author's facts; what the read does
 *     not carry (each article by month, the review history) says so.
 *
 * A follower count whose read failed reads "Couldn’t be read", never 0.
 * `load` is the client's, so a test can answer it.
 */

const CARD = 'rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900';
const MUTED = 'text-slate-500 dark:text-slate-400';
const INPUT = 'min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 md:min-h-[36px]';
const LINK = 'inline-flex min-h-[44px] items-center text-sm font-semibold text-violet-700 hover:underline dark:text-violet-300 md:min-h-0';
const MENU_ITEM = 'flex min-h-[44px] w-full items-center px-3 text-left text-sm text-slate-800 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-800 md:min-h-[36px]';

export function useRead(load) {
  const [read, setRead] = useState({ status: 'loading', data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setRead({ status: 'loading', data: null });
    Promise.resolve().then(load).then((data) => { if (live) setRead({ status: 'ready', data }); }, () => { if (live) setRead({ status: 'unreadable', data: null }); });
    return () => { live = false; };
  }, [load, tick]);
  return { ...read, retry: useCallback(() => setTick((n) => n + 1), []) };
}

export function Tiles({ tiles, testId }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid={testId}>
      {tiles.map((t) => (
        <div key={t.key} className={`${CARD} p-4`} data-testid={`${testId}-${t.key}`}>
          <div className={`text-xs font-semibold ${MUTED}`}>{t.label}</div>
          <div className={`mt-1 text-2xl font-extrabold tabular-nums ${t.missing ? 'text-base italic text-slate-500 dark:text-slate-400' : 'text-slate-900 dark:text-slate-100'}`}>{t.value}</div>
          {t.sub && <div className={`mt-1 text-xs ${MUTED}`}>{t.sub}</div>}
        </div>
      ))}
    </div>
  );
}

function Filters({ q, setQ, role, setRole, waiting, setWaiting, sort, setSort, profiles }) {
  return (
    <>
      <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300 md:flex-none">
        <span className="sr-only md:not-sr-only md:hidden">Search</span>
        <input type="search" className={INPUT} placeholder="Search an author" value={q} onChange={(e) => setQ(e.target.value)} data-testid="authors-search" />
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
        <span className="md:sr-only">Profile</span>
        <select className={INPUT} value={role} onChange={(e) => setRole(e.target.value)} data-testid="authors-profile">
          <option value="">Profile: all</option>
          {profiles.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </label>
      <label className="flex min-h-[44px] items-center gap-2 text-sm text-slate-800 dark:text-slate-100 md:min-h-[36px]">
        <input type="checkbox" checked={waiting} onChange={(e) => setWaiting(e.target.checked)} data-testid="authors-waiting" />Has articles waiting
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
        <span className="md:sr-only">Sort</span>
        <select className={INPUT} value={sort} onChange={(e) => setSort(e.target.value)} data-testid="authors-sort">
          {AUTHOR_SORTS.map((s) => <option key={s.key} value={s.key}>Sort: {s.label}</option>)}
        </select>
      </label>
    </>
  );
}

function RowMenu({ row, onOpen }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block">
      <button type="button" aria-label={`More for ${row.name}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="grid h-11 w-11 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 md:h-8 md:w-8" data-testid={`author-menu-${row.id}`}>
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-10 mt-1 w-64 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900" data-testid={`author-menu-list-${row.id}`}>
          <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => { setOpen(false); onOpen(row); }} data-testid={`author-open-${row.id}`}>Open author</button>
          <Link role="menuitem" className={MENU_ITEM} to={`/admin/accounts/all/${row.id}`} data-testid={`author-account-${row.id}`}>Open account (Accounts)</Link>
          <Link role="menuitem" className={MENU_ITEM} to={`/authors/${row.id}`} data-testid={`author-public-${row.id}`}>Open public author page</Link>
        </div>
      )}
    </div>
  );
}

/** ART10: one author's facts; what the read does not carry says so. */
function AuthorDrawer({ row, onClose }) {
  return (
    <Sheet label={`${row.name}, author`} title={`${row.name}, author`} sub={row.profile} onClose={onClose} width={640} testId="author-drawer">
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm" data-testid="author-facts">
        {authorFacts(row).map(([k, v]) => (
          <React.Fragment key={k}>
            <dt className={MUTED}>{k}</dt>
            <dd className="m-0 text-slate-900 tabular-nums dark:text-slate-100">{v}</dd>
          </React.Fragment>
        ))}
      </dl>
      {DRAWER_WAITS.map((l) => <p key={l} className={`mt-4 rounded-lg border border-dashed border-slate-300 p-3 text-sm dark:border-slate-700 ${MUTED}`} data-testid="author-drawer-wait">{l}</p>)}
      <div className="mt-4 flex flex-wrap gap-x-4">
        <Link className={LINK} to={`/admin/accounts/all/${row.id}`}>Open account (Accounts) ›</Link>
        <Link className={LINK} to={`/authors/${row.id}`}>Open public author page ›</Link>
      </div>
    </Sheet>
  );
}

export default function AuthorsTab({ load = adminArticles.authors }) {
  const read = useRead(load);
  const view = authorsView(read);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [sort, setSort] = useState('published');
  const [size, setSize] = useState(25);
  const [page, setPage] = useState(1);
  const [sheet, setSheet] = useState(false);
  const [drawer, setDrawer] = useState(null);
  const shown = useMemo(() => filterAuthors(view.rows, { q, role, waiting, sort }), [view.rows, q, role, waiting, sort]);
  const paged = pageOf(shown, page, size);
  useEffect(() => { setPage(1); }, [q, role, waiting, sort, size]);
  const profiles = profilesOf(view.rows);
  const filters = { q, setQ, role, setRole, waiting, setWaiting, sort, setSort, profiles };
  const active = (q ? 1 : 0) + (role ? 1 : 0) + (waiting ? 1 : 0);

  if (view.status === 'loading') return <div className={`${CARD} mt-4 h-40 animate-pulse`} aria-busy="true" data-testid="authors-loading" />;
  if (view.status === 'unreadable') {
    return (
      <div className={`${CARD} mt-4 p-6`} role="alert" data-testid="authors-unreadable">
        <p className="m-0 text-sm text-slate-800 dark:text-slate-100">The authors couldn’t be read just now. That is not the same as there being none.</p>
        <button type="button" className={LINK} onClick={read.retry}>Try again</button>
      </div>
    );
  }
  if (view.status === 'empty') {
    return (
      <div className={`${CARD} mt-4 p-6`} data-testid="authors-empty">
        <p className="m-0 text-sm font-semibold text-slate-900 dark:text-slate-100">No author has submitted an article yet.</p>
        <p className={`m-0 mt-1 text-sm ${MUTED}`}>An author appears here with their first submission.</p>
      </div>
    );
  }

  return (
    <section className="mt-4 flex flex-col gap-4" data-testid="content-queue-authors">
      <Tiles tiles={view.tiles} testId="authors-tiles" />
      <div className="hidden flex-wrap items-end gap-3 md:flex" data-testid="authors-toolbar">
        <Filters {...filters} />
        <span className={`ml-auto text-sm ${MUTED}`} data-testid="authors-range">{paged.range}</span>
      </div>
      <div className="flex items-center gap-3 md:hidden">
        <button type="button" className={`${INPUT} inline-flex items-center gap-2 font-semibold`} onClick={() => setSheet(true)} data-testid="authors-filters-open">
          <SlidersHorizontal size={15} aria-hidden="true" />Filters and sort{active ? ` · ${active}` : ''}
        </button>
        <span className={`ml-auto text-sm ${MUTED}`}>{paged.range}</span>
      </div>

      {shown.length === 0 ? (
        <div className={`${CARD} p-6 text-sm text-slate-800 dark:text-slate-100`} data-testid="authors-no-match">
          No author matches these filters.{' '}
          <button type="button" className={LINK} onClick={() => { setQ(''); setRole(''); setWaiting(false); }}>Clear all</button>
        </div>
      ) : (
        <>
          <div className={`${CARD} hidden overflow-x-auto md:block`}>
            <table className="w-full text-left text-sm" data-testid="authors-table">
              <thead>
                <tr className={`text-xs font-semibold ${MUTED}`}>
                  {['Author', 'Profile', 'Published', 'Waiting', 'Rejected', 'Approval rate', 'Views, all time', 'Followers', 'Last submitted', 'This week', ''].map((h, i) => <th key={i} className="whitespace-nowrap px-3 py-2">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {paged.rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800" data-testid={`author-row-${r.id}`}>
                    <td className="px-3 py-2 font-semibold text-slate-900 dark:text-slate-100">
                      <button type="button" className="text-left hover:underline" onClick={() => setDrawer(r)}>{r.name}</button>
                    </td>
                    <td className={`px-3 py-2 ${MUTED}`}>{r.profile}</td>
                    <td className="px-3 py-2 tabular-nums">{r.published}</td>
                    <td className="px-3 py-2 tabular-nums">{r.waiting}</td>
                    <td className="px-3 py-2 tabular-nums">{r.rejected}</td>
                    <td className="px-3 py-2 tabular-nums">{r.approval}</td>
                    <td className="px-3 py-2 tabular-nums">{r.views}</td>
                    <td className="px-3 py-2 tabular-nums">{r.followers}</td>
                    <td className="whitespace-nowrap px-3 py-2">{r.lastSubmitted}</td>
                    <td className={`whitespace-nowrap px-3 py-2 tabular-nums ${r.atLimit ? 'font-semibold text-amber-700 dark:text-amber-300' : ''}`} data-testid={`author-week-${r.id}`}>{r.week}{r.atLimit ? ' · at the limit' : ''}</td>
                    <td className="px-3 py-2 text-right"><RowMenu row={r} onOpen={setDrawer} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="m-0 flex list-none flex-col gap-2 p-0 md:hidden" data-testid="authors-cards">
            {paged.rows.map((r) => (
              <li key={r.id} className={`${CARD} flex flex-col gap-1 p-3`}>
                <div className="flex items-start justify-between gap-2">
                  <button type="button" className="min-h-[44px] text-left text-sm font-semibold text-slate-900 dark:text-slate-100" onClick={() => setDrawer(r)} data-testid={`author-card-${r.id}`}>{r.name}<span className={`block text-xs font-normal ${MUTED}`}>{r.profile}</span></button>
                  <RowMenu row={r} onOpen={setDrawer} />
                </div>
                <p className={`m-0 text-xs ${MUTED}`}>{`${r.published} published · ${r.waiting} waiting · ${r.approval} approved · this week ${r.week}`}</p>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className={`flex items-center gap-2 ${MUTED}`}>Rows per page
              <select className={INPUT} value={size} onChange={(e) => setSize(Number(e.target.value))} data-testid="authors-size">
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <span className={`ml-auto ${MUTED}`} data-testid="authors-page">Page {paged.page} of {paged.pages}</span>
            <button type="button" aria-label="Previous page" className={`${INPUT} w-11`} disabled={paged.page <= 1} onClick={() => setPage(paged.page - 1)}>‹</button>
            <button type="button" aria-label="Next page" className={`${INPUT} w-11`} disabled={paged.page >= paged.pages} onClick={() => setPage(paged.page + 1)} data-testid="authors-next">›</button>
          </div>
        </>
      )}
      {view.viewsNote && <p className={`m-0 text-xs ${MUTED}`} data-testid="authors-views-note">{view.viewsNote}</p>}

      {sheet && (
        <Lightbox label="Filters and sort" title="Filters and sort" phone="sheet" onClose={() => setSheet(false)} testId="authors-filters-sheet"
          footer={(
            <div className="flex gap-2 max-sm:flex-col-reverse">
              <button type="button" className={`${INPUT} font-semibold`} onClick={() => { setQ(''); setRole(''); setWaiting(false); setSort('published'); }}>Clear all</button>
              <button type="button" className="min-h-[44px] flex-1 rounded-lg bg-violet-700 px-4 text-sm font-bold text-white" onClick={() => setSheet(false)} data-testid="authors-filters-show">{`Show ${shown.length} author${shown.length === 1 ? '' : 's'}`}</button>
            </div>
          )}>
          <div className="flex flex-col gap-3"><Filters {...filters} /></div>
        </Lightbox>
      )}
      {drawer && <AuthorDrawer row={drawer} onClose={() => setDrawer(null)} />}
    </section>
  );
}
