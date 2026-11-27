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
import { itemsByKey, refreshMetric } from './figuresModel.js';
import { valueText } from './sourcesModel.js';

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

// ── D8772 (#8772): the finding names its element, and the same problem on several elements is one heading ──

/** Q1 option A (D8772): the groups keep their names; each row carries a severity chip. */
export const SEVERITY_WORDS = Object.freeze({ blocking: 'Blocks export', warning: 'Warning' });
const clip = (s, n = 40) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const words = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * The element's own name, from what the slide shows, so two tiles of one kind on one slide read
 * apart: a metric is its label and value ("MRR $34.2k"), an image its alt text, a chart its first
 * series, a link or audio its label, a video its title. Null when the block shows nothing to name
 * it by (text is told apart only when it has to be: `distinguish`).
 */
export function elementOf(block) {
  if (!block || typeof block !== 'object') return null;
  let name = '';
  if (block.kind === 'metric') name = [words(block.label), words(block.value)].filter(Boolean).join(' ');
  else if (block.kind === 'image') name = words(block.alt);
  else if (block.kind === 'chart') name = words(block.title) || words((Array.isArray(block.series) ? block.series : []).map((x) => x?.label).find((l) => words(l)));
  else if (block.kind === 'link' || block.kind === 'audio') name = words(block.label);
  else if (block.kind === 'video') name = words(block.title);
  return name ? clip(name) : null;
}

/** A text block's first words, quoted, for telling two text blocks on one slide apart. */
const excerptOf = (block) => {
  const t = words(block?.text);
  return t ? `“${clip(t, 32)}”` : null;
};

/** One finding as the panel draws it, with its screen-reader name ("Slide 4, title, the text is cut off at export size"). */
export function rowOf(finding, slides) {
  const card = Array.isArray(slides) ? slides[finding.card] : null;
  const block = finding.block != null ? (card?.blocks || []).find((b) => b?.id === finding.block) || null : null;
  const name = finding.block != null && !block ? 'Block' : blockName(block);
  const element = elementOf(block);
  const line = headline(finding, slides);
  const thing = element ? `${name.toLowerCase()} ${element}` : name.toLowerCase();
  const severityWord = finding.severity === SEVERITY.blocking ? SEVERITY_WORDS.blocking : SEVERITY_WORDS.warning;
  const problem = line.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase());
  return {
    id: finding.id,
    check: finding.check,
    severity: finding.severity,
    severityWord,
    dismissible: Boolean(finding.dismissible),
    card: finding.card,
    block: finding.block,
    slide: finding.card + 1,
    kind: name,
    element,
    where: `Slide ${finding.card + 1} · ${name}${element ? ` · ${element}` : ''}`,
    headline: line,
    detail: finding.detail,
    fix: finding.fix,
    problem,
    label: `Slide ${finding.card + 1}, ${thing}, ${problem}`,
    ...buttonLabels(finding.card + 1, thing, severityWord),
    // #3661 PF3: a contrast finding's colour pair, for the card beside the slide.
    pair: finding.pair ?? null,
  };
}

/** D8772: each Show and Dismiss button says which element it is for ("Show metric MRR $34.2k on slide 3"). */
function buttonLabels(slide, thing, severityWord) {
  return {
    showLabel: `Show ${thing} on slide ${slide}`,
    dismissLabel: `Dismiss the ${severityWord.toLowerCase()} on ${thing}, slide ${slide}`,
  };
}

/**
 * D8772: rows on one slide that still read alike (two text blocks, or two tiles with the same label
 * and value) get what tells them apart: a text block's first words, else its place on the slide
 * ("block 2 of 3"). Rows about the same block are the same element and keep the same name.
 */
