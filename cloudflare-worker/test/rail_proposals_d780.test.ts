// D780 (#2105) — `ai_rail_proposals` (migration 503): what a rail option's run
// leaves for the member to decide, and part 1's two options.
//
//   · The store: a run proposes, the member's press accepts, edits or discards,
//     once; every read and decision is the member's own; a field Eadwyn never
//     fills (D777) is refused.
//   · The routes: GET /api/ai/rail/proposals and POST /:uid/decide.
//   · H20 `draft:publication-summary`: Eadwyn's summary is a proposal naming its
//     run, the publication starts empty, and the Super Admin's Save is the only
//     write; it keeps the proposal as accepted or edited.
//
// `draft:legal/notes` is pinned in `ai_member_presses_d766.test.ts` (case 4):
// the document is the filled template, and the notes are a note here.
// Real SQLite, with the table from the migration; env.AI is stubbed with the
// guard stub. Each case names the mutations it was checked against.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/rail_proposals_d780.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { decideRail, getRail, listRail, proposeRail, proposeRefusal, withdrawRail } from '../src/services/railProposals.ts';
import railProposals from '../src/routes/ai_rail_proposals.ts';
import adminPublications from '../src/routes/admin_publications.ts';

const MIGRATION = readFileSync(new URL('../sql/migrations/503_ai_rail_proposals.sql', import.meta.url), 'utf8');
const RAIL_PREFS = readFileSync(new URL('../sql/migrations/465_ai_rail_preferences.sql', import.meta.url), 'utf8');
const ADMIN = 1;
const MEMBER = 2;
const OTHER = 3;

function makeAI(handler: () => any) {
  const calls: unknown[] = [];
  return { calls, async run(model: string, payload: any) { calls.push({ model, payload }); return handler(); } };
}
const reply = (text: string) => ({ response: text, usage: { prompt_tokens: 40, completion_tokens: 12 } });

function world(ai: any = makeAI(() => reply('x'))) {
  __resetForTest();
  const f = aiBudgetFixture();
  f.db.exec(MIGRATION);
  f.db.exec(RAIL_PREFS);
  f.db.prepare("INSERT INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES('admin',0,0,1)").run();
  f.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(?,?)').run(ADMIN, 5_000_000);
  const env: any = { DB: f.DB, AI: withGuard(ai, () => 'safe'), JWT_SECRET: 'd780-fixture-only-secret', ENVIRONMENT: 'development' };
  return { f, env, ai };
}
function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error', m: String(e?.message) }, 500);
  });
  a.route('/api/ai/rail/proposals', railProposals);
  a.route('/api/admin/publications', adminPublications);
  return a;
}
async function call(w: any, who: number, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await app().request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) }, w.env);
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
const base = { userId: MEMBER, page: 'Founder · Build', option: 'draft:thing', record: 'project:7', kind: 'draft' as const, payload: { text: 'A line' } };

