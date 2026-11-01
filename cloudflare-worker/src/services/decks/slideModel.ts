/**
 * D898 (#2676) — the slide model the Pitch deck editor writes.
 *
 * A slide keeps its fielded shape (title, fields, …) and gains:
 *
 *   layout      one of the twelve layouts (PD8); a preset of the grid.
 *   notes       the speaker notes, at most 4,000 characters.
 *   background  this card's background: a colour or an image (PD8).
 *   blocks      what sits on the card's 12 × 6 grid (PD8b). Each block is
 *               `{ id, kind, grid: { c1, c2, r1, r2 }, binding?, … }`: the
 *               range is inclusive, columns 1–12 and rows 1–6, and no two
 *               blocks on a card share a cell. A `graphic` block may carry
 *               a typed `diagram` (D898 §8.4, `diagramModel.ts`).
 *
 * A deck version also carries a theme (PD8): the venture's brand kit or one of
 * two neutral themes, with a deck background.
 *
 * Two entry points, on purpose:
 *   - `sanitizeModel` copies what is valid and drops what is not. Every stored
 *     read and every generator goes through it, so an old deck, or a version
 *     saved before this model, still opens.
 *   - `modelProblems` names what is wrong with a save, so the editor's own
 *     write is refused with a sentence rather than silently trimmed.
 *
 * D1500 (#3750) — model version 2 adds, on every card:
 *   uid         the card's own id, kept across saves and reorders, so a result
 *               made for a card lands on that card (`assignCardUids`).
 *   hidden, section, decor   a card left out of Present, its section name, and
 *               at most 16 decor items.
 * on a text block, `paras`: rich-text runs (bold, italic, underline, an
 * accent colour that passes contrast, an https link), with `text` kept as the
 * plain copy; and on the theme: `chrome` (page number, footer text, logo
 * corner, confidential), `voice`, `art_direction`, `lang` and `dir`.
 * A card is at most 256 KB and 12 areas.
 *
 * A binding is D896's: `{ source_key, record_ref, as_of, grade, snapshot_hash }`
 * (`services/decks/sources.ts`). A metric tile with no value is `value: null`,
 * which every reader shows as "Not recorded", never 0.
 */
import { sanitizeBinding } from './sources';
import { diagramProblem, sanitizeDiagram } from './diagramModel';
import { CUSTOM, STRUCTURE_IDS, areasProblem, sanitizeAreas } from './structures';

export const GRID_COLS = 12;
export const GRID_ROWS = 6;
export const MAX_BLOCKS = 24;
export const NOTES_MAX = 4000;
/** D1500: the document model this Worker reads and writes. A save in any other shape is refused, never stripped. */
export const MODEL_VERSION = 2;
export const MAX_DECOR = 16;
export const CARD_BYTES_MAX = 256 * 1024;
export const MAX_ACCENT_RUNS = 3;
export const MAX_PARAS = 40;
export const MAX_RUNS = 40;
export const SECTION_MAX = 60;
export const FOOTER_MAX = 120;
/** WCAG AA for body text: an accent run must read against the card. */
export const ACCENT_CONTRAST = 4.5;

export type Grid = { c1: number; c2: number; r1: number; r2: number };

export const BLOCK_KINDS = ['text', 'chart', 'graphic', 'image', 'video', 'audio', 'link', 'metric'] as const;
export type BlockKind = typeof BLOCK_KINDS[number];

/** The chart library (PD9b), in the canvas's order. */
export const CHART_TYPES = ['line', 'columns', 'stacked', 'percent_bar', 'ranked_bars', 'funnel', 'cohort_heatmap', 'timeline', 'metric_tiles', 'comparison_table', 'waterfall', 'nested_bars'] as const;
export const CHART_RANGES = ['3m', '6m', '12m', 'all'] as const;
export const TEXT_STYLES = ['heading', 'paragraph', 'list'] as const;
export const IMAGE_TAGS = ['illustration', 'photo', 'screenshot', 'logo'] as const;
/** D903 (#2682): how an image fills its range, and a background's overlay in the brand ink (PD12b–PD12d). */
export const IMAGE_FITS = ['cover', 'contain'] as const;
export const OVERLAYS = ['none', 'light', 'strong'] as const;
export const VIDEO_RATIOS = ['16:9', '9:16'] as const;
/** D1517 (#3769): Sand, Ocean and Forest join the three of D898 (pd7). */
export const THEME_KINDS = ['brand', 'neutral_light', 'neutral_dark', 'sand', 'ocean', 'forest'] as const;

