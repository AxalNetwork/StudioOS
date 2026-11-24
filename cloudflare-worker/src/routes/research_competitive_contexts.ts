/**
 * D7835 (#7835) — saved competitive contexts: a member's own product or a directory record, the
 * target buyer and segment, the customer problem and use case, customer countries, business and
 * delivery model, the purpose of the research, a tracked market and ordered comparison criteria,
 * written once and reused (migration 202611241146_7835_research_competitive_contexts.sql).
 *
 *   GET    /api/research/competitive-contexts                       the caller's contexts, newest first
 *   POST   /api/research/competitive-contexts                       create (version 1)
 *   GET    /api/research/competitive-contexts/:uid                  one context
 *   PUT    /api/research/competitive-contexts/:uid                  replace, naming the version read
 *   DELETE /api/research/competitive-contexts/:uid?version=N        delete, naming the version read
 *   GET    /api/research/competitive-contexts/:uid/versions/:n      a saved version exactly as it was
 *
 * OWNER-PRIVATE. Every route reads the context by uid and the caller's id: another member's context
 * is a 404, the same as one that does not exist. A support session reads as the member and cannot
 * write (403 `support_read_only`). A write naming a version that is no longer current is a 409
 * that returns the current version and changes nothing.
 *
 * A DIRECTORY RECORD is read through the served rows (researchCompanyRead, D7819) under the
 * Companies rule (D7178). A record that is not served, or a caller the rule does not admit, gets
 * one refusal that never names the record. A read shows the record's name only while both still
 * hold. A context holds no link to a study, a study segment or a Research Project; #7719 owns those.
 *
 * Each write leaves a `logAdminAction` receipt naming the context uid and the changed field
 * names, never the text typed.
 */
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { logAdminAction } from '../services/adminAudit';
import { admitsCompanies } from '../services/researchCompaniesAccess';
import { readCompanyByUid } from '../services/researchCompanyRead';
import { COMPANY_FACT_ATTRIBUTES } from '../services/researchCompanyFacts';
import {
  CONTEXTS_PER_OWNER_MAX, CONTEXT_LIMITS, CUSTOMER_COUNTRIES_MAX, changedFields, columnValues, contextDto,
  countriesKnown, listOwnContexts, marketKnown, readContextFields, readOwnContext, rowFields, type ContextFields,
} from '../services/competitiveContexts';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';

const contexts = new Hono<{ Bindings: Env }>();
type C = Context<{ Bindings: Env }>;

const REFUSALS: Record<string, string> = {
  invalid_body: 'Send the fields as a JSON object.',
  invalid_version: 'Send the version you read.',
  name_required: 'A context needs a name.',
  invalid_directory_record_uid: 'A directory record is named by its uid.',
  product_or_record: 'Name your own product or a directory record, not both.',
  invalid_customer_country: 'Each customer country is a two-letter country code from the country list.',
  too_many_customer_countries: `A context names at most ${CUSTOMER_COUNTRIES_MAX} customer countries.`,
  unknown_market: 'That market is not in the market directory.',
  invalid_criteria: 'Comparison criteria are a list.',
  unknown_criterion: `Each comparison criterion is one of ${COMPANY_FACT_ATTRIBUTES.join(', ')}.`,
  duplicate_criterion: 'Each comparison criterion is named once.',
};

/** A 400 for a field code, with its sentence (or one built from `<field>_too_long` / `invalid_<field>`). */
function badField(c: C, code: string) {
  const field = code.endsWith('_too_long') ? code.slice(0, -'_too_long'.length) : '';
  const message = REFUSALS[code]
    || (field ? `${field.replace(/_/g, ' ')} is longer than its limit of ${CONTEXT_LIMITS[field as keyof typeof CONTEXT_LIMITS] ?? 'its'} characters.`
      : 'One of the fields is not in a form this route accepts.');
  return refuse(c, 400, { code, message });
}

const notFound = (c: C) => refuse(c, 404, { code: 'context_not_found', message: 'No such competitive context.' });
const recordUnavailable = (c: C) =>
  refuse(c, 404, { code: 'directory_record_not_available', message: 'No directory record you can open has that id.' });
const stale = (c: C, current: number) =>
  refuse(c, 409, {
    code: 'context_changed',
    message: 'This context changed since you read it. Read it again before saving.',
    extra: { current_version: current },
  });

