import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarPlus, ChevronLeft, ChevronRight, Search, SquarePen } from 'lucide-react';
import { Card, PhoneBar, PhoneRows, Pill, RailFrame, Unrecorded, usePhoneWidth } from '../../ui';
import { phonePending } from '../account/AccountPhonePage';
import { ACCOUNT_PHONE_PAGES } from '../account/accountPhone';
import { COMING_SOON_LINE } from './learningAccess';
import {
  ALL_LIMIT, ARTICLES_PAGE_SIZE, EVENTS_PAGE_SIZE, LEARNING_TABS, RECOMMENDED_FUTURE, SUBMISSION_STATUS, TAB_KIND,
  newThisWeek,
  durationLabel, formatDay, formatWhen, kindLabel, matchesQuery, minutesLabel, rangeLabel, resolveTab, sourceStates, tabMode, webinarPhase,
} from './learningModel';
import { readArticles, readCatalog, readEvents, readExams, readExercises, readItemPreview, readMe, readMyStats, readPublications } from './learningReads';
import { readWebinars } from './webinarReads';
import {
  ComingSoonCard, LearningEmpty, LearningLoading, LearningUnreadable, NotLiveYet,
  RouteUnreadable, SectionCard, stateBlock,
} from './LearningStates';
import { MyProgramsSection, OpenPrograms, useMyPrograms } from './MyPrograms';
import { WebinarsTabPanel, useNow } from './LearningWebinars';
import { formatWebinarDayTime, seatsOf } from './webinarModel';
import { memberProgramHref, programProgress, progressLine } from './programModel';
import useLearningRead from './useLearningRead';
import { HOME_SECONDARY, HomePhonePrimary, HomeWebinarAction, HomeWebinarsList, homeSeatsLine, inProgressCourses, useHomeWebinarRegistration } from './LearningHomeActions';

