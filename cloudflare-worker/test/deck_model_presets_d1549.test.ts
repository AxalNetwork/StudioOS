/**
 * D1549 (#3796, deck v2 C1) — the deck's preset (Fast, Balanced, Best,
 * Custom) per element group, and HQ's org default and lock on
 * `deck_model_picks`: `presetModelFor`, the lock in `resolveElementModel`,
 * `GET/PUT /api/decks/:id/model-presets`, `GET/PUT /api/admin/ai/deck-models`,
 * and the deck's run and quote resolving each element through them.
 *
 * Synthetic data, the mounted Worker routes and the real migrated schema;
 * `env.AI` is a stub and `fetch` throws, so no test reaches a provider.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_model_presets_d1549.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckElementModels from '../src/routes/deck_element_models.ts';
import { adminDeckModels, deckModelPresets, LOCK_LINE } from '../src/routes/deck_model_presets.ts';
import deckNew from '../src/routes/deck_new.ts';
import deckImages from '../src/routes/deck_images.ts';
import decks from '../src/routes/decks.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { modelById } from '../src/services/ai/catalogue.ts';
import { jobStep } from '../src/services/ai/modelUseCases.ts';
import {
  ELEMENTS, PRESETS, choicesFor, groupElements, isRouted, lockedOut, presetModelFor, resolveElementModel, type PickRow,
} from '../src/services/decks/elementModels.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard, GUARD_MODEL } from './_guard_stub.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const LLAMA = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const MISTRAL = '@cf/mistralai/mistral-small-3.1-24b-instruct';
const GLM = '@cf/zai-org/glm-4.7-flash';
const SCHNELL = '@cf/black-forest-labs/flux-1-schnell';
const KLEIN4 = '@cf/black-forest-labs/flux-2-klein-4b';
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const row = (scope: PickRow['scope'], scope_id: string, key: string, model: string, locked = 0): PickRow => ({ scope, scope_id, key, model, locked, plan_min: null, set_by: 9 });

// ─────────────────────────────────────────────────────────── presets per group

test('presets: each element runs its own job\'s Fast, Balanced or Best row, one of its own choices; no model is named in the new code', () => {
  // Mutation checked: presetModelFor not testing the element's choices → the edit_vary Fast assert fails.
  for (const f of ['../src/routes/deck_model_presets.ts', '../src/services/decks/elementModels.ts']) assert.equal(/@cf\//.test(read(f)), false, `${f} names a model itself`);
  assert.deepEqual([...PRESETS], ['fast', 'balanced', 'best']);
  for (const e of ELEMENTS.filter((x) => isRouted(x.id))) {
    const job = jobStep(e.job!, 0)!;
    const choices = [...choicesFor(e.id).suggested, ...choicesFor(e.id).more].map((m) => m.id);
    for (const p of PRESETS) {
      const m = presetModelFor(e.id, p);
      if (m) { assert.equal(m, job.presets![p], `${e.id} ${p}`); assert.ok(choices.includes(m), `${e.id} ${p} is one of its choices`); assert.ok(modelById(m), `${e.id} ${p} is a catalogue model`); }
      else assert.ok(!job.presets?.[p] || !choices.includes(job.presets[p]!), `${e.id} ${p} is skipped only when the element cannot run it`);
    }
  }
  assert.deepEqual(PRESETS.map((p) => presetModelFor('body', p)), [GLM, LLAMA, MISTRAL], 'Text: its DK2 rows');
  assert.equal(presetModelFor('photo', 'fast'), SCHNELL, 'Images: its DK4 Fast row');
  // A preset row the element does not offer now (a draw model under policy) is no model, never a stand-in.
  for (const p of PRESETS) { const m = presetModelFor('photo', p); assert.ok(m === null || m === jobStep('DK4', 0)!.presets![p]); }
  assert.equal(presetModelFor('edit_vary', 'fast'), KLEIN4, 'an edit runs its own DK5 row, not the draw\'s');
});

// ─────────────────────────────────────────────────────────── the lock wins

test('an org lock wins over every other level: area, deck element, deck group, deck preset, my default and HQ\'s default', () => {
  // Mutations checked: the lock not skipping the member-set levels → the retired-lock assert fails (the deck pick wins);
  // a plan-blocked lock falling through → the lockedOut assert fails (a lower level runs).
  const others = [
    row('area', '1/3/a2', 'body', GLM),
    row('deck', '1', 'body', GLM),
    row('deck', '1', 'group:text', GLM),
    row('deck', '1', 'preset', 'fast'),
    row('member', '2', 'body', GLM),
    row('member', '2', 'group:text', GLM),
    row('org', 'hq', 'group:text', GLM, 0),
  ];
  for (const lock of [row('org', 'hq', 'body', MISTRAL, 1), row('org', 'hq', 'group:text', MISTRAL, 1)]) {
    // Every subset of the other levels, so no single level can beat the lock.
    for (let mask = 0; mask < 1 << others.length; mask++) {
      const rows = [...others.filter((_, i) => mask & (1 << i)), lock];
      const r = resolveElementModel({ element: 'body', rows, deck: '1', member: '2', area: { card: 3, area: 'a2' }, planRank: 2, env: {} });
      assert.deepEqual([r.model, r.source, r.locked], [MISTRAL, 'org_lock', true], `${lock.key}, levels ${mask.toString(2)}`);
    }
  }
  // Every element of a locked group runs the lock where it offers the model.
  for (const id of groupElements('text')) {
    const r = resolveElementModel({ element: id, rows: [...others, row('org', 'hq', 'group:text', MISTRAL, 1)], deck: '1', member: '2', planRank: 2, env: {} });
    assert.equal(r.model, MISTRAL, id);
  }
  // A lock whose model is retired: no member-set level is read; HQ's default, then the catalogue's, decides.
  const retired = row('org', 'hq', 'group:text', '@cf/synthetic/retired-model', 1);
  const gone = resolveElementModel({ element: 'body', rows: [retired, row('deck', '1', 'body', MISTRAL), row('member', '2', 'group:text', MISTRAL)], deck: '1', member: '2', planRank: 2, env: {} });
  assert.deepEqual([gone.model, gone.source], [LLAMA, 'default']);
  const hqDefault = resolveElementModel({ element: 'body', rows: [retired, row('deck', '1', 'body', MISTRAL), row('org', 'hq', 'body', GLM, 0)], deck: '1', member: '2', planRank: 2, env: {} });
  assert.deepEqual([hqDefault.model, hqDefault.source], [GLM, 'org_default']);
  // A lock the plan cannot run: nothing runs, never the member's own pick.
  const blocked = resolveElementModel({ element: 'photo', rows: [row('org', 'hq', 'group:images', KLEIN4, 1), row('deck', '1', 'photo', SCHNELL)], deck: '1', member: '2', planRank: 0, env: { AI_PARTNER_MODELS: 'on' } });
  assert.deepEqual([blocked.model, blocked.source, blocked.locked, lockedOut(blocked)], [null, 'org_lock', true, true]);
  assert.deepEqual(blocked.plan_blocked, [{ level: 'org_lock', model: KLEIN4, plan: 'Paid plans' }]);
});

test('the deck preset sits below the deck\'s own picks and above my default; a preset model the catalogue does not offer now is skipped, never cleared', () => {
  const preset = row('deck', '1', 'preset', 'fast');
  const base = { element: 'body', deck: '1', member: '2', planRank: 2, env: {} };
  assert.deepEqual([resolveElementModel({ ...base, rows: [preset, row('member', '2', 'body', MISTRAL)] }).model], [GLM], 'the preset beats my default');
  assert.equal(resolveElementModel({ ...base, rows: [preset, row('deck', '1', 'group:text', MISTRAL)] }).model, MISTRAL, 'the deck\'s own group pick beats the preset (Custom)');
  assert.equal(resolveElementModel({ ...base, rows: [row('deck', '1', 'preset', 'nonsense')] }).source, 'default', 'a name that is not a preset is no level');
  // Partner gate shut: an edit's Fast (its DK5 row) is not offered now; the preset is skipped and never returned to clear.
  // Mutation checked: deck_preset's stale model pushed to `stale` → the stale assert fails.
  assert.equal(presetModelFor('edit_vary', 'fast'), KLEIN4);
  const gated = resolveElementModel({ element: 'edit_vary', rows: [row('deck', '1', 'preset', 'fast'), row('member', '2', 'edit_vary', KLEIN4)], deck: '1', member: '2', planRank: 2, env: {} });
  assert.deepEqual(gated.stale.map((r) => r.key), ['edit_vary'], 'only the member\'s pick is stale, never the preset row');
  assert.notEqual(gated.source, 'deck_preset');
  const open = resolveElementModel({ element: 'edit_vary', rows: [row('deck', '1', 'preset', 'fast')], deck: '1', member: '2', planRank: 2, env: { AI_PARTNER_MODELS: 'on' } });
  assert.deepEqual([open.model, open.source], [KLEIN4, 'deck_preset'], 'offered again, the preset decides');
});

// ─────────────────────────────────────────────────────────── the routes

const root = new URL('../sql/', import.meta.url);
const baseline = readFileSync(new URL('schema_baseline.sql', root), 'utf8');
const migrations = readdirSync(new URL('migrations/', root)).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()
  .map((n) => readFileSync(new URL('migrations/' + n, root), 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'deck-model-presets-d1549-'));
const seedPath = join(scratch, 'schema.sqlite');
const schema = new DatabaseSync(seedPath, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
schema.exec(baseline); for (const sql of migrations) schema.exec(sql); schema.close();
after(() => rmSync(scratch, { recursive: true, force: true }));
let n = 0;
const JWT_SECRET = 'synthetic-d1549-only-not-a-real-credential'.repeat(2);
const SUPER = 9, ADMIN = 10, STALE = 11;

async function fixture(extraEnv: Record<string, unknown> = {}, fail: (model: string) => boolean = () => false) {
  __resetForTest();
  const file = join(scratch, `case-${++n}.sqlite`);
  copyFileSync(seedPath, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  for (const [id, role, fid, tier] of [[2, 'founder', 100, 'studio'], [3, 'founder', 300, 'free'], [4, 'founder', 400, 'studio'], [6, 'investor', null, 'studio'],
    [SUPER, 'admin', null, 'studio'], [ADMIN, 'admin', null, 'studio'], [STALE, 'admin', null, 'studio']] as const) {
    insert.run(id, role, fid, `Synthetic member ${id}`, `synthetic-${id}@example.invalid`, tier);
  }
  for (const id of [SUPER, STALE]) db.prepare('INSERT INTO super_admins(user_id) VALUES (?)').run(id);
  // Every caller signs in with a live session; a fresh TOTP one passes the step-up, and STALE's is years old.
  for (const id of [2, 3, 4, 6]) db.prepare("INSERT INTO user_sessions(user_id,jti,factor,assurance_level) VALUES(?,?,'password','password')").run(id, `j${id}`);
  for (const id of [SUPER, ADMIN]) db.prepare("INSERT INTO user_sessions(user_id,jti,factor,assurance_level) VALUES(?,?,'totp','totp')").run(id, `j${id}`);
  db.prepare("INSERT INTO user_sessions(user_id,jti,factor,assurance_level,created_at) VALUES(?,?,'totp','totp','2020-01-01 00:00:00')").run(STALE, `j${STALE}`);
  db.exec("INSERT INTO member_subscription_amounts(subscription_id,user_id,plan_family,amount_cents,currency,interval,interval_count,status) VALUES ('sub_synthetic_2',2,'founder',7900,'usd','month',1,'active')");
  db.exec("INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',100),(3,'Synthetic free venture',300),(4,'Synthetic other venture',400)");
  db.exec("INSERT INTO pitch_decks(id,project_id,version,slides,title,is_current) VALUES (7,1,1,'[]','Synthetic deck',1),(8,3,1,'[]','Synthetic free deck',1)");
  for (const u of [2, 3]) db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(?,5000000)').run(u);
  for (const key of ['founder:free', 'founder:studio']) db.prepare('INSERT OR IGNORE INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES(?,0,0,1)').run(key);
  const calls: string[] = [];
  const AI = withGuard({
    run: async (model: string) => {
      calls.push(model);
      if (fail(model)) throw Object.assign(new Error('synthetic 500'), { status: 500 });
      return { response: JSON.stringify({ cards: [] }), usage: { prompt_tokens: 60, completion_tokens: 40 } };
    },
  });
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', AI, FILES: {}, ...extraEnv };
  await ensureProjectMembershipSchema(env);
  const app = new Hono<any>().route('/api/decks', deckElementModels).route('/api/decks', deckModelPresets).route('/api/admin/ai/deck-models', adminDeckModels)
    .route('/api/decks', deckNew).route('/api/decks', deckImages).route('/api/decks', decks);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  const picks = () => db.prepare('SELECT scope, scope_id, key, model, locked FROM deck_model_picks ORDER BY id').all().map((r) => ({ ...r })) as any[];
  return { db, env, app, calls: () => calls.filter((m) => m !== GUARD_MODEL), picks, close };
}
type F = Awaited<ReturnType<typeof fixture>>;

async function call(f: F, who: number, method: string, path: string, json?: unknown) {
  const jwt = await new SignJWT({ user_id: who, jti: `j${who}` }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, ...(json === undefined ? {} : { body: JSON.stringify(json) }) }, f.env);
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}
const P7 = '/api/decks/7/model-presets';
const E7 = '/api/decks/7/element-models';
const HQ = '/api/admin/ai/deck-models';
const groupOf = (r: any, g: string) => r.groups.find((x: any) => x.group === g);

test('GET model-presets: Balanced when the deck holds nothing; each group\'s three presets and resolved model; no lock; who may read', async () => {
  const f = await fixture();
  try {
    const r = await call(f, 2, 'GET', P7);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.deck_id, r.body.project_id, r.body.preset, r.body.stored], [7, 1, 'balanced', null]);
    assert.deepEqual(r.body.options.map((o: any) => o.label), ['Fast', 'Balanced', 'Best', 'Custom']);
    assert.deepEqual(r.body.groups.map((g: any) => g.group), ['text', 'images', 'data', 'diagrams', 'venture'], 'the groups that run a model');
    assert.deepEqual(groupOf(r.body, 'text').presets.map((p: any) => p.model), [GLM, LLAMA, MISTRAL]);
    assert.deepEqual(groupOf(r.body, 'text').resolved, { model: LLAMA, name: groupOf(r.body, 'text').resolved.name, source: 'default', locked: false });
    assert.deepEqual(r.body.locks, []);
    assert.equal(groupOf(r.body, 'text').lock, null);
    assert.equal((await call(f, 4, 'GET', P7)).status, 403, 'another venture\'s founder');
    assert.ok([403, 404].includes((await call(f, 6, 'GET', P7)).status), 'an investor');
    assert.equal((await call(f, 2, 'GET', '/api/decks/999/model-presets')).status, 404);
  } finally { f.close(); }
});

test('PUT model-presets: Fast clears the deck\'s own picks and decides each group; a group pick after it reads Custom; Custom clears the preset; nothing else is written', async () => {
  // Mutation checked: the PUT not clearing the deck's picks → the "preset decides" assert fails (the deck pick wins).
  const f = await fixture();
  try {
    assert.equal((await call(f, 2, 'PUT', E7, { scope: 'deck', key: 'body', model: MISTRAL })).status, 200);
    assert.equal((await call(f, 2, 'PUT', E7, { scope: 'member', key: 'group:text', model: MISTRAL })).status, 200);
    f.db.prepare("INSERT INTO deck_model_picks(scope,scope_id,key,model,locked) VALUES('area','1/0/a1','body',?,0)").run(MISTRAL);
    const fast = await call(f, 2, 'PUT', P7, { preset: 'fast' });
    assert.equal(fast.status, 200, JSON.stringify(fast.body));
    assert.deepEqual([fast.body.preset, fast.body.stored], ['fast', 'fast']);
    assert.deepEqual(f.picks().filter((p) => p.scope !== 'member' && p.scope !== 'area').map((p) => [p.scope, p.key, p.model]), [['deck', 'preset', 'fast']], 'the deck\'s own pick is gone');
    assert.equal(f.picks().filter((p) => p.scope === 'area').length, 1, 'an area\'s override is kept');
    for (const g of fast.body.groups) {
      const want = g.presets.find((p: any) => p.preset === 'fast').model;
      if (want && !g.presets.find((p: any) => p.preset === 'fast').plan_locked) assert.deepEqual([g.resolved.model, g.resolved.source], [want, 'deck_preset'], `${g.group}: the preset decides`);
    }
    // A group pick after the preset: the deck reads Custom; the stored preset still holds the other groups.
    assert.equal((await call(f, 2, 'PUT', E7, { scope: 'deck', key: 'group:data', model: MISTRAL })).status, 200);
    const custom = (await call(f, 2, 'GET', P7)).body;
    assert.deepEqual([custom.preset, custom.stored], ['custom', 'fast']);
    assert.equal(groupOf(custom, 'text').resolved.source, 'deck_preset');
    assert.equal(groupOf(custom, 'data').resolved.source, 'deck_group');
    const cleared = await call(f, 2, 'PUT', P7, { preset: 'custom' });
    assert.deepEqual([cleared.body.preset, cleared.body.stored], ['custom', null]);
    assert.equal(groupOf(cleared.body, 'text').resolved.source, 'member_group', 'with no preset, my default applies');
    const before = f.picks();
    const bad = await call(f, 2, 'PUT', P7, { preset: 'cheapest' });
    assert.equal(bad.status, 400); assert.equal(bad.body.error, 'invalid_preset');
    assert.equal((await call(f, 4, 'PUT', P7, { preset: 'fast' })).status, 403, 'another venture');
    assert.deepEqual(f.picks(), before, 'nothing was written');
  } finally { f.close(); }
});

test('HQ: a Super Admin with a recent step-up sets a group\'s default and lock; it is audited; every other caller is refused, nothing written', async () => {
  // Mutations checked: the step-up dropped from the gate → the STALE assert fails; requireSuperAdmin swapped for requireAuth → the ADMIN assert fails.
  const f = await fixture({ AI_PARTNER_MODELS: 'on' });
  try {
    for (const [who, path, method, body] of [[2, HQ, 'GET'], [ADMIN, HQ, 'GET'], [STALE, HQ, 'GET'], [2, HQ, 'PUT', { group: 'images', model: SCHNELL, locked: true }],
      [ADMIN, HQ, 'PUT', { group: 'images', model: SCHNELL, locked: true }], [STALE, HQ, 'PUT', { group: 'images', model: SCHNELL, locked: true }]] as const) {
      assert.equal((await call(f, who, method, path, body)).status, 403, `${who} ${method}`);
    }
    assert.deepEqual(f.picks(), []);
    const read0 = await call(f, SUPER, 'GET', HQ);
    assert.equal(read0.status, 200, JSON.stringify(read0.body));
    const images0 = read0.body.groups.find((g: any) => g.group === 'images');
    assert.equal(images0.org, null); assert.equal(images0.label, 'Images');
    assert.deepEqual(images0.choices.map((m: any) => m.id), [...choicesFor('photo').suggested, ...choicesFor('photo').more].map((m) => m.id));
    for (const [bad, code] of [
      [{ group: 'graphics', model: SCHNELL, locked: false }, 'invalid_group'],
      [{ group: 'images', model: LLAMA, locked: false }, 'model_not_offered'],
      [{ group: 'images', model: null, locked: true }, 'lock_needs_model'],
      [{ group: 'images', model: SCHNELL }, 'invalid_lock'],
    ] as const) {
      const r = await call(f, SUPER, 'PUT', HQ, bad);
      assert.equal(r.status, 400, JSON.stringify(bad)); assert.equal(r.body.error, code);
    }
    assert.deepEqual(f.picks(), [], 'nothing written');
    assert.equal((await call(f, SUPER, 'PUT', HQ, { group: 'text', model: MISTRAL, locked: false })).status, 200);
    assert.equal((await call(f, SUPER, 'PUT', HQ, { group: 'images', model: SCHNELL, locked: true })).status, 200);
    assert.deepEqual(f.picks(), [
      { scope: 'org', scope_id: 'hq', key: 'group:text', model: MISTRAL, locked: 0 },
      { scope: 'org', scope_id: 'hq', key: 'group:images', model: SCHNELL, locked: 1 },
    ]);
    const audit = f.db.prepare("SELECT action, details, user_id FROM activity_logs WHERE action LIKE 'deck_model_org_%' ORDER BY id").all().map((r: any) => ({ ...r }));
    assert.deepEqual(audit.map((a: any) => [a.action, a.user_id, JSON.parse(a.details).group]), [['deck_model_org_default', SUPER, 'text'], ['deck_model_org_locked', SUPER, 'images']]);
    assert.doesNotMatch(JSON.stringify(audit), /synthetic-9@|Synthetic member/, 'no name or email in the audit details');
    // The deck reads HQ's lock with aird5's line, and its default as HQ's default.
    const deck = (await call(f, 2, 'GET', P7)).body;
    assert.deepEqual(deck.locks.map((l: any) => [l.group, l.model, l.line]), [['images', SCHNELL, LOCK_LINE]]);
    assert.equal(groupOf(deck, 'images').lock.line, 'Set by Axal VC HQ');
    assert.deepEqual([groupOf(deck, 'text').resolved.model, groupOf(deck, 'text').resolved.source], [MISTRAL, 'org_default']);
    // A member's pick on the locked group is refused; on HQ's default it is the member's to change.
    assert.equal((await call(f, 2, 'PUT', E7, { scope: 'deck', key: 'group:images', model: KLEIN4 })).body.error, 'role_locked');
    assert.equal((await call(f, 2, 'PUT', E7, { scope: 'deck', key: 'group:text', model: GLM })).status, 200);
    // Null clears HQ's row: the catalogue's Default decides again.
    assert.equal((await call(f, SUPER, 'PUT', HQ, { group: 'images', model: null, locked: false })).status, 200);
    assert.deepEqual((await call(f, 2, 'GET', P7)).body.locks, []);
    assert.equal((await call(f, SUPER, 'GET', HQ)).body.groups.find((g: any) => g.group === 'text').org.locked, false);
  } finally { f.close(); }
});

// ─────────────────────────────────────────────────────────── the run and the quote

test('the run and the quote: HQ\'s lock decides Body over the deck\'s pick, the quote names it, and the preset in force decides with no lock', async () => {
  // Mutation checked: the quote leaving out element_models → the quote assert fails.
  const f = await fixture();
  try {
    assert.equal((await call(f, 2, 'PUT', P7, { preset: 'fast' })).status, 200);
    const q0 = await call(f, 2, 'POST', '/api/decks/new/quote', { project_id: 1, step: 'build', audience: 'seed_fund' });
    assert.equal(q0.status, 200, JSON.stringify(q0.body));
    assert.deepEqual([q0.body.model, q0.body.element_models.body.model, q0.body.element_models.body.source], [GLM, GLM, 'deck_preset'], 'the preset in force');
    assert.equal((await call(f, 2, 'POST', '/api/decks/generate', { project_id: 1 })).status, 201);
    assert.equal(f.calls().at(-1), GLM);
    f.db.prepare("INSERT INTO deck_model_picks(scope,scope_id,key,model,locked,plan_min) VALUES('org','hq','group:text',?,1,'all')").run(MISTRAL);
    const q1 = await call(f, 2, 'POST', '/api/decks/new/quote', { project_id: 1, step: 'build', audience: 'seed_fund' });
    assert.deepEqual([q1.body.model, q1.body.element_models.body], [MISTRAL, { model: MISTRAL, source: 'org_lock', notice: null, locked: true }]);
    const built = await call(f, 2, 'POST', '/api/decks/generate', { project_id: 1 });
    assert.equal(built.status, 201, JSON.stringify(built.body));
    assert.equal(f.calls().at(-1), MISTRAL, 'the lock, not the preset');
    assert.equal(built.body.element_models.body.source, 'org_lock');
  } finally { f.close(); }
});

test('a locked model that fails is never answered by another model; an unlocked pick still falls back', async () => {
  // Mutation checked: run() ignoring `pinned` (keeping the chain) → the locked assert fails (a sibling answers).
  const f = await fixture({}, (m) => m === MISTRAL);
  try {
    assert.equal((await call(f, 2, 'PUT', E7, { scope: 'deck', key: 'body', model: MISTRAL })).status, 200);
    assert.equal((await call(f, 2, 'POST', '/api/decks/generate', { project_id: 1 })).status, 201);
    const unlocked = f.calls();
    assert.equal(unlocked[0], MISTRAL);
    assert.ok(unlocked.length > 1 && unlocked.slice(1).every((m) => m !== MISTRAL), 'an unlocked pick falls back to its chain');
    f.db.exec("DELETE FROM deck_model_picks");
    f.db.prepare("INSERT INTO deck_model_picks(scope,scope_id,key,model,locked,plan_min) VALUES('org','hq','body',?,1,'all')").run(MISTRAL);
    const before = f.calls().length;
    const r = await call(f, 2, 'POST', '/api/decks/generate', { project_id: 1 });
    assert.deepEqual(f.calls().slice(before), [MISTRAL], 'the locked model, and no other');
    assert.notEqual(r.body?.wording?.by, 'Eadwyn');
  } finally { f.close(); }
});

test('a lock the member\'s plan cannot run stops the image quote and run, and the build, with "Set by Axal VC HQ", and runs nothing', async () => {
  // Mutation checked: deck_images not asking lockedOut → the 403 assert fails (the run goes ahead on another model).
  const f = await fixture({ AI_PARTNER_MODELS: 'on' });
  try {
    f.db.prepare("INSERT INTO deck_model_picks(scope,scope_id,key,model,locked,plan_min) VALUES('org','hq','group:images',?,1,'lowest_paid')").run(KLEIN4);
    f.db.prepare("INSERT INTO deck_model_picks(scope,scope_id,key,model,locked) VALUES('deck','3','illustration',?,0)").run(SCHNELL);
    const ask = { use: 'content', description: 'A synthetic ledger on a desk', style: 'flat', palette: 'brand', aspect: '16:9', count: 1 };
    for (const path of ['/api/decks/8/images/quote', '/api/decks/8/images']) {
      const r = await call(f, 3, 'POST', path, ask);
      assert.equal(r.status, 403, `${path}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.error, 'role_locked');
      assert.match(r.body.message, /^Set by Axal VC HQ for this deck's Images\. Its model is on Paid plans\. Nothing was run\.$/);
    }
    // The build's quote too: HQ locked Text on a model whose row needs the top paid plan.
    // Mutation checked: deck_new not asking lockedOut → the build's 403 assert fails (it runs).
    f.db.prepare("INSERT INTO deck_model_picks(scope,scope_id,key,model,locked,plan_min) VALUES('org','hq','group:text',?,1,'top_paid')").run(MISTRAL);
    // (The build itself is on Raise + Grow, which ranks top paid, so a free member reaches only its quote.)
    for (const [path, body] of [['/api/decks/new/quote', { project_id: 3, step: 'build', audience: 'seed_fund' }]] as const) {
      const r = await call(f, 3, 'POST', path, body);
      assert.equal(r.status, 403, `${path}: ${JSON.stringify(r.body)}`);
      assert.match(r.body.message, /^Set by Axal VC HQ for this deck's Text\. /);
    }
    assert.deepEqual(f.calls(), [], 'no model ran');
    // A paid member runs the locked model, and the quote names it.
    const paid = await call(f, 2, 'POST', '/api/decks/7/images/quote', ask);
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    assert.deepEqual([paid.body.model, paid.body.element_models.illustration.source, paid.body.element_models.illustration.locked], [KLEIN4, 'org_lock', true]);
  } finally { f.close(); }
});
