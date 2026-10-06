import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarPlus, ChevronLeft, ChevronRight, Search, SquarePen } from 'lucide-react';
import { Card, Pill, RailFrame, Unrecorded, WorkerRail } from '../../ui';
import { COMING_SOON_LINE } from './learningAccess';
import {
  ALL_LIMIT, ARTICLES_PAGE_SIZE, EVENTS_PAGE_SIZE, LEARNING_TABS, TAB_KIND, TAB_NOT_LIVE,
  durationLabel, formatDay, formatWhen, kindLabel, matchesQuery, minutesLabel, rangeLabel, resolveTab, sourceStates, tabMode,
} from './learningModel';
import { readArticles, readCatalog, readEvents, readMe, readPublications } from './learningReads';
import { readWebinars } from './webinarReads';
import {
  ComingSoonCard, LearningEmpty, LearningHeader, LearningLoading, LearningUnreadable, NotLiveYet,
  RouteUnreadable, SectionCard,
} from './LearningStates';
import { MyProgramsSection, useMyPrograms } from './MyPrograms';
import { UpcomingWebinarsList, WebinarsTabPanel, useNow } from './LearningWebinars';
import useLearningRead from './useLearningRead';

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
const isLoading = (state) => state.status === 'loading' || state.status === 'idle';

function RowTitle({ href, children, testid }) {
  return href
    ? <Link to={href} className={ROW_TITLE} data-testid={testid}>{children}</Link>
    : <span className="text-[14px] font-semibold text-axal-ink dark:text-gray-100" data-testid={testid}>{children}</span>;
}

function Pager({ prevDisabled, nextDisabled, onPage, prevLabel = 'Previous', nextLabel = 'Next', testid }) {
  return (
    <span className="flex gap-1.5">
      <button type="button" className={PAGER} disabled={prevDisabled} onClick={() => onPage(-1)} data-testid={`button-${testid}-prev`}>
        <ChevronLeft size={13} aria-hidden="true" /> {prevLabel}
      </button>
      <button type="button" className={PAGER} disabled={nextDisabled} onClick={() => onPage(1)} data-testid={`button-${testid}-next`}>
        {nextLabel} <ChevronRight size={13} aria-hidden="true" />
      </button>
    </span>
  );
}

/**
 * Articles: the published list, each row opening `/articles/:slug` in the
 * existing reader, with the author, their role, the date and the reading time
 * the route sends (D562). This tab stays open while the rest is coming soon.
 */
