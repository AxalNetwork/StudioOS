/**
 * D1101 (#2456) — the Data room tool's addresses, words and derivations, kept
 * pure so the tests read them without a browser.
 *
 * WHERE THE TOOL LIVES. `/raise/data-room` is CycleRoute's module page (Home),
 * and every `/raise/data-room/<word>` is its record route (`/raise/:slug/:id`,
 * `cyclePaths.js` RECORD_ID). A file record's id is its number, so the tool's
 * tabs are words CycleRoute reads as tabs, never records (`isDataRoomTab`), as
 * D906 did for the Investor narrative and D1015 for the Cap table. No route is
 * added: `/raise/data-room/12` is still a file and `/new` is still Upload.
 *
 * WHAT IS READ, AND FROM WHERE. Every row comes from reads on `main`:
 *   - `GET /api/cycles/raise/modules/data-room` → Home (coverage, opens, the
 *     Files records), as CycleRoute draws it today;
 *   - `GET /api/data-room/:projectUid` → Files (the tree, each file's gate and
 *     who can open it now) and Access (every grant with its end, NDA, committed
 *     state and who granted it), through `dataRoomRead.js`'s one access
 *     predicate; every tab reads it for the venture's uid and the refusal.
 *   - D1108 (#2988): Activity, Checklist and Preview read D1105's and D1103's
 *     routes (`activityModel.js`, `checklistModel.js`, `previewModel.js`).
 *
 * A LINK ISSUED IS NOT A READ. The log holds `open_room`, `download` (a link
 * issued) and `blocked` (a refusal). No tab counts a refusal as an open.
 *
 * WHAT IS NOT DRAWN YET. Eadwyn's proposals (DR14) wait for AUTOFILL's
 * provenance (#2431); the Checklist tab says so (D1108).
 */

import { NOT_RECORDED } from '../../../lib/absence.js';
import { accessNow, grantAttribution, grantIsActive, noAccessReason, tierOf } from '../dataRoomRead.js';

export const SLUG = 'data-room';
export const HOME_PATH = `/raise/${SLUG}`;
export const TITLE = 'Data room';
export const LINE = 'Your diligence files, who can open them, and what they have opened.';

export const TABS = [
  { id: 'home', label: 'Home', path: '' },
  { id: 'files', label: 'Files', path: '/files' },
  { id: 'access', label: 'Access', path: '/access' },
  { id: 'requests', label: 'Requests', path: '/requests' },
  { id: 'activity', label: 'Activity', path: '/activity' },
  { id: 'checklist', label: 'Checklist', path: '/checklist' },
  { id: 'preview', label: 'Preview', path: '/preview' },
];
const TAB_WORDS = new Set(TABS.filter((t) => t.path).map((t) => t.id));

/** True when CycleRoute's record id under this module is a tab, not a file. */
export const isDataRoomTab = (slug, id) => slug === SLUG && TAB_WORDS.has(String(id ?? ''));

/** The query a tab keeps: the venture only. */
export function tabSearch(search = '') {
  const from = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const project = from.get('project_id') || from.get('project');
  return project && /^[1-9]\d*$/.test(project) ? `?project_id=${project}` : '';
}

export const tabHref = (tab, search = '') => `${HOME_PATH}${tab.path}${tabSearch(search)}`;

/**
 * D1109 (#2989, DR24) — the old addresses that forward into the tool, each
 * counted (#2319) under its own key and landing on its tab with a moved notice.
 * `?mode=workspace` was the files tool (`DataRoomPage`), `?mode=access` the
 * read-only access view (`FounderRaiseDataRoom`), and a file's number its record page.
 */
export const MOVED_FROM = Object.freeze({
  workspace: { key: '/raise/data-room?mode=workspace', to: `${HOME_PATH}/files` },
  access: { key: '/raise/data-room?mode=access', to: `${HOME_PATH}/access` },
  file: { key: '/raise/data-room/:id', to: `${HOME_PATH}/file` },
});

