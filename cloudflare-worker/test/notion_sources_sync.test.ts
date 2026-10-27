/**
 * D1086 (#2951, #2405 part 2) — a founder's picked Notion sources and the
 * shared sync, on the actual migrated schema (`_storage_schema.ts`, migration
 * 640 included), synthetic rows only. Notion is a stub of `NotionReads`
 * (`notionDeps.reads`): no test reaches a provider host. A test-only writer
 * stands in for part 4's roadmap writer, landing in the real `roadmap_okrs`,
 * so the ledger and the one-owner rule run against the real tables.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/notion_sources_sync.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { memKV } from './_mem_kv.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import notionRoutes, { notionCycleRoutes, notionDeps } from '../src/routes/notion.ts';
import { NotionReadError } from '../src/services/notion/reads.ts';
import { NOTION_MODULES, cleanFieldMap, mapRow, FieldMapError } from '../src/services/notion/modules.ts';
import { CURSOR_TTL_S, REQUEST_BUDGET, registerAcceptor, registerFactWriter } from '../src/services/notion/sync.ts';

const SECRET = 'synthetic-notion-sources-secret-'.repeat(3);
test.after(() => removeMigratedDatabases());

const DB_ID = '11111111222243338444555555555555';
const TREE_ID = '66666666777748889999000000000000';
const rowId = (n: number) => `${String(n).padStart(8, '0')}aaaa4bbb8cccdddddddddddd`;
const childId = (n: number) => `${String(n).padStart(8, '0')}eeee4fff8aaabbbbbbbbbbbb`;

/** Notion, as a stub: the database's schema and rows, a tree's children and their pages. Every call is counted. */
function stubNotion() {
  const s: any = {
    calls: [] as string[],
    properties: ['Objective', 'Status', 'Quarter', 'Progress', 'Notes'],
    rows: [] as Array<{ id: string; properties: Record<string, unknown> }>,
    pageSize: 3,
    children: [] as Array<{ id: string; title: string }>,
    pages: new Map<string, string>(),
    fail: null as null | string,
  };
  s.reads = {
    offered: ['notion-search', 'notion-fetch', 'notion-query-data-sources'],
    async searchSources(q: string) { s.calls.push(`search:${q}`); return [{ id: DB_ID, kind: 'data_source', title: 'Roadmap 2027', url: null, last_edited: null }]; },
    async dataSourceSchema(id: string) { s.calls.push(`schema:${id}`); return { id, title: 'Roadmap 2027', properties: s.properties.map((name: string) => ({ name, type: 'text' })) }; },
    async queryRows(id: string, opts: { cursor?: string | null } = {}) {
      s.calls.push(`rows:${opts.cursor ?? 'start'}`);
      if (s.fail) throw new NotionReadError(s.fail as any);
      const from = opts.cursor ? Number(opts.cursor) : 0;
      const slice = s.rows.slice(from, from + s.pageSize);
      const next = from + s.pageSize < s.rows.length ? String(from + s.pageSize) : null;
      return { rows: slice.map((r: any) => ({ id: r.id, url: `https://www.notion.so/${r.id}`, last_edited: '2026-10-21T09:00:00.000Z', properties: r.properties })), next_cursor: next };
    },
    async listChildren(id: string) { s.calls.push(`children:${id}`); if (s.fail) throw new NotionReadError(s.fail as any); return s.children.map((c: any) => ({ id: c.id, kind: 'page', title: c.title })); },
    async fetchPage(id: string) {
      s.calls.push(`page:${id}`);
      const md = s.pages.get(id) ?? '# Untitled';
      return { id, title: s.children.find((c: any) => c.id === id)?.title ?? 'Page', url: `https://www.notion.so/${id}`, last_edited: '2026-10-21T09:00:00.000Z',
        markdown: md, fingerprint: createHash('sha256').update(md).digest('hex') };
    },
  };
  return s;
}

