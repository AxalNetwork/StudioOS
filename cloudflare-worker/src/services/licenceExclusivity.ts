/**
 * D5019 (#5019) — territorial exclusivity, development commitments and
 * regional / master-franchise territories, apart from the operating licence.
 *
 * INDEPENDENT OF THE FEE. The operating licence (its territory in
 * `licence_territories`, its fee and royalty in `territory_licences`) is one
 * thing; exclusivity is another, versioned in `licence_exclusivity_terms`.
 * Paying the standard fee grants no exclusivity: a licence with no exclusivity
 * row is non-exclusive.
 *
 * OVERLAP. `licence_territories` keeps refusing two operating licences on one
 * country (migration 187's unique index): unchanged. On top of it, two
 * exclusive scopes may not cover the same ground, with one exception: a scope
 * that names a master franchise as its parent sits inside that master's scope,
 * and must. A master franchise may cover countries other licences operate in
 * only when those licences are modelled as its children, so a parent and a
 * child never read as two competing operating rights.
 *
 * NOTHING REVOKES ITSELF. A missed development target opens an HQ review and
 * marks the exclusivity at risk; it never ends or narrows it. HQ closes the
 * review with an action, a reason and the consequence it was shown, and that
 * action writes the next version.
 */
import type { Env } from '../types';
import { isIsoDay } from './licenceTerms';
import { territoryOf } from './licencePricingApply';
import { clearGuard, decisionGuard, runDecision } from './decisionBatch';

export const SCOPE_TYPES = ['non_exclusive', 'country_exclusive', 'regional_exclusive', 'master_franchise'] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];
export const STATES = ['draft', 'in_force', 'at_risk', 'released', 'ended'] as const;
export type ExState = (typeof STATES)[number];
export const METRICS = ['qualifying_revenue_cents', 'cohorts', 'active_members', 'network'] as const;
export type Metric = (typeof METRICS)[number];
export const ACTIONS = ['continue', 'cure_period', 'reduce_territory', 'convert_non_exclusive', 'end_exclusivity'] as const;
export type Action = (typeof ACTIONS)[number];
/** The target field each metric is measured against. */
export const TARGET_OF: Record<Metric, string> = {
  qualifying_revenue_cents: 'min_revenue_cents', cohorts: 'min_cohorts', active_members: 'min_active_members', network: 'min_network',
};

export type Target = { year: number; period_start: string; period_end: string; min_revenue_cents: number | null; min_cohorts: number | null; min_active_members: number | null; min_network: number | null };
export type Territory = { countries: string[]; regions: string[] };
export type TermsInput = {
  scope_type: ScopeType; territory: Territory; parent_licence_uid: string | null; child_licence_uids: string[];
  starts_on: string | null; ends_on: string | null; review_on: string | null; cure_period_days: number | null;
  targets: Target[]; state: ExState; contractual: boolean; reason: string; note: string | null; cure_until?: string | null;
};
export type Terms = TermsInput & { uid: string; licence_uid: string; revision: number; cure_until: string | null; created_at: string; created_by: string; superseded_at: string | null };

/** A refusal with a status and a stable code. */
export class ExclusivityError extends Error {
  readonly status: 400 | 404 | 409;
  readonly code: string;
  readonly sentence: string;
  readonly extra: Record<string, unknown>;
  constructor(status: 400 | 404 | 409, code: string, sentence: string, extra: Record<string, unknown> = {}) {
    super(sentence);
    this.status = status; this.code = code; this.sentence = sentence; this.extra = extra;
  }
}

const parse = <T>(s: unknown, d: T): T => { try { return JSON.parse(String(s)) as T; } catch { return d; } };

