/**
 * D4563 (#4563) — the Corporate Governance tab's pure rules: how a document's
 * status, versions and ownership read on the page. Nothing here fetches; the
 * Worker (`routes/admin_governance.ts`) holds every rule that refuses a write,
 * and this file only mirrors the ones the page uses to word a control.
 */

export const STATUS_LABELS = Object.freeze({ draft: 'Draft', review: 'In review', approved: 'Approved', executed: 'Executed', archived: 'Archived' });
export const STATUS_TONES = Object.freeze({
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200',
  review: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  approved: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  executed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  archived: 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
});
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
