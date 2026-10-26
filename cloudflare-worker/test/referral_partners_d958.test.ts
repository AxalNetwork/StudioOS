/**
 * D958 (#2791, Programs part 5 of #2371) — referral partners, custom terms
 * with the Super Admin's approval (migration 563), the engine paying terms
 * first, and the Referral partners reads.
 *
 * The database is the baseline plus every numbered migration above the cutoff,
 * so migration 563 applies to a fresh build exactly as it ships. Every person
 * is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/referral_partners_d958.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import partnersRoute, { quarterRange, readTermsInput } from '../src/routes/admin_referral_partners.ts';
import networkRoute, { fireCommissionEvent } from '../src/routes/network.ts';
import { effectiveState, onReferralTermsEnvelopeCompleted, rangesOverlap, termsAmount, todayUtc } from '../src/services/referralPartnerTerms.ts';
import { PROGRAM_ACTIVITY_ACTIONS } from '../src/services/programActivity.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const SUPER = 1, ADMIN = 2, MEMBER = 3;
const PIA = 10, QUIN = 11, L2 = 12, MAX = 20, NIA = 21, OLLY = 22;
const TODAY = todayUtc();
const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const NEXT_YEAR = `${Number(TODAY.slice(0, 4)) + 1}${TODAY.slice(4)}`;

const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, email_verified, referral_code) VALUES (?, ?, ?, ?, ?, 1, ?)');
  u.run(SUPER, 'admin', 'Sue Super', 'sue@example.test', 1, null);
  u.run(ADMIN, 'admin', 'Pat Plain', 'pat@example.test', 1, null);
  u.run(MEMBER, 'founder', 'Mo Member', 'mo@example.test', 1, 'MOMO01');
  u.run(PIA, 'partner', 'Pia Partner', 'pia@example.test', 1, 'PIA001');
  u.run(QUIN, 'investor', 'Quin Scout', 'quin@example.test', 1, 'QUIN01');
  u.run(L2, 'founder', 'Lee Upline', 'lee@example.test', 1, 'LEE001');
  u.run(MAX, 'founder', 'Max Referred', 'max@example.test', 1, null);
  u.run(NIA, 'founder', 'Nia Referred', 'nia@example.test', 1, null);
  u.run(OLLY, 'founder', 'Olly Referred', 'olly@example.test', 1, null);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  for (const id of [SUPER, ADMIN, MEMBER]) {
    db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))").run(id, `totp-${id}`);
  }
  db.prepare("INSERT INTO referral_partners (id, user_id, segment, added_by, added_at) VALUES (1, ?, 'event_organisers', ?, '2026-09-01 10:00:00')").run(PIA, SUPER);
  db.prepare("INSERT INTO referral_partners (id, user_id, segment, added_by, added_at) VALUES (2, ?, 'venture_scouts', ?, '2026-09-02 10:00:00')").run(QUIN, SUPER);
  const ref = db.prepare('INSERT INTO referrals (id, referrer_id, referred_id, referral_code, status, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  ref.run(1, PIA, MAX, 'PIA001', 'pending', `${TODAY} 09:00:00`);
  ref.run(2, PIA, NIA, 'PIA001', 'pending', `${TODAY} 09:30:00`);
  ref.run(3, QUIN, OLLY, 'QUIN01', 'converted', '2025-01-10 09:00:00');
  ref.run(4, L2, PIA, 'LEE001', 'converted', '2025-01-01 09:00:00');
  return db;
}

const app = new Hono<any>();
app.route('/api/admin/referral-partners', partnersRoute);
app.route('/api/network', networkRoute);
app.onError((err) => {
  const m = String((err as Error)?.message || '');
  if (m === 'Unauthorized') return new Response(JSON.stringify({ error: m }), { status: 401 });
  if (m === 'Admin required' || m === 'Super admin required') return new Response(JSON.stringify({ error: m }), { status: 403 });
  if (m === 'step_up_required' || m === 'factor_required') return new Response(JSON.stringify({ error: m }), { status: 403 });
  throw err;
});
const env = (db: DatabaseSync) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown, base = '/api/admin/referral-partners') {
  const token = await new SignJWT({ user_id: who, role: who === MEMBER ? 'founder' : 'admin', jti: `totp-${who}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error, console.log]; console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try {
    const res = await withThrownResponses(() => app.request(`${base}${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, env(db)));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error, console.log] = saved; }
}
const FLAT = [{ rule_key: 'referral_kyc_approved', amount_cents: 12000 }];
const draft = (over: Record<string, unknown> = {}) => ({ user_id: PIA, starts_on: YESTERDAY, ends_on: null, currency: 'USD', triggers: FLAT, contract_slug: 'finders-fee', ...over });
const commissionsOf = (db: DatabaseSync, userId: number) => db.prepare(
  'SELECT amount_cents, currency, source_type, source_id, terms_id, description FROM commissions WHERE user_id = ? ORDER BY id').all(userId).map((r: any) => ({ ...r }));
/** Terms straight into the store, signed, for the engine's tests. */
function signedTerms(db: DatabaseSync, o: { partner?: number; starts?: string; ends?: string | null; perIntro?: number | null; overall?: number | null; currency?: string; triggers: Array<[string, number | null, number | null]> }) {
  const id = Number(db.prepare(`INSERT INTO referral_partner_terms (uid, partner_id, segment, status, starts_on, ends_on, cap_per_intro_cents, overall_cap_cents, currency,
      created_by, submitted_at, approved_by, approved_at, envelope_id, sent_at, signed_at)
    VALUES (?, ?, 'event_organisers', 'signed', ?, ?, ?, ?, ?, ?, datetime('now'), ?, datetime('now'), 77, datetime('now'), datetime('now')) RETURNING id`)
    .get(`rpt_${Math.random().toString(36).slice(2)}`, o.partner ?? 1, o.starts ?? YESTERDAY, o.ends ?? null, o.perIntro ?? null, o.overall ?? null, o.currency ?? 'USD', SUPER, SUPER).id);
  for (const [key, amount, bps] of o.triggers) {
    db.prepare('INSERT INTO referral_partner_term_triggers (terms_id, rule_key, amount_cents, percentage_bps) VALUES (?, ?, ?, ?)').run(id, key, amount, bps);
  }
  return id;
}

