/**
 * D927 (#2723) — the Partner invitations reads: the Overview, one invitation
 * and the offer preview, and resend's `signing_link`. Real migrated SQLite;
 * synthetic accounts; every mail transport is local.
 *
 * What it proves:
 *   - each block of the Overview fails on its own, never as zeros;
 *   - the step dates come from the onboarding activity rows, and are null
 *     without them;
 *   - a resent invitation keeps its stage and shows its history;
 *   - no read here writes a row (SQLite's own `total_changes()` is unmoved);
 *   - each value of resend's `signing_link`.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/partner_reads_d927.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { envFor, token, call as esignCall, ADMIN } from './_esign_harness.ts';
import adminPartners from '../src/routes/admin_partners.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { FROM_ANSWERS, median, ms, offersSeen, parseTypes, stepDates, weekStart } from '../src/routes/admin_partners_reads.ts';

const read = (p: string) => readFileSync(p, 'utf8');
const scratch = mkdtempSync(join(tmpdir(), 'partner-d927-'));
const seed = join(scratch, 'schema.sqlite');
{
  const schema = new DatabaseSync(seed, { enableForeignKeyConstraints: false });
  schema.exec(read('cloudflare-worker/sql/schema_baseline.sql'));
  for (const name of readdirSync('cloudflare-worker/sql/migrations').filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()) {
    schema.exec(read(`cloudflare-worker/sql/migrations/${name}`));
  }
  schema.close();
}
after(() => rmSync(scratch, { recursive: true, force: true }));

const DAY = 86_400_000;
const NOW = Date.now();
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();
/** D1's own zone-less stamp, `YYYY-MM-DD HH:MM:SS`. */
const d1 = (days: number) => ago(days).replace('T', ' ').slice(0, 19);
let serial = 0;

function fixture() {
  const file = join(scratch, `${++serial}.sqlite`);
  copyFileSync(seed, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false });
  db.exec(`INSERT INTO users(id, role, name, email, is_active) VALUES
    (5, 'admin', 'Synthetic inviter', 'inviter@example.invalid', 1),
    (8, 'admin', 'Synthetic resender', 'resender@example.invalid', 1),
    (9, 'founder', 'Synthetic outsider', 'outsider@example.invalid', 1),
    (20, 'partner', 'Synthetic partner A', 'pa@example.invalid', 1),
    (21, 'partner', 'Synthetic partner B', 'pb@example.invalid', 1)`);
  const env: any = envFor(db);
  const app = new Hono<any>().route('/', adminPartners);
  app.onError((err, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  return { db, env, app };
}
type F = ReturnType<typeof fixture>;

async function call(f: F, method: string, path: string, body?: unknown, who: number | null = 8) {
  const headers: any = { 'Content-Type': 'application/json' };
  if (who) headers.Authorization = `Bearer ${await token(who, who === 9 ? 'founder' : 'admin')}`;
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const r = await f.app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, f.env);
    return { status: r.status, body: await r.json() as any };
  } finally { [console.warn, console.error] = saved; }
}

