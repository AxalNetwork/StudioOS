/**
 * D1536 (#3785, deck v2 B9) — the weekly AI catalogue drift job.
 *
 *   1. Without its read-only token (or the account id) the job skips with a
 *      logged reason: it calls nothing, writes nothing and raises no alert.
 *   2. A live list equal to the catalogue is no drift and no alert.
 *   3. A drift fixture writes one `ai_catalogue_drift` row per finding and
 *      raises one HQ alert per Super Admin, once per day; counts only.
 *   4. An unreadable or empty live answer is a failure, never drift.
 *   5. The token goes only into the Authorization header: no log carries it.
 *   6. Migration 731 is additive and applies twice; the cron gate is Monday
 *      05:17 UTC on HQ, inside the every-minute tick.
 * Cloudflare's API is a stub in every test; the model ids added as drift are invented.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeD1 } from './_d1_sqlite.mjs';
import { CATALOGUE } from '../src/services/ai/catalogue.ts';
import { diffCatalogue, liveModelsOf } from '../src/services/ai/catalogueDiff.ts';
import { DRIFT_ALERT_TYPE, runCatalogueDrift } from '../src/services/aiCatalogueDrift.ts';

const M731 = readFileSync('cloudflare-worker/sql/migrations/731_ai_catalogue_drift.sql', 'utf8');
const SCHEMA = `
  CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT, is_active INTEGER DEFAULT 1, notification_prefs TEXT);
  CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);
  CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
    body TEXT, link TEXT, meta TEXT, dedupe_key TEXT, read_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
  CREATE UNIQUE INDEX uq_notifications_dedupe ON notifications(user_id, kind, dedupe_key);
  CREATE TABLE notifications_inbox (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL,
    body TEXT, link TEXT, payload TEXT, channel TEXT DEFAULT 'in_app', read_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    category TEXT, severity TEXT DEFAULT 'info', cta_url TEXT, template_key TEXT);
  INSERT INTO users (id, role, is_active, notification_prefs) VALUES (1, 'admin', 1, NULL), (2, 'admin', 1, '{"ai_catalogue_drift":{"in_app":false}}'), (3, 'founder', 1, NULL), (4, 'admin', 0, NULL);
  INSERT INTO super_admins (user_id) VALUES (1), (2), (4);
` + M731;
// Invented values, never a real credential or account.
const TOKEN = 'synthetic-read-token-0000';
const ACCOUNT = '0123456789abcdef0123456789abcdef';
const NOW = new Date('2026-11-02T05:17:00Z'); // a Monday

/** Cloudflare's search answer for these rows, paged by `per_page` as the API pages. */
function liveRow(m: { id: string; kind: string; context_window: number | null; status: string }) {
  const properties: Array<{ property_id: string; value: string }> = [];
  if (m.context_window) properties.push({ property_id: 'context_window', value: String(m.context_window) });
  if (m.status === 'beta') properties.push({ property_id: 'beta', value: 'true' });
  return { id: `uuid-${m.id}`, name: m.id, description: 'synthetic', task: { id: 't', name: m.kind }, properties };
}
const listedNow = () => CATALOGUE.filter((m) => ['ga', 'partner', 'beta'].includes(m.status)).map(liveRow);

