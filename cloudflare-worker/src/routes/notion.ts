/**
 * D1086 (#2951, #2405 part 2) — a founder's picked Notion sources, and the
 * shared sync that lands them.
 *
 * `/api/connectors/notion` (default export, mounted ahead of the
 * integrations router):
 *   GET    /search?q=&project=           pages and databases matching q: id, kind, title, link, last edit only
 *   GET    /sources?project=             the sources of the caller's Notion (a venture's, or all)
 *   POST   /sources                      { project, module, kind, notion_id, field_map?, default_source? }
 *   GET    /sources/:uid/schema          a database's properties, by name and type, for Map properties
 *   PATCH  /sources/:uid                 { field_map, default_source? }, checked against the database
 *   DELETE /sources/:uid                 Stop using: no longer read; the rows already read stay
 *   GET    /sources/:uid/preview?map=    five rows as they would land, and what would be skipped
 *
 * `/api/cycles` (`notionCycleRoutes`, mounted ahead of the cycle routers):
 *   GET    /:section/notion?project=&module=          the module's From Notion: sources, facts, proposals
 *   POST   /:section/notion/sync                      { project }  the founder's own Notion, this section only
 *   POST   /:section/notion/proposals/:id/accept      { project, … }
 *   POST   /:section/notion/proposals/:id/dismiss     { project }
 *   DELETE /:section/notion/facts/:ledgerId?project=  stays deleted
 *
 * WHO. A write, a search, a preview or a sync is the connection's owner's: the
 * caller's own Notion, on a venture they may write (`canAccessProject`
 * write), whose company their Notion is switched on for. An admin acting for
 * a venture is refused; so is a support session, which may still disconnect
 * on the integrations page. Reading From Notion is anyone who can open the
 * module. Every statement is bound. Logs hold counts and outcomes only: never
 * a title, a property, a value or page text.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, selectJwt } from '../auth';
import { canAccessProject } from '../services/projectAccess';
import { projectEnabled } from '../integrations/companyScope';
import type { IntegrationRow } from '../integrations/registry';
import { NotionReadError, notionId, notionReadsFor, type NotionReads } from '../services/notion/reads';
import {
  FieldMapError, NOTION_MODULES, SECTIONS, checkAgainstSchema, cleanFieldMap, mapRow, modulesOf, type FieldMap, type Section, type SourceKind,
} from '../services/notion/modules';
import { acceptProposal, deleteFact, dismissProposal, factWriterFor, syncSection, type SourceRow } from '../services/notion/sync';

type C = Context<{ Bindings: Env }>;

/** The one place a route opens Notion's reads; a test swaps it for a stub. */
export const notionDeps: { reads: (env: Env, row: IntegrationRow) => Promise<NotionReads> } = { reads: (env, row) => notionReadsFor(env, row) };

class Refused extends Error {
  status: number; code: string; field: string | null;
  constructor(status: number, code: string, field: string | null = null) { super(code); this.status = status; this.code = code; this.field = field; }
}

/** Each refusal's sentence, written here: never a provider's text. */
const SENTENCES: Record<string, string> = {
  support_session_refused: 'A support session cannot read or change a member’s Notion.',
  invalid_project: 'Choose a venture.',
  project_not_available: 'You cannot change this venture’s modules.',
  company_not_enabled: 'Your Notion is not switched on for this venture’s company. Switch it on on the Notion page.',
  notion_not_connected: 'Notion is not connected yet. Connect your Notion workspace first.',
  sign_in_again: 'Notion asked you to sign in again.',
  rate_limited: 'Notion is busy. Try again in a minute.',
  notion_unreadable: 'Notion could not be read. Try again.',
  bad_id: 'That is not a Notion page or database.',
  invalid_module: 'Choose a module Notion feeds.',
  invalid_kind: 'This module does not take that kind of Notion source.',
  invalid_query: 'Search with at most 100 characters.',
  source_not_found: 'That source is not one of yours.',
  invalid_map: 'The mapping could not be read.',
  map_not_supported: 'Only a database is mapped.',
  unknown_field: 'That field is not one this module has.',
  invalid_property: 'Name the property in the database.',
  unknown_property: 'The database has no property by that name.',
  invalid_values: 'Only a choice field maps its values.',
  invalid_value: 'That value is not one this module accepts.',
  required_field: 'Map every required field.',
  invalid_default_source: 'Choose a source from the list.',
  invalid_section: 'Choose Validate, Build, Raise or Grow.',
  proposal_not_found: 'That proposal is not on this venture.',
  proposal_decided: 'That proposal was already decided.',
  not_ready: 'This kind of item cannot be accepted yet. Its module’s part adds it.',
  fact_not_found: 'That row is not on this venture.',
  notion_failed: 'Notion could not be read or saved. Try again.',
};