export function distinguish(rows, slides) {
  const byWhere = new Map();
  for (const r of rows) {
    if (r.block == null) continue;
    const list = byWhere.get(r.where) || [];
    list.push(r);
    byWhere.set(r.where, list);
  }
  const renamed = new Map();
  for (const list of byWhere.values()) {
    if (new Set(list.map((r) => r.block)).size < 2) continue;
    const blocks = (Array.isArray(slides) ? slides[list[0].card] : null)?.blocks || [];
    const extras = new Map(list.map((r) => {
      const at = blocks.findIndex((b) => b?.id === r.block);
      return [r.block, { excerpt: r.element ? null : excerptOf(blocks[at]), place: at >= 0 ? `block ${at + 1} of ${blocks.length}` : `block ${r.block}` }];
    }));
    const excerpts = [...extras.values()].map((e) => e.excerpt);
    const unique = excerpts.every((e) => e) && new Set(excerpts).size === excerpts.length;
    for (const r of list) {
      const e = extras.get(r.block);
      const extra = unique ? e.excerpt : e.place;
      const thing = `${r.kind.toLowerCase()}${r.element ? ` ${r.element}` : ''} ${extra}`;
      renamed.set(r.id, {
        ...r,
        element: r.element ? `${r.element} · ${extra}` : extra,
        where: `${r.where} · ${extra}`,
        label: `Slide ${r.slide}, ${thing}, ${r.problem}`,
        ...buttonLabels(r.slide, thing, r.severityWord),
      });
    }
  }
  return rows.map((r) => renamed.get(r.id) || r);
}

/**
 * Q2 option A (D8772): rows about the same problem on the same slide (same check, same headline)
 * sit under one heading, with a row per element; every finding keeps its own row and id, so a
 * dismissal still names one finding. A problem found once is a cluster of one, drawn as before.
 * `heading` is "Slide 3 · The source's date is not recorded · 2 elements".
 */
export function clustersOf(rows) {
  const out = [];
  const at = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const key = `${r.card ?? '-'}|${r.check ?? '-'}|${r.headline}`;
    if (!at.has(key)) { at.set(key, out.length); out.push({ key, rows: [] }); }
    out[at.get(key)].rows.push(r);
  }
  return out.map((c) => ({
    ...c,
    heading: c.rows.length > 1 ? `Slide ${c.rows[0].slide} · ${c.rows[0].headline.replace(/\.$/, '')} · ${c.rows.length} elements` : null,
  }));
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
  const rows = distinguish((result.findings || []).map((f) => rowOf(f, slides)), slides);
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

/**
 * The panel's sub line: "v3 · checked just now · 12 slides", or "· before your edit" when out of date.
 * D8772: `draft` (the editor holds unsaved edits, and the panel checks them) says so: "Your draft,
 * edited from v3 · …", never "v3", which is the saved version the export sends.
 */
export function subLine({ version, at, now = Date.now(), slides = 0, current = true, running = false, draft = false }) {
  const v = draft ? draftName(version) : version != null ? `v${version}` : 'This version';
  if (running) return `${v} · checking now · ${plural(slides, 'slide', 'slides')}`;
  const when = clockLabel(at, now);
  if (!when) return `${v} · ${plural(slides, 'slide', 'slides')}`;
  return current ? `${v} · ${when} · ${plural(slides, 'slide', 'slides')}` : `${v} · ${when} · before your edit`;
}

// ── D8772 (#8772): draft or saved version, and the repair checked on the same one ──

/** "Your draft, edited from v7". */
export const draftName = (version) => `Your draft, edited from ${version != null ? `v${version}` : 'the saved version'}`;

/**
 * What a check on the draft does not cover: the saved version is what Export and Share send, and
 * it is checked again when they open. With `fixed` (the re-check found the repair), it says the
 * repair is in the draft only until it is saved as a new version.
 */
export function draftLine({ version, fixed = 0 } = {}) {
  const v = version != null ? `v${version}` : 'the saved version';
  const saved = version != null ? `The saved v${version}` : 'The saved version';
  if (fixed > 0) return `Fixed in your draft. ${saved} still has ${fixed === 1 ? 'it' : 'them'}: save a new version, and Export and Share check that version again.`;
  return `This checked your draft, with your unsaved edits. Export and Share send ${v} and check it again when they open.`;
}

/**
 * Where focus goes when the founder comes back to the check from a finding (PTF04): the same row
 * when it is still found, else the next one that was after it in the last check, else the one
 * before it, else nothing (the headline takes it). `order` is the ids as the last check listed them.
 */
