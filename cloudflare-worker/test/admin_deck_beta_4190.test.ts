/**
 * #4190 (K3 of #4155, D4155) — HQ › Decks › Beta cohort.
 *
 *   1. HQ adds named people to deck features with a reason: one `user`-scope
 *      row per person and key, one audit row per person; the features turn on
 *      for them and no one else.
 *   2. A reason is required for an add and a removal; an unknown key is refused.
 *   3. Neither read carries an email; people are found by name (2+ characters,
 *      at most 10).
 *   4. HQ only.
 *   5. Removing a person clears their deck keys (rows and beta column) and
 *      leaves what they made: their deck, its logo wall, their rehearsal.
 *
 * On the real migrated schema. Every person here is invented.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/admin_deck_beta_4190.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import betaRoutes, { mount, keysOf } from '../src/routes/admin_deck_beta.ts';
import { flagsFor } from '../src/services/featureFlags.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

after(() => removeMigratedDatabases());

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HQ = 1, ADA = 2, BEN = 3, CAL = 4;
const REASON = 'Early access for the November cohort.';

function world(extraEnv: Record<string, unknown> = {}) {
  const db = migratedDatabase();
  const u = db.prepare('INSERT INTO users (id, uid, role, name, email, is_active) VALUES (?, ?, ?, ?, ?, 1)');
  u.run(HQ, 'u-hq', 'admin', 'Hana HQ', 'hana@example.test');
  u.run(ADA, 'u-ada', 'founder', 'Ada Lindqvist', 'ada@example.test');
  u.run(BEN, 'u-ben', 'founder', 'Ben Adair', 'ben@example.test');
  u.run(CAL, 'u-cal', 'founder', 'Cal Moreau', 'cal@example.test');
  db.exec(`INSERT INTO company_profiles (id, uid, company_name) VALUES (50, 'cp-50', 'Kestrel Labs');
    INSERT INTO user_company_links (uid, company_id, user_id) VALUES ('l-1', 50, ${ADA});
    INSERT INTO user_settings (user_id, feature_flags) VALUES (${ADA}, '{"grid_generate":true,"theme":"dark"}');`);
  const env = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...extraEnv } as any;
  const app = new Hono<any>().route(mount.path, betaRoutes);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  async function call(who: number | null, method: string, path = '', body?: unknown) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (who) headers.Authorization = `Bearer ${await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
    const res = await app.request(`${mount.path}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, text };
  }
  const audits = () => (db.prepare("SELECT action, details FROM activity_logs WHERE action LIKE 'deck_beta_%' ORDER BY id").all() as any[])
    .map((r) => ({ action: r.action, ...JSON.parse(r.details) }));
  return { db, env, call, audits };
}

test('#4190: HQ adds named people with a reason; the features turn on for them alone; one audit row each', async () => {
  // Mutation checked: one audit row for the batch → the per-person count fails; rows written enabled = 0 → the flag stays off for Ada.
  const w = world();
  try {
    w.db.exec("INSERT INTO feature_flags (key, scope, scope_id, enabled) VALUES ('deck:rehearsal', 'global', '', 0)");
    const add = await w.call(HQ, 'POST', '', { user_uids: ['u-ada', 'u-ben'], features: ['deck:rehearsal', 'grid_generate'], reason: REASON });
    assert.equal(add.status, 201, add.text);
    assert.deepEqual(add.body.added.sort(), ['u-ada', 'u-ben']);
    for (const id of [ADA, BEN]) assert.equal((await flagsFor(w.env, { id, role: 'founder' } as any)).on('deck:rehearsal'), true, `on for ${id}`);
    assert.equal((await flagsFor(w.env, { id: CAL, role: 'founder' } as any)).on('deck:rehearsal'), false, 'not for anyone else');
    const rows = w.audits();
    assert.equal(rows.length, 2, 'one audit row per person');
    assert.deepEqual(rows.map((r) => [r.action, r.target_user_id, r.reason]).sort(), [['deck_beta_add', ADA, REASON], ['deck_beta_add', BEN, REASON]]);
    // element:* means every grid element.
    const all = keysOf(['element:*']);
    assert.ok(all && all.length > 20 && all.every((k) => k.startsWith('element:')));
  } finally { w.db.close(); }
});

test('#4190: a reason is required, an unknown key or person is refused, and nothing is written', async () => {
  // Mutation checked: the reason check dropped on POST or DELETE → the write lands; keysOf accepting any key → model:… is written.
  const w = world();
  try {
    const bare = await w.call(HQ, 'POST', '', { user_uids: ['u-ada'], features: ['deck:rehearsal'], reason: 'short' });
    assert.deepEqual([bare.status, bare.body.error], [400, 'reason_required']);
    for (const features of [['model:@cf/meta/llama-guard-3-8b'], ['deck:nope'], []]) {
      const r = await w.call(HQ, 'POST', '', { user_uids: ['u-ada'], features, reason: REASON });
      assert.deepEqual([r.status, r.body.error], [400, 'invalid_feature'], JSON.stringify(features));
    }
    const ghost = await w.call(HQ, 'POST', '', { user_uids: ['u-ada', 'u-ghost'], features: ['deck:rehearsal'], reason: REASON });
    assert.deepEqual([ghost.status, ghost.body.error], [404, 'person_not_found']);
    assert.equal((w.db.prepare("SELECT COUNT(*) AS n FROM feature_flags WHERE scope = 'user'").get() as any).n, 0);
    await w.call(HQ, 'POST', '', { user_uids: ['u-ada'], features: ['deck:rehearsal'], reason: REASON });
    const noWhy = await w.call(HQ, 'DELETE', '/u-ada', { reason: '' });
    assert.deepEqual([noWhy.status, noWhy.body.error], [400, 'reason_required']);
    assert.equal((w.db.prepare("SELECT COUNT(*) AS n FROM feature_flags WHERE scope = 'user'").get() as any).n, 1, 'still in');
  } finally { w.db.close(); }
});

test('#4190: the cohort and the people search name people, never an email', async () => {
  // Mutation checked: u.email selected into either read → the email check fails; the 2-character floor dropped → a 1-letter search answers.
  const w = world();
  try {
    await w.call(HQ, 'POST', '', { user_uids: ['u-ada'], features: ['deck:logo_wall', 'element:*'], reason: REASON });
    const list = await w.call(HQ, 'GET');
    assert.equal(list.status, 200, list.text);
    assert.equal(list.body.total, 1);
    const [p] = list.body.people;
    assert.deepEqual([p.user, p.company, p.added_by], [{ uid: 'u-ada', name: 'Ada Lindqvist' }, 'Kestrel Labs', { uid: 'u-hq', name: 'Hana HQ' }]);
    assert.ok(p.features.includes('deck:logo_wall') && p.features.some((k: string) => k.startsWith('element:')));
    assert.ok(list.body.keys.some((k: any) => k.key === 'deck:rehearsal' && k.label === 'Rehearsal'));
    assert.equal((await w.call(HQ, 'GET', '?q=kestrel')).body.total, 1, 'by company');
    assert.equal((await w.call(HQ, 'GET', '?q=ben')).body.total, 0);
    assert.equal((await w.call(HQ, 'GET', '?feature=deck:rehearsal')).body.total, 0);
    assert.equal((await w.call(HQ, 'GET', '?added_by=u-hq')).body.total, 1);
    const search = await w.call(HQ, 'GET', '/people?q=ad');
    assert.equal(search.status, 200);
    assert.deepEqual(search.body.people.map((x: any) => x.name).sort(), ['Ada Lindqvist', 'Ben Adair']);
    assert.equal(search.body.people.find((x: any) => x.uid === 'u-ada').company, 'Kestrel Labs');
    assert.equal((await w.call(HQ, 'GET', '/people?q=a')).status, 400, 'at least 2 characters');
    for (const t of [list.text, search.text]) assert.ok(!/@example\.test/.test(t), 'never an email');
  } finally { w.db.close(); }
});

test('#4190: HQ only; a branch and a member are refused', async () => {
  // Mutation checked: requireAuth in place of requireHqAdmin → the founder lists the cohort.
  const w = world();
  try {
    assert.equal((await w.call(null, 'GET')).status, 401);
    for (const [m, p, b] of [['GET', '', undefined], ['GET', '/people?q=ad', undefined], ['POST', '', { user_uids: ['u-ben'], features: ['grid_generate'], reason: REASON }], ['DELETE', '/u-ada', { reason: REASON }]] as const) {
      assert.equal((await w.call(ADA, m, p, b)).status, 403, `${m} ${p}`);
    }
  } finally { w.db.close(); }
  const b = world({ BRANCH_CODE: 'lisbon' });
  try { assert.equal((await b.call(HQ, 'GET')).status, 403); } finally { b.db.close(); }
});

test('#4190: removing a person clears their deck keys and leaves what they made', async () => {
  // Mutation checked: the beta column left as it was → grid_generate stays on for Ada; a content table touched → her deck, logo or rehearsal is gone.
  const w = world();
  try {
    w.db.exec(`INSERT INTO feature_flags (key, scope, scope_id, enabled) VALUES ('grid_generate', 'global', '', 0), ('deck:logo_wall', 'global', '', 0);
      INSERT INTO projects (id, name, founder_id) VALUES (10, 'Kestrel', 1010);
      INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current) VALUES (7, 10, 1, '[{"title":"Customers","blocks":[{"element":"logo_wall","kind":"graphic","logo_key":"logo_0123456789abcdef01234567"}]}]', 'Seed', 1);
      INSERT INTO deck_logos (project_id, logo_key, customer_name, image_uid, permitted, permitted_at, permission_reference) VALUES (10, 'logo_0123456789abcdef01234567', 'Northwind', 'img-1', 1, '2026-10-01', 'Signed email, 1 Oct');
      INSERT INTO deck_rehearsals (uid, deck_id, project_id, user_id, pitch_seconds, duration_ms) VALUES ('reh-1', 7, 10, ${ADA}, 180, 170000);`);
    await w.call(HQ, 'POST', '', { user_uids: ['u-ada'], features: ['deck:logo_wall', 'deck:rehearsal'], reason: REASON });
    const before = await flagsFor(w.env, { id: ADA, role: 'founder' } as any);
    assert.deepEqual([before.on('deck:logo_wall'), before.on('grid_generate')], [true, true], 'the row and the beta column');
    const del = await w.call(HQ, 'DELETE', '/u-ada', { reason: 'The November cohort has ended.' });
    assert.equal(del.status, 200, del.text);
    assert.deepEqual(del.body.cleared, ['deck:logo_wall', 'deck:rehearsal']);
    const afterF = await flagsFor(w.env, { id: ADA, role: 'founder' } as any);
    assert.deepEqual([afterF.on('deck:logo_wall'), afterF.on('grid_generate')], [false, false], 'back to everyone\'s setting');
    assert.deepEqual(JSON.parse((w.db.prepare('SELECT feature_flags FROM user_settings WHERE user_id = ?').get(ADA) as any).feature_flags), { theme: 'dark' }, 'other settings kept');
    for (const [t, where] of [['pitch_decks', 'id = 7'], ['deck_logos', "logo_key = 'logo_0123456789abcdef01234567'"], ['deck_rehearsals', "uid = 'reh-1'"]]) {
      assert.equal((w.db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${where}`).get() as any).n, 1, `${t} stays`);
    }
    assert.match((w.db.prepare('SELECT slides FROM pitch_decks WHERE id = 7').get() as any).slides, /logo_wall/);
    assert.deepEqual(w.audits().at(-1), { action: 'deck_beta_remove', target_user_id: ADA, features: ['deck:logo_wall', 'deck:rehearsal'], reason: 'The November cohort has ended.' });
    assert.equal((await w.call(HQ, 'GET')).body.total, 0, 'out of the cohort');
  } finally { w.db.close(); }
});
