/** D6185: query only admitted listing files, using raw metadata solely for stable sorting (#6185). */
export function roomFilesQuery(listing, rawFiles, { folder = '', q = '', sort = 'added', page = 1 } = {}) {
  const raw = new Map((rawFiles || []).map((file) => [file.uid, file]));
  const files = (listing?.files || []).filter((f) => (!folder || f.folder_uid === folder) && (!q.trim() || String(f.name || '').toLowerCase().includes(q.trim().toLowerCase())));
  const measured = (f) => {
    const value = sort === 'size' ? raw.get(f.uid)?.size_bytes : Date.parse(String(raw.get(f.uid)?.created_at || '').replace(' ', 'T'));
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  };
  files.sort((a, b) => {
    if (sort === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'en') || String(a.uid).localeCompare(String(b.uid));
    const av = measured(a), bv = measured(b);
    return (av == null && bv != null ? 1 : av != null && bv == null ? -1 : av != null && bv != null ? bv - av : 0) || String(a.uid).localeCompare(String(b.uid));
  });
  const pages = Math.max(1, Math.ceil(files.length / 25));
  const current = Math.min(pages, Math.max(1, Number.isSafeInteger(page) ? page : 1));
  const start = (current - 1) * 25;
  return { rows: files.slice(start, start + 25), total: files.length, pages, page: current,
    range: files.length ? `${start + 1}–${Math.min(start + 25, files.length)} of ${files.length}` : '0 of 0' };
}
