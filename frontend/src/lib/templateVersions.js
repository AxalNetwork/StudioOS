/**
 * D717 (#1853) — the template editor's version compare, pure: which versions
 * there are and when each was saved, which two are compared, and the lines
 * printed above the text. `pages/admin/contracts/VersionCompare.jsx` draws them.
 *
 * WHEN A VERSION WAS SAVED (#1853 decision 9). A save copies the live row into
 * history with the SAVER's id and the time, then bumps the version
 * (`legalTemplateStore.ts`). So a snapshot's `created_at`/`created_by` belong
 * to the edit that replaced it, not to the snapshot:
 *   - the current version was saved at `current.updated_at` by `updated_by`;
 *   - v[k] (k ≥ 2) was saved at snapshot v[k−1]'s `created_at` by its `created_by`;
 *   - v1 was saved at `current.created_at` by `current.created_by`.
 * A missing date or editor is said, never guessed (D647).
 */
import { metaChanges } from './textDiff.js';

export const NOT_SAVED = 'Not saved';
export const NO_EDITOR = 'Not recorded: imported before editors were recorded.';

const at = (row, dateKey, byKey) => ({ at: row?.[dateKey] ?? null, by: row?.[byKey] ?? null });

/**
 * Every version, newest first: the draft (only when given), the current
 * version, then each snapshot. Each is `{ key, version, title, body_md,
 * doc_kind, axal_party, saved }`, `saved` being `{ at, by }` or null for the draft.
 */
export function versionEntries({ current, versions } = {}, draft = null) {
  const snapshots = [...(versions || [])].sort((a, b) => b.version - a.version);
  const byVersion = new Map(snapshots.map(s => [s.version, s]));
  const savedOf = (version) => {
    if (version === 1) return at(current, 'created_at', 'created_by');
    const before = byVersion.get(version - 1);
    return before ? at(before, 'created_at', 'created_by') : { at: null, by: null };
  };
  const entry = (row, key, saved) => ({
    key, version: row.version ?? null, title: row.title ?? '', body_md: row.body_md ?? '',
    doc_kind: row.doc_kind ?? null, axal_party: row.axal_party ?? null, saved,
  });
  const out = [];
  if (draft) out.push(entry({ ...draft, version: null }, 'draft', null));
  if (current) out.push(entry(current, `v${current.version}`, at(current, 'updated_at', 'updated_by')));
  for (const s of snapshots) {
    if (current && s.version === current.version) continue;
    out.push(entry(s, `v${s.version}`, savedOf(s.version)));
  }
  return out;
}

/** "Saved · [date] · Admin #[id]", saying which half is not recorded; "Not saved" for the draft. */
export function savedLine(saved, formatDate = (v) => v) {
  if (!saved) return NOT_SAVED;
  const when = saved.at ? formatDate(saved.at) : null;
  const who = saved.by != null ? `Admin #${saved.by}` : NO_EDITOR;
  return `Saved · ${when || 'date not recorded'} · ${who}`;
}

/** An entry's name: "v[k]", or "Draft". */
export const entryLabel = (e) => (e.key === 'draft' ? 'Draft' : `v${e.version}`);

/** A column heading: "v[k] · [date]", or "Draft · not saved". */
export function columnHeading(e, formatDate = (v) => v) {
  if (e.key === 'draft') return 'Draft · not saved';
  const when = e.saved?.at ? formatDate(e.saved.at) : null;
  return `v${e.version} · ${when || 'date not recorded'}`;
}

const rank = (entries, key) => entries.findIndex(e => e.key === key);

/** `[older, newer]`: the draft always newer, otherwise by position in the newest-first list. */
function ordered(entries, a, b) {
  if (a === 'draft') return [b, a];
  if (b === 'draft') return [a, b];
  return rank(entries, a) > rank(entries, b) ? [a, b] : [b, a];
}

/**
 * The pair shown first (#1853 decision 11): the current version and the draft when
 * the draft has unsaved changes, otherwise the two newest saved versions.
 * Null when there is nothing to compare.
 */
export function defaultPair(entries, draftChanged) {
  const saved = entries.filter(e => e.key !== 'draft');
  if (draftChanged && saved.length >= 1 && entries.some(e => e.key === 'draft')) return [saved[0].key, 'draft'];
  if (saved.length >= 2) return [saved[1].key, saved[0].key];
  return null;
}

/**
 * The pair after a click. `pair` is `[older, newer]` plus the order the two
 * were picked in (`picked`, the last-clicked key last). A click on a row in the
 * pair changes nothing; a click on another replaces the side picked earlier,
 * so the pair is always the last two clicks.
 */
export function pickPair(entries, pair, picked, key) {
  if (!pair) return { pair, picked };
  if (pair.includes(key)) return { pair, picked };
  const order = picked && picked.length === 2 ? picked : pair;
  const keep = order[1];
  return { pair: ordered(entries, keep, key), picked: [keep, key] };
}

const show = (field, v, { derived, partyLabel }) => {
  if (field === 'title') return `"${v ?? ''}"`;
  if (v == null) {
    const d = field === 'kind' ? derived?.kind : derived?.party;
    const name = field === 'party' && d != null ? partyLabel(d) : d;
    return `From the slug (${name ?? 'not recorded'})`;
  }
  return field === 'party' ? partyLabel(v) : v;
};
const FIELD_LABEL = { title: 'Title', kind: 'Kind', party: 'Axal VC party' };

/** The title, kind and party changes as printed above the text: `Kind: From the slug (agreement) → corporate`. */
export function metaLines(from, to, { derived = null, partyLabel = (p) => p } = {}) {
  return metaChanges(from, to).map(({ field, from: a, to: b }) => {
    const opts = { derived, partyLabel };
    return `${FIELD_LABEL[field]}: ${show(field, a, opts)} → ${show(field, b, opts)}`;
  });
}

/** The sentence for a compare that could not mark word by word, or null. */
export function compareNote(result) {
  if (!result) return null;
  if (result.mode === 'whole') return 'Too many changes to mark line by line, so the whole text shows as replaced.';
  if (result.reason === 'word_cap') return 'Over 20,000 words a side, so this compares line by line.';
  if (result.reason === 'edit_budget') return 'Too many changes to mark word by word, so this compares line by line.';
  return null;
}
