/**
 * D6070 (#6070) — RAN22, "Take vN out": one saved version of the narrative as
 * text to copy and as a watermarked PDF, built from the version read
 * (`GET /api/cycles/raise/narrative/:version`) and PITCH's source registry,
 * the two reads Story draws. Pure, so the tests read it without a browser.
 *
 * WHAT GOES OUT. The version's sections in their order. A section that is Not
 * recorded is left out and named as left out, never printed as an empty
 * heading. A bound figure goes out as the page shows it at export time: its
 * value is already in the words where it was inserted (D1114), and a bound
 * figure whose value is not in the words is listed under the section with the
 * record's current value, source, date and grade, or "Not recorded" when the
 * record holds none. A figure is never printed from a stale snapshot.
 *
 * WHAT NAMES IT. The first lines say the version, its audience, the export
 * date and the revision; every PDF page repeats the version and the date as
 * its watermark (owner pick A on #6067).
 */
import { NOT_RECORDED } from '../../../lib/absence.js';
import { userFacingRaiseError } from '../../../lib/raiseErrors.js';
import { audienceOf, bindingsBySection, boundChip, storySections, unplacedFigures } from './storyModel.js';

/** The three formats RAN22 draws. DOCX needs a backend this build does not have, so it is shown and not offered. */
export const FORMATS = [
  { id: 'text', label: 'Copy text', sub: 'Plain text, ready to paste', ready: true },
  { id: 'pdf', label: 'PDF', sub: 'Letter pages, watermarked', ready: true },
  { id: 'docx', label: 'DOCX', sub: 'Editable, watermarked', ready: false },
];
export const DOCX_LATER = 'Not available yet. DOCX needs the export pipeline the Worker does not have.';

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const SHORT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const parse = (value) => {
  if (!value) return null;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(String(value)) ? `${String(value).replace(' ', 'T')}Z` : String(value);
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};
const dayOf = (value) => { const d = parse(value); return d ? DAY.format(d) : null; };

/** A bound figure as one line of the export, from what its chip shows now. */
export function figureLine(view) {
  if (!view?.value) return `${view?.label || 'A bound figure'}: ${NOT_RECORDED}`;
  const chip = view.chip;
  const where = chip ? [chip.source, chip.date, chip.grade].filter(Boolean).join(', ') : '';
  return `${view.label}: ${view.value}${where ? ` (${where})` : ''}`;
}

/**
 * The version as the export reads it, or null when its sections could not be
 * read. `sources` is Story's registry state, `{ status, items }`.
 */
export function exportModel(read, sources, now) {
  const sections = storySections(read);
  if (!sections) return null;
  const bindings = bindingsBySection(read);
  const positioning = read?.positioning?.state === 'ok' && Array.isArray(read.positioning.effective) ? read.positioning.effective : [];
  const oneLiner = positioning.find((p) => p?.kind === 'one_liner' && typeof p.text === 'string' && p.text.trim())?.text.trim() || null;
  const revision = read?.meta?.state === 'ok' && Number.isInteger(Number(read.meta.revision)) ? Number(read.meta.revision) : null;
  return {
    version: Number(read.version),
    audience: audienceOf(read),
    date: dayOf(now),
    stamp: parse(now)?.toISOString().slice(0, 10) ?? null,
    revision,
    oneLiner,
    // Bound figures are unreadable as a whole: then none is printed, and the export says so.
    figuresUnreadable: bindings === null,
    sections: sections.map((s) => {
      const figures = (bindings?.get(s.key) || []).map((binding) => ({ binding, view: boundChip(binding, sources) }));
      const raw = (read.sections.items || []).find((x) => x?.key === s.key);
      const source = raw?.source && (raw.source.label || raw.source.kind) ? String(raw.source.label || raw.source.kind) : null;
      return {
        key: s.key, label: s.label, body: s.body, note: s.note, source,
        figures: s.body ? unplacedFigures(s.body, figures).map((f) => figureLine(f.view)) : [],
      };
    }),
  };
}

/** What the checklist starts with: every recorded section, the one-liner when there is one, no notes, no sources. */
export function defaultInclude(model) {
  return {
    keys: new Set((model?.sections || []).filter((s) => s.body).map((s) => s.key)),
    oneLiner: Boolean(model?.oneLiner),
    notes: false,
    sources: false,
  };
}

/** The sections that go out: chosen and recorded. A Not recorded section never goes out, whatever was ticked. */
export const includedSections = (model, include) => (model?.sections || []).filter((s) => s.body && include?.keys?.has(s.key));
export const leftOut = (model) => (model?.sections || []).filter((s) => !s.body);
export const hasWords = (model) => (model?.sections || []).some((s) => s.body);

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const copyLabel = (n) => `Copy text · ${plural(n, 'section', 'sections')}`;
export const pdfLabel = (n) => `Download PDF · ${plural(n, 'section', 'sections')}`;
export const copiedLine = (n) => `Copied ${plural(n, 'section', 'sections')}`;
export const takeOutTitle = (model) => `Take v${model?.version} out`;

