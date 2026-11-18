/**
 * D7167 (#7167) — Research › Funds profile: one vehicle and its dated source,
 * shared by the fund read (`GET /api/research/fund-directory/:uid`) and each
 * fund cell of a project comparison.
 *
 * ONE PROVENANCE OBJECT. Every figure carries `{ publisher, list_name,
 * list_title, published_url, reported_on, imported_on, reviewed_on, verdict }`
 * built by `provenanceOf`, so the chip in the Sheet, the profile and the
 * comparison is the same object. Three dates are kept apart: `reported_on` is
 * when the list recorded the figure (the row's `fund_date`), `imported_on` is
 * when Axal VC copied the row (`as_of`), and `reviewed_on` is when the list's
 * terms were reviewed (`research_fund_sources.reviewed_on`, D597).
 *
 * FOUR PROPOSED FIELDS (migration 202611180053_7167): manager name, investment
 * stage, investment geography and initial cheque range, each with its own
 * source and dates. A field with no row reads Not recorded with its reason; a
 * row whose list was taken down for its terms is never served.
 *
 * VEHICLE HISTORY. The manager's vehicles are the served rows that record the
 * same manager name, each by the label its list gives it. The size chart reads
 * observations of this vehicle only: its own row and report rows labelled with
 * its label. An unlabelled report row (written before vehicles had labels) is
 * counted, never charted, because it may belong to another vehicle.
 */
import type { Env } from '../types';
import { presentFund, type DirectoryRow, type FundSourceRow } from './researchFundDirectory';

export const PROPOSED_FIELDS = ['manager_name', 'investment_stage', 'investment_geography', 'initial_cheque'] as const;
export type ProposedField = typeof PROPOSED_FIELDS[number];

/** Why each proposed field reads Not recorded when no source states it. */
export const PROPOSED_REASONS: Readonly<Record<ProposedField, string>> = {
  manager_name: 'No source names the manager of this vehicle.',
  investment_stage: 'The directory records no investment stage for this vehicle.',
  investment_geography: 'No source states where this vehicle invests. Headquarters is where the manager is based.',
  initial_cheque: 'No source states an initial cheque for this vehicle.',
};

export const UNAVAILABLE = 'Unavailable';

