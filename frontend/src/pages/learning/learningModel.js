/**
 * The Learning center's pure half (D562): the tabs, how each live source's
 * real shape becomes a row, and the derivations the presentational components
 * share. No React and no fetch, so a test can read every rule here directly.
 *
 * THREE SOURCES ARE LIVE TODAY, AND EACH IS READ IN THE SHAPE ITS ROUTE SENDS:
 *
 *   articles      `GET /api/articles` (`routes/articles.ts`), `{ items, total }`,
 *                 each item `publicArticleShape`;
 *   publications  `GET /api/market-intel-public/publications`
 *                 (`routes/market_intel_public.ts`), `{ publications }`, each
 *                 `{ slug, title, subtitle, section, published_at }`;
 *   events        `GET /api/public/events` (`routes/events_public.ts`),
 *                 `{ events }`, each `shapeEvent`, upcoming by default.
 *
 * EVERYTHING ELSE WAITS ON A STORE THAT DOES NOT EXIST YET: courses, lessons,
 * videos and progress on #1158, programs on #1159, exercises and exams on
 * #1160, webinars on #1161, video playback on #1162. Those surfaces say so in
 * one line rather than drawing a row.
 */
import { titleCase } from '../../lib/absence';

/** The one line the home's not-live tabs and sections carry (the brief's words). */
export const NOT_LIVE_LINE = 'The course catalogue is not live yet.';

/** The line each deeper surface carries until its store merges. */
export const NOT_LIVE = {
  catalogue: NOT_LIVE_LINE,
  progress: 'Learning progress is not recorded yet.',
  webinars: 'Webinars are not live yet.',
  exercises: 'Exercises are not live yet.',
  exams: 'Exams are not live yet.',
  programs: 'Regional programs are not live yet.',
  studio: 'The learning studio is not live yet.',
};

/** The canvas's nine tabs, in its order. `live` marks the three an existing route fills. */
export const LEARNING_TABS = [
  { key: 'all', label: 'All', live: true },
  { key: 'courses', label: 'Courses', live: false },
  { key: 'videos', label: 'Videos', live: false },
  { key: 'webinars', label: 'Webinars', live: false },
  { key: 'articles', label: 'Articles', live: true },
  { key: 'publications', label: 'Publications', live: true },
  { key: 'events', label: 'Events', live: true },
  { key: 'exercises', label: 'Exercises', live: false },
  { key: 'exams', label: 'Exams', live: false },
];

export const ARTICLES_PAGE_SIZE = 20;
export const EVENTS_PAGE_SIZE = 20;
/** How many rows All draws, the canvas's "1–24". */
export const ALL_LIMIT = 24;

/** Articles for a profile that sees "Coming soon"; All for everyone else. */
export function defaultTab(gated) {
  return gated ? 'articles' : 'all';
}

/** The tab the URL names, or the default when it names none of the nine. */
export function resolveTab(requested, gated) {
  return LEARNING_TABS.some((t) => t.key === requested) ? requested : defaultTab(gated);
}

/**
 * What a tab draws: `live` (its list), `not_live` (the not-recorded line) or
 * `coming_soon` (the card). A gated profile has one open tab, Articles.
 */
export function tabMode(key, gated) {
  if (gated && key !== 'articles') return 'coming_soon';
  return LEARNING_TABS.find((t) => t.key === key)?.live ? 'live' : 'not_live';
}

const clean = (value) => String(value ?? '').trim();

/**
 * An instant from what the routes send: SQLite's UTC text
 * (`2026-10-01 12:00:00`), an ISO string with or without a zone, or a bare
 * date. Text with no zone is UTC, which is what `datetime('now')` writes. Null
 * for anything unparseable, so nothing renders "Invalid Date".
 */
