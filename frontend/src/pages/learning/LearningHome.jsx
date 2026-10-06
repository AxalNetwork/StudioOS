import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarPlus, ChevronLeft, ChevronRight, Search, SquarePen } from 'lucide-react';
import { Card, Pill, RailFrame, Unrecorded, WorkerRail } from '../../ui';
import { reportError } from '../../lib/log';
import { COMING_SOON_LINE } from './learningAccess';
import {
  ARTICLES_PAGE_SIZE, ALL_LIMIT, EVENTS_PAGE_SIZE, LEARNING_TABS, NOT_LIVE_LINE,
  combineAll, formatDay, formatWhen, kindLabel, matchesQuery, rangeLabel, resolveTab, tabMode,
} from './learningModel';
import { readArticles, readEvents, readPublications } from './learningReads';
import {
  ComingSoonCard, LearningEmpty, LearningHeader, LearningLoading, LearningUnreadable, NotLiveYet, SectionCard,
} from './LearningStates';

/** The canvas's one header action, kept for every profile: Articles stay open. */
export function WriteArticleLink() {
  return (
    <Link
      to="/articles/draft"
      className="inline-flex items-center gap-1.5 rounded-axal-sm bg-axal-violet px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-axal-violet-deep"
      data-testid="link-write-article"
    >
      <SquarePen size={14} aria-hidden="true" /> Write an article
    </Link>
  );
}

const ROW_TITLE = 'text-[14px] font-semibold text-axal-ink hover:text-axal-violet-deep dark:text-gray-100 dark:hover:text-violet-300';
const ROW_META = 'mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-axal-muted dark:text-gray-400';
const PAGER = 'inline-flex items-center gap-1 rounded-axal-sm border border-axal-hairline px-2.5 py-1 text-[12px] font-medium text-axal-ink hover:border-axal-violet/40 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:text-gray-200';

function RowTitle({ href, children, testid }) {
  return href
    ? <Link to={href} className={ROW_TITLE} data-testid={testid}>{children}</Link>
    : <span className="text-[14px] font-semibold text-axal-ink dark:text-gray-100" data-testid={testid}>{children}</span>;
}

/**
 * Articles: the published list, each row opening `/articles/:slug` in the
 * existing reader, with the author, their role, the date and the reading time
 * the route sends (D562). This tab stays open while the rest is coming soon.
 */
