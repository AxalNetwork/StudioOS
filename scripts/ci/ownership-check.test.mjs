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
test('the tagged branch identifies a task; dependencies cannot exempt another task', () => {
  assert.equal(taskIssue(pr), 8075);
  assert.equal(taskIssue({ ...pr, title: 'Depends on #42', body: 'Depends on #43' }), 8075);
  assert.throws(() => taskIssue({ head: { ref: 'feature/check' }, title: 'Fix #42', body: 'Closes #43' }), { code: 'TASK_AMBIGUOUS' });
  assert.equal(taskIssue({ title: 'Fix check', body: 'Depends on #43\nCloses #42' }), 42);
  assert.equal(taskIssue({ body: 'Related #44' }), 44);
  assert.equal(taskIssue({ title: 'Maintenance' }), null);
});
test('tagged branches cannot override contradictory or multiple explicit task links', async () => {
  for (const ref of ['agent/codex/8075-check', 'claude/session-name-8075', 'claude/session-name-8075c']) {
    for (const body of ['Closes #43', 'Part of #43', 'Closes #8075\nCloses #43']) {
      const input = { ...pr, head: { ref }, body };
      assert.throws(() => taskIssue(input), { code: 'TASK_AMBIGUOUS' });
      const result = await checkOwnership({ prNumber: 9000, api: async path => { assert.equal(path, '/pulls/9000'); return input; } });
      assert.equal(result.status, 'unknown');
      assert.equal(result.issue, null);
      assert.equal(exitStatus(result, 'enforce'), 1);
    }
    assert.equal(taskIssue({ ...pr, head: { ref }, body: 'Part of #8075\nDepends on #43' }), 8075);
  }
});
test('explicit task links beat incidental title references and tagged Claude branches identify their task', () => {
  assert.equal(taskIssue({ title: 'Hold #5719 while doing #8075', body: 'Closes #8075' }), 8075);
  assert.equal(taskIssue({ head: { ref: 'claude/session-name-8075' }, title: 'Coordination #5719', body: '' }), 8075);
  assert.equal(taskIssue({ head: { ref: 'claude/session-name-8075c' }, title: 'Coordination #5719', body: 'Part of #8075' }), 8075);
  for (const input of [{ title: 'Hold #5719 while doing #8075' }, { body: 'Closes #8075\nCloses #8076' }, { title: 'Fix #8075', body: 'Closes #8075\nCloses #8076' }, { body: 'Related #8075 and #8076' }]) assert.throws(() => taskIssue(input), { code: 'TASK_AMBIGUOUS' });
});
test('single-line ownership labels parse only their value and preserve section exclusions', () => {
  const body = 'Files owned: `src/a.js`, `ci.yml`\nUnrelated `outside.js`\n**Files owned:** `src/b.js`\n**Owned files**: `src/c.js`\n```md\nFiles owned: `fake.js`\n```';
  assert.deepEqual(ownedPatterns(body, 42), ['ci.yml', 'src/a.js', 'src/b.js', 'src/c.js']);
  assert.deepEqual(ownedPatterns('### Files owned\nNot:\n- `src/no.js`\nFiles owned: `src/yes.js`\n- `src/still-no.js`', 42), ['src/yes.js']);
});
test('multiline exclusions never become ownership through later bullets or nested headings', () => {
  const bodies = [
    '### Files owned\n`src/a.js`\nNot:\n- `src/b.js`\n- `src/c.js`\n\nOwned:\n`src/d.js`',
    '### Files owned\n`src/a.js`\nExcluding\n- `src/b.js`\n  `src/c.js`\n\nAlso owned:\n`src/d.js`',
    '### Files owned\n`src/a.js`\n#### Not owned\n- `src/b.js`\n- `src/c.js`\n#### Owned files\n`src/d.js`',
  ];
  for (const body of bodies) assert.deepEqual(ownedPatterns(body, 42), ['src/a.js', 'src/d.js']);
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
test('name-only matches stay unconfirmed, including rename sources, rather than claiming a file or reporting clear', async () => {
  const files = [{ filename: '.github/workflows/ci.yml', previous_filename: 'old/<b>/ci.yml' }];
  const owners = [active(42, '### Files owned\n`ci.yml`'), active(8075, '### Files owned\n`ci.yml`')];
  const result = await checkOwnership({ prNumber: 9000, api: async path => path === '/pulls/9000' ? pr : path.startsWith('/pulls/') ? files : owners });
  assert.equal(result.status, 'unconfirmed'); assert.deepEqual(result.overlaps, []);
  assert.deepEqual(result.unconfirmed.map(r => [r.kind, r.owner, r.file]), [['name-only', 42, '.github/workflows/ci.yml'], ['name-only', 42, 'old/<b>/ci.yml']]);
  const summary = renderReport(result); assert.match(summary, /Unconfirmed name-only match/); assert.doesNotMatch(summary, /No overlap/);
  assert.doesNotMatch(summary, /<b>/); assert.match(summary, /old\/&lt;b&gt;\/ci.yml/);
  assert.equal(exitStatus(result), 0); assert.equal(exitStatus(result, 'enforce'), 1);
  assert.deepEqual(overlaps(8075, ['ci.yml'], owners).map(r => r.owner), [42]);
});
test('a confirmed path suppresses redundant name-only uncertainty for that owner, while other owners remain distinct', async () => {
  const owners = [active(42, '### Files owned\n`ci.yml`, `.github/workflows/ci.yml`'), active(43, '### Files owned\n`ci.yml`')];
  const result = await checkOwnership({ prNumber: 9000, api: async path => path === '/pulls/9000' ? pr : path.startsWith('/pulls/') ? [{ filename: '.github/workflows/ci.yml' }] : owners });
  assert.equal(result.status, 'overlap'); assert.deepEqual(result.overlaps.map(r => r.owner), [42]);
  assert.deepEqual(result.unconfirmed.map(r => r.owner), [43]);
});
test('unscoped root globs require coordination instead of asserting ownership of every changed path', async () => {
  const owners = [active(42, '### Files owned\n`**/*`, `*/*`')];
  const result = await checkOwnership({ prNumber: 9000, api: async path => path === '/pulls/9000' ? pr : path.startsWith('/pulls/') ? [{ filename: 'src/a.js' }] : owners });
  assert.equal(result.status, 'unconfirmed'); assert.deepEqual(result.overlaps, []);
  assert.deepEqual(result.unconfirmed[0].patterns, ['**/*', '*/*']); assert.equal(result.unconfirmed[0].kind, 'unscoped');
  assert.match(renderReport(result), /Unscoped broad pattern/); assert.equal(exitStatus(result, 'enforce'), 1);
  assert.equal(overlaps(8075, ['src/a.js'], [active(42, '### Files owned\n`src/**`')]).length, 1);
  assert.equal(overlaps(8075, ['a.js'], [active(42, '### Files owned\n`*.js`')]).length, 1);
});
test('issue inventory excludes PR rows before validation and counts only actual issues', async () => {
  const result = await checkOwnership({ prNumber: 9000, api: async path => path === '/pulls/9000' ? pr : path.startsWith('/pulls/') ? [{ filename: 'src/a.js' }] : [{ number: 9001, pull_request: {} }, active(42, '### Files owned\n`src/a.js`')] });
  assert.equal(result.status, 'overlap'); assert.equal(result.scannedIssues, 1);
});
test('ambiguous task attribution is unknown before the inventory scan, without echoing the PR body', async () => {
  const result = await checkOwnership({ prNumber: 9000, api: async path => { assert.equal(path, '/pulls/9000'); return { title: 'Work #8075 or #8076', body: 'private text must not be echoed' }; } });
  assert.equal(result.status, 'unknown'); assert.match(result.note, /ambiguous/i); assert.equal(exitStatus(result, 'enforce'), 1);
  assert.doesNotMatch(renderReport(result), /private text/);
});
test('blocked claims remain outside the requested label scope and the report makes that coverage limit explicit', () => {
  assert.deepEqual(overlaps(8075, ['src/a.js'], [active(42, '### Files owned\n`src/a.js`', 'state:blocked')]), []);
  assert.match(renderReport({ status: 'clear', issue: 8075, overlaps: [] }), /blocked.*not evaluated/i);
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
  const uncertain = renderReport({ status: 'unconfirmed', issue: 8075, overlaps: [], unconfirmed: Array.from({ length: 201 }, () => ({ ...row, kind: 'name-only' })) });
  assert.equal(uncertain.split('\n').filter(l => l.startsWith('| #')).length, 200); assert.match(uncertain, /200 of 201 unconfirmed/);
});
test('a filename remains literal text instead of Markdown links, mentions or formatting', () => {
  const summary = renderReport({ status: 'overlap', issue: 8075, overlaps: [{ issue: 8075, owner: 42, file: '[name](path) @synthetic *bold* _em_ ~strike~ \\file', patterns: ['src/**'] }] });
  for (const fragment of ['[name]', '@synthetic', '*bold*', '_em_', '~strike~', '\\file']) assert.ok(!summary.includes(fragment), fragment);
  for (const encoded of ['&#91;name&#93;', '&#64;synthetic', '&#42;bold&#42;', '&#95;em&#95;', '&#126;strike&#126;', '&#92;file']) assert.ok(summary.includes(encoded), encoded);
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
