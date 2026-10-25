// D927 (#2723): the Partner invitations reads — overview, one invitation, the offer preview —
// and the resend reply's signing_link. Real migrated SQLite, synthetic accounts, local mail.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { envFor, token } from './_esign_harness.ts';
import adminPartners from '../src/routes/admin_partners.ts';
import adminPartnersReads from '../src/routes/admin_partners_reads.ts';
import { agreementReadiness, offerPreview, readInvitation, readOverview } from '../src/services/partnerInvitationReads.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';

const read = (p: string) => readFileSync(p, 'utf8');
const scratch = mkdtempSync(join(tmpdir(), 'partner-d927-'));
const seed = join(scratch, 'schema.sqlite');
const schema = new DatabaseSync(seed, { enableForeignKeyConstraints: false });
schema.exec(read('cloudflare-worker/sql/schema_baseline.sql'));
for (const name of readdirSync('cloudflare-worker/sql/migrations').filter(n => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()) schema.exec(read('cloudflare-worker/sql/migrations/' + name));
schema.close();
after(() => rmSync(scratch, { recursive: true, force: true }));

// Wednesday 21 October 2026, noon UTC; its Monday is 19 October.
const NOW = Date.parse('2026-10-21T12:00:00Z');
let serial = 0;

function fixture() {
  const file = join(scratch, `${++serial}.sqlite`); copyFileSync(seed, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false });
  db.exec(`INSERT INTO users(id,role,name,email,is_active,partner_id) VALUES
      (5,'admin','Synthetic inviter','inviter@example.invalid',1,NULL),
      (8,'admin','Synthetic resender','resender@example.invalid',1,NULL),
      (9,'founder','Synthetic outsider','outsider@example.invalid',1,NULL),
      (20,'partner','Synthetic signed partner','signed@example.invalid',1,1),
      (21,'partner','Synthetic unattached','loose@example.invalid',1,NULL),
      (30,'founder','Synthetic redeemer','redeemer@example.invalid',1,NULL),
      (31,'founder','Synthetic redeemer two','redeemer2@example.invalid',1,NULL);
    INSERT INTO partner_invitations(id,token,recipient_email,recipient_name,invited_by_user_id,allowed_deal_types,personal_message,status,expires_at,created_at,viewed_at,signed_at,envelope_id,last_sent_at,send_count,last_send_ok,last_send_reason) VALUES
      (1,'t1','one@example.invalid','One','5','["custom"]','Message fixture','sent','2026-10-30T00:00:00Z','2026-10-10 10:00:00',NULL,NULL,NULL,'2026-10-18T10:00:00Z',2,0,'refused'),
      (2,'t2','two@example.invalid','Two','5','["custom"]',NULL,'viewed','2026-11-01T00:00:00Z','2026-10-01 10:00:00','2026-10-05 08:00:00',NULL,NULL,'2026-10-01T10:00:00Z',1,1,NULL),
      (3,'t3','three@example.invalid','Three','5','["equity_partnership","capital_partnership","custom"]',NULL,'selected','2026-11-02T00:00:00Z','2026-09-20 10:00:00',NULL,NULL,NULL,NULL,1,NULL,NULL),
      (4,'t4','four@example.invalid','Four','5','["custom"]',NULL,'profiled','2026-10-15T00:00:00Z','2026-09-15 10:00:00',NULL,NULL,NULL,NULL,1,NULL,NULL),
      (5,'t5','five@example.invalid','Five','5','["custom"]',NULL,'signed','2026-09-15T00:00:00Z','2026-09-01 00:00:00',NULL,'2026-09-11 00:00:00',NULL,NULL,1,1,NULL),
      (6,'t6','six@example.invalid','Six','5','["custom"]',NULL,'signed','2026-08-15T00:00:00Z','2026-08-01 00:00:00',NULL,'2026-08-21 00:00:00',NULL,NULL,1,1,NULL),
      (7,'t7','seven@example.invalid','Seven','5','["custom"]',NULL,'revoked','2026-11-15T00:00:00Z','2026-10-02 00:00:00',NULL,NULL,NULL,NULL,1,1,NULL),
      (8,'t8','eight@example.invalid','Eight','5','["custom"]',NULL,'expired','2026-09-01T00:00:00Z','2026-08-10 00:00:00',NULL,NULL,NULL,NULL,1,1,NULL),
      (9,'t9','nine@example.invalid','Nine','5','["custom"]',NULL,'finalized','2026-11-05T00:00:00Z','2026-10-12 00:00:00',NULL,NULL,70,NULL,1,1,NULL);
    INSERT INTO activity_logs(action,details,actor,created_at) VALUES
      ('partner_invitation_viewed','{"invitation_id":3}','h','2026-09-21 09:00:00'),
      ('partner_profile_saved','{"invitation_id":3,"has_capital":true}','h','2026-09-22 09:00:00'),
      ('partner_proposals_generated','{"invitation_id":3,"count":3}','h','2026-09-23 09:00:00'),
      ('partner_proposals_generated','{"invitation_id":3,"count":3}','h','2026-09-25 09:00:00'),
      ('partner_proposal_selected','{"invitation_id":3,"deal_id":4}','h','2026-09-26 09:00:00'),
      ('partner_proposal_selected','{"invitation_id":3,"deal_id":4}','h','2026-10-02 09:00:00'),
      ('partner_envelope_refused','{"invitation_id":3,"code":"template_fields_unfilled","fields":["sender_title"]}','h','2026-10-03 09:00:00'),
      ('partner_proposal_selected','{"invitation_id":33}','h','2026-10-03 09:00:00');
    INSERT INTO partner_profiles(email,invitation_id,full_name,capacity_per_month,capital_capacity_usd,motivation) VALUES
      ('three@example.invalid',3,'Three Profile fixture','8 hrs/month',2000000,'Motivation fixture'),
      ('four@example.invalid',4,'Four Profile fixture',NULL,NULL,NULL);
    INSERT INTO partner_deals(id,invitation_id,user_id,deal_type,proposal_json,status,expires_at,created_at,envelope_id) VALUES
      (1,9,NULL,'custom','{}','awaiting_signature',NULL,'2026-10-12 00:00:00',70),
      (2,5,20,'services_partnership','{}','active','2026-11-10T00:00:00Z','2026-09-11 00:00:00',NULL),
      (3,6,NULL,'equity_partnership','{}','active','2026-10-01T00:00:00Z','2026-08-21 00:00:00',NULL),
      (4,3,NULL,'capital_partnership','{"label":"Capital Partnership"}','proposed',NULL,'2026-09-26 09:00:00',NULL),
      (5,7,NULL,'custom','{}','voided',NULL,'2026-10-02 00:00:00',NULL),
      (6,NULL,NULL,'deal_sourcing_revshare','{}','active','2027-06-01T00:00:00Z','2025-06-01 00:00:00',NULL);
    INSERT INTO partner_referral_redemptions(partner_deal_id,redeemed_by_user_id,attribution_kind,redeemed_at) VALUES
      (2,30,'referral','2026-10-14 10:00:00'),
      (6,30,'deal_sourcing_revshare','2025-11-10 10:00:00'),
      (6,31,'deal_sourcing_revshare','2026-10-20 10:00:00'),
      (6,32,'deal_sourcing_revshare','2025-10-01 10:00:00'),
      (2,31,'referral','2025-11-05 10:00:00');
    INSERT INTO dd_cases(uid,subject_type,subject_id,subject_label,status,owner_user_id) VALUES ('dd-fixture','partner',20,'Partner fixture','open',5);
    INSERT INTO esign_envelopes(id,envelope_uuid,document_type,document_title,document_body,body_sha256,status,created_by,created_at)
      VALUES (70,'env-uuid-fixture','partner_services','Synthetic partnership','Synthetic terms','synthetic','sent',5,'2026-10-12 00:00:00');
    INSERT INTO esign_recipients(envelope_id,recipient_email,signing_token,token_expires_at,status) VALUES (70,'NINE@example.invalid','${'s'.repeat(64)}','2026-10-26T00:00:00Z','pending');
    INSERT INTO esign_audit_events(envelope_id,ts,signer_id,action,meta) VALUES
      (70,'2026-10-13T00:00:00Z',8,'partner_signing_link_renewal_failed','{"link_renewed":false,"previous_link_restored":true,"invitation_id":9}'),
      (70,'2026-10-14T00:00:00Z',8,'partner_signing_link_renewed','{"link_renewed":true,"previous_link_restored":false,"invitation_id":9}');
    INSERT INTO admin_audit_log(admin_user_id,action,filters_json,exported_at) VALUES
      (5,'partner_invitation_created','{"invitation_id":9,"recipient_email":"nine@example.invalid","allowed_deal_types":["custom"],"email_sent":true}','2026-10-12 00:00:00'),
      (8,'partner_invitation_resent','{"invitation_id":9,"email_sent":false}','2026-10-13 00:00:00'),
      (8,'partner_invitation_resent','{"invitation_id":9,"email_sent":true,"signing_link":"renewed"}','2026-10-14 00:00:00'),
      (5,'partner_invitation_revoked','{"invitation_id":7,"reason":"Reason fixture"}','2026-10-15 00:00:00'),
      (5,'partner_invitation_resent','{"invitation_id":2,"email_sent":true}','2026-10-15 00:00:00');`);
  const failing: string[] = [];
  const env: any = envFor(db);
  const inner = env.DB;
  env.DB = { ...inner, prepare(sql: string) {
    for (const f of failing) if (sql.includes(f)) {
      const fail = async () => { throw new Error('SQLITE_ERROR: synthetic fixture-secret-text'); };
      const st: any = { bind: () => st, first: fail, all: fail, run: fail }; return st;
    }
    return inner.prepare(sql);
  } };
  const app = new Hono<any>().route('/', adminPartnersReads).route('/', adminPartners);
  app.onError((err, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  async function call(method: string, path: string, who: number | null = 8, body?: unknown) {
    const headers: any = { 'Content-Type': 'application/json' };
    if (who) headers.Authorization = 'Bearer ' + await token(who, who === 9 ? 'founder' : 'admin');
    const r = await app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    return { status: r.status, body: await r.json() as any };
  }
  const template = (body: string) => db.prepare("INSERT OR REPLACE INTO legal_templates (slug, title, category, body_md, is_stub) VALUES ('partner_services','Partner Services','partner',?,0)").run(body);
  return { db, env, call, template, fail: (s: string) => failing.push(s) };
}
type F = ReturnType<typeof fixture>;

const unreadableShape = (b: any) => {
  assert.equal(b.available, false); assert.equal(b.unreadable, true);
  assert.match(b.reason, /could not be read/); assert.doesNotMatch(b.reason, /SQLITE|fixture-secret-text/);
  assert.deepEqual(Object.keys(b).sort(), ['available', 'reason', 'unreadable']);
};
function rowCounts(f: F) {
  const tables = f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r: any) => r.name);
  return Object.fromEntries(tables.map((t: string) => [t, (f.db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as any).n]));
}

