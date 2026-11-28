/**
 * D7929 (#7929): the SEC EDGAR company financial facts importer — one registrant's own reported annual figures for a
 * few XBRL concepts, read from the EDGAR company-concept API (`data.sec.gov/api/xbrl/companyconcept`, JSON, no key),
 * each kept with its reported scope: the entity (CIK) that reported it, the accession that filed it, the taxonomy and
 * concept, the exact period, the unit and currency, the filing date and the values earlier filings gave for the same
 * fact (restatement provenance).
 *
 * A company's revenue is never a market size. Rows are stored under the registrant's own key (`geography_type`
 * `ecosystem`, code `CIK##########`), never under a country or region, so no geography, coverage or country page can
 * read one as a national or market figure. This importer shares nothing with the filings-count index connector
 * (`market_intel/sources/sec_edgar.ts`) or the ticker directory (`scripts/import-sec-edgar.mjs`).
 */
import type { Env } from '../../types';
import { reportPrivateError } from '../../util/errorPrivacy';
import { providerArchive } from './censusCbp';
import { ImportFailure, ImportRequestError, MAX_BATCH_ROWS, runObservationBatch, type ImportReport, type Observation, type PreparedBatch } from './write';

export const SOURCE_ID = 'sec-edgar-facts';
/** XBRL financial data starts with fiscal periods ending in 2009 (phase-in for the largest filers). */
export const FIRST_YEAR = 2009;
export const conceptUrl = (cik: string, taxonomy: string, concept: string) =>
  `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/${taxonomy}/${concept}.json`;

/** The concepts imported. Each is a monetary figure for an annual duration, or a balance at the period's end. */
export const EDGAR_CONCEPTS = Object.freeze({
  revenues: { taxonomy: 'us-gaap', concept: 'Revenues', period: 'duration', label: 'Revenues' },
  revenue_from_contracts: { taxonomy: 'us-gaap', concept: 'RevenueFromContractWithCustomerExcludingAssessedTax', period: 'duration',
    label: 'Revenue from contracts with customers, excluding assessed tax' },
  operating_income: { taxonomy: 'us-gaap', concept: 'OperatingIncomeLoss', period: 'duration', label: 'Operating income or loss' },
  net_income: { taxonomy: 'us-gaap', concept: 'NetIncomeLoss', period: 'duration', label: 'Net income or loss' },
  assets: { taxonomy: 'us-gaap', concept: 'Assets', period: 'instant', label: 'Total assets' },
  ifrs_revenue: { taxonomy: 'ifrs-full', concept: 'Revenue', period: 'duration', label: 'Revenue' },
} as const);
type ConceptId = keyof typeof EDGAR_CONCEPTS;
export const metricKey = (id: ConceptId) => `edgar_${id}`;

/** Annual reports and their amendments. A figure that only a 10-Q, 8-K or registration statement carries is not read. */
export const ANNUAL_FORMS: readonly string[] = Object.freeze(['10-K', '10-K/A', '10-KT', '10-KT/A', '20-F', '20-F/A', '40-F', '40-F/A']);
/** An annual duration: a 52- or 53-week year, or a calendar year. Quarters, half-years and nine-month periods are out. */
export const ANNUAL_DAYS = Object.freeze({ min: 350, max: 380 });

/**
 * One request per concept, one at a time, at least this far apart: at most eight a second, inside the SEC's published
 * ten per second (D7929, unverified from sec.gov in this session).
 */
export const EDGAR_REQUEST_GAP_MS = 125;
/** Four concepts by five years is 20 nominal cells; a batch whose distinct facts exceed the writer's 40 fails closed. */
export const EDGAR_IMPORT_LIMITS = Object.freeze({ concepts: 4, years: 5, response_bytes: 5_000_000, prior_values_listed: 3 });

/**
 * The env binding that carries the User-Agent the SEC asks automated requesters to declare: who is asking and a
 * contact address (for example `Example Research ops@example.org`). No value is in code; until an operator sets it,
 * every batch is refused before any request.
 */
export const USER_AGENT_BINDING = 'SEC_EDGAR_USER_AGENT';