function invite(f: F, o: { status?: string; email?: string; created?: string; expires?: string; signed?: string | null; types?: string[]; message?: string | null; lastOk?: number | null; lastSent?: string | null } = {}) {
  return Number(f.db.prepare(
    `INSERT INTO partner_invitations(token, recipient_email, invited_by_user_id, allowed_deal_types, status, created_at, expires_at, signed_at, personal_message, last_send_ok, last_sent_at, send_count)
     VALUES (?, ?, 5, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  ).run(crypto.randomUUID(), o.email ?? `p${serial}-${Math.random()}@example.invalid`, JSON.stringify(o.types ?? ['equity_partnership', 'custom']), o.status ?? 'sent',
    o.created ?? d1(10), o.expires ?? new Date(NOW + 5 * DAY).toISOString(), o.signed ?? null, o.message ?? null, o.lastOk ?? 1, o.lastSent ?? ago(10)).lastInsertRowid);
}
const step = (f: F, id: number, action: string, days: number, extra: Record<string, unknown> = {}) =>
  f.db.prepare('INSERT INTO activity_logs(action, details, actor, created_at) VALUES (?, ?, ?, ?)').run(action, JSON.stringify({ invitation_id: id, ...extra }), 'hash', d1(days));
const changes = (f: F) => Number((f.db.prepare('SELECT total_changes() AS n').get() as any).n);

// ---------------------------------------------------------------- the pure parts

test('the pure parts: zone-less stamps are UTC, weeks start Monday, the median, and the type list', () => {
  assert.equal(ms('2026-10-24 12:00:00'), Date.parse('2026-10-24T12:00:00Z'));
  assert.equal(ms('2026-10-24T12:00:00.000Z'), Date.parse('2026-10-24T12:00:00Z'));
  assert.equal(ms(''), null);
  assert.equal(new Date(weekStart(Date.parse('2026-10-25T23:00:00Z'))).toISOString(), '2026-10-19T00:00:00.000Z', 'a Sunday is in the week that began on Monday');
  assert.equal(median([]), null, 'none signed is null, never 0');
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.deepEqual(parseTypes('Equity_Partnership,custom,custom'), { types: ['equity_partnership', 'custom'] });
  assert.deepEqual(parseTypes(''), { error: 'types_required' });
  assert.deepEqual(parseTypes('equity_partnership,bogus'), { error: 'invalid_type' });
  assert.deepEqual(parseTypes('equity_partnership,services_partnership,custom,capital_partnership'), { error: 'too_many_deal_types' });
  const dates = stepDates([
    { invitation_id: 1, action: 'partner_proposal_selected', created_at: '2026-10-02 00:00:00' },
    { invitation_id: 1, action: 'partner_proposal_selected', created_at: '2026-10-05 00:00:00' },
  ]).get(1)!;
  assert.equal(new Date(dates.offer_chosen_first!).toISOString().slice(0, 10), '2026-10-02');
  assert.equal(new Date(dates.offer_chosen_latest!).toISOString().slice(0, 10), '2026-10-05');
});

test('the offers an invitee saw quote none of their answers; each profile-dependent phrase is marked', () => {
  const offers = offersSeen(['equity_partnership', 'capital_partnership', 'custom'], { capacity_per_month: '12 hrs/month', capital_capacity_usd: 1500000, motivation: 'Help climate founders' });
  const text = JSON.stringify(offers);
  for (const answer of ['12 hrs/month', '1,500,000', '1500000', 'Help climate founders']) assert.ok(!text.includes(answer), `the answer ${answer} reached the read`);
  assert.equal(offers[0].terms.time_commitment, FROM_ANSWERS);
  assert.equal(offers[1].terms.capital_commitment_usd, FROM_ANSWERS);
  assert.equal(offers[1].granted_tier_investor, 'institutional', 'the tier the invitee saw is kept: it is an offer term, not an answer');
  assert.equal(offers[2].terms.description, FROM_ANSWERS);
  assert.deepEqual(offers[0].profile_dependent, ['terms.time_commitment', 'contract_excerpt']);
});

// ---------------------------------------------------------------- GET /overview

test('the overview: every tile, Needs you, C1 to C4, from one read of each store', async () => {
  const f = fixture();
  try {
    const sent = invite(f, { status: 'sent', created: d1(20) });
    const chosen = invite(f, { status: 'selected', created: d1(8) });
    step(f, chosen, 'partner_proposal_selected', 3);
    invite(f, { status: 'viewed', created: d1(15), expires: ago(1) }); // lapsed at Opened
    invite(f, { status: 'signed', created: d1(40), signed: d1(30) });
    invite(f, { status: 'signed', created: d1(200), signed: d1(100) }); // signed outside 90 days
    invite(f, { status: 'revoked', created: d1(5) });
    invite(f, { status: 'expired', created: d1(60), expires: ago(30) }); // signed after the link lapsed: never Lapsed
    invite(f, { status: 'profiled', created: d1(4), lastOk: 0, lastSent: ago(2) }); // a failed send, no profile row
    invite(f, { status: 'sent', created: d1(70), lastOk: 0, lastSent: ago(40) }); // failed 40 days ago: Needs you, not the 30-day tile
    f.db.exec(`INSERT INTO partner_deals(id, invitation_id, user_id, deal_type, proposal_json, status, expires_at, created_at) VALUES
      (1, NULL, 20, 'services_partnership', '{}', 'active', '${new Date(NOW + 10 * DAY).toISOString()}', '${d1(100)}'),
      (2, NULL, 21, 'deal_sourcing_revshare', '{}', 'active', '${new Date(NOW + 200 * DAY).toISOString()}', '${d1(100)}'),
      (3, NULL, 22, 'equity_partnership', '{}', 'active', '${ago(2)}', '${d1(400)}'),
      (4, ${chosen}, NULL, 'equity_partnership', '{}', 'awaiting_signature', NULL, '${d1(3)}'),
      (5, NULL, 23, 'custom', '{}', 'terminated', NULL, '${d1(300)}')`);
    f.db.exec(`INSERT INTO partner_referral_redemptions(partner_deal_id, redeemed_by_user_id, attribution_kind, redeemed_at) VALUES
      (1, 30, 'referral', '${d1(3)}'), (2, 31, 'deal_sourcing_revshare', '${d1(350)}'), (2, 32, 'deal_sourcing_revshare', '${d1(10)}')`);
    f.db.exec(`INSERT INTO dd_cases(uid, subject_type, subject_id, subject_label, status, owner_user_id) VALUES ('case-a', 'partner', 20, 'Partner A', 'open', 5), ('case-b', 'partner', 23, 'Ended partner', 'open', 5)`);
    const before = changes(f);
    const r = await call(f, 'GET', '/overview');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(changes(f), before, 'the overview wrote a row');
    const t = r.body.tiles;
    assert.equal(t.available, true);
    assert.deepEqual([t.open.count, t.lapsed.count, t.signed_90d.count], [4, 1, 1]);
    assert.equal(t.open.oldest_first_send.slice(0, 10), ago(70).slice(0, 10));
    assert.equal(t.median_days_to_sign.over, 2);
    assert.equal(t.median_days_to_sign.median_days, 55, 'median of 10 and 100 days');
    assert.deepEqual([t.active_deals.count, t.active_deals.ending_30d, t.active_deals.term_over], [3, 1, 1]);
    assert.deepEqual([t.awaiting_signature.count, t.awaiting_signature.invitation_lapsed], [1, 0]);
    assert.equal(t.redemptions_90d.count, 2);
    assert.equal(t.failed_sends_30d.count, 1);
    const kinds = Object.fromEntries(Object.entries(r.body.needs_you.kinds).map(([k, v]: any) => [k, v.count]));
    assert.deepEqual(kinds, { lapsed: 1, agreement_blocked: 0, send_failed: 2, deal_ending: 1, unattached_account: 2, dd_open: 1, revshare_closing: 1 },
      'the bundled Partner Services file has no field finalize leaves empty, so Offer chosen is not blocked');
    assert.equal(r.body.needs_you.total, 8);
    assert.ok(r.body.needs_you.items.every((i: any) => i.kind && i.id != null), 'each row has its kind and its record\'s id');
    assert.deepEqual(r.body.needs_you.items.find((i: any) => i.kind === 'dd_open'), { kind: 'dd_open', id: 1, case_uid: 'case-a', case_status: 'open' });
    const stages = Object.fromEntries(r.body.c1.stages.map((s: any) => [s.stage, s]));
    assert.equal(stages.sent.count, 2);
    assert.equal(stages.sent.oldest_in_stage_since.slice(0, 10), ago(70).slice(0, 10));
    assert.equal(stages.selected.oldest_in_stage_since.slice(0, 10), ago(3).slice(0, 10), 'time in a stage comes from its activity row');
    assert.deepEqual([stages.profiled.count, stages.profiled.oldest_in_stage_since, stages.profiled.undated], [1, null, 1], 'no activity row: not dated, never now');
    assert.deepEqual(r.body.c1.closed, { signed: 2, lapsed: 1, revoked: 1, signed_after_lapse: 1 });
    assert.equal(r.body.c2.weeks.length, 12);
    assert.equal(r.body.c2.weeks.at(-1).current, true);
    assert.equal(r.body.c2.weeks.reduce((n: number, w: any) => n + w.sent, 0), 8, 'first sends within the 12 weeks: not the one 200 days ago');
    assert.equal(r.body.c2.weeks.reduce((n: number, w: any) => n + w.signed, 0), 1, 'signed within the 12 weeks: not the one 100 days ago');
    assert.ok(r.body.c3.rows.some((x: any) => x.deal_type === 'equity_partnership' && x.state === 'term_over' && x.count === 1), 'an active deal past its end is Term over');
    assert.equal(r.body.c4.weeks.reduce((n: number, w: any) => n + w.referral + w.deal_sourcing_revshare, 0), 2);
  } finally { f.db.close(); }
});

test('each block of the overview fails on its own: a missing store costs only the blocks that read it', async () => {
  const f = fixture();
  try {
    invite(f, { status: 'sent' });
    f.db.exec('DROP TABLE partner_referral_redemptions');
    let r = await call(f, 'GET', '/overview');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.tiles.redemptions_90d, { available: false, reason: 'Referral redemptions could not be read. That is not the same as none.' });
    assert.equal(r.body.c4.available, false);
    assert.ok(!('weeks' in r.body.c4), 'a failed block carries no zeros');
    assert.deepEqual(r.body.needs_you.unreadable, ['revshare_closing']);
    assert.equal(r.body.tiles.open.count, 1, 'the other tiles still answer');
    assert.equal(r.body.c2.available, true);
    f.db.exec('DROP TABLE dd_cases');
    f.db.exec(`INSERT INTO partner_deals(invitation_id, user_id, deal_type, proposal_json, status) VALUES (NULL, 20, 'custom', '{}', 'active')`);
    r = await call(f, 'GET', '/overview');
    assert.deepEqual(r.body.needs_you.unreadable.sort(), ['dd_open', 'revshare_closing']);
    f.db.exec('DROP TABLE partner_invitations');
    r = await call(f, 'GET', '/overview');
    for (const k of ['open', 'lapsed', 'signed_90d', 'median_days_to_sign', 'failed_sends_30d']) assert.equal(r.body.tiles[k].available, false, k);
    assert.equal(r.body.tiles.active_deals.available, true, 'deals still answer');
    assert.equal(r.body.c1.available, false);
    assert.equal(r.body.c3.available, true);
  } finally { f.db.close(); }
});

test('the agreement check (D923 §2): a field finalize leaves empty blocks Offer chosen; a ready body clears it; an unreadable store says nothing', async () => {
  const f = fixture();
  try {
    invite(f, { status: 'selected' });
    invite(f, { status: 'selected', expires: ago(1) }); // lapsed: Lapsed, not blocked
    await call(f, 'GET', '/overview'); // the template store's own schema check runs on first read
    const store = (body: string) => f.db.prepare(
      `INSERT INTO legal_templates(slug, title, category, body_md, is_active, is_stub) VALUES ('partner_services', 'Partner Services', 'gp', ?, 1, 0)
       ON CONFLICT(slug) DO UPDATE SET body_md = excluded.body_md, is_active = 1, is_stub = 0`,
    ).run(body);
    store('Between {{partner_name}} and Axal, on {{effective_date}}. Title: {{counterparty.title}}. Fee: {{fee_schedule}}.');
    let r = await call(f, 'GET', '/overview');
    const blocked = r.body.needs_you.items.filter((i: any) => i.kind === 'agreement_blocked');
    assert.equal(blocked.length, 1, 'only the open one at Offer chosen');
    assert.deepEqual([blocked[0].why, blocked[0].fields], ['fields', ['counterparty.title', 'fee_schedule']]);
    store('Between {{partner_name}} ({{partner_email}}) and Axal, for {{deal_type}} over {{term_months}} months from {{effective_date}}, signed by {{recipient_name}}.');
    r = await call(f, 'GET', '/overview');
    assert.equal(r.body.needs_you.kinds.agreement_blocked.count, 0, 'every field is one finalize fills');
    f.db.exec('DROP TABLE legal_templates; CREATE VIEW legal_templates AS SELECT 1 AS broken');
    r = await call(f, 'GET', '/overview');
    assert.equal(r.body.needs_you.kinds.agreement_blocked.available, false, 'a store that cannot be read says nothing either way');
    assert.ok(r.body.needs_you.unreadable.includes('agreement_blocked'));
  } finally { f.db.close(); }
});

// ---------------------------------------------------------------- GET /invitations/:id

test('one invitation: its message, each step date from its activity row, the offers seen, the deal and envelope, refusals and history', async () => {
  const f = fixture();
  try {
    const email = 'record@example.invalid';
    const id = invite(f, { status: 'finalized', email, created: d1(12), message: 'Glad to have you', types: ['equity_partnership', 'capital_partnership'] });
    step(f, id, 'partner_invitation_viewed', 11);
    step(f, id, 'partner_profile_saved', 10);
    step(f, id, 'partner_proposals_generated', 9, { count: 2 });
    step(f, id, 'partner_proposal_selected', 8);
    step(f, id, 'partner_proposal_selected', 6);
    step(f, id, 'partner_envelope_refused', 7, { code: 'template_fields_unfilled', fields: ['counterparty.title'] });
    step(f, id, 'partner_envelope_started', 5);
    step(f, id + 1000, 'partner_profile_saved', 30); // another invitation's earlier row is not read
    f.db.prepare(`INSERT INTO partner_profiles(invitation_id, email, full_name, capacity_per_month, capital_capacity_usd) VALUES (?, ?, 'Synthetic Partner', '7 hrs/month', 250000)`).run(id, email);
    await esignCall(f.env, 'GET', '/99999', ADMIN);
    const envId = Number(f.db.prepare(`INSERT INTO esign_envelopes(envelope_uuid, document_type, document_title, document_body, body_sha256, status, created_by) VALUES (?, 'partner_services', 'Synthetic', 'Body', 'sha', 'sent', 5)`).run(crypto.randomUUID()).lastInsertRowid);
    f.db.prepare('UPDATE partner_invitations SET envelope_id = ? WHERE id = ?').run(envId, id);
    f.db.prepare(`INSERT INTO esign_recipients(envelope_id, recipient_email, signing_token, token_expires_at, status) VALUES (?, ?, ?, '2026-11-07T00:00:00Z', 'pending')`).run(envId, email.toUpperCase(), 'c'.repeat(64));
    f.db.prepare(`INSERT INTO partner_deals(invitation_id, deal_type, proposal_json, envelope_id, status, created_at) VALUES (?, 'equity_partnership', ?, ?, 'awaiting_signature', ?)`).run(id, JSON.stringify({ label: 'Equity Partnership', summary: 'Long-term equity' }), envId, d1(8));
    f.db.prepare(`INSERT INTO admin_audit_log(admin_user_id, action, filters_json, exported_at) VALUES (5, 'partner_invitation_created', ?, ?), (8, 'partner_invitation_resent', ?, ?)`)
      .run(JSON.stringify({ invitation_id: id, email_sent: true }), d1(12), JSON.stringify({ invitation_id: id, email_sent: false }), d1(4));
    f.db.prepare(`INSERT INTO esign_audit_events(envelope_id, ts, signer_id, signer_email, action, meta) VALUES (?, ?, 8, 'resender@example.invalid', 'partner_signing_link_renewal_failed', ?)`)
      .run(envId, ago(4), JSON.stringify({ invitation_id: id, link_renewed: false, previous_link_restored: true }));

    const before = changes(f);
    const r = await call(f, 'GET', `/invitations/${id}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(changes(f), before, 'the record wrote a row: it must never log a view or move a stage');
    assert.equal(r.body.invitation.personal_message, 'Glad to have you');
    assert.equal(r.body.invitation.status, 'finalized');
    const s = r.body.steps;
    for (const [k, days] of [['opened', 11], ['profile_done', 10], ['offers_shown', 9], ['offer_chosen_first', 8], ['offer_chosen_latest', 6], ['agreement_out', 5]] as const) {
      assert.equal(s[k].slice(0, 10), ago(days).slice(0, 10), k);
    }
    assert.equal(s.signed, null);
    assert.equal(r.body.offers_seen.seen, true);
    assert.deepEqual(r.body.offers_seen.offers.map((o: any) => o.deal_type), ['equity_partnership', 'capital_partnership']);
    assert.doesNotMatch(JSON.stringify(r.body.offers_seen), /7 hrs\/month|250,000|250000/, 'no answer verbatim');
    assert.deepEqual(r.body.chosen_deal.deal, { ...r.body.chosen_deal.deal, deal_type: 'equity_partnership', status: 'awaiting_signature', label: 'Equity Partnership' });
    assert.equal(r.body.chosen_deal.envelope.status, 'sent');
    assert.equal(r.body.chosen_deal.envelope.signing_link_expires_at, '2026-11-07T00:00:00Z');
    assert.doesNotMatch(JSON.stringify(r.body), /c{64}/, 'never the signing token');
    assert.deepEqual(r.body.refusals.items.map((x: any) => [x.code, x.fields]), [['template_fields_unfilled', ['counterparty.title']]]);
    assert.deepEqual(r.body.history.items.map((h: any) => [h.event, h.by, h.email_sent]), [
      ['created', 'Synthetic inviter', true], ['resent', 'Synthetic resender', false], ['signing_link_not_renewed', 'Synthetic resender', false],
    ]);
    assert.equal(r.body.history.items[2].previous_link_restored, true);
    assert.doesNotMatch(JSON.stringify(r.body), /"capacity_per_month"|"motivation"|"full_name"|Synthetic Partner/, 'the profile\'s answers are not in this read');
  } finally { f.db.close(); }
});

