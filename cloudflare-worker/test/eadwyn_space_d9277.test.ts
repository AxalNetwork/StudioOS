/**
 * D9277 (#9277) — an Eadwyn conversation belongs to exactly one company or one project, and every read, run and
 * action stays in it.
 *
 * What the issue's "Done when" asks the tests to cover:
 *   - company → project, and project → sibling project;
 *   - a member removed between a draft and its Send;
 *   - a pending action confirmed after access is lost;
 *   - the same question asked in two projects with different synthetic evidence reads only its own.
 * Plus the space helper's own rules (`services/eadwynSpace.ts`), the migration's backfill and its company-XOR-project
 * triggers, and the refusals for a space the member is not in.
 *
 * Real SQLite: the AI budget fixture, the tables migration 444 creates and this issue's migration, both read from
 * their files. Every name, figure and id here is synthetic.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/eadwyn_space_d9277.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { createJWT } from '../src/auth.ts';
import { registerProvider } from '../src/integrations/registry.ts';
import eadwyn from '../src/routes/eadwyn.ts';
import {
  parseSpaceRef,
  projectInSpace,
  spaceColumns,
  spaceRefOfRow,
  type Space,
} from '../src/services/eadwynSpace.ts';

const SQL_444 = readFileSync(new URL('../sql/migrations/444_eadwyn_conversations.sql', import.meta.url), 'utf8');
const SQL_9277 = readFileSync(new URL('../sql/migrations/202611281314_9277_eadwyn_space.sql', import.meta.url), 'utf8');

const JWT_SECRET = 'unit-test-jwt-secret-9277-space-abcdef';
const ME = 2, OTHER = 3, COMPANY = 41, OTHER_COMPANY = 42, FOUNDER = 9;
// Project 5 is the member's own venture; 7 is a sibling in the same company the member joined as a co-founder;
// 6 is in the same company and not the member's; 8 is the member's, in another company.
const OWN = 5, SIBLING = 7, NOT_MINE = 6, ELSEWHERE = 8;

const pushes: unknown[] = [];
registerProvider({
  key: 'hubspot',
  connect: async () => ({ credentials: {} as any }),
  push: async (_c: unknown, _u: unknown, _row: unknown, payload: unknown) => {
    pushes.push(payload);
    return { summary: 'Updated HubSpot company', external_id: 'hs-9277', http_status: 200 };
  },
  preview: async (env: any, _row: unknown, payload: any) => {
    const p = await env.DB.prepare('SELECT name FROM projects WHERE id = ?').bind(payload.project_id).first();
    if (!p) throw new Error('project_not_found');
    return { target: `HubSpot company "${p.name}"`, fields: [{ name: 'name', value: p.name }] };
  },
} as any);

function world(opts: { reply?: string } = {}) {
  pushes.length = 0;
  const { DB, db } = aiBudgetFixture();
  db.exec(`
    ALTER TABLE users ADD COLUMN founder_id INTEGER;
    UPDATE users SET subscription_tier = 'studio', founder_id = ${FOUNDER} WHERE id = ${ME};
    CREATE TABLE user_sessions (jti TEXT, user_id INTEGER, revoked_at TEXT, step_up_due_at TEXT, last_seen_at TEXT);
    INSERT INTO user_sessions (jti, user_id) VALUES ('jti-${ME}', ${ME}), ('jti-${OTHER}', ${OTHER});
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER, company_id INTEGER, sector TEXT, deleted_at TEXT);
    INSERT INTO projects (id, name, founder_id, company_id) VALUES
      (${OWN}, 'Synthetic Own', ${FOUNDER}, ${COMPANY}),
      (${SIBLING}, 'Synthetic Sibling', 77, ${COMPANY}),
      (${NOT_MINE}, 'Synthetic Stranger', 78, ${COMPANY}),
      (${ELSEWHERE}, 'Synthetic Elsewhere', ${FOUNDER}, ${OTHER_COMPANY});
    CREATE TABLE deals (id INTEGER PRIMARY KEY, project_id INTEGER, status TEXT, amount REAL, hubspot_deal_id TEXT, sf_opportunity_id TEXT, updated_at TEXT);
    CREATE TABLE project_metrics (
      id INTEGER PRIMARY KEY, project_id INTEGER, snapshot_date TEXT, mrr REAL, arr REAL,
      monthly_churn_pct REAL, active_users INTEGER, source TEXT
    );
    -- The synthetic evidence: each project's own Stripe figure, distinct so a leak is visible.
    INSERT INTO project_metrics (project_id, snapshot_date, mrr, arr, source) VALUES
      (${OWN}, '2026-11-01', 1111, 13332, 'stripe'),
      (${SIBLING}, '2026-11-01', 7777, 93324, 'stripe'),
      (${NOT_MINE}, '2026-11-01', 4444, 53328, 'stripe');
    CREATE TABLE connector_fed_items (id INTEGER PRIMARY KEY, integration_id INTEGER, project_id INTEGER, module TEXT, kind TEXT, last_seen_at TEXT);
    CREATE TABLE integrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, user_id INTEGER, provider_key TEXT, display_name TEXT,
      status TEXT, auth_type TEXT, credentials_enc TEXT, config_json TEXT, capabilities_json TEXT, scopes_json TEXT,
      external_account_id TEXT, external_account_name TEXT, webhook_secret_enc TEXT,
      last_synced_at TEXT, last_error TEXT, last_error_at TEXT, created_at TEXT, updated_at TEXT
    );
    INSERT INTO integrations (id, uid, user_id, provider_key, status, last_synced_at) VALUES
      (1, 'i1', ${ME}, 'hubspot', 'active', '2026-11-01 10:00:00'),
      (2, 'i2', ${ME}, 'stripe', 'active', '2026-11-01 11:00:00');
    CREATE TABLE integration_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, integration_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      provider_key TEXT NOT NULL, direction TEXT NOT NULL, event_type TEXT NOT NULL, status TEXT NOT NULL,
      http_status INTEGER, request_summary TEXT, response_summary TEXT, external_id TEXT, payload_json TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE integration_waitlist (id INTEGER PRIMARY KEY);
    CREATE TABLE project_members (id INTEGER PRIMARY KEY, project_id INTEGER, user_id INTEGER, role TEXT, status TEXT);
    INSERT INTO project_members (project_id, user_id, role, status) VALUES (${SIBLING}, ${ME}, 'cofounder', 'accepted');
    CREATE TABLE user_company_links (user_id INTEGER, company_id INTEGER);
    CREATE TABLE company_profiles (id INTEGER PRIMARY KEY, company_name TEXT, archived_at TEXT);
    INSERT INTO company_profiles (id, company_name) VALUES (${COMPANY}, 'Synthetic Holdings'), (${OTHER_COMPANY}, 'Synthetic Other');
    INSERT INTO user_company_links VALUES (${ME}, ${COMPANY}), (${ME}, ${OTHER_COMPANY});
    CREATE TABLE integration_companies (integration_id INTEGER, company_id INTEGER, enabled INTEGER);
    INSERT INTO integration_companies VALUES (1, ${COMPANY}, 1), (2, ${COMPANY}, 1);
  `);
  db.exec(SQL_444);
  db.exec(SQL_9277);
  const modelCalls: any[] = [];
  const env: any = {
    JWT_SECRET,
    DB,
    AI: {
      run: async (model: string, input: any) => {
        if (/guard/.test(model)) return { response: 'safe' };
        modelCalls.push(input);
        return { response: opts.reply ?? '{"answer":"Noted.","send":null}' };
      },
    },
  };
  return { env, db, modelCalls };
}

const sent = (call: any): string => call.messages.map((m: any) => m.content).join('\n');

async function call(env: any, method: string, path: string, body?: unknown, o: { id?: number; company?: number | null } = {}) {
  const id = o.id ?? ME;
  const token = await createJWT(env, id, `u${id}@example.test`, 'founder', undefined, `jti-${id}`);
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const company = o.company === undefined ? COMPANY : o.company;
  if (company !== null) headers['x-company-id'] = String(company);
  const res = await eadwyn.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env);
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

async function start(env: any, scope: 'company' | 'project', id: number, o: { company?: number | null } = {}) {
  const r = await call(env, 'POST', '/conversations', { scope, id, workspace: 'Build' }, o);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.conversation.uid as string;
}

const sendTo = (project: number) => JSON.stringify({
  answer: 'I can send that company to HubSpot.',
  send: { connector: 'hubspot', payload: { project_id: project }, summary: 'Company' },
});

// ── the helper ──────────────────────────────────────────────────────────────

test('helper: a client claim is shape-checked, and a stored row reads as one company or one project', () => {
  assert.deepEqual(parseSpaceRef('project', '7'), { scope: 'project', id: 7 });
  assert.deepEqual(parseSpaceRef('company', 41), { scope: 'company', id: 41 });
  for (const [s, i] of [['team', 7], ['project', 0], ['project', '-3'], ['company', '1e3'], ['company', ' '], [undefined, 7], ['project', 7.5]]) {
    assert.equal(parseSpaceRef(s, i), null, `accepted ${String(s)} ${String(i)}`);
  }
  assert.deepEqual(spaceRefOfRow({ scope_kind: 'project', company_id: null, project_id: 7 }), { scope: 'project', id: 7 });
  assert.deepEqual(spaceRefOfRow({ scope_kind: 'company', company_id: 41, project_id: null }), { scope: 'company', id: 41 });
  // The Worker one version back writes company_id without scope_kind: still company scope.
  assert.deepEqual(spaceRefOfRow({ scope_kind: null, company_id: 41, project_id: null }), { scope: 'company', id: 41 });
  assert.equal(spaceRefOfRow({ scope_kind: null, company_id: null, project_id: null }), null, 'a row with neither has a space');
  assert.equal(spaceRefOfRow({ scope_kind: 'project', company_id: 41, project_id: null }), null, 'a project row without its project has a space');
  assert.deepEqual(spaceColumns({ scope: 'project', id: 7 }), { scope_kind: 'project', company_id: null, project_id: 7 });
  assert.deepEqual(spaceColumns({ scope: 'company', id: 41 }), { scope_kind: 'company', company_id: 41, project_id: null });
});

test('helper: a project is inside its own space and its company\'s, never a sibling\'s, and an unassigned one in no company\'s', () => {
  const company: Space = { scope: 'company', id: 41, name: null, companyId: 41, projectId: null };
  const project: Space = { scope: 'project', id: 5, name: null, companyId: 41, projectId: 5 };
  assert.equal(projectInSpace(project, { id: 5, company_id: 41 }), true);
  assert.equal(projectInSpace(project, { id: 7, company_id: 41 }), false, 'a sibling project is inside a project space');
  assert.equal(projectInSpace(company, { id: 7, company_id: 41 }), true);
  assert.equal(projectInSpace(company, { id: 8, company_id: 42 }), false, 'another company\'s project is inside the space');
  assert.equal(projectInSpace(company, { id: 9, company_id: null }), false, 'an unassigned project is inside a company space');
});

// ── the migration ───────────────────────────────────────────────────────────

test('migration: a row with a company becomes company scope, a row with neither stays without one, and the shape is enforced', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY); INSERT INTO users (id) VALUES (1); CREATE TABLE projects (id INTEGER PRIMARY KEY); INSERT INTO projects (id) VALUES (5);');
  db.exec(SQL_444);
  db.exec("INSERT INTO eadwyn_conversations (uid, user_id, company_id, workspace) VALUES ('with-company', 1, 41, 'w'), ('neither', 1, NULL, 'w')");
  db.exec("INSERT INTO eadwyn_pending_actions (uid, conversation_id, user_id, company_id, integration_id, provider_key, target_label, payload_json, payload_hash) VALUES ('a1', 1, 1, 41, 1, 'hubspot', 't', '{}', 'h')");
  db.exec(SQL_9277);
  const rows = db.prepare('SELECT uid, scope_kind, company_id, project_id FROM eadwyn_conversations ORDER BY id').all();
  assert.deepEqual(rows.map((r: any) => [r.uid, r.scope_kind, r.company_id, r.project_id]), [
    ['with-company', 'company', 41, null],
    ['neither', null, null, null],
  ]);
  assert.equal((db.prepare('SELECT scope_kind FROM eadwyn_pending_actions').get() as any).scope_kind, 'company');

  const insert = (scope: string | null, company: number | null, project: number | null) =>
    () => db.prepare("INSERT INTO eadwyn_conversations (uid, user_id, scope_kind, company_id, project_id, workspace) VALUES (?, 1, ?, ?, ?, 'w')")
      .run(`r-${Math.random()}`, scope, company, project);
  assert.doesNotThrow(insert('project', null, 5));
  assert.doesNotThrow(insert('company', 41, null));
  assert.doesNotThrow(insert(null, 41, null), 'the previous Worker\'s insert is refused');
  assert.throws(insert('project', 41, 5), /one company or one project/, 'a project row may also name a company');
  assert.throws(insert('company', 41, 5), /one company or one project/);
  assert.throws(insert('project', null, null), /one company or one project/);
  assert.throws(insert('company', null, null), /one company or one project/);
  assert.throws(insert('team', 41, null), /one company or one project/);
  assert.throws(insert(null, null, 5), /one company or one project/, 'a project without a scope was stored');
  assert.throws(() => db.exec("UPDATE eadwyn_conversations SET project_id = 5 WHERE uid = 'with-company'"), /one company or one project/, 'an update moved a conversation into a second space');
  assert.throws(() => db.prepare("INSERT INTO eadwyn_pending_actions (uid, conversation_id, user_id, scope_kind, company_id, project_id, integration_id, provider_key, target_label, payload_json, payload_hash) VALUES ('a2', 1, 1, 'project', 41, 5, 1, 'hubspot', 't', '{}', 'h')").run(), /one company or one project/);
});

// ── starting and listing ────────────────────────────────────────────────────

test('a conversation starts only in a space the member is in, and says which', async () => {
  const { env, db } = world();
  const bad = await call(env, 'POST', '/conversations', { scope: 'team', id: 1 });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, 'space_invalid');
  for (const [scope, id] of [['project', NOT_MINE], ['company', 999], ['project', 404]] as const) {
    const r = await call(env, 'POST', '/conversations', { scope, id });
    assert.equal(r.status, 403, `${scope} ${id}`);
    assert.equal(r.json.error, 'space_not_member');
  }
  const none = await call(env, 'POST', '/conversations', { workspace: 'Build' }, { company: null });
  assert.equal(none.status, 400);
  assert.equal(none.json.error, 'space_required');
  assert.equal((db.prepare('SELECT COUNT(*) n FROM eadwyn_conversations').get() as any).n, 0, 'a refused start stored a row');

  const p = await call(env, 'POST', '/conversations', { scope: 'project', id: SIBLING });
  assert.deepEqual(p.json.conversation.space, { scope: 'project', id: SIBLING, name: 'Synthetic Sibling' });
  const c = await call(env, 'POST', '/conversations', { workspace: 'Build' });
  assert.deepEqual(c.json.conversation.space, { scope: 'company', id: COMPANY, name: 'Synthetic Holdings' }, 'an older client\'s start is not in the active company');
  assert.deepEqual(db.prepare('SELECT scope_kind, company_id, project_id FROM eadwyn_conversations ORDER BY id').all().map((r: any) => [r.scope_kind, r.company_id, r.project_id]), [
    ['project', null, SIBLING],
    ['company', COMPANY, null],
  ]);
});

test('company → project: each list holds only its own space\'s conversations, and the header names it', async () => {
  const { env } = world();
  const inCompany = await start(env, 'company', COMPANY);
  const inProject = await start(env, 'project', OWN);
  const inSibling = await start(env, 'project', SIBLING);

  const company = await call(env, 'GET', `/conversations?scope=company&id=${COMPANY}`);
  assert.deepEqual(company.json.conversations.map((x: any) => x.uid), [inCompany], 'the company list holds a project\'s conversation');
  assert.equal(company.json.space.name, 'Synthetic Holdings');
  const project = await call(env, 'GET', `/conversations?scope=project&id=${OWN}`);
  assert.deepEqual(project.json.conversations.map((x: any) => x.uid), [inProject], 'the project list holds its company\'s or a sibling\'s conversation');
  assert.equal(project.json.space.name, 'Synthetic Own');
  const sibling = await call(env, 'GET', `/conversations?scope=project&id=${SIBLING}`);
  assert.deepEqual(sibling.json.conversations.map((x: any) => x.uid), [inSibling]);

  const stranger = await call(env, 'GET', `/conversations?scope=project&id=${NOT_MINE}`);
  assert.equal(stranger.status, 403);
  assert.equal(stranger.json.error, 'space_not_member');

  const one = await call(env, 'GET', `/conversations/${inProject}`);
  assert.deepEqual(one.json.conversation.space, { scope: 'project', id: OWN, name: 'Synthetic Own' });
});

test('company → project: the company conversation reads every project of the company it may; the project one reads only its own', async () => {
  const { env, modelCalls } = world();
  const inCompany = await start(env, 'company', COMPANY);
  const inProject = await start(env, 'project', OWN);
  for (const uid of [inCompany, inProject]) await call(env, 'PUT', `/conversations/${uid}/connectors`, { keys: ['stripe'] });

  const a = await call(env, 'POST', `/conversations/${inCompany}/ask`, { question: 'What is MRR?' });
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.match(sent(modelCalls[0]), /MRR 1,111/);
  assert.match(sent(modelCalls[0]), /MRR 7,777/);
  assert.deepEqual(a.json.sources.map((s: any) => s.space), [{ scope: 'company', id: COMPANY }]);

  const b = await call(env, 'POST', `/conversations/${inProject}/ask`, { question: 'What is MRR?' });
  assert.equal(b.status, 200, JSON.stringify(b.json));
  assert.match(sent(modelCalls[1]), /Synthetic Own .*MRR 1,111/);
  assert.doesNotMatch(sent(modelCalls[1]), /7,777|4,444|Synthetic Sibling|Synthetic Stranger/, 'the project run read its company\'s other projects');
  assert.deepEqual(b.json.sources.map((s: any) => s.space), [{ scope: 'project', id: OWN }]);
  assert.match(modelCalls[1].messages[0].content, /belongs to one project \(project 5\)/, 'the run was not told its space');
});

test('the same question in two projects with different synthetic evidence reads only its own', async () => {
  const { env, modelCalls } = world();
  const own = await start(env, 'project', OWN);
  const sibling = await start(env, 'project', SIBLING);
  for (const uid of [own, sibling]) await call(env, 'PUT', `/conversations/${uid}/connectors`, { keys: ['stripe'] });

  const q = { question: 'What is our MRR this month?' };
  const a = await call(env, 'POST', `/conversations/${own}/ask`, q);
  const b = await call(env, 'POST', `/conversations/${sibling}/ask`, q);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.match(sent(modelCalls[0]), /MRR 1,111/);
  assert.doesNotMatch(sent(modelCalls[0]), /7,777/, 'project 5 read project 7\'s evidence');
  assert.match(sent(modelCalls[1]), /MRR 7,777/);
  assert.doesNotMatch(sent(modelCalls[1]), /1,111/, 'project 7 read project 5\'s evidence');
  assert.deepEqual(a.json.sources, [{ key: 'stripe', name: 'Stripe', as_of: '2026-11-01', space: { scope: 'project', id: OWN } }]);
  assert.deepEqual(b.json.sources, [{ key: 'stripe', name: 'Stripe', as_of: '2026-11-01', space: { scope: 'project', id: SIBLING } }]);
  // Each thread keeps its own turns: the sibling's history is not replayed into the other.
  const second = await call(env, 'POST', `/conversations/${own}/ask`, { question: 'And churn?' });
  assert.equal(second.status, 200);
  assert.equal(modelCalls[2].messages.filter((m: any) => m.role === 'user').length, 2, 'a sibling conversation\'s turn was replayed');
});

test('project → sibling project: a send proposed in one project cannot target its sibling, even one the member may write', async () => {
  const { env, db } = world({ reply: sendTo(SIBLING) });
  const own = await start(env, 'project', OWN);
  await call(env, 'PUT', `/conversations/${own}/connectors`, { keys: ['hubspot'] });
  const r = await call(env, 'POST', `/conversations/${own}/ask`, { question: 'Send the sibling to HubSpot' });
  assert.equal(r.status, 200);
  assert.equal(r.json.action, null, 'a card was offered for a project outside the conversation\'s space');
  assert.equal((db.prepare('SELECT COUNT(*) n FROM eadwyn_pending_actions').get() as any).n, 0);

  // The same proposal in the sibling's own conversation gives a card, and the action records that space.
  const sib = await start(env, 'project', SIBLING);
  await call(env, 'PUT', `/conversations/${sib}/connectors`, { keys: ['hubspot'] });
  const ok = await call(env, 'POST', `/conversations/${sib}/ask`, { question: 'Send it to HubSpot' });
  assert.ok(ok.json.action, JSON.stringify(ok.json));
  assert.deepEqual({ ...(db.prepare('SELECT scope_kind, company_id, project_id FROM eadwyn_pending_actions').get() as any) }, { scope_kind: 'project', company_id: null, project_id: SIBLING });
});

test('switching the active company leaves a project thread where it started', async () => {
  const { env } = world();
  const own = await start(env, 'project', OWN);
  const r = await call(env, 'POST', `/conversations/${own}/ask`, { question: 'Still here?' }, { company: OTHER_COMPANY });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const got = await call(env, 'GET', `/conversations/${own}`, undefined, { company: OTHER_COMPANY });
  assert.deepEqual(got.json.conversation.space, { scope: 'project', id: OWN, name: 'Synthetic Own' });
  assert.equal(got.json.messages.length, 2);
});

// ── access lost ─────────────────────────────────────────────────────────────

test('a member removed between a draft and its Send: the quote ran, the ask is refused, and nothing is read or kept', async () => {
  const { env, db, modelCalls } = world();
  const sib = await start(env, 'project', SIBLING);
  await call(env, 'PUT', `/conversations/${sib}/connectors`, { keys: ['stripe'] });
  const quote = await call(env, 'POST', `/conversations/${sib}/quote`, { question: 'What is MRR?' });
  assert.equal(quote.status, 200, JSON.stringify(quote.json));

  db.prepare('DELETE FROM project_members WHERE user_id = ? AND project_id = ?').run(ME, SIBLING);

  const ask = await call(env, 'POST', `/conversations/${sib}/ask`, { question: 'What is MRR?' });
  assert.equal(ask.status, 403);
  assert.equal(ask.json.error, 'space_access_lost');
  assert.equal(modelCalls.length, 0, 'the model ran for a project the member left');
  assert.equal((db.prepare('SELECT COUNT(*) n FROM eadwyn_messages').get() as any).n, 0);
  for (const [method, path, body] of [
    ['POST', `/conversations/${sib}/quote`, { question: 'again' }],
    ['GET', `/conversations/${sib}`, undefined],
    ['PUT', `/conversations/${sib}/connectors`, { keys: [] }],
  ] as const) {
    const r = await call(env, method, path, body);
    assert.equal(r.status, 403, `${method} ${path}`);
    assert.equal(r.json.error, 'space_access_lost', `${method} ${path}`);
  }
  const list = await call(env, 'GET', `/conversations?scope=project&id=${SIBLING}`);
  assert.equal(list.json.error, 'space_not_member');
  const mine = await call(env, 'GET', '/conversations/mine');
  assert.deepEqual(mine.json.conversations.filter((x: any) => x.kind === 'eadwyn').map((x: any) => x.id), [], 'a lost space\'s conversation was listed');
  const legacy = await call(env, 'GET', '/conversations?workspace=Build');
  assert.deepEqual(legacy.json.conversations, [], 'the older workspace list kept a lost space\'s conversation');
  // The owner can still delete their own conversation.
  assert.equal((await call(env, 'DELETE', `/conversations/${sib}`)).status, 200);
});

test('a company space is lost when the member leaves it or it is archived, and another member never had it', async () => {
  const { env, db } = world();
  const uid = await start(env, 'company', COMPANY);
  assert.equal((await call(env, 'GET', `/conversations/${uid}`)).status, 200);
  const stranger = await call(env, 'POST', '/conversations', { scope: 'company', id: COMPANY }, { id: OTHER });
  assert.equal(stranger.json.error, 'space_not_member', 'a member with no link started a conversation in the company');
  db.prepare('UPDATE company_profiles SET archived_at = ? WHERE id = ?').run('2026-11-20 10:00:00', COMPANY);
  const archived = await call(env, 'GET', `/conversations/${uid}`);
  assert.equal(archived.status, 403);
  assert.equal(archived.json.error, 'space_access_lost', 'an archived company stayed a space');
  db.prepare('UPDATE company_profiles SET archived_at = NULL WHERE id = ?').run(COMPANY);
  db.prepare('DELETE FROM user_company_links WHERE user_id = ? AND company_id = ?').run(ME, COMPANY);
  assert.equal((await call(env, 'GET', `/conversations/${uid}`)).json.error, 'space_access_lost');
});

test('a pending action confirmed after access to its project is lost sends nothing', async () => {
  const { env, db } = world({ reply: sendTo(SIBLING) });
  const sib = await start(env, 'project', SIBLING);
  await call(env, 'PUT', `/conversations/${sib}/connectors`, { keys: ['hubspot'] });
  const ask = await call(env, 'POST', `/conversations/${sib}/ask`, { question: 'Send it' });
  const action = ask.json.action;
  assert.ok(action, JSON.stringify(ask.json));

  db.prepare('DELETE FROM project_members WHERE user_id = ? AND project_id = ?').run(ME, SIBLING);
  const r = await call(env, 'POST', `/actions/${action.uid}/confirm`);
  assert.equal(r.status, 403);
  assert.equal(r.json.error, 'space_access_lost');
  assert.deepEqual(pushes, [], 'a push went out after the member lost the project');
  assert.equal((db.prepare('SELECT status FROM eadwyn_pending_actions WHERE uid = ?').get(action.uid) as any).status, 'pending');
});

test('a pending action checks the space IT recorded, not the conversation\'s', async () => {
  const { env, db } = world({ reply: sendTo(SIBLING) });
  const sib = await start(env, 'project', SIBLING);
  await call(env, 'PUT', `/conversations/${sib}/connectors`, { keys: ['hubspot'] });
  const action = (await call(env, 'POST', `/conversations/${sib}/ask`, { question: 'Send it' })).json.action;
  // The action alone is moved to a project the member is not in: its own recorded space is what confirm checks.
  db.prepare('UPDATE eadwyn_pending_actions SET project_id = ? WHERE uid = ?').run(NOT_MINE, action.uid);
  const r = await call(env, 'POST', `/actions/${action.uid}/confirm`);
  assert.equal(r.json.error, 'space_access_lost');
  assert.deepEqual(pushes, []);
});

test('a pending action confirmed while the member keeps the space is sent once', async () => {
  const { env } = world({ reply: sendTo(SIBLING) });
  const sib = await start(env, 'project', SIBLING);
  await call(env, 'PUT', `/conversations/${sib}/connectors`, { keys: ['hubspot'] });
  const action = (await call(env, 'POST', `/conversations/${sib}/ask`, { question: 'Send it' })).json.action;
  const r = await call(env, 'POST', `/actions/${action.uid}/confirm`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(pushes, [{ project_id: SIBLING }]);
});

test('a conversation from before spaces with no company is its owner\'s to read, and never runs', async () => {
  const { env, db, modelCalls } = world();
  db.prepare("INSERT INTO eadwyn_conversations (uid, user_id, workspace) VALUES (?, ?, 'Build')").run('a'.repeat(32), ME);
  const got = await call(env, 'GET', `/conversations/${'a'.repeat(32)}`);
  assert.equal(got.status, 200);
  assert.equal(got.json.conversation.space, null);
  assert.equal((await call(env, 'GET', `/conversations/${'a'.repeat(32)}`, undefined, { id: OTHER })).status, 404, 'another member read it');
  const ask = await call(env, 'POST', `/conversations/${'a'.repeat(32)}/ask`, { question: 'Hello?' });
  assert.equal(ask.status, 409);
  assert.equal(ask.json.error, 'no_space');
  assert.equal(modelCalls.length, 0);
  const legacy = await call(env, 'GET', '/conversations?workspace=Build');
  assert.deepEqual(legacy.json.conversations.map((x: any) => x.space), [null]);
});