test('migration 563 applies to a fresh build; a trigger pays a flat amount or a share, never both; steps carry who and when', () => {
  const db = fixture();
  const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as any[]).map((c) => c.name);
  assert.ok(['terms_id', 'reversed_amount_cents', 'reversed_at'].every((c) => cols('commissions').includes(c)));
  assert.ok(['segment', 'status', 'starts_on', 'ends_on', 'cap_per_intro_cents', 'overall_cap_cents', 'currency', 'sectors', 'contract_slug', 'envelope_id',
    'created_by', 'submitted_at', 'approved_by', 'approved_at', 'sent_at', 'signed_at', 'ended_by', 'ended_at', 'end_reason'].every((c) => cols('referral_partner_terms').includes(c)));
  const id = signedTerms(db, { triggers: [['referral_kyc_approved', 100, null]] });
  assert.throws(() => db.prepare('INSERT INTO referral_partner_term_triggers (terms_id, rule_key, amount_cents, percentage_bps) VALUES (?, ?, 100, 200)').run(id, 'referral_deal_funded'), /CHECK/);
  assert.throws(() => db.prepare('INSERT INTO referral_partner_term_triggers (terms_id, rule_key) VALUES (?, ?)').run(id, 'referral_spinout'), /CHECK/);
  assert.throws(() => db.prepare("INSERT INTO referral_partner_terms (uid, partner_id, segment, status, starts_on, currency, created_by) VALUES ('x', 1, 'event_organisers', 'approved', '2026-01-01', 'USD', 1)").run(), /CHECK/,
    'an approved row needs a submission, an approver and a time');
  assert.throws(() => db.prepare("INSERT INTO referral_partner_terms (uid, partner_id, segment, starts_on, ends_on, created_by) VALUES ('y', 1, 'event_organisers', '2026-05-01', '2026-04-01', 1)").run(), /CHECK/);
  assert.throws(() => db.prepare("INSERT INTO referral_partners (user_id, segment, added_by) VALUES (3, 'influencers', 1)").run(), /CHECK/);
});

