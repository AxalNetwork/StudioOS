/**
 * D1088 (#2953, Notion part 4 of #2405) — Build: a roadmap and a must-have
 * database as facts, spec pages as Solution design proposals, under the
 * one-owner rule. On the actual migrated schema (`_storage_schema.ts`),
 * synthetic rows only. Notion is a stub of `NotionReads` (`notionDeps.reads`):
 * no test reaches a provider host. The writers are the real ones
 * (`services/notion/build.ts`).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/notion_nt4.test.ts
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
import { factWriterFor, acceptorFor } from '../src/services/notion/sync.ts';
import { EXTRACT_MAX, keyResultsOf } from '../src/services/notion/build.ts';
import { NOTION_FEEDS } from '../src/integrations/notionFeeds.ts';

const SECRET = 'synthetic-notion-build-secret-'.repeat(3);
test.after(() => removeMigratedDatabases());

const ROADMAP_DB = '11111111222243338444555555555555';
const MUST_DB = '22222222333344448555666666666666';
const SPECS = '66666666777748889999000000000000';
const rowId = (n: number) => `${String(n).padStart(8, '0')}aaaa4bbb8cccdddddddddddd`;
const childId = (n: number) => `${String(n).padStart(8, '0')}eeee4fff8aaabbbbbbbbbbbb`;

function stubNotion() {
  const s: any = {
    calls: [] as string[],
    schemas: new Map<string, string[]>([
      [ROADMAP_DB, ['Objective', 'Status', 'Quarter', 'Key result', 'Progress']],
      [MUST_DB, ['Feature', 'Value', 'Stage']],
    ]),
    rows: new Map<string, Array<{ id: string; properties: Record<string, unknown> }>>(),
    children: [] as Array<{ id: string; title: string }>,
    pages: new Map<string, string>(),
  };
  s.reads = {
    offered: ['notion-search', 'notion-fetch', 'notion-query-data-sources'],
    async searchSources() { return []; },
    async dataSourceSchema(id: string) { s.calls.push(`schema:${id}`); return { id, title: id === ROADMAP_DB ? 'Roadmap 2027' : 'Must-haves', properties: (s.schemas.get(id) ?? []).map((name: string) => ({ name, type: 'text' })) }; },
    async queryRows(id: string) {
      s.calls.push(`rows:${id}`);
      return { rows: (s.rows.get(id) ?? []).map((r: any) => ({ id: r.id, url: `https://www.notion.so/${r.id}`, last_edited: '2026-10-21T09:00:00.000Z', properties: r.properties })), next_cursor: null };
    },
    async listChildren(id: string) { s.calls.push(`children:${id}`); return s.children.map((c: any) => ({ id: c.id, kind: 'page', title: c.title })); },
    async fetchPage(id: string) {
      s.calls.push(`page:${id}`);
      const md = s.pages.get(id) ?? '# Untitled';
      return { id, title: s.children.find((c: any) => c.id === id)?.title ?? 'Specs', url: `https://www.notion.so/${id}`, last_edited: '2026-10-21T09:00:00.000Z',
        markdown: md, fingerprint: createHash('sha256').update(md).digest('hex') };
    },
  };
  return s;
}

function fixture() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'One','one@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active) VALUES (11,'Owner','owner@example.test','founder',101,1);
    INSERT INTO company_profiles(id,uid,company_name) VALUES (1,'co-acme','Acme Robotics');
    INSERT INTO user_company_links(uid,company_id,user_id,is_primary_admin) VALUES ('l1',1,11,1);
    INSERT INTO projects(id,uid,name,founder_id,company_id) VALUES (701,'v-acme','Acme Field',101,1);
    INSERT INTO integrations(id,uid,user_id,provider_key,status,auth_type) VALUES (5,'i-notion',11,'notion','active','oauth_mcp'),(7,'i-github',11,'github','active','oauth2');
    INSERT INTO integration_companies(integration_id,company_id,enabled) VALUES (5,1,1),(7,1,1);
  `);
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db), RATE_LIMITS: memKV() };
  const app = new Hono<any>();
  app.onError((e: any, c: any) => c.json({ detail: e.message }, AUTH_ERROR_STATUSES[e?.message] || 500));
  app.route('/api/connectors/notion', notionRoutes);
  app.route('/api/cycles', notionCycleRoutes);
  const notion = stubNotion();
  notionDeps.reads = async () => notion.reads;
  const call = async (method: string, path: string, b?: unknown) => {
    const jwt = await new SignJWT({ user_id: 11, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    const res = await app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }, env);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  };
  const sync = async () => { const r = await call('POST', '/api/cycles/build/notion/sync', { project: 701 }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
  return { db, env, notion, call, sync };
}

const ROADMAP_MAP = { fields: {
  objective: { property: 'Objective' },
  status: { property: 'Status', values: { 'In progress': 'now', 'Up next': 'next', Someday: 'later', Shipped: 'done' } },
  quarter: { property: 'Quarter' }, key_result: { property: 'Key result' }, progress: { property: 'Progress' },
} };
const MUST_MAP = { fields: {
  feature: { property: 'Feature' },
  added_value: { property: 'Value', values: { Critical: 'High', Nice: 'Low', Useful: 'Medium' } },
  delivery_status: { property: 'Stage', values: { Todo: 'Backlog', Doing: 'In Progress', Shipped: 'Done' } },
} };

async function addSource(t: ReturnType<typeof fixture>, module: string, kind: string, notionId: string, map?: unknown) {
  const r = await t.call('POST', '/api/connectors/notion/sources', { project: 701, module, kind, notion_id: notionId, ...(map ? { field_map: map } : {}) });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.source.uid as string;
}
const roadmap = (db: any) => db.prepare('SELECT id, objective, kanban_status, quarter, key_results_json, created_by FROM roadmap_okrs WHERE project_id = 701 ORDER BY id').all().map((r: any) => ({ ...r }));
const musts = (db: any) => db.prepare('SELECT id, title, is_must_have, added_value, delivery_status, effort FROM mvp_features WHERE project_id = 701 ORDER BY id').all().map((r: any) => ({ ...r }));

test('the three writers and the acceptor are registered, and NOTION_FEEDS names Build\'s three feeds', () => {
  assert.deepEqual([factWriterFor('product_roadmap')?.localTable, factWriterFor('prototype_mvp')?.localTable], ['roadmap_okrs', 'mvp_features']);
  assert.equal(acceptorFor('design_note')?.kind, 'design_note');
  assert.deepEqual(NOTION_FEEDS.filter((f) => f.decision === 'D1088').map((f) => [f.key, f.module, [...f.tools]]), [
    ['build_roadmap', 'product_roadmap', ['notion-fetch', 'notion-query-data-sources']],
    ['build_must_haves', 'prototype_mvp', ['notion-fetch', 'notion-query-data-sources']],
    ['build_specs', 'solution_design', ['notion-fetch']],
  ]);
});

test('Product roadmap: a row is one item; status maps to Now, Next, Later and Done; quarter and the key result land; a re-sync updates its own row only', async () => {
  const t = fixture();
  await addSource(t, 'product_roadmap', 'database', ROADMAP_DB, ROADMAP_MAP);
  t.notion.rows.set(ROADMAP_DB, [
    { id: rowId(1), properties: { Objective: 'Checkout v2', Status: 'In progress', Quarter: '2027 Q1', 'Key result': 'Conversion', Progress: '40%' } },
    { id: rowId(2), properties: { Objective: 'Onboarding', Status: 'Up next', Quarter: '2027 Q2' } },
    { id: rowId(3), properties: { Objective: 'Mobile app', Status: 'Someday' } },
    { id: rowId(4), properties: { Objective: 'Billing', Status: 'Shipped' } },
    { id: rowId(5), properties: { Objective: 'Unsorted', Status: 'Blocked' } },
  ]);
  const first = await t.sync();
  assert.equal(first.sources[0].counts.written, 5);
  const rows = roadmap(t.db);
  assert.deepEqual(rows.map((r: any) => [r.objective, r.kanban_status, r.quarter]), [
    ['Checkout v2', 'now', '2027 Q1'], ['Onboarding', 'next', '2027 Q2'], ['Mobile app', 'later', null], ['Billing', 'done', null],
    ['Unsorted', 'next', null],
  ], 'an unmapped status is never forced onto a lane: a new row starts in Next');
  assert.deepEqual(JSON.parse(rows[0].key_results_json), [{ text: 'Conversion', current: 40, target: 100, unit: '%' }]);
  assert.equal(rows[1].key_results_json, '[]');
  assert.ok(rows.every((r: any) => r.created_by === 11));

  // The founder moves Onboarding to Later by hand and edits nothing else; Notion renames Checkout and blanks its quarter.
  t.db.prepare("UPDATE roadmap_okrs SET kanban_status = 'later' WHERE id = ?").run(rows[1].id);
  t.notion.rows.set(ROADMAP_DB, [
    { id: rowId(1), properties: { Objective: 'Checkout v3', Status: 'In progress', Quarter: '', Progress: '55' } },
    { id: rowId(2), properties: { Objective: 'Onboarding', Quarter: '2027 Q2' } },
  ]);
  const second = await t.sync();
  assert.equal(second.sources[0].counts.updated, 2);
  assert.equal(second.sources[0].counts.written, 0, 'a re-sync never duplicates');
  const after = roadmap(t.db);
  assert.equal(after.length, 5);
  assert.deepEqual([after[0].objective, after[0].quarter], ['Checkout v3', '2027 Q1'], 'a field Notion leaves empty keeps the row\'s own value');
  assert.deepEqual(JSON.parse(after[0].key_results_json), [{ text: 'Progress', current: 55, target: 100, unit: '%' }]);
  assert.equal(after[1].kanban_status, 'later', 'an unmapped status leaves the founder\'s lane alone');
  assert.equal(after[1].key_results_json, '[]', 'a row that maps no key result keeps the row\'s own');
});

test('one owner per row: a GitHub-linked and a hand-entered roadmap item are never updated by a Notion sync', async () => {
  const t = fixture();
  t.db.exec(`
    INSERT INTO roadmap_okrs (id, project_id, objective, kanban_status, quarter) VALUES (900, 701, 'From GitHub', 'now', '2026 Q4'), (901, 701, 'Typed by hand', 'later', NULL);
    INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id) VALUES (7, 701, 'product_roadmap', 'github_issue', 'gh:1', 'roadmap_okrs', 900);
  `);
  await addSource(t, 'product_roadmap', 'database', ROADMAP_DB, ROADMAP_MAP);
  // Notion's ledger is made to claim GitHub's row, as a stale or crossed link would. The
  // hand-entered row has no ledger row at all: nothing of Notion's can name it.
  t.db.exec(`
    INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id) VALUES
      (5, 701, 'product_roadmap', 'notion_fact', 'notion:701:product_roadmap:${rowId(1)}', 'roadmap_okrs', 900);
  `);
  const before = roadmap(t.db).filter((r: any) => r.id === 900 || r.id === 901);
  t.notion.rows.set(ROADMAP_DB, [
    { id: rowId(1), properties: { Objective: 'Overwritten?', Status: 'Shipped', Quarter: '2030 Q1' } },
    { id: rowId(3), properties: { Objective: 'New from Notion', Status: 'Up next' } },
  ]);
  const r = await t.sync();
  assert.equal(r.sources[0].counts.owned_elsewhere, 1, 'GitHub\'s row is GitHub\'s, whatever Notion\'s ledger says');
  assert.equal(r.sources[0].counts.written, 1, 'GitHub and Notion items coexist');
  assert.equal((t.db.prepare("SELECT COUNT(*) AS n FROM connector_fed_items WHERE local_table = 'roadmap_okrs' AND local_id = 901").get() as any).n, 0,
    'the hand-entered row is never linked');
  assert.deepEqual(roadmap(t.db).filter((x: any) => x.id === 900 || x.id === 901), before, 'the GitHub-linked and the hand-entered rows are byte for byte unchanged');
});

test('Prototype / MVP: a row is one must-have; value and status map onto the store\'s lists; unmapped values default, never guessed', async () => {
  const t = fixture();
  await addSource(t, 'prototype_mvp', 'database', MUST_DB, MUST_MAP);
  t.notion.rows.set(MUST_DB, [
    { id: rowId(11), properties: { Feature: 'Sign-in', Value: 'Critical', Stage: 'Doing' } },
    { id: rowId(12), properties: { Feature: 'Export', Value: 'Nice', Stage: 'Shipped' } },
    { id: rowId(13), properties: { Feature: 'Dark mode', Value: 'Someday', Stage: 'Later' } },
  ]);
  await t.sync();
  assert.deepEqual(musts(t.db).map((m: any) => [m.title, m.is_must_have, m.added_value, m.delivery_status, m.effort]), [
    ['Sign-in', 1, 'High', 'In Progress', 'M'], ['Export', 1, 'Low', 'Done', 'M'], ['Dark mode', 1, 'High', 'Backlog', 'M'],
  ]);
  // A hand edit to the value survives a sync where Notion's value is outside the map.
  const [, , dark] = musts(t.db);
  const [signIn] = musts(t.db);
  t.db.prepare("UPDATE mvp_features SET added_value = 'Medium' WHERE id = ?").run(dark.id);
  t.db.prepare("UPDATE mvp_features SET delivery_status = 'Review' WHERE id = ?").run(signIn.id);
  t.notion.rows.set(MUST_DB, [
    { id: rowId(13), properties: { Feature: 'Dark mode', Value: 'Someday', Stage: 'Todo' } },
    { id: rowId(11), properties: { Feature: 'Sign-in', Value: 'Critical', Stage: 'Waiting' } },
  ]);
  await t.sync();
  const d = musts(t.db).find((m: any) => m.id === dark.id);
  assert.deepEqual([d.added_value, d.delivery_status], ['Medium', 'Backlog']);
  assert.equal(musts(t.db).find((m: any) => m.id === signIn.id).delivery_status, 'Review', 'a status outside the map keeps the founder\'s');
  assert.equal(musts(t.db).length, 3);
});

test('a deleted fact stays deleted: the writer removes the row, and the next sync keeps it out', async () => {
  const t = fixture();
  await addSource(t, 'prototype_mvp', 'database', MUST_DB, MUST_MAP);
  t.notion.rows.set(MUST_DB, [{ id: rowId(11), properties: { Feature: 'Sign-in', Value: 'Critical' } }]);
  await t.sync();
  const ledger = t.db.prepare("SELECT id FROM connector_fed_items WHERE integration_id = 5 AND kind = 'notion_fact'").get() as any;
  const del = await t.call('DELETE', `/api/cycles/build/notion/facts/${ledger.id}?project=701`);
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal(musts(t.db).length, 0);
  const again = await t.sync();
  assert.equal(again.sources[0].counts.kept_deleted, 1);
  assert.equal(musts(t.db).length, 0);
});

test('Solution design: each page under Specs is a proposal; Accept writes one note citing the page, with at most 2,000 characters of its Markdown', async () => {
  const t = fixture();
  await addSource(t, 'solution_design', 'page_tree', SPECS);
  t.notion.children = [{ id: childId(1), title: 'Payments spec' }, { id: childId(2), title: 'Auth spec' }];
  t.notion.pages.set(childId(1), `# Payments\n${'x'.repeat(5000)}`);
  t.notion.pages.set(childId(2), '# Auth\nOAuth only.');
  const r = await t.sync();
  assert.equal(r.sources[0].counts.proposed, 2);
  assert.equal((t.db.prepare('SELECT COUNT(*) AS n FROM solution_design_notes').get() as any).n, 0, 'nothing lands before Accept');
  const proposals = t.db.prepare("SELECT id, title FROM notion_proposals WHERE kind = 'design_note' ORDER BY id").all() as any[];
  const acc = await t.call('POST', `/api/cycles/build/notion/proposals/${proposals[0].id}/accept`, { project: 701 });
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  const note = t.db.prepare('SELECT title, body, source_url, source_path, created_by FROM solution_design_notes').get() as any;
  assert.equal(note.title, 'Payments spec');
  assert.equal(note.source_url, `https://www.notion.so/${childId(1)}`, 'the note cites the page');
  assert.equal(note.source_path, `notion/${childId(1)}`);
  assert.ok(note.body.length <= EXTRACT_MAX);
  assert.ok(note.body.startsWith('# Payments'));
  assert.equal(note.created_by, 11);
  // Dismissed stays dismissed.
  const dis = await t.call('POST', `/api/cycles/build/notion/proposals/${proposals[1].id}/dismiss`, { project: 701 });
  assert.equal(dis.status, 200);
  const again = await t.sync();
  assert.equal(again.sources[0].counts.kept_dismissed, 1);
  assert.equal((t.db.prepare('SELECT COUNT(*) AS n FROM solution_design_notes').get() as any).n, 1);
});

test('the key result: one, with its progress clamped to 0–100, only when the row maps either', () => {
  assert.equal(keyResultsOf({}), null);
  assert.deepEqual(JSON.parse(keyResultsOf({ progress: '140' })!), [{ text: 'Progress', current: 100, target: 100, unit: '%' }]);
  assert.deepEqual(JSON.parse(keyResultsOf({ key_result: 'NPS 50' })!), [{ text: 'NPS 50', current: null, target: null, unit: null }]);
  assert.equal(JSON.parse(keyResultsOf({ progress: 'n/a', key_result: 'X' })!)[0].current, null);
});

// ---------------------------------------------------------------- look-alikes (migration 644)

const linkProposals = (db: any) => db.prepare("SELECT id, source_key, title, payload_json, status FROM notion_proposals WHERE kind = 'fact_link' ORDER BY id").all().map((r: any) => ({ ...r, payload: JSON.parse(r.payload_json) }));

test('a look-alike of a hand-entered item waits as "Link to [existing]?"; Accept links it, and the next sync updates it as Notion\'s', async () => {
  const t = fixture();
  t.db.exec(`INSERT INTO roadmap_okrs (id, project_id, objective, kanban_status) VALUES (901, 701, 'Checkout v2', 'later')`);
  await addSource(t, 'product_roadmap', 'database', ROADMAP_DB, ROADMAP_MAP);
  t.notion.rows.set(ROADMAP_DB, [{ id: rowId(1), properties: { Objective: '  checkout   V2 ', Status: 'In progress', Quarter: '2027 Q1' } }]);
  const first = await t.sync();
  assert.equal(first.sources[0].counts.written, 0, 'a look-alike is never imported as a second row');
  assert.equal(roadmap(t.db).length, 1);
  const [p] = linkProposals(t.db);
  assert.equal(p.source_key, rowId(1));
  assert.deepEqual(p.payload, { local_table: 'roadmap_okrs', local_id: 901, existing: 'Checkout v2', fed_by: null });

  const read = await t.call('GET', '/api/cycles/build/notion?project=701&module=product_roadmap');
  const shown = read.body.proposals.find((x: any) => x.kind === 'fact_link');
  assert.deepEqual(shown.link, { existing: 'Checkout v2', fed_by: null });

  const acc = await t.call('POST', `/api/cycles/build/notion/proposals/${p.id}/accept`, { project: 701 });
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  assert.equal(roadmap(t.db).length, 1, 'Accept writes no new row');
  const ledger = t.db.prepare("SELECT kind, local_table, local_id FROM connector_fed_items WHERE integration_id = 5 AND external_id = ?").get(`notion:701:product_roadmap:${rowId(1)}`) as any;
  assert.deepEqual({ ...ledger }, { kind: 'notion_fact', local_table: 'roadmap_okrs', local_id: 901 }, 'linked as a fact, so From Notion lists and deletes it');

  const second = await t.sync();
  assert.equal(second.sources[0].counts.updated, 1);
  assert.deepEqual([roadmap(t.db)[0].kanban_status, roadmap(t.db)[0].quarter], ['now', '2027 Q1'], 'Notion\'s changes now update the linked item');
  const after = await t.call('GET', '/api/cycles/build/notion?project=701&module=product_roadmap');
  assert.equal(after.body.facts.length, 1);
});

test('a look-alike of a row GitHub feeds reads "Already fed by GitHub": it is never linked and never imported', async () => {
  const t = fixture();
  t.db.exec(`
    INSERT INTO mvp_features (id, project_id, title, is_must_have, added_value, delivery_status) VALUES (950, 701, 'Sign-in', 1, 'High', 'Review');
    INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id) VALUES (7, 701, 'prototype_mvp', 'github_pr', 'gh:pr:1', 'mvp_features', 950);
  `);
  const before = musts(t.db);
  await addSource(t, 'prototype_mvp', 'database', MUST_DB, MUST_MAP);
  t.notion.rows.set(MUST_DB, [{ id: rowId(11), properties: { Feature: 'Sign-in', Value: 'Nice', Stage: 'Shipped' } }]);
  await t.sync();
  const [p] = linkProposals(t.db);
  assert.deepEqual(p.payload, { local_table: 'mvp_features', local_id: 950, existing: 'Sign-in', fed_by: 'github' });
  const read = await t.call('GET', '/api/cycles/build/notion?project=701&module=prototype_mvp');
  assert.deepEqual(read.body.proposals.find((x: any) => x.kind === 'fact_link').link, { existing: 'Sign-in', fed_by: 'github' }, 'the page can say whose it is');
  const acc = await t.call('POST', `/api/cycles/build/notion/proposals/${p.id}/accept`, { project: 701 });
  assert.equal(acc.status, 409);
  assert.equal(acc.body.error, 'already_fed');
  assert.equal((t.db.prepare("SELECT status FROM notion_proposals WHERE id = ?").get(p.id) as any).status, 'pending', 'nothing was decided');
  assert.equal((t.db.prepare("SELECT COUNT(*) AS n FROM connector_fed_items WHERE local_table = 'mvp_features' AND local_id = 950").get() as any).n, 1, 'GitHub\'s link stays the only one');
  await t.sync();
  assert.deepEqual(musts(t.db), before, 'byte for byte, and no second row');
});

test('a dismissed look-alike stays out; a feature that is not a must-have is no look-alike; Notion\'s own items never look alike', async () => {
  const t = fixture();
  t.db.exec(`INSERT INTO mvp_features (id, project_id, title, is_must_have) VALUES (960, 701, 'Export', 0), (961, 701, 'Search', 1)`);
  await addSource(t, 'prototype_mvp', 'database', MUST_DB, MUST_MAP);
  t.notion.rows.set(MUST_DB, [
    { id: rowId(11), properties: { Feature: 'Search' } },
    { id: rowId(12), properties: { Feature: 'Export' } },
    { id: rowId(13), properties: { Feature: 'Export' } },
  ]);
  const r = await t.sync();
  assert.equal(r.sources[0].counts.written, 2, 'both Export rows land: a feature that is not a must-have is no look-alike, and Notion\'s own Export is not one either');
  const [p] = linkProposals(t.db);
  assert.equal(p.source_key, rowId(11));
  assert.equal(linkProposals(t.db).length, 1, 'only Search, a must-have, is a look-alike');
  assert.equal((await t.call('POST', `/api/cycles/build/notion/proposals/${p.id}/dismiss`, { project: 701 })).status, 200);
  const again = await t.sync();
  assert.equal(again.sources[0].counts.kept_dismissed, 1);
  assert.equal(musts(t.db).filter((m: any) => m.title === 'Search').length, 1, 'still one Search');
});

test('a link whose item is gone since is refused, and nothing is decided', async () => {
  const t = fixture();
  t.db.exec(`INSERT INTO roadmap_okrs (id, project_id, objective) VALUES (905, 701, 'Pricing')`);
  await addSource(t, 'product_roadmap', 'database', ROADMAP_DB, ROADMAP_MAP);
  t.notion.rows.set(ROADMAP_DB, [{ id: rowId(7), properties: { Objective: 'Pricing' } }]);
  await t.sync();
  const [p] = linkProposals(t.db);
  t.db.exec('DELETE FROM roadmap_okrs WHERE id = 905');
  const acc = await t.call('POST', `/api/cycles/build/notion/proposals/${p.id}/accept`, { project: 701 });
  assert.deepEqual([acc.status, acc.body.error], [409, 'link_target_gone']);
  assert.equal((t.db.prepare('SELECT status FROM notion_proposals WHERE id = ?').get(p.id) as any).status, 'pending');
  assert.equal((t.db.prepare("SELECT COUNT(*) AS n FROM connector_fed_items WHERE integration_id = 5").get() as any).n, 0, 'nothing is linked');
});

test('migration 644 keeps every proposal as it was and takes fact_link', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { readFileSync } = await import('node:fs');
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../sql/migrations/640_notion_sources.sql', import.meta.url), 'utf8'));
  db.exec(`INSERT INTO notion_proposals (integration_id, project_id, module, kind, source_key, fingerprint, title, status, changed)
           VALUES (5, 701, 'solution_design', 'design_note', 'a', 'f1', 'Spec', 'dismissed', 0), (5, 701, 'capital_relationships', 'prospect', 'b', 'f2', 'Firm', 'pending', 1)`);
  assert.throws(() => db.exec(`INSERT INTO notion_proposals (integration_id, project_id, module, kind, source_key, fingerprint, title) VALUES (5, 701, 'product_roadmap', 'fact_link', 'c', 'f3', 'X')`));
  const before = db.prepare('SELECT * FROM notion_proposals ORDER BY id').all().map((r: any) => ({ ...r }));
  db.exec(readFileSync(new URL('../sql/migrations/644_notion_fact_link_proposals.sql', import.meta.url), 'utf8'));
  assert.deepEqual(db.prepare('SELECT * FROM notion_proposals ORDER BY id').all().map((r: any) => ({ ...r })), before);
  db.exec(`INSERT INTO notion_proposals (integration_id, project_id, module, kind, source_key, fingerprint, title) VALUES (5, 701, 'product_roadmap', 'fact_link', 'c', 'f3', 'X')`);
  assert.throws(() => db.exec(`INSERT INTO notion_proposals (integration_id, project_id, module, kind, source_key, fingerprint, title) VALUES (5, 701, 'product_roadmap', 'nonsense', 'd', 'f4', 'Y')`));
  assert.throws(() => db.exec(`INSERT INTO notion_proposals (integration_id, project_id, module, kind, source_key, fingerprint, title) VALUES (5, 701, 'product_roadmap', 'fact_link', 'c', 'f5', 'dup')`), 'the unique key survives');
  assert.ok((db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_notion_proposals_project'").get() as any), 'the index survives');
});
