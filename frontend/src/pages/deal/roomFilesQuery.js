/** D6185: query only admitted listing files, using raw metadata solely for stable sorting (#6185). */

/** #6270: the folder filter's key for files outside every listed folder ("Not in a folder"). */
export const LOOSE_FOLDER = '__not_in_a_folder__';

/** The listed folder a file sits in, or LOOSE_FOLDER when it sits in none the listing names. */
export function folderKeyOf(listing, file) {
  const uid = file?.folder_uid;
  return uid && (listing?.folders || []).some((f) => f.uid === uid) ? uid : LOOSE_FOLDER;
}

export function roomFilesQuery(listing, rawFiles, { folder = '', q = '', sort = 'added', page = 1, grouped = false } = {}) {
  const raw = new Map((rawFiles || []).map((file) => [file.uid, file]));
  const inFolder = (f) => !folder || (folder === LOOSE_FOLDER ? folderKeyOf(listing, f) === LOOSE_FOLDER : f.folder_uid === folder);
  const files = (listing?.files || []).filter((f) => inFolder(f) && (!q.trim() || String(f.name || '').toLowerCase().includes(q.trim().toLowerCase())));
  const measured = (f) => {
    const value = sort === 'size' ? raw.get(f.uid)?.size_bytes : Date.parse(String(raw.get(f.uid)?.created_at || '').replace(' ', 'T'));
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  };
  files.sort((a, b) => {
    if (sort === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'en') || String(a.uid).localeCompare(String(b.uid));
    const av = measured(a), bv = measured(b);
    return (av == null && bv != null ? 1 : av != null && bv == null ? -1 : av != null && bv != null ? bv - av : 0) || String(a.uid).localeCompare(String(b.uid));
  });
  // #6270: grouped, the files run folder by folder in the listing's own order, files outside every
  // folder last, each group keeping the sort above (Array#sort is stable).
  if (grouped) {
    const order = new Map((listing?.folders || []).map((f, i) => [f.uid, i]));
    const rank = (f) => { const k = folderKeyOf(listing, f); return k === LOOSE_FOLDER ? order.size : order.get(k); };
    files.sort((a, b) => rank(a) - rank(b));
  }
  const pages = Math.max(1, Math.ceil(files.length / 25));
  const current = Math.min(pages, Math.max(1, Number.isSafeInteger(page) ? page : 1));
  const start = (current - 1) * 25;
  return { rows: files.slice(start, start + 25), total: files.length, pages, page: current,
    range: files.length ? `${start + 1}–${Math.min(start + 25, files.length)} of ${files.length}` : '0 of 0' };
}
