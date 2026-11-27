/**
 * D5016 (#5016) — maintaining the country market catalogue: sourced
 * observations, field status changes, profile details and a bulk import, each
 * revision-checked and recorded in `country_market_observations` (append-only).
 *
 * PROVENANCE. A value observation needs a source, an as-of date and a reason;
 * the database refuses one without them. A field can be marked `provisional`
 * (it keeps its value, and the engine uses it only when HQ allows it) or
 * `not_recorded` (its value and source are cleared). Neither is inferred: each
 * is a Super Admin's act with a reason.
 *
 * REVISION-SAFE. Every write names the profile revision it read. The UPDATE
 * matches on it, and the observation row is written only if that UPDATE changed
 * the profile (`changes() > 0`, in the same batch). A stale write changes
 * nothing and answers 409 with the current revision.
 *
 * FUTURE ONLY. A profile change never touches a snapshot (append-only) or a
 * licence term: it changes the next recommendation, nothing already recorded.
 */
import type { Env } from '../types';
import { PricingError, REGULATORY_CLASSES, countryCodeOf, getCountry, type CountryProfile, type RegulatoryClass } from './licencePricingStore';

export const OBSERVED_FIELDS = ['population', 'ppp_gdp_per_capita', 'startup_ecosystem_score', 'startup_ecosystem_rank'] as const;
export type ObservedField = (typeof OBSERVED_FIELDS)[number];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type ObservationInput = {
  country_code: string;
  field: ObservedField;
  value: number;
  status: 'recorded' | 'provisional';
  source: string;
  source_ref: string | null;
  as_of: string;
};

const trimmed = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

/** One observation, validated; the problems keyed by field. */
export function validateObservation(raw: unknown): { ok: true; value: ObservationInput } | { ok: false; errors: Record<string, string> } {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const code = countryCodeOf(b.country_code);
  if (!code) errors.country_code = 'country_code must be an ISO 3166-1 alpha-2 code';
  const field = b.field as ObservedField;
  if (!(OBSERVED_FIELDS as readonly string[]).includes(String(b.field))) errors.field = `field must be one of ${OBSERVED_FIELDS.join(', ')}`;
  const value = b.value;
  if (typeof value !== 'number' || !Number.isInteger(value)) errors.value = 'value must be an integer (PPP in whole international dollars, the startup score in thousandths of a point)';
  else if (field === 'startup_ecosystem_score' ? value < 0 : value <= 0) errors.value = field === 'startup_ecosystem_score' ? 'a score cannot be negative' : 'value must be positive';
  const status = b.status === undefined ? 'recorded' : b.status;
  if (status !== 'recorded' && status !== 'provisional') errors.status = 'status must be recorded or provisional (use the status route to clear a field)';
  if (field === 'startup_ecosystem_rank' && status === 'provisional') errors.status = 'a rank is recorded or not; there is no provisional rank';
  const source = trimmed(b.source, 200);
  if (!source) errors.source = 'every observation names its source';
  const as_of = trimmed(b.as_of, 10);
  if (!as_of || !DATE.test(as_of) || Number.isNaN(Date.parse(`${as_of}T00:00:00Z`))) errors.as_of = 'as_of must be the YYYY-MM-DD date the value is true as of';
  return Object.keys(errors).length ? { ok: false, errors }
    : { ok: true, value: { country_code: code!, field, value: value as number, status: status as 'recorded' | 'provisional', source: source!, source_ref: trimmed(b.source_ref, 500), as_of: as_of! } };
}

export function reasonOf(raw: unknown): string | null {
  const r = typeof raw === 'string' ? raw.trim() : '';
  return r.length >= 3 && r.length <= 500 ? r : null;
}

export function revisionOf(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : null;
}

/**
 * The profile UPDATE for one observation, as one literal statement: `?1` names
 * the field and every column takes its new value only when it is that field's.
 * Matching on `?7` (the revision read) is what makes a stale write a no-op.
 * `?11`, in an import, is the previous row's observation for the same country:
 * a row applies only if the one before it did, so a country's rows apply all
 * or none even if another write happens to land on the revision a later row expects.
 */
