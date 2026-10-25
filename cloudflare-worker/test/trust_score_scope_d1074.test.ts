/**
 * D1074 (#2966, part 2 of #2425) — who reads another member's requirement
 * status, the pairwise NDAs a member is shown, and the version of an accepted
 * document. Real SQLite over the baseline's own tables; every name and
 * address is invented.
 *
 *  1. The score: self; an admin of this territory (this deployment's database),
 *     never another territory's; a counterparty in an open intro, either way
 *     round; a counterparty in an open deal (invited, committed, or its lead
 *     partner), either way round. A stranger is 403 whatever their role, and so
 *     are a revoked or expired intro, a funded, rejected or passed deal and a
 *     withdrawn commitment.
 *  2. The batch: the same rule for every id, all or nothing; a member with no
 *     obligation rows reads `not_recorded` with a null score, never 100.
 *  3. Pairwise NDAs: every caller, an admin included, lists only the pairs they
 *     are party to, and a signer who is neither party is named without an address.
 *  4. Acceptances: each row stores the page's version; `/me` returns
 *     `accepted_at`, `surface`, `document_version` and `newer_document`, and a
 *     row from before migration 583 reads its version as not recorded.
 *  5. The versions are the pages' own "Last updated" dates.
 *  6. The obligations matrix names the Explorer.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/trust_score_scope_d1074.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import trust from '../src/routes/trust.ts';
import { mayReadTrustScores } from '../src/services/scoreAccess.ts';
import { LEGAL_DOCUMENT_VERSIONS, latestAcceptances, obligationsForRole, recordTermsAcceptance } from '../src/services/trust.ts';

const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const migration = (f: string) => readFileSync(new URL(`../sql/migrations/${f}`, import.meta.url), 'utf8')
  .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const secret = 'synthetic-test-only-'.repeat(3);

const ADMIN = 1, LEAD_PARTNER = 2, INVITED = 3, FOUNDER_A = 4, FOUNDER_B = 5, STRANGER = 6,
  INTRO_PENDING = 8, INTRO_REVOKED = 9, OTHER_PARTNER = 11, COMMITTED = 12, WITHDRAWN = 13, INTRO_EXPIRED = 14, MEMBER_A = 15;

function fixture(opts: { users?: Array<[number, string, number | null]>; branch?: string } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const name of ['users', 'projects', 'deals', 'deal_invitations', 'commitments', 'user_company_links',
    'pairwise_ndas', 'esign_envelopes', 'esign_recipients', 'legal_obligations', 'activity_logs']) {
    db.exec(tableFromBaseline(baseline, name));
  }
  for (const f of ['245_legal_acceptances.sql', '583_legal_acceptance_version.sql']) {
    for (const stmt of migration(f).split(';')) if (stmt.trim()) db.exec(`${stmt.trim()};`);
  }
  const users = opts.users ?? [
    [ADMIN, 'admin', null], [LEAD_PARTNER, 'partner', null], [INVITED, 'investor', null], [FOUNDER_A, 'founder', 40],
    [FOUNDER_B, 'founder', 50], [STRANGER, 'investor', null], [INTRO_PENDING, 'investor', null], [INTRO_REVOKED, 'investor', null],
    [OTHER_PARTNER, 'partner', null], [COMMITTED, 'investor', null], [WITHDRAWN, 'investor', null], [INTRO_EXPIRED, 'investor', null],
    [MEMBER_A, 'advisor', null],
  ];
  for (const [id, role, founder] of users) {
    db.prepare('INSERT INTO users(id,email,name,role,founder_id) VALUES(?,?,?,?,?)')
      .run(id, `person${id}@example.invalid`, `Person ${id}`, role, founder);
  }
  if (!opts.users) {
    db.exec(`
      INSERT INTO projects(id,name,founder_id,company_id) VALUES(10,'Synthetic A',40,100),(20,'Synthetic B',50,200);
      INSERT INTO deals(id,project_id,status,lead_partner_id) VALUES(100,10,'active',${LEAD_PARTNER}),(200,20,'scored',NULL);
      INSERT INTO deal_invitations(deal_id,investor_user_id) VALUES(100,${INVITED});
      INSERT INTO commitments(deal_id,investor_user_id,amount,status) VALUES(100,${COMMITTED},1,'confirmed'),(100,${WITHDRAWN},1,'withdrawn');
      INSERT INTO user_company_links(uid,company_id,user_id) VALUES('synthetic-member',100,${MEMBER_A});
      INSERT INTO pairwise_ndas(party_a_user_id,party_b_user_id,nda_envelope_uuid,status) VALUES(${FOUNDER_B},${INTRO_PENDING},'env-8','pending');
      INSERT INTO pairwise_ndas(party_a_user_id,party_b_user_id,nda_envelope_uuid,status) VALUES(${FOUNDER_B},${INTRO_REVOKED},'env-9','revoked');
      INSERT INTO pairwise_ndas(party_a_user_id,party_b_user_id,status,valid_until) VALUES(${FOUNDER_B},${INTRO_EXPIRED},'active','2020-01-01T00:00:00Z');
      INSERT INTO esign_envelopes(id,envelope_uuid,status,document_type,document_title,document_body,body_sha256,created_by) VALUES
        (1,'env-8','sent','nda','Synthetic NDA','Synthetic body','0',${ADMIN}),(2,'env-9','voided','nda','Synthetic NDA','Synthetic body','0',${ADMIN});
      INSERT INTO esign_recipients(envelope_id,recipient_email,recipient_name,status,signing_token,token_expires_at) VALUES
        (1,'person5@example.invalid','Person 5','pending','t-1','2099-01-01'),(1,'person8@example.invalid','Person 8','signed','t-2','2099-01-01'),
        (1,'countersigner@axal.example','Axal VC','pending','t-3','2099-01-01'),(2,'person9@example.invalid','Person 9','pending','t-4','2099-01-01');
    `);
  }
  const env: any = { DB: d1Over(db), JWT_SECRET: secret, ENVIRONMENT: 'development', ...(opts.branch ? { BRANCH_CODE: opts.branch } : {}) };
  return { db, env };
}

async function request(env: any, id: number, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: id }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  const res = await trust.request(path, { method: body ? 'POST' : 'GET', headers: {
    Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
  }, ...(body ? { body: JSON.stringify(body) } : {}) }, env);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text };
}
const score = (env: any, who: number, target: number) => request(env, who, `/score/${target}`);

test('1. the score: self, this territory\'s admin, and open counterparties; nobody else', async () => {
  const { db, env } = fixture();
  try {
    const reads: Array<[number, number, number, string]> = [
      [FOUNDER_A, FOUNDER_A, 200, 'self'],
      [ADMIN, FOUNDER_A, 200, 'an admin of this territory'],
      [INVITED, FOUNDER_A, 200, 'an investor invited to the open deal'],
      [FOUNDER_A, INVITED, 200, 'the founder reads the invited investor'],
      [COMMITTED, FOUNDER_A, 200, 'a committed investor'],
      [LEAD_PARTNER, FOUNDER_A, 200, 'the deal\'s lead partner'],
      [FOUNDER_A, LEAD_PARTNER, 200, 'the founder reads the lead partner'],
      [MEMBER_A, INVITED, 200, 'a venture member, through the company link'],
      [INTRO_PENDING, FOUNDER_B, 200, 'an investor in an open intro'],
      [FOUNDER_B, INTRO_PENDING, 200, 'the founder in that intro'],
      [STRANGER, FOUNDER_A, 403, 'an investor with no intro or deal'],
      [OTHER_PARTNER, FOUNDER_A, 403, 'a partner not on the deal'],
      [OTHER_PARTNER, FOUNDER_B, 403, 'a partner, a deal with no lead partner'],
      [WITHDRAWN, FOUNDER_A, 403, 'a withdrawn commitment'],
      [INTRO_REVOKED, FOUNDER_B, 403, 'a revoked intro'],
      [INTRO_EXPIRED, FOUNDER_B, 403, 'an intro past valid_until'],
      [FOUNDER_A, FOUNDER_B, 403, 'another founder'],
      [INVITED, FOUNDER_B, 403, 'an investor invited to another deal'],
    ];
    for (const [who, target, status, why] of reads) assert.equal((await score(env, who, target)).status, status, why);
    // A counterparty reads the score, never the missing items; self and the admin read both.
    const counterparty = (await score(env, INVITED, FOUNDER_A)).body;
    assert.deepEqual(Object.keys(counterparty).sort(), ['score', 'status', 'user_id']);
    for (const who of [FOUNDER_A, ADMIN]) assert.ok(Array.isArray((await score(env, who, FOUNDER_A)).body.missing), String(who));
    // A deal that closed or was passed is no longer open.
    for (const close of ["UPDATE deals SET status = 'funded' WHERE id = 100", "UPDATE deals SET status = 'rejected' WHERE id = 100", "UPDATE deals SET passed_at = '2026-10-01' WHERE id = 100"]) {
      db.exec(close);
      assert.equal((await score(env, INVITED, FOUNDER_A)).status, 403, close);
      assert.equal((await score(env, LEAD_PARTNER, FOUNDER_A)).status, 403, close);
      db.exec("UPDATE deals SET status = 'active', passed_at = NULL WHERE id = 100");
    }
    // A user id that is not in this territory's database, even for an admin.
    assert.equal((await score(env, ADMIN, 999)).status, 403);
    // Another territory: a branch's own database, whose admin has never had these members.
    const branch = fixture({ users: [[ADMIN, 'admin', null], [70, 'founder', 700]], branch: 'ldn' });
    try {
      assert.equal((await score(branch.env, ADMIN, FOUNDER_A)).status, 403, 'another territory\'s admin');
      assert.equal((await score(branch.env, ADMIN, 70)).status, 200, 'the branch admin reads the branch\'s own member');
    } finally { branch.db.close(); }
  } finally { db.close(); }
});

test('2. the batch: the single rule for every id, all or nothing; no rows is not_recorded, never 100', async () => {
  const { db, env } = fixture();
  try {
    const batch = (who: number, ids: number[]) => request(env, who, '/score/batch', { user_ids: ids });
    assert.equal((await batch(INVITED, [FOUNDER_A])).status, 200);
    assert.equal((await batch(INVITED, [FOUNDER_A, FOUNDER_B])).status, 403, 'one unreadable id refuses the batch');
    assert.equal((await batch(STRANGER, [FOUNDER_A])).status, 403);
    assert.equal((await batch(OTHER_PARTNER, [FOUNDER_A])).status, 403, 'a partner reads no list of strangers');
    assert.equal((await batch(FOUNDER_A, [FOUNDER_A, INVITED, LEAD_PARTNER])).status, 200, 'a founder reads their own deal\'s counterparties');
    // No obligation rows (the batch does not seed): null with not_recorded, for every caller.
    const admin = await batch(ADMIN, [FOUNDER_B, STRANGER]);
    assert.equal(admin.status, 200);
    for (const row of admin.body.scores) {
      assert.equal(row.score, null);
      assert.equal(row.status, 'not_recorded');
      assert.ok(row.reason);
    }
    const counterparty = await batch(INVITED, [FOUNDER_A]);
    assert.deepEqual(counterparty.body.scores, [{ user_id: FOUNDER_A, score: null, status: 'not_recorded', reason: 'No trust obligations recorded' }]);
    // With rows, it is recorded; with every requirement met, 100.
    db.exec(`INSERT INTO legal_obligations(user_id,obligation_key,required,status) VALUES(${FOUNDER_A},'tos_v1',1,'satisfied'),(${FOUNDER_A},'privacy_v1',1,'pending')`);
    assert.deepEqual((await batch(INVITED, [FOUNDER_A])).body.scores, [{ user_id: FOUNDER_A, score: 50, status: 'recorded', reason: null }]);
    // The access check is one bounded query for the whole batch.
    let queries = 0;
    const prepare = env.DB.prepare.bind(env.DB);
    env.DB.prepare = (sql: string) => { queries++; return prepare(sql); };
    assert.equal(await mayReadTrustScores(env, { id: FOUNDER_A, role: 'founder' } as any, [INVITED, COMMITTED, LEAD_PARTNER]), true);
    assert.equal(queries, 1);
  } finally { db.close(); }
});

test('3. pairwise NDAs: only the caller\'s own pairs, for an admin too; no third party\'s address', async () => {
  const { env, db } = fixture();
  try {
    const investor = await request(env, INTRO_PENDING, '/pairwise-ndas');
    assert.equal(investor.status, 200);
    assert.deepEqual(investor.body.items.map((i: any) => [i.party_a_user_id, i.party_b_user_id]), [[FOUNDER_B, INTRO_PENDING]]);
    const row = investor.body.items[0];
    assert.equal(row.party_a_email, 'person5@example.invalid');
    assert.equal(row.party_b_email, 'person8@example.invalid');
    const axal = row.recipients.find((r: any) => r.name === 'Axal VC');
    assert.ok(axal, 'the countersigner is listed');
    assert.equal(axal.email, null, 'by name, without an address');
    assert.ok(!investor.text.includes('countersigner@axal.example'));
    assert.ok(!investor.text.includes('person9@example.invalid'), 'another pair\'s party');
    assert.ok(!investor.text.includes('person14@example.invalid'));
    // The founder sees each of their pairs; an admin who is party to none sees none.
    const founder = await request(env, FOUNDER_B, '/pairwise-ndas');
    assert.equal(founder.body.items.length, 3);
    const admin = await request(env, ADMIN, '/pairwise-ndas');
    assert.deepEqual(admin.body.items, []);
    assert.equal((await request(env, STRANGER, '/pairwise-ndas')).body.items.length, 0);
  } finally { db.close(); }
});

test('4. an acceptance stores its version; /me says when, where, which, and whether a newer one exists', async () => {
  const { db, env } = fixture();
  try {
    await recordTermsAcceptance(env, FOUNDER_A, { surface: 'onboarding_licence' });
    const stored = db.prepare('SELECT obligation_key, document_version FROM legal_acceptances WHERE user_id = ? ORDER BY obligation_key').all(FOUNDER_A);
    assert.deepEqual(stored.map((r: any) => [r.obligation_key, r.document_version]), [['privacy_v1', LEGAL_DOCUMENT_VERSIONS.privacy_v1], ['tos_v1', LEGAL_DOCUMENT_VERSIONS.tos_v1]]);
    const me = await request(env, FOUNDER_A, '/me');
    assert.equal(me.status, 200, me.text);
    const tos = me.body.acceptances.find((a: any) => a.obligation_key === 'tos_v1');
    assert.equal(tos.surface, 'onboarding_licence');
    assert.ok(tos.accepted_at);
    assert.equal(tos.document_version, LEGAL_DOCUMENT_VERSIONS.tos_v1);
    assert.equal(tos.current_version, LEGAL_DOCUMENT_VERSIONS.tos_v1);
    assert.equal(tos.newer_document, false);
    assert.equal(tos.reason, null);
    // An older version than the page: a newer document exists. The latest act is the one read.
    db.prepare("INSERT INTO legal_acceptances(user_id,obligation_key,accepted_at,surface,document_version) VALUES(?,?,?,?,?)").run(INVITED, 'tos_v1', '2026-01-02T00:00:00Z', 'signup', '2026-01-01');
    db.prepare("INSERT INTO legal_acceptances(user_id,obligation_key,accepted_at,surface,document_version) VALUES(?,?,?,?,?)").run(INVITED, 'tos_v1', '2025-01-02T00:00:00Z', 'signup', LEGAL_DOCUMENT_VERSIONS.tos_v1);
    // A row from before migration 583: its version is not recorded, never guessed.
    db.prepare("INSERT INTO legal_acceptances(user_id,obligation_key,accepted_at,surface) VALUES(?,?,?,?)").run(INVITED, 'privacy_v1', '2026-01-02T00:00:00Z', 'signup');
    const invited = await latestAcceptances(env, INVITED);
    const by = Object.fromEntries(invited!.map((a) => [a.obligation_key, a]));
    assert.equal(by.tos_v1.document_version, '2026-01-01');
    assert.equal(by.tos_v1.newer_document, true);
    assert.equal(by.privacy_v1.document_version, null);
    assert.equal(by.privacy_v1.newer_document, null);
    assert.equal(by.privacy_v1.reason, 'Accepted before the version was recorded');
    // Nothing accepted: no date, no version, and a reason.
    const none = await latestAcceptances(env, STRANGER);
    assert.ok(none!.every((a) => a.accepted_at === null && a.newer_document === null && a.reason === 'Not accepted yet'));
    // Unreadable is null, never "nothing accepted".
    db.exec('DROP TABLE legal_acceptances');
    assert.equal(await latestAcceptances(env, FOUNDER_A), null);
  } finally { db.close(); }
});

test('5. the versions are the pages\' own "Last updated" dates', () => {
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const pageDate = (file: string, name: string) => {
    const src = readFileSync(new URL(`../../frontend/src/pages/${file}`, import.meta.url), 'utf8');
    const m = new RegExp(`export const ${name} = '([A-Z][a-z]+) (\\d{1,2}), (\\d{4})';`).exec(src);
    assert.ok(m, `${file} names ${name}`);
    const month = MONTHS.indexOf(m![1]) + 1;
    assert.ok(month > 0, m![1]);
    return `${m![3]}-${String(month).padStart(2, '0')}-${m![2].padStart(2, '0')}`;
  };
  assert.equal(LEGAL_DOCUMENT_VERSIONS.tos_v1, pageDate('TermsPage.jsx', 'TERMS_UPDATED'));
  assert.equal(LEGAL_DOCUMENT_VERSIONS.privacy_v1, pageDate('PrivacyPage.jsx', 'PRIVACY_UPDATED'));
  assert.ok(Object.isFrozen(LEGAL_DOCUMENT_VERSIONS));
});

test('6. the obligations matrix names the Explorer', () => {
  assert.deepEqual(obligationsForRole('exploring').map((o) => [o.key, o.required]), [['tos_v1', 1], ['privacy_v1', 1]]);
  const src = readFileSync(new URL('../src/services/trust.ts', import.meta.url), 'utf8');
  const matrix = src.slice(src.indexOf('const ROLE_MATRIX'), src.indexOf('export function obligationsForRole'));
  assert.match(matrix, /\n  exploring: \[/, 'its own row, not the partner fallback');
});
