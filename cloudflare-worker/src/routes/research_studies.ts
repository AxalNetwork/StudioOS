/**
 * D7719 (#7719) — the market study of a Research Project: the product and its
 * boundary, the business model, the decision the research serves, its horizon,
 * an optional venture, the customer segments, and the Markets view it started
 * from. Mounted at `/api/research/projects` beside `research_projects.ts`
 * (migration 202611191832_7719_research_studies.sql).
 *
 *   GET  /:uid/study                                 the study (null when none), its segments, the venture link
 *   PUT  /:uid/study                                 create (version 0) or replace the study with the version read
 *   POST /:uid/study/segments                        add a segment
 *   GET  /:uid/study/segments/:segmentUid            one segment, archived ones included
 *   PUT  /:uid/study/segments/:segmentUid            replace a segment with the version read
 *   POST /:uid/study/segments/:segmentUid/archive    archive (never delete)
 *   POST /:uid/study/segments/:segmentUid/restore    restore
 *   POST /:uid/study/segments/reorder                the live segments in their new order
 *   POST /with-study                                 a new project and its study in one batch
 *
 * OWNER-SCOPED. Every route reads the project through `checkProjectOwner`:
 * another member's project is a 404, the same as one that does not exist. An
 * archived project is read-only (409 `project_archived`); a support session
 * cannot write (403 `support_read_only`). Each write leaves a `logAdminAction`
 * receipt naming uids and changed field names, never the text typed.
 *
 * A PUT REPLACES. The body carries every field of the study (or segment); a
 * field not sent is written as not recorded (NULL). The stored version must
 * match the one sent, so a stale write is 409 and changes nothing (the brief
 * route's upsert is the pattern). Version 0 creates the study, so a project
 * made before #7719 can get one.
 *
 * THE VENTURE (owner answer A): at most one, optional. It is accepted only for
 * a venture the caller passes `canAccessProject` for; any other id gets the
 * same refusal as one that does not exist. The link grants nobody access to
 * the study. Every read checks access again, and a venture the caller can no
 * longer read is said to be linked, with no name. Changing or clearing it
 * clears every segment's Validate link in the same batch, and a Validate link
 * is accepted only for a live `customer_segments` row of the linked venture.
 *
 * THE ORIGIN is written once, by `/with-study`, and never edited: the market
 * slug (it must be in the market directory) and name, the tracked sector the
 * Worker reads from its own mapping ('none' when unmapped), and the Markets
 * filters exactly as sent, returned under a key and label that say they were
 * company-location filters in Markets. A segment's customer countries come
 * only from its own field and start empty.
 *
 * Limits are the exported constants below; over a limit is a refusal, never a
 * truncation.
 */
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { logAdminAction } from '../services/adminAudit';
import { canAccessProject } from '../services/projectAccess';
import { listCountries, marketSectorFor } from '../services/researchTaxonomy';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import { checkProjectOwner, defaultTitle, readField } from './research_projects';
import { readRequestId } from './research_project_comparisons';
import { FRESH_BANDS, SOURCE_KINDS } from './research_markets';

const studies = new Hono<{ Bindings: Env }>();
type C = Context<{ Bindings: Env }>;

/** The longest value of each study text field (the migration's CHECKs). */
export const STUDY_LIMITS = { product: 200, product_boundary: 1000, business_model: 500, decision: 1000 } as const;
/** The longest horizon a study may name, in months. */
export const HORIZON_MONTHS_MAX = 120;
/** The longest value of each segment text field (the migration's CHECKs). */
export const SEGMENT_LIMITS = {
  name: 120, buyer: 200, end_user: 200, budget_holder: 200, purchasing_unit: 200,
  size_band: 120, exclusions: 1000, sample_note: 1000, sample_limits: 1000,
} as const;
/** The most live segments one study holds. */
export const SEGMENT_MAX = 12;
/** The most industry codes, and customer countries, one segment names. */
export const INDUSTRY_CODES_MAX = 20;
export const CUSTOMER_COUNTRIES_MAX = 60;
/** The origin's Markets filters: the query length and the number of countries the Markets list accepts. */
export const ORIGIN_QUERY_MAX = 120;
export const ORIGIN_COUNTRIES_MAX = 20;

/**
 * The statistical units and industry schemes a segment may name. #7716 exports
 * the same lists for the observation store; whichever of #7716 and #7719
 * merges second imports the first one's constant (D7719).
 */
export const STATISTICAL_UNITS = ['enterprise', 'establishment', 'legal_unit', 'household', 'consumer_unit', 'person'] as const;
export const INDUSTRY_SCHEMES = ['isic_rev4', 'nace_rev2', 'naics_2022'] as const;

/** Where the origin's Markets filters are returned, and the label that travels with them. */
export const ORIGIN_FILTERS_KEY = 'markets_company_location_filters';
export const ORIGIN_FILTERS_LABEL = 'Company-location filters used in Markets. They describe where companies are based, not where the study’s customers are.';

const STUDY_TEXT = ['product', 'product_boundary', 'business_model', 'decision'] as const;
const SEGMENT_TEXT = ['buyer', 'end_user', 'budget_holder', 'purchasing_unit', 'size_band', 'exclusions', 'sample_note', 'sample_limits'] as const;
const ORIGIN_KEYS = new Set(['market_slug', 'q', 'country', 'fresh', 'src']);
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;
const INDUSTRY_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,15}$/;
const newUid = () => crypto.randomUUID().replace(/-/g, '');