/** The text every row carries. The restatement note for the fact is appended. */
export const EDGAR_LIMITATIONS = 'One company\'s own figure as it reported it to the SEC in XBRL: the registrant (CIK) named in the '
  + 'series, for its own reporting scope as filed (consolidated where it reports consolidated, without segment, product or '
  + 'geographic breakdown), for the exact period in the key, in the currency it reported, not converted or adjusted. '
  + 'It is not a market size, a market share, an industry total or a figure for any country. A fact the filing does not '
  + 'tag, or tags with no value, stores no row.';

export interface EdgarParams { cik: string; concepts: ConceptId[]; from: number; to: number }
export interface EdgarSkips { not_reported: number; missing_value: number; unknown_unit: number; conflicting: number }
export type EdgarReport = ImportReport & { skipped: EdgarSkips; restated: number; requests: number };

/** One fact as the company-concept API lists it under a unit. */
interface Fact { start?: string; end: string; val?: unknown; accn: string; fy?: unknown; fp?: unknown; form: string; filed: string }

const invalid = () => new ImportRequestError('invalid_sec_edgar_parameters');
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const ACCESSION_RE = /^\d{10}-\d{2}-\d{6}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

/** Validate a batch: one CIK, one to four known concepts, period-end years `from` to `to` (at most five). */
export function edgarParams(raw: unknown, now: Date = new Date()): EdgarParams {
  const b = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  if (Object.keys(b).some(k => !['cik', 'concepts', 'from', 'to'].includes(k))) throw invalid();
  if (typeof b.cik !== 'string' || !/^\d{1,10}$/.test(b.cik) || Number(b.cik) === 0) throw invalid();
  const last = now.getUTCFullYear();
  for (const y of [b.from, b.to]) if (!Number.isInteger(y) || Number(y) < FIRST_YEAR || Number(y) > last) throw invalid();
  if (Number(b.to) < Number(b.from) || Number(b.to) - Number(b.from) + 1 > EDGAR_IMPORT_LIMITS.years) throw invalid();
  const concepts = b.concepts;
  if (!Array.isArray(concepts) || !concepts.length || concepts.length > EDGAR_IMPORT_LIMITS.concepts
    || concepts.some(v => typeof v !== 'string' || !Object.hasOwn(EDGAR_CONCEPTS, v)) || new Set(concepts).size !== concepts.length) throw invalid();
  return { cik: b.cik.padStart(10, '0'), concepts: concepts as ConceptId[], from: Number(b.from), to: Number(b.to) };
}

/** The configured User-Agent: printable ASCII naming the requester with a contact address, or null when unset or unusable. */
export function edgarUserAgent(env: unknown): string | null {
  const raw = (env as Record<string, unknown> | null)?.[USER_AGENT_BINDING];
  if (typeof raw !== 'string') return null;
  const ua = raw.trim();
  return /^[\x20-\x7e]{8,200}$/.test(ua) && /\S+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/.test(ua) && /[A-Za-z]{2,}.*\s/.test(ua) ? ua : null;
}

const dayNumber = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 86_400_000;

/** A fact's shape checked; anything this reader does not know fails the batch rather than being guessed. */
function checkedFact(f: unknown): Fact {
  const x = f && typeof f === 'object' && !Array.isArray(f) ? f as Record<string, unknown> : null;
  if (!x || typeof x.end !== 'string' || !DATE_RE.test(x.end) || (x.start !== undefined && (typeof x.start !== 'string' || !DATE_RE.test(x.start)))
    || typeof x.accn !== 'string' || !ACCESSION_RE.test(x.accn) || typeof x.form !== 'string' || x.form.length > 20
    || typeof x.filed !== 'string' || !DATE_RE.test(x.filed)) throw new ImportFailure('provider_payload');
  return x as unknown as Fact;
}

const amount = (n: number, unit: string) => `${String(n)} ${unit}`;
const reported = (f: Fact) => `accession ${f.accn} (${f.form}, filed ${f.filed})`;

