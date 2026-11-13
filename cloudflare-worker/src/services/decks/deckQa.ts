/**
 * D1559 (#3806, deck v2 C11) — likely investor questions for one deck, with
 * real objections ranked first and every answer a set of bindings to records.
 * Pure: `routes/deck_qa.ts` reads the objections, the critic's rule findings,
 * the deck's sources and the kept answers; this file ranks and binds.
 *
 * RANKING. The venture's own objections (`narrative/objections.ts`, what
 * investors said in Capital relationships) come first, most heard first, as
 * that read orders them. Then the investor critic's rule findings (D1557:
 * A23's missing cards and proof, a market with no source, every Not backed
 * figure), deal-breakers first, then by card. One question per card; no
 * model runs, so it answers with AI off and costs nothing.
 *
 * PER PROSPECT (D1582, #3829). Asked for one prospect (an investor in Capital
 * relationships, already checked to be the venture's), the objections THAT
 * prospect raised rank first, the ones it raised most first, then the
 * venture's other objections in the order above, then the findings. Each
 * objection says how many of its rows the prospect gave (`heard.from_prospect`).
 * With no prospect the order is D1559's, unchanged.
 *
 * ANSWERS ARE BINDINGS. A question draws on the deck cards it is about (an
 * objection by its words, `TOPICS`; a finding by its card), and its answer is
 * those cards' recorded deck sources (`CARD_CATALOGUE[].sources`), each with
 * D896's binding keys (source_key, record_ref, as_of, grade, snapshot_hash)
 * and the value the record holds. The answer's words are written only from
 * those bindings (`lineOf`). Nothing else may state a figure: the founder's
 * own recorded answer to an objection is shown only when every figure in it
 * is carried by one of the question's bindings, and a kept answer's note
 * likewise (`unboundFigures`).
 *
 * A figure is a run of digits, read as the critic reads one (D1557), with
 * separators and leading zeros set aside, so "$1,200.50" is carried by a
 * value of 120050 cents and "2026-10-01" by its own as_of.
 */
import { CARD_CATALOGUE } from './newDeck';
import { SEVERITIES, type Finding, type Severity } from './critic';
import type { Objection, Answered } from '../narrative/objections';
import type { SourceItem } from './sources';

export const QUESTIONS_MAX = 20;
export const KEPT_BINDINGS_MAX = 6;
export const NOTE_MAX = 600;

// ─────────────────────────────────────────────────────────── figures

const DIGITS = /\p{Nd}+(?:[.,]\p{Nd}+)*/gu;

/** Every figure in a text: its digits, separators and leading zeros set aside. */
export function figuresIn(text: unknown): string[] {
  return (String(text ?? '').match(DIGITS) ?? []).map((r) => r.replace(/[^\p{Nd}]/gu, '').replace(/^0+(?=\d)/u, ''));
}

/** What a binding carries: the bound value, its second value, its date and its slot's own label. */
export type QaBinding = {
  source_key: string; record_ref: string | null; as_of: string | null; grade: string; snapshot_hash: string | null;
  label: string; value: number | string; of: number | null; unit: string; source: string | null;
};

export function carriedBy(bindings: readonly QaBinding[]): Set<string> {
  const out = new Set<string>();
  for (const b of bindings) for (const t of [b.value, b.of, b.as_of, b.label]) for (const f of figuresIn(t)) out.add(f);
  return out;
}

/** The figures in a text that no binding carries; empty when every figure is bound. */
export function unboundFigures(text: unknown, bindings: readonly QaBinding[]): string[] {
  const held = carriedBy(bindings);
  return figuresIn(text).filter((f) => !held.has(f));
}

// ─────────────────────────────────────────────────────────── a binding's words

const grouped = (s: string) => {
  const [int, frac] = s.split('.');
  const g = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac === undefined ? g : `${g}.${frac}`;
};

/** A bound value as words. Formatting keeps every digit, so the figure stays the binding's. */
export function shown(b: Pick<QaBinding, 'value' | 'unit' | 'of'>): string {
  const v = b.value;
  const n = typeof v === 'number' && Number.isFinite(v) ? v : null;
  let s: string;
  if (n === null) s = String(v);
  else if (b.unit === 'cents' && Number.isInteger(n)) {
    const neg = n < 0;
    const abs = String(Math.abs(n)).padStart(3, '0');
    s = `${neg ? '-' : ''}$${grouped(abs.slice(0, -2))}.${abs.slice(-2)}`;
  } else if (b.unit === 'usd') s = `$${grouped(String(n))}`;
  else if (b.unit === 'percent') s = `${String(n)}%`;
  else if (b.unit === 'months') s = `${String(n)} months`;
  else s = grouped(String(n));
  return b.of != null ? `${s} of ${grouped(String(b.of))}` : s;
}

