/**
 * D7714 (#7714) — does each country profile agree with its observation history?
 *
 * `country_market_profiles` holds what HQ holds today; `country_market_observations`
 * (append-only, D5016) holds how each figure got there. The supported writes
 * change both in one batch, but the database does not tie the two together, so
 * this read compares them. It WRITES NOTHING, and it never touches a snapshot.
 *
 * WHAT COUNTS AS A FINDING, per country and per field of `OBSERVED_FIELDS`,
 * against the latest history row for that field:
 *   · `value_without_history`          the profile holds a value and the field has no history row;
 *   · `differs_from_history`           the value, status, source, reference or as-of date differs
 *                                      from what the latest row says the profile should hold;
 *   · `cleared_but_history_holds_value` the field is not recorded, yet its latest row holds a value;
 *   · `history_ahead_of_profile`       the latest row names a revision above the profile's own.
 *
 * WHAT IS NOT. A seeded field with no rows and no value. A profile revision above
 * the latest row's: a details-only edit (`updateDetails`) raises the revision
 * with no history row, by design.
 *
 * WHAT "SHOULD HOLD" MEANS. A value row sets the value and its provenance. A
 * `not_recorded` status row clears both. A `provisional` status row carries the
 * value it marked and leaves the provenance as the last value row set it (unless
 * a `not_recorded` row cleared it since). A rank has no status, source or as-of
 * date on the profile (its value is all a rank write changes), so a rank is
 * compared on its value only.
 *
 * WHAT A FINDING CARRIES. The profile's side, the history's side, and how many
 * frozen pricing snapshots (D5014) hold the value at stake for that field and how
 * many pricing decisions name them, so HQ sees what a repair would sit beside.
 * Snapshots are never changed: a repair changes only future recommendations.
 */
import type { Env } from '../types';
import { listCountries, type CountryProfile } from './licencePricingStore';
import { OBSERVED_FIELDS, type ObservedField } from './licencePricingCatalogue';

export const FINDING_KINDS = ['value_without_history', 'differs_from_history', 'cleared_but_history_holds_value', 'history_ahead_of_profile'] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

type Side = { value: number | null; status: string | null; source: string | null; source_ref: string | null; as_of: string | null };
const PROVENANCE = ['value', 'status', 'source', 'source_ref', 'as_of'] as const;
type Compared = (typeof PROVENANCE)[number];

/** The profile columns each observed field lives in. A rank has a value column only. */
const COLUMNS: Record<ObservedField, { value: keyof CountryProfile; status?: keyof CountryProfile; source?: keyof CountryProfile; ref?: keyof CountryProfile; asOf?: keyof CountryProfile }> = {
  population: { value: 'population', status: 'population_status', source: 'population_source', ref: 'population_source_ref', asOf: 'population_as_of' },
  ppp_gdp_per_capita: { value: 'ppp_gdp_per_capita', status: 'ppp_status', source: 'ppp_source', ref: 'ppp_source_ref', asOf: 'ppp_as_of' },
  startup_ecosystem_score: { value: 'startup_ecosystem_score', status: 'startup_score_status', source: 'startup_source', ref: 'startup_source_ref', asOf: 'startup_as_of' },
  startup_ecosystem_rank: { value: 'startup_ecosystem_rank' },
};

export type HistoryRow = {
  uid: string; kind: 'value' | 'status'; value: number | null; status: string; source: string | null; source_ref: string | null;
  as_of: string | null; profile_revision: number; ingested_at: string;
};

export type SnapshotsHolding = {
  value: number; count: number; decisions: number;
  items: Array<{ uid: string; pricing_model_version: string; profile_revision: number; created_at: string; decisions: number }>;
};

export type Finding = {
  country_code: string; country_name: string; field: ObservedField; kind: FindingKind;
  /** Which of value, status, source, source_ref and as_of were compared (a rank: value only). */
  compared: Compared[];
  /** For `differs_from_history`: the ones that differ. */
  differences: Compared[];
  profile: Side & { revision: number };
  /** The latest history row for the field, or null when there is none. */
  history: HistoryRow | null;
  /** What that row says the profile should hold, or null when there is no row. */
  expected: Side | null;
  /** The frozen snapshots that hold the value at stake for this field; null when no value is at stake. */
  snapshots: SnapshotsHolding | null;
};

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function profileSide(p: CountryProfile, f: ObservedField): Side {
  const c = COLUMNS[f];
  const at = (k?: keyof CountryProfile) => (k ? str(p[k]) : null);
  return { value: num(p[c.value]), status: at(c.status), source: at(c.source), source_ref: at(c.ref), as_of: at(c.asOf) };
}