/** The audiences a version is written for (PD3). */
export const AUDIENCES = ['angel', 'pre_seed_fund', 'seed_fund', 'series_a_fund', 'strategic', 'grant', 'other'] as const;

const b = (kind: BlockKind, c1: number, c2: number, r1: number, r2: number, extra: Record<string, unknown> = {}) => ({ kind, grid: { c1, c2, r1, r2 }, ...extra });

/** The twelve layouts (PD8): each is a preset of the grid, in the canvas's order. */
export const LAYOUTS = [
  { id: 'title', label: 'Title', blocks: [b('text', 1, 12, 2, 3, { style: 'heading' }), b('text', 1, 12, 4, 4, { style: 'paragraph' })] },
  { id: 'statement', label: 'Statement', blocks: [b('text', 2, 11, 2, 5, { style: 'heading' })] },
  { id: 'two_columns', label: 'Two columns', blocks: [b('text', 1, 12, 1, 1, { style: 'heading' }), b('text', 1, 6, 2, 6, { style: 'paragraph' }), b('text', 7, 12, 2, 6, { style: 'paragraph' })] },
  { id: 'metric_tiles', label: 'Metric tiles', blocks: [b('text', 1, 12, 1, 1, { style: 'heading' }), b('metric', 1, 3, 2, 4), b('metric', 4, 6, 2, 4), b('metric', 7, 9, 2, 4), b('metric', 10, 12, 2, 4), b('text', 1, 12, 5, 6, { style: 'paragraph' })] },
  { id: 'chart_text', label: 'Chart + text', blocks: [b('text', 1, 12, 1, 1, { style: 'heading' }), b('chart', 1, 8, 2, 6, { chart_type: 'line' }), b('text', 9, 12, 2, 6, { style: 'list' })] },
  { id: 'timeline', label: 'Timeline', blocks: [b('text', 1, 12, 1, 1, { style: 'heading' }), b('chart', 1, 12, 2, 5, { chart_type: 'timeline' }), b('text', 1, 12, 6, 6, { style: 'paragraph' })] },
  { id: 'team_grid', label: 'Team grid', blocks: [b('text', 1, 12, 1, 1, { style: 'heading' }), b('image', 1, 3, 2, 4), b('image', 4, 6, 2, 4), b('image', 7, 9, 2, 4), b('image', 10, 12, 2, 4), b('text', 1, 3, 5, 6), b('text', 4, 6, 5, 6), b('text', 7, 9, 5, 6), b('text', 10, 12, 5, 6)] },
  { id: 'quote', label: 'Quote', blocks: [b('text', 2, 11, 2, 4, { style: 'heading' }), b('text', 2, 11, 5, 5, { style: 'paragraph' })] },
  { id: 'comparison_table', label: 'Comparison table', blocks: [b('text', 1, 12, 1, 1, { style: 'heading' }), b('chart', 1, 12, 2, 6, { chart_type: 'comparison_table' })] },
  { id: 'image_text', label: 'Image + text', blocks: [b('image', 1, 6, 1, 6), b('text', 7, 12, 1, 1, { style: 'heading' }), b('text', 7, 12, 2, 6, { style: 'paragraph' })] },
  { id: 'full_bleed_image', label: 'Full-bleed image', blocks: [b('image', 1, 12, 1, 6)] },
  { id: 'appendix_table', label: 'Appendix table', blocks: [b('text', 1, 12, 1, 1, { style: 'heading' }), b('text', 1, 12, 2, 6, { style: 'list' })] },
] as const;
export const LAYOUT_IDS = LAYOUTS.map((l) => l.id) as string[];