function fixture() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'One','one@example.test'),(202,'Two','two@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active) VALUES
      (11,'Owner','owner@example.test','founder',101,1),(22,'Other','other@example.test','founder',202,1),(44,'Staff','staff@example.test','admin',NULL,1);
    INSERT INTO company_profiles(id,uid,company_name) VALUES (1,'co-acme','Acme Robotics'),(2,'co-blue','Bluefern Health');
    INSERT INTO user_company_links(uid,company_id,user_id,is_primary_admin) VALUES ('l1',1,11,1),('l2',2,11,0),('l3',2,22,1);
    INSERT INTO projects(id,uid,name,founder_id,company_id) VALUES (701,'v-acme','Acme Field',101,1),(702,'v-blue','Bluefern Clinic',101,2),(703,'v-theirs','Theirs',202,2);
    INSERT INTO integrations(id,uid,user_id,provider_key,status,auth_type) VALUES (5,'i-notion',11,'notion','active','oauth_mcp'),(6,'i-their-notion',22,'notion','active','oauth_mcp'),(7,'i-github',11,'github','active','oauth2');
    INSERT INTO integration_companies(integration_id,company_id,enabled) VALUES (5,1,1),(5,2,0),(6,2,1),(7,1,1);
  `);
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db), RATE_LIMITS: memKV() };
  const app = new Hono<any>();
  app.onError((e: any, c: any) => c.json({ detail: e.message }, AUTH_ERROR_STATUSES[e?.message] || 500));
  app.route('/api/connectors/notion', notionRoutes);
  app.route('/api/cycles', notionCycleRoutes);
  const notion = stubNotion();
  notionDeps.reads = async () => notion.reads;
  const call = async (who: number, method: string, path: string, b?: unknown, support = false) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(who) as any;
    const jwt = await new SignJWT({ user_id: who, role: u.role, ...(support ? { impersonated_by: 44 } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    const res = await app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }, env);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  };
  return { db, env, notion, call };
}

const ROADMAP_MAP = { fields: { objective: { property: 'Objective' }, status: { property: 'Status', values: { 'In progress': 'now', 'Up next': 'next', Someday: 'later' } }, quarter: { property: 'Quarter' } } };

/** A test-only stand-in for part 4's roadmap writer: the real store, its own mapped fields only. */
registerFactWriter({
  module: 'product_roadmap', localTable: 'roadmap_okrs',
  async write(env, ctx, item, existingId) {
    const v = item.values;
    if (existingId) {
      await env.DB.prepare('UPDATE roadmap_okrs SET objective = ?, kanban_status = COALESCE(?, kanban_status), quarter = ? WHERE id = ? AND project_id = ?')
        .bind(v.objective, v.status, v.quarter, existingId, ctx.projectId).run();
      return existingId;
    }
    const r = await env.DB.prepare("INSERT INTO roadmap_okrs (project_id, objective, kanban_status, quarter) VALUES (?, ?, COALESCE(?, 'now'), ?) RETURNING id")
      .bind(ctx.projectId, v.objective, v.status, v.quarter).first<{ id: number }>();
    return Number(r!.id);
  },
  async alive(env, projectId, id) { return !!(await env.DB.prepare('SELECT 1 FROM roadmap_okrs WHERE id = ? AND project_id = ?').bind(id, projectId).first()); },
  async remove(env, projectId, id) { await env.DB.prepare('DELETE FROM roadmap_okrs WHERE id = ? AND project_id = ?').bind(id, projectId).run(); return true; },
  async view(env, projectId, ids) {
    const rows = (await env.DB.prepare('SELECT id, objective, kanban_status, quarter FROM roadmap_okrs WHERE project_id = ? AND id IN (SELECT value FROM json_each(?))').bind(projectId, JSON.stringify(ids)).all<any>()).results || [];
    return new Map(rows.map((r: any) => [Number(r.id), { objective: r.objective, status: r.kanban_status, quarter: r.quarter }]));
  },
});
registerAcceptor({
  kind: 'design_note',
  async accept(env, ctx, p) {
    const r = await env.DB.prepare('INSERT INTO solution_design_notes (project_id, title, body, source_url, created_by) VALUES (?, ?, ?, ?, ?) RETURNING id')
      .bind(ctx.projectId, p.title, p.extract, p.url, ctx.userId).first<{ id: number }>();
    return { localTable: 'solution_design_notes', localId: Number(r!.id) };
  },
});

async function addRoadmap(t: ReturnType<typeof fixture>, map: unknown = ROADMAP_MAP) {
  const r = await t.call(11, 'POST', '/api/connectors/notion/sources', { project: 701, module: 'product_roadmap', kind: 'database', notion_id: DB_ID, field_map: map });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.source.uid as string;
}
const roadmap = (db: any) => db.prepare('SELECT objective, kanban_status, quarter FROM roadmap_okrs WHERE project_id = 701 ORDER BY id').all().map((r: any) => ({ ...r }));

// ---------------------------------------------------------------- the field map

test('the field map: known fields, a property each, values onto the store’s list, every required field; a page is never mapped', () => {
  assert.deepEqual(cleanFieldMap('product_roadmap', 'database', ROADMAP_MAP), ROADMAP_MAP);
  assert.deepEqual(mapRow('product_improvement', { fields: { body: { property: 'Feedback' } }, default_source: 'team' }, { Feedback: 'Faster export' }),
    { values: { body: 'Faster export', source: 'team' }, skip: null }, 'the default source fills an unmapped source');
  const code = (fn: () => unknown) => { try { fn(); return null; } catch (e) { return e instanceof FieldMapError ? `${e.code}:${e.field}` : String(e); } };
  assert.equal(code(() => cleanFieldMap('product_roadmap', 'database', { fields: { budget: { property: 'Budget' }, objective: { property: 'Objective' } } })), 'unknown_field:budget');
  assert.equal(code(() => cleanFieldMap('product_roadmap', 'database', { fields: { quarter: { property: 'Quarter' } } })), 'required_field:objective');
  assert.equal(code(() => cleanFieldMap('product_roadmap', 'database', { fields: { objective: { property: 'Objective' }, status: { property: 'Status', values: { Done: 'finished' } } } })), 'invalid_value:status');
  assert.equal(code(() => cleanFieldMap('product_roadmap', 'database', { fields: { objective: { property: 'Objective', values: { a: 'now' } } } })), 'invalid_values:objective');
  assert.equal(code(() => cleanFieldMap('product_roadmap', 'database', { fields: { objective: { property: '  ' } } })), 'invalid_property:objective');
  assert.equal(code(() => cleanFieldMap('nope', 'database', {})), 'invalid_module:null');
  assert.equal(code(() => cleanFieldMap('product_improvement', 'database', { fields: { body: { property: 'Text' } }, default_source: 'press' })), 'invalid_default_source:null');
  assert.equal(cleanFieldMap('solution_design', 'page_tree', null), null);
  assert.equal(code(() => cleanFieldMap('solution_design', 'page_tree', { fields: { title: { property: 'x' } } })), 'map_not_supported:null');
  // A row, mapped: a value onto its list, an unknown choice left empty (never forced), a required field empty or a bad date skipped.
  assert.deepEqual(mapRow('product_roadmap', ROADMAP_MAP as any, { Objective: 'Ship', Status: 'Up next', Quarter: 'Q1' }), { values: { objective: 'Ship', status: 'next', quarter: 'Q1' }, skip: null });
  assert.deepEqual(mapRow('product_roadmap', ROADMAP_MAP as any, { Objective: 'Ship', Status: 'Blocked' }).values?.status, null);
  assert.deepEqual(mapRow('product_roadmap', ROADMAP_MAP as any, { Objective: '', Status: 'Up next' }).skip, { reason: 'empty_required', field: 'objective' });
  assert.deepEqual(mapRow('distribution', { fields: { title: { property: 'T' }, planned_on: { property: 'D' } } } as any, { T: 'Post', D: 'TBD' }).skip, { reason: 'bad_value', field: 'planned_on' });
  // The choices are the stores' own lists.
  const progress = readFileSync('cloudflare-worker/src/routes/progress.ts', 'utf8');
  assert.deepEqual(NOTION_MODULES.prototype_mvp.fields.delivery_status.values, JSON.parse(`[${/MVP_STATUSES = new Set\(\[([^\]]+)\]/.exec(progress)![1].replace(/'/g, '"')}]`));
  assert.deepEqual([...NOTION_MODULES.product_roadmap.fields.status.values!].sort(), JSON.parse(`[${/KANBAN_STATUSES = new Set\(\[([^\]]+)\]/.exec(progress)![1].replace(/'/g, '"')}]`).sort());
  const contacts = readFileSync('cloudflare-worker/src/routes/contacts.ts', 'utf8');
  assert.deepEqual(NOTION_MODULES.capital_relationships.fields.stage.values, JSON.parse(`[${/RAISE_STAGES = \[([^\]]+)\]/.exec(contacts)![1].replace(/'/g, '"')}]`));
  const grow = readFileSync('cloudflare-worker/sql/migrations/443_grow_stores.sql', 'utf8');
  assert.match(grow, /status IN \('open', 'planned', 'shipped'\)/);
  assert.deepEqual(NOTION_MODULES.product_improvement.fields.status.values, ['open', 'planned', 'shipped']);
});

// ---------------------------------------------------------------- the sources

test('sources: the owner adds, maps, previews and stops using one; a missing column, a non-owner, a disabled company and a support session are refused', async () => {
  const t = fixture();
  // A map to a column the database does not have is refused, and nothing is saved.
  const missing = await t.call(11, 'POST', '/api/connectors/notion/sources', { project: 701, module: 'product_roadmap', kind: 'database', notion_id: DB_ID, field_map: { fields: { objective: { property: 'Goal' } } } });
  assert.deepEqual([missing.status, missing.body.error, missing.body.field], [400, 'unknown_property', 'objective']);
  assert.equal((t.db.prepare('SELECT COUNT(*) AS n FROM notion_sources').get() as any).n, 0);
  // Refusals: a support session, an admin, another founder's venture, a company the owner's Notion is off for, a module that does not take a page, an id that is not Notion's.
  const body = { project: 701, module: 'product_roadmap', kind: 'database', notion_id: DB_ID, field_map: ROADMAP_MAP };
  assert.equal((await t.call(11, 'POST', '/api/connectors/notion/sources', body, true)).body.error, 'support_session_refused');
  assert.equal((await t.call(44, 'POST', '/api/connectors/notion/sources', body)).status, 403);
  assert.equal((await t.call(22, 'POST', '/api/connectors/notion/sources', body)).body.error, 'project_not_available');
  assert.equal((await t.call(11, 'POST', '/api/connectors/notion/sources', { ...body, project: 702 })).body.error, 'company_not_enabled');
  assert.equal((await t.call(11, 'POST', '/api/connectors/notion/sources', { ...body, kind: 'page' })).body.error, 'invalid_kind');
  assert.equal((await t.call(11, 'POST', '/api/connectors/notion/sources', { ...body, notion_id: 'https://evil.example/x' })).body.error, 'bad_id');
  // The owner adds it: Notion is asked what the id is.
  const uid = await addRoadmap(t);
  const list = await t.call(11, 'GET', '/api/connectors/notion/sources?project=701');
  assert.deepEqual(list.body.items.map((s: any) => [s.title, s.module_label, s.kind, s.project_name]), [['Roadmap 2027', 'Product roadmap', 'database', 'Acme Field']]);
  assert.deepEqual((await t.call(22, 'GET', '/api/connectors/notion/sources')).body.items, [], 'another founder never reads my sources');
  // The schema and the preview: five rows as they would land, and the skipped rows named, nothing stored.
  t.notion.pageSize = 10;
  t.notion.rows = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ id: rowId(n), properties: { Objective: n === 4 ? '' : `Goal ${n}`, Status: 'Up next', Quarter: 'Q4 2026' } }));
  const schema = await t.call(11, 'GET', `/api/connectors/notion/sources/${uid}/schema`);
  assert.deepEqual(schema.body.properties.map((p: any) => p.name), t.notion.properties);
  assert.ok(schema.body.fields.find((f: any) => f.key === 'objective').required);
  const preview = await t.call(11, 'GET', `/api/connectors/notion/sources/${uid}/preview`);
  assert.equal(preview.body.rows.length, 5);
  assert.deepEqual(preview.body.rows[0].values, { objective: 'Goal 1', status: 'next', quarter: 'Q4 2026' });
  assert.deepEqual(preview.body.skipped, [{ reason: 'empty_required', field: 'objective', rows: [4] }]);
  assert.equal(preview.body.stored, false);
  assert.equal((t.db.prepare('SELECT COUNT(*) AS n FROM roadmap_okrs').get() as any).n, 0, 'a preview stores nothing');
  const candidate = await t.call(11, 'GET', `/api/connectors/notion/sources/${uid}/preview?map=${encodeURIComponent(JSON.stringify({ fields: { objective: { property: 'Nope' } } }))}`);
  assert.equal(candidate.body.error, 'unknown_property');
  // Remap: a missing column refused, a good one saved.
  assert.equal((await t.call(11, 'PATCH', `/api/connectors/notion/sources/${uid}`, { field_map: { fields: { objective: { property: 'Goal' } } } })).body.error, 'unknown_property');
  const remap = await t.call(11, 'PATCH', `/api/connectors/notion/sources/${uid}`, { field_map: { fields: { objective: { property: 'Objective' }, quarter: { property: 'Quarter' } } } });
  assert.deepEqual(remap.body.source.field_map, { fields: { objective: { property: 'Objective' }, quarter: { property: 'Quarter' } } });
  assert.equal((await t.call(22, 'PATCH', `/api/connectors/notion/sources/${uid}`, { field_map: ROADMAP_MAP })).body.error, 'source_not_found', 'not the owner');
  // Search: titles, kinds and ids only; a long query refused.
  const found = await t.call(11, 'GET', '/api/connectors/notion/search?project=701&q=road');
  assert.deepEqual(Object.keys(found.body.items[0]).sort(), ['id', 'kind', 'last_edited', 'title', 'url']);
  assert.equal((await t.call(11, 'GET', `/api/connectors/notion/search?project=701&q=${'x'.repeat(101)}`)).body.error, 'invalid_query');
  // Stop using.
  assert.deepEqual((await t.call(11, 'DELETE', `/api/connectors/notion/sources/${uid}`)).body, { stopped: true, rows_kept: true });
  assert.deepEqual((await t.call(11, 'GET', '/api/connectors/notion/sources?project=701')).body.items, []);
});

