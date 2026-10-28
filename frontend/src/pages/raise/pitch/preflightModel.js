/**
 * #3661 — Pitch preflight: the checks a deck version gets before it is
 * exported or shared, pure. Every finding names its card and block, says what
 * is wrong and what to do, and is either export-blocking (a technical error
 * the export would lose content over) or a warning the founder may dismiss.
 *
 * WHAT IT NEVER DOES. It gives no score and no "investor ready" verdict. It
 * rewrites nothing, deletes nothing and corrects no figure: it only reads.
 * A check it cannot run honestly (clipping needs the rendered page) says
 * "Not measured", never a pass. It is not D900's evidence Check
 * (`checkModel.js`), which compares figures with their records.
 *
 * WHAT IT READS. One version (`{ id, version, slides, theme }`, as
 * `GET /api/decks/:id` returns it), the brand kit's palette, D896's refresh
 * rows when the page has them (stale or gone figures), and, optionally,
 * measurements of the rendered print page at 1920 × 1080
 * (`preflightMeasure.js`). The export pages draw the blocks at the print
 * sizes `BlockGrid.jsx` uses (`PRINT`), so the estimates below use those.
 */
import { cardColours, cardTitle } from './editorModel.js';
import { overlayContrast } from './imageContrast.js';

/** The print page: 1920 × 1080, 3% padding, a 24px gap, 12 × 6 cells (`BlockGrid.jsx`, size `print`). */
export const PRINT = Object.freeze({ width: 1920, height: 1080, pad: 0.03, gap: 24, cols: 12, rows: 6, font: { heading: 64, paragraph: 30, list: 30 } });
/** The smallest text an audience reads on a projected 1080p card, in CSS pixels (about 18 pt). */
export const MIN_FONT_PX = 24;
/** WCAG 2.x: body text 4.5:1; a heading at the print sizes is large text, 3:1. */
export const CONTRAST_BODY = 4.5;
export const CONTRAST_LARGE = 3;
/** More words than this on one card reads as a document, not a slide. */
export const CARD_WORDS_MAX = 110;
/** An image drawn larger than this many times its own pixels looks soft. */
export const UPSCALE_MAX = 1.5;
/** A bound figure older than this is flagged; the founder decides whether it is still true. */
export const STALE_DAYS = 120;

export const SEVERITY = Object.freeze({ blocking: 'blocking', warning: 'warning' });
export const CHECKS = Object.freeze([
  { key: 'layout', label: 'Grid and overlap' },
  { key: 'overflow', label: 'Clipped content' },
  { key: 'density', label: 'Text density' },
  { key: 'font', label: 'Font size' },
  { key: 'contrast', label: 'Contrast' },
  { key: 'image', label: 'Image resolution and fit' },
  { key: 'alt', label: 'Alt text' },
  { key: 'theme', label: 'Consistent theme' },
  { key: 'placeholder', label: 'Unresolved placeholders' },
  { key: 'sources', label: 'Sources' },
]);
export const CHECK_STATE = Object.freeze({ pass: 'Passed', findings: 'Needs attention', unmeasured: 'Not measured' });
export const NOT_MEASURED = 'Not measured: open the card at export size to measure it.';

const str = (v) => String(v ?? '').trim();
const blocksOf = (card) => (Array.isArray(card?.blocks) ? card.blocks : []);
const grid = (b) => b?.grid || {};
const ok = (n) => Number.isInteger(n);

/** A block's range on the print page, in pixels. */
export function blockPx(g) {
  const w = PRINT.width * (1 - 2 * PRINT.pad);
  const h = PRINT.height - 2 * PRINT.pad * PRINT.width;
  const cw = (w - (PRINT.cols - 1) * PRINT.gap) / PRINT.cols;
  const ch = (h - (PRINT.rows - 1) * PRINT.gap) / PRINT.rows;
  const cols = g.c2 - g.c1 + 1;
  const rows = g.r2 - g.r1 + 1;
  return { w: cols * cw + (cols - 1) * PRINT.gap, h: rows * ch + (rows - 1) * PRINT.gap };
}

