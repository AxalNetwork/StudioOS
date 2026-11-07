/**
 * #4566 (Agent capacity A0) — the preview isolation preflight
 * (`scripts/lib/previewIsolation.mjs`), on the real `wrangler.toml` and on
 * small synthetic configs. Nothing here reaches Cloudflare; every id is made up.
 *
 *   1. The real config: preview declares no production identity, and its
 *      placeholders keep a hosted run unverified.
 *   2. Shared D1, KV, Queue, DLQ, Workflow, Durable Object, R2, AI Gateway or
 *      Worker name: unsafe. An unknown binding kind: unsafe.
 *   3. An observation that disagrees with the declaration, names production,
 *      lacks a field, or lacks its permissions: never isolated.
 *   4. Outbound secrets, live inference and a used browser: unsafe.
 *   5. Production's agent switches must still read off and manual.
 *
 *   node --test cloudflare-worker/test/preview_isolation_4566.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { INTERNAL_SECRETS, isolationMatrix, preflight } from '../../scripts/lib/previewIsolation.mjs';

const REAL = readFileSync(new URL('../../wrangler.toml', import.meta.url), 'utf8');

/** A small config shaped like wrangler.toml: production and one preview, each line replaceable. */
const PROD_D1 = '11111111-1111-1111-1111-111111111111';
const PROD_KV = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
function config(over = {}) {
  const p = {
    worker: 'studioos-preview', d1: '22222222-2222-2222-2222-222222222222', d1name: 'studioos-db-preview', kv: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    queue: 'studioos-agent-queue-preview', dlq: 'studioos-agent-queue-preview-dlq', workflow: 'studioos-agent-task-preview',
    bucket: 'studioos-files-preview', doScript: null, gateway: '', engine: 'off', autonomy: 'manual', extra: '', ...over,
  };
  return `name = "studioos"
[env.production]
name = "studioos"
[env.production.vars]
AGENT_ENGINE = "${p.engine}"
AGENT_AUTONOMY = "${p.autonomy}"
CF_AI_GATEWAY_SLUG_ADVISOR = "advisor-ongoing"
[[env.production.d1_databases]]
binding = "DB"
database_name = "studioos-db"
database_id = "${PROD_D1}"
[[env.production.kv_namespaces]]
binding = "RATE_LIMITS"
id = "${PROD_KV}"
[[env.production.queues.producers]]
binding = "AGENT_QUEUE"
queue = "studioos-agent-queue"
[[env.production.queues.consumers]]
queue = "studioos-agent-queue"
dead_letter_queue = "studioos-agent-queue-dlq"
[[env.production.workflows]]
name = "studioos-agent-task"
binding = "AGENT_TASK"
class_name = "AgentTaskWorkflow"
[[env.production.durable_objects.bindings]]
name = "AGENT_SCOPE"
class_name = "AgentScope"
[[env.production.r2_buckets]]
binding = "FILES"
bucket_name = "studioos-files"
[env.preview]
name = "${p.worker}"
[env.preview.vars]
AGENT_ENGINE = "off"
CF_AI_GATEWAY_SLUG_ADVISOR = "${p.gateway}"
[[env.preview.d1_databases]]
binding = "DB"
database_name = "${p.d1name}"
database_id = "${p.d1}"
[[env.preview.kv_namespaces]]
binding = "RATE_LIMITS"
id = "${p.kv}"
[[env.preview.queues.producers]]
binding = "AGENT_QUEUE"
queue = "${p.queue}"
[[env.preview.queues.consumers]]
queue = "${p.queue}"
dead_letter_queue = "${p.dlq}"
[[env.preview.workflows]]
name = "${p.workflow}"
binding = "AGENT_TASK"
class_name = "AgentTaskWorkflow"
[[env.preview.durable_objects.bindings]]
name = "AGENT_SCOPE"
class_name = "AgentScope"
${p.doScript ? `script_name = "${p.doScript}"` : ''}
[[env.preview.r2_buckets]]
binding = "FILES"
bucket_name = "${p.bucket}"
[env.preview.ai]
binding = "AI"
${p.extra}
`;
}
/** The observation that matches `config()`'s preview exactly. */
const observation = (over = {}) => ({
  taken_at: '2026-11-06T12:00:00Z', account_permissions: ['d1:read', 'kv:read', 'queues:read', 'workflows:read', 'r2:read', 'secrets:list'],
  worker: 'studioos-preview',
  d1: { DB: { database_id: '22222222-2222-2222-2222-222222222222', database_name: 'studioos-db-preview' } },
  kv: { RATE_LIMITS: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
  queues: ['studioos-agent-queue-preview', 'studioos-agent-queue-preview-dlq'],
  workflows: ['studioos-agent-task-preview'], r2: ['studioos-files-preview'],
  secrets: ['JWT_SECRET'], inference: 'stub', browser: 'unused', ...over,
});
const unsafeOf = (r) => r.unsafe.map((u) => `${u.kind}:${u.field ?? u.binding}:${u.status}`);

test('the real wrangler.toml: preview declares no production identity; its placeholders keep a hosted run unverified', () => {
  // Mutation checked: preview's AI Gateway slug back to production's `advisor-ongoing` → the static check fails.
  const s = preflight(REAL, { static: true });
  assert.equal(s.ok, true, JSON.stringify(s.unsafe));
  assert.deepEqual(s.rows.filter((r) => r.status === 'placeholder').map((r) => r.binding).sort(), ['DB', 'OAUTH_KV', 'RATE_LIMITS', 'TOKENS'],
    'D1 and the three KV namespaces are not provisioned for preview yet');
  const hosted = preflight(REAL, { observed: { ...observation(), worker: 'studioos-preview' } });
  assert.notEqual(hosted.verdict, 'isolated', 'a placeholder can never be isolated');
  // Every production critical identity appears somewhere in the comparison.
  const prodShared = preflight(REAL.replace('CF_AI_GATEWAY_SLUG_ADVISOR     = ""', 'CF_AI_GATEWAY_SLUG_ADVISOR     = "advisor-ongoing"'), { static: true });
  assert.deepEqual(unsafeOf(prodShared), ['ai_gateway:CF_AI_GATEWAY_SLUG_ADVISOR:shared']);
  // The CLI agrees, and is part of test:guards.
  assert.match(execFileSync('node', ['scripts/check-preview-isolation.mjs', '--static'], { cwd: new URL('../../', import.meta.url), encoding: 'utf8' }), /declares no production identity/);
  assert.match(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'), /check-preview-isolation\.mjs --static/);
});

test('a fully observed, separate preview is isolated; the same config without an observation is unverified', () => {
  const r = preflight(config(), { observed: observation() });
  assert.equal(r.verdict, 'isolated', JSON.stringify([r.unsafe, r.pending]));
  assert.equal(r.ok, true);
  assert.equal(preflight(config(), {}).verdict, 'unverified', 'no evidence is never safe');
});

test('each shared production identity is unsafe: D1, KV, Queue, DLQ, Workflow, Durable Object, R2, gateway, Worker', () => {
  // Mutation checked: dropping the queue cross-table lookup lets a preview DLQ named after production's queue pass.
  const cases = [
    [{ d1: PROD_D1 }, 'd1_databases:database_id:shared'],
    [{ d1name: 'studioos-db' }, 'd1_databases:database_name:shared'],
    [{ kv: PROD_KV }, 'kv_namespaces:id:shared'],
    [{ queue: 'studioos-agent-queue' }, 'queues.producers:queue:shared'],
    [{ dlq: 'studioos-agent-queue' }, 'queues.consumers:dead_letter_queue:shared'],
    [{ workflow: 'studioos-agent-task' }, 'workflows:name:shared'],
    [{ doScript: 'studioos' }, 'durable_objects.bindings:script_name:shared'],
    [{ bucket: 'studioos-files' }, 'r2_buckets:bucket_name:shared'],
    [{ gateway: 'advisor-ongoing' }, 'ai_gateway:CF_AI_GATEWAY_SLUG_ADVISOR:shared'],
  ];
  for (const [over, want] of cases) {
    const r = preflight(config(over), { observed: observation(), static: false });
    assert.equal(r.verdict, 'unsafe', `${want}: ${JSON.stringify(r.unsafe)}`);
    assert.ok(unsafeOf(r).includes(want), `${want} in ${unsafeOf(r)}`);
    assert.equal(preflight(config(over), { static: true }).ok, false, `${want}: the static CI check fails too`);
  }
  // The Worker named as production's: its own Durable Object namespaces are production's.
  const w = preflight(config({ worker: 'studioos' }), { observed: observation({ worker: 'studioos' }) });
  assert.ok(unsafeOf(w).includes('worker:script:shared'));
  assert.ok(unsafeOf(w).includes('durable_objects.bindings:namespace:shared'));
});

test('an unknown binding kind is unsafe rather than skipped', () => {
  const r = preflight(config({ extra: '[[env.preview.hyperdrive]]\nbinding = "HD"\nid = "x"' }), { static: true });
  assert.deepEqual(unsafeOf(r), ['hyperdrive:hyperdrive:unknown_binding']);
});

test('an observation that disagrees, names production, or is incomplete is never isolated', () => {
  // Mutation checked: treating an absent observed field as isolated → the missing-KV case passes.
  const mismatch = preflight(config(), { observed: observation({ kv: { RATE_LIMITS: 'cccccccccccccccccccccccccccccccc' } }) });
  assert.ok(unsafeOf(mismatch).includes('kv_namespaces:id:mismatch'), 'declared one id, observed another');
  const aliased = preflight(config(), { observed: observation({ d1: { DB: { database_id: PROD_D1, database_name: 'studioos-db-preview' } } }) });
  assert.ok(unsafeOf(aliased).includes('d1_databases:database_id:shared'), 'the deployed preview binds production\'s database');
  const missing = preflight(config(), { observed: observation({ kv: {} }) });
  assert.equal(missing.verdict, 'unverified');
  assert.ok(missing.pending.some((p) => p.kind === 'kv_namespaces'));
  const queueGone = preflight(config(), { observed: observation({ queues: ['studioos-agent-queue-preview'] }) });
  assert.notEqual(queueGone.verdict, 'isolated', 'a DLQ that does not exist is not isolated');
  const { account_permissions, ...noPerms } = observation();
  const perms = preflight(config(), { observed: noPerms });
  assert.equal(perms.verdict, 'unverified', 'missing account permission is unverified, not safe');
  assert.ok(perms.pending.some((p) => p.kind === 'account_permissions'));
});

test('outbound secrets, live inference and a used browser are unsafe; internal secrets are not', () => {
  // Mutation checked: a blocklist instead of INTERNAL_SECRETS lets a secret added later (here STRIPE_SECRET_KEY) through.
  for (const name of ['RESEND_API_KEY', 'STRIPE_SECRET_KEY', 'ANTHROPIC_API_KEY', 'TELEGRAM_BOT_TOKEN', 'SOME_NEW_PROVIDER_TOKEN']) {
    const r = preflight(config(), { observed: observation({ secrets: ['JWT_SECRET', name] }) });
    assert.ok(unsafeOf(r).includes(`secrets:${name}:outbound_secret`), name);
  }
  for (const name of INTERNAL_SECRETS) assert.equal(preflight(config(), { observed: observation({ secrets: [name] }) }).verdict, 'isolated', name);
  assert.ok(unsafeOf(preflight(config(), { observed: observation({ inference: 'live' }) })).includes('ai:AI:shared'), 'a paid model call');
  assert.equal(preflight(config(), { observed: observation({ inference: undefined }) }).verdict, 'unverified');
  const browser = preflight(config({ extra: '[env.preview.browser]\nbinding = "BROWSER"' }), { observed: observation({ browser: 'used' }) });
  assert.ok(unsafeOf(browser).includes('browser:BROWSER:shared'));
  assert.equal(preflight(config(), { observed: observation({ secrets: undefined }) }).verdict, 'unverified', 'secret names not listed');
});

test('production\'s agent switches must read off and manual, whatever preview says', () => {
  assert.ok(unsafeOf(preflight(config({ engine: 'on' }), { static: true })).includes('production_var:AGENT_ENGINE:shared'));
  assert.ok(unsafeOf(preflight(config({ autonomy: 'self_start' }), { static: true })).includes('production_var:AGENT_AUTONOMY:shared'));
  // The real file keeps them.
  const m = isolationMatrix(REAL, 'production');
  assert.equal(m.worker, 'studioos');
});

test('the fixture writer refuses without an isolated, fresh preflight, and writes for a local copy only when told', async () => {
  // Mutation checked: the verdict check dropped → an unverified preflight writes a seed file.
  const { mkdtempSync, writeFileSync, existsSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'a0-fixtures-'));
  const cwd = new URL('../../', import.meta.url);
  const run = (...a) => { try { execFileSync('node', ['scripts/agent-validation-fixtures.mjs', ...a], { cwd, encoding: 'utf8', stdio: 'pipe' }); return 0; } catch (e) { return e.status; } };
  try {
    const out = join(dir, 'seed.sql');
    assert.equal(run('seed', '--run', 'a0run01', '--out', out), 1, 'no preflight');
    for (const [name, pre] of [['unverified', { verdict: 'unverified', observed_at: new Date().toISOString() }], ['stale', { verdict: 'isolated', observed_at: '2020-01-01T00:00:00Z' }], ['unsafe', { verdict: 'unsafe' }]]) {
      const p = join(dir, `${name}.json`); writeFileSync(p, JSON.stringify(pre));
      assert.equal(run('seed', '--run', 'a0run01', '--preflight', p, '--out', out), 1, name);
    }
    assert.equal(existsSync(out), false, 'nothing was written');
    const ok = join(dir, 'ok.json'); writeFileSync(ok, JSON.stringify({ verdict: 'isolated', observed_at: new Date().toISOString() }));
    assert.equal(run('seed', '--run', 'a0run01', '--preflight', ok, '--out', out), 0);
    assert.equal(run('seed', '--run', 'a0run01', '--tenants', '11', '--preflight', ok, '--out', out), 1, 'over a ceiling');
    assert.equal(run('seed', '--run', 'A;DROP', '--local', '--out', out), 1, 'a bad run id');
    assert.equal(run('cleanup', '--run', 'a0run01', '--local', '--out', out), 0);
    assert.match(readFileSync(out, 'utf8'), /LOCAL SQLite only/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
