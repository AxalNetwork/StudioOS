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
 *
 * D7748 (#7748): EVERY SOURCED STATEMENT. The fields read the statements
 * `readFundStatements` (D7743) serves, in its order, once per request: each
 * of the four keys keeps `status`, `value` and `provenance` and, when any
 * source states it, gains `statements`, `past_statements`, `tied` and `old`;
 * eight more keys (`STATEMENT_FIELDS`) carry their statements. `value` is
 * filled only when one statement leads and has main's form. A failed
 * statement read makes every field Unavailable; the row is still served.
 */
import type { Env } from '../types';
import { directoryColumns, presentFund, type DirectoryRow, type FundSourceRow } from './researchFundDirectory';
import { isMoneyFact, readFundStatements, type FundStatement, type FundStatements } from './researchFundObservations';

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
        // D7744: the directory's column list (with each row's size currency), a literal of researchFundDirectory.ts.
        `SELECT ${directoryColumns('d')}
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
      `SELECT period, report_date, fund_size_cents, fund_size_currency, source_url, vehicle_label
         FROM research_fund_directory_reports WHERE fund_uid = ? ORDER BY report_date ASC, period ASC`,
    ).bind(row.uid).all<{ period: string; report_date: string | null; fund_size_cents: number | null; fund_size_currency: string | null; source_url: string; vehicle_label: string | null }>();
    let unlabelled = 0;
    for (const x of r.results || []) {
      if (!label(x.vehicle_label)) { unlabelled += 1; continue; }
      if (!mine || label(x.vehicle_label) !== mine) continue;
      if (observations.some((o) => o.reported_on === x.report_date && o.fund_size_cents === x.fund_size_cents)) continue;
      // D7744: a report row shows its own currency, not the fund row's.
      const p = presentFund({ ...row, fund_size_cents: x.fund_size_cents, fund_size_currency: x.fund_size_currency });
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

// ---------------------------------------------------------------------------
// D7748: statements per field.
// ---------------------------------------------------------------------------

/** D7748: the fields served with their statements beside the four above. Fixed: nothing outside it is answered. */
export const STATEMENT_FIELDS = [
  'stated_fund_capital', 'manager_aum', 'revenue_threshold', 'traction_requirement',
  'lead_preference', 'interests', 'description', 'date_last_raised',
] as const;
export type StatementField = typeof STATEMENT_FIELDS[number];

/** Why each statement field reads Not recorded when no served source states it. */
export const STATEMENT_REASONS: Readonly<Record<StatementField, string>> = {
  stated_fund_capital: 'No source states the capital of this fund. The reported size is the list’s own figure.',
  manager_aum: 'No source states the assets this manager has under management.',
  revenue_threshold: 'No source states a revenue threshold for this vehicle.',
  traction_requirement: 'No source states a traction requirement for this vehicle.',
  lead_preference: 'No source states whether this vehicle leads rounds.',
  interests: 'No source states the interests of this vehicle.',
  description: 'No source whose terms allow republishing describes this vehicle.',
  date_last_raised: 'No source states when this manager last raised.',
};

/** Why a field with only earlier statements reads Not recorded: a past statement is never the current one. */
export const PAST_ONLY_REASON = 'Every statement a source made about this is marked as history; none is current.';

/** D7748 (#7738 Q6 A, D7032-p3): a statement is Old once its own reported date is older than this. */
export const OLD_AFTER_MONTHS = 24;

/** The cheque currencies main's profile prints (migration 202611180053_7167's CHECK). */
const PRINTABLE_CURRENCIES: ReadonlySet<string> = new Set(['EUR', 'USD', 'GBP']);
const RANGE_QUALIFIERS: ReadonlySet<string> = new Set(['range', 'lower_bound', 'upper_bound']);

/** The day `months` before `today`, as YYYY-MM-DD (UTC). */
export function oldCutoff(today: Date, months = OLD_AFTER_MONTHS): string {
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - months, today.getUTCDate())).toISOString().slice(0, 10);
}

/** A reported date as the last day it can mean ("2023" is 2023-12-31), or null when it is not a date. */
function lastDayOf(v: string | null): string | null {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/.exec(String(v ?? '').trim());
  if (!m) return null;
  if (m[3]) return `${m[1]}-${m[2]}-${m[3]}`;
  if (m[2]) return new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).toISOString().slice(0, 10);
  return `${m[1]}-12-31`;
}

/** Old (true), not old (false) or undated (null), by the statement's own reported date. */
export const isOld = (reportedOn: string | null, cutoff: string): boolean | null => {
  const day = lastDayOf(reportedOn);
  return day == null ? null : day < cutoff;
};

export interface ServedStatement {
  wording: string | null;
  qualifier?: string | null;
  min_cents?: number;
  max_cents?: number;
  point_cents?: number;
  currency?: string | null;
  currency_basis?: string | null;
  currency_verified?: boolean;
  review_flags?: string[] | null;
  terms: FundStatement['terms'];
  period_start?: string | null;
  period_end?: string | null;
  old: boolean | null;
  provenance: FundProvenance;
}

/** One statement as the API shows it: named keys only, amounts only where the wording gave them. */
export function presentStatement(s: FundStatement, reviews: Map<string, FundSourceRow>, cutoff: string): ServedStatement {
  const out: ServedStatement = {
    wording: s.wording, terms: s.terms, old: isOld(s.reported_on, cutoff),
    provenance: provenanceOf(s.source_name, s.source_url, s.reported_on, s.imported_on, reviews.get(s.source_name)),
  };
  if (isMoneyFact(s.fact)) {
    out.qualifier = s.qualifier;
    if (s.min_cents != null) out.min_cents = s.min_cents;
    if (s.max_cents != null) out.max_cents = s.max_cents;
    if (s.point_cents != null) out.point_cents = s.point_cents;
    out.currency = s.currency;
    out.currency_basis = s.currency_basis;
    out.currency_verified = s.currency != null;
    out.review_flags = s.review_flags;
  }
  if (s.period_start != null || s.period_end != null) {
    out.period_start = s.period_start;
    out.period_end = s.period_end;
  }
  return out;
}

const sameStatement = (a: FundStatement, b: FundStatement) =>
  String(a.wording ?? '').trim().toLowerCase() === String(b.wording ?? '').trim().toLowerCase()
  && a.qualifier === b.qualifier && a.min_cents === b.min_cents && a.max_cents === b.max_cents
  && a.point_cents === b.point_cents && a.currency === b.currency;

/** The first two current statements share a reported date (or neither has one) and differ: neither leads. */
export const isTied = (current: FundStatement[]) =>
  current.length >= 2 && current[0].reported_on === current[1].reported_on && !sameStatement(current[0], current[1]);

type MainValue = string | { min_cents: number | null; max_cents: number | null; currency: string };

/** The leading statement's value in main's form, or null: text, or a cheque range in a printable currency. */
export function mainForm(field: ProposedField, s: FundStatement): MainValue | null {
  if (field !== 'initial_cheque') return text(s.wording);
  if (!s.currency || !PRINTABLE_CURRENCIES.has(s.currency) || !RANGE_QUALIFIERS.has(String(s.qualifier))) return null;
  if (s.min_cents == null && s.max_cents == null) return null;
  return { min_cents: s.min_cents, max_cents: s.max_cents, currency: s.currency };
}

/** The vehicle-fact rows among a fund's statements, as `loadVehicleFacts` returns them (D7167's form). */
export function factsOf(st: FundStatements | undefined): Map<ProposedField, FactRow> {
  const out = new Map<ProposedField, FactRow>();
  for (const s of st?.current ?? []) {
    if (s.origin !== 'vehicle_fact' || !(PROPOSED_FIELDS as readonly string[]).includes(s.fact)) continue;
    const field = s.fact as ProposedField;
    out.set(field, {
      fund_uid: s.fund_uid, field, value_text: field === 'initial_cheque' ? null : s.wording,
      min_cents: s.min_cents, max_cents: s.max_cents, currency: s.currency,
      source_name: s.source_name, source_url: s.source_url, reported_on: s.reported_on, imported_on: s.imported_on ?? '',
    });
  }
  return out;
}

export interface FieldStatements { current: FundStatement[]; past: FundStatement[] }

/** A fund's statements for one field. */
export const fieldStatements = (st: FundStatements | null | undefined, field: string): FieldStatements => ({
  current: (st?.current ?? []).filter((s) => s.fact === field),
  past: (st?.past ?? []).filter((s) => s.fact === field),
});

/** The parts every field with statements carries: current and past apart, `tied`, and the leading line's Old flag. */
export function statementParts(fs: FieldStatements, reviews: Map<string, FundSourceRow>, cutoff: string) {
  return {
    statements: fs.current.map((s) => presentStatement(s, reviews, cutoff)),
    past_statements: fs.past.map((s) => presentStatement(s, reviews, cutoff)),
    tied: isTied(fs.current),
    old: fs.current.length ? isOld(fs.current[0].reported_on, cutoff) : null,
  };
}

/** The statement that leads a field: the first current one, unless the first two are tied. */
export const leadOf = (fs: FieldStatements): FundStatement | null => (fs.current.length && !isTied(fs.current) ? fs.current[0] : null);

/**
 * One of the four proposed fields with its statements. With none at all it is
 * main's answer exactly. `manager_name` keeps main's status, value and
 * provenance (one string from research_fund_vehicle_facts); the others are
 * recorded when a current statement exists, with `value` only when one leads
 * in main's form.
 */
export function presentProposedField(
  field: ProposedField, fs: FieldStatements, facts: Map<ProposedField, FactRow>, reviews: Map<string, FundSourceRow>, cutoff: string,
): Record<string, unknown> {
  const main = presentFact(field, facts.get(field), reviews);
  if (!fs.current.length && !fs.past.length) return main;
  const parts = statementParts(fs, reviews, cutoff);
  if (field === 'manager_name') return { ...main, ...parts };
  if (!fs.current.length) return { status: 'not_recorded', reason: PAST_ONLY_REASON, ...parts };
  const lead = leadOf(fs);
  return {
    status: 'recorded',
    value: lead ? mainForm(field, lead) : null,
    provenance: lead ? provenanceOf(lead.source_name, lead.source_url, lead.reported_on, lead.imported_on, reviews.get(lead.source_name)) : null,
    ...parts,
  };
}

/** One of the eight statement fields: recorded with its statements, or Not recorded with its own reason. */
export function presentStatementField(field: StatementField, fs: FieldStatements, reviews: Map<string, FundSourceRow>, cutoff: string) {
  const status = fs.current.length
    ? { status: 'recorded' as const }
    : { status: 'not_recorded' as const, reason: fs.past.length ? PAST_ONLY_REASON : STATEMENT_REASONS[field] };
  return { ...status, ...statementParts(fs, reviews, cutoff) };
}

/** Every field a fund's statements answer; `null` statements (a failed read) make each one Unavailable. */
export function presentStatementFields(st: FundStatements | null, reviews: Map<string, FundSourceRow>, today: Date) {
  const unavailable = { status: 'unavailable' as const, reason: UNAVAILABLE };
  const cutoff = oldCutoff(today);
  const facts = st ? factsOf(st) : new Map<ProposedField, FactRow>();
  return {
    ...Object.fromEntries(PROPOSED_FIELDS.map((k) => [k, st ? presentProposedField(k, fieldStatements(st, k), facts, reviews, cutoff) : unavailable])),
    ...Object.fromEntries(STATEMENT_FIELDS.map((k) => [k, st ? presentStatementField(k, fieldStatements(st, k), reviews, cutoff) : unavailable])),
  } as Record<ProposedField | StatementField, Record<string, unknown>>;
}

/**
 * What the profile read adds to a served row: its provenance, the proposed
 * fields with their statements (D7748) and the vehicle history. One statement
 * read; it failing makes those parts Unavailable, and the row's own facts are
 * still served. `today` is the Worker's date, which every Old flag is measured from.
 */
export async function fundProfile(env: Env, row: DirectoryRow, reviews: Map<string, FundSourceRow>, today: Date = new Date()) {
  let statements: FundStatements | null;
  try {
    statements = (await readFundStatements(env, [row.uid])).get(row.uid) ?? { current: [], past: [] };
  } catch {
    statements = null;
  }
  const proposed = presentStatementFields(statements, reviews, today);
  return {
    provenance: rowProvenance(row, reviews),
    proposed,
    history: await vehicleHistory(env, row, proposed.manager_name as ProposedValue, reviews),
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