test('HQ adds a referral partner with a segment (OD3 A); an admin account, a repeat and a member are refused', async () => {
  const db = fixture();
  const added = await call(db, ADMIN, 'POST', '', { user_id: MEMBER, segment: 'deal_makers' });
  assert.equal(added.status, 201);
  assert.equal(added.body.segment_label, 'Deal makers');
  assert.equal((await call(db, ADMIN, 'POST', '', { user_id: MEMBER, segment: 'deal_makers' })).body.error, 'already_referral_partner');
  assert.equal((await call(db, ADMIN, 'POST', '', { user_id: ADMIN, segment: 'deal_makers' })).body.error, 'admins_cannot_refer');
  assert.equal((await call(db, ADMIN, 'POST', '', { user_id: MAX, segment: 'scouts' })).body.error, 'unknown_segment');
  assert.equal((await call(db, MEMBER, 'GET', '')).status, 403);
  const moved = await call(db, ADMIN, 'PATCH', `/${MEMBER}`, { segment: 'venture_scouts' });
  assert.equal(moved.body.segment, 'venture_scouts');
  const logged = db.prepare("SELECT action FROM activity_logs WHERE action LIKE 'referral_partner.%' ORDER BY id").all().map((r: any) => r.action);
  assert.deepEqual(logged, ['referral_partner.added', 'referral_partner.updated']);
});

test('a draft is checked as the engine needs it: a trigger an event fires, flat or share never both, real dates, no share of an identity check', async () => {
  const db = fixture();
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ triggers: [{ rule_key: 'referral_deal_funded', amount_cents: 100 }] }, 'trigger_unknown'],
    [{ triggers: [{ rule_key: 'referral_kyc_approved', amount_cents: 100, percentage_bps: 50 }] }, 'trigger_amount_ambiguous'],
    [{ triggers: [{ rule_key: 'referral_kyc_approved' }] }, 'trigger_amount_ambiguous'],
    [{ triggers: [{ rule_key: 'referral_kyc_approved', percentage_bps: 50 }] }, 'trigger_share_unpaid'],
    [{ starts_on: '2026-02-30' }, 'invalid_dates'],
    [{ starts_on: '2026-05-01', ends_on: '2026-04-01' }, 'invalid_dates'],
    [{ currency: 'usd' }, 'invalid_currency'],
    [{ triggers: [] }, 'triggers_required'],
  ];
  for (const [over, code] of cases) {
    const res = await call(db, ADMIN, 'POST', '/terms', draft(over));
    assert.equal(res.status, 400, code);
    assert.equal(res.body.error, code);
  }
  assert.equal((await call(db, ADMIN, 'POST', '/terms', draft({ user_id: MAX }))).body.error, 'referral_partner_not_found');
  const made = await call(db, ADMIN, 'POST', '/terms', draft({ cap_per_intro_cents: 10000 }));
  assert.equal(made.status, 201);
  assert.deepEqual([made.body.state, made.body.segment, made.body.triggers], ['draft', 'event_organisers', [{ rule_key: 'referral_kyc_approved', amount_cents: 12000, percentage_bps: null }]]);
  const edited = await call(db, ADMIN, 'PATCH', `/terms/${made.body.uid}`, { overall_cap_cents: 50000 });
  assert.deepEqual([edited.status, edited.body.overall_cap_cents, edited.body.cap_per_intro_cents], [200, 50000, 10000]);
  assert.equal(readTermsInput({ starts_on: '2026-01-01', triggers: FLAT }).hasOwnProperty('code'), false);
});

