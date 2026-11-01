/**
 * D1420 (#3864) — `studio:layout` on `POST /api/ai/rail/run`: Eadwyn's layout
 * proposals for /studio (SM9, SM10). Refused before any hold; the hold is said
 * before the run; only placeable, unlocked ops within 12 are proposed; only
 * `ai_rail_proposals` rows are written, never `studio_layouts`.
 *
 * On the migrated schema, synthetic rows only. The runner and the quoter are
 * stubs (`railRunRoutes({ run, quote })`) that record each call in order.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/studio_layout_proposals_d1420.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { railRunRoutes } from '../src/routes/rail_run.ts';
import ai from '../src/routes/ai.ts';
import railProposals from '../src/routes/ai_rail_proposals.ts';
import { railOptionsOn } from '../src/services/ai/railMatrix.ts';
import { STUDIO_MODULES, STUDIO_LAYOUT_MAX, catalogueOf } from '../src/services/studioModules.ts';
import { STUDIO_RAIL_PAGES, validateOps } from '../src/services/studioLayoutRun.ts';
import { runRefusalView } from '../src/util/railContext.ts';
import { TASK_LABELS } from '../src/services/aiCatalog.ts';

const SECRET = randomBytes(32).toString('hex');
test.after(() => removeMigratedDatabases());

const OPTION = 'studio:layout';
const FOUNDER_PAGE = 'Founder · Studio';
const INVESTOR_PAGE = 'Investor · Home';

// 11 founder (in the Lab, week 3), 12 investor (free), 13 advisor, 14 partner, 51 admin, 61 explorer, 62 Spin-Out Lab explorer.
function fixture(output: unknown = '{"ops":[]}') {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'One','one@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active,spinout_lab_active,spinout_lab_week) VALUES
      (11,'Founder','f@example.test','founder',101,1,1,3),(12,'Investor','i@example.test','investor',NULL,1,0,1),
      (13,'Advisor','a@example.test','advisor',NULL,1,0,1),(14,'Partner','p@example.test','partner',NULL,1,0,1),
      (51,'Admin','h@example.test','admin',NULL,1,0,1),(61,'Explorer','e@example.test','exploring',NULL,1,0,1),
      (62,'Lab Explorer','le@example.test','exploring',NULL,1,1,2);
  `);
  db.prepare("INSERT INTO studio_layouts(user_id,profile,layout) VALUES (11,'founder',?)").run(JSON.stringify([
    { key: 'company_progress', size: 'full' }, { key: 'eadwyn_questions', size: '1/2' },
  ]));
  const calls: string[] = [];
  let out: unknown = output;
  const stub = { quote: { ok: true, model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', hold_microusd: 4200 } as any, run: null as any };
  const quote = async (_env: any, input: any) => { calls.push(`quote:${input.task}`); return stub.quote; };
  const run = async (_env: any, input: any) => {
    calls.push(`run:${input.task}`);
    seen.push(input);
    return stub.run ?? { ok: true, output: out, usageLogId: null, usage: { model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' } };
  };
  const seen: any[] = [];
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  const app = new Hono<any>();
  app.onError((e: any, c: any) => c.json({ detail: e.message }, 500));
  app.route('/api/ai/rail', railRunRoutes({ run: run as any, quote: quote as any }));
  app.route('/api/ai/rail/proposals', railProposals);
  app.route('/api/ai', ai);
  const jwt = async (who: number, support = false) => {
    const u = db.prepare('SELECT role FROM users WHERE id = ?').get(who) as any;
    return new SignJWT({ user_id: who, role: u.role, ...(support ? { impersonated_by: 51 } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  };
  const post = async (who: number, body: Record<string, unknown>, support = false) => {
    const r = await app.request('/api/ai/rail/run', { method: 'POST', headers: { Authorization: `Bearer ${await jwt(who, support)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
    const text = await r.text();
    const events = (r.headers.get('content-type') || '').startsWith('text/event-stream')
      ? text.trim().split('\n\n').map((b) => ({ event: /^event: (.+)$/m.exec(b)![1], data: JSON.parse(/^data: (.+)$/m.exec(b)![1]) }))
      : [];
    return { status: r.status, text, body: (() => { try { return JSON.parse(text); } catch { return null; } })(), events, done: events.find((e) => e.event === 'done')?.data };
  };
  const get = async (who: number, path: string, init: { method?: string; body?: unknown } = {}) => {
    const r = await app.request(path, { method: init.method ?? 'GET', headers: { Authorization: `Bearer ${await jwt(who)}`, 'Content-Type': 'application/json' }, ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) }, env);
    return { status: r.status, body: await r.json() as any };
  };
  const layouts = () => JSON.stringify(db.prepare('SELECT * FROM studio_layouts ORDER BY user_id, profile').all());
  const rows = () => (db.prepare('SELECT user_id, rail_page, rail_option, record_ref, kind, payload_json, usage_log_id FROM ai_rail_proposals ORDER BY id').all() as any[])
    .map((r) => ({ ...r, payload: JSON.parse(r.payload_json) }));
  return { db, post, get, calls, seen, stub, rows, layouts, setOutput: (o: unknown) => { out = o; } };
}
const ask = (page = FOUNDER_PAGE) => ({ page, option: OPTION });
const ops = (...list: unknown[]) => JSON.stringify({ ops: list });

test('refused before any quote, hold or run: an Explorer, a support session, an admin, a page that is not the member\'s Studio', async () => {
  const f = fixture(ops({ op: 'add', key: 'lab_tools', size: '1/2' }));
  const explorer = await f.post(61, ask());
  assert.deepEqual([explorer.status, explorer.body.error], [403, 'no_profile']);
  const support = await f.post(11, ask(), true);
  assert.deepEqual([support.status, support.body.error], [403, 'support_session_refused']);
  const admin = await f.post(51, ask());
  assert.deepEqual([admin.status, admin.body.error], [403, 'read_only_preview']);
  assert.match(admin.body.detail, /preview/);
  for (const page of [INVESTOR_PAGE, 'Founder · Validate', 'Advisor · Home', '']) {
    const r = await f.post(11, ask(page));
    assert.deepEqual([r.status, r.body.error], [404, 'unknown_page'], page);
  }
  // Advisor /studio has no rail (owner request): no page key is theirs.
  const advisor = await f.post(13, ask('Advisor · Home'));
  assert.deepEqual([advisor.status, advisor.body.error], [404, 'unknown_page']);
  assert.deepEqual(f.calls, [], 'no stub was called');
  assert.equal(f.rows().length, 0);
});

test('a Spin-Out Lab member arranges their founder Studio; the investor and partner on their own Home key', async () => {
  const f = fixture();
  assert.equal((await f.post(62, ask())).status, 200);
  assert.equal((await f.post(12, ask(INVESTOR_PAGE))).status, 200);
  assert.equal((await f.post(14, ask('Operating Partner · Home'))).status, 200);
  assert.deepEqual(STUDIO_RAIL_PAGES, { founder: FOUNDER_PAGE, investor: INVESTOR_PAGE, partner: 'Operating Partner · Home' });
});

test('the order: meta carries the hold before the run; the run is the studio_layout task on the rail', async () => {
  const f = fixture(ops({ op: 'add', key: 'lab_tools', size: '1/2' }));
  const r = await f.post(11, ask());
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(f.calls, ['quote:studio_layout', 'run:studio_layout']);
  assert.deepEqual(r.events.map((e) => e.event), ['meta', 'done']);
  assert.deepEqual(r.events[0].data, { model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', hold_microusd: 4200 });
  assert.deepEqual(f.seen[0].rail, { page: FOUNDER_PAGE, option: OPTION, record: null });
  // The model reads the layout, the catalogue and the founder's Lab week; no table name, no email.
  const said = f.seen[0].messages.map((m: any) => m.content).join('\n');
  assert.ok(said.includes('"company_progress"') && said.includes('"week":3'));
  assert.ok(!/studio_layouts|ai_rail_proposals|score_snapshots|@example\.test/.test(said));
});

test('pricing: GET /api/ai/pricing lists the studio_layout task; the task has its label; the chip is offered on the three Studio pages only', async () => {
  const f = fixture();
  const p = await f.get(11, '/api/ai/pricing');
  assert.equal(p.status, 200);
  assert.ok(p.body.routes.studio_layout?.model, 'the router entry puts it in the price list');
  assert.equal(TASK_LABELS.studio_layout, 'Arrange your Studio');
  for (const page of Object.values(STUDIO_RAIL_PAGES)) {
    const o = railOptionsOn(page).find((x) => x.optionKey === OPTION);
    assert.ok(o && o.models.length, page);
    assert.equal(o!.optionLabel, 'Arrange my Studio for this stage');
  }
  assert.equal(railOptionsOn('Advisor · Home').some((x) => x.optionKey === OPTION), false);
  const rail = await f.get(11, `/api/ai/rail?page=${encodeURIComponent(FOUNDER_PAGE)}`);
  assert.ok(rail.body.options.some((o: any) => o.key === OPTION), 'GET /api/ai/rail lists it with its own pick');
});

test('validation: six ops, one per drop reason plus one valid, write exactly one row and name five dropped, never by a raw key', async () => {
  const locked = { key: 'synthetic_pipeline', profile: 'founder', title: 'Synthetic pipeline', group: 'studio', purpose: 'p', href: null, reads: ['/api/capital/synthetic'], default_size: '1/2' };
  (STUDIO_MODULES as any[]).push(locked);
  try {
    // Founder 11's saved layout holds company_progress and eadwyn_questions.
    const f = fixture(ops(
      { op: 'add', key: 'not_a_module', size: '1/2' },
      { op: 'add', key: 'synthetic_pipeline', size: '1/2' },
      { op: 'remove', key: 'strip' },
      { op: 'add', key: 'eadwyn_questions', size: '1/2' },
      { op: 'resize', key: 'company_progress', size: '2/3' },
      { op: 'add', key: 'lab_tools', size: '1/2' },
    ));
    // The founder has no Studio plan, so a module behind /api/capital is locked for them.
    const r = await f.post(11, ask());
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.done.dropped, [
      { op: 'add', title: null, why: 'not_offered' },
      { op: 'add', title: 'Synthetic pipeline', why: 'locked' },
      { op: 'remove', title: 'Founder strip', why: 'fixed' },
      { op: 'add', title: 'Eadwyn’s questions', why: 'already_placed' },
      { op: 'resize', title: 'Company progress', why: 'invalid_size' },
    ]);
    const rows = f.rows();
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], {
      user_id: 11, rail_page: FOUNDER_PAGE, rail_option: OPTION, record_ref: null, kind: 'proposal',
      payload_json: rows[0].payload_json, usage_log_id: null,
      payload: { op: 'add', key: 'lab_tools', title: 'Lab tools', size: '1/2', source: rows[0].payload.source, base_revision: 1 },
    });
    assert.equal(typeof rows[0].payload.source, 'string');
    assert.deepEqual(r.done.proposals.map((p: any) => [p.op, p.key, p.base_revision]), [['add', 'lab_tools', 1]]);
  } finally { (STUDIO_MODULES as any[]).splice(-1); }
});

test('no op takes the layout past 12, counting the ops kept before it', () => {
  const user: any = { id: 11, role: 'founder', founder_id: 101 };
  const offered = catalogueOf('founder', user).map((m) => m.key);
  const eleven = offered.slice(0, 11).map((key) => ({ key, size: '1/3' as const }));
  const spare = offered.slice(11, 13);
  const out = validateOps(ops({ op: 'add', key: spare[0], size: '1/3' }, { op: 'add', key: spare[1], size: '1/3' }), 'founder', user, eleven);
  assert.equal(STUDIO_LAYOUT_MAX, 12);
  assert.deepEqual(out.kept.map((k) => k.key), [spare[0]]);
  assert.deepEqual(out.dropped.map((d) => d.why), ['over_limit']);
  // A remove first makes room for both.
  const room = validateOps(ops({ op: 'remove', key: eleven[0].key }, { op: 'add', key: spare[0], size: '1/3' }, { op: 'add', key: spare[1], size: '1/3' }), 'founder', user, eleven);
  assert.equal(room.kept.length, 3);
});

test('nothing is written to the layout by any run; the payload carries the read\'s revision', async () => {
  const f = fixture(ops({ op: 'remove', key: 'eadwyn_questions' }, { op: 'move', key: 'company_progress', index: 0 }));
  f.db.prepare("UPDATE studio_layouts SET revision = 7 WHERE user_id = 11").run();
  const before = f.layouts();
  const r = await f.post(11, ask());
  assert.equal(r.status, 200, r.text);
  assert.equal(f.layouts(), before, 'studio_layouts is unchanged');
  assert.deepEqual(f.rows().map((x) => x.payload.base_revision), [7, 7]);
  // A member with no saved row: the default layout, revision null.
  const g = fixture(ops({ op: 'add', key: 'lab_tools', size: '1/2' }));
  g.db.prepare('DELETE FROM studio_layouts').run();
  await g.post(62, ask());
  assert.equal(g.layouts(), '[]');
});

test('nothing to change: an empty output proposes nothing and writes no row; so does output with nothing usable', async () => {
  const f = fixture('{"ops":[]}');
  const r = await f.post(11, ask());
  assert.equal(r.done.reason, 'nothing_to_change');
  assert.deepEqual(r.done.proposals, []);
  f.setOutput('I would leave it as it is.');
  const words = await f.post(11, ask());
  assert.equal(words.done.reason, 'nothing_to_change');
  assert.equal(f.rows().length, 0);
});

test('refusals pass through: out of tokens before the hold, or the AI switched off in the run; no row and no charge', async () => {
  const f = fixture(ops({ op: 'add', key: 'lab_tools', size: '1/2' }));
  f.stub.quote = { ok: false, refusal: 'budget_user_month', error: 'x' };
  const broke = await f.post(11, ask());
  assert.deepEqual(broke.done.refusal, runRefusalView({ refusal: 'budget_user_month', error: 'x' }));
  assert.deepEqual(f.calls, ['quote:studio_layout'], 'no run after a refused quote');
  f.stub.quote = { ok: true, model: 'm', hold_microusd: 1 };
  f.stub.run = { ok: false, refusal: 'assist_off', error: 'off' };
  const off = await f.post(11, ask());
  assert.equal(off.done.refusal.code, 'assist_off');
  assert.equal(f.rows().length, 0);
  assert.equal((f.db.prepare('SELECT COUNT(*) n FROM ai_usage_logs').get() as any).n, 0);
});

test('Accept and Edit decide a studio:layout proposal on the existing route; Discard too; the layout is still untouched', async () => {
  const f = fixture(ops({ op: 'add', key: 'lab_tools', size: '1/2' }, { op: 'resize', key: 'company_progress', size: '1/2' }, { op: 'remove', key: 'eadwyn_questions' }));
  const before = f.layouts();
  const r = await f.post(11, ask());
  const [a, b, d] = r.done.proposals;
  const accept = await f.get(11, `/api/ai/rail/proposals/${a.uid}/decide`, { method: 'POST', body: { decision: 'accept' } });
  assert.equal(accept.status, 200, JSON.stringify(accept.body));
  const edit = await f.get(11, `/api/ai/rail/proposals/${b.uid}/decide`, { method: 'POST', body: { decision: 'edit', payload: { ...b, size: 'full' } } });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  const discard = await f.get(11, `/api/ai/rail/proposals/${d.uid}/decide`, { method: 'POST', body: { decision: 'discard' } });
  assert.equal(discard.status, 200, JSON.stringify(discard.body));
  const listed = await f.get(11, `/api/ai/rail/proposals?option=${encodeURIComponent(OPTION)}&status=proposed`);
  assert.deepEqual(listed.body.proposals, []);
  assert.equal(f.layouts(), before, 'deciding saves nothing: Accept saves through PUT /api/studio/layout');
});
