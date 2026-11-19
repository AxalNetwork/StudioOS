/** D6897 part 4 (#6897, RA-31): the Raise status page shared outside Axal, as a link and as a PDF copy.
 *  Real SQLite with the production schema and migrations; every person, venture and figure is synthetic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import router from '../src/routes/cycle_raise.ts';
import evidenceSharePublic from '../src/routes/evidence_share_public.ts';
import readinessSharePublic from '../src/routes/readiness_share_public.ts';
import statusSharePublic from '../src/routes/status_share_public.ts';
import { EVIDENCE_SHARE_READ } from '../src/middleware/rateLimit.ts';
import { listPackLinks, revokePackLink } from '../src/services/raiseEvidenceShare.ts';
import { createStatusLink, materialWords, statusBody } from '../src/services/raiseStatusPage.ts';

const DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true }); loadSchema(db);
  const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all().map((r: any) => r.sql); db.close(); return ddl;
})();
const secret = 't'.repeat(64); // in-memory test signing seed only
const KEYS = ['narrative', 'deck', 'data_room', 'cap_table', 'use_of_funds', 'traction', 'team', 'pmf'];

function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true }); for (const sql of DDL) db.exec(sql);
  db.exec(`INSERT INTO users(id,name,email,role,founder_id,is_active,spinout_lab_active,kyc_status) VALUES
   (1,'Synthetic Founder','one@example.invalid','founder',100,1,0,NULL),(3,'Synthetic Admin','three@example.invalid','admin',NULL,1,0,NULL);
   INSERT INTO projects(id,uid,name,founder_id,company_id) VALUES(1,'venture-one','Synthetic Venture',100,10);
   INSERT INTO company_profiles(id,uid,company_name) VALUES(10,'company-one','Synthetic One');
   INSERT INTO user_company_links(uid,user_id,company_id) VALUES('one',1,10),('three',3,10);`);
  KEYS.forEach((k, i) => db.prepare('INSERT INTO readiness_items(id,project_id,item_key,label,position) VALUES(?,?,?,?,?)').run(i + 1, 1, k, k, i));
  const env: any = { DB: d1Over(db), JWT_SECRET: secret, ENVIRONMENT: 'development' };
  const ctx: any = { env, user: db.prepare('SELECT * FROM users WHERE id=1').get(), projectId: 1, companyId: 10, founder: true };
  const app = new Hono<any>(); app.route('/api/cycles/raise', router); app.route('/api/share/evidence', evidenceSharePublic); app.route('/api/share/readiness', readinessSharePublic); app.route('/api/share/status', statusSharePublic);
  return { db, env, ctx, app };
}
type World = ReturnType<typeof world>;
function pipeline(w: World) {
  const rows: Array<[string, string]> = [['to_contact', 'Synthetic Angel A'], ['contacted', 'Synthetic Fund B'], ['meeting', 'Synthetic Fund C'],
    ['diligence', 'Synthetic Fund D'], ['diligence', 'Synthetic Fund E'], ['committed', 'Synthetic Fund F'], ['passed', 'Synthetic Fund G']];
  rows.forEach(([stage, name], i) => w.db.prepare('INSERT INTO raise_prospects(uid,project_id,name,email,firm,stage,notes,amount) VALUES(?,?,?,?,?,?,?,?)')
    .run('p' + i, 1, name, `p${i}@example.invalid`, name + ' Partners', stage, 'PRIVATE PROSPECT NOTE', 250000 + i));
  w.db.prepare("INSERT INTO readiness_scores(item_id,project_id,score,evidence,missing,source,scored_at) VALUES(1,1,6,'stated','A sharper why-now.','computed','2026-11-02 09:00:00')").run();
}
const tokenOf = (path: string) => path.split('/').pop() as string;
async function call(w: World, who: number, method: string, tail: string, body?: unknown) {
  const auth = { Authorization: 'Bearer ' + await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret)) };
  const r = await w.app.request('/api/cycles/raise' + tail, { method, headers: { 'Content-Type': 'application/json', 'X-Company-Id': '10', ...auth }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, w.env);
  return { status: r.status, body: await r.json() as any };
}
async function open(w: World, token: string, page = 'status') {
  const r = await w.app.request(`/api/share/${page}/` + token, { method: 'GET' }, w.env);
  return { status: r.status, cache: r.headers.get('Cache-Control'), body: await r.json() as any };
}
const deps = (room: any = { slug: 'data-room', name: 'Data room', state: 'ok' }) => ({ currentDeck: async () => null, roomCard: async () => room });

test('the page: stage, five materials in words, counts by stage only, readiness, next steps, tools; no names or amounts', async () => {
  const w = world(); try {
    pipeline(w);
    const made = await call(w, 1, 'POST', '/status/share-links?project=1', { label: 'Synthetic co-founder update' });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.equal(made.body.output, 'status'); assert.equal(made.body.sent, false); assert.equal(made.body.item_count, 5);
    assert.match(made.body.path, /^\/share\/status\/[A-Za-z0-9_-]{40,}$/);
    const seen = await open(w, tokenOf(made.body.path));
    assert.equal(seen.status, 200); assert.equal(seen.cache, 'no-store');
    const page = seen.body.status;
    assert.equal(page.kind, 'status'); assert.equal(page.venture, 'Synthetic One');
    // A prospect in the pipeline: the stage is Run the raise, with the three before it done.
    assert.equal(page.stage.key, 'run_the_raise');
    assert.deepEqual(page.stage.stages.map((s: any) => s.state), ['done', 'done', 'done', 'current']);
    assert.deepEqual(page.materials.map((m: any) => m.label), ['Investor narrative', 'Pitch', 'Data room', 'Cap table', 'Use of funds']);
    assert.equal(page.materials[1].words, 'No deck');
    for (const m of page.materials) assert.equal(typeof m.words, 'string');
    // Mutation checked: count passed in In pipeline → 7; drop meeting from the talks → 3.
    assert.deepEqual(page.investors, { in_pipeline: 6, active_conversations: 4, in_diligence: 2, committed: 1 });
    assert.equal(page.readiness.areas.length, 7);
    assert.ok(page.next_steps.length <= 3);
    for (const s of page.next_steps) assert.deepEqual(Object.keys(s).sort(), ['label', 'text']);
    // A tool's read state and day only, never the fact it read (a runway, a count).
    for (const t of page.tools) assert.deepEqual(Object.keys(t).sort(), ['as_of', 'key', 'label', 'state', 'words']);
    assert.deepEqual(page.tools.map((t: any) => [t.key, t.words]), [['mercury', 'Not connected'], ['github', 'Not connected'], ['google', 'Not connected']]);
    const text = JSON.stringify(seen.body);
    for (const leak of ['Synthetic Fund', 'Synthetic Angel', 'example.invalid', 'PRIVATE', '250000', 'Partners']) assert.ok(!text.includes(leak), leak);
    // A status token opens no other page, and no other token opens this one.
    assert.equal((await open(w, tokenOf(made.body.path), 'readiness')).status, 404);
    assert.equal((await open(w, tokenOf(made.body.path), 'evidence')).status, 404);
    assert.equal((w.db.prepare("SELECT COUNT(*) n FROM activity_logs WHERE action='raise_status_shared'").get() as any).n, 1);
    const row: any = w.db.prepare('SELECT * FROM raise_evidence_share_links').get();
    assert.equal(row.output, 'status'); assert.ok(!row.snapshot_json.includes('Synthetic Fund'));
  } finally { w.db.close(); }
});

test('frozen on the day it is made; the founder\'s list says when the raise has changed since', async () => {
  const w = world(); try {
    pipeline(w);
    const made: any = await createStatusLink(w.ctx, { label: 'Synthetic advisor' }, deps());
    let list: any = await listPackLinks(w.ctx, async () => (await statusBody({ env: w.env, projectId: 1, today: '2026-11-18' }, deps())).hash);
    assert.equal(list.links.find((l: any) => l.uid === made.uid).changed_since_sent, false);
    w.db.prepare("INSERT INTO raise_prospects(uid,project_id,name,stage) VALUES('late',1,'Synthetic Late','committed')").run();
    const seen = await open(w, tokenOf(made.path));
    assert.equal(seen.body.status.investors.committed, 1);
    list = await listPackLinks(w.ctx, async () => (await statusBody({ env: w.env, projectId: 1, today: '2026-11-18' }, deps())).hash);
    // Mutation checked: skip the status hash in listPackLinks → null, not true.
    assert.equal(list.links.find((l: any) => l.uid === made.uid).changed_since_sent, true);
    await revokePackLink(w.ctx, made.uid);
    assert.equal((await open(w, tokenOf(made.path))).body.state, 'revoked');
  } finally { w.db.close(); }
});

test('nothing exported half-filled: an unreadable part makes no link and no copy', async () => {
  const w = world(); try {
    pipeline(w);
    // Mutation checked: let an unreadable card through as words → a link is made.
    await assert.rejects(createStatusLink(w.ctx, { label: 'x' }, deps({ slug: 'data-room', name: 'Data room', state: 'unreadable' })),
      (e: any) => e.code === 'status_unreadable' && e.status === 503);
    await assert.rejects(createStatusLink(w.ctx, { label: 'x' }, { currentDeck: async () => { throw new Error('deck unreadable'); }, roomCard: deps().roomCard }),
      (e: any) => e.code === 'status_unreadable');
    w.db.exec('DROP TABLE raise_prospects');
    const r = await call(w, 1, 'POST', '/status/pdf-copies?project=1', { label: 'x' });
    assert.equal(r.status, 503); assert.equal(r.body.error, 'status_unreadable');
    assert.equal((w.db.prepare('SELECT COUNT(*) n FROM raise_evidence_share_links').get() as any).n, 0);
    assert.equal((w.db.prepare('SELECT COUNT(*) n FROM raise_share_pdf_copies').get() as any).n, 0);
  } finally { w.db.close(); }
});

test('the PDF copy: the same page, recorded as a copy; founders only; malformed input refused', async () => {
  const w = world(); try {
    pipeline(w);
    const copy = await call(w, 1, 'POST', '/status/pdf-copies?project=1', { label: 'Synthetic board' });
    assert.equal(copy.status, 201, JSON.stringify(copy.body));
    assert.equal(copy.body.kind, 'pdf'); assert.equal(copy.body.output, 'status'); assert.equal(copy.body.status.kind, 'status');
    assert.deepEqual(copy.body.status.investors, { in_pipeline: 6, active_conversations: 4, in_diligence: 2, committed: 1 });
    const row: any = w.db.prepare('SELECT * FROM raise_share_pdf_copies').get();
    assert.equal(row.output, 'status'); assert.equal(row.item_count, 5);
    assert.equal((w.db.prepare("SELECT COUNT(*) n FROM activity_logs WHERE action='raise_status_pdf_copied'").get() as any).n, 1);
    const list = await call(w, 1, 'GET', '/evidence/share-links?project=1');
    assert.equal(list.body.copies[0].output, 'status');
    assert.equal((await call(w, 3, 'POST', '/status/share-links?project=1', { label: 'x' })).status, 403);
    assert.equal((await call(w, 3, 'POST', '/status/pdf-copies?project=1', { label: 'x' })).status, 403);
    for (const bad of [{}, { label: '' }, { label: 'x', view_limit: 0 }, { label: 'x', expires_in_days: 9999 }, { label: 'x', covering_line: 'y' }]) {
      await assert.rejects(createStatusLink(w.ctx, bad as any, deps()), (e: any) => e.code === 'invalid' && e.status === 400, JSON.stringify(bad));
    }
    await assert.rejects(createStatusLink({ ...w.ctx, founder: false }, { label: 'x' }, deps()), (e: any) => e.status === 403);
  } finally { w.db.close(); }
});

test('material words: state words only, unreadable has none', () => {
  assert.equal(materialWords('investor-narrative', 'ok'), 'Saved');
  assert.equal(materialWords('cap-table', 'ok'), 'Recorded');
  assert.equal(materialWords('use-of-funds', 'empty'), 'Not started');
  assert.equal(materialWords('data-room', 'too_little'), 'Partial');
  assert.equal(materialWords('cap-table', 'not_recorded'), 'Not recorded');
  assert.equal(materialWords('cap-table', 'unreadable'), null);
});

test('the public read shares the evidence pack rate-limit bucket', () => {
  assert.ok(EVIDENCE_SHARE_READ.test('/api/share/status/abc'));
  assert.ok(!EVIDENCE_SHARE_READ.test('/api/share/status/abc/more'));
});
