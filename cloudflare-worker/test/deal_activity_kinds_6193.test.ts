/**
 * #6193 (D6193, DL14) — every activity row carries a kind (deal, documents, diligence), and the feed gains the
 * venture's documents and diligence, each behind the rule its own read already has:
 *   · documents behind the venture's NDA (D4631), as GET /:id/documents;
 *   · diligence for the case's owner and reviewers or a platform admin, as the stage read (D1150);
 *   · other investors are still never named (D1152), and a request's own text is never shown;
 *   · a source that cannot be read adds one row saying so, never silence.
 *
 * Driven through the real router on real `node:sqlite`, with `schema_baseline.sql`. Every name is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deal_activity_kinds_6193.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import deals, { ACTIVITY_KINDS } from '../src/routes/deals.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

const ADMIN = 1, ADA = 2, BEN = 3, FOUNDER = 5, PARTNER = 6;
const ROLE: Record<number, string> = { 1: 'admin', 2: 'investor', 3: 'investor', 5: 'founder', 6: 'partner' };
const NAMES: Record<number, string> = { 1: 'Sam Staff', 2: 'Ada Angel', 3: 'Ben Backer', 5: 'Fay Founder', 6: 'Pat Partner' };

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  // #6193: the activity also reads documents and diligence, each behind its own rule.
  for (const t of ['users', 'projects', 'deals', 'deal_invitations', 'commitments', 'documents', 'pairwise_ndas', 'dd_cases', 'dd_reviewers', 'dd_requests']) db.exec(ddl(t));
  const u = db.prepare(`INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)`);
  for (const [id, role] of Object.entries(ROLE)) u.run(Number(id), role, NAMES[Number(id)], `u${id}@example.test`);
  db.exec(`UPDATE users SET founder_id = 50 WHERE id = ${FOUNDER}`);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (10, 'Harbor Ledger', 50)`);
  db.exec(`INSERT INTO deals (id, project_id, created_at) VALUES (1, 10, '2026-10-01 09:00:00')`);
  db.exec(`INSERT INTO deal_invitations (deal_id, investor_user_id, status, created_at) VALUES
    (1, ${ADA}, 'interested', '2026-10-02 09:00:00'), (1, ${BEN}, 'invited', '2026-10-03 09:00:00')`);
  db.exec(`INSERT INTO commitments (deal_id, investor_user_id, amount, status, created_at) VALUES
    (1, ${ADA}, 50000, 'pending', '2026-10-05 09:00:00'), (1, ${BEN}, 75000, 'confirmed', '2026-10-06 09:00:00')`);
  // #6193: two documents in the venture's catalogue, and Ada's NDA with the founder (Ben has none).
  db.exec(`INSERT INTO documents (project_id, title, created_at) VALUES (10, 'Data room index', '2026-10-07 09:00:00'), (10, 'Cap table', '2026-10-08 09:00:00')`);
  db.exec(`INSERT INTO pairwise_ndas (party_a_user_id, party_b_user_id, status) VALUES (${FOUNDER}, ${ADA}, 'active')`);
  // #6193: Ada's diligence case on the venture, one answered and one open request; Ben is not on it.
  db.exec(`INSERT INTO dd_cases (id, uid, subject_type, subject_id, subject_label, owner_user_id, created_at) VALUES (7, 'case-7', 'project', 10, 'Harbor Ledger', ${ADA}, '2026-10-09 09:00:00')`);
  db.exec(`INSERT INTO dd_requests (case_id, title, responded_at, created_at) VALUES (7, 'Customer contracts', '2026-10-10 09:00:00', '2026-10-09 10:00:00'), (7, 'Payroll', NULL, '2026-10-09 11:00:00')`);
  return db;
}

const app = (() => {
  const a = new Hono();
  a.route('/api/deals', deals as any);
  a.onError((err: any, c) => {
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    return st ? c.json({ detail: err.message }, st) : c.json({ detail: 'Internal server error' }, 500);
  });
  return a;
})();

async function activity(db: DatabaseSync, who: number) {
  const tok = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request('http://x/api/deals/1/activity', { headers: { Authorization: `Bearer ${tok}` } }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text), text };
}


const kinds = (rows: any[]) => rows.map((e: any) => `${e.kind}:${e.label}`);

test('#6193 every row carries one of the three kinds', async () => {
  const db = freshDb();
  try {
    assert.deepEqual([...ACTIVITY_KINDS], ['deal', 'documents', 'diligence']);
    for (const who of [ADMIN, ADA, BEN, FOUNDER, PARTNER]) {
      const r = await activity(db, who);
      assert.equal(r.status, 200, r.text);
      for (const e of r.body) assert.ok(ACTIVITY_KINDS.includes(e.kind), `${ROLE[who]}: ${JSON.stringify(e)}`);
    }
  } finally { db.close(); }
});

// Mutation checked: the NDA check dropped (Ben reads the documents, fails); the documents query unbounded is not
// observable here, the LIMIT is pinned in the source test below.
test('#6193 documents: read behind the venture’s NDA, as the documents tab', async () => {
  const db = freshDb();
  try {
    const ada = kinds((await activity(db, ADA)).body);
    assert.ok(ada.includes('documents:Document added: Cap table') && ada.includes('documents:Document added: Data room index'), ada.join(' | '));
    const ben = kinds((await activity(db, BEN)).body);
    assert.ok(!ben.some((k) => k.startsWith('documents:')), 'no NDA, no document rows');
    for (const who of [ADMIN, FOUNDER]) assert.ok(kinds((await activity(db, who)).body).includes('documents:Document added: Cap table'), ROLE[who]);
  } finally { db.close(); }
});

// Mutation checked: the owner/reviewer rule dropped (Ben reads Ada's case, fails); the admin bypass dropped (fails);
// the request title shown (fails); an unanswered request counted (fails).
test('#6193 diligence: the case owner, its reviewers and an admin read it; nobody is named and no request text shows', async () => {
  const db = freshDb();
  try {
    const ada = await activity(db, ADA);
    const mine = ada.body.filter((e: any) => e.kind === 'diligence');
    assert.deepEqual(mine.map((e: any) => [e.label, e.mine]), [['The founder answered a diligence request', false], ['You opened a diligence case', true]]);
    assert.ok(!ada.text.includes('Customer contracts') && !ada.text.includes('Payroll'), 'a request’s text is never shown');
    assert.deepEqual(kinds((await activity(db, BEN)).body).filter((k) => k.startsWith('diligence:')), [], 'another investor’s case is not read');
    const admin = kinds((await activity(db, ADMIN)).body).filter((k) => k.startsWith('diligence:'));
    assert.deepEqual(admin, ['diligence:The founder answered a diligence request', 'diligence:Diligence case opened']);
    assert.ok(!(await activity(db, ADMIN)).text.includes('Ada Angel opened'), 'the case owner is not named');
    db.exec(`INSERT INTO dd_reviewers (case_id, section_id, user_id) VALUES (7, 1, ${BEN})`);
    assert.ok(kinds((await activity(db, BEN)).body).includes('diligence:Diligence case opened'), 'a reviewer reads the case');
  } finally { db.close(); }
});

// Mutation checked: a failed diligence read swallowed silently (fails); a failed read failing the whole feed (fails).
test('#6193 a source that cannot be read says so in one row, and the rest of the feed stands', async () => {
  const db = freshDb();
  try {
    db.exec('DROP TABLE dd_requests');
    const r = await activity(db, ADA);
    assert.equal(r.status, 200, r.text);
    const labels = kinds(r.body);
    assert.ok(labels.includes('diligence:Diligence activity could not be read'), labels.join(' | '));
    assert.ok(labels.includes('deal:You committed 50,000 USD') && labels.includes('documents:Document added: Cap table'));
    db.exec('DROP TABLE documents');
    assert.ok(kinds((await activity(db, ADA)).body).includes('documents:Document activity could not be read'));
  } finally { db.close(); }
});

test('#6193 each new source is bounded', () => {
  const route = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/deals.ts'), 'utf8');
  const at = route.indexOf("deals.get('/:id/activity'");
  const body = route.slice(at, route.indexOf('\n});', at));
  assert.match(body, /FROM documents WHERE project_id = \$\{deal\.project_id\} ORDER BY created_at DESC LIMIT 50/);
  assert.match(body, /AND responded_at IS NOT NULL ORDER BY responded_at DESC LIMIT 50/);
});
