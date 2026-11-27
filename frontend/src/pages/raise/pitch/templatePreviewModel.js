/**
 * D8770 (#8770, canvas PTP01 to PTP16) — the template preview's rules, pure.
 * No React, no network.
 *
 *   One layout, scaled   every card is laid out once at its export size
 *                        (1920 × 1080, `BlockGrid`'s `print` size, which the
 *                        canvas's 960 × 540 halves to) and scaled as one
 *                        picture (`previewScale`). Text keeps its line breaks at
 *                        every size, so what fits full size fits in every
 *                        thumbnail; a card too small to read offers Open full
 *                        size (`tooSmall`).
 *   The template's face  the store's theme, not Present's fixed face: its
 *                        ground, ink, accent and chart colours, its display,
 *                        body and mono faces with the theme's own fallbacks
 *                        (`previewFace`, `fontsHref`).
 *   Example and Blank    Example draws the fictional company of
 *                        `templateExamples.js` over a copy of the cards;
 *                        Blank structure is the cards as the store holds them
 *                        (`previewSlides`). Only the blank structure becomes a
 *                        deck: Use this template sends the template's uid.
 *   Charts               plotted, with axes from 0, units and the last value,
 *                        stepping down for 2, 1 or no points (`chartPlan`).
 *   Read this slide      the takeaway, the data as a table, the source and
 *                        what the blank structure holds (`readSlide`).
 *
 * D8770 part 3 (canvas PTP08, PTP16, PTP20 to PTP25):
 *   Chrome and decor     the template's own chrome (`templateChrome`,
 *                        `chromeLines`) and each card's decor (`decorPlan`):
 *                        rules drawn here, icons, shapes and textures from the
 *                        elements library (`decorArt`, `decorArtSrc`).
 *   Example unavailable  a template the example covers none of shows its
 *                        blank structure and says so (`viewFor`).
 *   The phone            the sheet's one card (`sheetCard`), the full-size
 *                        title (`phoneHeading`) and its hint.
 */
import { FRAME, SLIDE_SIZES, aspectOf, boxOf } from './gridModel';
import { EXAMPLE_AS_OF, EXAMPLE_COMPANY, cardKeyOf, exampleFor } from './templateExamples';

export const VIEWS = Object.freeze({ example: 'Example', blank: 'Blank structure' });
/** Owner Q1, option A (D8770): the preview opens on the Example. */
export const DEFAULT_VIEW = 'example';
export const VIEW_GROUP = 'Preview content';
export const OPEN_FULL = 'Open full size';
export const TOO_SMALL = 'Too small to read here';
export const RUNS_PAST = 'Text runs past its area';
export const READ_SLIDE = 'Read this slide';
export const IN_BLANK = 'In the blank structure';
export const KEYS_LINE = '← → move between slides · Esc closes';
export const SCALED_LINE = 'Each card is laid out once at full size and scaled, so it never re-wraps.';

/** `BlockView`'s heading size at export size (`size="print"`). */
export const HEADING_PX = 64;
/** Under this effective heading size, a reduced card is for shape, not reading (canvas PTP13). */
export const READABLE_PX = 9;

const str = (v) => (v == null ? '' : String(v).trim());

/** The layout's own pixel size for an aspect: 1920 × 1080 or 1440 × 1080. */
export const layoutSize = (aspect = '16:9') => SLIDE_SIZES[aspectOf(aspect)];

/** How much a card laid out at its export size is scaled to fit `width` CSS pixels. */
export function previewScale(width, aspect = '16:9') {
  const w = Number(width);
  if (!Number.isFinite(w) || w <= 0) return 0;
  return w / layoutSize(aspect).width;
}

/** A heading's size on screen at this width, in CSS pixels. */
export const effectiveHeading = (width, aspect = '16:9') => HEADING_PX * previewScale(width, aspect);

/** Whether a card this wide is too small to read, so it says so and offers Open full size. */
export function tooSmall(width, aspect = '16:9') {
  const w = Number(width);
  return Number.isFinite(w) && w > 0 && effectiveHeading(w, aspect) < READABLE_PX;
}

// ── The template's face ────────────────────────────────────────────────────

