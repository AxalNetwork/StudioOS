/**
 * D898 §8 (#3658) — the deck design system: what a theme's tokens are, how
 * much each layout's blocks may hold, and which layout a card's evidence
 * earns. Pure: no env, no D1, no model.
 *
 * THE CONTRACT IS MAIN'S v1. Layout ids are `slideModel.ts` LAYOUT_IDS (PD8's
 * twelve), block kinds are BLOCK_KINDS, theme kinds are THEME_KINDS (`brand`,
 * `neutral_light`, `neutral_dark`). Nothing here renames one; this file gives
 * each id its tokens and budgets (S33's ruling on #3658, 2026-10-29). #3659
 * (story and composition) and #3660 (visuals) read `chooseLayout`,
 * `LAYOUT_BUDGETS` and `fitProblems` from here.
 *
 * THE SLIDE IS 1920 × 1080 (16:9). Every size below is a pixel at that size;
 * a renderer scales the whole slide, never one block, so the budgets hold at
 * any display size. The 12 × 6 grid sits inside the safe margins.
 *
 * BUDGETS COME FROM GEOMETRY, not from taste: a text block's capacity is the
 * lines its range holds at its style's size and leading, times the characters
 * a line holds at that size (an average glyph is 0.52 em wide in the families
 * below). A block is over budget when its text needs more. So a layout's
 * budget moves with its range, and a renderer that keeps these sizes cannot
 * overflow a block that passes `fitProblems`.
 *
 * BRAND OVERRIDES ARE CHECKED. A brand kit's colours replace the brand
 * theme's, each only where it keeps text legible (4.5:1 for body text, 3:1
 * for the accent on large type, WCAG AA). A colour that does not is left out
 * and named in `adjustments`, so the founder is told, not surprised.
 */
import { BLOCK_KINDS, GRID_COLS, GRID_ROWS, LAYOUTS, LAYOUT_IDS, THEME_KINDS, type Grid } from './slideModel';

export const DESIGN_SYSTEM_VERSION = 1;

// ───────────────────────────────────────────────────────────── geometry

export const SLIDE = Object.freeze({ width: 1920, height: 1080 });
/** Safe margins and the gutter between grid cells. */
export const FRAME = Object.freeze({ marginX: 112, marginTop: 96, marginBottom: 88, gutter: 24 });

const innerW = SLIDE.width - FRAME.marginX * 2;
const innerH = SLIDE.height - FRAME.marginTop - FRAME.marginBottom;
export const CELL = Object.freeze({
  width: (innerW - FRAME.gutter * (GRID_COLS - 1)) / GRID_COLS,
  height: (innerH - FRAME.gutter * (GRID_ROWS - 1)) / GRID_ROWS,
});

