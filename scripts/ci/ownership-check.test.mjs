/** D8075 (#8075): ownership parsing against public task snapshots and read-only scan behavior. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ownedPatterns, taskIssue, overlaps, checkOwnership, exitStatus, renderReport, githubApi, main } from './ownership-check.mjs';

const fixtures = JSON.parse(readFileSync(new URL('./ownership-fixtures.json', import.meta.url), 'utf8'));
const active = (number, body, state = 'state:in-progress') => ({ number, body, state: 'open', labels: [{ name: state }] });
const pr = { number: 9000, head: { ref: 'agent/codex/8075-ownership-check' }, title: 'Add check', body: 'Closes #8075; depends on #5580', changed_files: 1 };
test('five real task bodies retain explicit ownership and issue placeholders, never excluded files or other sections', () => {
  const expected = new Map([[8070, 'cloudflare-worker/test/agent_capabilities_8070.test.ts'], [8071, 'cloudflare-worker/test/agent_budgets_8071.test.ts'], [8072, 'frontend/test/pool_contract_8072.test.mjs'], [8074, 'scripts/scan-remediation/sla.mjs'], [8075, 'scripts/ci/ownership-check.mjs']]);
  for (const fixture of fixtures) {
    const patterns = ownedPatterns(fixture.body, fixture.number);
    assert.ok(patterns.includes(expected.get(fixture.number)), `snapshot #${fixture.number}`);
    assert.ok(patterns.includes(`documentation/architecture/decisions/D${fixture.number}.md`));
    assert.ok(!patterns.includes('scripts/lib/workIntent.mjs'));
    assert.ok(!patterns.includes('scripts/landing-bot/**'));
    assert.ok(!patterns.includes('AGENTS.md'));
  }
});
test('form headings, bare paths, nested headings, negatives and code fences have bounded meaning', () => {
  const body = 'Before `unowned.js`\n### Files owned\n- `src/**/*.js`\n- plain/file.ts\n#### More\n`README.md`\nNot `src/private/**`.\nExcept `src/other/**`.\n### Goal\n`outside.js`\n```md\n## Owned files\n`fake.js`\n```';
  assert.deepEqual(ownedPatterns(body, 42), ['README.md', 'plain/file.ts', 'src/**/*.js']);
  assert.deepEqual(ownedPatterns('## Owned files\n`a.js`, `b.js`, `src/not/a.js`\n## Next\n`c.js`', 42), ['a.js', 'b.js', 'src/not/a.js']);
  assert.deepEqual(ownedPatterns('### **Files owned**\n`./src/a.ts` and `../escape.js`, `/absolute/a.js`, `$(bad).js`, `https://bad/a.js`', 42), ['src/a.ts']);
});
test('the branch is authoritative; unrelated body references cannot exempt another task', () => {
  assert.equal(taskIssue(pr), 8075);
  assert.equal(taskIssue({ ...pr, title: 'Depends on #42', body: 'Closes #43' }), 8075);
  assert.equal(taskIssue({ head: { ref: 'feature/check' }, title: 'Fix #42', body: 'Closes #43' }), 42);
  assert.equal(taskIssue({ title: 'Fix check', body: 'Depends on #43\nCloses #42' }), 42);
  assert.equal(taskIssue({ body: 'Related #44' }), 44);
  assert.equal(taskIssue({ title: 'Maintenance' }), null);
});
test('glob matching includes new/deleted/renamed paths and suppresses duplicate matches', () => {
  const issues = [active(8075, '### Files owned\n`src/**`'), active(42, '## Owned files\n`src/**/*.{js,ts}`, `src/a.js`, `old/file.js`'), active(43, '### Files owned\n`docs/`'), active(44, '### Files owned\n`src/**`', 'state:ready'), { ...active(45, '### Files owned\n`src/**`'), state: 'closed' }];
  issues.push(issues[1]);
  const rows = overlaps(8075, [{ filename: 'src/a.js' }, { filename: 'src/a.js' }, { filename: 'new/file.js', previous_filename: 'old/file.js' }, { filename: 'docs/new.md', status: 'removed' }], issues);
  assert.deepEqual(rows.map(r => [r.owner, r.file]), [[42, 'old/file.js'], [42, 'src/a.js'], [43, 'docs/new.md']]);
  assert.equal(overlaps(8075, ['no-match.txt'], issues).length, 0);
});
test('scan paginates changed files and both state labels once, deduplicates issues, and caches reads within one run', async () => {
  const calls = new Map();
  const api = async path => {
    calls.set(path, (calls.get(path) || 0) + 1);
    if (path === '/pulls/9000') return { ...pr, changed_files: 101 };
    if (path.startsWith('/pulls/9000/files')) return path.endsWith('page=1') ? Array.from({ length: 100 }, (_, i) => ({ filename: `src/${i}.js` })) : [{ filename: 'src/last.js' }];
    if (path.startsWith('/issues?')) return [active(42, '### Files owned\n`src/last.js`')];
    throw new Error('unexpected ' + path);
  };
  const result = await checkOwnership({ api, prNumber: 9000 });
  assert.equal(result.status, 'overlap'); assert.equal(result.issue, 8075);
  assert.equal(result.overlaps.length, 1); assert.equal(result.scannedIssues, 1);
  assert.equal(calls.size, 5); assert.ok([...calls.values()].every(n => n === 1));
  assert.match(renderReport(result), /#8075.*#42.*src\/last.js/);
  assert.equal(exitStatus(result), 0); assert.equal(exitStatus(result, 'advisory'), 0); assert.equal(exitStatus(result, 'enforce'), 1);
});
test('unlinked PR skips with a note, no scan; a clean complete scan passes even in enforce mode', async () => {
  const skipped = await checkOwnership({ prNumber: 9000, api: async path => { assert.equal(path, '/pulls/9000'); return { title: 'Maintenance', body: '', head: { ref: 'maintenance' } }; } });
  assert.equal(skipped.status, 'skipped'); assert.match(renderReport(skipped), /No linked task issue/); assert.equal(exitStatus(skipped, 'enforce'), 0);
  const clean = await checkOwnership({ prNumber: 9000, api: async path => path === '/pulls/9000' ? pr : path.startsWith('/pulls/') ? [{ filename: 'unowned.js' }] : [] });
  assert.equal(clean.status, 'clear'); assert.equal(exitStatus(clean, 'enforce'), 0);
});
test('API failure, truncated file list and malformed inventory are unknown, never an empty success', async () => {
  for (const variant of ['error', 'files', 'issues']) {
    const result = await checkOwnership({ prNumber: 9000, api: async path => {
      if (path === '/pulls/9000') return pr;
      if (variant === 'error') throw new Error('private token text must not be echoed');
      if (path.startsWith('/pulls/')) return variant === 'files' ? [] : [{ filename: 'a.js' }];
      return variant === 'files' ? [] : {};
    } });
    assert.equal(result.status, 'unknown'); assert.equal(exitStatus(result, 'enforce'), 1); assert.equal(exitStatus(result), 0);
    assert.doesNotMatch(renderReport(result), /private token/);
  }
});
test('the frozen event head is checked before and after pagination, including a changed base', async () => {
  const head = 'a'.repeat(40), base = 'b'.repeat(40);
  for (const variant of ['stable', 'start', 'head', 'base']) {
    let reads = 0;
    const result = await checkOwnership({ prNumber: 9000, expectedHead: head, api: async path => {
      if (path === '/pulls/9000') {
        reads++;
        return { ...pr, head: { ...pr.head, sha: variant === 'start' || reads === 2 && variant === 'head' ? 'c'.repeat(40) : head }, base: { sha: reads === 2 && variant === 'base' ? 'c'.repeat(40) : base } };
      }
      return path.startsWith('/pulls/') ? [{ filename: 'unowned.js' }] : [];
    } });
    assert.equal(result.status, variant === 'stable' ? 'clear' : 'unknown');
    assert.equal(reads, variant === 'start' ? 1 : 2);
  }
});
test('GitHub adapter is GET-only, bounded, validates repository/paths and never follows a redirect with the token', async () => {
  const calls = [];
  const api = githubApi({ repository: 'AxalNetwork/StudioOS', token: 'synthetic', fetcher: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => [] }; } });
  assert.deepEqual(await api('/issues?state=open'), []);
  assert.equal(calls[0].options.method, 'GET'); assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].url, 'https://api.github.com/repos/AxalNetwork/StudioOS/issues?state=open');
  await assert.rejects(api('https://other.example'), /path/);
  await assert.rejects(api('/../other'), /path/);
  assert.throws(() => githubApi({ repository: '../other', token: 'synthetic' }), /repository/);
  const failing = githubApi({ repository: 'AxalNetwork/StudioOS', token: 'synthetic', fetcher: async () => ({ ok: false, status: 403 }) });
  await assert.rejects(failing('/issues'), /HTTP 403/);
});
test('workflow uses hosted read-only PR execution, forces advisory bootstrap and runs its regression tests', () => {
  const source = readFileSync(new URL('../../.github/workflows/ownership.yml', import.meta.url), 'utf8');
  assert.match(source, /pull_request:/); assert.doesNotMatch(source, /pull_request_target|secrets\.|id-token|write-all/);
  assert.match(source, /issues: read/); assert.match(source, /pull-requests: read/); assert.match(source, /persist-credentials: false/);
  assert.match(source, /name: ownership/); assert.match(source, /LANDING_OWNERSHIP_CHECK=advisory/);
  assert.match(source, /node --test scripts\/ci\/ownership-check.test.mjs/);
  assert.match(source, /working-directory: candidate/); assert.match(source, /node candidate\/scripts\/ci\/ownership-check.mjs/);
});
test('summary escapes API-supplied filenames and bounds large overlap tables', () => {
  const row = { issue: 8075, owner: 42, file: '<b>|`bad`\n&.js\r::warning::synthetic', patterns: ['<b>|`bad`\n&.js'] };
  const summary = renderReport({ status: 'overlap', issue: 8075, overlaps: Array.from({ length: 201 }, () => row) });
  assert.doesNotMatch(summary, /<b>|`bad`/); assert.match(summary, /&lt;b&gt;&#124;&#96;bad&#96; &amp;.js/);
  assert.doesNotMatch(summary, /\r|^::warning/m);
  assert.equal(summary.split('\n').filter(l => l.startsWith('| #')).length, 200); assert.match(summary, /200 of 201/);
});
test('CLI writes the same report to stdout and step summary and never treats missing event access as clear', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ownership8075-')), event = join(dir, 'event.json'), summary = join(dir, 'summary.md');
  try {
    const head = 'a'.repeat(40);
    writeFileSync(event, JSON.stringify({ pull_request: { number: 9000, head: { sha: head } } }));
    const logs = [], calls = [];
    const api = async path => { calls.push(path); return path === '/pulls/9000' ? { ...pr, head: { ...pr.head, sha: head } } : path.startsWith('/pulls/') ? [{ filename: 'src/a.js' }] : [active(42, '### Files owned\n`src/a.js`')]; };
    const code = await main({ env: { GITHUB_EVENT_PATH: event, GITHUB_STEP_SUMMARY: summary, LANDING_OWNERSHIP_CHECK: 'enforce' }, api, log: s => logs.push(s) });
    assert.equal(code, 1); assert.equal(readFileSync(summary, 'utf8'), logs[0]); assert.match(logs[0], /#8075.*#42/);
    assert.equal(calls.filter(p => p === '/pulls/9000').length, 2);
    const missing = [];
    assert.equal(await main({ env: { LANDING_OWNERSHIP_CHECK: 'enforce' }, log: s => missing.push(s) }), 1);
    assert.match(missing[0], /unknown/); assert.doesNotMatch(missing[0], /No overlap/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
