/**
 * The small pure pieces the diligence room and document pages share.
 *
 * Kept out of the pages so the artboard-contract tests can run them in Node:
 * a size is formatted from bytes at the edge (canvas 96463a46: "so the header
 * and the tile cannot disagree"), and a missing byte count is not a size of
 * zero.
 */

/** Bytes as the canvas writes them, or null when the room did not record a size. */
export function fileSize(bytes) {
  if (bytes === null || bytes === undefined || bytes === '') return null;
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** A date as the canvases write it ("12 Aug 2026"), or null for nothing. */
export function day(v) {
  if (!v) return null;
  const t = new Date(v);
  return Number.isNaN(t.getTime())
    ? String(v)
    : t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** A date and time ("12 Aug 2026, 14:20"), or null for nothing. */
export function when(v) {
  if (!v) return null;
  const t = new Date(v);
  return Number.isNaN(t.getTime())
    ? String(v)
    : `${day(v)}, ${t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * Which of the room canvas's three file states applies.
 *
 * `open` — something is listed. `all_withheld` — the room holds files and every
 * one is behind an NDA the reader has not signed. `empty` — nothing staged.
 * The last two are different findings and must not share a sentence.
 */
export function roomFileState(room) {
  if (!room) return null;
  if (room.file_open > 0) return 'open';
  return room.file_total > 0 ? 'all_withheld' : 'empty';
}

/** What an activity line says, with a withheld file's name kept out of it. */
export function activityLine(a) {
  const verb = a.action === 'open_room' ? 'Opened the room'
    : a.action === 'download' ? 'Download link issued'
      : a.action;
  if (a.action === 'open_room') return { verb, what: null };
  if (a.file_withheld) return { verb, what: 'a document now behind an NDA' };
  if (a.file_removed) return { verb, what: 'a document no longer in the room' };
  return { verb, what: a.file_name || null };
}