interface StudyRow {
  project_id: number; product: string | null; product_boundary: string | null; business_model: string | null;
  decision: string | null; horizon_months: number | null; origin_market_slug: string | null; origin_market_name: string | null;
  origin_tracked_sector: string | null; origin_filters_json: string | null; venture_project_id: number | null;
  version: number; created_at: string; updated_at: string;
}
interface SegmentRow {
  id: number; uid: string; name: string; buyer: string | null; end_user: string | null; budget_holder: string | null;
  purchasing_unit: string | null; statistical_unit: string | null; industry_scheme: string | null;
  industry_codes_json: string | null; size_band: string | null; customer_countries_json: string | null;
  exclusions: string | null; beachhead: number; validate_segment_id: number | null; validate_name: string | null;
  validate_archived_at: string | null; validate_project_id: number | null; sample_note: string | null;
  sample_limits: string | null; position: number; version: number; archived_at: string | null;
  created_at: string; updated_at: string;
}
type Project = NonNullable<Awaited<ReturnType<typeof checkProjectOwner>>>;
type StudyFields = {
  product: string | null; product_boundary: string | null; business_model: string | null; decision: string | null;
  horizon_months: number | null; venture_id: number | null;
};
type SegmentFields = {
  name: string; buyer: string | null; end_user: string | null; budget_holder: string | null; purchasing_unit: string | null;
  statistical_unit: string | null; industry_scheme: string | null; industry_codes: string[] | null; size_band: string | null;
  customer_countries: string[] | null; exclusions: string | null; beachhead: boolean; validate_segment_id: number | null;
  sample_note: string | null; sample_limits: string | null;
};
type Origin = { market_slug: string; q: string | null; country: string[]; fresh: string | null; src: string | null };
type VentureState = { id: number; name: string } | 'no_access' | 'unreadable' | null;

// ---------------------------------------------------------------------------
// Reading a request
// ---------------------------------------------------------------------------

/** An optional text field: absent, null or blank is not recorded (null); a string is trimmed and must fit. */
export function readText(name: string, value: unknown, limit: number): { value?: string | null; error?: string } {
  if (value === undefined || value === null) return { value: null };
  if (typeof value !== 'string') return { error: `invalid_${name}` };
  const text = value.trim();
  if (!text) return { value: null };
  if (text.length > limit) return { error: `${name}_too_long` };
  return { value: text };
}

/** A positive integer id, or null when absent. */
function readId(name: string, value: unknown): { value?: number | null; error?: string } {
  if (value === undefined || value === null) return { value: null };
  return Number.isSafeInteger(value) && (value as number) > 0 ? { value: value as number } : { error: `invalid_${name}` };
}

/** The study's fields from a body: every field, absent ones as not recorded. */
export function readStudyFields(body: Record<string, unknown>): { fields?: StudyFields; error?: string } {
  const out: Record<string, unknown> = {};
  for (const name of STUDY_TEXT) {
    const f = readText(name, body[name], STUDY_LIMITS[name]);
    if (f.error) return { error: f.error };
    out[name] = f.value;
  }
  const horizon = body.horizon_months;
  if (horizon === undefined || horizon === null) out.horizon_months = null;
  else if (Number.isSafeInteger(horizon) && (horizon as number) >= 1 && (horizon as number) <= HORIZON_MONTHS_MAX) out.horizon_months = horizon;
  else return { error: 'invalid_horizon_months' };
  const venture = readId('venture_id', body.venture_id);
  if (venture.error) return { error: venture.error };
  out.venture_id = venture.value;
  return { fields: out as StudyFields };
}

/** A list of short strings: deduplicated, at most `max`, each matching `re`; empty is null. */
function readList(value: unknown, max: number, re: RegExp, upper: boolean): { value?: string[] | null; error?: 'invalid' | 'too_many' } {
  if (value === undefined || value === null) return { value: null };
  if (!Array.isArray(value)) return { error: 'invalid' };
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return { error: 'invalid' };
    const v = upper ? item.trim().toUpperCase() : item.trim();
    if (!re.test(v)) return { error: 'invalid' };
    if (!out.includes(v)) out.push(v);
  }
  if (out.length > max) return { error: 'too_many' };
  return { value: out.length ? out : null };
}

/** A segment's fields from a body: every field, absent ones as not recorded. Country codes are checked by the caller. */
export function readSegmentFields(body: Record<string, unknown>): { fields?: SegmentFields; error?: string } {
  const name = readText('name', body.name, SEGMENT_LIMITS.name);
  if (name.error) return { error: name.error };
  if (!name.value) return { error: 'name_required' };
  const out: Record<string, unknown> = { name: name.value };
  for (const field of SEGMENT_TEXT) {
    const f = readText(field, body[field], SEGMENT_LIMITS[field]);
    if (f.error) return { error: f.error };
    out[field] = f.value;
  }
  for (const [field, list] of [['statistical_unit', STATISTICAL_UNITS], ['industry_scheme', INDUSTRY_SCHEMES]] as const) {
    const v = body[field];
    if (v === undefined || v === null || v === '') out[field] = null;
    else if (typeof v === 'string' && (list as readonly string[]).includes(v)) out[field] = v;
    else return { error: `invalid_${field}` };
  }
  const codes = readList(body.industry_codes, INDUSTRY_CODES_MAX, INDUSTRY_CODE_RE, false);
  if (codes.error) return { error: codes.error === 'too_many' ? 'too_many_industry_codes' : 'invalid_industry_codes' };
  // A code means nothing without the scheme it belongs to.
  if (codes.value && !out.industry_scheme) return { error: 'industry_scheme_required' };
  out.industry_codes = codes.value;
  const countries = readList(body.customer_countries, CUSTOMER_COUNTRIES_MAX, COUNTRY_RE, true);
  if (countries.error) return { error: countries.error === 'too_many' ? 'too_many_customer_countries' : 'invalid_customer_country' };
  out.customer_countries = countries.value;
  if (body.beachhead !== undefined && body.beachhead !== null && typeof body.beachhead !== 'boolean') return { error: 'invalid_beachhead' };
  out.beachhead = body.beachhead === true;
  const validate = readId('validate_segment_id', body.validate_segment_id);
  if (validate.error) return { error: validate.error };
  out.validate_segment_id = validate.value;
  return { fields: out as SegmentFields };
}