const COLOUR = /^#[0-9a-f]{6}$/i;
const ID = /^[A-Za-z0-9_-]{1,40}$/;

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | null => (typeof v === 'string' && (list as readonly string[]).includes(v) ? v as T : null);

/** An https URL on a public host; the same rule as slide images (sanitizeImageUrl), passed in to avoid a cycle. */
export type UrlGuard = (u: string | null | undefined) => string | null;

/** D896's binding, or null when it is not one: `sources.ts`'s one rule, so a save and a refresh agree. */
export const bindingOf = sanitizeBinding;

export function gridOf(v: any): Grid | null {
  if (!v || typeof v !== 'object') return null;
  const n = (x: unknown) => (Number.isInteger(x) ? x as number : NaN);
  const g = { c1: n(v.c1), c2: n(v.c2), r1: n(v.r1), r2: n(v.r2) };
  if (!(g.c1 >= 1 && g.c1 <= g.c2 && g.c2 <= GRID_COLS && g.r1 >= 1 && g.r1 <= g.r2 && g.r2 <= GRID_ROWS)) return null;
  return g;
}

const overlaps = (a: Grid, z: Grid) => a.c1 <= z.c2 && z.c1 <= a.c2 && a.r1 <= z.r2 && z.r1 <= a.r2;

/** A YouTube or Vimeo link, read without a fetch; null for anything else. */
export function videoOf(raw: unknown): { provider: 'youtube' | 'vimeo'; video_id: string; url: string } | null {
  if (typeof raw !== 'string' || raw.length > 500) return null;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, '');
  let id: string | null = null;
  if (host === 'youtube.com') {
    id = u.pathname === '/watch' ? u.searchParams.get('v') : (/^\/(?:shorts|embed)\/([^/]+)/.exec(u.pathname)?.[1] ?? null);
  } else if (host === 'youtu.be') {
    id = u.pathname.slice(1).split('/')[0] || null;
  } else if (host === 'vimeo.com') {
    id = /^\/(\d{6,12})(?:\/|$)/.exec(u.pathname)?.[1] ?? null;
    return id ? { provider: 'vimeo', video_id: id, url: `https://vimeo.com/${id}` } : null;
  }
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  return { provider: 'youtube', video_id: id, url: `https://www.youtube.com/watch?v=${id}` };
}

const IMAGE_ID = /^[0-9a-f-]{36}$/;
type Background = { color: string | null; image_url: string | null; image_id?: string; overlay?: string };

/** A colour or an image; an image from D903 keeps its id and its overlay (none, light or strong). */
function backgroundOf(v: any, url: UrlGuard): Background | null {
  if (!v || typeof v !== 'object') return null;
  const color = typeof v.color === 'string' && COLOUR.test(v.color) ? v.color.toLowerCase() : null;
  const image_url = typeof v.image_url === 'string' ? url(v.image_url) : null;
  if (!color && !image_url) return null;
  const out: Background = { color, image_url };
  if (image_url && typeof v.image_id === 'string' && IMAGE_ID.test(v.image_id)) out.image_id = v.image_id;
  const overlay = image_url ? oneOf(v.overlay, OVERLAYS) : null;
  if (overlay) out.overlay = overlay;
  return out;
}

/** D903: the point an image keeps in view when it is cropped to its range, in percent of each side. */
function cropOf(v: any): { x: number; y: number } | null {
  if (!v || typeof v !== 'object') return null;
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(Math.min(100, Math.max(0, x))) : null);
  const x = n(v.x), y = n(v.y);
  return x === null || y === null ? null : { x, y };
}

function pointsOf(v: unknown): Array<{ x: string; y: number }> | null {
  if (!Array.isArray(v)) return null;
  const out = v.slice(0, 60).filter((p: any) => p && typeof p.x === 'string' && typeof p.y === 'number' && Number.isFinite(p.y))
    .map((p: any) => ({ x: p.x.slice(0, 20), y: p.y }));
  return out.length ? out : null;
}

