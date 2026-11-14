/**
 * D1093 (#2958, part 4 of #2402) — Google Workspace feeds Build: spec Docs as
 * Solution design proposals, a mapped roadmap Sheet into Product roadmap under
 * the one-owner rule. The provider is the shared fake: no test reaches Google.
 * Every file, heading, row and person is invented.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/google_workspace_gw4.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import buildGoogle from '../src/routes/build_google.ts';
import workspaceRoutes from '../src/routes/google_workspace.ts';
import { DRIVE_FILE_SCOPE, ensureWorkspaceIntegration } from '../src/services/google/workspace.ts';
import { docOutline, keyResultsJson, laneOf, progressOf, roadmapMapping } from '../src/services/google/buildFeeds.ts';
import { ensureIntegrationsSchema } from '../src/integrations/registry.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { googleWorkspaceFake } from './_google_workspace_fake.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const SECRET = 'synthetic-workspace-gw4-secret-0123456789';
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const app = new Hono<any>();
app.route('/api/cycles/build/google', buildGoogle);
app.route('/api/connectors/google-workspace', workspaceRoutes);
app.onError((err, c) => c.json({ error: 'authentication_failed' }, AUTH_ERROR_STATUSES[err.message] ?? 500));
const base = '/api/cycles/build/google';

const META = {
  spec: { name: 'Synthetic spec', mimeType: 'application/vnd.google-apps.document' },
  spec2: { name: 'Synthetic second spec', mimeType: 'application/vnd.google-apps.document' },
  plan: { name: 'Synthetic roadmap', mimeType: 'application/vnd.google-apps.spreadsheet' },
};
const heading = (level: number, text: string) => ({ paragraph: { paragraphStyle: { namedStyleType: `HEADING_${level}` }, elements: [{ textRun: { content: `${text}\n` } }] } });
const para = (text: string) => ({ paragraph: { paragraphStyle: { namedStyleType: 'NORMAL_TEXT' }, elements: [{ textRun: { content: text } }] } });
const SPEC = (extra: any[] = []) => ({ title: 'Payments spec', body: { content: [heading(1, 'Architecture'), para('Private paragraph text never stored.'), heading(2, 'Queue design'), ...extra] } });
const SHEET = () => [
  ['Objective', 'Key result', 'Quarter', 'Status', 'Progress'],
  ['Launch the pilot', '3 paying pilots', 'Q4 2026', 'In progress', '40%'],
  ['Hire a CTO', '', 'Q1 2027', 'Planned', ''],
  ['', 'orphan KR', 'Q1 2027', 'Done', ''],
  ['launch the pilot', 'duplicate', 'Q4 2026', 'Done', ''],
  ['Close the seed', 'Raise 1.5M', 'Q2 2027', 'Mystery', '0.25'],
];
const MAPPING = { header_row: 1, columns: { objective: 'A', key_result: 'B', quarter: 'C', status: 'D', progress: 'E' } };

async function fixture(docs: Record<string, unknown> = { spec: SPEC() }, sheets: Record<string, unknown> = { plan: SHEET() }) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  const baseline = read('../sql/schema_baseline.sql');
  for (const t of ['users', 'founders', 'projects', 'user_company_links', 'roadmap_okrs']) db.exec(tableFromBaseline(baseline, t));
  db.exec('ALTER TABLE roadmap_okrs ADD COLUMN created_by INTEGER');
  for (const t of ['companies']) db.exec(tableFromBaseline(read('../sql/migrations/034_unmounted_routes.sql'), t));
  db.exec(read('../sql/migrations/445_connector_fed_items.sql'));
  db.exec(read('../sql/migrations/500_github_solution_design.sql'));
  db.exec(read('../sql/migrations/588_google_workspace_files.sql'));
  db.exec('CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, user_id INTEGER, entity_type TEXT, entity_id TEXT, action TEXT, details TEXT, actor TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
  db.exec('CREATE TABLE google_oauth_tokens(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER UNIQUE,refresh_token TEXT,scope TEXT,google_sub TEXT,google_email TEXT,updated_at TEXT)');
  db.exec("INSERT INTO users(id,email,name,role,is_active,founder_id) VALUES (1,'founder@example.test','Synthetic founder','founder',1,1),(2,'other@example.test','Other','founder',1,2)");
  db.exec("INSERT INTO companies(id,company_name) VALUES (1,'Synthetic venture'),(2,'Other venture')");
  db.exec("INSERT INTO projects(id,name,founder_id,company_id) VALUES (1,'Synthetic project',1,1),(2,'Other project',2,2)");
  db.exec("INSERT INTO user_company_links(uid,user_id,company_id) VALUES ('link1',1,1),('link2',2,2)");
  db.prepare('INSERT INTO google_oauth_tokens(user_id,refresh_token,scope,google_sub,google_email,updated_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)').run(1, 'server-refresh-only', DRIVE_FILE_SCOPE, 'google-member', 'founder@example.test');
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development', GOOGLE_CAL_CLIENT_ID: 'public-client', GOOGLE_CAL_CLIENT_SECRET: 'synthetic-secret', PUBLIC_BASE_URL: 'https://axal.vc' };
  await ensureIntegrationsSchema(env);
  db.exec('CREATE TABLE IF NOT EXISTS integration_companies(integration_id INTEGER,company_id INTEGER,enabled INTEGER,PRIMARY KEY(integration_id,company_id))');
  const integration = await ensureWorkspaceIntegration(env, 1);
  db.prepare('INSERT INTO integration_companies VALUES (?,?,1)').run(integration.id, 1);
  const fake = googleWorkspaceFake({ ...META, docs, sheets });
  const old = globalThis.fetch; globalThis.fetch = fake.fetcher;
  const call = async (path: string, method = 'GET', body?: unknown, as = 1) => {
    const token = await new SignJWT({ user_id: as, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const res = await app.request(path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body === undefined || method === 'GET' ? {} : { body: JSON.stringify(body) }) }, env);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  };
  const choose = async (module: string, ids: string[]) => { const r = await call('/api/connectors/google-workspace/files', 'POST', { project: 1, module, ids }); assert.equal(r.status, 201, JSON.stringify(r.body)); };
  const fileUid = (id: string) => (db.prepare('SELECT uid FROM google_workspace_files WHERE drive_file_id = ?').get(id) as any).uid;
  const map = async (id: string, mapping: unknown) => (await call(`/api/connectors/google-workspace/files/${fileUid(id)}/mapping`, 'PUT', { mapping })).status;
  const sync = () => call(`${base}/sync`, 'POST', { project: 1 });
  const okrs = () => (db.prepare('SELECT id, objective, quarter, kanban_status, key_results_json FROM roadmap_okrs ORDER BY id').all() as any[]).map((r) => ({ ...r }));
  const close = () => { globalThis.fetch = old; db.close(); };
  return { db, env, integration, fake, call, choose, map, sync, okrs, fileUid, close };
}

// ───────────────────────────────────────────────────────────── pure rules ──

test('the mapping is validated by the feed: objective, quarter and status required, columns A–Z, distinct', () => {
  assert.deepEqual(roadmapMapping(MAPPING), MAPPING);
  assert.deepEqual(roadmapMapping({ columns: { objective: 'A', quarter: 'B', status: 'C' } }), { header_row: 1, columns: { objective: 'A', quarter: 'B', status: 'C' } });
  for (const bad of [null, [], {}, { columns: { objective: 'A', quarter: 'B' } }, { columns: { objective: 'A', quarter: 'B', status: 'B' } },
    { columns: { objective: 'A', quarter: 'B', status: 'AA' } }, { columns: { objective: 'A', quarter: 'B', status: 'C', owner: 'D' } },
    { header_row: 11, columns: { objective: 'A', quarter: 'B', status: 'C' } }, { columns: { objective: 'a', quarter: 'B', status: 'C' } }]) {
    assert.equal(roadmapMapping(bad), null, JSON.stringify(bad));
  }
});

test('status words map to lanes, an unknown word moves nothing; progress is a percentage or nothing, never a guess', () => {
  assert.deepEqual(['Done', 'shipped', 'In progress', 'at risk', 'Planned', 'to do', 'Backlog', 'Mystery', ''].map(laneOf), ['done', 'done', 'now', 'now', 'next', 'next', 'later', null, null]);
  assert.deepEqual(['40%', '40', '0.25', '100%', '1', 'abc', '', '120', '-5'].map(progressOf), [40, 40, 25, 100, 1, null, null, null, null]);
  assert.equal(keyResultsJson({ key: 'k', objective: 'o', quarter: null, lane: null, keyResult: null, progress: null }), '[]');
  assert.deepEqual(JSON.parse(keyResultsJson({ key: 'k', objective: 'o', quarter: null, lane: null, keyResult: '3 pilots', progress: 40 })), [{ text: '3 pilots', current: 40, target: 100, unit: '%' }]);
});

test('a Doc’s outline is its title and headings only, never its paragraphs', () => {
  const o = docOutline(SPEC());
  assert.deepEqual(o, { title: 'Payments spec', headings: [{ level: 1, text: 'Architecture' }, { level: 2, text: 'Queue design' }] });
  assert.ok(!JSON.stringify(o).includes('Private paragraph'));
});

// ───────────────────────────────────────────────────────────── spec Docs ──

test('a spec Doc becomes one proposal; the same text proposes nothing new; a dismissed one stays dismissed until the Doc changes', async () => {
  const f = await fixture();
  try {
    await f.choose('solution_design', ['spec']);
    const s1 = await f.sync();
    assert.equal(s1.status, 200, JSON.stringify(s1.body));
    assert.equal(s1.body.totals.proposed, 1);
    const p = f.db.prepare('SELECT * FROM google_workspace_proposals').all() as any[];
    assert.equal(p.length, 1);
    assert.deepEqual([p[0].module, p[0].kind, p[0].source_key, p[0].title, p[0].status], ['solution_design', 'design_note', 'spec', 'Payments spec', 'pending']);
    assert.ok(!p[0].payload_json.includes('Private paragraph'), 'no paragraph text is stored');
    assert.equal((await f.sync()).body.totals.unchanged, 1, 'the same text proposes nothing new');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM solution_design_notes').get().n, 0, 'nothing lands until Accept');
    const dismissed = await f.call(`${base}/proposals/${p[0].id}/dismiss`, 'POST', { project: 1 });
    assert.equal(dismissed.status, 200);
    await f.sync();
    assert.equal((f.db.prepare('SELECT status FROM google_workspace_proposals').get() as any).status, 'dismissed', 'stays dismissed');
    assert.equal((await f.call(`${base}/proposals/${p[0].id}/dismiss`, 'POST', { project: 1 })).status, 409);
  } finally { f.close(); }
  const g = await fixture({ spec: SPEC([heading(2, 'Retry policy')]) });
  try {
    await g.choose('solution_design', ['spec']);
    await g.sync();
    const id = (g.db.prepare('SELECT id FROM google_workspace_proposals').get() as any).id;
    await g.call(`${base}/proposals/${id}/dismiss`, 'POST', { project: 1 });
    g.db.prepare('UPDATE google_workspace_proposals SET fingerprint = ? WHERE id = ?').run('an-older-text', id);
    assert.equal((await g.sync()).body.totals.changed, 1);
    assert.equal((g.db.prepare('SELECT status FROM google_workspace_proposals').get() as any).status, 'pending', 'changed text comes back');
  } finally { g.close(); }
});

test('an Accept that loses a race to another decision writes nothing', async () => {
  const f = await fixture();
  try {
    await f.choose('solution_design', ['spec']);
    await f.sync();
    const id = (f.db.prepare('SELECT id FROM google_workspace_proposals').get() as any).id;
    const real = f.env.DB;
    // Someone dismisses it between this Accept's read and its write.
    f.env.DB = { ...real, prepare(sql: string) {
      if (/^UPDATE google_workspace_proposals SET status = 'accepted'/.test(sql)) f.db.prepare("UPDATE google_workspace_proposals SET status = 'dismissed' WHERE id = ?").run(id);
      return real.prepare(sql);
    }, batch: (st: any) => real.batch(st) };
    const r = await f.call(`${base}/proposals/${id}/accept`, 'POST', { project: 1 });
    f.env.DB = real;
    assert.equal(r.status, 409);
    assert.equal((f.db.prepare('SELECT status FROM google_workspace_proposals').get() as any).status, 'dismissed');
  } finally { f.close(); }
});

test('Accept writes one design note linked by the ledger; a later Accept updates it, never a second; a deleted note is written again', async () => {
  const f = await fixture();
  try {
    await f.choose('solution_design', ['spec']);
    await f.sync();
    const id = (f.db.prepare('SELECT id FROM google_workspace_proposals').get() as any).id;
    assert.equal((await f.call(`${base}/proposals/${id}/accept`, 'POST', { project: 1 }, 2)).status, 403, 'another venture’s member');
    const ok = await f.call(`${base}/proposals/${id}/accept`, 'POST', { project: 1 });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const note = f.db.prepare('SELECT * FROM solution_design_notes').get() as any;
    assert.deepEqual([note.project_id, note.title, note.source_path, note.source_url, note.created_by],
      [1, 'Payments spec', 'google_docs/spec', 'https://docs.google.com/document/d/spec/edit', 1]);
    assert.equal(note.body, '• Architecture\n  • Queue design');
    const led = f.db.prepare('SELECT * FROM connector_fed_items').get() as any;
    assert.deepEqual([led.module, led.kind, led.external_id, led.local_table, led.local_id], ['solution_design', 'design_note', 'spec:design_note', 'solution_design_notes', note.id]);
    assert.equal((await f.call(`${base}/proposals/${id}/accept`, 'POST', { project: 1 })).status, 409, 'once');
    // The Doc changes, comes back, and is accepted again: the same note.
    f.db.prepare("UPDATE google_workspace_proposals SET status = 'pending', title = 'Payments spec v2' WHERE id = ?").run(id);
    await f.call(`${base}/proposals/${id}/accept`, 'POST', { project: 1 });
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM solution_design_notes').get().n, 1);
    assert.equal((f.db.prepare('SELECT title FROM solution_design_notes').get() as any).title, 'Payments spec v2');
    // The founder deleted the note; a later Accept is their decision and writes it again.
    f.db.exec('DELETE FROM solution_design_notes');
    f.db.prepare("UPDATE google_workspace_proposals SET status = 'pending' WHERE id = ?").run(id);
    await f.call(`${base}/proposals/${id}/accept`, 'POST', { project: 1 });
    const again = f.db.prepare('SELECT id FROM solution_design_notes').get() as any;
    assert.ok(again);
    assert.equal((f.db.prepare('SELECT local_id FROM connector_fed_items').get() as any).local_id, again.id);
    assert.equal((await f.call(`${base}/proposals/999/accept`, 'POST', { project: 1 })).status, 404);
    assert.equal((await f.call(`${base}/proposals/abc/accept`, 'POST', { project: 1 })).status, 404);
  } finally { f.close(); }
});

// ─────────────────────────────────────────────────────────── roadmap Sheet ──

test('an unmapped Sheet, or one mapped without objective, quarter and status, lands nothing', async () => {
  const f = await fixture();
  try {
    await f.choose('product_roadmap', ['plan']);
    const s = await f.sync();
    assert.equal(s.body.totals.needs_mapping, 1);
    assert.equal(s.body.files[0].state, 'needs_mapping');
    assert.equal(f.okrs().length, 0);
    assert.ok(!f.fake.calls.some((c) => c.host === 'sheets.googleapis.com'), 'an unmapped Sheet is not even read');
    assert.equal(await f.map('plan', { columns: { objective: 'A', quarter: 'C' } }), 200, 'part 2 stores any draft');
    assert.equal((await f.sync()).body.totals.needs_mapping, 1);
    assert.equal(f.okrs().length, 0);
  } finally { f.close(); }
});

test('a mapped row lands once; a re-sync updates its own row; blank and repeated objectives are counted, not landed', async () => {
  const f = await fixture();
  try {
    await f.choose('product_roadmap', ['plan']);
    await f.map('plan', MAPPING);
    const s = await f.sync();
    assert.deepEqual(s.body.totals, { proposed: 0, changed: 0, unchanged: 0, created: 3, updated: 0, held: 0, deleted_kept: 0, blank: 1, repeated: 1, needs_mapping: 0, unreadable: 0 });
    const rows = f.okrs();
    assert.deepEqual(rows.map((r) => [r.objective, r.quarter, r.kanban_status]), [['Launch the pilot', 'Q4 2026', 'now'], ['Hire a CTO', 'Q1 2027', 'next'], ['Close the seed', 'Q2 2027', 'next']]);
    assert.deepEqual(JSON.parse(rows[0].key_results_json), [{ text: '3 paying pilots', current: 40, target: 100, unit: '%' }]);
    assert.equal(rows[1].key_results_json, '[]', 'no key result and no progress: none invented');
    assert.equal(JSON.parse(rows[2].key_results_json)[0].current, 25);
    const again = await f.sync();
    assert.equal(again.body.totals.created, 0, 'lands once');
    assert.equal(again.body.totals.updated, 3);
    assert.equal(f.okrs().length, 3);
    const ledger = f.db.prepare("SELECT external_id, local_table FROM connector_fed_items WHERE kind = 'roadmap_row'").all() as any[];
    assert.equal(ledger.length, 3);
    assert.ok(ledger.every((l) => /^plan:row:[0-9a-f]{16}$/.test(l.external_id) && l.local_table === 'roadmap_okrs'));
    // An unknown status word keeps the founder's lane.
    f.db.exec("UPDATE roadmap_okrs SET kanban_status = 'later' WHERE objective = 'Close the seed'");
    await f.sync();
    assert.equal(f.okrs().find((r) => r.objective === 'Close the seed').kanban_status, 'later');
  } finally { f.close(); }
});

test('a deleted row stays deleted; a GitHub-linked, Notion-linked or hand-entered row is never written', async () => {
  const f = await fixture();
  try {
    await f.choose('product_roadmap', ['plan']);
    await f.map('plan', MAPPING);
    await f.sync();
    // The founder deletes one; the next sync keeps it deleted and unlinks it.
    const gone = f.okrs().find((r) => r.objective === 'Hire a CTO');
    f.db.prepare('DELETE FROM roadmap_okrs WHERE id = ?').run(gone.id);
    let s = await f.sync();
    assert.equal(s.body.totals.deleted_kept, 1);
    assert.ok(!f.okrs().some((r) => r.objective === 'Hire a CTO'));
    s = await f.sync();
    assert.equal(s.body.totals.deleted_kept, 1, 'still deleted on the sync after');
    assert.equal(f.okrs().length, 2);
    // Rows the Sheet does not own: hand-entered, GitHub's, Notion's.
    f.db.exec(`INSERT INTO roadmap_okrs (id, project_id, objective, quarter, kanban_status) VALUES
      (900, 1, 'Hand-entered goal', 'Q4 2026', 'now'), (901, 1, 'GitHub issue item', NULL, 'next'), (902, 1, 'Notion item', 'Q1 2027', 'later')`);
    f.db.exec(`INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id) VALUES
      (77, 1, 'product_roadmap', 'issue', 'issue:acme/app#1', 'roadmap_okrs', 901), (78, 1, 'product_roadmap', 'page', 'notion-page-1', 'roadmap_okrs', 902)`);
    // Even a Sheet row the ledger once linked to a row another connection now also claims is held, not written.
    const pilot = f.okrs().find((r) => r.objective === 'Launch the pilot');
    f.db.prepare(`INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id) VALUES (79, 1, 'product_roadmap', 'issue', 'issue:acme/app#2', 'roadmap_okrs', ?)`).run(pilot.id);
    f.db.prepare("UPDATE roadmap_okrs SET objective = 'Edited elsewhere' WHERE id = ?").run(pilot.id);
    const before = f.db.prepare('SELECT * FROM roadmap_okrs WHERE id IN (900, 901, 902) ORDER BY id').all();
    s = await f.sync();
    assert.deepEqual(f.db.prepare('SELECT * FROM roadmap_okrs WHERE id IN (900, 901, 902) ORDER BY id').all(), before, 'untouched, field by field');
    assert.equal(s.body.totals.held, 1);
    assert.equal(f.okrs().find((r) => r.id === pilot.id).objective, 'Edited elsewhere', 'a contested row is held');
  } finally { f.close(); }
});

// ─────────────────────────────────────────────────── reads, scope, failures ──

test('From Google reads the files, the pending proposals and the roadmap items this connection owns', async () => {
  const f = await fixture();
  try {
    await f.choose('solution_design', ['spec']);
    await f.choose('product_roadmap', ['plan']);
    await f.map('plan', MAPPING);
    await f.sync();
    const r = await f.call(`${base}?project=1`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.files.map((x: any) => [x.module, x.name, x.mapped, x.status]), [['solution_design', 'Synthetic spec', null, 'active'], ['product_roadmap', 'Synthetic roadmap', true, 'active']]);
    assert.ok(r.body.files.every((x: any) => x.last_synced_at));
    assert.deepEqual(r.body.proposals.map((p: any) => [p.title, p.headings.length]), [['Payments spec', 2]]);
    assert.deepEqual(r.body.roadmap.map((o: any) => [o.objective, o.key_result, o.quarter, o.progress]),
      [['Launch the pilot', '3 paying pilots', 'Q4 2026', 40], ['Hire a CTO', null, 'Q1 2027', null], ['Close the seed', 'Raise 1.5M', 'Q2 2027', 25]]);
    assert.doesNotMatch(JSON.stringify(r.body), /server-refresh-only|browser-must-never-see-server-access/);
    assert.equal((await f.call(`${base}?project=1`, 'GET', undefined, 2)).status, 403);
    assert.equal((await f.call(`${base}?project=2`)).status, 403, 'the project named is the one checked');
    f.db.exec("UPDATE google_workspace_proposals SET status = 'dismissed'");
    assert.deepEqual((await f.call(`${base}?project=1`)).body.proposals, [], 'only pending proposals are offered');
  } finally { f.close(); }
});

test('one unreadable file never stops the next; errors are codes; every provider read is a GET', async () => {
  const f = await fixture({ spec: 'unshared', spec2: SPEC() });
  try {
    await f.choose('solution_design', ['spec', 'spec2']);
    const s = await f.sync();
    assert.equal(s.body.totals.unreadable, 1);
    assert.equal(s.body.totals.proposed, 1, 'the next file still syncs');
    const bad = s.body.files.find((x: any) => x.state === 'unreadable');
    assert.equal(bad.error, 'file_not_shared');
    assert.doesNotMatch(JSON.stringify(s.body), /raw-private-provider-body|server-refresh-only/);
    assert.equal((f.db.prepare("SELECT status FROM google_workspace_files WHERE drive_file_id = 'spec'").get() as any).status, 'unreadable');
    assert.ok(f.fake.calls.filter((x: any) => x.host !== 'oauth2.googleapis.com').every((x: any) => x.method === 'GET'));
  } finally { f.close(); }
});

test('Stop using a Doc drops its pending proposal and unlinks its facts; an accepted note stays', async () => {
  const f = await fixture({ spec: SPEC(), spec2: SPEC() });
  try {
    await f.choose('solution_design', ['spec', 'spec2']);
    await f.sync();
    const [a] = f.db.prepare("SELECT id FROM google_workspace_proposals WHERE source_key = 'spec'").all() as any[];
    await f.call(`${base}/proposals/${a.id}/accept`, 'POST', { project: 1 });
    for (const id of ['spec', 'spec2']) assert.equal((await f.call(`/api/connectors/google-workspace/files/${f.fileUid(id)}`, 'DELETE')).status, 200);
    assert.deepEqual((f.db.prepare('SELECT source_key, status FROM google_workspace_proposals ORDER BY id').all() as any[]).map((r) => [r.source_key, r.status]), [['spec', 'accepted']], 'the pending one is gone');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM solution_design_notes').get().n, 1, 'the accepted note stays');
    assert.equal((f.db.prepare("SELECT local_id FROM connector_fed_items WHERE external_id = 'spec:design_note'").get() as any).local_id, null, 'unlinked');
  } finally { f.close(); }
});

test('bias guard: the new statements are bound and no route logs a cell, a heading or a title', () => {
  const src = read('../src/services/google/buildFeeds.ts') + read('../src/routes/build_google.ts');
  assert.doesNotMatch(src, /prepare\(`[^`]*\$\{/, 'no interpolated SQL');
  for (const m of src.matchAll(/console\.(?:log|warn|error|info)\(([^)]*)\)/g)) assert.doesNotMatch(m[1], /title|heading|objective|row|cell|name/i, m[1]);
});