test('draft → submitted → approved (the Super Admin only, elevation before the bar) → sent → signed → active; a non-draft cannot be edited', async () => {
  const db = fixture();
  const uid = (await call(db, ADMIN, 'POST', '/terms', draft())).body.uid;
  const submitted = await call(db, ADMIN, 'POST', `/terms/${uid}/submit`);
  assert.deepEqual([submitted.status, submitted.body.state, submitted.body.submitted.by], [200, 'submitted', ADMIN]);
  assert.equal((await call(db, ADMIN, 'PATCH', `/terms/${uid}`, { note: 'late' })).body.error, 'terms_not_draft');
  const plain = await call(db, ADMIN, 'POST', `/terms/${uid}/approve`);
  assert.deepEqual([plain.status, plain.body.error], [403, 'super_admin_required'], 'a plain Admin is refused before any code is asked for');
  assert.equal((await call(db, ADMIN, 'POST', `/terms/${uid}/send`, {})).body.error, 'terms_not_approved');
  const approved = await call(db, SUPER, 'POST', `/terms/${uid}/approve`);
  assert.deepEqual([approved.status, approved.body.state, approved.body.approved.by], [200, 'approved', SUPER]);
  assert.equal((await call(db, SUPER, 'POST', `/terms/${uid}/approve`)).body.error, 'terms_not_submitted');
  // The send is today's envelope send (routes/admin_contracts.ts) on the published
  // template, to the partner on record, and must match its own preview.
  db.prepare("INSERT INTO legal_templates (id, slug, title, category, body_md, version) VALUES (90, 'finders-fee', 'Finder''s Fee Agreement', 'portfolio', 'Finder terms for {{recipient_name}}.', 2)").run();
  db.prepare("INSERT INTO legal_template_publications (template_id, slug, version, title, category, body_md, published_at, published_by) VALUES (90, 'finders-fee', 2, 'Finder''s Fee Agreement', 'portfolio', 'Finder terms for {{recipient_name}}.', datetime('now'), ?)").run(SUPER);
  const preview = await call(db, ADMIN, 'POST', `/terms/${uid}/preview`, { template_version: 2 });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  const stale = await call(db, ADMIN, 'POST', `/terms/${uid}/send`, { template_version: 2, provider: 'native', preview_sha256: 'f'.repeat(64) });
  assert.deepEqual([stale.status, stale.body.code], [409, 'preview_changed'], 'the send must match the previewed body');
  const sent = await call(db, ADMIN, 'POST', `/terms/${uid}/send`, { template_version: 2, provider: 'native', preview_sha256: preview.body.body_sha256 });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.body.state, 'sent');
  const stored = db.prepare('SELECT status, envelope_id, sent_by FROM referral_partner_terms WHERE uid = ?').get(uid) as any;
  assert.deepEqual([stored.status, stored.envelope_id, stored.sent_by], ['sent', sent.body.envelope_id, ADMIN]);
  const envelope = db.prepare('SELECT document_type FROM esign_envelopes WHERE id = ?').get(stored.envelope_id) as any;
  assert.equal(envelope.document_type, 'finders-fee');
  assert.equal((db.prepare('SELECT recipient_email FROM esign_recipients WHERE envelope_id = ?').get(stored.envelope_id) as any).recipient_email, 'pia@example.test', 'the signer is the partner on record');
  // The completion hook then signs the row.
  assert.deepEqual(await onReferralTermsEnvelopeCompleted(env(db), stored.envelope_id), { changed: true, uid });
  assert.deepEqual(await onReferralTermsEnvelopeCompleted(env(db), stored.envelope_id), { changed: false, uid: null }, 'a second completion changes nothing');
  const read = await call(db, ADMIN, 'GET', `/${PIA}/terms`);
  assert.deepEqual([read.body.items[0].stored_status, read.body.items[0].state, !!read.body.items[0].signed], ['signed', 'active', true]);
  const actions = db.prepare("SELECT action FROM activity_logs WHERE action LIKE 'referral_terms.%' ORDER BY id").all().map((r: any) => r.action);
  assert.deepEqual(actions, ['referral_terms.created', 'referral_terms.submitted', 'referral_terms.approved', 'referral_terms.sent']);
  for (const a of actions) assert.ok(PROGRAM_ACTIVITY_ACTIONS['referral-partners'].includes(a), `${a} is listed for the Activity tab`);
});