test('D927 overview tiles, on a fixed clock', async () => {
  const f = fixture(); f.template('Agreement for {{partner_name}} on {{effective_date}}.');
  try {
    const o: any = await readOverview(f.env, NOW);
    assert.deepEqual(o.tiles.open, { available: true, count: 4, oldest_first_sent_at: '2026-09-20T10:00:00.000Z' });
    assert.deepEqual(o.tiles.lapsed, { available: true, count: 1 });
    assert.deepEqual(o.tiles.signed_90d, { available: true, count: 2 });
    assert.deepEqual(o.tiles.days_to_sign, { available: true, median_days: 15, over_signed: 2 });
    assert.deepEqual(o.tiles.active_deals, { available: true, count: 3, ending_within_30d: 1, term_over_not_closed: 1 });
    assert.deepEqual(o.tiles.awaiting_signature, { available: true, count: 1, invitation_lapsed: 0 });
    assert.deepEqual(o.tiles.redemptions_90d, { available: true, count: 2 });
    assert.deepEqual(o.tiles.failed_sends_30d, { available: true, count: 1, by_reason: { refused: 1 } });
    f.db.exec('UPDATE partner_invitations SET signed_at = NULL');
    assert.deepEqual((await readOverview(f.env, NOW) as any).tiles.days_to_sign, { available: true, median_days: null, over_signed: 0 }, 'none signed is not a median of zero');
  } finally { f.db.close(); }
});