const HEX = /^#[0-9a-f]{6}$/i;
const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).reduce((acc, c, i) => acc + [0.2126, 0.7152, 0.0722][i] * lin(c), 0);
/** WCAG contrast of two `#rrggbb` colours, to two places, or null when either is not one. */
export function contrast(a, b) {
  if (!HEX.test(a || '') || !HEX.test(b || '')) return null;
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return Math.floor(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/** Words in a text: Latin words, and each CJK character as one (a Chinese or Japanese line has no spaces). */
export function wordCount(text) {
  const t = str(text);
  if (!t) return 0;
  const cjk = (t.match(/[぀-ヿ㐀-鿿가-힯]/g) || []).length;
  const rest = t.replace(/[぀-ヿ㐀-鿿가-힯]/g, ' ').split(/\s+/).filter(Boolean).length;
  return cjk + rest;
}

/**
 * About how many lines a text needs in a range at its print size: an
 * estimate (a character is about 0.55 em wide, a CJK one 1 em), never a
 * measurement. `fits` is false when the estimate passes the range's height.
 */
export function textFit(block) {
  const size = PRINT.font[block?.style] || PRINT.font.paragraph;
  const { w, h } = blockPx(grid(block));
  const lineH = size * (block?.style === 'heading' ? 1.25 : 1.375);
  const paras = (block?.style === 'list' ? str(block?.text).split('\n') : [str(block?.text)]).filter(Boolean);
  let lines = 0;
  for (const p of paras) {
    const cjk = (p.match(/[぀-ヿ㐀-鿿가-힯]/g) || []).length;
    const ems = cjk + (p.length - cjk) * 0.55;
    lines += Math.max(1, Math.ceil((ems * size) / Math.max(1, w - (block?.style === 'list' ? 32 : 0))));
  }
  const room = Math.max(1, Math.floor(h / lineH));
  return { lines, room, fits: lines <= room };
}

const PLACEHOLDERS = [
  { re: /\[[^\]\n]{1,60}\]/, word: 'a bracketed sample' },
  { re: /\{\{[^}\n]{0,60}\}\}/, word: 'a template field' },
  { re: /\blorem ipsum\b/i, word: 'lorem ipsum' },
  { re: /\b(?:TBD|TODO|XXX|TK)\b/, word: 'a note to self' },
  { re: /\b(?:Your company|Company name|Insert [a-z]+ here)\b/i, word: 'template wording' },
];
/** The first placeholder in a text, as `{ match, word }`, or null. */
export function placeholderIn(text) {
  const t = str(text);
  for (const p of PLACEHOLDERS) {
    const m = p.re.exec(t);
    if (m) return { match: m[0], word: p.word };
  }
  return null;
}

/** The texts of one block a reader sees, with the word that names each. */
function textsOf(b) {
  if (b.kind === 'text') return [str(b.text)];
  if (b.kind === 'metric') return [str(b.label), str(b.value)];
  if (b.kind === 'link' || b.kind === 'audio') return [str(b.label)];
  if (b.kind === 'video') return [str(b.title)];
  if (b.kind === 'image') return [str(b.alt)];
  if (b.kind === 'chart') return (b.series || []).map((s) => str(s?.label));
  return [];
}

const days = (asOf, now) => {
  const t = Date.parse(String(asOf || '').length === 10 ? `${asOf}T00:00:00Z` : String(asOf || ''));
  return Number.isFinite(t) ? Math.floor((now - t) / 86400000) : null;
};

/**
 * A stable key for one version's content, so a result is shown only beside
 * the version it was run on (a 32-bit FNV-1a of its slides and theme).
 */