function fail(c: C, e: unknown) {
  if (e instanceof Error && ['Unauthorized', 'Forbidden'].includes(e.message)) throw e;
  let r: Refused;
  if (e instanceof Refused) r = e;
  else if (e instanceof FieldMapError) r = new Refused(400, e.code, e.field);
  else if (e instanceof NotionReadError) {
    r = e.code === 'not_connected' ? new Refused(409, 'notion_not_connected')
      : e.code === 'unauthorized' ? new Refused(409, 'sign_in_again')
        : e.code === 'rate_limited' ? new Refused(429, 'rate_limited')
          : e.code === 'bad_id' ? new Refused(400, 'bad_id') : new Refused(502, 'notion_unreadable');
  } else {
    console.error('[notion] route failed:', (e as Error)?.name);
    r = new Refused(503, 'notion_failed');
  }
  return c.json({ error: r.code, detail: SENTENCES[r.code] ?? SENTENCES.notion_failed, ...(r.field ? { field: r.field } : {}) }, r.status as any);
}

const route = (fn: (c: C, user: User) => Promise<Response>) => async (c: C) => {
  try { return await fn(c, await requireAuth(c)); } catch (e) { return fail(c, e); }
};

async function ownSession(c: C) {
  if ((await selectJwt(c))?.payload?.impersonated_by) throw new Refused(403, 'support_session_refused');
}

const idOf = (v: unknown, code = 'invalid_project') => { const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) throw new Refused(400, code); return n; };
const body = async (c: C) => { const b = await c.req.json().catch(() => null); return b && typeof b === 'object' && !Array.isArray(b) ? b as Record<string, any> : {}; };

/** A venture the caller may write, with its company: an admin acting for one is refused. */
async function venture(c: C, user: User, raw: unknown) {
  const id = idOf(raw);
  const p = await c.env.DB.prepare('SELECT id, name, company_id, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL').bind(id)
    .first<{ id: number; name: string | null; company_id: number | null; founder_id: number | null }>();
  if (user.role === 'admin' || !p || !(await canAccessProject(c.env, user, p, { write: true }))) throw new Refused(403, 'project_not_available');
  if (!p.company_id) throw new Refused(409, 'company_not_enabled');
  return p;
}

/** The caller's own Notion row, active; nobody else's is ever read. */
async function connection(c: C, user: User): Promise<IntegrationRow> {
  const row = await c.env.DB.prepare("SELECT * FROM integrations WHERE user_id = ? AND provider_key = 'notion' AND status = 'active'").bind(user.id).first<IntegrationRow>();
  if (!row) throw new Refused(409, 'notion_not_connected');
  return row;
}

/** Owner, venture, company: the three checks every write, search, preview and sync passes. */
async function owner(c: C, user: User, project: unknown) {
  await ownSession(c);
  const p = await venture(c, user, project);
  const row = await connection(c, user);
  if (!(await projectEnabled(c.env, Number(row.id), p.id))) throw new Refused(409, 'company_not_enabled');
  return { project: p, row };
}

const sourceView = (s: any) => ({
  uid: s.uid, project_id: Number(s.project_id), project_name: s.project_name ?? null, module: s.module, module_label: NOTION_MODULES[s.module]?.label ?? s.module,
  section: NOTION_MODULES[s.module]?.section ?? null, kind: s.kind, notion_id: s.notion_id, title: s.title, url: s.url,
  field_map: s.field_map_json ? JSON.parse(s.field_map_json) : null, default_source: s.default_source ?? null, status: s.status,
  last_synced_at: s.last_synced_at ?? null, last_result: s.last_result ?? null, last_counts: s.last_counts_json ? JSON.parse(s.last_counts_json) : null,
});

/** One of the caller's own sources, by uid, with its connection still the caller's. */
async function ownSource(c: C, user: User, raw: string | undefined) {
  const uid = raw ?? '';
  if (!/^[0-9a-f-]{32,36}$/.test(uid)) throw new Refused(404, 'source_not_found');
  const row = await connection(c, user);
  const s = await c.env.DB.prepare("SELECT * FROM notion_sources WHERE uid = ? AND integration_id = ? AND status = 'active'").bind(uid, row.id).first<SourceRow & Record<string, any>>();
  if (!s) throw new Refused(404, 'source_not_found');
  await owner(c, user, s.project_id);
  return { source: s, row };
}

