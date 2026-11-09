/**
 * D4563 (#4563) — the Corporate Governance tab's pure rules: how a document's
 * status, versions and ownership read on the page. Nothing here fetches; the
 * Worker (`routes/admin_governance.ts`) holds every rule that refuses a write,
 * and this file only mirrors the ones the page uses to word a control.
 */

import { GOVERNANCE_KEYS, governanceLifecycle } from '../../../lib/contractLifecycle';

// D4811: the labels are the governance lifecycle's (`lib/contractLifecycle.js`),
// so the pill, the move dialog and the moves read one vocabulary. `review` reads
// "In review"; the stored values do not change.
export const STATUS_LABELS = Object.freeze(Object.fromEntries(Object.keys(GOVERNANCE_KEYS).map((k) => [k, governanceLifecycle(k).label])));
export const statusLabel = (status) => STATUS_LABELS[status] || 'Not recorded';

/** The verb a move button says. */
export function moveLabel(from, to) {
  if (to === 'review') return from === 'approved' ? 'Return to review' : 'Send to review';
  if (to === 'draft') return from === 'archived' ? 'Restore as draft' : 'Return to draft';
  if (to === 'approved') return 'Approve';
  if (to === 'executed') return 'Mark executed';
  if (to === 'archived') return 'Archive';
  return statusLabel(to);
}

/**
 * Whether the page can see evidence of signature for `executed`: a version
 * uploaded as signed, or a linked envelope (the Worker re-checks that it
 * completed). The Worker decides; this only explains a refusal before it happens.
 */
export function executedHint(document, versions = []) {
  if (versions.some((v) => v.signed)) return null;
  if (document?.envelope_id != null) return null;
  return 'Upload the signed copy, or link the completed envelope, before marking this executed.';
}

/** Documents grouped in category order; a category with none is kept so the page can say so. */
export function byCategory(documents = [], categories = []) {
  return categories.map((c) => ({ ...c, documents: documents.filter((d) => d.category === c.key) }));
}

export function fileSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
export const fileKind = (type) => (type === 'application/pdf' ? 'PDF' : type ? 'Word' : null);

/** "v3 · PDF · 1.2 MB · signed copy", or null when the document has no file yet. */
export function versionLine(v) {
  if (!v) return null;
  return [`v${v.version}`, fileKind(v.content_type), fileSize(v.file_bytes), v.signed ? 'signed copy' : null].filter(Boolean).join(' · ');
}

/** A YYYY-MM-DD date as the page writes it, or null (the page then says Not recorded). */
export function dayLabel(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
}

export const ACCEPT = '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** A file the page will send, or the reason it will not. The Worker sniffs the bytes again. */
export function fileProblem(file) {
  if (!file) return 'Choose a PDF or Word (.docx) file.';
  if (!/\.(pdf|docx)$/i.test(file.name || '')) return 'Only a PDF or Word (.docx) file can be kept here.';
  if (file.size > MAX_FILE_BYTES) return 'The file is larger than 25 MB.';
  if (!file.size) return 'The file is empty.';
  return null;
}

/** Ownership rows as the editor holds them: strings, so a blank percent stays blank, never 0. */
export const draftRow = (r = {}) => ({ holder: r.holder || '', interest: r.interest || '', percent: r.percent == null ? '' : String(r.percent), note: r.note || '' });

/** The rows a save sends, or the reason it will not. The same rules as `ownershipOf` in the Worker. */
export function ownershipPayload(rows = []) {
  const kept = rows.filter((r) => r.holder.trim() || r.interest.trim() || r.percent.trim() || r.note.trim());
  if (kept.length > 50) return { error: 'At most 50 ownership rows.' };
  const out = [];
  for (const r of kept) {
    if (!r.holder.trim()) return { error: 'Every ownership row names its holder.' };
    const percent = r.percent.trim() === '' ? null : Number(r.percent);
    if (percent !== null && (!Number.isFinite(percent) || percent < 0 || percent > 100)) return { error: 'A percent is between 0 and 100.' };
    out.push({ holder: r.holder.trim(), interest: r.interest.trim() || null, percent, note: r.note.trim() || null });
  }
  if (out.reduce((s, r) => s + (r.percent ?? 0), 0) > 100.0001) return { error: 'The percents add up to more than 100.' };
  return { rows: out };
}

/** The sum of the recorded percents, or null when none is recorded. */
export function recordedPercent(rows = []) {
  const known = rows.filter((r) => r.percent != null);
  return known.length ? Math.round(known.reduce((s, r) => s + Number(r.percent), 0) * 100) / 100 : null;
}

