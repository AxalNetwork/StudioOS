/**
 * The readings the founder's data room (canvas "Data Room", founder view) and
 * its tests share. Pure, so they run in Node.
 *
 * EVERY COUNT HERE IS A COUNT OF A REAL TABLE. `data_room_access_log` logs
 * three actions — `open_room`, `download` and `blocked` (D374) — and nothing
 * else. There is no per-file view, so a file's figure is its downloads, and
 * there is no NDA-signing event in the log, so the NDA filter is the events on
 * NDA-marked files, which is what the log can answer.
 */

/** The four tiles above the room. `v: null` is Not recorded, never a zero. */
export function roomStats(room) {
  if (!room) return [];
  const files = room.files || [];
  const active = (room.grants || []).filter((g) => grantIsActive(g));
  const week = room.week || null;
  return [
    { k: 'Files', v: String(files.length), sub: `${(room.folders || []).length} folder${(room.folders || []).length === 1 ? '' : 's'}` },
    { k: 'NDA-gated', v: String(files.filter((f) => f.visibility === 'nda').length), sub: 'open only with a signed NDA' },
    { k: 'Investors with access', v: String(active.length), sub: `${active.filter((g) => g.nda_signed).length} with an NDA on file` },
    week
      ? { k: 'Room opens this week', v: String(week.opened), sub: `${week.downloaded} download${week.downloaded === 1 ? '' : 's'} · ${week.blocked} blocked` }
      : { k: 'Room opens this week', v: null, sub: 'the weekly count did not come back with the room' },
  ];
}

/**
 * The folder tree. Folders nest by `parent_id`; files sit in their folder by
 * `folder_id`, and a file whose folder is gone is at the root (migration 184
 * sets it NULL). A parent that is not in the list, or a loop, lands at the
 * root rather than vanishing.
 */
export function folderTree(folders = [], files = []) {
  const byId = new Map(folders.map((f) => [f.id, { folder: f, folders: [], files: [] }]));
  const root = { folder: null, folders: [], files: [] };
  for (const node of byId.values()) {
    let p = node.folder.parent_id;
    const seen = new Set([node.folder.id]);
    let loops = false;
    while (p != null && byId.has(p)) {
      if (seen.has(p)) { loops = true; break; }
      seen.add(p);
      p = byId.get(p).folder.parent_id;
    }
    const parent = !loops && node.folder.parent_id != null ? byId.get(node.folder.parent_id) : null;
    (parent || root).folders.push(node);
  }
  for (const f of files) (byId.get(f.folder_id) || root).files.push(f);
  return root;
}

/** Every file under a node, its sub-folders included. */
export function filesUnder(node) {
  if (!node) return [];
  return [...node.files, ...node.folders.flatMap(filesUnder)];
}

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

/**
 * The canvas's three tiers, each the `access_tier` it stores (migration 463).
 * Every investor read applies them (D691 decision 6). They are set per file
 * from Raise › Data room's Upload and Edit file (D695), not on this page; the
 * NDA is the toggle below, not a tier.
 */
const SET_WHERE = 'Set per file from Raise › Data room’s Upload and Edit file, not on this page.';
export const ACCESS_TIERS = [
  { key: 'invited', label: 'Everyone invited', note: `Every investor you have shared the room with. ${SET_WHERE}` },
  { key: 'committed', label: 'Committed only', note: `Only investors whose email is a committed prospect on this raise. ${SET_WHERE}` },
  { key: 'nobody', label: 'Private to you', note: `No investor, whatever their grant or NDA. ${SET_WHERE}` },
];

/** The tier a file is marked with; a file with none reads as `invited`. */
export function tierOf(file) {
  return file?.access_tier == null || file.access_tier === '' ? 'invited' : file.access_tier;
}

export const AUDIT_FILTERS = ['All', 'View', 'Download', 'NDA', 'Blocked'];

/** Whether one log row belongs under a filter. "View" is opening the room. */
export function auditMatches(event, filter) {
  switch (filter) {
    case 'All': return true;
    case 'View': return event.action === 'open_room';
    case 'Download': return event.action === 'download';
    case 'Blocked': return event.action === 'blocked';
    case 'NDA': return event.file_visibility === 'nda';
    default: return false;
  }
}

/** One log row as words. An action the page does not know is printed as it is. */
export function auditLine(event) {
  const file = event.file_name || 'a file since deleted';
  switch (event.action) {
    case 'open_room': return { verb: 'opened the room', what: '', tag: 'View' };
    case 'download': return { verb: 'downloaded', what: file, tag: 'Download' };
    case 'blocked': return { verb: 'was blocked from', what: file, tag: 'Blocked' };
    default: return { verb: String(event.action || 'did something unrecorded'), what: event.file_name || '', tag: '' };
  }
}

/** A file's own figure: downloads, from the log. Absent is Not recorded. */
export function downloadsLabel(n) {
  if (n === null || n === undefined) return null;
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return `${v} download${v === 1 ? '' : 's'}`;
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
