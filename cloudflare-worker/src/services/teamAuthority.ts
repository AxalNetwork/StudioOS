/**
 * Title, authority and economics — three axes, and why they must stay apart.
 *
 * `user_company_links` carried one: `role_in_company`, a free TEXT string
 * defaulting to 'Member'. The Team · Authority design is built on the
 * observation that squeezing a firm's team model into one string is the bug,
 * because it forces three independent facts to agree:
 *
 *   TITLE      where someone sits — a LADDER rung, or a non-ladder FUNCTION.
 *   AUTHORITY  what they may actually do — VIEW, WORK, FLAG, SPONSOR, VOTE.
 *   ECONOMICS  carry, which tracks neither of the others.
 *
 * THE CASES THAT PROVE THEY ARE INDEPENDENT, each from the design:
 *
 *   · A Venture Partner SPONSORs — outranking a Vice President's FLAG — while
 *     being part-time with no GP ownership and often less carry.
 *   · A Vice President is senior to an Associate on the ladder and holds the
 *     SAME authority.
 *   · An Operating Partner is a partner by title and VIEW by authority.
 *
 * So `authorityForTitle` returns a DEFAULT, not a derivation. The stored
 * `authority` column is independent, and a caller may set any level for any
 * title. If authority were computed from title, renaming someone would grant
 * or revoke power silently — the one thing an authority model must never do,
 * and what `team_authority.test.mjs` exists to prevent.
 *
 * WHAT AUTHORITY MEANS, in the design's own words, because two of these are
 * routinely misread:
 *
 *   FLAG    "May raise a formal objection that blocks a decision until
 *           answered. Not a veto — a stop."
 *   SPONSOR "Brings a deal to committee. Cannot decide it."
 *   VOTE    "Decides. The only level that does."
 *
 * NOTHING HERE IS AN ACCESS CHECK YET. `canEdit()` in routes/company.ts still
 * reads `role_in_company`, and migration 191 deliberately did not touch it:
 * rewriting a permission check in the same change that adds its replacement is
 * how a permissions bug ships. This is the vocabulary and the store; wiring
 * authority into enforcement is a separate, deliberate step.
 */

/** Ordered weakest to strongest. Order is meaningful; the index is the rank. */
export const AUTHORITY_LEVELS = ['VIEW', 'WORK', 'FLAG', 'SPONSOR', 'VOTE'] as const;
export type Authority = (typeof AUTHORITY_LEVELS)[number];

export const AUTHORITY_MEANING: Record<Authority, string> = {
  VIEW: 'Sees the pipeline. Touches nothing.',
  WORK: 'Runs diligence, builds models, drafts memos.',
  FLAG: 'May raise a formal objection that blocks a decision until answered. Not a veto — a stop.',
  SPONSOR: 'Brings a deal to committee. Cannot decide it.',
  VOTE: 'Decides. The only level that does.',
};

export interface LadderRung {
  title: string;
  /** The authority this rung USUALLY carries. A default, never a derivation. */
  defaultAuthority: Authority;
  does: string;
  /** Carry band in basis points, inclusive. Guidance for the picker only. */
  carryBpsBand: [number, number];
}

/** The investment ladder, in seniority order. */
export const LADDER: ReadonlyArray<LadderRung> = [
  { title: 'Analyst', defaultAuthority: 'WORK',
    does: 'Research, market maps, screening, model support.', carryBpsBand: [0, 25] },
  { title: 'Associate', defaultAuthority: 'FLAG',
    does: 'Runs diligence, drafts memos, some portfolio relationships.', carryBpsBand: [25, 100] },
  { title: 'Senior Associate', defaultAuthority: 'FLAG',
    does: 'Experienced deal-runner, more autonomy.', carryBpsBand: [50, 150] },
  { title: 'Vice President', defaultAuthority: 'FLAG',
    does: 'Sources and leads diligence; presents to IC.', carryBpsBand: [100, 200] },
  { title: 'Principal', defaultAuthority: 'SPONSOR',
    does: 'Leads deals end to end, manages Associates, observer seats.', carryBpsBand: [100, 300] },
  { title: 'Venture Partner', defaultAuthority: 'SPONSOR',
    does: 'Sourcing and sector depth, usually part-time, no GP ownership.', carryBpsBand: [50, 200] },
  { title: 'Partner / GP', defaultAuthority: 'VOTE',
    does: 'Decides. Carries the fund.', carryBpsBand: [200, 10000] },
];

export interface TeamFunction {
  name: string;
  defaultAuthority: Authority;
  sees: string;
}

/**
 * Non-ladder functions. Every one defaults to VIEW — that is the design's
 * position, not an oversight: these roles are scoped to a slice and none of
 * them decides anything by default.
 */
export const FUNCTIONS: ReadonlyArray<TeamFunction> = [
  { name: 'Operating Partner', defaultAuthority: 'VIEW',
    sees: 'Portfolio companies they are scoped to. Talent, GTM, product.' },
  { name: 'Entrepreneur in Residence', defaultAuthority: 'VIEW',
    sees: 'Time-boxed by definition. Converts to Venture Partner or Principal.' },
  { name: 'Fundraising & LP Relations', defaultAuthority: 'VIEW',
    sees: 'Funds reporting and LP records. Not the deal pipeline.' },
  { name: 'Operations / Back office', defaultAuthority: 'VIEW',
    sees: 'Contracts and Revenue slices. No deal or LP data by default.' },
  { name: 'Community / Ecosystem', defaultAuthority: 'VIEW',
    sees: 'Community and content. Nothing financial.' },
  { name: 'Tech / Platform Support', defaultAuthority: 'VIEW',
    sees: 'Support, access operations, Platform read. No financial, LP or carry visibility.' },
];

const TITLES = new Map<string, Authority>([
  ...LADDER.map((r) => [r.title, r.defaultAuthority] as [string, Authority]),
  ...FUNCTIONS.map((f) => [f.name, f.defaultAuthority] as [string, Authority]),
]);

export function isTitle(t: unknown): t is string {
  return typeof t === 'string' && TITLES.has(t);
}

export function isAuthority(a: unknown): a is Authority {
  return typeof a === 'string' && (AUTHORITY_LEVELS as readonly string[]).includes(a);
}

/**
 * The authority a title USUALLY carries, for pre-filling a picker.
 *
 * Callers must treat this as a suggestion. Nothing reads it to decide what a
 * person may do — that is the stored column, which the caller sets explicitly.
 */
export function authorityForTitle(title: string): Authority | null {
  return TITLES.get(title) ?? null;
}

/** Rank of an authority level, or -1. Strictly for ordering, never for access. */
export function authorityRank(a: string): number {
  return (AUTHORITY_LEVELS as readonly string[]).indexOf(a);
}

/**
 * Validate carry. Basis points, integer, 0–10000 — see migration 191 for why
 * a rate is stored as bps rather than a float.
 */
export function normalizeCarryBps(v: unknown): number | null | undefined {
  if (v === null) return null;             // explicit clear
  if (v === undefined || v === '') return undefined; // leave alone
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 10000) return undefined;
  return n;
}

/** Everything a picker needs, in one payload. */
export function teamVocabulary() {
  return {
    authority_levels: AUTHORITY_LEVELS.map((k) => ({ key: k, meaning: AUTHORITY_MEANING[k] })),
    ladder: LADDER,
    functions: FUNCTIONS,
    carry_unit: 'basis_points',
  };
}