function termsOf(r: Record<string, any>): Terms {
  const t = parse<Territory>(r.territory_json, { countries: [], regions: [] });
  return {
    uid: String(r.uid), licence_uid: String(r.licence_uid), revision: Number(r.revision), scope_type: r.scope_type,
    territory: { countries: Array.isArray(t.countries) ? t.countries : [], regions: Array.isArray(t.regions) ? t.regions : [] },
    parent_licence_uid: r.parent_licence_uid ?? null, child_licence_uids: parse<string[]>(r.child_licences_json, []), starts_on: r.starts_on ?? null, ends_on: r.ends_on ?? null, review_on: r.review_on ?? null,
    cure_period_days: r.cure_period_days === null || r.cure_period_days === undefined ? null : Number(r.cure_period_days),
    cure_until: r.cure_until ?? null, targets: parse<Target[]>(r.targets_json, []), state: r.state, contractual: Number(r.contractual) === 1,
    reason: String(r.reason), note: r.note ?? null, created_at: String(r.created_at), created_by: String(r.created_by), superseded_at: r.superseded_at ?? null,
  };
}

export async function currentTerms(env: Env, licenceUid: string): Promise<Terms | null> {
  const r = await env.DB.prepare('SELECT * FROM licence_exclusivity_terms WHERE licence_uid = ? AND superseded_at IS NULL').bind(licenceUid).first<Record<string, any>>();
  return r ? termsOf(r) : null;
}

export async function termsHistory(env: Env, licenceUid: string): Promise<Terms[]> {
  const r = await env.DB.prepare('SELECT * FROM licence_exclusivity_terms WHERE licence_uid = ? ORDER BY revision DESC').bind(licenceUid).all<Record<string, any>>();
  return (r.results || []).map(termsOf);
}

// ── Validation ───────────────────────────────────────────────────────────────

const ISO2 = /^[A-Z]{2}$/;
const REGION = /^[A-Z0-9-]{2,40}$/;
const intOrNull = (v: unknown, max: number) => (v === null || v === undefined ? { ok: true as const, v: null }
  : typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max ? { ok: true as const, v } : { ok: false as const });

export function validateTargets(raw: unknown, errors: Record<string, string>): Target[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 10) { errors.targets = 'must be a list of at most 10 yearly targets'; return []; }
  const out: Target[] = [];
  const years = new Set<number>();
  raw.forEach((t: any, i) => {
    const at = `targets.${i}`;
    if (!t || typeof t !== 'object') { errors[at] = 'must be an object'; return; }
    if (!Number.isInteger(t.year) || t.year < 1 || t.year > 10 || years.has(t.year)) { errors[`${at}.year`] = 'must be a year number from 1 to 10, once each'; return; }
    years.add(t.year);
    if (!isIsoDay(t.period_start) || !isIsoDay(t.period_end) || t.period_end < t.period_start) { errors[`${at}.period`] = 'needs a real period_start and a later period_end'; return; }
    const mins: Record<string, number | null> = {};
    for (const [k, max] of [['min_revenue_cents', 1e12], ['min_cohorts', 10000], ['min_active_members', 10_000_000], ['min_network', 10_000_000]] as const) {
      const r = intOrNull(t[k], max);
      if (!r.ok) errors[`${at}.${k}`] = 'must be a whole number, not negative, or null for no target'; else mins[k] = r.v;
    }
    out.push({ year: t.year, period_start: t.period_start, period_end: t.period_end, ...(mins as any) });
  });
  return out.sort((a, b) => a.year - b.year);
}