// 1 ───────────────────────────────────────────────────────────────────────────
test('a run proposes; the member decides once, and only their own', async () => {
  // Mutations checked: the decision unscoped by user; the `status = 'proposed'` guard dropped; edit stored without the member's version.
  const { env } = world();
  const p = await proposeRail(env, { ...base, model: '@cf/x', usageLogId: null });
  assert.equal(p.status, 'proposed');
  assert.deepEqual([p.rail_page, p.rail_option, p.record_ref, p.kind], ['Founder · Build', 'draft:thing', 'project:7', 'draft']);

  assert.equal(await decideRail(env, OTHER, p.uid, 'accept'), null, 'another member decided it');
  assert.equal(await getRail(env, OTHER, p.uid), null, 'another member read it');
  assert.deepEqual(await listRail(env, OTHER, { option: 'draft:thing' }), []);

  assert.equal(await decideRail(env, MEMBER, p.uid, 'edit'), null, 'an edit with no version');
  const edited = await decideRail(env, MEMBER, p.uid, 'edit', { text: 'My line' });
  assert.equal(edited?.status, 'edited');
  assert.deepEqual(edited?.payload, { text: 'A line' }, 'Eadwyn\'s version is kept');
  assert.deepEqual(edited?.decided_payload, { text: 'My line' });
  assert.equal(await decideRail(env, MEMBER, p.uid, 'discard'), null, 'decided twice');
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('what the store refuses: a never-fill field, a bad key, a bad kind', async () => {
  // Mutations checked: the never-fill check removed; the kind check removed.
  const { env } = world();
  assert.equal(proposeRefusal({ ...base, kind: 'proposal', payload: { field: 'fund_capital_calls.amount', value: 1000 } }), 'a field Eadwyn never fills');
  assert.equal(proposeRefusal({ ...base, page: 'x\nDROP' }), 'not a rail page');
  assert.equal(proposeRefusal({ ...base, option: 'has space' }), 'not a rail option');
  assert.equal(proposeRefusal({ ...base, kind: 'record' as any }), 'not a kind');
  assert.equal(proposeRefusal({ ...base, kind: 'proposal', payload: { field: 'hypotheses.claim', value: 'x' } }), null);
  await assert.rejects(proposeRail(env, { ...base, kind: 'proposal', payload: { field: 'profiles.ssn', value: '1' } }), /never fills/);
  assert.equal(env.DB && (await listRail(env, MEMBER, { option: 'draft:thing' })).length, 0, 'a refused proposal was stored');
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('the platform withdraws only the member\'s open proposals on that record', async () => {
  const { env } = world();
  const open = await proposeRail(env, base);
  const kept = await proposeRail(env, base);
  await decideRail(env, MEMBER, kept.uid, 'accept');
  const elsewhere = await proposeRail(env, { ...base, record: 'project:8' });
  assert.equal(await withdrawRail(env, MEMBER, 'draft:thing', 'project:7'), 1);
  assert.equal((await getRail(env, MEMBER, open.uid))?.status, 'withdrawn');
  assert.equal((await getRail(env, MEMBER, kept.uid))?.status, 'accepted');
  assert.equal((await getRail(env, MEMBER, elsewhere.uid))?.status, 'proposed');
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('the routes: a member lists and decides their own, and another member gets 409', async () => {
  // Mutations checked: the route passing the uid's owner instead of the caller.
  const w = world();
  const p = await proposeRail(w.env, base);
  const listed = await call(w, MEMBER, 'GET', '/api/ai/rail/proposals?option=draft:thing&record=project:7&status=proposed');
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.proposals.map((x: any) => x.uid), [p.uid]);
  assert.equal((await call(w, MEMBER, 'GET', '/api/ai/rail/proposals')).status, 400);
  assert.equal((await call(w, OTHER, 'POST', `/api/ai/rail/proposals/${p.uid}/decide`, { decision: 'accept' })).status, 409);
  assert.equal((await call(w, MEMBER, 'POST', `/api/ai/rail/proposals/${p.uid}/decide`, { decision: 'send' })).status, 400);
  const ok = await call(w, MEMBER, 'POST', `/api/ai/rail/proposals/${p.uid}/decide`, { decision: 'discard' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.proposal.status, 'discarded');
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('H20 draft:publication-summary: the summary is a proposal naming its run; the publication starts empty', async () => {
  // Mutations checked: the AI summary written into summary_text again; the proposal stored without its usage row; the old option key.
  const w = world(makeAI(() => reply('- [sector_heat:fintech] Up 12% (2026-W18)')));
  const r = await call(w, ADMIN, 'POST', '/api/admin/publications/draft', { title: 'Q3 heat', section: 'sector_heat', audience: 'internal' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ai_ok, true);
  const pub = w.f.db.prepare('SELECT id, summary_text, summary_human_edited FROM admin_publications').get();
  assert.equal(pub.summary_text, '', 'Eadwyn\'s summary was written into the publication');
  const run = w.f.db.prepare("SELECT id, rail_option FROM ai_usage_logs WHERE guard_for IS NULL AND task = 'publication'").get();
  assert.equal(run.rail_option, 'draft:publication-summary');
  const row = w.f.db.prepare('SELECT * FROM ai_rail_proposals').get();
  assert.deepEqual([row.user_id, row.kind, row.rail_option, row.record_ref, row.usage_log_id, row.status],
    [ADMIN, 'draft', 'draft:publication-summary', `publication:${pub.id}`, run.id, 'proposed']);
  assert.deepEqual(r.body.summary_proposal, { uid: row.uid, text: '- [sector_heat:fintech] Up 12% (2026-W18)' });

  const read = await call(w, ADMIN, 'GET', `/api/admin/publications/${pub.id}`);
  assert.deepEqual(read.body.summary_proposal, r.body.summary_proposal, 'the detail page does not offer it');
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('H20: Save writes the summary and keeps the proposal as accepted, or as edited; only an edit is human-edited', async () => {
  // Mutations checked: Save not deciding the proposal; every proposal Save marked human-edited; a decided proposal accepted again.
  const w = world(makeAI(() => reply('- Eadwyn line')));
  const d = await call(w, ADMIN, 'POST', '/api/admin/publications/draft', { title: 'Q3 heat', section: 'sector_heat', audience: 'internal' });
  const id = d.body.publication.id;
  const uid = d.body.summary_proposal.uid;
  const saved = await call(w, ADMIN, 'PUT', `/api/admin/publications/${id}`, { summary_text: '- Eadwyn line', summary_proposal_uid: uid });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const pub = w.f.db.prepare('SELECT summary_text, summary_human_edited FROM admin_publications WHERE id = ?').get(id);
  assert.deepEqual([pub.summary_text, pub.summary_human_edited], ['- Eadwyn line', 0]);
  assert.equal(w.f.db.prepare('SELECT status FROM ai_rail_proposals WHERE uid = ?').get(uid).status, 'accepted');
  assert.equal((await call(w, ADMIN, 'PUT', `/api/admin/publications/${id}`, { summary_text: 'x', summary_proposal_uid: uid })).status, 409, 'a decided proposal saved again');

  const d2 = await call(w, ADMIN, 'POST', '/api/admin/publications/draft', { title: 'Q4 heat', section: 'sector_heat', audience: 'internal' });
  const id2 = d2.body.publication.id;
  const uid2 = d2.body.summary_proposal.uid;
  await call(w, ADMIN, 'PUT', `/api/admin/publications/${id2}`, { summary_text: '- My line', summary_proposal_uid: uid2 });
  const p2 = w.f.db.prepare('SELECT summary_text, summary_human_edited FROM admin_publications WHERE id = ?').get(id2);
  assert.deepEqual([p2.summary_text, p2.summary_human_edited], ['- My line', 1]);
  const row = w.f.db.prepare('SELECT status, decided_payload_json FROM ai_rail_proposals WHERE uid = ?').get(uid2);
  assert.deepEqual([row.status, JSON.parse(row.decided_payload_json)], ['edited', { text: '- My line' }]);
});

// 7 ───────────────────────────────────────────────────────────────────────────
test('H20: a model that cannot be reached keeps the aggregate fallback in the blank, and proposes nothing', async () => {
  // Mutations checked: the fallback stored as Eadwyn's proposal.
  const w = world(makeAI(() => { throw new Error('5007: model unavailable'); }));
  const r = await call(w, ADMIN, 'POST', '/api/admin/publications/draft', { title: 'Q3 heat', section: 'sector_heat', audience: 'internal' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ai_ok, false);
  assert.equal(r.body.summary_proposal, null);
  assert.notEqual(w.f.db.prepare('SELECT summary_text FROM admin_publications').get().summary_text, '');
  assert.equal(w.f.db.prepare('SELECT COUNT(*) AS n FROM ai_rail_proposals').get().n, 0);
});
