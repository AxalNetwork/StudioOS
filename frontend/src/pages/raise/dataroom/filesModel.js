/**
 * D1106 (#2986) — Data room part 5: Home, Files, the file and folder
 * lightboxes, Upload and the dialogs (DR1–DR5, DR15, DR19–DR23), as pure
 * functions, so the tests read them without a browser.
 *
 * WHO CAN OPEN A FILE is the investor reads' own rule: `dataRoomRead.js`'s
 * `accessNow` (the tier, the end date, the NDA), and then a grant's folders
 * (D1103, migration 594): a grant whose `folders` is null opens every folder;
 * one that names folders opens those and what is inside them, and never a
 * file at the room's top level; one whose scope could not be read is said so,
 * never drawn as every folder.
 *
 * EVERY CHANGE IS ASKED FIRST. Each dialog's words come from here: what
 * changes, and for a gate, an end date, a move or a folder's NDA, which
 * investors gain or lose the file. Nothing is changed by a browser pop-up.
 *
 * NOTHING HERE IS A ZERO FOR A MISSING VALUE. The last ninety days have no
 * store yet, and say so; Trash (D6073) is its own read, and a figure it does
 * not hold reads Not recorded. Storage left is Usage › Storage's own
 * read (D6074): a figure it could not read is Unreadable, one it does not
 * hold is Not recorded, never 0.
 */
import { NOT_RECORDED } from '../../../lib/absence.js';
import { accessNow, grantIsActive, noAccessReason, tierOf } from '../dataRoomRead.js';
import { day } from './dataRoomModel.js';
import { COMPARE_HREF, COMPARE_PLANS, OPEN_STORAGE, READ_FAILED, STAFF_FOOT, STORAGE_HREF, allowanceView, storageSize } from '../../account/storagePageModel.js';

export const MAX_UPLOAD_MB = 20;
export const ENDING_SOON_DAYS = 14;
const DAY_MS = 86_400_000;
export const FILE_PATH = '/raise/data-room/file';
export const fileHref = (id, search = '') => `${FILE_PATH}/${encodeURIComponent(id)}${search}`;

export const GATES = [
  { key: 'invited', label: 'Everyone invited', note: 'Every investor with an active grant to its folder.' },
  { key: 'committed', label: 'Committed only', note: 'Only investors marked committed in Capital relationships.' },
  { key: 'nobody', label: 'Private to you', note: 'No investor sees it, not even its name.' },
];
const GATE_WORD = Object.fromEntries(GATES.map((g) => [g.key, g.label]));
export const gateWord = (file) => GATE_WORD[tierOf(file)] || NOT_RECORDED;

/* ------------------------------------------------------------------ *
 * Folders and who can open a file
 * ------------------------------------------------------------------ */

const folderIndex = (room) => new Map((room?.folders || []).map((f) => [Number(f.id), f]));

/** A folder and every folder above it, as uids; empty for the top level. A loop stops the walk. */
export function folderPath(room, folderId) {
  const byId = folderIndex(room);
  const out = [];
  const seen = new Set();
  let at = folderId == null ? null : byId.get(Number(folderId));
  while (at && !seen.has(at.id)) { seen.add(at.id); out.push(at.uid); at = at.parent_id == null ? null : byId.get(Number(at.parent_id)); }
  return out;
}

/** Whether a grant's folders let it reach this file (D1103). `null` is "could not be read". */
export function inScope(room, file, grant) {
  if (grant?.folders_unreadable) return null;
  if (grant?.folders == null) return true;
  const path = folderPath(room, file?.folder_id);
  return path.some((uid) => grant.folders.includes(uid));
}

const investor = (g) => g?.investor_name || g?.investor_email || NOT_RECORDED;