export interface FundProvenance {
  list_name: string;
  list_title: string | null;
  publisher: string | null;
  published_url: string | null;
  reported_on: string | null;
  imported_on: string | null;
  reviewed_on: string | null;
  verdict: FundSourceRow['verdict'] | null;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** The one dated provenance object for a figure read from `sourceName`. */
export function provenanceOf(
  sourceName: string, rowUrl: string | null, reportedOn: unknown, importedOn: unknown, review: FundSourceRow | undefined,
): FundProvenance {
  return {
    list_name: sourceName,
    list_title: review?.title ?? null,
    publisher: review?.publisher ?? null,
    published_url: review?.published_url ?? text(rowUrl),
    reported_on: text(reportedOn),
    imported_on: text(importedOn),
    reviewed_on: review?.reviewed_on ?? null,
    verdict: review?.verdict ?? null,
  };
}

/** A directory row's provenance: its list, the date the list reported it and the date it was imported. */
export const rowProvenance = (r: Pick<DirectoryRow, 'source_name' | 'source_url' | 'fund_date' | 'as_of'>, reviews: Map<string, FundSourceRow>) =>
  provenanceOf(r.source_name, r.source_url, r.fund_date, r.as_of, reviews.get(r.source_name));

export interface FactRow {
  fund_uid: string; field: ProposedField; value_text: string | null;
  min_cents: number | null; max_cents: number | null; currency: string | null;
  source_name: string; source_url: string | null; reported_on: string | null; imported_on: string;
}

/**
 * The proposed fields of `uids`, by uid then field. A fact read from a list
 * whose terms forbid republishing (D597) is left out, as its rows are.
 */
export async function loadVehicleFacts(env: Env, uids: string[]): Promise<Map<string, Map<ProposedField, FactRow>>> {
  const out = new Map<string, Map<ProposedField, FactRow>>();
  if (!uids.length) return out;
  const r = await env.DB.prepare(
    `SELECT v.fund_uid, v.field, v.value_text, v.min_cents, v.max_cents, v.currency,
            v.source_name, v.source_url, v.reported_on, v.imported_on
       FROM research_fund_vehicle_facts v
      WHERE v.fund_uid IN (SELECT value FROM json_each(?))
        AND NOT EXISTS (SELECT 1 FROM research_fund_sources s WHERE s.source_name = v.source_name AND s.verdict = 'not allowed')`,
  ).bind(JSON.stringify([...new Set(uids)])).all<FactRow>();
  for (const f of r.results || []) {
    if (!out.has(f.fund_uid)) out.set(f.fund_uid, new Map());
    out.get(f.fund_uid)!.set(f.field, f);
  }
  return out;
}

export type ProposedValue =
  | { status: 'recorded'; value: string | { min_cents: number | null; max_cents: number | null; currency: string }; provenance: FundProvenance }
  | { status: 'not_recorded'; reason: string }
  | { status: 'unavailable'; reason: string };

/** One proposed field as the API shows it. */
export function presentFact(field: ProposedField, f: FactRow | undefined, reviews: Map<string, FundSourceRow>): ProposedValue {
  if (!f) return { status: 'not_recorded', reason: PROPOSED_REASONS[field] };
  const provenance = provenanceOf(f.source_name, f.source_url, f.reported_on, f.imported_on, reviews.get(f.source_name));
  if (field === 'initial_cheque') {
    if (!f.currency || (f.min_cents == null && f.max_cents == null)) return { status: 'not_recorded', reason: PROPOSED_REASONS[field] };
    return { status: 'recorded', value: { min_cents: f.min_cents, max_cents: f.max_cents, currency: f.currency }, provenance };
  }
  const v = text(f.value_text);
  return v ? { status: 'recorded', value: v, provenance } : { status: 'not_recorded', reason: PROPOSED_REASONS[field] };
}

/** All four proposed fields; `null` facts (a failed read) read Unavailable, never Not recorded. */
export function presentProposed(facts: Map<ProposedField, FactRow> | null, reviews: Map<string, FundSourceRow>) {
  return Object.fromEntries(PROPOSED_FIELDS.map((k) => [k, facts === null
    ? { status: 'unavailable', reason: UNAVAILABLE }
    : presentFact(k, facts.get(k), reviews)])) as Record<ProposedField, ProposedValue>;
}

const label = (v: unknown) => String(v ?? '').trim().toLowerCase();

/**
 * The manager's vehicles and this vehicle's observations. Each part fails on
 * its own and says so (`unavailable`); neither is passed off as empty.
 */
export async function vehicleHistory(env: Env, row: DirectoryRow, manager: ProposedValue, reviews: Map<string, FundSourceRow>) {
  const own = presentFund(row);
  const history: Record<string, unknown> = {
    manager: manager.status === 'recorded' ? manager.value : null,
    vehicles_status: 'ok', vehicles: [] as unknown[],
    observations_status: 'ok', observations: [] as unknown[], unlabelled_reports: 0,
  };
  if (manager.status !== 'recorded') {
    history.vehicles_status = manager.status === 'unavailable' ? 'unavailable' : 'not_recorded';
    history.vehicles_reason = manager.status === 'unavailable'
      ? UNAVAILABLE
      : 'No source names the manager of this vehicle, so its other vehicles cannot be listed.';
  } else {
    try {
      const r = await env.DB.prepare(
        `SELECT d.uid, d.name, d.website, d.linkedin, d.hq, d.fund_number, d.fund_size_cents, d.fund_date, d.quarter, d.fund_year,
                d.sector_focus, d.notable_lps, d.eif_flag, d.eifo_flag, d.source_name, d.source_url, d.as_of
           FROM research_fund_directory d
           JOIN research_fund_vehicle_facts v ON v.fund_uid = d.uid AND v.field = 'manager_name'
          WHERE LOWER(TRIM(v.value_text)) = LOWER(TRIM(?))
            AND NOT EXISTS (SELECT 1 FROM research_fund_sources s WHERE s.verdict = 'not allowed'
                             AND (s.source_name = d.source_name OR s.source_name = v.source_name))
          ORDER BY d.fund_date IS NULL, d.fund_date DESC, d.uid
          LIMIT 50`,
      ).bind(manager.value as string).all<DirectoryRow>();
      history.vehicles = (r.results || []).map((v) => {
        const p = presentFund(v);
        return {
          uid: v.uid, name: v.name, label: text(v.fund_number), fund_year: v.fund_year,
          fund_size_cents: p.fund_size_cents, size_currency: p.size_currency,
          current: v.uid === row.uid, provenance: rowProvenance(v, reviews),
        };
      });
    } catch {
      history.vehicles_status = 'unavailable';
      history.vehicles_reason = UNAVAILABLE;
      history.vehicles = [];
    }
  }

  // This vehicle's own observation, then report rows labelled as this vehicle.
  const mine = label(row.fund_number);
  const observations: Array<Record<string, unknown>> = [];
  if (own.fund_size_cents != null && own.size_currency) {
    observations.push({ period: row.quarter, reported_on: text(row.fund_date), fund_size_cents: own.fund_size_cents, size_currency: own.size_currency, provenance: rowProvenance(row, reviews) });
  }
  try {
    const r = await env.DB.prepare(
      `SELECT period, report_date, fund_size_cents, source_url, vehicle_label
         FROM research_fund_directory_reports WHERE fund_uid = ? ORDER BY report_date ASC, period ASC`,
    ).bind(row.uid).all<{ period: string; report_date: string | null; fund_size_cents: number | null; source_url: string; vehicle_label: string | null }>();
    let unlabelled = 0;
    for (const x of r.results || []) {
      if (!label(x.vehicle_label)) { unlabelled += 1; continue; }
      if (!mine || label(x.vehicle_label) !== mine) continue;
      if (observations.some((o) => o.reported_on === x.report_date && o.fund_size_cents === x.fund_size_cents)) continue;
      const p = presentFund({ ...row, fund_size_cents: x.fund_size_cents });
      if (p.fund_size_cents == null || !p.size_currency) continue;
      observations.push({
        period: x.period, reported_on: text(x.report_date), fund_size_cents: p.fund_size_cents, size_currency: p.size_currency,
        provenance: provenanceOf(row.source_name, x.source_url, x.report_date, row.as_of, reviews.get(row.source_name)),
      });
    }
    history.unlabelled_reports = unlabelled;
  } catch {
    history.observations_status = 'unavailable';
  }
  history.observations = observations.sort((a, b) => String(a.reported_on ?? '').localeCompare(String(b.reported_on ?? '')));
  return history;
}

/**
 * What the profile read adds to a served row: its provenance, the four
 * proposed fields and the vehicle history. The facts table failing to answer
 * makes those parts Unavailable; the row's own facts are still served.
 */
export async function fundProfile(env: Env, row: DirectoryRow, reviews: Map<string, FundSourceRow>) {
  let facts: Map<ProposedField, FactRow> | null;
  try {
    facts = (await loadVehicleFacts(env, [row.uid])).get(row.uid) ?? new Map();
  } catch {
    facts = null;
  }
  const proposed = presentProposed(facts, reviews);
  return {
    provenance: rowProvenance(row, reviews),
    proposed,
    history: await vehicleHistory(env, row, proposed.manager_name, reviews),
  };
}

/**
 * D7167: is `uid` held in the directory but withheld because its list was
 * taken down (D597)? Returns that list's review, else null. Used to refuse a
 * save, an add or a compare with `source_withdrawn` rather than "not found".
 */
export async function withdrawnSourceOf(env: Env, uid: string): Promise<FundSourceRow | null> {
  return env.DB.prepare(
    `SELECT s.source_name, s.title, s.publisher, s.published_url, s.terms_status, s.terms_quote, s.evidence_url, s.evidence,
            s.verdict, s.verdict_reason, s.reviewed_on, s.repo_copy, s.repo_copy_note
       FROM research_fund_directory d JOIN research_fund_sources s ON s.source_name = d.source_name
      WHERE d.uid = ? AND s.verdict = 'not allowed'`,
  ).bind(uid).first<FundSourceRow>();
}

/** The refusal sentence for a withdrawn source (D278: written here, never raw). */
export const SOURCE_WITHDRAWN_MESSAGE = 'This fund’s source list was withdrawn, so nothing was saved or added.';
