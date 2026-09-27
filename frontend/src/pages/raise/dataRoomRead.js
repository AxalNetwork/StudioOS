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
  const active = (room.grants || []).filter((g) => g.status === 'active');
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
 * Who can open this file or see this folder right now: an active grant for an
 * open item, an active grant with a live NDA for an NDA-marked one. The same
 * rule the worker's gate applies — this restates it, it does not decide it.
 */
export function accessNow(item, grants = []) {
  if (!item) return [];
  const active = grants.filter((g) => g.status === 'active');
  return item.visibility === 'nda' ? active.filter((g) => g.nda_signed) : active;
}

/** Why nobody can open it, when nobody can. */
export function noAccessReason(item, grants = []) {
  const active = grants.filter((g) => g.status === 'active');
  if (!active.length) return 'No investor can open this — the room is not shared with anyone yet.';
  return 'No investor can open this — it needs a signed NDA, and nobody with access has one on file.';
}

/**
 * The canvas's three tiers, and which of them this room stores. It stores two
 * gates (`open`, `nda`); the NDA is a toggle below, not a tier. The other two
 * are drawn, and each says why it is not built.
 */
export const ACCESS_TIERS = [
  { label: 'Everyone invited', built: true, note: 'Every investor you have shared the room with.' },
  {
    label: 'Committed only',
    built: false,
    note: 'Not built. The room has no link to who has committed on this raise, and the investor reads show a file to anyone with a grant and a signed NDA whatever else it is marked — so a third mark would be listed to every NDA holder.',
  },
  {
    label: 'Private to you',
    built: false,
    note: 'Not built, for the same reason: a mark the investor reads do not know would not hide the file from an investor with a signed NDA. Until then, keep a private file out of the room.',
  },
];

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
