/**
 * D5624 (#5624) — a team's Landing settings: the contract.
 *
 * Pure types, defaults, HQ caps and `validateLandingPolicy(body, hq)`. No
 * imports, so the studioos Worker (its `team_landing.ts` route) and
 * Merge Control can both read it. Shape only: whether a referenced person is
 * on the team, an agent belongs to it, or a repository record is the team's,
 * is the caller's check against D1.
 *
 * A field that is `null` is unset and takes `LANDING_DEFAULTS` (as in D4422).
 * A PUT body names only the fields it changes; `null` resets one.
 *
 * Two rules hold whatever HQ sets:
 *   - T2 never lands by itself: `landing.auto_tiers` holds T0 and T1 only.
 *   - `landing.t2_signers` are people, never agents.
 */

export const LANDING_TIERS = ['T0', 'T1', 'T2'] as const;
export type LandingTier = typeof LANDING_TIERS[number];
/** The tiers a team may let land without a person; T2 is never one of them. */
export const AUTO_TIERS = ['T0', 'T1'] as const;
export type AutoTier = typeof AUTO_TIERS[number];

export type PersonRef = { kind: 'person'; uid: string };
export type AgentRef = { kind: 'agent'; uid: string };
export type ActorRef = PersonRef | AgentRef;

export type LandingRules = { auto_tiers: AutoTier[]; t2_signers: PersonRef[] };
export type RepairRules = { max_attempts: number; max_spend_microusd: number; pushers: ActorRef[] };
export type PathOwner = { path: string; owners: PersonRef[] };

export type LandingPolicy = {
  /** A `venture_git_installations.uid` (D5569); a reference, never proof of access. */
  repository: string | null;
  landing: LandingRules | null;
  repair: RepairRules | null;
  path_owners: PathOwner[] | null;
  max_parallel_per_repo: number | null;
  /** Compute (executors, CI), separate from the inference budget. Integer micro-USD per month. */
  compute_budget_microusd: number | null;
  /** Provider ids as D5565's `PROVIDERS` names them. */
  executors: string[] | null;
};

export const LANDING_FIELDS = [
  'repository', 'landing', 'repair', 'path_owners', 'max_parallel_per_repo', 'compute_budget_microusd', 'executors',
] as const satisfies readonly (keyof LandingPolicy)[];
export type LandingField = typeof LANDING_FIELDS[number];

/** Every field unset: what a scope with no row reads as. */
export const UNSET_POLICY: LandingPolicy = Object.freeze({
  repository: null, landing: null, repair: null, path_owners: null,
  max_parallel_per_repo: null, compute_budget_microusd: null, executors: null,
});

/**
 * What an unset field means to the enforcer (#5570, #5580). Nothing lands,
 * repairs or runs until a manager chooses it: T0 alone lands by itself, no one
 * signs T2, repair is off, one change at a time, no compute, no executor.
 */
export const LANDING_DEFAULTS = Object.freeze({
  repository: null,
  landing: { auto_tiers: ['T0'] as AutoTier[], t2_signers: [] as PersonRef[] },
  repair: { max_attempts: 0, max_spend_microusd: 0, pushers: [] as ActorRef[] },
  path_owners: [] as PathOwner[],
  max_parallel_per_repo: 1,
  compute_budget_microusd: 0,
  executors: [] as string[],
});

/** HQ's bounds on a team's values. The caller passes the executor list. */
export type LandingCaps = {
  repair_max_attempts: number;
  repair_max_spend_microusd: number;
  max_parallel_per_repo: number;
  compute_budget_microusd: number;
  executors: readonly string[];
};

/**
 * HQ's bounds until an HQ store holds them (none exists on main, D5624).
 * `repair_max_attempts` is internal Merge Control's own (`repairPolicy.ts`,
 * MAX_ATTEMPTS = 2); `max_parallel_per_repo` matches the engine's 1 to 5.
 */
export const HQ_LANDING_CAPS: Omit<LandingCaps, 'executors'> = Object.freeze({
  repair_max_attempts: 2,
  repair_max_spend_microusd: 50_000_000,
  max_parallel_per_repo: 5,
  compute_budget_microusd: 1_000_000_000,
});