// ---------------------------------------------------------------- the sync

test('sync: a re-sync updates and never duplicates; a deleted fact stays deleted; a skipped row is named; one owner per row', async () => {
  const t = fixture();
  await addRoadmap(t);
  t.notion.pageSize = 10;
  t.notion.rows = [
    { id: rowId(1), properties: { Objective: 'Crews book without calling', Status: 'In progress', Quarter: 'Q4 2026' } },
    { id: rowId(2), properties: { Objective: 'Win the first paying sites', Status: 'Up next', Quarter: 'Q1 2027' } },
    { id: rowId(3), properties: { Objective: '', Status: 'Someday', Quarter: 'Q2 2027' } },
  ];
  const first = await t.call(11, 'POST', '/api/cycles/build/notion/sync', { project: 701 });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.deepEqual(first.body.sources[0].counts.written, 2);
  assert.deepEqual(first.body.sources[0].counts.skipped, [{ reason: 'empty_required', field: 'objective', rows: 1 }]);
  assert.equal(first.body.sources[0].result, 'partial', 'a skipped row makes it partly synced');
  assert.equal(first.body.more, false, 'a skipped row is not more to read');
  assert.deepEqual(roadmap(t.db), [{ objective: 'Crews book without calling', kanban_status: 'now', quarter: 'Q4 2026' }, { objective: 'Win the first paying sites', kanban_status: 'next', quarter: 'Q1 2027' }]);
  // A re-sync with a change updates the linked row, and adds none.
  t.notion.rows[1].properties.Status = 'In progress';
  const again = await t.call(11, 'POST', '/api/cycles/build/notion/sync', { project: 701 });
  assert.deepEqual([again.body.sources[0].counts.written, again.body.sources[0].counts.updated], [0, 2]);
  assert.equal(roadmap(t.db).length, 2);
  assert.equal(roadmap(t.db)[1].kanban_status, 'now');
  // The founder deletes one: it stays deleted on the next sync.
  const read = await t.call(11, 'GET', '/api/cycles/build/notion?project=701&module=product_roadmap');
  assert.equal(read.body.facts.length, 2);
  assert.deepEqual(read.body.facts[0].values, { objective: 'Crews book without calling', status: 'now', quarter: 'Q4 2026' });
  const del = await t.call(11, 'DELETE', `/api/cycles/build/notion/facts/${read.body.facts[0].ledger_id}?project=701`);
  assert.deepEqual(del.body, { ok: true, deleted: true });
  const third = await t.call(11, 'POST', '/api/cycles/build/notion/sync', { project: 701 });
  assert.equal(third.body.sources[0].counts.kept_deleted, 1);
  assert.deepEqual(roadmap(t.db).map((r: any) => r.objective), ['Win the first paying sites']);
  assert.equal((await t.call(11, 'GET', '/api/cycles/build/notion?project=701&module=product_roadmap')).body.kept_deleted, 1);
  // One owner per row: a row another connection's ledger links is never written by Notion.
  const linked = t.db.prepare("SELECT local_id FROM connector_fed_items WHERE integration_id = 5 AND local_id IS NOT NULL").get() as any;
  t.db.exec(`INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id) VALUES (7, 701, 'product_roadmap', 'issue', 'gh:1', 'roadmap_okrs', ${linked.local_id})`);
  t.notion.rows[1].properties.Objective = 'Renamed in Notion';
  const owned = await t.call(11, 'POST', '/api/cycles/build/notion/sync', { project: 701 });
  assert.equal(owned.body.sources[0].counts.owned_elsewhere, 1);
  assert.deepEqual(roadmap(t.db).map((r: any) => r.objective), ['Win the first paying sites'], 'GitHub’s row is not touched');
  // Refusals: another founder, a support session, a disabled company, a section that is not one.
  assert.equal((await t.call(22, 'POST', '/api/cycles/build/notion/sync', { project: 701 })).status, 403);
  assert.equal((await t.call(11, 'POST', '/api/cycles/build/notion/sync', { project: 701 }, true)).body.error, 'support_session_refused');
  assert.equal((await t.call(11, 'POST', '/api/cycles/build/notion/sync', { project: 702 })).body.error, 'company_not_enabled');
  assert.equal((await t.call(11, 'POST', '/api/cycles/admin/notion/sync', { project: 701 })).body.error, 'invalid_section');
  // The sync reads only its own section's sources.
  t.notion.calls.length = 0;
  await t.call(11, 'POST', '/api/cycles/grow/notion/sync', { project: 701 });
  assert.deepEqual(t.notion.calls, [], 'Grow reads no Build source');
});