/** The origin's shape: exactly `market_slug`, `q`, `country`, `fresh` and `src`, each checked against its list. */
export function readOrigin(value: unknown): { origin?: Origin | null; error?: string } {
  if (value === undefined || value === null) return { origin: null };
  if (typeof value !== 'object' || Array.isArray(value)) return { error: 'invalid_origin' };
  const o = value as Record<string, unknown>;
  if (Object.keys(o).some((k) => !ORIGIN_KEYS.has(k))) return { error: 'invalid_origin' };
  if (typeof o.market_slug !== 'string' || !SLUG_RE.test(o.market_slug)) return { error: 'unknown_market' };
  let q: string | null = null;
  if (o.q !== undefined && o.q !== null) {
    if (typeof o.q !== 'string') return { error: 'invalid_origin_query' };
    q = o.q.trim() || null;
    if (q && q.length > ORIGIN_QUERY_MAX) return { error: 'origin_query_too_long' };
  }
  const country = readList(o.country, ORIGIN_COUNTRIES_MAX, COUNTRY_RE, true);
  if (country.error) return { error: 'invalid_country' };
  const band = (v: unknown, list: readonly string[]) => (v === undefined || v === null || v === '' ? null : typeof v === 'string' && list.includes(v) ? v : undefined);
  const fresh = band(o.fresh, FRESH_BANDS);
  if (fresh === undefined) return { error: 'invalid_fresh' };
  const src = band(o.src, SOURCE_KINDS);
  if (src === undefined) return { error: 'invalid_src' };
  return { origin: { market_slug: o.market_slug, q, country: country.value || [], fresh, src } };
}

const REFUSALS: Record<string, string> = {
  invalid_body: 'Send the fields as a JSON object.',
  invalid_version: 'Send the version you read; 0 creates the study.',
  invalid_horizon_months: `The horizon is a whole number of months from 1 to ${HORIZON_MONTHS_MAX}.`,
  invalid_venture_id: 'The venture is named by its id.',
  invalid_validate_segment_id: 'The Validate segment is named by its id.',
  name_required: 'A segment needs a name.',
  invalid_statistical_unit: `The statistical unit is one of ${STATISTICAL_UNITS.join(', ')}.`,
  invalid_industry_scheme: `The industry scheme is one of ${INDUSTRY_SCHEMES.join(', ')}.`,
  invalid_industry_codes: 'Each industry code is up to 16 letters, digits, dots or hyphens.',
  too_many_industry_codes: `A segment names at most ${INDUSTRY_CODES_MAX} industry codes.`,
  industry_scheme_required: 'Name the industry scheme the codes belong to.',
  invalid_customer_country: 'Each customer country is a two-letter country code from the country list.',
  too_many_customer_countries: `A segment names at most ${CUSTOMER_COUNTRIES_MAX} customer countries.`,
  invalid_beachhead: 'Beachhead is true or false.',
  invalid_origin: 'The origin holds only market_slug, q, country, fresh and src.',
  unknown_market: 'That market is not in the market directory.',
  invalid_origin_query: 'The Markets search is text.',
  origin_query_too_long: `The Markets search is at most ${ORIGIN_QUERY_MAX} characters.`,
  invalid_country: `A country filter is a two-letter code from the country list, at most ${ORIGIN_COUNTRIES_MAX}.`,
  invalid_fresh: `Source freshness is one of ${FRESH_BANDS.join(', ')}.`,
  invalid_src: `Source type is one of ${SOURCE_KINDS.join(', ')}.`,
  study_empty: 'Write at least one field of the study.',
  invalid_request_id: 'The request id is 8 to 64 letters, digits or hyphens.',
};
/** A 400 for a field code: the code, and its sentence (or one built from a `<field>_too_long` / `invalid_<field>` code). */
function badField(c: C, code: string) {
  const message = REFUSALS[code]
    || (code.endsWith('_too_long') ? `${code.slice(0, -'_too_long'.length).replace(/_/g, ' ')} is longer than its limit.`
      : code.endsWith('_required') ? `${code.slice(0, -'_required'.length).replace(/_/g, ' ')} is required.`
        : 'One of the fields is not in a form this route accepts.');
  return refuse(c, 400, { code, message });
}

const notFound = (c: C) => refuse(c, 404, { code: 'project_not_found', message: 'No such research project.' });

/** The refusal for a write the caller may not make on this project, or null. */
function writeRefusal(c: C, user: User, project: Project) {
  if (user.support_session) return refuse(c, 403, { code: 'support_read_only', message: 'Support sessions cannot change research studies.' });
  if (project.status === 'archived') return refuse(c, 409, { code: 'project_archived', message: 'Restore this project before changing its study.' });
  return null;
}

async function jsonBody(c: C): Promise<Record<string, unknown> | null> {
  const body = await c.req.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
}

/** Customer countries outside the country list, if any. */
async function unknownCountries(env: Env, codes: string[] | null): Promise<boolean> {
  if (!codes?.length) return false;
  const known = new Set((await listCountries(env)).map((r) => r.code));
  return codes.some((code) => !known.has(code));
}

// ---------------------------------------------------------------------------
// The venture and the Validate segment
// ---------------------------------------------------------------------------

