/**
 * D1555 (#3802, deck v2 C7) — the deck's consistency rules, across its cards.
 *
 * WHAT IT CHECKS. The figures the deck itself states, card against card:
 *   one_value     one value per metric across the cards (ARR, the raise, burn …);
 *   use_of_funds  the use of funds adds up to the raise (and its shares to 100%);
 *   runway        runway equals cash ÷ monthly burn;
 *   round         the raise, the valuation and the dilution agree
 *                 (post-money = pre-money + raise; dilution = raise ÷ post-money);
 *   forecast      the forecast's year 1 equals the current ARR.
 *
 * WHERE A FIGURE COMES FROM. A metric block bound to a slot (`raise.pre_money`,
 * `grow.arr` …) is read as that slot. Any other text is read by fixed patterns
 * that need the figure's words beside the number (`parseStatedFigures`, plus
 * cash, pre- and post-money, valuation, dilution, year 1 and use of funds
 * here), so a bare number is never read as anything. Speaker notes are not
 * read. A line that speaks of the future ("projected", "by 2027", "target")
 * states no current figure, so a forecast never contradicts today's ARR.
 *
 * PURE. No database, no model, no charge: the check reply calls it, and the
 * automated run (AUTO-5) calls it in-run on the slides it is about to propose.
 * A rule with a figure missing says nothing; a metric already stated twice is
 * reported once, by `one_value`, and the other rules skip it.
 */
import { agrees, parseStatedFigures, FIGURE_LABEL, FIGURE_UNIT, type FigureKey } from './raiseCycle';
import { fundSlotKey } from './decks/recordSources';
import { FUND_SECTIONS } from '../util/useOfFunds';

export type Metric = FigureKey | 'cash' | 'pre_money' | 'post_money' | 'valuation' | 'dilution' | 'forecast_y1' | 'use_of_funds';
export type Fact = { metric: Metric; value: number; card: number };
export const CONSISTENCY_RULES = ['one_value', 'use_of_funds', 'runway', 'round', 'forecast'] as const;
export type Rule = (typeof CONSISTENCY_RULES)[number];
export type Finding = { key: string; rule: Rule; message: string; cards: number[] };
export type Consistency = { state: 'ok' | 'unreadable'; findings: Finding[] };

const LABEL: Record<Metric, string> = {
  ...FIGURE_LABEL, cash: 'Cash', pre_money: 'Pre-money valuation', post_money: 'Post-money valuation', valuation: 'Valuation',
  dilution: 'Dilution', forecast_y1: 'Forecast year 1', use_of_funds: 'Use of funds',
};
const UNIT: Record<Metric, 'money' | 'percent' | 'months' | 'count'> = {
  ...FIGURE_UNIT, cash: 'money', pre_money: 'money', post_money: 'money', valuation: 'money', dilution: 'percent', forecast_y1: 'money', use_of_funds: 'money',
};

/** The slots a bound metric block is read as. Cents slots are shown in dollars on the card, so the card's words are read. */
const SLOT: Record<string, Metric> = {
  'grow.mrr': 'mrr', 'grow.arr': 'arr', 'grow.churn': 'churn', 'grow.paying_customers': 'paying_customers', 'grow.net_burn': 'net_burn',
  'grow.runway': 'runway', 'grow.wau': 'active_users', 'validate.interviews': 'interviews', 'validate.lois': 'lois',
  'raise.round_target': 'raise', 'raise.pre_money': 'pre_money', 'raise.post_money': 'post_money', 'raise.dilution_pct': 'dilution',
  'raise.projection_revenue_12m': 'forecast_y1',
};
const FUND_SLOTS = new Set(FUND_SECTIONS.map((s) => fundSlotKey(s.key)));

const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6, b: 1e9, billion: 1e9 };
const MONEY = String.raw`\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k|mm|m|b|thousand|million|billion)?\b`;
const PCT = String.raw`(\d{1,3}(?:\.\d+)?)\s*%`;
const money = (d: string, s?: string) => { const n = Number(d.replace(/,/g, '')) * (s ? SCALE[s.toLowerCase()] ?? 1 : 1); return Number.isFinite(n) ? n : null; };
const FORWARD = /\b(?:project(?:ed|ion|ions)|forecast(?:ed)?|by\s+(?:20\d\d|year|the end)|target(?:ed|ing)?|goal|planned|will|expect(?:ed)?|plan to)\b/i;