test('sync: a budget spent answers partial with a cursor kept in KV (TTL ≥ 60 s), and the next press resumes there', async () => {
  const t = fixture();
  await addRoadmap(t);
  t.notion.pageSize = 2;
  t.notion.rows = Array.from({ length: (REQUEST_BUDGET + 3) * 2 }, (_, i) => ({ id: rowId(i + 1), properties: { Objective: `Goal ${i + 1}`, Status: 'Up next' } }));
  const puts: any[] = [];
  const put = t.env.RATE_LIMITS.put.bind(t.env.RATE_LIMITS);
  t.env.RATE_LIMITS.put = async (k: string, v: string, o: any) => { puts.push(o); return put(k, v, o); };
  const one = await t.call(11, 'POST', '/api/cycles/build/notion/sync', { project: 701 });
  assert.equal(one.body.partial, true);
  assert.equal(one.body.more, true, 'a spent budget says there is more to read');
  assert.equal(one.body.sources[0].result, 'partial');
  assert.equal(one.body.sources[0].counts.written, REQUEST_BUDGET * 2);
  assert.ok(puts[0].expirationTtl >= 60 && puts[0].expirationTtl === CURSOR_TTL_S);
  t.notion.calls.length = 0;
  const two = await t.call(11, 'POST', '/api/cycles/build/notion/sync', { project: 701 });
  assert.equal(t.notion.calls[0], `rows:${REQUEST_BUDGET * 2}`, 'resumes from the cursor, not the start');
  assert.equal(two.body.sources[0].counts.written, 6);
  assert.equal(two.body.partial, false);
  assert.equal(two.body.more, false);
  assert.equal(roadmap(t.db).length, (REQUEST_BUDGET + 3) * 2, 'every row once');
  // Done: the cursor is cleared, and the next press starts over (updating, never duplicating).
  t.notion.calls.length = 0;
  await t.call(11, 'POST', '/api/cycles/build/notion/sync', { project: 701 });
  assert.equal(t.notion.calls[0], 'rows:start');
  assert.equal(roadmap(t.db).length, (REQUEST_BUDGET + 3) * 2);
});

