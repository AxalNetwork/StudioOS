/**
 * D4811 (#4811) part 3 — the Agreements metric strip (board CT-01) on
 * `GET /api/admin/contracts/stats` and its drill-downs on
 * `GET /api/admin/contracts?attention=…`: awaiting, executed by period,
 * stalled only from a recorded send (an unrecorded one is unknown, never
 * fresh or stalled), data repair (signed with no evidence; unlinked
 * recipient), and the library cells (restricted templates, governance in
 * review and confidential, HQ only). Real baseline schema; made-up rows.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/contracts_attention_4811.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import contracts from '../src/routes/admin_contracts.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { contractAttention, matchesAttention, stalledOf, STALLED_DAYS } from '../src/services/contractAttention.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const SECRET = 'unit-test-secret-4811-attention-0123456789';
const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const NOW = Date.now();
const ago = (days: number) => new Date(NOW - days * 86400000).toISOString();

function fixture({ governance = true } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const name of ['users', 'super_admins', 'user_sessions', 'activity_logs', 'admin_audit_log', 'documents',
    'projects', 'founders', 'deals', 'esign_envelopes', 'esign_recipients', 'esign_audit_events', 'pairwise_ndas', 'partner_deals', 'partner_referral_redemptions', 'legal_templates', 'legal_template_versions']) {
    db.exec(tableFromBaseline(baseline, name));
  }
  if (governance) db.exec(readFileSync('cloudflare-worker/sql/migrations/202611062154_governance_documents.sql', 'utf8'));
  db.prepare("INSERT INTO users(id,role,name,email,is_active) VALUES(2,'admin','Plain admin','admin@example.test',1)").run();
  db.exec("INSERT INTO projects(id,name) VALUES(10,'Beta'); INSERT INTO deals(id,project_id) VALUES(90,10)");
  // Envelopes: deal 90 links Beta; deal NULL is an unlinked recipient.
  const env = db.prepare("INSERT INTO esign_envelopes(id,envelope_uuid,deal_id,document_type,document_title,document_body,body_sha256,created_by,status,created_at,completed_at,provider) VALUES(?,?,?,'investor_nda_axal',?,'body','hash',2,?,?,?,'native')");
  env.run(1, 'env-old', 90, 'Old send', 'sent', ago(60), null);      // sent 45 days ago → stalled
  env.run(2, 'env-new', 90, 'Fresh send', 'sent', ago(5), null);     // sent 3 days ago → not stalled
  env.run(3, 'env-nosend', 90, 'No send event', 'sent', ago(90), null); // no recorded send → unknown
  env.run(4, 'env-done', 90, 'Signed this month', 'completed', ago(10), ago(1));
  env.run(5, 'env-unlinked', null, 'Unlinked one', 'sent', ago(20), null); // sent 10 days ago, no company
  const ev = db.prepare("INSERT INTO esign_audit_events(envelope_id,ts,action) VALUES(?,?,'email_sent')");
  ev.run(1, ago(45)); ev.run(2, ago(3)); ev.run(4, ago(9)); ev.run(5, ago(10));
  // A document marked signed with nothing to show for it: the contradiction.
  db.prepare("INSERT INTO documents(uid,title,doc_type,status,template_name,project_id,created_at) VALUES('doc-bare','Bare signed','safe','signed','safe',10,?)").run(ago(30));
  db.exec("INSERT INTO legal_templates(slug,title,category,body_md,is_active) VALUES('subsidiary_licence_agreement','Subsidiary Licence','licence','x',1),('mutual_nda','Mutual NDA','nda','x',1)");
  if (governance) {
    const g = db.prepare("INSERT INTO governance_documents(uid,entity_key,category,title,status,confidential) VALUES(?,?,?,?,?,?)");
    g.run('00000000-0000-4000-8000-000000000001', 'gp', 'resolution', 'Resolution in review', 'review', 0);
    g.run('00000000-0000-4000-8000-000000000002', 'holdings', 'member_register', 'Register', 'approved', 1);
    g.run('00000000-0000-4000-8000-000000000003', 'holdings', 'resolution', 'Old confidential', 'archived', 1);
  }
  return db;
}
const app = new Hono<any>();
app.route('/contracts', contracts);
app.onError((err, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
async function call(db: DatabaseSync, path: string, extraEnv = {}) {
  const jwt = await new SignJWT({ user_id: 2, role: 'admin' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const res = await app.request(`/contracts${path}`, { headers: { Authorization: `Bearer ${jwt}` } }, { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...extraEnv });
  return { status: res.status, body: await res.json() as any };
}

test('the rules: stalled only from a recorded send; an unrecorded send is unknown; evidence and links as the table draws them', () => {
  const now = Date.UTC(2026, 10, 9, 12);
  const day = 86400000;
  assert.equal(STALLED_DAYS, 30);
  assert.equal(stalledOf({ status: 'sent', sent_at: new Date(now - 31 * day).toISOString() }, now), true);
  assert.equal(stalledOf({ status: 'sent', sent_at: new Date(now - 29 * day).toISOString() }, now), false);
  assert.equal(stalledOf({ status: 'sent', sent_at: null }, now), null, 'no recorded send: unknown');
  assert.equal(stalledOf({ status: 'signed', sent_at: new Date(now - 90 * day).toISOString() }, now), false, 'only an awaiting row stalls');
  assert.equal(matchesAttention({ status: 'signed' }, 'repair_evidence', now), true);
  assert.equal(matchesAttention({ status: 'signed', source: 'esign', raw_status: 'completed' }, 'repair_evidence', now), false);
  assert.equal(matchesAttention({ status: 'signed', signed_at: '2026-01-01' }, 'repair_evidence', now), false);
  assert.equal(matchesAttention({ status: 'sent', source: 'esign', project_name: null }, 'repair_unlinked', now), true);
  assert.equal(matchesAttention({ status: 'sent', source: 'documents', project_name: null }, 'repair_unlinked', now), true);
  assert.equal(matchesAttention({ status: 'void', source: 'esign', project_name: null }, 'repair_unlinked', now), false, 'a voided row needs no repair');
  // D4811 part 11: a store with no company link to make is never a repair.
  assert.equal(matchesAttention({ status: 'sent', source: 'pairwise_nda', project_name: null }, 'repair_unlinked', now), false);
  assert.equal(matchesAttention({ status: 'sent', source: 'partner_deal', project_name: null }, 'repair', now), false);
  const c = contractAttention([
    { status: 'signed', signed_at: '2026-11-02T10:00:00Z', project_name: 'A' },
    { status: 'signed', signed_at: '2026-03-02T10:00:00Z', project_name: 'A' },
    { status: 'signed', signed_at: '2025-03-02T10:00:00Z', project_name: 'A' },
    { status: 'signed', source: 'esign', raw_status: 'completed', project_name: 'A' },
  ], now);
  assert.deepEqual(c.executed, { total: 4, this_year: 2, this_month: 1, undated: 1 }, 'an undated signature counts in no period');
});

test('the strip on /stats: each count from the rows the page lists, unknowns kept apart', async () => {
  const r = await call(fixture(), '/stats?recorded=true');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const a = r.body.attention;
  assert.equal(a.awaiting, 4);
  assert.deepEqual([a.stalled.count, a.stalled.unknown], [1, 1], 'one stalled; the send nobody recorded is unknown, not fresh');
  assert.equal(a.executed.total, 2);
  assert.deepEqual([a.repair.count, a.repair.evidence, a.repair.unlinked], [2, 1, 1]);
  assert.deepEqual([a.legal_review.templates, a.legal_review.governance, a.legal_review.governance_scope], [1, 1, 'hq']);
  assert.deepEqual([a.restricted.templates, a.restricted.governance], [1, 1], 'an archived confidential record is not counted');
  assert.equal(r.body.pending_signature, 4, 'the existing counters are unchanged');
});

test('every count opens its records: ?attention= lists exactly the rows behind the number', async () => {
  const db = fixture();
  const stats = (await call(db, '/stats?recorded=true')).body.attention;
  const list = async (f: string) => (await call(db, `?recorded=true&limit=100&attention=${f}`)).body;
  const stalled = await list('stalled');
  assert.deepEqual(stalled.items.map((x: any) => x.uid), ['env-old']);
  assert.equal(stalled.total, stats.stalled.count);
  assert.equal((await list('awaiting')).total, stats.awaiting);
  assert.equal((await list('executed')).total, stats.executed.total);
  assert.equal((await list('repair')).total, stats.repair.count);
  assert.deepEqual((await list('repair_evidence')).items.map((x: any) => x.uid), ['doc-bare']);
  assert.deepEqual((await list('repair_unlinked')).items.map((x: any) => x.uid), ['env-unlinked']);
  assert.equal((await call(db, '?attention=everything')).status, 400, 'an unknown filter is refused, never ignored');
});

test('governance is HQ\'s: a branch reads it as not recorded, a failed read as unreadable, never 0', async () => {
  const branch = (await call(fixture(), '/stats?recorded=true', { BRANCH_CODE: 'north' })).body.attention;
  assert.deepEqual([branch.legal_review.governance, branch.legal_review.governance_scope], [null, 'branch']);
  const missing = (await call(fixture({ governance: false }), '/stats?recorded=true')).body.attention;
  assert.deepEqual([missing.restricted.governance, missing.restricted.governance_scope], [null, 'unreadable']);
  assert.equal(missing.restricted.templates, 1, 'the template count still reads');
});