/** The canvas's one header action, kept for every profile: Articles stay open. */
export function WriteArticleLink({ secondary = false }) {
  return (
    <Link
      to="/articles/draft"
      className={secondary ? HOME_SECONDARY : "inline-flex items-center gap-1.5 rounded-axal-sm bg-axal-violet px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-axal-violet-deep"}
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

/**
 * lr7: a video card's hover preview. A pointer that rests on the card for
 * 400 ms reads the item once (`readItemPreview`) and, when Stream has a ready
 * preview, shows it above the card's text; nothing is drawn otherwise, and a
 * touch never triggers it. The preview is decoration: it is hidden from
 * assistive technology and says nothing the card does not.
 */
export function HoverPreview({ uid, read = readItemPreview, delay = 400 }) {
  const [url, setUrl] = useState(null);
  const [shown, setShown] = useState(false);
  const timer = React.useRef(null);
  const host = React.useRef(null);
  useEffect(() => {
    const card = host.current?.parentElement;
    if (!card) return undefined;
    let live = true;
    const enter = (e) => {
      if (e.pointerType === 'touch') return;
      clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        const u = await read(uid);
        if (live && u) { setUrl(u); setShown(true); }
      }, delay);
    };
    const leave = () => { clearTimeout(timer.current); setShown(false); };
    card.addEventListener('pointerenter', enter);
    card.addEventListener('pointerleave', leave);
    return () => { live = false; clearTimeout(timer.current); card.removeEventListener('pointerenter', enter); card.removeEventListener('pointerleave', leave); };
  }, [uid, read, delay]);
  return (
    <span ref={host} aria-hidden="true" className={shown && url ? 'block overflow-hidden rounded-axal-sm bg-black' : 'hidden'} data-testid="catalog-row-preview">
      {shown && url ? <img src={url} alt="" className="aspect-video w-full object-cover" data-testid="img-catalog-preview" /> : null}
    </span>
  );
}

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
                  {row.kind === 'video' && row.uid ? <HoverPreview uid={row.uid} /> : null}
                  <span className="flex flex-wrap gap-1.5">
                    <Pill tone="info">{kindLabel(row.kind)}</Pill>
                    {row.draft && <Pill tone="warn">{row.draft}</Pill>}
                  </span>
                  <span className="line-clamp-2 text-[13.5px] font-semibold text-axal-ink dark:text-gray-100">{row.title}</span>
                  <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{catalogMeta(row) || <Unrecorded>Not recorded</Unrecorded>}</span>
                  {row.found ? <span className="line-clamp-2 text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="catalog-row-found">{row.found}</span> : null}
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

/**
 * D3726 (#3726) LR1 — "Your progress": the four figures of #4180's
 * `GET /api/learning/me/stats` (`statsTiles`). A figure the route does not
 * record reads "Not recorded", never 0; a failed read says so and is never
 * a row of zeros.
 */
export function ProgressStrip({ state = IDLE, onRetry }) {
  if (isLoading(state)) return <LearningLoading rows={1} what="your progress figures" />;
  if (state.status !== 'ready') {
    return <LearningUnreadable what="Your progress figures" claim="This is not a claim that they are zero." onRetry={onRetry} />;
  }
  return (
    <div data-testid="section-progress">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {(state.tiles || []).map((t) => (
          <Card key={t.key} padding="sm" className="flex flex-col gap-0.5" data-testid="progress-figure">
            <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{t.label}</span>
            <span className="text-[13px] font-bold">{t.value === 'Not recorded' ? <Unrecorded reason="Not recorded for this month yet.">Not recorded</Unrecorded> : t.value}</span>
          </Card>
        ))}
      </div>
    </div>
  );
}

/**
 * D3726 LR1 — "New this week": courses, videos and readings dated in the last
 * seven days, newest first, from the catalog the All tab reads. A failed read
 * is Unreadable, never an empty week.
 */
export function NewThisWeek({ state, now = Date.now(), onRetry, limit = 4 }) {
  let body;
  if (isLoading(state)) body = <LearningLoading rows={2} what="what is new" />;
  else if (state.status !== 'ready') body = <LearningUnreadable what="What is new this week" claim="This is not a claim that nothing is new." onRetry={onRetry} />;
  else {
    const rows = newThisWeek(state.rows, now).slice(0, limit);
    body = rows.length === 0 ? (
      <LearningEmpty title="Nothing new this week" body="Courses, videos and readings HQ publishes appear here in their first week." />
    ) : (
      <ul className="divide-y divide-axal-hairline dark:divide-gray-800" data-testid="list-new-this-week">
        {rows.map((row) => (
          <li key={row.key} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0" data-testid={`new-row-${row.kind}`}>
            <span className="flex min-w-0 items-center gap-2">
              <Pill tone="info">{kindLabel(row.kind)}</Pill>
              <RowTitle href={row.href}>{row.title}</RowTitle>
            </span>
            <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{catalogMeta(row) || <Unrecorded>Length not recorded</Unrecorded>}</span>
          </li>
        ))}
      </ul>
    );
  }
  return <SectionCard title="New this week" meta="Newest first" testid="section-new-this-week">{body}</SectionCard>;
}

/** D3726 LR1 — "Recommended for you": a dashed future block, with no rows (#3724). */
export function RecommendedFuture() {
  return (
    <div className="rounded-axal border border-dashed border-axal-hairline px-4 py-3 dark:border-gray-700" data-testid="section-recommended">
      <p className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">Recommended for you <span className="ml-1 rounded-full bg-axal-ground px-2 py-0.5 text-[11px] font-semibold text-axal-muted dark:bg-gray-800 dark:text-gray-400">Future</span></p>
      <p className="mt-0.5 text-[12px] text-axal-muted dark:text-gray-400">{RECOMMENDED_FUTURE}</p>
    </div>
  );
}

/** Continue learning: what the member has started, from `GET /api/learning/me`. */
export function ContinueLearning({ state, onRetry, onBrowse }) {
  if (isLoading(state)) return <LearningLoading rows={2} what="your progress" />;
  if (state.status !== 'ready') {
    return <LearningUnreadable what="Your progress" claim="This is not a claim that you have started nothing." onRetry={onRetry} />;
  }
  const rows = inProgressCourses(state).slice(0, 3);
  if (!rows.length) return <div className="space-y-2"><p className="text-[12.5px] text-axal-muted dark:text-gray-400">No course in progress.</p><button type="button" className={HOME_SECONDARY} onClick={onBrowse} disabled={!onBrowse} data-testid="learning-browse-courses">Browse courses</button></div>;
  return (
    <ul className="space-y-3" data-testid="list-continue">
      {rows.map((r) => {
        const p = Number(r.percent);
        const has = r.percent !== null && r.percent !== undefined && Number.isFinite(p);
        return (
          <li key={`${r.subject_kind}:${r.subject_uid}`} className="space-y-1" data-testid="row-continue">
            <div className="flex items-baseline justify-between gap-2 text-[13px]">
              <span className="min-w-0 flex-1 break-words"><RowTitle href={r.href}>{r.title || 'Untitled'}</RowTitle></span>
              <span className="flex-none text-[12px] tabular-nums text-axal-muted dark:text-gray-400">{has ? `${Math.round(p)}%` : 'Started'}</span>
            </div>
            {r.href ? <Link to={r.href} className="inline-flex min-h-[44px] items-center rounded-axal-sm bg-axal-violet px-3 py-1.5 text-[12.5px] font-semibold text-white dark:bg-violet-400 dark:text-gray-950 sm:min-h-[32px]">Continue</Link> : <Unrecorded>Course link not recorded</Unrecorded>}
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

function AdminLinks({ links }) {
  if (!links.length) return null;
  return (
    <nav aria-label="Learning pages" className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]" data-testid="learning-admin-links">
      {links.map((l) => (
        <Link key={l.to} to={l.to} className="font-semibold text-axal-violet-deep underline hover:text-axal-violet dark:text-violet-300">{l.label}</Link>
      ))}
    </nav>
  );
}

/** The catalogue card: the tab bar, the search and the open tab's list. */
/**
 * #4180 (lr2a, lr2b): the Exercises and Exams tabs, from their own list
 * routes. A failed read says so; an exam whose best score is not recorded says
 * "Score not recorded", never 0%.
 */
export function AssessmentList({ state = IDLE, kind, onPage, onRetry }) {
  const what = kind === 'exam' ? 'the exams' : 'the exercises';
  const rows = state.status === 'ready' ? state.rows || [] : [];
  const block = stateBlock({
    status: state.status, what, onRetry, claim: `This is not a claim that there are no ${kind}s.`, isEmpty: rows.length === 0,
    empty: { title: kind === 'exam' ? 'No exams published yet' : 'No exercises published yet', body: 'They appear here when HQ publishes them.' },
  });
  if (block) return <div data-testid={`${kind}-list`}>{block}</div>;
  const range = rangeLabel(state.offset || 0, rows.length, state.total);
  return (
    <div className="space-y-3" data-testid={`${kind}-list`}>
      <ul className="m-0 list-none divide-y divide-axal-hairline p-0 dark:divide-gray-800">
        {rows.map((row) => (
          <li key={row.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5" data-testid={`${kind}-row`}>
            <RowTitle href={row.href} testid={`${kind}-row-title`}>{row.title}</RowTitle>
            <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{row.where || <Unrecorded>Not in a course or programme</Unrecorded>}</span>
            {kind === 'exercise' ? (
              <span className="ml-auto inline-flex items-center gap-2 text-[11.5px] text-axal-muted dark:text-gray-400">
                {row.status ? <Pill tone={SUBMISSION_STATUS[row.status].tone}>{SUBMISSION_STATUS[row.status].label}</Pill> : <Pill tone="neutral">Not started</Pill>}
                <span className="tabular-nums">{formatDay(row.updated) || 'date not recorded'}</span>
              </span>
            ) : (
              <span className="ml-auto inline-flex flex-wrap items-center gap-2 text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="exam-row-meta">
                <span className="tabular-nums">{row.questions == null ? 'Questions not recorded' : `${row.questions} question${row.questions === 1 ? '' : 's'}`}</span>
                <span>· {row.limit}</span>
                {row.passMark ? <span>· {row.passMark}</span> : null}
                <span>· {row.attemptsLeft}</span>
                <span>· {row.best ? `Your best ${row.best}` : <Unrecorded>Score not recorded</Unrecorded>}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
      {range ? (
        <div className="flex items-center justify-between gap-2 text-[11.5px] text-axal-muted dark:text-gray-400">
          <span className="tabular-nums">{range}</span>
          <Pager prevDisabled={!state.offset} nextDisabled={state.total == null || (state.offset || 0) + rows.length >= state.total} onPage={onPage} testid={`${kind}-pager`} />
        </div>
      ) : null}
    </div>
  );
}

function LearningCatalogue({
  gated, tab, onTab, query, onQuery, q, catalog, articles, publications, events, upcoming, past, now,
  onCatalogPage, onArticlesPage, onRetry, exercises = IDLE, exams = IDLE, onAssessmentPage = () => {}, showTabs = true,
}) {
  const mode = tabMode(tab, gated);
  return (
    <Card padding="none" data-testid="learning-catalogue">
      {showTabs && <TabBar tab={tab} gated={gated} onTab={onTab} />}
      {mode === 'live' && (
        <div className="px-4 pt-3">
          <label htmlFor="learning-search" className="sr-only">Search</label>
          <div role="search" className="relative">
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
        {mode === 'not_live' && <NotLiveYet />}
        {mode === 'live' && tab === 'all' && <CatalogList state={catalog} q={q} onRetry={onRetry.catalog} />}
        {mode === 'live' && TAB_KIND[tab] && <CatalogList state={catalog} kind={TAB_KIND[tab]} q={q} onPage={onCatalogPage} onRetry={onRetry.catalog} />}
        {mode === 'live' && tab === 'webinars' && (
          <WebinarsTabPanel upcoming={upcoming} past={past} q={q} now={now} onRetry={{ upcoming: onRetry.upcoming, past: onRetry.past }} />
        )}
        {mode === 'live' && tab === 'articles' && <ArticleList state={articles} q={q} onPage={onArticlesPage} onRetry={onRetry.article} />}
        {mode === 'live' && tab === 'publications' && <PublicationList state={publications} q={q} onRetry={onRetry.publication} />}
        {mode === 'live' && tab === 'events' && <EventList state={events} q={q} onRetry={onRetry.event} />}
        {mode === 'live' && tab === 'exercises' && <AssessmentList state={exercises} kind="exercise" onPage={onAssessmentPage} onRetry={onRetry.exercises} />}
        {mode === 'live' && tab === 'exams' && <AssessmentList state={exams} kind="exam" onPage={onAssessmentPage} onRetry={onRetry.exams} />}
      </div>
    </Card>
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
 *   catalog   `readCatalog`'s state, for All, Courses and Videos
 *   articles, publications, events   each tab's own read
 *   upcoming, past   `readWebinars`' states (D560): upcoming for the
 *             Webinars tab and "Upcoming webinars", past for the tab only
 *   me        `readMe`'s state, for Continue learning
 *   programs  `useMyPrograms()`'s reads and enrol (D558), for My programs
 *   now       the clock the webinar rows are placed against
 *   links     extra links for an admin: [{ to, label }]
 */
/** The home shares Help's decorative artwork; no Learning reads or gates change. */
export function LearningHero({ phoneBar = null, primary = null, showArticle = true }) {
  return (
    <header className="relative isolate overflow-hidden border-b border-violet-200 bg-violet-50 px-4 pb-8 pt-10 text-center md:px-8 dark:border-violet-900/60 dark:bg-violet-950" data-testid="learning-hero">
      <img src="/site/home-hero.webp" alt="" className="absolute inset-0 -z-20 h-full w-full object-cover object-[center_45%]" />
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-r from-violet-50/90 via-white/80 to-violet-50/70 dark:from-gray-950/90 dark:via-gray-950/80 dark:to-violet-950/80" />
      {phoneBar ? <div className="[&>div]:border-0 [&>div]:bg-transparent [&>div]:p-0 dark:[&>div]:bg-transparent">{phoneBar}</div> : <>
      <h1 className="text-[28px] font-extrabold leading-tight tracking-tight text-balance text-gray-900 dark:text-gray-100">Learning</h1>
      <p className="mx-auto mt-2 max-w-2xl text-[13.5px] leading-relaxed text-gray-600 dark:text-gray-300">Courses, videos, webinars, articles, publications, events, exercises and exams, in one place.</p>
      </>}
      {primary && <div className="mt-4">{primary}</div>}
      {showArticle && <div className="mt-5 flex justify-center"><WriteArticleLink /></div>}
    </header>
  );
}

export function LearningHomeView({
  gated, tab, onTab = () => {}, query = '', onQuery = () => {}, q = '',
  catalog = IDLE, articles = IDLE, publications = IDLE, events = IDLE, me = IDLE,
  upcoming = IDLE, past = IDLE, programs = PROGRAMS_IDLE, now = Date.now(), fresh = IDLE, stats = IDLE, webinarActions = {},
  onCatalogPage = () => {}, onArticlesPage = () => {}, onRetry = {}, links = [],
  exercises = IDLE, exams = IDLE, onAssessmentPage = () => {},
}) {
  return (
    <>
      <LearningHero />
      <div className="space-y-4 px-4 py-6 md:px-8">
        <AdminLinks links={links} />
        {gated ? (
          <ComingSoonCard articlesLink={false} testid="learning-coming-soon-sections" />
        ) : (
          <>
            <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <div className="min-w-0 space-y-4">
                <ProgressStrip state={stats} onRetry={onRetry.stats} />
                <SectionCard title="Continue learning" meta="Pick up where you left off." testid="section-continue"><ContinueLearning state={me} onRetry={onRetry.me} onBrowse={() => onTab('courses')} /></SectionCard>
                <NewThisWeek state={fresh} now={now} onRetry={onRetry.fresh} />
              </div>
              <div className="min-w-0 space-y-4">
                <MyProgramsSection {...programs} />
                <SectionCard title="Upcoming webinars" testid="section-webinars"><HomeWebinarsList state={upcoming} now={now} onRetry={onRetry.upcoming} actions={webinarActions} /></SectionCard>
                <RecommendedFuture />
              </div>
            </div>
          </>
        )}
        <LearningCatalogue
          gated={gated} tab={tab} onTab={onTab} query={query} onQuery={onQuery} q={q}
          catalog={catalog} articles={articles} publications={publications} events={events}
          upcoming={upcoming} past={past} now={now} onCatalogPage={onCatalogPage} onArticlesPage={onArticlesPage} onRetry={onRetry}
          exercises={exercises} exams={exams} onAssessmentPage={onAssessmentPage}
        />

      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// D700 (#1662) — A8m, the page on a phone.
// ---------------------------------------------------------------------------

const BROWSE = [
  { title: 'Courses', tab: 'courses' },
  { title: 'Articles and publications', tab: 'articles' },
  { title: 'Exercises and exams', tab: 'exercises' },
];

/** A8m's Browse: three rows into the tab lists. Gated rows but Articles say "Coming soon". */
export function browseGroup({ gated }) {
  const page = ACCOUNT_PHONE_PAGES.learning;
  return {
    label: page.sections[3],
    testid: 'learning-phone-browse',
    rows: BROWSE.map((b) => ({
      key: b.tab,
      title: b.title,
      description: b.tab === 'exercises' ? 'Your exercises and exams, with your status and best score.' : '',
      pill: gated && b.tab !== 'articles' ? { label: 'Coming soon', tone: 'neutral' } : null,
      to: `/learning?tab=${b.tab}`,
      chevron: true,
      testid: `learning-phone-browse-${b.tab}`,
    })),
    note: gated ? <span data-testid="learning-phone-coming-soon">{COMING_SOON_LINE}</span> : null,
  };
}

/**
 * A8m's sections. A profile the gate holds gets Browse alone, with the
 * coming-soon line, and none of these reads is made for it (decision 10).
 * Everyone else gets Continue learning, My programs and Upcoming webinars
 * first, from the same reads as the desktop's cards.
 */
export function learningPhoneGroups({ gated, me = IDLE, programs = PROGRAMS_IDLE, upcoming = IDLE, fresh = IDLE, now = Date.now(), onRetry = {}, onBrowse, webinarActions = {} }) {
  if (gated) return [browseGroup({ gated })];
  const [continueTitle, , webinarsTitle] = ACCOUNT_PHONE_PAGES.learning.sections;
  const status = (st) => (isLoading(st) ? 'loading' : st.status);

  const cont = { label: continueTitle, rows: [], testid: 'learning-phone-continue' };
  if (status(me) !== 'ready') cont.note = phonePending(status(me), 'Your progress', 'This is not a claim that you have started nothing.', onRetry.me);
  else {
    cont.rows = inProgressCourses(me).slice(0, 1).map((r) => {
      const p = Number(r.percent);
      const has = r.percent !== null && r.percent !== undefined && Number.isFinite(p);
      return { key: `${r.subject_kind}:${r.subject_uid}`, title: r.title || 'Untitled', description: kindLabel(r.subject_kind === 'item' ? r.item_kind : r.subject_kind), value: has ? `${Math.round(p)}%` : 'Started', bar: has ? Math.round(p) : null, to: r.href, testid: 'learning-phone-continue-row' };
    });
    if (!cont.rows.length) cont.note = <span className="block space-y-2"><span className="block">No course in progress.</span><button type="button" className={HOME_SECONDARY} onClick={onBrowse} disabled={!onBrowse} data-testid="learning-browse-courses">Browse courses</button></span>;
  }

  const mine = { label: 'Your programs', rows: [], testid: 'learning-phone-programs' };
  const enrolled = programs.enrolled || IDLE;
  if (status(enrolled) !== 'ready') mine.note = phonePending(status(enrolled), 'Your programs', 'This is not a claim that you are in none.', programs.onRetry?.enrolled);
  else {
    mine.rows = (enrolled.rows || []).map(({ program, detail }) => {
      const progress = detail.status === 'ready' ? programProgress(detail.contents, detail.completion) : null;
      const row = { key: program.uid, title: program.name || 'Untitled program', to: memberProgramHref(program.uid), testid: 'learning-phone-program' };
      if (!progress) {
        const reason = detail.status === 'ready' ? 'The program route sent no completion for you.' : 'Your progress in this program could not be read.';
        return { ...row, description: program.region || '', notRecorded: true, notRecordedReason: reason };
      }
      const pct = progress.total ? Math.round((100 * progress.done) / progress.total) : null;
      return { ...row, description: progressLine(progress), value: pct == null ? '' : `${pct}%`, bar: pct };
    });
    if (!mine.rows.length) mine.note = 'You are not in a program yet. Most programs are by invitation: a Super Admin enrols their members.';
  }

  const programNote = mine.note;
  mine.note = <>{programNote && <span className="block">{programNote}</span>}<OpenPrograms {...programs} /></>;

  const web = { label: webinarsTitle, rows: [], testid: 'learning-phone-webinars' };
  if (status(upcoming) !== 'ready') web.note = phonePending(status(upcoming), 'The upcoming webinars', 'This is not a claim that none is scheduled.', onRetry.upcoming);
  else {
    web.rows = (upcoming.rows || []).slice(0, 3).map((w) => {
      const phase = webinarPhase(w, now);
      const active = !w.registered && !['cancelled', 'past'].includes(phase) && !seatsOf(w).full;
      const error = webinarActions.errors?.[w.uid];
      return { key: w.uid, title: w.title || 'Untitled webinar',
        description: <span><span className="font-mono">{formatWebinarDayTime(w.starts_at) || 'Start not recorded'} · {homeSeatsLine(w)}</span>{error && <span role="alert" className="block text-red-700 dark:text-red-300" data-testid={`home-webinar-error-${w.uid}`}>{error}</span>}</span>,
        value: <HomeWebinarAction row={w} phase={phase} actions={webinarActions} />, to: active ? undefined : w.href || undefined, testid: `home-webinar-${w.uid}` };

    });
    if (!web.rows.length) web.note = 'No webinar scheduled. Webinars HQ schedules appear here, with a way to register.';
  }
  const latest = { label: 'New this week', rows: [], testid: 'learning-phone-new' };
  if (status(fresh) !== 'ready') latest.note = phonePending(status(fresh), 'What is new this week', 'This is not a claim that nothing is new.', onRetry.fresh);
  else {
    latest.rows = newThisWeek(fresh.rows, now).slice(0, 3).map((row) => ({ key: row.key, title: row.title, to: row.href, description: kindLabel(row.kind), value: catalogMeta(row) || 'Length not recorded', testid: 'learning-phone-new-row' }));
    if (!latest.rows.length) latest.note = 'Nothing new this week.';
  }
  return [cont, latest, mine, web, browseGroup({ gated })];
}

/** A8m — the bar and the sections, then `children`: the tab lists Browse opens. */
export function LearningPhoneView({ gated, me, programs, upcoming, fresh, now, onRetry, onTab = () => {}, tab = 'all', webinarActions = {}, children = null }) {
  const page = ACCOUNT_PHONE_PAGES.learning;
  const onBrowse = () => onTab('courses');
  const groups = learningPhoneGroups({ gated, me, programs, upcoming, fresh, now, onRetry, onBrowse, webinarActions });
  return <div className="min-h-screen bg-white dark:bg-gray-950" data-testid="learning-phone" data-phone="true">
    <LearningHero phoneBar={<PhoneBar back={{ label: 'Back' }} title="Learning" eadwynLabel={page.title} />} showArticle={gated} primary={!gated && <HomePhonePrimary state={me} onBrowse={onBrowse} />} />
    <div className="px-4"><TabBar tab={tab} gated={gated} onTab={onTab} /></div>
    <div className="px-4 pt-4 [&>div]:px-0"><PhoneRows groups={groups} /></div>
    {children && <div className="space-y-4 px-4 pb-4">{children}</div>}
  </div>;
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
  const [upcoming, retryUpcoming, setUpcoming] = useLearningRead(() => readWebinars('upcoming'), [], { enabled: !gated, scope: 'webinars-upcoming' });
  const [past, retryPast] = useLearningRead(() => readWebinars('past'), [],
    { enabled: live && tab === 'webinars', scope: 'webinars-past' });
  // #4180: the Exercises and Exams tabs read their own lists, a page at a time.
  const [assessmentOffset, setAssessmentOffset] = useState(0);
  const [exercises, retryExercises] = useLearningRead(() => readExercises({ offset: assessmentOffset }), [assessmentOffset],
    { enabled: live && tab === 'exercises', scope: 'exercises' });
  const [exams, retryExams] = useLearningRead(() => readExams({ offset: assessmentOffset }), [assessmentOffset],
    { enabled: live && tab === 'exams', scope: 'exams' });
  const onAssessmentPage = (step) => setAssessmentOffset((o) => Math.max(0, o + step * ALL_LIMIT));
  const programs = useMyPrograms(!gated);
  const webinarActions = useHomeWebinarRegistration(setUpcoming);
  const now = useNow(60 * 1000);
  // D3726 LR1: New this week reads the catalog's newest rows across every kind.
  const [fresh, retryFresh] = useLearningRead(() => readCatalog({}), [], { enabled: !gated, scope: 'catalog-new' });
  // D3726 LR1: Your progress, from #4180's stats read.
  const [stats, retryStats] = useLearningRead(readMyStats, [], { enabled: !gated, scope: 'me-stats' });

  // A new tab starts from its first page.
  const onTab = useCallback((key) => {
    setPage(0);
    setCatalogOffset(0);
    setAssessmentOffset(0);
    setParams((old) => { const next = new URLSearchParams(old); next.set('tab', key); return next; }, { replace: true });
  }, [setParams]);
  const onCatalogPage = (step) => setCatalogOffset((o) => Math.max(0, o + step * ALL_LIMIT));
  const onArticlesPage = (step) => setPage((p) => Math.max(0, p + step));
  const onRetry = {
    catalog: retryCatalog, article: retryArticles, publication: retryPublications, event: retryEvents, me: retryMe,
    upcoming: retryUpcoming, past: retryPast, exercises: retryExercises, exams: retryExams, fresh: retryFresh, stats: retryStats,
  };
  // The Learning home has no AI rail; the shared frame keeps its body layout.
  const phone = usePhoneWidth();

  return (
    <RailFrame data-testid="learning-home">
      {phone ? (
        <LearningPhoneView gated={gated} me={me} programs={programs} upcoming={upcoming} fresh={fresh} now={now} onRetry={onRetry} onTab={onTab} tab={tab} webinarActions={webinarActions}>
          <AdminLinks links={links} />
          {!gated && <WriteArticleLink secondary />}
          <LearningCatalogue
            showTabs={false} gated={gated} tab={tab} onTab={onTab} query={query} onQuery={setQuery} q={q}
            catalog={catalog} articles={articles} publications={publications} events={events}
            upcoming={upcoming} past={past} now={now} onCatalogPage={onCatalogPage} onArticlesPage={onArticlesPage} onRetry={onRetry}
            exercises={exercises} exams={exams} onAssessmentPage={onAssessmentPage}
          />
        </LearningPhoneView>
      ) : (
        <div className="min-w-0">
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
            webinarActions={webinarActions}
            past={past}
            programs={programs}
            now={now}
            fresh={fresh}
            stats={stats}
            onCatalogPage={onCatalogPage}
            onArticlesPage={onArticlesPage}
            onRetry={onRetry}
            links={links}
            exercises={exercises}
            exams={exams}
            onAssessmentPage={onAssessmentPage}
          />
        </div>
      )}
    </RailFrame>
  );
}
