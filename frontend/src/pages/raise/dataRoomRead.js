/**
 * The readings the Data room tool shares (D374, kept by D1109). Pure, so they
 * run in Node: who can open a file now and why not (the Worker's one predicate
 * restated, never decided here), a file's tier, the upload queue's size
 * refusal, and who made a grant.
 *
 * D1109 (#2989): the old files tool's stat strip, folder tree, activity filters
 * and download label went with it; the tool's own models (`dataroom/`) draw those now.
 */

/**
 * A stored `access_expires_at` (`YYYY-MM-DD`, or a full timestamp) in
 * milliseconds, read as UTC; null when it cannot be read. The worker's
 * `expiryMs` (`services/dataRoomAccess.ts`), restated.
 */
function expiryMs(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z');
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Why a file's own tier or expiry shuts everyone out, or null when it does
 * not. A file with no `access_tier` reads as `invited`; a folder carries no
 * tier (access is set per file), so it reads the same. An expiry nobody can
 * read hides the file, as the worker's predicate does.
 */
function tierRefusal(item, now) {
  const tier = item.access_tier == null || item.access_tier === '' ? 'invited' : item.access_tier;
  if (tier === 'nobody') return 'No investor can open this — it is private to you.';
  if (tier !== 'invited' && tier !== 'committed') return 'No investor can open this — its access mark is not one this page knows.';
  if (item.access_expires_at != null && String(item.access_expires_at).trim() !== '') {
    const at = expiryMs(item.access_expires_at);
    if (at == null) return 'No investor can open this — its access end date cannot be read.';
    if (at <= now) return `No investor can open this — its access ended on ${String(item.access_expires_at).slice(0, 10)}.`;
  }
  return null;
}

/**
 * Who can open this file or see this folder right now. The worker's one
 * predicate (D691 decision 6, `services/dataRoomAccess.ts`) restated — this
 * does not decide it:
 *   - the file's tier: everyone with an active grant (`invited`), only the
 *     grants whose investor is a committed prospect (`committed`), or no one
 *     (`nobody`); and no one once `access_expires_at` has passed;
 *   - then the NDA gate: an NDA-marked item needs a live NDA.
 */
export function grantIsActive(g, now = Date.now()) {
  if (g.status !== 'active') return false;
  if (!g.expires_at) return true;
  const expires = expiryMs(g.expires_at);
  return expires != null && expires > now;
}

export function accessNow(item, grants = [], now = Date.now()) {
  if (!item) return [];
  if (tierRefusal(item, now)) return [];
  const active = grants.filter((g) => grantIsActive(g, now));
  const tiered = item.access_tier === 'committed' ? active.filter((g) => g.committed) : active;
  return item.visibility === 'nda' ? tiered.filter((g) => g.nda_signed) : tiered;
}

/** Why nobody can open it, when nobody can — the first rule that shuts them out. */
export function noAccessReason(item, grants = [], now = Date.now()) {
  const refused = item ? tierRefusal(item, now) : null;
  if (refused) return refused;
  const active = grants.filter((g) => grantIsActive(g, now));
  if (!active.length) return 'No investor can open this — the room is not shared with anyone yet.';
  if (item?.access_tier === 'committed' && !active.some((g) => g.committed)) {
    return 'No investor can open this — it is for committed investors, and nobody with access has committed on this raise.';
  }
  return 'No investor can open this — it needs a signed NDA, and nobody with access has one on file.';
}

/** The tier a file is marked with; a file with none reads as `invited`. */
export function tierOf(file) {
  return file?.access_tier == null || file.access_tier === '' ? 'invited' : file.access_tier;
}

/** Whether a picked file may join the upload queue, and why not. */
export function queueRefusal(file, maxMb) {
  if (!file) return 'No file';
  if (file.size > maxMb * 1024 * 1024) return `Larger than ${maxMb} MB`;
  return null;
}

/** Attribution stays visible even when an older granter's name is unavailable. */
export function grantAttribution(grant) {
  const name = grant.granted_by_name || 'Not recorded';
  const role = grant.granted_by_role;
  return `Granted by ${name}${role ? ` (${role})` : ''}`;
}