export function focusAfter(order, rows, id) {
  const now = new Set((Array.isArray(rows) ? rows : []).map((r) => r.id));
  if (id == null) return null;
  if (now.has(id)) return id;
  const list = Array.isArray(order) ? order : [];
  const i = list.indexOf(id);
  if (i < 0) return null;
  for (let j = i + 1; j < list.length; j += 1) if (now.has(list[j])) return list[j];
  for (let j = i - 1; j >= 0; j -= 1) if (now.has(list[j])) return list[j];
  return null;
}

/**
 * The headline of a check (PTF13), the words a screen reader is told, and whether export may go:
 *   · blockers: "2 to fix before you export or share" (tone fix): export waits until they are fixed;
 *   · warnings only: "No blockers · 3 warnings to confirm" (tone look): export after they are confirmed;
 *   · nothing found: "Nothing to fix" (tone ok), and only then: a warning is never "nothing";
 * a slide that could not be checked is added to each, and is never a pass.
 * `groups` is `groupsOf()`'s, or a gate (`gateOf()`'s, which carries `unchecked` as a count).
 */
export function headlineOf(groups) {
  if (!groups) return null;
  const fix = groups.fix?.length || 0;
  const look = groups.look?.length || 0;
  const unchecked = Array.isArray(groups.unchecked) ? groups.unchecked.length : Number(groups.unchecked) || 0;
  const tail = unchecked ? ` ${plural(unchecked, 'item', 'items')} couldn’t be checked, which is not a pass.` : '';
  if (fix) {
    return {
      text: `${fix} to fix before you export or share`,
      tone: 'fix', allowed: 'none',
      announce: `${plural(fix, 'blocker', 'blockers')}: export waits until ${fix === 1 ? 'it is' : 'they are'} fixed.${look ? ` ${plural(look, 'warning', 'warnings')}.` : ''}${tail}`,
    };
  }
  if (look) {
    return {
      text: `No blockers · ${plural(look, 'warning', 'warnings')} to confirm`,
      tone: 'look', allowed: 'confirm',
      announce: `No blockers. ${plural(look, 'warning', 'warnings')}: export after you confirm ${look === 1 ? 'it' : 'them'}.${tail}`,
    };
  }
  return { text: NOTHING_TO_FIX, tone: unchecked ? 'unchecked' : 'ok', allowed: 'all', announce: `${NOTHING_TO_FIX}.${tail}` };
}

/** "20 Nov 2026" (UTC), or null. */
export function dateWords(value) {
  const v = String(value ?? '');
  const t = Date.parse(v.length === 10 ? `${v}T00:00:00Z` : v);
  return Number.isFinite(t) ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(t) : null;
}

const MISSING_DATE = /source's date is not recorded/;
const MOVED = /its figure has changed in its store/;
/**
 * D8772 (PTF03): the repair a source finding on a bound metric tile offers where Show leaves the
 * founder, from the sources read the editor already holds (`GET /api/decks/sources`). Nothing is
 * saved: the tile changes in the draft, like Refresh from records, until a version is saved.
 *   · the date is not recorded, and the store holds the same snapshot with a date: bind it again,
 *     which keeps the value and adds the date ("Add the source date · 20 Nov 2026");
 *   · the figure moved in its store (or the date is missing and the store moved too): refresh to
 *     the store's figure, named ("Refresh to $36.0k · as of 20 Nov 2026");
 *   · otherwise a line that says why there is nothing to press (the source was not read, or it
 *     records no date either).
 * Null for any other finding.
 */
