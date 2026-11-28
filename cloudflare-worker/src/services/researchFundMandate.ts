/**
 * D7749 (#7749) — the fund directory's mandate filters: where a fund invests,
 * at what stage, and whether its stated cheque contains the cheque a founder
 * needs. The one mandate filter contract: the Funds directory, the Capital
 * relationships match read (services/capRelReads.ts) and the Companies plan's
 * firm discovery all go through `parseMandateQuery` and `listDirectory`.
 *
 * WHAT IS READ. The statements of D7743 (`research_fund_observations` and
 * their terms, migration 202611191932_7743) and the rows of the older
 * `research_fund_vehicle_facts` (D7167), under the gate `readFundStatements`
 * uses: a list whose verdict is 'not allowed' never matches or counts, a
 * statement with a period is history and matches nothing, and a statement
 * under a uid that moved is read under the new uid (one hop). The vocabulary
 * is D7743's (`STAGE_TERMS`, `REGION_TERMS`); this file defines none.
 *
 * FILTERS (every value bound):
 *   stage           a stage term, or `none`. A multi-stage statement matches
 *                   each of its terms. An unknown term is a 400 naming them.
 *   invests_in      a two-letter country code, a region term, `global`, or
 *                   `none`. Literal: a region matches statements that name the
 *                   region, never its countries, and the reverse. Never the HQ.
 *   cheque          a whole amount of `cheque_currency` (required with it, no
 *                   default), `worded` or `none`. An amount matches a row with
 *                   a current cheque statement that is a range, a lower bound
 *                   or an upper bound in that stated or reviewed currency and
 *                   contains it (bounds inclusive). An average, a typical or
 *                   exact amount, a statement with no stated currency, or a
 *                   bound in another currency never matches; such rows are
 *                   `cheque_not_comparable`. `worded` lists rows whose cheque
 *                   statements are all of that kind; `none` rows with none.
 *   `none`          no served current statement of that fact. A row whose
 *                   statements map to no term is in neither a term nor
 *                   `none`; `facets_unmapped` counts it.
 *
 * A row matches when one of its own statements does: nothing is inherited
 * between a manager's row and its vehicles' rows. A store that cannot be read
 * is not an empty one: the list still answers, every mandate block reads
 * `unavailable`, and a request that asks for a mandate filter is refused
 * (`MandateUnavailableError`, a 503 at the route), never answered unfiltered.
 *
 * Every SQL fragment here is a literal of this file; request values are bound.
 */
import type { Env } from '../types';
import {
  REGION_TERMS, STAGE_TERMS, compareStatements,
  type CurrencyBasis, type Qualifier, type RegionTerm, type StageTerm,
} from './researchFundObservations';

export const MANDATE_UNAVAILABLE = 'Unavailable: the fund statements could not be read';

/** A mandate filter was asked while the statement store cannot be read. */
export class MandateUnavailableError extends Error {
  constructor() { super(MANDATE_UNAVAILABLE); this.name = 'MandateUnavailableError'; }
}

export interface MandateQuery {
  stage?: StageTerm | 'none' | null;
  /** `{ vocabulary: 'country', term: 'DE' }`, `{ vocabulary: 'region', term: 'Europe' | 'global' }`, or `none`. */
  invests_in?: { vocabulary: 'country' | 'region'; term: string } | 'none' | null;
  /** Whole units of `cheque_currency`, or `worded` / `none`. */
  cheque?: number | 'worded' | 'none' | null;
  cheque_currency?: string | null;
}

export const mandateAsked = (q: MandateQuery) => q.stage != null || q.invests_in != null || q.cheque != null;

const MAX_CHEQUE = 1_000_000_000_000;

const regionKey = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, ' ');

