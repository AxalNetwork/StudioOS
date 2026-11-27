// #4646 — answers, drafts and pending progress that survive an interruption.
//
// A learner's unsent exercise text, checklist ticks and exam choices, and a video position that could not be written
// (offline, a closed tab), are kept on THIS DEVICE under a key naming the learner, the content and, for an exam, the
// exact attempt. They are restored when the same learner reopens the same content, and removed once the server has
// the work. The server stays authoritative: exam timing and submission, and what counts as an answer, are its.
//
// What this is not: a copy on the server. Another device does not see it, and the words on the page say "on this
// device" so a saved state never claims more than is durable. (Server-held exam choices wait on the attempt contract
// in #4643.)
//
// Pure with an injected store, so a test runs it without a browser. Every read and write is guarded: a store that is
// missing, full or refusing (private mode) leaves the page working and the state "not saved".

const PREFIX = 'axal:learning:v1';
export const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const DRAFT_MAX_CHARS = 60_000;

/** The browser's store, or null when there is none. */
export function browserStore() {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

const part = (v) => encodeURIComponent(String(v ?? '').trim());

/**
 * `axal:learning:v1:<learner>:<kind>:<content>[:<attempt>]`, or null when the learner or the content is not known:
 * a draft is never kept under a key that could be another learner's.
 */
export function draftKey({ userId, kind, uid, attempt = null }) {
  if (userId === null || userId === undefined || String(userId) === '' || !kind || !uid) return null;
  return [PREFIX, part(userId), part(kind), part(uid), ...(attempt ? [part(attempt)] : [])].join(':');
}

/** A saved value, or null when there is none, it is corrupt, or it has expired. */
export function loadDraft(store, key, now = Date.now()) {
  if (!store || !key) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const row = JSON.parse(raw);
    if (!row || typeof row !== 'object' || row.v !== 1 || !Number.isFinite(row.at)) return null;
    if (now - row.at > DRAFT_TTL_MS) { store.removeItem(key); return null; }
    return { value: row.value, at: row.at };
  } catch { return null; }
}

/** True when the value is now on the device. A value too large to keep is refused, not cut. */
export function saveDraft(store, key, value, now = Date.now()) {
  if (!store || !key) return false;
  try {
    const text = JSON.stringify({ v: 1, at: now, value });
    if (text.length > DRAFT_MAX_CHARS) return false;
    store.setItem(key, text);
    return true;
  } catch { return false; }
}

export function clearDraft(store, key) {
  if (!store || !key) return;
  try { store.removeItem(key); } catch { /* nothing to clear */ }
}

/** Whether a value is worth keeping: an empty answer or an unticked list is the same as none. */
export function isBlankDraft(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  // Index 0 is a real tick (the first checklist item), so a list is blank only when it holds nothing at all.
  if (Array.isArray(value)) return value.length === 0 || value.every((x) => x === null || x === undefined || x === '' || x === false);
  if (typeof value === 'object') return Object.values(value).every(isBlankDraft);
  return false;
}

/** The words for a draft's state; every one says where the work is. */
export const DRAFT_WORDS = Object.freeze({
  restored: 'Restored your unsent work from this device.',
  saved: 'Saved on this device. It is not sent until you submit.',
  failed: 'Not saved: this browser would not keep it. Your work is still on the page.',
  none: '',
});

// ── pending video position ────────────────────────────────────────────────

export const POSITION_PREFIX = `${PREFIX}:position`;
const POSITION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** `axal:learning:v1:position:<learner>:<item>`. */
export const positionKey = (userId, itemUid) => (userId === null || userId === undefined || String(userId) === '' || !itemUid
  ? null : [POSITION_PREFIX, part(userId), part(itemUid)].join(':'));

/** The pending position of one item: `{ seconds, duration, at }`, or null. */
export function loadPosition(store, key, now = Date.now()) {
  const row = loadDraft(store, key, now);
  const v = row?.value;
  if (!v || !Number.isFinite(v.seconds) || v.seconds < 0) return null;
  if (now - row.at > POSITION_TTL_MS) return null;
  return { seconds: v.seconds, duration: Number.isFinite(v.duration) ? v.duration : undefined, at: row.at };
}

export function savePosition(store, key, seconds, duration, now = Date.now()) {
  return saveDraft(store, key, { seconds, duration: Number.isFinite(Number(duration)) ? Number(duration) : null }, now);
}

/** Every pending position this learner has stored: `[{ key, itemUid, seconds, duration }]`. */
export function pendingPositions(store, userId, now = Date.now()) {
  if (!store || userId === null || userId === undefined) return [];
  const lead = `${POSITION_PREFIX}:${part(userId)}:`;
  const out = [];
  try {
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (!key || !key.startsWith(lead)) continue;
      const row = loadPosition(store, key, now);
      if (row) out.push({ key, itemUid: decodeURIComponent(key.slice(lead.length)), seconds: row.seconds, duration: row.duration ?? null });
    }
  } catch { /* an unreadable store has nothing pending */ }
  return out;
}
