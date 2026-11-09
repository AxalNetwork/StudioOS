/**
 * D4615 (#4615) — privacy and notification integrity.
 *
 * Real SQLite over every migration; the real settings router and the real
 * `notify()` dispatcher. Pinned, from the issue's acceptance criteria:
 *   · a privacy save changes only the fields it names and is checked against
 *     the revision it read; a stale one (a delayed request, another tab) is a
 *     409 that changes nothing;
 *   · category maps merge key by key; a mandatory category cannot be turned off;
 *   · preferences saved through the routes decide delivery in the dispatcher:
 *     category opt-outs, event overrides and mandatory exceptions;
 *   · the defaults Settings is given are the ones delivery uses.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/settings_privacy_notify_4615.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import settings from '../src/routes/settings.ts';
import { notify } from '../src/services/notify.ts';
import { effectiveChannels, effectiveCategoryDefaults, mergeCategoryPatch } from '../src/services/notificationPolicy.ts';

const SECRET = ['d4615', 'settings', 'fixture', 'secret'].join('-');
const ME = 41, OTHER = 42;

function fixture() {
  const db = new DatabaseSync(':memory:', { ...SCHEMA_OPTIONS });
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, uid, role, name, email) VALUES (?, ?, ?, ?, ?)');
  u.run(ME, 'u-me', 'founder', 'Mel Member', 'mel@example.test');
  u.run(OTHER, 'u-other', 'partner', 'Otto Other', 'otto@example.test');
  const env = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  const app = new Hono<any>();
  app.route('/api/settings', settings);
  app.onError((err: any, c) => {
    const s = ({ Unauthorized: 401 } as Record<string, 401>)[String(err?.message || '')];
    if (s) return c.json({ detail: err.message }, s);
    throw err;
  });
  async function call(as: number, method: string, path: string, body?: unknown) {
    const token = await new SignJWT({ user_id: as }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
    try {
      const res = await withThrownResponses(() => app.request(path, {
        method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }, env));
      let json: any = null; try { json = await res.json(); } catch { json = null; }
      return { status: res.status, body: json };
    } finally { [console.warn, console.error] = saved; }
  }
  const one = (sql: string, ...a: unknown[]) => ({ ...(db.prepare(sql).get(...a) as any) });
  const count = (sql: string, ...a: unknown[]) => Number((db.prepare(sql).get(...a) as any).n);
  return { db, env, call, one, count };
}

test('privacy: field-level, revision-checked; a stale save changes nothing and says what is stored', async () => {
  const { call, one } = fixture();
  const read = await call(ME, 'GET', '/api/settings/privacy');
  assert.equal(read.status, 200);
  assert.equal(read.body.revision, 0);
  // Tab A hides the profile.
  const a = await call(ME, 'PUT', '/api/settings/privacy', { visibility: 'private', expected_revision: 0 });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.revision, 1);
  // Tab B, still on revision 0, tries to change the directory listing: refused, and told what is stored now.
  const b = await call(ME, 'PUT', '/api/settings/privacy', { show_in_directory: false, expected_revision: 0 });
  assert.equal(b.status, 409);
  assert.equal(b.body.code ?? b.body.error, 'privacy_conflict');
  assert.equal(b.body.current.visibility, 'private');
  assert.equal(b.body.current.show_in_directory, true, 'the stale write changed nothing');
  // With the revision it now holds, B's change lands and A's is kept: field-level.
  const b2 = await call(ME, 'PUT', '/api/settings/privacy', { show_in_directory: false, expected_revision: 1 });
  assert.equal(b2.status, 200);
  assert.equal(b2.body.visibility, 'private');
  assert.equal(b2.body.show_in_directory, false);
  const row = one('SELECT visibility, show_in_directory, privacy_revision FROM user_settings WHERE user_id = ?', ME);
  assert.deepEqual([row.visibility, row.show_in_directory, row.privacy_revision], ['private', 0, 2]);
  // A client that names no revision still writes field by field, and moves the revision on.
  const legacy = await call(ME, 'PUT', '/api/settings/privacy', { discoverable: false });
  assert.equal(legacy.body.revision, 3);
  assert.equal(legacy.body.visibility, 'private');
  assert.equal((await call(ME, 'PUT', '/api/settings/privacy', { discoverable: true, expected_revision: 'x' })).status, 400);
});

test('notification categories merge key by key; a mandatory category cannot be turned off; defaults are what delivery uses', async () => {
  const { call } = fixture();
  const read = await call(ME, 'GET', '/api/settings/notifications');
  assert.equal(read.body.revision, 0);
  assert.equal(read.body.effective_categories.email.deals, true, 'nothing stored reads on, as delivery treats it');
  assert.equal(read.body.effective_categories.inapp.billing, true);
  assert.deepEqual(read.body.effective_categories.locked, ['billing']);
  const a = await call(ME, 'PUT', '/api/settings/notifications', { notif_categories_email: { deals: false }, expected_revision: 0 });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  const stale = await call(ME, 'PUT', '/api/settings/notifications', { notif_categories_email: { mentions: false }, expected_revision: 0 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code ?? stale.body.error, 'notifications_conflict');
  const b = await call(ME, 'PUT', '/api/settings/notifications', { notif_categories_email: { mentions: false }, expected_revision: 1 });
  assert.deepEqual(b.body.notif_categories_email, { deals: false, mentions: false }, 'merged, not replaced');
  assert.equal(b.body.effective_categories.email.calendar, true);
  const cleared = await call(ME, 'PUT', '/api/settings/notifications', { notif_categories_email: { deals: null }, expected_revision: 2 });
  assert.deepEqual(cleared.body.notif_categories_email, { mentions: false }, 'null puts a category back to its default');
  const billing = await call(ME, 'PUT', '/api/settings/notifications', { notif_categories_email: { billing: false } });
  assert.equal(billing.status, 400);
  assert.match(billing.body.error, /always sent/);
  assert.equal((await call(ME, 'PUT', '/api/settings/notifications', { notif_categories_inapp: { nonsense: true } })).status, 400);
});

test('the dispatcher honours what the routes saved: category opt-outs, event overrides, mandatory exceptions', async () => {
  const { call, env, count, db } = fixture();
  const inbox = (type: string) => count('SELECT COUNT(*) AS n FROM notifications_inbox WHERE user_id = ? AND type = ?', ME, type);
  // Weekly digest is the default, so a non-critical email that is let through lands in the outbox.
  const queued = (type: string) => count('SELECT COUNT(*) AS n FROM notification_outbox WHERE user_id = ? AND type = ?', ME, type);

  // Baseline: nothing stored, both channels go out.
  await notify(env, { userId: ME, type: 'deal_assigned', title: 'A deal', category: 'deals', channels: ['in_app', 'email'] });
  assert.equal(inbox('deal_assigned'), 1);
  assert.equal(queued('deal_assigned'), 1);

  // Category opt-outs saved through the route stop delivery on that channel only.
  await call(ME, 'PUT', '/api/settings/notifications', { notif_categories_email: { deals: false }, notif_categories_inapp: { mentions: false } });
  await notify(env, { userId: ME, type: 'deal_stage', title: 'Stage moved', category: 'deals', channels: ['in_app', 'email'] });
  assert.equal(inbox('deal_stage'), 1, 'in-app is still on for deals');
  assert.equal(queued('deal_stage'), 0, 'the deals email opt-out stopped the email before it was queued');
  await notify(env, { userId: ME, type: 'mentioned', title: 'You were mentioned', category: 'mentions', channels: ['in_app'] });
  assert.equal(inbox('mentioned'), 0, 'the mentions in-app opt-out stopped the inbox row');

  // An event switch stored as on (a preset writes every event) does not win over a category opt-out…
  await call(ME, 'PATCH', '/api/settings', { notification_prefs: { deal_note: { email: true, in_app: true } } });
  await notify(env, { userId: ME, type: 'deal_note', title: 'Note', category: 'deals', channels: ['email'] });
  assert.equal(queued('deal_note'), 0);
  // …and an event switch turned off narrows a category that is on.
  await call(ME, 'PATCH', '/api/settings', { notification_prefs: { calendar_invite: { in_app: false } } });
  await notify(env, { userId: ME, type: 'calendar_invite', title: 'Invite', category: 'calendar', channels: ['in_app', 'email'] });
  assert.equal(inbox('calendar_invite'), 0);
  assert.equal(queued('calendar_invite'), 1, 'the email of an event left on still goes');

  // Mandatory: a billing opt-out stored before the lock existed does not stop billing messages.
  db.prepare("UPDATE user_settings SET notif_categories_inapp = '{\"billing\":false}' WHERE user_id = ?").run(ME);
  await notify(env, { userId: ME, type: 'invoice_due', title: 'Invoice due', category: 'billing', channels: ['in_app'] });
  assert.equal(inbox('invoice_due'), 1);

  // Another member's choices never decide this member's delivery.
  await call(OTHER, 'PUT', '/api/settings/notifications', { notif_categories_inapp: { scoring: false } });
  await notify(env, { userId: ME, type: 'score_ready', title: 'Score', category: 'scoring', channels: ['in_app'] });
  assert.equal(inbox('score_ready'), 1);
});

test('public-profile switches: one field per save, revision-checked, and the answer is what the profile shows', async () => {
  const { call, one } = fixture();
  const read = await call(ME, 'GET', '/api/settings');
  assert.equal(read.status, 200, JSON.stringify(read.body));
  assert.equal(read.body.public_profile_revision, 0);
  assert.equal(read.body.public_profile_effective.socials, false, 'the founder default the public profile is served with');
  assert.equal(read.body.public_profile_effective.background, true);
  const a = await call(ME, 'PUT', '/api/settings/privacy/public-profile', { fields: { socials: true }, expected_revision: 0 });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.public_profile_revision, 1);
  assert.equal(a.body.public_profile_effective.socials, true);
  // A second tab, still on revision 0, cannot overwrite it.
  const stale = await call(ME, 'PUT', '/api/settings/privacy/public-profile', { fields: { bio: false }, expected_revision: 0 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.public_profile_effective.socials, true);
  const b = await call(ME, 'PUT', '/api/settings/privacy/public-profile', { fields: { bio: false }, expected_revision: 1 });
  assert.equal(b.body.public_profile_effective.socials, true, 'the first switch survives the second save');
  assert.equal(b.body.public_profile_effective.bio, false);
  // Reopening: the stored choices and what the profile shows agree.
  const again = await call(ME, 'GET', '/api/settings');
  assert.deepEqual(again.body.public_profile_effective, b.body.public_profile_effective);
  assert.equal((await call(ME, 'PUT', '/api/settings/privacy/public-profile', { fields: { password: true } })).status, 400);
  assert.equal((await call(ME, 'PUT', '/api/settings/privacy/public-profile', { fields: { bio: 'yes' } })).status, 400);
  // The older whole-map save moves the revision on too, so a tab holding the old one is refused afterwards.
  await call(ME, 'PATCH', '/api/settings', { privacy_prefs: { public_profile: { name: true } } });
  assert.equal(JSON.parse(one('SELECT privacy_prefs FROM users WHERE id = ?', ME).privacy_prefs).revision, 3);
  assert.equal((await call(ME, 'PUT', '/api/settings/privacy/public-profile', { fields: { bio: true }, expected_revision: 2 })).status, 409);
});

test('the policy, pure: precedence and the effective defaults', () => {
  const cats = { email: { deals: false }, inapp: {} };
  assert.deepEqual(effectiveChannels({ type: 'x', category: 'deals', requested: ['in_app', 'email', 'slack'], eventPrefs: {}, categories: cats }).channels, ['in_app', 'slack'],
    'a category switch never touches Slack');
  assert.deepEqual(effectiveChannels({ type: 'agreement_ready_to_sign', category: 'deals', requested: ['email'], eventPrefs: { agreement_ready_to_sign: { email: false } }, categories: cats }).channels, ['email'],
    'a locked email type is always emailed');
  assert.deepEqual(effectiveChannels({ type: 'y', category: 'security', requested: ['in_app'], eventPrefs: { y: { in_app: false } }, categories: { email: {}, inapp: { security: false } } }).channels, [],
    'a mandatory category ignores category opt-outs but not its event switch for in-app');
  assert.deepEqual(effectiveChannels({ type: 'z', category: null, requested: ['in_app'], eventPrefs: {}, categories: { email: {}, inapp: { deals: false } } }).channels, ['in_app'],
    'an uncategorised message is not touched by category switches');
  assert.deepEqual(effectiveChannels({ type: 'z', category: 'deals', requested: ['email'], eventPrefs: {}, categories: null }).channels, ['email'],
    'settings that could not be read leave delivery on');
  const d = effectiveCategoryDefaults({ email: { billing: false, scoring: false }, inapp: {} });
  assert.equal(d.email.billing, true);
  assert.equal(d.email.scoring, false);
  assert.equal(mergeCategoryPatch({ a: 1 } as any, { deals: true }).ok, true);
  assert.equal(mergeCategoryPatch({}, ['deals']).ok, false);
});