export function deckKey(deck) {
  const s = JSON.stringify({ id: deck?.id ?? null, version: deck?.version ?? null, slides: deck?.slides ?? [], theme: deck?.theme ?? null });
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${deck?.id ?? 'deck'}:${deck?.version ?? 'v'}:${h.toString(16).padStart(8, '0')}`;
}

/**
 * Run every check on one version. `measurements` maps `"<card>:<block>"` to
 * `preflightMeasure.js`'s `{ clipped, font_px, natural_w, natural_h }` for
 * the rendered print page; without it, clipping is "Not measured".
 *
 * Returns `{ key, findings, checks }`. A finding is `{ id, check, severity,
 * card, block, title, detail, fix, dismissible }`, with `card` the card's
 * index (0-based) and `block` its block id, or null for the card itself.
 */
export function runPreflight(deck, { kit = null, refresh = null, measurements = null, now = Date.now() } = {}) {
  const slides = Array.isArray(deck?.slides) ? deck.slides : [];
  const colours = cardColours(deck?.theme, kit);
  const findings = [];
  const add = (check, severity, card, block, title, detail, fix) => findings.push({
    id: `${check}:${card}:${block ?? '-'}:${findings.filter((f) => f.check === check && f.card === card && f.block === (block ?? null)).length}`,
    check, severity, card, block: block ?? null, title, detail, fix, dismissible: severity === SEVERITY.warning,
  });
  const measured = measurements && typeof measurements === 'object' ? measurements : null;
  const stale = new Map();
  for (const r of Array.isArray(refresh?.rows) ? refresh.rows : []) {
    if ((r?.state === 'stale' || r?.state === 'gone') && Number.isInteger(r.slide)) stale.set(r.slide, r.state);
  }
  const bgCount = new Map();
  for (const s of slides) {
    const c = s?.background?.color;
    if (c && !s?.background?.image_url) bgCount.set(c, (bgCount.get(c) || 0) + 1);
  }

  slides.forEach((card, i) => {
    const name = `Card ${i + 1}, ${cardTitle(card, i)}`;
    const blocks = blocksOf(card);
    // Grid and overlap: a block off the 12 × 6 grid, or on another, is dropped on read (`sanitizeBlocks`).
    const placed = [];
    for (const b of blocks) {
      const g = grid(b);
      const on = ok(g.c1) && ok(g.c2) && ok(g.r1) && ok(g.r2) && g.c1 >= 1 && g.c1 <= g.c2 && g.c2 <= PRINT.cols && g.r1 >= 1 && g.r1 <= g.r2 && g.r2 <= PRINT.rows;
      if (!on) { add('layout', SEVERITY.blocking, i, b.id, `${name}: a block sits off the grid.`, 'Its range is outside the 12 × 6 grid, so the export would leave it out.', 'Move or resize it onto the grid.'); continue; }
      const hit = placed.find((p) => g.c1 <= p.grid.c2 && p.grid.c1 <= g.c2 && g.r1 <= p.grid.r2 && p.grid.r1 <= g.r2);
      if (hit) add('layout', SEVERITY.blocking, i, b.id, `${name}: two blocks overlap.`, `It shares cells with block ${hit.id}, so the export would leave one out.`, 'Move one of them.');
      else placed.push(b);
    }
    if (blocks.length > 24) add('layout', SEVERITY.blocking, i, null, `${name}: more than 24 blocks.`, `It has ${blocks.length}; a card keeps 24.`, 'Move some to another card.');

    const bg = card?.background?.image_url ? null : (card?.background?.color || colours.bg);
    const words = blocks.filter((b) => b.kind === 'text').reduce((n, b) => n + wordCount(b.text), 0);
    if (words > CARD_WORDS_MAX) add('density', SEVERITY.warning, i, null, `${name}: ${words} words on one card.`, `More than ${CARD_WORDS_MAX} words reads as a document, not a slide.`, 'Move detail to the speaker notes or another card.');

    for (const b of blocks) {
      const where = `${name}, block ${b.id}`;
      const m = measured ? measured[`${i}:${b.id}`] : null;
      if (b.kind === 'text' && str(b.text)) {
        const fit = textFit(b);
        if (m && typeof m.clipped === 'boolean') {
          if (m.clipped) add('overflow', SEVERITY.blocking, i, b.id, `${where}: the text is cut off at export size.`, 'Part of it falls outside its range on the 1920 × 1080 card, so the PDF and PowerPoint would lose it.', 'Shorten it, or give the block more rows.');
        } else if (!fit.fits) {
          add('density', SEVERITY.warning, i, b.id, `${where}: likely too much text for its range.`, `An estimate: about ${fit.lines} lines at its size, with room for ${fit.room}. Not measured on the rendered card.`, 'Shorten it, or give the block more rows.');
        }
        const px = m && Number.isFinite(m.font_px) ? m.font_px : PRINT.font[b.style] || PRINT.font.paragraph;
        if (px < MIN_FONT_PX) add('font', SEVERITY.warning, i, b.id, `${where}: the text is ${Math.round(px)}px at export size.`, `Below ${MIN_FONT_PX}px an audience cannot read it from the room.`, 'Use fewer words so it can be larger.');
        if (bg) {
          const ratio = contrast(colours.ink, bg);
          const min = b.style === 'heading' ? CONTRAST_LARGE : CONTRAST_BODY;
          if (ratio !== null && ratio < min) add('contrast', SEVERITY.warning, i, b.id, `${where}: the text contrast is ${ratio}:1.`, `It needs ${min}:1 on this background.`, 'Change the card background or the theme.');
        }
      }
      if (b.kind === 'image') {
        if (!str(b.image_url)) add('image', SEVERITY.blocking, i, b.id, `${where}: an image block with no image.`, 'The export would draw an empty range.', 'Choose an image, or remove the block.');
        else {
          if (!str(b.alt)) add('alt', SEVERITY.warning, i, b.id, `${where}: the image has no alt text.`, 'A screen reader, and the HTML export, have nothing to say for it.', 'Add alt text in the image toolbar.');
          if (m && Number.isFinite(m.natural_w) && Number.isFinite(m.natural_h) && m.natural_w > 0 && m.natural_h > 0) {
            const { w, h } = blockPx(grid(b));
            const scale = b.fit === 'contain' ? Math.min(w / m.natural_w, h / m.natural_h) : Math.max(w / m.natural_w, h / m.natural_h);
            if (scale > UPSCALE_MAX) add('image', SEVERITY.warning, i, b.id, `${where}: the image is ${m.natural_w} × ${m.natural_h} pixels for a ${Math.round(w)} × ${Math.round(h)} range.`, `It is drawn ${Math.round(scale * 10) / 10} times larger than its pixels, so it looks soft.`, 'Use a larger file, or a smaller range.');
          }
        }
      }
      for (const t of textsOf(b)) {
        const p = placeholderIn(t);
        if (p) { add('placeholder', SEVERITY.warning, i, b.id, `${where}: "${p.match}" looks like ${p.word}.`, 'It would reach the export as it is.', 'Replace it with the real words, or remove it.'); break; }
      }
      if (b.kind === 'metric' && str(b.value) && !b.binding) add('sources', SEVERITY.warning, i, b.id, `${where}: the figure ${str(b.value)} has no source.`, 'It was typed, so nothing on file backs it.', 'Bind it to a record, or say where it comes from in the notes.');
      if (b.binding) {
        const age = days(b.binding.as_of, now);
        if (age === null) add('sources', SEVERITY.warning, i, b.id, `${where}: the source's date is not recorded.`, 'Nobody can tell how current the figure is.', 'Refresh the figure from its source.');
        else if (age > STALE_DAYS) add('sources', SEVERITY.warning, i, b.id, `${where}: the source is ${age} days old.`, `Its figure is as of ${b.binding.as_of}.`, 'Refresh it, or keep it as of that date with a note.');
      }
      if (b.kind === 'chart') {
        const series = Array.isArray(b.series) ? b.series : [];
        if (!series.length) add('sources', SEVERITY.warning, i, b.id, `${where}: the chart has no series.`, 'It would export as an empty chart.', 'Add a series from your records.');
        else if (series.some((s) => !s?.binding)) add('sources', SEVERITY.warning, i, b.id, `${where}: a series was typed, not bound.`, 'Its points have no record behind them.', 'Bind it to a record.');
      }
    }
    if (stale.has(i)) add('sources', SEVERITY.warning, i, null, `${name}: ${stale.get(i) === 'gone' ? 'a bound figure is no longer in its store' : 'a bound figure has changed in its store'}.`, 'The card shows an older figure than the record.', 'Open the card and refresh its figures.');
    if (card?.background?.image_url) {
      const ratio = overlayContrast(card.background.overlay || 'none', colours.ink);
      if (ratio < CONTRAST_BODY && blocks.some((b) => b.kind === 'text' && str(b.text))) add('contrast', SEVERITY.warning, i, null, `${name}: text on the background image could read at ${ratio}:1.`, `At worst, on a light part of the image; it needs ${CONTRAST_BODY}:1.`, 'Use a stronger overlay.');
    }
    const own = card?.background?.color && !card?.background?.image_url ? card.background.color : null;
    if (own && slides.length >= 3 && bgCount.get(own) === 1 && own !== colours.bg) add('theme', SEVERITY.warning, i, null, `${name}: its background ${own} is used on no other card.`, 'One card off the theme reads as a mistake.', 'Use the theme background, or Apply to all.');
  });

  const has = (k) => findings.some((f) => f.check === k);
  const anyText = slides.some((s) => blocksOf(s).some((b) => b.kind === 'text' && str(b.text)));
  const checks = CHECKS.map((c) => {
    if (c.key === 'overflow' && anyText && !(measured && slides.every((s, i) => blocksOf(s).filter((b) => b.kind === 'text' && str(b.text)).every((b) => typeof measured[`${i}:${b.id}`]?.clipped === 'boolean')))) {
      return { ...c, state: has('overflow') ? 'findings' : 'unmeasured' };
    }
    if (c.key === 'image' && !has('image') && slides.some((s, i) => blocksOf(s).some((b) => b.kind === 'image' && str(b.image_url) && !Number.isFinite(measured?.[`${i}:${b.id}`]?.natural_w)))) {
      return { ...c, state: 'unmeasured' };
    }
    return { ...c, state: has(c.key) ? 'findings' : 'pass' };
  });
  return { key: deckKey(deck), findings, checks };
}

