/** D1135: real routes and SQLite, synthetic people and stubbed outbound mail. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import company from '../src/routes/company.ts';
import projects from '../src/routes/projects.ts';

const SECRET = 'synthetic-d1135-secret'.repeat(3);
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
function fixture() {
  const { DB, db } = makeD1('');
  for (const name of ['users', 'founders', 'company_profiles', 'user_company_links', 'projects', 'deals', 'activity_logs', 'project_member_invitations']) db.exec(stripForeignKeys(tableFromBaseline(baseline, name)));
  db.exec(tableFromBaseline(readFileSync(new URL('../sql/migrations/515_newsletter_lists.sql', import.meta.url), 'utf8'), 'email_suppressions'));
  // D1137 (#3017): a rename writes its membership event in the same batch (migration 597).
  db.exec(readFileSync(new URL('../sql/migrations/597_company_archive_and_events.sql', import.meta.url), 'utf8'));
  // D1415: project create writes a slug, and company create a slug and the legal fields (migration 685).
  db.exec(stripForeignKeys(tableFromBaseline(baseline, 'incorporations')));
  db.exec(readFileSync(new URL('../sql/migrations/685_company_legal_record_and_slugs.sql', import.meta.url), 'utf8'));
  for (const [id, role, fid] of [[1, 'founder', 10], [2, 'founder', 20], [3, 'exploring', null], [4, 'admin', null]] as const) {
    db.prepare('INSERT INTO users(id,email,name,role,founder_id) VALUES(?,?,?,?,?)').run(id, `synthetic${id}@example.test`, `Synthetic ${id}`, role, fid);
  }
  db.exec(`INSERT INTO founders(id,name,email) VALUES(10,'Synthetic founder','synthetic1@example.test'),(20,'Other founder','synthetic2@example.test');
    INSERT INTO company_profiles(id,uid,company_name) VALUES(1,'co-one','One'),(2,'co-two','Two'),(3,'co-other','Other');
    INSERT INTO user_company_links(uid,company_id,user_id,role_in_company,is_primary_admin) VALUES('a',1,1,'Admin',1),('b',1,2,'Member',0),('c',2,1,'Admin',1),('d',3,2,'Admin',1);
    INSERT INTO projects(id,name,founder_id) VALUES(1,'Synthetic venture',10),(2,'Other venture',20);`);
  const env: any = { DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development', PUBLIC_BASE_URL: 'https://synthetic-branch.example.test/', GMAIL_CLIENT_ID: 'synthetic', GMAIL_CLIENT_SECRET: 'synthetic', GMAIL_REFRESH_TOKEN: 'synthetic' };
  const app = new Hono().route('/api', company).route('/api/projects', projects);
  app.onError((e) => e instanceof Response ? e : new Response('Unhandled fixture error', { status: 500 }));
  return { db, env, app };
}
async function call(f: ReturnType<typeof fixture>, who: number | null, method: string, path: string, body?: any) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (who) headers.Authorization = 'Bearer ' + await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const response = await f.app.request('/api' + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, f.env).catch((e) => { if (e instanceof Response) return e; throw e; });
  return { status: response.status, body: await response.json().catch(() => ({})) as any };
}

test('Member leaves only their own company; last primary admin stays until another exists', async () => {
  const f = fixture();
  assert.equal((await call(f, 2, 'POST', '/company/co-one/leave')).status, 200);
  assert.equal(f.db.prepare('SELECT count(*) n FROM user_company_links WHERE company_id=1 AND user_id=2').get().n, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM user_company_links WHERE company_id=3 AND user_id=2').get().n, 1);
  assert.equal((await call(f, 2, 'POST', '/company/co-one/leave')).status, 404);
  const blocked = await call(f, 1, 'POST', '/company/co-one/leave');
  assert.equal(blocked.status, 409); assert.equal(blocked.body.code, 'last_primary_admin');
  assert.equal(f.db.prepare('SELECT count(*) n FROM user_company_links WHERE company_id=1').get().n, 1);
  f.db.exec("INSERT INTO user_company_links(uid,company_id,user_id,is_primary_admin) VALUES('replacement',1,2,1)");
  assert.equal((await call(f, 1, 'POST', '/company/co-one/leave')).status, 200);
  assert.equal(f.db.prepare('SELECT user_id FROM user_company_links WHERE company_id=1').get().user_id, 2);
  assert.equal((await call(f, null, 'POST', '/company/co-two/leave')).status, 401);
});

test('create and rename validate trimmed bounded names and caller-local clashes; Explorer cannot create', async () => {
  const f = fixture();
  for (const name of ['', '   ', 'x'.repeat(201)]) {
    assert.equal((await call(f, 1, 'POST', '/company/create', { company_name: name })).status, 400);
    assert.equal((await call(f, 1, 'PATCH', '/company/co-one', { company_name: name })).status, 400);
    assert.equal(f.db.prepare('SELECT company_name FROM company_profiles WHERE id=1').get().company_name, 'One');
  }
  assert.equal((await call(f, 1, 'PATCH', '/company/co-one', { company_name: ' two ' })).status, 409);
  assert.equal((await call(f, 1, 'PATCH', '/company/co-one', { company_name: ' One ' })).status, 200);
  assert.equal((await call(f, 1, 'PATCH', '/company/co-one', { company_name: ' Other ' })).status, 200);
  assert.equal(f.db.prepare('SELECT company_name FROM company_profiles WHERE id=1').get().company_name, 'Other');
  assert.equal((await call(f, 2, 'PATCH', '/company/co-one', { company_name: 'Unauthorized' })).status, 403);
  const refused = await call(f, 3, 'POST', '/company/create', { company_name: 'Explorer company' });
  assert.equal(refused.status, 403); assert.equal(refused.body.code, 'explorer_company_create_refused');
  assert.equal(f.db.prepare('SELECT count(*) n FROM company_profiles').get().n, 3);
  assert.equal((await call(f, 1, 'POST', '/company/create', { company_name: '  New  ' })).status, 200);
  assert.equal(f.db.prepare("SELECT company_name FROM company_profiles WHERE company_name='New'").get().company_name, 'New');
});

test('trash frees the free cap, restore needs ownership, retention and plan space', async () => {
  const f = fixture();
  assert.equal((await call(f, 1, 'POST', '/projects', { name: 'Blocked' })).status, 402);
  assert.equal((await call(f, 1, 'DELETE', '/projects/1')).status, 200);
  assert.equal((await call(f, 2, 'POST', '/projects/1/restore')).status, 404);
  assert.equal((await call(f, 4, 'POST', '/projects/1/restore')).status, 404);
  assert.equal((await call(f, 1, 'POST', '/projects/1/restore')).status, 200);
  assert.equal(f.db.prepare('SELECT deleted_at FROM projects WHERE id=1').get().deleted_at, null);
  assert.equal((await call(f, 1, 'DELETE', '/projects/1')).status, 200);
  const created = await call(f, 1, 'POST', '/projects', { name: 'Replacement' });
  assert.equal(created.status, 201);
  assert.equal((await call(f, 1, 'POST', '/projects/1/restore')).status, 409);
  assert.notEqual(f.db.prepare('SELECT deleted_at FROM projects WHERE id=1').get().deleted_at, null);
  assert.equal((await call(f, 1, 'DELETE', '/projects/' + created.body.id)).status, 200);
  f.db.exec("UPDATE projects SET deleted_at=datetime('now','-31 days') WHERE id=1");
  assert.equal((await call(f, 1, 'POST', '/projects/1/restore')).status, 409);
  f.db.exec("UPDATE projects SET deleted_at=datetime('now','-29 days') WHERE id=1");
  assert.equal((await call(f, 1, 'POST', '/projects/1/restore')).status, 200);
  assert.equal((await call(f, 1, 'POST', '/projects/1/restore')).body.already_restored, true);
});

test('email invitation sends one matching accept link, link mode sends none, failed delivery is reported', async () => {
  const f = fixture(); const prior = globalThis.fetch; const sent: any[] = []; let works = true;
  globalThis.fetch = async (input, init) => {
    if (String(input) === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'synthetic' });
    assert.equal(String(input), 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    sent.push(JSON.parse(String(init?.body))); return new Response('{}', { status: works ? 200 : 503 });
  };
  try {
    const email = await call(f, 1, 'POST', '/projects/1/invitations', { mode: 'email', email: 'invitee@example.test' });
    assert.equal(email.status, 200); assert.equal(email.body.email_sent, true); assert.equal(sent.length, 1);
    const mime = Buffer.from(sent[0].raw, 'base64url').toString();
    assert.match(mime, /To: invitee@example.test/);
    const text = Buffer.from(mime.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0].replace(/\s/g, ''), 'base64').toString();
    assert.ok(text.includes('https://synthetic-branch.example.test' + email.body.accept_path));
    assert.equal((await call(f, 1, 'POST', '/projects/1/invitations', { mode: 'link' })).body.email_sent, null);
    assert.equal(sent.length, 1);
    assert.equal((await call(f, 1, 'POST', '/projects/1/invitations', { mode: 'email', email: 'invitee@example.test' })).status, 409);
    assert.equal(sent.length, 1);
    f.db.exec("INSERT INTO email_suppressions(email,reason) VALUES('suppressed@example.test','bounce')");
    assert.equal((await call(f, 1, 'POST', '/projects/1/invitations', { mode: 'email', email: 'suppressed@example.test' })).body.email_sent, false);
    assert.equal(sent.length, 1);
    assert.doesNotMatch(text, /Synthetic venture|Synthetic 1/);
    works = false;
    assert.equal((await call(f, 1, 'POST', '/projects/1/invitations', { mode: 'email', email: 'second@example.test' })).body.email_sent, false);
    assert.equal(sent.length, 2);
    assert.equal((await call(f, 2, 'POST', '/projects/1/invitations', { mode: 'email', email: 'third@example.test' })).status, 403);
    assert.equal(sent.length, 2);
  } finally { globalThis.fetch = prior; }
});

test('email invitations cap each inviter across projects and each project across inviters, reserving before delivery', async () => {
  const f = fixture(); const prior = globalThis.fetch; let sends = 0;
  globalThis.fetch = async (input) => {
    if (String(input) === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'synthetic' });
    sends += 1; return new Response('{}');
  };
  try {
    const insert = f.db.prepare("INSERT INTO project_member_invitations(project_id,invited_by_user_id,source,status,expires_at) VALUES(?,?,'email','pending',datetime('now','+14 days'))");
    for (let i = 0; i < 9; i += 1) insert.run(2, 1);
    assert.equal((await call(f, 1, 'POST', '/projects/1/invitations', { mode: 'email', email: 'tenth@example.test' })).body.email_sent, true);
    assert.equal(sends, 1);
    assert.equal((await call(f, 1, 'POST', '/projects/1/invitations', { mode: 'email', email: 'eleventh@example.test' })).status, 429);
    assert.equal(sends, 1);
    f.db.exec("UPDATE project_member_invitations SET created_at=datetime('now','-2 hours')");
    assert.equal((await call(f, 1, 'POST', '/projects/1/invitations', { mode: 'email', email: 'after-window@example.test' })).body.email_sent, true);
    for (let i = 0; i < 19; i += 1) insert.run(1, 2);
    assert.equal((await call(f, 4, 'POST', '/projects/1/invitations', { mode: 'email', email: 'project-cap@example.test' })).status, 429);
    assert.equal(sends, 2);
  } finally { globalThis.fetch = prior; }
});
