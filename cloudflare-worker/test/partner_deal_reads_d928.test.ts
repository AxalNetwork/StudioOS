/**
 * D928 (#2724, part 5 of #2370) — one deal's read, the terminate preview, the
 * cross-deal redemptions read and the agreement-ready signal.
 *
 * The database is the baseline plus every numbered migration above the
 * cutoff, schema only, so the routes' SQL runs against production's columns.
 * Every person, firm and code is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/partner_deal_reads_d928.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import reads, { ATTRIBUTION_DAYS, AGREEMENT_FILLED_KEYS, REDEMPTION_SORTS } from '../src/routes/admin_partner_deal_reads.ts';
import adminPartners from '../src/routes/admin_partners.ts';
import { FINALIZE_MERGE_KEYS } from '../src/routes/partner_onboarding.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const ADMIN = 1, PARTNER = 2, M1 = 11, M2 = 12, M3 = 13, M4 = 14, FOUNDER = 20;

const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();

const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace('T', ' ');

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  const u = db.prepare(`INSERT INTO users (id, role, name, email, is_active, subscription_tier, subscription_status, investor_tier, investor_subscription_status)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`);
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test', 'free', 'active', 'free', 'free');
  u.run(PARTNER, 'partner', 'Lio Testwell', 'lio@example.test', 'founder_pro', 'partner_grant', 'professional', 'partner_grant');
  u.run(M1, 'founder', 'Mia One', 'mia@example.test', 'founder_pro', 'partner_referral', 'free', 'free');
  // M2 now pays for the same tier the deal gave: it is no longer the grant, so terminate would not touch it.
  u.run(M2, 'founder', 'Max Two', 'max@example.test', 'founder_pro', 'active', 'free', 'free');
  u.run(M3, 'investor', 'Ivy Three', 'ivy@example.test', 'free', 'active', 'professional', 'partner_referral');
  u.run(M4, 'founder', 'Ola Four', 'ola@example.test', 'founder_pro', 'partner_referral', 'free', 'free');
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 'free', 'active', 'free', 'free');
  db.exec(`INSERT INTO partner_invitations (id, token, recipient_email, recipient_name, invited_by_user_id, allowed_deal_types, status, expires_at, signed_at, created_at)
    VALUES (10, 'tok10', 'lio@example.test', 'Lio Testwell', ${ADMIN}, '["deal_sourcing_revshare"]', 'signed', '2026-12-01', '2026-09-01 10:00:00', '2026-08-20 09:00:00')`);
  db.exec(`INSERT INTO esign_envelopes (id, envelope_uuid, document_type, document_title, document_body, body_sha256, created_by, status, created_at, completed_at)
    VALUES (5, 'env-5', 'partner_services', 'Partner Services', 'body', 'sha', ${ADMIN}, 'completed', '2026-08-25 09:00:00', '2026-09-01 09:59:00')`);
  db.exec(`INSERT INTO esign_recipients (envelope_id, recipient_email, recipient_name, signing_token, token_expires_at, status)
    VALUES (5, 'lio@example.test', 'Lio Testwell', 'sig5', '2026-09-08 09:00:00', 'signed')`);
  const d = db.prepare(`INSERT INTO partner_deals (id, invitation_id, user_id, deal_type, proposal_json, granted_tier_founder, granted_tier_investor,
      term_months, referral_code, envelope_id, status, activated_at, expires_at, terminated_at, terminated_by_user_id, termination_reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 12, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  d.run(41, 10, PARTNER, 'deal_sourcing_revshare', '{"summary":"Revenue share on sourced deals","terms":["10% of fees"]}', 'founder_pro', 'professional',
    'AXP-41', 5, 'active', '2026-09-01 10:00:00', '2027-09-01', null, null, null, '2026-08-25 09:00:00');
  d.run(42, null, PARTNER, 'services_partnership', '{not json', 'founder_pro', null, 'AXP-42', null, 'terminated', '2026-01-01 10:00:00', '2027-01-01',
    '2026-10-01 12:00:00', ADMIN, 'Firm closed its practice', '2025-12-20 09:00:00');
  d.run(43, null, null, 'capital_partnership', '{}', 'founder_pro', 'institutional', null, null, 'proposed', null, null, null, null, null, '2026-10-01 09:00:00');
  // The case deal 41's activation opened, and one opened by deal 42's: before deal 41, after deal 42.
  db.exec(`INSERT INTO dd_cases (id, uid, subject_type, subject_id, subject_label, owner_user_id, created_at) VALUES
    (7, 'dd-old', 'partner', ${PARTNER}, 'Lio', ${ADMIN}, '2026-01-01 10:00:05'),
    (8, 'dd-41', 'partner', ${PARTNER}, 'Lio', ${ADMIN}, '2026-09-01 10:00:05')`);
  db.exec(`INSERT INTO dd_sections (case_id, section_key, title, weight, status) VALUES (8, 'kyb_entity', 'KYB', 1, 'in_review'), (8, 'compliance_aml', 'AML', 1, 'pending')`);
  db.exec(`INSERT INTO legal_obligations (user_id, obligation_key, required, status) VALUES
    (${PARTNER}, 'partner_msa_v1', 1, 'satisfied'), (${PARTNER}, 'kyb_v1', 1, 'pending'), (${PARTNER}, 'kyc_v1', 0, 'waived'), (${PARTNER}, 'tos_v1', 1, 'satisfied')`);
  const r = db.prepare(`INSERT INTO partner_referral_redemptions (partner_deal_id, redeemed_by_user_id, granted_tier_founder, granted_tier_investor, granted_until, attribution_kind, redeemed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  r.run(41, M1, 'founder_pro', 'professional', '2027-09-01', 'deal_sourcing_revshare', ago(350)); // window closes in ~15 days
  r.run(41, M2, 'founder_pro', 'professional', '2027-09-01', 'deal_sourcing_revshare', ago(100));
  r.run(41, M3, 'founder_pro', 'professional', '2027-09-01', 'deal_sourcing_revshare', ago(400)); // window closed
  r.run(42, M4, 'founder_pro', null, '2027-01-01', 'referral', ago(30));
  db.exec(`INSERT INTO admin_audit_log (admin_user_id, action, filters_json, exported_at) VALUES
    (${ADMIN}, 'partner_deal_terminated', '{"deal_id":42,"reason":"Firm closed its practice"}', '2026-10-01 12:00:01'),
    (${ADMIN}, 'partner_deal_activation_retried', '{"deal_id":41,"activated":true}', '2026-09-01 09:59:30'),
    (${ADMIN}, 'partner_deal_terminated', '{"deal_id":99}', '2026-10-02 12:00:00')`);
  db.exec(`INSERT INTO activity_logs (action, details, actor, user_id, created_at) VALUES ('partner_deal_activated', '{"deal_id":41}', 'h', ${PARTNER}, '2026-09-01 10:00:00')`);
  return db;
}

const app = new Hono<any>();
app.route('/api/admin/partners', reads);
app.route('/api/admin/partners', adminPartners);

async function call(db: DatabaseSync, who: number, path: string) {
  const role = who === ADMIN ? 'admin' : 'founder';
  const token = await new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await withThrownResponses(() => app.request(`/api/admin/partners${path}`, { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}

// ─────────────────────────────────────────────── one deal

test('one deal: the row, its invitation, envelope, case and KYB, obligations per key and its history', async () => {
  const db = fixture();
  const { status, body } = await call(db, ADMIN, '/deals/41');
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.deal.id, 41);
  assert.equal(body.deal.status, 'active');
  assert.equal(body.deal.partner_name, 'Lio Testwell');
  assert.deepEqual(body.deal.proposal, { summary: 'Revenue share on sourced deals', terms: ['10% of fees'] });
  assert.equal(body.deal.proposal_unreadable, false);
  assert.equal(body.deal.redemptions_total, 3);
  assert.equal(body.deal.term_months, 12);
  assert.ok('activation_error' in body.deal && 'void_reason' in body.deal, 'parts 1 and 2 fields ride the row');
  assert.equal(body.invitation.id, 10);
  assert.equal(body.invitation.invited_by_name, 'Ada Admin');
  assert.equal(body.invitation.signed_at, '2026-09-01 10:00:00');
  assert.equal(body.envelope.status, 'completed');
  assert.equal(body.envelope.sent_at, '2026-08-25 09:00:00');
  assert.equal(body.envelope.completed_at, '2026-09-01 09:59:00');
  assert.equal(body.envelope.signing_link_expires_at, '2026-09-08 09:00:00');
  assert.equal(body.due_diligence.match, 'one', 'the older case predates the deal');
  assert.equal(body.due_diligence.case.uid, 'dd-41');
  assert.deepEqual(body.due_diligence.case.kyb, { status: 'in_review', verdict: null });
  const ob = Object.fromEntries(body.obligations.map((o: any) => [o.key, o]));
  assert.deepEqual(body.obligations.map((o: any) => o.key).slice(0, 4), ['partner_msa_v1', 'kyb_v1', 'kyc_v1', 'accreditation_v1']);
  assert.equal(ob.partner_msa_v1.status, 'satisfied');
  assert.equal(ob.kyb_v1.status, 'pending');
  assert.deepEqual([ob.kyc_v1.status, ob.kyc_v1.required], ['waived', false], 'a waived obligation is listed, not hidden');
  assert.deepEqual([ob.accreditation_v1.recorded, ob.accreditation_v1.status], [false, null], 'never seeded is not "satisfied"');
  assert.equal(ob.tos_v1.status, 'satisfied', 'the member’s other obligations follow');
  assert.deepEqual(body.history.map((h: any) => h.kind), ['created', 'activation_retried', 'activated']);
  assert.equal(body.history[1].by_name, 'Ada Admin');
  assert.equal(body.history[1].outcome, 'activated');
});

test('a terminated deal says who and why; an unreadable proposal is said, not passed off as empty', async () => {
  const db = fixture();
  const { body } = await call(db, ADMIN, '/deals/42');
  assert.equal(body.deal.proposal, null);
  assert.equal(body.deal.proposal_unreadable, true);
  const t = body.history.find((h: any) => h.kind === 'terminated');
  assert.deepEqual([t.at, t.by_name, t.reason], ['2026-10-01 12:00:00', 'Ada Admin', 'Firm closed its practice']);
  assert.equal(body.invitation, null);
  assert.equal(body.invitation_missing, false, 'no invitation id, so none is missing');
  assert.equal(body.envelope, null);
  assert.equal(body.due_diligence.match, 'ambiguous', 'both cases were opened at or after this older deal’s activation');
  assert.deepEqual(body.due_diligence.candidates.map((c: any) => c.uid), ['dd-old', 'dd-41']);
  assert.equal(body.due_diligence.case, null, 'two candidates: name both, pick neither');
});

test('a proposed deal has no member yet: no case, no obligations, no envelope', async () => {
  const db = fixture();
  const { body } = await call(db, ADMIN, '/deals/43');
  assert.equal(body.due_diligence.match, 'not_activated');
  assert.equal(body.obligations, null);
  assert.equal(body.history.length, 1);
});

test('one deal: a missing deal is a 404, a non-admin is refused, and every block’s failure is a 5xx', async () => {
  const db = fixture();
  assert.equal((await call(db, ADMIN, '/deals/999')).status, 404);
  assert.equal((await call(db, FOUNDER, '/deals/41')).status, 403);
  for (const table of ['partner_invitations', 'esign_envelopes', 'dd_cases', 'dd_sections', 'legal_obligations', 'admin_audit_log', 'activity_logs', 'partner_referral_redemptions']) {
    const broken = fixture();
    broken.exec(`DROP TABLE ${table}`);
    const r = await call(broken, ADMIN, '/deals/41');
    assert.ok(r.status >= 500, `${table}: ${r.status}`);
  }
});

test('the deal read does not take /deals/top from the existing route', async () => {
  const db = fixture();
  const r = await call(db, ADMIN, '/deals/top?status=all&limit=5');
  assert.equal(r.status, 200);
  assert.ok(!('deal' in (r.body || {})), 'answered by admin_partners, not the one-deal read');
});

// ─────────────────────────────────────────────── terminate preview

test('terminate preview: only members still on the deal’s grant would lose it; a member who paid for a plan would not', async () => {
  const db = fixture();
  const { status, body } = await call(db, ADMIN, '/deals/41/terminate-preview');
  assert.equal(status, 200);
  assert.equal(body.can_terminate, true);
  assert.equal(body.registered, 3);
  assert.equal(body.members_losing, 2);
  const by = Object.fromEntries(body.members.map((m: any) => [m.user_id, m]));
  assert.ok(!by[M2], 'Max pays for the tier now, so terminating takes nothing from them');
  assert.deepEqual([by[M1].loses_founder, by[M1].loses_investor], [true, false]);
  assert.deepEqual([by[M3].loses_founder, by[M3].loses_investor], [false, true]);
  assert.deepEqual(body.partner, { user_id: PARTNER, founder_still_granted: true, investor_still_granted: true });
  // The partner now pays for the founder tier: the same tier, but no longer the deal's grant.
  db.exec(`UPDATE users SET subscription_status = 'active' WHERE id = ${PARTNER}`);
  const after = (await call(db, ADMIN, '/deals/41/terminate-preview')).body;
  assert.equal(after.partner.founder_still_granted, false);
  assert.equal(after.partner.investor_still_granted, true);
  // An investor tier other than the deal's is not its grant, whatever the status says.
  db.exec(`UPDATE users SET investor_tier = 'free' WHERE id = ${PARTNER}`);
  assert.equal((await call(db, ADMIN, '/deals/41/terminate-preview')).body.partner.investor_still_granted, false);
});

test('terminate preview agrees with terminate itself', async () => {
  const db = fixture();
  const preview = (await call(db, ADMIN, '/deals/41/terminate-preview')).body;
  const token = await new SignJWT({ user_id: ADMIN, role: 'admin' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await withThrownResponses(() => app.request('/api/admin/partners/deals/41/terminate', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'Agreed end' }),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any));
  const done = await res.json() as any;
  assert.equal(res.status, 200, JSON.stringify(done));
  assert.equal(done.members_revoked, preview.members_losing);
  assert.equal(done.partner_tiers_reverted, preview.partner.founder_still_granted || preview.partner.investor_still_granted);
  const later = (await call(db, ADMIN, '/deals/41/terminate-preview')).body;
  assert.equal(later.can_terminate, false);
  assert.equal(later.members_losing, 0);
});

test('terminate preview: a missing deal is a 404 and a failed read a 5xx', async () => {
  const db = fixture();
  assert.equal((await call(db, ADMIN, '/deals/999/terminate-preview')).status, 404);
  db.exec('DROP TABLE partner_referral_redemptions');
  assert.ok((await call(db, ADMIN, '/deals/41/terminate-preview')).status >= 500);
});

// ─────────────────────────────────────────────── redemptions

test('redemptions: every row across deals, newest first, with the member, partner, deal state and window', async () => {
  const db = fixture();
  const { status, body } = await call(db, ADMIN, '/redemptions');
  assert.equal(status, 200);
  assert.equal(body.total, 4);
  assert.deepEqual(body.items.map((i: any) => i.member_user_id), [M4, M2, M1, M3]);
  const m1 = body.items.find((i: any) => i.member_user_id === M1);
  assert.equal(m1.member_name, 'Mia One');
  assert.equal(m1.member_role, 'founder');
  assert.equal(m1.partner_name, 'Lio Testwell');
  assert.equal(m1.deal_id, 41);
  assert.equal(m1.deal_status, 'active');
  assert.equal(m1.referral_code, 'AXP-41');
  assert.ok(m1.window_days_left > 10 && m1.window_days_left <= 16, String(m1.window_days_left));
  assert.equal(body.items.find((i: any) => i.member_user_id === M3).window_days_left, 0, 'a closed window reads 0 days');
  const m4 = body.items.find((i: any) => i.member_user_id === M4);
  assert.equal(m4.window_days_left, null, 'a plain referral has no window');
  assert.equal(m4.deal_status, 'terminated', 'O-WIN: the deal’s state is returned with each row');
});

test('redemptions: each filter narrows, and the total counts what the filter keeps', async () => {
  const db = fixture();
  const ids = async (qs: string) => {
    const r = await call(db, ADMIN, `/redemptions?${qs}`);
    assert.equal(r.status, 200, `${qs}: ${JSON.stringify(r.body)}`);
    return { ids: r.body.items.map((i: any) => i.member_user_id).sort(), total: r.body.total };
  };
  assert.deepEqual(await ids('attribution=referral'), { ids: [M4], total: 1 });
  assert.deepEqual(await ids('attribution=deal_sourcing_revshare'), { ids: [M1, M2, M3], total: 3 });
  assert.deepEqual(await ids(`partner=${PARTNER}`), { ids: [M1, M2, M3, M4], total: 4 });
  assert.deepEqual(await ids(`partner=${FOUNDER}`), { ids: [], total: 0 });
  assert.deepEqual(await ids('deal=42'), { ids: [M4], total: 1 });
  assert.deepEqual(await ids('window_within=30'), { ids: [M1], total: 1 }, 'only an open window closing within 30 days');
  assert.deepEqual(await ids('window_within=365'), { ids: [M1, M2], total: 2 });
  const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  assert.deepEqual(await ids(`from=${day(120)}`), { ids: [M2, M4], total: 2 });
  assert.deepEqual(await ids(`to=${day(200)}`), { ids: [M1, M3], total: 2 });
  assert.deepEqual(await ids(`from=${day(120)}&to=${day(60)}`), { ids: [M2], total: 1 });
  assert.deepEqual(await ids(`from=${day(30)}&to=${day(30)}`), { ids: [M4], total: 1 }, 'both ends of the range are the day itself');
  assert.deepEqual(await ids('q=%25%25'), { ids: [], total: 0 }, 'a % in the search is a literal, not a wildcard');
  assert.deepEqual(await ids('q=ivy'), { ids: [M3], total: 1 }, 'the member’s name');
  assert.deepEqual(await ids('q=axp-42'), { ids: [M4], total: 1 }, 'the code');
  assert.deepEqual(await ids('q=testwell'), { ids: [M1, M2, M3, M4], total: 4 }, 'the partner');
  for (const bad of ['attribution=other', 'partner=x', 'deal=-1', 'window_within=400', 'from=yesterday', 'sort=random']) {
    assert.equal((await call(db, ADMIN, `/redemptions?${bad}`)).status, 400, bad);
  }
});

test('redemptions: each sort, and pages with an exact total', async () => {
  const db = fixture();
  const order = async (qs: string) => (await call(db, ADMIN, `/redemptions?${qs}`)).body.items.map((i: any) => i.member_user_id);
  assert.deepEqual(await order('sort=window'), [M1, M2, M3, M4], 'open windows first, soonest to close first');
  db.exec(`UPDATE users SET name = 'Aaron Partner' WHERE id = ${PARTNER}`);
  db.exec(`INSERT INTO users (id, role, name, email, is_active) VALUES (30, 'partner', 'Zed Firm', 'zed@example.test', 1)`);
  db.exec(`INSERT INTO partner_deals (id, user_id, deal_type, proposal_json, status, referral_code, created_at) VALUES (44, 30, 'services_partnership', '{}', 'active', 'AXP-44', '2026-10-01')`);
  db.exec(`INSERT INTO partner_referral_redemptions (partner_deal_id, redeemed_by_user_id, granted_until, attribution_kind, redeemed_at) VALUES (44, ${FOUNDER}, '2027-01-01', 'referral', '${ago(1)}')`);
  const byPartner = await order('sort=partner');
  assert.equal(byPartner.at(-1), FOUNDER, 'Zed Firm sorts after Aaron Partner');
  const p1 = (await call(db, ADMIN, '/redemptions?limit=2&page=1')).body;
  const p3 = (await call(db, ADMIN, '/redemptions?limit=2&page=3')).body;
  assert.deepEqual([p1.total, p1.pages, p1.items.length], [5, 3, 2]);
  assert.deepEqual([p3.page, p3.items.length], [3, 1]);
  const all = (await call(db, ADMIN, '/redemptions?limit=100')).body.items.map((i: any) => i.id);
  const paged = [...p1.items, ...(await call(db, ADMIN, '/redemptions?limit=2&page=2')).body.items, ...p3.items].map((i: any) => i.id);
  assert.deepEqual(paged, all, 'the pages cover every row once, in order');
});

test('redemptions: a failed read is a 5xx, never an empty list; a non-admin is refused', async () => {
  const db = fixture();
  assert.equal((await call(db, FOUNDER, '/redemptions')).status, 403);
  db.exec('DROP TABLE partner_referral_redemptions');
  assert.ok((await call(db, ADMIN, '/redemptions')).status >= 500);
});

test('the window’s 365 days are one figure, in the read and in the deal’s own redemptions route', () => {
  assert.equal(ATTRIBUTION_DAYS, 365);
  assert.match(readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/admin_partners.ts'), 'utf8'), /const ATTRIBUTION_DAYS = 365;/);
  for (const sql of Object.values(REDEMPTION_SORTS)) assert.match(sql, /julianday\(prr\.redeemed_at\) \+ 365/);
});

// ─────────────────────────────────────────────── agreement ready

function withTemplate(db: DatabaseSync, body: string, opts: { stub?: number; active?: number } = {}) {
  db.prepare(`INSERT INTO legal_templates (slug, version, title, category, body_md, is_active, is_stub) VALUES ('partner_services', 1, 'Partner Services', 'partner', ?, ?, ?)`)
    .run(body, opts.active ?? 1, opts.stub ?? 0);
}

test('agreement ready: every field the send fills', async () => {
  const db = fixture();
  withTemplate(db, 'Between Axal VC and {{partner_name}} ({{partner_email}}), from {{effective_date}}: {{deal_type}} for {{term_months}} months. Signed by {{recipient_name}}.');
  const { status, body } = await call(db, ADMIN, '/agreement-ready');
  assert.equal(status, 200);
  assert.deepEqual(body, { ready: true, reason: null, fields: [] });
});

test('agreement ready: a sender field and every counterparty field are named as unfilled', async () => {
  const db = fixture();
  withTemplate(db, '{{partner_name}} agrees to {{fee_split}}. Partner id {{counterparty.partner_id}}.');
  const { body } = await call(db, ADMIN, '/agreement-ready');
  assert.equal(body.ready, false);
  assert.equal(body.reason, 'unfilled_fields');
  assert.deepEqual(body.fields.map((f: any) => f.key), ['fee_split', 'counterparty.partner_id']);
  assert.equal(body.fields[0].label, 'Fee split');
});

test('agreement ready: an unreadable template says nothing either way; a non-admin is refused', async () => {
  const db = fixture();
  db.exec('DROP TABLE legal_templates');
  db.exec('CREATE TABLE legal_templates (slug TEXT)');
  const r = await call(db, ADMIN, '/agreement-ready');
  assert.equal(r.status, 503);
  assert.equal(r.body.ready, null);
  assert.equal(r.body.reason, 'unreadable');
  assert.equal((await call(db, FOUNDER, '/agreement-ready')).status, 403);
});

test('agreement ready: with no row in the library, the bundled body decides', async () => {
  const db = fixture();
  const r = await call(db, ADMIN, '/agreement-ready');
  assert.equal(r.status, 200);
  assert.ok(r.body.ready === true || (r.body.ready === false && ['no_body', 'unfilled_fields'].includes(r.body.reason)), JSON.stringify(r.body));
});

test('the keys the signal counts as filled are finalize’s own merge fields and the envelope’s', () => {
  const src = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/partner_onboarding.ts'), 'utf8');
  const at = src.indexOf('mergeFields: {', src.indexOf("onboard.post('/:token/finalize'"));
  const block = src.slice(at, src.indexOf('},', at));
  const keys = [...block.matchAll(/^\s+([a-z_]+):/gm)].map((m) => m[1]);
  assert.deepEqual(keys, [...FINALIZE_MERGE_KEYS], 'FINALIZE_MERGE_KEYS is the mergeFields finalize passes');
  for (const k of ['recipient_name', 'recipient_email', 'counterparty_name', 'effective_date', ...FINALIZE_MERGE_KEYS]) assert.ok(AGREEMENT_FILLED_KEYS.has(k), k);
  assert.ok(![...AGREEMENT_FILLED_KEYS].some((k) => k.startsWith('counterparty.')));
});