/** One binding as a line of the answer: the label, the value, and where it came from. */
export function lineOf(b: QaBinding): string {
  const from = [b.grade, b.source, b.as_of ? `as of ${b.as_of}` : null].filter(Boolean).join(', ');
  return `${b.label}: ${shown(b)}${from ? ` (${from})` : ''}`;
}

/** A recorded source item as a binding; null for a slot with no value this reader may see. */
export function bindingOf(it: SourceItem): QaBinding | null {
  if (it.state !== 'recorded' || it.value == null || it.grade === 'Not recorded') return null;
  return {
    source_key: it.source_key, record_ref: it.record_ref, as_of: it.as_of, grade: it.grade, snapshot_hash: it.snapshot_hash,
    label: it.label, value: it.value, of: it.of ?? null, unit: it.unit, source: it.source,
  };
}

// ─────────────────────────────────────────────────────────── what a question is about

/** An objection's words to the cards that answer it; first match first. */
export const TOPICS: ReadonlyArray<{ card: string; words: RegExp }> = [
  { card: 'traction', words: /\b(traction|revenue|mrr|arr|paying|customers?|sales|growth|growing|users?|adoption)\b/i },
  { card: 'unit_economics', words: /\b(burn|runway|churn|margins?|cac|ltv|payback|unit economics|profitab\w*)\b/i },
  { card: 'market', words: /\b(market|tam|sam|som|demand|size|niche)\b/i },
  { card: 'competition', words: /\b(compet\w*|incumbents?|moat|differentiat\w*|alternatives?)\b/i },
  { card: 'team', words: /\b(team|founders?|hires?|hiring|experience|cto|ceo)\b/i },
  { card: 'validation', words: /\b(validat\w*|interviews?|evidence|proof|pilots?|lois?|early|signal|waitlist)\b/i },
  { card: 'problem', words: /\b(problem|pain|need)\b/i },
  { card: 'product', words: /\b(product|ship\w*|built|build|tech\w*|mvp|features?)\b/i },
  { card: 'roadmap', words: /\b(roadmap|milestones?|timeline|plan)\b/i },
  { card: 'round', words: /\b(valuation|terms|round|raising|raise|safe|cap|dilution|amount)\b/i },
  { card: 'use_of_funds', words: /\b(use of funds|spend\w*|allocat\w*)\b/i },
  { card: 'cap_table', words: /\b(cap table|ownership|equity|vesting|shareholders?)\b/i },
];
export const TOPICS_PER_QUESTION = 2;

export function cardsOfObjection(text: string): string[] {
  return TOPICS.filter((t) => t.words.test(text)).slice(0, TOPICS_PER_QUESTION).map((t) => t.card);
}

/** The deck sources a card draws on (`CARD_CATALOGUE`). */
export function sourcesOfCards(cards: readonly string[]): string[] {
  const out: string[] = [];
  for (const card of cards) for (const k of CARD_CATALOGUE.find((c) => c.card === card)?.sources ?? []) if (!out.includes(k)) out.push(k);
  return out;
}

const titleOf = (card: string) => CARD_CATALOGUE.find((c) => c.card === card)?.title ?? card;

/** What an investor asks when a card is missing or unproven. */
export const CARD_QUESTION: Record<string, string> = {
  problem: 'How do you know this problem is real?',
  solution: 'What does the product do about the pain?',
  traction: 'What traction do you have so far?',
  validation: 'What evidence do you have that customers want this?',
  product: 'What have you shipped so far?',
  market: 'How big is the market, and where does that figure come from?',
  unit_economics: 'What are your burn, runway and churn?',
  team: 'Why is this the team to win this?',
  round: 'What are you raising, and on what terms?',
  use_of_funds: 'Where will the money go?',
  competition: 'Who else does this, and why do you win?',
  roadmap: 'What does this round get done?',
  cap_table: 'Who owns the company today?',
};

