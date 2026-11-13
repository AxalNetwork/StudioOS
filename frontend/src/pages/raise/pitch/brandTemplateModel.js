/**
 * D1572 (#3819, deck v2 D11) — the words and rules of pd31's brand locks and
 * pd30's .pptx template import. Pure: no React, no network.
 *
 *   LOCK_ROWS        pd31's three switches, in its order
 *   ADMINS_ONLY      "Only the venture’s admins can lock."
 *   lockedTag        "Locked by [name]" for a locked part, or null
 *   lockFor          whether a part of the kit form is locked, and its tag
 *   TEMPLATE_*       pd30's drop and progress lines
 *   countsLine       "[10] layouts found · [8] placed on whole cells · [2] could not be placed"
 *   fontLine         "Calibri → Inter (stand-in)", or the font itself
 *   unplacedOf       each layout that could not be placed, with its reason
 *   placedOf         the layouts Save as your layouts sends: name and areas only
 *   areaRange        "c1–6 × r2–6", a placed area as the grid names it
 *
 * The Worker's words (`brandLocks.ts`, `pptxTemplate.ts`) are the rule; the
 * Worker checks every layout again before it saves one.
 */

export const LOCK_ROWS = Object.freeze([
  { part: 'fonts', label: 'Fonts' },
  { part: 'palette', label: 'Colour roles' },
  { part: 'logo', label: 'Logo' },
]);
export const ADMINS_ONLY = 'Only the venture’s admins can lock.';
export const LOCKS_FAILED = 'The brand kit’s locks could not be read.';

/** "Locked by [name]" for a locked part; null when it is not locked. */
export function lockedTag(lock) {
  if (!lock) return null;
  return `Locked by ${lock.by || 'an admin'}`;
}

/** A part of the kit form: whether it is locked, and the tag it shows. A lock read that failed locks nothing here; the Worker still refuses. */
export function lockFor(answer, part) {
  const lock = answer?.available === true ? answer.value?.locks?.[part] ?? null : null;
  return { locked: Boolean(lock), tag: lockedTag(lock) };
}

export const TEMPLATE_TITLE = 'Import a .pptx template';
export const TEMPLATE_DROP = '.pptx up to 50 MB';
export const TEMPLATE_PRIVACY = 'Your file’s text is read only to map the layouts.';
export const TEMPLATE_READING = 'Reading your template…';
export const TEMPLATE_SAVE = 'Save as your layouts';
export const TEMPLATE_MAX_BYTES = 50 * 1024 * 1024;

/** Whether a chosen file can be sent: a .pptx of at most 50 MB; otherwise the sentence why not. */
export function fileProblem(file) {
  if (!file) return 'Choose a .pptx template.';
  if (!/\.pptx$/i.test(String(file.name || ''))) return 'Choose a PowerPoint template: a .pptx file.';
  if (Number(file.size) > TEMPLATE_MAX_BYTES) return 'A template can be up to 50 MB.';
  return null;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** pd30's count line. A count the report does not hold is left out, never shown as 0. */
export function countsLine(counts) {
  if (!counts || !Number.isInteger(counts.found)) return null;
  return [
    plural(counts.found, 'layout found', 'layouts found'),
    `${counts.placed} placed on whole cells`,
    `${counts.not_placed} could not be placed`,
  ].join(' · ');
}

/** A font found in the template, and what stands in for it when it is not one of the OFL list. */
export function fontLine(f) {
  if (!f) return null;
  const role = f.role === 'display' ? 'Headings' : 'Text';
  if (!f.found) return `${role}: none found · ${f.use}`;
  return f.fallback ? `${role}: ${f.found} → ${f.use} (stand-in)` : `${role}: ${f.found}`;
}

/** Each layout that could not be placed, with its reason. */
export function unplacedOf(report) {
  return (Array.isArray(report?.layouts) ? report.layouts : []).filter((l) => l && l.placed === false).map((l) => ({ name: String(l.name || 'A layout'), why: String(l.why || 'It could not be placed.') }));
}

/** The layouts Save as your layouts sends: only placed ones, name and areas. */
export function placedOf(report) {
  return (Array.isArray(report?.layouts) ? report.layouts : []).filter((l) => l && l.placed === true && Array.isArray(l.areas)).map((l) => ({ name: String(l.name), areas: l.areas }));
}

/** An area's range as the grid names it: "c1–6 × r2–6". */
export const areaRange = (a) => `c${a.c1}${a.c2 !== a.c1 ? `–${a.c2}` : ''} × r${a.r1}${a.r2 !== a.r1 ? `–${a.r2}` : ''}`;