/** A grid range's box in slide pixels. */
export function boxOf(g: Grid): { x: number; y: number; w: number; h: number } {
  const x = FRAME.marginX + (g.c1 - 1) * (CELL.width + FRAME.gutter);
  const y = FRAME.marginTop + (g.r1 - 1) * (CELL.height + FRAME.gutter);
  const w = (g.c2 - g.c1 + 1) * CELL.width + (g.c2 - g.c1) * FRAME.gutter;
  const h = (g.r2 - g.r1 + 1) * CELL.height + (g.r2 - g.r1) * FRAME.gutter;
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

// ───────────────────────────────────────────────────────────── type

export type TypeRole = 'display' | 'heading' | 'subheading' | 'paragraph' | 'list' | 'metric' | 'metric_label' | 'caption' | 'kicker';
/**
 * Size, leading and weight in slide pixels. 22px is the floor: nothing on a
 * slide is set smaller. D1517 (#3769) tunes it: every line sits on the 8 px
 * baseline (`lineHeight`), and the scale gains the cover's kicker, the short
 * capitalised line above a title.
 */
export const TYPE_SCALE: Record<TypeRole, { size: number; leading: number; weight: number; tracking: number }> = {
  display: { size: 104, leading: 1.04, weight: 700, tracking: -0.025 },
  heading: { size: 64, leading: 1.1, weight: 700, tracking: -0.02 },
  subheading: { size: 40, leading: 1.2, weight: 600, tracking: -0.01 },
  paragraph: { size: 32, leading: 1.4, weight: 400, tracking: 0 },
  list: { size: 30, leading: 1.45, weight: 400, tracking: 0 },
  metric: { size: 72, leading: 1.0, weight: 700, tracking: -0.02 },
  metric_label: { size: 24, leading: 1.3, weight: 600, tracking: 0.02 },
  caption: { size: 22, leading: 1.35, weight: 500, tracking: 0.01 },
  kicker: { size: 24, leading: 1.3, weight: 600, tracking: 0.08 },
};
export const MIN_TYPE_SIZE = 22;
/** The baseline every line sits on, in slide pixels (The Grid's, `structures.ts` BASELINE). */
export const BASELINE = 8;
/** The average glyph width, in em, of the theme families (measured for Space Grotesk and Inter). */
export const GLYPH_EM = 0.52;

/** A line's height at a size and leading, rounded up to the baseline so every line sits on it. */
export const lineHeight = (size: number, leading: number) => Math.ceil((size * leading) / BASELINE) * BASELINE;

/**
 * D1517: the sizes step-down fit may take for each role, largest first, all
 * within the scale and never under MIN_TYPE_SIZE. A text that does not fit at
 * its own size shrinks one step at a time before anything leaves its area.
 */
export const TYPE_STEPS: Record<TypeRole, readonly number[]> = {
  display: [104, 88, 76],
  heading: [64, 56, 48],
  subheading: [40, 36, 32],
  paragraph: [32, 28, 26],
  list: [30, 28, 26],
  metric: [72, 64, 56],
  metric_label: [24, 22],
  caption: [22],
  kicker: [24, 22],
};

/** A text block's style as the type scale names it; the title layout's heading is display size. */
export function typeRoleOf(style: unknown, layout: string | null = null): TypeRole {
  if (style === 'heading') return layout === 'title' || layout === 'statement' || layout === 'quote' ? 'display' : 'heading';
  if (style === 'list') return 'list';
  return 'paragraph';
}

/**
 * The most a block of each role should say, whatever its space: a slide is
 * read in seconds, so a paragraph is two or three sentences and a heading one
 * line of thought. Geometry can only lower these.
 */
export const DENSITY_MAX: Record<TypeRole, number> = {
  display: 90, heading: 70, subheading: 90, paragraph: 280, list: 320, metric: 10, metric_label: 40, caption: 140, kicker: 40,
};

/** How many characters a range holds at a type role, and its lines: the budget a text must fit. */
export function textCapacity(g: Grid, role: TypeRole): { chars: number; lines: number; perLine: number } {
  return capacityAt(g, role, TYPE_SCALE[role].size);
}

/** A range's capacity at one size of a role: lines on the baseline, characters per line at that size. */
export function capacityAt(g: Grid, role: TypeRole, size: number): { chars: number; lines: number; perLine: number } {
  const { w, h } = boxOf(g);
  const lines = Math.max(1, Math.floor(h / lineHeight(size, TYPE_SCALE[role].leading)));
  const perLine = Math.max(1, Math.floor(w / (size * GLYPH_EM)));
  return { chars: Math.min(lines * perLine, DENSITY_MAX[role]), lines, perLine };
}

// ───────────────────────────────────────────────────────────── wrap and fit

const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean);

