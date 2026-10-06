/**
 * The Learning center's pure half (D562): the tabs, how each live source's
 * real shape becomes a row, and the derivations the presentational components
 * share. No React and no fetch, so a test can read every rule here directly.
 *
 * EACH LIVE SOURCE IS READ IN THE SHAPE ITS ROUTE SENDS:
 *
 *   catalog       `GET /api/learning/catalog` (`routes/learning.ts`, D557),
 *                 `{ items, sources, limit, offset }`: courses, videos and
 *                 readings with articles, publications and events, and each
 *                 source's own state;
 *   courses, items, progress  `GET /api/learning/courses/:slug`,
 *                 `/items/:uid`, `/me` and `POST /progress` (D557);
 *   articles      `GET /api/articles` (`routes/articles.ts`), `{ items, total }`,
 *                 each item `publicArticleShape`;
 *   publications  `GET /api/market-intel-public/publications`
 *                 (`routes/market_intel_public.ts`), `{ publications }`, each
 *                 `{ slug, title, subtitle, section, published_at }`;
 *   events        `GET /api/public/events` (`routes/events_public.ts`),
 *                 `{ events }`, each `shapeEvent`, upcoming by default.
 *
 * THE REST WAITS ON A STORE THAT DOES NOT EXIST YET: programs on #1159,
 * exercises and exams on #1160, webinars on #1161, playback of an uploaded
 * video on #1162. Those surfaces say so in one line rather than drawing a row.
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

/**
 * The canvas's nine tabs, in its order. `live` marks the ones a route fills:
 * All, Courses and Videos read D557's catalog; Articles, Publications and
 * Events their own routes. The other three wait on their stores.
 */
export const LEARNING_TABS = [
  { key: 'all', label: 'All', live: true },
  { key: 'courses', label: 'Courses', live: true },
  { key: 'videos', label: 'Videos', live: true },
  { key: 'webinars', label: 'Webinars', live: false },
  { key: 'articles', label: 'Articles', live: true },
  { key: 'publications', label: 'Publications', live: true },
  { key: 'events', label: 'Events', live: true },
  { key: 'exercises', label: 'Exercises', live: false },
  { key: 'exams', label: 'Exams', live: false },
];

/** The line each tab that waits on a store says, and the store it waits on. */
export const TAB_NOT_LIVE = {
  webinars: NOT_LIVE.webinars,
  exercises: NOT_LIVE.exercises,
  exams: NOT_LIVE.exams,
};

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

const KIND_LABEL = {
  course: 'Course', video: 'Video', reading: 'Reading', article: 'Article', publication: 'Publication', event: 'Event',
};
export const kindLabel = (kind) => KIND_LABEL[kind] || titleCase(kind);

// ── The federated catalog (D557, `GET /api/learning/catalog`) ─────────────

/** The six kinds the catalog reads, in its own order. */
export const CATALOG_KINDS = ['course', 'video', 'reading', 'article', 'publication', 'event'];

/** The tab a catalog kind belongs to, and back: All reads every kind. */
export const TAB_KIND = { courses: 'course', videos: 'video' };

/** Where a standalone item opens: a video at its own route, a reading at the catalog's. */
export function itemHref(item) {
  const uid = clean(item?.uid ?? item?.id);
  if (!uid) return null;
  return item?.kind === 'video' ? `/learning/videos/${encodeURIComponent(uid)}` : `/learning/items/${encodeURIComponent(uid)}`;
}

/**
 * One catalog row, from the shape `readKind` returns: `kind`, `id` (a uid
 * for an item, a slug otherwise), `title`, `summary`, `date`, plus the
 * fields each kind adds. The href is built here from the id, so a video opens
 * `/learning/videos/:uid` (the route this app serves; the catalog's own href
 * for an item is `/learning/items/:uid`, which it also serves). A row whose
 * status is not `published` is the Super Admin's draft, and says so.
 */