/** One grant against one file, now: whether it opens it, and why not when it does not. */
export function grantOn(room, file, grant, now = Date.now()) {
  if (!grantIsActive(grant, now)) return { open: false, why: grant?.status === 'active' ? 'Access ended' : 'Access revoked' };
  const scope = inScope(room, file, grant);
  if (scope === null) return { open: false, why: 'Its folders could not be read', unreadable: true };
  if (!scope) return { open: false, why: file?.folder_id == null ? 'Its access names folders; this file is at the top level' : 'Its access does not include this folder' };
  if (accessNow(file, [grant], now).length) return { open: true, why: 'Can open' };
  if (tierOf(file) === 'nobody') return { open: false, why: 'Private to you' };
  if (tierOf(file) === 'committed' && !grant.committed) return { open: false, why: 'Not committed' };
  if (file?.visibility === 'nda' && !grant.nda_signed) return { open: false, why: 'NDA needed' };
  return { open: false, why: noAccessReason(file, [grant], now).replace(/^No investor can open this — /, '').replace(/^./, (c) => c.toUpperCase()).replace(/\.$/, '') };
}

/** The lightbox's "Who can open it now": each grant in force, opening or not, and why. */
export function whoCanOpen(room, file, now = Date.now()) {
  return (room?.grants || []).filter((g) => grantIsActive(g, now)).map((g) => ({ uid: g.uid, who: investor(g), ...grantOn(room, file, g, now) }));
}

/** The investors who open a file now, by name. */
export const openersOf = (room, file, now = Date.now()) =>
  (room?.grants || []).filter((g) => grantOn(room, file, g, now).open).map(investor);

/** Who gains and who loses at least one of these files if `change` is applied to each. */
export function gainLose(room, files, change, now = Date.now()) {
  const gain = new Set(); const lose = new Set();
  for (const f of files) {
    const before = new Set(openersOf(room, f, now));
    const after = new Set(openersOf(room, { ...f, ...change }, now));
    for (const n of after) if (!before.has(n)) gain.add(n);
    for (const n of before) if (!after.has(n)) lose.add(n);
  }
  return { gain: [...gain].sort(), lose: [...lose].sort() };
}

const names = (list) => (list.length <= 3 ? list.join(', ') : `${list.slice(0, 3).join(', ')} and ${list.length - 3} more`);
/** The dialog's line naming who gains or loses, or that nobody does. */
export function effectLine({ gain, lose }, files = 1) {
  const it = files === 1 ? 'it' : 'them';
  const parts = [];
  if (gain.length) parts.push(`${names(gain)} can open ${it} after this.`);
  if (lose.length) parts.push(`${names(lose)} can no longer open ${it}.`);
  return parts.length ? parts.join(' ') : 'No investor gains or loses access by this.';
}

/* ------------------------------------------------------------------ *
 * Files (DR2): the tree, the table, the bulk bar
 * ------------------------------------------------------------------ */

/** The tree, flattened in the order it is drawn: each folder with its depth and the files under it, subfolders included. */
export function treeRows(room) {
  const folders = room?.folders || [];
  const files = room?.files || [];
  const byParent = new Map();
  const known = new Set(folders.map((f) => Number(f.id)));
  for (const f of folders) {
    // A parent that is gone puts its child at the top, never out of sight.
    const p = f.parent_id != null && known.has(Number(f.parent_id)) ? Number(f.parent_id) : null;
    byParent.set(p, [...(byParent.get(p) || []), f]);
  }
  const under = (id) => files.filter((x) => folderPath(room, x.folder_id).includes(folders.find((f) => Number(f.id) === id)?.uid)).length;
  const out = [];
  const seen = new Set();
  const walk = (parent, depth) => {
    for (const f of (byParent.get(parent) || []).slice().sort((a, b) => (Number(a.display_order) || 0) - (Number(b.display_order) || 0) || String(a.name).localeCompare(String(b.name)))) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      out.push({ uid: f.uid, id: Number(f.id), name: f.name, depth, files: under(Number(f.id)), nda: f.visibility === 'nda', children: (byParent.get(Number(f.id)) || []).length });
      walk(Number(f.id), depth + 1);
    }
  };
  walk(null, 0);
  const top = files.filter((x) => x.folder_id == null || !known.has(Number(x.folder_id))).length;
  return { all: files.length, top, folders: out };
}

