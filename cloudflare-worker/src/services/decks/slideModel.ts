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
 *               blocks on a card share a cell.
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
 * A binding is D896's: `{ source_key, record_ref, as_of, grade, snapshot_hash }`
 * (`services/decks/sources.ts`). A metric tile with no value is `value: null`,
 * which every reader shows as "Not recorded", never 0.
 */
import { sanitizeBinding } from './sources';

export const GRID_COLS = 12;
export const GRID_ROWS = 6;
export const MAX_BLOCKS = 24;
export const NOTES_MAX = 4000;

export type Grid = { c1: number; c2: number; r1: number; r2: number };

export const BLOCK_KINDS = ['text', 'chart', 'graphic', 'image', 'video', 'audio', 'link', 'metric'] as const;
export type BlockKind = typeof BLOCK_KINDS[number];

/** The chart library (PD9b), in the canvas's order. */
export const CHART_TYPES = ['line', 'columns', 'stacked', 'percent_bar', 'ranked_bars', 'funnel', 'cohort_heatmap', 'timeline', 'metric_tiles', 'comparison_table', 'waterfall', 'nested_bars'] as const;
export const CHART_RANGES = ['3m', '6m', '12m', 'all'] as const;
export const TEXT_STYLES = ['heading', 'paragraph', 'list'] as const;
export const IMAGE_TAGS = ['illustration', 'photo', 'screenshot', 'logo'] as const;
export const VIDEO_RATIOS = ['16:9', '9:16'] as const;
export const THEME_KINDS = ['brand', 'neutral_light', 'neutral_dark'] as const;

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

function backgroundOf(v: any, url: UrlGuard): { color: string | null; image_url: string | null } | null {
  if (!v || typeof v !== 'object') return null;
  const color = typeof v.color === 'string' && COLOUR.test(v.color) ? v.color.toLowerCase() : null;
  const image_url = typeof v.image_url === 'string' ? url(v.image_url) : null;
  return color || image_url ? { color, image_url } : null;
}

function pointsOf(v: unknown): Array<{ x: string; y: number }> | null {
  if (!Array.isArray(v)) return null;
  const out = v.slice(0, 60).filter((p: any) => p && typeof p.x === 'string' && typeof p.y === 'number' && Number.isFinite(p.y))
    .map((p: any) => ({ x: p.x.slice(0, 20), y: p.y }));
  return out.length ? out : null;
}

/** One block's own fields, by kind; null when the kind is unknown. */
function blockBody(kind: BlockKind, v: any, url: UrlGuard): Record<string, unknown> | null {
  switch (kind) {
    case 'text': return { style: oneOf(v.style, TEXT_STYLES) ?? 'paragraph', text: str(v.text, 4000) };
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
    case 'graphic': return { graphic: str(v.graphic, 60), ratio: v.ratio === '2x2' ? '2x2' : '1x1' };
    case 'image': return { image_url: typeof v.image_url === 'string' ? url(v.image_url) : null, alt: str(v.alt, 200), tag: oneOf(v.tag, IMAGE_TAGS) };
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
export function sanitizeBlocks(input: unknown, url: UrlGuard): any[] {
  const out: any[] = [];
  for (const [i, v] of (Array.isArray(input) ? input : []).slice(0, MAX_BLOCKS).entries()) {
    const kind = oneOf(v?.kind, BLOCK_KINDS);
    const grid = gridOf(v?.grid);
    if (!kind || !grid || out.some((o) => overlaps(o.grid, grid))) continue;
    const body = blockBody(kind, v, url);
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
  if (Array.isArray(s?.blocks)) out.blocks = sanitizeBlocks(s.blocks, url);
  const bd = bindingOf(s?.binding);
  if (bd) out.binding = bd;
  return out;
}

/** The deck's theme (PD8), or null for the default (the brand kit, no deck background). */
export function sanitizeTheme(v: any, url: UrlGuard): { kind: string; background: { color: string | null; image_url: string | null } | null } | null {
  if (!v || typeof v !== 'object') return null;
  const kind = oneOf(v.kind, THEME_KINDS);
  if (!kind) return null;
  return { kind, background: backgroundOf(v.background, url) };
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
      if (!blockBody(kind, v, url)) out.push(kind === 'video' ? `${where}: the video must be a YouTube or Vimeo link.` : `${where}: the link must be https on a public host.`);
      if (v?.binding != null && !bindingOf(v.binding)) out.push(`${where}: the binding is not a source.`);
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