export function catalogRow(r) {
  const id = clean(r?.id);
  const enc = encodeURIComponent;
  const base = {
    kind: r?.kind,
    key: `${r?.kind}:${id}`,
    title: clean(r?.title) || 'Untitled',
    summary: clean(r?.summary) || null,
    date: r?.date || null,
    draft: r?.status && r.status !== 'published' ? titleCase(r.status) : null,
  };
  const level = clean(r?.level) ? titleCase(r.level) : null;
  switch (r?.kind) {
    case 'course':
      return { ...base, href: id ? `/learning/courses/${enc(id)}` : null, level, minutes: r.estimated_minutes ?? null };
    case 'video':
    case 'reading':
      return { ...base, href: itemHref({ kind: r.kind, uid: id }), level, topic: clean(r.topic) || null, seconds: r.duration_seconds ?? null };
    case 'article': {
      const minutes = Number(r.read_minutes);
      return {
        ...base, href: id ? `/articles/${enc(id)}` : null,
        author: clean(r.author?.name) || null,
        role: clean(r.author?.role) ? titleCase(r.author.role) : null,
        readMinutes: Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : null,
      };
    }
    case 'publication':
      return { ...base, href: id ? `/insights/public/${enc(id)}` : null, section: clean(r.section) ? titleCase(r.section) : null };
    case 'event':
      return { ...base, href: id ? `/events/${enc(id)}` : null, type: clean(r.event_type) ? titleCase(r.event_type) : null };
    default:
      return { ...base, href: null };
  }
}

/**
 * The catalog's per-source states, named: `ready` with a total,
 * `unreadable` with the route's own reason, or `filtered_out`. A source that
 * failed is never read as an empty list.
 */
export function sourceStates(sources) {
  return CATALOG_KINDS
    .filter((kind) => sources && sources[kind])
    .map((kind) => ({ kind, ...sources[kind] }));
}

// ── Items: how a video plays (D557's allow-list; an uploaded file, D561) ──

const YOUTUBE_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com'];
const VIDEO_ID = /^[\w-]{6,32}$/;
const STREAM_ID = /^[a-f0-9]{32}$/i;

/** The one address an item's uploaded file plays from: D561's gated route for that item. */
export const itemStreamPath = (uid) => `/api/learning/items/${encodeURIComponent(clean(uid))}/video`;

/**
 * How a video item plays here. `{ src, embed: true }` is an iframe in the
 * platform's own embed form; `{ src, embed: false }` is an uploaded file in
 * the browser's own player; `{ reason, href }` is a video this page cannot
 * play, with the reason and, for a link, the link itself.
 *
 *   - An uploaded file (D561) plays from `video_stream_url`, which the item
 *     read sends in place of any bucket address: the path of `GET
 *     /api/learning/items/:uid/video`. That route asks the same question as
 *     the item read, takes the session cookie and answers HTTP Range, so a
 *     same-origin `<video src>` plays it and can seek. Only that route, for
 *     this item, is played: any other address is refused with its reason. An
 *     upload whose read sent no address is "Not recorded", with the reason.
 *   - YouTube (`watch?v=`, `youtu.be/`, `/embed/`, `/shorts/`, `/live/`) →
 *     `www.youtube-nocookie.com/embed/<id>`;
 *   - Vimeo (`vimeo.com/<id>`, `player.vimeo.com/video/<id>`) →
 *     `player.vimeo.com/video/<id>`;
 *   - Cloudflare Stream (`<customer>.cloudflarestream.com/<id>`,
 *     `videodelivery.net/<id>`) → the `iframe` player for that id.
 */