test('proposals: changed text re-proposes as Changed in Notion; a dismissed one stays dismissed; Accept lands once through its acceptor', async () => {
  const t = fixture();
  t.notion.children = [{ id: childId(1), title: 'Spec: offline mode' }, { id: childId(2), title: 'Spec: booking' }];
  t.notion.pages.set(childId(1), '# Offline\n\nWorks without signal.');
  t.notion.pages.set(childId(2), '# Booking\n\nUnder two minutes.');
  const added = await t.call(11, 'POST', '/api/connectors/notion/sources', { project: 701, module: 'solution_design', kind: 'page_tree', notion_id: TREE_ID });
  assert.equal(added.status, 201);
  const first = await t.call(11, 'POST', '/api/cycles/build/notion/sync', { project: 701 });
  assert.equal(first.body.sources[0].counts.proposed, 2);
  const pending = () => t.db.prepare('SELECT id, title, status, changed FROM notion_proposals ORDER BY id').all().map((r: any) => ({ ...r }));
  assert.deepEqual(pending().map((p: any) => [p.title, p.status]), [['Spec: offline mode', 'pending'], ['Spec: booking', 'pending']]);
  assert.equal((t.db.prepare("SELECT COUNT(*) AS n FROM connector_fed_items WHERE integration_id = 5").get() as any).n, 0, 'a proposal is not a fact');
  const [offline, booking] = pending();
  // Dismiss one: an unchanged page stays dismissed.
  assert.deepEqual((await t.call(11, 'POST', `/api/cycles/build/notion/proposals/${booking.id}/dismiss`, { project: 701 })).body, { ok: true, state: 'dismissed' });
  const second = await t.call(11, 'POST', '/api/cycles/build/notion/sync', { project: 701 });
  assert.equal(second.body.sources[0].counts.kept_dismissed, 1);
  assert.equal(pending()[1].status, 'dismissed');
  // Changed text in Notion puts it back to pending, marked changed.
  t.notion.pages.set(childId(2), '# Booking\n\nUnder ninety seconds.');
  const third = await t.call(11, 'POST', '/api/cycles/build/notion/sync', { project: 701 });
  assert.equal(third.body.sources[0].counts.reproposed, 1);
  assert.deepEqual([pending()[1].status, pending()[1].changed], ['pending', 1]);
  const read = await t.call(11, 'GET', '/api/cycles/build/notion?project=701&module=solution_design');
  assert.equal(read.body.proposals.find((p: any) => p.id === booking.id).changed, true);
  // Accept: once, through the acceptor, with its ledger row; a second press is refused.
  const ok = await t.call(11, 'POST', `/api/cycles/build/notion/proposals/${offline.id}/accept`, { project: 701 });
  assert.deepEqual([ok.status, ok.body.local_table], [200, 'solution_design_notes']);
  assert.equal((await t.call(11, 'POST', `/api/cycles/build/notion/proposals/${offline.id}/accept`, { project: 701 })).body.error, 'proposal_decided');
  assert.equal((await t.call(11, 'POST', `/api/cycles/build/notion/proposals/${offline.id}/dismiss`, { project: 701 })).body.error, 'proposal_decided', 'an accepted one is not dismissed');
  assert.equal((t.db.prepare("SELECT COUNT(*) AS n FROM connector_fed_items WHERE integration_id = 5 AND local_table = 'solution_design_notes'").get() as any).n, 1);
  assert.equal((await t.call(22, 'POST', `/api/cycles/build/notion/proposals/${booking.id}/dismiss`, { project: 701 })).status, 403, 'another founder');
  // A kind no part has built yet is not accepted: nothing is written.
  t.db.exec(`INSERT INTO notion_proposals (integration_id, project_id, module, kind, source_key, fingerprint, title) VALUES (5, 701, 'capital_relationships', 'prospect', 'k1', 'f', '[Firm A]')`);
  const none = t.db.prepare("SELECT id FROM notion_proposals WHERE kind = 'prospect'").get() as any;
  assert.equal((await t.call(11, 'POST', `/api/cycles/raise/notion/proposals/${none.id}/accept`, { project: 701 })).body.error, 'not_ready');
  // Stop using drops what was never decided, and keeps what was.
  await t.call(11, 'DELETE', `/api/connectors/notion/sources/${added.body.source.uid}`);
  assert.deepEqual(t.db.prepare("SELECT status FROM notion_proposals WHERE module = 'solution_design' ORDER BY id").all().map((r: any) => r.status), ['accepted']);
});