const OBSERVE_SQL = `UPDATE country_market_profiles SET
    population = CASE WHEN ?1 = 'population' THEN ?2 ELSE population END,
    population_status = CASE WHEN ?1 = 'population' THEN ?3 ELSE population_status END,
    population_source = CASE WHEN ?1 = 'population' THEN ?4 ELSE population_source END,
    population_source_ref = CASE WHEN ?1 = 'population' THEN ?5 ELSE population_source_ref END,
    population_as_of = CASE WHEN ?1 = 'population' THEN ?6 ELSE population_as_of END,
    ppp_gdp_per_capita = CASE WHEN ?1 = 'ppp_gdp_per_capita' THEN ?2 ELSE ppp_gdp_per_capita END,
    ppp_status = CASE WHEN ?1 = 'ppp_gdp_per_capita' THEN ?3 ELSE ppp_status END,
    ppp_source = CASE WHEN ?1 = 'ppp_gdp_per_capita' THEN ?4 ELSE ppp_source END,
    ppp_source_ref = CASE WHEN ?1 = 'ppp_gdp_per_capita' THEN ?5 ELSE ppp_source_ref END,
    ppp_as_of = CASE WHEN ?1 = 'ppp_gdp_per_capita' THEN ?6 ELSE ppp_as_of END,
    startup_ecosystem_score = CASE WHEN ?1 = 'startup_ecosystem_score' THEN ?2 ELSE startup_ecosystem_score END,
    startup_score_status = CASE WHEN ?1 = 'startup_ecosystem_score' THEN ?3 ELSE startup_score_status END,
    startup_source = CASE WHEN ?1 = 'startup_ecosystem_score' THEN ?4 ELSE startup_source END,
    startup_source_ref = CASE WHEN ?1 = 'startup_ecosystem_score' THEN ?5 ELSE startup_source_ref END,
    startup_as_of = CASE WHEN ?1 = 'startup_ecosystem_score' THEN ?6 ELSE startup_as_of END,
    startup_ecosystem_rank = CASE WHEN ?1 = 'startup_ecosystem_rank' THEN ?2 ELSE startup_ecosystem_rank END,
    revision = revision + 1, updated_at = ?8, updated_by = ?9
  WHERE country_code = ?10 AND revision = ?7
    AND (?11 IS NULL OR EXISTS (SELECT 1 FROM country_market_observations WHERE uid = ?11))`;

const OBSERVATION_INSERT = `INSERT INTO country_market_observations
    (uid, country_code, field, kind, value, status, source, source_ref, as_of, recorded_by, reason, profile_revision)
  SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0`;

function observeStatements(env: Env, o: ObservationInput, expected: number, actor: string, reason: string, at: string, uid: string, prevUid: string | null) {
  return [
    env.DB.prepare(OBSERVE_SQL).bind(o.field, o.value, o.status, o.source, o.source_ref, o.as_of, expected, at, actor, o.country_code, prevUid),
    env.DB.prepare(OBSERVATION_INSERT).bind(uid, o.country_code, o.field, 'value', o.value, o.status, o.source, o.source_ref,
      o.as_of, actor, reason, expected + 1),
  ];
}

async function conflict(env: Env, code: string): Promise<never> {
  const now = await getCountry(env, code);
  if (!now) throw new PricingError(404, 'not_found', `No market profile is recorded for ${code}.`);
  throw new PricingError(409, 'profile_conflict', `${now.country_name} changed since you read it, so nothing was saved. Reload it and apply your change again.`,
    { current_revision: now.revision });
}

/** Records one sourced observation as the field's current value. */
export async function recordObservation(env: Env, o: ObservationInput, expected: number, actor: string, reason: string): Promise<CountryProfile> {
  if (!(await getCountry(env, o.country_code))) throw new PricingError(404, 'not_found', `No market profile is recorded for ${o.country_code}.`);
  const res = await env.DB.batch(observeStatements(env, o, expected, actor, reason, new Date().toISOString(), crypto.randomUUID(), null));
  if (!res[0]?.meta?.changes) await conflict(env, o.country_code);
  return (await getCountry(env, o.country_code))!;
}

/**
 * Marks a field `provisional` (keeping its value) or `not_recorded` (clearing
 * its value and provenance). A rank has no status: it is cleared or recorded.
 */