test('D927 overview: Needs you, and C1 to C4', async () => {
  const f = fixture(); f.template('Agreement for {{partner_name}}, signed by {{sender_title}}.');
  try {
    const o: any = await readOverview(f.env, NOW);
    const rows = o.needs_you.rows.map((r: any) => `${r.kind}:${r.id}`).sort();
    assert.deepEqual(rows, ['agreement_blocked:3', 'deal_ending:2', 'due_diligence_open:2', 'failed_send:1', 'lapsed:4', 'revshare_closing:6', 'unattached_account:21']);
    assert.deepEqual(o.needs_you.kinds.agreement_blocked.agreement, { state: 'not_ready', why: 'fields', fields: ['sender_title'] });
    assert.deepEqual(o.needs_you.unreadable_kinds, []);
    assert.equal(o.needs_you.rows.find((r: any) => r.kind === 'lapsed').stage, 'profiled');
    assert.equal(o.needs_you.rows.find((r: any) => r.kind === 'due_diligence_open').case_uid, 'dd-fixture');
    assert.equal(o.needs_you.rows.find((r: any) => r.kind === 'revshare_closing').windows, 1, 'a closed window and a referral are not rev-share windows closing');

    assert.deepEqual(o.c1.stages.selected, { count: 1, oldest_entered_at: '2026-10-02T09:00:00.000Z', oldest_days: 19, entered_not_recorded: 0 }, 'the latest choice');
    assert.deepEqual(o.c1.stages.viewed, { count: 1, oldest_entered_at: '2026-10-05T08:00:00.000Z', oldest_days: 16, entered_not_recorded: 0 });
    assert.deepEqual(o.c1.stages.sent, { count: 1, oldest_entered_at: '2026-10-10T10:00:00.000Z', oldest_days: 11, entered_not_recorded: 0 });
    assert.deepEqual(o.c1.stages.finalized, { count: 1, oldest_entered_at: null, oldest_days: null, entered_not_recorded: 1 }, 'no row is not a time of zero');
    assert.equal(o.c1.stages.profiled.count, 0, 'a lapsed invitation is not open');
    assert.deepEqual(o.c1.closed, { signed: 2, lapsed: 1, revoked: 1, signed_after_lapse: 1 });

    assert.equal(o.c2.weeks.length, 12); assert.equal(o.c2.weeks[0].week_start, '2026-08-03'); assert.equal(o.c2.weeks.at(-1).to_date, true);
    const wk = (d: string) => o.c2.weeks.find((w: any) => w.week_start === d);
    assert.deepEqual([wk('2026-10-12').sent, wk('2026-10-05').sent, wk('2026-09-28').sent, wk('2026-09-07').signed, wk('2026-08-17').signed], [1, 1, 2, 1, 1]);
    assert.equal(o.c2.weeks.reduce((n: number, w: any) => n + w.sent, 0), 8, 'invitation 6 was sent before the window');

    assert.equal(o.c3.by_type.services_partnership.active, 1); assert.equal(o.c3.by_type.equity_partnership.term_over, 1);
    assert.equal(o.c3.by_type.equity_partnership.active, 0); assert.equal(o.c3.by_type.custom.voided, 1);
    assert.equal(o.c3.by_type.custom.awaiting_signature, 1); assert.equal(o.c3.by_type.capital_partnership.proposed, 1);

    const r4 = (d: string) => o.c4.weeks.find((w: any) => w.week_start === d);
    assert.deepEqual([r4('2026-10-12').referral, r4('2026-10-19').deal_sourcing_revshare], [1, 1]);
    assert.equal(o.c4.weeks.reduce((n: number, w: any) => n + w.referral + w.deal_sourcing_revshare, 0), 2);
  } finally { f.db.close(); }
});