/** The card a rule finding is about: in its key for a stage rule, its place in the deck for a figure. */
export function cardOfFinding(f: Finding, deckCards: ReadonlyArray<{ kind: string | null }>): string | null {
  const m = /^rule:(missing_card|missing_proof):([a-z_]+)$/.exec(f.key);
  if (m) return m[2];
  if (f.code === 'market_unsourced') return 'market';
  return f.card_index != null ? deckCards[f.card_index]?.kind ?? null : null;
}

// ─────────────────────────────────────────────────────────── the answer

export type AnswerState = 'bound' | 'not_recorded' | 'unchecked' | 'no_topic';
export type Answer = {
  state: AnswerState;
  /** The answer's words, written from its bindings alone; null when nothing is bound. */
  text: string | null;
  bindings: QaBinding[];
  /** The slots that would answer it and hold nothing yet, with the module that fills each. */
  fill: Array<{ source_key: string; label: string; module: string; href: string }>;
};

export function answerOf(keys: readonly string[], items: readonly SourceItem[]): Answer {
  if (!keys.length) return { state: 'no_topic', text: null, bindings: [], fill: [] };
  const slots = keys.map((k) => items.find((i) => i.source_key === k)).filter((i): i is SourceItem => !!i);
  const bindings = slots.map(bindingOf).filter((b): b is QaBinding => !!b);
  const fill = slots.filter((i) => i.state === 'not_recorded').map((i) => ({ source_key: i.source_key, label: i.label, module: i.module, href: i.href }));
  if (bindings.length) return { state: 'bound', text: bindings.map(lineOf).join('; '), bindings, fill };
  // A slot the read did not return (its sources could not be read) is unchecked, never "not recorded".
  const unchecked = slots.length < keys.length || slots.some((i) => i.state === 'unreadable' || i.state === 'withheld');
  return { state: unchecked ? 'unchecked' : 'not_recorded', text: null, bindings: [], fill };
}

// ─────────────────────────────────────────────────────────── kept answers

export type KeptRow = {
  question_key: string; deck_id: number | null; version: number | null; bindings_json: string; note: string | null;
  kept_by: number | null; name: string | null; kept_at: string | null;
};
export type Kept = {
  text: string; note: string | null; deck_id: number | null; version: number | null;
  by: { id: number; name: string | null } | null; at: string | null;
  bindings: Array<QaBinding & { state: 'fresh' | 'stale' | 'gone' | 'unknown' }>;
};

/** A stored binding, kept only when it is whole: a bad row is dropped, never repaired. */
function storedBinding(x: any): QaBinding | null {
  if (!x || typeof x !== 'object' || typeof x.source_key !== 'string' || typeof x.label !== 'string') return null;
  if (!(typeof x.value === 'number' || typeof x.value === 'string')) return null;
  return {
    source_key: x.source_key, record_ref: typeof x.record_ref === 'string' ? x.record_ref : null, as_of: typeof x.as_of === 'string' ? x.as_of : null,
    grade: String(x.grade ?? ''), snapshot_hash: typeof x.snapshot_hash === 'string' ? x.snapshot_hash : null, label: x.label, value: x.value,
    of: typeof x.of === 'number' ? x.of : null, unit: String(x.unit ?? 'text'), source: typeof x.source === 'string' ? x.source : null,
  };
}

/** The words of a kept answer: its bindings, then the founder's note. */
export const keptText = (bindings: readonly QaBinding[], note: string | null) =>
  [bindings.map(lineOf).join('; '), note ?? ''].filter(Boolean).join(' — ');

/** A kept answer as read now: each binding fresh, stale (the record moved), gone or unknown, as D896 compares. */
export function keptOf(row: KeptRow, items: readonly SourceItem[]): Kept | null {
  let raw: unknown;
  try { raw = JSON.parse(row.bindings_json); } catch { return null; }
  const bindings = (Array.isArray(raw) ? raw : []).map(storedBinding).filter((b): b is QaBinding => !!b);
  if (!bindings.length) return null;
  // A note whose figure is no longer carried is not shown: the rule holds on read as on write.
  const note = row.note && !unboundFigures(row.note, bindings).length ? row.note : null;
  return {
    text: keptText(bindings, note), note, deck_id: row.deck_id, version: row.version,
    by: row.kept_by ? { id: Number(row.kept_by), name: row.name || null } : null, at: row.kept_at ? String(row.kept_at).slice(0, 10) : null,
    bindings: bindings.map((b) => {
      const cur = items.find((i) => i.source_key === b.source_key);
      const state = !cur || cur.state === 'not_recorded' ? 'gone' : cur.state !== 'recorded' ? 'unknown'
        : cur.snapshot_hash === b.snapshot_hash ? 'fresh' : 'stale';
      return { ...b, state };
    }),
  };
}

