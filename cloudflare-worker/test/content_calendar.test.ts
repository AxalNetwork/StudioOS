/**
 * D1090 (#2955) — Distribution's content calendar (migration 587), typed by
 * hand: POST/PATCH/DELETE /api/cycles/grow/channels/content, and the read's
 * `parts.content_calendar`. A typed piece and a Notion piece live side by
 * side; a Notion sync never edits a typed one. Beehiiv, X, TikTok and Facebook
 * never write this store. On the actual migrated schema, synthetic rows only;
 * Notion is a stub.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/content_calendar.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { memKV } from './_mem_kv.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import cycleGrow from '../src/routes/cycle_grow.ts';
import notionRoutes, { notionCycleRoutes, notionDeps } from '../src/routes/notion.ts';

const SECRET = 'synthetic-content-calendar-secret-'.repeat(3);
test.after(() => removeMigratedDatabases());
const CAL = '33333333444455556666777777777777';
const rowId = (n: number) => `${String(n).padStart(8, '0')}aaaa4bbb8cccdddddddddddd`;

function fixture() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'One','one@example.test'),(102,'Two','two@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active) VALUES (11,'Owner','owner@example.test','founder',101,1),(12,'Other','other@example.test','founder',102,1);
    INSERT INTO company_profiles(id,uid,company_name) VALUES (1,'co-acme','Acme Robotics');
    INSERT INTO user_company_links(uid,company_id,user_id,is_primary_admin) VALUES ('l1',1,11,1);
    INSERT INTO projects(id,uid,name,founder_id,company_id) VALUES (701,'v-acme','Acme Field',101,1),(702,'v-two','Two',102,NULL);
    INSERT INTO growth_channels(uid,project_id,name,utm_source) VALUES ('ch-news',701,'Newsletter','newsletter'),('ch-other',702,'Newsletter','newsletter');
    INSERT INTO integrations(id,uid,user_id,provider_key,status,auth_type) VALUES (5,'i-notion',11,'notion','active','oauth_mcp');
    INSERT INTO integration_companies(integration_id,company_id,enabled) VALUES (5,1,1);
  `);
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db), RATE_LIMITS: memKV() };
  const app = new Hono<any>();
  app.onError((e: any, c: any) => c.json({ detail: e.message }, AUTH_ERROR_STATUSES[e?.message] || 500));
  app.route('/api/cycles/grow', cycleGrow);
  app.route('/api/connectors/notion', notionRoutes);
  app.route('/api/cycles', notionCycleRoutes);
  const rows: Array<{ id: string; properties: Record<string, unknown> }> = [];
  notionDeps.reads = async () => ({
    offered: ['notion-search', 'notion-fetch', 'notion-query-data-sources'],
    async searchSources() { return []; },
    async dataSourceSchema(id: string) { return { id, title: 'Calendar', properties: ['Title', 'Date', 'Status', 'Channel', 'Link'].map((name) => ({ name, type: 'text' })) }; },
    async queryRows() { return { rows: rows.map((r) => ({ id: r.id, url: `https://www.notion.so/${r.id}`, last_edited: '2026-10-21T09:00:00.000Z', properties: r.properties })), next_cursor: null }; },
    async listChildren() { return []; },
    async fetchPage() { throw new Error('not used'); },
  } as any);
  const call = async (who: number, method: string, path: string, b?: unknown) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(who) as any;
    const jwt = await new SignJWT({ user_id: who, role: u.role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    const res = await app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }, env);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  };
  const all = (sql: string, ...p: unknown[]) => (db.prepare(sql).all(...p) as any[]).map((r) => ({ ...r }));
  return { db, rows, call, all };
}
const add = (t: ReturnType<typeof fixture>, b: Record<string, unknown>, who = 11) => t.call(who, 'POST', '/api/cycles/grow/channels/content', { project: 701, ...b });
const read = async (t: ReturnType<typeof fixture>) => (await t.call(11, 'GET', '/api/cycles/grow/modules/distribution?project=701')).body;

test('a typed piece: added with its channel, edited, read on Distribution, deleted; each write logged by id', async () => {
  const t = fixture();
  const a = await add(t, { title: 'Launch post', planned_on: '2026-11-03', status: 'planned', channel_uid: 'ch-news', url: 'https://acme.example/blog/launch' });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const b = await add(t, { title: '  Idea: teardown  ' });
  assert.equal(b.status, 201);
  const row = t.all('SELECT title, planned_on, status, url, source, created_by, channel_id FROM content_calendar_items WHERE uid = ?', a.body.uid)[0];
  assert.deepEqual({ ...row, channel_id: undefined }, { title: 'Launch post', planned_on: '2026-11-03', status: 'planned', url: 'https://acme.example/blog/launch', source: 'manual', created_by: 11, channel_id: undefined });
  assert.equal(row.channel_id, t.all("SELECT id FROM growth_channels WHERE uid = 'ch-news'")[0].id);
  assert.deepEqual(t.all('SELECT status, planned_on, channel_id FROM content_calendar_items WHERE uid = ?', b.body.uid)[0], { status: 'idea', planned_on: null, channel_id: null }, 'an idea, with no date and no channel');

  let cal = (await read(t)).parts.content_calendar;
  assert.equal(cal.state, 'ready');
  assert.deepEqual(cal.items.map((i: any) => [i.title, i.channel_name, i.source]), [['Launch post', 'Newsletter', 'manual'], ['Idea: teardown', null, 'manual']], 'soonest first, an unplanned piece last');

  const e = await t.call(11, 'PATCH', `/api/cycles/grow/channels/content/${a.body.uid}`, { project: 701, status: 'published', channel_uid: null });
  assert.equal(e.status, 200, JSON.stringify(e.body));
  assert.deepEqual(t.all('SELECT title, planned_on, status, channel_id FROM content_calendar_items WHERE uid = ?', a.body.uid)[0], { title: 'Launch post', planned_on: '2026-11-03', status: 'published', channel_id: null }, 'only what the edit names');

  const d = await t.call(11, 'DELETE', `/api/cycles/grow/channels/content/${b.body.uid}`, { project: 701 });
  assert.equal(d.status, 200);
  cal = (await read(t)).parts.content_calendar;
  assert.deepEqual(cal.items.map((i: any) => i.title), ['Launch post']);
  assert.deepEqual(t.all("SELECT action, entity_type, entity_id FROM activity_logs WHERE action LIKE 'grow_content_%' ORDER BY id").map((r) => r.action),
    ['grow_content_added', 'grow_content_added', 'grow_content_updated', 'grow_content_deleted']);
  for (const l of t.all("SELECT details FROM activity_logs WHERE action LIKE 'grow_content_%'")) assert.doesNotMatch(String(l.details), /Launch post|teardown|acme\.example/, 'ids only, never the piece');
});

test('refusals: no title, a bad date, status, link, another venture\'s channel or piece, and a reader', async () => {
  const t = fixture();
  assert.equal((await add(t, { title: ' ' })).status, 400);
  assert.equal((await add(t, { title: 'x', planned_on: '2026-02-30' })).body.field, 'planned_on');
  assert.equal((await add(t, { title: 'x', status: 'sent' })).body.field, 'status');
  assert.equal((await add(t, { title: 'x', url: 'javascript:alert(1)' })).body.field, 'url');
  assert.equal((await add(t, { title: 'x', channel_uid: 'ch-other' })).status, 404, 'another venture\'s channel');
  assert.equal((await add(t, { title: 'x' }, 12)).status, 403);
  const mine = await add(t, { title: 'Mine' });
  assert.equal((await t.call(12, 'PATCH', `/api/cycles/grow/channels/content/${mine.body.uid}`, { project: 702, title: 'Taken' })).status, 404);
  assert.equal((await t.call(12, 'DELETE', `/api/cycles/grow/channels/content/${mine.body.uid}`, { project: 702 })).status, 404);
  assert.equal(t.all('SELECT title FROM content_calendar_items')[0].title, 'Mine');
});

test('a typed piece and a Notion piece coexist; a sync never edits the typed one, and a Notion piece is edited in Notion', async () => {
  const t = fixture();
  const typed = await add(t, { title: 'Launch post', planned_on: '2026-11-03', status: 'planned' });
  t.rows.push({ id: rowId(1), properties: { Title: 'Launch post', Date: '2026-11-10', Status: 'Scheduled', Channel: 'newsletter', Link: '' } });
  const src = await t.call(11, 'POST', '/api/connectors/notion/sources', { project: 701, module: 'distribution', kind: 'database', notion_id: CAL,
    field_map: { fields: { title: { property: 'Title' }, planned_on: { property: 'Date' }, status: { property: 'Status', values: { Scheduled: 'scheduled' } }, channel: { property: 'Channel' } } } });
  assert.equal(src.status, 201, JSON.stringify(src.body));
  for (let i = 0; i < 2; i += 1) assert.equal((await t.call(11, 'POST', '/api/cycles/grow/notion/sync', { project: 701 })).status, 200);
  const items = (await read(t)).parts.content_calendar.items;
  assert.deepEqual(items.map((i: any) => [i.title, i.planned_on, i.status, i.source]), [['Launch post', '2026-11-03', 'planned', 'manual'], ['Launch post', '2026-11-10', 'scheduled', 'notion']]);
  const fromNotion = items.find((i: any) => i.source === 'notion');
  const e = await t.call(11, 'PATCH', `/api/cycles/grow/channels/content/${fromNotion.uid}`, { project: 701, title: 'Renamed' });
  assert.equal(e.status, 409);
  assert.match(e.body.detail, /comes from Notion\. Change it there/);
  assert.equal(t.all('SELECT title FROM content_calendar_items WHERE uid = ?', typed.body.uid)[0].title, 'Launch post');
});

test('the calendar unreadable says so on its own and never blanks the channels', async () => {
  const t = fixture();
  t.db.exec('DROP TABLE content_calendar_items');
  const r = await read(t);
  assert.deepEqual(r.parts.content_calendar, { state: 'unreadable', reason: 'Unreadable: the content calendar could not be read' });
  assert.deepEqual(r.records.rows.map((x: any) => x.name), ['Newsletter']);
});

test('Beehiiv, X, TikTok and Facebook never write the content calendar: only its writers name the table', () => {
  const root = new URL('../src/', import.meta.url).pathname;
  const files: string[] = [];
  const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.ts$/.test(n)) files.push(p); } };
  walk(root);
  const naming = files.filter((f) => readFileSync(f, 'utf8').includes('content_calendar_items')).map((f) => f.slice(root.length)).sort();
  assert.deepEqual(naming, ['services/growWriters.ts', 'services/notion/grow.ts']);
});