test('the ledger’s edges: a row deleted elsewhere stays deleted, Delete unlinks at once, an unmapped database is named, a finished source is not re-read on resume, a support session cannot sync', async () => {
  const t = fixture();
  await addRoadmap(t);
  t.notion.pageSize = 10;
  t.notion.rows = [
    { id: rowId(1), properties: { Objective: 'First goal', Status: 'Up next' } },
    { id: rowId(2), properties: { Objective: 'Second goal', Status: 'Up next' } },
  ];
  await t.call(11, 'POST', '/api/cycles/build/notion/sync', { project: 701 });
  // Deleted in the roadmap itself, not through Notion's Delete: the next sync leaves it deleted and unlinks it.
  const gone = t.db.prepare("SELECT local_id FROM connector_fed_items WHERE integration_id = 5 ORDER BY id").get() as any;
  t.db.prepare('DELETE FROM roadmap_okrs WHERE id = ?').run(gone.local_id);
  const after = await t.call(11, 'POST', '/api/cycles/build/notion/sync', { project: 701 });
  assert.deepEqual([after.body.sources[0].counts.kept_deleted, after.body.sources[0].counts.updated, after.body.sources[0].counts.written], [1, 1, 0]);
  assert.deepEqual(roadmap(t.db).map((r: any) => r.objective), ['Second goal']);
  assert.equal((t.db.prepare("SELECT local_id FROM connector_fed_items WHERE integration_id = 5 ORDER BY id").get() as any).local_id, null);
  // Delete unlinks at once: the read drops the row before any sync.
  const read = await t.call(11, 'GET', '/api/cycles/build/notion?project=701&module=product_roadmap');
  assert.equal(read.body.facts.length, 1);
  await t.call(11, 'DELETE', `/api/cycles/build/notion/facts/${read.body.facts[0].ledger_id}?project=701`);
  const now = await t.call(11, 'GET', '/api/cycles/build/notion?project=701&module=product_roadmap');
  assert.deepEqual([now.body.facts.length, now.body.kept_deleted], [0, 2]);
  // A support session reads, and is never offered Sync.
  assert.equal(now.body.can_sync, true);
  const support = await t.call(11, 'GET', '/api/cycles/build/notion?project=701&module=product_roadmap', undefined, true);
  assert.deepEqual([support.status, support.body.can_sync], [200, false]);
});