async function schemaOf(c: C, row: IntegrationRow, notionIdValue: string) {
  const reads = await notionDeps.reads(c.env, row);
  return reads.dataSourceSchema(notionIdValue);
}

// ---------------------------------------------------------------- the connector page

const connectors = new Hono<{ Bindings: Env }>();

connectors.get('/search', route(async (c, user) => {
  const q = String(c.req.query('q') ?? '').trim();
  if (q.length > 100) throw new Refused(400, 'invalid_query');
  const { row } = await owner(c, user, c.req.query('project'));
  const found = await (await notionDeps.reads(c.env, row)).searchSources(q);
  // Titles, kinds and ids only: never a page's text.
  return c.json({ items: found.slice(0, 50).map((f) => ({ id: f.id, kind: f.kind, title: f.title, url: f.url, last_edited: f.last_edited })) });
}));

connectors.get('/sources', route(async (c, user) => {
  await ownSession(c);
  const row = await c.env.DB.prepare("SELECT id FROM integrations WHERE user_id = ? AND provider_key = 'notion'").bind(user.id).first<{ id: number }>();
  if (!row) return c.json({ connected: false, items: [] });
  const project = c.req.query('project');
  const rows = await c.env.DB.prepare(
    `SELECT s.*, p.name AS project_name FROM notion_sources s JOIN projects p ON p.id = s.project_id
      WHERE s.integration_id = ? AND s.status = 'active' AND (? IS NULL OR s.project_id = ?) AND p.deleted_at IS NULL ORDER BY s.id`,
  ).bind(row.id, project ? idOf(project) : null, project ? idOf(project) : null).all();
  return c.json({ connected: true, items: (rows.results || []).map(sourceView) });
}));

connectors.post('/sources', route(async (c, user) => {
  const b = await body(c);
  const { project, row } = await owner(c, user, b.project);
  const mod = NOTION_MODULES[String(b.module)];
  if (!mod) throw new Refused(400, 'invalid_module');
  const kind = String(b.kind) as SourceKind;
  if (!mod.kinds.includes(kind)) throw new Refused(400, 'invalid_kind');
  const id = notionId(b.notion_id);
  const map = b.field_map == null ? null : cleanFieldMap(mod.key, kind, b.field_map);
  if (b.default_source != null && !mod.defaultSources?.includes(String(b.default_source))) throw new Refused(400, 'invalid_default_source');
  const reads = await notionDeps.reads(c.env, row);
  // Notion is asked what the id is: nothing the browser sent about it is trusted.
  let title: string | null; let url: string | null; let properties: string[] = [];
  if (kind === 'database') {
    const schema = await reads.dataSourceSchema(id);
    title = schema.title; url = null; properties = schema.properties.map((p) => p.name);
    checkAgainstSchema(map, properties);
  } else {
    const page = await reads.fetchPage(id);
    title = page.title; url = page.url;
  }
  const uid = crypto.randomUUID().replace(/-/g, '');
  await c.env.DB.prepare(
    `INSERT INTO notion_sources (uid, integration_id, project_id, module, kind, notion_id, title, url, field_map_json, default_source, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(integration_id, project_id, module, notion_id) DO UPDATE SET kind = excluded.kind, title = excluded.title, url = excluded.url,
       field_map_json = COALESCE(excluded.field_map_json, notion_sources.field_map_json), default_source = COALESCE(excluded.default_source, notion_sources.default_source),
       status = 'active', updated_at = CURRENT_TIMESTAMP`,
  ).bind(uid, row.id, project.id, mod.key, kind, id, title ? title.slice(0, 300) : null, url, map ? JSON.stringify(map) : null,
    b.default_source == null ? null : String(b.default_source), user.id).run();
  const saved = await c.env.DB.prepare('SELECT * FROM notion_sources WHERE integration_id = ? AND project_id = ? AND module = ? AND notion_id = ?')
    .bind(row.id, project.id, mod.key, id).first();
  console.info(`[notion] source saved module=${mod.key} kind=${kind}`);
  return c.json({ source: sourceView({ ...saved, project_name: project.name }), properties }, 201);
}));