/** Greedy word wrap at `perLine` characters; a word longer than a line takes a line of its own. */
export function wrapGreedy(text: string, perLine: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const w of wordsOf(text)) {
    if (!line) line = w;
    else if (line.length + 1 + w.length <= perLine) line += ` ${w}`;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * The balanced wrap: the same number of lines as the greedy wrap, at the
 * narrowest measure that keeps it, so the lines are even rather than one long
 * line over a short one. A heading never ends on one word when the line above
 * can give it a second.
 */
export function wrapBalanced(text: string, perLine: number, title = false): string[] {
  const greedy = wrapGreedy(text, perLine);
  if (greedy.length < 2) return greedy;
  const longest = Math.max(...wordsOf(text).map((w) => w.length));
  let lo = Math.max(1, longest), hi = perLine;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (wrapGreedy(text, mid).length <= greedy.length) hi = mid; else lo = mid + 1;
  }
  const lines = wrapGreedy(text, lo);
  if (title) {
    const last = lines.length - 1;
    const above = wordsOf(lines[last - 1] ?? '');
    if (last > 0 && wordsOf(lines[last]).length === 1 && above.length >= 3) {
      const moved = above.pop()!;
      const next = `${moved} ${lines[last]}`;
      if (next.length <= perLine) { lines[last - 1] = above.join(' '); lines[last] = next; }
    }
  }
  return lines;
}

/** Whether a title's wrap leaves a line of one word that the line above could have shared. */
export function singleWordLine(lines: string[]): boolean {
  if (lines.length < 2) return false;
  return lines.some((l, i) => wordsOf(l).length === 1 && wordsOf(lines[i === 0 ? 1 : i - 1]).length >= 3);
}

const TITLE_ROLES: readonly TypeRole[] = ['display', 'heading', 'subheading'];

export type TextFit = { fits: boolean; size: number; step: number; lines: string[]; over: number };

/**
 * D1517 step-down fit: the text at its role's size, then one step smaller at
 * a time (`TYPE_STEPS`), each wrapped balanced, until it sits in its range.
 * `fits` is false only when even the smallest step overflows; `over` is then
 * the characters past that step's capacity. Density (`DENSITY_MAX`) holds at
 * every size: a slide is read in seconds, whatever its type.
 */
export function fitText(g: Grid, role: TypeRole, text: unknown): TextFit {
  const t = String(text ?? '').trim();
  const steps = TYPE_STEPS[role];
  const title = TITLE_ROLES.includes(role);
  let last: TextFit = { fits: false, size: steps[0], step: 0, lines: [], over: 0 };
  for (let i = 0; i < steps.length; i += 1) {
    const cap = capacityAt(g, role, steps[i]);
    const lines = wrapBalanced(t, cap.perLine, title);
    const tooLong = lines.some((l) => l.length > cap.perLine);
    const fits = t.length <= DENSITY_MAX[role] && lines.length <= cap.lines && !tooLong;
    last = { fits, size: steps[i], step: i, lines, over: fits ? 0 : Math.max(1, t.length - cap.chars) };
    if (fits) return last;
  }
  return last;
}

// ───────────────────────────────────────────────────────────── colour

const HEX = /^#[0-9a-f]{6}$/i;
const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const luminance = (hex: string) => { const [r, g, b] = channels(hex); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };

/** WCAG contrast of two colours, rounded down to two places. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.floor(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}
export const BODY_CONTRAST = 4.5;
export const LARGE_CONTRAST = 3;

export type ThemeKind = typeof THEME_KINDS[number];
export type Colours = {
  ground: string; surface: string; ink: string; muted: string; hairline: string;
  accent: string; accent_ink: string; positive: string; negative: string;
};
export type ThemeTokens = {
  kind: ThemeKind;
  version: number;
  colours: Colours;
  /** Six chart series colours, in order, each readable on `ground` as a large mark (3:1). */
  chart: string[];
  fonts: { display: string; body: string; mono: string };
  /** How images sit: corner radius in slide pixels, and the default background overlay. */
  image: { radius: number; overlay: 'none' | 'light' | 'strong' };
  /** Card and tile corners, in slide pixels. */
  radius: number;
};

const FONTS = { display: 'Space Grotesk', body: 'Inter', mono: 'Roboto Mono' } as const;

