/**
 * D576 (#1189) — a founder's tech-transfer answer re-sequences their Spin-Out
 * Lab Week 1. The pure half: the rule table and the recompute. No Hono, no
 * D1; `routes/spinout_lab.ts` stores what these return (migration 396) and
 * the tests call them directly.
 *
 * THE STEPS are the catalog's Week 1 milestone keys (`spinoutLabCatalog.ts`):
 * the four the week gate requires and the six optional deliverables. A rule
 * ORDERS them. It never adds a step (a step with no milestone key could never
 * be marked done) and never drops one (every key is either in the gate or on
 * the checklist). The catalog itself is never edited.
 *
 * THE STATUSES are the ones the application stores (`TTO_STATUSES` in
 * `applicationLifecycle.ts`), plus two the answer implies: an independent
 * build, which is asked no tech-transfer question, and no answer at all (an
 * application from before migration 315, or none).
 */
import { MILESTONES, OPTIONAL_MILESTONES } from './spinoutLabCatalog';
import type { Answers } from './applicationLifecycle';

/** The catalog's Week 1 keys, in catalog order: the required four, then the optional six. */
export const WEEK1_KEYS: readonly string[] = [
  ...(MILESTONES.find((w) => w.week === 1)?.requiredAll ?? []),
  ...(OPTIONAL_MILESTONES[1] ?? []),
];

export const RULE_KEYS = [
  'not_disclosed', 'disclosed', 'negotiating', 'signed', 'not_applicable', 'independent', 'not_recorded',
] as const;
export type RuleKey = (typeof RULE_KEYS)[number];

const I = (n: number) => `customer_interview_logged_${n}`;

/**
 * THE RULE TABLE — the one place the orderings live. `label` is what the
 * member's Week 1 prints after "Ordered for:"; `why` is the reason, in one
 * sentence. Every `order` is the catalog's ten Week 1 keys, each once.
 */
export const RULES: Readonly<Record<RuleKey, { label: string; why: string; order: readonly string[] }>> = {
  not_disclosed: {
    label: 'Not yet disclosed to the tech-transfer office',
    why: 'Until the office knows, talk about the problem, not the invention: define the customer and the market first, and share research last.',
    order: ['project_created', 'icp_defined', 'market_sizing_completed', I(1), I(2), I(3), 'profiling_completed', I(4), I(5), 'market_research_shared'],
  },
  disclosed: {
    label: 'Disclosed, no discussion yet',
    why: 'The office knows and nothing is agreed: interviews come first, so the licence conversation starts from customer evidence.',
    order: ['project_created', I(1), I(2), I(3), 'icp_defined', 'market_sizing_completed', 'profiling_completed', I(4), I(5), 'market_research_shared'],
  },
  negotiating: {
    label: 'Licence under negotiation',
    why: 'A licence is scoped by field of use and market, so the market is sized first and the customer defined before the interviews.',
    order: ['project_created', 'market_sizing_completed', 'icp_defined', I(1), I(2), I(3), I(4), I(5), 'profiling_completed', 'market_research_shared'],
  },
  signed: {
    label: 'Licence or assignment signed',
    why: 'The company can hold the IP today, so every interview comes first.',
    order: ['project_created', I(1), I(2), I(3), I(4), I(5), 'icp_defined', 'market_sizing_completed', 'profiling_completed', 'market_research_shared'],
  },
  not_applicable: {
    label: 'No transfer office involved',
    why: 'There is no office to wait on, so Week 1 keeps the Lab’s standard order.',
    order: WEEK1_KEYS,
  },
  independent: {
    label: 'Independent build',
    why: 'An independent build owns what it has made, so Week 1 keeps the Lab’s standard order.',
    order: WEEK1_KEYS,
  },
  not_recorded: {
    label: 'No tech-transfer answer recorded',
    why: 'Your application recorded no tech-transfer answer, so Week 1 keeps the Lab’s standard order.',
    order: WEEK1_KEYS,
  },
};

/** The rule an application's answers select. */
export function ruleFor(answers: Pick<Answers, 'origin' | 'tto_status'> | null | undefined): RuleKey {
  if (!answers) return 'not_recorded';
  if (answers.origin === 'independent') return 'independent';
  const s = answers.tto_status;
  return s && (RULE_KEYS as readonly string[]).includes(s) ? (s as RuleKey) : 'not_recorded';
}

/**
 * The steps a plan holds after a (re)compute.
 *
 * - Before Week 1 starts, the plan is the rule's order.
 * - After it starts, the steps already done keep their places at the head of
 *   the plan, in the order the previous plan had them (catalog order when
 *   there was none). Only the steps not yet done follow the new rule's order.
 */
export function planSteps(
  rule: RuleKey,
  opts: { started: boolean; done?: Iterable<string>; previous?: readonly string[] | null },
): string[] {
  const order = [...RULES[rule].order];
  if (!opts.started) return order;
  const done = new Set(opts.done ?? []);
  const before = (opts.previous && opts.previous.length ? opts.previous : WEEK1_KEYS).filter((k) => done.has(k));
  return [...before, ...order.filter((k) => !before.includes(k))];
}

/** A stored `steps_json` → its keys, or null when it is not a list of Week 1 keys. */
export function parseSteps(json: unknown): string[] | null {
  if (typeof json !== 'string') return null;
  try {
    const v = JSON.parse(json);
    if (!Array.isArray(v) || !v.every((k) => typeof k === 'string' && WEEK1_KEYS.includes(k))) return null;
    return v;
  } catch {
    return null;
  }
}

export interface PlanRow {
  user_id: number; rule_key: string; steps_json: string; started: number;
  computed_by: string; created_at: string; updated_at: string;
}

/** A stored plan → what `/state` and the admin list send. Null when the row cannot be read as a plan. */
export function planView(row: PlanRow | null | undefined) {
  if (!row) return null;
  const steps = parseSteps(row.steps_json);
  const rule = (RULE_KEYS as readonly string[]).includes(row.rule_key) ? RULES[row.rule_key as RuleKey] : null;
  if (!steps || !rule) return null;
  return {
    rule: row.rule_key, label: rule.label, why: rule.why, steps,
    computed_with_week1_started: Number(row.started) === 1,
    computed_by: row.computed_by, created_at: row.created_at, updated_at: row.updated_at,
  };
}
