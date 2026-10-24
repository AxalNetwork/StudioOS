/** #2435: synthetic principals/data, real mounted routes and SQLite. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import decks from '../src/routes/decks.ts';
import brand from '../src/routes/brand.ts';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { withGuard } from './_guard_stub.mjs';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { canWrite, canWritePitchDeck } from '../src/routes/_founder_validate_helpers.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const SECRET = 'synthetic-project-content-secret-2435'.repeat(2);
const SLIDES = [{ title: 'Synthetic problem', method_id: 'yc_seed', spec_id: 'problem', body: 'Synthetic founder text.', fields: [] }];
const POSITIONING = { one_liner: 'Synthetic dispatch', elevator_pitch: 'Synthetic team coordinates shipments.', positioning_lines: ['Synthetic shared dispatch'] };
const principals = [
  [1, 'admin', null], [2, 'founder', 20], [3, 'investor', null], [4, 'partner', null], [5, 'advisor', null],
  [6, 'founder', 60], [7, 'founder', 70], [8, 'founder', 80], [9, 'explorer', null], [10, 'founder', 30],
  [11, 'advisor', null], [12, 'partner', null], [13, 'partner', null], [14, 'founder', 140],
  [15, 'founder', 150], [16, 'founder', 160], [17, 'founder', 170],
] as const;

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function request(f: any, who: number | null, method: string, path: string, body?: any, company?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (who) headers.Authorization = 'Bearer ' + await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  if (company) headers['X-Company-Id'] = company;
  const res = await f.app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, f.env);
  const text = await res.text(); let value: any;
  try { value = JSON.parse(text); } catch { value = text; }
  return { status: res.status, body: value };
}
async function fixture() {
  __resetForTest();
  const f = aiBudgetFixture();
  f.db.exec('PRAGMA foreign_keys=OFF; ALTER TABLE users ADD COLUMN founder_id INTEGER; ALTER TABLE activity_logs ADD COLUMN project_id INTEGER; ALTER TABLE activity_logs ADD COLUMN entity_type TEXT; ALTER TABLE activity_logs ADD COLUMN entity_id TEXT;');
  for (const table of ['projects', 'pitch_decks', 'financial_models', 'cap_table_holders', 'landing_pages']) f.db.exec(stripForeignKeys(tableFromBaseline(BASELINE, table)));
  f.db.exec(readFileSync(new URL('../sql/migrations/399_landing_brand_voice_dark_logo_archive.sql', import.meta.url), 'utf8'));
  f.db.exec(readFileSync(new URL('../sql/migrations/465_ai_rail_preferences.sql', import.meta.url), 'utf8'));
  f.db.exec(`CREATE TABLE mi_pro_subscriptions(user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE user_recovery_state(user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);
    CREATE TABLE user_company_links(user_id INTEGER, company_id INTEGER);
    INSERT INTO user_company_links VALUES(2,101),(2,102),(4,101);
    INSERT INTO projects(id,name,founder_id,company_id) VALUES(1,'Synthetic venture',20,101),(2,'Synthetic unrelated venture',30,102);`);
  for (const [id, role, founder] of principals) f.db.prepare("UPDATE users SET name = ?, role = ?, founder_id = ?, subscription_tier = 'studio', is_active = 1 WHERE id = ?")
    .run(id === 2 ? 'Synthetic owner' : 'Synthetic member ' + id, role, founder, id);
  const prompts: any[] = [];
  const promptTexts: string[] = [];
  const env: any = { DB: f.DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development', AI: withGuard({ run: async (_model: string, input: any) => {
    const content = input?.messages?.map((m: any) => m.content).join('\n') ?? '';
    if (content.includes('Startup data (JSON):')) {
      promptTexts.push(content);
      prompts.push(JSON.parse(content.split('Startup data (JSON):\n')[1].split('\n\nReturn ONLY')[0]));
      return { response: JSON.stringify(POSITIONING), usage: { prompt_tokens: 30, completion_tokens: 20 } };
    }
    return { response: '{}', usage: { prompt_tokens: 10, completion_tokens: 10 } };
  } }) };
  const app = new Hono<any>().route('/api/decks', decks).route('/api/brand', brand);
  const out = { ...f, app, env, prompts, promptTexts, shareId: 0, token: '', slug: '' };
  // Owner controls initialize the exact runtime schema before hostile calls.
  assert.equal((await request(out, 2, 'GET', '/api/decks/by-project/1')).status, 200);
  const landing = await request(out, 2, 'PUT', '/api/brand/landing/by-project/1', { name: 'Synthetic venture' });
  assert.equal(landing.status, 200, JSON.stringify(landing.body));
  out.slug = landing.body.slug;
  assert.equal((await request(out, 2, 'POST', '/api/brand/landing/by-project/1/pages', { name: 'Synthetic second page', page_slug: 'second' })).status, 201);
  f.db.prepare('INSERT INTO pitch_decks(id,project_id,version,slides,title,is_current,created_by) VALUES(10,1,1,?,?,1,2),(11,2,1,?,?,1,10)')
    .run(JSON.stringify(SLIDES), 'Synthetic deck', JSON.stringify(SLIDES), 'Synthetic other deck');
  await ensureProjectMembershipSchema(env);
  f.db.prepare("INSERT INTO pitch_deck_proposals(id,project_id,base_deck_id,slides,title,method_id,created_by) VALUES(40,1,10,?,'Synthetic proposal','yc_seed',2)").run(JSON.stringify(SLIDES));
  f.db.exec("INSERT INTO project_members(project_id,user_id,role,status) VALUES(1,6,'cofounder','accepted'),(1,7,'cofounder','pending'),(1,8,'cofounder','removed'),(1,11,'advisor','accepted'),(1,12,'advisor','accepted'),(1,13,'cofounder','accepted'),(1,14,'unexpected','accepted'),(1,15,'cofounder','accepted'),(1,16,'cofounder','accepted'),(1,17,'cofounder','accepted'),(1,2,'owner','accepted')");
  f.db.exec('UPDATE users SET is_active = 0 WHERE id = 15');
  const share = await request(out, 2, 'POST', '/api/decks/10/share', { view_limit: 100 });
  assert.equal(share.status, 200, JSON.stringify(share.body));
  out.shareId = share.body.id; out.token = share.body.token;
  f.db.prepare("INSERT INTO waitlist_signups(project_id,landing_page_id,name,email,source) VALUES(1,1,'Synthetic signup','synthetic2435@example.test','landing')").run();
  return out;
}
const snapshot = (f: Fixture) => JSON.stringify(['pitch_decks', 'pitch_deck_proposals', 'pitch_deck_share_tokens', 'landing_pages', 'brand_sites', 'waitlist_signups']
  .map((name) => f.db.prepare('SELECT * FROM ' + name).all())); // fixed local fixture table names
const writes = (f: Fixture): Array<[string, string, any?]> => [
  ['PUT', '/api/decks/10', { slides: SLIDES, title: 'Synthetic edit' }],
  ['POST', '/api/decks/10/restore'], ['POST', '/api/decks/10/share', { ttl_hours: 24 }], ['DELETE', '/api/decks/10/shares/' + f.shareId],
  ['POST', '/api/decks/10/autofill', {}],
  ['PUT', '/api/brand/landing/by-project/1', { name: 'Synthetic edit' }],
  ['POST', '/api/brand/landing/by-project/1/publish', { published: true }],
  ['PUT', '/api/brand/landing/pages/1', { name: 'Synthetic edit' }],
  ['POST', '/api/brand/landing/pages/1/publish', { published: true }], ['DELETE', '/api/brand/landing/pages/2'],
];
const otherWrites = (): Array<[string, string, any?]> => [
  ['POST', '/api/decks/proposals/40/keep'], ['DELETE', '/api/decks/proposals/40'],
  ['POST', '/api/brand/custom-templates', { name: 'Synthetic template', from_page_id: 1 }],
  ['POST', '/api/decks/generate', { project_id: 1 }], ['POST', '/api/decks/positioning', { project_id: 1 }],
  ['POST', '/api/decks/apply-method', { project_id: 1, method_id: 'yc_seed' }], ['POST', '/api/decks/10/export', { format: 'pptx' }],
  ['PUT', '/api/brand/site/by-project/1', { slug: 'synthetic-new-site' }],
  ['PUT', '/api/brand/landing/pages/1/address', { page_slug: 'synthetic-new-page' }],
  ['POST', '/api/brand/landing/pages/1/archive', { archived: true }],
  ['POST', '/api/brand/landing/by-project/1/pages', { name: 'Synthetic new page', page_slug: 'synthetic-page' }],
  ['GET', '/api/brand/landing/by-project/1/preview-url'], ['GET', '/api/brand/landing/pages/1/preview-url'],
];
const contacts: Array<[string, string]> = [['GET', '/api/brand/landing/by-project/1/waitlist']];
const reads: Array<[string, string]> = [
  ['GET', '/api/brand/site/by-project/1'],
  ['GET', '/api/decks/10'], ['GET', '/api/decks/by-project/1'], ['GET', '/api/decks/10/engagement'], ['GET', '/api/decks/recommend?project_id=1'],
  ['GET', '/api/brand/landing/by-project/1'],
  ['GET', '/api/brand/landing/pages/1/public-url'],
  ['GET', '/api/brand/landing/by-project/1/page-slug-available?page_slug=synthetic-free'],
  ['GET', '/api/brand/landing/by-project/1/pages'], ['GET', '/api/brand/landing/pages/1'],
];
for (const [who, label] of [[3, 'investor'], [4, 'Operating Partner'], [5, 'unrelated advisor'], [9, 'Explorer'], [10, 'unrelated founder'], [7, 'pending member'], [8, 'removed member'], [14, 'invalid membership']] as const) {
  test(label + ' cannot read or modify venture content through management routes', async () => {
    const f = await fixture(); const before = snapshot(f);
    try {
      for (const [method, path, body] of [...writes(f), ...otherWrites(), ...reads, ...contacts]) {
        const r = await request(f, who, method, path, body);
        assert.equal(r.status, 403, label + ' ' + method + ' ' + path + ': ' + JSON.stringify(r.body));
      }
      assert.equal(snapshot(f), before); assert.deepEqual(f.prompts, []);
    } finally { f.db.close(); }
  });
}
for (let index = 0; index < 10; index++) test('owning founder control for protected write ' + index, async () => {
  const f = await fixture();
  try { const [method, path, body] = writes(f)[index]; const r = await request(f, 2, method, path, body); assert.equal(r.status, 200, path + ': ' + JSON.stringify(r.body)); }
  finally { f.db.close(); }
});
for (const who of [1, 6, 13]) test('admin reads only decks; accepted cofounder ' + who + ' retains existing writes', async () => {
  const f = await fixture();
  try {
    for (const [method, path] of reads) assert.equal((await request(f, who, method, path)).status, 200, path);
    assert.equal((await request(f, who, 'PUT', '/api/decks/10', { slides: SLIDES })).status, who === 1 ? 403 : 200);
    assert.equal((await request(f, who, 'PUT', '/api/brand/landing/by-project/1', { name: 'Synthetic member edit' })).status, 200);
    if (who !== 1) {
      const details = JSON.parse(f.db.prepare("SELECT details FROM activity_logs WHERE action = 'project_content_write_authorized' ORDER BY id DESC LIMIT 1").get().details);
      assert.deepEqual(details, { permission: 'write', phase: 'authorization', method: 'PUT', route: '/api/brand/landing/by-project/:pid' });
      const audit = f.db.prepare("SELECT actor, user_id, project_id FROM activity_logs WHERE action = 'project_content_write_authorized' ORDER BY id DESC LIMIT 1").get();
      assert.deepEqual({ ...audit }, { actor: `user:${who}`, user_id: who, project_id: 1 });
    }
  } finally { f.db.close(); }
});
for (const who of [11, 12]) test('accepted advisor ' + who + ' reads brand but cannot read decks, write or create preview credentials', async () => {
  const f = await fixture();
  try {
    for (const [method, path] of reads) assert.equal((await request(f, who, method, path)).status, path.startsWith('/api/decks/') ? 403 : 200, path);
    const before = snapshot(f);
    for (const [method, path, body] of [...writes(f), ...otherWrites()]) assert.equal((await request(f, who, method, path, body)).status, 403, path);
    assert.equal(snapshot(f), before);
  } finally { f.db.close(); }
});
test('company selection narrows owner access and never grants an unrelated partner access', async () => {
  const f = await fixture();
  try {
    assert.equal((await request(f, 2, 'GET', '/api/brand/landing/by-project/1', undefined, '101')).status, 200);
    assert.equal((await request(f, 2, 'GET', '/api/brand/landing/by-project/1', undefined, '102')).status, 404);
    assert.equal((await request(f, 4, 'PUT', '/api/brand/landing/by-project/1', { name: 'Synthetic attack' }, '101')).status, 403);
  } finally { f.db.close(); }
});
test('a valid public deck share and published landing page remain readable without management access', async () => {
  const f = await fixture();
  try {
    assert.equal((await request(f, 3, 'GET', '/api/decks/10')).status, 403);
    assert.equal((await request(f, null, 'GET', '/api/decks/share/' + f.token)).status, 200);
    assert.equal((await request(f, 2, 'POST', '/api/brand/landing/pages/1/publish', { published: true })).status, 200);
    assert.equal((await request(f, null, 'GET', '/api/brand/landing/' + f.slug)).status, 200);
  } finally { f.db.close(); }
});
for (const empty of [false, true]) test('positioning uses recorded team only; empty=' + empty, async () => {
  const f = await fixture();
  try {
    f.db.exec("INSERT INTO cap_table_holders(user_id,project_id,name,kind) VALUES(2,1,'Synthetic cap investor','investor'),(2,1,'Synthetic cap employee','employee')");
    if (empty) f.db.exec("UPDATE users SET name = '' WHERE id = 2; UPDATE project_members SET status = 'pending' WHERE project_id = 1;");
    const r = await request(f, 2, 'POST', '/api/decks/positioning', { project_id: 1 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(f.prompts.length, 1);
    const team = f.prompts[0].team;
    assert.equal(JSON.stringify(f.prompts).includes('Synthetic cap'), false);
    assert.equal(team.includes('Synthetic member 7'), false); assert.equal(team.includes('Synthetic member 8'), false);
    assert.equal(team.includes('Synthetic member 14'), false);
    assert.equal(team.includes('Synthetic member 15'), false);
    assert.equal(team.includes('Synthetic member 11'), false); assert.equal(team.includes('Synthetic member 12'), false);
    assert.deepEqual(team, empty ? [] : ['Synthetic owner', 'Synthetic member 6', 'Synthetic member 13', 'Synthetic member 16', 'Synthetic member 17']);
    assert.deepEqual(f.prompts[0].advisors, empty ? [] : ['Synthetic member 11']);
    assert.equal(team.length + f.prompts[0].advisors.length, empty ? 0 : 6);
    assert.equal(r.body.sourced_from.advisors, empty ? 0 : 1);
    assert.equal(r.body.sourced_from.team, team.length);
    assert.equal(r.body.sourced_from.team_status, empty ? 'not_recorded' : 'recorded');
  } finally { f.db.close(); }
});
test('an unreadable team store sends no names and reports unreadable rather than no team', async () => {
  const f = await fixture(); const prepare = f.env.DB.prepare.bind(f.env.DB);
  f.env.DB.prepare = (sql: string) => { if (sql.includes('WITH target AS')) throw new Error('synthetic store unavailable'); return prepare(sql); };
  try {
    const r = await request(f, 2, 'POST', '/api/decks/positioning', { project_id: 1 });
    assert.equal(r.status, 200); assert.deepEqual(f.prompts[0].team, []); assert.deepEqual(f.prompts[0].advisors, []);
    assert.equal(r.body.sourced_from.advisors, null);
    assert.equal(r.body.sourced_from.team, null); assert.equal(r.body.sourced_from.team_status, 'unreadable');
  } finally { f.db.close(); }
});

test('a missing actor audit refuses a new member write before business rows change', async () => {
  const f = await fixture(); const before = snapshot(f);
  try {
    f.db.exec('DROP TABLE activity_logs');
    const r = await request(f, 6, 'PUT', '/api/brand/landing/by-project/1', { name: 'Synthetic unlogged edit' });
    assert.equal(r.status, 403); assert.equal(snapshot(f), before);
  } finally { f.db.close(); }
});

test('an investor membership and role casing do not create management access', async () => {
  const f = await fixture();
  try {
    f.db.exec("INSERT INTO project_members(project_id,user_id,role,status) VALUES(1,3,'cofounder','accepted')");
    for (const role of ['investor', 'INVESTOR']) {
      f.db.prepare('UPDATE users SET role = ? WHERE id = 3').run(role);
      assert.equal((await request(f, 3, 'PUT', '/api/decks/10', { slides: SLIDES })).status, 403);
      assert.equal((await request(f, 3, 'PUT', '/api/brand/landing/by-project/1', { name: 'Synthetic denied' })).status, 403);
    }
  } finally { f.db.close(); }
});

const allocatingReads = [
  { path: '/api/brand/site/by-project/1', clear: 'DELETE FROM brand_sites WHERE project_id = 1' },
  { path: '/api/brand/landing/by-project/1/preview-url', clear: 'UPDATE landing_pages SET preview_token = NULL WHERE project_id = 1' },
  { path: '/api/brand/landing/pages/1/preview-url', clear: 'UPDATE landing_pages SET preview_token = NULL WHERE id = 1' },
];
for (const { path, clear } of allocatingReads) {
  test('existing allocation reads without an audit write: ' + path, async () => {
    const f = await fixture();
    try {
      const before = Number(f.db.prepare("SELECT count(*) AS n FROM activity_logs WHERE action = 'project_content_write_authorized'").get().n);
      assert.equal((await request(f, 6, 'GET', path)).status, 200);
      assert.equal(Number(f.db.prepare("SELECT count(*) AS n FROM activity_logs WHERE action = 'project_content_write_authorized'").get().n), before);
      f.db.exec('DROP TABLE activity_logs');
      assert.equal((await request(f, 6, 'GET', path)).status, 200);
    } finally { f.db.close(); }
  });
  test('new allocation records the member actor: ' + path, async () => {
    const f = await fixture();
    try {
      f.db.exec(clear);
      assert.equal((await request(f, 6, 'GET', path)).status, 200);
      const rows = f.db.prepare("SELECT actor, user_id, project_id FROM activity_logs WHERE action = 'project_content_write_authorized'").all();
      assert.deepEqual(rows.map((r: any) => ({ ...r })), [{ actor: 'user:6', user_id: 6, project_id: 1 }]);
    } finally { f.db.close(); }
  });
  test('new allocation refuses an unavailable audit store: ' + path, async () => {
    const f = await fixture();
    try {
      f.db.exec(clear); const before = snapshot(f);
      f.db.exec('DROP TABLE activity_logs');
      assert.equal((await request(f, 6, 'GET', path)).status, 403);
      assert.equal(snapshot(f), before);
    } finally { f.db.close(); }
  });
}

for (const who of [11, 12]) test('accepted advisor '+who+' can read an existing address but cannot allocate one', async () => {
  const f = await fixture();
  try {
    assert.equal((await request(f, who, 'GET', '/api/brand/site/by-project/1')).status, 200);
    f.db.exec('DELETE FROM brand_sites WHERE project_id = 1'); const before = snapshot(f);
    assert.equal((await request(f, who, 'GET', '/api/brand/site/by-project/1')).status, 403);
    assert.equal(snapshot(f), before);
  } finally { f.db.close(); }
});

for (const who of [1, 2, 6, 13, 11, 12]) test('waitlist contact access is limited to owners and cofounders: ' + who, async () => {
  const f = await fixture(); const prepare = f.env.DB.prepare.bind(f.env.DB); let contactReads = 0;
  f.env.DB.prepare = (sql: string) => { if (sql.includes('FROM waitlist_signups')) contactReads++; return prepare(sql); };
  try {
    const before = snapshot(f);
    const auditBefore = Number(f.db.prepare("SELECT count(*) AS n FROM activity_logs WHERE action = 'project_content_write_authorized'").get().n);
    const r = await request(f, who, 'GET', '/api/brand/landing/by-project/1/waitlist');
    if (who === 11 || who === 12) {
      assert.equal(r.status, 403); assert.equal(contactReads, 0);
      assert.equal(JSON.stringify(r.body).includes('synthetic2435@example.test'), false);
    } else {
      assert.equal(r.status, 200); assert.equal(contactReads, 1);
      assert.equal(r.body.count, 1);
      assert.equal(r.body.signups[0].email, 'synthetic2435@example.test');
      assert.equal(r.body.signups[0].name, 'Synthetic signup');
    }
    assert.equal(snapshot(f), before);
    assert.equal(Number(f.db.prepare("SELECT count(*) AS n FROM activity_logs WHERE action = 'project_content_write_authorized'").get().n), auditBefore);
  } finally { f.db.close(); }
});

test('recorded advisors are separate from an absent founding team', async () => {
  const f = await fixture();
  try {
    f.db.exec("UPDATE users SET name = '' WHERE id = 2; UPDATE project_members SET status = 'pending' WHERE project_id = 1 AND role IN ('owner', 'cofounder')");
    const r = await request(f, 2, 'POST', '/api/decks/positioning', { project_id: 1 });
    assert.equal(r.status, 200); assert.deepEqual(f.prompts[0].team, []);
    assert.deepEqual(f.prompts[0].advisors, ['Synthetic member 11', 'Synthetic member 12']);
    assert.equal(r.body.sourced_from.team, 0); assert.equal(r.body.sourced_from.team_status, 'not_recorded');
    assert.equal(r.body.sourced_from.advisors, 2);
    assert.ok(f.promptTexts[0].includes("Never describe them as founders or members of the operating team"));
  } finally { f.db.close(); }
});

test('a refused payload records authorization context rather than a completed change', async () => {
  const f = await fixture(); const before = snapshot(f);
  try {
    assert.equal((await request(f, 6, 'PUT', '/api/decks/10', { slides: [] })).status, 400);
    assert.equal(snapshot(f), before);
    const rows = f.db.prepare("SELECT action, details FROM activity_logs WHERE action = 'project_content_write_authorized'").all();
    assert.equal(rows.length, 1);
    assert.deepEqual(JSON.parse(rows[0].details), { permission: 'write', phase: 'authorization', method: 'PUT', route: '/api/decks/:id' });
  } finally { f.db.close(); }
});


test('D895: legacy admin/advisor casing stays blocked on decks without changing other module ownership',async()=>{
 const f=await fixture();try{
  // This fixture deliberately supports legacy/malformed roles; canonical D1
  // constrains role values and the other D895 fixtures retain that constraint.
  f.db.exec("UPDATE users SET role='ADMIN' WHERE id=1; UPDATE users SET role='ADVISOR' WHERE id=6");
  assert.equal((await request(f,1,'GET','/api/decks/10')).status,200);
  assert.equal((await request(f,6,'GET','/api/decks/10')).status,403);
  for(const who of [1,6])for(const [method,path,body]of [...writes(f),...otherWrites()].filter(([,path])=>path.startsWith('/api/decks/'))){const r=await request(f,who,method,path,body);assert.ok([403,404].includes(r.status),`${who} ${method} ${path}: ${r.status}`)}
  assert.equal((await request(f,1,'PUT','/api/brand/landing/by-project/1',{name:'Synthetic existing brand policy'})).status,200);
  for(const role of ['ADMIN','ADVISOR']){
   const actor={id:1,role,founder_id:20,spinout_lab_active:1} as any;
   assert.equal(canWrite({id:1,founder_id:20},actor),true);
   assert.equal(canWritePitchDeck({id:1,founder_id:20},actor),false);
  }
 }finally{f.db.close()}
});

test('#2447: landing-by-project records accepted and edited fills against the row actually saved', async () => {
 const f=await fixture();
 const result=await request(f,2,'PUT','/api/brand/landing/by-project/1',{
  name:'Synthetic filled brand',tagline:'Founder edited tagline',headline:'Synthetic proposed headline',
  ai_proposals:{tagline:'Synthetic proposed tagline',headline:'Synthetic proposed headline',not_a_column:'Synthetic ignored value'},ai_model:'synthetic-test-model',
 });
 assert.equal(result.status,200,JSON.stringify(result.body));
 assert.ok(f.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='fill_provenance'").get(),'a landing save must record fill provenance');
 const fills=f.db.prepare("SELECT target_table,target_row_id,target_column,proposed_value,written_value,edited,decided_by FROM fill_provenance WHERE target_table='landing_pages' ORDER BY target_column").all() as any[];
 assert.deepEqual(fills.map(r=>[r.target_column,r.proposed_value,r.written_value,r.edited]),[
  ['headline','Synthetic proposed headline','Synthetic proposed headline',0],['tagline','Synthetic proposed tagline','Founder edited tagline',1],
 ]);
 assert.ok(fills.every(r=>r.target_row_id===result.body.id && r.decided_by===2));
 const before=fills.length;
 assert.equal((await request(f,2,'PUT','/api/brand/landing/by-project/1',{name:'Typed brand',tagline:'Typed tagline'})).status,200);
 assert.equal(f.db.prepare("SELECT count(*) n FROM fill_provenance WHERE target_table='landing_pages'").get()!.n,before);
});