/**
 * The six treatments. Brand starts from Axal's own colours until a kit
 * overrides them. D1517 (#3769, pd7): Sand, Ocean and Forest from the final
 * canvas, Sand's and Forest's muted text darkened from the canvas's until it
 * reads 4.5:1 on the ground. Ocean is dark, as Neutral dark is.
 */
export const BASE_THEMES: Record<ThemeKind, ThemeTokens> = {
  neutral_light: {
    kind: 'neutral_light', version: DESIGN_SYSTEM_VERSION,
    colours: { ground: '#fbfaf7', surface: '#ffffff', ink: '#18181b', muted: '#5b5666', hairline: '#e4e1ea', accent: '#6d28d9', accent_ink: '#ffffff', positive: '#047857', negative: '#b91c1c' },
    chart: ['#6d28d9', '#0f766e', '#b45309', '#1d4ed8', '#be185d', '#4d7c0f'],
    fonts: { ...FONTS }, image: { radius: 20, overlay: 'light' }, radius: 20,
  },
  neutral_dark: {
    kind: 'neutral_dark', version: DESIGN_SYSTEM_VERSION,
    colours: { ground: '#0b1220', surface: '#111a2e', ink: '#f3f4f6', muted: '#a3abbd', hairline: '#273349', accent: '#a78bfa', accent_ink: '#0b1220', positive: '#34d399', negative: '#f87171' },
    chart: ['#a78bfa', '#2dd4bf', '#fbbf24', '#60a5fa', '#f472b6', '#a3e635'],
    fonts: { ...FONTS }, image: { radius: 20, overlay: 'strong' }, radius: 20,
  },
  brand: {
    kind: 'brand', version: DESIGN_SYSTEM_VERSION,
    colours: { ground: '#f4f0fe', surface: '#ffffff', ink: '#1e1b2e', muted: '#5b5470', hairline: '#ddd0fb', accent: '#7c3aed', accent_ink: '#ffffff', positive: '#047857', negative: '#b91c1c' },
    chart: ['#7c3aed', '#0f766e', '#c2410c', '#1d4ed8', '#be185d', '#4d7c0f'],
    fonts: { ...FONTS }, image: { radius: 28, overlay: 'light' }, radius: 28,
  },
  sand: {
    kind: 'sand', version: DESIGN_SYSTEM_VERSION,
    colours: { ground: '#f6efe6', surface: '#fffbf5', ink: '#2b2118', muted: '#6b5b4b', hairline: '#e6d8c3', accent: '#a16207', accent_ink: '#ffffff', positive: '#047857', negative: '#b91c1c' },
    chart: ['#a16207', '#0f766e', '#9a3412', '#1d4ed8', '#86198f', '#3f6212'],
    fonts: { ...FONTS }, image: { radius: 20, overlay: 'light' }, radius: 20,
  },
  ocean: {
    kind: 'ocean', version: DESIGN_SYSTEM_VERSION,
    colours: { ground: '#0f2740', surface: '#173554', ink: '#eaf2fb', muted: '#9fb3c8', hairline: '#24476b', accent: '#5eead4', accent_ink: '#0f2740', positive: '#34d399', negative: '#fca5a5' },
    chart: ['#5eead4', '#93c5fd', '#fcd34d', '#f9a8d4', '#bef264', '#c4b5fd'],
    fonts: { ...FONTS }, image: { radius: 20, overlay: 'strong' }, radius: 20,
  },
  forest: {
    kind: 'forest', version: DESIGN_SYSTEM_VERSION,
    colours: { ground: '#f3f6f1', surface: '#ffffff', ink: '#1f2a1c', muted: '#55604f', hairline: '#d5e0cc', accent: '#3f6212', accent_ink: '#ffffff', positive: '#047857', negative: '#b91c1c' },
    chart: ['#3f6212', '#0f766e', '#b45309', '#1d4ed8', '#be185d', '#6d28d9'],
    fonts: { ...FONTS }, image: { radius: 20, overlay: 'light' }, radius: 20,
  },
};

