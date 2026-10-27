/**
 * D1295 (#3391, part 5 of #2383) — Pipeline's words and rules, from the
 * owner's canvas "Content queue" (ART1–ART6, ART13–ART17). Pure, so
 * `frontend/test/content_queue_pipeline_d1295.test.mjs` holds each rule
 * without a router.
 *
 * The reads are D1291's queue (`GET /api/admin/articles/queue`: stages,
 * counts, total, search, filters, sort, paging) and the article read with
 * D1292's `approved_by` and D1293's drawer data. Nothing here decides who may
 * act: the Worker refuses, and these rules only decide what to offer.
 */

import { localInputValue, publishAtFromLocal, utcLabel } from '../articlePublishAt';

export { utcLabel };

/** The seven stages, in the board's order (D1291 §1). `approved` is Ready or Scheduled by its time. */
export const STAGES = Object.freeze([
  { key: 'submitted', label: 'Submitted', dot: 'bg-sky-500' },
  { key: 'in_review', label: 'In review', dot: 'bg-amber-500' },
  { key: 'changes_requested', label: 'Changes requested', dot: 'bg-slate-500' },
  { key: 'ready', label: 'Ready to publish', dot: 'bg-emerald-500' },
  { key: 'scheduled', label: 'Scheduled', dot: 'bg-violet-600' },
  { key: 'published', label: 'Published', dot: 'bg-slate-900 dark:bg-slate-100' },
  { key: 'rejected', label: 'Rejected', dot: 'bg-red-700' },
]);
export const STAGE_LABEL = Object.freeze(Object.fromEntries(STAGES.map((s) => [s.key, s.label])));
/** The board's columns: the open stages. Published and Rejected are the list's. */
export const BOARD_STAGES = Object.freeze(['submitted', 'in_review', 'changes_requested', 'ready', 'scheduled']);

/** An article's stage from its row: the Worker's `stage`, else its status, split as D1291 does. */
export function stageOf(a) {
  if (!a) return null;
  if (a.stage && STAGE_LABEL[a.stage]) return a.stage;
  if (a.status === 'approved') return a.publish_at ? 'scheduled' : 'ready';
  return STAGE_LABEL[a.status] ? a.status : null;
}