/** Relative luminance of a #rrggbb colour (WCAG 2). */
function luminance(hex: string): number {
  const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

/** The contrast ratio of two #rrggbb colours, 1 to 21. */
export function contrastRatio(a: string, z: string): number {
  const [hi, lo] = [luminance(a), luminance(z)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** What a card's text sits on: its own background colour, else white. */
export const groundOf = (card: any): string => (typeof card?.background?.color === 'string' && COLOUR.test(card.background.color) ? card.background.color.toLowerCase() : '#ffffff');

type Run = { text: string; b?: true; i?: true; u?: true; accent?: string; href?: string };

/**
 * D1500: a text block's rich text, sanitized. Each paragraph is `{ runs }`;
 * a run keeps bold, italic, underline, an accent colour and an https link. A
 * link that is not https on a public host is dropped (the words stay); an
 * accent that fails contrast on the card, or past the third, is dropped.
 * Returns the paragraphs and their plain copy, or null when there are none.
 */
export function parasOf(v: unknown, url: UrlGuard, ground = '#ffffff'): { paras: Array<{ runs: Run[] }>; text: string } | null {
  if (!Array.isArray(v)) return null;
  let accents = 0;
  const paras = v.slice(0, MAX_PARAS).map((p: any) => {
    const runs: Run[] = [];
    for (const r of (Array.isArray(p?.runs) ? p.runs : []).slice(0, MAX_RUNS)) {
      if (typeof r?.text !== 'string' || !r.text) continue;
      const run: Run = { text: r.text.slice(0, 4000) };
      if (r.b === true) run.b = true;
      if (r.i === true) run.i = true;
      if (r.u === true) run.u = true;
      if (typeof r.accent === 'string' && COLOUR.test(r.accent) && accents < MAX_ACCENT_RUNS && contrastRatio(r.accent, ground) >= ACCENT_CONTRAST) {
        run.accent = r.accent.toLowerCase();
        accents += 1;
      }
      const href = typeof r.href === 'string' ? url(r.href) : null;
      if (href) run.href = href;
      runs.push(run);
    }
    return { runs };
  });
  if (!paras.some((p) => p.runs.length)) return null;
  const text = paras.map((p) => p.runs.map((r) => r.text).join('')).join('\n').slice(0, 4000);
  return { paras, text };
}

/** What is wrong with a block's rich text, as a sentence, or null. Links that are not https are dropped, not refused. */
function parasProblem(v: unknown, ground: string): string | null {
  if (v == null) return null;
  if (!Array.isArray(v)) return 'the rich text must be a list of paragraphs.';
  if (v.length > MAX_PARAS) return `the text holds at most ${MAX_PARAS} paragraphs.`;
  let accents = 0;
  for (const p of v as any[]) {
    for (const r of Array.isArray(p?.runs) ? p.runs : []) {
      if (r?.accent == null) continue;
      if (typeof r.accent !== 'string' || !COLOUR.test(r.accent)) return 'an accent must be a colour like #1a2b3c.';
      if (contrastRatio(r.accent, ground) < ACCENT_CONTRAST) return `the accent ${r.accent} does not read against the card (contrast under ${ACCENT_CONTRAST}:1).`;
      accents += 1;
    }
  }
  return accents > MAX_ACCENT_RUNS ? `the text holds at most ${MAX_ACCENT_RUNS} accent runs.` : null;
}

/** D1500: a card's decor (at most 16 items), each `{ id, kind, grid? }`; what the items draw is the elements library's (#3779). */
function decorOf(v: unknown): Array<{ id: string; kind: string; grid?: Grid }> | null {
  if (!Array.isArray(v)) return null;
  const out = v.slice(0, MAX_DECOR).flatMap((d: any, i: number) => {
    const kind = str(d?.kind, 40);
    if (!kind) return [];
    const item: { id: string; kind: string; grid?: Grid } = { id: typeof d.id === 'string' && ID.test(d.id) ? d.id : `d${i + 1}`, kind };
    const grid = gridOf(d.grid);
    if (grid) item.grid = grid;
    return [item];
  });
  return out.length ? out : null;
}

// D1500: the card uid helpers live in `cardUids.ts`, a module with no imports, so a store that names a card does not pull in this model's readers.
export { assignCardUids, cardIndexOf, cardUidAt, cardRefOf } from './cardUids';

/** D1500: the bytes a card takes stored. */
export const cardBytes = (card: unknown): number => new TextEncoder().encode(JSON.stringify(card ?? null)).length;

/** One block's own fields, by kind; null when the kind is unknown. */
function blockBody(kind: BlockKind, v: any, url: UrlGuard, ground = '#ffffff'): Record<string, unknown> | null {
  switch (kind) {
    case 'text': {
      const style = oneOf(v.style, TEXT_STYLES) ?? 'paragraph';
      // D1500: rich text keeps its runs; `text` stays the plain copy every older reader shows.
      const rich = parasOf(v.paras, url, ground);
      return rich ? { style, text: rich.text, paras: rich.paras } : { style, text: str(v.text, 4000) };
    }
    case 'chart': {
      const series = (Array.isArray(v.series) ? v.series : []).slice(0, 6).map((s: any) => {
        const out: Record<string, unknown> = { label: str(s?.label, 80) };
        const bd = bindingOf(s?.binding);
        if (bd) out.binding = bd;
        // A series the founder typed (PD9's Typed series) carries its points; its grade is Stated.
        const pts = bd ? null : pointsOf(s?.points);
        if (pts) out.points = pts;
        return bd || pts ? out : null;
      }).filter(Boolean);
      return {
        chart_type: oneOf(v.chart_type, CHART_TYPES) ?? 'line', series,
        range: oneOf(v.range, CHART_RANGES) ?? 'all', previous: v.previous === true, labels: v.labels !== false,
      };
    }
    case 'graphic': {
      const out: Record<string, unknown> = { graphic: str(v.graphic, 60), ratio: v.ratio === '2x2' ? '2x2' : '1x1' };
      // D898 §8.4 (#3658): an editable typed diagram, optional and versioned (`diagramModel.ts`).
      const diagram = sanitizeDiagram(v.diagram);
      if (diagram) out.diagram = diagram;
      return out;
    }
    case 'image': {
      const image_url = typeof v.image_url === 'string' ? url(v.image_url) : null;
      const out: Record<string, unknown> = { image_url, alt: str(v.alt, 200), tag: oneOf(v.tag, IMAGE_TAGS) };
      // D903: an image from the deck's own store keeps its id, its fit and its crop.
      if (image_url && typeof v.image_id === 'string' && IMAGE_ID.test(v.image_id)) out.image_id = v.image_id;
      const fit = oneOf(v.fit, IMAGE_FITS);
      if (fit) out.fit = fit;
      const crop = cropOf(v.crop);
      if (crop) out.crop = crop;
      return out;
    }
    case 'video': {
      const vid = videoOf(v.url);
      return vid ? { ...vid, poster_url: typeof v.poster_url === 'string' ? url(v.poster_url) : null, ratio: oneOf(v.ratio, VIDEO_RATIOS) ?? '16:9', title: str(v.title, 200) } : null;
    }
    case 'audio':
    case 'link': {
      const u = typeof v.url === 'string' ? url(v.url) : null;
      return u ? { url: u, label: str(v.label, 120) } : null;
    }
    case 'metric': return { label: str(v.label, 60), value: typeof v.value === 'string' && v.value.trim() ? v.value.trim().slice(0, 80) : null };
  }
}

/** The blocks of one slide that are valid, in order; a block that overlaps an earlier one is dropped. */
export function sanitizeBlocks(input: unknown, url: UrlGuard, ground = '#ffffff'): any[] {
  const out: any[] = [];
  for (const [i, v] of (Array.isArray(input) ? input : []).slice(0, MAX_BLOCKS).entries()) {
    const kind = oneOf(v?.kind, BLOCK_KINDS);
    const grid = gridOf(v?.grid);
    if (!kind || !grid || out.some((o) => overlaps(o.grid, grid))) continue;
    const body = blockBody(kind, v, url, ground);
    if (!body) continue;
    const block: Record<string, unknown> = { id: typeof v.id === 'string' && ID.test(v.id) ? v.id : `b${i + 1}`, kind, grid, ...body };
    const bd = kind === 'chart' ? null : bindingOf(v.binding);
    if (bd) block.binding = bd;
    out.push(block);
  }
  return out;
}

/** The model's part of a slide: what `sanitizeSlides` adds to the fielded shape. */
export function sanitizeModel(s: any, url: UrlGuard): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const layout = oneOf(s?.layout, LAYOUT_IDS);
  if (layout) out.layout = layout;
  if (typeof s?.notes === 'string' && s.notes.trim()) out.notes = s.notes.slice(0, NOTES_MAX);
  const bg = backgroundOf(s?.background, url);
  if (bg) out.background = bg;
  if (Array.isArray(s?.blocks)) out.blocks = sanitizeBlocks(s.blocks, url, groundOf({ background: bg }));
  // D1500: the card's uid (assigned over the whole deck by `assignCardUids`), whether it is hidden, its section and decor.
  if (typeof s?.uid === 'string' && ID.test(s.uid)) out.uid = s.uid;
  if (s?.hidden === true) out.hidden = true;
  const section = str(s?.section, SECTION_MAX);
  if (section) out.section = section;
  const decor = decorOf(s?.decor);
  if (decor) out.decor = decor;
  const bd = bindingOf(s?.binding);
  if (bd) out.binding = bd;
  // D1499: a card's structure and areas, kept only when sound; a card without them derives its areas (`structures.areasOf`).
  if (typeof s?.structure === 'string' && (s.structure === CUSTOM || STRUCTURE_IDS.includes(s.structure))) out.structure = s.structure;
  const areas = s?.areas != null ? sanitizeAreas(s.areas) : null;
  if (areas) out.areas = areas;
  return out;
}

export const DIRS = ['ltr', 'rtl'] as const;
const LANG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

/** D1500: the chrome drawn on every card (pd3): page number, footer text, logo corner, confidential. Null when none is on. */
export function chromeOf(v: any): { page_number: boolean; footer_text: string | null; logo_corner: boolean; confidential: boolean } | null {
  if (!v || typeof v !== 'object') return null;
  const footer = str(v.footer_text, FOOTER_MAX) || null;
  const out = { page_number: v.page_number === true, footer_text: footer, logo_corner: v.logo_corner === true, confidential: v.confidential === true };
  return out.page_number || out.footer_text || out.logo_corner || out.confidential ? out : null;
}

/** The deck's theme (PD8), or null for the default (the brand kit, no deck background). */
export function sanitizeTheme(v: any, url: UrlGuard): Record<string, unknown> & { kind: string; background: Background | null; aspect?: '4:3'; compliance_fls?: false; confidential?: false } | null {
  if (!v || typeof v !== 'object') return null;
  const kind = oneOf(v.kind, THEME_KINDS);
  if (!kind) return null;
  // D1499: 4:3 is kept; 16:9 is the default and is left out, so a deck saved before v2 hashes as it did.
  const out: Record<string, unknown> & { kind: string; background: Background | null; aspect?: '4:3'; compliance_fls?: false; confidential?: false } = { kind, background: backgroundOf(v.background, url), ...(v.aspect === '4:3' ? { aspect: '4:3' as const } : {}) };
  // D1546: compliance is on by default; retain only flags explicitly turned off.
  if (v.compliance_fls === false) out.compliance_fls = false;
  if (v.confidential === false) out.confidential = false;
  // D1500: each kept only when set, so a theme saved before v2 hashes as it did.
  const chrome = chromeOf(v.chrome);
  if (chrome) out.chrome = chrome;
  const voice = str(v.voice, 200);
  if (voice) out.voice = voice;
  const art = str(v.art_direction, 500);
  if (art) out.art_direction = art;
  if (typeof v.lang === 'string' && LANG.test(v.lang)) out.lang = v.lang;
  const dir = oneOf(v.dir, DIRS);
  if (dir) out.dir = dir;
  return out;
}

/**
 * What is wrong with a save, as sentences, or [] when it is sound. The editor
 * sends only valid blocks, so a problem here is a bug or a hand-made request;
 * it is refused rather than trimmed, so nobody loses a block without being told.
 */
export function modelProblems(slides: unknown, url: UrlGuard): string[] {
  const out: string[] = [];
  (Array.isArray(slides) ? slides : []).forEach((s: any, i) => {
    const card = `Card ${i + 1}`;
    if (s?.layout != null && !oneOf(s.layout, LAYOUT_IDS)) out.push(`${card}: the layout is not one of the twelve.`);
    if (typeof s?.notes === 'string' && s.notes.length > NOTES_MAX) out.push(`${card}: the notes are longer than ${NOTES_MAX} characters.`);
    if (s?.structure != null && !(s.structure === CUSTOM || STRUCTURE_IDS.includes(s.structure))) out.push(`${card}: the structure is not one of the seventeen.`);
    const ap = s?.areas != null ? areasProblem(s.areas) : null;
    if (ap) out.push(`${card}: ${ap}`);
    // D1500: the caps a card is refused past, each with its sentence.
    if (s?.decor != null && (!Array.isArray(s.decor) || s.decor.length > MAX_DECOR)) out.push(`${card}: a card holds at most ${MAX_DECOR} decor items.`);
    if (cardBytes(s) > CARD_BYTES_MAX) out.push(`${card}: the card is larger than 256 KB. Remove an image or some text, then save.`);
    if (s?.section != null && (typeof s.section !== 'string' || s.section.length > SECTION_MAX)) out.push(`${card}: the section name is at most ${SECTION_MAX} characters.`);
    if (s?.blocks == null) return;
    if (!Array.isArray(s.blocks)) { out.push(`${card}: blocks must be a list.`); return; }
    if (s.blocks.length > MAX_BLOCKS) out.push(`${card}: a card holds at most ${MAX_BLOCKS} blocks.`);
    const placed: Grid[] = [];
    s.blocks.slice(0, MAX_BLOCKS).forEach((v: any, j: number) => {
      const where = `${card}, block ${j + 1}`;
      const kind = oneOf(v?.kind, BLOCK_KINDS);
      if (!kind) { out.push(`${where}: unknown kind.`); return; }
      const grid = gridOf(v?.grid);
      if (!grid) { out.push(`${where}: the range must sit on the ${GRID_COLS} × ${GRID_ROWS} grid.`); return; }
      if (placed.some((p) => overlaps(p, grid))) out.push(`${where}: it overlaps another block.`);
      placed.push(grid);
      if (!blockBody(kind, v, url, groundOf(s))) out.push(kind === 'video' ? `${where}: the video must be a YouTube or Vimeo link.` : `${where}: the link must be https on a public host.`);
      if (v?.binding != null && !bindingOf(v.binding)) out.push(`${where}: the binding is not a source.`);
      const dp = kind === 'graphic' ? diagramProblem(v?.diagram) : null;
      if (dp) out.push(`${where}: ${dp}`);
      const pp = kind === 'text' ? parasProblem(v?.paras, groundOf(s)) : null;
      if (pp) out.push(`${where}: ${pp}`);
    });
  });
  return out;
}

/** SHA-256 of a version's slides and theme, lowercase hex: two versions with the same hash read the same. */
export async function contentHash(slides: unknown, theme: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify({ slides, theme: theme ?? null }));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (x) => x.toString(16).padStart(2, '0')).join('');
}