connectors.get('/sources/:uid/schema', route(async (c, user) => {
  const { source, row } = await ownSource(c, user, c.req.param('uid'));
  if (source.kind !== 'database') throw new Refused(400, 'map_not_supported');
  const schema = await schemaOf(c, row, source.notion_id);
  const mod = NOTION_MODULES[source.module];
  return c.json({
    properties: schema.properties,
    fields: Object.entries(mod.fields).map(([key, f]) => ({ key, label: f.label, type: f.type, required: !!f.required, values: f.values ?? null })),
    default_sources: mod.defaultSources ?? null,
  });
}));

connectors.patch('/sources/:uid', route(async (c, user) => {
  const { source, row } = await ownSource(c, user, c.req.param('uid'));
  const b = await body(c);
  const map = cleanFieldMap(source.module, source.kind, b.field_map);
  if (source.kind === 'database') checkAgainstSchema(map, (await schemaOf(c, row, source.notion_id)).properties.map((p) => p.name));
  await c.env.DB.prepare('UPDATE notion_sources SET field_map_json = ?, default_source = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(map ? JSON.stringify(map) : null, map?.default_source ?? null, source.id).run();
  const saved = await c.env.DB.prepare('SELECT * FROM notion_sources WHERE id = ?').bind(source.id).first();
  return c.json({ source: sourceView(saved) });
}));

connectors.delete('/sources/:uid', route(async (c, user) => {
  const { source } = await ownSource(c, user, c.req.param('uid'));
  // Stop using: never read again. Rows already read stay in their module; proposals not yet decided go.
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE notion_sources SET status = 'removed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(source.id),
    c.env.DB.prepare("DELETE FROM notion_proposals WHERE source_id = ? AND status = 'pending'").bind(source.id),
  ]);
  return c.json({ stopped: true, rows_kept: true });
}));

connectors.get('/sources/:uid/preview', route(async (c, user) => {
  const { source, row } = await ownSource(c, user, c.req.param('uid'));
  if (source.kind !== 'database') throw new Refused(400, 'map_not_supported');
  const raw = c.req.query('map');
  if (raw && raw.length > 8000) throw new Refused(400, 'invalid_map');
  let candidate: unknown = null;
  if (raw) { try { candidate = JSON.parse(raw); } catch { throw new Refused(400, 'invalid_map'); } }
  const map = (raw ? cleanFieldMap(source.module, 'database', candidate) : (source.field_map_json ? JSON.parse(source.field_map_json) : null)) as FieldMap | null;
  if (!map) throw new Refused(400, 'required_field');
  const reads = await notionDeps.reads(c.env, row);
  checkAgainstSchema(map, (await reads.dataSourceSchema(source.notion_id)).properties.map((p) => p.name));
  const page = await reads.queryRows(source.notion_id, {});
  const rows: Array<{ n: number; values: Record<string, unknown> | null; skipped: { reason: string; field: string } | null }> = [];
  const skipped: Record<string, { reason: string; field: string; rows: number[] }> = {};
  page.rows.forEach((r, i) => {
    const m = mapRow(source.module, map, r.properties);
    if (!m.values) {
      const k = `${m.skip.reason}:${m.skip.field}`;
      (skipped[k] ??= { ...m.skip, rows: [] }).rows.push(i + 1);
    }
    if (rows.length < 5) rows.push({ n: i + 1, values: m.values, skipped: m.values ? null : m.skip });
  });
  return c.json({ rows, skipped: Object.values(skipped), read: page.rows.length, more: !!page.next_cursor, stored: false });
}));

export default connectors;

// ---------------------------------------------------------------- the four sections

export const notionCycleRoutes = new Hono<{ Bindings: Env }>();

const sectionOf = (c: C): Section => {
  const s = c.req.param('section') as Section;
  if (!SECTIONS.includes(s)) throw new Refused(404, 'invalid_section');
  return s;
};
const ctxOf = (row: IntegrationRow, projectId: number, user: User) => ({ integrationId: Number(row.id), projectId, userId: Number(user.id), today: new Date().toISOString().slice(0, 10) });