/**
 * The value a fact holds now and where it came from. Facts are read in filing order; each change of value starts a new
 * edition, first filed in the accession that changed it. The current edition is the last; the earlier ones are the
 * values it restates. A later filing that repeats the current value changes nothing, so a replay is stable.
 */
export function editions(facts: (Fact & { val: number })[]): { current: Fact & { val: number }; prior: (Fact & { val: number })[] } {
  const ordered = [...facts].sort((a, b) => a.filed.localeCompare(b.filed) || a.accn.localeCompare(b.accn));
  const starts: (Fact & { val: number })[] = [];
  for (const f of ordered) if (!starts.length || starts[starts.length - 1].val !== f.val) starts.push(f);
  return { current: starts[starts.length - 1], prior: starts.slice(0, -1) };
}

/** The restatement provenance a row carries, or null when no earlier filing gave another value. */
export function restatementNote(prior: (Fact & { val: number })[], unit: string): string | null {
  if (!prior.length) return null;
  const listed = prior.slice(-EDGAR_IMPORT_LIMITS.prior_values_listed).reverse();
  const earlier = prior.length - listed.length;
  return 'Restated: this value replaces ' + listed.map(f => `${amount(f.val, unit)} first reported in ${reported(f)}`).join('; ')
    + (earlier ? `; and ${earlier} earlier value${earlier === 1 ? '' : 's'}` : '') + '.';
}