/** The themes drawn light on dark: their art and overlays are the dark ones. */
export const DARK_THEMES: readonly ThemeKind[] = Object.freeze(['neutral_dark', 'ocean']);
export const isDarkTheme = (kind: unknown) => (DARK_THEMES as readonly unknown[]).includes(kind);

/** A venture's brand kit, as `landing_pages` holds it (`branding.ts` BrandKitRow's palette). */
export type BrandKit = { palette_bg?: string | null; palette_ink?: string | null; palette_accent?: string | null; theme_color?: string | null; palette_secondary?: string | null };

/**
 * A theme's tokens. For `brand`, the kit's colours replace the base where they
 * stay legible; each one left out is named. The neutral themes ignore the kit.
 */
export function themeTokens(kind: unknown, kit: BrandKit | null = null): { tokens: ThemeTokens; adjustments: string[] } {
  const k: ThemeKind = (THEME_KINDS as readonly string[]).includes(kind as string) ? kind as ThemeKind : 'brand';
  const base = BASE_THEMES[k];
  const tokens: ThemeTokens = { ...base, colours: { ...base.colours }, chart: [...base.chart], fonts: { ...base.fonts }, image: { ...base.image } };
  const adjustments: string[] = [];
  if (k !== 'brand' || !kit) return { tokens, adjustments };
  const hex = (v: unknown) => (typeof v === 'string' && HEX.test(v.trim()) ? v.trim().toLowerCase() : null);
  const ground = hex(kit.palette_bg);
  const ink = hex(kit.palette_ink);
  if (ground && ink) {
    if (contrast(ink, ground) >= BODY_CONTRAST) { tokens.colours.ground = ground; tokens.colours.ink = ink; }
    else adjustments.push(`The brand's ink on its background reads ${contrast(ink, ground)}:1, under ${BODY_CONTRAST}:1, so the deck keeps its own.`);
  } else if (ground) {
    if (contrast(tokens.colours.ink, ground) >= BODY_CONTRAST) tokens.colours.ground = ground;
    else adjustments.push('The brand background would make the text unreadable, so the deck keeps its own.');
  } else if (ink) {
    if (contrast(ink, tokens.colours.ground) >= BODY_CONTRAST) tokens.colours.ink = ink;
    else adjustments.push('The brand ink is too light for the background, so the deck keeps its own.');
  }
  const accent = hex(kit.palette_accent) || hex(kit.theme_color);
  if (accent) {
    if (contrast(accent, tokens.colours.ground) >= LARGE_CONTRAST) {
      tokens.colours.accent = accent;
      tokens.colours.accent_ink = contrast('#ffffff', accent) >= BODY_CONTRAST ? '#ffffff' : tokens.colours.ink;
      tokens.chart[0] = accent;
    } else adjustments.push(`The brand accent reads ${contrast(accent, tokens.colours.ground)}:1 on the background, under ${LARGE_CONTRAST}:1, so headings keep the deck's accent.`);
  }
  const second = hex(kit.palette_secondary);
  if (second && contrast(second, tokens.colours.ground) >= LARGE_CONTRAST) tokens.chart[1] = second;
  // Every chart colour stays a readable mark on the ground; one that is not takes the ink.
  tokens.chart = tokens.chart.map((c) => (contrast(c, tokens.colours.ground) >= LARGE_CONTRAST ? c : tokens.colours.ink));
  return { tokens, adjustments };
}