/** An exclusivity version a person sent, checked in itself (the overlap rules need the database: `overlapProblems`). */
export function validateTermsBody(b: Record<string, unknown> | null): { ok: true; value: TermsInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const x = b || {};
  const scope = x.scope_type;
  if (typeof scope !== 'string' || !(SCOPE_TYPES as readonly string[]).includes(scope)) errors.scope_type = `must be one of ${SCOPE_TYPES.join(', ')}`;
  const terr = (x.territory && typeof x.territory === 'object' ? x.territory : {}) as Record<string, unknown>;
  const countries = Array.isArray(terr.countries) ? terr.countries.map((c) => String(c ?? '').trim().toUpperCase()) : [];
  const regions = Array.isArray(terr.regions) ? terr.regions.map((c) => String(c ?? '').trim().toUpperCase()) : [];
  if (countries.some((c) => !ISO2.test(c))) errors['territory.countries'] = 'every country is an ISO 3166-1 alpha-2 code';
  if (regions.some((c) => !REGION.test(c))) errors['territory.regions'] = 'every region is a region id (A–Z, 0–9 and hyphens)';
  if (scope === 'regional_exclusive' && !regions.length) errors['territory.regions'] = 'a regional exclusivity names at least one region';
  if ((scope === 'country_exclusive' || scope === 'master_franchise') && !countries.length && !regions.length) errors.territory = 'name the countries or regions this covers';
  if (scope === 'country_exclusive' && regions.length) errors['territory.regions'] = 'a country exclusivity covers whole countries; use regional_exclusive for regions';
  const parent = x.parent_licence_uid === undefined || x.parent_licence_uid === null ? null
    : typeof x.parent_licence_uid === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x.parent_licence_uid) ? x.parent_licence_uid : (errors.parent_licence_uid = 'is not a licence id', null);
  if (parent && scope === 'master_franchise') errors.parent_licence_uid = 'a master franchise has no parent';
  const kids = Array.isArray(x.child_licence_uids) ? [...new Set(x.child_licence_uids.map((k) => String(k ?? '')))].sort() : [];
  if (kids.length > 200 || kids.some((k) => !/^[A-Za-z0-9_-]{1,64}$/.test(k))) errors.child_licence_uids = 'is a list of licence ids';
  if (kids.length && scope !== 'master_franchise') errors.child_licence_uids = 'only a master franchise lists child licences';
  const day = (k: string) => {
    const v = x[k];
    if (v === undefined || v === null || v === '') return null;
    if (isIsoDay(v)) return v as string;
    errors[k] = 'must be a real date as YYYY-MM-DD';
    return null;
  };
  const starts = day('starts_on');
  const ends = day('ends_on');
  const review = day('review_on');
  if (starts && ends && ends < starts) errors.ends_on = 'must be on or after starts_on';
  const cure = intOrNull(x.cure_period_days, 3650);
  if (!cure.ok) errors.cure_period_days = 'must be whole days from 0 to 3650';
  const targets = validateTargets(x.targets, errors);
  const state = x.state === undefined ? 'in_force' : x.state;
  if (state !== 'draft' && state !== 'in_force') errors.state = 'a version HQ writes is draft or in_force; at risk, released and ended come from a review';
  const reason = typeof x.reason === 'string' ? x.reason.trim() : '';
  if (reason.length < 3 || reason.length > 500) errors.reason = 'say why, in 3 to 500 characters';
  const note = typeof x.note === 'string' ? x.note.trim().slice(0, 2000) || null : null;
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      scope_type: scope as ScopeType, territory: { countries: [...new Set(countries)].sort(), regions: [...new Set(regions)].sort() },
      parent_licence_uid: parent, child_licence_uids: kids, starts_on: starts, ends_on: ends, review_on: review, cure_period_days: cure.ok ? cure.v : null,
      targets, state: state as ExState, contractual: x.contractual !== false, reason, note,
    },
  };
}

// ── Regions and overlap ──────────────────────────────────────────────────────

export type Region = { id: string; kind: 'subnational' | 'metro' | 'multi_country'; name: string; countries: string[]; parent_region_id: string | null };

export async function allRegions(env: Env): Promise<Region[]> {
  const r = await env.DB.prepare('SELECT * FROM territory_regions ORDER BY id').all<Record<string, any>>();
  return (r.results || []).map((x) => ({ id: String(x.id), kind: x.kind, name: String(x.name), countries: parse<string[]>(x.countries_json, []), parent_region_id: x.parent_region_id ?? null }));
}

