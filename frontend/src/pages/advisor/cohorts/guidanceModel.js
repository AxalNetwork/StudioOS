/**
 * D4813 (#4813, package 2) — the Guidance feed's and composer's decisions, with no React in it.
 *
 *   · STATUS. Published, Draft or Retired, from the Worker's `status` (derived
 *     there from `retired_at` and `is_draft`); a row from before the drafts
 *     migration has no `status` and is published unless retired.
 *   · FILTERS. All, Published, Draft, Retired and Needs response. Needs
 *     response is a founder's question with no answer that is not retired.
 *   · THE WEEK. Checked here with the same rule the Worker enforces, against
 *     the cohort's `week_limit`, so the error shows before a round trip. The
 *     Worker stays the authority and its refusal is shown the same way.
 *   · UNSAVED TEXT IS KEPT PER COHORT. Local storage keyed by cohort and by
 *     the guidance being edited, so switching cohort never erases another
 *     cohort's draft. Every access is wrapped: storage can be absent or throw.
 *   · A WRITE LANDS ONLY ON THE COHORT IT WAS MADE FOR. `guardedWrite` is
 *     `guardedRead`'s twin: a save in flight for cohort A whose answer arrives
 *     after the advisor moved to cohort B is not painted into B's composer.
 */
export const GUIDANCE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'published', label: 'Published' },
  { key: 'draft', label: 'Draft' },
  { key: 'retired', label: 'Retired' },
  { key: 'needs_response', label: 'Needs response' },
];
export const FILTER_PARAM = 'filter';

/** A filter key from the URL, or 'all'. */
export function parseGuidanceFilter(raw) {
  return GUIDANCE_FILTERS.some((f) => f.key === raw) ? raw : 'all';
}

export function guidanceStatusOf(item) {
  if (!item) return 'published';
  if (item.retired_at) return 'retired';
  if (item.status === 'draft' || item.is_draft === true || item.is_draft === 1) return 'draft';
  return 'published';
}

export const needsResponse = (item) => item?.kind === 'question' && !item.answer && guidanceStatusOf(item) !== 'retired';

export function matchesFilter(item, filter) {
  if (filter === 'needs_response') return needsResponse(item);
  if (filter === 'all') return true;
  // Published is what the advisor said; a founder's question is listed under
  // All and, while it waits, under Needs response.
  if (filter === 'published' && item?.kind === 'question') return false;
  return guidanceStatusOf(item) === filter;
}

export function filterGuidance(items, filter) {
  return (items || []).filter((i) => matchesFilter(i, filter));
}

export function filterCounts(items) {
  const out = {};
  for (const f of GUIDANCE_FILTERS) out[f.key] = filterGuidance(items, f.key).length;
  return out;
}

const firstLine = (s) => String(s || '').trim().split(/\r?\n/)[0].trim();
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A title, or the body's first line for a row written before titles existed. */
export function guidanceTitle(item) {
  const t = String(item?.title || '').trim();
  if (t) return clip(t, 120);
  const line = firstLine(item?.body);
  if (line) return clip(line, 80);
  return 'Untitled draft';
}

/** What follows the title: the body, or the rest of it when the title was its first line. */
export function guidancePreview(item, max = 180) {
  const body = String(item?.body || '').trim();
  if (!body) return '';
  const rest = String(item?.title || '').trim() ? body : body.split(/\r?\n/).slice(1).join(' ').trim();
  return clip(rest.replace(/\s+/g, ' '), max);
}

/** The week the composer may name: the Worker's bound, else the same fallback it uses. */
export const WEEK_FALLBACK_MAX = 52;
export function weekMax(guidance) {
  const n = Number(guidance?.week_limit?.max);
  return Number.isInteger(n) && n >= 1 ? n : WEEK_FALLBACK_MAX;
}

/**
 * The Worker's `parseGuidanceWeek`, mirrored. Empty is general guidance;
 * anything else is a whole number from 1 to `max`, or an error in words.
 */
export function validateWeek(raw, max) {
  const text = raw == null ? '' : String(raw).trim();
  if (!text) return { ok: true, week: null };
  const n = /^\d{1,3}$/.test(text) ? Number(text) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > max) {
    return {
      ok: false,
      message: `This cohort has ${max} week${max === 1 ? '' : 's'}. Choose a week from 1 to ${max}, or leave it empty for general guidance.`,
    };
  }
  return { ok: true, week: n };
}

// ── Unsaved text, per cohort ─────────────────────────────────────────────

export const DRAFT_PREFIX = 'axal.cohorts.guidanceDraft';

