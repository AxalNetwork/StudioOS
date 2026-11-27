/**
 * D6710 (#6710, P2 of #6680) — offering formation cases to partner firms, the
 * partner-side access check, reassignment and expiry, on the full migrated
 * schema (202611270444_6710 included). One test per Done-when item:
 *   1. a firm with an expired credential or no data agreement cannot be offered a case;
 *   2. a member of firm A fails the access check on firm B's case;
 *   3. after reassignment the old firm fails the check at once, and the new firm
 *      cannot read people until a consent naming it exists;
 *   4. an expired offer reappears in HQ's 'unassigned' view, with an event;
 * plus the re-screen before an offer, the ranking, and the auth-inventory token.
 *
 * Every firm, person and licence is made up. Licence dates are far in the past
 * or the future and every clock the checks read is passed in, so no test here
 * depends on the day it runs.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/formation_assignments_6710.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import cases from '../src/routes/admin_formation_cases.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import {
  PARTNER_NOTICE_WORDING, answerOffer, canAccessFormationCase, canReadFormationPeople, expireOffers, offerCase,
} from '../src/services/formationAssignments.ts';
import { EVIDENCE_TOKENS } from '../../scripts/lib/authInventory.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { formationScreeningFixture } from './_formation_screening_fixture.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { grantWriteBar } from './_write_bar_session.mjs';

const SECRET = 'fixture-only-formation-assignment-key-6710';
const ADMIN = 1, OTHER_ADMIN = 2, FOUNDER = 10;
const MEMBER_A = 21, MEMBER_B = 22, OUTSIDER = 24;
// Firms: partners.id 101..106, formation_partners.id 1..6.
const A = 1, B = 2, EXPIRED = 3, NO_DPA = 4, RESTRICTED = 5, UNVERIFIED = 6;
const NOW = new Date('2026-11-27T12:00:00Z');
const at = (sqlTs: string) => new Date(sqlTs.replace(' ', 'T') + 'Z');
const HOUR = 3_600_000;

const app = new Hono<any>();
app.route('/cases', cases);
app.onError((e, c) => c.json({ error: e.message }, (AUTH_ERROR_STATUSES[e.message] || 500) as any));

function fixture(lists?: any) {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  const user = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  user.run(ADMIN, 'admin', 'Case Owner', 'owner@example.test', null);
  user.run(OTHER_ADMIN, 'admin', 'Other Admin', 'other@example.test', null);
  user.run(FOUNDER, 'founder', 'Founder', 'founder@example.test', 100);
  user.run(MEMBER_A, 'partner', 'Firm A staff', 'a@example.test', null);
  user.run(MEMBER_B, 'partner', 'Firm B staff', 'b@example.test', null);
  user.run(OUTSIDER, 'partner', 'No firm', 'none@example.test', null);
  db.exec(`DELETE FROM super_admins;
    INSERT INTO formation_catalogue_versions (id, version) VALUES (901, 901);
    INSERT INTO formation_jurisdictions (id, version_id, country) VALUES (901, 901, 'DE');
    INSERT INTO formation_entity_forms (id, version_id, jurisdiction_id, form_key, label) VALUES (901, 901, 901, 'gmbh_fixture', 'Example form');
    INSERT INTO formation_cases (id, uid, user_id, intent, track, stage, waiting_on, hq_owner_user_id, form_key, catalogue_version_id)
      VALUES (1, 'fc', ${FOUNDER}, 'new_company', 'v2', 'details', 'founder', ${ADMIN}, 'gmbh_fixture', 901),
             (2, 'fc2', ${FOUNDER}, 'new_company', 'v2', 'details', 'founder', ${ADMIN}, 'gmbh_fixture', 901);`);
  const firm = db.prepare(`INSERT INTO partners (id, name, email) VALUES (?, ?, ?)`);
  const fp = db.prepare(`INSERT INTO formation_partners (id, uid, partner_id, status, dpa_signed_on, restricted_places_json) VALUES (?, ?, ?, ?, ?, ?)`);
  const cover = db.prepare(`INSERT INTO formation_partner_coverage (formation_partner_id, country, form_key, service, priority, is_on) VALUES (?, 'DE', 'gmbh_fixture', 'formation', ?, 1)`);
  const cred = db.prepare(`INSERT INTO formation_partner_credentials (formation_partner_id, country, licence_type, licence_number, regulator, valid_until) VALUES (?, 'DE', 'Example', 'X-1', 'Example regulator', ?)`);
  const firms: [number, string, string, string | null, string, string][] = [
    [A, 'fp_a', 'verified', '2026-01-01', '[]', '2099-12-31'],
    [B, 'fp_b', 'verified', '2026-01-01', '["US"]', '2099-12-31'],
    [EXPIRED, 'fp_expired', 'verified', '2026-01-01', '[]', '2001-01-01'],
    [NO_DPA, 'fp_nodpa', 'verified', null, '[]', '2099-12-31'],
    [RESTRICTED, 'fp_restricted', 'verified', '2026-01-01', '["de"]', '2099-12-31'],
    [UNVERIFIED, 'fp_draft', 'draft', '2026-01-01', '[]', '2099-12-31'],
  ];
  for (const [id, uid, status, dpa, places, valid] of firms) {
    firm.run(100 + id, `Firm ${uid}`, `${uid}@example.test`);
    fp.run(id, uid, 100 + id, status, dpa, places);
    cover.run(id, id === B ? 50 : 100);
    cred.run(id, valid);
  }
  db.exec(`INSERT INTO formation_partner_members (formation_partner_id, user_id, role) VALUES (${A}, ${MEMBER_A}, 'staff'), (${B}, ${MEMBER_B}, 'staff');`);
  const tokens = formationScreeningFixture(db, 1);
  formationScreeningFixture(db, 2);
  const jti = grantWriteBar(db, ADMIN);
  const env = { TOKENS: lists ?? tokens, DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  const one = (sql: string, ...args: any[]) => ({ ...db.prepare(sql).get(...args) }) as any;
  const count = (sql: string, ...args: any[]) => Number(one(sql, ...args).n);
  async function call(method: string, path: string, body?: any, who: number = ADMIN, stepUp = true) {
    const claims = who === ADMIN && stepUp ? { user_id: who, jti } : { user_id: who };
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + await new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET)),
    };
    const res = await app.request('/cases' + (path.startsWith('?') ? '' : '/') + path, { method, headers, body: body ? JSON.stringify(body) : undefined }, env);
    return { status: res.status, body: await res.json() as any };
  }
  const partnerUser = (id: number) => ({ id, role: 'partner', email: `${id}@example.test` }) as any;
  const adminUser = { id: ADMIN, role: 'admin', email: 'owner@example.test' } as any;
  return { db, env, one, count, call, partnerUser, adminUser };
}

test('a firm with an expired credential, no data agreement, a restricted place or no verification cannot be offered a case', async () => {
  const { call, count } = fixture();
  const list = await call('GET', 'fc/eligible-partners');
  assert.equal(list.status, 200, JSON.stringify(list.body));
  const byUid = Object.fromEntries(list.body.partners.map((p: any) => [p.uid, p]));
  assert.deepEqual(
    Object.fromEntries(Object.entries(byUid).map(([k, v]: any) => [k, v.refusal])),
    { fp_a: null, fp_b: null, fp_expired: 'credential_expired', fp_nodpa: 'dpa_missing', fp_restricted: 'restricted_place', fp_draft: 'partner_not_verified' },
  );
  // Eligible first, by coverage priority: B (50) before A (100); turnaround not recorded is null, never 0.
  assert.deepEqual(list.body.partners.slice(0, 2).map((p: any) => p.uid), ['fp_b', 'fp_a']);
  assert.equal(byUid.fp_a.turnaround_hours, null);
  for (const [uid, code] of [['fp_expired', 'credential_expired'], ['fp_nodpa', 'dpa_missing'], ['fp_restricted', 'restricted_place'], ['fp_draft', 'partner_not_verified']]) {
    const r = await call('POST', 'fc/offer', { formation_partner_uid: uid });
    assert.equal(r.status, 409, uid);
    assert.equal(r.body.error, code, uid);
  }
  assert.equal(count('SELECT COUNT(*) n FROM formation_case_assignments'), 0);
  // No screening is run for a refused offer.
  assert.equal(count("SELECT COUNT(*) n FROM formation_case_screenings WHERE checkpoint = 'offer'"), 0);
  // Only the case's HQ owner (or a Super Admin) offers it.
  const other = await call('POST', 'fc/offer', { formation_partner_uid: 'fp_a' }, OTHER_ADMIN);
  assert.equal(other.status, 403);
  assert.equal(other.body.error, 'case_owner_required');
});

test('an offer re-screens the people first, refuses a hold, and records user and firm', async () => {
  const held = fixture({ get: async (key: string) => [{ source: key.split(':').at(-1), name: 'Fixture case owner', aliases: [], ref: 'synthetic', dob: null, nationality: null }] });
  const r = await held.call('POST', 'fc/offer', { formation_partner_uid: 'fp_a' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'case_on_hold');
  assert.equal(held.count('SELECT COUNT(*) n FROM formation_case_assignments'), 0);
  assert.equal(held.one('SELECT hold_reason FROM formation_cases WHERE id = 1').hold_reason, 'screening');

  const { call, one, count } = fixture();
  const ok = await call('POST', 'fc/offer', { formation_partner_uid: 'fp_a', expires_in_hours: 48 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.state, 'offered');
  assert.equal(count("SELECT COUNT(*) n FROM formation_case_screenings s JOIN formation_case_people p ON p.id = s.person_id WHERE p.case_id = 1 AND s.checkpoint = 'offer'"), 1);
  const row = one('SELECT partner_id, offered_by, expires_at, offered_at FROM formation_case_assignments');
  assert.equal(row.partner_id, 101);
  assert.equal(row.offered_by, ADMIN);
  assert.equal(at(row.expires_at).getTime() - at(row.offered_at).getTime() <= 48 * HOUR + 1000, true);
  const ev = JSON.parse(one("SELECT detail_json FROM formation_case_events WHERE kind = 'partner_offered'").detail_json);
  assert.equal(ev.formation_partner_uid, 'fp_a');
  assert.equal(ev.by_user_id, ADMIN);
  assert.equal(count("SELECT COUNT(*) n FROM admin_audit_log WHERE action = 'formation_case.partner_offered' AND admin_user_id = ? AND json_extract(filters_json, '$.partner_id') = 101", ADMIN), 1);
  assert.equal(count("SELECT COUNT(*) n FROM activity_logs WHERE action = 'formation_case.partner_offered' AND user_id = ?", ADMIN), 1);
  // A second offer of the same service is refused: reassign instead.
  const again = await call('POST', 'fc/offer', { formation_partner_uid: 'fp_b' });
  assert.equal(again.body.error, 'assignment_exists');
});

test("a member of firm A fails the access check on firm B's case", async () => {
  const { env, call, one, partnerUser, db } = fixture();
  assert.equal((await call('POST', 'fc/offer', { formation_partner_uid: 'fp_a' })).status, 200);
  assert.equal((await call('POST', 'fc2/offer', { formation_partner_uid: 'fp_b' })).status, 200);
  const offeredAt = at(one('SELECT offered_at FROM formation_case_assignments WHERE case_id = 1').offered_at);
  const t = new Date(offeredAt.getTime() + HOUR);
  // Offered: the firm's member gets the redacted view only.
  assert.equal(await canAccessFormationCase(env, partnerUser(MEMBER_A), 1, t), 'redacted');
  const a1 = one('SELECT uid FROM formation_case_assignments WHERE case_id = 1').uid;
  const b2 = one('SELECT uid FROM formation_case_assignments WHERE case_id = 2').uid;
  // Firm A's member cannot answer firm B's offer.
  assert.equal((await answerOffer(env, partnerUser(MEMBER_A), b2, 'accept', t) as any).error, 'offer_not_found');
  assert.equal((await answerOffer(env, partnerUser(MEMBER_A), a1, 'accept', t)).ok, true);
  assert.equal((await answerOffer(env, partnerUser(MEMBER_B), b2, 'accept', t)).ok, true);
  assert.equal(one('SELECT partner_id FROM formation_cases WHERE id = 1').partner_id, 101);
  assert.equal(await canAccessFormationCase(env, partnerUser(MEMBER_A), 1, t), 'full');
  assert.equal(await canAccessFormationCase(env, partnerUser(MEMBER_B), 2, t), 'full');
  assert.equal(await canAccessFormationCase(env, partnerUser(MEMBER_A), 2, t), null);
  assert.equal(await canAccessFormationCase(env, partnerUser(MEMBER_B), 1, t), null);
  assert.equal(await canAccessFormationCase(env, partnerUser(OUTSIDER), 1, t), null);
  // Not partner-licensed: an admin or the founder gets nothing from this check.
  assert.equal(await canAccessFormationCase(env, { id: FOUNDER, role: 'founder' } as any, 1, t), null);
  // A revoked membership and a suspended firm end access.
  db.exec(`UPDATE formation_partner_members SET revoked_at = '2026-11-27 00:00:00' WHERE user_id = ${MEMBER_A}`);
  assert.equal(await canAccessFormationCase(env, partnerUser(MEMBER_A), 1, t), null);
  db.exec(`UPDATE formation_partners SET status = 'suspended' WHERE id = ${B}`);
  assert.equal(await canAccessFormationCase(env, partnerUser(MEMBER_B), 2, t), null);
});

test('after reassignment the old firm fails the check at once, and the new firm reads no people until a consent names it', async () => {
  const { env, call, one, count, partnerUser, db } = fixture();
  assert.equal((await call('POST', 'fc/offer', { formation_partner_uid: 'fp_a' })).status, 200);
  const offered = one('SELECT uid, offered_at FROM formation_case_assignments');
  const t = new Date(at(offered.offered_at).getTime() + HOUR);
  assert.equal((await answerOffer(env, partnerUser(MEMBER_A), offered.uid, 'accept', t)).ok, true);
  // The founder consents to firm A, firm A's notice reached the person, and the offer screening is clear.
  db.exec(`INSERT INTO formation_case_consents (case_id, kind, partner_id, scope, text_hash, lawful_basis_key, given_by)
      VALUES (1, 'share_with_partner', 101, 'people', 'fixture', 'test', ${FOUNDER});
    UPDATE formation_case_people SET notice_sent_at = '2026-11-27 00:00:00', notice_partner_id = 101 WHERE case_id = 1;`);
  assert.equal(await canReadFormationPeople(env, partnerUser(MEMBER_A), 1, 'people', false, t), true);

  // Reassigning needs a recent step-up and a reason.
  assert.equal((await call('POST', 'fc/reassign', { formation_partner_uid: 'fp_b', reason: 'Firm A is at capacity.' }, ADMIN, false)).status, 403);
  assert.equal((await call('POST', 'fc/reassign', { formation_partner_uid: 'fp_b' })).body.error, 'reason_required');
  const moved = await call('POST', 'fc/reassign', { formation_partner_uid: 'fp_b', reason: 'Firm A is at capacity.', notice_kind: 'return_request' });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.deepEqual(moved.body.notice, { kind: 'return_request', delivery: 'awaiting_counsel' });

  // Firm A: no access and no people, at once.
  assert.equal(await canAccessFormationCase(env, partnerUser(MEMBER_A), 1, t), null);
  assert.equal(await canReadFormationPeople(env, partnerUser(MEMBER_A), 1, 'people', false, t), false);
  assert.equal(one('SELECT partner_id FROM formation_cases WHERE id = 1').partner_id, null);
  assert.equal(one('SELECT state FROM formation_case_assignments WHERE uid = ?', offered.uid).state, 'withdrawn');
  // Its return request is recorded, not sent: counsel's wording is pending.
  assert.equal(PARTNER_NOTICE_WORDING, null);
  const notice = one('SELECT formation_partner_id, kind, delivery, sent_at, requested_by FROM formation_partner_notices');
  assert.deepEqual(notice, { formation_partner_id: A, kind: 'return_request', delivery: 'awaiting_counsel', sent_at: null, requested_by: ADMIN });
  assert.equal(count("SELECT COUNT(*) n FROM admin_audit_log WHERE action = 'formation_case.partner_reassigned' AND json_extract(filters_json, '$.from_partner_id') = 101 AND json_extract(filters_json, '$.partner_id') = 102"), 1);

  // Firm B accepts: full access, but no people until a consent naming firm B exists.
  const next = one("SELECT uid FROM formation_case_assignments WHERE state = 'offered'").uid;
  assert.equal(await canAccessFormationCase(env, partnerUser(MEMBER_B), 1, t), 'redacted');
  assert.equal((await answerOffer(env, partnerUser(MEMBER_B), next, 'accept', t)).ok, true);
  assert.equal(await canAccessFormationCase(env, partnerUser(MEMBER_B), 1, t), 'full');
  db.exec('UPDATE formation_case_people SET notice_partner_id = 102 WHERE case_id = 1');
  assert.equal(await canReadFormationPeople(env, partnerUser(MEMBER_B), 1, 'people', false, t), false);
  db.exec(`INSERT INTO formation_case_consents (case_id, kind, partner_id, scope, text_hash, lawful_basis_key, given_by)
    VALUES (1, 'share_with_partner', 102, 'people', 'fixture', 'test', ${FOUNDER})`);
  assert.equal(await canReadFormationPeople(env, partnerUser(MEMBER_B), 1, 'people', false, t), true);
  // Firm A's old consent still gives firm A nothing.
  assert.equal(await canReadFormationPeople(env, partnerUser(MEMBER_A), 1, 'people', false, t), false);
});

test("an expired offer returns to HQ's 'unassigned' view with an event", async () => {
  const { env, call, one, count, partnerUser, adminUser } = fixture();
  const r = await offerCase(env, adminUser, 'fc', { formation_partner_uid: 'fp_a', expires_in_hours: 24 }, NOW);
  assert.equal(r.ok, true, JSON.stringify(r));
  const unassigned = async () => (await call('GET', '?view=unassigned')).body.items.map((i: any) => i.uid);
  assert.deepEqual(await unassigned(), []);
  // Past the expiry the check fails even before the sweep runs.
  const later = new Date(NOW.getTime() + 25 * HOUR);
  assert.equal(await canAccessFormationCase(env, partnerUser(MEMBER_A), 1, new Date(NOW.getTime() + HOUR)), 'redacted');
  assert.equal(await canAccessFormationCase(env, partnerUser(MEMBER_A), 1, later), null);
  // Not yet due: nothing expires.
  assert.deepEqual(await expireOffers(env, new Date(NOW.getTime() + 23 * HOUR)), { expired: 0 });
  assert.deepEqual(await expireOffers(env, later), { expired: 1 });
  assert.deepEqual(await expireOffers(env, later), { expired: 0 });
  assert.equal(one('SELECT state FROM formation_case_assignments').state, 'expired');
  assert.equal(count("SELECT COUNT(*) n FROM formation_case_events WHERE case_id = 1 AND kind = 'partner_offer_expired' AND party = 'system'"), 1);
  assert.deepEqual(await unassigned(), ['fc']);
  // A new offer takes it out of the view again.
  assert.equal((await offerCase(env, adminUser, 'fc', { formation_partner_uid: 'fp_b' }, later)).ok, true);
  assert.deepEqual(await unassigned(), []);
});

test('canAccessFormationCase is an auth-inventory evidence token', () => {
  assert.ok(EVIDENCE_TOKENS.includes('canAccessFormationCase'));
});
