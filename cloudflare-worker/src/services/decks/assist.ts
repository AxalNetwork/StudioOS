/**
 * D899 (#2678, part 5 of #2434) — Eadwyn's card tools: what each press asks a
 * model, and what of its answer may reach a card. Pure: no binding, no fetch.
 *
 * WORDS ONLY. Every text tool (rewrite, shorten, expand, tone, translate, ask,
 * and the headline for a card made from a connector) returns wording. A
 * wording that names a number the founder's own text did not is not placed:
 * figures come from records, so `wordingProblem` refuses it. The chart, table
 * and timeline tools return only which recorded sources to show; code builds
 * the block, every series a binding through `sanitizeBinding`, so no tool can
 * write a number into a card.
 *
 * Each press is one rail option on "Founder · Raise · Pitch deck"
 * (`ASSIST_OPTIONS`): Ask and the connector headline are rewrites with an
 * instruction, so they run as `deck:rewrite`.
 */
import { sanitizeBinding, type SourceItem } from './sources';
import { numberIn } from './newDeck';

export const ASSIST_PAGE = 'Founder · Raise · Pitch deck';

export const TEXT_ACTIONS = ['rewrite', 'shorten', 'expand', 'tone', 'translate', 'ask', 'headline'] as const;
export const CHART_ACTIONS = ['chart', 'table', 'timeline'] as const;
export const ACTIONS = [...TEXT_ACTIONS, ...CHART_ACTIONS] as const;
export type Action = typeof ACTIONS[number];
export type TextAction = typeof TEXT_ACTIONS[number];
export type ChartAction = typeof CHART_ACTIONS[number];

/** Each press's rail option. */
export const ASSIST_OPTIONS: Record<Action, string> = {
  rewrite: 'deck:rewrite', ask: 'deck:rewrite', headline: 'deck:rewrite',
  shorten: 'deck:shorten', expand: 'deck:expand', tone: 'deck:tone', translate: 'deck:translate',
  chart: 'deck:chart', table: 'deck:table', timeline: 'deck:timeline',
};

/** The chart type each chart press makes, from the editor's library (`CHART_TYPES`). */
export const CHART_TYPE_OF: Record<ChartAction, 'columns' | 'comparison_table' | 'timeline'> = {
  chart: 'columns', table: 'comparison_table', timeline: 'timeline',
};

export const TONES = ['confident', 'plain', 'warm', 'formal'] as const;
export const LANGUAGES = ['French', 'German', 'Spanish', 'Portuguese', 'Italian', 'Dutch', 'Japanese', 'Chinese (Simplified)', 'Korean', 'Arabic', 'Hindi'] as const;

export const TEXT_MAX = 4000;
export const INSTRUCTION_MAX = 300;
export const HEADLINE_MAX = 120;
export const SERIES_MAX = 6;

export const AI_OFF_LINE = 'AI assistance is off on this page. Your records still fill the figures.';
export const FIGURE_LINE = (module: string | null) => `Figures come from your records. Update ${module || 'its module'} to change this one.`;

const SYSTEM = [
  'You edit the words on one card of a founder\'s pitch deck.',
  'Return only the new wording: no quotes, no preface, no explanation.',
  'Never add a number, an amount, a percentage, a date or a count. Keep every figure the text already has exactly as written, or leave it out.',
  'Keep the founder\'s meaning. Do not invent customers, partners or results.',
].join(' ');

const ASK: Record<Exclude<TextAction, 'headline'>, (o: { tone?: string; language?: string; instruction?: string }) => string> = {
  rewrite: () => 'Rewrite this text so it reads clearly to an investor.',
  shorten: () => 'Shorten this text to about half its length.',
  expand: () => 'Expand this text by a sentence or two, saying more about what it already says.',
  tone: (o) => `Rewrite this text in a ${o.tone} tone.`,
  translate: (o) => `Translate this text into ${o.language}.`,
  ask: (o) => `Change this text as the founder asks: ${o.instruction}`,
};