/** Read and validate the three filters; `fail` builds the caller's 400 error. */
export function parseMandateQuery(get: (k: string) => string | undefined, fail: (field: string, reason: string) => Error): MandateQuery {
  const out: MandateQuery = { stage: null, invests_in: null, cheque: null, cheque_currency: null };

  const stage = (get('stage') ?? '').trim().toLowerCase();
  if (stage) {
    if (stage !== 'none' && !(STAGE_TERMS as readonly string[]).includes(stage)) {
      throw fail('stage', `stage must be one of ${STAGE_TERMS.join(', ')}, none`);
    }
    out.stage = stage as StageTerm | 'none';
  }

  const where = (get('invests_in') ?? '').trim();
  if (where) {
    const region = REGION_TERMS.find((r) => regionKey(r) === regionKey(where));
    if (where.toLowerCase() === 'none') out.invests_in = 'none';
    else if (/^[A-Za-z]{2}$/.test(where)) out.invests_in = { vocabulary: 'country', term: where.toUpperCase() };
    else if (region) out.invests_in = { vocabulary: 'region', term: region };
    else throw fail('invests_in', `invests_in must be a two-letter country code, one of ${REGION_TERMS.join(', ')}, or none`);
  }

  const cheque = (get('cheque') ?? '').trim().toLowerCase();
  const ccyRaw = (get('cheque_currency') ?? '').trim();
  if (ccyRaw && !/^[A-Za-z]{3}$/.test(ccyRaw)) throw fail('cheque_currency', 'cheque_currency must be a three-letter currency code, such as USD');
  if (cheque === 'worded' || cheque === 'none') out.cheque = cheque;
  else if (cheque) {
    if (!/^\d+$/.test(cheque) || Number(cheque) > MAX_CHEQUE) {
      throw fail('cheque', `cheque must be a whole amount up to ${MAX_CHEQUE}, worded or none`);
    }
    out.cheque = Number(cheque);
  }
  if (typeof out.cheque === 'number') {
    if (!ccyRaw) throw fail('cheque_currency', 'a cheque amount needs cheque_currency: amounts are never compared across currencies');
    out.cheque_currency = ccyRaw.toUpperCase();
  } else if (ccyRaw) {
    throw fail('cheque_currency', 'cheque_currency applies only to a cheque amount');
  }
  return out;
}

// ---------------------------------------------------------------------------
// SQL literals.
// ---------------------------------------------------------------------------

/**
 * Every served CURRENT statement of `facts` (a literal list of this file),
 * D7743's store and D7167's older table under
 * the same gate as `readFundStatements`. The older table records no currency
 * basis, so its cheques are never comparable, and no terms, so its stage and
 * geography text is unmapped.
 */
const stmtFor = (facts: string) => `(SELECT o.id AS id, COALESCE(mv.new_uid, o.fund_uid) AS fund_uid, o.fact AS fact, o.wording AS wording,
         o.source_name AS source_name, o.source_url AS source_url, o.reported_on AS reported_on, o.imported_on AS imported_on,
         o.qualifier AS qualifier, o.min_cents AS min_cents, o.max_cents AS max_cents, o.point_cents AS point_cents,
         o.currency AS currency, o.currency_basis AS currency_basis
    FROM research_fund_observations o
    JOIN research_fund_sources s ON s.source_name = o.source_name
    LEFT JOIN research_fund_directory_uid_moves mv ON mv.old_uid = o.fund_uid
   WHERE o.fact IN (${facts}) AND s.verdict <> 'not allowed' AND o.period_start IS NULL AND o.period_end IS NULL
  UNION ALL
  SELECT NULL, v.fund_uid, v.field, v.value_text, v.source_name, v.source_url, v.reported_on, v.imported_on,
         CASE WHEN v.field <> 'initial_cheque' THEN NULL WHEN v.min_cents IS NOT NULL AND v.max_cents IS NOT NULL THEN 'range'
              WHEN v.min_cents IS NOT NULL THEN 'lower_bound' ELSE 'upper_bound' END,
         v.min_cents, v.max_cents, NULL, v.currency, NULL
    FROM research_fund_vehicle_facts v
   WHERE v.field IN (${facts})
     AND NOT EXISTS (SELECT 1 FROM research_fund_sources n WHERE n.source_name = v.source_name AND n.verdict = 'not allowed'))`;

/** One fact's statements (the fact is pushed into both branches, so D7743's (fact, fund_uid) index serves it). */
const FACT_STMT: Readonly<Record<string, string>> = {
  investment_stage: stmtFor(`'investment_stage'`),
  investment_geography: stmtFor(`'investment_geography'`),
  initial_cheque: stmtFor(`'initial_cheque'`),
  manager_name: stmtFor(`'manager_name'`),
};
const CHEQUE_STMT = FACT_STMT.initial_cheque;
/** The three facts a row's mandate block shows, and no other. */
const MANDATE_STMT = stmtFor(`'investment_stage', 'investment_geography', 'initial_cheque'`);

