/**
 * D4289 P1 (#4290) — the Influencer program and its membership: the migration,
 * applying, HQ's decisions, changes, the Investor Pro grant, the tier defaults
 * and the key in every program list.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/influencer_program_d4290.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import influencerRoute from '../src/routes/influencer.ts';
import adminInfluencers from '../src/routes/admin_influencers.ts';
import partnersRoute, { readTermsInput } from '../src/routes/admin_referral_partners.ts';
import {
  CONSENT_VERSION, INFLUENCER_RULE, REAPPLY_DAYS, applyAsInfluencer, influencerActive, influencerMe, reapplyAfter,
} from '../src/services/influencers.ts';
import { INFLUENCER_ACTIONS } from '../src/services/influencerActions.ts';
import { PROGRAM_KEYS } from '../src/services/programRegistry.ts';
import { PROGRAM_ACTIVITY_ACTIONS } from '../src/services/programActivity.ts';
import { PROGRAMS } from '../src/services/programGrants.ts';
import { REQUESTABLE_PROGRAMS } from '../src/services/escalationRequests.ts';
import { programCatalogue } from '../src/services/programCatalogue.ts';
import { effectiveInvestorTier } from '../src/middleware/requireInvestorTier.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d4290-0123456789-abcdef'; // synthetic test fixture
const SUPER = 1, ADMIN = 2, ANA = 3, BEN = 4, CARA = 5, DEV = 6;
const MIGRATION = 'cloudflare-worker/sql/migrations/202611031502_influencer_program.sql';
const NOW = Date.parse('2026-11-03T12:00:00Z');

const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();
/** The migration's seed rows, which a schema-only replay leaves out. */
const SEEDS = (() => {
  const sql = readFileSync(MIGRATION, 'utf8');
  const at = sql.indexOf("INSERT OR IGNORE INTO influencer_tier_defaults");
  return sql.slice(at, sql.indexOf(';', at) + 1);
})();

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a trigger naming an object replayed later */ } }
  db.exec(SEEDS);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, email_verified) VALUES (?, ?, ?, ?, 1, 1)');
  u.run(SUPER, 'admin', 'Sue Super', 'sue@example.test');
  u.run(ADMIN, 'admin', 'Pat Plain', 'pat@example.test');
  u.run(ANA, 'founder', 'Ana Creator', 'ana@example.test');
  u.run(BEN, 'investor', 'Ben Payer', 'ben@example.test');
  u.run(CARA, 'advisor', 'Cara Writer', 'cara@example.test');
  u.run(DEV, 'partner', 'Dev Scout', 'dev@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  for (const id of [SUPER, ADMIN, ANA, BEN, CARA, DEV]) {
    db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))").run(id, `totp-${id}`);
  }
  // Ben pays for Professional himself; Dev is already a referral partner.
  db.prepare("UPDATE users SET investor_tier = 'professional', investor_subscription_status = 'active', investor_stripe_subscription_id = 'sub_ben' WHERE id = ?").run(BEN);
  db.prepare("INSERT INTO referral_partners (user_id, segment, added_by) VALUES (?, 'venture_scouts', ?)").run(DEV, SUPER);
  return db;
}