export function ArticleList({ state, q, onPage, onRetry }) {
  if (state.status === 'loading') return <LearningLoading rows={4} what="the articles" />;
  if (state.status === 'unreadable') {
    return <LearningUnreadable what="The article list" claim="This is not a claim that no article is published." onRetry={onRetry} />;
  }
  const rows = state.rows || [];
  if (!rows.length) {
    return q
      ? <LearningEmpty title={`No article matches “${q}”`} body="Try another word, or clear the search." />
      : <LearningEmpty title="No article published yet" body="Every member can write one." cta={{ label: 'Write an article', to: '/articles/draft' }} />;
  }
  const offset = state.offset || 0;
  const hasNext = Number.isFinite(state.total) ? offset + rows.length < state.total : rows.length === ARTICLES_PAGE_SIZE;
  return (
    <div data-testid="list-articles">
      <ul className="divide-y divide-axal-hairline dark:divide-gray-800">
        {rows.map((a) => (
          <li key={a.key} className="py-3 first:pt-0" data-testid="row-article">
            <RowTitle href={a.href}>{a.title}</RowTitle>
            {a.summary && <p className="mt-0.5 line-clamp-2 text-[12.5px] text-axal-muted dark:text-gray-400">{a.summary}</p>}
            <p className={ROW_META}>
              <span className="font-medium text-gray-700 dark:text-gray-300">{a.author || <Unrecorded>Author not recorded</Unrecorded>}</span>
              {a.role && <Pill tone="neutral">{a.role}</Pill>}
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{formatDay(a.date) || <Unrecorded>Date not recorded</Unrecorded>}</span>
              {a.readMinutes && <><span aria-hidden="true">·</span><span className="tabular-nums">{a.readMinutes} min read</span></>}
            </p>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-axal-hairline pt-3 dark:border-gray-800">
        <span className="text-[11.5px] tabular-nums text-axal-faint dark:text-gray-500" data-testid="text-articles-range">
          {rangeLabel(offset, rows.length, state.total)} · each opens in the article reader
        </span>
        <span className="flex gap-1.5">
          <button type="button" className={PAGER} disabled={offset === 0} onClick={() => onPage(-1)} data-testid="button-articles-prev">
            <ChevronLeft size={13} aria-hidden="true" /> Newer
          </button>
          <button type="button" className={PAGER} disabled={!hasNext} onClick={() => onPage(1)} data-testid="button-articles-next">
            Older <ChevronRight size={13} aria-hidden="true" />
          </button>
        </span>
      </div>
    </div>
  );
}

/**
 * Publications: the reports HQ has published, from the public list. That list
 * sends a title, a section and a date, and no file: a PDF is rendered by an
 * admin and shared as a 24-hour link, so each row opens the publication's
 * public page and the PDF is "not recorded" here (D562 GAPS).
 */
export function PublicationList({ state, q, onRetry }) {
  if (state.status === 'loading') return <LearningLoading rows={3} what="the publications" />;
  if (state.status === 'unreadable') {
    return <LearningUnreadable what="The publication list" claim="This is not a claim that nothing is published." onRetry={onRetry} />;
  }
  const all = state.rows || [];
  const rows = all.filter((r) => matchesQuery(r, q));
  if (!rows.length) {
    return q
      ? <LearningEmpty title={`No publication matches “${q}”`} body="Try another word, or clear the search." />
      : <LearningEmpty title="No publication yet" body="Reports HQ publishes appear here." />;
  }
  return (
    <div data-testid="list-publications">
      <ul className="divide-y divide-axal-hairline dark:divide-gray-800">
        {rows.map((p) => (
          <li key={p.key} className="flex flex-col gap-1 py-3 first:pt-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4" data-testid="row-publication">
            <div className="min-w-0">
              <RowTitle href={p.href}>{p.title}</RowTitle>
              {p.summary && <p className="mt-0.5 line-clamp-2 text-[12.5px] text-axal-muted dark:text-gray-400">{p.summary}</p>}
              <p className={ROW_META}>
                <span className="tabular-nums">{formatDay(p.date) || <Unrecorded>Date not recorded</Unrecorded>}</span>
                {p.section && <><span aria-hidden="true">·</span><span>{p.section}</span></>}
                <span aria-hidden="true">·</span>
                <span>PDF <Unrecorded reason="The published list carries no file. A PDF is rendered by an admin and shared as a 24-hour link.">not recorded</Unrecorded></span>
              </p>
            </div>
            {p.href && (
              <Link to={p.href} className="flex-none text-[12.5px] font-semibold text-axal-violet-deep hover:text-axal-violet dark:text-violet-300">
                Read it
              </Link>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 border-t border-axal-hairline pt-3 text-[11.5px] tabular-nums text-axal-faint dark:border-gray-800 dark:text-gray-500" data-testid="text-publications-count">
        {rows.length} publication{rows.length === 1 ? '' : 's'}{all.length >= 100 ? ' · the newest 100 the list serves' : ''}
      </p>
    </div>
  );
}

/** Events: the next upcoming events from the public feed, each with its calendar file. */
export function EventList({ state, q, onRetry }) {
  if (state.status === 'loading') return <LearningLoading rows={3} what="the events" />;
  if (state.status === 'unreadable') {
    return <LearningUnreadable what="The event list" claim="This is not a claim that no event is planned." onRetry={onRetry} />;
  }
  const rows = state.rows || [];
  if (!rows.length) {
    return q
      ? <LearningEmpty title={`No upcoming event matches “${q}”`} body="Try another word, or clear the search." />
      : <LearningEmpty title="No upcoming event" body="Published events appear here before they start." cta={{ label: 'See past events', to: '/events' }} />;
  }
  return (
    <div data-testid="list-events">
      <ul className="divide-y divide-axal-hairline dark:divide-gray-800">
        {rows.map((e) => (
          <li key={e.key} className="flex flex-col gap-1.5 py-3 first:pt-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4" data-testid="row-event">
            <div className="min-w-0">
              <p className="text-[12px] tabular-nums text-axal-muted dark:text-gray-400">{formatWhen(e.date, e.timezone) || <Unrecorded>Start not recorded</Unrecorded>}</p>
              <RowTitle href={e.href}>{e.title}</RowTitle>
              <p className={ROW_META}>
                {e.type && <Pill tone="neutral">{e.type}</Pill>}
                <span>{e.place || <Unrecorded>Place not recorded</Unrecorded>}</span>
              </p>
            </div>
            {e.icsHref && (
              <a href={e.icsHref} download className="inline-flex flex-none items-center gap-1 text-[12.5px] font-semibold text-axal-violet-deep hover:text-axal-violet dark:text-violet-300">
                <CalendarPlus size={14} aria-hidden="true" /> Add to calendar
              </a>
            )}
          </li>
        ))}
      </ul>
      {rows.length === EVENTS_PAGE_SIZE && (
        <p className="mt-3 border-t border-axal-hairline pt-3 text-[11.5px] text-axal-faint dark:border-gray-800 dark:text-gray-500">
          The next {EVENTS_PAGE_SIZE}. <Link to="/events" className="font-semibold text-axal-violet-deep underline dark:text-violet-300">Every upcoming event</Link> is on the events page.
        </p>
      )}
    </div>
  );
}

function allMeta(row) {
  if (row.kind === 'article') return [row.author, row.readMinutes ? `${row.readMinutes} min read` : null, formatDay(row.date)].filter(Boolean).join(' · ');
  if (row.kind === 'publication') return [formatDay(row.date), row.section].filter(Boolean).join(' · ');
  return [formatWhen(row.date, row.timezone), row.place].filter(Boolean).join(' · ');
}

const SOURCE_NAME = { article: 'The article list', publication: 'The publication list', event: 'The event list' };

/**
 * All: articles, publications and events as one list, newest first, each row
 * labelled by its kind. A source still loading or unreadable is named above
 * the rows, never counted as empty.
 */
export function AllList({ articles, publications, events, q, onRetry }) {
  const filteredPublications = publications.status === 'ready'
    ? { ...publications, rows: (publications.rows || []).filter((r) => matchesQuery(r, q)) }
    : publications;
  const all = combineAll({ article: articles, publication: filteredPublications, event: events });
  if (all.loading.length === 3) return <LearningLoading rows={4} what="the catalogue" />;
  return (
    <div className="space-y-3" data-testid="list-all">
      {all.unreadable.map((kind) => (
        <LearningUnreadable key={kind} what={SOURCE_NAME[kind]} claim="This is not a claim that it is empty." onRetry={onRetry?.[kind]} />
      ))}
      {all.loading.length > 0 && (
        <p className="text-[12px] text-axal-muted dark:text-gray-400" data-testid="text-all-loading">
          Still reading {all.loading.map((k) => `${kindLabel(k).toLowerCase()}s`).join(' and ')}…
        </p>
      )}
      {all.rows.length === 0 && all.loading.length === 0 && all.unreadable.length === 0 && (
        q ? <LearningEmpty title={`Nothing matches “${q}”`} body="Try another word, or clear the search." />
          : <LearningEmpty title="Nothing published yet" body="Articles, publications and upcoming events appear here." />
      )}
      {all.rows.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {all.rows.map((row) => {
              const inner = (
                <>
                  <span><Pill tone="info">{kindLabel(row.kind)}</Pill></span>
                  <span className="line-clamp-2 text-[13.5px] font-semibold text-axal-ink dark:text-gray-100">{row.title}</span>
                  <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{allMeta(row) || 'Date not recorded'}</span>
                </>
              );
              return row.href
                ? <Card key={row.key} as={Link} to={row.href} interactive padding="sm" className="flex flex-col gap-1.5" data-testid={`all-row-${row.kind}`}>{inner}</Card>
                : <Card key={row.key} padding="sm" className="flex flex-col gap-1.5" data-testid={`all-row-${row.kind}`}>{inner}</Card>;
            })}
          </div>
          <p className="text-[11.5px] tabular-nums text-axal-faint dark:text-gray-500" data-testid="text-all-count">
            {all.rows.length < all.count ? `The newest ${ALL_LIMIT} of ${all.count}` : `${all.count} in all`} across articles, publications and events. Each tab holds its own full list.
          </p>
        </>
      )}
    </div>
  );
}

/** The tab bar: arrow keys move along it, as a tablist should. */
function TabBar({ tab, gated, onTab }) {
  const move = (event) => {
    const keys = LEARNING_TABS.map((t) => t.key);
    const at = keys.indexOf(tab);
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = keys[(at + step + keys.length) % keys.length];
    onTab(next);
    if (typeof document !== 'undefined') document.getElementById(`learning-tab-${next}`)?.focus();
  };
  return (
    <div role="tablist" aria-label="Learning" className="flex gap-1 overflow-x-auto border-b border-axal-hairline px-3 pb-2 pt-3 dark:border-gray-800" onKeyDown={move}>
      {LEARNING_TABS.map((t) => {
        const on = t.key === tab;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`learning-tab-${t.key}`}
            aria-selected={on}
            aria-controls="learning-panel"
            tabIndex={on ? 0 : -1}
            onClick={() => onTab(t.key)}
            className={`whitespace-nowrap rounded-axal-sm px-3 py-1.5 text-[12.5px] font-semibold ${on
              ? 'bg-axal-lavender text-axal-violet-deep dark:bg-violet-900/30 dark:text-violet-300'
              : 'text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}
            data-testid={`tab-${t.key}`}
          >
            {t.label}
            {gated && t.key !== 'articles' && <span className="sr-only"> (coming soon)</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The learner home, drawn entirely from its props so every state can be
 * rendered without a fetch (D562). `LearningHome` below owns the reads.
 *
 *   gated     `learningComingSoon()` for this profile: Articles open, the rest
 *             one coming-soon card (temporary, owner's request of 2026-10-06)
 *   tab       the open tab; onTab(key)
 *   query     the search box; q the settled query the reads used
 *   articles, publications, events   `{ status, rows, total, offset }`
 *   links     extra links for an admin: [{ to, label }]
 */
export function LearningHomeView({
  gated, tab, onTab = () => {}, query = '', onQuery = () => {}, q = '',
  articles, publications, events, onArticlesPage = () => {}, onRetry = {}, links = [],
}) {
  const mode = tabMode(tab, gated);
  return (
    <>
      <LearningHeader
        eyebrow={null}
        title="Learning"
        sub="Courses, videos, webinars, articles, publications, events, exercises and exams, in one place."
        action={<WriteArticleLink />}
      />
      {links.length > 0 && (
        <nav aria-label="Learning pages" className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]" data-testid="learning-admin-links">
          {links.map((l) => (
            <Link key={l.to} to={l.to} className="font-semibold text-axal-violet-deep underline hover:text-axal-violet dark:text-violet-300">{l.label}</Link>
          ))}
        </nav>
      )}
      {gated ? (
        <ComingSoonCard articlesLink={false} testid="learning-coming-soon-sections" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard title="Continue learning" testid="section-continue"><NotLiveYet /></SectionCard>
          <SectionCard title="My programs" testid="section-programs"><NotLiveYet /></SectionCard>
        </div>
      )}
      <Card padding="none" data-testid="learning-catalogue">
        <TabBar tab={tab} gated={gated} onTab={onTab} />
        {mode === 'live' && (
          <div className="px-4 pt-3">
            <label htmlFor="learning-search" className="sr-only">Search</label>
            <div className="relative">
              <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-axal-faint dark:text-gray-500" />
              <input
                id="learning-search"
                type="search"
                value={query}
                onChange={(e) => onQuery(e.target.value)}
                placeholder={gated ? 'Search articles' : 'Search articles, publications and events'}
                className="w-full rounded-axal-md border border-axal-hairline bg-white py-2 pl-9 pr-3 text-[13px] text-axal-ink placeholder:text-axal-faint dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                data-testid="input-learning-search"
              />
            </div>
          </div>
        )}
        <div id="learning-panel" role="tabpanel" aria-labelledby={`learning-tab-${tab}`} className="p-4" data-testid={`panel-${tab}`} data-mode={mode}>
          {mode === 'coming_soon' && <ComingSoonCard />}
          {mode === 'not_live' && <NotLiveYet />}
          {mode === 'live' && tab === 'all' && <AllList articles={articles} publications={publications} events={events} q={q} onRetry={onRetry} />}
          {mode === 'live' && tab === 'articles' && <ArticleList state={articles} q={q} onPage={onArticlesPage} onRetry={onRetry.article} />}
          {mode === 'live' && tab === 'publications' && <PublicationList state={publications} q={q} onRetry={onRetry.publication} />}
          {mode === 'live' && tab === 'events' && <EventList state={events} q={q} onRetry={onRetry.event} />}
        </div>
      </Card>
      {!gated && (
        <SectionCard title="Upcoming webinars" testid="section-webinars"><NotLiveYet /></SectionCard>
      )}
    </>
  );
}

/** What the rail says it is looking at: one line per source this page actually read. */
export function homeCoverage({ gated, q, articles, publications, events }) {
  const s = (n) => (n === 1 ? '' : 's');
  return [
    articles.status === 'ready' && Number.isFinite(articles.total)
      ? `${articles.total} published article${s(articles.total)}${q ? ` matching “${q}”` : ''}`
      : null,
    !gated && publications.status === 'ready' ? `${publications.rows.length} publication${s(publications.rows.length)}` : null,
    !gated && events.status === 'ready' ? `${events.rows.length} upcoming event${s(events.rows.length)} read` : null,
  ].filter(Boolean);
}

const IDLE = { status: 'idle', rows: [] };

/**
 * `/learning`: the container. It owns the tab (in the URL, `?tab=`), the
 * search and the three reads, and hands them to `LearningHomeView`. A gated
 * profile reads articles only: the other two would be drawn nowhere.
 */
export default function LearningHome({ gated, links = [] }) {
  const [params, setParams] = useSearchParams();
  const tab = resolveTab(params.get('tab'), gated);
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [reload, setReload] = useState({ article: 0, publication: 0, event: 0 });
  const [articles, setArticles] = useState({ status: 'loading', rows: [] });
  const [publications, setPublications] = useState(gated ? IDLE : { status: 'loading', rows: [] });
  const [events, setEvents] = useState(gated ? IDLE : { status: 'loading', rows: [] });

  useEffect(() => {
    const t = setTimeout(() => { setQ(query.trim()); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let alive = true;
    setArticles({ status: 'loading', rows: [] });
    readArticles({ q, page })
      .then((r) => { if (alive) setArticles({ status: 'ready', ...r }); })
      .catch((err) => { if (!alive) return; reportError('Learning:articles', err); setArticles({ status: 'unreadable', rows: [] }); });
    return () => { alive = false; };
  }, [q, page, reload.article]);

  useEffect(() => {
    if (gated) return undefined;
    let alive = true;
    setPublications({ status: 'loading', rows: [] });
    readPublications()
      .then((r) => { if (alive) setPublications({ status: 'ready', ...r }); })
      .catch((err) => { if (!alive) return; reportError('Learning:publications', err); setPublications({ status: 'unreadable', rows: [] }); });
    return () => { alive = false; };
  }, [gated, reload.publication]);

  useEffect(() => {
    if (gated) return undefined;
    let alive = true;
    setEvents({ status: 'loading', rows: [] });
    readEvents({ q })
      .then((r) => { if (alive) setEvents({ status: 'ready', ...r }); })
      .catch((err) => { if (!alive) return; reportError('Learning:events', err); setEvents({ status: 'unreadable', rows: [] }); });
    return () => { alive = false; };
  }, [gated, q, reload.event]);

  // A new tab starts the articles from their newest page, so All, which shares
  // that read, is always "the newest", never page three of the Articles tab.
  const onTab = useCallback((key) => {
    setPage(0);
    setParams((old) => { const next = new URLSearchParams(old); next.set('tab', key); return next; }, { replace: true });
  }, [setParams]);
  const retry = (kind) => () => setReload((r) => ({ ...r, [kind]: r[kind] + 1 }));

  return (
    <RailFrame
      rail={(
        <WorkerRail
          workspace="Learning"
          // Violet, the founder accent: the canvas draws the learner's
          // Learning in #7c3aed for every profile it serves.
          role="founder"
          stance="Read-only catalogue"
          note="Eadwyn reads back the lines this page has loaded, on a click. It does not write an article, register you for an event or mark anything complete."
          coverage={homeCoverage({ gated, q, articles, publications, events })}
          unavailable={gated
            ? [['Courses, videos, webinars and more', COMING_SOON_LINE]]
            : [['Courses, videos, webinars, exercises and exams', NOT_LIVE_LINE]]}
        />
      )}
      data-testid="learning-home"
    >
      <div className="space-y-4">
        <LearningHomeView
          gated={gated}
          tab={tab}
          onTab={onTab}
          query={query}
          onQuery={setQuery}
          q={q}
          articles={articles}
          publications={publications}
          events={events}
          onArticlesPage={(step) => setPage((p) => Math.max(0, p + step))}
          onRetry={{ article: retry('article'), publication: retry('publication'), event: retry('event') }}
          links={links}
        />
      </div>
    </RailFrame>
  );
}