function stubFetch(rows: any[], opts: { status?: number; success?: boolean } = {}) {
  const calls: Array<{ url: string; auth: string | null }> = [];
  const fn = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    calls.push({ url, auth: new Headers(init?.headers).get('authorization') });
    const per = Number(u.searchParams.get('per_page')), page = Number(u.searchParams.get('page'));
    const result = rows.slice((page - 1) * per, page * per);
    return new Response(JSON.stringify({ success: opts.success ?? true, result, errors: [], messages: [] }), { status: opts.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function capture() {
  const lines: string[] = [];
  const orig = { info: console.info, warn: console.warn, error: console.error, log: console.log };
  for (const k of ['info', 'warn', 'error', 'log'] as const) (console as any)[k] = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  return { lines, restore: () => Object.assign(console, orig) };
}
const count = (db: any, sql: string) => Number(db.prepare(sql).get().n);

// ── 1 ────────────────────────────────────────────────────────────────────────
test('1. without the token the job skips with a logged reason: no call, no row, no alert', async () => {
  // Mutation checked: the job running without the secret check → it calls the stub and alerts, this fails.
  const { DB, db } = makeD1(SCHEMA);
  const drift = stubFetch([...listedNow(), liveRow({ id: '@cf/example-lab/synthetic-model-1', kind: 'Text Generation', context_window: 4096, status: 'ga' })]);
  const log = capture();
  try {
    const r = await runCatalogueDrift({ DB, CLOUDFLARE_ACCOUNT_ID: ACCOUNT } as any, { fetch: drift.fn, now: NOW });
    const r2 = await runCatalogueDrift({ DB, CLOUDFLARE_AI_MODELS_API_TOKEN: TOKEN } as any, { fetch: drift.fn, now: NOW });
    log.restore();
    assert.deepEqual(r, { state: 'skipped', reason: 'token_unset' });
    assert.deepEqual(r2, { state: 'skipped', reason: 'account_unset' });
    assert.equal(drift.calls.length, 0, 'Cloudflare was not called');
    assert.deepEqual(log.lines, ['[ai-drift] skipped reason=token_unset', '[ai-drift] skipped reason=account_unset']);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM ai_catalogue_drift'), 0);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM notifications_inbox'), 0, 'no alert');
    const branch = await runCatalogueDrift({ DB, BRANCH_CODE: 'acme', CLOUDFLARE_AI_MODELS_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT } as any, { fetch: drift.fn, now: NOW });
    assert.deepEqual(branch, { state: 'skipped', reason: 'branch' }, 'HQ only');
  } finally { log.restore(); db.close(); }
});

// ── 2 ────────────────────────────────────────────────────────────────────────
test('2. a live list equal to the catalogue is no drift and no alert', async () => {
  const { DB, db } = makeD1(SCHEMA);
  try {
    const live = stubFetch(listedNow());
    const r = await runCatalogueDrift({ DB, CLOUDFLARE_AI_MODELS_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT } as any, { fetch: live.fn, now: NOW });
    assert.deepEqual(r, { state: 'ok', models: listedNow().length, drift: 0, alerted: 0 });
    assert.ok(live.calls.length >= 1 && live.calls.every((c) => c.url.startsWith(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/models/search?`)));
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM notifications_inbox'), 0);
  } finally { db.close(); }
});

// ── 3 ────────────────────────────────────────────────────────────────────────
test('3. a drift fixture writes each finding and raises one HQ alert per Super Admin, once a day, in counts', async () => {
  // Mutation checked: the job skipping the alert on drift → no inbox item, this fails.
  const { DB, db } = makeD1(SCHEMA);
  const log = capture();
  try {
    const offered = CATALOGUE.filter((m) => m.status === 'ga' && m.context_window);
    const [gone, resized, rekind] = [offered[0], offered[1], offered[2]];
    const rows = listedNow()
      .filter((r) => r.name !== gone.id)
      .map((r) => (r.name === resized.id ? liveRow({ ...resized, context_window: resized.context_window! * 2 }) : r))
      .map((r) => (r.name === rekind.id ? liveRow({ ...rekind, kind: 'Synthetic Task' }) : r));
    rows.push(liveRow({ id: '@cf/example-lab/synthetic-model-1', kind: 'Text Generation', context_window: 4096, status: 'ga' }));
    const env: any = { DB, CLOUDFLARE_AI_MODELS_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT };
    const live = stubFetch(rows);
    const r = await runCatalogueDrift(env, { fetch: live.fn, now: NOW });
    assert.deepEqual(r, { state: 'ok', models: rows.length, drift: 4, alerted: 1 });
    const found = db.prepare('SELECT model_id, field, catalogue_value, live_value, seen_at FROM ai_catalogue_drift ORDER BY model_id, field').all().map((x: any) => ({ ...x }));
    assert.deepEqual(found.map((x: any) => [x.model_id, x.field, x.catalogue_value, x.live_value]).sort(), [
      ['@cf/example-lab/synthetic-model-1', 'listed', 'absent', 'listed'],
      [gone.id, 'listed', 'listed', 'absent'],
      [rekind.id, 'kind', rekind.kind, 'Synthetic Task'],
      [resized.id, 'context_window', String(resized.context_window), String(resized.context_window! * 2)],
    ].sort());
    assert.ok(found.every((x: any) => x.seen_at === '2026-11-02 05:17:00'));
    // The inbox: the active Super Admin who has not switched it off; not the one who did, the inactive one or a member.
    const inbox = db.prepare('SELECT user_id, type, title, body, link, payload, category FROM notifications_inbox').all().map((x: any) => ({ ...x }));
    assert.deepEqual(inbox.map((x: any) => [x.user_id, x.type, x.category]), [[1, DRIFT_ALERT_TYPE, 'operations']]);
    assert.deepEqual(JSON.parse(inbox[0].payload), { kind: DRIFT_ALERT_TYPE, findings: 4, models: 4, day: '2026-11-02' });
    assert.equal(inbox[0].body, "4 differences across 4 models between Cloudflare's model list and the catalogue.");
    // A retried run the same day alerts no one twice.
    const again = await runCatalogueDrift(env, { fetch: live.fn, now: NOW });
    assert.equal(again.state === 'ok' && again.alerted, 0);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM notifications_inbox'), 1);
    log.restore();
    // 5. The token is only in the header; logs hold counts and outcomes.
    assert.ok(live.calls.every((c) => c.auth === `Bearer ${TOKEN}`));
    assert.ok(log.lines.length > 0 && log.lines.every((l) => !l.includes(TOKEN) && !l.includes(ACCOUNT) && !l.includes('@cf/')), log.lines.join('\n'));
    assert.deepEqual(log.lines[0], `[ai-drift] ok models=${rows.length} drift=4 alerted=1`);
  } finally { log.restore(); db.close(); }
});

// ── 4 ────────────────────────────────────────────────────────────────────────
test('4. an unreadable or empty live answer is a failure, never drift', async () => {
  const { DB, db } = makeD1(SCHEMA);
  const log = capture();
  try {
    const env: any = { DB, CLOUDFLARE_AI_MODELS_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT };
    assert.deepEqual(await runCatalogueDrift(env, { fetch: stubFetch(listedNow(), { status: 403 }).fn, now: NOW }), { state: 'failed', reason: 'live_unreadable' });
    assert.deepEqual(await runCatalogueDrift(env, { fetch: stubFetch(listedNow(), { success: false }).fn, now: NOW }), { state: 'failed', reason: 'live_unreadable' });
    assert.deepEqual(await runCatalogueDrift(env, { fetch: (async () => { throw new Error('offline'); }) as any, now: NOW }), { state: 'failed', reason: 'live_unreadable' });
    assert.deepEqual(await runCatalogueDrift(env, { fetch: stubFetch([]).fn, now: NOW }), { state: 'failed', reason: 'live_empty' });
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM ai_catalogue_drift'), 0);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM notifications_inbox'), 0);
  } finally { log.restore(); db.close(); }
});

test('4b. the diff: retired rows gone live are not drift, and unreadable rows are left out', () => {
  const retired = CATALOGUE.find((m) => m.status === 'deprecated')!;
  const live = liveModelsOf(listedNow());
  assert.equal(diffCatalogue(live).length, 0);
  assert.ok(!live.some((m) => m.id === retired.id) && diffCatalogue(live).every((d) => d.model_id !== retired.id));
  assert.deepEqual(liveModelsOf([{ name: 'not a model id' }, { name: 42 }, null, 'x']), []);
  assert.deepEqual(liveModelsOf('nope'), []);
  const beta = CATALOGUE.find((m) => m.status === 'ga')!;
  const flipped = liveModelsOf([liveRow({ ...beta, status: 'beta' })]);
  assert.deepEqual(diffCatalogue(flipped, [beta]), [{ model_id: beta.id, field: 'beta', catalogue_value: 'false', live_value: 'true' }]);
});

// ── 6 ────────────────────────────────────────────────────────────────────────
test('6. migration 731 is additive and applies twice; the cron gate is Monday 05:17 UTC on HQ', () => {
  const { db } = makeD1(M731 + M731);
  try {
    const cols = db.prepare('PRAGMA table_info(ai_catalogue_drift)').all().map((c: any) => c.name);
    assert.deepEqual(cols, ['model_id', 'field', 'catalogue_value', 'live_value', 'seen_at']);
  } finally { db.close(); }
  assert.ok(!/\b(DROP|ALTER|DELETE|UPDATE)\b/i.test(M731.replace(/^--.*$/gm, '')), 'additive only');
  const index = readFileSync('cloudflare-worker/src/index.ts', 'utf8');
  assert.match(index, /if \(hqCadences && now\.getUTCDay\(\) === 1 && now\.getUTCHours\(\) === 5 && now\.getUTCMinutes\(\) === 17\) \{\s*try \{\s*const \{ runCatalogueDrift \} = await import\('\.\/services\/aiCatalogueDrift'\);/);
});