/** A stored timestamp, ISO or SQL form, as a Date, or null. */
export function when(at) {
  if (!at) return null;
  const s = String(at);
  const d = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const DAY = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const DAY_TIME = (d) => `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC`;

/** How long, in words: "4 days", "9 hours", "under an hour". */
export function ageText(hours) {
  if (hours == null || !Number.isFinite(hours)) return null;
  if (hours < 1) return 'under an hour';
  if (hours < 48) return `${Math.floor(hours)} ${Math.floor(hours) === 1 ? 'hour' : 'hours'}`;
  const d = Math.floor(hours / 24);
  return `${d} days`;
}

/** The card's and the row's "Waiting or due" line for one article. Never a guessed date. */
export function waitText(a, now = Date.now()) {
  const stage = stageOf(a);
  const since = (at) => { const d = when(at); return d ? ageText((now - d.getTime()) / 3_600_000) : null; };
  switch (stage) {
    case 'submitted': { const w = since(a.submitted_at); return w ? `Waiting ${w}` : 'Waiting · submitted time not recorded'; }
    case 'in_review': return a.reviewer_name ? `Reviewer: ${a.reviewer_name}` : 'In review · reviewer not recorded';
    case 'changes_requested': return 'With the author';
    case 'ready': { const d = when(a.approved_at); return d ? `Approved ${DAY(d)}` : 'Approved · date not recorded'; }
    case 'scheduled': { const d = when(a.publish_at || a.goes_out); return d ? `Goes out ${DAY_TIME(d)}` : 'Scheduled · time not recorded'; }
    case 'published': { const d = when(a.published_at || a.goes_out); return d ? `Published ${DAY(d)}` : 'Published · date not recorded'; }
    case 'rejected': return 'Rejected';
    default: return 'Not recorded';
  }
}

/** One stage's count and its oldest wait, from D1291's `counts` block; an unreadable block says so, never 0. */
export function countOf(counts, stage) {
  if (!counts || counts.available === false || !counts.stages) return { readable: false, text: 'Could not be read' };
  const s = counts.stages[stage];
  if (!s) return { readable: false, text: 'Not recorded' };
  return { readable: true, count: Number(s.count) || 0, oldest: s.oldest_hours != null ? `oldest ${ageText(s.oldest_hours)}` : null, reason: s.oldest_reason || null };
}

/* ------------------------------------------------------------------ *
 * The list (ART2): search, filters, sort and paging live in the address
 * ------------------------------------------------------------------ */

export const SORTS = Object.freeze([
  { key: 'waiting', label: 'Waiting longest first' },
  { key: 'newest', label: 'Newest submitted' },
  { key: 'goes_out', label: 'Goes out soonest' },
  { key: 'rounds', label: 'Most rounds' },
  { key: 'title', label: 'Title, A to Z' },
]);
export const LIST_STAGES = Object.freeze([
  { key: 'open', label: 'Open' },
  ...STAGES.map((s) => ({ key: s.key, label: s.label })),
  { key: 'all', label: 'Every stage' },
]);
export const PAGE_SIZES = Object.freeze([20, 50, 100]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The list's state from the address's search string. A value the read would refuse is left out, never guessed. */
export function listStateOf(search) {
  const p = new URLSearchParams(search || '');
  const s = { view: p.get('view') === 'list' ? 'list' : 'board' };
  const q = (p.get('q') || '').trim();
  s.q = q.slice(0, 120);
  s.stage = LIST_STAGES.some((x) => x.key === p.get('stage')) ? p.get('stage') : 'open';
  s.sort = SORTS.some((x) => x.key === p.get('sort')) ? p.get('sort') : 'waiting';
  for (const k of ['author', 'reviewer']) s[k] = /^[1-9]\d{0,15}$/.test(p.get(k) || '') ? p.get(k) : '';
  s.sector = (p.get('sector') || '').slice(0, 80);
  for (const k of ['submitted_from', 'submitted_to']) s[k] = DATE.test(p.get(k) || '') ? p.get(k) : '';
  s.open_comments = p.get('open_comments') === '1' ? '1' : '';
  s.size = PAGE_SIZES.includes(Number(p.get('size'))) ? Number(p.get('size')) : 20;
  s.page = /^[1-9]\d{0,5}$/.test(p.get('page') || '') ? Number(p.get('page')) : 1;
  return s;
}

/** The address for a list state: only what differs from the defaults, so a plain list is `?view=list`. */
export function searchOf(s) {
  const p = new URLSearchParams();
  if (s.view === 'list') p.set('view', 'list');
  if (s.q) p.set('q', s.q);
  if (s.stage && s.stage !== 'open') p.set('stage', s.stage);
  for (const k of ['author', 'sector', 'reviewer', 'submitted_from', 'submitted_to', 'open_comments']) if (s[k]) p.set(k, s[k]);
  if (s.sort && s.sort !== 'waiting') p.set('sort', s.sort);
  if (s.size && s.size !== 20) p.set('size', String(s.size));
  if (s.page && s.page > 1) p.set('page', String(s.page));
  const out = p.toString();
  return out ? `?${out}` : '';
}

/** The queue read's parameters for a list state (D1291 §2). Empty values are left out by the client. */
export function queueParams(s) {
  return {
    stage: s.stage || 'open', q: s.q || undefined, author: s.author || undefined, sector: s.sector || undefined,
    reviewer: s.reviewer || undefined, submitted_from: s.submitted_from || undefined, submitted_to: s.submitted_to || undefined,
    open_comments: s.open_comments || undefined, sort: s.sort || 'waiting', limit: s.size || 20, offset: ((s.page || 1) - 1) * (s.size || 20),
  };
}

/** How many filters narrow the list (search and stage aside), for "Clear all". */
export const activeFilters = (s) => ['author', 'sector', 'reviewer', 'submitted_from', 'submitted_to', 'open_comments'].filter((k) => s[k]).length;

/** "1–20 of 46", or "0 of 0" never: an empty page says how many match. */
export function rangeText(total, s) {
  const t = Number(total);
  if (!Number.isFinite(t)) return 'Total not recorded';
  if (t === 0) return 'No articles match';
  const from = ((s.page || 1) - 1) * (s.size || 20) + 1;
  if (from > t) return `Past the end · ${t} match`;
  return `${from}–${Math.min(t, from + (s.size || 20) - 1)} of ${t}`;
}
export const pageCount = (total, size) => Math.max(1, Math.ceil((Number(total) || 0) / (size || 20)));

/** The filters' choices from the rows a read returned: authors and sectors by what is there. */
export function choicesOf(items) {
  const authors = new Map(); const sectors = new Set();
  for (const r of items || []) {
    if (r.author_user_id && r.author_name) authors.set(String(r.author_user_id), r.author_name);
    if (r.sector) sectors.add(r.sector);
  }
  return {
    authors: [...authors.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    sectors: [...sectors].sort(),
  };
}

/* ------------------------------------------------------------------ *
 * The drawer (ART3–ART5)
 * ------------------------------------------------------------------ */

export const DRAWER_TABS = Object.freeze([
  { key: 'article', label: 'Article' },
  { key: 'comments', label: 'Comments' },
  { key: 'revisions', label: 'Revisions' },
  { key: 'details', label: 'Details' },
]);

/** The article's paragraphs, in order, for paragraph comments: each a `¶ n` and its first words. */
export function paragraphsOf(markdown) {
  return String(markdown || '').split(/\n\s*\n/).map((b) => b.trim()).filter((b) => b && !/^```/.test(b))
    .map((b, i) => ({ n: i + 1, text: b.replace(/^#{1,6}\s+/, '').replace(/[*_`>]/g, '').replace(/\s+/g, ' ').trim() }));
}

