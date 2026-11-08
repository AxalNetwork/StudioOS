/**
 * D4801 (#4801, canvas SE04, SE05 and SE11c; D4803 decisions A1, B1 and C1) —
 * the Access workspace's rules, pure, so a Worker-free test can pin each one.
 *
 * Every figure and every outcome here comes from `admin_security.ts` and
 * `services/userSessions.ts` as they are:
 *
 *   - The list holds ACTIVE sessions only: not revoked, token under
 *     `token_hours` (24) old, and not below the account's sign-out floor. So
 *     Revoked appears on a row only after this page's own act was confirmed,
 *     and Expired only when the page has sat open past a row's expiry.
 *   - Expires is derived: `created_at` + `token_hours`. Nothing stores it.
 *   - Revoke one (`POST /sessions/:id/revoke`) sets `revoked_at` on one row.
 *     The caller's own current session is refused with 409
 *     `own_current_session`.
 *   - Sign out account (`POST /force-reauth/:userId`) raises that account's
 *     token floor, so every session it holds, on every device, is refused.
 *     It does not list which sessions that reached.
 *   - End support session (`POST /impersonations/:id/end`) closes the record.
 *     The support token carries no session id, so it stays valid until it
 *     expires, at most `expiry_minutes` (30) after it was minted (C1).
 *   - Emergency re-authentication (`POST /force-reauth`) raises the floor of
 *     every active account in the HQ database, the caller's included. Nothing
 *     in the route reaches a branch database (A1). The count is known only
 *     after the run (`affected`).
 *   - Every write takes the Super Admin write bar (a TOTP session and a
 *     recent step-up) and a reason of at least MIN_REASON characters.
 */
import { titleCase } from '../../../lib/absence.js';
import { parseUserAgent } from './parseUserAgent.js';

/** The server's own floor (`admin_security.ts` MIN_REASON). */
export const MIN_REASON = 8;
/** "Revoke selected" in one request, at most (`userSessions.ts`). */
export const SESSION_BULK_LIMIT = 100;
/** What the operator types to confirm emergency re-authentication (SE05e). */
export const EMERGENCY_PHRASE = 'SIGN OUT HQ';

// ───────────────────────────────────────────────────────────── time ──

/**
 * A server timestamp as a Date, or null. D1 writes `datetime('now')`, which
 * is UTC with no zone marker ("2026-11-07 09:47:12"); a string without a
 * zone is read as UTC, never as the browser's local time.
 */
export function parseServerTime(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') return Number.isFinite(v) ? new Date(v) : null;
  let s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2} \d/.test(s)) s = s.replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(s)) s += 'Z';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

const FORMATS = new Map();
function formatter(timeZone, seconds) {
  const key = `${timeZone}|${seconds}`;
  if (!FORMATS.has(key)) {
    FORMATS.set(key, new Intl.DateTimeFormat('en-GB', {
      timeZone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hourCycle: 'h23',
    }));
  }
  return FORMATS.get(key);
}
// "Sat, 7 Nov 2026, 09:47:12" → "Sat 7 Nov 2026, 09:47:12" (SEB: "Thu 19 Nov 2026").
const tidy = (s) => s.replace(/^(\w{3}),/, '$1').replace(' at ', ', ');

/**
 * A precise, zoned time: "Sat 7 Nov 2026, 09:47:12 UTC". Always UTC on the
 * page, so two operators in two cities read the same words; the viewer's own
 * zone is offered beside it by `formatInZone`. Null for an unreadable value.
 */
export function formatUtc(v, { seconds = true } = {}) {
  const d = parseServerTime(v);
  if (!d) return null;
  return `${tidy(formatter('UTC', seconds).format(d))} UTC`;
}

/** The same instant in another IANA zone, with the zone named. */
export function formatInZone(v, timeZone, { seconds = true } = {}) {
  const d = parseServerTime(v);
  if (!d || !timeZone) return null;
  try {
    return `${tidy(formatter(timeZone, seconds).format(d))} (${timeZone})`;
  } catch {
    return null;
  }
}

/** The browser's zone, or null where the platform will not say. */
export function viewerZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; }
}