/** The one-line notice each forward lands with (DR24a, DR24b), read from `?moved=`. */
export const MOVED_NOTICES = Object.freeze({
  workspace: 'The data room workspace is now Data room › Files.',
  access: 'The access view is now Data room › Access.',
  file: 'A file’s page is now its window over Data room › Files.',
});

/** Which old address, if any, this tool address is: `?mode=` on the bare address. */
export function movedKind(search = '') {
  const mode = new URLSearchParams(String(search || '').replace(/^\?/, '')).get('mode');
  return mode === 'workspace' || mode === 'access' ? mode : null;
}

/**
 * Where an old address lands: its tab (or, for a file's number, its window over
 * Files), with the whole query kept except `mode`, `?moved=` naming the notice,
 * and the hash kept. `?project_id=` travels as it came.
 */
export function movedTarget(kind, search = '', hash = '', id = null) {
  const from = MOVED_FROM[kind];
  if (!from) return null;
  const q = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  q.delete('mode');
  q.set('moved', kind);
  const pathname = kind === 'file' ? `${from.to}/${encodeURIComponent(String(id))}` : from.to;
  return { pathname, search: `?${q.toString()}`, hash: hash || '' };
}

/** True for a file record's number under the module: the old record page, never a tab word. */
export const isOldFileAddress = (slug, id) => slug === SLUG && /^[1-9]\d*$/.test(String(id ?? ''));

/** The venture's uid, which the founder's data-room read is keyed on, from the projects list. */
export function projectUidOf(projects, projectId) {
  const list = Array.isArray(projects) ? projects : (projects?.items || []);
  const hit = list.find((p) => String(p?.id) === String(projectId));
  return hit?.uid ? String(hit.uid) : null;
}

/** "24 Oct 2026" from an ISO date or stamp; anything else is "Not recorded". */
export function day(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  if (!m) return NOT_RECORDED;
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${M[Number(m[2]) - 1]} ${m[1]}`;
}

const GATE = { nda: 'NDA', open: 'Open' };
const TIER = { invited: 'Everyone invited', committed: 'Committed only', nobody: 'Private to you' };

/**
 * Files' rows: every file with its folder, gate, tier, end date, downloads and
 * who can open it now, by the same predicate every investor read applies.
 */
export function fileRows(room, now = Date.now()) {
  const folders = new Map((room?.folders || []).map((f) => [f.id, f.name]));
  const grants = room?.grants || [];
  return (room?.files || []).map((f) => {
    const can = accessNow(f, grants, now);
    return {
      uid: f.uid,
      name: f.name,
      folder: folders.get(f.folder_id) || 'Top level',
      gate: GATE[f.visibility] || NOT_RECORDED,
      tier: TIER[tierOf(f)] || NOT_RECORDED,
      until: f.access_expires_at ? day(f.access_expires_at) : 'No end date',
      downloads: f.downloads == null ? NOT_RECORDED : String(Number(f.downloads)),
      opens: can.length ? `${can.length} investor${can.length === 1 ? '' : 's'}` : 'No one',
      why: can.length ? '' : noAccessReason(f, grants, now),
    };
  });
}

/** Access's rows: each grant, whether it is in force now, its end, NDA, committed state and who granted it. */
export function grantRows(room, now = Date.now()) {
  return (room?.grants || []).map((g) => ({
    uid: g.uid,
    who: g.investor_name || g.investor_email || NOT_RECORDED,
    email: g.investor_email || '',
    state: grantIsActive(g, now) ? 'In force' : g.status === 'active' ? 'Ended' : 'Revoked',
    since: day(g.created_at),
    until: g.expires_at ? day(g.expires_at) : 'No end date',
    nda: g.nda_signed ? 'Signed' : 'Not signed',
    committed: g.committed ? 'Committed' : 'Not committed',
    by: grantAttribution(g),
  }));
}