/** The figures this module reads beside `parseStatedFigures`'s, each only with its words beside the number. */
const EXTRA: Array<[Metric, RegExp[], 'money' | 'percent']> = [
  ['cash', [new RegExp(`(?:cash(?:\\s+(?:balance|on hand|in the bank))?|in the bank)\\s*(?:of|is|at|:|=)?\\s*${MONEY}`, 'i'),
    new RegExp(`${MONEY}\\s*(?:in\\s+(?:the\\s+bank|cash)|of\\s+cash|cash(?:\\s+on\\s+hand)?)`, 'i')], 'money'],
  ['pre_money', [new RegExp(`pre[- ]money(?:\\s+valuation)?\\s*(?:of|is|at|:|=)?\\s*${MONEY}`, 'i'), new RegExp(`${MONEY}\\s*pre[- ]money`, 'i')], 'money'],
  ['post_money', [new RegExp(`post[- ]money(?:\\s+valuation)?\\s*(?:of|is|at|:|=)?\\s*${MONEY}`, 'i'), new RegExp(`${MONEY}\\s*post[- ]money`, 'i')], 'money'],
  ['dilution', [new RegExp(`${PCT}\\s*dilution`, 'i'), new RegExp(`dilution\\s*(?:of|is|at|:|=)?\\s*${PCT}`, 'i'), new RegExp(`(?:selling|offering)\\s+${PCT}`, 'i')], 'percent'],
  ['forecast_y1', [new RegExp(`(?:year\\s*1|Y1|first[- ]year)(?:\\s+(?:revenue|ARR|sales))?(?:\\s+(?:forecast|projection))?\\s*(?:of|is|at|:|=)?\\s*${MONEY}`, 'i'),
    new RegExp(`${MONEY}\\s*(?:in\\s+)?(?:year\\s*1|Y1)\\b`, 'i')], 'money'],
  ['use_of_funds', [new RegExp(`use of funds\\s*(?:total(?:s|ing)?|of|is|:|=)?\\s*${MONEY}`, 'i'), new RegExp(`${MONEY}\\s*use of funds`, 'i')], 'money'],
];

/** The figures one line states. `forward` lines state only the forecast's year 1. */
export function lineFacts(text: string): Array<{ metric: Metric; value: number }> {
  const out: Array<{ metric: Metric; value: number }> = [];
  const forward = FORWARD.test(text);
  if (!forward) for (const s of parseStatedFigures('deck', text)) out.push({ metric: s.figure, value: s.value });
  const pre = EXTRA.find(([m]) => m === 'pre_money')![1].some((p) => p.test(text));
  const post = EXTRA.find(([m]) => m === 'post_money')![1].some((p) => p.test(text));
  for (const [metric, patterns, unit] of EXTRA) {
    if (forward && metric !== 'forecast_y1') continue;
    const m = patterns.map((p) => p.exec(text)).find(Boolean);
    if (!m) continue;
    const v = unit === 'money' ? money(m[1], m[2]) : Number(m[1]);
    if (v != null && Number.isFinite(v)) out.push({ metric, value: v });
  }
  // A valuation with neither "pre-money" nor "post-money" beside it.
  if (!forward && !pre && !post) {
    const m = new RegExp(`valuation\\s*(?:of|is|at|:|=)?\\s*${MONEY}`, 'i').exec(text) || new RegExp(`${MONEY}\\s*valuation`, 'i').exec(text);
    const v = m ? money(m[1], m[2]) : null;
    if (v != null) out.push({ metric: 'valuation', value: v });
  }
  return out;
}

const SKIP = new Set(['notes', 'blocks', 'binding', 'background', 'areas', 'structure', 'layout', 'id', 'image_url', 'image_id', 'grid', 'kind', 'fit', 'crop', 'url', 'poster_url', 'tag', 'diagram']);
function strings(v: unknown, depth = 0): string[] {
  if (depth > 6) return [];
  if (typeof v === 'string') return v.trim() ? [v] : [];
  if (Array.isArray(v)) return v.flatMap((x) => strings(x, depth + 1));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => (SKIP.has(k) ? [] : strings(x, depth + 1)));
  return [];
}
/** A bound value as the card shows it: "$2.0M", "18%", "14 months", "1,240". */
function shownNumber(v: unknown, unit: 'money' | 'percent' | 'months' | 'count'): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = String(v ?? '');
  const m = /(\d[\d,]*(?:\.\d+)?)\s*(k|mm|m|b|thousand|million|billion)?\b/i.exec(t);
  if (!m) return null;
  return unit === 'money' ? money(m[1], m[2]) : Number(m[1].replace(/,/g, ''));
}

