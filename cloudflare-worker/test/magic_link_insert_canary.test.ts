/** #1008 — the private scheduled canary exercises the real Worker fetch and correlates its own two writes. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.ts';
import { runMagicLinkInsertCanary } from '../src/services/magicLinkInsertCanary.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { memKV } from './_mem_kv.mjs';
import { loadSchema } from './_schema_once.mjs';

const slot = Date.UTC(2026, 10, 17, 3, 45);
const nextSlot = slot + 4 * 60 * 60_000;
const address = 'synthetic@example.test';

function fixture() {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const queued: string[] = [];
  const env = {
    DB: d1Over(db), RATE_LIMITS: memKV(), APP_URL: 'https://axal.vc', USE_CF_QUEUE: 'true',
    ENVIRONMENT: 'production', JWT_SECRET: 'jwt-fixture-'.repeat(5), SCORING_HMAC_SECRET: 'scoring-fixture-'.repeat(4),
    MAGIC_INSERT_CANARY_EMAIL: address,
    JOB_QUEUE: { send: async (msg: { payload: { to: string } }) => { queued.push(msg.payload.to); } },
  } as any;
  const receipt = () => {
    const raw = db.prepare('SELECT value FROM platform_settings WHERE key = ?').get('magic_link_insert_canary_v1');
    return raw && JSON.parse(String(raw.value));
  };
  return { db, env, queued, receipt };
}

test('concurrent and repeated ticks produce one canary request and its two exact rows through worker.fetch', async () => {
  const { db, env, queued, receipt } = fixture();
  const waits: Promise<unknown>[] = [];
  const ctx = { waitUntil: (work: Promise<unknown>) => waits.push(work), passThroughOnException() {} } as any;
  const post = async (req: Request) => {
    assert.equal(req.url, 'https://axal.vc/api/auth/magic/start');
    assert.equal(req.method, 'POST');
    assert.deepEqual(await req.clone().json(), { email: address });
    const res = await worker.fetch(req, env, ctx);
    assert.deepEqual(Object.keys(await res.clone().json() as object).sort(), ['message', 'ok']);
    // An independent request for the same recipient can enqueue while the
    // first request completes. MAX(id) would credit the wrong pair of rows.
    const other = new Request(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify({ email: address }) });
    assert.equal((await worker.fetch(other, env, ctx)).status, 202);
    return res;
  };
  await Promise.all([0, 0, 10_000].map(offset => runMagicLinkInsertCanary(env, slot + offset, post, () => slot + 20_000)));
  await Promise.all(waits);
  const tokenIds = db.prepare('SELECT id FROM magic_link_tokens WHERE email=? ORDER BY id').all(address);
  const sendIds = db.prepare('SELECT id FROM email_send_log WHERE to_addr=? AND template_key=? ORDER BY id').all(address, 'auth_magic_link');
  assert.equal(tokenIds.length, 2);
  assert.equal(sendIds.length, 2);
  assert.deepEqual(queued, [address, address]);
  assert.deepEqual(receipt(), {
    slot, state: 'complete', startedAt: slot + 20_000, startMs: 0, startStatus: 202, tokenId: tokenIds[0].id, sendId: sendIds[0].id,
  });
  db.close();
});

test('only timely scheduled starts on explicitly configured production HQ can touch D1', async () => {
  const denied = () => { throw new Error('unexpected D1 or HTTP call'); };
  const env = { ENVIRONMENT: 'production', MAGIC_INSERT_CANARY_EMAIL: address, DB: { prepare: denied } } as any;
  for (const override of [
    { ENVIRONMENT: 'preview' }, { BRANCH_CODE: 'ch' }, { MAGIC_INSERT_CANARY_EMAIL: '' },
    { MAGIC_INSERT_CANARY_EMAIL: 'disabled' }, { MAGIC_INSERT_CANARY_EMAIL: 'invalid' },
  ]) await runMagicLinkInsertCanary({ ...env, ...override }, slot, denied, () => slot);
  for (const [scheduled, actual] of [[NaN, slot], [slot, slot - 1], [slot, slot + 300_000], [slot - 60_000, slot], [slot + 3600_000, slot + 3600_000]]) {
    await runMagicLinkInsertCanary(env, scheduled, denied, () => actual);
  }
});

test('the scheduled entrypoint measures Worker boot refusal while another cron holds the drain lease', async t => {
  const { env, db, queued, receipt } = fixture();
  t.mock.method(Date, 'now', () => slot);
  await env.RATE_LIMITS.put('cron:queue:lease', 'held-by-another-tick');
  delete env.SCORING_HMAC_SECRET;
  const waits: Promise<unknown>[] = [];
  const ctx = { waitUntil: (work: Promise<unknown>) => waits.push(work) } as any;
  await worker.scheduled({ cron: '* * * * *', scheduledTime: slot } as ScheduledEvent, env, ctx);
  await Promise.all(waits);
  assert.deepEqual(receipt(), {
    slot, state: 'complete', startedAt: slot, startMs: 0, startStatus: 503, tokenId: null, sendId: null,
  });
  assert.deepEqual(queued, []);
  db.close();
});

test('a late completion cannot overwrite a newer failed request or issue another send', async () => {
  const { db, env, receipt } = fixture();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const first = runMagicLinkInsertCanary(env, slot, async () => {
    entered.resolve();
    await release.promise;
    return new Response(null, { status: 429 });
  }, () => slot);
  await entered.promise;
  assert.equal(receipt().state, 'running');
  await runMagicLinkInsertCanary(env, nextSlot, async () => { throw new Error('private transport detail'); }, () => nextSlot);
  release.resolve();
  await first;
  assert.deepEqual(receipt(), {
    slot: nextSlot, state: 'error', startedAt: nextSlot, startMs: 0, startStatus: null, tokenId: null, sendId: null,
  });
  // Slow D1 claim: by the time the statement returns the allowed send window has ended.
  const later = nextSlot + 4 * 60 * 60_000;
  let actual = later;
  let sent = false;
  await runMagicLinkInsertCanary(env, later, async () => { sent = true; return new Response(null, { status: 202 }); },
    () => { const current = actual; actual += 5 * 60_000; return current; });
  assert.equal(sent, false);
  assert.equal(receipt().state, 'error');
  assert.equal(receipt().startedAt, null);
  db.close();
});