/** The table's rows for the folder chosen (`all`, `top` or a folder uid) and the search. */
export function tableRows(room, { folder = 'all', q = '' } = {}, now = Date.now()) {
  const byId = folderIndex(room);
  const needle = String(q || '').trim().toLowerCase();
  return (room?.files || [])
    .filter((f) => {
      if (folder === 'all') return true;
      if (folder === 'top') return f.folder_id == null || !byId.has(Number(f.folder_id));
      return folderPath(room, f.folder_id).includes(folder);
    })
    .filter((f) => !needle || String(f.name || '').toLowerCase().includes(needle))
    .map((f) => {
      const opens = openersOf(room, f, now);
      return {
        uid: f.uid, id: f.id, name: f.name,
        folder: byId.get(Number(f.folder_id))?.name || 'Top level',
        gate: gateWord(f),
        nda: f.visibility === 'nda',
        until: f.access_expires_at ? day(f.access_expires_at) : 'No end date',
        links: f.downloads == null ? NOT_RECORDED : String(Number(f.downloads)),
        opens: opens.length ? `${opens.length} investor${opens.length === 1 ? '' : 's'}` : 'No one',
        why: opens.length ? '' : noOneWhy(room, f, now),
      };
    });
}

/** Why no investor opens a file now, with the folder scope taken into account. */
function noOneWhy(room, f, now) {
  const live = (room?.grants || []).filter((g) => grantIsActive(g, now));
  if (live.length && live.every((g) => inScope(room, f, g) === false)) return 'No investor’s access includes this folder.';
  return noAccessReason(f, room?.grants || [], now).replace(/^No investor can open this — /, '').replace(/^./, (c) => c.toUpperCase());
}

/** The folder choices a move or an upload offers: the top level, then each folder by its path. */
export function folderChoices(room) {
  const { folders } = treeRows(room);
  return [{ value: '', label: 'Top level' }, ...folders.map((f) => ({ value: f.uid, label: `${'  '.repeat(f.depth)}${f.name}` }))];
}

/* ------------------------------------------------------------------ *
 * The dialogs: each says what it changes before it saves
 * ------------------------------------------------------------------ */

const many = (files) => (files.length === 1 ? files[0].name : `${files.length} files`);

export const OWNER_ONLY = 'Only the venture’s owner changes a gate or removes a file. You can still move, rename and match files, and restore from Trash.';

/** Moving keeps each file's own gate; a grant limited to folders may gain or lose it. */
export function moveCopy(room, files, folderUid, now = Date.now()) {
  const target = folderUid ? (room?.folders || []).find((f) => f.uid === folderUid) : null;
  const where = target ? target.name : 'the top level';
  const change = { folder_id: target ? target.id : null };
  return {
    title: `Move ${many(files)} to ${where}?`,
    body: `Each file keeps its own gate. ${effectLine(gainLose(room, files, change, now), files.length)}`,
    action: 'Move', patch: { folder_uid: folderUid || null },
  };
}

/** A gate: who it is for, and whether it needs the NDA. */
export function gateCopy(room, files, { tier, nda }, now = Date.now()) {
  const change = { ...(tier ? { access_tier: tier } : {}), ...(nda == null ? {} : { visibility: nda ? 'nda' : 'open' }) };
  const what = [tier ? `“${GATE_WORD[tier]}”` : null, nda == null ? null : nda ? 'needing the NDA' : 'with no NDA'].filter(Boolean).join(', ');
  return {
    title: `Set ${many(files)} to ${what}?`,
    body: effectLine(gainLose(room, files, change, now), files.length),
    action: 'Set gate', patch: change,
  };
}

/** An end date: a day, today or later, or none. */
export function endCopy(room, files, until, now = Date.now()) {
  const change = { access_expires_at: until || null };
  return {
    title: until ? `End access to ${many(files)} on ${day(until)}?` : `Remove the end date from ${many(files)}?`,
    body: `${until ? 'Investors can open it through that day; after it, no one can.' : 'Access then lasts as long as each grant does.'} ${effectLine(gainLose(room, files, change, now), files.length)}`,
    action: until ? 'Set end date' : 'Remove end date', patch: change,
  };
}

/** Matching to a request or a checklist item changes what the file answers, never who can open it. */
export function matchCopy(files, label) {
  return { title: `Mark ${many(files)} as answering ${label}?`, body: 'Who can open it does not change. Checklist coverage on Home counts it.', action: 'Match' };
}