// ---- D4811 (#4811) part 2: the attention view (boards CT-03 to CT-06) ------
//
// The Worker computes each expected record's state (`services/governanceAttention.ts`);
// these are only its words. Every state is a glyph and words (board CT-91), with
// a one-line explanation under it. There is no score.

export const RECORD_STATES = Object.freeze({
  current: { label: 'Current', glyph: '✓', tone: 'current', line: null },
  review_required: { label: 'Review required', glyph: '◷', tone: 'review', line: 'A version is waiting to be reviewed.' },
  missing: { label: 'Missing — expected', glyph: '!', tone: 'missing', line: 'This entity should hold one. None is recorded.' },
  not_recorded: { label: 'Not recorded — add if applicable', glyph: '○', tone: 'plain', line: 'Only needed if the entity keeps one.' },
  restricted: { label: 'Restricted', glyph: '🔒', tone: 'restricted', line: 'Contents need restricted access (Super Admin only).' },
  incomplete: { label: 'Incomplete', glyph: '◌', tone: 'incomplete', line: 'A record is started but has no file yet.' },
});
export const recordState = (key) => RECORD_STATES[key] || null;

/** The drill-downs of the summary: each opens the records behind its count. */
export const DRILLS = Object.freeze([
  { key: 'review_required', label: 'Need legal review', unit: 'records' },
  { key: 'missing', label: 'Missing — expected', unit: 'records the system expects' },
  { key: 'restricted', label: 'Restricted', unit: 'records · access-controlled' },
  { key: 'incomplete', label: 'Incomplete', unit: 'records with no file' },
]);
export const isDrill = (key) => DRILLS.some((d) => d.key === key);

/** Totals across the entities. A record restricted for a Super Admin still counts as restricted. */
export function groupCounts(entities = []) {
  const out = { entities: entities.length, review_required: 0, missing: 0, restricted: 0, incomplete: 0 };
  for (const e of entities) for (const k of ['review_required', 'missing', 'restricted', 'incomplete']) out[k] += Number(e.attention?.counts?.[k] || 0);
  return out;
}

/** The records a drill-down lists, across the entities, in entity order. */
export function drillRecords(entities = [], key) {
  const rows = [];
  for (const e of entities) for (const r of e.attention?.records || []) {
    if (r.state === key || (key === 'restricted' && r.restricted)) rows.push({ entity: e, record: r });
  }
  return rows;
}

/** What the next-action control of a record says, or null when there is nothing to do here. */
export function recordAction(record, entityName) {
  if (!record) return null;
  if (record.state === 'missing') return { kind: 'add', label: 'Add governance record', aria: `Add ${record.label} for ${entityName}` };
  if (record.state === 'not_recorded') return { kind: 'add', label: 'Add if applicable', aria: `Add ${record.label} for ${entityName}` };
  if (record.state === 'restricted') return null;
  const uid = record.attention?.uid || record.current?.uid;
  if (!uid) return null;
  if (record.state === 'incomplete') return { kind: 'open', uid, label: 'Upload file', aria: `Upload the file of ${record.attention?.title || record.label}` };
  if (record.state === 'review_required') return { kind: 'open', uid, label: 'Open review', aria: `Open ${record.attention?.title || record.label}` };
  return { kind: 'open', uid, label: 'Open', aria: `Open ${record.current?.title || record.label}` };
}

/** "v2 · Executed", "3 recorded · v1 · Approved", or null when nothing this viewer may open is recorded. */
export function recordVersion(record) {
  const c = record?.current;
  if (!c) return null;
  return [record.recorded > 1 ? `${record.recorded} recorded` : null, c.version ? `v${c.version}` : 'no file', statusLabel(c.status)].filter(Boolean).join(' · ');
}

/** An entity fact's sentence: the outstanding issue or the next action, or null when there is none. */
export function issueLine(issue) {
  if (!issue) return null;
  if (issue.kind === 'missing') return `No ${issue.label} recorded`;
  if (issue.kind === 'incomplete') return `${issue.title || issue.label} has no file`;
  return null;
}
export function nextLine(next) {
  if (!next) return null;
  if (next.kind === 'add') return `Add ${next.label}`;
  if (next.kind === 'upload') return `Upload the file of ${next.title || next.label}`;
  if (next.kind === 'review') return `Finish the review of ${next.title || next.label}`;
  return null;
}

/**
 * The group structure as one sentence, for the chart's accessible name and its
 * phone form. A percent not recorded says so; it is never drawn as 100% or 0%.
 */
export function groupSentence(entities = [], links = []) {
  if (!links.length) return null;
  const name = (k) => entities.find((e) => e.key === k)?.name || k;
  return links.map((l) => `${name(l.parent)} owns ${l.percent == null ? 'a share (percent not recorded) of' : `${l.percent}% of`} ${name(l.child)}`).join('. ') + '.';
}
