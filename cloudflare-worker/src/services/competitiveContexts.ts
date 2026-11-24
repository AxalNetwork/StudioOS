/**
 * D7835 (#7835): the saved competitive context, the fields a member writes once and reuses for
 * competitor research. Reading and checking a body, and the store's reads and writes; the route is
 * routes/research_competitive_contexts.ts (migration 202611241146_7835_research_competitive_contexts.sql).
 *
 * A context holds no link to a study, a study segment or a Research Project, and nothing here
 * reads or writes #7719's tables. Fields that mean the same as a field of #7719's market study take
 * its name and its exported limit: product, business_model, buyer and customer_countries.
 *
 * Customer countries are where the buyers are. They come only from their own field, start empty
 * and are checked against the taxonomy's country list; nothing fills them from a company-location
 * filter or a directory record's country. Comparison criteria are #7828's attribute list, in the
 * order the member gives.
 */
import type { Env } from '../types';
import { COMPANY_FACT_ATTRIBUTES, type CompanyFactAttribute } from './researchCompanyFacts';
import { listCountries } from './researchTaxonomy';
import { CUSTOMER_COUNTRIES_MAX, SEGMENT_LIMITS, STUDY_LIMITS, readText } from '../routes/research_studies';

/** The longest value of each text field. The four shared with #7719 are its numbers, imported. */
export const CONTEXT_LIMITS = {
  name: 120,
  product: STUDY_LIMITS.product,
  buyer: SEGMENT_LIMITS.buyer,
  customer_segment: 200,
  customer_problem: 1000,
  use_case: 1000,
  business_model: STUDY_LIMITS.business_model,
  delivery_model: 500,
  purpose: 1000,
} as const;
export { CUSTOMER_COUNTRIES_MAX };
/** The most saved contexts one member keeps. */
export const CONTEXTS_PER_OWNER_MAX = 100;

const TEXT_FIELDS = [
  'product', 'buyer', 'customer_segment', 'customer_problem', 'use_case', 'business_model', 'delivery_model', 'purpose',
] as const;
type TextField = (typeof TEXT_FIELDS)[number];
const COUNTRY_RE = /^[A-Z]{2}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const RECORD_UID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export type ContextFields = {
  name: string;
  directory_record_uid: string | null;
  customer_countries: string[];
  market_slug: string | null;
  criteria: CompanyFactAttribute[];
} & Record<TextField, string | null>;

/** Every field the store keeps, in the order a version records them. */
export const CONTEXT_FIELD_NAMES = [
  'name', 'product', 'directory_record_uid', 'buyer', 'customer_segment', 'customer_problem', 'use_case',
  'customer_countries', 'business_model', 'delivery_model', 'purpose', 'market_slug', 'criteria',
] as const;

export interface ContextRow {
  id: number; uid: string; owner_user_id: number; name: string; product: string | null; directory_record_uid: string | null;
  buyer: string | null; customer_segment: string | null; customer_problem: string | null; use_case: string | null;
  customer_countries_json: string | null; business_model: string | null; delivery_model: string | null; purpose: string | null;
  market_slug: string | null; criteria_json: string | null; version: number; created_at: string; updated_at: string;
}

/** A refusal code and the field it is about. */
export type FieldError = { code: string };

/** The whole body as the context's fields: every field, absent ones as not recorded. A PUT replaces. */
export function readContextFields(body: Record<string, unknown>): { fields?: ContextFields; error?: FieldError } {
  const name = readText('name', body.name, CONTEXT_LIMITS.name);
  if (name.error) return { error: { code: name.error } };
  if (!name.value) return { error: { code: 'name_required' } };
  const out: Record<string, unknown> = { name: name.value };
  for (const field of TEXT_FIELDS) {
    const f = readText(field, body[field], CONTEXT_LIMITS[field]);
    if (f.error) return { error: { code: f.error } };
    out[field] = f.value;
  }
  const record = body.directory_record_uid;
  if (record === undefined || record === null || record === '') out.directory_record_uid = null;
  else if (typeof record === 'string' && RECORD_UID_RE.test(record)) out.directory_record_uid = record;
  else return { error: { code: 'invalid_directory_record_uid' } };
  if (out.product && out.directory_record_uid) return { error: { code: 'product_or_record' } };

  const countries = body.customer_countries;
  const codes: string[] = [];
  if (countries !== undefined && countries !== null) {
    if (!Array.isArray(countries)) return { error: { code: 'invalid_customer_country' } };
    for (const item of countries) {
      const code = typeof item === 'string' ? item.trim().toUpperCase() : '';
      if (!COUNTRY_RE.test(code)) return { error: { code: 'invalid_customer_country' } };
      if (!codes.includes(code)) codes.push(code);
    }
    if (codes.length > CUSTOMER_COUNTRIES_MAX) return { error: { code: 'too_many_customer_countries' } };
  }
  out.customer_countries = codes;

  const slug = body.market_slug;
  if (slug === undefined || slug === null || slug === '') out.market_slug = null;
  else if (typeof slug === 'string' && SLUG_RE.test(slug)) out.market_slug = slug;
  else return { error: { code: 'unknown_market' } };

  const criteria = body.criteria;
  const list: CompanyFactAttribute[] = [];
  if (criteria !== undefined && criteria !== null) {
    if (!Array.isArray(criteria)) return { error: { code: 'invalid_criteria' } };
    for (const item of criteria) {
      if (typeof item !== 'string' || !(COMPANY_FACT_ATTRIBUTES as readonly string[]).includes(item)) {
        return { error: { code: 'unknown_criterion' } };
      }
      if (list.includes(item as CompanyFactAttribute)) return { error: { code: 'duplicate_criterion' } };
      list.push(item as CompanyFactAttribute);
    }
  }
  out.criteria = list;
  return { fields: out as ContextFields };
}