/**
 * Remove (DR28, D6073): the files go to Trash for 30 days (owner answer 8 of
 * D1101). Investors stop seeing them at once; Restore brings each back with its
 * folder, gate and versions until the day named here.
 */
export const TRASH_DAYS = 30;
export function removeCopy(files, earlier = null, { room = null, now = Date.now() } = {}) {
  const versions = earlier == null ? ' and every earlier version' : earlier ? ` and its ${earlier} earlier version${earlier === 1 ? '' : 's'}` : '';
  const them = files.length === 1 ? 'it' : 'them';
  const byId = folderIndex(room);
  const folders = [...new Set(files.map((f) => byId.get(Number(f.folder_id))?.name || 'Top level'))];
  return {
    title: `Remove ${many(files)}?`,
    body: `Moves ${many(files)}${versions} to Trash for ${TRASH_DAYS} days. Investors stop seeing ${them} now. Copies already saved are not recalled.`,
    facts: [
      { k: 'Folder', v: folders.length === 1 ? folders[0] : `${folders.length} folders` },
      { k: 'Restorable until', v: day(new Date(now + TRASH_DAYS * DAY_MS).toISOString()) },
    ],
    trash: `Restore brings ${them} back with ${files.length === 1 ? 'its' : 'their'} folder, gate and versions. After ${TRASH_DAYS} days ${them === 'it' ? 'it is' : 'they are'} deleted for good.`,
    action: 'Move to Trash',
  };
}

/* ------------------------------------------------------------------ *
 * Trash (DR28, D6073)
 * ------------------------------------------------------------------ */

export const TRASH_NOTE = `Removed files stay here for ${TRASH_DAYS} days, then they are deleted. Investors cannot see them.`;
export const TRASH_EMPTY = { title: 'Trash is empty.', sub: `Removed files stay here for ${TRASH_DAYS} days.` };
export const TRASH_UNREADABLE = 'Trash could not be read. Files still work. Nothing in Trash was changed.';
export const DRIVE_TRASH = 'Restoring keeps it here; Google Drive will not copy it again. Until you restore it, a copy you deleted stays deleted, even when Google’s file changes.';

/** The foot under the list: what Restore keeps, and who deletes now. */
export const trashFoot = (canDeleteNow) => 'Restore brings back the file’s folder, gate, tier, versions and checklist match. A file whose folder was deleted returns to Top level and says so. '
  + (canDeleteNow ? 'Only you, the room’s owner, can Delete now.' : 'Co-founders restore; only the room’s owner can Delete now.');

/** The Trash read as rows. A day, a remover or days left nobody recorded says so. */
export function trashRows(read) {
  return (read?.items || []).map((t) => ({
    uid: t.uid, name: t.name,
    folder: t.folder || 'Top level',
    returns: t.folder_gone ? 'returns to Top level' : '',
    removed: t.removed_at ? day(t.removed_at) : NOT_RECORDED,
    by: t.removed_by_name || NOT_RECORDED,
    left: Number.isSafeInteger(t.days_left) ? `${t.days_left} day${t.days_left === 1 ? '' : 's'} left` : NOT_RECORDED,
    days: Number.isSafeInteger(t.days_left) ? t.days_left : null,
    versions: Number.isSafeInteger(t.earlier_versions) ? t.earlier_versions : null,
    drive: t.source_ref === 'google_drive',
  }));
}

/** The line after a Restore: where the file is now. */
export const restoredLine = (name, out) => (out?.returned_to_top_level
  ? `${name} is back, at the top level: its folder was deleted.`
  : `${name} is back in its folder, with its gate and versions.`);
/** A Restore that did not go through: the file is still in Trash. */
export const restoreFailed = (row) => `Restore did not go through. ${row.name} is still in Trash${row.days == null ? '' : ` with ${row.left}`}.`;