test('D927 overview: the agreement-ready rule, and its two refusals', async () => {
  const f = fixture();
  try {
    f.template('Agreement for {{partner_name}}, {{partner_email}}, {{deal_type}}, {{term_months}}, {{recipient_name}}.');
    assert.deepEqual(await agreementReadiness(f.env), { state: 'ready' });
    let o: any = await readOverview(f.env, NOW);
    assert.equal(o.needs_you.rows.filter((r: any) => r.kind === 'agreement_blocked').length, 0, 'ready: no row');
    f.template('Agreement for {{partner_name}} with {{counterparty.title}}.');
    assert.deepEqual(await agreementReadiness(f.env), { state: 'not_ready', why: 'fields', fields: ['counterparty.title'] });
    f.fail('FROM legal_templates');
    assert.deepEqual(await agreementReadiness(f.env), { state: 'not_ready', why: 'template_unreadable' });
  } finally { f.db.close(); }
});

test('D927 overview: each block fails alone, never as zeros', async () => {
  const f = fixture(); f.template('Agreement for {{partner_name}}.'); f.fail('FROM partner_referral_redemptions'); f.fail('FROM dd_cases');
  try {
    const o: any = await readOverview(f.env, NOW);
    unreadableShape(o.tiles.redemptions_90d); unreadableShape(o.c4);
    unreadableShape(o.needs_you.kinds.revshare_closing); unreadableShape(o.needs_you.kinds.due_diligence_open);
    assert.deepEqual(o.needs_you.unreadable_kinds, ['due_diligence_open', 'revshare_closing']);
    assert.equal(o.needs_you.rows.some((r: any) => r.kind === 'revshare_closing'), false);
    for (const k of ['open', 'lapsed', 'active_deals', 'failed_sends_30d']) assert.equal(o.tiles[k].available, true, k);
    for (const k of ['c1', 'c2', 'c3']) assert.equal(o[k].available, true, k);
  } finally { f.db.close(); }
  const g = fixture(); g.fail('FROM partner_invitations');
  try {
    const o: any = await readOverview(g.env, NOW);
    for (const k of ['open', 'lapsed', 'signed_90d', 'days_to_sign', 'failed_sends_30d']) unreadableShape(o.tiles[k]);
    unreadableShape(o.c1); unreadableShape(o.c2);
    assert.equal(o.tiles.active_deals.available, true); assert.equal(o.c3.available, true); assert.equal(o.tiles.redemptions_90d.available, true);
  } finally { g.db.close(); }
});

