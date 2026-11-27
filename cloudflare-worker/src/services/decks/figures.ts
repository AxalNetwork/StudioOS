/**
 * D1523 (#3775, deck v2 A24) — every figure on a deck version, with where it
 * comes from: the badges the editor draws (pd24) and the counts Check claims
 * shows (pd25).
 *
 *   linked        a figure bound to a record (`sources.ts` binding: source_key,
 *                 record_ref, as_of, grade): a metric tile, a chart series, a
 *                 table cell, or an older card's field
 *   not_recorded  bound, but the record holds nothing (the one-click build
 *                 binds a missing slot as grade "Not recorded"), or a metric
 *                 tile with no value: never a 0
 *   stated        a figure the founder typed: an unbound tile value, a typed
 *                 chart series, a table cell whose text names a number
 *   uncited       a number in free text (a text block, a heading): no record
 *                 and no tile backs it
 *
 * Pure: it reads the version's slides as saved and names each binding's slot
 * through `slotHome`. Badges are the editor's alone; nothing here reaches
 * Present, a share link or an export, which never call it.
 */
import { slotHome } from './newDeck';

export type FigureState = 'linked' | 'not_recorded' | 'stated' | 'uncited';
export const FIGURE_STATES: readonly FigureState[] = ['linked', 'stated', 'uncited', 'not_recorded'];

export type Figure = {
  card: number;                // 0-based place in the version
  block_id: string | null;     // the block, or the field key on an older card
  kind: 'metric' | 'chart' | 'table' | 'text' | 'field';
  label: string | null;
  at: string | null;           // a chart series' index or a table cell's "row:col"
  state: FigureState;
  value: string | null;        // the words on the card; null for a chart series or a missing figure
  source: { source_key: string; label: string | null; module: string | null; href: string | null; record_ref: string | null; as_of: string | null; grade: string | null } | null;
  figures?: string[];          // an uncited block: each number its text names
};

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * Every number a text names, in order: digits in any script (with a currency
 * sign, separators and a % or k/m/b suffix kept on), up to 20.
 */
export function numbersIn(text: unknown): string[] {
  if (typeof text !== 'string' || !text) return [];
  const out: string[] = [];
  for (const m of text.matchAll(/[$€£¥₹]?\s?\p{Nd}[\p{Nd},.]*(?:\s?%|\s?[kKmMbB](?![\p{L}]))?/gu)) {
    const t = m[0].trim().replace(/[.,]+$/, '');
    if (t) out.push(t);
    if (out.length >= 20) break;
  }
  return out;
}

function sourceOf(b: any, projectId: number): Figure['source'] {
  const home = slotHome(String(b.source_key), projectId);
  return {
    source_key: String(b.source_key),
    label: home?.label ?? null,
    module: home?.module ?? null,
    href: home?.href ?? null,
    record_ref: typeof b.record_ref === 'string' ? b.record_ref : null,
    as_of: typeof b.as_of === 'string' ? b.as_of : null,
    grade: typeof b.grade === 'string' ? b.grade : null,
  };
}

const bound = (b: any) => Boolean(b && typeof b === 'object' && typeof b.source_key === 'string' && b.source_key);
/** A binding that holds a value: graded, and not "Not recorded". */
const recorded = (b: any) => bound(b) && typeof b.grade === 'string' && b.grade !== 'Not recorded';

/** The figures of one block. */
function blockFigures(card: number, b: any, projectId: number): Figure[] {
  const id = typeof b?.id === 'string' ? b.id : null;
  const base = { card, block_id: id };
  switch (b?.kind) {
    case 'metric': {
      const value = str(b.value) || null;
      const label = str(b.label) || null;
      if (bound(b.binding)) {
        return [{ ...base, kind: 'metric', label, at: null, value: recorded(b.binding) && value ? value : null,
          state: recorded(b.binding) && value ? 'linked' : 'not_recorded', source: sourceOf(b.binding, projectId) }];
      }
      return [{ ...base, kind: 'metric', label, at: null, value, state: value ? 'stated' : 'not_recorded', source: null }];
    }
    case 'chart': {
      return (Array.isArray(b.series) ? b.series : []).map((s: any, i: number): Figure | null => {
        const label = str(s?.label) || null;
        if (bound(s?.binding)) {
          return { ...base, kind: 'chart', label, at: String(i), value: null, state: recorded(s.binding) ? 'linked' : 'not_recorded', source: sourceOf(s.binding, projectId) };
        }
        return Array.isArray(s?.points) && s.points.length ? { ...base, kind: 'chart', label, at: String(i), value: null, state: 'stated', source: null } : null;
      }).filter(Boolean) as Figure[];
    }
    case 'table': {
      const out: Figure[] = [];
      (Array.isArray(b.rows) ? b.rows : []).forEach((row: any, r: number) => (Array.isArray(row) ? row : []).forEach((cell: any, c: number) => {
        if (bound(cell?.binding)) {
          out.push({ ...base, kind: 'table', label: null, at: `${r}:${c}`, value: null, state: recorded(cell.binding) ? 'linked' : 'not_recorded', source: sourceOf(cell.binding, projectId) });
        } else if (numbersIn(cell?.text).length) {
          out.push({ ...base, kind: 'table', label: null, at: `${r}:${c}`, value: str(cell.text), state: 'stated', source: null });
        }
      }));
      return out;
    }
    case 'text': {
      const figures = numbersIn(b.text);
      return figures.length ? [{ ...base, kind: 'text', label: null, at: null, value: null, state: 'uncited', source: null, figures }] : [];
    }
    default:
      return [];
  }
}

/** An older card's fields (`fields: [{ key, kind, value, binding }]`): bound ones are linked, text naming a number is uncited. */
function fieldFigures(card: number, f: any, projectId: number): Figure[] {
  const key = typeof f?.key === 'string' ? f.key : null;
  const base = { card, block_id: key, kind: 'field' as const, label: str(f?.label) || null, at: null };
  if (bound(f?.binding)) {
    const value = typeof f.value === 'string' ? str(f.value) || null : null;
    return [{ ...base, value: recorded(f.binding) ? value : null, state: recorded(f.binding) ? 'linked' : 'not_recorded', source: sourceOf(f.binding, projectId) }];
  }
  const text = typeof f?.value === 'string' ? f.value : Array.isArray(f?.value) ? f.value.filter((x: unknown) => typeof x === 'string').join('\n') : '';
  const figures = numbersIn(text);
  return figures.length ? [{ ...base, value: null, state: 'uncited', source: null, figures }] : [];
}

/** Every figure on a version's slides, card by card, and the counts per state. */
export function figuresOf(slides: unknown, projectId: number): { figures: Figure[]; counts: Record<FigureState, number> } {
  const figures: Figure[] = [];
  (Array.isArray(slides) ? slides : []).forEach((s: any, i: number) => {
    for (const b of Array.isArray(s?.blocks) ? s.blocks : []) figures.push(...blockFigures(i, b, projectId));
    for (const f of Array.isArray(s?.fields) ? s.fields : []) figures.push(...fieldFigures(i, f, projectId));
  });
  const counts = { linked: 0, stated: 0, uncited: 0, not_recorded: 0 } as Record<FigureState, number>;
  for (const f of figures) counts[f.state] += 1;
  return { figures, counts };
}
