/**
 * D1108 (#2988) — Preview's derivations (DR13, DR13e), kept pure, from D1103's
 * read `GET /api/data-room/:projectUid/preview?grant=` (`dataRoomApi.preview`).
 *
 * THE ROOM EXACTLY AS ONE INVESTOR SEES IT. The Worker runs the investor read's
 * own filter (`investorView`) for that grant, so every folder and file drawn
 * here is one that investor can see. Nothing outside the read's `folders` and
 * `files` is ever named: what the NDA withholds and what the tier, end date or
 * folders hide come back as counts and are drawn as counts. The founder's own
 * room read only supplies the list of grants to view as, and how many folders
 * the investor does not see, never their names.
 *
 * A REVOKED OR ENDED GRANT opens nothing (`open: false`): DR13e draws only the
 * sentence that investor reads, with no folder or file named.
 *
 * Preview writes nothing and logs nothing: a founder looking is not the
 * investor opening the room.
 */

import { NOT_RECORDED } from '../../../lib/absence.js';
import { grantIsActive } from '../dataRoomRead.js';
import { day } from './dataRoomModel.js';

const plural = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/** The grants to view as: in force first, each with what ended it. */
export function viewAsOptions(room, now = Date.now()) {
  const grants = Array.isArray(room?.grants) ? room.grants : [];
  return grants
    .map((g) => {
      const live = grantIsActive(g, now);
      const who = g.investor_name || g.investor_email || NOT_RECORDED;
      const ended = live ? null : g.status === 'active' ? `access ended ${day(g.expires_at)}` : 'access revoked';
      return { uid: g.uid, who, live, label: ended ? `${who} · ${ended}` : who, committed: !!g.committed };
    })
    .sort((a, b) => Number(b.live) - Number(a.live));
}

/** The line every preview opens with. */
export const infoLine = (who) => `Preview. This is what ${who} sees today. Nothing here is logged or sent.`;

/** DR13e: what an investor whose access ended or was revoked sees. */
export function endedView(who) {
  return {
    title: 'The founder has not opened their data room to you.',
    line: `This is all ${who} sees. No folder or file is named.`,
  };
}

/**
 * DR13: the room as the investor's deal page draws it, from the preview read
 * alone. `roomFolders` is how many folders the founder's room has; only the
 * difference is used, as a count.
 */
export function previewView(preview, { who = NOT_RECORDED, committed = false, roomFolders = null } = {}) {
  if (!preview || preview.open === false) return { open: false, ...endedView(who) };
  const folders = Array.isArray(preview.folders) ? preview.folders : [];
  const files = Array.isArray(preview.files) ? preview.files : [];
  const withheld = Number(preview.withheld_behind_nda) || 0;
  const hidden = Number(preview.hidden_from_grant) || 0;
  const count = (folderUid) => files.filter((f) => (f.folder_uid ?? null) === folderUid).length;
  const groups = [
    { uid: null, name: 'Top level', files: files.filter((f) => (f.folder_uid ?? null) === null).map((f) => f.name) },
    ...folders.map((f) => ({ uid: f.uid, name: f.name, files: files.filter((x) => x.folder_uid === f.uid).map((x) => x.name) })),
  ].filter((g) => g.uid !== null || g.files.length)
    .map((g) => ({ ...g, count: plural(count(g.uid), 'file') }));
  const banner = withheld && !preview.nda_signed
    ? `You have access. ${plural(withheld, 'file needs', 'files need')} your NDA.`
    : 'You have access.';
  const margin = [];
  if (hidden) margin.push(`${plural(hidden, 'file is', 'files are')} not shown: their tier, end date or folders keep ${who} out. They are not named.`);
  if (withheld) margin.push(`${plural(withheld, 'file sits', 'files sit')} behind the NDA, so ${withheld === 1 ? 'its name is' : 'their names are'} not shown to ${who}.`);
  const notShown = Number.isFinite(Number(roomFolders)) ? Math.max(0, Number(roomFolders) - folders.length) : 0;
  if (notShown) margin.push(`${plural(notShown, 'folder is', 'folders are')} not shown to ${who}, so ${notShown === 1 ? 'it is' : 'they are'} not named.`);
  if (committed) margin.push(`Committed only files show because ${who} is committed.`);
  return {
    open: true,
    room: preview.project?.name || NOT_RECORDED,
    banner,
    groups,
    withheld: withheld ? { title: `${plural(withheld, 'file needs', 'files need')} your NDA`, sub: 'Their names show once you sign.' } : null,
    margin,
    empty: !files.length && !withheld,
  };
}