test('D927 one invitation: message, step dates, offers seen, chosen deal, refusals, history', async () => {
  const f = fixture();
  try {
    const r: any = await readInvitation(f.env, 3, NOW);
    assert.equal(r.invitation.id, 3); assert.equal(r.invitation.personal_message, null); assert.equal(r.invitation.is_lapsed, false);
    assert.deepEqual(r.invitation.allowed_deal_types, ['equity_partnership', 'capital_partnership', 'custom']);
    assert.deepEqual(r.steps, { available: true, sent: '2026-09-20 10:00:00', opened: '2026-09-21 09:00:00', profile_done: '2026-09-22 09:00:00',
      offers_shown: '2026-09-23 09:00:00', offer_chosen_first: '2026-09-26 09:00:00', offer_chosen_latest: '2026-10-02 09:00:00', agreement_out: null, signed: null });
    assert.equal(r.offers_seen.shown, true); assert.equal(r.offers_seen.offers.length, 3);
    const eq = r.offers_seen.offers.find((o: any) => o.deal_type === 'equity_partnership');
    assert.equal(eq.terms.time_commitment, '8 hrs/month', 'their own profile, not the neutral default');
    assert.equal(r.offers_seen.offers.find((o: any) => o.deal_type === 'capital_partnership').granted_tier_investor, 'institutional');
    assert.equal(r.chosen_deal.deal.id, 4); assert.equal(r.chosen_deal.deal.proposal.label, 'Capital Partnership'); assert.equal(r.chosen_deal.envelope, null);
    assert.deepEqual(r.agreement_refusals.items, [{ at: '2026-10-03 09:00:00', code: 'template_fields_unfilled', fields: ['sender_title'] }]);
    // The answers stay a logged read (D923 §3): only the offers made from them are here.
    assert.doesNotMatch(JSON.stringify(r), /Three Profile fixture|answers|raw_chat/);
    assert.equal(r.offers_seen.offers.find((o: any) => o.deal_type === 'custom').terms.description, 'Motivation fixture', 'the custom offer quotes what they wrote, as they saw it');

    const one: any = await readInvitation(f.env, 1, NOW);
    assert.equal(one.invitation.personal_message, 'Message fixture');
    assert.deepEqual(one.steps, { available: true, sent: '2026-10-10 10:00:00', opened: null, profile_done: null, offers_shown: null,
      offer_chosen_first: null, offer_chosen_latest: null, agreement_out: null, signed: null }, 'each date is null when its row is absent');
    assert.deepEqual(one.offers_seen, { available: true, shown: false, offers: null });
    assert.deepEqual(one.chosen_deal, { available: true, deal: null, envelope: null });
    assert.equal((await readInvitation(f.env, 2, NOW)).steps.opened, '2026-10-05 08:00:00', 'the column wins when there is one');
    assert.equal((await readInvitation(f.env, 4, NOW)).offers_seen.shown, false, 'a profile alone is not offers shown');
    assert.equal(await readInvitation(f.env, 999, NOW), null);
  } finally { f.db.close(); }
});