/** The result for this version only: a result run on another version is not shown. */
export const currentResult = (result, deck) => (result && result.key === deckKey(deck) ? result : null);

/** Whether the export may run: no blocking finding. Dismissed warnings are the founder's; blocking ones cannot be dismissed. */
export function exportGate(result, dismissed = new Set()) {
  const findings = Array.isArray(result?.findings) ? result.findings : [];
  const blocking = findings.filter((f) => f.severity === SEVERITY.blocking);
  const warnings = findings.filter((f) => f.severity === SEVERITY.warning && !dismissed.has(f.id));
  return { blocked: blocking.length > 0, blocking, warnings };
}

/** The summary line: counts by severity, never a score. */
export function summaryLine(result) {
  if (!result) return 'Preflight has not run on this version.';
  const blocking = result.findings.filter((f) => f.severity === SEVERITY.blocking).length;
  const warnings = result.findings.length - blocking;
  const unmeasured = result.checks.filter((c) => c.state === 'unmeasured').map((c) => c.label);
  const head = !result.findings.length ? 'No findings.' : [blocking ? `${blocking} blocking` : null, warnings ? `${warnings} ${warnings === 1 ? 'warning' : 'warnings'}` : null].filter(Boolean).join(' · ') + '.';
  return unmeasured.length ? `${head} Not measured: ${unmeasured.join(', ')}.` : head;
}