const HEX = /^#[0-9a-f]{6}$/i;
const FAMILY = /^[A-Za-z0-9 ]{1,40}$/;
const SERIF = new Set(['Lora', 'Fraunces', 'Newsreader', 'Playfair Display', 'Source Serif 4', 'Libre Caslon Text', 'Literata', 'Cormorant Garamond']);
const MONO = new Set(['Roboto Mono', 'IBM Plex Mono', 'JetBrains Mono']);
/** The store's own fallbacks (`templateLibrary.FALLBACK_FONTS`) when a theme names none. */
const FALLBACKS = { display: 'Space Grotesk', body: 'Inter', mono: 'Roboto Mono' };
/** Present's face (`PitchPresent.FACE_COLOURS`), for a card whose theme gives no colours. */
const PLAIN = { ground: '#fbfaf7', ink: '#0f2a3d', accent: '#6d28d9', muted: '#64748b', hairline: '#e5e7eb' };
const PLAIN_CHART = ['#1F4E79', '#B04A22', '#2F6B3E', '#6B3F8F', '#7A5C12', '#9B2C4A'];

const family = (v) => (FAMILY.test(str(v)) ? str(v) : null);
const colour = (v, fallback) => (HEX.test(str(v)) ? str(v) : fallback);
const generic = (f) => (SERIF.has(f) ? 'serif' : MONO.has(f) ? 'monospace' : 'sans-serif');
/** A CSS stack: the theme's face, then its fallback, then the generic family of the theme's face. */
function stack(face, fallback) {
  const list = [face, fallback].filter(Boolean);
  const unique = [...new Set(list)];
  return [...unique.map((f) => `"${f}"`), generic(face || fallback)].join(', ');
}

/** The faces a theme names: display, body and mono, each a known-safe family name or the fallback. */
export function themeFonts(theme) {
  const f = theme && typeof theme === 'object' && theme.fonts && typeof theme.fonts === 'object' ? theme.fonts : {};
  const fb = theme?.fallback_fonts && typeof theme.fallback_fonts === 'object' ? theme.fallback_fonts : {};
  const out = {};
  for (const role of ['display', 'body', 'mono']) out[role] = { face: family(f[role]), fallback: family(fb[role]) || FALLBACKS[role] };
  return out;
}

/**
 * The card's colours and faces from the store's theme (`templateLibrary.compose`'s
 * `colours`, `chart` and `fonts`). The object is `BlockView`'s `colours`
 * (`bg`, `ink`, `accent`, `muted`), plus the faces it draws headings in.
 */
export function previewFace(theme) {
  const c = theme && typeof theme === 'object' && theme.colours && typeof theme.colours === 'object' ? theme.colours : {};
  const fonts = themeFonts(theme);
  const chart = Array.isArray(theme?.chart) ? theme.chart.filter((x) => HEX.test(str(x))) : [];
  return {
    bg: colour(c.ground, PLAIN.ground),
    ink: colour(c.ink, PLAIN.ink),
    accent: colour(c.accent, PLAIN.accent),
    muted: colour(c.muted, PLAIN.muted),
    hairline: colour(c.hairline, PLAIN.hairline),
    chart: chart.length ? chart : PLAIN_CHART,
    display: stack(fonts.display.face, fonts.display.fallback),
    body: stack(fonts.body.face, fonts.body.fallback),
    mono: stack(fonts.mono.face, fonts.mono.fallback),
    themed: Boolean(c.ground || fonts.display.face),
    // D8770 part 3: the template's chrome travels with its face, so every preview card draws it.
    chrome: templateChrome(theme),
  };
}

/**
 * The Google Fonts stylesheet for the theme's faces (each under an open
 * licence, `templateLibrary.FONT_LICENCES`), or null when it names none.
 * Only plain family names pass `themeFonts`, so nothing else reaches the URL.
 */
export function fontsHref(theme) {
  const fonts = themeFonts(theme);
  const names = [...new Set(['display', 'body', 'mono'].map((r) => fonts[r].face).filter(Boolean))];
  if (!names.length) return null;
  const q = names.map((n) => `family=${n.replace(/ /g, '+')}:wght@400;500;700`).join('&');
  return `https://fonts.googleapis.com/css2?${q}&display=swap`;
}

/** "Lora · Inter · IBM Plex Mono", for the aside's "what the template sets". */
export function typeLine(theme) {
  const f = themeFonts(theme);
  const names = ['display', 'body', 'mono'].map((r) => f[r].face).filter(Boolean);
  return names.length ? names.join(' · ') : null;
}

