/**
 * D6075 (#6075, canvas DR30 of `Raise v2 Data Room · Boards`): From Google on the data room's Upload, as pure rules.
 * No React, no fetch, no clock.
 *
 * It reuses what main already serves (D1094, `services/google/raise.ts`); no route, store or migration is added:
 *   GET  /api/connectors/google-workspace/mine        the member's connection state and the files they chose
 *   GET  /api/cycles/raise/modules/data-room           `parts.google`: the chosen files, the copies, the deleted count
 *   POST /api/cycles/raise/google/sync                 copies each chosen file once (the ledger), counts back
 * A copy lands behind the NDA with access "nobody" until the founder opens it, is at most 20 MB, and counts in the
 * storage line; a copy the founder deleted stays deleted on every sync. None of that is decided here.
 */

/** The canvas's own words for a copy's source. */
export const COPY_SOURCE = 'From Google Drive';
export const COPY_ACCESS_LINE = 'Each copy lands behind the NDA and private to you (Nobody) until you open it. Up to 20 MB a copy; copies count in your storage.';
export const GOOGLE_PAGE = '/account/connectors/google_workspace';
export const COLUMNS = Object.freeze([{ key: 'name', label: 'File' }, { key: 'source', label: 'Source' }]);

const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/** "From Google Drive, as of 2026-11-14", or the source with no date when Google gave none. */
export const copySource = (asOf) => (day(asOf) ? `${COPY_SOURCE}, as of ${day(asOf)}` : `${COPY_SOURCE}, date not recorded`);

/** The rows the shared section draws: one per copy in the room. */
export const copyRows = (part) => (Array.isArray(part?.copies) ? part.copies : [])
  .filter((c) => c && c.id != null)
  .map((c) => ({ id: c.id, label: c.name || 'Untitled file', cells: { name: c.name || null, source: copySource(c.as_of) } }));

/** The data-room files this member chose for this venture, from `mine` (their numeric project id). */
export const chosenHere = (mine, projectId) => (Array.isArray(mine?.items) ? mine.items : [])
  .filter((f) => f?.module === 'data_room' && String(f.project_id) === String(projectId));

/**
 * What the section is:
 *   hidden        not connected and nothing chosen here: the option is not offered at all
 *   reading       the connection or the module is being read
 *   unreadable    the connection could not be read, or the module's Google part failed (said, never "none")
 *   revoked       the member chose files here but Google is no longer connected or allowed
 *   unavailable   connected, but this venture's Google part is not served to them (company not enabled, support session)
 *   section       connected: the shared From Google section with the copies
 */
export function googleState({ mine, module }, projectId) {
  if (!mine || mine.status === 'loading') return 'reading';
  if (mine.status === 'error') return 'unreadable';
  const state = mine.data?.state;
  const chosen = chosenHere(mine.data, projectId);
  if (state !== 'ready') return chosen.length ? 'revoked' : 'hidden';
  if (!module || module.status === 'loading') return 'reading';
  if (module.status === 'error') return 'unreadable';
  const part = module.data?.parts?.google;
  if (!part || typeof part !== 'object') return 'unavailable';
  if (part.state === 'unreadable') return 'unreadable';
  return 'section';
}

/** The revoked line: what stopped, and that the copies already in the room stay. */
export function revokedLine(state, n) {
  const why = state === 'workspace_not_allowed' ? 'Google files are no longer allowed for your account' : 'Your Google account is no longer connected';
  return `${why}, so the ${n === 1 ? 'file you chose is' : `${n} files you chose are`} not read again. Copies already in the room stay.`;
}

/**
 * A sync's counts as the shared section's Partly synced: Google's limit or a full plan stopped it before every chosen
 * file was read. Null when it finished.
 */
export function partlyOf(counts, chosen) {
  if (!counts?.partly_synced) return null;
  const read = ['copies_added', 'copies_replaced', 'copies_unchanged', 'copies_kept_deleted', 'files_unreadable']
    .reduce((n, k) => n + (Number(counts[k]) || 0), 0);
  const total = Math.max(read, Number(chosen) || 0);
  const reason = counts.stopped === 'storage_full' ? 'Your plan’s storage is full, so the rest were not copied. Open Storage to see what counts.'
    : counts.stopped === 'storage_not_configured' ? 'File storage is not set up, so the rest were not copied.'
      : 'Google’s read limit was reached. Sync again in a moment to carry on.';
  return { read, total, reason };
}

/** A sync's counts in one sentence: counts only, never a file's name or contents. */
export function syncLine(counts) {
  if (!counts) return '';
  const n = (k) => Number(counts[k]) || 0;
  const parts = [];
  if (n('copies_added')) parts.push(`${n('copies_added')} copied into the room`);
  if (n('copies_replaced')) parts.push(`${n('copies_replaced')} replaced by a newer version`);
  if (n('copies_unchanged')) parts.push(`${n('copies_unchanged')} unchanged`);
  if (n('copies_kept_deleted')) parts.push(`${n('copies_kept_deleted')} you deleted stayed deleted`);
  if (n('files_unreadable')) parts.push(`${n('files_unreadable')} could not be read`);
  return parts.length ? `${parts.join(', ')}.` : 'Nothing new in your Google files.';
}