test('sync: a database with no mapping is named, and a source finished before the budget ran out is not read again on resume', async () => {
  const t = fixture();
  const unmapped = await t.call(11, 'POST', '/api/connectors/notion/sources', { project: 701, module: 'prototype_mvp', kind: 'database', notion_id: TREE_ID });
  assert.equal(unmapped.status, 201, JSON.stringify(unmapped.body));
  const r = await t.call(11, 'POST', '/api/cycles/build/notion/sync', { project: 701 });
  assert.deepEqual(r.body.sources[0].counts.skipped, [{ reason: 'not_mapped', field: null, rows: 1 }]);
  assert.equal(r.body.sources[0].result, 'partial');
  await t.call(11, 'DELETE', `/api/connectors/notion/sources/${unmapped.body.source.uid}`);
  // Two sources; the first finishes, the second spends the budget.
  const a = await addRoadmap(t);
  const b = await t.call(11, 'POST', '/api/connectors/notion/sources', { project: 701, module: 'product_roadmap', kind: 'database', notion_id: '99999999888847778666555555555555', field_map: ROADMAP_MAP });
  t.notion.pageSize = 2;
  const pages = Math.floor(REQUEST_BUDGET / 2) + 2;
  t.notion.rows = Array.from({ length: pages * 2 }, (_, i) => ({ id: rowId(i + 1), properties: { Objective: `Goal ${i + 1}` } }));
  const one = await t.call(11, 'POST', '/api/cycles/build/notion/sync', { project: 701 });
  assert.deepEqual(one.body.sources.map((s: any) => [s.uid, s.result]), [[a, 'ok'], [b.body.source.uid, 'partial']]);
  assert.equal(one.body.more, true);
  const two = await t.call(11, 'POST', '/api/cycles/build/notion/sync', { project: 701 });
  assert.deepEqual(two.body.sources.map((s: any) => s.uid), [b.body.source.uid], 'the finished source is not read again');
  assert.equal(two.body.more, false);
});