/** The countries a scope reaches: its own, plus those its regions lie in. */
export function countriesOfScope(t: Territory, regions: Region[]): string[] {
  const by = new Map(regions.map((r) => [r.id, r]));
  return [...new Set([...t.countries, ...t.regions.flatMap((id) => by.get(id)?.countries ?? [])])].sort();
}

/** A region and every region above it. */
function lineage(id: string, by: Map<string, Region>): string[] {
  const out: string[] = [];
  let cur: string | null = id;
  for (let i = 0; cur && i < 20; i++) { out.push(cur); cur = by.get(cur)?.parent_region_id ?? null; }
  return out;
}

/**
 * Whether two scopes cover common ground. Whole countries clash with the same
 * country or any region in it; two regions clash when they are the same or one
 * contains the other. A multi-country region clashes like each of its countries.
 */
export function scopesClash(a: Territory, b: Territory, regions: Region[]): string[] {
  const by = new Map(regions.map((r) => [r.id, r]));
  const whole = (t: Territory) => new Set([...t.countries, ...t.regions.filter((id) => by.get(id)?.kind === 'multi_country').flatMap((id) => by.get(id)!.countries)]);
  const parts = (t: Territory) => t.regions.filter((id) => by.get(id)?.kind !== 'multi_country');
  const out = new Set<string>();
  const aw = whole(a), bw = whole(b);
  for (const c of aw) if (bw.has(c)) out.add(c);
  for (const id of parts(b)) for (const c of by.get(id)?.countries ?? []) if (aw.has(c)) out.add(`${c} (${id})`);
  for (const id of parts(a)) for (const c of by.get(id)?.countries ?? []) if (bw.has(c)) out.add(`${c} (${id})`);
  for (const x of parts(a)) for (const y of parts(b)) if (lineage(x, by).includes(y) || lineage(y, by).includes(x)) out.add(x === y ? x : `${x} / ${y}`);
  return [...out].sort();
}

