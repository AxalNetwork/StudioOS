/**
 * D4158 (#4158, H1 of #4137): HQ › AI agents › Roster. Synthetic data on the
 * real migrated schema in memory, through the mounted routers (the roster and
 * the team agents' own, so each effect is seen where teams see it).
 *
 *   1. Super Admin only, on every roster route;
 *   2. values, risk and natural fit are never writable: 400 values_fixed, nothing written or audited;
 *   3. every write takes a reason of at least 10 characters;
 *   4. a rename needs the trademark check, and teams see the new name at once;
 *   5. hidden: out of GET /api/teams/personas, a new team cannot add it, a team that has it keeps it;
 *   6. retired: its live agents are paused at once, a team cannot resume them, open proposals stay decidable;
 *   7. defaults: model, starting and maximum cap, checked, and the maximum holds on the team routes;
 *   8. usage: each figure null when no store holds it, never 0; one audit row per change;
 *   9. no email in any answer.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/admin_ai_roster_d4158.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import roster from '../src/routes/admin_ai_agents_roster.ts';
import teamAgents from '../src/routes/team_agents.ts';
import { PERSONAS } from '../src/services/agents/personas.ts';
import { FIXED_FIELDS, REASON_MIN } from '../src/services/agents/rosterAdmin.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const JWT_SECRET = 'synthetic-d4158-only-not-a-real-credential'.repeat(2);
const ORIGIN = 'https://axal.vc';
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const SUPER = 1, FOUNDER = 2, PLAIN_ADMIN = 3, EDITOR2 = 4;
const EMAILS = ['synthetic-super@example.invalid', 'synthetic-founder@example.invalid', 'synthetic-admin@example.invalid', 'synthetic-editor@example.invalid'];
const REASON = 'Plainer for founders, per the review';
const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');

function fixture({ unrecordedCharge = false } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const user = db.prepare("INSERT INTO users (id, uid, email, name, role, is_active, founder_id, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, ?, 1, ?, 'growth', 'active')");
  user.run(SUPER, 'u-super', EMAILS[0], 'Ada Super', 'admin', null);
  user.run(FOUNDER, 'u-founder', EMAILS[1], 'Femi Founder', 'founder', 200);
  user.run(PLAIN_ADMIN, 'u-admin', EMAILS[2], 'Pat Admin', 'admin', null);
  user.run(EDITOR2, 'u-editor2', EMAILS[3], 'Eli Editor', 'founder', 201);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.exec("INSERT INTO company_profiles (id, uid, company_name) VALUES (10, 'co-10', 'Northwind Labs'), (11, 'co-11', 'Bluefern Health')");
  db.exec("INSERT INTO projects (id, name, company_id, founder_id) VALUES (20, 'Atlas Pilot', 10, 200)");
  const link = db.prepare('INSERT INTO user_company_links (uid, user_id, company_id, role_in_company) VALUES (?, ?, ?, ?)');
  link.run('l1', FOUNDER, 10, 'Founder'); link.run('l2', EDITOR2, 11, 'Founder');
  const agent = db.prepare(`INSERT INTO team_agents (id, uid, scope_kind, company_id, project_id, role_key, persona_key, first_name, model_id, sponsor_user_id, monthly_cap_microusd, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  agent.run(100, 'a100a100a100a100a100a100a100a100', 'company', 10, null, 'general_counsel', 'vesta', 'Vesta', MODEL, FOUNDER, 5_000_000, 'active', FOUNDER);
  agent.run(101, 'a101a101a101a101a101a101a101a101', 'project', null, 20, 'general_counsel', 'vesta', 'Vesta', MODEL, FOUNDER, 5_000_000, 'active', FOUNDER);
  agent.run(102, 'a102a102a102a102a102a102a102a102', 'company', 10, null, 'cfo', 'orrin', 'Orrin', MODEL, FOUNDER, 5_000_000, 'active', FOUNDER);
  db.exec(`INSERT INTO scope_tasks (id, uid, scope_kind, company_id, title, assignee_kind, assignee_agent_id) VALUES (500, 'task-0000-0500', 'company', 10, 'Review the lease', 'agent', 100)`);
  const usage = db.prepare('INSERT INTO ai_usage_logs (id, user_id, task, model, prompt_tokens, completion_tokens, charged_microusd, agent_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  usage.run(900, FOUNDER, 'rail_chat', MODEL, 400, 100, 2_000_000, 100, daysAgo(1));
  usage.run(901, FOUNDER, 'rail_chat', MODEL, 300, 80, unrecordedCharge ? null : 1_500_000, 101, daysAgo(2));
  usage.run(902, FOUNDER, 'rail_chat', MODEL, 300, 80, 9_000_000, 100, daysAgo(40)); // outside the 30 days
  const run = db.prepare(`INSERT INTO agent_task_runs (id, uid, agent_id, task_id, attempt, status, steps_json, created_at) VALUES (?, ?, ?, 500, ?, ?, '[]', ?)`);
  run.run(1, 'run-0000-0001', 100, 1, 'done', daysAgo(1));
  run.run(2, 'run-0000-0002', 100, 2, 'done', daysAgo(2));
  run.run(3, 'run-0000-0003', 101, 3, 'failed', daysAgo(3));
  run.run(4, 'run-0000-0004', 100, 4, 'done', daysAgo(45));
  const prop = db.prepare(`INSERT INTO ai_rail_proposals (uid, user_id, rail_page, rail_option, kind, payload_json, status, agent_id, decided_at)
    VALUES (?, ?, 'team', 'draft', 'draft', '{}', ?, ?, ?)`);
  prop.run('prop-1', FOUNDER, 'accepted', 100, daysAgo(1));
  prop.run('prop-2', FOUNDER, 'discarded', 100, daysAgo(1));
  prop.run('prop-3', FOUNDER, 'edited', 101, daysAgo(2));
  prop.run('prop-4', FOUNDER, 'proposed', 100, null);
  db.exec(`INSERT INTO agent_skills (id, uid, scope, slug, name, purpose, output_kind, status, created_by)
    VALUES (700, 'skill-clause', 'hq', 'clause-review', 'Contract clause review', 'Reads a clause and drafts notes', 'draft', 'published', ${SUPER})`);
  db.exec(`INSERT INTO agent_skill_links (agent_id, skill_id, version, linked_by) VALUES (100, 700, 1, ${FOUNDER})`);
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', TEAM_AGENTS_ENABLED: 'true' };
  const app = new Hono<any>().route('/api/admin/ai-agents/roster', roster).route('/api/teams', teamAgents);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  return { db, env, app, close: () => db.close() };
}
type F = ReturnType<typeof fixture>;

const token = (who: number) => new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
async function call(f: F, who: number | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { Origin: ORIGIN };
  if (who) headers.Authorization = `Bearer ${await token(who)}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await f.app.request(ORIGIN + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, f.env);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text };
}
const R = '/api/admin/ai-agents/roster';
const audits = (f: F) => f.db.prepare("SELECT action, subject, before_json, after_json, reason, admin_user_id FROM ai_admin_audit WHERE area = 'roster' ORDER BY id").all() as any[];
const setting = (f: F, key: string) => f.db.prepare('SELECT * FROM ai_persona_settings WHERE persona_key = ?').get(key) as any;
const noEmail = (text: string, where: string) => assert.doesNotMatch(text, /@example\.invalid/, `${where} carries an email`);

test('1: Super Admin only — signed out, a founder and a plain admin are refused on every roster route', async () => {
  // Mutation checked: requireSuperAdmin → requireAdmin on GET / → the plain admin is answered 200 and this fails.
  const f = fixture();
  try {
    const routes: Array<[string, string, unknown?]> = [
      ['GET', R], ['GET', `${R}/vesta`],
      ['PATCH', `${R}/vesta`, { status: 'hidden', reason: REASON }],
      ['PUT', `${R}/vesta/defaults`, { model: MODEL, start_cap_usd: 20, max_cap_usd: 100, reason: REASON }],
    ];
    for (const [m, p, b] of routes) {
      assert.equal((await call(f, null, m, p, b)).status, 401, `${m} ${p}: signed out`);
      assert.equal((await call(f, FOUNDER, m, p, b)).status, 403, `${m} ${p}: a founder`);
      assert.equal((await call(f, PLAIN_ADMIN, m, p, b)).status, 403, `${m} ${p}: a plain admin`);
    }
    assert.equal(setting(f, 'vesta'), undefined, 'a refused write wrote nothing');
    assert.equal(audits(f).length, 0, 'and audited nothing');
    assert.equal((await call(f, SUPER, 'GET', R)).status, 200);
  } finally { f.close(); }
});

test('2: values, risk and natural fit are never writable — 400 values_fixed, nothing written or audited', async () => {
  // Mutations checked: FIXED_FIELDS emptied → PATCH { values } reaches invalid_field and the code assert fails;
  // refuseFixed dropped from putDefaults → the defaults PUT with risk is written and the nothing-written assert fails.
  const f = fixture();
  try {
    for (const k of FIXED_FIELDS) {
      const r = await call(f, SUPER, 'PATCH', `${R}/vesta`, { [k]: k === 'risk' ? 5 : ['finance'], tagline: 'A new line here', reason: REASON });
      assert.equal(r.status, 400, k);
      assert.equal(r.body.error, 'values_fixed', k);
      assert.deepEqual(r.body.detail.fields ?? r.body.fields, [k]);
    }
    const d = await call(f, SUPER, 'PUT', `${R}/vesta/defaults`, { model: MODEL, start_cap_usd: 20, max_cap_usd: 100, risk: 1, reason: REASON });
    assert.equal(d.body.error, 'values_fixed');
    assert.equal(setting(f, 'vesta'), undefined);
    assert.equal(audits(f).length, 0);
    const one = await call(f, SUPER, 'GET', `${R}/vesta`);
    const p = PERSONAS.find((x) => x.key === 'vesta')!;
    assert.deepEqual(one.body.persona.values, { ...p.values });
    assert.equal(one.body.persona.risk, p.risk);
    assert.deepEqual(one.body.persona.natural_fit, [...p.natural_fit]);
  } finally { f.close(); }
});

test('3: every write takes a reason of at least 10 characters', async () => {
  // Mutation checked: REASON_MIN 10 → 1 in reasonOf → the 9-character reason is accepted and this fails.
  const f = fixture();
  try {
    assert.equal(REASON_MIN, 10, 'the issue\'s rule: at least 10 characters');
    const short = 'x'.repeat(9);
    for (const [m, p, b] of [
      ['PATCH', `${R}/vesta`, { status: 'hidden' }],
      ['PATCH', `${R}/vesta`, { status: 'hidden', reason: short }],
      ['PATCH', `${R}/vesta`, { tagline: 'A new line here', reason: '          ' + short }],
      ['PUT', `${R}/vesta/defaults`, { model: MODEL, start_cap_usd: 20, max_cap_usd: 100, reason: short }],
    ] as const) {
      const r = await call(f, SUPER, m, p, b);
      assert.equal(r.status, 400, `${m} ${JSON.stringify(b)}`);
      assert.equal(r.body.error, 'reason_required');
    }
    assert.equal(setting(f, 'vesta'), undefined);
    assert.equal(audits(f).length, 0);
    assert.equal((await call(f, SUPER, 'PATCH', `${R}/vesta`, { status: 'hidden', reason: 'x'.repeat(10) })).status, 200);
  } finally { f.close(); }
});

test('4: a rename needs the trademark check; teams see the new name at once; the values stay', async () => {
  // Mutations checked: the trademark_checked test dropped → the unchecked rename lands and the refusal assert fails;
  // agentDto back to personaDto → the team's agent keeps "Vesta" and the new-name assert fails.
  const f = fixture();
  try {
    const no = await call(f, SUPER, 'PATCH', `${R}/vesta`, { name: 'Vestra', reason: REASON });
    assert.equal(no.status, 400); assert.equal(no.body.error, 'trademark_unchecked');
    const half = await call(f, SUPER, 'PATCH', `${R}/vesta`, { name: 'Vestra', trademark_checked: 'yes', reason: REASON });
    assert.equal(half.body.error, 'trademark_unchecked', 'only true counts');
    const taken = await call(f, SUPER, 'PATCH', `${R}/vesta`, { name: 'orrin', trademark_checked: true, reason: REASON });
    assert.equal(taken.status, 409); assert.equal(taken.body.error, 'name_taken');
    assert.equal(audits(f).length, 0);

    const ok = await call(f, SUPER, 'PATCH', `${R}/vesta`, { name: 'Vestra', trademark_checked: true, reason: REASON });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.persona.name, 'Vestra');
    assert.equal(setting(f, 'vesta').name_checked_by, SUPER);
    const team = await call(f, FOUNDER, 'GET', '/api/teams/company/co-10/agents');
    const vesta = team.body.agents.find((a: any) => a.uid === 'a100a100a100a100a100a100a100a100');
    assert.equal(vesta.persona.name, 'Vestra', 'teams see the new name on the card at once');
    assert.deepEqual(vesta.persona.values, { ...PERSONAS.find((x) => x.key === 'vesta')!.values }, 'her values do not change');
    const gallery = await call(f, FOUNDER, 'GET', '/api/teams/personas');
    assert.equal(gallery.body.personas.find((p: any) => p.key === 'vesta').name, 'Vestra');

    const [a] = audits(f);
    assert.equal(a.action, 'persona.rename');
    assert.equal(a.subject, 'persona:vesta');
    assert.deepEqual(JSON.parse(a.before_json), { name: 'Vesta' });
    assert.deepEqual(JSON.parse(a.after_json), { name: 'Vestra', trademark_checked: true });
    assert.equal(a.reason, REASON);

    // A tagline alone needs no trademark check, and the same words again are no change.
    assert.equal((await call(f, SUPER, 'PATCH', `${R}/vesta`, { tagline: 'Seal first, then the gate.', reason: REASON })).status, 200);
    const same = await call(f, SUPER, 'PATCH', `${R}/vesta`, { tagline: 'Seal first, then the gate.', reason: REASON });
    assert.equal(same.body.error, 'no_change');
    const bad = await call(f, SUPER, 'PATCH', `${R}/vesta`, { personality: 'Loud', reason: REASON });
    assert.equal(bad.body.error, 'invalid_field');
    const avatar = await call(f, SUPER, 'PATCH', `${R}/vesta`, { avatar: 'https://elsewhere.example/v.png', reason: REASON });
    assert.equal(avatar.body.error, 'invalid_field');
  } finally { f.close(); }
});

test('5: hidden — out of the gallery, refused to a new team, kept by the teams that have it', async () => {
  // Mutations checked: galleryPersonas keeping hidden ones → Vesta is still in /personas and this fails;
  // the persona_unavailable check dropped → the new team adds Vesta (201) and the refusal assert fails.
  const f = fixture();
  try {
    const before = await call(f, FOUNDER, 'GET', '/api/teams/personas');
    assert.ok(before.body.personas.some((p: any) => p.key === 'vesta'));
    assert.equal((await call(f, SUPER, 'PATCH', `${R}/vesta`, { status: 'hidden', reason: REASON })).status, 200);
    const after = await call(f, FOUNDER, 'GET', '/api/teams/personas');
    assert.ok(!after.body.personas.some((p: any) => p.key === 'vesta'), 'a hidden persona is absent from the gallery');
    assert.equal(after.body.personas.length, PERSONAS.length - 1);

    const add = await call(f, EDITOR2, 'POST', '/api/teams/company/co-11/agents', { role_key: 'general_counsel', persona_key: 'vesta', model_id: MODEL, monthly_cap_microusd: 5_000_000 });
    assert.equal(add.status, 409); assert.equal(add.body.error, 'persona_unavailable');
    const kept = await call(f, FOUNDER, 'GET', '/api/teams/company/co-10/agents');
    const v = kept.body.agents.find((a: any) => a.uid === 'a100a100a100a100a100a100a100a100');
    assert.equal(v.status, 'active', 'a team that has it keeps it, running');
    assert.equal(v.persona.key, 'vesta');

    const [a] = audits(f);
    assert.equal(a.action, 'persona.hide');
    assert.deepEqual([JSON.parse(a.before_json), JSON.parse(a.after_json)], [{ status: 'offered' }, { status: 'hidden' }]);
    const list = await call(f, SUPER, 'GET', R);
    assert.deepEqual(list.body.counts, { total: 16, offered: 15, hidden: 1, retired: 0 });
  } finally { f.close(); }
});

test('6: retired — its live agents stop at once, a team cannot resume them, open proposals stay decidable', async () => {
  // Mutations checked: the pause UPDATE dropped from the retire batch → agent 100 stays active and this fails;
  // the persona_retired resume gate dropped → the team resumes it (200) and the refusal assert fails.
  const f = fixture();
  try {
    assert.equal((await call(f, SUPER, 'PATCH', `${R}/vesta`, { status: 'retired', reason: REASON })).status, 200);
    const rows = f.db.prepare("SELECT id, status, paused_reason FROM team_agents WHERE persona_key = 'vesta' ORDER BY id").all() as any[];
    assert.deepEqual(rows.map((r) => [r.status, r.paused_reason]), [['paused', 'persona_retired'], ['paused', 'persona_retired']]);
    const orrin = f.db.prepare('SELECT status FROM team_agents WHERE id = 102').get() as any;
    assert.equal(orrin.status, 'active', 'another persona is untouched');
    const ev = f.db.prepare("SELECT agent_id, kind, actor_user_id, detail_json FROM team_agent_events WHERE kind = 'paused' ORDER BY agent_id").all() as any[];
    assert.deepEqual(ev.map((e) => [e.agent_id, JSON.parse(e.detail_json).reason, e.actor_user_id]), [[100, 'persona_retired', SUPER], [101, 'persona_retired', SUPER]]);
    assert.equal((f.db.prepare("SELECT status FROM ai_rail_proposals WHERE uid = 'prop-4'").get() as any).status, 'proposed', 'its open proposal stays decidable');

    const resume = await call(f, FOUNDER, 'PATCH', '/api/teams/agents/a100a100a100a100a100a100a100a100', { status: 'active' });
    assert.equal(resume.status, 409); assert.equal(resume.body.error, 'persona_retired');
    const gallery = await call(f, FOUNDER, 'GET', '/api/teams/personas');
    assert.ok(!gallery.body.personas.some((p: any) => p.key === 'vesta'), 'it leaves the gallery');

    // Offered again: nothing resumes on its own, and the team may resume it.
    assert.equal((await call(f, SUPER, 'PATCH', `${R}/vesta`, { status: 'offered', reason: 'Brought back after review' })).status, 200);
    assert.equal((f.db.prepare('SELECT status FROM team_agents WHERE id = 100').get() as any).status, 'paused');
    assert.equal((await call(f, FOUNDER, 'PATCH', '/api/teams/agents/a100a100a100a100a100a100a100a100', { status: 'active' })).status, 200);
    assert.deepEqual(audits(f).map((a) => a.action), ['persona.retire', 'persona.offer']);
  } finally { f.close(); }
});

test('7: defaults — the model and both caps, checked, and the maximum holds on the team routes', async () => {
  // Mutations checked: the start > max check dropped → start 200 / max 100 is written and the refusal assert fails;
  // the cap_above_max check dropped from POST → the second team adds Orrin at $150 and the refusal assert fails.
  const f = fixture();
  try {
    const put = (b: Record<string, unknown>) => call(f, SUPER, 'PUT', `${R}/orrin/defaults`, { reason: REASON, ...b });
    assert.equal((await put({ model: 'not-a-model', start_cap_usd: 20, max_cap_usd: 100 })).body.error, 'model_not_offered');
    assert.equal((await put({ model: MODEL, start_cap_usd: 200, max_cap_usd: 100 })).body.error, 'start_above_max');
    assert.equal((await put({ model: MODEL, start_cap_usd: 0, max_cap_usd: 100 })).body.error, 'invalid_cap');
    assert.equal((await put({ model: MODEL, start_cap_usd: 20.005, max_cap_usd: 100 })).body.error, 'invalid_cap');
    assert.equal((await put({ model: MODEL, start_cap_usd: 20, max_cap_usd: 2_000_000 })).body.error, 'cap_above_platform');
    assert.equal(audits(f).length, 0);

    const ok = await put({ model: MODEL, start_cap_usd: 20, max_cap_usd: 100 });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.persona.defaults, { model: MODEL, start_cap_usd: 20, max_cap_usd: 100 });
    const [a] = audits(f);
    assert.equal(a.action, 'persona.defaults');
    assert.deepEqual(JSON.parse(a.before_json), { model: null, start_cap_usd: null, max_cap_usd: null });
    assert.deepEqual(JSON.parse(a.after_json), { model: MODEL, start_cap_usd: 20, max_cap_usd: 100 });
    assert.equal((await put({ model: MODEL, start_cap_usd: 20, max_cap_usd: 100 })).body.error, 'no_change');

    const gallery = await call(f, FOUNDER, 'GET', '/api/teams/personas');
    assert.deepEqual(gallery.body.personas.find((p: any) => p.key === 'orrin').defaults, { model: MODEL, start_cap_usd: 20, max_cap_usd: 100 });
    const high = await call(f, EDITOR2, 'POST', '/api/teams/company/co-11/agents', { role_key: 'cfo', persona_key: 'orrin', model_id: MODEL, monthly_cap_microusd: 150_000_000 });
    assert.equal(high.status, 422); assert.equal(high.body.error, 'cap_above_max');
    assert.equal((await call(f, EDITOR2, 'POST', '/api/teams/company/co-11/agents', { role_key: 'cfo', persona_key: 'orrin', model_id: MODEL, monthly_cap_microusd: 100_000_000 })).status, 201);
    const raise = await call(f, FOUNDER, 'PATCH', '/api/teams/agents/a102a102a102a102a102a102a102a102', { monthly_cap_microusd: 120_000_000 });
    assert.equal(raise.status, 422); assert.equal(raise.body.error, 'cap_above_max');
  } finally { f.close(); }
});

test('8: usage over 30 days — measured counts, and null (never 0) for what no store holds', async () => {
  // Mutations checked: spend summed over the known charges only → the unrecorded case reads 2.0, not null, and this fails;
  // accepted_pct as 0 when nothing was decided → Orrin's accepted reads 0 and the null assert fails.
  const f = fixture();
  try {
    const list = await call(f, SUPER, 'GET', R);
    assert.equal(list.status, 200);
    assert.equal(list.body.personas.length, 16);
    const vesta = list.body.personas.find((p: any) => p.key === 'vesta');
    assert.deepEqual(vesta.usage, { teams: 2, runs: 3, spend_usd: 3.5, accepted_pct: 66.7, failed_pct: 33.3 });
    assert.equal(vesta.status, 'offered');
    assert.deepEqual(vesta.defaults, { model: null, start_cap_usd: null, max_cap_usd: null });
    const orrin = list.body.personas.find((p: any) => p.key === 'orrin');
    assert.deepEqual(orrin.usage, { teams: 1, runs: 0, spend_usd: null, accepted_pct: null, failed_pct: null });
    const kade = list.body.personas.find((p: any) => p.key === 'kade');
    assert.deepEqual(kade.usage, { teams: 0, runs: 0, spend_usd: null, accepted_pct: null, failed_pct: null });

    const g = fixture({ unrecordedCharge: true });
    try {
      const v = (await call(g, SUPER, 'GET', R)).body.personas.find((p: any) => p.key === 'vesta');
      assert.equal(v.usage.spend_usd, null, 'one unrecorded charge makes the spend unknown, never a smaller sum');
    } finally { g.close(); }

    const one = await call(f, SUPER, 'GET', `${R}/vesta`);
    assert.deepEqual(one.body.persona.teams.map((t: any) => [t.company, t.project]), [['Northwind Labs', null], ['Northwind Labs', 'Atlas Pilot']]);
    assert.deepEqual(one.body.persona.skills, [{ uid: 'skill-clause', name: 'Contract clause review', runs: 2 }]);
    assert.deepEqual(one.body.persona.history, []);
    assert.equal((await call(f, SUPER, 'GET', `${R}/nobody`)).status, 404);
  } finally { f.close(); }
});

test('9: no email in any answer, the history included', async () => {
  // Mutation checked: the history read selecting u.email AS admin_name → the admin's address reaches the answer and this fails.
  const f = fixture();
  try {
    await call(f, SUPER, 'PATCH', `${R}/vesta`, { status: 'hidden', reason: REASON });
    await call(f, SUPER, 'PUT', `${R}/vesta/defaults`, { model: MODEL, start_cap_usd: 20, max_cap_usd: 100, reason: REASON });
    const list = await call(f, SUPER, 'GET', R);
    noEmail(list.text, 'GET /roster');
    const one = await call(f, SUPER, 'GET', `${R}/vesta`);
    noEmail(one.text, 'GET /roster/vesta');
    assert.deepEqual(one.body.persona.history.map((h: any) => [h.action, h.admin.name, h.reason]), [
      ['persona.defaults', 'Ada Super', REASON], ['persona.hide', 'Ada Super', REASON],
    ]);
    const patch = await call(f, SUPER, 'PATCH', `${R}/vesta`, { tagline: 'Seal first, then the gate.', reason: REASON });
    noEmail(patch.text, 'PATCH /roster/vesta');
  } finally { f.close(); }
});