/** Delete now, in two steps (Scope, then Review), and the result line. */
export function deleteNowCopy(row) {
  const v = row.versions == null ? 'Its earlier versions go with it.' : row.versions ? `Its ${row.versions} earlier version${row.versions === 1 ? '' : 's'} go${row.versions === 1 ? 'es' : ''} with it.` : 'It has no earlier version.';
  return {
    scope: { title: `Delete ${row.name} now?`, body: `Delete now: ${row.name} from Trash. One file. ${v}`, action: 'Continue' },
    review: {
      title: `Delete ${row.name} now?`,
      body: `This cannot be undone. The file and its versions are deleted now${row.days == null ? '' : ` instead of in ${row.days} day${row.days === 1 ? '' : 's'}`}. Restore will no longer be offered.`,
      action: 'Delete now',
    },
    done: (left) => `Deleted. ${row.name} and its versions are gone.${Number.isSafeInteger(left) ? ` Trash holds ${left} file${left === 1 ? '' : 's'}.` : ''}`,
  };
}

/** Make current (DR15): a swap; nothing is lost, and the count of versions stays the same. */
export function makeCurrentCopy(file, version) {
  return {
    title: `Make version ${version} of ${file?.name || 'this file'} current?`,
    body: 'Investors who can open the file get this version from now on. The version that is current now is kept as an earlier version; nothing is lost.',
    action: 'Make current',
  };
}

/** Rename: the name investors see. */
export const renameCopy = (what, from) => ({ title: `Rename ${from}?`, body: `Investors who can open ${what === 'folder' ? 'it' : 'the file'} see the new name.`, action: 'Rename' });

/* ------------------------------------------------------------------ *
 * Folders (DR5)
 * ------------------------------------------------------------------ */

/** A folder's NDA switch, set on the folder alone or on everything inside it. */
export function folderNdaCopy(room, folder, nda, applyInside, now = Date.now()) {
  const inside = (room?.files || []).filter((f) => folderPath(room, f.folder_id).includes(folder.uid));
  const effect = applyInside ? effectLine(gainLose(room, inside, { visibility: nda ? 'nda' : 'open' }, now), inside.length) : 'Each file keeps its own gate, which is what the download checks; files added here later take this folder’s.';
  return {
    title: nda ? `Ask for an NDA on ${folder.name}?` : `Stop asking for an NDA on ${folder.name}?`,
    body: applyInside ? `Every folder and file inside is set the same (${inside.length} file${inside.length === 1 ? '' : 's'}). ${effect}` : effect,
    action: nda ? 'Ask for the NDA' : 'Stop asking',
    patch: { visibility: nda ? 'nda' : 'open', apply_to_contents: !!applyInside },
  };
}

/**
 * Delete a folder. Its files land at the top level and nothing is deleted. A
 * folder with folders inside is not deleted here: whether its subfolders go
 * with it depends on the database's foreign keys, so the page cannot say.
 */
export function deleteFolderCopy(room, folder, now = Date.now()) {
  const kids = (room?.folders || []).filter((f) => Number(f.parent_id) === Number(folder.id));
  if (kids.length) return { blocked: `${folder.name} has ${kids.length} folder${kids.length === 1 ? '' : 's'} inside. Move or delete ${kids.length === 1 ? 'it' : 'them'} first.` };
  const inside = (room?.files || []).filter((f) => Number(f.folder_id) === Number(folder.id));
  const lost = (room?.grants || []).filter((g) => grantIsActive(g, now) && Array.isArray(g.folders) && g.folders.includes(folder.uid) && g.folders.length === 1).map(investor);
  return {
    title: `Delete ${folder.name}?`,
    body: `Its ${inside.length} file${inside.length === 1 ? '' : 's'} move${inside.length === 1 ? 's' : ''} to the top level. Nothing is deleted.${lost.length ? ` ${names(lost)}, whose access names only this folder, then open${lost.length === 1 ? 's' : ''} nothing.` : ''}`,
    action: 'Delete folder',
  };
}

/* ------------------------------------------------------------------ *
 * Upload (DR4)
 * ------------------------------------------------------------------ */

/** A picked file's place in the queue: waiting, or refused before sending. */
export function queueEntry(file, i) {
  const big = file.size > MAX_UPLOAD_MB * 1024 * 1024;
  return { key: `${i}-${file.name}`, name: file.name, size: sizeText(file.size), bytes: Number(file.size), state: big ? 'refused' : 'waiting', why: big ? `Refused: larger than ${MAX_UPLOAD_MB} MB` : '' };
}
export const QUEUE_WORDS = { waiting: '○ Waiting', sending: '⇪ Sending', done: '✓ In the room', refused: '✕ Refused' };

