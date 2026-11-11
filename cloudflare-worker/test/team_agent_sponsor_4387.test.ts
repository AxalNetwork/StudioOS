// D4387 (#4387, #3742 E8) — an agent's sponsor changes, and a cap pause ends
// when the UTC month turns.
//
//   · PUT /api/teams/agents/:uid/sponsor: a valid change, logged with its
//     actor and reason; every refusal its own code (not a member, not an
//     editor, no paid plan, no tokens, tokens unreadable, same sponsor, the old
//     sponsor's tools, no reason, not found); a `sponsor_left` pause resumes;
//   · GET …/sponsors: the team's members, each can or cannot, in words;
//   · the sweep resumes `paused_reason = 'cap'` paused in an earlier month,
//     and nothing else: not this month's cap, not manual, HQ's
//     `persona_retired`, `ai_paused`, `spend_limit` or `sponsor_left`;
//   · `resumes_at` on the agent is the first day of the month after its pause;
//   · the migration keeps every event row, id and the sequence, and widens
//     the kind CHECK by `sponsor_changed` only.
//
// Real SQLite: the baseline's tables, migration 712 and this migration.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/team_agent_sponsor_4387.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { makeD1 } from './_d1_sqlite.mjs';
import { addColumnsFrom, stripForeignKeys, tableFromBaseline } from './_baseline.mjs';
import { AI_BUDGET_MIGRATION, AI_LOG_SCHEMA } from './_ai_budget_fixture.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import teamAgents from '../src/routes/team_agents.ts';
import { sweepAgents } from '../src/agents/sweep.ts';
import { capResumesAt, nextMonthDay, resumeCapPauses } from '../src/services/agents/sponsor.ts';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const BASELINE = sql('schema_baseline.sql');
const THIS = 'migrations/202611040924_team_agent_sponsor_changes.sql';

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const CAP = 5_000_000;
// The sponsor (an editor), a second editor who can pay, a plain member, a stranger,
// an editor on a free plan, an editor with no tokens.
const EDITOR = 10, EDITOR2 = 17, MEMBER = 11, STRANGER = 12, FREE_EDITOR = 13, POOR_EDITOR = 18;

function world({ budget = true } = {}) {
  const { DB, db } = makeD1(
    ['users', 'company_profiles', 'user_company_links', 'projects', 'integrations', 'project_members'].map((t) => stripForeignKeys(tableFromBaseline(BASELINE, t))).join('\n')
    + AI_LOG_SCHEMA + sql('migrations/506_ai_rail_proposals.sql'),
  );
  addColumnsFrom(db, sql('migrations/597_company_archive_and_events.sql'), 'company_profiles');
  db.exec(sql('migrations/712_team_agents.sql'));
  db.exec(sql('migrations/202611021724_team_agents_persona.sql'));
  db.exec(stripForeignKeys(sql('migrations/727_scope_goals_and_tasks.sql')));
  db.exec(sql(THIS));
  if (budget) {
    db.exec(AI_BUDGET_MIGRATION + sql('migrations/525_ai_reservation_idempotency.sql') + sql('migrations/632_ai_hold_context.sql'));
  }
  const user = db.prepare("INSERT INTO users (id, uid, email, name, role, founder_id, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')");
  user.run(1, 'u-admin', 'admin@example.test', 'Ada Admin', 'admin', null, 'free');
  user.run(EDITOR, 'u-editor', 'editor@example.test', 'Eve Editor', 'founder', 100, 'growth');
  user.run(EDITOR2, 'u-editor2', 'editor2@example.test', 'Nia Next', 'founder', 105, 'growth');
  user.run(MEMBER, 'u-member', 'member@example.test', 'Max Member', 'founder', 101, 'growth');
  user.run(STRANGER, 'u-stranger', 'stranger@example.test', 'Sam Stranger', 'founder', 102, 'growth');
  user.run(FREE_EDITOR, 'u-free', 'free@example.test', 'Fay Free', 'founder', 103, 'free');
  user.run(POOR_EDITOR, 'u-poor', 'poor@example.test', 'Pip Poor', 'founder', 106, 'growth');
  if (budget) {
    // The growth licence includes nothing, so a member's tokens are their paid balance alone.
    db.prepare("INSERT INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES('founder:growth',0,0,1)").run();
    const topup = db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(?,50000000)');
    topup.run(EDITOR); topup.run(EDITOR2); topup.run(MEMBER); topup.run(STRANGER); topup.run(FREE_EDITOR);
    // The poor editor pays no plan (so no allowance) and holds no paid balance.
    db.prepare('DELETE FROM member_subscription_amounts WHERE user_id = ?').run(POOR_EDITOR);
  }
  db.prepare("INSERT INTO company_profiles (id, uid, company_name) VALUES (1, 'co-uid-1', 'Acme')").run();
  const link = db.prepare('INSERT INTO user_company_links (uid, user_id, company_id, role_in_company) VALUES (?, ?, 1, ?)');
  link.run('l1', EDITOR, 'Founder'); link.run('l2', MEMBER, 'Member'); link.run('l3', FREE_EDITOR, 'Owner');
  link.run('l4', EDITOR2, 'Admin'); link.run('l5', POOR_EDITOR, 'Admin');
  const kv = new Map<string, string>();
  const env: any = {
    DB, JWT_SECRET: 'd4387-fixture-only-secret', ENVIRONMENT: 'development', TEAM_AGENTS_ENABLED: 'true', AGENT_ENGINE: 'off',
    RATE_LIMITS: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); }, delete: async (k: string) => { kv.delete(k); } },
  };
  return { db, env, kv };
}
type W = ReturnType<typeof world>;