export function videoPlayback(item) {
  if (!item || item.kind !== 'video') return null;
  const stream = clean(item.video_stream_url);
  if (stream) {
    // A query string (a version, say) may follow; the path is what decides.
    if (stream.split(/[?#]/)[0] === itemStreamPath(item.uid)) return { src: stream, embed: false };
    return { reason: 'The stream address sent with this video is not this item’s own, so it is not played here.' };
  }
  if (item.video_source === 'r2') {
    return { reason: 'This video was uploaded, but the page was not sent an address to stream it from.' };
  }
  const raw = clean(item.video_url);
  if (!raw) return { reason: 'No video link is recorded for this item.' };
  let u;
  try { u = new URL(raw); } catch { return { reason: 'The video link cannot be read.' }; }
  if (u.protocol !== 'https:') return { reason: 'The video link is not https, so it is not played here.' };
  const host = u.hostname.toLowerCase();
  const segments = u.pathname.split('/').filter(Boolean);
  const embed = (src) => ({ src, embed: true });
  if (YOUTUBE_HOSTS.includes(host)) {
    const id = u.pathname === '/watch' ? u.searchParams.get('v')
      : ['embed', 'shorts', 'live'].includes(segments[0]) ? segments[1] : null;
    if (id && VIDEO_ID.test(id)) return embed(`https://www.youtube-nocookie.com/embed/${id}`);
  }
  if (host === 'youtu.be' && segments[0] && VIDEO_ID.test(segments[0])) {
    return embed(`https://www.youtube-nocookie.com/embed/${segments[0]}`);
  }
  if ((host === 'vimeo.com' || host === 'www.vimeo.com') && /^\d+$/.test(segments[0] || '')) {
    return embed(`https://player.vimeo.com/video/${segments[0]}`);
  }
  if (host === 'player.vimeo.com' && segments[0] === 'video' && /^\d+$/.test(segments[1] || '')) {
    return embed(`https://player.vimeo.com/video/${segments[1]}`);
  }
  if (host.endsWith('.cloudflarestream.com') && STREAM_ID.test(segments[0] || '')) {
    return embed(`https://${host}/${segments[0]}/iframe`);
  }
  if (host === 'videodelivery.net' && STREAM_ID.test(segments[0] || '')) {
    return embed(`https://iframe.videodelivery.net/${segments[0]}`);
  }
  return { reason: 'This link cannot be played on this page.', href: u.toString() };
}

// ── Courses and lessons, from `GET /api/learning/courses/:slug` ──────────────

/** Every lesson of a course, in module order then lesson order, with its module. */
export function courseLessons(modules) {
  return byPosition(modules).flatMap((m) => byPosition(m?.lessons).map((l) => ({ ...l, module: m })));
}

/** One lesson of a course, with the lessons either side of it. */
export function findLesson(modules, uid) {
  const all = courseLessons(modules);
  const at = all.findIndex((l) => l.uid === uid);
  if (at < 0) return null;
  return { lesson: all[at], index: at, total: all.length, prev: all[at - 1] || null, next: all[at + 1] || null };
}

// ── The studio's helpers ──────────────────────────────────────────────────

/**
 * A length typed as `12` (minutes) or `12:05` (minutes and seconds), as whole
 * seconds. `null` for an empty field; `undefined` for one that is not a length.
 */
export function parseLength(value) {
  const s = clean(value);
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s) * 60;
  const m = /^(\d+):([0-5]\d)$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}

/** Whole seconds as the studio's `m:ss`, or '' when there is none. */
export function formatLength(seconds) {
  const n = Number(seconds);
  if (seconds === null || seconds === undefined || seconds === '' || !Number.isFinite(n) || n < 0) return '';
  return `${Math.floor(n / 60)}:${String(Math.round(n % 60)).padStart(2, '0')}`;
}

/**
 * A complete order with one uid moved a step up (-1) or down (+1), as the
 * reorder routes take it; null when it is already at that end.
 */
export function moveInOrder(uids, uid, step) {
  const at = uids.indexOf(uid);
  const to = at + step;
  if (at < 0 || to < 0 || to >= uids.length) return null;
  const next = [...uids];
  [next[at], next[to]] = [next[to], next[at]];
  return next;
}

// ── Shared by the presentational components (planned shapes, #1158–#1162) ──

/** The five lesson kinds `learning_lessons.kind` allows (#1158). */
export const LESSON_KINDS = ['video', 'reading', 'exercise', 'exam', 'webinar'];
export const lessonKindLabel = (kind) => (LESSON_KINDS.includes(kind) ? titleCase(kind) : 'Lesson');

/**
 * Where a lesson opens. A video or reading plays in the lesson player. An
 * exercise or exam lesson points at its own page through `ref_uid`. A webinar
 * lesson names an EVENT by its slug (D557: `checkRef` looks it up in
 * `events`), so it opens the event's page until #1161's webinars exist.
 */
export function lessonHref(courseSlug, lesson) {
  const slug = clean(courseSlug);
  if (!lesson) return null;
  if (lesson.kind === 'webinar') {
    const ref = clean(lesson.ref_uid);
    return ref ? `/events/${encodeURIComponent(ref)}` : null;
  }
  if (lesson.kind === 'exercise' || lesson.kind === 'exam') {
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