export async function setFieldStatus(
  env: Env, code: string, field: ObservedField, status: 'provisional' | 'not_recorded', expected: number, actor: string, reason: string,
): Promise<CountryProfile> {
  const before = await getCountry(env, code);
  if (!before) throw new PricingError(404, 'not_found', `No market profile is recorded for ${code}.`);
  if (field === 'startup_ecosystem_rank' && status === 'provisional') throw new PricingError(400, 'invalid_status', 'A rank is recorded or not; there is no provisional rank.');
  if (status === 'provisional' && before[field] === null) throw new PricingError(409, 'no_value', `There is no ${field.replace(/_/g, ' ')} to mark provisional; record one with its source first.`);
  const clear = status === 'not_recorded' ? 1 : 0;
  const at = new Date().toISOString();
  const res = await env.DB.batch([
    env.DB.prepare(`UPDATE country_market_profiles SET
        population = CASE WHEN ?1 = 'population' AND ?2 = 1 THEN NULL ELSE population END,
        population_status = CASE WHEN ?1 = 'population' THEN ?3 ELSE population_status END,
        population_source = CASE WHEN ?1 = 'population' AND ?2 = 1 THEN NULL ELSE population_source END,
        population_source_ref = CASE WHEN ?1 = 'population' AND ?2 = 1 THEN NULL ELSE population_source_ref END,
        population_as_of = CASE WHEN ?1 = 'population' AND ?2 = 1 THEN NULL ELSE population_as_of END,
        ppp_gdp_per_capita = CASE WHEN ?1 = 'ppp_gdp_per_capita' AND ?2 = 1 THEN NULL ELSE ppp_gdp_per_capita END,
        ppp_status = CASE WHEN ?1 = 'ppp_gdp_per_capita' THEN ?3 ELSE ppp_status END,
        ppp_source = CASE WHEN ?1 = 'ppp_gdp_per_capita' AND ?2 = 1 THEN NULL ELSE ppp_source END,
        ppp_source_ref = CASE WHEN ?1 = 'ppp_gdp_per_capita' AND ?2 = 1 THEN NULL ELSE ppp_source_ref END,
        ppp_as_of = CASE WHEN ?1 = 'ppp_gdp_per_capita' AND ?2 = 1 THEN NULL ELSE ppp_as_of END,
        startup_ecosystem_score = CASE WHEN ?1 = 'startup_ecosystem_score' AND ?2 = 1 THEN NULL ELSE startup_ecosystem_score END,
        startup_score_status = CASE WHEN ?1 = 'startup_ecosystem_score' THEN ?3 ELSE startup_score_status END,
        startup_source = CASE WHEN ?1 = 'startup_ecosystem_score' AND ?2 = 1 THEN NULL ELSE startup_source END,
        startup_source_ref = CASE WHEN ?1 = 'startup_ecosystem_score' AND ?2 = 1 THEN NULL ELSE startup_source_ref END,
        startup_as_of = CASE WHEN ?1 = 'startup_ecosystem_score' AND ?2 = 1 THEN NULL ELSE startup_as_of END,
        startup_ecosystem_rank = CASE WHEN ?1 = 'startup_ecosystem_rank' AND ?2 = 1 THEN NULL ELSE startup_ecosystem_rank END,
        revision = revision + 1, updated_at = ?5, updated_by = ?6
      WHERE country_code = ?7 AND revision = ?4`).bind(field, clear, status, expected, at, actor, code),
    env.DB.prepare(OBSERVATION_INSERT).bind(crypto.randomUUID(), code, field, 'status', clear ? null : before[field], status,
      null, null, null, actor, reason, expected + 1),
  ]);
  if (!res[0]?.meta?.changes) await conflict(env, code);
  return (await getCountry(env, code))!;
}

export type DetailsInput = Partial<{
  country_name: string; region_code: string | null; currency_code: string | null;
  regulatory_class: RegulatoryClass | null; regulatory_note: string | null; strategic_note: string | null;
}>;

/** The details that are not external measurements, validated; only the keys sent are changed. */
export function validateDetails(raw: unknown): { ok: true; value: DetailsInput } | { ok: false; errors: Record<string, string> } {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: DetailsInput = {};
  const errors: Record<string, string> = {};
  if ('country_name' in b) { const v = trimmed(b.country_name, 120); if (!v) errors.country_name = 'a country needs a name'; else out.country_name = v; }
  if ('region_code' in b) out.region_code = b.region_code === null ? null : trimmed(b.region_code, 20);
  if ('currency_code' in b) {
    const v = b.currency_code === null ? null : trimmed(b.currency_code, 3)?.toUpperCase() ?? null;
    if (v !== null && !/^[A-Z]{3}$/.test(v)) errors.currency_code = 'currency_code must be an ISO 4217 code'; else out.currency_code = v;
  }
  if ('regulatory_class' in b) {
    const v = b.regulatory_class;
    if (v !== null && !(REGULATORY_CLASSES as readonly string[]).includes(String(v))) errors.regulatory_class = `regulatory_class must be one of ${REGULATORY_CLASSES.join(', ')}, or null`;
    else out.regulatory_class = v as RegulatoryClass | null;
  }
  if ('regulatory_note' in b) out.regulatory_note = b.regulatory_note === null ? null : trimmed(b.regulatory_note, 2000);
  if ('strategic_note' in b) out.strategic_note = b.strategic_note === null ? null : trimmed(b.strategic_note, 2000);
  if (!Object.keys(out).length && !Object.keys(errors).length) errors.body = 'nothing to change';
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: out };
}