/** A cheque statement an amount can be compared with: a range or bound in a stated or reviewed currency. */
const COMPARABLE = `fact = 'initial_cheque' AND qualifier IN ('range', 'lower_bound', 'upper_bound')
  AND currency_basis IN ('stated', 'reviewed') AND currency IS NOT NULL`;

const FACT_OF = { stage: 'investment_stage', invests_in: 'investment_geography' } as const;

const uidsWith = (fact: string) => `SELECT fund_uid FROM ${FACT_STMT[fact]}`;
const uidsWithTerm = (fact: string) => `SELECT st.fund_uid FROM ${FACT_STMT[fact]} st
  JOIN research_fund_observation_terms t ON t.observation_id = st.id
 WHERE st.fact = '${fact}' AND t.vocabulary = ? AND t.term = ?`;

/**
 * The WHERE conditions the mandate filters add, leaving out the one named by
 * `omit`. Each is a literal; every value goes into `binds`. Only called when
 * the store can be read.
 */
export function mandateConditions(q: MandateQuery, omit: 'stage' | 'invests_in' | 'cheque' | string | null) {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.stage && omit !== 'stage') {
    if (q.stage === 'none') where.push(`uid NOT IN (${uidsWith(FACT_OF.stage)})`);
    else { where.push(`uid IN (${uidsWithTerm(FACT_OF.stage)})`); binds.push('stage', q.stage); }
  }
  if (q.invests_in && omit !== 'invests_in') {
    if (q.invests_in === 'none') where.push(`uid NOT IN (${uidsWith(FACT_OF.invests_in)})`);
    else { where.push(`uid IN (${uidsWithTerm(FACT_OF.invests_in)})`); binds.push(q.invests_in.vocabulary, q.invests_in.term); }
  }
  if (q.cheque != null && omit !== 'cheque') {
    if (q.cheque === 'none') where.push(`uid NOT IN (${uidsWith('initial_cheque')})`);
    else if (q.cheque === 'worded') {
      where.push(`uid IN (${uidsWith('initial_cheque')}) AND uid NOT IN (SELECT fund_uid FROM ${CHEQUE_STMT} WHERE ${COMPARABLE})`);
    } else {
      const cents = q.cheque * 100;
      where.push(`uid IN (SELECT fund_uid FROM ${CHEQUE_STMT} WHERE ${COMPARABLE} AND currency = ?
        AND (min_cents IS NULL OR min_cents <= ?) AND (max_cents IS NULL OR max_cents >= ?))`);
      binds.push(q.cheque_currency, cents, cents);
    }
  }
  return { where, binds };
}

/** `q` also finds a row by a served current manager_name statement (`needle` is the caller's escaped LIKE pattern). */
export function managerNameCondition(needle: string) {
  return { sql: `uid IN (SELECT fund_uid FROM ${FACT_STMT.manager_name} WHERE wording LIKE ? ESCAPE '\\')`, binds: [needle] };
}

// ---------------------------------------------------------------------------
// Coverage, facets and the row summary.
// ---------------------------------------------------------------------------

export interface MandateCoverage {
  status: 'ok' | 'unavailable';
  reason?: string;
  stage: number; geography: number; cheque: number; manager: number; cheque_comparable: number;
}

/**
 * Over the whole served directory (`served`, the caller's SERVED_FUNDS
 * literal): rows with a current stage, geography, cheque and manager
 * statement, and rows with a comparable cheque. A store that cannot be read
 * answers `unavailable`, never zeros. This read is also how the directory
 * learns whether the store can be read at all.
 */