/** The lines that name the export: version, audience, date and revision. */
export function exportHeading(model) {
  return [
    `Investor narrative · v${model.version}`,
    [`For ${model.audience || 'an audience not recorded'}`, model.date ? `exported ${model.date}` : null, model.revision != null ? `revision ${model.revision}` : null]
      .filter(Boolean).join(' · '),
  ];
}

/** Each PDF page's watermark (owner pick A on #6067: on every page). */
export const watermark = (model, page, pages) => `Investor narrative v${model.version} · exported ${model.date || 'on a date not recorded'} · page ${page} of ${pages}`;

/**
 * The export as blocks: the heading, the one-liner, then each included
 * section with its words, the bound figures not in its words, and, when
 * chosen, its audience note and source. Copy and PDF print the same blocks.
 */
export function exportBlocks(model, include) {
  const blocks = exportHeading(model).map((text, i) => ({ kind: i === 0 ? 'title' : 'meta', text }));
  if (include?.oneLiner && model.oneLiner) blocks.push({ kind: 'lead', text: model.oneLiner });
  for (const s of includedSections(model, include)) {
    blocks.push({ kind: 'heading', text: s.label });
    blocks.push({ kind: 'body', text: s.body });
    if (s.figures.length) blocks.push({ kind: 'figures', text: `Bound figures: ${s.figures.join('; ')}` });
    if (include.notes && s.note) blocks.push({ kind: 'note', text: `Audience note: ${s.note}` });
    if (include.sources && s.source) blocks.push({ kind: 'note', text: `Source: ${s.source}` });
  }
  if (model.figuresUnreadable) blocks.push({ kind: 'note', text: 'The bound figures could not be read, so none is listed.' });
  return blocks;
}

/** The text Copy puts on the clipboard. */
export const exportText = (model, include) => exportBlocks(model, include).map((b) => b.text).join('\n\n');

export const exportFilename = (model) => `investor-narrative-v${model.version}${model.stamp ? `-${model.stamp}` : ''}.pdf`;

/* ------------------------------------------------------------------ *
 * States (RAN26, RAN27)
 * ------------------------------------------------------------------ */

export const NO_WORDS = (model) => `No words to copy in v${model.version}.`;
export const NO_WORDS_SUB = 'Every section of this version is Not recorded. Write a section in Story, save the version, then take it out.';
export const CLIPBOARD_BLOCKED = 'The browser blocked copying. The text is selected below. Press Ctrl+C (⌘C) to copy it by hand.';
export const ADMIN_LINE = 'Read only. You may copy the text; the copy is recorded with your read reason. Only the venture’s founder exports a file.';
export const UNSAVED_LINE = 'Unsaved changes in Story are not in the export. It takes the saved version.';
export const LOG_EMPTY = 'No export of this narrative yet.';
export const LOG_UNREADABLE = 'The export log could not be read. This is not a claim that nothing was exported.';
export const NOT_RECORDED_FILE = 'The export could not be recorded, so no file was made. Try again in a moment.';
export const NOT_RECORDED_COPY = 'The copy could not be recorded with your read reason, so nothing was copied. Try again in a moment.';
export const PDF_FAILED = 'The PDF could not be made in this browser. The export was recorded; nothing was shared.';

/** The sentence for a refused or failed record, by the Worker's code. */
export function exportFailure(error, { admin = false } = {}) {
  const code = error?.code || error?.data?.code || error?.data?.error || null;
  if (code === 'export_not_recorded' || (!code && Number(error?.status) >= 500)) return admin ? NOT_RECORDED_COPY : NOT_RECORDED_FILE;
  if (code === 'admin_copy_only') return 'An admin copies the narrative’s text only. Only the venture’s founder exports a file.';
  if (code === 'live_deck_not_exported') return 'Version 0 is the live deck’s wording. Export a saved version.';
  if (code === 'read_reason_required') return 'Your read reason has expired. Give a reason again to copy this narrative.';
  return userFacingRaiseError(error, { fallback: admin ? NOT_RECORDED_COPY : NOT_RECORDED_FILE });
}

/** One row of the export log: "Exported v4 as PDF · 12 Nov". */
export function exportLogLine(row) {
  const v = row?.version != null ? `v${row.version}` : 'a version';
  const what = row?.format === 'pdf' ? `Exported ${v} as PDF` : row?.by === 'admin' ? `An admin copied ${v} as text` : `Copied ${v} as text`;
  const d = parse(row?.created_at);
  return d ? `${what} · ${SHORT.format(d)}` : what;
}
