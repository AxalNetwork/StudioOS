/**
 * D1090 (#2955, #2405 part 6) — Grow from a founder's Notion: a content
 * calendar into Distribution's `content_calendar_items`, and a feedback
 * database into `product_feedback`, both as facts. The channel is matched by
 * name or none; `source` comes from a mapped column or the founder's default;
 * no name or email unless mapped. On the actual migrated schema, synthetic
 * rows only; Notion is a stub of `NotionReads`.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/notion_grow.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { memKV } from './_mem_kv.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import notionRoutes, { notionCycleRoutes, notionDeps } from '../src/routes/notion.ts';
import { factWriterFor } from '../src/services/notion/sync.ts';

const SECRET = 'synthetic-notion-grow-secret-'.repeat(3);
test.after(() => removeMigratedDatabases());
const CAL = '33333333444455556666777777777777';
const FB = '44444444555566667777888888888888';
const rowId = (n: number) => `${String(n).padStart(8, '0')}aaaa4bbb8cccdddddddddddd`;

function fixture() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'One','one@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active) VALUES (11,'Owner','owner@example.test','founder',101,1);
    INSERT INTO company_profiles(id,uid,company_name) VALUES (1,'co-acme','Acme Robotics');
    INSERT INTO user_company_links(uid,company_id,user_id,is_primary_admin) VALUES ('l1',1,11,1);
    INSERT INTO projects(id,uid,name,founder_id,company_id) VALUES (701,'v-acme','Acme Field',101,1),(702,'v-two','Two',101,NULL);
    INSERT INTO growth_channels(uid,project_id,name,utm_source) VALUES ('ch-news',701,'Newsletter','newsletter'),('ch-li',701,'LinkedIn','linkedin'),('ch-x',702,'Podcast','podcast');
    INSERT INTO integrations(id,uid,user_id,provider_key,status,auth_type) VALUES (5,'i-notion',11,'notion','active','oauth_mcp');
    INSERT INTO integration_companies(integration_id,company_id,enabled) VALUES (5,1,1);
    INSERT INTO product_feedback(uid,project_id,body,source,status) VALUES ('fb-typed',701,'Typed by hand','team','open');
  `);
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db), RATE_LIMITS: memKV() };
  const app = new Hono<any>();
  app.onError((e: any, c: any) => c.json({ detail: e.message }, AUTH_ERROR_STATUSES[e?.message] || 500));
  app.route('/api/connectors/notion', notionRoutes);
  app.route('/api/cycles', notionCycleRoutes);
  const db_: Record<string, { props: string[]; rows: Array<{ id: string; properties: Record<string, unknown> }> }> = {
    [CAL]: { props: ['Title', 'Date', 'Status', 'Channel', 'Link'], rows: [] },
    [FB]: { props: ['Feedback', 'Theme', 'Status', 'Source', 'Name', 'Email'], rows: [] },
  };
  notionDeps.reads = async () => ({
    offered: ['notion-search', 'notion-fetch', 'notion-query-data-sources'],
    async searchSources() { return []; },
    async dataSourceSchema(id: string) { return { id, title: 'DB', properties: db_[id].props.map((name) => ({ name, type: 'text' })) }; },
    async queryRows(id: string) { return { rows: db_[id].rows.map((r) => ({ id: r.id, url: `https://www.notion.so/${r.id}`, last_edited: '2026-10-21T09:00:00.000Z', properties: r.properties })), next_cursor: null }; },
    async listChildren() { return []; },
    async fetchPage() { throw new Error('not used'); },
  } as any);
  const call = async (method: string, path: string, b?: unknown) => {
    const jwt = await new SignJWT({ user_id: 11, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    const res = await app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }, env);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  };
  const all = (sql: string, ...p: unknown[]) => (db.prepare(sql).all(...p) as any[]).map((r) => ({ ...r }));
  const source = (module: string, notion_id: string, field_map: unknown) => call('POST', '/api/connectors/notion/sources', { project: 701, module, kind: 'database', notion_id, field_map });
  const sync = () => call('POST', '/api/cycles/grow/notion/sync', { project: 701 });
  return { db, rows: (id: string) => db_[id].rows, call, all, source, sync };
}

const CAL_MAP = { fields: { title: { property: 'Title' }, planned_on: { property: 'Date' }, status: { property: 'Status', values: { 'In draft': 'planned', Live: 'published' } }, channel: { property: 'Channel' }, url: { property: 'Link' } } };

test('the Grow writers are registered on the routes\' import, each on its store', () => {
  assert.equal(factWriterFor('distribution')?.localTable, 'content_calendar_items');
  assert.equal(factWriterFor('product_improvement')?.localTable, 'product_feedback');
});

test('Distribution: a row is one planned piece; the channel is matched by name, else none, and never made', async () => {
  const t = fixture();
  t.rows(CAL).push(
    { id: rowId(1), properties: { Title: 'Launch post', Date: '2026-11-03T10:00:00.000Z', Status: 'In draft', Channel: '  newsletter ', Link: 'https://acme.example/launch' } },
    { id: rowId(2), properties: { Title: 'Podcast clip', Date: '2026-11', Status: 'Live', Channel: 'Podcast', Link: 'not a link' } },
    { id: rowId(3), properties: { Title: 'Teardown', Date: '', Status: 'Someday', Channel: '', Link: '' } },
  );
  assert.equal((await t.source('distribution', CAL, CAL_MAP)).status, 201);
  const s = await t.sync();
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const rows = t.all(`SELECT i.title, i.planned_on, i.status, i.url, i.source, g.name AS channel FROM content_calendar_items i
    LEFT JOIN growth_channels g ON g.id = i.channel_id ORDER BY i.id`);
  assert.deepEqual(rows, [
    { title: 'Launch post', planned_on: '2026-11-03', status: 'planned', url: 'https://acme.example/launch', source: 'notion', channel: 'Newsletter' },
    { title: 'Podcast clip', planned_on: null, status: 'published', url: null, source: 'notion', channel: null },
    { title: 'Teardown', planned_on: null, status: 'idea', url: null, source: 'notion', channel: null },
  ], 'a channel of another venture is none; a month alone is no date; an unmapped status is an idea; a bad link is empty');
  assert.equal(t.all('SELECT id FROM growth_channels').length, 3, 'no channel made up');
  const read = await t.call('GET', '/api/cycles/grow/notion?project=701&module=distribution');
  assert.deepEqual(read.body.facts.map((f: any) => f.values), [
    { title: 'Launch post', planned_on: '2026-11-03', status: 'planned', channel: 'Newsletter', url: 'https://acme.example/launch' },
    { title: 'Podcast clip', planned_on: null, status: 'published', channel: null, url: null },
    { title: 'Teardown', planned_on: null, status: 'idea', channel: null, url: null },
  ], 'From Notion shows each piece as it landed');
});

test('Distribution: a re-sync updates the linked piece only, by its mapped fields; a deleted piece stays deleted', async () => {
  const t = fixture();
  t.rows(CAL).push({ id: rowId(1), properties: { Title: 'Launch post', Date: '2026-11-03', Status: 'In draft', Channel: 'Newsletter', Link: '' } });
  await t.source('distribution', CAL, { fields: { title: { property: 'Title' }, channel: { property: 'Channel' } } });
  await t.sync();
  t.db.exec("UPDATE content_calendar_items SET status = 'scheduled', planned_on = '2026-11-04'");
  t.rows(CAL)[0].properties = { Title: 'Launch post v2', Channel: 'linkedin' };
  await t.sync();
  assert.deepEqual(t.all('SELECT i.title, i.status, i.planned_on, g.name AS channel FROM content_calendar_items i LEFT JOIN growth_channels g ON g.id = i.channel_id'),
    [{ title: 'Launch post v2', status: 'scheduled', planned_on: '2026-11-04', channel: 'LinkedIn' }], 'unmapped fields stay as the founder set them');
  t.db.exec('DELETE FROM content_calendar_items');
  const s = await t.sync();
  assert.equal(t.all('SELECT id FROM content_calendar_items').length, 0);
  assert.equal(s.body.sources[0].counts.kept_deleted, 1);
});

const FB_MAP = { fields: { body: { property: 'Feedback' }, theme: { property: 'Theme' }, status: { property: 'Status', values: { Done: 'shipped' } } } };

test('Product improvement: source is the founder\'s default, or the mapped column; a map with neither is refused', async () => {
  const t = fixture();
  const none = await t.source('product_improvement', FB, FB_MAP);
  assert.equal(none.status, 400);
  assert.deepEqual([none.body.error, none.body.field, none.body.detail], ['source_required', 'source', 'Map a Source column, or choose where this feedback comes from.']);
  t.rows(FB).push(
    { id: rowId(1), properties: { Feedback: 'Export to CSV please', Theme: 'Export', Status: 'Done', Source: 'Investor', Name: 'Ada', Email: 'ada@example.test' } },
    { id: rowId(2), properties: { Feedback: 'Dark mode', Theme: '', Status: '', Source: 'investor', Name: '', Email: '' } },
  );
  assert.equal((await t.source('product_improvement', FB, { ...FB_MAP, default_source: 'customer' })).status, 201);
  await t.sync();
  assert.deepEqual(t.all("SELECT body, source, theme, status, from_name, from_email, shipped_on IS NOT NULL AS shipped FROM product_feedback WHERE uid <> 'fb-typed' ORDER BY id"), [
    { body: 'Export to CSV please', source: 'customer', theme: 'Export', status: 'shipped', from_name: null, from_email: null, shipped: 1 },
    { body: 'Dark mode', source: 'customer', theme: null, status: 'open', from_name: null, from_email: null, shipped: 0 },
  ], 'the default, and no name or email when none is mapped');

  const u = fixture();
  u.rows(FB).push(
    { id: rowId(1), properties: { Feedback: 'Export to CSV please', Source: 'investor' } },
    { id: rowId(2), properties: { Feedback: 'No source here', Source: '' } },
  );
  assert.equal((await u.source('product_improvement', FB, { fields: { body: { property: 'Feedback' }, source: { property: 'Source' } } })).status, 201);
  const s = await u.sync();
  assert.deepEqual(u.all("SELECT body, source FROM product_feedback WHERE uid <> 'fb-typed'"), [{ body: 'Export to CSV please', source: 'investor' }]);
  assert.deepEqual(s.body.sources[0].counts.skipped, [{ reason: 'empty_required', field: 'source', rows: 1 }], 'never a guessed source');
});

test('Product improvement: a name and an email only when mapped; a bad email is left empty; a typed row is never edited', async () => {
  const t = fixture();
  t.rows(FB).push(
    { id: rowId(1), properties: { Feedback: 'Export to CSV please', Source: 'customer', Name: 'Ada Lovelace', Email: 'ADA@example.test' } },
    { id: rowId(2), properties: { Feedback: 'Typed by hand', Source: 'customer', Name: 'Bo', Email: 'not-an-email' } },
  );
  await t.source('product_improvement', FB, { fields: { body: { property: 'Feedback' }, source: { property: 'Source' }, from_name: { property: 'Name' }, from_email: { property: 'Email' } } });
  await t.sync();
  assert.deepEqual(t.all("SELECT body, from_name, from_email FROM product_feedback WHERE uid <> 'fb-typed' ORDER BY id"), [
    { body: 'Export to CSV please', from_name: 'Ada Lovelace', from_email: 'ada@example.test' },
    { body: 'Typed by hand', from_name: 'Bo', from_email: null },
  ]);
  t.rows(FB)[0].properties = { Feedback: 'Export to CSV, and XLSX', Source: 'investor' };
  await t.sync();
  assert.deepEqual(t.all("SELECT body, source, from_name, from_email FROM product_feedback WHERE uid <> 'fb-typed' ORDER BY id")[0],
    { body: 'Export to CSV, and XLSX', source: 'investor', from_name: null, from_email: null }, 'a mapped column emptied in Notion empties it here');
  assert.deepEqual(t.all("SELECT body, source, status FROM product_feedback WHERE uid = 'fb-typed'")[0], { body: 'Typed by hand', source: 'team', status: 'open' }, 'the typed row as typed');
  const read = await t.call('GET', '/api/cycles/grow/notion?project=701&module=product_improvement');
  assert.equal(read.status, 200);
  assert.doesNotMatch(JSON.stringify(read.body.facts), /Ada|Bo\b|example\.test/, 'From Notion shows the feedback, never who gave it');
});