/** What a template sets, as the aside lists it: theme, type and aspect. Only what the store says. */
export function templateSets(read) {
  const theme = read?.theme && typeof read.theme === 'object' ? read.theme : null;
  const rows = [];
  if (theme?.name) rows.push(['Theme', `${str(theme.name)}${HEX.test(str(theme?.colours?.accent)) ? ` · accent ${theme.colours.accent}` : ''}`]);
  const type = typeLine(theme);
  if (type) rows.push(['Type', type]);
  const cards = Array.isArray(read?.cards) ? read.cards.length : 0;
  rows.push(['Aspect', `${aspectOf(read?.template?.aspect || theme?.aspect)}${cards ? ` · ${cards} cards` : ''}`]);
  return rows;
}

// ── Example and Blank structure ─────────────────────────────────────────────

/** A drawn picture, as a data URL the `<img>` of `BlockView` can show. */
const svgUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The example's product screen: a fictional expiry list, drawn, not photographed. */
export function exampleScreen(face) {
  const rows = [['Oat milk 1L', 'Thu', '−30%'], ['Sourdough loaf', 'Today', '−50%'], ['Greek yoghurt', 'Fri', '−20%'], ['Free-range eggs', 'Sat', '—'], ['Hummus 200g', 'Sun', '—']];
  const body = rows.map(([item, day, off], i) => {
    const y = 210 + i * 92;
    return `<rect x="70" y="${y}" width="1060" height="76" rx="10" fill="#ffffff" stroke="${face.hairline}" stroke-width="2"/>`
      + `<text x="100" y="${y + 48}" font-size="30" font-family="Arial, sans-serif" fill="${face.ink}">${esc(item)}</text>`
      + `<text x="760" y="${y + 48}" font-size="28" font-family="Arial, sans-serif" fill="${face.muted}">${esc(day)}</text>`
      + `<text x="1080" y="${y + 48}" font-size="30" font-weight="700" text-anchor="end" font-family="Arial, sans-serif" fill="${face.accent}">${esc(off)}</text>`;
  }).join('');
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 760"><rect width="1200" height="760" rx="28" fill="${face.ink}"/>`
    + `<rect x="30" y="30" width="1140" height="700" rx="16" fill="#f7f7f5"/>`
    + `<text x="70" y="110" font-size="40" font-weight="700" font-family="Arial, sans-serif" fill="${face.ink}">Expires this week</text>`
    + `<text x="70" y="160" font-size="26" font-family="Arial, sans-serif" fill="${face.muted}">Larder Lane · Corner shop · sample screen</text>${body}</svg>`);
}

/** The example's illustration: a shelf with date labels, flat shapes in the theme's colours. */
export function exampleScene(face) {
  const shelf = (y) => `<rect x="80" y="${y}" width="1040" height="14" fill="${face.ink}" opacity="0.7"/>`;
  const jars = [0, 1, 2, 3, 4, 5].map((i) => `<rect x="${120 + i * 165}" y="${190 + (i % 2) * 30}" width="110" height="${150 - (i % 2) * 30}" rx="14" fill="${face.chart[i % face.chart.length]}" opacity="0.85"/>`
    + `<rect x="${130 + i * 165}" y="300" width="90" height="34" rx="4" fill="#ffffff"/>`).join('');
  const boxes = [0, 1, 2, 3].map((i) => `<rect x="${150 + i * 240}" y="${430 + (i % 2) * 20}" width="190" height="${170 - (i % 2) * 20}" fill="${face.accent}" opacity="${0.35 + i * 0.12}"/>`).join('');
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 760"><rect width="1200" height="760" fill="${face.bg}"/>${jars}${shelf(350)}${boxes}${shelf(610)}</svg>`);
}

/**
 * A missing image or photo, drawn as a labelled frame (canvas PTP15) instead
 * of an empty area: what belongs there, and that none is chosen yet.
 */