/** The venture by id when the caller may read it now; null for one that does not exist and for one they cannot read alike. */
async function readableVenture(env: Env, user: User, id: number): Promise<{ id: number; name: string } | null> {
  const row = await env.DB.prepare(
    'SELECT id, name, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL',
  ).bind(id).first<{ id: number; name: string; founder_id: number | null }>();
  if (!row) return null;
  return (await canAccessProject(env, user, { id: row.id, founder_id: row.founder_id })) ? { id: row.id, name: row.name } : null;
}

/** The link as this caller may see it, checked again on every read. */
async function ventureState(env: Env, user: User, id: number | null): Promise<VentureState> {
  if (id == null) return null;
  try {
    return (await readableVenture(env, user, id)) || 'no_access';
  } catch {
    return 'unreadable';
  }
}

function ventureDto(v: VentureState) {
  if (v === null) return null;
  if (v === 'no_access') return { linked: true, state: 'no_access', message: 'A venture is linked that you can no longer read.' };
  if (v === 'unreadable') return { linked: true, state: 'unreadable', message: 'The linked venture could not be read just now.' };
  return { linked: true, state: 'readable', id: v.id, name: v.name };
}

const VENTURE_NOT_FOUND = { code: 'venture_not_found', message: 'No venture you can open has that id.' };
const VALIDATE_NOT_FOUND = { code: 'validate_segment_not_found', message: 'No live Validate segment of the linked venture has that id.' };

/** Whether a Validate segment may be linked: a live `customer_segments` row of the study's venture, which the caller can read. */
async function validateSegmentAllowed(env: Env, user: User, ventureId: number | null, segmentId: number): Promise<boolean> {
  if (ventureId == null) return false;
  if (!(await readableVenture(env, user, ventureId))) return false;
  const row = await env.DB.prepare(
    'SELECT id FROM customer_segments WHERE id = ? AND project_id = ? AND archived_at IS NULL',
  ).bind(segmentId, ventureId).first<{ id: number }>();
  return Boolean(row);
}

// ---------------------------------------------------------------------------
// Reading the store
// ---------------------------------------------------------------------------

const STUDY_SELECT = `SELECT project_id, product, product_boundary, business_model, decision, horizon_months,
  origin_market_slug, origin_market_name, origin_tracked_sector, origin_filters_json, venture_project_id,
  version, created_at, updated_at FROM research_studies WHERE project_id = ?`;
const readStudy = (env: Env, projectId: number) => env.DB.prepare(STUDY_SELECT).bind(projectId).first<StudyRow>();

const SEGMENT_SELECT = `SELECT g.id, g.uid, g.name, g.buyer, g.end_user, g.budget_holder, g.purchasing_unit, g.statistical_unit,
  g.industry_scheme, g.industry_codes_json, g.size_band, g.customer_countries_json, g.exclusions, g.beachhead,
  g.validate_segment_id, cs.name AS validate_name, cs.archived_at AS validate_archived_at, cs.project_id AS validate_project_id,
  g.sample_note, g.sample_limits, g.position, g.version, g.archived_at, g.created_at, g.updated_at
  FROM research_study_segments g LEFT JOIN customer_segments cs ON cs.id = g.validate_segment_id`;
const SEGMENT_BY_UID = SEGMENT_SELECT + ' WHERE g.project_id = ? AND g.uid = ?';
const SEGMENTS_OF_STUDY = SEGMENT_SELECT + ' WHERE g.project_id = ? ORDER BY g.position, g.id';
const readSegment = (env: Env, projectId: number, uid: string) =>
  env.DB.prepare(SEGMENT_BY_UID).bind(projectId, uid).first<SegmentRow>();