export const LIST_MAX = { t2_signers: 20, pushers: 20, path_owners: 200, owners: 20 } as const;
export const PATH_MAX = 200;

export type LandingRefusal = { ok: false; field: string; message: string };
export type LandingPatch = { ok: true; patch: Partial<LandingPolicy> };

const UID = /^[A-Za-z0-9_-]{1,64}$/;
const INSTALLATION_UID = /^[0-9a-f]{32}$/;
/** A repository path pattern: letters, digits, `. _ - / *`; relative, no `..`, no `.git`. */
const PATH_CHARS = /^[A-Za-z0-9._*/-]+$/;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const wholeIn = (v: unknown, lo: number, hi: number): v is number => Number.isSafeInteger(v) && (v as number) >= lo && (v as number) <= hi;
const no = (field: string, message: string): LandingRefusal => ({ ok: false, field, message });

function closed(v: Record<string, unknown>, keys: readonly string[], field: string): LandingRefusal | null {
  const extra = Object.keys(v).find((k) => !keys.includes(k));
  if (extra) return no(`${field}.${extra}`, `${field} has no ${extra}.`);
  const missing = keys.find((k) => !(k in v));
  return missing ? no(`${field}.${missing}`, `Send ${field}.${missing}.`) : null;
}

function refs(v: unknown, field: string, max: number, agents: boolean): ActorRef[] | LandingRefusal {
  if (!Array.isArray(v) || v.length > max) return no(field, `${field} is a list of at most ${max}.`);
  const seen = new Set<string>();
  const out: ActorRef[] = [];
  for (const r of v) {
    if (!isObj(r) || Object.keys(r).some((k) => k !== 'kind' && k !== 'uid')) return no(field, `Each of ${field} is { kind, uid }.`);
    if (r.kind === 'agent' && !agents) return no(field, `${field} are people, never agents.`);
    if (r.kind !== 'person' && r.kind !== 'agent') return no(field, `Each of ${field} is a person${agents ? ' or an agent' : ''}.`);
    if (typeof r.uid !== 'string' || !UID.test(r.uid)) return no(field, `Each of ${field} names its uid.`);
    const key = `${r.kind}:${r.uid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: r.kind, uid: r.uid });
  }
  return out.sort((a, b) => (a.kind + a.uid < b.kind + b.uid ? -1 : a.kind + a.uid > b.kind + b.uid ? 1 : 0));
}
const refused = (x: unknown): x is LandingRefusal => isObj(x) && x.ok === false;

function landing(v: unknown): LandingRules | LandingRefusal {
  if (!isObj(v)) return no('landing', 'landing is { auto_tiers, t2_signers }, or null.');
  const shape = closed(v, ['auto_tiers', 't2_signers'], 'landing');
  if (shape) return shape;
  if (!Array.isArray(v.auto_tiers)) return no('landing.auto_tiers', 'landing.auto_tiers is a list of tiers.');
  if (v.auto_tiers.includes('T2')) return no('landing.auto_tiers', 'T2 never lands by itself; a person signs it.');
  if (v.auto_tiers.some((t) => !(AUTO_TIERS as readonly unknown[]).includes(t))) return no('landing.auto_tiers', 'landing.auto_tiers holds T0 and T1 only.');
  const signers = refs(v.t2_signers, 'landing.t2_signers', LIST_MAX.t2_signers, false);
  if (refused(signers)) return signers;
  const tiers = AUTO_TIERS.filter((t) => (v.auto_tiers as unknown[]).includes(t));
  return { auto_tiers: [...tiers], t2_signers: signers as PersonRef[] };
}

function repair(v: unknown, caps: LandingCaps): RepairRules | LandingRefusal {
  if (!isObj(v)) return no('repair', 'repair is { max_attempts, max_spend_microusd, pushers }, or null.');
  const shape = closed(v, ['max_attempts', 'max_spend_microusd', 'pushers'], 'repair');
  if (shape) return shape;
  if (!wholeIn(v.max_attempts, 0, caps.repair_max_attempts)) return no('repair.max_attempts', `repair.max_attempts is a whole number from 0 to ${caps.repair_max_attempts}.`);
  if (!wholeIn(v.max_spend_microusd, 0, caps.repair_max_spend_microusd)) return no('repair.max_spend_microusd', `repair.max_spend_microusd is whole micro-USD from 0 to ${caps.repair_max_spend_microusd}.`);
  const pushers = refs(v.pushers, 'repair.pushers', LIST_MAX.pushers, true);
  if (refused(pushers)) return pushers;
  return { max_attempts: v.max_attempts, max_spend_microusd: v.max_spend_microusd, pushers: pushers as ActorRef[] };
}

function pathOwners(v: unknown): PathOwner[] | LandingRefusal {
  if (!Array.isArray(v) || v.length > LIST_MAX.path_owners) return no('path_owners', `path_owners is a list of at most ${LIST_MAX.path_owners}.`);
  const out = new Map<string, PathOwner>();
  for (const o of v) {
    if (!isObj(o)) return no('path_owners', 'Each of path_owners is { path, owners }.');
    const shape = closed(o, ['path', 'owners'], 'path_owners');
    if (shape) return shape;
    const p = o.path;
    if (typeof p !== 'string' || p.length > PATH_MAX || !PATH_CHARS.test(p) || p.startsWith('/')
      || p.split('/').some((seg) => seg === '..' || seg === '.' || seg === '.git' || seg === '')) {
      return no('path_owners.path', `A path is a relative repository pattern of at most ${PATH_MAX} letters, digits and . _ - / *.`);
    }
    if (out.has(p)) return no('path_owners.path', `${p} is listed twice.`);
    const owners = refs(o.owners, 'path_owners.owners', LIST_MAX.owners, false);
    if (refused(owners)) return owners;
    if (!(owners as PersonRef[]).length) return no('path_owners.owners', `${p} needs at least one owner.`);
    out.set(p, { path: p, owners: owners as PersonRef[] });
  }
  return [...out.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * A PUT body → the fields it sets (null = unset), or the first field at fault.
 * An empty body, an unknown key, T2 in `auto_tiers`, an agent signer, a value
 * over `caps`, or an executor outside `caps.executors` is refused.
 */
export function validateLandingPolicy(body: unknown, caps: LandingCaps): LandingPatch | LandingRefusal {
  if (!isObj(body)) return no('body', 'Send the Landing settings as an object.');
  const keys = Object.keys(body);
  if (!keys.length) return no('body', `Send at least one of ${LANDING_FIELDS.join(', ')}.`);
  const unknown = keys.find((k) => !(LANDING_FIELDS as readonly string[]).includes(k));
  if (unknown) return no(unknown, `${unknown} is not a Landing setting.`);
  const patch: Partial<LandingPolicy> = {};
  for (const k of keys as LandingField[]) {
    const v = body[k];
    if (v === null) { (patch as Record<string, unknown>)[k] = null; continue; }
    switch (k) {
      case 'repository':
        if (typeof v !== 'string' || !INSTALLATION_UID.test(v)) return no(k, 'repository is a connected repository’s id, or null.');
        patch.repository = v; break;
      case 'landing': { const r = landing(v); if (refused(r)) return r; patch.landing = r; break; }
      case 'repair': { const r = repair(v, caps); if (refused(r)) return r; patch.repair = r; break; }
      case 'path_owners': { const r = pathOwners(v); if (refused(r)) return r; patch.path_owners = r; break; }
      case 'max_parallel_per_repo':
        if (!wholeIn(v, 1, caps.max_parallel_per_repo)) return no(k, `max_parallel_per_repo is a whole number from 1 to ${caps.max_parallel_per_repo}.`);
        patch.max_parallel_per_repo = v; break;
      case 'compute_budget_microusd':
        if (!wholeIn(v, 0, caps.compute_budget_microusd)) return no(k, `compute_budget_microusd is whole micro-USD from 0 to ${caps.compute_budget_microusd}.`);
        patch.compute_budget_microusd = v; break;
      case 'executors': {
        if (!Array.isArray(v) || v.some((e) => typeof e !== 'string')) return no(k, 'executors is a list of provider ids.');
        const outside = v.find((e) => !caps.executors.includes(e as string));
        if (outside !== undefined) return no(k, `${outside} is not an executor HQ offers.`);
        patch.executors = caps.executors.filter((e) => v.includes(e));
        break;
      }
    }
  }
  return { ok: true, patch };
}