/** What a text press asks the model. */
export function textMessage(action: TextAction, text: string, o: { tone?: string; language?: string; instruction?: string; labels?: string[] } = {}): { system: string; user: string } {
  if (action === 'headline') {
    return {
      system: `${SYSTEM} Write one headline of at most ${HEADLINE_MAX} characters.`,
      user: `Write a headline for a card that shows these figures from the founder's records (their values are filled in by the records, not by you): ${(o.labels ?? []).join('; ')}.`,
    };
  }
  return { system: SYSTEM, user: `${ASK[action](o)}\n\nText:\n${text}` };
}

/** The wording from a model's answer: trimmed, its wrapping quotes taken off, cut to the field. */
export function wordingOf(output: unknown, max = TEXT_MAX): string {
  let s = typeof output === 'string' ? output.trim() : '';
  s = s.replace(/^(?:here is|here's)[^:\n]*:\s*/i, '');
  if (/^["“'].*["”']$/s.test(s)) s = s.slice(1, -1).trim();
  return s.slice(0, max);
}

const NUMBERISH = /\d+(?:[.,]\d+)*|[%$€£¥]/g;
const numbersOf = (t: string) => new Set((t.match(NUMBERISH) ?? []).map((x) => x.replace(/,/g, '')));

/**
 * Why a wording may not reach the card, or null when it may. Empty is no
 * wording. Every digit run and currency or percent sign in the answer must
 * already be in the founder's text; a headline may name none, and neither
 * may it use a number word.
 */
export function wordingProblem(action: TextAction, before: string, after: string): string | null {
  if (!after) return 'Eadwyn returned no wording, so nothing was placed.';
  if (action === 'headline') return numberIn(after) ? 'Eadwyn’s headline named a figure, so it was not placed. Figures come from your records.' : null;
  const had = numbersOf(before);
  for (const n of numbersOf(after)) if (!had.has(n)) return 'Eadwyn’s wording named a figure your text did not, so it was not placed. Figures come from your records.';
  return null;
}

/** The recorded sources a chart may show: values that code read, never typed. */
export const chartable = (items: SourceItem[]) => items.filter((i) => i.state === 'recorded' && i.value != null && i.unit !== 'text' && i.unit !== 'date');

/** What a chart press asks the model: which sources to show, by key and label only. No value is sent. */
export function chartMessage(action: ChartAction, items: SourceItem[], heading: string): { system: string; user: string } {
  const what = { chart: 'a column chart', table: 'a comparison table', timeline: 'a timeline' }[action];
  return {
    system: 'You choose which of a founder\'s recorded figures belong on one pitch-deck card. Reply with JSON only: {"title": string, "keys": string[]}. Choose at most six keys from the list. The title names what the card shows and contains no number.',
    user: `Make ${what}${heading ? ` for a card titled "${heading}"` : ''}. Recorded figures (key — label):\n${items.map((i) => `${i.source_key} — ${i.label}`).join('\n')}`,
  };
}

/**
 * The chart block a chart press proposes, from the model's choice: the keys it
 * named that are recorded, in its order, each a series bound to its source.
 * The title is dropped when it names a figure. Null when no key survives.
 */
export function chartBlock(action: ChartAction, choice: any, items: SourceItem[]): { block: Record<string, unknown>; title: string | null } | null {
  const byKey = new Map(chartable(items).map((i) => [i.source_key, i]));
  const keys: string[] = Array.isArray(choice?.keys) ? choice.keys.filter((k: unknown): k is string => typeof k === 'string') : [];
  const picked = [...new Set(keys)].map((k) => byKey.get(k)).filter((i): i is SourceItem => Boolean(i)).slice(0, SERIES_MAX);
  if (!picked.length) return null;
  const series = picked.map((i) => ({
    label: i.label,
    binding: sanitizeBinding({ source_key: i.source_key, record_ref: i.record_ref, as_of: i.as_of, grade: i.grade, snapshot_hash: i.snapshot_hash }),
  })).filter((s) => s.binding);
  if (!series.length) return null;
  const rawTitle = typeof choice?.title === 'string' ? choice.title.replace(/\s+/g, ' ').trim().slice(0, HEADLINE_MAX) : '';
  return {
    block: { kind: 'chart', chart_type: CHART_TYPE_OF[action], series, range: 'all', previous: false, labels: true },
    title: rawTitle && !numberIn(rawTitle) ? rawTitle : null,
  };
}