/** Problems with a theme's tokens, or []: every pair a slide draws is legible. */
export function themeProblems(t: ThemeTokens): string[] {
  const out: string[] = [];
  const c = t.colours;
  if (contrast(c.ink, c.ground) < BODY_CONTRAST) out.push(`${t.kind}: ink on ground is under ${BODY_CONTRAST}:1.`);
  if (contrast(c.ink, c.surface) < BODY_CONTRAST) out.push(`${t.kind}: ink on surface is under ${BODY_CONTRAST}:1.`);
  if (contrast(c.muted, c.ground) < BODY_CONTRAST) out.push(`${t.kind}: muted text on ground is under ${BODY_CONTRAST}:1.`);
  if (contrast(c.accent, c.ground) < LARGE_CONTRAST) out.push(`${t.kind}: the accent on ground is under ${LARGE_CONTRAST}:1.`);
  if (contrast(c.accent_ink, c.accent) < BODY_CONTRAST) out.push(`${t.kind}: text on the accent is under ${BODY_CONTRAST}:1.`);
  t.chart.forEach((x, i) => { if (contrast(x, c.ground) < LARGE_CONTRAST) out.push(`${t.kind}: chart colour ${i + 1} is under ${LARGE_CONTRAST}:1.`); });
  if (new Set(t.chart).size !== t.chart.length) out.push(`${t.kind}: two chart colours are the same.`);
  return out;
}

// ───────────────────────────────────────────────────────────── layout budgets

export type LayoutId = typeof LAYOUTS[number]['id'];
export type SlotBudget =
  | { index: number; kind: 'text'; role: TypeRole; chars: number; lines: number }
  | { index: number; kind: 'metric'; label_chars: number; value_chars: number }
  | { index: number; kind: 'chart'; max_series: number; max_points: number }
  | { index: number; kind: 'image'; min_px: { w: number; h: number } }
  | { index: number; kind: 'graphic'; max_items: number };

/** What a layout's evidence must include before it is chosen, and the layout to fall back to without it. */
/**
 * `steps` counts what a diagram can draw in order: dated roadmap objectives
 * for a timeline, recorded allocation lines for use of funds.
 */
export type LayoutNeed = { metrics?: number; series?: number; people?: number; steps?: number; rows?: number; images?: number };

const METRIC_VALUE_CHARS = 14;
/** The fewest grid rows a metric tile may span. */
export const METRIC_MIN_ROWS = 2;
/** Chart limits: beyond six series or twenty-four points a 16:9 chart stops being readable. */
const CHART_MAX_SERIES = 6;
const CHART_MAX_POINTS = 24;

function slotsOf(layout: (typeof LAYOUTS)[number]): SlotBudget[] {
  return layout.blocks.map((b: any, index: number) => {
    const g = b.grid as Grid;
    if (b.kind === 'text') {
      const role = typeRoleOf(b.style, layout.id);
      const cap = textCapacity(g, role);
      return { index, kind: 'text', role, chars: cap.chars, lines: cap.lines };
    }
    if (b.kind === 'metric') {
      const { w } = boxOf(g);
      return { index, kind: 'metric', label_chars: Math.min(DENSITY_MAX.metric_label, Math.floor(w / (TYPE_SCALE.metric_label.size * GLYPH_EM)) * 2), value_chars: Math.min(METRIC_VALUE_CHARS, Math.floor(w / (TYPE_SCALE.metric.size * GLYPH_EM))) };
    }
    if (b.kind === 'chart') return { index, kind: 'chart', max_series: b.chart_type === 'timeline' ? 1 : CHART_MAX_SERIES, max_points: CHART_MAX_POINTS };
    if (b.kind === 'image') { const { w, h } = boxOf(g); return { index, kind: 'image', min_px: { w, h } }; }
    return { index, kind: 'graphic', max_items: 6 };
  });
}

/** What each layout needs from a card's evidence, and where it falls back to. Title, statement and quote need words only. */
export const LAYOUT_NEEDS: Record<LayoutId, { needs: LayoutNeed; fallback: LayoutId | null }> = {
  title: { needs: {}, fallback: null },
  statement: { needs: {}, fallback: null },
  quote: { needs: {}, fallback: 'statement' },
  two_columns: { needs: {}, fallback: 'statement' },
  metric_tiles: { needs: { metrics: 2 }, fallback: 'statement' },
  chart_text: { needs: { series: 1 }, fallback: 'metric_tiles' },
  timeline: { needs: { steps: 3 }, fallback: 'two_columns' },
  // Photos only a person agreed to share (D903): without them the team reads as two columns of words.
  team_grid: { needs: { people: 2, images: 2 }, fallback: 'two_columns' },
  comparison_table: { needs: { rows: 2 }, fallback: 'two_columns' },
  image_text: { needs: { images: 1 }, fallback: 'two_columns' },
  full_bleed_image: { needs: { images: 1 }, fallback: 'statement' },
  appendix_table: { needs: {}, fallback: null },
};