notionCycleRoutes.get('/:section/notion', route(async (c, user) => {
  const section = sectionOf(c);
  const id = idOf(c.req.query('project'));
  const module = String(c.req.query('module') ?? '');
  if (!modulesOf(section).includes(module)) throw new Refused(400, 'invalid_module');
  const p = await c.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL').bind(id).first<{ id: number; founder_id: number | null }>();
  if (!p || !(await canAccessProject(c.env, user, p))) throw new Refused(403, 'project_not_available');
  const mine = await c.env.DB.prepare("SELECT id, status FROM integrations WHERE user_id = ? AND provider_key = 'notion'").bind(user.id).first<{ id: number; status: string }>();
  const sources = ((await c.env.DB.prepare(
    "SELECT s.*, i.user_id AS owner_user_id FROM notion_sources s JOIN integrations i ON i.id = s.integration_id WHERE s.project_id = ? AND s.module = ? ORDER BY s.id",
  ).bind(id, module).all<any>()).results || []);
  const ledger = ((await c.env.DB.prepare(
    "SELECT id, integration_id, external_id, local_table, local_id, last_seen_at FROM connector_fed_items WHERE project_id = ? AND module = ? AND kind = 'notion_fact' ORDER BY id",
  ).bind(id, module).all<any>()).results || []);
  const writer = factWriterFor(module);
  const live = ledger.filter((l: any) => l.local_id != null);
  const values = writer?.view ? await writer.view(c.env, id, live.map((l: any) => Number(l.local_id))) : new Map();
  const proposals = ((await c.env.DB.prepare(
    "SELECT id, integration_id, kind, source_key, title, extract, url, status, changed, updated_at FROM notion_proposals WHERE project_id = ? AND module = ? AND status IN ('pending', 'dismissed') ORDER BY id",
  ).bind(id, module).all<any>()).results || []);
  return c.json({
    module, label: NOTION_MODULES[module].label, lands: NOTION_MODULES[module].lands,
    connected: mine?.status === 'active', can_sync: mine?.status === 'active' && !(await selectJwt(c))?.payload?.impersonated_by,
    fields: Object.entries(NOTION_MODULES[module].fields).map(([key, f]) => ({ key, label: f.label })),
    sources: sources.map((s: any) => ({ ...sourceView(s), mine: Number(s.owner_user_id) === Number(user.id) })),
    facts: live.map((l: any) => ({ ledger_id: Number(l.id), mine: Number(l.integration_id) === Number(mine?.id), as_of: l.last_seen_at, values: values.get(Number(l.local_id)) ?? null })),
    kept_deleted: ledger.length - live.length,
    proposals: proposals.map((x: any) => ({ id: Number(x.id), mine: Number(x.integration_id) === Number(mine?.id), kind: x.kind, title: x.title, extract: x.extract, url: x.url, status: x.status, changed: !!x.changed, as_of: x.updated_at })),
    writer_ready: !!writer,
  });
}));

notionCycleRoutes.post('/:section/notion/sync', route(async (c, user) => {
  const section = sectionOf(c);
  const b = await body(c);
  const { project, row } = await owner(c, user, b.project);
  const reads = await notionDeps.reads(c.env, row);
  const out = await syncSection(c.env, reads, ctxOf(row, project.id, user), section);
  return c.json({ ok: true, ...out });
}));

const proposalId = (c: C) => idOf(c.req.param('id'), 'proposal_not_found');

notionCycleRoutes.post('/:section/notion/proposals/:id/accept', route(async (c, user) => {
  sectionOf(c);
  const b = await body(c);
  const { project, row } = await owner(c, user, b.project);
  const out = await acceptProposal(c.env, ctxOf(row, project.id, user), proposalId(c), b);
  if (out === 'not_found') throw new Refused(404, 'proposal_not_found');
  if (out === 'decided') throw new Refused(409, 'proposal_decided');
  if (out === 'not_ready') throw new Refused(409, 'not_ready');
  return c.json({ ok: true, state: 'accepted', local_table: out.localTable, local_id: out.localId });
}));

notionCycleRoutes.post('/:section/notion/proposals/:id/dismiss', route(async (c, user) => {
  sectionOf(c);
  const b = await body(c);
  const { project, row } = await owner(c, user, b.project);
  const out = await dismissProposal(c.env, ctxOf(row, project.id, user), proposalId(c));
  if (out === 'not_found') throw new Refused(404, 'proposal_not_found');
  if (out === 'decided') throw new Refused(409, 'proposal_decided');
  return c.json({ ok: true, state: 'dismissed' });
}));

notionCycleRoutes.delete('/:section/notion/facts/:ledgerId', route(async (c, user) => {
  sectionOf(c);
  const { project, row } = await owner(c, user, c.req.query('project'));
  const out = await deleteFact(c.env, ctxOf(row, project.id, user), idOf(c.req.param('ledgerId'), 'fact_not_found'));
  if (out === 'not_found') throw new Refused(404, 'fact_not_found');
  return c.json({ ok: true, deleted: true });
}));