test('the send refuses terms with no contract, and the end needs a reason; ended terms pay nothing more', async () => {
  const db = fixture();
  const uid = (await call(db, ADMIN, 'POST', '/terms', draft({ contract_slug: null }))).body.uid;
  await call(db, ADMIN, 'POST', `/terms/${uid}/submit`);
  await call(db, SUPER, 'POST', `/terms/${uid}/approve`);
  assert.equal((await call(db, ADMIN, 'POST', `/terms/${uid}/preview`, {})).body.error, 'terms_contract_missing');
  assert.equal((await call(db, ADMIN, 'POST', `/terms/${uid}/end`, { reason: 'Ending.' })).body.error, 'reason_required');
  assert.equal((await call(db, ADMIN, 'POST', `/terms/${uid}/end`, { reason: 'The partner left the firm.' })).body.error, 'terms_not_active');
  const live = signedTerms(db, { partner: 2, triggers: [['referral_kyc_approved', 9000, null]] });
  const liveUid = (db.prepare('SELECT uid FROM referral_partner_terms WHERE id = ?').get(live) as any).uid;
  const ended = await call(db, ADMIN, 'POST', `/terms/${liveUid}/end`, { reason: 'The partner left the firm.' });
  assert.deepEqual([ended.status, ended.body.state, ended.body.ended.reason], [200, 'ended', 'The partner left the firm.']);
});

