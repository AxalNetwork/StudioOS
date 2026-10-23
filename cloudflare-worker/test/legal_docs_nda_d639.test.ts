/**
 * D639 (#1396) — one access rule for every document handler, and co-founder
 * NDAs that record uids, on the real routers and node:sqlite.
 *
 *   1. `GET /legal/documents` and `GET /legal/documents/:id` decide through
 *      `canAccessFounderResource`: for an admin, a partner, an investor, the
 *      project's founder and the founder of another project, the list holds
 *      exactly the documents the single read opens. (The generate route this
 *      also covered was deleted by D758: it never wrote a document.)
 *   2. A new co-founder NDA holds no email in its title or `signed_by`.
 *   3. Only the connection's two members can sign; an admin is refused too.
 *   4. `renderNda` uses a neutral label for an empty or defaulted name.
 *   5. Migration 428 rewrites NDAs written with an email.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/legal_docs_nda_d639.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import legal from '../src/routes/legal.ts';
import cofounder, { renderNda, ndaName, ndaTitle, NDA_NEUTRAL } from '../src/routes/cofounder.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIG428 = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/428_cofounder_nda_uids.sql'), 'utf8');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

// Users. 10 and 11 are founders of projects 1 and 2; 12 has a name defaulted
// from their email; 9 is an admin, 20 a partner, 30 an investor.
const ADMIN = 9, PARTNER = 20, INVESTOR = 30, OWNER = 10, OTHER = 11, DEFAULTED = 12;
const USERS: Array<[number, string, string, string, number | null]> = [
  [ADMIN, 'admin', 'Ada Admin', 'ada@example.test', null],
  [PARTNER, 'partner', 'Pat Partner', 'pat@example.test', null],
  [INVESTOR, 'investor', 'Ivy Investor', 'ivy@example.test', null],
  [OWNER, 'founder', 'Olu Owner', 'olu@example.test', 100],
  [OTHER, 'founder', 'Ola Other', 'ola@example.test', 200],
  [DEFAULTED, 'founder', 'ben', 'ben@example.test', 300],
];
const ROLE = Object.fromEntries(USERS.map(([id, role]) => [id, role])) as Record<number, string>;

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'documents', 'cofounder_profiles', 'cofounder_connections', 'cofounder_interests', 'activity_logs']) db.exec(ddl(t));
  db.exec('CREATE UNIQUE INDEX idx_ci_pair ON cofounder_interests(from_user_id, to_user_id)');
  const u = db.prepare('INSERT INTO users (id, uid, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, ?, 1, ?)');
  for (const [id, role, name, email, fid] of USERS) u.run(id, `uid-${id}`, role, name, email, fid);
  db.prepare(`INSERT INTO projects (id, name, founder_id) VALUES (1, 'Owned', 100), (2, 'Elsewhere', 200)`).run();
  const d = db.prepare(`INSERT INTO documents (id, project_id, title, doc_type, status, content) VALUES (?, ?, ?, 'other', 'generated', 'x')`);
  d.run(1, 1, 'On project 1');
  d.run(2, 2, 'On project 2');
  d.run(3, null, 'Unattached');
  return db;
}

const app = (() => {
  const a = new Hono();
  a.route('/api/legal', legal as any);
  a.route('/api/cofounder', cofounder as any);
  a.onError((err: any, c) => {
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    return st ? c.json({ detail: err.message }, st) : c.json({ detail: String(err?.message || 'Internal server error') }, 500);
  });
  return a;
})();

async function call(db: DatabaseSync, who: number, path: string, init: { method?: string; body?: any } = {}) {
  const tok = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.fetch(new Request(`http://x/api${path}`, {
      method: init.method || 'GET',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}

// ── 1. one access rule for the three document handlers ─────────────────────

// What each role may open, by the rule: admin every document; a
// founder their own project's; an investor none; nobody but staff an
// unattached one.
const EXPECTED: Record<number, number[]> = {
  [ADMIN]: [1, 2, 3], [PARTNER]: [], [INVESTOR]: [], [OWNER]: [1], [OTHER]: [2],
};

test('D639: for every role, the list holds exactly the documents the single read opens', async () => {
  const db = freshDb();
  for (const who of [ADMIN, PARTNER, INVESTOR, OWNER, OTHER]) {
    const list = await call(db, who, '/legal/documents');
    assert.equal(list.status, 200, `${ROLE[who]} ${who}`);
    const listed = list.body.map((d: any) => d.id).sort();
    const opens: number[] = [];
    for (const id of [1, 2, 3]) {
      const one = await call(db, who, `/legal/documents/${id}`);
      if (one.status === 200) opens.push(id);
      else assert.equal(one.status, 403, `${ROLE[who]} reading ${id}`);
    }
    assert.deepEqual(listed, opens, `${ROLE[who]} ${who}: the list and the read disagree`);
    assert.deepEqual(listed, EXPECTED[who], `${ROLE[who]} ${who}`);
    for (const d of list.body) {
      assert.equal('content' in d, false, 'the list stays redacted');
      assert.equal('project_founder_id' in d, false, 'the owner column used for the rule is not returned');
    }
  }
});

test('D639: the project filter narrows the same way, and never widens a founder or an investor', async () => {
  const db = freshDb();
  const ids = async (who: number, pid: number) => (await call(db, who, `/legal/documents?project_id=${pid}`)).body.map((d: any) => d.id);
  assert.deepEqual(await ids(ADMIN, 2), [2]);
  assert.deepEqual(await ids(PARTNER, 1), []);
  assert.deepEqual(await ids(OWNER, 1), [1]);
  assert.deepEqual(await ids(OWNER, 2), [], 'another founder’s project lists nothing');
  assert.deepEqual(await ids(INVESTOR, 1), [], 'an investor lists nothing, filtered or not');
});

// ── 2–4. co-founder NDAs ───────────────────────────────────────────────────

function withProfiles(db: DatabaseSync) {
  const p = db.prepare('INSERT INTO cofounder_profiles (user_id, listed) VALUES (?, 1)');
  p.run(OWNER); p.run(OTHER); p.run(DEFAULTED);
}
async function connect(db: DatabaseSync, x: number, y: number): Promise<string> {
  await call(db, x, '/cofounder/interest', { method: 'POST', body: { user_uid: `uid-${y}` } });
  const r = await call(db, y, '/cofounder/interest', { method: 'POST', body: { user_uid: `uid-${x}` } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.connection_uid, 'mutual interest opens a connection');
  return r.body.connection_uid;
}
const ndas = (db: DatabaseSync) => db.prepare(`SELECT id, title, signed_by, content FROM documents WHERE template_name = 'nda_cofounder' ORDER BY id`).all() as any[];

test('D639: a new NDA holds no email in its title, and signing records the signer by uid', async () => {
  const db = freshDb();
  withProfiles(db);
  const conn = await connect(db, OWNER, OTHER);
  const docs = ndas(db);
  assert.equal(docs.length, 2);
  assert.deepEqual(docs.map((d) => d.title).sort(), [ndaTitle({ uid: `uid-${OWNER}` }), ndaTitle({ uid: `uid-${OTHER}` })].sort());
  for (const d of docs) assert.doesNotMatch(d.title, /@/);

  const s = await call(db, OWNER, `/cofounder/connections/${conn}/nda/sign`, { method: 'POST', body: { accepted: true, signer_name: 'Olu Owner' } });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const signed = ndas(db).filter((d) => d.signed_by);
  assert.deepEqual(signed.map((d) => d.signed_by), [`uid-${OWNER}`]);
  for (const d of ndas(db)) assert.equal(String(d.signed_by ?? '').includes('@'), false);
});

test('D639: only the connection’s two members can sign; an admin and another founder are refused and nothing is written', async () => {
  const db = freshDb();
  withProfiles(db);
  const conn = await connect(db, OWNER, OTHER);
  const before = JSON.stringify(db.prepare('SELECT * FROM cofounder_connections').all());
  const admin = await call(db, ADMIN, `/cofounder/connections/${conn}/nda/sign`, { method: 'POST', body: { accepted: true, signer_name: 'Ada Admin' } });
  assert.equal(admin.status, 403);
  assert.equal(admin.body.code ?? admin.body.error, 'not_a_party');
  assert.match(JSON.stringify(admin.body), /Only the two people in this connection can sign its NDA\. Nothing was signed\./);
  const stranger = await call(db, DEFAULTED, `/cofounder/connections/${conn}/nda/sign`, { method: 'POST', body: { accepted: true, signer_name: 'Ben' } });
  assert.equal(stranger.status, 403);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM cofounder_connections').all()), before, 'no signature was recorded');
  assert.equal(ndas(db).filter((d) => d.signed_by).length, 0);
  // An admin still reads it: reading is not signing.
  assert.equal((await call(db, ADMIN, `/cofounder/connections/${conn}`)).status, 200);
});

test('D639: an empty or email-defaulted name reads as a neutral label, never as the email', async () => {
  assert.equal(ndaName({ name: 'Olu Owner', email: 'olu@example.test' }), 'Olu Owner');
  assert.equal(ndaName({ name: '', email: 'olu@example.test' }), null);
  assert.equal(ndaName({ name: '   ', email: 'olu@example.test' }), null);
  assert.equal(ndaName({ name: 'olu@example.test', email: 'olu@example.test' }), null);
  assert.equal(ndaName({ name: 'Ben', email: 'ben@example.test' }), null, 'the part before the @, in any case');
  assert.equal(ndaName({ name: 'Benjamin', email: 'ben@example.test' }), 'Benjamin');

  const signer = { id: 1, uid: 'u1', name: 'Olu Owner', email: 'olu@example.test', is_active: 1 };
  const defaulted = { id: 2, uid: 'u2', name: 'ben', email: 'ben@example.test', is_active: 1 };
  const body = renderNda(signer, defaulted);
  assert.match(body, /between Olu Owner \("Recipient"\) and your co-founder\s*\("Discloser"\)/);
  assert.equal(body.includes('ben@example.test'), false, 'the counterparty’s email is not in the NDA');
  const own = renderNda({ ...signer, name: '' }, { ...defaulted, name: 'Ben Jones' });
  assert.match(own, new RegExp(`between ${NDA_NEUTRAL.signer} \\("Recipient"\\) and Ben Jones`));

  // Through the route: Olu's NDA with the email-named member names "your co-founder".
  const db = freshDb();
  withProfiles(db);
  await connect(db, OWNER, DEFAULTED);
  const olus = ndas(db).find((d) => d.title === ndaTitle({ uid: `uid-${OWNER}` }));
  assert.match(olus.content, /and your co-founder/);
  assert.equal(olus.content.includes('ben@example.test'), false);
});

// ── 5. migration 428 ───────────────────────────────────────────────────────

test('D639: migration 428 rewrites NDAs written with an email, and leaves everything else alone', () => {
  const db = freshDb();
  const T = 'Co-founder Mutual Non-Disclosure Agreement';
  const d = db.prepare(`INSERT INTO documents (id, title, doc_type, status, content, template_name, signed_by) VALUES (?, ?, 'other', ?, 'x', ?, ?)`);
  d.run(10, `${T} — olu@example.test`, 'signed', 'nda_cofounder', 'olu@example.test');
  d.run(11, `${T} — ola@example.test`, 'generated', 'nda_cofounder', null);
  d.run(12, `${T} — gone@example.test`, 'signed', 'nda_cofounder', 'gone@example.test');
  d.run(13, `${T} — uid-10`, 'generated', 'nda_cofounder', null);
  d.run(14, 'Memo — someone@example.test', 'generated', 'memo', 'someone@example.test');
  // An NDA no connection points at (connections are closed, not deleted, so
  // this should not exist): there is no signer to read a uid from, so it is
  // left as written rather than blanked.
  d.run(15, `${T} — stray@example.test`, 'signed', 'nda_cofounder', 'stray@example.test');
  // c2's side B is user 77, whose account is gone; side A already holds a uid.
  db.prepare(`INSERT INTO cofounder_connections (uid, user_a_id, user_b_id, status, nda_doc_a_id, nda_doc_b_id) VALUES ('c1', ?, ?, 'pending_nda', 10, 11), ('c2', ?, 77, 'pending_nda', 13, 12)`)
    .run(OWNER, OTHER, OWNER);
  db.exec(MIG428);
  const row = (id: number) => ({ ...(db.prepare('SELECT title, signed_by FROM documents WHERE id = ?').get(id) as any) });
  assert.deepEqual(row(10), { title: `${T} — uid-${OWNER}`, signed_by: `uid-${OWNER}` });
  assert.deepEqual(row(11), { title: `${T} — uid-${OTHER}`, signed_by: null });
  assert.deepEqual(row(12), { title: `${T} — a former member`, signed_by: null }, 'a signer whose account is gone');
  assert.deepEqual(row(13), { title: `${T} — uid-10`, signed_by: null }, 'a row already on uids is untouched');
  assert.deepEqual(row(14), { title: 'Memo — someone@example.test', signed_by: 'someone@example.test' }, 'only co-founder NDAs');
  assert.deepEqual(row(15), { title: `${T} — stray@example.test`, signed_by: 'stray@example.test' }, 'an NDA with no connection is not guessed at');
  db.exec(MIG428);
  assert.deepEqual(row(10), { title: `${T} — uid-${OWNER}`, signed_by: `uid-${OWNER}` }, 're-running changes nothing');
});