function list(json: string | null): string[] {
  try { const v = JSON.parse(json || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
}

function originDto(r: StudyRow) {
  if (!r.origin_market_slug) return null;
  let filters: Record<string, unknown> = {};
  try { filters = JSON.parse(r.origin_filters_json || '{}') || {}; } catch { filters = {}; }
  return {
    market: { slug: r.origin_market_slug, name: r.origin_market_name },
    tracked_sector: r.origin_tracked_sector ? { state: 'tracked', name: r.origin_tracked_sector } : { state: 'none' },
    [ORIGIN_FILTERS_KEY]: {
      label: ORIGIN_FILTERS_LABEL,
      q: typeof filters.q === 'string' ? filters.q : null,
      country: Array.isArray(filters.country) ? filters.country : [],
      fresh: typeof filters.fresh === 'string' ? filters.fresh : null,
      src: typeof filters.src === 'string' ? filters.src : null,
    },
  };
}

const studyDto = (r: StudyRow) => ({
  product: r.product, product_boundary: r.product_boundary, business_model: r.business_model, decision: r.decision,
  horizon_months: r.horizon_months, origin: originDto(r), version: r.version, created_at: r.created_at, updated_at: r.updated_at,
});

/** A segment; its Validate link is named only while the caller can read the venture. */
function segmentDto(r: SegmentRow, venture: VentureState) {
  let validate: Record<string, unknown> | null = null;
  if (r.validate_segment_id != null) {
    validate = venture && typeof venture === 'object'
      ? { state: 'readable', id: r.validate_segment_id, name: r.validate_name, archived: Boolean(r.validate_archived_at) }
      : { state: venture === 'unreadable' ? 'unreadable' : 'no_access' };
  }
  return {
    uid: r.uid, name: r.name, buyer: r.buyer, end_user: r.end_user, budget_holder: r.budget_holder,
    purchasing_unit: r.purchasing_unit, statistical_unit: r.statistical_unit, industry_scheme: r.industry_scheme,
    industry_codes: list(r.industry_codes_json), size_band: r.size_band, customer_countries: list(r.customer_countries_json),
    exclusions: r.exclusions, beachhead: Boolean(r.beachhead), validate_segment: validate,
    sample_note: r.sample_note, sample_limits: r.sample_limits, position: r.position, version: r.version,
    archived: Boolean(r.archived_at), archived_at: r.archived_at, created_at: r.created_at, updated_at: r.updated_at,
  };
}

/** The whole read: the study or null, the venture link, the live segments in order and the archived ones. */
async function studyResponse(env: Env, user: User, projectId: number) {
  const row = await readStudy(env, projectId);
  if (!row) return { study: null, venture: null, segments: [], archived_segments: [] };
  const venture = await ventureState(env, user, row.venture_project_id);
  const segs = await env.DB.prepare(SEGMENTS_OF_STUDY).bind(projectId).all<SegmentRow>();
  const all = segs.results || [];
  return {
    study: studyDto(row),
    venture: ventureDto(venture),
    segments: all.filter((s) => !s.archived_at).map((s) => segmentDto(s, venture)),
    archived_segments: all.filter((s) => s.archived_at).map((s) => segmentDto(s, venture)),
  };
}

// ---------------------------------------------------------------------------
// The study
// ---------------------------------------------------------------------------

studies.get('/:uid/study', async (c) => {
  const user = await requireAuth(c);
  const project = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
  if (!project) return notFound(c);
  return c.json(await studyResponse(c.env, user, project.id));
});

studies.put('/:uid/study', async (c) => {
  const user = await requireAuth(c);
  const project = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
  if (!project) return notFound(c);
  const refused = writeRefusal(c, user, project);
  if (refused) return refused;
  const body = await jsonBody(c);
  if (!body) return badField(c, 'invalid_body');
  const version = body.version;
  if (!Number.isSafeInteger(version) || (version as number) < 0) return badField(c, 'invalid_version');
  const read = readStudyFields(body);
  if (!read.fields) return badField(c, read.error!);
  const f = read.fields;
  const current = await readStudy(c.env, project.id);
  // An empty study is never stored; a study made from Markets keeps its origin, which is content.
  if (!current?.origin_market_slug && STUDY_TEXT.every((n) => f[n] == null) && f.horizon_months == null && f.venture_id == null) {
    return badField(c, 'study_empty');
  }
  const was = current?.venture_project_id ?? null;
  const ventureChanged = was !== f.venture_id;
  if (ventureChanged && f.venture_id != null && !(await readableVenture(c.env, user, f.venture_id))) {
    return refuse(c, 404, VENTURE_NOT_FOUND);
  }
  const statements = [c.env.DB.prepare(
    `INSERT INTO research_studies (project_id, owner_user_id, product, product_boundary, business_model, decision, horizon_months, venture_project_id, created_by)
     SELECT id, owner_user_id, ?, ?, ?, ?, ?, ?, ? FROM research_projects
      WHERE id = ? AND owner_user_id = ? AND status <> 'archived'
        AND (? = 0 OR EXISTS (SELECT 1 FROM research_studies WHERE project_id = ?))
     ON CONFLICT(project_id) DO UPDATE SET product = excluded.product, product_boundary = excluded.product_boundary,
       business_model = excluded.business_model, decision = excluded.decision, horizon_months = excluded.horizon_months,
       venture_project_id = excluded.venture_project_id, version = research_studies.version + 1, updated_at = datetime('now')
     WHERE research_studies.version = ?`,
  ).bind(f.product, f.product_boundary, f.business_model, f.decision, f.horizon_months, f.venture_id, user.id,
    project.id, user.id, version, project.id, version)];
  if (ventureChanged) {
    // Only when the study write just before it changed a row (`changes()` reads the statement before, inside
    // the same batch, as adminAuditStatement's onlyIfChanged does): a refused or stale write clears nothing.
    statements.push(c.env.DB.prepare(
      `UPDATE research_study_segments SET validate_segment_id = NULL, version = version + 1, updated_at = datetime('now')
        WHERE project_id = ? AND validate_segment_id IS NOT NULL AND changes() > 0`,
    ).bind(project.id));
  }
  const results = await c.env.DB.batch(statements);
  if (!Number(results[0]?.meta?.changes || 0)) {
    return refuse(c, 409, { code: 'study_changed', message: 'This study or its project changed. Read it again before saving.' });
  }
  const fields: string[] = [...STUDY_TEXT, 'horizon_months'].filter((n) => (current?.[n as keyof StudyRow] ?? null) !== f[n as keyof StudyFields]);
  if (ventureChanged) fields.push('venture_id');
  await logAdminAction(c.env, user.id, user.email, current ? 'research_study_updated' : 'research_study_created', {
    project_uid: project.uid, fields, validate_links_cleared: ventureChanged ? Number(results[1]?.meta?.changes || 0) : 0,
  });
  return c.json(await studyResponse(c.env, user, project.id), current ? 200 : 201);
});

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

/** Field names that differ between a stored segment and the fields to write. */
function changedSegmentFields(before: SegmentRow | null, f: SegmentFields): string[] {
  const now: Record<string, unknown> = {
    ...f, industry_codes: f.industry_codes ? JSON.stringify(f.industry_codes) : null,
    customer_countries: f.customer_countries ? JSON.stringify(f.customer_countries) : null, beachhead: f.beachhead ? 1 : 0,
  };
  const was = (name: string): unknown => {
    if (!before) return null;
    if (name === 'industry_codes') return before.industry_codes_json;
    if (name === 'customer_countries') return before.customer_countries_json;
    if (name === 'beachhead') return before.beachhead ? 1 : 0;
    return (before as unknown as Record<string, unknown>)[name] ?? null;
  };
  return Object.keys(now).filter((name) => (now[name] ?? null) !== was(name) && (before || now[name] !== null && now[name] !== 0));
}

/** Reads and checks a segment body against the study: fields, countries, Validate link. A refusal, or the fields. */
async function segmentFields(c: C, user: User, study: StudyRow, body: Record<string, unknown>, keepValidate: number | null) {
  const read = readSegmentFields(body);
  if (!read.fields) return { response: badField(c, read.error!) };
  const f = read.fields;
  if (await unknownCountries(c.env, f.customer_countries)) return { response: badField(c, 'invalid_customer_country') };
  if (f.validate_segment_id != null && f.validate_segment_id !== keepValidate
    && !(await validateSegmentAllowed(c.env, user, study.venture_project_id, f.validate_segment_id))) {
    return { response: refuse(c, 404, VALIDATE_NOT_FOUND) };
  }
  return { fields: f };
}

const beachheadTaken = (c: C) => refuse(c, 409, { code: 'beachhead_taken', message: 'Another live segment is already the beachhead. Clear it first.' });
const segmentLimit = (c: C) => refuse(c, 409, { code: 'segment_limit', message: `A study holds at most ${SEGMENT_MAX} live segments. Archive one first.` });
const segmentNotFound = (c: C) => refuse(c, 404, { code: 'segment_not_found', message: 'No such segment in this study.' });

async function liveCounts(env: Env, projectId: number, exceptId = 0) {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN beachhead = 1 AND id <> ? THEN 1 ELSE 0 END), 0) AS beachheads
       FROM research_study_segments WHERE project_id = ? AND archived_at IS NULL`,
  ).bind(exceptId, projectId).first<{ n: number; beachheads: number }>();
  return { live: Number(r?.n || 0), beachheads: Number(r?.beachheads || 0) };
}

const isUnique = (e: unknown) => /UNIQUE/i.test(String((e as Error)?.message || e));

studies.post('/:uid/study/segments', async (c) => {
  const user = await requireAuth(c);
  const project = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
  if (!project) return notFound(c);
  const refused = writeRefusal(c, user, project);
  if (refused) return refused;
  const study = await readStudy(c.env, project.id);
  if (!study) return refuse(c, 409, { code: 'study_required', message: 'Write the study before adding segments.' });
  const body = await jsonBody(c);
  if (!body) return badField(c, 'invalid_body');
  const read = await segmentFields(c, user, study, body, null);
  if (!read.fields) return read.response;
  const f = read.fields;
  const counts = await liveCounts(c.env, project.id);
  if (counts.live >= SEGMENT_MAX) return segmentLimit(c);
  if (f.beachhead && counts.beachheads) return beachheadTaken(c);
  const uid = newUid();
  try {
    const r = await c.env.DB.prepare(
      `INSERT INTO research_study_segments (uid, project_id, name, buyer, end_user, budget_holder, purchasing_unit,
         statistical_unit, industry_scheme, industry_codes_json, size_band, customer_countries_json, exclusions, beachhead,
         validate_segment_id, sample_note, sample_limits, position, created_by)
       SELECT ?, s.project_id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              (SELECT COALESCE(MAX(position), 0) + 1 FROM research_study_segments WHERE project_id = s.project_id), ?
         FROM research_studies s JOIN research_projects p ON p.id = s.project_id
        WHERE s.project_id = ? AND p.owner_user_id = ? AND p.status <> 'archived'`,
    ).bind(uid, f.name, f.buyer, f.end_user, f.budget_holder, f.purchasing_unit, f.statistical_unit, f.industry_scheme,
      f.industry_codes ? JSON.stringify(f.industry_codes) : null, f.size_band,
      f.customer_countries ? JSON.stringify(f.customer_countries) : null, f.exclusions, f.beachhead ? 1 : 0,
      f.validate_segment_id, f.sample_note, f.sample_limits, user.id, project.id, user.id).run();
    if (!Number(r.meta?.changes || 0)) return refuse(c, 409, { code: 'study_changed', message: 'This study or its project changed. Read it again before saving.' });
  } catch (e) {
    if (isUnique(e)) return beachheadTaken(c);
    throw e;
  }
  await logAdminAction(c.env, user.id, user.email, 'research_study_segment_created', {
    project_uid: project.uid, segment_uid: uid, fields: changedSegmentFields(null, f),
  });
  const saved = await readSegment(c.env, project.id, uid);
  return c.json({ segment: saved ? segmentDto(saved, await ventureState(c.env, user, study.venture_project_id)) : { uid } }, 201);
});

studies.post('/:uid/study/segments/reorder', async (c) => {
  const user = await requireAuth(c);
  const project = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
  if (!project) return notFound(c);
  const refused = writeRefusal(c, user, project);
  if (refused) return refused;
  const body = await jsonBody(c);
  const uids = body?.uids;
  const live = await c.env.DB.prepare(
    'SELECT uid FROM research_study_segments WHERE project_id = ? AND archived_at IS NULL',
  ).bind(project.id).all<{ uid: string }>();
  const have = new Set((live.results || []).map((r) => r.uid));
  if (!Array.isArray(uids) || uids.length !== have.size || new Set(uids).size !== uids.length || !uids.every((u) => typeof u === 'string' && have.has(u))) {
    return refuse(c, 400, { code: 'invalid_order', message: 'Send every live segment of the study once, in the new order.' });
  }
  if (uids.length) {
    await c.env.DB.batch((uids as string[]).map((uid, i) => c.env.DB.prepare(
      "UPDATE research_study_segments SET position = ?, updated_at = datetime('now') WHERE project_id = ? AND uid = ? AND archived_at IS NULL",
    ).bind(i + 1, project.id, uid)));
  }
  await logAdminAction(c.env, user.id, user.email, 'research_study_segments_reordered', { project_uid: project.uid, segment_uids: uids });
  return c.json(await studyResponse(c.env, user, project.id));
});

studies.get('/:uid/study/segments/:segmentUid', async (c) => {
  const user = await requireAuth(c);
  const project = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
  if (!project) return notFound(c);
  const row = await readSegment(c.env, project.id, c.req.param('segmentUid'));
  if (!row) return segmentNotFound(c);
  const study = await readStudy(c.env, project.id);
  return c.json({ segment: segmentDto(row, await ventureState(c.env, user, study?.venture_project_id ?? null)) });
});

studies.put('/:uid/study/segments/:segmentUid', async (c) => {
  const user = await requireAuth(c);
  const project = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
  if (!project) return notFound(c);
  const refused = writeRefusal(c, user, project);
  if (refused) return refused;
  const row = await readSegment(c.env, project.id, c.req.param('segmentUid'));
  const study = await readStudy(c.env, project.id);
  if (!row || !study) return segmentNotFound(c);
  if (row.archived_at) return refuse(c, 409, { code: 'segment_archived', message: 'Restore this segment before editing it.' });
  const body = await jsonBody(c);
  if (!body) return badField(c, 'invalid_body');
  const version = body.version;
  if (!Number.isSafeInteger(version) || (version as number) < 1) return badField(c, 'invalid_version');
  const read = await segmentFields(c, user, study, body, row.validate_segment_id);
  if (!read.fields) return read.response;
  const f = read.fields;
  if (f.beachhead && (await liveCounts(c.env, project.id, row.id)).beachheads) return beachheadTaken(c);
  let changes = 0;
  try {
    const r = await c.env.DB.prepare(
      `UPDATE research_study_segments
          SET name = ?, buyer = ?, end_user = ?, budget_holder = ?, purchasing_unit = ?, statistical_unit = ?, industry_scheme = ?,
              industry_codes_json = ?, size_band = ?, customer_countries_json = ?, exclusions = ?, beachhead = ?,
              validate_segment_id = ?, sample_note = ?, sample_limits = ?, version = version + 1, updated_at = datetime('now')
        WHERE id = ? AND project_id = ? AND version = ? AND archived_at IS NULL
          AND EXISTS (SELECT 1 FROM research_projects WHERE id = ? AND owner_user_id = ? AND status <> 'archived')`,
    ).bind(f.name, f.buyer, f.end_user, f.budget_holder, f.purchasing_unit, f.statistical_unit, f.industry_scheme,
      f.industry_codes ? JSON.stringify(f.industry_codes) : null, f.size_band,
      f.customer_countries ? JSON.stringify(f.customer_countries) : null, f.exclusions, f.beachhead ? 1 : 0,
      f.validate_segment_id, f.sample_note, f.sample_limits, row.id, project.id, version, project.id, user.id).run();
    changes = Number(r.meta?.changes || 0);
  } catch (e) {
    if (isUnique(e)) return beachheadTaken(c);
    throw e;
  }
  if (!changes) return refuse(c, 409, { code: 'segment_changed', message: 'This segment changed. Read it again before saving.' });
  await logAdminAction(c.env, user.id, user.email, 'research_study_segment_updated', {
    project_uid: project.uid, segment_uid: row.uid, fields: changedSegmentFields(row, f),
  });
  const saved = await readSegment(c.env, project.id, row.uid);
  return c.json({ segment: saved ? segmentDto(saved, await ventureState(c.env, user, study.venture_project_id)) : null });
});

for (const action of ['archive', 'restore'] as const) {
  studies.post(`/:uid/study/segments/:segmentUid/${action}`, async (c) => {
    const user = await requireAuth(c);
    const project = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
    if (!project) return notFound(c);
    const refused = writeRefusal(c, user, project);
    if (refused) return refused;
    const row = await readSegment(c.env, project.id, c.req.param('segmentUid'));
    if (!row) return segmentNotFound(c);
    if (action === 'archive' && row.archived_at) return refuse(c, 409, { code: 'segment_archived', message: 'This segment is already archived.' });
    if (action === 'restore' && !row.archived_at) return refuse(c, 409, { code: 'segment_not_archived', message: 'This segment is not archived.' });
    if (action === 'restore') {
      const counts = await liveCounts(c.env, project.id);
      if (counts.live >= SEGMENT_MAX) return segmentLimit(c);
      if (row.beachhead && counts.beachheads) return beachheadTaken(c);
    }
    try {
      await c.env.DB.prepare(action === 'archive'
        ? "UPDATE research_study_segments SET archived_at = datetime('now'), version = version + 1, updated_at = datetime('now') WHERE id = ? AND archived_at IS NULL"
        : `UPDATE research_study_segments SET archived_at = NULL, version = version + 1, updated_at = datetime('now'),
             position = (SELECT COALESCE(MAX(position), 0) + 1 FROM research_study_segments WHERE project_id = ? AND archived_at IS NULL)
           WHERE id = ? AND archived_at IS NOT NULL`,
      ).bind(...(action === 'archive' ? [row.id] : [project.id, row.id])).run();
    } catch (e) {
      if (isUnique(e)) return beachheadTaken(c);
      throw e;
    }
    await logAdminAction(c.env, user.id, user.email, `research_study_segment_${action === 'archive' ? 'archived' : 'restored'}`, {
      project_uid: project.uid, segment_uid: row.uid,
    });
    const saved = await readSegment(c.env, project.id, row.uid);
    const study = await readStudy(c.env, project.id);
    return c.json({ segment: saved ? segmentDto(saved, await ventureState(c.env, user, study?.venture_project_id ?? null)) : null });
  });
}

// ---------------------------------------------------------------------------
// A new project and its study, together (from Markets)
// ---------------------------------------------------------------------------

studies.post('/with-study', async (c) => {
  const user = await requireAuth(c);
  if (user.support_session) return refuse(c, 403, { code: 'support_read_only', message: 'Support sessions cannot create research projects.' });
  const body = await jsonBody(c);
  const asked = body?.project;
  if (!body || !asked || typeof asked !== 'object' || Array.isArray(asked)) return badField(c, 'invalid_body');
  const p = asked as Record<string, unknown>;
  const question = readField('question', p.question);
  if (question.error || question.value == null) return badField(c, question.error || 'question_required');
  const titleIn = p.title === undefined || p.title === null || p.title === '' ? undefined : p.title;
  const title = titleIn === undefined ? { value: defaultTitle(question.value) } : readField('title', titleIn);
  if (title.error || !title.value) return badField(c, title.error || 'title_required');
  const projectFields: Record<string, string | null> = {};
  for (const name of ['objective', 'scope', 'exclusions'] as const) {
    const f = readField(name, p[name]);
    if (f.error) return badField(c, f.error);
    projectFields[name] = f.value ?? null;
  }
  const studyIn = body.study === undefined || body.study === null ? {} : body.study;
  if (typeof studyIn !== 'object' || Array.isArray(studyIn)) return badField(c, 'invalid_body');
  const read = readStudyFields(studyIn as Record<string, unknown>);
  if (!read.fields) return badField(c, read.error!);
  const f = read.fields;
  const origin = readOrigin(body.origin);
  if (origin.error) return badField(c, origin.error);
  const o = origin.origin ?? null;
  if (!o && STUDY_TEXT.every((n) => f[n] == null) && f.horizon_months == null && f.venture_id == null) return badField(c, 'study_empty');
  const requestId = readRequestId(body.request_id);
  if (requestId.error) return badField(c, requestId.error);
  const rid = requestId.value ?? null;

  // A repeat of a form already saved answers with the first project and writes nothing.
  const firstProject = async () => rid
    ? c.env.DB.prepare(
      `SELECT p.id, p.uid FROM research_studies s JOIN research_projects p ON p.id = s.project_id
        WHERE s.owner_user_id = ? AND s.request_id = ? AND p.owner_user_id = ?`,
    ).bind(user.id, rid, user.id).first<{ id: number; uid: string }>()
    : null;
  const repeat = async (first: { id: number; uid: string }) =>
    c.json({ project: { uid: first.uid }, request_id: rid, repeat: true, rolled_back: false, ...(await studyResponse(c.env, user, first.id)) }, 200);
  const first = await firstProject();
  if (first) return repeat(first);

  let market: { slug: string; name: string } | null = null;
  let sector: string | null = null;
  if (o) {
    market = await c.env.DB.prepare('SELECT slug, name FROM research_market_directory WHERE slug = ?')
      .bind(o.market_slug).first<{ slug: string; name: string }>();
    if (!market) return badField(c, 'unknown_market');
    if (await unknownCountries(c.env, o.country)) return badField(c, 'invalid_country');
    // The tracked sector is the Worker's own mapping, never the request's.
    sector = (await marketSectorFor(c.env, market.slug))?.mi_sector ?? null;
  }
  if (f.venture_id != null && !(await readableVenture(c.env, user, f.venture_id))) return refuse(c, 404, VENTURE_NOT_FOUND);

  const projectUid = newUid();
  const filters = o ? JSON.stringify({ q: o.q, country: o.country, fresh: o.fresh, src: o.src }) : null;
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO research_projects (uid, owner_user_id, title, question, objective, scope, exclusions, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(projectUid, user.id, title.value, question.value, projectFields.objective, projectFields.scope, projectFields.exclusions, user.id),
    c.env.DB.prepare(
      `INSERT INTO research_studies (project_id, owner_user_id, product, product_boundary, business_model, decision, horizon_months,
         origin_market_slug, origin_market_name, origin_tracked_sector, origin_filters_json, venture_project_id, request_id, created_by)
       SELECT id, owner_user_id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM research_projects WHERE uid = ? AND owner_user_id = ?`,
    ).bind(f.product, f.product_boundary, f.business_model, f.decision, f.horizon_months,
      market?.slug ?? null, market?.name ?? null, sector, filters, f.venture_id, rid, user.id, projectUid, user.id),
  ];
  try {
    await c.env.DB.batch(statements);
  } catch {
    // The batch is one transaction. Say what the database holds, never what we hope it holds.
    try {
      const raced = await firstProject();
      if (raced) return repeat(raced);
      const kept = await checkProjectOwner(c.env, projectUid, user.id);
      if (!kept) {
        return refuse(c, 500, { code: 'save_rolled_back', message: 'Nothing was saved: every write of this save was undone.', extra: { rolled_back: true } });
      }
    } catch {
      return refuse(c, 503, { code: 'save_outcome_unknown', message: 'The save may not have finished. Check My Research before saving again.', extra: { rolled_back: null } });
    }
  }
  const project = await checkProjectOwner(c.env, projectUid, user.id);
  await logAdminAction(c.env, user.id, user.email, 'research_project_created', { project_uid: projectUid });
  await logAdminAction(c.env, user.id, user.email, 'research_study_created', {
    project_uid: projectUid,
    fields: [...STUDY_TEXT, 'horizon_months', 'venture_id'].filter((n) => f[n as keyof StudyFields] != null).concat(o ? ['origin'] : []),
    validate_links_cleared: 0,
  });
  return c.json({
    project: { uid: projectUid, title: project?.title ?? title.value }, request_id: rid, repeat: false, rolled_back: false,
    ...(await studyResponse(c.env, user, project?.id ?? 0)),
  }, 201);
});

export const mount: RouteMount = { path: '/api/research/projects', router: studies };
export default studies;