function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error', m: String(e?.message) }, 500);
  });
  a.route('/api/teams', teamAgents);
  return a;
}
async function call(w: W, who: number, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await app().request(`/api/teams${path}`, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) }, w.env);
  const text = await r.text();
  return { status: r.status, body: (text ? JSON.parse(text) : null) as any, text };
}
const CO = '/company/co-uid-1';
const REASON = 'Eve is moving to the board and stops paying for runs.';
function noPrivateKeys(text: string) {
  assert.ok(!/"email"\s*:/.test(text), 'an email key');
  assert.ok(!/@example\.test/.test(text), 'an email address');
  assert.ok(!/"(sponsor_user_id|created_by|actor_user_id|user_id)"\s*:/.test(text), 'a numeric user id key');
}
async function addAgent(w: W, role = 'cfo') {
  const r = await call(w, EDITOR, 'POST', `${CO}/agents`, { role_key: role, model_id: MODEL, monthly_cap_microusd: CAP });
  assert.equal(r.status, 201, r.text);
  return r.body.agent.uid as string;
}
const row = (w: W, uid: string) => w.db.prepare('SELECT * FROM team_agents WHERE uid = ?').get(uid) as any;
const events = (w: W, uid: string) => w.db.prepare('SELECT e.kind, e.actor_user_id AS actor, e.detail_json AS detail, e.created_at AS at FROM team_agent_events e WHERE agent_id = ? ORDER BY e.id').all(row(w, uid).id) as any[];
const sponsorTo = (w: W, uid: string, sponsor_uid: string, over: Record<string, unknown> = {}, who = EDITOR) =>
  call(w, who, 'PUT', `/agents/${uid}/sponsor`, { sponsor_uid, reason: REASON, ...over });