/** Every layout's budgets, from its grid (computed once). */
export const LAYOUT_BUDGETS: Record<string, { id: string; label: string; slots: SlotBudget[]; needs: LayoutNeed; fallback: string | null }> =
  Object.fromEntries(LAYOUTS.map((l) => [l.id, { id: l.id, label: l.label, slots: slotsOf(l), ...LAYOUT_NEEDS[l.id as LayoutId] }]));

/** Evidence a card has, counted by code from its records; never from a model. */
export type Evidence = { metrics: number; series: number; people: number; steps: number; rows: number; images: number };
export const NO_EVIDENCE: Evidence = Object.freeze({ metrics: 0, series: 0, people: 0, steps: 0, rows: 0, images: 0 });

/** Whether `evidence` meets a layout's needs. */
export function meets(layout: string, evidence: Partial<Evidence>): boolean {
  const need = LAYOUT_BUDGETS[layout]?.needs;
  if (!need) return false;
  return (Object.keys(need) as Array<keyof LayoutNeed>).every((k) => (evidence[k] ?? 0) >= (need[k] ?? 0));
}

// ───────────────────────────────────────────────────────────── roles

/**
 * The cards a pitch deck is made of, and the layouts each prefers, best first.
 * The first layout whose needs the card's evidence meets is chosen; each list
 * ends in one that needs only words. #3658's thirteen named roles, plus the
 * catalogue's own cards (`newDeck.ts` CARD_CATALOGUE).
 */
export const ROLE_LAYOUTS: Record<string, LayoutId[]> = {
  title: ['title'],
  // A problem is a sentence a customer would say, with its evidence under it, not a row of tiles.
  problem: ['quote', 'statement'],
  why_now: ['statement'],
  solution: ['image_text', 'two_columns', 'statement'],
  product: ['image_text', 'metric_tiles', 'two_columns'],
  traction: ['chart_text', 'metric_tiles', 'statement'],
  validation: ['chart_text', 'metric_tiles', 'statement'],
  market: ['comparison_table', 'statement'],
  competition: ['comparison_table', 'two_columns', 'statement'],
  business_model: ['two_columns', 'metric_tiles', 'statement'],
  unit_economics: ['metric_tiles', 'chart_text', 'statement'],
  team: ['team_grid', 'metric_tiles', 'two_columns'],
  timeline: ['timeline', 'two_columns'],
  roadmap: ['timeline', 'metric_tiles', 'two_columns'],
  round: ['metric_tiles', 'statement'],
  use_of_funds: ['timeline', 'two_columns', 'statement'],
  cap_table: ['metric_tiles', 'statement'],
  every_figure: ['appendix_table'],
};

/**
 * The layout a card's evidence earns, and why. `quote` is chosen only when a
 * recorded customer quote is part of the evidence (`quotes`), never from a model.
 */
export function chooseLayout(role: string, evidence: Partial<Evidence> & { quotes?: number }): { layout: string; reason: string } {
  const prefs = ROLE_LAYOUTS[role] ?? ['two_columns', 'statement'];
  for (const id of prefs) {
    if (id === 'quote' && !(evidence.quotes && evidence.quotes > 0)) continue;
    if (meets(id, evidence)) return { layout: id, reason: id === prefs[0] ? 'first choice' : `${prefs[0]} needs more records` };
  }
  return { layout: 'statement', reason: 'nothing recorded for this card yet' };
}

// ───────────────────────────────────────────────────────────── fit