test('D927 a resent invitation: its envelope and history, with the signing-link renewals', async () => {
  const f = fixture();
  try {
    const r: any = await readInvitation(f.env, 9, NOW);
    assert.deepEqual(r.chosen_deal.envelope, { id: 70, status: 'sent', sent_at: '2026-10-12 00:00:00', completed_at: null, signing_link_expires_at: '2026-10-26T00:00:00Z' });
    assert.doesNotMatch(JSON.stringify(r), /s{64}|signing_token/, 'never the signing token');
    assert.deepEqual(r.history.items, [
      { at: '2026-10-12 00:00:00', action: 'created', by: 'Synthetic inviter', email_sent: true },
      { at: '2026-10-13 00:00:00', action: 'resent', by: 'Synthetic resender', email_sent: false },
      { at: '2026-10-14 00:00:00', action: 'resent', by: 'Synthetic resender', email_sent: true, signing_link: 'renewed' },
    ]);
    assert.deepEqual(r.history.signing_link_renewals, [
      { at: '2026-10-13T00:00:00Z', action: 'signing_link_renewal', by: 'Synthetic resender', renewed: false, previous_link_restored: true },
      { at: '2026-10-14T00:00:00Z', action: 'signing_link_renewal', by: 'Synthetic resender', renewed: true, previous_link_restored: false },
    ]);
    const revoked: any = await readInvitation(f.env, 7, NOW);
    assert.deepEqual(revoked.history.items, [{ at: '2026-10-15 00:00:00', action: 'revoked', by: 'Synthetic inviter', reason: 'Reason fixture' }]);
    f.fail('FROM esign_audit_events');
    const broken: any = await readInvitation(f.env, 9, NOW);
    unreadableShape(broken.history); assert.equal(broken.steps.available, true); assert.equal(broken.chosen_deal.available, true);
  } finally { f.db.close(); }
});

