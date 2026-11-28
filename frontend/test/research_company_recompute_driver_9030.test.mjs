// D9030 (#9030): scripts/research-company-recompute.mjs against a fake
// recompute route on 127.0.0.1. Each run is the real CLI in a child process,
// so stdout/stderr are exactly what an operator sees.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'research-company-recompute.mjs');
const PATH = '/api/admin/research-company-mapping/recompute';
const SECRET = 'studioos_auth=SECRET-JWT-9030; studioos_csrf=CSRF-9030';

const page = (after, done, counts, processed = 2, rules_version = 'D7821.1:4') =>
  ({ status: 200, body: { stale: false, processed, after, done, rules_version, counts } });
// The route's refusal shape (util/refusal.ts refusalBody): the code on `error`.
const refusal = (status, code) => ({ status, body: { error: code, message: `refused ${code} ${SECRET}`, detail: `refused ${code}` } });

/** Serve `answers` in order; record each request. */
async function fakeRoute(answers) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, cookie: req.headers.cookie, csrf: req.headers['x-csrf-token'], body: JSON.parse(raw || 'null') });
      const answer = answers[seen.length - 1] ?? refusal(500, 'fake_ran_out');
      res.writeHead(answer.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(answer.body));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { seen, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

function run(args, env = { RESEARCH_RECOMPUTE_COOKIE: SECRET }) {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, ...args], { env: { PATH: process.env.PATH, ...env }, timeout: 20_000 }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stdout, stderr, json: (() => { try { return JSON.parse(stdout); } catch { return null; } })() });
    });
  });
}

