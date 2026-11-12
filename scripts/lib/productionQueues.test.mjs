/** D5535: disposable release-admission fixtures, without Cloudflare credentials. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { candidateConfig, checkProductionQueues, productionQueues } from '../check-production-queues.mjs';

const account = 'a'.repeat(32);
const previewAccount = 'b'.repeat(32);

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'production-queues-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'wrangler.toml');
  writeFileSync(path, `name = "fixture"
compatibility_date = "2026-11-01"
[[queues.producers]]
binding = "JOBS"
queue = "root-jobs"
[env.production]
account_id = "${account}"
[env.production.queues]
producers = [{ binding = "JOBS", queue = "prod-jobs" }]
consumers = [{ queue = "prod-jobs", dead_letter_queue = "prod-dlq" }, { queue = "prod-consumer" }]
[env.preview]
account_id = "${previewAccount}"
[[env.preview.queues.producers]]
binding = "JOBS"
queue = "preview-dlq"
`);
  return productionQueues(path);
}

function inventory(names, page = 1, totalPages = 1) {
  return Response.json({ success: true, result: names.map(queue_name => ({ queue_name })), result_info: { page, total_pages: totalPages } });
}

test('Wrangler resolves only the production producers, consumers and dead-letter queues', t => {
  assert.deepEqual(fixture(t), { configuredAccount: account, names: ['prod-consumer', 'prod-dlq', 'prod-jobs'] });
});

test('the release sequence stops before migrations and publish unless the production inventory is verified', async t => {
  const bindings = fixture(t);
  async function rehearse(pages) {
    const steps = [];
    const result = await checkProductionQueues({ ...bindings, account, token: 'fixture', fetchImpl: async (url, request) => {
      const page = Number(url.searchParams.get('page'));
      steps.push([request.method, url.pathname, page]);
      return inventory(pages[page - 1], page, pages.length);
    } });
    if (result.status === 'verified') steps.push('migrate', 'publish');
    return { result, steps };
  }
  const endpoint = `/client/v4/accounts/${account}/queues`;
  assert.deepEqual(await rehearse([['prod-jobs', 'prod-consumer', 'preview-dlq']]), {
    result: { status: 'missing', missing: ['prod-dlq'] }, steps: [['GET', endpoint, 1]],
  });
  assert.deepEqual(await rehearse([['prod-jobs', 'prod-consumer'], ['prod-dlq']]), {
    result: { status: 'verified', required: bindings.names }, steps: [['GET', endpoint, 1], ['GET', endpoint, 2], 'migrate', 'publish'],
  });
});

test('authorization, incomplete inventory and a preview account fail distinctly', async t => {
  const bindings = fixture(t);
  const check = fetchImpl => checkProductionQueues({ ...bindings, account, token: 'fixture', fetchImpl });
  assert.equal((await check(async () => new Response(null, { status: 403 }))).status, 'unauthorized');
  assert.equal((await check(async () => Response.json({ success: true, result: [] }))).status, 'inconclusive');
  assert.equal((await check(async () => inventory([], 2, 2))).status, 'inconclusive');
  assert.equal((await check(async () => { throw new Error('connection closed'); })).status, 'inconclusive');
  assert.deepEqual(await checkProductionQueues({ ...bindings, account: previewAccount, token: 'fixture', fetchImpl: async () => {
    assert.fail('The preview account must never be queried');
  } }), { status: 'account_mismatch' });
});

test('candidate config rejects an abbreviated or mismatched revision', () => {
  assert.throws(() => candidateConfig('abcd123'), /trusted candidate SHA/);
  assert.throws(() => candidateConfig('0'.repeat(40)), /trusted candidate SHA/);
});