const app = new Hono<any>();
app.route('/api/influencer', influencerRoute);
app.route('/api/admin/influencers', adminInfluencers);
app.route('/api/admin/referral-partners', partnersRoute);
app.onError((err) => {
  const m = String((err as Error)?.message || '');
  if (m === 'Unauthorized') return new Response(JSON.stringify({ error: m }), { status: 401 });
  if (/required|step_up|factor|HQ only/i.test(m)) return new Response(JSON.stringify({ error: m }), { status: 403 });
  throw err;
});

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown, extra: Record<string, unknown> = {}) {
  const role = (db.prepare('SELECT role FROM users WHERE id = ?').get(who) as any)?.role ?? 'founder';
  const token = await new SignJWT({ user_id: who, role, jti: `totp-${who}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error, console.log]; console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try {
    const res = await withThrownResponses(() => app.request(path, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...extra } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error, console.log] = saved; }
}

const ANSWERS = {
  channels: [{ kind: 'youtube', url: 'https://youtube.com/@ana', audience: 42000 }, { kind: 'newsletter', url: 'https://ana.example/news' }],
  regions: ['Europe'], topics: ['Venture building'], why: 'My audience builds companies and needs a studio.',
  consent_version: CONSENT_VERSION, consent: { disclosure: true, no_deal_promotion: true, no_self_referral: true },
};
const row = (db: DatabaseSync, sql: string, ...a: any[]) => db.prepare(sql).get(...a) as any;
const rows = (db: DatabaseSync, sql: string, ...a: any[]) => db.prepare(sql).all(...a) as any[];
const apply = (db: DatabaseSync, who: number, body: unknown = ANSWERS) => call(db, who, 'POST', '/api/influencer/apply', body);
const decide = (db: DatabaseSync, who: number, uid: string, body: unknown) => call(db, who, 'POST', `/api/admin/influencers/applications/${uid}/decision`, body);
const REASON = 'Reviewed at the weekly HQ influencer meeting.';

// ---- the migration ---------------------------------------------------------------

test('the migration widens both segment CHECKs and the grant defaults CHECK, keeping every row, id and high-water mark', () => {
  // Mutation checked: leave out the sequence restore → the next partner reuses id 7.
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: true });
  loadSchema(db, { below: 202611031502 });
  db.exec("INSERT INTO users (id, role, name, email, is_active) VALUES (1, 'admin', 'A', 'a@example.test', 1), (2, 'founder', 'B', 'b@example.test', 1), (3, 'founder', 'C', 'c@example.test', 1)");
  db.exec("INSERT INTO referral_partners (id, user_id, segment, added_by) VALUES (5, 2, 'deal_makers', 1), (7, 3, 'venture_scouts', 1)");
  db.exec('DELETE FROM referral_partners WHERE id = 7');
  // An empty table with a high-water mark: terms ids 1 to 11 were used and deleted.
  db.exec("INSERT INTO referral_partner_terms (id, uid, partner_id, segment, status, starts_on, created_by) VALUES (11, 'rpt_gone', 5, 'deal_makers', 'draft', '2026-10-01', 1)");
  db.exec("DELETE FROM referral_partner_terms WHERE id = 11");
  db.exec("UPDATE program_grant_defaults SET fee_cents = 5000 WHERE program_key = 'perks'");
  // D1 applies a migration file as one transaction, which is where its deferred foreign keys are checked.
  db.exec('BEGIN');
  db.exec(readFileSync(MIGRATION, 'utf8'));
  db.exec('COMMIT');
  assert.deepEqual(rows(db, 'SELECT id, user_id, segment FROM referral_partners').map((r) => ({ ...r })), [{ id: 5, user_id: 2, segment: 'deal_makers' }]);
  assert.equal(row(db, 'SELECT COUNT(*) AS n FROM referral_partner_terms').n, 0);
  db.exec("INSERT INTO referral_partners (user_id, segment, added_by) VALUES (3, 'influencers', 1)");
  assert.equal(row(db, 'SELECT id FROM referral_partners WHERE user_id = 3').id, 8, 'the high-water mark survives the rebuild');
  db.exec("INSERT INTO referral_partner_terms (uid, partner_id, segment, status, starts_on, created_by) VALUES ('rpt_two', 8, 'influencers', 'draft', '2026-11-03', 1)");
  assert.equal(row(db, "SELECT id FROM referral_partner_terms WHERE uid = 'rpt_two'").id, 12, 'an emptied table keeps its high-water mark too');
  assert.throws(() => db.exec("INSERT INTO referral_partners (user_id, segment, added_by) VALUES (1, 'scouts', 1)"), /CHECK/);
  assert.equal(row(db, "SELECT fee_cents FROM program_grant_defaults WHERE program_key = 'perks'").fee_cents, 5000, 'defaults kept');
  assert.deepEqual({ ...row(db, "SELECT grantable, requires_signed_schedule FROM program_grant_defaults WHERE program_key = 'influencer'") }, { grantable: 0, requires_signed_schedule: 1 });
  assert.deepEqual(rows(db, 'PRAGMA foreign_key_check'), [], 'no foreign key left dangling');
  // The registry row, its published How it runs and its draft copy.
  assert.deepEqual({ ...row(db, "SELECT grp, join_method, status, position FROM programs WHERE key = 'influencer'") },
    { grp: 'Network and referrals', join_method: 'By application', status: 'partly_built', position: 10 });
  assert.deepEqual(rows(db, "SELECT section_key FROM program_playbook_sections WHERE program_key = 'influencer' AND version = 1 ORDER BY position").map((r) => r.section_key),
    ['purpose', 'who', 'join', 'rewards', 'terms', 'measure', 'admin-tools']);
  assert.equal(row(db, "SELECT COUNT(*) AS n FROM program_playbook_sections WHERE program_key = 'influencer' AND version = 0").n, 7);
  assert.equal(row(db, "SELECT COUNT(*) AS n FROM program_playbook_versions WHERE program_key = 'influencer'").n, 1);
  // The owner's tier table is the seed: rates in basis points, Strategic Partner's negotiated (null).
  assert.deepEqual(rows(db, 'SELECT tier, percentage_bps, duration_invoices FROM influencer_tier_defaults ORDER BY position').map((r) => [r.tier, r.percentage_bps, r.duration_invoices]),
    [['affiliate_creator', 2000, 12], ['verified_influencer', 2500, 12], ['strategic_creator', 3000, 12], ['strategic_partner', null, null]]);
  const sql = readFileSync(MIGRATION, 'utf8');
  assert.doesNotMatch(sql, /\bBEGIN TRANSACTION\b|\bCOMMIT\b|RENAME TO/i, 'no transaction, and every table rebuilt under its own name');
});

test('influencer_events is append-only, and one open application per member is the store\'s rule', () => {
  const db = fixture();
  db.exec("INSERT INTO influencer_applications (uid, user_id, answers_json, consent_version) VALUES ('ifa_1', 3, '{}', 'v1')");
  assert.throws(() => db.exec("INSERT INTO influencer_applications (uid, user_id, answers_json, consent_version) VALUES ('ifa_2', 3, '{}', 'v1')"), /UNIQUE/);
  db.exec("INSERT INTO influencer_events (user_id, event) VALUES (3, 'applied')");
  assert.throws(() => db.exec("UPDATE influencer_events SET event = 'admitted'"), /append-only/);
  assert.throws(() => db.exec('DELETE FROM influencer_events'), /append-only/);
  assert.throws(() => db.exec("UPDATE influencer_applications SET status = 'declined' WHERE uid = 'ifa_1'"), /CHECK/, 'a decline needs who, when and a reason');
});

// ---- applying -------------------------------------------------------------------

test('apply: every answer and each rule of the terms is checked; one open application; the store keeps what was asked', async () => {
  // Mutation checked: drop the no_self_referral consent check → a body missing it is saved.
  const db = fixture();
  for (const [body, code] of [
    [{ ...ANSWERS, channels: [] }, 'channels_required'],
    [{ ...ANSWERS, channels: [{ kind: 'myspace', url: 'https://x.example' }] }, 'channel_invalid'],
    [{ ...ANSWERS, channels: [{ kind: 'x', url: 'javascript:alert(1)' }] }, 'channel_invalid'],
    [{ ...ANSWERS, channels: [{ kind: 'x', url: 'https://x.com/ana', audience: -3 }] }, 'audience_invalid'],
    [{ ...ANSWERS, regions: [] }, 'regions_required'],
    [{ ...ANSWERS, topics: ['ok', ''] }, 'topics_required'],
    [{ ...ANSWERS, why: '  ' }, 'why_required'],
    [{ ...ANSWERS, consent_version: '2025-01-01' }, 'terms_version'],
    [{ ...ANSWERS, consent: { disclosure: true, no_deal_promotion: true } }, 'terms_not_accepted'],
  ] as const) {
    const r = await apply(db, ANA, body);
    assert.deepEqual([r.status, r.body.error], [400, code], code);
  }
  assert.equal(row(db, 'SELECT COUNT(*) AS n FROM influencer_applications').n, 0, 'nothing saved');
  const ok = await apply(db, ANA);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.deepEqual([ok.body.application.status, ok.body.application.consent_version], ['applied', CONSENT_VERSION]);
  assert.equal(ok.body.application.answers.channels[0].audience, 42000);
  const again = await apply(db, ANA);
  assert.deepEqual([again.status, again.body.error, again.body.application?.uid], [409, 'application_open', ok.body.application.uid], 'the open one is named');
  assert.deepEqual(rows(db, 'SELECT event, actor_user_id FROM influencer_events').map((r) => [r.event, r.actor_user_id]), [['applied', ANA]]);
  // A branch does not run it.
  assert.deepEqual([(await call(db, CARA, 'POST', '/api/influencer/apply', ANSWERS, { BRANCH_CODE: 'fr' })).body.error], ['hq_program']);
  // Me reads it.
  const me = await call(db, ANA, 'GET', '/api/influencer/me');
  assert.deepEqual([me.body.membership, me.body.application.status, me.body.reapply_after], [null, 'applied', null]);
});

test('a decline dates the 90-day wait; HQ asking for more is answered by applying again', async () => {
  // Mutation checked: count the wait from the application, not the decision → the retry date moves.
  const db = fixture();
  const a = (await apply(db, ANA)).body.application;
  assert.deepEqual([(await decide(db, ADMIN, a.uid, { decline: 'short' })).body.error], ['reason_required']);
  const d = await decide(db, ADMIN, a.uid, { decline: 'Your channels are under the audience we admit at.' });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.equal(d.body.application.reason, 'Your channels are under the audience we admit at.');
  db.prepare("UPDATE influencer_applications SET decided_at = '2026-10-01 09:00:00' WHERE uid = ?").run(a.uid);
  assert.equal(REAPPLY_DAYS, 90);
  assert.equal(reapplyAfter({ status: 'declined', decided_at: '2026-10-01 09:00:00' }, NOW), '2026-12-30');
  assert.equal(reapplyAfter({ status: 'declined', decided_at: '2026-07-01 09:00:00' }, NOW), null, 'past the wait');
  await assert.rejects(applyAsInfluencer({ DB: d1Over(db) } as any, ANA, ANSWERS, NOW), (e: any) => e.code === 'reapply_later' && e.extra.reapply_after === '2026-12-30');
  assert.equal((await influencerMe({ DB: d1Over(db) } as any, ANA, NOW)).reapply_after, '2026-12-30');
  // After the wait, a new application.
  const later = await applyAsInfluencer({ DB: d1Over(db) } as any, ANA, ANSWERS, Date.parse('2027-01-02T00:00:00Z'));
  assert.equal(later.status, 'applied');
  // Ask for more, then the answer.
  const m = await decide(db, ADMIN, later.uid, { more: 'Which of your channels reach founders?' });
  assert.equal(m.body.application.status, 'more_requested');
  assert.deepEqual([(await decide(db, ADMIN, later.uid, { more: 'And which reach investors?' })).body.error], ['awaiting_applicant']);
  const answered = await apply(db, ANA, { ...ANSWERS, why: 'YouTube reaches founders; the newsletter reaches angels.' });
  assert.deepEqual([answered.status, answered.body.application.uid, answered.body.application.status], [200, later.uid, 'applied']);
  assert.equal(answered.body.application.answers.why, 'YouTube reaches founders; the newsletter reaches angels.');
  // Notices tell the applicant, with the reason or the question.
  const notes = rows(db, "SELECT type, body FROM notifications_inbox WHERE user_id = ? ORDER BY id", ANA);
  assert.deepEqual(notes.map((n) => n.type), ['influencer_declined', 'influencer_more_requested']);
  assert.match(notes[1].body, /Which of your channels reach founders\?/);
});

// ---- admitting --------------------------------------------------------------------

test('admit: the membership, the referral partner in the influencers segment, draft terms from the tier, Investor Pro; decided once', async () => {
  // Mutation checked: copy a literal rate instead of the tier's → the trigger's bps no longer follows Settings.
  const db = fixture();
  db.prepare("UPDATE influencer_tier_defaults SET percentage_bps = 2700 WHERE tier = 'verified_influencer'").run();
  const a = (await apply(db, ANA)).body.application;
  assert.equal((await decide(db, ANA, a.uid, { admit: 'verified_influencer' })).status, 403, 'a member decides nothing');
  assert.deepEqual([(await decide(db, ADMIN, a.uid, { admit: 'superstar' })).body.error], ['unknown_tier']);
  assert.deepEqual([(await decide(db, ADMIN, a.uid, { admit: 'verified_influencer', decline: 'x' })).body.error], ['invalid_decision']);
  const r = await decide(db, ADMIN, a.uid, { admit: 'verified_influencer' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.application.status, r.body.membership.tier, r.body.membership.status, r.body.membership.investor_pro], ['admitted', 'verified_influencer', 'active', true]);
  const partner = row(db, 'SELECT id, segment FROM referral_partners WHERE user_id = ?', ANA);
  assert.equal(partner.segment, 'influencers');
  const terms = row(db, 'SELECT * FROM referral_partner_terms WHERE uid = ?', r.body.terms_uid);
  assert.deepEqual([terms.status, terms.segment, terms.partner_id, terms.starts_on.length], ['draft', 'influencers', partner.id, 10], 'a draft: nothing is paid until approved and signed');
  assert.deepEqual({ ...row(db, 'SELECT rule_key, amount_cents, percentage_bps FROM referral_partner_term_triggers WHERE terms_id = ?', terms.id) },
    { rule_key: INFLUENCER_RULE, amount_cents: null, percentage_bps: 2700 });
  // The draft is editable: its trigger passes the terms check, as P3 will fire it.
  assert.ok(!('code' in (readTermsInput({ starts_on: '2026-11-03', triggers: [{ rule_key: INFLUENCER_RULE, percentage_bps: 2700 }] }) as any)));
  // Investor Pro, through the granted-tier columns.
  const u = row(db, 'SELECT investor_tier, investor_subscription_status FROM users WHERE id = ?', ANA);
  assert.deepEqual([u.investor_tier, u.investor_subscription_status], ['professional', 'influencer_grant']);
  assert.equal(effectiveInvestorTier(row(db, 'SELECT * FROM users WHERE id = ?', ANA)), 'professional');
  assert.equal(await influencerActive({ DB: d1Over(db) } as any, ANA), 1);
  // Decided once.
  assert.deepEqual([(await decide(db, SUPER, a.uid, { decline: 'Changed my mind about this one.' })).body.error], ['application_decided']);
  assert.deepEqual([(await apply(db, ANA)).body.error], ['already_influencer']);
  // The audit and the notice.
  assert.deepEqual(rows(db, "SELECT action FROM admin_audit_log WHERE action LIKE 'influencer.%'").map((x) => x.action), [INFLUENCER_ACTIONS.admitted]);
  assert.equal(row(db, "SELECT type FROM notifications_inbox WHERE user_id = ?", ANA).type, 'influencer_admitted');
  assert.deepEqual(rows(db, 'SELECT event FROM influencer_events ORDER BY id').map((x) => x.event), ['applied', 'admitted']);
});

test('admit keeps a member\'s own plan and their partner row; Strategic Partner\'s negotiated rate drafts no trigger', async () => {
  // Mutation checked: let the grant overwrite a paid plan → Ben's own subscription becomes the grant.
  const db = fixture();
  const ben = (await apply(db, BEN)).body.application;
  assert.equal((await decide(db, ADMIN, ben.uid, { admit: 'affiliate_creator' })).status, 200);
  const u = row(db, 'SELECT investor_tier, investor_subscription_status FROM users WHERE id = ?', BEN);
  assert.deepEqual([u.investor_tier, u.investor_subscription_status], ['professional', 'active'], 'his paid plan stays his');
  assert.equal(row(db, 'SELECT investor_grant FROM influencers WHERE user_id = ?', BEN).investor_grant, 0);
  // Cara pays for Plus: the grant would raise her tier, but it would overwrite her own subscription, so it does not.
  db.prepare("UPDATE users SET investor_tier = 'plus', investor_subscription_status = 'active' WHERE id = ?").run(CARA);
  const cara = (await apply(db, CARA)).body.application;
  assert.equal((await decide(db, ADMIN, cara.uid, { admit: 'affiliate_creator' })).status, 200);
  assert.deepEqual({ ...row(db, 'SELECT investor_tier, investor_subscription_status FROM users WHERE id = ?', CARA) }, { investor_tier: 'plus', investor_subscription_status: 'active' });
  const dev = (await apply(db, DEV)).body.application;
  const r = await decide(db, ADMIN, dev.uid, { admit: 'strategic_partner' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(row(db, 'SELECT segment FROM referral_partners WHERE user_id = ?', DEV).segment, 'venture_scouts', 'an existing partner keeps their row');
  const t = row(db, 'SELECT id, segment FROM referral_partner_terms WHERE uid = ?', r.body.terms_uid);
  assert.equal(t.segment, 'venture_scouts');
  assert.equal(row(db, 'SELECT COUNT(*) AS n FROM referral_partner_term_triggers WHERE terms_id = ?', t.id).n, 0, 'a negotiated rate is HQ\'s to write');
  // Pausing Ben takes back nothing that was not given.
  await call(db, ADMIN, 'PATCH', `/api/admin/influencers/${r.body.membership ? row(db, 'SELECT uid FROM influencers WHERE user_id = ?', BEN).uid : ''}`, { status: 'paused', reason: REASON });
  assert.equal(row(db, 'SELECT investor_subscription_status FROM users WHERE id = ?', BEN).investor_subscription_status, 'active');
});

// ---- changes ------------------------------------------------------------------------

test('PATCH: tier, pause, resume and end, each with a reason; the grant follows the status; an end is final', async () => {
  // Mutation checked: skip the revoke on pause → Ana keeps Investor Pro while paused.
  const db = fixture();
  const a = (await apply(db, ANA)).body.application;
  await decide(db, ADMIN, a.uid, { admit: 'affiliate_creator' });
  const uid = row(db, 'SELECT uid FROM influencers WHERE user_id = ?', ANA).uid;
  const patch = (body: unknown, who = ADMIN) => call(db, who, 'PATCH', `/api/admin/influencers/${uid}`, body);
  assert.deepEqual([(await patch({ status: 'paused' })).body.error], ['reason_required']);
  assert.deepEqual([(await patch({ reason: REASON })).body.error], ['nothing_to_change']);
  assert.deepEqual([(await patch({ status: 'gone', reason: REASON })).body.error], ['unknown_status']);
  assert.equal((await patch({ status: 'paused', reason: REASON }, ANA)).status, 403);
  const tier = await patch({ tier: 'strategic_creator', reason: REASON });
  assert.deepEqual([tier.status, tier.body.membership.tier, tier.body.events], [200, 'strategic_creator', ['tier_changed']]);
  const paused = await patch({ status: 'paused', reason: REASON });
  assert.deepEqual([paused.body.membership.status, paused.body.membership.investor_pro], ['paused', false]);
  assert.deepEqual({ ...row(db, 'SELECT investor_tier, investor_subscription_status FROM users WHERE id = ?', ANA) }, { investor_tier: 'free', investor_subscription_status: 'influencer_ended' });
  assert.equal(await influencerActive({ DB: d1Over(db) } as any, ANA), 0, 'the sidebar row goes with it');
  const resumed = await patch({ status: 'active', reason: REASON });
  assert.deepEqual([resumed.body.events, resumed.body.membership.investor_pro], [['resumed'], true]);
  assert.deepEqual([(await patch({ status: 'active', reason: REASON })).body.error], ['nothing_changed']);
  const ended = await patch({ status: 'ended', reason: REASON });
  assert.deepEqual([ended.body.membership.status, ended.body.membership.investor_pro], ['ended', false]);
  assert.deepEqual([(await patch({ status: 'active', reason: REASON })).body.error], ['influencer_ended']);
  assert.deepEqual(rows(db, "SELECT event FROM influencer_events WHERE influencer_id IS NOT NULL ORDER BY id").map((x) => x.event),
    ['admitted', 'tier_changed', 'paused', 'resumed', 'ended']);
  assert.deepEqual(rows(db, "SELECT action FROM admin_audit_log WHERE action LIKE 'influencer.%' ORDER BY id").map((x) => x.action),
    [INFLUENCER_ACTIONS.admitted, INFLUENCER_ACTIONS.tier, INFLUENCER_ACTIONS.paused, INFLUENCER_ACTIONS.resumed, INFLUENCER_ACTIONS.ended]);
  // An ended member may apply again, and admitting them reopens the one membership row.
  const again = await applyAsInfluencer({ DB: d1Over(db) } as any, ANA, ANSWERS, NOW);
  const back = await decide(db, ADMIN, again.uid, { admit: 'verified_influencer' });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.deepEqual([back.body.membership.uid, back.body.membership.status], [uid, 'active']);
});

// ---- HQ's reads and settings -------------------------------------------------------

test('the queue: HQ only, oldest first, with counts; the tier defaults: read by HQ and the public page, changed by the Super Admin', async () => {
  // Mutation checked: let a plain admin write the defaults → the 403 becomes 200.
  const db = fixture();
  await apply(db, ANA);
  await apply(db, CARA);
  assert.equal((await call(db, ANA, 'GET', '/api/admin/influencers/applications')).status, 403);
  const q = await call(db, ADMIN, 'GET', '/api/admin/influencers/applications?status=applied');
  assert.deepEqual(q.body.applications.map((x: any) => x.applicant.user_id), [ANA, CARA]);
  assert.deepEqual(q.body.counts, { applied: 2, more_requested: 0 });
  assert.deepEqual([(await call(db, ADMIN, 'GET', '/api/admin/influencers/applications?status=maybe')).body.error], ['invalid_status']);
  assert.ok((await call(db, ADMIN, 'GET', '/api/admin/influencers/applications', undefined, { BRANCH_CODE: 'fr' })).status >= 400, 'a branch is refused');
  // The public tier table reads the stored rates, never typed ones.
  const pub = await app.request('/api/influencer/tiers', {}, { DB: d1Over(db) } as any);
  const tiers = (await pub.json() as any).tiers;
  assert.deepEqual(tiers.map((t: any) => [t.tier, t.percentage_bps]), [['affiliate_creator', 2000], ['verified_influencer', 2500], ['strategic_creator', 3000], ['strategic_partner', null]]);
  assert.deepEqual([(await call(db, ADMIN, 'PUT', '/api/admin/influencers/tier-defaults/verified_influencer', { percentage_bps: 2600 })).body.error], ['super_admin_required'], 'a plain admin');
  assert.deepEqual([(await call(db, SUPER, 'PUT', '/api/admin/influencers/tier-defaults/verified_influencer', { percentage_bps: 0 })).body.error], ['invalid_rate']);
  assert.deepEqual([(await call(db, SUPER, 'PUT', '/api/admin/influencers/tier-defaults/verified_influencer', { currency: 'usd' })).body.error], ['invalid_currency']);
  assert.equal((await call(db, SUPER, 'PUT', '/api/admin/influencers/tier-defaults/nope', {})).status, 404);
  const w = await call(db, SUPER, 'PUT', '/api/admin/influencers/tier-defaults/verified_influencer', { percentage_bps: 2600, offer_budget_cents: 50000 });
  assert.equal(w.status, 200, JSON.stringify(w.body));
  assert.deepEqual([w.body.tier.percentage_bps, w.body.tier.duration_invoices, w.body.tier.offer_budget_cents], [2600, 12, 50000]);
  assert.equal(row(db, "SELECT action FROM admin_audit_log WHERE action = ?", INFLUENCER_ACTIONS.defaults).action, INFLUENCER_ACTIONS.defaults);
});

test('an influencer joins by application: Add partner refuses the influencers segment', async () => {
  const db = fixture();
  const r = await call(db, SUPER, 'POST', '/api/admin/referral-partners', { user_id: CARA, segment: 'influencers' });
  assert.deepEqual([r.status, r.body.error], [400, 'segment_by_application']);
  const p = await call(db, SUPER, 'PATCH', `/api/admin/referral-partners/${DEV}`, { segment: 'influencers' });
  assert.deepEqual([p.status, p.body.error], [400, 'segment_by_application']);
});

// ---- the key in every list ---------------------------------------------------------

test('influencer is in every program list, HQ-run, and its writes are its Activity', () => {
  assert.equal(PROGRAM_KEYS.at(-1), 'influencer');
  assert.deepEqual(PROGRAMS.find((p) => p.key === 'influencer'), { key: 'influencer', name: 'Influencers', group: 'Network and referrals', readiness: 'hq' });
  assert.ok((REQUESTABLE_PROGRAMS as readonly string[]).includes('influencer'));
  assert.deepEqual([...PROGRAM_ACTIVITY_ACTIONS.influencer], Object.values(INFLUENCER_ACTIONS));
  const fe = readFileSync('frontend/src/lib/programGrants.js', 'utf8');
  assert.match(fe, /\{ key: 'influencer', name: 'Influencers', group: 'Network and referrals', grant: 'hq'/);
  // /me carries the flag the sidebar row reads.
  const auth = readFileSync('cloudflare-worker/src/routes/auth.ts', 'utf8');
  assert.match(auth, /const influencer_active = await influencerActive\(c\.env, Number\(user\.id\)\);/);
  assert.match(auth, /\n {4}influencer_active,\n/);
});

test('the Programs catalogue card: active influencers, and the applications waiting on HQ as Needs you', async () => {
  // Mutation checked: count more_requested as waiting on HQ → Needs you reads 2.
  const db = fixture();
  db.exec("INSERT INTO programs (key, grp, name, status, position) VALUES ('influencer', 'Network and referrals', 'Influencers', 'partly_built', 10)");
  await apply(db, ANA);
  const cara = (await apply(db, CARA)).body.application;
  await decide(db, ADMIN, cara.uid, { more: 'Which of your channels reach founders?' });
  const ben = (await apply(db, BEN)).body.application;
  await decide(db, ADMIN, ben.uid, { admit: 'affiliate_creator' });
  const saved = console.warn; console.warn = () => {};
  try {
    const out: any = await programCatalogue({ DB: d1Over(db), ENVIRONMENT: 'development' } as any, { id: SUPER, superAdmin: true }, 4 as any);
    const card = out.programs.rows.find((r: any) => r.key === 'influencer');
    assert.deepEqual(card.figures, { influencers: { available: true, count: 1 } });
    assert.deepEqual([card.needs_you.available, card.needs_you.count], [true, 1], 'Ana waits on HQ; Cara\'s answer is hers to give');
  } finally { console.warn = saved; }
});