/** The refusal for a write by this caller, or null. */
function writeRefusal(c: C, user: User) {
  if (user.support_session) return refuse(c, 403, { code: 'support_read_only', message: 'Support sessions cannot change competitive contexts.' });
  return null;
}

async function jsonBody(c: C): Promise<Record<string, unknown> | null> {
  const body = await c.req.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

/** The record when the directory serves it in full and the Companies rule admits the caller; otherwise null. */
async function servedRecord(env: Env, user: User, uid: string): Promise<{ uid: string; name: string } | null> {
  if (!admitsCompanies(user)) return null;
  const row = (await readCompanyByUid(env, uid)) as Record<string, unknown> | undefined;
  if (!row || typeof row.name !== 'string' || !('id' in row)) return null;
  return { uid: String(row.uid ?? uid), name: row.name };
}

/** The directory record as this caller may see it now: its name only while it is served to them. */
async function recordState(env: Env, user: User, uid: string | null) {
  if (!uid) return null;
  try {
    const record = await servedRecord(env, user, uid);
    return record ? { uid, state: 'served', name: record.name } : { uid, state: 'not_available' };
  } catch {
    return { uid, state: 'unreadable' };
  }
}

/** Checks the fields against the country list, the market directory and the served rows. A refusal, or null. */
async function checkFields(c: C, user: User, f: ContextFields, keepRecord: string | null) {
  if (!(await countriesKnown(c.env, f.customer_countries))) return badField(c, 'invalid_customer_country');
  if (!(await marketKnown(c.env, f.market_slug))) return badField(c, 'unknown_market');
  if (f.directory_record_uid && f.directory_record_uid !== keepRecord && !(await servedRecord(c.env, user, f.directory_record_uid))) {
    return recordUnavailable(c);
  }
  return null;
}

/**
 * The statement that copies the context's new version into its history, in the same batch as the
 * update. `changes()` reads the statement just before it, so a stale or refused update copies nothing.
 */
const snapshot = (env: Env, id: number, f: ContextFields) =>
  env.DB.prepare(
    `INSERT INTO research_competitive_context_versions (context_id, version, fields_json)
     SELECT id, version, ? FROM research_competitive_contexts WHERE id = ? AND changes() > 0`,
  ).bind(JSON.stringify(f), id);

const readOwn = (c: C, user: User) => readOwnContext(c.env, c.req.param('uid') || '', user.id);

contexts.get('/', async (c) => {
  const user = await requireAuth(c);
  const items = [];
  for (const r of await listOwnContexts(c.env, user.id)) items.push(contextDto(r, await recordState(c.env, user, r.directory_record_uid)));
  return c.json({ items });
});

contexts.post('/', async (c) => {
  const user = await requireAuth(c);
  const refused = writeRefusal(c, user);
  if (refused) return refused;
  const body = await jsonBody(c);
  if (!body) return badField(c, 'invalid_body');
  const read = readContextFields(body);
  if (!read.fields) return badField(c, read.error!.code);
  const f = read.fields;
  const checked = await checkFields(c, user, f, null);
  if (checked) return checked;
  const uid = crypto.randomUUID().replace(/-/g, '');
  // The context and its first saved version in one batch; the version is copied only when the insert wrote.
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO research_competitive_contexts (uid, owner_user_id, name, product, directory_record_uid, buyer,
         customer_segment, customer_problem, use_case, customer_countries_json, business_model, delivery_model, purpose,
         market_slug, criteria_json)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE (SELECT COUNT(*) FROM research_competitive_contexts WHERE owner_user_id = ?) < ?`,
    ).bind(uid, user.id, ...columnValues(f), user.id, CONTEXTS_PER_OWNER_MAX),
    c.env.DB.prepare(
      `INSERT INTO research_competitive_context_versions (context_id, version, fields_json)
       SELECT id, version, ? FROM research_competitive_contexts WHERE uid = ? AND changes() > 0`,
    ).bind(JSON.stringify(f), uid),
  ]);
  if (!Number(results[0]?.meta?.changes || 0)) {
    return refuse(c, 409, { code: 'context_limit', message: `You keep at most ${CONTEXTS_PER_OWNER_MAX} competitive contexts. Delete one first.` });
  }
  const row = (await readOwnContext(c.env, uid, user.id))!;
  await logAdminAction(c.env, user.id, user.email, 'research_competitive_context_created', { context_uid: uid, fields: changedFields(null, f) });
  return c.json(contextDto(row, await recordState(c.env, user, row.directory_record_uid)), 201);
});

/** A context the caller owns, or null. Named for the access check it is. */
const requireContextOwner = (c: C, user: User) => readOwn(c, user);

contexts.get('/:uid', async (c) => {
  const user = await requireAuth(c);
  const row = await requireContextOwner(c, user);
  if (!row) return notFound(c);
  return c.json(contextDto(row, await recordState(c.env, user, row.directory_record_uid)));
});

contexts.put('/:uid', async (c) => {
  const user = await requireAuth(c);
  const row = await requireContextOwner(c, user);
  if (!row) return notFound(c);
  const refused = writeRefusal(c, user);
  if (refused) return refused;
  const body = await jsonBody(c);
  if (!body) return badField(c, 'invalid_body');
  const version = body.version;
  if (!Number.isSafeInteger(version) || (version as number) < 1) return badField(c, 'invalid_version');
  if (version !== row.version) return stale(c, row.version);
  const read = readContextFields(body);
  if (!read.fields) return badField(c, read.error!.code);
  const f = read.fields;
  const checked = await checkFields(c, user, f, row.directory_record_uid);
  if (checked) return checked;
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE research_competitive_contexts SET name = ?, product = ?, directory_record_uid = ?, buyer = ?,
         customer_segment = ?, customer_problem = ?, use_case = ?, customer_countries_json = ?, business_model = ?,
         delivery_model = ?, purpose = ?, market_slug = ?, criteria_json = ?, version = version + 1, updated_at = datetime('now')
       WHERE id = ? AND owner_user_id = ? AND version = ?`,
    ).bind(...columnValues(f), row.id, user.id, version),
    snapshot(c.env, row.id, f),
  ]);
  if (!Number(results[0]?.meta?.changes || 0)) {
    const now = await readOwnContext(c.env, row.uid, user.id);
    return now ? stale(c, now.version) : notFound(c);
  }
  const saved = (await readOwnContext(c.env, row.uid, user.id))!;
  await logAdminAction(c.env, user.id, user.email, 'research_competitive_context_updated', {
    context_uid: row.uid, version: saved.version, fields: changedFields(rowFields(row), f),
  });
  return c.json(contextDto(saved, await recordState(c.env, user, saved.directory_record_uid)));
});

