// D5665: complete fake sender lifecycle, busy itemized batches, restart/receipts and destination isolation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { SlackOutbox } from '../../engineering-slack/outbox.mjs';
import { slackTransport } from '../../engineering-slack/transport.mjs';
import { registryOf, prepare, row } from '../../engineering-slack/presentation-v1.mjs';
import { healthAdapter } from '../../engineering-slack/health-adapter.mjs';
const registry = { schema: 1, version: 1, reviewedBy: 'guillaumelauzier', approvedAt: '2026-11-12T10:00:00Z', teamId: 'TFIXTURE', channels: { activity: { id: 'CACTIVITY', enabled: true, private: false, retentionDays: 90, publisher: 'internal-bot' }, prs: { id: 'CPRS', enabled: true, private: false, retentionDays: 90, publisher: 'internal-bot' }, health: { id: 'CHEALTH', enabled: true, private: false, retentionDays: 90, publisher: 'internal-bot' }, security: { id: 'GPRIVATE', enabled: true, private: true, retentionDays: 30, publisher: 'internal-bot' } }, mentions: { S18: 'UFIXTURE' } };
const at = Date.parse('2026-11-12T10:00:00Z');
const event = (n, state = 'success', attempt = 1) => ({ schema: 1, key: createHash('sha256').update(`${n}:${state}:${attempt}`).digest('hex'), repository: 'o/r', family: 'ci', state, visibility: 'public', observedAt: new Date(at + n).toISOString(), ids: { run: '42', attempt: String(attempt), job: String(1000 + n), prs: ['3'] }, refs: { head: 'a'.repeat(40) }, labels: ['slot:S18'], gaps: [] });
const action = (revision = 1) => ({ schema: 1, role: 'prs', disposition: 'action', material: true, subject: 'pr:3', slot: 'S18', revision });
function fixture(existing) {
  const db = existing || new DatabaseSync(':memory:'); let clock = at, sent = [], fail = null;
  const sql = { exec: (q, ...args) => { const rows = db.prepare(q).all(...args); return { toArray: () => rows }; } };
  const transaction = fn => { db.exec('BEGIN'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const make = () => new SlackOutbox({ sql, transaction, registry: structuredClone(registry), now: () => clock, jitter: () => 0, deliver: async request => { sent.push(request); return fail || { state: 'acknowledged', receipt: { channel: request.channel.id, ts: `${100 + sent.length}.000001`, status: 200, transport: 'adapter' } }; } });
  return { db, sql, make, sent, advance: ms => clock += ms, fail: value => fail = value, drain: async box => { for (let n = 0; n < 1000; n++) { clock += 1000; const r = await box.tick(); if (r.state === 'idle') return; } throw Error('outbox did not drain'); } };
}
test('head update, 100 matrix jobs, two attempts, cancellation and recovery retain every Slack-local item and one PR root', async () => {
  const f = fixture(), box = f.make();
  try {
    box.enqueue(event(1, 'failure'), action(1));
    for (let n = 2; n <= 101; n++) { box.enqueue(event(n, n === 50 ? 'skipped' : 'success')); box.enqueue(event(n, n === 50 ? 'cancelled' : 'success', 2)); }
    box.enqueue(event(102, 'cancelled'), action(2)); box.enqueue(event(103, 'recovery', 2), { ...action(3), disposition: 'recovery' });
    box.enqueue(event(1, 'failure'), action(1));
    f.advance(300_001); await f.drain(box);
    assert.equal(box.summary().itemCount, 203); assert.equal(box.summary().unbatched, 0);
    assert.equal(f.sent.filter(r => r.text.includes('current state follows')).length, 1);
    assert.equal(f.sent.filter(r => r.text.includes('five-minute itemized')).length, 1);
    const items = f.db.prepare('SELECT event_key, chunk_key FROM activity').all();
    for (const item of items) { const receipt = box.get(item.chunk_key); assert.equal(receipt.state, 'acknowledged'); assert.ok(receipt.items.includes(item.event_key)); }
    const logs = f.sent.filter(r => r.channel.id === 'CACTIVITY').map(r => r.text).join('\n');
    assert.match(logs, /attempt:1/); assert.match(logs, /attempt:2/); assert.match(logs, /\[skipped\]/); assert.match(logs, /\[cancelled\]/); assert.match(logs, /\[recovery\]/);
    for (const posted of f.sent.filter(r => !r.text.includes('current state follows') && r.channel.id === 'CPRS')) assert.ok(posted.ts || posted.threadTs);
  } finally { f.db.close(); }
});
test('durable retries respect channel pacing and Retry-After; accepted timeout remains ambiguous across restart', async () => {
  const f = fixture(); let box = f.make();
  try {
    box.enqueue(event(1, 'failure'), action()); f.fail({ state: 'retry', code: 'rate_limited', retryAfterMs: 5000 });
    assert.equal((await box.tick()).state, 'retry'); const count = f.sent.length;
    await box.tick(); assert.equal(f.sent.length, count); f.advance(4999); await box.tick(); assert.equal(f.sent.length, count);
    f.advance(1); f.fail({ state: 'retry', code: 'provider_unavailable' }); assert.equal((await box.tick()).state, 'retry');
    f.advance(10000); f.fail({ state: 'ambiguous' }); assert.equal((await box.tick()).state, 'ambiguous');
    box = f.make(); f.advance(10000); await box.tick(); assert.equal(f.sent.length, count + 2); assert.equal(box.get('subject:o/r:pr:3:prs').state, 'ambiguous');
    assert.ok(box.summary().states.some(s => s.state === 'pending'));
  } finally { f.db.close(); }
});
test('started send survives crash as ambiguous; late old update cannot replace a newer material state', async () => {
  const f = fixture(); let box = f.make();
  try {
    box.enqueue(event(1, 'failure'), action(1)); box.enqueue(event(2, 'recovery'), { ...action(3), disposition: 'recovery' }); box.enqueue(event(3, 'failure'), action(2));
    const updates = f.db.prepare("SELECT state,payload FROM outbox WHERE json_extract(payload,'$.operation') = 'update'").all();
    assert.deepEqual(updates.map(r => r.state), ['superseded', 'pending']);
    f.sql.exec("UPDATE outbox SET state='sending' WHERE logical_key = ?", 'subject:o/r:pr:3:prs');
    box = f.make(); assert.equal(box.get('subject:o/r:pr:3:prs').state, 'ambiguous');
    await box.tick(); assert.equal(f.sent.length, 0);
  } finally { f.db.close(); }
});
test('untrusted labels and content cannot escalate, mention or leak; restricted records cannot use broad fallback', () => {
  const f = fixture(), box = f.make();
  try {
    const evil = { ...event(1), labels: ['<!channel>', '<@UATTACK>', '[action]', 'token&secret'], title: 'secret title', body: 'secret body', logs: 'secret logs' };
    const prepared = prepare(evil); const text = row(prepared); assert.match(text, /\[routine\]/); assert.doesNotMatch(text, /<!channel>|<@|secret|title|body|logs/);
    assert.equal(box.enqueue({ ...evil, visibility: 'restricted' }).state, 'redacted');
    assert.equal(box.enqueue({ ...event(999), family: 'security', visibility: 'public' }, { schema: 1, role: 'security', disposition: 'routine', material: false }).state, 'redacted');
    box.enqueue(evil, action()); assert.doesNotMatch(JSON.stringify(f.db.prepare('SELECT payload FROM activity').all()), /secret|<!channel>|<@/);
    const security = { ...event(2), family: 'security', visibility: 'restricted' };
    box.enqueue(security, { schema: 1, role: 'security', disposition: 'routine', material: false });
    f.advance(300001); box.flush(); const rows = f.db.prepare("SELECT channel,payload FROM outbox WHERE role='security'").all(); assert.ok(rows.length); assert.ok(rows.every(r => r.channel === 'GPRIVATE'));
    assert.throws(() => registryOf({ ...registry, channels: { security: { ...registry.channels.security, private: false } } }), /public/);
  } finally { f.db.close(); }
});
test('destination kill switch holds pending items, repeated enqueue has one logical receipt, and no files API is used', async () => {
  const f = fixture(), box = f.make();
  try {
    box.enqueue(event(1, 'failure'), action()); box.registry.channels.prs.enabled = false;
    assert.equal((await box.tick()).state, 'idle'); assert.equal(f.sent.length, 0);
    box.registry.channels.prs.enabled = true; await box.tick(); const root = box.get('subject:o/r:pr:3:prs'); assert.equal(root.state, 'acknowledged');
    box.enqueue(event(1, 'failure'), action()); f.advance(1000); await box.tick();
    assert.equal(f.sent.filter(r => r.text.includes('current state follows')).length, 1); assert.ok(f.sent.every(r => ['post','update'].includes(r.operation)));
  } finally { f.db.close(); }
});
function transportFixture({ post = { ok: true, channel: 'CPRS', ts: '123.000001' }, team = 'TFIXTURE', info = {}, status = 200, throws = false } = {}) {
  const calls = [];
  const send = slackTransport({ token: 'fixture-not-a-token', fetchImpl: async (url, init) => { const method = url.split('/').at(-1), body = JSON.parse(init.body); calls.push({ method, body }); if (method === 'auth.test') return Response.json({ ok: true, team_id: team }); if (method === 'conversations.info') return Response.json({ ok: true, channel: { id: 'CPRS', is_member: true, is_private: false, is_archived: false, ...info } }); if (throws) throw Error('accepted then timeout'); return new Response(JSON.stringify(post), { status, headers: { 'retry-after': '7' } }); } });
  return { calls, send: () => send({ registry, channel: registry.channels.prs, text: 'fixture', operation: 'post', clientId: 'fixture' }) };
}
test('Web API HTTP200 ok:false, 429/5xx, archived/revoked/wrong workspace and ambiguous timeout remain explicit', async () => {
  assert.equal((await transportFixture().send()).state, 'acknowledged');
  for (const fixture of [{ post: { ok: false, error: 'invalid_auth' } }, { info: { is_archived: true } }, { info: { is_member: false } }, { team: 'TWRONG' }, { info: { is_private: true } }]) { const f = transportFixture(fixture); assert.equal((await f.send()).state, 'dead'); if (fixture.team || fixture.info) assert.equal(f.calls.filter(c => c.method.startsWith('chat.')).length, 0); }
  assert.equal((await transportFixture({ status: 429 }).send()).retryAfterMs, 7000);
  assert.equal((await transportFixture({ status: 503 }).send()).state, 'retry');
  assert.equal((await transportFixture({ throws: true }).send()).state, 'ambiguous');
  const f = transportFixture(); await f.send(); const body = f.calls.at(-1).body; assert.equal(body.unfurl_links, false); assert.equal(body.parse, 'none'); assert.equal(body.link_names, false);
});
test('health adapter preserves original logical key and never treats outbox acceptance as a Slack receipt', async () => {
  const inputs = [], intent = { key: 'health:v1:o/r:future-clock:7:open', kind: 'future-clock', phase: 'open', issue: 7, text: 'untrusted omitted' }; let state = { state: 'pending' };
  const deliver = healthAdapter({ channelId: 'CHEALTH', enqueueIntent: async value => inputs.push(value), receipt: async () => state });
  assert.equal((await deliver(intent)).state, 'retry'); assert.equal(inputs[0].key, intent.key); assert.equal(inputs[0].text, undefined);
  state = { state: 'acknowledged', receipt: { transport: 'adapter', status: 200, channel: 'CHEALTH', ts: '123.000001' } };
  assert.equal((await deliver(intent)).state, 'acknowledged'); assert.equal((await deliver({ key: 'malformed' })).state, 'dead');
});

test('bounded retries dead-letter and health open/recovery bridge shares original durable keys', async () => {
  const f = fixture(), box = f.make();
  try {
    const intent = { key: 'health:v1:o/r:future-clock:7:open', kind: 'future-clock', phase: 'open', issue: 7 };
    const deliver = healthAdapter({ channelId: 'CHEALTH', enqueueIntent: i => box.enqueueHealth(i), receipt: async key => box.get(key) });
    assert.equal((await deliver(intent)).state, 'retry'); await f.drain(box); assert.equal((await deliver(intent)).state, 'acknowledged');
    const recovery = { ...intent, key: intent.key.replace(':open', ':recovery'), phase: 'recovery' }; await deliver(recovery); await f.drain(box); assert.equal((await deliver(recovery)).state, 'acknowledged');
    assert.equal(f.sent.filter(r => r.text.startsWith('[health] future-clock')).length, 1);
    assert.throws(() => box.enqueueHealth({ ...intent, issue: 8 }), /invalid/);
    box.enqueue(event(1, 'failure'), action()); f.fail({ state: 'retry', code: 'rate_limited', retryAfterMs: 1000 });
    for (let n = 0; n < 5; n++) { f.advance(1000); await box.tick(); }
    assert.equal(box.get('subject:o/r:pr:3:prs').state, 'dead'); assert.equal(box.get('subject:o/r:pr:3:prs').attempts, 5);
    assert.ok(f.sent.every(r => ['CPRS', 'CHEALTH'].includes(r.channel.id)));
  } finally { f.db.close(); }
});

test('Workers delivery actor persists receipt across SQLite restart without publishing to Slack', async () => {
  const { createRequire } = await import('node:module'), { mkdtempSync, rmSync } = await import('node:fs'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
  const require = createRequire(new URL('../../cloudflare-worker/package.json', import.meta.url)), { build } = require('esbuild'), { Miniflare, convertV4MiniflareOptions } = require('miniflare');
  const entry = new URL('../../engineering-slack/worker.mjs', import.meta.url).pathname;
  const source = `import { DeliveryActor } from ${JSON.stringify(entry)}; export class FixtureActor extends DeliveryActor { async add(e,p) { return this.outbox.enqueue(e,p); } async step() { this.outbox.deliver=async x => ({state:'acknowledged',receipt:{channel:x.channel.id,ts:'123.000001',transport:'adapter',status:200}}); return this.outbox.tick(); } } export default {async fetch(request,env) {const actor=env.OUTBOX.getByName('fixture'), path=new URL(request.url).pathname; return Response.json(path==='/add' ? await actor.add(...await request.json()) : path==='/step' ? await actor.step() : await actor.receipt('subject:o/r:pr:3:prs'));}};`;
  const bundle = await build({ stdin: { contents: source, resolveDir: process.cwd() }, bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers'] });
  const dir = mkdtempSync(join(tmpdir(), 's38-slack-runtime-'));
  const options = convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-11-08', compatibilityFlags: ['nodejs_compat'], resourcePersistencePath: dir, durableObjects: { OUTBOX: { className: 'FixtureActor', useSQLite: true } }, bindings: { DELIVERY_ENABLED: 'false', ROUTING_REGISTRY: JSON.stringify(registry) } });
  let mf = new Miniflare(options);
  try {
    await mf.dispatchFetch('https://fixture/add', { method: 'POST', body: JSON.stringify([event(1, 'failure'), action()]) });
    const result = await (await mf.dispatchFetch('https://fixture/step')).json(); assert.equal(result.state, 'acknowledged');
    await mf.dispose(); mf = new Miniflare(options);
    const receipt = await (await mf.dispatchFetch('https://fixture/receipt')).json(); assert.equal(receipt.state, 'acknowledged'); assert.equal(receipt.receipt.ts, '123.000001');
  } finally { await mf.dispose(); rmSync(dir, { recursive: true }); }
});

test('accepted message with acknowledgement-write interruption is uncertain after restart; retention cannot revive expired queued work', async () => {
  const f = fixture(); let box = f.make();
  try {
    box.enqueue(event(1, 'failure'), action());
    const exec = f.sql.exec; let crash = true;
    f.sql.exec = (q, ...args) => { if (crash && q.startsWith('UPDATE outbox') && args[1] === 'acknowledged') { crash = false; throw Error('interrupted acknowledgement write'); } return exec(q, ...args); };
    await assert.rejects(box.tick(), /interrupted/); assert.equal(f.sent.length, 1);
    box = f.make(); assert.equal(box.get('subject:o/r:pr:3:prs').state, 'ambiguous'); await box.tick(); assert.equal(f.sent.length, 1);
    f.advance(91 * 86_400_000); assert.equal(box.enqueue(event(2, 'failure'), action(2)).state, 'redacted');
  } finally { f.db.close(); }
});

test('per-channel pacing holds acknowledged root replies and actions precede ready digest pages', async () => {
  const f = fixture(), box = f.make();
  try {
    box.enqueue(event(1)); f.advance(300001); box.flush(); box.enqueue(event(2, 'failure'), action());
    await box.tick(); assert.equal(f.sent[0].channel.id, 'CPRS'); const count = f.sent.length;
    await box.tick(); // another channel may send, but the PR channel cannot send again at the same instant
    assert.equal(f.sent.filter(s => s.channel.id === 'CPRS').length, 1);
    f.advance(1000); await box.tick(); assert.ok(f.sent.length > count); assert.equal(f.sent.filter(s => s.channel.id === 'CPRS').length, 2);
  } finally { f.db.close(); }
});