test('D927 offer preview: the Worker text over a neutral profile, profile phrases marked', async () => {
  const p = offerPreview('equity_partnership, capital_partnership,custom');
  assert.deepEqual(p.types, ['equity_partnership', 'capital_partnership', 'custom']); assert.equal(p.source, 'worker');
  const eq: any = p.offers.find((o) => o.deal_type === 'equity_partnership');
  assert.equal(eq.terms.time_commitment, '5–10 hrs/month');
  assert.deepEqual(eq.profile_dependent.map((d: any) => d.field), ['terms.time_commitment', 'contract_excerpt']);
  const cap: any = p.offers.find((o) => o.deal_type === 'capital_partnership');
  assert.equal(cap.terms.capital_commitment_usd, 'TBD (≥ $250k)'); assert.equal(cap.granted_tier_investor, 'professional');
  assert.deepEqual(cap.profile_dependent.map((d: any) => d.what), ['capital_commitment', 'capital_tier', 'capital_commitment']);
  assert.deepEqual((p.offers.find((o) => o.deal_type === 'custom') as any).profile_dependent.map((d: any) => d.what), ['custom_text', 'custom_text']);
  const svc: any = offerPreview('services_partnership').offers[0]; assert.deepEqual(svc.profile_dependent, [], 'nothing in it depends on the profile');
  const four = offerPreview('equity_partnership,services_partnership,custom,capital_partnership');
  assert.equal(four.offers.length, 3); assert.deepEqual(four.not_offered, ['capital_partnership'], 'only the first three are ever offered');
  const f = fixture();
  try {
    assert.equal((await f.call('GET', '/offers/preview?types=equity_partnership,bogus')).status, 400);
    assert.equal((await f.call('GET', '/offers/preview')).status, 400);
    const ok = await f.call('GET', '/offers/preview?types=custom'); assert.equal(ok.status, 200); assert.equal(ok.body.offers[0].deal_type, 'custom');
  } finally { f.db.close(); }
});

test('D927 the reads are admin only and write no row', async () => {
  const f = fixture(); f.template('Agreement for {{partner_name}}.');
  try {
    for (const path of ['/overview', '/invitations/3', '/offers/preview?types=custom']) {
      assert.ok([401, 403].includes((await f.call('GET', path, null)).status), path);
      assert.ok([401, 403].includes((await f.call('GET', path, 9)).status), path);
    }
    // Warm any lazy schema first, so the comparison is rows, not tables.
    await f.call('GET', '/overview'); await f.call('GET', '/invitations/3');
    const before = rowCounts(f);
    const statusBefore = f.db.prepare('SELECT id, status, viewed_at FROM partner_invitations ORDER BY id').all();
    for (const path of ['/overview', '/invitations/1', '/invitations/3', '/invitations/9', '/offers/preview?types=custom']) {
      assert.equal((await f.call('GET', path)).status, 200, path);
    }
    assert.deepEqual(rowCounts(f), before, 'no read writes a row anywhere');
    assert.deepEqual(f.db.prepare('SELECT id, status, viewed_at FROM partner_invitations ORDER BY id').all(), statusBefore, 'Sent stays Sent');
    assert.equal((await f.call('GET', '/invitations/999')).status, 404);
    const list = await f.call('GET', '/invitations'); assert.equal(list.status, 200); assert.equal(list.body.items.length, 9, 'the list route still answers');
  } finally { f.db.close(); }
});

test('D927 resend says whether it renewed the signing link: renewed, not_renewed or null', async () => {
  for (const [kind, expected] of [['ok', 'renewed'], ['refused', 'not_renewed']] as const) {
    const f = fixture();
    Object.assign(f.env, { GMAIL_CLIENT_ID: 'synthetic-id', GMAIL_CLIENT_SECRET: 'synthetic-secret', GMAIL_REFRESH_TOKEN: 'synthetic-refresh' });
    const original = globalThis.fetch;
    globalThis.fetch = async (input: any) => {
      if (String(input) === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'synthetic-local-token' });
      return Response.json(kind === 'ok' ? { id: 'synthetic-message' } : { error: 'synthetic refusal' }, { status: kind === 'ok' ? 200 : 403 });
    };
    try {
      const r = await f.call('POST', '/invitations/9/resend');
      assert.equal(r.status, 200); assert.equal(r.body.signing_link, expected);
      for (const k of ['ok', 'email_sent', 'link', 'expires_at']) assert.ok(k in r.body, `keeps ${k}`);
      const audit: any = f.db.prepare("SELECT filters_json FROM admin_audit_log WHERE action='partner_invitation_resent' ORDER BY id DESC LIMIT 1").get();
      assert.equal(JSON.parse(audit.filters_json).signing_link, expected);
    } finally { globalThis.fetch = original; f.db.close(); }
  }
  const g = fixture();
  try {
    const r = await g.call('POST', '/invitations/2/resend');
    assert.equal(r.status, 200); assert.equal(r.body.signing_link, null, 'no pending signature: the onboarding email went');
  } finally { g.db.close(); }
});
