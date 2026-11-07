/**
 * D4806 (#4806, Programs audit 3/7) — Perks review and feature actions apply to the listing as the reviewer saw it.
 *
 *   1. Every review action names the listing's revision (`expected_revision`, its `updated_at`): a missing one is
 *      refused (400), a stale one is refused (409 `listing_changed`) and writes nothing.
 *   2. Feature and Stop featuring are their own operation. They act on a LIVE listing only, so a listing the
 *      dialog showed as live but that was paused, or edited by its partner, meanwhile is not republished or
 *      changed in any way; and an approve of an already-live listing is refused (`already_live`).
 *   3. The write repeats the check: a change landing between the read and the UPDATE loses too.
 *   4. A feature switch that wins changes the feature and the editorial line and nothing else, and audits it.
 *
 * Real routes on node:sqlite over the Perks harness. Every person and listing is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/perks_listing_revisions_d4806.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { freshDb, makeD1, token, ADMIN, PARTNER, addPerk } from './_perks_harness.ts';
import { ensureAdminAuditLogTable } from '../src/routes/admin.ts';
import perks from '../src/routes/perks.ts';
import { mapError } from '../src/routes/_t13t14t15_helpers.ts';

async function harness() {
  const db = freshDb();
  const env: any = { JWT_SECRET: 'unit-test-jwt-secret-0123456789-abcdef', ENVIRONMENT: 'development', DB: makeD1(db, { beforeBatch: null }) };
  await ensureAdminAuditLogTable(env);
  const app = new Hono().route('/perks', perks);
  app.onError((e, c) => mapError(c as any, e));
  const call = async (path: string, method = 'GET', data?: any, who = ADMIN) => {
    const res = await app.request(path, { method, headers: { Authorization: `Bearer ${await token(who)}`, 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }, env);
    return { status: res.status, body: await res.json() as any };
  };
  const row = (uid = 'p1') => db.prepare('SELECT * FROM perks WHERE uid = ?').get(uid) as any;
  const rev = (uid = 'p1') => String(row(uid).updated_at);
  const audits = (action: string) => db.prepare('SELECT filters_json FROM admin_audit_log WHERE action = ?').all(action).length;
  return { db, env, call, row, rev, audits };
}
const feature = (h: any, body: Record<string, unknown>, uid = 'p1') => h.call(`/perks/admin/${uid}/feature`, 'POST', body);
const review = (h: any, body: Record<string, unknown>, uid = 'p1') => h.call(`/perks/admin/${uid}/review`, 'POST', body);

test('1. a review names the revision it read: missing is 400, stale is 409 and writes nothing', async () => {
  const h = await harness();
  try {
    addPerk(h.db, 'p1', { status: 'in_review' });
    h.db.prepare("UPDATE perks SET updated_at = '2026-11-01T10:00:00.000Z' WHERE uid = 'p1'").run();
    const before = h.row();
    const none = await review(h, { action: 'approve' });
    assert.equal(none.status, 400); assert.equal(none.body.error, 'expected_revision_required');
    const stale = await review(h, { action: 'approve', expected_revision: '2026-10-31T10:00:00.000Z' });
    assert.equal(stale.status, 409); assert.equal(stale.body.error, 'listing_changed');
    assert.match(stale.body.message, /Nothing was changed/);
    assert.deepEqual(h.row(), before, 'neither wrote anything');
    assert.equal(h.audits('perk.approved'), 0);
    const ok = await review(h, { action: 'approve', expected_revision: '2026-11-01T10:00:00.000Z' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(h.row().status, 'live');
    assert.notEqual(ok.body.revision, '2026-11-01T10:00:00.000Z', 'the answer carries the new revision');
    assert.equal(h.rev(), ok.body.revision);
  } finally { h.db.close(); }
});

test('2. a feature switch cannot republish a listing that was paused while the dialog was open', async () => {
  const h = await harness();
  try {
    addPerk(h.db, 'p1', { status: 'live', featured: 0 });
    const seen = h.rev();     // the revision the reviewer's dialog read, with the listing live
    // Another admin pauses it.
    await new Promise((r) => setTimeout(r, 5));
    const paused = await review(h, { action: 'pause', expected_revision: seen });
    assert.equal(paused.status, 200, JSON.stringify(paused.body));
    const before = h.row();
    assert.equal(before.status, 'paused');

    const stale = await feature(h, { featured: true, editorial_note: 'Our pick', expected_revision: seen });
    assert.equal(stale.status, 409); assert.equal(stale.body.error, 'listing_changed');
    assert.deepEqual(h.row(), before, 'the paused listing is exactly as it was');

    // Even with the current revision, a feature switch is only for a live listing.
    const notLive = await feature(h, { featured: true, expected_revision: h.rev() });
    assert.equal(notLive.status, 409); assert.equal(notLive.body.error, 'not_live');
    assert.deepEqual(h.row(), before);
    assert.equal(h.audits('perk.feature_updated'), 0);
  } finally { h.db.close(); }
});

test('2b. nor one its partner edited meanwhile; and an approve of a live listing is refused, so it cannot be republished either', async () => {
  const h = await harness();
  try {
    addPerk(h.db, 'p1', { status: 'live', featured: 1, editorial_note: 'Old line' });
    const seen = h.rev();
    await new Promise((r) => setTimeout(r, 5));
    // The partner edits the live listing: it returns to review and its revision moves.
    const edited = await h.call('/perks/partner/p1', 'PATCH', { offer: 'A different offer' }, PARTNER);
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(h.row().status, 'in_review');
    assert.notEqual(h.rev(), seen);
    const before = h.row();
    const stale = await feature(h, { featured: false, expected_revision: seen });
    assert.equal(stale.status, 409); assert.equal(stale.body.error, 'listing_changed');
    assert.deepEqual(h.row(), before, 'the edited listing was neither featured, un-featured nor published');

    // An approve of a listing that is live is refused outright (its feature has its own operation).
    h.db.prepare("UPDATE perks SET status = 'live'").run();
    const live = await review(h, { action: 'approve', featured: true, expected_revision: h.rev() });
    assert.equal(live.status, 409); assert.equal(live.body.error, 'already_live');
  } finally { h.db.close(); }
});

test('3. the write repeats the check: a change landing between the read and the UPDATE loses', async () => {
  const h = await harness();
  try {
    addPerk(h.db, 'p1', { status: 'live', featured: 0 });
    const prepare = h.env.DB.prepare.bind(h.env.DB);
    let raced = 0;
    h.env.DB.prepare = (sql: string) => {
      const stmt = prepare(sql), run = stmt.run;
      if (sql.startsWith('UPDATE perks SET featured')) stmt.run = async () => {
        raced++; h.db.exec("UPDATE perks SET status = 'paused', updated_at = '2099-01-01T00:00:00.000Z' WHERE uid = 'p1'"); return run();
      };
      return stmt;
    };
    const lost = await feature(h, { featured: true, expected_revision: h.rev() });
    assert.equal(lost.status, 409, JSON.stringify(lost.body)); assert.equal(lost.body.error, 'listing_changed');
    assert.equal(raced, 1);
    const after = h.row();
    assert.deepEqual([after.status, after.featured], ['paused', 0], 'the pause stands and nothing was featured');
    assert.equal(h.audits('perk.feature_updated'), 0, 'and no audit line says otherwise');
  } finally { h.db.close(); }
});

test('4. a feature switch that wins changes the feature and its line and nothing else, and audits it', async () => {
  const h = await harness();
  try {
    addPerk(h.db, 'p1', { status: 'live', featured: 0 });
    h.db.prepare("UPDATE perks SET review_note = 'kept', reviewed_by_user_id = ?, reviewed_at = '2026-10-01T00:00:00.000Z'").run(ADMIN);
    const was = h.row();
    assert.equal((await feature(h, { editorial_note: 'x', expected_revision: h.rev() })).body.error, 'bad_featured');
    assert.equal((await feature(h, { featured: true, expected_revision: h.rev() }, 'absent')).status, 404);
    const on = await feature(h, { featured: true, editorial_note: ' Our pick this month. ', expected_revision: h.rev() });
    assert.equal(on.status, 200, JSON.stringify(on.body));
    assert.deepEqual([on.body.status, on.body.featured], ['live', true]);
    const row = h.row();
    assert.deepEqual([row.status, row.featured, row.editorial_note], ['live', 1, 'Our pick this month.']);
    assert.deepEqual([row.review_note, row.reviewed_by_user_id, row.reviewed_at], [was.review_note, was.reviewed_by_user_id, was.reviewed_at], 'the review record is untouched');
    assert.equal(h.audits('perk.feature_updated'), 1);

    const same = await feature(h, { featured: true, editorial_note: 'Our pick this month.', expected_revision: on.body.revision });
    assert.equal(same.status, 409); assert.equal(same.body.error, 'no_change');
    const off = await feature(h, { featured: false, expected_revision: on.body.revision });
    assert.equal(off.status, 200); assert.equal(h.row().featured, 0);
    assert.equal(h.row().status, 'live');
    assert.equal(h.audits('perk.feature_updated'), 2);
  } finally { h.db.close(); }
});