// ─────────────────────────────────────────────────────────── the questions

export type Question = {
  key: string;
  rank: number;
  kind: 'objection' | 'finding';
  question: string;
  /** The deck cards the answer draws on. */
  cards: string[];
  heard?: { count: number; prospects: number; last_heard: string | null; from_prospect?: number };
  /** D913: the saved narrative version and section marked as answering it. */
  answered_in?: Answered | null;
  /** The founder's own recorded answer in Capital relationships, when every figure in it is bound. */
  said?: string | null;
  said_held?: 'unbound_figure';
  severity?: Severity;
  code?: string;
  card_uid?: string | null;
  card_index?: number | null;
  answer: Answer;
  kept: Kept | null;
};

/** A question's key: `objection-<its key>`, or `finding-` and 16 hex of what the finding is about. */
export async function findingKey(about: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(about));
  return `finding-${[...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}
export const QUESTION_KEY = /^(objection|finding)-[0-9a-f]{16}$/;

export async function rankQuestions(input: {
  objections: readonly Objection[];
  findings: readonly Finding[];
  deckCards: ReadonlyArray<{ kind: string | null }>;
  items: readonly SourceItem[];
  kept: ReadonlyMap<string, KeptRow>;
}): Promise<{ questions: Question[]; more: number }> {
  const out: Question[] = [];
  const keptFor = (key: string) => { const r = input.kept.get(key); return r ? keptOf(r, input.items) : null; };

  // D1582: the asked-for prospect's own objections first (stable, so each half keeps D913's order).
  const mine = (o: Objection) => o.of_prospect ?? 0;
  const objections = input.objections.some((o) => o.of_prospect !== undefined)
    ? input.objections.map((o, i) => ({ o, i })).sort((a, b) => mine(b.o) - mine(a.o) || a.i - b.i).map((x) => x.o)
    : input.objections;
  for (const o of objections) {
    const cards = cardsOfObjection(o.text);
    const answer = answerOf(sourcesOfCards(cards), input.items);
    const said = o.answer && !unboundFigures(o.answer, answer.bindings).length ? o.answer : null;
    const key = `objection-${o.key}`;
    out.push({
      key, rank: 0, kind: 'objection', question: o.text, cards,
      heard: { count: o.count, prospects: o.prospects, last_heard: o.last_heard, ...(o.of_prospect !== undefined ? { from_prospect: o.of_prospect } : {}) },
      answered_in: o.answered ?? null,
      said, ...(o.answer && !said ? { said_held: 'unbound_figure' as const } : {}),
      answer, kept: keptFor(key),
    });
  }

  const findings = [...input.findings].sort((a, b) =>
    SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || (a.card_index ?? 99) - (b.card_index ?? 99));
  const seen = new Set<string>();
  for (const f of findings) {
    const card = cardOfFinding(f, input.deckCards);
    const notBacked = f.code === 'not_backed';
    const about = notBacked ? `not_backed:${card ?? `card${f.card_index ?? ''}`}:${f.message}` : `card:${card ?? f.key}`;
    if (seen.has(about)) continue;
    seen.add(about);
    const cards = card ? [card] : [];
    const label = notBacked ? f.message.replace(/ is not backed by a record$/, '') : '';
    const question = notBacked ? `Where does your ${label} figure come from?`
      : (card && CARD_QUESTION[card]) || `What is behind your ${card ? titleOf(card).toLowerCase() : 'deck'}?`;
    const key = await findingKey(about);
    out.push({
      key, rank: 0, kind: 'finding', question, cards, severity: f.severity, code: f.code, card_uid: f.card_uid, card_index: f.card_index,
      answer: answerOf(sourcesOfCards(cards), input.items), kept: keptFor(key),
    });
  }

  const questions = out.slice(0, QUESTIONS_MAX).map((q, i) => ({ ...q, rank: i + 1 }));
  return { questions, more: Math.max(0, out.length - QUESTIONS_MAX) };
}