test('without its activity rows every step date is null, never the creation time; a missing invitation is 404', async () => {
  const f = fixture();
  try {
    const id = invite(f, { status: 'selected', created: d1(3) });
    const r = await call(f, 'GET', `/invitations/${id}`);
    assert.equal(r.status, 200);
    assert.deepEqual({ ...r.body.steps, sent: undefined }, { available: true, sent: undefined, opened: null, profile_done: null, offers_shown: null, offer_chosen_first: null, offer_chosen_latest: null, agreement_out: null, signed: null });
    assert.deepEqual(r.body.offers_seen, { available: true, seen: false, offers: [] }, 'offers never shown are not invented');
    assert.deepEqual(r.body.chosen_deal, { available: true, deal: null, envelope: null });
    assert.deepEqual(r.body.history.items, []);
    assert.equal((await call(f, 'GET', '/invitations/99999')).status, 404);
    assert.equal((await call(f, 'GET', `/invitations/${id}`, undefined, 9)).status, 403, 'admins only');
    f.db.exec('DROP TABLE admin_audit_log');
    const r2 = await call(f, 'GET', `/invitations/${id}`);
    assert.equal(r2.body.history.available, false, 'a failed history read is not an empty one');
    assert.equal(r2.body.steps.available, true);
  } finally { f.db.close(); }
});