export function repairOf(row, block, items) {
  if (!row || row.check !== 'sources' || !block || block.kind !== 'metric' || !block.binding?.source_key) return null;
  const missing = MISSING_DATE.test(String(row.headline || ''));
  const moved = MOVED.test(String(row.headline || ''));
  if (!missing && !moved) return null;
  const item = itemsByKey(items).get(block.binding.source_key) || null;
  if (!item) return { state: 'unread', line: 'Its source has not been read here, so there is nothing to bind again yet.' };
  if (item.state !== 'recorded') return { state: 'gone', line: 'Its source records no figure now. The tile keeps what it shows until you change it.' };
  const when = dateWords(item.as_of);
  const same = (item.snapshot_hash ?? null) === (block.binding.snapshot_hash ?? null);
  if (missing && same && !when) return { state: 'no_date', line: 'Its source records no date either. Add one where the figure is recorded, then come back.' };
  const next = refreshMetric(block, item);
  const keeps = String(block.value ?? '').trim();
  if (same) {
    return {
      // The same snapshot: the figure is the same, so the tile keeps its own words for it.
      state: 'ready', block: { ...next, value: block.value }, edit: 'Add source date',
      action: `Add the source date · ${when}`,
      line: `Binds ${keeps || 'the figure'} to its source again: the value stays, the date is added in your draft.`,
    };
  }
  const now = valueText(item) || 'the store’s figure';
  return {
    state: 'ready', block: next, edit: 'Refresh figure',
    action: `Refresh to ${now}${when ? ` · as of ${when}` : ''}`,
    line: `The store moved from ${keeps || 'the figure on the tile'}. Refresh changes the tile in your draft.`,
  };
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
    // D8772: what could not be checked rides along, so the gate's headline never calls it a pass.
    unchecked: Array.isArray(groups.unchecked) ? groups.unchecked.length : 0,
    open: n > 0 || look.length > 0,
    title: share ? 'Before you share' : 'Before you export',
    fix,
    look,
    anyway: n === 0 ? `${verb} anyway` : null,
    waitLine: n > 0 ? `${verb} anyway opens once the ${plural(n, 'item', 'items')} to fix ${n === 1 ? 'is' : 'are'} fixed.` : null,
  };
}
/**
 * D4598 (#4598): the gate before Share and Export checks the version that will be sent, never the edits on screen.
 * `sentLine` says which; `DIRTY_LINE` says what that leaves out and the way to include it.
 */
export const sentLine = (version) => (version != null ? `v${version} · the saved version that will be sent` : 'The saved version that will be sent');
export const DIRTY_LINE = 'You have unsaved edits. This check read the saved version, not your edits: the link and the export carry the saved version. Save a new version to send your edits, then check again.';
export const SAVE_FIRST = 'Save a new version…';
/** Export's version picker: a version other than the one the gate checked has not been checked. */
export const notCheckedLine = (version, checkedVersion) => `${version != null ? `v${version}` : 'This version'} was not checked. The check before you export read ${checkedVersion != null ? `v${checkedVersion}` : 'another version'}.`;

/** The deck the editor holds now, as `runPreflight` reads a version. */
export const workingDeck = (deck, cards, theme) => ({ id: deck?.id ?? null, version: deck?.version ?? null, slides: cards, theme: theme ?? null });

/**
 * D4598 (#4598) part 2 — a hidden card is in no export (mirrors the Worker's own rule,
 * `visibleCards` in `services/decks/slideModel.ts`): the export dialog's check reads the
 * picked version's cards through this, so a finding's slide number is the export's, not
 * the editor's.
 */
export const exportableCards = (slides) => (Array.isArray(slides) ? slides.filter((s) => !(s && typeof s === 'object' && s.hidden === true)) : []);

/**
 * D4598 (#4598) part 2 — the effective deck Export or Share is about to check: `slides`
 * is the artifact's own content (`exportableCards`'s for Export, `preflight/link-cards`'s
 * for Share), not the saved version's as a whole. Null while that content is still being
 * read, so the caller shows "Checking…" rather than a result for the wrong combination.
 */
export const effectiveDeck = (id, version, slides, theme) => (Array.isArray(slides) ? { id: id ?? null, version: version ?? null, slides, theme: theme ?? null } : null);

/** Previous and Next over the findings (pf5g): "Findings · 1 of 8". */
export function stepOf(rows, id) {
  const i = rows.findIndex((r) => r.id === id);
  return { index: i, total: rows.length, line: i >= 0 ? `Findings · ${i + 1} of ${rows.length}` : null, prev: i > 0 ? rows[i - 1] : null, next: i >= 0 && i < rows.length - 1 ? rows[i + 1] : null };
}
