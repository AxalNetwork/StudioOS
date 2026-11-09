/**
 * D4615 (#4615) — Settings saves one request at a time, so a later choice is
 * never replaced by an earlier one. The Worker's half is
 * cloudflare-worker/test/settings_privacy_notify_4615.test.ts.
 *
 * Every case drives `SerialSaver` (and the cards' savers) with promises the
 * test resolves in the order it chooses: delayed responses, a response that
 * would arrive "reversed", a failed save, a reload and another tab's save.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/settings_serial_save_4615.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SerialSaver, mergeDelta } from '../src/lib/serialSave.js';
import { categorySwitches, notificationSaver, privacySaver, publicProfileSaver } from '../src/lib/settingsSavers.js';

/** A `send` whose requests the test answers by hand. */
function server() {
  const calls = [];
  const send = (delta, revision) => new Promise((resolve, reject) => { calls.push({ delta, revision, resolve, reject }); });
  return { calls, send };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const conflict = (data) => Object.assign(new Error('changed'), { status: 409, data });

test('rapid edits: one request at a time, the later edits sent together after it, with the new revision', async () => {
  // Mutations checked: a second request sent while the first is out; the queued edit sent with the stale revision.
  const s = server();
  const views = [];
  const saver = new SerialSaver({
    initial: { visibility: 'public', show_in_directory: true }, revision: 4, send: s.send,
    accept: (r) => ({ values: r.values, revision: r.revision }), onChange: (v) => views.push(v),
  });
  saver.save({ visibility: 'private' });
  saver.save({ show_in_directory: false });
  saver.save({ visibility: 'network' });
  assert.equal(s.calls.length, 1, 'only one request in flight');
  assert.deepEqual(s.calls[0].delta, { visibility: 'private' });
  assert.equal(s.calls[0].revision, 4);
  assert.deepEqual(saver.view, { visibility: 'network', show_in_directory: false }, 'the view is the latest choice at once');
  s.calls[0].resolve({ values: { visibility: 'private', show_in_directory: true }, revision: 5 });
  await tick();
  assert.equal(s.calls.length, 2);
  assert.deepEqual(s.calls[1].delta, { show_in_directory: false, visibility: 'network' }, 'the queued edits go together');
  assert.equal(s.calls[1].revision, 5, 'named with the revision the first save returned');
  assert.deepEqual(saver.view, { visibility: 'network', show_in_directory: false }, 'the delayed first response did not pull the view back');
  s.calls[1].resolve({ values: { visibility: 'network', show_in_directory: false }, revision: 6 });
  await saver.running;
  assert.deepEqual(saver.view, { visibility: 'network', show_in_directory: false });
  assert.equal(saver.revision, 6);
  const from = views.findIndex((v) => v.visibility === 'network');
  assert.ok(from >= 0 && views.slice(from).every((v) => v.visibility === 'network'), 'once chosen, the view never went back to an earlier value');
});

test('a failed save drops only its own edit; a newer queued edit to the same field survives and is still sent', async () => {
  // Mutations checked: a failure reverting the queued edit; a failure stopping the queue.
  const s = server();
  const errors = [];
  const saver = new SerialSaver({
    initial: { discoverable: true, matching_opt_in: false }, revision: 1, send: s.send,
    accept: (r) => ({ values: r.values, revision: r.revision }), onError: (e, kind) => errors.push(kind),
  });
  saver.save({ discoverable: false });
  saver.save({ matching_opt_in: true });
  s.calls[0].reject(Object.assign(new Error('network'), { status: 500 }));
  await tick();
  assert.deepEqual(errors, ['failed']);
  assert.equal(saver.view.discoverable, true, 'the failed edit went back to what is stored');
  assert.equal(s.calls.length, 2, 'the queue kept going');
  assert.deepEqual(s.calls[1].delta, { matching_opt_in: true });
  assert.equal(s.calls[1].revision, 1, 'the failed save moved no revision');
  s.calls[1].resolve({ values: { discoverable: true, matching_opt_in: true }, revision: 2 });
  await saver.running;
  assert.deepEqual(saver.view, { discoverable: true, matching_opt_in: true });
});

test('another tab saved first: the server copy is adopted and said, and this tab\'s stale edits are not sent', async () => {
  // Mutations checked: the 409 swallowed as a plain failure; the queued stale edit sent anyway.
  const s = server();
  const errors = [];
  const saver = new SerialSaver({
    initial: { visibility: 'public' }, revision: 2, send: s.send,
    accept: (r) => ({ values: r.values, revision: r.revision }),
    conflictOf: (e) => ({ values: e.data.current, revision: e.data.revision }), onError: (e, kind) => errors.push(kind),
  });
  saver.save({ visibility: 'private' });
  saver.save({ visibility: 'network' });
  s.calls[0].reject(conflict({ current: { visibility: 'public', show_in_directory: false }, revision: 3 }));
  await tick();
  assert.deepEqual(errors, ['conflict']);
  assert.deepEqual(saver.view, { visibility: 'public', show_in_directory: false }, 'the other tab\'s choice is what shows');
  assert.equal(saver.revision, 3);
  assert.equal(s.calls.length, 1, 'nothing stale was sent after the conflict');
  // A fresh edit after the conflict goes with the new revision.
  saver.save({ visibility: 'private' });
  assert.equal(s.calls[1].revision, 3);
});

test('a reload adopts what is stored without dropping an edit still queued', async () => {
  const s = server();
  const saver = new SerialSaver({ initial: { a: 1, b: 1 }, revision: 0, send: s.send, accept: (r) => r });
  saver.save({ a: 2 });
  saver.save({ b: 2 });
  saver.reset({ a: 1, b: 1, c: 9 }, 0);
  assert.deepEqual(saver.view, { a: 2, b: 2, c: 9 });
});

test('the cards\' savers: the right route, the revision, field-level bodies, and the conflict body read', async () => {
  // Mutations checked: expected_revision dropped from a body; the whole public-profile map sent; the 409 body not read.
  const sent = [];
  const client = {
    updatePrivacySettings: async (b) => { sent.push(['privacy', b]); return { ...b, revision: 8 }; },
    updateNotificationSettings: async (b) => { sent.push(['notif', b]); return { notif_categories_email: { deals: false }, revision: 2 }; },
    updatePublicProfileSwitches: async (b) => { sent.push(['public', b]); return { public_profile_effective: { name: true, socials: true }, public_profile_revision: 5 }; },
  };
  const rows = [];
  const p = privacySaver({ visibility: 'public', revision: 7 }, (v) => rows.push(v), null, client);
  await p.save({ visibility: 'private' });
  assert.deepEqual(sent[0], ['privacy', { visibility: 'private', expected_revision: 7 }]);
  const n = notificationSaver({ notif_categories_email: {}, revision: 1 }, () => {}, null, null, client);
  await n.save({ notif_categories_email: { deals: false } });
  assert.deepEqual(sent[1], ['notif', { notif_categories_email: { deals: false }, expected_revision: 1 }], 'one category, not the whole map');
  const pp = publicProfileSaver({ public_profile_effective: { name: true, socials: false }, public_profile_revision: 4 }, () => {}, null, client);
  await pp.save({ socials: true });
  assert.deepEqual(sent[2], ['public', { fields: { socials: true }, expected_revision: 4 }]);
  assert.equal(pp.view.socials, true);
  const pc = publicProfileSaver({ public_profile_effective: { bio: true }, public_profile_revision: 1 }, () => {}, () => {}, {
    updatePublicProfileSwitches: async () => { throw conflict({ public_profile_effective: { bio: false }, public_profile_revision: 2 }); },
  });
  await pc.save({ bio: true });
  assert.equal(pc.view.bio, false, 'the profile as another tab left it');
  assert.equal(pc.revision, 2);
});

test('category switches are drawn as delivery reads them; a mandatory one is locked on', () => {
  // Mutations checked: an unset category drawn off; billing drawn unlocked.
  const sw = categorySwitches({
    notif_categories_email: { deals: false }, notif_categories_inapp: {},
    effective_categories: { email: { deals: false, billing: true, mentions: true }, inapp: { billing: true, deals: true }, locked: ['billing'] },
  });
  assert.equal(sw.email.deals, false);
  assert.equal(sw.email.mentions, true);
  assert.equal(sw.inapp.scoring, true, 'a category the server did not list reads on, as delivery treats it');
  assert.ok(sw.locked.has('billing'));
  const legacy = categorySwitches({ notif_categories_email: { billing: false }, effective_categories: { email: { billing: true }, inapp: {}, locked: ['billing'] } });
  assert.equal(legacy.email.billing, true, 'a stored opt-out of a mandatory category is not drawn');
  assert.deepEqual(mergeDelta({ m: { a: 1 }, x: 1 }, { m: { b: 2 } }), { m: { a: 1, b: 2 }, x: 1 });
});

test('the page uses the savers and draws public-profile switches from what the profile shows', () => {
  const page = readFileSync(new URL('../src/pages/SettingsPage.jsx', import.meta.url), 'utf8');
  assert.match(page, /saver\.current = privacySaver\(r, setRow, flash\)/);
  assert.match(page, /saver\.current = notificationSaver\(next, setRow, flash, setFieldErrors\)/);
  assert.match(page, /saver\.current = publicProfileSaver\(data, setPp, flash\)/);
  assert.match(page, /checked=\{pp\[key\] === true\}/);
  assert.doesNotMatch(page, /const PUBLIC_PROFILE_DEFAULTS = \{/, 'the drifted copy of the defaults is gone');
  assert.doesNotMatch(page, /save\(\{ notif_categories_email: \{ \.\.\.email/, 'no whole-map category save');
});