test('the fake matches the route: 409 recompute_rules_changed through refuse()', () => {
  const src = readFileSync(join(ROOT, 'cloudflare-worker/src/routes/research_company_mapping.ts'), 'utf8');
  assert.match(src, /refuse\(c,409,\{code:'recompute_rules_changed'/);
  assert.match(src, /path:'\/api\/admin\/research-company-mapping'/);
});

test('pages until done, carrying after and rules_version, and sums every group once per page', async () => {
  const fake = await fakeRoute([
    page('c-0002', false, { state: { mapped: 1, no_label: 1 }, method: { code: 1, none: 1 }, scheme: { 'UK SIC': 1, none: 1 } }),
    page('c-0004', false, { state: { mapped: 2 }, method: { code: 1, rule: 1 }, scheme: { 'UK SIC': 2, NACE: 1 } }),
    page('c-0005', true, { state: { outside_tracked_markets: 1 }, method: { rule: 1 }, scheme: { none: 1 } }, 1),
  ]);
  try {
    const r = await run(['--base', fake.base]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(fake.seen.length, 3);
    assert.deepEqual(fake.seen.map((s) => [s.method, s.url]), [['POST', PATH], ['POST', PATH], ['POST', PATH]]);
    assert.deepEqual(fake.seen.map((s) => s.body), [
      { after: '', limit: 100 },
      { after: 'c-0002', limit: 100, rules_version: 'D7821.1:4' },
      { after: 'c-0004', limit: 100, rules_version: 'D7821.1:4' },
    ]);
    assert.equal(fake.seen[0].cookie, SECRET);
    assert.equal(fake.seen[0].csrf, 'CSRF-9030');
    assert.equal(r.json.complete, true);
    assert.equal(r.json.pages, 3);
    assert.equal(r.json.processed, 5);
    assert.equal(r.json.restarts, 0);
    assert.equal(r.json.after, 'c-0005');
    assert.equal(r.json.rules_version, 'D7821.1:4');
    assert.deepEqual(r.json.counts, {
      state: { mapped: 3, no_label: 1, outside_tracked_markets: 1 },
      method: { code: 2, none: 1, rule: 2 },
      scheme: { 'UK SIC': 3, none: 2, NACE: 1 },
    });
  } finally { await fake.close(); }
});

test('a 409 restart discards the partial sums and starts again from an empty cursor', async () => {
  const fake = await fakeRoute([
    page('c-0002', false, { state: { mapped: 2 }, method: { code: 2 }, scheme: { 'UK SIC': 2 } }, 2, 'D7821.1:4'),
    refusal(409, 'recompute_rules_changed'),
    page('c-0002', false, { state: { mapped: 1, pinned_unmapped_by_hand: 1 }, method: { code: 1, manual: 1 }, scheme: { 'UK SIC': 2 } }, 2, 'D7821.1:5'),
    page('c-0003', true, { state: { no_label: 1 }, method: { none: 1 }, scheme: { none: 1 } }, 1, 'D7821.1:5'),
  ]);
  try {
    const r = await run(['--base', fake.base]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(fake.seen.map((s) => s.body), [
      { after: '', limit: 100 },
      { after: 'c-0002', limit: 100, rules_version: 'D7821.1:4' },
      { after: '', limit: 100 },
      { after: 'c-0002', limit: 100, rules_version: 'D7821.1:5' },
    ]);
    assert.equal(r.json.complete, true);
    assert.equal(r.json.restarts, 1);
    assert.equal(r.json.pages, 2);
    assert.equal(r.json.processed, 3);
    assert.equal(r.json.rules_version, 'D7821.1:5');
    // Only the pages after the restart: the first run's mapped:2 is gone.
    assert.deepEqual(r.json.counts, {
      state: { mapped: 1, pinned_unmapped_by_hand: 1, no_label: 1 },
      method: { code: 1, manual: 1, none: 1 },
      scheme: { 'UK SIC': 2, none: 1 },
    });
  } finally { await fake.close(); }
});

test('restarts once: a second 409 stops the run with its cursor', async () => {
  const fake = await fakeRoute([
    refusal(409, 'recompute_rules_changed'),
    page('c-0002', false, { state: { mapped: 2 }, method: { code: 2 }, scheme: { 'UK SIC': 2 } }),
    refusal(409, 'recompute_rules_changed'),
  ]);
  try {
    const r = await run(['--base', fake.base]);
    assert.equal(r.code, 1);
    assert.equal(fake.seen.length, 3);
    assert.equal(r.json.complete, false);
    assert.equal(r.json.restarts, 1);
    assert.deepEqual(r.json.stopped, { status: 409, code: 'recompute_rules_changed', at_after: 'c-0002' });
  } finally { await fake.close(); }
});

test('a 503 stops at the page cursor, with no retry and the sums so far', async () => {
  const fake = await fakeRoute([
    page('c-0002', false, { state: { mapped: 2 }, method: { code: 2 }, scheme: { 'UK SIC': 2 } }),
    refusal(503, 'research_store_unavailable'),
    page('c-0004', true, { state: { mapped: 2 }, method: { code: 2 }, scheme: { 'UK SIC': 2 } }),
  ]);
  try {
    const r = await run(['--base', fake.base]);
    assert.equal(r.code, 1);
    assert.equal(fake.seen.length, 2);
    assert.equal(r.json.complete, false);
    assert.deepEqual(r.json.stopped, { status: 503, code: 'research_store_unavailable', at_after: 'c-0002' });
    assert.equal(r.json.rules_version, 'D7821.1:4');
    assert.equal(r.json.pages, 1);
    assert.deepEqual(r.json.counts.state, { mapped: 2 });
  } finally { await fake.close(); }
});

test('resumes from --after with --rules-version, and a page that does not advance stops', async () => {
  const fake = await fakeRoute([
    page('c-0006', false, { state: { mapped: 1 }, method: { code: 1 }, scheme: { NACE: 1 } }, 1),
    page('c-0006', false, { state: { mapped: 1 }, method: { code: 1 }, scheme: { NACE: 1 } }, 1),
  ]);
  try {
    const r = await run(['--base', fake.base, '--after', 'c-0005', '--rules-version', 'D7821.1:4', '--limit', '50']);
    assert.equal(r.code, 1);
    assert.deepEqual(fake.seen[0].body, { after: 'c-0005', limit: 50, rules_version: 'D7821.1:4' });
    assert.equal(r.json.resumed_from, 'c-0005');
    assert.deepEqual(r.json.stopped, { status: 200, code: 'no_progress', at_after: 'c-0006' });
    assert.equal(r.json.pages, 1);
  } finally { await fake.close(); }
});

test('the cookie is never printed, on success or on a stop', async () => {
  const fake = await fakeRoute([
    page('c-0002', false, { state: { mapped: 2 }, method: { code: 2 }, scheme: { 'UK SIC': 2 } }),
    refusal(403, 'forbidden'),
  ]);
  try {
    const r = await run(['--base', fake.base]);
    assert.equal(r.code, 1);
    for (const text of [r.stdout, r.stderr]) {
      assert.doesNotMatch(text, /SECRET-JWT-9030|CSRF-9030|studioos_auth/);
    }
    const ok = await run(['--dry-run']);
    assert.equal(ok.code, 0);
    assert.doesNotMatch(ok.stdout + ok.stderr, /SECRET-JWT-9030|CSRF-9030/);
  } finally { await fake.close(); }
});

test('refuses axal.vc and app.axal.vc without --confirm-production, before any request', async () => {
  // No cookie in these runs: should the host check ever fail open, the run
  // stops at the missing cookie instead of sending a request anywhere.
  for (const base of ['https://axal.vc', 'https://APP.axal.vc.']) {
    const r = await run(['--base', base], {});
    assert.equal(r.code, 2);
    assert.match(r.stderr, /is production: rerun with --confirm-production/);
    assert.equal(r.stdout, '');
  }
  const other = await run(['--base', 'http://example.com'], {});
  assert.equal(other.code, 2);
  assert.match(other.stderr, /plain http is accepted for localhost only/);
  const noCookie = await run(['--base', 'http://127.0.0.1:9'], {});
  assert.equal(noCookie.code, 2);
  assert.match(noCookie.stderr, /set RESEARCH_RECOMPUTE_COOKIE/);
});

test('--dry-run answers from the stub, contacts nothing and sums its pages', async () => {
  const r = await run(['--dry-run'], {});
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.dry_run, true);
  assert.equal(r.json.complete, true);
  assert.equal(r.json.pages, 2);
  assert.deepEqual(r.json.counts.scheme, { 'UK SIC': 1, none: 2 });
});

test('checkBase lets production through only with the confirmation, and keeps the origin only', async () => {
  const { checkBase } = await import('../../scripts/research-company-recompute.mjs');
  assert.deepEqual(checkBase('https://app.axal.vc', true), { origin: 'https://app.axal.vc', production: true });
  assert.deepEqual(checkBase('https://staging.example.com', false), { origin: 'https://staging.example.com', production: false });
  assert.match(checkBase('https://axal.vc/api', true).error, /origin only/);
});