export function mediaFallback(block, face) {
  const what = str(block?.alt) || (block?.tag === 'photo' ? 'Photo' : 'Image');
  const line = block?.tag === 'photo' ? 'Photo · not added yet' : block?.tag === 'screenshot' ? 'Screenshot · not added yet' : 'Image · not chosen yet';
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><rect x="6" y="6" width="788" height="488" fill="${face.bg}" stroke="${face.muted}" stroke-width="5" stroke-dasharray="22 14"/>`
    + `<text x="400" y="235" text-anchor="middle" font-size="40" font-family="Arial, sans-serif" fill="${face.ink}">${esc(what.slice(0, 40))}</text>`
    + `<text x="400" y="295" text-anchor="middle" font-size="32" font-family="Arial, sans-serif" fill="${face.muted}">${esc(line)}</text></svg>`);
}

const clone = (v) => JSON.parse(JSON.stringify(v ?? null));

/** One area's block with the example drawn over it: a fresh object, never the store's. */
function exampleBlock(block, fill, face) {
  const b = clone(block);
  if (!fill) return b;
  if ('text' in fill) {
    b.text = fill.text;
    delete b.binding;
    delete b.runs;
    return b;
  }
  if ('value' in fill) {
    if (b.kind === 'metric') { b.value = fill.value; if (fill.label) b.label = fill.label; delete b.binding; } else { b.text = fill.value; }
    return b;
  }
  if ('image' in fill) {
    b.image_url = fill.image === 'screen' ? exampleScreen(face) : fill.image === 'scene' ? exampleScene(face) : null;
    // A drawn screen or scene is shown whole at its own ratio, never re-cropped for the area (D903, PTP13).
    if (b.image_url) b.fit = 'contain';
    if (fill.alt) b.alt = fill.alt;
    return b;
  }
  if (fill.series) { b.series = clone(fill.series); return b; }
  if (fill.table) { b.table = clone(fill.table); return b; }
  if (fill.shares) { b.shares = clone(fill.shares); return b; }
  if (fill.milestones) { b.milestones = clone(fill.milestones); return b; }
  if (fill.diagram && b.diagram && typeof b.diagram === 'object') { b.diagram = { ...b.diagram, items: fill.diagram.map((label) => ({ label })) }; return b; }
  return b;
}

/**
 * One card as the Example view draws it: a copy with the example's words,
 * figures and pictures in the areas the example fills, marked `example`.
 * A card the example has no words for is the blank structure, unmarked.
 */
export function exampleSlide(slide, face = previewFace(null)) {
  const ex = exampleFor(cardKeyOf(slide), slide?.layout);
  if (!ex) return clone(slide);
  const out = clone(slide);
  out.blocks = (Array.isArray(slide?.blocks) ? slide.blocks : []).map((b) => exampleBlock(b, ex.areas?.[b?.id], face));
  out.example = { company: EXAMPLE_COMPANY, source: ex.source || null, as_of: EXAMPLE_AS_OF };
  return out;
}

/** The cards a view draws: the store's own (Blank structure) or the example's copies (Example). */
export function previewSlides(cards, view = DEFAULT_VIEW, face = previewFace(null)) {
  const list = Array.isArray(cards) ? cards : [];
  return view === 'blank' ? list : list.map((s) => exampleSlide(s, face));
}

/** Every image area with no picture drawn as its labelled frame (canvas PTP15). */
export function withMedia(blocks, face) {
  return (Array.isArray(blocks) ? blocks : []).map((b) => (b?.kind === 'image' && !str(b.image_url) ? { ...b, image_url: mediaFallback(b, face), fit: 'contain' } : b));
}

/** The example's source line, as the slide carries it. Blank cards carry none. */
export function sourceLine(slide) {
  const ex = slide?.example;
  if (!ex?.source) return null;
  return `Source · ${ex.source} · sample, fictional · as of ${ex.as_of || EXAMPLE_AS_OF}`;
}

// ── Charts ──────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Jun", or "Nov 2026" with the year. */
export function monthLabel(x, year = false) {
  const m = /^(\d{4})-(\d{2})/.exec(str(x));
  if (!m) return str(x);
  const name = MONTHS[Number(m[2]) - 1] || str(x);
  return year ? `${name} ${m[1]}` : name;
}

/** A figure in its unit: "$10.6k", "$540k", "83". */
export function formatValue(y, unit) {
  const n = Number(y);
  if (!Number.isFinite(n)) return '—';
  if (unit === 'usd') {
    const a = Math.abs(n);
    if (a >= 1e6) return `$${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
    if (a >= 1e3) return `$${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
    return `$${n}`;
  }
  if (unit === 'usd_k') return n >= 1000 ? `$${(n / 1000).toFixed(1).replace(/\.0$/, '')}M` : `$${n}k`;
  return n.toLocaleString('en-US');
}

/** The unit's name beside a series' label: "MRR · US$". */
export const unitName = (unit) => ({ usd: 'US$', usd_k: 'US$', count: 'count' }[unit] || '');

/** Ticks from 0 up to a round step past `max`: 3 or 4 of them (canvas PTP12, rule 3). */
export function niceTicks(max) {
  const m = Number(max);
  if (!Number.isFinite(m) || m <= 0) return [0, 1];
  // Of 3 or 2 steps, the one whose top sits closest above `max`; a tie keeps more ticks.
  let best = null;
  for (const parts of [3, 2]) {
    const raw = m / parts;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s * parts >= m);
    if (step && (!best || step * parts < best.top)) best = { parts, step, top: step * parts };
  }
  return best ? Array.from({ length: best.parts + 1 }, (_, i) => +(i * best.step).toFixed(6)) : [0, m];
}

const pointsOf = (s) => (Array.isArray(s?.points) ? s.points.filter((p) => p && Number.isFinite(Number(p.y))).map((p) => ({ x: p.x, y: Number(p.y) })) : []);
const AREA_NAMES = { validate: 'Validate', build: 'Build', raise: 'Raise', grow: 'Grow', team: 'Team' };
/** Where a series' figures come from in a real deck: "Grow", from its binding. */
export const recordArea = (s) => AREA_NAMES[str(s?.binding?.source_key).split('.')[0]] || null;

/**
 * One series' panel, stepped down for too little data (canvas PTP12):
 *   3 or more points  `line`: ticks from 0, months, the year once, the last value
 *   2 points          `figures`: both, with their months, never a two-point line
 *   1 point           `figure`: the one value with its month
 *   none              `none`: "Not recorded", and where it would come from
 */
export function seriesPanel(s) {
  const pts = pointsOf(s);
  const label = str(s?.label) || 'Series';
  const unit = str(s?.unit) || null;
  const base = { label, unit, unitName: unitName(unit) };
  if (pts.length >= 3) {
    const max = Math.max(...pts.map((p) => p.y));
    const last = pts[pts.length - 1];
    return {
      ...base, state: 'line', points: pts, ticks: niceTicks(max),
      xLabels: pts.map((p, i) => monthLabel(p.x, i === pts.length - 1)), last: formatValue(last.y, unit),
    };
  }
  if (pts.length === 2) return { ...base, state: 'figures', points: pts, line: pts.map((p) => `${formatValue(p.y, unit)} ${monthLabel(p.x)}`).join(' → '), chip: '2 points · shown as figures' };
  if (pts.length === 1) return { ...base, state: 'figure', points: pts, line: formatValue(pts[0].y, unit), when: monthLabel(pts[0].x, true) };
  const area = recordArea(s);
  return { ...base, state: 'none', line: 'Not recorded', from: area ? `Your figures from ${area}, each with its source, or “Not recorded”.` : 'Your figures, each with its source, or “Not recorded”.' };
}

/**
 * How the preview draws a chart block. `panels` for series (each in its own
 * panel: two units never share an axis), `bars` for a ranked comparison of
 * single figures, `table` for a comparison, `shares` for a use of funds,
 * `milestones` for a roadmap, else `blank`: the frame that says what fills it.
 */
export function chartPlan(block) {
  const b = block && typeof block === 'object' ? block : {};
  const type = str(b.chart_type) || 'line';
  if (b.table && Array.isArray(b.table.rows)) return { kind: 'table', head: Array.isArray(b.table.head) ? b.table.head : null, rows: b.table.rows };
  if (Array.isArray(b.shares) && b.shares.length) {
    const total = b.shares.reduce((t, [, v]) => t + (Number(v) || 0), 0);
    return {
      kind: 'shares', total, totalLabel: formatValue(total, 'usd_k'),
      items: b.shares.map(([label, v]) => ({ label, value: Number(v) || 0, valueLabel: formatValue(v, 'usd_k'), share: total ? Math.round(((Number(v) || 0) / total) * 100) : 0 })),
    };
  }
  if (Array.isArray(b.milestones) && b.milestones.length) return { kind: 'milestones', items: b.milestones.map(([when, what]) => ({ when, what })) };
  const series = Array.isArray(b.series) ? b.series : [];
  const panels = series.map(seriesPanel);
  if (panels.length && panels.every((p) => p.state === 'none')) {
    return { kind: 'blank', type, labels: panels.map((p) => p.label), from: panels[0].from };
  }
  if (type === 'ranked_bars' && panels.length && panels.every((p) => p.state === 'figure' || p.state === 'none')) {
    const bars = panels.map((p) => ({ label: p.label, value: p.points?.[0]?.y ?? null, valueLabel: p.state === 'figure' ? p.line : 'Not recorded' }));
    return { kind: 'bars', bars, max: Math.max(1, ...bars.map((x) => x.value || 0)) };
  }
  if (!panels.length) return { kind: 'blank', type, labels: [], from: 'Your figures, each with its source, or “Not recorded”.' };
  return { kind: 'panels', type, panels };
}

/** A chart's data as rows for Read this slide: months by series, or the table, shares or milestones. */
export function dataTable(block) {
  const plan = chartPlan(block);
  if (plan.kind === 'table') return { head: plan.head || [], rows: plan.rows };
  if (plan.kind === 'shares') return { head: ['Use', 'Amount', 'Share'], rows: [...plan.items.map((i) => [i.label, i.valueLabel, `${i.share}%`]), ['Total', plan.totalLabel, '100%']] };
  if (plan.kind === 'milestones') return { head: ['When', 'Milestone'], rows: plan.items.map((i) => [i.when, i.what]) };
  if (plan.kind === 'bars') return { head: ['Measure', 'Value'], rows: plan.bars.map((x) => [x.label, x.valueLabel]) };
  if (plan.kind !== 'panels') return null;
  const xs = [...new Set(plan.panels.flatMap((p) => (p.points || []).map((pt) => str(pt.x))))].sort();
  if (!xs.length) return null;
  return {
    head: ['Month', ...plan.panels.map((p) => p.label)],
    rows: xs.map((x) => [monthLabel(x, true), ...plan.panels.map((p) => {
      const pt = (p.points || []).find((q) => str(q.x) === x);
      return pt ? formatValue(pt.y, p.unit) : '—';
    })]),
  };
}

// ── Read this slide ─────────────────────────────────────────────────────────

const HEAD_IDS = ['H', 'T', 'S', 'Q'];
/** The card's heading words: its takeaway in the Example, its placeholder in the blank structure. */
export function takeaway(slide) {
  const blocks = Array.isArray(slide?.blocks) ? slide.blocks : [];
  const head = HEAD_IDS.map((id) => blocks.find((b) => b?.id === id && b?.kind === 'text')).find(Boolean)
    || blocks.find((b) => b?.kind === 'text' && b?.style === 'heading');
  return str(head?.text) || str(slide?.title) || null;
}

/** What the blank structure holds in each area, in words: "Heading “[Growth so far]”". */
export function blankLines(slide) {
  const out = [];
  for (const b of Array.isArray(slide?.blocks) ? slide.blocks : []) {
    if (b?.kind === 'text') {
      const t = str(b.text).split('\n').filter(Boolean).join('; ');
      if (t) out.push(`${b.style === 'heading' ? 'Heading' : b.style === 'list' ? 'List' : 'Text'} “${t}”`);
    } else if (b?.kind === 'metric') {
      const area = recordArea(b);
      out.push(`${str(b.label) || 'A figure'}${area ? ` from ${area}` : ''}, or “Not recorded”`);
    } else if (b?.kind === 'chart') {
      const labels = (b.series || []).map((s) => str(s?.label)).filter(Boolean);
      const area = recordArea((b.series || [])[0]);
      out.push(`A chart of ${labels.join(' and ') || 'your figures'}${area ? ` from ${area}` : ''}, each with its source`);
    } else if (b?.kind === 'image') {
      out.push(`${b.tag === 'photo' ? 'A photo' : b.tag === 'screenshot' ? 'A screenshot' : 'An image'}: ${str(b.alt) || 'not chosen yet'}`);
    } else if (b?.kind === 'graphic') {
      out.push(`A diagram: ${(b.diagram?.items || []).map((i) => str(i?.label)).filter(Boolean).join(' → ')}`);
    }
  }
  return out;
}

/**
 * Read this slide (canvas PTP04): the title, the takeaway, the chart's data
 * as a table, the source, and what the blank structure holds instead.
 */
export function readSlide(blank, shown, index, count) {
  const title = str(blank?.title) || `Card ${index + 1}`;
  const chart = (Array.isArray(shown?.blocks) ? shown.blocks : []).find((b) => b?.kind === 'chart');
  return {
    heading: `Slide ${index + 1} of ${count} · ${title}`,
    takeaway: takeaway(shown),
    example: Boolean(shown?.example),
    table: chart ? dataTable(chart) : null,
    source: sourceLine(shown),
    blank: blankLines(blank),
  };
}

// ── The overflow check ──────────────────────────────────────────────────────

/**
 * The blocks a real layout measured as running past their area
 * (`preflightMeasure.measureBlocks`'s `clipped`), as `card:block` keys.
 */
export function overflowing(measures) {
  return Object.entries(measures && typeof measures === 'object' ? measures : {})
    .filter(([, m]) => m && m.clipped === true)
    .map(([k]) => k);
}

// ── Use this template ───────────────────────────────────────────────────────

/**
 * What Use this template carries and what it does not, as main's apply does
 * it today (`deck_templates.ts`, `/templates/:uid/apply`): the cards as
 * stored, through a proposal. The proposal keeps the current version's theme
 * when it is kept (D898), so the template's theme is said not to carry yet.
 */
export function carryLines(read, label) {
  const n = Array.isArray(read?.cards) ? read.cards.length : 0;
  const name = str(label) || 'the template';
  return {
    carries: [
      ['Structure', n ? `${n} cards in ${name}’s order` : `The cards in ${name}’s order`],
      ['Placeholders', 'Bracketed words where yours go; figures from your records, or “Not recorded”'],
    ],
    not: [
      ['Example', `[${EXAMPLE_COMPANY}]’s words, figures and pictures`],
      ['Theme and type', 'Not yet: the kept version takes your current version’s theme, or the default when there is none'],
      ['Art', 'No image is generated · no model runs'],
    ],
  };
}

// ── Example unavailable (canvas PTP16) ──────────────────────────────────────

export const EXAMPLE_UNAVAILABLE = 'Example unavailable';
export const EXAMPLE_UNAVAILABLE_LINE = 'The example has no card for this template’s layouts, so the blank structure is shown.';

/** How many of the cards the example has words for (by catalogue card and layout). */
export function exampleCoverage(cards) {
  return (Array.isArray(cards) ? cards : []).filter((s) => exampleFor(cardKeyOf(s), s?.layout)).length;
}

/**
 * The view the preview draws: the one chosen, except that a template the
 * example covers none of (one of Yours whose cards were renamed, say) falls
 * back to the blank structure, so placeholders are never shown as if they
 * were the example.
 */
export function viewFor(view, cards) {
  if (view !== 'example') return 'blank';
  return exampleCoverage(cards) > 0 ? 'example' : 'blank';
}

// ── The template's chrome and decor (canvas PTP08, PTP11) ───────────────────

const CHROME_KEYS = ['slide_number', 'footer_rule', 'venture_mark', 'section_label'];
const MARKS = ['top_left', 'bottom_left'];

/**
 * The chrome a template sets (`templateLibrary.compose`'s `theme.chrome`):
 * where the venture's name sits (top left, bottom left or nowhere), the slide
 * number bottom right, a hairline over the footer, and the card's own title
 * as a section label. A theme with no template chrome (a saved version's, in
 * Yours) keeps the preview's plain chrome: the name top left and the number.
 */
export function templateChrome(theme) {
  const c = theme && typeof theme === 'object' && theme.chrome && typeof theme.chrome === 'object' ? theme.chrome : null;
  if (!c || !CHROME_KEYS.some((k) => k in c)) return { mark: 'top_left', number: true, rule: false, section: false, template: false };
  return { mark: MARKS.includes(c.venture_mark) ? c.venture_mark : null, number: c.slide_number === 'bottom_right', rule: c.footer_rule === true, section: c.section_label === true, template: true };
}

/**
 * The chrome's two lines for one card: the top (the name and, with a section
 * label, the card's title) and the bottom (the name when it sits bottom left,
 * then the example's source line). Empty parts are left out.
 */
export function chromeLines(slide, chrome, name) {
  const ch = chrome || templateChrome(null);
  const title = str(slide?.title);
  const top = [ch.mark === 'top_left' ? name : null, ch.section && title ? title : null].filter(Boolean);
  const bottom = [ch.mark === 'bottom_left' ? name : null, sourceLine(slide)].filter(Boolean);
  return { top: top.join(' · ') || null, bottom: bottom.join(' · ') || null };
}

export const DECOR_TONES = Object.freeze(['ink', 'accent', 'muted', 'surface']);
const DIVIDER_STYLES = ['line', 'double', 'dashed', 'dotted', 'accent'];
const ART_KINDS = ['icon', 'shape', 'texture'];
/** A heading's rule at export size: the canvas's 56 px at 960 wide, doubled. */
export const RULE_PX = 112;
const RULE_H = 8;
const MAX_DECOR = 16;
const cell = (n) => Number.isInteger(n) && n >= 1 && n <= 12;

/** A decor tone's colour in the template's face. */
export function toneColour(tone, face) {
  const f = face || previewFace(null);
  return { ink: f.ink, accent: f.accent, muted: f.muted, surface: f.bg }[DECOR_TONES.includes(tone) ? tone : 'ink'];
}

/**
 * A card's decor as the preview draws it, at export size (canvas PTP08):
 *   divider   under a heading, a short rule in the gutter below its area (a
 *             double rule for Kitchen Table), so it never sits over the
 *             words; in a one-column area spanning rows, a vertical rule
 *   icon, shape, texture   the elements library's own drawing in its area
 * At most 16 items; an item with no area or an unknown kind is left out.
 */
export function decorPlan(slide, aspect = '16:9') {
  const list = Array.isArray(slide?.decor) ? slide.decor.slice(0, MAX_DECOR) : [];
  const out = [];
  list.forEach((d, i) => {
    const g = d?.grid;
    if (!g || ![g.c1, g.c2, g.r1, g.r2].every(cell) || g.c2 < g.c1 || g.r2 < g.r1) return;
    const id = typeof d.id === 'string' && d.id ? d.id : `d${i + 1}`;
    const tone = DECOR_TONES.includes(d.tone) ? d.tone : 'ink';
    const box = boxOf(g, aspect);
    if (d.kind === 'divider') {
      const style = DIVIDER_STYLES.includes(d.ref) ? d.ref : 'line';
      if (g.c1 === g.c2 && g.r2 > g.r1) {
        out.push({ id, kind: 'divider', style, tone, vertical: true, box: { x: box.x + Math.round(box.w / 2) - RULE_H / 2, y: box.y, w: RULE_H, h: box.h } });
      } else {
        out.push({ id, kind: 'divider', style, tone, vertical: false, box: { x: box.x, y: box.y + box.h + Math.round((FRAME.gutter - RULE_H) / 2), w: Math.min(box.w, RULE_PX), h: RULE_H } });
      }
      return;
    }
    if (ART_KINDS.includes(d.kind) && typeof d.ref === 'string' && d.ref) out.push({ id, kind: d.kind, ref: d.ref, tone, box });
  });
  return out;
}

/** The icons a template's cards name, for one read of the elements library. */
export function decorIcons(cards) {
  const refs = new Set();
  for (const s of Array.isArray(cards) ? cards : []) for (const d of decorPlan(s)) if (d.kind === 'icon') refs.add(d.ref);
  return [...refs].sort();
}

/** Whether any card has decor the elements library draws (an icon, shape or texture). */
export const needsDecorArt = (cards) => (Array.isArray(cards) ? cards : []).some((s) => decorPlan(s).some((d) => d.kind !== 'divider'));

/**
 * The library's drawings by `kind:ref`, from `deckV2Adapter.elementsLibrary`'s
 * read (`{ available, value }`). An unavailable library gives none, and the
 * preview leaves that ornament out.
 */
export function decorArt(read) {
  const v = read && read.available === true && read.value && typeof read.value === 'object' ? read.value : null;
  if (!v) return null;
  const out = {};
  const add = (kind, list) => { for (const x of Array.isArray(list) ? list : []) if (typeof x?.ref === 'string' && typeof x?.svg === 'string' && x.svg.startsWith('<svg')) out[`${kind}:${x.ref}`] = x.svg; };
  add('shape', v.shapes);
  add('texture', v.textures);
  add('icon', v.icons?.items);
  return out;
}

/**
 * A library drawing in the item's tone, as an image source. The library draws
 * each item in `var(--deck-ink)`; the item's tone takes its place, and the
 * other theme variables take the face's colours.
 */
export function decorArtSrc(svg, tone, face) {
  if (typeof svg !== 'string' || !svg.startsWith('<svg')) return null;
  const f = face || previewFace(null);
  const map = { ink: toneColour(tone, f), accent: f.accent, muted: f.muted, surface: f.bg };
  const filled = svg.replace(/var\(--deck-(ink|accent|muted|surface)\)/g, (_, t) => map[t]);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(filled)}`;
}

// ── The phone (canvas PTP20 to PTP25) ───────────────────────────────────────

export const PHONE_HINT = 'Turn the phone for a larger slide · pinch to zoom';

/** The card the phone sheet shows: the first with a chart (Kitchen Table's traction), else the first. */
export function sheetCard(cards) {
  const list = Array.isArray(cards) ? cards : [];
  const i = list.findIndex((s) => (Array.isArray(s?.blocks) ? s.blocks : []).some((b) => b?.kind === 'chart'));
  return i >= 0 ? i : 0;
}

/** "3 of 13 · Traction": the full-size title on a phone. */
export function phoneHeading(blank, index, count) {
  return `${index + 1} of ${count} · ${str(blank?.title) || `Card ${index + 1}`}`;
}