/** "12 min ago", "in 3 h 5 min", "just now". Null for an unreadable value. */
export function relativeTo(v, now) {
  const d = parseServerTime(v);
  if (!d || !Number.isFinite(now)) return null;
  const diff = Math.round((d.getTime() - now) / 60000);
  const abs = Math.abs(diff);
  if (abs < 1) return 'just now';
  const text = abs < 60 ? `${abs} min` : `${Math.floor(abs / 60)} h${abs % 60 ? ` ${abs % 60} min` : ''}`;
  return diff < 0 ? `${text} ago` : `in ${text}`;
}

/** An ISO string for `<time dateTime>`, or undefined. */
export const isoOf = (v) => parseServerTime(v)?.toISOString();

// ───────────────────────────────────────────────────────── sessions ──

/** The person, by name: a name, then the address, then the account number. */
export function accountName(name, email, id) {
  return name || email || (id !== null && id !== undefined ? `Account #${id}` : 'An unnamed account');
}
export const roleOf = (role) => (role ? titleCase(role) : null);

/** `created_at` + `token_hours`: the ordinary lifetime the token was signed with. */
export function sessionExpiresAt(row, tokenHours) {
  const d = parseServerTime(row?.created_at);
  const h = Number(tokenHours);
  if (!d || !Number.isFinite(h) || h <= 0) return null;
  return new Date(d.getTime() + h * 3600000);
}

/**
 * THE FOUR SESSION STATUSES, one set of words for the table, the phone
 * cards, the dialogs and the counts (#4801: "consistent across cards,
 * tables, dialogs, and counts"). Each is drawn with the shared vocabulary's
 * badge; the canvas draws Current over Pending and Active over Healthy.
 */
export const SESSION_STATUS = Object.freeze({
  current: { word: 'Current', state: 'pending', note: 'The session you are using now' },
  active: { word: 'Active', state: 'healthy', note: 'Its token can still open the platform' },
  expired: { word: 'Expired', state: 'not_applicable', note: 'Its token has passed its expiry; nothing to revoke' },
  revoked: { word: 'Revoked', state: 'verified', note: 'Confirmed revoked by the server' },
});

/**
 * One row's status. `changed` is this page's own confirmed acts since the
 * list was read: `sessions[id]` for a revoke, `accounts[userId]` for a
 * sign-out, `all` after emergency re-authentication. Revoked wins over Current: if your own account was signed out,
 * this session is no longer good either.
 */
export function sessionStatus(row, { now, tokenHours, changed } = {}) {
  if (changed?.all || changed?.sessions?.[row.id] || changed?.accounts?.[row.user_id]) return 'revoked';
  const exp = sessionExpiresAt(row, tokenHours);
  if (exp && Number.isFinite(now) && exp.getTime() <= now) return 'expired';
  return row.is_current ? 'current' : 'active';
}

/** What a row is, in the words every surface uses. */
export function describeSession(row, opts = {}) {
  const ua = parseUserAgent(row.user_agent);
  return {
    id: row.id,
    userId: row.user_id,
    name: accountName(row.name, row.email, row.user_id),
    role: roleOf(row.role),
    browser: ua.browser,
    os: ua.os,
    device: ua.missing ? 'No user agent stored' : (ua.label || 'Browser not recognised'),
    uaMissing: ua.missing,
    status: sessionStatus(row, opts),
    expires: sessionExpiresAt(row, opts.tokenHours),
    isCurrent: !!row.is_current,
  };
}

/**
 * READ-ONLY UNTIL STEP-UP. Every write needs a session minted with the
 * authenticator (`requireFactor('totp')`). The list carries the caller's own
 * row with its `factor`, so the page can tell before anyone clicks:
 *
 *   'ready'      your session is a TOTP session; a fresh step-up may still
 *                be asked for, and the request continues after it.
 *   'needs_totp' your session was not minted with the authenticator, so
 *                every act would be refused. The acts are not offered.
 *   'unknown'    your own row is not in the page that was read (the list is
 *                capped), so the page cannot say; the acts stay offered and
 *                the server decides.
 */
export function writeAccess(list) {
  const own = (list?.rows || []).find((r) => r.is_current);
  if (!own) return 'unknown';
  return own.factor === 'totp' ? 'ready' : 'needs_totp';
}

// ────────────────────────────────────────────────────────── results ──

/**
 * THE EIGHT RESULTS, each its own words and state (#4801: "Partial,
 * uncertain, failed, expired, and already-revoked outcomes have distinct UI
 * states"). Done is drawn only from a reply the server sent.
 */