/** Read one company-concept response into observations for the asked years. */
export function conceptRows(body: unknown, p: EdgarParams, id: ConceptId, skipped: EdgarSkips, counts: { restated: number; seen: number }): Observation[] {
  const spec = EDGAR_CONCEPTS[id];
  const j = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  // The answer must be the entity and concept asked for; anything else is not this fact.
  if (!j || j.cik !== Number(p.cik) || j.taxonomy !== spec.taxonomy || j.tag !== spec.concept
    || typeof j.entityName !== 'string' || !j.entityName.trim() || j.entityName.length > 150
    || !j.units || typeof j.units !== 'object' || Array.isArray(j.units)) throw new ImportFailure('provider_payload');
  const entity = j.entityName.replace(/\s+/g, ' ').trim();
  const rows: Observation[] = [];
  for (const [unit, list] of Object.entries(j.units as Record<string, unknown>)) {
    if (!Array.isArray(list)) throw new ImportFailure('provider_payload');
    const facts = list.map(checkedFact);
    // Only a currency is read: these concepts are monetary, and a unit such as `USD/shares` or `pure` is not one.
    if (!CURRENCY_RE.test(unit)) { skipped.unknown_unit++; continue; }
    const identities = new Map<string, Fact[]>();
    for (const f of facts) {
      if (!ANNUAL_FORMS.includes(f.form)) continue;
      if (spec.period === 'instant' ? f.start !== undefined : f.start === undefined) continue;
      if (f.start !== undefined) {
        const days = dayNumber(f.end) - dayNumber(f.start) + 1;
        if (days < ANNUAL_DAYS.min || days > ANNUAL_DAYS.max) continue;
      }
      const year = Number(f.end.slice(0, 4));
      if (year < p.from || year > p.to) continue;
      const identity = `${f.start ?? ''}:${f.end}`;
      identities.set(identity, [...(identities.get(identity) ?? []), f]);
    }
    for (const [identity, group] of [...identities].sort(([a], [b]) => a.localeCompare(b))) {
      counts.seen++;
      // A value that is absent or null is a fact the filing did not give a number for: no row, never a zero.
      const numbered = group.filter((f): f is Fact & { val: number } => typeof f.val === 'number' && Number.isFinite(f.val));
      if (!numbered.length) { skipped.missing_value++; continue; }
      // One filing giving two values for one fact cannot say which it means.
      const byFiling = new Map<string, number>();
      let conflicting = false;
      for (const f of numbered) {
        if (byFiling.has(f.accn) && byFiling.get(f.accn) !== f.val) conflicting = true;
        byFiling.set(f.accn, f.val);
      }
      if (conflicting) { skipped.conflicting++; continue; }
      const { current, prior } = editions(numbered);
      const note = restatementNote(prior, unit);
      if (note) counts.restated++;
      const key = ['edgar', p.cik, spec.taxonomy, spec.concept, unit, identity].join(':');
      const periodText = current.start ? `${current.start} to ${current.end}` : `at ${current.end}`;
      rows.push({
        metric_key: metricKey(id), metric_label: `${entity} (CIK ${p.cik}): ${spec.label}, as reported (${spec.taxonomy}:${spec.concept})`,
        geography_type: 'ecosystem', geography_code: `CIK${p.cik}`,
        period: current.end.slice(0, 4), value: current.val, unit, observation_status: 'actual', published_at: current.filed,
        source_observation_key: key, vintage: current.accn,
        statistical_unit: 'enterprise', scale: 'units', currency: unit, price_basis: 'current_prices',
        industry_scheme: null, industry_code: null, size_band: null,
        series_id: ['EDGAR', p.cik, spec.taxonomy, spec.concept, unit].join('.').slice(0, 120),
        supporting_passage: null,
        applicability_note: `Reported by ${entity} (CIK ${p.cik}) in ${reported(current)}; period ${periodText}`
          + `${typeof current.fy === 'number' && typeof current.fp === 'string' ? `; the filing's own fiscal focus ${current.fy} ${current.fp}` : ''}.`,
        limitations: [EDGAR_LIMITATIONS, note].filter(Boolean).join(' '),
      });
    }
  }
  return rows;
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** One bounded batch: one request per concept, sequential and paced, at most one writer batch, no continuation. */
export async function ingestSecEdgarFacts(env: Env, raw: unknown, cursor?: unknown): Promise<EdgarReport> {
  const params = edgarParams(raw);
  if (cursor !== undefined && cursor !== null) throw new ImportRequestError('invalid_cursor');
  const userAgent = edgarUserAgent(env);
  if (userAgent === null) throw new ImportRequestError('sec_edgar_identity_not_configured', 409);
  const skipped: EdgarSkips = { not_reported: 0, missing_value: 0, unknown_unit: 0, conflicting: 0 };
  const counts = { restated: 0, seen: 0, requests: 0 };
  const report = await runObservationBatch(env, SOURCE_ID, async (): Promise<PreparedBatch> => {
    try {
      const rows: Observation[] = [];
      for (const id of params.concepts) {
        if (counts.requests > 0) await pause(EDGAR_REQUEST_GAP_MS);
        const spec = EDGAR_CONCEPTS[id];
        counts.requests++;
        let bytes: Uint8Array;
        try {
          bytes = (await providerArchive(conceptUrl(params.cik, spec.taxonomy, spec.concept), EDGAR_IMPORT_LIMITS.response_bytes,
            { 'User-Agent': userAgent, Accept: 'application/json' })).bytes;
        } catch (error) {
          // The company never tagged this concept: nothing to store, and not a failure of the batch.
          if (error instanceof ImportFailure && error.kind === 'provider_http' && error.httpStatus === 404) { skipped.not_reported++; continue; }
          throw error;
        }
        let body: unknown;
        try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)); }
        catch { throw new ImportFailure('provider_payload'); }
        rows.push(...conceptRows(body, params, id, skipped, counts));
      }
      if (counts.seen > MAX_BATCH_ROWS) throw new ImportFailure('provider_payload');
      const newest = [...rows].sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)) || b.vintage.localeCompare(a.vintage))[0];
      return { rows, seen: counts.seen, vintage: newest ? `accession:${newest.vintage}` : 'not_recorded',
        cursor: null, retry_cursor: null, progressed: true };
    } catch (error) {
      reportPrivateError('import_row', error, 'market_provider_failed');
      for (const k of Object.keys(skipped) as (keyof EdgarSkips)[]) skipped[k] = 0;
      counts.restated = 0;
      return { rows: [], seen: 0, vintage: 'not_recorded', cursor: null, retry_cursor: null, progressed: false,
        failure: error instanceof ImportFailure ? error : new ImportFailure('provider_payload') };
    }
  });
  return { ...report, skipped, restated: counts.restated, requests: counts.requests };
}
