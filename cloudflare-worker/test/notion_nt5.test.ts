/**
 * D1089 (#2954, #2405 part 5) — Raise from a founder's Notion: an investor CRM
 * as prospects to add or link, then their stage as a fact; pages as data-room
 * snapshots, NDA by default, a later change adding a version on Accept only.
 * On the actual migrated schema, synthetic rows only. Notion is a stub of
 * `NotionReads` and R2 an in-memory map: no test reaches a provider host.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/notion_nt5.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { memKV } from './_mem_kv.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import notionRoutes, { notionCycleRoutes, notionDeps } from '../src/routes/notion.ts';
import { acceptorFor } from '../src/services/notion/sync.ts';

const SECRET = 'synthetic-notion-raise-secret-'.repeat(3);
test.after(() => removeMigratedDatabases());

const CRM = '22222222333344445555666666666666';
const MEMO = '77777777888849990000aaaaaaaaaaaa';
const rowId = (n: number) => `${String(n).padStart(8, '0')}aaaa4bbb8cccdddddddddddd`;

function stubNotion() {
  const s: any = { rows: [] as Array<{ id: string; properties: Record<string, unknown> }>, pages: new Map<string, string>(), properties: ['Name', 'Firm', 'Stage', 'Notes', 'Email'] };
  s.reads = {
    offered: ['notion-search', 'notion-fetch', 'notion-query-data-sources'],
    async searchSources() { return []; },
    async dataSourceSchema(id: string) { return { id, title: 'Investors', properties: s.properties.map((name: string) => ({ name, type: 'text' })) }; },
    async queryRows() { return { rows: s.rows.map((r: any) => ({ id: r.id, url: `https://www.notion.so/${r.id}`, last_edited: '2026-10-21T09:00:00.000Z', properties: r.properties })), next_cursor: null }; },
    async listChildren() { return []; },
    async fetchPage(id: string) {
      const md = s.pages.get(id) ?? '';
      return { id, title: id === MEMO ? 'Investor memo v3' : 'Investors', url: `https://www.notion.so/${id}`, last_edited: '2026-10-21T09:00:00.000Z', markdown: md, fingerprint: createHash('sha256').update(md).digest('hex') };
    },
  };
  return s;
}

function memR2() {
  const objects = new Map<string, { bytes: Uint8Array; type: string | null }>();
  return {
    objects,
    async put(key: string, bytes: Uint8Array, opts: any) { objects.set(key, { bytes, type: opts?.httpMetadata?.contentType ?? null }); },
    async get(key: string) { const o = objects.get(key); return o ? { text: async () => new TextDecoder().decode(o.bytes) } : null; },
    async delete(key: string) { objects.delete(key); },
    async head(key: string) { const o = objects.get(key); return o ? { size: o.bytes.byteLength } : null; },
  };
}

function fixture() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'One','one@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active) VALUES (11,'Owner','owner@example.test','founder',101,1),(33,'Investor','inv@example.test','investor',NULL,1);
    INSERT INTO company_profiles(id,uid,company_name) VALUES (1,'co-acme','Acme Robotics');
    INSERT INTO user_company_links(uid,company_id,user_id,is_primary_admin) VALUES ('l1',1,11,1);
    INSERT INTO projects(id,uid,name,founder_id,company_id) VALUES (701,'v-acme','Acme Field',101,1);
    INSERT INTO integrations(id,uid,user_id,provider_key,status,auth_type) VALUES (5,'i-notion',11,'notion','active','oauth_mcp');
    INSERT INTO integration_companies(integration_id,company_id,enabled) VALUES (5,1,1);
    INSERT INTO raise_prospects(uid,project_id,name,email,firm,stage,created_at,updated_at) VALUES
      ('p-acme',701,'Dana Reyes','dana@acme.capital','Acme Capital','contacted','2026-10-01','2026-10-01');
  `);
  const FILES = memR2();
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db), RATE_LIMITS: memKV(), FILES };
  const app = new Hono<any>();
  app.onError((e: any, c: any) => c.json({ detail: e.message }, AUTH_ERROR_STATUSES[e?.message] || 500));
  app.route('/api/connectors/notion', notionRoutes);
  app.route('/api/cycles', notionCycleRoutes);
  const notion = stubNotion();
  notionDeps.reads = async () => notion.reads;
  const call = async (who: number, method: string, path: string, b?: unknown) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(who) as any;
    const jwt = await new SignJWT({ user_id: who, role: u.role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    const res = await app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }, env);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  };
  const all = (sql: string, ...p: unknown[]) => (db.prepare(sql).all(...p) as any[]).map((r) => ({ ...r }));
  const sync = () => call(11, 'POST', '/api/cycles/raise/notion/sync', { project: 701 });
  const accept = (id: number, b: Record<string, unknown> = {}) => call(11, 'POST', `/api/cycles/raise/notion/proposals/${id}/accept`, { project: 701, ...b });
  return { db, env, FILES, notion, call, all, sync, accept };
}

const STAGES = { 'Meeting booked': 'meeting', 'In DD': 'diligence', Reached: 'contacted' };
const MAP = { fields: { name: { property: 'Name' }, firm: { property: 'Firm' }, stage: { property: 'Stage', values: STAGES }, notes: { property: 'Notes' } } };

async function crm(t: ReturnType<typeof fixture>, map: unknown = MAP) {
  const r = await t.call(11, 'POST', '/api/connectors/notion/sources', { project: 701, module: 'capital_relationships', kind: 'database', notion_id: CRM, field_map: map });
  assert.equal(r.status, 201, JSON.stringify(r.body));
}
const proposals = (t: ReturnType<typeof fixture>) => t.all("SELECT id, source_key, title, status, payload_json FROM notion_proposals WHERE module = 'capital_relationships' ORDER BY id");

test('the Raise writers are registered on the routes\' import', () => {
  assert.ok(acceptorFor('prospect')?.describe);
  assert.ok(acceptorFor('data_room_snapshot')?.describe);
});

test('an unlinked row proposes Add at its stage; a match on firm proposes Link, and Accept links it: never a duplicate', async () => {
  const t = fixture();
  t.notion.rows = [
    { id: rowId(1), properties: { Name: 'Sam Lee', Firm: 'Northwind Ventures', Stage: 'Meeting booked', Notes: 'Met at demo day', Email: 'sam@northwind.vc' } },
    { id: rowId(2), properties: { Name: 'Dana R.', Firm: 'acme capital', Stage: 'In DD', Notes: '', Email: 'other@acme.capital' } },
  ];
  await crm(t);
  assert.equal((await t.sync()).status, 200);
  const ps = proposals(t);
  assert.deepEqual(ps.map((p) => p.title), ['Add Northwind Ventures at Meeting?', 'Link to Acme Capital']);
  for (const p of ps) assert.ok(!('email' in JSON.parse(p.payload_json)), 'no email unless the founder mapped one');
  assert.equal(t.all('SELECT id FROM raise_prospects').length, 1, 'a sync adds nobody');

  const add = await t.accept(ps[0].id);
  assert.equal(add.status, 200, JSON.stringify(add.body));
  const added = t.all('SELECT name, firm, stage, email, notes FROM raise_prospects WHERE id = ?', add.body.local_id)[0];
  assert.deepEqual(added, { name: 'Sam Lee', firm: 'Northwind Ventures', stage: 'meeting', email: null, notes: 'Met at demo day' });

  const link = await t.accept(ps[1].id);
  assert.equal(link.status, 200);
  assert.equal(link.body.local_id, Number(t.all("SELECT id FROM raise_prospects WHERE uid = 'p-acme'")[0].id), 'linked to the investor already tracked');
  assert.equal(t.all('SELECT id FROM raise_prospects').length, 2, 'no duplicate');
  assert.equal(t.all("SELECT stage FROM raise_prospects WHERE uid = 'p-acme'")[0].stage, 'contacted', 'a link changes nothing by itself');
});

test('with the email mapped, a match on email links, and a new investor keeps the email the founder mapped', async () => {
  const t = fixture();
  t.notion.rows = [
    { id: rowId(3), properties: { Name: 'D. Reyes', Firm: 'Someone Else', Stage: 'Reached', Email: 'DANA@acme.capital' } },
    { id: rowId(4), properties: { Name: 'Kim Park', Firm: 'Harbor Street', Stage: 'Reached', Email: 'kim@harbor.vc' } },
  ];
  await crm(t, { fields: { ...MAP.fields, email: { property: 'Email' } } });
  await t.sync();
  const ps = proposals(t);
  assert.deepEqual(ps.map((p) => p.title), ['Link to Acme Capital', 'Add Harbor Street at Contacted?']);
  await t.accept(ps[1].id);
  assert.equal(t.all("SELECT email FROM raise_prospects WHERE name = 'Kim Park'")[0].email, 'kim@harbor.vc');
});

test('once linked, a stage changed in Notion is a fact through the stage writer, not a new proposal', async () => {
  const t = fixture();
  t.notion.rows = [{ id: rowId(1), properties: { Name: 'Sam Lee', Firm: 'Northwind Ventures', Stage: 'Reached' } }];
  await crm(t);
  await t.sync();
  const [p] = proposals(t);
  const id = (await t.accept(p.id)).body.local_id;
  t.notion.rows[0].properties.Stage = 'In DD';
  const s = await t.sync();
  assert.equal(s.body.sources[0].counts.updated, 1);
  assert.equal(t.all('SELECT stage FROM raise_prospects WHERE id = ?', id)[0].stage, 'diligence');
  assert.deepEqual(proposals(t).map((x) => x.status), ['accepted'], 'no new proposal');
  assert.ok(t.all("SELECT details FROM activity_logs WHERE action = 'prospect_updated'").some((r) => /Contacted → Diligence/.test(r.details)), 'logged by the stage writer');
  const again = await t.sync();
  assert.equal(again.body.sources[0].counts.updated, 0, 'the same stage writes nothing');
  t.notion.rows[0].properties.Notes = 'changed only the notes';
  await t.sync();
  assert.equal(t.all('SELECT notes FROM raise_prospects WHERE id = ?', id)[0].notes, null, 'only the stage follows Notion');
  t.db.exec(`DELETE FROM raise_prospects WHERE id = ${Number(id)}`);
  t.notion.rows[0].properties.Stage = 'Meeting booked';
  const gone = await t.sync();
  assert.deepEqual([gone.body.sources[0].counts.updated, gone.body.sources[0].counts.proposed], [0, 0], 'an investor deleted in Raise is not brought back, nor proposed again');
  assert.equal(t.all('SELECT id FROM raise_prospects WHERE id = ?', id).length, 0);

});

async function memo(t: ReturnType<typeof fixture>, md = '# Memo\n\nWhy now.') {
  t.notion.pages.set(MEMO, md);
  const r = await t.call(11, 'POST', '/api/connectors/notion/sources', { project: 701, module: 'data_room', kind: 'page', notion_id: MEMO });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await t.sync();
  return Number(t.all("SELECT id FROM notion_proposals WHERE module = 'data_room'")[0].id);
}

test('a page waits as Add a snapshot; nothing reaches the room or storage before Accept; Accept stores it NDA by default under the venture\'s prefix', async () => {
  const t = fixture();
  const id = await memo(t);
  assert.equal(t.all("SELECT title FROM notion_proposals WHERE id = ?", id)[0].title, 'Add a snapshot of “Investor memo v3”?');
  assert.equal(t.all('SELECT id FROM data_room_files').length, 0, 'an investor sees nothing: no file');
  assert.equal(t.FILES.objects.size, 0, 'and no object');
  const r = await t.accept(id);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const f = t.all('SELECT name, visibility, r2_key, content_type, size_bytes FROM data_room_files')[0];
  assert.deepEqual([f.name, f.visibility, f.content_type], ['Investor memo v3.md', 'nda', 'text/markdown']);
  assert.match(f.r2_key, /^data-room\/v-acme\//, 'the key is the venture\'s');
  assert.equal(new TextDecoder().decode(t.FILES.objects.get(f.r2_key)!.bytes), '# Memo\n\nWhy now.');
});

test('the dialog may make it open; anything else is refused; a page changed since it was proposed is refused until synced', async () => {
  const t = fixture();
  const id = await memo(t);
  assert.deepEqual([(await t.accept(id, { visibility: 'public' })).body.error], ['invalid_visibility']);
  t.notion.pages.set(MEMO, '# Memo v4');
  assert.deepEqual([(await t.accept(id)).body.error], ['changed_in_notion']);
  assert.equal(t.all('SELECT id FROM data_room_files').length, 0);
  await t.sync();
  assert.equal((await t.accept(id, { visibility: 'open' })).status, 200);
  assert.equal(t.all('SELECT visibility FROM data_room_files')[0].visibility, 'open');
});

test('a later change proposes Update the snapshot, and adds a version on Accept only', async () => {
  const t = fixture();
  const id = await memo(t);
  await t.accept(id);
  const file = t.all('SELECT id, r2_key FROM data_room_files')[0];
  t.notion.pages.set(MEMO, '# Memo\n\nWhy now, revised.');
  await t.sync();
  const p = t.all('SELECT status, changed, title FROM notion_proposals WHERE id = ?', id)[0];
  assert.deepEqual([p.status, p.changed, p.title], ['pending', 1, 'Update the snapshot of “Investor memo v3”']);
  assert.equal(t.all('SELECT id FROM data_room_file_versions').length, 0, 'no version before Accept');
  assert.equal(t.all('SELECT r2_key FROM data_room_files')[0].r2_key, file.r2_key);
  assert.equal((await t.accept(id)).status, 200);
  assert.equal(t.all('SELECT id FROM data_room_files').length, 1, 'the same file');
  assert.deepEqual(t.all('SELECT version, r2_key FROM data_room_file_versions').map((v) => [v.version, v.r2_key]), [[1, file.r2_key]], 'the earlier snapshot kept as version 1');
  const now = t.all('SELECT r2_key FROM data_room_files')[0].r2_key;
  assert.match(now, /^data-room\/v-acme\//);
  assert.equal(new TextDecoder().decode(t.FILES.objects.get(now)!.bytes), '# Memo\n\nWhy now, revised.');
});

test('an investor reads no Raise proposal from Notion', async () => {
  const t = fixture();
  await memo(t);
  const r = await t.call(33, 'GET', '/api/cycles/raise/notion?project=701&module=data_room');
  assert.notEqual(r.status, 200);
  assert.doesNotMatch(JSON.stringify(r.body), /Investor memo/);
});