export function parseInstant(value) {
  if (value === null || value === undefined || value === '') return null;
  let s = clean(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s = `${s}T00:00:00Z`;
  else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s = `${s.replace(' ', 'T')}Z`;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

function format(value, options, timeZone) {
  const d = parseInstant(value);
  if (!d) return null;
  try {
    return new Intl.DateTimeFormat('en-GB', { ...options, ...(timeZone ? { timeZone } : {}) }).format(d);
  } catch {
    // A time zone Intl does not know: the reader's own zone, rather than nothing.
    return new Intl.DateTimeFormat('en-GB', options).format(d);
  }
}

/** "6 Oct 2026", or null when there is no date. */
export function formatDay(value, timeZone) {
  return format(value, { day: 'numeric', month: 'short', year: 'numeric' }, timeZone);
}

/** "Sat, 10 Oct 2026, 18:00 CEST": a start time in the zone it was set in. */
export function formatWhen(value, timeZone) {
  return format(value, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short',
  }, timeZone);
}

/** "12 min" or "1 h 05 min"; null for a length that is not a positive number. */
export function durationLabel(seconds) {
  const n = Number(seconds);
  if (seconds === null || seconds === undefined || seconds === '' || !Number.isFinite(n) || n <= 0) return null;
  const minutes = Math.max(1, Math.round(n / 60));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/** "30 min" from a whole-minute column, null when absent. */
export function minutesLabel(minutes) {
  const n = Number(minutes);
  if (minutes === null || minutes === undefined || minutes === '' || !Number.isFinite(n) || n <= 0) return null;
  return durationLabel(n * 60);
}

/** "1–20 of 57" for a page of a list whose route sends a total. */
export function rangeLabel(offset, count, total) {
  if (!count) return null;
  const from = offset + 1;
  const to = offset + count;
  return Number.isFinite(total) ? `${from}–${to} of ${total}` : `${from}–${to}`;
}

// ── The three live sources, read in their routes' own shapes ──────────────

/**
 * One published article (`publicArticleShape`). The reading time is the
 * route's `read_minutes`, drawn only when it is a positive number; a missing
 * author or date is said to be missing rather than left blank.
 */
export function articleRow(a) {
  const minutes = Number(a?.read_minutes);
  return {
    kind: 'article',
    key: `article:${a?.id ?? a?.slug}`,
    title: clean(a?.title) || 'Untitled article',
    href: clean(a?.slug) ? `/articles/${encodeURIComponent(clean(a.slug))}` : null,
    summary: clean(a?.subtitle) || clean(a?.excerpt) || null,
    author: clean(a?.author) || null,
    role: clean(a?.author_role) ? titleCase(a.author_role) : null,
    date: a?.published_at || null,
    readMinutes: Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : null,
  };
}

/**
 * One published publication. The public list carries no file and no size, so
 * a row links to the publication's public page; the PDF stays "not recorded"
 * here (D562 GAPS).
 */
export function publicationRow(p) {
  return {
    kind: 'publication',
    key: `publication:${p?.slug}`,
    title: clean(p?.title) || 'Untitled publication',
    href: clean(p?.slug) ? `/insights/public/${encodeURIComponent(clean(p.slug))}` : null,
    summary: clean(p?.subtitle) || null,
    section: clean(p?.section) ? titleCase(p.section) : null,
    date: p?.published_at || null,
  };
}

/** Where an event happens, from `location_kind` (`virtual`, `physical`, `hybrid`). */
export function eventPlace(e) {
  const where = clean(e?.location_text);
  if (e?.location_kind === 'virtual') return 'Online';
  if (e?.location_kind === 'hybrid') return where ? `${where} and online` : 'In person and online';
  if (e?.location_kind === 'physical') return where || 'In person';
  return where || null;
}

/**
 * One upcoming event (`shapeEvent`). `icsUrl` is the client's own URL builder
 * (`eventsPublic.icsUrl`), passed in so this module imports no client.
 */
export function eventRow(e, icsUrl) {
  const slug = clean(e?.slug);
  return {
    kind: 'event',
    key: `event:${e?.id ?? slug}`,
    title: clean(e?.title) || 'Untitled event',
    href: slug ? `/events/${encodeURIComponent(slug)}` : null,
    summary: clean(e?.summary) || null,
    type: clean(e?.type) ? titleCase(e.type) : null,
    date: e?.starts_at || null,
    timezone: clean(e?.timezone) || null,
    place: eventPlace(e),
    icsHref: slug && typeof icsUrl === 'function' ? icsUrl(slug) : null,
  };
}

/** Whether a row answers a search, for the one list whose route takes no query. */
export function matchesQuery(row, query) {
  const needle = clean(query).toLowerCase();
  if (!needle) return true;
  return [row.title, row.summary, row.section].some((v) => String(v ?? '').toLowerCase().includes(needle));
}

const KIND_LABEL = { article: 'Article', publication: 'Publication', event: 'Event' };
export const kindLabel = (kind) => KIND_LABEL[kind] || titleCase(kind);

/**
 * All: the three live lists as one, newest date first, each row keeping its
 * kind. A source that is still loading or could not be read is named rather
 * than folded in as empty, so a failed read never reads as "nothing published".
 */
export function combineAll(sources, limit = ALL_LIMIT) {
  const rows = [];
  const loading = [];
  const unreadable = [];
  for (const [kind, state] of Object.entries(sources)) {
    if (!state || state.status === 'loading') loading.push(kind);
    else if (state.status === 'unreadable') unreadable.push(kind);
    else if (state.status === 'ready') rows.push(...(state.rows || []));
  }
  const stamp = (row) => parseInstant(row.date)?.getTime() ?? -Infinity;
  rows.sort((a, b) => stamp(b) - stamp(a));
  return { rows: rows.slice(0, limit), count: rows.length, loading, unreadable };
}

// ── Shared by the presentational components (planned shapes, #1158–#1162) ──

/** The five lesson kinds `learning_lessons.kind` allows (#1158). */
export const LESSON_KINDS = ['video', 'reading', 'exercise', 'exam', 'webinar'];
export const lessonKindLabel = (kind) => (LESSON_KINDS.includes(kind) ? titleCase(kind) : 'Lesson');

/**
 * Where a lesson opens. A video or reading plays in the lesson player; an
 * exercise, exam or webinar lesson points at its own page through `ref_uid`.
 */
export function lessonHref(courseSlug, lesson) {
  const slug = clean(courseSlug);
  if (!lesson) return null;
  if (lesson.kind === 'exercise' || lesson.kind === 'exam' || lesson.kind === 'webinar') {
    const ref = clean(lesson.ref_uid);
    return ref ? `/learning/${lesson.kind}s/${encodeURIComponent(ref)}` : null;
  }
  const uid = clean(lesson.uid);
  return slug && uid ? `/learning/courses/${encodeURIComponent(slug)}/${encodeURIComponent(uid)}` : null;
}

export const lessonDone = (lesson) => lesson?.progress?.status === 'completed';

/** Lessons in their stored order. */
export const byPosition = (rows) => [...(rows || [])].sort((a, b) => (Number(a?.position) || 0) - (Number(b?.position) || 0));

/**
 * A module's length is the sum of its lessons' lengths, and only when every
 * lesson has one: a sum over the lessons that happen to be timed would be a
 * shorter number presented as the whole.
 */
export function totalSeconds(lessons) {
  const list = lessons || [];
  if (!list.length) return null;
  let sum = 0;
  for (const l of list) {
    const n = Number(l?.duration_seconds);
    if (l?.duration_seconds === null || l?.duration_seconds === undefined || !Number.isFinite(n) || n <= 0) return null;
    sum += n;
  }
  return sum;
}

/**
 * The course's progress from the same ticks the outline draws, so the summary
 * can never disagree with the rows under it.
 */
export function courseProgress(modules) {
  const lessons = (modules || []).flatMap((m) => m?.lessons || []);
  const done = lessons.filter(lessonDone).length;
  return { done, total: lessons.length, percent: lessons.length ? Math.round((done / lessons.length) * 100) : null };
}

/** How long before a webinar's start its join link may show (#1161). */
export const JOIN_LEAD_MS = 15 * 60 * 1000;

/**
 * Where a webinar stands: `cancelled`, `upcoming`, `live`, `past`, or
 * `unknown` when a time it needs is not recorded.
 */
export function webinarPhase(webinar, now) {
  if (webinar?.status === 'cancelled') return 'cancelled';
  const start = parseInstant(webinar?.starts_at);
  const end = parseInstant(webinar?.ends_at);
  const t = Number(now);
  if (!start || !Number.isFinite(t)) return 'unknown';
  if (t < start.getTime()) return 'upcoming';
  if (!end) return 'unknown';
  return t < end.getTime() ? 'live' : 'past';
}

/**
 * Whether the join link may show: the server sends `join_url` only to a
 * registered member inside the window, and the page re-checks the window so a
 * link read earlier is not offered after the event has ended.
 */
export function joinWindowOpen(webinar, now) {
  const start = parseInstant(webinar?.starts_at);
  const end = parseInstant(webinar?.ends_at);
  const t = Number(now);
  if (!start || !end || !Number.isFinite(t)) return false;
  return t >= start.getTime() - JOIN_LEAD_MS && t < end.getTime();
}

/** Seconds left on an exam attempt, or null for an exam with no time limit. */
export function secondsLeft(attempt, exam, now) {
  const start = parseInstant(attempt?.started_at);
  const limit = Number(exam?.time_limit_minutes);
  if (!start || !Number.isFinite(limit) || limit <= 0 || !Number.isFinite(Number(now))) return null;
  return Math.max(0, Math.floor((start.getTime() + limit * 60000 - Number(now)) / 1000));
}

/** "23:48" for a count of seconds. */
export function formatClock(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Attempts left, or null when the exam records no limit. Never below zero. */
export function attemptsLeft(exam, attempts) {
  const max = Number(exam?.max_attempts);
  if (exam?.max_attempts === null || exam?.max_attempts === undefined || !Number.isFinite(max)) return null;
  return Math.max(0, max - (attempts || []).length);
}

/** `learning_exercise_submissions.status` (#1160), as a label and a pill tone. */
export const SUBMISSION_STATUS = {
  submitted: { label: 'Submitted', tone: 'info' },
  accepted: { label: 'Accepted', tone: 'ok' },
  needs_work: { label: 'Needs work', tone: 'warn' },
};

/** A content row's status, as a pill tone. */
export const CONTENT_STATUS_TONE = { published: 'ok', draft: 'warn', archived: 'neutral', cancelled: 'danger' };

/**
 * One cell of the members-against-content matrix (#1159): a tick for done, the
 * best score for an exam, the review status for an exercise, the percent for
 * something started, and a dash for a member who never opened it. A cell the
 * route marks `unavailable` (a store that is not there yet) says so instead.
 */
export function learnerCell(cell, kind) {
  if (cell?.unavailable) return { mark: 'Not recorded', tone: 'absent', label: 'Not recorded' };
  if (kind === 'exam' && cell && cell.score_percent !== null && cell.score_percent !== undefined && Number.isFinite(Number(cell.score_percent))) {
    const passed = cell.passed === true || cell.passed === 1;
    return { mark: `${Math.round(Number(cell.score_percent))}%`, tone: passed ? 'ok' : 'warn', label: `Best score ${Math.round(Number(cell.score_percent))}%${passed ? ', passed' : ''}` };
  }
  if (kind === 'exercise' && cell?.submission_status && SUBMISSION_STATUS[cell.submission_status]) {
    const s = SUBMISSION_STATUS[cell.submission_status];
    return { mark: s.label, tone: s.tone, label: s.label };
  }
  if (cell?.status === 'completed') return { mark: '✓', tone: 'ok', label: 'Completed' };
  if (cell?.status === 'started') {
    const p = Number(cell.percent);
    return Number.isFinite(p) && cell.percent !== null && cell.percent !== undefined
      ? { mark: `${Math.round(p)}%`, tone: 'neutral', label: `Started, ${Math.round(p)}%` }
      : { mark: 'Started', tone: 'neutral', label: 'Started' };
  }
  return { mark: '—', tone: 'none', label: 'Not started' };
}
