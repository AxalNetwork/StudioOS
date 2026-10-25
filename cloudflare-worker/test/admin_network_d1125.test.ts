/**
 * D1125 (#3005) — the Advisors & Partners gaps on D973's reads: a roster card
 * linked to a member's account is that member's deck card; each member's
 * network stage (D976's rule) and the stage filter; the drawer's History from
 * HQ's audit log; and the header tabs' counts. Each on the real SQLite schema,
 * each with a failed source.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/admin_network_d1125.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import route from '../src/routes/admin_network_reads.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const NOW = Date.parse('2026-10-26T04:30:00Z');
const SECRET = 'test'.repeat(16);
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const migration = (file: string) => readFileSync(new URL('../sql/migrations/' + file, import.meta.url), 'utf8');

// Invented people and firms; no real names or addresses.
function fixture(drop: string[] = []) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const name of ['users', 'super_admins', 'user_sessions', 'advisors', 'network_profiles', 'partners', 'partner_profiles', 'partner_deals', 'advisor_bookings', 'partner_bookings', 'advisor_office_hour_slots', 'partner_office_hour_slots', 'advisor_reviews', 'advisor_cohort_assignments', 'admin_audit_log']) db.exec(tableFromBaseline(baseline, name));
  for (const [file, name] of [['313_lab_host_applications.sql', 'lab_host_applications'], ['238_advisor_engagements.sql', 'advisor_engagements']]) db.exec(tableFromBaseline(migration(file), name));
  db.exec(migration('551_network_profiles_roster.sql'));
  db.exec(migration('552_network_member_states.sql'));
  const insert = (table: string, value: Record<string, any>) => db.prepare(`INSERT INTO ${table} (${Object.keys(value).join(',')}) VALUES (${Object.keys(value).map(() => '?').join(',')})`).run(...Object.values(value));
  for (const [id, role, name] of [[1, 'admin', 'Admin One'], [2, 'advisor', 'Ada Example'], [3, 'partner', 'Ben Sample'], [4, 'advisor', 'Cy Onboarding'], [5, 'founder', 'Fay Founder']] as const) {
    insert('users', { id, role, name, email: `${id}@invented.example`, partner_id: id === 3 ? 9 : null, kyc_status: 'approved', is_active: 1 });
    insert('user_sessions', { user_id: id, jti: `j-${id}`, factor: 'totp' });
  }
  insert('advisors', { id: 11, uid: 'a11', user_id: 2, display_name: 'Ada Example', email: 'x@invented.example', is_active: 1 });
  insert('partners', { id: 9, name: 'Firm Nine', email: 'firm@invented.example', status: 'active' });
  insert('partners', { id: 10, name: 'Firm Ten', email: 'ten@invented.example', status: 'active' });
  // Card 1 is linked to Ada (a member); card 2 is linked to a founder (not in the network), so it stays deck-only;
  // card 3 is unlinked; card 4 is hidden; card 5 is archived and out of the list.
  insert('network_profiles', { id: 1, name: 'Ada on the deck', kind: 'advisor', display_order: 1, is_active: 1, linked_user_id: 2 });
  insert('network_profiles', { id: 2, name: 'Founder card', kind: 'advisor', display_order: 2, is_active: 1, linked_user_id: 5 });
  insert('network_profiles', { id: 3, name: 'Unlinked card', kind: 'advisor', display_order: 3, is_active: 1 });
  insert('network_profiles', { id: 4, name: 'Hidden card', kind: 'partner', display_order: 4, is_active: 0 });
  insert('network_profiles', { id: 5, name: 'Archived card', kind: 'advisor', display_order: 5, is_active: 0, archived_at: '2026-10-01 00:00:00' });
  insert('network_member_states', { user_id: 3, paused_at: '2026-10-20 10:00:00', paused_reason: 'On leave', paused_by: 1 });
  for (const drop1 of drop) db.exec(`DROP TABLE ${drop1}`);
  return { db, insert };
}
async function get(db: any, path: string) {
  const token = await new SignJWT({ user_id: 1, role: 'admin', jti: 'j-1' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const app = new Hono<any>(); app.route('/api/admin/network', route);
  const before = Date.now; Date.now = () => NOW;
  try {
    const response = await app.request('/api/admin/network' + path, { headers: { Authorization: `Bearer ${token}` } }, { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' });
    return { status: response.status, body: await response.json() as any };
  } finally { Date.now = before; }
}
const value = (b: any) => { assert.equal(b.available, true, JSON.stringify(b)); assert.equal(b.recorded, true, JSON.stringify(b)); return b.value; };
const failed = (b: any) => { assert.equal(b.available, false); assert.ok(b.reason); assert.equal('value' in b, false); };
const unknown = (b: any) => { assert.equal(b.recorded, false); assert.ok(b.reason); };
const byRef = (items: any[]) => Object.fromEntries(items.map((p) => [p.ref, p]));

test('a card linked to a member is that member\'s deck card, not a second person; its own ref opens the member', async () => {
  const { db } = fixture();
  try {
    const { status, body } = await get(db, '/people?limit=100');
    assert.equal(status, 200);
    const p = byRef(body.items);
    assert.deepEqual(Object.keys(p).sort(), ['roster:2', 'roster:3', 'roster:4', 'user:2', 'user:3', 'user:4'],
      'card 1 folds into Ada; a founder\'s card stays deck-only; an archived card is out');
    assert.deepEqual(value(p['user:2'].deck), { roster_id: 1, shown: true, reach: 'profile', position: 1, has_photo: false });
    assert.equal(value(p['user:3'].deck), null, 'a member with no card: the roster was read and holds none');
    assert.deepEqual(body.items.filter((x: any) => x.kind === 'deck_only').map((x: any) => x.ref).sort(), ['roster:2', 'roster:3', 'roster:4']);
    assert.deepEqual((await get(db, '/people?on_deck=true')).body.items.map((x: any) => x.ref).sort(), ['roster:2', 'roster:3', 'user:2'],
      'a member on the slide is on the deck');
    const opened = await get(db, '/people/roster:1');
    assert.equal(opened.status, 200);
    assert.equal(opened.body.person.ref, 'user:2', 'the linked card opens its member');
    assert.equal((await get(db, '/people/roster:5')).status, 404, 'an archived card is no one');
  } finally { db.close(); }
  const broken = fixture(['network_profiles']);
  try {
    const { body } = await get(broken.db, '/people?limit=100');
    failed(byRef(body.items)['user:2'].deck);
    assert.equal(body.available, false, 'the roster is core: the list says it is incomplete');
  } finally { broken.db.close(); }
});

test('each member carries D976\'s stage; the stage filter works; a failed standing read costs only the stage', async () => {
  const { db } = fixture();
  try {
    const p = byRef((await get(db, '/people?limit=100')).body.items);
    assert.equal(value(p['user:2'].stage), 'active');
    assert.equal(value(p['user:3'].stage), 'paused');
    assert.equal(value(p['user:4'].stage), 'onboarding', 'an Advisor with no advisor profile is onboarding');
    unknown(p['roster:3'].stage);
    assert.deepEqual((await get(db, '/people?stage=paused')).body.items.map((x: any) => x.ref), ['user:3']);
    assert.equal((await get(db, '/people?stage=sideways')).status, 400);
    assert.deepEqual((await get(db, '/people')).body.filters.stage, ['onboarding', 'active', 'paused', 'ended']);
  } finally { db.close(); }
  const broken = fixture(['network_member_states']);
  try {
    const { status, body } = await get(broken.db, '/people?limit=100');
    assert.equal(status, 200);
    const p = byRef(body.items);
    failed(p['user:2'].stage);
    assert.ok(value(p['user:2'].deck), 'the rest of the row stays');
    assert.ok(body.unreadable.includes('network_stages'));
    assert.equal((await get(broken.db, '/people?stage=active')).status, 503, 'a filter on an unread source is refused, never an empty list');
  } finally { broken.db.close(); }
});

test('History: what admins did to this person, newest first, never another person\'s rows or an email; a failed read is its own block', async () => {
  const { db, insert } = fixture();
  try {
    const log = (action: string, viewed: number | null, details: Record<string, unknown>, at: string) =>
      insert('admin_audit_log', { admin_user_id: 1, action, viewed_user_id: viewed, filters_json: JSON.stringify(details), exported_at: at });
    log('network.paused', 2, { target_user_id: 2, reason: 'Two weeks off' }, '2026-10-20 09:00:00');
    log('network.resumed', 2, { target_user_id: 2, reason: 'Back' }, '2026-10-22 09:00:00');
    log('advisor_cohort.assigned', 2, { target_user_id: 2, cohort_cycle_id: 77, assignment_id: 3 }, '2026-10-21 09:00:00');
    log('network_profile_shown', null, { id: 1 }, '2026-10-19 09:00:00'); // before the link, by card id
    log('admin_view_user', 2, { target_user_id: 2, email: 'x@invented.example' }, '2026-10-23 09:00:00'); // not a network act
    log('network.paused', 3, { target_user_id: 3, reason: 'Someone else' }, '2026-10-24 09:00:00');
    log('network_profile_updated', null, { id: 3 }, '2026-10-18 09:00:00'); // the unlinked card's
    const ada = (await get(db, '/people/user:2')).body;
    const h = value(ada.history);
    assert.equal(h.truncated, false);
    assert.deepEqual(h.items.map((i: any) => i.action), ['network.resumed', 'advisor_cohort.assigned', 'network.paused', 'network_profile_shown']);
    assert.deepEqual(h.items[0].by, { id: 1, name: 'Admin One' });
    assert.equal(h.items[0].reason, 'Back');
    assert.equal(h.items[1].cohort_cycle_id, 77);
    assert.equal(h.items[3].reason, null, 'only a pause or resume carries a reason');
    assert.doesNotMatch(JSON.stringify(ada.history), /invented\.example|Someone else|assignment_id/);
    const card = value((await get(db, '/people/roster:3')).body.history);
    assert.deepEqual(card.items.map((i: any) => i.action), ['network_profile_updated'], 'a deck-only name\'s history is its card\'s');
  } finally { db.close(); }
  const broken = fixture(['admin_audit_log']);
  try {
    const { status, body } = await get(broken.db, '/people/user:2');
    assert.equal(status, 200, 'the drawer still answers');
    failed(body.history);
    assert.ok(body.person.name);
  } finally { broken.db.close(); }
});

test('the tabs: Overview counts what Needs you lists, People the list, Firms the firms, Deck the shown cards; each fails alone', async () => {
  const { db } = fixture();
  try {
    const { status, body } = await get(db, '/tabs');
    assert.equal(status, 200);
    assert.equal(value(body.people), 6);
    assert.equal(value(body.firms), 2);
    assert.equal(value(body.deck), 3, 'shown cards only: not the hidden or the archived one');
    const needs = (await get(db, '/overview')).body.needs_you;
    const listed = ['missing_advisor_profiles', 'unattached_partners', 'ending_deals', 'pending_hosts', 'missing_deck_photos'].reduce((n, k) => n + value(needs[k]).length, 0);
    assert.equal(value(body.overview), listed, 'the Overview count is the Needs you items');
    assert.ok(listed > 0, 'the fixture has something that needs you');
  } finally { db.close(); }
  const broken = fixture(['partners']);
  try {
    const { body } = await get(broken.db, '/tabs');
    failed(body.firms);
    failed(body.overview);
    assert.equal(value(body.deck), 3, 'the deck count survives');
  } finally { broken.db.close(); }
});