/** Whether every customer country is on the taxonomy's country list. */
export async function countriesKnown(env: Pick<Env, 'DB'>, codes: string[]): Promise<boolean> {
  if (!codes.length) return true;
  const known = new Set((await listCountries(env as Env)).map((r) => r.code));
  return codes.every((code) => known.has(code));
}

/** Whether the market slug is one the market directory holds. */
export async function marketKnown(env: Pick<Env, 'DB'>, slug: string | null): Promise<boolean> {
  if (slug === null) return true;
  const row = await env.DB.prepare('SELECT slug FROM research_market_directory WHERE slug = ?').bind(slug).first<{ slug: string }>();
  return Boolean(row);
}

function list(json: string | null): string[] {
  try {
    const v = JSON.parse(json || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** The fields as the store holds them, for a version's copy and for comparing two saves. */
export function rowFields(r: ContextRow): ContextFields {
  return {
    name: r.name, product: r.product, directory_record_uid: r.directory_record_uid, buyer: r.buyer,
    customer_segment: r.customer_segment, customer_problem: r.customer_problem, use_case: r.use_case,
    customer_countries: list(r.customer_countries_json), business_model: r.business_model,
    delivery_model: r.delivery_model, purpose: r.purpose, market_slug: r.market_slug,
    criteria: list(r.criteria_json) as CompanyFactAttribute[],
  };
}

/** Field names whose value differs between two saves; receipts carry names only, never the text. */
export function changedFields(before: ContextFields | null, after: ContextFields): string[] {
  return CONTEXT_FIELD_NAMES.filter((n) => JSON.stringify(before?.[n] ?? null) !== JSON.stringify(after[n] ?? null)
    && (before !== null || !(after[n] === null || (Array.isArray(after[n]) && (after[n] as unknown[]).length === 0))));
}

/** The values bound into an INSERT or UPDATE, in the column order the route's statements name. */
export function columnValues(f: ContextFields): unknown[] {
  return [
    f.name, f.product, f.directory_record_uid, f.buyer, f.customer_segment, f.customer_problem, f.use_case,
    f.customer_countries.length ? JSON.stringify(f.customer_countries) : null, f.business_model, f.delivery_model,
    f.purpose, f.market_slug, f.criteria.length ? JSON.stringify(f.criteria) : null,
  ];
}

/** The caller's own context by uid; another member's reads as absent, the same as one that does not exist. */
export function readOwnContext(env: Pick<Env, 'DB'>, uid: string, ownerId: number) {
  return env.DB.prepare(
    `SELECT id, uid, owner_user_id, name, product, directory_record_uid, buyer, customer_segment, customer_problem, use_case,
       customer_countries_json, business_model, delivery_model, purpose, market_slug, criteria_json, version, created_at, updated_at
     FROM research_competitive_contexts WHERE uid = ? AND owner_user_id = ?`,
  ).bind(uid, ownerId).first<ContextRow>();
}

/** The caller's contexts, newest first. */
export async function listOwnContexts(env: Pick<Env, 'DB'>, ownerId: number): Promise<ContextRow[]> {
  const rows = await env.DB.prepare(
    `SELECT id, uid, owner_user_id, name, product, directory_record_uid, buyer, customer_segment, customer_problem, use_case,
       customer_countries_json, business_model, delivery_model, purpose, market_slug, criteria_json, version, created_at, updated_at
     FROM research_competitive_contexts WHERE owner_user_id = ? ORDER BY updated_at DESC, id DESC`,
  ).bind(ownerId).all<ContextRow>();
  return rows.results || [];
}

/** What a member reads. The directory record is described by the route, which checks it again on every read. */
export function contextDto(r: ContextRow, record: Record<string, unknown> | null) {
  const f = rowFields(r);
  return {
    uid: r.uid,
    name: f.name,
    product: f.product,
    directory_record: record,
    buyer: f.buyer,
    customer_segment: f.customer_segment,
    customer_problem: f.customer_problem,
    use_case: f.use_case,
    customer_countries: f.customer_countries,
    business_model: f.business_model,
    delivery_model: f.delivery_model,
    purpose: f.purpose,
    market_slug: f.market_slug,
    criteria: f.criteria,
    version: r.version,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}