/** A Worker refusal, as one sentence. */
export function uploadRefusal(error) {
  const status = Number(error?.status);
  // D1171 (STG4): the plan's storage is full. The sentence is the shared one,
  // drawn by `StorageRefusal` under the file, the same as in Messages and
  // Record a Session; this is its short form for the queue.
  if (error?.code === 'storage_full') return 'Refused: no room left on the storage plan';
  if (status === 413) return `Refused: larger than ${MAX_UPLOAD_MB} MB`;
  if (status === 403 && error?.code === 'owner_only') return 'Refused: only the owner sets a gate';
  if (status === 503) return 'Refused: storage is not configured here';
  if (status === 404) return 'Refused: that folder no longer exists';
  return 'Refused: the upload did not go through';
}

export function sizeText(bytes) {
  const n = Number(bytes);
  if (bytes == null || !Number.isFinite(n) || n < 0) return NOT_RECORDED;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The room's own count: what its current files hold. Earlier versions are not
 * in the room read, so they are not totalled here; the plan's total, which
 * counts them, is `uploadStorage` below.
 */
export function storageLine(room) {
  const sizes = (room?.files || []).map((f) => f.size_bytes);
  const known = sizes.filter((s) => s != null && Number.isFinite(Number(s)));
  const total = known.reduce((t, s) => t + Number(s), 0);
  const counted = known.length === sizes.length ? sizeText(total) : `${sizeText(total)} over the ${known.length} of ${sizes.length} files whose size is recorded`;
  return `This room’s current files: ${counted}. Earlier versions are not totalled here. Each file can be up to ${MAX_UPLOAD_MB} MB.`;
}

/**
 * D6074 (#6074) — DR4s and DR23 on Upload: storage used and left on the plan
 * these files count to, from the same read as Usage › Storage
 * (`usageApi.storage`, D642 as D1169 grew it), through that page's own
 * `allowanceView`, so the two never disagree. `read` is `{ status: 'loading' }`,
 * `{ status: 'ready', data }` or `{ status: 'error' }`.
 *
 * A data room file counts to the venture's owner (D1170 §2). The read is the
 * caller's own plan, and its `companies[].ventures` lists the ventures whose
 * files count to the caller, so a room not in that list counts to someone
 * else's plan and no figure of the caller's is drawn for it.
 *
 * Only a `meter` view, a figure measured against an allowance, can refuse a
 * queue (`queueStorage`). Unreadable, Not recorded, staff and another
 * member's plan never block: the Worker's own refusal at upload (D1170/D1171)
 * still answers for those.
 *
 * Near the limit is the Worker's own `state` (`near_80`, `near_95`: 80% and
 * 95% of the allowance, `storageState` in `services/storageUsage.ts`), the
 * same that draws Usage › Storage's "Near your limit" pill and notice.
 */
const isCount = (n) => Number.isSafeInteger(n) && n >= 0;
export const STORAGE_UNREADABLE = `Storage left: Unreadable. ${READ_FAILED} You can still add files.`;
export function uploadStorage(read, projectUid) {
  if (!read || read.status === 'loading') return { mode: 'loading', line: 'Reading your storage…' };
  const s = read.status === 'ready' && read.data && typeof read.data === 'object' ? read.data : null;
  const unreadable = { mode: 'unreadable', line: STORAGE_UNREADABLE };
  const v = s ? allowanceView(s, null) : null;
  if (!v) return unreadable;
  // Staff pass the Worker's guard whoever's room it is (D1170 §1).
  if (v.mode === 'staff') return { mode: 'none', line: `Storage left: Not recorded. ${STAFF_FOOT}` };
  if (!Array.isArray(s.companies)) return unreadable; // whose plan this is could not be read
  const ours = s.companies.some((c) => (Array.isArray(c?.ventures) ? c.ventures : []).some((x) => x?.uid && x.uid === projectUid));
  if (!ours) return { mode: 'elsewhere', line: 'Files added here count to the company owner’s storage, which is not shown to you. If it is full, the room refuses a file when it is sent.' };
  if (v.mode === 'unread' || s.plan_recorded === false) return unreadable;
  if (v.mode !== 'meter') return { mode: 'none', line: `Storage left: Not recorded. ${v.reason}` };
  const used = s.measured_bytes;
  const allowance = s.allowance_bytes;
  const near = v.state === 'near_80' || v.state === 'near_95';
  const full = used >= allowance;
  return {
    mode: 'meter', used, allowance, left: Math.max(0, allowance - used),
    line: `Storage: ${v.used} of ${v.allowance} used · ${v.side}.${v.pending ? ` ${v.pending}` : ''}`,
    tone: full ? 'red' : near ? 'amber' : 'muted',
    // DR23: the amber line, in the canvas's words, with its one door.
    near: near ? { text: `Your files use ${v.used} of ${v.allowance}. Versions count too.`, link: { label: OPEN_STORAGE, to: STORAGE_HREF } } : null,
  };
}

/**
 * DR4s, before anything is sent: the waiting files' total against what is
 * left, by the Worker's own rule (`assertStorageRoom`: used plus the file
 * passes the allowance, or nothing is left for an empty file). Null when the
 * queue fits, or when the figure is not a meter. The refusal has the shape
 * `StorageRefusal` draws, with the doors to Usage › Storage and the plans.
 */
export function queueStorage(view, queue) {
  if (view?.mode !== 'meter') return null;
  const waiting = (queue || []).filter((x) => x?.state === 'waiting');
  if (!waiting.length) return null;
  const need = waiting.reduce((t, x) => t + (isCount(x.bytes) ? x.bytes : 0), 0);
  if (view.used + need <= view.allowance && !(need === 0 && view.used >= view.allowance)) return null;
  const n = waiting.length;
  const text = view.left === 0
    ? 'Storage full. Nothing new can be stored until you free up space or change plan. Everything you stored stays.'
    : `${n === 1 ? 'This file needs' : `These ${n} files need`} ${storageSize(need)}. You have ${storageSize(view.left)} left on your plan. Nothing was sent; remove ${n === 1 ? 'it' : 'some'} or make room first.`;
  return { text, yours: true, full: view.left === 0, need, links: [{ label: OPEN_STORAGE, to: STORAGE_HREF }, { label: COMPARE_PLANS, to: COMPARE_HREF }] };
}

/* ------------------------------------------------------------------ *
 * Home (DR1)
 * ------------------------------------------------------------------ */

/** Needs you: what the room holds that waits on the founder. Each row is a real count. */
export function needsYou(room, now = Date.now()) {
  const rows = [];
  const files = room?.files || [];
  const live = (room?.grants || []).filter((g) => grantIsActive(g, now));
  const shut = files.filter((f) => tierOf(f) !== 'nobody' && !openersOf(room, f, now).length);
  if (live.length && shut.length) rows.push({ key: 'shut', text: `${shut.length} file${shut.length === 1 ? '' : 's'} no investor can open now`, sub: 'Each file’s row on Files says why.', to: 'files' });
  const soon = live.filter((g) => g.expires_at && Date.parse(String(g.expires_at).replace(' ', 'T') + (/T|Z/.test(String(g.expires_at)) ? '' : 'T00:00:00Z')) - now <= ENDING_SOON_DAYS * DAY_MS);
  for (const g of soon) rows.push({ key: `end-${g.uid}`, text: `${investor(g)}’s access ends ${day(g.expires_at)}`, sub: 'Change the end date on Access.', to: 'access' });
  const ndaFiles = files.filter((f) => f.visibility === 'nda').length;
  const noNda = live.filter((g) => !g.nda_signed);
  if (ndaFiles && noNda.length) rows.push({ key: 'nda', text: `${noNda.length} investor${noNda.length === 1 ? '' : 's'} need${noNda.length === 1 ? 's' : ''} an NDA to open ${ndaFiles} file${ndaFiles === 1 ? '' : 's'}`, sub: names(noNda.map(investor)), to: 'access' });
  const blind = live.filter((g) => g.folders_unreadable);
  if (blind.length) rows.push({ key: 'scope', text: `${blind.length} grant${blind.length === 1 ? '’s' : 's’'} folders could not be read`, sub: 'Who they open is not known until it is read again.', to: 'access', bad: true });
  return rows;
}
/**
 * D1284 (#3342) — Needs you's access requests, from D1104's queue
 * (`dataRoomApi.requests`): how many are open, and whether they are the
 * caller's to answer (`can_answer`, the venture's owner). A reply with no
 * count is unreadable, never "none".
 */
export function requestsNeed(read) {
  const open = read?.open;
  if (!Number.isSafeInteger(open) || open < 0) return { state: 'unreadable' };
  if (open === 0) return { state: 'none', text: 'No access request waits.' };
  const n = `${open} access request${open === 1 ? '' : 's'}`;
  return read.can_answer === true
    ? { state: 'open', text: `${n} wait${open === 1 ? 's' : ''} for your answer`, sub: 'Share the room or decline, on Requests.' }
    : { state: 'open', text: `${n} open`, sub: 'The venture’s owner answers them. You can read them on Requests.' };
}
export const ACTIVITY_NOTE = 'Daily opens, downloads and blocked requests, the last fifty events, and this week’s counts are on Activity.';

/** Who has access: every grant in force, with its end, NDA and folders. */
export function accessRows(room, now = Date.now()) {
  const byUid = new Map((room?.folders || []).map((f) => [f.uid, f.name]));
  return (room?.grants || []).filter((g) => grantIsActive(g, now)).map((g) => ({
    uid: g.uid, who: investor(g),
    until: g.expires_at ? day(g.expires_at) : 'No end date',
    nda: g.nda_signed ? 'NDA signed' : 'NDA needed',
    folders: g.folders_unreadable ? 'Folders could not be read' : g.folders == null ? 'Every folder' : g.folders.length ? g.folders.map((u) => byUid.get(u) || 'a folder since deleted').join(', ') : 'No folders',
  }));
}

/** What was added: the newest files first. */
export function recentFiles(room, n = 5) {
  const byId = folderIndex(room);
  return (room?.files || []).slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || Number(b.id) - Number(a.id))
    .slice(0, n).map((f) => ({ id: f.id, uid: f.uid, name: f.name, folder: byId.get(Number(f.folder_id))?.name || 'Top level', when: f.created_at ? day(f.created_at) : NOT_RECORDED }));
}