export async function mandateCoverage(env: Env, served: string): Promise<MandateCoverage> {
  try {
    const row = await env.DB.prepare(
      `SELECT SUM(CASE WHEN uid IN (${uidsWith(FACT_OF.stage)}) THEN 1 ELSE 0 END) AS stage,
              SUM(CASE WHEN uid IN (${uidsWith(FACT_OF.invests_in)}) THEN 1 ELSE 0 END) AS geography,
              SUM(CASE WHEN uid IN (${uidsWith('initial_cheque')}) THEN 1 ELSE 0 END) AS cheque,
              SUM(CASE WHEN uid IN (${uidsWith('manager_name')}) THEN 1 ELSE 0 END) AS manager,
              SUM(CASE WHEN uid IN (SELECT fund_uid FROM ${CHEQUE_STMT} WHERE ${COMPARABLE}) THEN 1 ELSE 0 END) AS cheque_comparable,
              (SELECT COUNT(*) FROM research_fund_observation_terms WHERE 0) AS terms_readable
         FROM ${served} AS f`,
    ).first<Record<string, number | null>>();
    const n = (k: string) => Number(row?.[k] ?? 0);
    return { status: 'ok', stage: n('stage'), geography: n('geography'), cheque: n('cheque'), manager: n('manager'), cheque_comparable: n('cheque_comparable') };
  } catch (e) {
    console.warn('[researchFundMandate] statements unreadable:', (e as Error)?.name || 'error');
    return { status: 'unavailable', reason: MANDATE_UNAVAILABLE, stage: 0, geography: 0, cheque: 0, manager: 0, cheque_comparable: 0 };
  }
}

export const STAGE_LABEL: Readonly<Record<string, string>> = {
  pre_seed: 'Pre-seed', seed: 'Seed', series_a: 'Series A', series_b: 'Series B', series_c_plus: 'Series C and later',
  growth: 'Growth', early_stage: 'Early stage', late_stage: 'Late stage', multi_stage: 'Multi-stage',
};

/**
 * Stage or geography counts over `matches` (the caller's `SELECT uid …` with
 * every other filter applied): rows per term, `none` and the unmapped rows.
 * A row two sources call seed counts once.
 */
