/**
 * D1565 (#3812) — tailored deck variants and the recipient watermark.
 *
 * A variant is a frozen deck version reordered and emphasised for one
 * investor. It never writes a card: its slides are the master's own slides in
 * another order, so a variant can never hold a figure the master lacks.
 * `checkVariantFigures` holds that, and the route refuses anything else.
 *
 *   tailorMatch  the venture's sector and stage against the investor's stated
 *                thesis: a match, a conflict (the sector is in their
 *                anti-thesis) or outside it. A conflict is a chip, never hidden.
 *   tailorPlan   the order and emphasis: the title first, then the cards that
 *                speak to their thesis, then the rest in the master's order.
 *
 * Pure: no binding, no model. The thesis is what the founder entered from what
 * the investor states; free text is never parsed into invented preferences.
 */

export type Thesis = { sectors: string[]; anti_sectors: string[]; stages: string[] };
export type Chip = { kind: 'sector' | 'stage'; state: 'match' | 'conflict' | 'outside' | 'not_recorded'; value: string | null; words: string };
export type Emphasis = Record<string, 'lead' | 'appendix'>;

const norm = (v: string) => v.trim().toLowerCase().replace(/[_\s]+/g, '-');
const list = (v: unknown, max = 20): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x: string) => x.trim().slice(0, 60)).slice(0, max) : []);

export function cleanThesis(raw: unknown): Thesis {
  const t = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return { sectors: list(t.sectors), anti_sectors: list(t.anti_sectors), stages: list(t.stages) };
}

/** The venture against the investor's thesis, as chips. An anti-thesis sector is a conflict chip. */
export function tailorMatch(venture: { sector: string | null; stage: string | null }, thesis: Thesis): Chip[] {
  const chips: Chip[] = [];
  const sector = venture.sector ? String(venture.sector) : null;
  if (!sector) chips.push({ kind: 'sector', state: 'not_recorded', value: null, words: 'Sector: Not recorded' });
  else if (thesis.anti_sectors.some((s) => norm(s) === norm(sector))) chips.push({ kind: 'sector', state: 'conflict', value: sector, words: `Their thesis excludes ${sector}` });
  else if (thesis.sectors.some((s) => norm(s) === norm(sector))) chips.push({ kind: 'sector', state: 'match', value: sector, words: `${sector} is in their thesis` });
  else chips.push({ kind: 'sector', state: 'outside', value: sector, words: thesis.sectors.length ? `${sector} is outside their stated sectors` : 'They state no sectors' });
  const stage = venture.stage ? String(venture.stage) : null;
  if (!stage) chips.push({ kind: 'stage', state: 'not_recorded', value: null, words: 'Stage: Not recorded' });
  else if (!thesis.stages.length) chips.push({ kind: 'stage', state: 'outside', value: stage, words: 'They state no stages' });
  else if (thesis.stages.some((s) => norm(s) === norm(stage))) chips.push({ kind: 'stage', state: 'match', value: stage, words: `${stage} is a stage they invest at` });
  else chips.push({ kind: 'stage', state: 'outside', value: stage, words: `${stage} is outside their stated stages` });
  return chips;
}

const slideText = (s: unknown) => JSON.stringify(s ?? '').toLowerCase();

/** The order and emphasis: the title first, then cards that speak to the thesis, then the rest. */
export function tailorPlan(master: unknown[], thesis: Thesis): { slide_order: number[]; emphasis: Emphasis } {
  const words = [...thesis.sectors, ...thesis.stages].map((w) => w.toLowerCase()).filter((w) => w.length > 2);
  const idx = master.map((_, i) => i);
  const speaks = (i: number) => i > 0 && words.some((w) => slideText(master[i]).includes(w));
  const lead = idx.filter(speaks);
  const order = [...(master.length ? [0] : []), ...lead, ...idx.filter((i) => i > 0 && !lead.includes(i))];
  return { slide_order: order, emphasis: Object.fromEntries(lead.map((i) => [String(i), 'lead' as const])) };
}

/**
 * A valid order of the master's slides: each index once, every slide kept.
 * An index the master lacks or a repeated one is refused (null); a slide the
 * order leaves out is appended in the master's order.
 */
export function cleanOrder(master: unknown[], raw: unknown): number[] | null {
  if (raw == null) return master.map((_, i) => i);
  if (!Array.isArray(raw)) return null;
  const seen = new Set<number>();
  for (const v of raw) {
    if (!Number.isSafeInteger(v) || v < 0 || v >= master.length || seen.has(v)) return null;
    seen.add(v);
  }
  return [...raw as number[], ...master.map((_, i) => i).filter((i) => !seen.has(i))];
}

export const variantSlides = <T>(master: T[], order: number[]): T[] => order.map((i) => master[i]).filter((s) => s !== undefined);

/** Every figure a set of cards states: numbers with their unit marks. */
export function figuresOf(slides: unknown[]): Set<string> {
  const out = new Set<string>();
  for (const m of JSON.stringify(slides ?? []).matchAll(/[$€£]?\d[\d,.]*\s?(?:%|[kmb]\b|x\b)?/gi)) out.add(m[0].replace(/\s+/g, '').toLowerCase());
  return out;
}

/** The figures `variant` states that `master` does not: always empty for a valid variant. */
export function checkVariantFigures(master: unknown[], variant: unknown[]): string[] {
  const have = figuresOf(master);
  return [...figuresOf(variant)].filter((f) => !have.has(f));
}

/** The recipient watermark: who the link was made for, and their fund. */
export function watermarkFor(investor: string | null, fund: string | null): string | null {
  const who = (investor || '').trim();
  const firm = (fund || '').trim();
  if (!who && !firm) return null;
  return `Prepared for ${[who, firm && firm !== who ? firm : ''].filter(Boolean).join(' · ')}`.slice(0, 160);
}