export function ArticleList({ state, q, onPage, onRetry }) {
  if (isLoading(state)) return <LearningLoading rows={4} what="the articles" />;
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
        <Pager prevDisabled={offset === 0} nextDisabled={!hasNext} onPage={onPage} prevLabel="Newer" nextLabel="Older" testid="articles" />
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
  if (isLoading(state)) return <LearningLoading rows={3} what="the publications" />;
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
  if (isLoading(state)) return <LearningLoading rows={3} what="the events" />;
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

/** The line under a catalog card: what each kind's row carries. */
export function catalogMeta(row) {
  const parts = {
    course: [row.level, minutesLabel(row.minutes)],
    video: [durationLabel(row.seconds), row.topic, row.level],
    reading: [row.topic, row.level],
    article: [row.author, row.readMinutes ? `${row.readMinutes} min read` : null, formatDay(row.date)],
    publication: [formatDay(row.date), row.section],
    // The catalog's event row sends no time zone, so the start is in the reader's own.
    event: [formatWhen(row.date), row.type],
  }[row.kind] || [];
  return parts.filter(Boolean).join(' · ');
}

const CATALOG_EMPTY = {
  course: ['No course published yet', 'Courses HQ publishes appear here.'],
  video: ['No video published yet', 'Videos HQ publishes appear here.'],
  all: ['Nothing published yet', 'Courses, videos, readings, articles, publications and upcoming events appear here.'],
};

/**
 * All, Courses and Videos, from D557's catalog. Each row is labelled by its
 * kind, and a draft the Super Admin can see says so. A source the route could
 * not read is named in the route's own words above the rows, and is never
 * folded in as empty; a whole catalog that failed is Unreadable.
 */
export function CatalogList({ state, kind = null, q = '', onPage, onRetry }) {
  if (isLoading(state)) return <LearningLoading rows={4} what="the catalogue" />;
  if (state.status !== 'ready') {
    return <LearningUnreadable what="The catalogue" claim="This is not a claim that nothing is published." onRetry={onRetry} />;
  }
  const rows = state.rows || [];
  const failed = sourceStates(state.sources).filter((s) => s.status === 'unreadable');
  const own = kind ? state.sources?.[kind] : null;
  const offset = state.offset || 0;
  const [emptyTitle, emptyBody] = CATALOG_EMPTY[kind || 'all'];
  return (
    <div className="space-y-3" data-testid={`list-catalog-${kind || 'all'}`}>
      {failed.map((s) => <RouteUnreadable key={s.kind} reason={s.reason} onRetry={onRetry} testid={`source-unreadable-${s.kind}`} />)}
      {rows.length === 0 && failed.length === 0 && (
        q ? <LearningEmpty title={`Nothing matches “${q}”`} body="Try another word, or clear the search." /> : <LearningEmpty title={emptyTitle} body={emptyBody} />
      )}
      {rows.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((row) => {
              const inner = (
                <>
                  <span className="flex flex-wrap gap-1.5">
                    <Pill tone="info">{kindLabel(row.kind)}</Pill>
                    {row.draft && <Pill tone="warn">{row.draft}</Pill>}
                  </span>
                  <span className="line-clamp-2 text-[13.5px] font-semibold text-axal-ink dark:text-gray-100">{row.title}</span>
                  <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{catalogMeta(row) || <Unrecorded>Not recorded</Unrecorded>}</span>
                </>
              );
              return row.href
                ? <Card key={row.key} as={Link} to={row.href} interactive padding="sm" className="flex flex-col gap-1.5" data-testid={`catalog-row-${row.kind}`}>{inner}</Card>
                : <Card key={row.key} padding="sm" className="flex flex-col gap-1.5" data-testid={`catalog-row-${row.kind}`}>{inner}</Card>;
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-axal-hairline pt-3 dark:border-gray-800">
            <span className="text-[11.5px] tabular-nums text-axal-faint dark:text-gray-500" data-testid="text-catalog-range">
              {kind
                ? rangeLabel(offset, rows.length, Number(own?.total))
                : `The newest ${rows.length} across courses, videos, readings, articles, publications and events. Each tab holds its own list.`}
            </span>
            {kind && onPage && (
              <Pager prevDisabled={offset === 0} nextDisabled={offset + rows.length >= Number(own?.total || 0)} onPage={onPage} testid="catalog" />
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Continue learning: what the member has started, from `GET /api/learning/me`. */
export function ContinueLearning({ state, onRetry }) {
  if (isLoading(state)) return <LearningLoading rows={2} what="your progress" />;
  if (state.status !== 'ready') {
    return <LearningUnreadable what="Your progress" claim="This is not a claim that you have started nothing." onRetry={onRetry} />;
  }
  const rows = (state.in_progress || []).filter((r) => r.href).slice(0, 3);
  if (!rows.length) return <LearningEmpty title="Nothing in progress" body="A course you start appears here, with where you left off." />;
  return (
    <ul className="space-y-3" data-testid="list-continue">
      {rows.map((r) => {
        const p = Number(r.percent);
        const has = r.percent !== null && r.percent !== undefined && Number.isFinite(p);
        return (
          <li key={`${r.subject_kind}:${r.subject_uid}`} className="space-y-1" data-testid="row-continue">
            <div className="flex items-baseline justify-between gap-2 text-[13px]">
              <Link to={r.href} className="min-w-0 truncate font-semibold text-axal-ink hover:text-axal-violet-deep dark:text-gray-100 dark:hover:text-violet-300">{r.title || 'Untitled'}</Link>
              <span className="flex-none text-[12px] tabular-nums text-axal-muted dark:text-gray-400">{has ? `${Math.round(p)}%` : 'Started'}</span>
            </div>
            {has && (
              <div className="h-1.5 overflow-hidden rounded-full bg-axal-ground dark:bg-gray-800" aria-hidden="true">
                <div className="h-full rounded-full bg-axal-violet" style={{ width: `${Math.max(0, Math.min(100, Math.round(p)))}%` }} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
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

const IDLE = { status: 'idle' };
const PROGRAMS_IDLE = { enrolled: IDLE, open: IDLE };

/**
 * The catalog read as the open tab may draw it. A tab switch renders once
 * before the new tab's read starts, so a reply for another kind is "loading"
 * here: All's rows are never drawn under Courses, nor Courses' under Videos.
 */
export function catalogFor(state, kind) {
  return state?.status === 'ready' && (state.kind || null) !== (kind || null) ? { status: 'loading' } : state;
}

/**
 * The learner home, drawn entirely from its props so every state can be
 * rendered without a fetch (D562). `LearningHome` below owns the reads.
 *
 *   gated     `learningComingSoon()` for this profile: Articles open, the rest
 *             one coming-soon card (temporary, owner's request of 2026-10-06)
 *   tab       the open tab; onTab(key)
 *   query     the search box; q the settled query the reads used
 *   catalog   `readCatalog`'s state, for All, Courses and Videos
 *   articles, publications, events   each tab's own read
 *   upcoming, past   `readWebinars`' states (D560): upcoming for the
 *             Webinars tab and "Upcoming webinars", past for the tab only
 *   me        `readMe`'s state, for Continue learning
 *   programs  `useMyPrograms()`'s reads and enrol (D558), for My programs
 *   now       the clock the webinar rows are placed against
 *   links     extra links for an admin: [{ to, label }]
 */
export function LearningHomeView({
  gated, tab, onTab = () => {}, query = '', onQuery = () => {}, q = '',
  catalog = IDLE, articles = IDLE, publications = IDLE, events = IDLE, me = IDLE,
  upcoming = IDLE, past = IDLE, programs = PROGRAMS_IDLE, now = Date.now(),
  onCatalogPage = () => {}, onArticlesPage = () => {}, onRetry = {}, links = [],
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
          <SectionCard title="Continue learning" testid="section-continue"><ContinueLearning state={me} onRetry={onRetry.me} /></SectionCard>
          <MyProgramsSection {...programs} />
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
                placeholder={gated ? 'Search articles' : 'Search courses, videos, webinars, articles, publications and events'}
                className="w-full rounded-axal-md border border-axal-hairline bg-white py-2 pl-9 pr-3 text-[13px] text-axal-ink placeholder:text-axal-faint dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                data-testid="input-learning-search"
              />
            </div>
          </div>
        )}
        <div id="learning-panel" role="tabpanel" aria-labelledby={`learning-tab-${tab}`} className="p-4" data-testid={`panel-${tab}`} data-mode={mode}>
          {mode === 'coming_soon' && <ComingSoonCard />}
          {mode === 'not_live' && <NotLiveYet line={TAB_NOT_LIVE[tab]} />}
          {mode === 'live' && tab === 'all' && <CatalogList state={catalog} q={q} onRetry={onRetry.catalog} />}
          {mode === 'live' && TAB_KIND[tab] && <CatalogList state={catalog} kind={TAB_KIND[tab]} q={q} onPage={onCatalogPage} onRetry={onRetry.catalog} />}
          {mode === 'live' && tab === 'webinars' && (
            <WebinarsTabPanel upcoming={upcoming} past={past} q={q} now={now} onRetry={{ upcoming: onRetry.upcoming, past: onRetry.past }} />
          )}
          {mode === 'live' && tab === 'articles' && <ArticleList state={articles} q={q} onPage={onArticlesPage} onRetry={onRetry.article} />}
          {mode === 'live' && tab === 'publications' && <PublicationList state={publications} q={q} onRetry={onRetry.publication} />}
          {mode === 'live' && tab === 'events' && <EventList state={events} q={q} onRetry={onRetry.event} />}
        </div>
      </Card>
      {!gated && (
        <SectionCard title="Upcoming webinars" testid="section-webinars">
          <UpcomingWebinarsList state={upcoming} now={now} onRetry={onRetry.upcoming} />
        </SectionCard>
      )}
    </>
  );
}

/** What the rail says it is looking at: one line per read this page actually made. */
export function homeCoverage({ gated, q, catalog, articles, publications, events, me, upcoming, programs }) {
  const s = (n) => (n === 1 ? '' : 's');
  const lines = [];
  if (catalog?.status === 'ready') {
    const own = catalog.kind ? catalog.sources?.[catalog.kind] : null;
    if (own?.status === 'ready') lines.push(`${own.total} ${kindLabel(catalog.kind).toLowerCase()}${s(own.total)} in the catalogue`);
    if (!catalog.kind) lines.push(`${catalog.rows.length} newest catalogue row${s(catalog.rows.length)}`);
  }
  if (articles?.status === 'ready' && Number.isFinite(articles.total)) {
    lines.push(`${articles.total} published article${s(articles.total)}${q ? ` matching “${q}”` : ''}`);
  }
  if (!gated && publications?.status === 'ready') lines.push(`${publications.rows.length} publication${s(publications.rows.length)}`);
  if (!gated && events?.status === 'ready') lines.push(`${events.rows.length} upcoming event${s(events.rows.length)} read`);
  if (!gated && me?.status === 'ready') lines.push(`${me.in_progress.length} started by you`);
  if (!gated && upcoming?.status === 'ready') lines.push(`${upcoming.rows.length} upcoming webinar${s(upcoming.rows.length)} read`);
  if (!gated && programs?.enrolled?.status === 'ready') lines.push(`${programs.enrolled.rows.length} program${s(programs.enrolled.rows.length)} you are in`);
  return lines;
}

/**
 * `/learning`: the container. It owns the tab (in the URL, `?tab=`), the
 * search and the reads, and hands them to `LearningHomeView`. Each tab reads
 * only while it is open. A gated profile reads articles only: nothing else is
 * drawn for it.
 */
export default function LearningHome({ gated, links = [] }) {
  const [params, setParams] = useSearchParams();
  const tab = resolveTab(params.get('tab'), gated);
  const live = tabMode(tab, gated) === 'live';
  const kind = TAB_KIND[tab] || null;
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [catalogOffset, setCatalogOffset] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => { setQ(query.trim()); setPage(0); setCatalogOffset(0); }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const [catalogRead, retryCatalog] = useLearningRead(() => readCatalog({ kind, q, offset: catalogOffset }), [kind, q, catalogOffset],
    { enabled: live && (tab === 'all' || Boolean(kind)), scope: 'catalog' });
  const catalog = catalogFor(catalogRead, kind);
  const [articles, retryArticles] = useLearningRead(() => readArticles({ q, page }), [q, page],
    { enabled: live && tab === 'articles', scope: 'articles' });
  const [publications, retryPublications] = useLearningRead(readPublications, [],
    { enabled: live && tab === 'publications', scope: 'publications' });
  const [events, retryEvents] = useLearningRead(() => readEvents({ q }), [q],
    { enabled: live && tab === 'events', scope: 'events' });
  const [me, retryMe] = useLearningRead(readMe, [], { enabled: !gated, scope: 'me' });
  // Upcoming webinars feed both the home's section and the Webinars tab, so they
  // are read once; the past ones only while that tab is open.
  const [upcoming, retryUpcoming] = useLearningRead(() => readWebinars('upcoming'), [], { enabled: !gated, scope: 'webinars-upcoming' });
  const [past, retryPast] = useLearningRead(() => readWebinars('past'), [],
    { enabled: live && tab === 'webinars', scope: 'webinars-past' });
  const programs = useMyPrograms(!gated);
  const now = useNow(60 * 1000);

  // A new tab starts from its first page.
  const onTab = useCallback((key) => {
    setPage(0);
    setCatalogOffset(0);
    setParams((old) => { const next = new URLSearchParams(old); next.set('tab', key); return next; }, { replace: true });
  }, [setParams]);

  return (
    <RailFrame
      rail={(
        <WorkerRail
          workspace="Learning"
          // Violet, the founder accent: the canvas draws the learner's
          // Learning in #7c3aed for every profile it serves.
          role="founder"
          stance="Read-only catalogue"
          note="Eadwyn reads back the lines this page has loaded, on a click. It does not write an article, register you for an event or a webinar, enrol you in a program or mark anything complete."
          coverage={homeCoverage({ gated, q, catalog, articles, publications, events, me, upcoming, programs })}
          unavailable={gated
            ? [['Courses, videos, webinars and more', COMING_SOON_LINE]]
            : [['Exercises and exams', 'No route lists them on their own, so the home reads neither. Each opens from the course or program that holds it.']]}
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
          catalog={catalog}
          articles={articles}
          publications={publications}
          events={events}
          me={me}
          upcoming={upcoming}
          past={past}
          programs={programs}
          now={now}
          onCatalogPage={(step) => setCatalogOffset((o) => Math.max(0, o + step * ALL_LIMIT))}
          onArticlesPage={(step) => setPage((p) => Math.max(0, p + step))}
          onRetry={{
            catalog: retryCatalog, article: retryArticles, publication: retryPublications, event: retryEvents, me: retryMe,
            upcoming: retryUpcoming, past: retryPast,
          }}
          links={links}
        />
      </div>
    </RailFrame>
  );
}