test('an unreadable source is said, its rows are kept, and the other sources still sync; nothing private reaches a log or an error', async () => {
  const t = fixture();
  await addRoadmap(t);
  t.notion.rows = [{ id: rowId(1), properties: { Objective: 'Secret plan for [Customer]', Status: 'Up next' } }];
  await t.call(11, 'POST', '/api/cycles/build/notion/sync', { project: 701 });
  const logs: string[] = [];
  const was = { info: console.info, error: console.error, warn: console.warn };
  console.info = (...a: any[]) => { logs.push(a.join(' ')); }; console.error = console.info; console.warn = console.info;
  try {
    t.notion.fail = 'not_allowed';
    const r = await t.call(11, 'POST', '/api/cycles/build/notion/sync', { project: 701 });
    assert.deepEqual([r.body.sources[0].result, r.body.sources[0].reason, r.body.partial], ['unreadable', 'not_allowed', true]);
    assert.equal(roadmap(t.db).length, 1, 'the rows read before are kept');
    const read = await t.call(11, 'GET', '/api/cycles/build/notion?project=701&module=product_roadmap');
    assert.equal(read.body.sources[0].last_result, 'unreadable');
    t.notion.fail = 'unauthorized';
    const again = await t.call(11, 'GET', `/api/connectors/notion/sources/${read.body.sources[0].uid}/preview`);
    assert.deepEqual([again.status, again.body.error], [409, 'sign_in_again']);
  } finally { Object.assign(console, was); }
  for (const l of logs) assert.doesNotMatch(l, /Secret plan|Customer|Roadmap 2027|Objective/, l);
});

test('the source: every statement bound, the routes mounted ahead, the client covers every route', () => {
  const route = readFileSync('cloudflare-worker/src/routes/notion.ts', 'utf8');
  const sync = readFileSync('cloudflare-worker/src/services/notion/sync.ts', 'utf8');
  for (const [f, src] of [['notion.ts', route], ['sync.ts', sync]]) {
    assert.doesNotMatch(src, /prepare\(`[^`]*\$\{/, `${f}: no interpolated SQL`);
    assert.doesNotMatch(src, /console\.\w+\([^)]*(title|markdown|properties|values)\b/, `${f}: no content in a log`);
  }
  const index = readFileSync('cloudflare-worker/src/index.ts', 'utf8');
  assert.ok(index.indexOf("app.route('/api/connectors/notion', notionRoutes)") < index.indexOf("app.route('/api/connectors', integrations)"));
  assert.ok(index.indexOf("app.route('/api/cycles', notionCycleRoutes)") < index.indexOf("app.route('/api/cycles/grow', cycleGrow)"));
  const client = readFileSync('frontend/src/lib/api/notion.js', 'utf8');
  for (const p of ['/search?', '/sources', '/schema', '/preview', '/notion/sync', '/accept', '/dismiss', '/notion/facts/']) assert.ok(client.includes(p), p);
  assert.ok(readFileSync('frontend/src/lib/api.js', 'utf8').includes("export * from './api/notion.js';"));
  assert.match(readFileSync('cloudflare-worker/sql/migrations/640_notion_sources.sql', 'utf8'), /UNIQUE \(integration_id, project_id, module, notion_id\)[\s\S]*UNIQUE \(integration_id, project_id, kind, source_key\)/);
});