/** Every figure the deck states, card by card (1-based), and each use-of-funds card's allocation lines. */
export function deckFacts(slides: unknown[]): { facts: Fact[]; allocations: Array<{ card: number; amounts: number[]; shares: number[] }> } {
  const facts: Fact[] = [];
  const allocations: Array<{ card: number; amounts: number[]; shares: number[] }> = [];
  slides.forEach((s: any, i) => {
    const card = i + 1;
    const lines: string[] = strings(s);
    const fundShares: number[] = [];
    for (const b of Array.isArray(s?.blocks) ? s.blocks : []) {
      const key = typeof b?.binding?.source_key === 'string' ? b.binding.source_key : null;
      if (b?.kind === 'metric') {
        const metric = key ? SLOT[key] : undefined;
        if (metric) {
          const v = shownNumber(b.value, UNIT[metric]);
          if (v != null) facts.push({ metric, value: v, card });
          continue;
        }
        if (key && FUND_SLOTS.has(key)) {
          const v = shownNumber(b.value, 'percent');
          if (v != null) fundShares.push(v);
          continue;
        }
        lines.push([b.label, b.value].filter((x) => typeof x === 'string' && x.trim()).join(' '));
        continue;
      }
      lines.push(...strings(b));
    }
    const isFunds = fundShares.length > 0 || lines.some((l) => /use of funds/i.test(l));
    const amounts: number[] = [];
    const shares: number[] = [...fundShares];
    for (const line of lines) {
      const found = lineFacts(line);
      for (const f of found) facts.push({ ...f, card });
      if (!isFunds || found.length || FORWARD.test(line)) continue;
      // An allocation line: a share or an amount with no figure's words beside it.
      for (const m of line.matchAll(new RegExp(MONEY, 'gi'))) { const v = money(m[1], m[2]); if (v != null) amounts.push(v); }
      for (const m of line.matchAll(new RegExp(PCT, 'g'))) shares.push(Number(m[1]));
    }
    if (isFunds && (amounts.length > 1 || shares.length > 1)) allocations.push({ card, amounts, shares });
  });
  return { facts, allocations };
}

/**
 * D1580 (#3827): the figures the deck LINKS to the record — metric blocks bound
 * to a slot this module reads — each with its card (1-based), slot and grade.
 * A rehearsal compares what the founder said with these, never with typed text.
 */
export function boundFigures(slides: unknown[]): Array<{ metric: Metric; value: number; card: number; source_key: string; grade: string | null }> {
  const out: Array<{ metric: Metric; value: number; card: number; source_key: string; grade: string | null }> = [];
  slides.forEach((s: any, i) => {
    for (const b of Array.isArray(s?.blocks) ? s.blocks : []) {
      const key = typeof b?.binding?.source_key === 'string' ? b.binding.source_key : null;
      const metric = b?.kind === 'metric' && key ? SLOT[key] : undefined;
      if (!metric || !key || b.binding.grade === 'Not recorded') continue;
      const v = shownNumber(b.value, UNIT[metric]);
      if (v != null) out.push({ metric, value: v, card: i + 1, source_key: key, grade: typeof b.binding.grade === 'string' ? b.binding.grade : null });
    }
  });
  return out;
}

const trim = (n: number) => String(Math.round(n * 10) / 10).replace(/\.0$/, '');
export function shown(metric: Metric | 'money', v: number): string {
  const unit = metric === 'money' ? 'money' : UNIT[metric];
  if (unit === 'percent') return `${trim(v)}%`;
  if (unit === 'months') return `${trim(v)} months`;
  if (unit === 'count') return Math.round(v).toLocaleString('en-US');
  const a = Math.abs(v);
  return a >= 1e9 ? `$${trim(v / 1e9)}B` : a >= 1e6 ? `$${trim(v / 1e6)}M` : a >= 1e3 ? `$${trim(v / 1e3)}k` : `$${Math.round(v).toLocaleString('en-US')}`;
}
const cardsWord = (cards: number[]) => (cards.length === 1 ? `card ${cards[0]}` : `cards ${cards.slice(0, -1).join(', ')} and ${cards.at(-1)}`);
const uniq = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b);

/** Values of one metric that agree with each other, in the order the deck states them. */
function clusters(list: Fact[]): Fact[][] {
  const out: Fact[][] = [];
  for (const f of list) {
    const c = out.find((g) => agrees(g[0].value, f.value));
    if (c) c.push(f); else out.push([f]);
  }
  return out;
}

/**
 * The findings for a deck's slides, every rule run on every call. Slides that
 * are not a list are unreadable: nothing is said about them, rather than
 * "consistent".
 */