export const RESULTS = Object.freeze({
  done: { word: 'Done', state: 'verified' },
  partial: { word: 'Partly done', state: 'action_required' },
  refused: { word: 'Refused', state: 'action_required' },
  failed: { word: 'Failed', state: 'failed' },
  unknown: { word: 'Outcome unknown', state: 'unknown' },
  already_revoked: { word: 'Already revoked', state: 'not_applicable' },
  not_found: { word: 'Not found', state: 'not_applicable' },
  expired: { word: 'Expired', state: 'stale' },
});

/** The per-row outcomes of a bulk revoke, as the route spells them. */
export const ROW_OUTCOMES = Object.freeze({
  revoked: { word: 'Revoked', state: 'verified' },
  already_revoked: { word: 'Already revoked', state: 'not_applicable' },
  not_found: { word: 'Not found', state: 'not_applicable' },
  missing: { word: 'No answer for this row', state: 'unknown' },
});

/**
 * A thrown request as one of the results. The order is the argument:
 *
 *   - no HTTP status (a timeout, a dropped connection): the request may or
 *     may not have landed, so it is UNKNOWN, "re-read before retrying" (SE05g).
 *   - 401: your own session has expired; nothing was done (EXPIRED).
 *   - the server's codes for "already" and "not there" are their own results,
 *     not failures: nothing needed doing, or nothing was there to do.
 *   - `past_ceiling`: the support session is older than its ceiling, so no
 *     token for it can still be valid (EXPIRED).
 *   - every other 4xx is a refusal: nothing was changed (REFUSED).
 *   - a 5xx is FAILED, and says to re-read: a server error does not prove
 *     nothing happened.
 */
export function resultOfError(err) {
  const status = Number(err?.status);
  const code = err?.code || null;
  const message = String(err?.message || err || 'The request failed.');
  if (code === 'timeout' || !Number.isFinite(status) || status === 0) {
    return { result: 'unknown', code: code || 'no_response', message };
  }
  if (status === 401) return { result: 'expired', code: 'session_expired', message };
  if (code === 'already_revoked' || code === 'already_ended') return { result: 'already_revoked', code, message };
  if (code === 'session_not_found' || code === 'user_not_found' || status === 404) return { result: 'not_found', code, message };
  if (code === 'past_ceiling') return { result: 'expired', code, message };
  if (status >= 500) return { result: 'failed', code, message };
  return { result: 'refused', code, message };
}

/** Whether a refusal was the write bar (TOTP session, or a step-up not completed). */
export const isWriteBarRefusal = (r) => r?.result === 'refused'
  && (r.code === 'step_up_required' || /TOTP required/i.test(r.message || ''));

/**
 * A bulk revoke's reply as one result plus one line per selected row.
 * Done only when every row came back revoked; Partly done when some did;
 * otherwise the one outcome they share, or Partly done for a mixture of
 * nothing-to-do outcomes. A row the reply does not mention is "No answer",
 * never assumed revoked.
 */
export function bulkResult(res, ids) {
  const byId = new Map((Array.isArray(res?.results) ? res.results : []).map((r) => [Number(r.id), r.outcome]));
  const rows = ids.map((id) => {
    const outcome = byId.get(Number(id));
    return { id, outcome: ROW_OUTCOMES[outcome] ? outcome : 'missing' };
  });
  const revoked = rows.filter((r) => r.outcome === 'revoked').length;
  const kinds = new Set(rows.map((r) => r.outcome));
  let result;
  if (revoked === rows.length && rows.length > 0) result = 'done';
  else if (revoked > 0) result = 'partial';
  else if (kinds.size === 1 && kinds.has('already_revoked')) result = 'already_revoked';
  else if (kinds.size === 1 && kinds.has('not_found')) result = 'not_found';
  else if (kinds.size === 1 && kinds.has('missing')) result = 'unknown';
  else result = 'partial';
  return { result, rows, revoked, total: rows.length };
}

/** "3 sessions on 2 accounts" — the scope line of a bulk review (SE05b). */
export function bulkScope(rows) {
  const accounts = new Set(rows.map((r) => r.userId));
  const s = rows.length === 1 ? 'session' : 'sessions';
  const a = accounts.size === 1 ? 'account' : 'accounts';
  return `${rows.length} ${s} on ${accounts.size} ${a}`;
}