/**
 * The latest row for every country and field, and beside it the latest value row
 * and the latest `not_recorded` row, which a `provisional` status row needs to
 * say what provenance the profile should still hold. One literal query, no
 * parameter; the history is a few rows per field.
 */
const LATEST_SQL = `SELECT uid, country_code, field, kind, value, status, source, source_ref, as_of, ingested_at, profile_revision, rn_all, rn_kind
    FROM (SELECT o.uid, o.country_code, o.field, o.kind, o.value, o.status, o.source, o.source_ref, o.as_of, o.ingested_at, o.profile_revision,
                 ROW_NUMBER() OVER (PARTITION BY o.country_code, o.field ORDER BY o.profile_revision DESC, o.ingested_at DESC, o.uid DESC) AS rn_all,
                 ROW_NUMBER() OVER (PARTITION BY o.country_code, o.field, o.kind, CASE WHEN o.kind = 'status' THEN o.status ELSE '' END
                                    ORDER BY o.profile_revision DESC, o.ingested_at DESC, o.uid DESC) AS rn_kind
            FROM country_market_observations o)
   WHERE rn_all = 1 OR (rn_kind = 1 AND (kind = 'value' OR status = 'not_recorded'))`;

type Latest = { latest: HistoryRow | null; lastValue: HistoryRow | null; lastCleared: HistoryRow | null };

function rowOf(r: Record<string, any>): HistoryRow {
  return {
    uid: String(r.uid), kind: r.kind === 'status' ? 'status' : 'value', value: num(r.value), status: String(r.status),
    source: str(r.source), source_ref: str(r.source_ref), as_of: str(r.as_of),
    profile_revision: Number(r.profile_revision), ingested_at: String(r.ingested_at),
  };
}

async function latestRows(env: Env): Promise<Map<string, Latest>> {
  const res = await env.DB.prepare(LATEST_SQL).all<Record<string, any>>();
  const out = new Map<string, Latest>();
  for (const r of res.results || []) {
    const key = `${r.country_code}:${r.field}`;
    const slot = out.get(key) ?? { latest: null, lastValue: null, lastCleared: null };
    const row = rowOf(r);
    if (Number(r.rn_all) === 1) slot.latest = row;
    if (Number(r.rn_kind) === 1 && row.kind === 'value') slot.lastValue = row;
    if (Number(r.rn_kind) === 1 && row.kind === 'status' && row.status === 'not_recorded') slot.lastCleared = row;
    out.set(key, slot);
  }
  return out;
}

/** What the latest row says the profile should hold for the field. */
function expectedFrom(l: Latest): Side | null {
  const { latest, lastValue, lastCleared } = l;
  if (!latest) return null;
  if (latest.kind === 'value') return { value: latest.value, status: latest.status, source: latest.source, source_ref: latest.source_ref, as_of: latest.as_of };
  if (latest.status === 'not_recorded') return { value: null, status: 'not_recorded', source: null, source_ref: null, as_of: null };
  // `provisional`: the value it marked, and the provenance of the last value row not cleared since.
  const prov = lastValue && !(lastCleared && lastCleared.profile_revision > lastValue.profile_revision) ? lastValue : null;
  return { value: latest.value, status: latest.status, source: prov?.source ?? null, source_ref: prov?.source_ref ?? null, as_of: prov?.as_of ?? null };
}

/** The findings for one profile field; pure, so the rules are testable without a database. */
export function compareField(p: CountryProfile, field: ObservedField, l: Latest | undefined): Array<Omit<Finding, 'snapshots'>> {
  const compared: Compared[] = field === 'startup_ecosystem_rank' ? ['value'] : [...PROVENANCE];
  const profile = profileSide(p, field);
  const latest = l?.latest ?? null;
  const expected = l ? expectedFrom(l) : null;
  const base = {
    country_code: p.country_code, country_name: p.country_name, field, compared,
    profile: { ...profile, revision: p.revision }, history: latest, expected,
  };
  const out: Array<Omit<Finding, 'snapshots'>> = [];
  if (!latest || !expected) {
    if (profile.value !== null) out.push({ ...base, kind: 'value_without_history', differences: [] });
    return out;
  }
  if (profile.value === null && expected.value !== null) {
    out.push({ ...base, kind: 'cleared_but_history_holds_value', differences: ['value'] });
  } else {
    const differences = compared.filter((k) => profile[k] !== expected[k]);
    if (differences.length) out.push({ ...base, kind: 'differs_from_history', differences });
  }
  if (latest.profile_revision > p.revision) out.push({ ...base, kind: 'history_ahead_of_profile', differences: [] });
  return out;
}