contexts.delete('/:uid', async (c) => {
  const user = await requireAuth(c);
  const row = await requireContextOwner(c, user);
  if (!row) return notFound(c);
  const refused = writeRefusal(c, user);
  if (refused) return refused;
  const version = Number(c.req.query('version'));
  if (!Number.isSafeInteger(version) || version < 1) return badField(c, 'invalid_version');
  if (version !== row.version) return stale(c, row.version);
  const gone = await c.env.DB.prepare('DELETE FROM research_competitive_contexts WHERE id = ? AND owner_user_id = ? AND version = ?')
    .bind(row.id, user.id, version).run();
  if (!Number(gone.meta?.changes || 0)) {
    const now = await readOwnContext(c.env, row.uid, user.id);
    return now ? stale(c, now.version) : notFound(c);
  }
  await logAdminAction(c.env, user.id, user.email, 'research_competitive_context_deleted', { context_uid: row.uid, version });
  return c.json({ deleted: true, uid: row.uid });
});

contexts.get('/:uid/versions/:version', async (c) => {
  const user = await requireAuth(c);
  const row = await requireContextOwner(c, user);
  if (!row) return notFound(c);
  const version = Number(c.req.param('version'));
  if (!Number.isSafeInteger(version) || version < 1) return badField(c, 'invalid_version');
  const saved = await c.env.DB.prepare(
    'SELECT version, fields_json, created_at FROM research_competitive_context_versions WHERE context_id = ? AND version = ?',
  ).bind(row.id, version).first<{ version: number; fields_json: string; created_at: string }>();
  if (!saved) return refuse(c, 404, { code: 'version_not_found', message: 'This context has no such version.' });
  return c.json({ uid: row.uid, version: saved.version, saved_at: saved.created_at, fields: JSON.parse(saved.fields_json) });
});

export const mount: RouteMount = { path: '/api/research/competitive-contexts', router: contexts };
export default contexts;
