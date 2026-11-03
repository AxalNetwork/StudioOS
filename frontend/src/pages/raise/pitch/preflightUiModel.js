/**
 * D1370 (#3661, PF1–PF5) — the words and groups of "Check before you send",
 * pure: the toolbar chip, the results panel's four groups, a finding's row,
 * the gate before Share and Export, and the lines that say what was not
 * checked. It reads `preflightModel.js`'s result and never changes it: no
 * score, no verdict, nothing rewritten.
 *
 * "Couldn't check" is never a pass. A slide the page could not draw at export
 * size, or a check that had nothing measured, is its own group and its own
 * count, and "All checks passed" is said only when nothing is in it.
 *
 * What each later part switches on (`BUILD`; an item not live is greyed with `notYet()`):
 *   · P1 (D4208, #4208): dismissals kept per version on the Worker
 *     (`GET`/`PUT /api/decks/:id/preflight/dismissals`), read when the editor
 *     opens and written on Dismiss and Undo, so every editor sees them.
 *   · P2 (D4210, #4210): "Ask Eadwyn to suggest a fix", D899's card tools
 *     with `tool: 'preflight_fix'`: quoted first (its hold), run as one
 *     proposal, which waits in Ask until Accept places it and Save keeps it.
 * The UI never prints an issue number (`pitch_v2_chrome_d1604`), so the line
 * is the adapter's own "Not switched on yet."
 */
import { cardTitle } from './editorModel.js';
import { SEVERITY } from './preflightModel.js';
import { aiTokens } from './newDeckModel.js';

export const BUILD = Object.freeze({
  P1: { issue: 4208, live: true, what: 'Dismissals kept for every editor of this version' },
  P2: { issue: 4210, live: true, what: 'Ask Eadwyn to suggest a fix' },
});
export const notYet = () => 'Not switched on yet.';
export const LATER = 'Coming later';

export const TITLE = 'Check before you send';
export const RECHECK = 'Re-check';
export const SHOW_ME = 'Show me';
export const DISMISS = 'Dismiss';
export const UNDO = 'Undo';
export const TRY_AGAIN = 'Try again';
export const ASK_FIX = 'Ask Eadwyn to suggest a fix';
export const FIX_FIRST = 'Fix first';
export const FREE_LINE = 'Checks are free. They change nothing on your slides.';
export const READER_LINE = 'You can see what needs fixing. Editors of this deck dismiss findings and ask for fixes.';
export const KEEP_EDITING = 'You can keep editing. Results appear when every slide is checked.';
export const HELD_HERE = 'Dismissed here only: reloading the page brings them back.';
/** P1: a Dismiss or Undo the Worker did not keep is taken back, and says so. */
export const NOT_KEPT = 'That was not kept. Try again.';

/**
 * P2 (D4210): the checks Eadwyn may suggest a fix for, the Worker's
 * `PREFLIGHT_FIX_CHECKS`. Text only: never sources, contrast or an image, and
 * a figure is never rewritten.
 */
export const FIX_CHECKS = Object.freeze(['overflow', 'density', 'font', 'placeholder']);
export const TOKENS_OUT = 'Not enough AI tokens';
export const ADD_TOKENS = 'Add tokens';
export const FIX_WAITING = 'A suggestion is waiting in Ask. Accept places it on the slide; Save keeps it.';

/** Whether a finding can ask for a fix: a text check, on one text block with words, not a figure bound to a record. */
export function canAskFix(row, block) {
  if (!row || !FIX_CHECKS.includes(row.check) || row.block == null) return false;
  if (!block || block.kind !== 'text' || block.binding?.source_key) return false;
  return Boolean(String(block.text ?? '').trim());
}

/** The body a fix press sends (D899's quote and run): the finding, the block, and its words as checked. */
export function fixBody(row, block) {
  return {
    tool: 'preflight_fix',
    finding: { check: row.check, block: String(row.block), title: String(row.headline || '').slice(0, 200) },
    block: { id: block.id, kind: block.kind },
    text: String(block.text ?? ''),
  };
}

/** pf2: the line under the action, from its quote. */
export function holdLine(quote) {
  if (!quote) return 'Reading the cost…';
  if (quote.ai === false) return quote.message || 'Eadwyn cannot run this now.';
  const held = aiTokens(quote.hold_microusd);
  return held ? `Holds up to ${held} · you pay what it uses` : 'You pay what it uses';
}