/** A paragraph comment's anchor, as the author's editor shows it (`anchor`, at most 120 characters). */
export function anchorFor(p) {
  if (!p) return null;
  const words = p.text.length > 60 ? `${p.text.slice(0, 60).replace(/\s+\S*$/, '')}…` : p.text;
  return `¶ ${p.n}: “${words}”`.slice(0, 120);
}

/** Threads: each first comment with its replies under it, in order (D1293: one level). */
export function threadsOf(comments) {
  const list = Array.isArray(comments) ? comments : [];
  const replies = new Map();
  for (const c of list) if (c.parent_id) replies.set(c.parent_id, [...(replies.get(c.parent_id) || []), c]);
  return list.filter((c) => !c.parent_id).map((c) => ({ ...c, replies: replies.get(c.id) || [] }));
}

/**
 * Two texts compared line by line: each line `same`, `removed` or `added`,
 * in reading order (a longest-common-subsequence walk, so a moved paragraph
 * reads as removed then added rather than as a guess).
 */
export function compareLines(before, after) {
  const a = String(before || '').split('\n'); const b = String(after || '').split('\n');
  const n = a.length; const m = b.length;
  if (n * m > 400_000) return [...a.map((t) => ({ kind: 'removed', text: t })), ...b.map((t) => ({ kind: 'added', text: t }))];
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0; let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ kind: 'same', text: a[i] }); i += 1; j += 1; } else if (L[i + 1][j] >= L[i][j + 1]) { out.push({ kind: 'removed', text: a[i] }); i += 1; } else { out.push({ kind: 'added', text: b[j] }); j += 1; }
  }
  while (i < n) { out.push({ kind: 'removed', text: a[i] }); i += 1; }
  while (j < m) { out.push({ kind: 'added', text: b[j] }); j += 1; }
  return out;
}

/* ------------------------------------------------------------------ *
 * The actions (ART3's footer, ART6's dialogs, ART16's Admin view)
 * ------------------------------------------------------------------ */

/** Whether the viewer wrote the article: D1292's self-approval rule turns on it. */
export const ownArticle = (article, viewer) => Boolean(article?.author_user_id && viewer?.userId && Number(article.author_user_id) === Number(viewer.userId));

/**
 * What the drawer's footer offers for an article and a viewer. The Worker
 * refuses anything else; this decides only what is offered:
 *   · approve, publish and schedule on one's own article become `approve_self`
 *     and `publish_self` (a Super Admin, with a reason), or `own_note` (an
 *     Admin: "You wrote this", nothing to press);
 *   · Feature is a Super Admin's, on a published article (owner question 4).
 */