// ---------------------------------------------------------------- GET /offers/preview

test('the preview: the Worker\'s text over a neutral profile, each profile-dependent phrase marked; refusals', async () => {
  const f = fixture();
  try {
    const before = changes(f);
    const r = await call(f, 'GET', '/offers/preview?types=capital_partnership,custom');
    assert.equal(r.status, 200);
    assert.equal(changes(f), before);
    assert.equal(r.body.profile, 'neutral');
    assert.deepEqual(r.body.offers.map((o: any) => o.deal_type), ['capital_partnership', 'custom']);
    assert.equal(r.body.offers[0].terms.capital_commitment_usd, 'TBD (≥ $250k)');
    assert.deepEqual(r.body.offers[0].profile_dependent, ['terms.capital_commitment_usd', 'granted_tier_investor', 'contract_excerpt']);
    assert.deepEqual(r.body.offers[1].profile_dependent, ['terms.description', 'contract_excerpt']);
    assert.equal((await call(f, 'GET', '/offers/preview?types=bogus')).body.error, 'invalid_type');
    assert.equal((await call(f, 'GET', '/offers/preview')).status, 400);
  } finally { f.db.close(); }
});

// ---------------------------------------------------------------- resend's signing_link

function transport(kind: 'ok' | 'failed') {
  const original = globalThis.fetch;
  globalThis.fetch = async (input: any) => {
    const url = String(input);
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'synthetic-local-token' });
    if (kind === 'failed') throw new Error('synthetic transport failure');
    return Response.json({ id: 'synthetic-message' });
  };
  return () => { globalThis.fetch = original; };
}
const credentials = (f: F) => Object.assign(f.env, { GMAIL_CLIENT_ID: 'synthetic-id', GMAIL_CLIENT_SECRET: 'synthetic-secret', GMAIL_REFRESH_TOKEN: 'synthetic-refresh' });