// 1 ───────────────────────────────────────────────────────────────────────────
test('a valid change: the new sponsor is set, the event names who, from whom, to whom and why, and the answer is the agent', async () => {
  // Mutations checked: the UPDATE's sponsor_user_id left unchanged → the row and DTO asserts fail;
  // logEvent's actor null → the actor assert fails; the reason left out of the detail → the detail assert fails.
  const w = world();
  const uid = await addAgent(w);
  const r = await sponsorTo(w, uid, 'u-editor2');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.agent.sponsor, { uid: 'u-editor2', name: 'Nia Next' });
  assert.equal(r.body.agent.status, 'active');
  assert.equal(row(w, uid).sponsor_user_id, EDITOR2);
  const ev = events(w, uid).filter((e) => e.kind === 'sponsor_changed');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].actor, EDITOR);
  assert.deepEqual(JSON.parse(ev[0].detail), { from: { uid: 'u-editor', name: 'Eve Editor' }, to: { uid: 'u-editor2', name: 'Nia Next' }, reason: REASON });
  assert.equal(events(w, uid).some((e) => e.kind === 'resumed'), false, 'an active agent logs no resume');
  noPrivateKeys(r.text);
  // The profile's history carries it, without an email or a numeric id.
  const p = await call(w, MEMBER, 'GET', `/agents/${uid}`);
  assert.equal(p.body.events[0].kind, 'sponsor_changed');
  assert.deepEqual(p.body.events[0].actor, { uid: 'u-editor', name: 'Eve Editor' });
  noPrivateKeys(p.text);
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('refusals: each its own code and words, and nothing changes', async () => {
  // Mutations checked: the onTeam check dropped → the stranger falls through to sponsor_cannot_manage and fails;
  // the target's canManage check dropped → the member's assert fails (200); planOk dropped → the free editor's fails (200);
  // the tokens check dropped → the poor editor's fails (200).
  const w = world();
  const uid = await addAgent(w);
  const cases: [string, number, string, RegExp][] = [
    ['u-stranger', 422, 'sponsor_not_member', /not on this team/],
    ['u-member', 422, 'sponsor_cannot_manage', /cannot manage this team’s agents/],
    ['u-free', 422, 'sponsor_plan_required', /paid Founder plan/],
    ['u-poor', 422, 'sponsor_no_tokens', /no AI tokens left/],
    ['u-nobody', 422, 'sponsor_not_found', /no such member/],
    ['u-editor', 409, 'same_sponsor', /already sponsors/],
  ];
  for (const [who, status, code, words] of cases) {
    const r = await sponsorTo(w, uid, who);
    assert.deepEqual([r.status, r.body?.error], [status, code], `${who}: ${r.text}`);
    assert.match(r.body.message, words, who);
  }
  for (const reason of [undefined, '', '   short  ', 'x'.repeat(501)]) {
    const r = await sponsorTo(w, uid, 'u-editor2', { reason });
    assert.deepEqual([r.status, r.body?.error], [400, 'reason_required'], String(reason));
  }
  // The caller's gates come first: a member who cannot manage, a stranger who cannot read.
  assert.deepEqual([(await sponsorTo(w, uid, 'u-editor2', {}, MEMBER)).body.error], ['not_manager']);
  assert.deepEqual([(await sponsorTo(w, uid, 'u-editor2', {}, STRANGER)).body.error], ['not_member']);
  assert.equal((await sponsorTo(w, '0'.repeat(32), 'u-editor2')).status, 404);
  assert.equal(row(w, uid).sponsor_user_id, EDITOR, 'no refusal changed the sponsor');
  assert.equal(events(w, uid).some((e) => e.kind === 'sponsor_changed'), false);
  // A removed agent keeps its sponsor.
  await call(w, EDITOR, 'DELETE', `/agents/${uid}`);
  assert.deepEqual([(await sponsorTo(w, uid, 'u-editor2')).body.error], ['removed']);
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('tokens that cannot be read refuse 503, never taken as none or as enough', async () => {
  // Mutation checked: `left === null` treated as tokens (refusal dropped) → the 503 assert fails.
  const w = world({ budget: false });
  const uid = await addAgent(w);
  const r = await sponsorTo(w, uid, 'u-editor2');
  assert.deepEqual([r.status, r.body.error], [503, 'sponsor_balance_unreadable']);
  assert.equal(row(w, uid).sponsor_user_id, EDITOR);
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('an agent paused sponsor_left resumes with its new sponsor; another pause stays', async () => {
  // Mutation checked: the CASE that resumes `sponsor_left` removed → the status assert fails;
  // the CASE widened to every pause → the manual agent's assert fails.
  const w = world();
  const uid = await addAgent(w);
  w.db.prepare("UPDATE team_agents SET status = 'paused', paused_reason = 'sponsor_left' WHERE uid = ?").run(uid);
  const r = await sponsorTo(w, uid, 'u-editor2');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.body.agent.status, r.body.agent.paused_reason], ['active', null]);
  assert.deepEqual([row(w, uid).status, row(w, uid).paused_reason], ['active', null]);
  const resumed = events(w, uid).filter((e) => e.kind === 'resumed');
  assert.equal(resumed.length, 1);
  assert.deepEqual([resumed[0].actor, JSON.parse(resumed[0].detail)], [EDITOR, { reason: 'sponsor_changed' }]);

  const other = await addAgent(w, 'cto');
  w.db.prepare("UPDATE team_agents SET status = 'paused', paused_reason = 'manual' WHERE uid = ?").run(other);
  assert.equal((await sponsorTo(w, other, 'u-editor2')).status, 200);
  assert.deepEqual([row(w, other).status, row(w, other).paused_reason], ['paused', 'manual'], 'a hand pause stays');
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('the old sponsor\'s tools: refused sponsor_tools until drop_tools, then dropped and counted', async () => {
  // Mutation checked: the drop_tools gate removed → the 422 assert fails; the grants kept → the '[]' assert fails.
  const w = world();
  const uid = await addAgent(w);
  w.db.prepare('UPDATE team_agents SET tool_grants_json = ? WHERE uid = ?').run(JSON.stringify([{ integration_uid: 'a'.repeat(32), tool: 'search' }]), uid);
  const r = await sponsorTo(w, uid, 'u-editor2');
  assert.deepEqual([r.status, r.body.error, r.body.tools], [422, 'sponsor_tools', 1]);
  assert.match(r.body.message, /a new sponsor cannot use/);
  const ok = await sponsorTo(w, uid, 'u-editor2', { drop_tools: true });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(row(w, uid).tool_grants_json, '[]');
  assert.equal(JSON.parse(events(w, uid).find((e) => e.kind === 'sponsor_changed').detail).tools_dropped, 1);
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('GET …/sponsors: the team\'s members, each with whether they may sponsor and why not; a manager only', async () => {
  const w = world();
  const uid = await addAgent(w);
  const r = await call(w, EDITOR, 'GET', `/agents/${uid}/sponsors`);
  assert.equal(r.status, 200, r.text);
  const by = Object.fromEntries(r.body.candidates.map((m: any) => [m.uid, m]));
  assert.deepEqual(Object.keys(by).sort(), ['u-editor', 'u-editor2', 'u-free', 'u-member', 'u-poor'], 'the stranger is not listed');
  assert.deepEqual([by['u-editor'].current, by['u-editor'].can_sponsor], [true, false]);
  assert.deepEqual([by['u-editor2'].can_sponsor, by['u-editor2'].code], [true, null]);
  assert.deepEqual([by['u-member'].code, by['u-free'].code, by['u-poor'].code], ['sponsor_cannot_manage', 'sponsor_plan_required', 'sponsor_no_tokens']);
  assert.match(by['u-poor'].reason, /no AI tokens left/);
  assert.deepEqual(r.body.sponsor, { uid: 'u-editor', name: 'Eve Editor' });
  noPrivateKeys(r.text);
  assert.deepEqual([(await call(w, MEMBER, 'GET', `/agents/${uid}/sponsors`)).body.error], ['not_manager']);
});

// 7 ───────────────────────────────────────────────────────────────────────────
test('the sweep resumes a cap pause from an earlier month at the new month, and nothing else', async () => {
  // Mutations checked: the month bound dropped (every cap pause resumed) → the this-month agent's assert fails;
  // `paused_reason = 'cap'` widened → the manual, persona_retired, ai_paused, spend_limit and sponsor_left asserts fail;
  // the bound compared to the pause's own month → last month's agent stays paused and fails.
  const w = world();
  const pausedOn = async (role: string, reason: string, at: string | null, updatedAt = '2026-10-20 08:00:00') => {
    const uid = await addAgent(w, role);
    const a = row(w, uid);
    w.db.prepare("UPDATE team_agents SET status = 'paused', paused_reason = ?, updated_at = ? WHERE id = ?").run(reason, updatedAt, a.id);
    if (at) w.db.prepare("INSERT INTO team_agent_events (agent_id, kind, detail_json, created_at) VALUES (?, 'paused', ?, ?)").run(a.id, JSON.stringify({ reason }), at);
    return uid;
  };
  const lastMonth = await pausedOn('cfo', 'cap', '2026-10-31 23:59:59');
  const noEvent = await pausedOn('ceo', 'cap', null, '2026-10-02 09:00:00');
  const thisMonth = await pausedOn('cto', 'cap', '2026-11-01 00:00:00');
  const held: Record<string, string> = {};
  for (const [role, reason] of [['cmo', 'manual'], ['sales', 'persona_retired'], ['coo', 'ai_paused'], ['people', 'spend_limit'], ['cpo', 'sponsor_left'], ['general_counsel', 'daily_limit']]) {
    held[reason] = await pausedOn(role, reason, '2026-10-05 10:00:00');
  }
  // Before the month turns, nothing resumes.
  assert.equal(await resumeCapPauses(w.env, new Date('2026-10-31T23:59:59Z')), 0);
  // The engine is off and the halt key is set: the cap resume still runs, and admits no run.
  w.kv.set('agents:halt', 'drill');
  const r = await sweepAgents(w.env, new Date('2026-11-01T00:06:00Z'));
  assert.deepEqual(r, { resent: 0, admitted: 0, cap_resumed: 2 });
  for (const uid of [lastMonth, noEvent]) {
    assert.deepEqual([row(w, uid).status, row(w, uid).paused_reason], ['active', null], uid);
    const e = events(w, uid).at(-1);
    assert.deepEqual([e.kind, e.actor, JSON.parse(e.detail)], ['resumed', null, { reason: 'cap_reset' }]);
  }
  assert.deepEqual([row(w, thisMonth).status, row(w, thisMonth).paused_reason], ['paused', 'cap'], 'paused this month: it waits for December');
  for (const [reason, uid] of Object.entries(held)) {
    assert.deepEqual([row(w, uid).status, row(w, uid).paused_reason], ['paused', reason], reason);
    assert.equal(events(w, uid).some((e) => e.kind === 'resumed'), false, reason);
  }
  // A second sweep in the same month changes nothing more.
  assert.equal((await sweepAgents(w.env, new Date('2026-11-01T00:11:00Z'))).cap_resumed, 0);
  assert.equal(await resumeCapPauses(w.env, new Date('2026-12-01T00:01:00Z')), 1, 'December resumes November\'s');
});

// 8 ───────────────────────────────────────────────────────────────────────────
test('resumes_at: the first day of the month after the pause, from the server; null for any other agent', async () => {
  // Mutation checked: nextMonthDay returning the pause's own month → the 2026-11-01 assert fails; December's rollover → 2027-01-01.
  const w = world();
  const uid = await addAgent(w);
  assert.equal((await call(w, EDITOR, 'GET', `/agents/${uid}`)).body.agent.resumes_at, null, 'active');
  const a = row(w, uid);
  w.db.prepare("UPDATE team_agents SET status = 'paused', paused_reason = 'cap' WHERE id = ?").run(a.id);
  w.db.prepare("INSERT INTO team_agent_events (agent_id, kind, detail_json, created_at) VALUES (?, 'paused', '{\"reason\":\"cap\"}', '2026-10-15 10:00:00')").run(a.id);
  assert.equal((await call(w, EDITOR, 'GET', `/agents/${uid}`)).body.agent.resumes_at, '2026-11-01');
  assert.equal((await call(w, EDITOR, 'GET', `${CO}/agents`)).body.agents[0].resumes_at, '2026-11-01', 'the list carries it too');
  w.db.prepare("UPDATE team_agents SET paused_reason = 'manual' WHERE id = ?").run(a.id);
  assert.equal(await capResumesAt(w.env, row(w, uid)), null, 'a hand pause has no resume day');
  assert.equal(nextMonthDay('2026-12-31 23:59:59'), '2027-01-01');
  assert.equal(nextMonthDay('2026-01-01 00:00:00'), '2026-02-01');
  assert.equal(nextMonthDay(null), null);
  assert.equal(nextMonthDay('not a date'), null);
});

// 9 ───────────────────────────────────────────────────────────────────────────
test('the migration keeps every event, id and the sequence, and allows sponsor_changed only', () => {
  // Mutations checked: the copy-back dropped → the rows assert fails; the sequence UPDATE dropped → the next-id assert fails.
  const { db } = makeD1(['users', 'company_profiles', 'projects'].map((t) => stripForeignKeys(tableFromBaseline(BASELINE, t))).join('\n') + AI_LOG_SCHEMA + sql('migrations/506_ai_rail_proposals.sql'));
  db.exec(sql('migrations/712_team_agents.sql'));
  db.prepare("INSERT INTO users (id, uid, email, name, role) VALUES (1, 'u1', 'a@example.test', 'A', 'founder')").run();
  db.prepare("INSERT INTO company_profiles (id, uid, company_name) VALUES (1, 'c1', 'Acme')").run();
  db.prepare("INSERT INTO team_agents (uid, scope_kind, company_id, role_key, model_id, sponsor_user_id, monthly_cap_microusd, created_by) VALUES ('x', 'company', 1, 'cfo', 'm', 1, 1, 1)").run();
  const ins = db.prepare("INSERT INTO team_agent_events (agent_id, actor_user_id, kind, detail_json, created_at) VALUES (1, 1, ?, ?, '2026-10-01 00:00:00')");
  ins.run('added', '{}'); ins.run('paused', '{"reason":"cap"}'); ins.run('run', null);
  db.prepare('DELETE FROM team_agent_events WHERE id = 3').run();
  assert.throws(() => db.prepare("INSERT INTO team_agent_events (agent_id, kind) VALUES (1, 'sponsor_changed')").run(), /CHECK/);
  db.exec(sql(THIS));
  assert.deepEqual(db.prepare('SELECT id, kind, detail_json FROM team_agent_events ORDER BY id').all().map((r: any) => [r.id, r.kind, r.detail_json]),
    [[1, 'added', '{}'], [2, 'paused', '{"reason":"cap"}']]);
  db.prepare("INSERT INTO team_agent_events (agent_id, kind) VALUES (1, 'sponsor_changed')").run();
  assert.equal((db.prepare("SELECT MAX(id) AS id FROM team_agent_events").get() as any).id, 4, 'the AUTOINCREMENT high-water mark is kept: id 3 is never reused');
  assert.throws(() => db.prepare("INSERT INTO team_agent_events (agent_id, kind) VALUES (1, 'nonsense')").run(), /CHECK/);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_team_agent_events_agent'").get());
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE '%_keep_4387'").get().n, 0, 'the copies are dropped');
});