export function actionsFor(article, viewer) {
  const stage = stageOf(article);
  const own = ownArticle(article, viewer);
  const sa = Boolean(viewer?.superAdmin);
  const decide = (k) => (own ? (sa ? `${k}_self` : null) : k);
  let out = [];
  if (stage === 'submitted') out = ['start', 'request', decide('approve'), 'reject'];
  else if (stage === 'in_review') out = ['request', decide('approve'), 'reject'];
  else if (stage === 'ready') out = [own ? null : 'schedule', decide('publish')];
  else if (stage === 'scheduled') out = [own ? null : 'schedule', 'clear', decide('publish')];
  else if (stage === 'published') out = ['unpublish', sa ? (article.featured_at ? 'unfeature' : 'feature') : null];
  out = [...new Set(out.filter(Boolean))];
  const blocked = own && !sa && ['submitted', 'in_review', 'ready', 'scheduled'].includes(stage);
  return blocked ? [...out, 'own_note'] : out;
}

export const ACTION_LABELS = Object.freeze({
  start: 'Start review…', request: 'Request changes…', approve: 'Approve…', approve_self: 'Approve anyway…', reject: 'Reject…',
  schedule: 'Schedule…', clear: 'Clear time…', publish: 'Publish now…', publish_self: 'Publish anyway…',
  unpublish: 'Unpublish…', feature: 'Feature on Articles…', unfeature: 'Stop featuring…',
});

/** "You wrote this": the Admin's view of their own article (ART16, D1292 §2). */
export const OWN_NOTE = Object.freeze({
  title: 'You wrote this',
  line: 'A second admin approves an author’s own article. It stays where it is until another admin decides.',
});

/** Each dialog's words (ART6, 560 wide). `reason` is the text the author reads, at least 8 characters. */
export function dialogFor(kind, article) {
  const t = article?.title || 'this article';
  const who = article?.author_name || 'The author';
  const D = {
    start: { title: `Start reviewing “${t}”?`, line: 'Starting the review makes you the reviewer. It moves to In review.', confirm: 'Start review', done: 'Recorded: review started by you.' },
    approve: { title: `Approve “${t}”?`, line: `It moves to Ready to publish. ${who} is told. Set a time or publish it next.`, confirm: 'Approve', done: 'Recorded: approved by you, now.' },
    approve_self: {
      title: 'Approve your own article anyway?', line: 'A second admin approves an author’s own article. As Super Admin you can approve it without one; your reason is recorded with the approval.',
      reason: { label: 'Why approve it without a second admin?', hint: 'At least 8 characters. Kept on the audit record.' }, confirm: 'Approve anyway', danger: true,
      done: 'Recorded: approved by you without a second admin, with your reason.',
    },
    request: {
      title: `Request changes to “${t}”`, line: `It goes back to ${who}, who reads your note in their editor.`,
      reason: { label: 'What should change?', hint: 'At least 8 characters. The author reads this.' }, confirm: 'Send request', done: 'Recorded: changes requested by you, with your note.',
    },
    reject: {
      title: `Reject “${t}”?`, line: `${who} is told it was rejected, with your reason. It leaves the queue.`,
      reason: { label: 'Why is it rejected?', hint: 'At least 8 characters. The author reads this.' }, confirm: 'Reject', danger: true, done: 'Recorded: rejected by you, with your reason.',
    },
    schedule: {
      title: `Schedule “${t}”`, line: 'Pick a time in the future, up to a year ahead. It goes out within a minute of that time.',
      when: true, confirm: 'Schedule', done: `Recorded: scheduled by you. ${who} is told when it goes out.`,
    },
    clear: { title: `Clear the time for “${t}”?`, line: 'It goes back to Ready to publish and waits for Publish.', confirm: 'Clear time', done: 'Recorded: time cleared by you.' },
    publish: { title: `Publish “${t}” now?`, line: `It goes live on the public Articles page at once. ${who} and their followers are told.`, confirm: 'Publish now', done: 'Recorded: published by you, now.' },
    publish_self: {
      title: 'Publish your own article anyway?', line: 'A second admin publishes an author’s own article. As Super Admin you can publish it without one; your reason is recorded.',
      reason: { label: 'Why publish it without a second admin?', hint: 'At least 8 characters. Kept on the audit record.' }, confirm: 'Publish anyway', danger: true,
      done: 'Recorded: published by you without a second admin, with your reason.',
    },
    unpublish: {
      title: `Unpublish “${t}”?`, line: `It leaves the public page at once and goes back to Ready to publish, with no time. ${who} is told it was unpublished, with your reason.`,
      reason: { label: 'Why is it unpublished?', hint: 'At least 8 characters. The author reads this.' }, confirm: 'Unpublish', danger: true, done: 'Recorded: unpublished by you, with your reason.',
    },
    feature: { title: `Feature “${t}” on the public Articles page?`, line: 'It shows first on Articles. Up to three are featured at a time.', confirm: 'Feature', done: 'Recorded: featured by you.' },
    unfeature: { title: `Stop featuring “${t}”?`, line: 'It stays published and leaves the Featured strip.', confirm: 'Stop featuring', done: 'Recorded: no longer featured.' },
    delete_comment: {
      title: 'Delete this comment?', line: 'The author loses it too. This cannot be undone. Resolve keeps it on record instead.',
      confirm: 'Delete', danger: true, done: 'Recorded: comment deleted by you.',
    },
  };
  return D[kind] || null;
}