/** Every reason this version cannot hold, against the licence's operating territory and everyone else's exclusivity. */
export async function overlapProblems(env: Env, licence: { id: number; uid: string }, input: TermsInput): Promise<string[]> {
  const problems: string[] = [];
  const regions = await allRegions(env);
  const known = new Set(regions.map((r) => r.id));
  const unknown = input.territory.regions.filter((id) => !known.has(id));
  if (unknown.length) return [`No region is recorded as ${unknown.join(', ')}. Record it under territory regions first.`];
  const own = await territoryOf(env, licence.id);
  const reach = countriesOfScope(input.territory, regions);

  // Who operates where: the operating-licence ledger (one holder per country, migration 187).
  const held = reach.length
    ? ((await env.DB.prepare(
      `SELECT lt.country_code, l.uid, l.licence_ref FROM licence_territories lt JOIN territory_licences l ON l.id = lt.licence_id
        WHERE lt.licence_id <> ? AND l.status <> 'terminated' AND lt.country_code IN (SELECT value FROM json_each(?))`,
    ).bind(licence.id, JSON.stringify(reach)).all<Record<string, any>>()).results || [])
    : [];
  const live = ((await env.DB.prepare(
    `SELECT * FROM licence_exclusivity_terms WHERE superseded_at IS NULL AND licence_uid <> ? AND state IN ('draft', 'in_force', 'at_risk')`,
  ).bind(licence.uid).all<Record<string, any>>()).results || []).map(termsOf);
  const children = new Set(input.child_licence_uids);

  if (input.scope_type === 'master_franchise') {
    // A master may span countries others operate in only when it lists them as its children.
    const rivals = held.filter((h) => !children.has(String(h.uid)));
    if (rivals.length) problems.push(`${rivals.map((h) => `${h.country_code} is operated by ${h.licence_ref}`).join('; ')}, which this master franchise does not list as a child. List it as a child licence, or leave the country out.`);
    for (const kid of input.child_licence_uids) {
      if (kid === licence.uid) { problems.push('A master franchise cannot list itself as its child.'); continue; }
      const row = await env.DB.prepare('SELECT id, licence_ref, status FROM territory_licences WHERE uid = ?').bind(kid).first<{ id: number; licence_ref: string; status: string }>();
      if (!row) { problems.push(`No licence ${kid} exists to list as a child.`); continue; }
      const kidTerritory = await territoryOf(env, row.id);
      const beyond = kidTerritory.filter((c) => !reach.includes(c));
      if (beyond.length) problems.push(`${row.licence_ref} operates in ${beyond.join(', ')}, outside this master franchise.`);
      const otherMaster = live.find((t) => t.scope_type === 'master_franchise' && t.child_licence_uids.includes(kid));
      if (otherMaster) problems.push(`${row.licence_ref} is already a child of another master franchise.`);
    }
  } else {
    // An operating licence's exclusivity lies inside its own operating territory.
    const outside = reach.filter((c) => !own.includes(c));
    if (input.scope_type !== 'non_exclusive' && outside.length) problems.push(`${outside.join(', ')} ${outside.length > 1 ? 'are' : 'is'} outside this licence's operating territory (${own.join(', ') || 'none'}).`);
  }

  if (input.parent_licence_uid) {
    const parentScope = live.find((t) => t.licence_uid === input.parent_licence_uid) ?? null;
    if (!parentScope || parentScope.scope_type !== 'master_franchise') problems.push('The parent licence holds no master franchise in force.');
    else if (!parentScope.child_licence_uids.includes(licence.uid)) problems.push('The master franchise does not list this licence as its child. Add it to the master first.');
    else {
      const parentReach = countriesOfScope(parentScope.territory, regions);
      const mine = reach.length ? reach : own;
      const beyond = mine.filter((c) => !parentReach.includes(c));
      if (beyond.length) problems.push(`${beyond.join(', ')} ${beyond.length > 1 ? 'are' : 'is'} outside the master franchise's territory.`);
    }
  }

  if (input.scope_type !== 'non_exclusive') {
    for (const other of live) {
      if (other.scope_type === 'non_exclusive') continue;
      // A child inside its master, or a master over its child, is one structure, not a clash.
      if (other.licence_uid === input.parent_licence_uid || other.parent_licence_uid === licence.uid
        || children.has(other.licence_uid) || other.child_licence_uids.includes(licence.uid)) continue;
      const clash = scopesClash(input.territory, other.territory, regions);
      if (clash.length) {
        const ref = await env.DB.prepare('SELECT licence_ref FROM territory_licences WHERE uid = ?').bind(other.licence_uid).first<{ licence_ref: string }>();
        problems.push(`${clash.join(', ')} ${clash.length > 1 ? 'are' : 'is'} already exclusive to ${ref?.licence_ref ?? 'another licence'} (${other.scope_type.replace(/_/g, ' ')}).`);
      }
    }
  }
  return problems;
}

// ── Writing a version ────────────────────────────────────────────────────────

