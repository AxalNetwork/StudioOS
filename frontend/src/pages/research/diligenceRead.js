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

/** A stored timestamp as milliseconds ("2026-11-03 09:34:00" or ISO), or null when it does not parse. */
function stamp(v) {
  if (!v) return null;
  const t = Date.parse(String(v).replace(' ', 'T'));
  return Number.isFinite(t) ? t : null;
}

/**
 * #6270 (canvas IRV-03): is this file new since the reader's previous visit?
 *
 * `true` when it was staged after `last_opened_at` (the visit before this one,
 * which the worker reads before it logs this visit). `false` when it was
 * staged before. `null` when there is nothing to compare: a first visit, or a
 * staged date that was not recorded. A null is never drawn as "New".
 */
export function stagedSinceLastVisit(createdAt, lastOpenedAt) {
  const staged = stamp(createdAt);
  const last = stamp(lastOpenedAt);
  if (staged === null || last === null) return null;
  return staged > last;
}

/**
 * #6270: where the NDA with this founder stands, from the room read's `nda`
 * (`{ status: none | out_for_signature | on_file, valid_until }`, D6267), in
 * the canvas's words (IRV-03B: No NDA, NDA out for signature, NDA signed).
 * `null` when the read did not carry it, which the page shows as Not recorded.
 */
export function roomNdaState(nda) {
  const status = nda?.status;
  if (status === 'on_file') {
    const until = day(nda.valid_until);
    return { status, label: 'NDA signed', line: until ? `An NDA with this founder is on file until ${until}.` : 'An NDA with this founder is on file, with no end date recorded.' };
  }
  if (status === 'out_for_signature') {
    return { status, label: 'NDA out for signature', line: 'Waiting for signatures. The files behind it open once every party has signed.' };
  }
  if (status === 'none') return { status, label: 'No NDA', line: 'No NDA is active between you and this founder.' };
  return null;
}

/** The folder a room file sits in, by name, or null for a file outside every listed folder. */
export function folderNameOf(folders, folderUid) {
  if (!folderUid) return null;
  const f = (Array.isArray(folders) ? folders : []).find((x) => x && x.uid === folderUid);
  return f ? f.name : null;
}

/**
 * #6270 (canvas IRV-03C): the accepted memo as a plain-text file. The body is
 * the reader's accepted text, trimmed and otherwise unchanged; the head names the company and when it
 * was accepted, and the file is named for the company and the day.
 */
export function memoExport({ company, body, acceptedAt }) {
  const name = String(company || 'room').trim() || 'room';
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'room';
  const accepted = when(acceptedAt);
  const head = `Room memo · ${name}${accepted ? ` · accepted ${accepted}` : ''}`;
  const dated = stamp(acceptedAt);
  const d = dated === null ? null : new Date(dated);
  const suffix = d ? `-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
  return { filename: `room-memo-${slug}${suffix}.txt`, text: `${head}\n\n${String(body || '').trim()}\n` };
}