test('one set of terms at a time: overlapping dates are refused on submit (409 terms_overlap); later dates are fine', async () => {
  const db = fixture();
  signedTerms(db, { starts: YESTERDAY, ends: NEXT_YEAR, triggers: [['referral_kyc_approved', 100, null]] });
  const clash = (await call(db, ADMIN, 'POST', '/terms', draft({ starts_on: TODAY }))).body.uid;
  const refused = await call(db, ADMIN, 'POST', `/terms/${clash}/submit`);
  assert.deepEqual([refused.status, refused.body.error], [409, 'terms_overlap']);
  const later = new Date(Date.parse(`${NEXT_YEAR}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const next = (await call(db, ADMIN, 'POST', '/terms', draft({ starts_on: later }))).body.uid;
  assert.equal((await call(db, ADMIN, 'POST', `/terms/${next}/submit`)).status, 200);
  assert.equal(rangesOverlap({ starts_on: '2026-01-01', ends_on: null }, { starts_on: '2030-01-01', ends_on: '2030-02-01' }), true);
});

test('the engine pays active terms before the rule, with no L2 bonus; without terms the rule pays as before, bonus and all', async () => {
  const db = fixture();
  db.exec(`CREATE TABLE IF NOT EXISTS referral_chains (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, root_referrer_id INTEGER NOT NULL,
    level INTEGER NOT NULL, multiplier_bps INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  db.prepare('INSERT INTO referral_chains (user_id, root_referrer_id, level, multiplier_bps) VALUES (?, ?, 2, 5000)').run(MAX, L2);
  db.prepare('INSERT INTO referral_chains (user_id, root_referrer_id, level, multiplier_bps) VALUES (?, ?, 2, 5000)').run(OLLY, L2);
  const terms = signedTerms(db, { triggers: [['referral_kyc_approved', 12000, null]], currency: 'EUR' });
  await fireCommissionEvent(env(db), MAX, 'referral_kyc_approved', `kyc:${MAX}`);
  assert.deepEqual(commissionsOf(db, PIA), [{ amount_cents: 12000, currency: 'EUR', source_type: 'kyc_approved', source_id: `kyc:${MAX}`, terms_id: terms,
    description: 'Under signed terms: $50 flat when a referred user completes KYC' }]);
  assert.deepEqual(commissionsOf(db, L2), [], 'a commission under terms pays no L2 bonus');
  await fireCommissionEvent(env(db), MAX, 'referral_kyc_approved', `kyc:${MAX}`);
  assert.equal(commissionsOf(db, PIA).length, 1, 'idempotent on (user, source type, source id)');
  // Quin has no terms: the standard rule pays, and the L2 bonus follows.
  await fireCommissionEvent(env(db), OLLY, 'referral_kyc_approved', `kyc:${OLLY}`);
  assert.deepEqual(commissionsOf(db, QUIN).map((c: any) => [c.amount_cents, c.currency, c.terms_id]), [[5000, 'USD', null]]);
  assert.deepEqual(commissionsOf(db, L2).map((c: any) => c.amount_cents), [2500]);
  assert.equal((db.prepare('SELECT status FROM referrals WHERE id = 1').get() as any).status, 'converted');
});

test('the caps: per introduction, then what the overall cap has left after reversals; a spent cap pays nothing; expired terms leave the rule to pay', async () => {
  assert.deepEqual(termsAmount({ terms_id: 1, currency: 'USD', amount_cents: null, percentage_bps: 500, cap_per_intro_cents: 30000, overall_cap_cents: null, paid_so_far_cents: 0 }, 1_000_000),
    { terms_id: 1, amount_cents: 30000, currency: 'USD', capped: 'per_intro' });
  assert.deepEqual(termsAmount({ terms_id: 1, currency: 'USD', amount_cents: 20000, percentage_bps: null, cap_per_intro_cents: null, overall_cap_cents: 50000, paid_so_far_cents: 45000 }, 0),
    { terms_id: 1, amount_cents: 5000, currency: 'USD', capped: 'overall' });
  const db = fixture();
  const terms = signedTerms(db, { overall: 15000, triggers: [['referral_kyc_approved', 12000, null], ['referral_deal_funded', null, 200]], perIntro: 10000 });
  await fireCommissionEvent(env(db), MAX, 'referral_kyc_approved', 'kyc:max');
  await fireCommissionEvent(env(db), NIA, 'referral_kyc_approved', 'kyc:nia');
  assert.deepEqual(commissionsOf(db, PIA).map((c: any) => [c.amount_cents, c.terms_id]), [[10000, terms], [5000, terms]], 'per intro, then the overall cap');
  db.prepare("UPDATE commissions SET reversed_amount_cents = 4000, reversed_at = datetime('now') WHERE source_id = 'kyc:nia'").run();
  await fireCommissionEvent(env(db), NIA, 'referral_deal_funded', 'deal:9', 1_000_000);
  assert.deepEqual(commissionsOf(db, PIA).at(-1)!.amount_cents, 4000, 'a reversal gives the cap back');
  db.prepare("INSERT INTO referrals (id, referrer_id, referred_id, referral_code, status) VALUES (9, ?, ?, 'PIA001', 'pending')").run(PIA, MEMBER);
  await fireCommissionEvent(env(db), MEMBER, 'referral_kyc_approved', 'kyc:mo');
  assert.equal(commissionsOf(db, PIA).length, 3, 'a spent cap pays nothing, and the standard rule does not step in');
  db.prepare("UPDATE referral_partner_terms SET ends_on = ? WHERE id = ?").run(YESTERDAY, terms);
  db.prepare("UPDATE referral_partner_terms SET starts_on = '2020-01-01' WHERE id = ?").run(terms);
  db.prepare("UPDATE referral_partner_terms SET ends_on = '2020-12-31' WHERE id = ?").run(terms);
  await fireCommissionEvent(env(db), MEMBER, 'referral_kyc_approved', 'kyc:mo');
  assert.deepEqual(commissionsOf(db, PIA).at(-1), { amount_cents: 5000, currency: 'USD', source_type: 'kyc_approved', source_id: 'kyc:mo', terms_id: null,
    description: '$50 flat when a referred user completes KYC' }, 'expired terms: the rule pays');
});

test('state is read from the dates: signed before its start, active within, expired after', () => {
  assert.equal(effectiveState({ status: 'signed', starts_on: '2999-01-01', ends_on: null }, '2026-10-26'), 'signed');
  assert.equal(effectiveState({ status: 'signed', starts_on: '2026-01-01', ends_on: null }, '2026-10-26'), 'active');
  assert.equal(effectiveState({ status: 'signed', starts_on: '2026-01-01', ends_on: '2026-10-25' }, '2026-10-26'), 'expired');
  assert.equal(effectiveState({ status: 'ended', starts_on: '2026-01-01', ends_on: null }, '2026-10-26'), 'ended');
  assert.deepEqual(quarterRange('2026-Q4'), { from: '2026-10-01', to: '2027-01-01' });
  assert.equal(quarterRange('2026-Q5'), null);
});

test('the list: segment, terms state, code, introductions and converted; money for the Super Admin only, Paid from completed payouts only', async () => {
  const db = fixture();
  signedTerms(db, { triggers: [['referral_kyc_approved', 12000, null]] });
  db.prepare("INSERT INTO commissions (user_id, amount_cents, currency, source_type, source_id, status, reversed_amount_cents) VALUES (?, 9000, 'USD', 'kyc_approved', 'a', 'paid', 1000)").run(PIA);
  db.prepare("INSERT INTO commissions (user_id, amount_cents, currency, source_type, source_id, status) VALUES (?, 3000, 'EUR', 'kyc_approved', 'b', 'accrued')").run(PIA);
  db.prepare("INSERT INTO payouts (user_id, amount_cents, currency, status, payout_method, completed_at) VALUES (?, 6000, 'USD', 'completed', 'wire', datetime('now'))").run(PIA);
  db.prepare("INSERT INTO payouts (user_id, amount_cents, currency, status, payout_method) VALUES (?, 2000, 'USD', 'requested', 'wire')").run(PIA);
  const hq = await call(db, SUPER, 'GET', '');
  assert.equal(hq.status, 200);
  assert.equal(hq.body.total, 2);
  const pia = hq.body.items.find((x: any) => x.user_id === PIA);
  assert.deepEqual([pia.segment_label, pia.terms_state, pia.code, pia.introductions, pia.converted], ['Event organisers', 'active', 'PIA001', 2, 0]);
  assert.deepEqual(pia.money, { available: true, accrued: [{ currency: 'EUR', cents: 3000 }, { currency: 'USD', cents: 8000 }], paid: [{ currency: 'USD', cents: 6000 }] },
    'accrued less reversals, by currency; paid is completed payouts, never a claimed commission');
  const admin = await call(db, ADMIN, 'GET', '');
  assert.deepEqual(admin.body.items[0].money, { available: false, reason: 'hq_reads', message: 'HQ reads these figures.' }, 'O-MONEY A: never a 0 for an Admin');
  assert.deepEqual((await call(db, ADMIN, 'GET', '?segment=venture_scouts')).body.items.map((x: any) => x.user_id), [QUIN]);
  assert.deepEqual((await call(db, ADMIN, 'GET', '?terms=none')).body.items.map((x: any) => x.user_id), [QUIN]);
  assert.deepEqual((await call(db, ADMIN, 'GET', '?q=pia0')).body.items.map((x: any) => x.user_id), [PIA], 'the code is searched');
  assert.deepEqual((await call(db, ADMIN, 'GET', '?q=%25%25')).body.total, 0, 'a literal %% matches nothing, never every row');
  const paged = await call(db, ADMIN, 'GET', '?limit=1&offset=1&sort=name');
  assert.deepEqual([paged.body.items.map((x: any) => x.user_id), paged.body.total, paged.body.limit], [[QUIN], 2, 1]);
  assert.equal((await call(db, ADMIN, 'GET', '?sort=money')).body.error, 'unknown_sort');
  assert.match(admin.body.facts.join, /By invitation/);
});

test('the summary, the series and the queue: counts per quarter, money gated, the queue oldest first, one partner newest first', async () => {
  const db = fixture();
  signedTerms(db, { triggers: [['referral_kyc_approved', 12000, null]] });
  const q = (await call(db, SUPER, 'GET', '/summary')).body;
  assert.deepEqual([q.active_partners, q.with_signed_terms, q.waiting_to_sign, q.introductions], [2, 1, 0, 2]);
  assert.deepEqual(q.money, { available: true, accrued: [], paid: [] });
  assert.equal((await call(db, ADMIN, 'GET', '/summary')).body.money.reason, 'hq_reads');
  assert.equal((await call(db, ADMIN, 'GET', '/summary?quarter=2025-Q1')).body.introductions, 1, 'Quin’s January 2025 introduction');
  assert.equal((await call(db, ADMIN, 'GET', '/summary?quarter=Q1')).body.error, 'invalid_quarter');
  const s = (await call(db, SUPER, 'GET', '/series')).body;
  assert.deepEqual(s.introductions.map((x: any) => [x.segment, x.outcome, x.n]), [['event_organisers', 'pending', 2]]);
  assert.equal(s.commission.available, true);
  assert.equal((await call(db, ADMIN, 'GET', '/series')).body.commission.reason, 'hq_reads');
  const a = (await call(db, ADMIN, 'POST', '/terms', draft({ user_id: QUIN }))).body.uid;
  const b = (await call(db, ADMIN, 'POST', '/terms', draft({ user_id: QUIN, starts_on: '2040-01-01' }))).body.uid;
  db.prepare("UPDATE referral_partner_terms SET status = 'submitted', submitted_at = '2026-10-02 09:00:00' WHERE uid = ?").run(b);
  db.prepare("UPDATE referral_partner_terms SET status = 'submitted', submitted_at = '2026-10-03 09:00:00' WHERE uid = ?").run(a);
  const queue = (await call(db, ADMIN, 'GET', '/terms')).body;
  assert.deepEqual([queue.items.map((t: any) => t.uid), queue.total], [[b, a], 2]);
  db.prepare("UPDATE referral_partner_terms SET created_at = '2026-10-01 09:00:00' WHERE uid = ?").run(a);
  db.prepare("UPDATE referral_partner_terms SET created_at = '2026-10-04 09:00:00' WHERE uid = ?").run(b);
  assert.deepEqual((await call(db, ADMIN, 'GET', `/${QUIN}/terms`)).body.items.map((t: any) => t.uid), [b, a], 'one partner’s terms, newest first');
  assert.equal((await call(db, ADMIN, 'GET', `/${MAX}/terms`)).body.error, 'referral_partner_not_found');
});

test('the rules read says which rules an event fires (OD4 open: only the identity check)', async () => {
  const db = fixture();
  const rules = await call(db, SUPER, 'GET', '/admin/commission-rules', undefined, '/api/network');
  assert.equal(rules.status, 200);
  const fires = Object.fromEntries(rules.body.map((r: any) => [r.rule_key, r.fires]));
  assert.deepEqual(fires, { referral_deal_funded: false, referral_kyc_approved: true, referral_lp_onboarded: false, referral_partner_fee: false, referral_spinout: false });
});

test('the e-sign completion hook signs terms by envelope, in its own try, beside the partner-deal activator', () => {
  const src = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/esign.ts'), 'utf8');
  const at = src.indexOf('await onReferralTermsEnvelopeCompleted(c.env, rec.envelope_id);');
  assert.ok(at > 0, 'the completion hook calls the terms signer');
  assert.ok(at > src.indexOf('activatePartnerDealOnSignature(c.env, rec.envelope_id)'), 'after the partner-deal activator');
  assert.ok(src.lastIndexOf('try {', at) > src.lastIndexOf('}', at - 80), 'in its own try, so it never fails the signature');
});

test('a standard rule HQ switched off pays nothing; signed terms on the same trigger still pay', async () => {
  const db = fixture();
  await fireCommissionEvent(env(db), MAX, 'referral_kyc_approved', 'warm-up');
  db.prepare("UPDATE commission_rules SET active = 0 WHERE rule_key = 'referral_kyc_approved'").run();
  await fireCommissionEvent(env(db), OLLY, 'referral_kyc_approved', `kyc:${OLLY}`);
  assert.deepEqual(commissionsOf(db, QUIN), [], 'no terms, and the rule is off');
  const terms = signedTerms(db, { triggers: [['referral_kyc_approved', 7000, null]] });
  await fireCommissionEvent(env(db), NIA, 'referral_kyc_approved', `kyc:${NIA}`);
  assert.deepEqual(commissionsOf(db, PIA).map((c: any) => [c.source_id, c.amount_cents, c.terms_id]), [['warm-up', 5000, null], [`kyc:${NIA}`, 7000, terms]]);
});
