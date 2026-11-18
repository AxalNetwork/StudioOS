/**
 * D7168 (#7168) — My funds and the fund dossier: the readings their tests run
 * in Node. The Directory's map by catalogue uid, the count strip's scope, the
 * page line, the identity chip, the dossier's per-field drafts and what a save
 * refreshes, and the conflict's "Combine both".
 *
 * IDENTITY IS NEVER A NAME. "Atlas A-I" and "Atlas AI" normalise to the same
 * letters, and the old map opened one dossier for both. A directory vehicle
 * opens the entry linked to its catalogue uid, or none; a legacy entry is
 * never matched by name.
 *
 * A SAVE REFRESHES ONLY WHAT IT SENT, and the fields that were not being
 * edited. The page used to reset every box from the stored row after any
 * save, so changing the stage discarded the note being typed (FND-S04).
 */

/** The page size the list reads, and the most the Worker gives. */
export const MY_FUNDS_PAGE = 50;

/**
 * The founder's own entry for each directory vehicle, by catalogue uid → uid:
 * the Worker's `catalogue_links` (every linked row, whatever the page), then
 * any row an Add just created that the list has not caught up with.
 */
export function dossierMap(links, created = {}) {
  const byCatalogue = new Map();
  for (const link of links || []) {
    if (link?.catalogue_uid && !byCatalogue.has(link.catalogue_uid)) byCatalogue.set(link.catalogue_uid, link.uid);
  }
  for (const [catalogueUid, uid] of Object.entries(created || {})) {
    if (!byCatalogue.has(catalogueUid)) byCatalogue.set(catalogueUid, uid);
  }
  return byCatalogue;
}

const n = (v) => Number(v || 0).toLocaleString('en-US');

/**
 * What the count strip says it counts. A Worker that answers `counts_scope:
 * 'all_saved'` counted every saved fund; one that does not is the old newest-500
 * read, and the strip says so rather than letting 500 pass for everything.
 */
export function countScopeLine(data) {
  if (!data) return null;
  if (data.counts_scope === 'all_saved') {
    return `Counted over all ${n(data.saved_count)} funds you saved, whatever the page or filter.`;
  }
  return 'Counted over your 500 most recently saved funds.';
}

/** "Showing 1–50 of 1,284 · Page 1 of 26", or null with nothing to page. */
export function pageLine(total, limit, offset) {
  const t = Number(total || 0);
  if (!t) return null;
  const size = Math.max(1, Number(limit || MY_FUNDS_PAGE));
  const from = Math.min(t, Number(offset || 0) + 1);
  const to = Math.min(t, Number(offset || 0) + size);
  const page = Math.floor(Number(offset || 0) / size) + 1;
  const pages = Math.max(1, Math.ceil(t / size));
  return { from, to, total: t, page, pages, text: `Showing ${n(from)}–${n(to)} of ${n(t)}`, pageText: `Page ${page} of ${pages}` };
}

/** The offset a page number names, clamped to the pages there are. */
export function offsetOf(page, total, limit = MY_FUNDS_PAGE) {
  const pages = Math.max(1, Math.ceil(Number(total || 0) / limit));
  const p = Math.min(Math.max(1, Math.floor(Number(page) || 1)), pages);
  return (p - 1) * limit;
}

/** The identity chip a row shows: a linked catalogue record, your own record, or a legacy entry that needs a choice. */
export function identityChip(fund) {
  const identity = fund?.identity || (fund?.catalogue_uid ? 'linked' : 'legacy');
  if (identity === 'linked') return { kind: 'linked', label: `Catalogue · ${fund.catalogue_uid}` };
  if (identity === 'own') return { kind: 'own', label: 'Your own record' };
  return { kind: 'legacy', label: 'Needs a choice' };
}

const usdText = (cents) => (cents == null ? '' : `$${Math.round(Number(cents) / 100).toLocaleString('en-US')}`);

/** The dossier's editable fields, and how each stored value reads in its box. */
export const DRAFT_FIELDS = {
  note: { column: 'note', label: 'note', read: (r) => r?.note || '' },
  thesis: { column: 'thesis', label: 'thesis', read: (r) => r?.thesis || '' },
  pass_reason: { column: 'pass_reason', label: 'pass reason', read: (r) => r?.pass_reason || '' },
  source_url: { column: 'source_url', label: 'source', read: (r) => r?.source_url || '' },
  lo: { column: 'cheque_min_cents', label: 'cheque low end', read: (r) => usdText(r?.cheque_min_cents) },
  hi: { column: 'cheque_max_cents', label: 'cheque high end', read: (r) => usdText(r?.cheque_max_cents) },
  alloc: { column: 'intended_allocation_cents', label: 'allocation', read: (r) => usdText(r?.intended_allocation_cents) },
};

/** Every field's box as the stored row reads. */
export function draftsFrom(row) {
  return Object.fromEntries(Object.entries(DRAFT_FIELDS).map(([k, f]) => [k, f.read(row)]));
}

/** The fields whose box no longer matches the row it was loaded from. */
export function dirtyFields(drafts, row) {
  const stored = draftsFrom(row);
  return Object.keys(DRAFT_FIELDS).filter((k) => (drafts?.[k] ?? '') !== stored[k]);
}

/**
 * The boxes after a save answered with `next`. A field that was sent takes the
 * stored value; a field that was not being edited follows the row; a field
 * with unsaved text keeps it. `sent` names draft fields (note, lo, …).
 */
export function mergeDrafts(drafts, prev, next, sent = []) {
  const before = draftsFrom(prev);
  const after = draftsFrom(next);
  const out = {};
  for (const k of Object.keys(DRAFT_FIELDS)) {
    const mine = drafts?.[k] ?? before[k];
    out[k] = sent.includes(k) || mine === before[k] ? after[k] : mine;
  }
  return out;
}

/**
 * "Combine both" on a note conflict: the saved text, then each line of yours
 * it does not already hold. The founder edits the result and saves it; nothing
 * is written by choosing this.
 */
export function combineNotes(saved, mine) {
  const base = String(saved || '').replace(/\s+$/, '');
  const have = new Set(base.split('\n').map((l) => l.trim()).filter(Boolean));
  const extra = String(mine || '').split('\n').filter((l) => l.trim() && !have.has(l.trim()));
  if (!extra.length) return base;
  return base ? `${base}\n${extra.join('\n')}` : extra.join('\n');
}

/** Why Write into the note waits, or null. The brief is appended after the SAVED note. */
export function acceptWaitReason(noteDirty) {
  return noteDirty
    ? 'Save your note first. You have unsaved changes in the note, and the brief is added after the saved note, so it would not include them.'
    : null;
}

/**
 * The leave guard's words. Fixed for the fund, not counted per keystroke: the
 * guard is rebuilt when its message changes, so the message stays the same
 * while the page is open.
 */
export function leaveMessage(name) {
  return `Leave without saving? Text you typed on ${name || 'this fund'} is not saved and will be lost.`;
}