/** The room's counts for the bar under the tabs (DR1's chips). Requests wait for part 3. */
export function roomChips(room, now = Date.now()) {
  const files = (room?.files || []).length;
  const folders = (room?.folders || []).length;
  const live = (room?.grants || []).filter((g) => grantIsActive(g, now)).length;
  return [`${files} file${files === 1 ? '' : 's'} · ${folders} folder${folders === 1 ? '' : 's'}`, `${live} investor${live === 1 ? '' : 's'} with access`];
}

/* ------------------------------------------------------------------ *
 * The file lightbox (DR3): what the record read adds
 * ------------------------------------------------------------------ */

/** What the file answers, from its record's facts; null when nothing is matched. */
export function answersOf(record) {
  const fact = (record?.facts || []).find((f) => f?.k === 'Answers' || f?.label === 'Answers');
  const v = fact?.v ?? fact?.value ?? null;
  return v && typeof v === 'string' ? v : null;
}

/** Links issued and refusals, from the record's "Who opened it" section; never a view. */
export function linkRows(record) {
  const sec = (record?.sections || []).find((s) => s?.key === 'opened');
  return (sec?.rows || []).filter((r) => r?.c === 'Downloaded' || r?.c === 'Blocked')
    .map((r) => ({ who: r.a, what: r.c === 'Downloaded' ? 'Link issued' : 'Refused', when: r.b }));
}

/** The versions read as rows: the current first; a size or an uploader nobody recorded says so. */
export function versionRows(read) {
  const all = [read?.current, ...(read?.versions || [])].filter(Boolean);
  return all.map((v, i) => ({
    version: Number(v.version), current: i === 0,
    when: v.created_at ? day(v.created_at) : NOT_RECORDED,
    who: v.uploaded_by_name || NOT_RECORDED,
    size: sizeText(v.size_bytes),
  }));
}