/** Updates the profile's own details (name, region, currency, regulatory class, notes), revision-checked. */
export async function updateDetails(env: Env, code: string, d: DetailsInput, expected: number, actor: string): Promise<CountryProfile> {
  const before = await getCountry(env, code);
  if (!before) throw new PricingError(404, 'not_found', `No market profile is recorded for ${code}.`);
  const next = { ...before, ...d };
  const res = await env.DB.prepare(
    `UPDATE country_market_profiles SET country_name = ?, region_code = ?, currency_code = ?, regulatory_class = ?, regulatory_note = ?,
        strategic_note = ?, revision = revision + 1, updated_at = ?, updated_by = ?
      WHERE country_code = ? AND revision = ?`,
  ).bind(next.country_name, next.region_code, next.currency_code, next.regulatory_class, next.regulatory_note, next.strategic_note,
    new Date().toISOString(), actor, code, expected).run();
  if (!res.meta?.changes) await conflict(env, code);
  return (await getCountry(env, code))!;
}

export type ImportResult = { applied: Record<string, number>; conflicts: Array<{ country_code: string; current_revision: number | null }> };

/**
 * Imports a dataset of observations in one batch. Each country's rows apply in
 * order against the revision HQ read for it (`expected_revisions`), so a country
 * changed meanwhile applies none of its rows and is reported, while the others
 * apply. Every row is validated before anything is written, and the import is
 * capped at 500 rows.
 */
export async function importObservations(
  env: Env, rows: ObservationInput[], expected: Record<string, number>, actor: string, reason: string,
): Promise<ImportResult> {
  const codes = [...new Set(rows.map((r) => r.country_code))];
  const missingRev = codes.filter((c) => revisionOf(expected[c]) === null);
  if (missingRev.length) throw new PricingError(400, 'expected_revision_required', 'Name the revision you read for every country in the import.', { countries: missingRev });
  const at = new Date().toISOString();
  const stmts = [];
  const next: Record<string, number> = {};
  const prev: Record<string, string> = {};
  for (const r of rows) {
    const rev = next[r.country_code] ?? expected[r.country_code];
    const uid = crypto.randomUUID();
    stmts.push(...observeStatements(env, r, rev, actor, reason, at, uid, prev[r.country_code] ?? null));
    next[r.country_code] = rev + 1;
    prev[r.country_code] = uid;
  }
  const res = await env.DB.batch(stmts);
  const applied: Record<string, number> = {};
  const failed = new Set<string>();
  rows.forEach((r, i) => {
    if (res[i * 2]?.meta?.changes) applied[r.country_code] = (applied[r.country_code] ?? 0) + 1;
    else failed.add(r.country_code);
  });
  const conflicts = [];
  for (const c of failed) conflicts.push({ country_code: c, current_revision: (await getCountry(env, c))?.revision ?? null });
  return { applied, conflicts };
}

export type Observation = {
  uid: string; country_code: string; field: ObservedField; kind: 'value' | 'status'; value: number | null; status: string;
  source: string | null; source_ref: string | null; as_of: string | null; ingested_at: string; recorded_by: string;
  reason: string; profile_revision: number;
};

/** A country's observation history, newest first, optionally for one field. */
export async function observationsFor(env: Env, code: string, field: ObservedField | null): Promise<Observation[]> {
  const res = await env.DB.prepare(
    `SELECT uid, country_code, field, kind, value, status, source, source_ref, as_of, ingested_at, recorded_by, reason, profile_revision
       FROM country_market_observations WHERE country_code = ? AND (? IS NULL OR field = ?)
      ORDER BY profile_revision DESC, ingested_at DESC LIMIT 200`,
  ).bind(code, field, field).all<Record<string, any>>();
  return (res.results || []).map((r) => ({
    ...r, value: r.value === null ? null : Number(r.value), profile_revision: Number(r.profile_revision),
  } as Observation));
}