function insertStatement(env: Env, uid: string, licenceUid: string, revision: number, t: TermsInput & { cure_until?: string | null }, actor: string, now: string) {
  return env.DB.prepare(
    `INSERT INTO licence_exclusivity_terms (uid, licence_uid, revision, scope_type, territory_json, parent_licence_uid, child_licences_json, starts_on, ends_on, review_on,
       cure_period_days, cure_until, targets_json, state, contractual, reason, note, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(uid, licenceUid, revision, t.scope_type, JSON.stringify(t.territory), t.parent_licence_uid, JSON.stringify(t.child_licence_uids), t.starts_on, t.ends_on, t.review_on,
    t.cure_period_days, t.cure_until ?? null, JSON.stringify(t.targets), t.state, t.contractual ? 1 : 0, t.reason, t.note, now, actor);
}

/**
 * The statements that make `next` the licence's current version, guarded by
 * the revision the writer read (0: none yet). Extra statements run after the
 * guard, so they land only with the version.
 */
export function versionStatements(env: Env, a: { licenceUid: string; expectedRevision: number; next: TermsInput & { cure_until?: string | null }; uid: string; actor: string; now: string; extra?: D1PreparedStatement[] }): D1PreparedStatement[] {
  const decide = a.expectedRevision === 0
    ? env.DB.prepare(
      `INSERT INTO licence_exclusivity_terms (uid, licence_uid, revision, scope_type, territory_json, parent_licence_uid, child_licences_json, starts_on, ends_on, review_on,
         cure_period_days, cure_until, targets_json, state, contractual, reason, note, created_at, created_by)
       SELECT ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM licence_exclusivity_terms WHERE licence_uid = ?)`,
    ).bind(a.uid, a.licenceUid, a.next.scope_type, JSON.stringify(a.next.territory), a.next.parent_licence_uid, JSON.stringify(a.next.child_licence_uids), a.next.starts_on, a.next.ends_on, a.next.review_on,
      a.next.cure_period_days, a.next.cure_until ?? null, JSON.stringify(a.next.targets), a.next.state, a.next.contractual ? 1 : 0, a.next.reason, a.next.note, a.now, a.actor, a.licenceUid)
    : env.DB.prepare('UPDATE licence_exclusivity_terms SET superseded_at = ? WHERE licence_uid = ? AND superseded_at IS NULL AND revision = ?')
      .bind(a.now, a.licenceUid, a.expectedRevision);
  return [
    decide,
    decisionGuard(env),
    ...(a.expectedRevision === 0 ? [] : [insertStatement(env, a.uid, a.licenceUid, a.expectedRevision + 1, a.next, a.actor, a.now)]),
    ...(a.extra || []),
    clearGuard(env),
  ];
}

export async function writeVersion(env: Env, a: Parameters<typeof versionStatements>[1]): Promise<Terms> {
  const run = await runDecision(env, versionStatements(env, a));
  if (run.lost) throw new ExclusivityError(409, 'exclusivity_conflict', 'This licence\'s exclusivity changed since you opened it, so nothing was saved. Reload it.');
  return (await currentTerms(env, a.licenceUid)) as Terms;
}

// ── Observations and progress ────────────────────────────────────────────────

export type Observation = { uid: string; metric: Metric; period_start: string; period_end: string; value: number; source: string; note: string | null; supersedes_uid: string | null; recorded_at: string; recorded_by: string };

export async function observationsFor(env: Env, licenceUid: string): Promise<Observation[]> {
  const r = await env.DB.prepare('SELECT * FROM licence_performance_observations WHERE licence_uid = ? ORDER BY recorded_at, rowid').bind(licenceUid).all<Record<string, any>>();
  return (r.results || []).map((x) => ({
    uid: String(x.uid), metric: x.metric, period_start: String(x.period_start), period_end: String(x.period_end), value: Number(x.value),
    source: String(x.source), note: x.note ?? null, supersedes_uid: x.supersedes_uid ?? null, recorded_at: String(x.recorded_at), recorded_by: String(x.recorded_by),
  }));
}

export type TargetProgress = {
  year: number; period_start: string; period_end: string;
  metrics: Array<{ metric: Metric; target: number; measured: number | null; met: boolean | null }>;
  status: 'no_target' | 'not_recorded' | 'in_progress' | 'met' | 'missed';
};

/** Each year's targets against what was observed in its period. Pure. An unmeasured target is not recorded, never 0 and never missed. */
export function progressOf(targets: Target[], observations: Observation[], today: string): TargetProgress[] {
  const replaced = new Set(observations.map((o) => o.supersedes_uid).filter(Boolean) as string[]);
  const live = observations.filter((o) => !replaced.has(o.uid));
  return targets.map((t) => {
    const metrics = METRICS.flatMap((m) => {
      const target = (t as any)[TARGET_OF[m]] as number | null;
      if (target === null || target === undefined) return [];
      const inside = live.filter((o) => o.metric === m && o.period_start >= t.period_start && o.period_end <= t.period_end);
      const measured = inside.length ? inside.reduce((a, o) => a + o.value, 0) : null;
      return [{ metric: m, target, measured, met: measured === null ? null : measured >= target }];
    });
    const ended = t.period_end < today;
    let status: TargetProgress['status'];
    if (!metrics.length) status = 'no_target';
    else if (metrics.some((x) => x.measured === null)) status = metrics.every((x) => x.measured === null) ? 'not_recorded' : (ended && metrics.some((x) => x.met === false) ? 'missed' : 'in_progress');
    else if (metrics.every((x) => x.met)) status = 'met';
    else status = ended ? 'missed' : 'in_progress';
    return { year: t.year, period_start: t.period_start, period_end: t.period_end, metrics, status };
  });
}

// ── Reviews ──────────────────────────────────────────────────────────────────

export type Review = {
  uid: string; licence_uid: string; terms_uid: string; trigger: string; trigger_detail: Record<string, unknown>; state: 'open' | 'resolved';
  action: Action | null; resolution_reason: string | null; consequence: string | null; resulting_terms_uid: string | null; revision: number;
  opened_at: string; opened_by: string; resolved_at: string | null; resolved_by: string | null;
};
const reviewOf = (r: Record<string, any>): Review => ({
  uid: String(r.uid), licence_uid: String(r.licence_uid), terms_uid: String(r.terms_uid), trigger: String(r.trigger), trigger_detail: parse(r.trigger_detail_json, {}),
  state: r.state, action: r.action ?? null, resolution_reason: r.resolution_reason ?? null, consequence: r.consequence ?? null,
  resulting_terms_uid: r.resulting_terms_uid ?? null, revision: Number(r.revision), opened_at: String(r.opened_at), opened_by: String(r.opened_by),
  resolved_at: r.resolved_at ?? null, resolved_by: r.resolved_by ?? null,
});

export async function reviewsFor(env: Env, licenceUid: string): Promise<Review[]> {
  const r = await env.DB.prepare('SELECT * FROM licence_exclusivity_reviews WHERE licence_uid = ? ORDER BY opened_at DESC, rowid DESC').bind(licenceUid).all<Record<string, any>>();
  return (r.results || []).map(reviewOf);
}

export async function getReview(env: Env, uid: string): Promise<Review | null> {
  const r = await env.DB.prepare('SELECT * FROM licence_exclusivity_reviews WHERE uid = ?').bind(uid).first<Record<string, any>>();
  return r ? reviewOf(r) : null;
}

/** The statement that opens a review on the version a batch is writing (or the current one). */
export function openReviewStatement(env: Env, a: { uid: string; licenceUid: string; termsUid: string; trigger: 'target_missed' | 'review_date' | 'hq'; detail: Record<string, unknown>; actor: string; now: string }) {
  return env.DB.prepare(
    `INSERT INTO licence_exclusivity_reviews (uid, licence_uid, terms_uid, trigger, trigger_detail_json, opened_at, opened_by)
     SELECT ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM licence_exclusivity_reviews WHERE licence_uid = ? AND state = 'open')`,
  ).bind(a.uid, a.licenceUid, a.termsUid, a.trigger, JSON.stringify(a.detail), a.now, a.actor, a.licenceUid);
}

const addDays = (day: string, n: number) => { const t = new Date(`${day}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