export const REASON_MIN = 8;
/** A reason is the trimmed text, long enough for the Worker (D1292, D1293). */
export const reasonOk = (text) => String(text || '').trim().length >= REASON_MIN;

/**
 * A time for Schedule: a local date and time (D484's rule, `articlePublishAt.js`:
 * read in this browser's zone, sent as UTC), in the future and at most a
 * year ahead, as UTC ISO; else null.
 */
export function scheduleAt(date, time, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}$/.test(time || '')) return null;
  const iso = publishAtFromLocal(`${date}T${time}`);
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) && ms > now && ms <= now + 366 * 86_400_000 ? iso : null;
}

/** The dialog's date and time, prefilled from a stored time in this browser's zone. */
export function scheduleFields(publishAt) {
  const v = localInputValue(publishAt);
  return v ? { date: v.slice(0, 10), time: v.slice(11, 16) } : { date: '', time: '09:00' };
}

/**
 * A refusal in words. A 409 is a stale click (ART15d): the article moved
 * before it, and nothing else changed. Anything else is the Worker's
 * sentence, or a plain failure; never the error's own text.
 */
export function refusalText(e, movedTo) {
  if (e?.status === 409 && e?.code !== 'featured_full') {
    return movedTo ? `This article moved to ${movedTo} before your click. Nothing else changed.` : 'This article changed before your click. Nothing else changed.';
  }
  const SAID = {
    featured_full: 'Three articles are featured already. Stop featuring one first.',
    self_approval: 'You wrote this article, so another admin must approve and publish it. Nothing was changed.',
    self_approval_reason_required: 'Give a reason to approve your own article. Nothing was changed.',
    reason_too_short: 'The reason needs at least 8 characters. Nothing was changed.',
    super_admin_only: 'Only the Super Admin features articles. Nothing was changed.',
  };
  return SAID[e?.code] || 'That did not go through. Nothing was changed. Try again.';
}

/** The page's states (ART13–ART15): what to say when there is nothing, when it fails, and when a block fails alone. */
export const STATES = Object.freeze({
  none: { title: 'No articles yet.', line: 'When a member sends an article for review, it appears here.' },
  noMatch: { title: 'No articles match these filters.', clear: 'Clear filters', every: 'Search every stage' },
  failed: { title: 'We could not load the queue.', line: 'The rest of the admin still works.', retry: 'Try again' },
  blockFailed: 'Could not be read. This is not a claim that there are none.',
  reading: 'Reading…',
  views: 'Views are one running total per article. Views by day are not recorded yet.',
});

/** ART17b: a member who opens an admin address, in the canvas's words. */
export const NO_PERMISSION = Object.freeze({
  title: 'This page is for studio admins.',
  line: 'If you wrote this article, open it in your writing workspace.',
  action: { label: 'Open my articles', to: '/articles/draft' },
});
