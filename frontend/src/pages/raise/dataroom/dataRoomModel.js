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
 *     who can open it now), Access (every grant with its end, NDA, committed
 *     state and who granted it) and Activity (the last fifty events and the
 *     week's counts), through `dataRoomRead.js`'s one access predicate.
 *
 * A LINK ISSUED IS NOT A READ. The log holds `open_room`, `download` (a link
 * issued) and `blocked` (a refusal). No tab counts a refusal as an open.
 *
 * WHAT IS NOT DRAWN YET, AND WHO DRAWS IT. Requests (no access-request store),
 * the per-item Checklist read and the investor Preview read have no Worker
 * read yet; each tab says so (D1101 §6). Uploads, gates, sharing and revoking
 * stay in today's files tool (`?mode=workspace`) until part 4 replaces it.
 */

import { NOT_RECORDED } from '../../../lib/absence.js';
import { accessNow, auditLine, grantAttribution, grantIsActive, noAccessReason, tierOf } from '../dataRoomRead.js';

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

/** Today's files tool, where uploads, gates, sharing and revoking still happen until part 4. */
export function workspaceHref(search = '') {
  const q = tabSearch(search);
  return `${HOME_PATH}?mode=workspace${q ? `&${q.slice(1)}` : ''}`;
}

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

/** Activity's log rows. A refusal is a refusal, never an open. */
export function activityRows(room) {
  return (room?.recent_access || []).map((a, i) => {
    const line = auditLine(a);
    return { key: `${a.created_at || ''}-${i}`, who: a.user_name || a.user_email || NOT_RECORDED, verb: line.verb, what: line.what, tag: line.tag, when: a.created_at || '' };
  });
}

/** The week's three counts, each its own figure. Missing is Not recorded, never zero. */
export function weekTiles(room) {
  const w = room?.week || null;
  const n = (k) => (w && Number.isFinite(Number(w[k])) ? String(Number(w[k])) : NOT_RECORDED);
  return [
    { k: 'Room opens', v: n('opened') },
    { k: 'Links issued', v: n('downloaded'), sub: 'A link issued is not a read.' },
    { k: 'Refused', v: n('blocked'), sub: 'Never counted as an open.' },
  ];
}

export const WAITS = {
  requests: 'Not read here yet. Access requests from the round call and the deal page are not stored in one queue yet, so none can be shown. This is not a claim that nobody asked.',
  checklist: 'Not read here yet. Which files answer each diligence item, and whether anyone can open them, needs its own read. Coverage by area is on Home.',
  preview: 'Not read here yet. Seeing the room exactly as one investor sees it needs a read that runs the investor’s own filter for that grant.',
};

export const WORKSPACE_LINE = 'Upload, gates, sharing and revoking stay in today’s files tool until this tool takes them over.';