async function atAgreementOut(f: F) {
  await esignCall(f.env, 'GET', '/99999', ADMIN);
  const id = invite(f, { status: 'finalized', email: 'partner@example.invalid' });
  const envId = Number(f.db.prepare(`INSERT INTO esign_envelopes(envelope_uuid, document_type, document_title, document_body, body_sha256, status, created_by) VALUES (?, 'partner_services', 'Synthetic', 'Body', 'sha', 'sent', 5)`).run(crypto.randomUUID()).lastInsertRowid);
  f.db.prepare('UPDATE partner_invitations SET envelope_id = ? WHERE id = ?').run(envId, id);
  f.db.prepare(`INSERT INTO esign_recipients(envelope_id, recipient_email, signing_token, token_expires_at, status) VALUES (?, 'partner@example.invalid', ?, '2000-01-01', 'pending')`).run(envId, 'a'.repeat(64));
  return id;
}

test('resend says whether it renewed the signing link: renewed, not_renewed (the prior link restored), or null (the onboarding email)', async () => {
  let f = fixture(); credentials(f); let restore = transport('ok');
  try {
    const id = await atAgreementOut(f);
    const r = await call(f, 'POST', `/invitations/${id}/resend`);
    assert.equal(r.status, 200);
    assert.equal(r.body.signing_link, 'renewed');
    for (const k of ['ok', 'email_sent', 'link', 'expires_at']) assert.ok(k in r.body, `the reply kept ${k}`);
    const rec = await call(f, 'GET', `/invitations/${id}`);
    assert.ok(rec.body.history.items.some((h: any) => h.event === 'resent' && h.by === 'Synthetic resender'), 'a resent invitation shows its resend');
    assert.equal(rec.body.invitation.status, 'finalized', 'and keeps its stage');
    assert.ok(rec.body.history.items.some((h: any) => h.event === 'signing_link_renewed'));
  } finally { restore(); f.db.close(); }
  f = fixture(); credentials(f); restore = transport('failed');
  try {
    const id = await atAgreementOut(f);
    const r = await call(f, 'POST', `/invitations/${id}/resend`);
    assert.equal(r.body.signing_link, 'not_renewed');
    assert.equal((f.db.prepare('SELECT signing_token FROM esign_recipients').get() as any).signing_token, 'a'.repeat(64), 'the prior link was restored');
    const rec = await call(f, 'GET', `/invitations/${id}`);
    assert.equal(rec.body.history.items.find((h: any) => h.event === 'signing_link_not_renewed').previous_link_restored, true);
  } finally { restore(); f.db.close(); }
  f = fixture();
  try {
    const id = invite(f, { status: 'viewed' });
    const r = await call(f, 'POST', `/invitations/${id}/resend`);
    assert.equal(r.status, 200);
    assert.equal(r.body.signing_link, null, 'no pending partner signature: the onboarding email went instead');
  } finally { f.db.close(); }
});
