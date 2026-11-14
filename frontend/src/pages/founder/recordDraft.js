/**
 * D5811 (#5811) — Record a session's setup, kept while the member leaves for
 * Account › Connectors › Microsoft Teams (and Microsoft's own sign-in) and
 * brought back when they return, so connecting never costs them the form.
 *
 * WHERE IT LIVES. This tab's `sessionStorage`, under one key, never a URL or a
 * log: the meeting link and the interviewee's name stay on this device. The
 * record names the member it belongs to; a read by anyone else removes it.
 * It expires after an hour, and Record a session removes it on Cancel, on a
 * Start that succeeds, and once it has been restored.
 *
 * WHAT IT HOLDS. The venture and interview the lightbox was on, Who's name and
 * company, the mode and provider, the meeting link and the call's length.
 * Never consent: the member confirms it again before anything records.
 *
 * WHERE "BACK" GOES. Only `/validate/record`, with the venture and interview
 * as numbers (`recordReturnPath`, `safeRecordReturn`): a stored path is read
 * back through the same allowlist, so no other address is ever followed.
 */

const KEY = 'axal.record.draft';
const TTL_MS = 60 * 60_000;
const MODES = new Set(['in_person', 'video', 'phone', 'text']);
const PROVIDER = /^[a-z_]{1,24}$/;
const RETURN = /^\/validate\/record(?:\?project_id=[1-9]\d{0,11}(?:&interview=[1-9]\d{0,11})?)?$/;

function session() {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; }
}
const id = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Record a session's own address for a venture and interview: the one place "Back" may go. */
export function recordReturnPath(projectId, interviewId = null) {
  const p = id(projectId);
  if (!p) return '/validate/record';
  const i = id(interviewId);
  return `/validate/record?project_id=${p}${i ? `&interview=${i}` : ''}`;
}

/** The path, when it is one `recordReturnPath` could have made; null for anything else. */
export function safeRecordReturn(path) {
  return typeof path === 'string' && RETURN.test(path) ? path : null;
}

/** Keep the setup for this member. False when it could not be kept (no storage, no member). */
export function saveRecordDraft(userId, draft, now = Date.now(), store = session()) {
  const user = id(userId);
  if (!store || !user || !draft) return false;
  const record = {
    v: 1, user, at: now,
    projectId: id(draft.projectId), interviewId: id(draft.interviewId),
    name: text(draft.name, 120), company: text(draft.company, 120),
    mode: MODES.has(draft.mode) ? draft.mode : 'video',
    provider: PROVIDER.test(String(draft.provider || '')) ? draft.provider : null,
    link: text(draft.link, 2048), minutes: id(draft.minutes),
  };
  try { store.setItem(KEY, JSON.stringify(record)); return true; } catch { return false; }
}

/** Forget the setup. */
export function clearRecordDraft(store = session()) {
  try { store?.removeItem(KEY); } catch { /* nothing kept */ }
}

/**
 * The setup kept for this member, or null. Another member's, an expired one or
 * an unreadable one is removed. `projectId`, when given, must be the venture it
 * was kept for: a draft is never poured into another venture's form.
 */
export function readRecordDraft(userId, { projectId = undefined } = {}, now = Date.now(), store = session()) {
  if (!store) return null;
  let v = null;
  try { v = JSON.parse(store.getItem(KEY) || 'null'); } catch { clearRecordDraft(store); return null; }
  if (!v) return null;
  const user = id(userId);
  // Not known yet (the session still loading): leave it for when it is.
  if (!user) return null;
  if (v.v !== 1 || v.user !== user || !Number.isFinite(v.at) || now - v.at < 0 || now - v.at > TTL_MS) {
    clearRecordDraft(store);
    return null;
  }
  if (projectId !== undefined && id(projectId) !== v.projectId) return null;
  return v;
}

/** Where the Teams page's "Back to Record a session" goes, when this member has a setup waiting; null otherwise. */
export function pendingRecordReturn(userId, now = Date.now(), store = session()) {
  const d = readRecordDraft(userId, {}, now, store);
  return d ? safeRecordReturn(recordReturnPath(d.projectId, d.interviewId)) : null;
}