/** One key per cohort and per piece of guidance; a new note is `new`. */
export function draftKey(cycleId, uid) {
  return `${DRAFT_PREFIX}:${cycleId}:${uid || 'new'}`;
}

function defaultStorage() {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}

export function readLocalDraft(cycleId, uid, storage = defaultStorage()) {
  if (cycleId == null || !storage) return null;
  try {
    const raw = storage.getItem(draftKey(cycleId, uid));
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object' || Number(d.cycleId) !== Number(cycleId)) return null;
    return {
      cycleId: Number(cycleId),
      uid: d.uid || null,
      title: String(d.title ?? ''),
      body: String(d.body ?? ''),
      week: String(d.week ?? ''),
      baseVersion: Number.isInteger(d.baseVersion) ? d.baseVersion : null,
      savedAt: d.savedAt || null,
    };
  } catch {
    return null;
  }
}

/** Keeps the text; returns whether it was kept (storage may refuse). */
export function writeLocalDraft(cycleId, uid, draft, storage = defaultStorage()) {
  if (cycleId == null || !storage) return false;
  try {
    storage.setItem(draftKey(cycleId, uid), JSON.stringify({
      cycleId: Number(cycleId), uid: uid || null,
      title: draft.title || '', body: draft.body || '', week: draft.week ?? '',
      baseVersion: Number.isInteger(draft.baseVersion) ? draft.baseVersion : null,
      savedAt: new Date().toISOString(),
    }));
    return true;
  } catch {
    return false;
  }
}

export function clearLocalDraft(cycleId, uid, storage = defaultStorage()) {
  if (cycleId == null || !storage) return;
  try { storage.removeItem(draftKey(cycleId, uid)); } catch { /* a convenience only */ }
}

/** True when the advisor has typed something here that is not yet saved. */
export const hasText = (d) => Boolean(d && (String(d.title || '').trim() || String(d.body || '').trim() || String(d.week || '').trim()));

// ── Writes ───────────────────────────────────────────────────────────────

/**
 * One write, guarded like a read. `write()` performs it; `onState` hears the
 * result only while this is still the newest write AND the cohort on screen is
 * the one it was made for (`currentCycle()`). Returns `{ landed, ok, result | error }`
 * either way, so the caller can still clear what belongs to the cohort it left.
 */
export async function guardedWrite({ gate, forCycle, currentCycle, write, onState }) {
  const token = gate.next();
  const lands = () => gate.isCurrent(token) && Number(currentCycle()) === Number(forCycle);
  try {
    const result = await write();
    const landed = lands();
    if (landed && onState) onState({ ok: true, result });
    return { landed, ok: true, result };
  } catch (error) {
    const landed = lands();
    if (landed && onState) onState({ ok: false, error });
    return { landed, ok: false, error };
  }
}

/** What a failed write was, in the composer's terms. */
export function writeFailure(error, fallback) {
  if (error?.status === 409 && error?.code === 'guidance_version_conflict') {
    return { state: 'conflict', current: error?.data?.current || null, message: error.message };
  }
  if (error?.status === 400 && error?.code === 'guidance_week_invalid') {
    return { state: 'invalid', message: error.message };
  }
  return { state: fallback, message: error?.message || '' };
}

/**
 * The composer's save states, each a glyph and words (never colour alone), and
 * whether it is announced politely (`status`) or at once (`alert`).
 */
export const SAVE_STATES = {
  idle: { glyph: '', text: '', role: 'status' },
  unsaved: { glyph: '●', text: 'Unsaved changes', role: 'status' },
  saving: { glyph: '◷', text: 'Saving…', role: 'status' },
  saved: { glyph: '✓', text: 'Draft saved', role: 'status' },
  publishing: { glyph: '◷', text: 'Publishing…', role: 'status' },
  published: { glyph: '✓', text: 'Published', role: 'status' },
  invalid: { glyph: '✕', text: 'Not saved · check the week', role: 'alert' },
  conflict: { glyph: '▲', text: 'Version conflict', role: 'alert' },
  failed_save: { glyph: '✕', text: 'Not saved · Retry', role: 'alert' },
  failed_publish: { glyph: '✕', text: 'Publish failed · your text is kept', role: 'alert' },
};

export function saveStateLine(state, at) {
  const s = SAVE_STATES[state] || SAVE_STATES.idle;
  if (!s.text) return '';
  const when = (state === 'saved' || state === 'published') && at ? ` ${at}` : '';
  return `${s.glyph} ${s.text}${when}`;
}