const SNAPSHOT_ITEMS_SQL = `SELECT s.uid, s.pricing_model_version, s.profile_revision, s.created_at,
         (SELECT COUNT(*) FROM licence_pricing_decisions d WHERE d.snapshot_uid = s.uid) AS decisions
    FROM country_pricing_snapshots s
   WHERE s.country_code = ?1
     AND (CASE ?2 WHEN 'population' THEN s.population WHEN 'ppp_gdp_per_capita' THEN s.ppp_gdp_per_capita
                  WHEN 'startup_ecosystem_score' THEN s.startup_ecosystem_score WHEN 'startup_ecosystem_rank' THEN s.startup_ecosystem_rank END) = ?3
   ORDER BY s.created_at DESC, s.uid DESC LIMIT 50`;
const SNAPSHOT_TOTALS_SQL = `SELECT COUNT(*) AS n,
         (SELECT COUNT(*) FROM licence_pricing_decisions d JOIN country_pricing_snapshots s2 ON s2.uid = d.snapshot_uid
           WHERE s2.country_code = ?1
             AND (CASE ?2 WHEN 'population' THEN s2.population WHEN 'ppp_gdp_per_capita' THEN s2.ppp_gdp_per_capita
                          WHEN 'startup_ecosystem_score' THEN s2.startup_ecosystem_score WHEN 'startup_ecosystem_rank' THEN s2.startup_ecosystem_rank END) = ?3) AS decisions
    FROM country_pricing_snapshots s
   WHERE s.country_code = ?1
     AND (CASE ?2 WHEN 'population' THEN s.population WHEN 'ppp_gdp_per_capita' THEN s.ppp_gdp_per_capita
                  WHEN 'startup_ecosystem_score' THEN s.startup_ecosystem_score WHEN 'startup_ecosystem_rank' THEN s.startup_ecosystem_rank END) = ?3`;

/** The value a finding is about: the profile's, or, where the profile holds none, the history's. */
const valueAtStake = (f: Omit<Finding, 'snapshots'>): number | null => f.profile.value ?? f.expected?.value ?? null;

/** Every country, every observed field: the findings, and how much was checked. Reads only. */
export async function catalogueConsistency(env: Env) {
  const [profiles, latest] = await Promise.all([listCountries(env), latestRows(env)]);
  const bare = profiles.flatMap((p) => OBSERVED_FIELDS.flatMap((f) => compareField(p, f, latest.get(`${p.country_code}:${f}`))));
  const findings: Finding[] = await Promise.all(bare.map(async (f) => {
    const v = valueAtStake(f);
    if (v === null) return { ...f, snapshots: null };
    const [items, totals] = await Promise.all([
      env.DB.prepare(SNAPSHOT_ITEMS_SQL).bind(f.country_code, f.field, v).all<Record<string, any>>(),
      env.DB.prepare(SNAPSHOT_TOTALS_SQL).bind(f.country_code, f.field, v).first<Record<string, any>>(),
    ]);
    return {
      ...f,
      snapshots: {
        value: v, count: Number(totals?.n ?? 0), decisions: Number(totals?.decisions ?? 0),
        items: (items.results || []).map((s) => ({
          uid: String(s.uid), pricing_model_version: String(s.pricing_model_version), profile_revision: Number(s.profile_revision),
          created_at: String(s.created_at), decisions: Number(s.decisions),
        })),
      },
    };
  }));
  const counts = Object.fromEntries(FINDING_KINDS.map((k) => [k, findings.filter((f) => f.kind === k).length])) as Record<FindingKind, number>;
  return {
    checked: { countries: profiles.length, fields_per_country: OBSERVED_FIELDS.length, fields: profiles.length * OBSERVED_FIELDS.length, field_names: [...OBSERVED_FIELDS] },
    findings, total: findings.length, counts, stored: false,
  };
}