export async function termFacet(env: Env, which: 'stage' | 'invests_in', matches: string, binds: unknown[], countryNames: Map<string, string>) {
  const fact = FACT_OF[which];
  const one = FACT_STMT[fact];
  const rows = await env.DB.prepare(
    `WITH m AS MATERIALIZED (${matches})
     SELECT 'term' AS k, t.vocabulary AS vocabulary, t.term AS v, COUNT(DISTINCT st.fund_uid) AS n
       FROM ${one} st JOIN research_fund_observation_terms t ON t.observation_id = st.id
      WHERE st.fund_uid IN (SELECT uid FROM m)
      GROUP BY t.vocabulary, t.term
     UNION ALL
     SELECT 'none', NULL, NULL, COUNT(*) FROM m WHERE uid NOT IN (SELECT fund_uid FROM ${one})
     UNION ALL
     SELECT 'unmapped', NULL, NULL, COUNT(*) FROM m
      WHERE uid IN (SELECT fund_uid FROM ${one})
        AND uid NOT IN (SELECT st.fund_uid FROM ${one} st JOIN research_fund_observation_terms t ON t.observation_id = st.id)`,
  ).bind(...binds).all<{ k: string; vocabulary: string | null; v: string | null; n: number }>();
  const list = rows.results || [];
  const pick = (k: string) => Number(list.find((x) => x.k === k)?.n ?? 0);
  const terms = list.filter((x) => x.k === 'term' && x.v != null && Number(x.n) > 0);
  const noneLabel = which === 'stage' ? 'Stage not recorded' : 'Where it invests not recorded';
  let values: Array<{ value: string; vocabulary?: string; label: string; count: number }>;
  if (which === 'stage') {
    values = STAGE_TERMS.flatMap((t) => {
      const hit = terms.find((x) => x.v === t);
      return hit ? [{ value: t as string, label: STAGE_LABEL[t] ?? t, count: Number(hit.n) }] : [];
    });
  } else {
    const regions = REGION_TERMS.flatMap((r) => {
      const hit = terms.find((x) => x.vocabulary === 'region' && x.v === r);
      return hit ? [{ value: r as string, vocabulary: 'region', label: r === 'global' ? 'Global' : r, count: Number(hit.n) }] : [];
    });
    const countries = terms.filter((x) => x.vocabulary === 'country')
      .map((x) => ({ value: String(x.v), vocabulary: 'country', label: countryNames.get(String(x.v)) ?? String(x.v), count: Number(x.n) }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    values = [...regions, ...countries];
  }
  return { values: [...values, { value: 'none', label: noneLabel, count: pick('none') }], unmapped: pick('unmapped') };
}

/**
 * Cheque counts over `matches`: per currency, the rows with a comparable
 * statement in it and the lowest and highest bound stated; `worded`; `none`;
 * and `not_comparable` — with an amount asked, the rows whose cheque
 * statements hold none comparable in the asked currency; without one, the
 * worded rows.
 */
export async function chequeFacet(env: Env, q: MandateQuery, matches: string, binds: unknown[]) {
  const asked = typeof q.cheque === 'number';
  const rows = await env.DB.prepare(
    `WITH m AS MATERIALIZED (${matches})
     SELECT 'currency' AS k, currency AS v, COUNT(DISTINCT fund_uid) AS n, MIN(min_cents) AS lo, MAX(max_cents) AS hi
       FROM ${CHEQUE_STMT} WHERE ${COMPARABLE} AND fund_uid IN (SELECT uid FROM m) GROUP BY currency
     UNION ALL
     SELECT 'worded', NULL, COUNT(*), NULL, NULL FROM m
      WHERE uid IN (${uidsWith('initial_cheque')}) AND uid NOT IN (SELECT fund_uid FROM ${CHEQUE_STMT} WHERE ${COMPARABLE})
     UNION ALL
     SELECT 'none', NULL, COUNT(*), NULL, NULL FROM m WHERE uid NOT IN (${uidsWith('initial_cheque')})
     UNION ALL
     SELECT 'not_comparable', NULL, COUNT(*), NULL, NULL FROM m
      WHERE uid IN (${uidsWith('initial_cheque')}) AND uid NOT IN (SELECT fund_uid FROM ${CHEQUE_STMT} WHERE ${COMPARABLE} AND currency = ?)`,
  ).bind(...binds, asked ? q.cheque_currency : null).all<{ k: string; v: string | null; n: number; lo: number | null; hi: number | null }>();
  const list = rows.results || [];
  const pick = (k: string) => Number(list.find((x) => x.k === k)?.n ?? 0);
  return {
    cheque: {
      currencies: list.filter((x) => x.k === 'currency' && x.v != null)
        .map((x) => ({ currency: String(x.v), count: Number(x.n), min_cents: x.lo == null ? null : Number(x.lo), max_cents: x.hi == null ? null : Number(x.hi) }))
        .sort((a, b) => a.currency.localeCompare(b.currency)),
      worded: pick('worded'),
      none: pick('none'),
    },
    not_comparable: asked ? pick('not_comparable') : pick('worded'),
  };
}

interface StatementRow {
  fund_uid: string; fact: string; wording: string | null; source_name: string; source_url: string | null;
  reported_on: string | null; imported_on: string | null; qualifier: Qualifier | null; min_cents: number | null;
  max_cents: number | null; point_cents: number | null; currency: string | null; currency_basis: CurrencyBasis | null;
  terms: string | null;
}

const isComparable = (s: Pick<StatementRow, 'fact' | 'qualifier' | 'currency_basis' | 'currency'>) =>
  s.fact === 'initial_cheque' && (s.qualifier === 'range' || s.qualifier === 'lower_bound' || s.qualifier === 'upper_bound')
  && (s.currency_basis === 'stated' || s.currency_basis === 'reviewed') && s.currency != null;

function parseTerms(raw: string | null): Array<{ vocabulary: string; term: string }> {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.filter((x) => x && typeof x.term === 'string').map((x) => ({ vocabulary: String(x.vocabulary), term: String(x.term) })) : [];
  } catch { return []; }
}

export const MANDATE_NOT_RECORDED = 'Not recorded: no served source states this';

/**
 * Each page row's stage, geography and cheque, from its own current served
 * statements only: status, terms, each statement's wording and qualifier,
 * the number of sources and each statement's provenance. Only these three
 * facts are read, so a description or any other fact never reaches it.
 */
export async function readMandates(env: Env, uids: string[]) {
  const out = new Map<string, ReturnType<typeof summarise>>();
  if (!uids.length) return out;
  const r = await env.DB.prepare(
    `SELECT st.fund_uid, st.fact, st.wording, st.source_name, st.source_url, st.reported_on, st.imported_on,
            st.qualifier, st.min_cents, st.max_cents, st.point_cents, st.currency, st.currency_basis,
            (SELECT json_group_array(json_object('vocabulary', t.vocabulary, 'term', t.term))
               FROM research_fund_observation_terms t WHERE t.observation_id = st.id) AS terms
       FROM ${MANDATE_STMT} st
      WHERE st.fund_uid IN (SELECT value FROM json_each(?))`,
  ).bind(JSON.stringify([...new Set(uids)])).all<StatementRow>();
  const by = new Map<string, StatementRow[]>();
  for (const s of r.results || []) by.set(s.fund_uid, [...(by.get(s.fund_uid) ?? []), s]);
  for (const uid of uids) out.set(uid, summarise(by.get(uid) ?? []));
  return out;
}

const provenance = (s: StatementRow) => ({
  source_name: s.source_name, source_url: s.source_url, reported_on: s.reported_on, imported_on: s.imported_on,
});

function termBlock(list: StatementRow[], vocab: (t: { vocabulary: string; term: string }) => boolean) {
  const statements = list.sort(compareStatements as (a: StatementRow, b: StatementRow) => number).map((s) => {
    const terms = parseTerms(s.terms).filter(vocab);
    return { wording: s.wording, qualifier: null, terms: terms.map((t) => t.term), provenance: provenance(s), _terms: terms };
  });
  const seen = new Map<string, { vocabulary: string; term: string }>();
  for (const s of statements) for (const t of s._terms) seen.set(`${t.vocabulary}:${t.term}`, t);
  return { statements: statements.map(({ _terms, ...s }) => s), terms: [...seen.values()] };
}

function summarise(rows: StatementRow[]) {
  const of = (fact: string) => rows.filter((s) => s.fact === fact);
  const sources = (list: StatementRow[]) => new Set(list.map((s) => s.source_name)).size;
  const status = (list: StatementRow[], mapped: boolean) => (!list.length ? 'not_recorded' : mapped ? 'stated' : 'unmapped');

  const st = of('investment_stage');
  const stage = termBlock(st, (t) => t.vocabulary === 'stage');
  const stageTerms = STAGE_TERMS.filter((t) => stage.terms.some((x) => x.term === t));

  const geo = of('investment_geography');
  const g = termBlock(geo, (t) => t.vocabulary === 'country' || t.vocabulary === 'region');
  const regions = REGION_TERMS.filter((r) => g.terms.some((x) => x.vocabulary === 'region' && x.term === r)) as RegionTerm[];
  const countries = g.terms.filter((x) => x.vocabulary === 'country').map((x) => x.term).sort();

  const ch = of('initial_cheque').sort(compareStatements as (a: StatementRow, b: StatementRow) => number);
  const comparable = ch.some(isComparable);
  return {
    status: 'ok' as const,
    stage: {
      status: status(st, stageTerms.length > 0), terms: stageTerms, source_count: sources(st), statements: stage.statements,
      ...(st.length ? {} : { reason: MANDATE_NOT_RECORDED }),
    },
    geography: {
      status: status(geo, regions.length + countries.length > 0), terms: { countries, regions }, source_count: sources(geo),
      statements: g.statements, ...(geo.length ? {} : { reason: MANDATE_NOT_RECORDED }),
    },
    cheque: {
      status: !ch.length ? 'not_recorded' : comparable ? 'comparable' : 'worded',
      terms: [...new Set(ch.filter(isComparable).map((s) => String(s.currency)))].sort(),
      source_count: sources(ch),
      statements: ch.map((s) => ({
        wording: s.wording, qualifier: s.qualifier, min_cents: s.min_cents, max_cents: s.max_cents, point_cents: s.point_cents,
        currency: s.currency, currency_basis: s.currency_basis, comparable: isComparable(s), provenance: provenance(s),
      })),
      ...(ch.length ? {} : { reason: MANDATE_NOT_RECORDED }),
    },
  };
}

export const MANDATE_UNAVAILABLE_BLOCK = { status: 'unavailable' as const, reason: MANDATE_UNAVAILABLE };

export const MANDATE_BASIS = 'Stage, where a fund invests and its cheque come from each source\'s own current statement about that row; nothing is inherited between a manager and its vehicles. Where it invests is literal: a statement that names a region matches that region only, never its countries, and a country never matches a region. It is never read from the headquarters. A cheque amount is compared only with a stated range or bound in the asked currency; an average, a typical amount or an amount with no stated currency is never compared.';