/** pf2b: "Charged $x of $y held"; null when the charge is not known. */
export function chargedLine(charged, held) {
  const c = aiTokens(charged);
  if (!c) return null;
  const h = aiTokens(held);
  return h ? `Charged ${c} of ${h} held` : `Charged ${c}`;
}
export const NOTHING_TO_FIX = 'Nothing to fix';
export const ALL_PASSED = 'All checks passed';
export const NOT_SINCE_EDIT = 'Not checked since your last edit';
export const NOT_A_PASS = 'Not a pass';
export const GROUPS = Object.freeze({ fix: 'To fix', look: 'Worth a look', unchecked: 'Couldn’t check', passed: 'Passed' });
export const GROUP_NOTES = Object.freeze({ fix: 'Before you export or share', look: 'You can dismiss these', lookGate: 'You can export with these' });

/** The block's name on a finding's row, as the boards say it ("Slide 4 · Title"). */
const BLOCK_NAMES = { heading: 'Title', paragraph: 'Body', list: 'List' };
const KIND_NAMES = { metric: 'Metric', image: 'Image', chart: 'Chart', video: 'Video', link: 'Link', audio: 'Audio', table: 'Table', graphic: 'Graphic' };
export function blockName(block) {
  if (!block) return 'Whole slide';
  if (block.kind === 'text') return BLOCK_NAMES[block.style] || 'Text';
  return KIND_NAMES[block.kind] || 'Block';
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * The one-line defect, without the model's "Card 4, Traction, block b1: "
 * prefix (the row's own line already names the slide and the block). Falls
 * back to the whole title when the prefix is not the one the model writes.
 */
export function headline(finding, slides) {
  const i = finding?.card;
  const card = Array.isArray(slides) ? slides[i] : null;
  const name = `Card ${i + 1}, ${cardTitle(card, i)}`;
  const prefix = finding?.block != null ? `${name}, block ${finding.block}: ` : `${name}: `;
  const t = String(finding?.title || '');
  return t.startsWith(prefix) ? cap(t.slice(prefix.length)) : t;
}

/** One finding as the panel draws it, with its screen-reader name ("Slide 4, title, the text is cut off at export size"). */
export function rowOf(finding, slides) {
  const card = Array.isArray(slides) ? slides[finding.card] : null;
  const block = finding.block != null ? (card?.blocks || []).find((b) => b?.id === finding.block) || null : null;
  const name = finding.block != null && !block ? 'Block' : blockName(block);
  const line = headline(finding, slides);
  return {
    id: finding.id,
    check: finding.check,
    severity: finding.severity,
    dismissible: Boolean(finding.dismissible),
    card: finding.card,
    block: finding.block,
    slide: finding.card + 1,
    where: `Slide ${finding.card + 1} · ${name}`,
    headline: line,
    detail: finding.detail,
    fix: finding.fix,
    label: `Slide ${finding.card + 1}, ${name.toLowerCase()}, ${line.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase())}`,
    // #3661 PF3: a contrast finding's colour pair, for the card beside the slide.
    pair: finding.pair ?? null,
  };
}

// ── #3661 PF3: the finding drawn on its slide ───────────────────────────────

export const CLIP_LEGEND = 'The red line is the edge of the block. The greyed words past it are hidden in the export.';
export const PAIR_TITLE = 'The contrast pair';
export const PAIR_LEGEND = 'Shown with its colour pair. It is a warning: the text can still be read up close, not from the back of the room.';
// The model's own figure (two places), so the card and the finding's line agree.
const ratioWords = (n) => `${Number(n)} : 1`;

/**
 * What the slide overlay draws for a finding, or null when it has no slide:
 *   · `clip`: cut-off text, drawn as exported, the hidden words greyed past the block's edge;
 *   · `contrast`: the block outlined, beside it the text and background colours and their ratio;
 *   · `outline`: any other finding about a block, outlined and numbered.
 * `n` is the finding's number in the strip. `current` false means the deck was edited after the
 * check: the overlay draws the slide as it was checked, and says so.
 */
export function overlayOf(row, { n = 1, aspect = '16:9', current = true } = {}) {
  if (!row || !Number.isInteger(row.card)) return null;
  const tone = row.severity === SEVERITY.blocking ? 'fix' : 'look';
  const kind = row.check === 'overflow' ? 'clip' : row.check === 'contrast' && row.pair ? 'contrast' : 'outline';
  const as = kind === 'clip' ? ' · as exported' : '';
  return {
    kind, tone, n, card: row.card, block: row.block ?? null,
    eyebrow: `Slide ${row.slide} · ${aspect}${as}${current ? '' : ' · as checked, before your edit'}`,
    legend: { title: row.headline, detail: kind === 'clip' ? CLIP_LEGEND : kind === 'contrast' ? PAIR_LEGEND : (row.detail || '') },
    pair: kind === 'contrast' ? {
      fg: row.pair.fg, bg: row.pair.bg, ratio: ratioWords(row.pair.ratio), reads: `${ratioWords(row.pair.min)} reads reliably`,
      label: `Text ${row.pair.fg} on ${row.pair.bg}: contrast ${ratioWords(row.pair.ratio)}, ${ratioWords(row.pair.min)} needed`,
    } : null,
    label: `${row.label}. ${kind === 'clip' ? CLIP_LEGEND : ''}`.trim(),
  };
}

/** pf5c: a slide that couldn't be checked is tried again on its own. */
export const RETRYING = 'Checking…';
export const retryLabel = (slide) => `Try again to check slide ${slide}`;

const UNMEASURED_LINES = {
  overflow: 'Cut-off text needs the slide drawn at export size, and it was not measured.',
  image: 'An image did not load at export size, so its resolution and fit were not measured.',
};
const SLIDE_FAILED = 'The page did not finish drawing it at export size, so cut-off text, font size and image fit were not measured.';

/**
 * What was not checked: a row for each slide the page could not draw at
 * export size (`failed`, card indexes), else one for each check the model
 * left "Not measured". Never a pass, and counted as its own group.
 */
export function uncheckedRows(result, failed = [], slides = []) {
  if (!result) return [];
  const bad = [...new Set((Array.isArray(failed) ? failed : []).filter((i) => Number.isInteger(i)))].sort((a, b) => a - b);
  if (bad.length) {
    return bad.map((i) => ({ id: `slide:${i}`, card: i, block: null, slide: i + 1, where: `Slide ${i + 1}`, headline: GROUPS.unchecked, detail: SLIDE_FAILED, label: `Slide ${i + 1}, couldn’t check` }));
  }
  return (result.checks || []).filter((c) => c.state === 'unmeasured').map((c) => ({
    id: `check:${c.key}`, card: null, block: null, slide: null, where: c.label, headline: GROUPS.unchecked,
    detail: UNMEASURED_LINES[c.key] || 'It was not measured.', label: `${c.label}, couldn’t check`,
    firstCard: firstMeasuredCard(c.key, slides),
  }));
}

/** The first card a "Not measured" check is about, so Show me has somewhere to go. */
function firstMeasuredCard(key, slides) {
  const want = key === 'image' ? (b) => b?.kind === 'image' && String(b.image_url || '').trim() : (b) => b?.kind === 'text' && String(b.text || '').trim();
  const i = (Array.isArray(slides) ? slides : []).findIndex((s) => (s?.blocks || []).some(want));
  return i >= 0 ? i : null;
}

/** The panel's four groups. `dismissed` is a Set of finding ids. */
export function groupsOf(result, { slides = [], dismissed = new Set(), failed = [] } = {}) {
  if (!result) return null;
  const rows = (result.findings || []).map((f) => rowOf(f, slides));
  const fix = rows.filter((r) => r.severity === SEVERITY.blocking);
  const warnings = rows.filter((r) => r.severity !== SEVERITY.blocking);
  const look = warnings.filter((r) => !dismissed.has(r.id));
  const unchecked = uncheckedRows(result, failed, slides);
  const passed = (result.checks || []).filter((c) => c.state === 'pass').map((c) => c.label);
  return { fix, look, dismissed: warnings.length - look.length, unchecked, passed };
}

/** "3 to fix · 5 to look at · 1 couldn’t check"; parts at 0 are left out. */
export function countsLine({ fix = 0, look = 0, unchecked = 0 } = {}) {
  const parts = [fix ? `${fix} to fix` : null, look ? `${look} to look at` : null, unchecked ? `${unchecked} couldn’t check` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : ALL_PASSED;
}
const countsOf = (g) => ({ fix: g.fix.length, look: g.look.length, unchecked: g.unchecked.length });

/**
 * The toolbar chip (pf1b): nothing before the first check; "Checking · 7 of
 * 12" while it runs; "Not checked since your last edit" once the result is
 * for another version; else the counts, or "✓ All checks passed".
 */
export function chipOf({ groups = null, current = true, running = null } = {}) {
  if (running) return { text: `Checking · ${running.done} of ${running.total}`, tone: 'muted', label: `Check before you send: checking slide ${Math.min(running.done + 1, running.total)} of ${running.total}` };
  if (!groups) return null;
  if (!current) return { text: NOT_SINCE_EDIT, tone: 'muted', label: `Check before you send: ${NOT_SINCE_EDIT.toLowerCase()}` };
  const c = countsOf(groups);
  const text = countsLine(c);
  const passed = text === ALL_PASSED;
  return { text: passed ? `✓ ${ALL_PASSED}` : text, tone: c.fix ? 'warn' : passed ? 'ok' : 'muted', label: `Check before you send: ${text}` };
}

/** "checked just now", else "checked at 14:20" (the viewer's clock). */
export function clockLabel(at, now = Date.now()) {
  if (!Number.isFinite(at)) return null;
  if (now - at < 60000) return 'checked just now';
  const d = new Date(at);
  return `checked at ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** The panel's sub line: "v3 · checked just now · 12 slides", or "· before your edit" when out of date. */
export function subLine({ version, at, now = Date.now(), slides = 0, current = true, running = false }) {
  const v = version != null ? `v${version}` : 'This version';
  if (running) return `${v} · checking now · ${plural(slides, 'slide', 'slides')}`;
  const when = clockLabel(at, now);
  if (!when) return `${v} · ${plural(slides, 'slide', 'slides')}`;
  return current ? `${v} · ${when} · ${plural(slides, 'slide', 'slides')}` : `${v} · ${when} · before your edit`;
}

/** The out-of-date banner (pf4). */
export const STALE_LINE = 'Out of date. You edited the deck after this check.';
export const RECHECK_NOW = 'Re-check now';
export const OUT_OF_DATE = 'Out of date';

/** What the last check found that this one does not ("✓ Fixed since the last check: Slide 4 · Title"). */
export function fixedSince(previous, groups) {
  if (!previous || !groups) return [];
  const now = new Set([...groups.fix, ...groups.look].map((r) => r.id));
  return [...previous.fix, ...previous.look].filter((r) => !now.has(r.id)).map((r) => r.where);
}
export const fixedLine = (wheres) => (wheres.length ? `Fixed since the last check: ${wheres.slice(0, 3).join(', ')}${wheres.length > 3 ? ` and ${wheres.length - 3} more` : ''}` : null);

/** pf5c: "Couldn’t check 2 slides: the page did not draw them at export size." */
export function uncheckedBanner(groups) {
  const slides = groups?.unchecked.filter((r) => r.slide != null).length || 0;
  if (!slides) return null;
  return `Couldn’t check ${plural(slides, 'slide', 'slides')}: the page did not draw ${slides === 1 ? 'it' : 'them'} at export size.`;
}

/** The progress while it runs (pf5a). */
export const checkingLine = (done, total) => `Checking slide ${Math.min(done + 1, total)} of ${total}`;
export const percent = (done, total) => (total > 0 ? Math.round((done / total) * 100) : 0);
export const slideState = (i, done) => (i < done ? '✓ Checked' : i === done ? 'Checking' : 'Waiting');

/** pf5b: "All 9 checks passed on 12 slides." */
export const passedLine = (checks, slides) => `All ${plural(checks, 'check', 'checks')} passed on ${plural(slides, 'slide', 'slides')}.`;

/**
 * The gate before Share and Export (pf1c, pf1d). `open` is false when there
 * is nothing to fix and nothing to look at: the dialog then opens at once.
 * "Couldn’t check" does not stop it (it is listed in the panel and on the
 * chip, never called a pass). `anyway` is offered only with no item to fix.
 */
export function gateOf(groups, kind) {
  const share = kind === 'share';
  const verb = share ? 'Send' : 'Export';
  if (!groups) return { open: false, kind };
  const fix = groups.fix;
  const look = groups.look;
  const n = fix.length;
  return {
    kind,
    open: n > 0 || look.length > 0,
    title: share ? 'Before you share' : 'Before you export',
    fix,
    look,
    anyway: n === 0 ? `${verb} anyway` : null,
    waitLine: n > 0 ? `${verb} anyway opens once the ${plural(n, 'item', 'items')} to fix ${n === 1 ? 'is' : 'are'} fixed.` : null,
  };
}
export const DIRTY_LINE = 'Checked with your unsaved edits. The link and the export carry the saved version until you save one.';

/** The deck the editor holds now, as `runPreflight` reads a version. */
export const workingDeck = (deck, cards, theme) => ({ id: deck?.id ?? null, version: deck?.version ?? null, slides: cards, theme: theme ?? null });

/** Previous and Next over the findings (pf5g): "Findings · 1 of 8". */
export function stepOf(rows, id) {
  const i = rows.findIndex((r) => r.id === id);
  return { index: i, total: rows.length, line: i >= 0 ? `Findings · ${i + 1} of ${rows.length}` : null, prev: i > 0 ? rows[i - 1] : null, next: i >= 0 && i < rows.length - 1 ? rows[i + 1] : null };
}