export function deckConsistency(slides: unknown): Consistency {
  if (!Array.isArray(slides)) return { state: 'unreadable', findings: [] };
  const { facts, allocations } = deckFacts(slides);
  const findings: Finding[] = [];
  const by = new Map<Metric, Fact[]>();
  for (const f of facts) by.set(f.metric, [...(by.get(f.metric) || []), f]);
  /** The one value the deck states for a metric; null when it states none, or more than one (`one_value` reports those). */
  const one = (m: Metric): Fact | null => { const c = clusters(by.get(m) || []); return c.length === 1 ? c[0][0] : null; };
  const cardsOf = (m: Metric) => uniq((by.get(m) || []).map((f) => f.card));

  for (const [metric, list] of by) {
    const groups = clusters(list);
    if (groups.length < 2) continue;
    const parts = groups.map((g) => `${shown(metric, g[0].value)} on ${cardsWord(uniq(g.map((f) => f.card)))}`);
    findings.push({ key: `one_value:${metric}`, rule: 'one_value', message: `${LABEL[metric]} is ${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}.`, cards: uniq(list.map((f) => f.card)) });
  }

  const raise = one('raise');
  if (raise) {
    const stated = one('use_of_funds');
    const alloc = allocations.filter((a) => a.amounts.length > 1);
    const total = stated ? { value: stated.value, cards: cardsOf('use_of_funds') } : alloc.length === 1 ? { value: alloc[0].amounts.reduce((a, b) => a + b, 0), cards: [alloc[0].card] } : null;
    if (total && !agrees(total.value, raise.value)) {
      findings.push({ key: 'use_of_funds:raise', rule: 'use_of_funds', message: `Use of funds ${shown('money', total.value)} does not match the raise ${shown('money', raise.value)}.`, cards: uniq([...total.cards, ...cardsOf('raise')]) });
    }
  }
  for (const a of allocations) {
    if (a.shares.length < 2) continue;
    const sum = a.shares.reduce((x, y) => x + y, 0);
    if (Math.abs(sum - 100) > 1) findings.push({ key: `use_of_funds:shares:${a.card}`, rule: 'use_of_funds', message: `Use of funds adds up to ${trim(sum)}%, not 100%.`, cards: [a.card] });
  }

  const cash = one('cash'), burn = one('net_burn'), runway = one('runway');
  if (cash && burn && runway && burn.value > 0) {
    const months = cash.value / burn.value;
    if (Math.abs(months - runway.value) > Math.max(1, 0.1 * runway.value)) {
      findings.push({ key: 'runway:cash_burn', rule: 'runway', message: `Runway does not equal cash ÷ burn: ${shown('money', cash.value)} ÷ ${shown('money', burn.value)} a month is ${trim(months)} months; the deck says ${shown('runway', runway.value)}.`, cards: uniq([...cardsOf('cash'), ...cardsOf('net_burn'), ...cardsOf('runway')]) });
    }
  }

  if (raise) {
    const pre = one('pre_money'), post = one('post_money'), plain = one('valuation'), dil = one('dilution');
    const roundCards = (...ms: Metric[]) => uniq(ms.flatMap(cardsOf));
    if (pre && post && !agrees(pre.value + raise.value, post.value)) {
      findings.push({ key: 'round:pre_post', rule: 'round', message: `Post-money ${shown('money', post.value)} is not pre-money ${shown('money', pre.value)} plus the raise ${shown('money', raise.value)}.`, cards: roundCards('pre_money', 'post_money', 'raise') });
    }
    if (dil) {
      const posts = post ? [post.value] : pre ? [pre.value + raise.value] : plain ? [plain.value, plain.value + raise.value] : [];
      const expected = posts.map((p) => (raise.value / p) * 100);
      if (expected.length && !expected.some((e) => Math.abs(e - dil.value) <= 1)) {
        const basis = post ? `post-money ${shown('money', post.value)}` : pre ? `pre-money ${shown('money', pre.value)}` : `the valuation ${shown('money', plain!.value)}`;
        findings.push({ key: 'round:dilution', rule: 'round', message: `The raise ${shown('money', raise.value)} at ${basis} is ${trim(expected[0])}% dilution, not ${shown('dilution', dil.value)}.`, cards: roundCards('raise', 'dilution', 'pre_money', 'post_money', 'valuation') });
      }
    }
  }

  const y1 = one('forecast_y1'), arr = one('arr');
  if (y1 && arr && !agrees(y1.value, arr.value)) {
    findings.push({ key: 'forecast:arr', rule: 'forecast', message: `Forecast year 1 ${shown('money', y1.value)} does not match current ARR ${shown('money', arr.value)}.`, cards: uniq([...cardsOf('forecast_y1'), ...cardsOf('arr')]) });
  }
  return { state: 'ok', findings };
}