export type FitProblem = { card: number; block: string; kind: 'overflow' | 'single_word_line' | 'too_many_series' | 'too_many_points' | 'too_many_items' | 'value_too_long' | 'too_small'; over: number; message: string };

/**
 * What would overflow or turn illegible at 16:9, per block, or []. Text is
 * measured against its own range at its own style (so it holds for edited
 * ranges too); a chart against the readable limits; a metric's value against
 * its tile.
 */
export function fitProblems(slides: unknown): FitProblem[] {
  const out: FitProblem[] = [];
  (Array.isArray(slides) ? slides : []).forEach((s: any, i: number) => {
    const card = i + 1;
    for (const b of Array.isArray(s?.blocks) ? s.blocks : []) {
      const g = b?.grid as Grid;
      if (!g || !(BLOCK_KINDS as readonly string[]).includes(b?.kind)) continue;
      const id = String(b.id ?? '?');
      if (b.kind === 'text') {
        // D1517: the text steps down within the scale before it counts as overflowing.
        const role = typeRoleOf(b.style, s.layout ?? null);
        const fit = fitText(g, role, b.text);
        const smallest = TYPE_STEPS[role][TYPE_STEPS[role].length - 1];
        if (!fit.fits) out.push({ card, block: id, kind: 'overflow', over: fit.over, message: `Card ${card}: the text is ${fit.over} characters longer than its space holds, even at ${smallest}px.` });
        else if (TITLE_ROLES.includes(role) && singleWordLine(fit.lines)) out.push({ card, block: id, kind: 'single_word_line', over: 1, message: `Card ${card}: the title leaves one word on a line of its own.` });
      } else if (b.kind === 'metric') {
        const { w } = boxOf(g);
        const max = Math.min(METRIC_VALUE_CHARS, Math.floor(w / (TYPE_SCALE.metric.size * GLYPH_EM)));
        const len = String(b.value ?? '').length;
        if (len > max) out.push({ card, block: id, kind: 'value_too_long', over: len - max, message: `Card ${card}: the figure is too long for its tile; widen the tile.` });
        // A tile draws its label, its figure and its source line: two rows is the least that holds them.
        if (g.r2 - g.r1 + 1 < METRIC_MIN_ROWS) out.push({ card, block: id, kind: 'too_small', over: METRIC_MIN_ROWS - (g.r2 - g.r1 + 1), message: `Card ${card}: a figure tile needs at least ${METRIC_MIN_ROWS} rows for its label, figure and source.` });
      } else if (b.kind === 'chart') {
        const series = Array.isArray(b.series) ? b.series : [];
        if (series.length > CHART_MAX_SERIES) out.push({ card, block: id, kind: 'too_many_series', over: series.length - CHART_MAX_SERIES, message: `Card ${card}: a chart reads at most ${CHART_MAX_SERIES} series.` });
        const pts = Math.max(0, ...series.map((x: any) => (Array.isArray(x?.points) ? x.points.length : 0)));
        if (pts > CHART_MAX_POINTS) out.push({ card, block: id, kind: 'too_many_points', over: pts - CHART_MAX_POINTS, message: `Card ${card}: a chart reads at most ${CHART_MAX_POINTS} points; pick a shorter range.` });
      } else if (b.kind === 'graphic' && b.diagram) {
        const n = Array.isArray(b.diagram.items) ? b.diagram.items.length : 0;
        const max = Math.max(2, Math.floor((g.c2 - g.c1 + 1) / 2));
        if (n > max) out.push({ card, block: id, kind: 'too_many_items', over: n - max, message: `Card ${card}: the diagram holds at most ${max} steps at this width.` });
      }
    }
  });
  return out;
}

/** The layout ids this module knows, so a test can hold it to slideModel's list. */
export const KNOWN_LAYOUTS = Object.keys(LAYOUT_BUDGETS);
export const isLayoutId = (v: unknown): v is string => typeof v === 'string' && LAYOUT_IDS.includes(v);