export type ActionParams = { territory?: Territory; cure_period_days?: number | null };

/**
 * What an action would do, said in a sentence, and the version it would write.
 * Pure. Nothing is written by a preview; the resolve writes exactly `next`.
 */
export function previewAction(cur: Terms, action: Action, params: ActionParams, today: string, regions: Region[]):
  { ok: true; consequence: string; next: TermsInput & { cure_until: string | null } } | { ok: false; code: string; sentence: string } {
  const base: TermsInput & { cure_until: string | null } = {
    scope_type: cur.scope_type, territory: cur.territory, parent_licence_uid: cur.parent_licence_uid, child_licence_uids: cur.child_licence_uids, starts_on: cur.starts_on, ends_on: cur.ends_on,
    review_on: cur.review_on, cure_period_days: cur.cure_period_days, targets: cur.targets, state: cur.state, contractual: cur.contractual,
    reason: cur.reason, note: cur.note, cure_until: cur.cure_until,
  };
  const where = countriesOfScope(cur.territory, regions).join(', ') || 'no named territory';
  const agreement = cur.contractual ? ' The agreement states this exclusivity, so it will no longer match until a replacement is signed; the executed agreement is not edited.' : '';
  switch (action) {
    case 'continue':
      return { ok: true, consequence: `Exclusivity over ${where} continues in force as it stands. The missed target stays on record.`, next: { ...base, state: 'in_force', cure_until: null } };
    case 'cure_period': {
      const days = params.cure_period_days ?? cur.cure_period_days;
      if (days === null || days === undefined || days < 1) return { ok: false, code: 'cure_days_required', sentence: 'Give the cure period in days: this exclusivity records none.' };
      const until = addDays(today, days);
      return { ok: true, consequence: `Exclusivity over ${where} stays, at risk, until ${until} (${days} days) for the licensee to catch up. HQ reviews again then; nothing ends by itself.`, next: { ...base, state: 'at_risk', cure_period_days: days, cure_until: until } };
    }
    case 'reduce_territory': {
      const t = params.territory;
      if (!t) return { ok: false, code: 'territory_required', sentence: 'Name the reduced territory.' };
      const before = countriesOfScope(cur.territory, regions);
      const after = countriesOfScope(t, regions);
      const wider = after.filter((c) => !before.includes(c));
      const sameOrWider = t.countries.every((c) => cur.territory.countries.includes(c)) && t.regions.every((r) => cur.territory.regions.includes(r)) && t.countries.length + t.regions.length >= cur.territory.countries.length + cur.territory.regions.length;
      if (wider.length || sameOrWider) return { ok: false, code: 'not_a_reduction', sentence: 'A reduction keeps part of the current territory and adds nothing to it.' };
      if (!t.countries.length && !t.regions.length) return { ok: false, code: 'not_a_reduction', sentence: 'To keep no exclusive territory, end exclusivity or convert it to non-exclusive.' };
      const released = before.filter((c) => !after.includes(c));
      const scope: ScopeType = cur.scope_type === 'country_exclusive' && t.regions.length ? 'regional_exclusive' : cur.scope_type;
      return { ok: true, consequence: `Exclusivity narrows from ${where} to ${after.join(', ')}${t.regions.length ? ` (${t.regions.join(', ')})` : ''}.${released.length ? ` ${released.join(', ')} ${released.length > 1 ? 'are' : 'is'} no longer exclusive to this licence; its operating licence there is unchanged.` : ''}${agreement}`, next: { ...base, scope_type: scope, territory: t, state: 'in_force', cure_until: null } };
    }
    case 'convert_non_exclusive':
      return { ok: true, consequence: `The licence keeps operating over its territory, but ${where} is no longer exclusive to it: HQ may license others there. The operating fee is unchanged.${agreement}`, next: { ...base, scope_type: 'non_exclusive', child_licence_uids: [], state: 'released', cure_until: null } };
    case 'end_exclusivity':
      return { ok: true, consequence: `Exclusivity over ${where} ends today (${today}). The operating licence and its fee are unchanged.${agreement}`, next: { ...base, state: 'ended', ends_on: today, cure_until: null } };
  }
}
