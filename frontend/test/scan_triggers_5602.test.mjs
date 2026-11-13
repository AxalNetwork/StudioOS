/** D5602: run real scan admission/artifact/alert paths on synthetic data; deliberately break their gates. */
import test from 'node:test';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import * as policy from '../../scripts/lib/scanScope.mjs';
import { prepareState, previousState, selectScope, verifyArtifactRead } from '../../scripts/scan-scope.mjs';

const root = process.cwd();
const read = file => readFileSync(resolve(root, file), 'utf8');
const paths = ['cloudflare-worker/sql/migrations/x.sql', 'cloudflare-worker/src/auth.ts',
  'cloudflare-worker/src/middleware/authz.ts', '.github/workflows/x.yml', 'wrangler.toml', 'wrangler-preview.toml',
  'package.json', 'frontend/package.json', 'cloudflare-worker/package-lock.json', 'apps/yarn.lock',
  'apps/pnpm-lock.yaml', 'infra/.terraform.lock.hcl', 'apps/deno.lock', 'nix/flake.lock', 'tools/uv.lock', 'Pipfile.lock', 'nested/bun.lockb', '.semgrepignore',
  'scripts/sarif-summary.py', 'scripts/strip-suppressed-sarif.py', 'scripts/scan-fingerprints.py'];
function scopeChecks(m) {
  for (const event of ['push', 'schedule']) assert.equal(m.scanScope({ event, files: ['README.md'] }), true);
  for (const path of paths) assert.equal(m.scanScope({ event: 'pull_request', files: [path] }), true, path);
  assert.equal(m.scanScope({ event: 'pull_request', files: ['documentation/guide.md', 'README.md'] }), false);
  assert.equal(m.scanScope({ event: 'pull_request', files: ['README.md'], labels: [{ name: 'security-scan' }] }), true);
  assert.equal(m.scanScope({ event: 'pull_request', files: [{ filename: 'notes.md', previous_filename: '.github/old.yml' }] }), true);
  assert.equal(m.scanScope({ event: 'pull_request', files: ['README.md'], truncated: true }), true);
  assert.equal(m.scanScope({ event: 'pull_request', files: Array(3000).fill('README.md') }), true);
  assert.equal(m.scanScope({ event: 'pull_request' }), true);
  assert.equal(m.scanScope({ event: 'pull_request', files: [null] }), true);
  assert.equal(m.scanScope({ event: 'merge_group', files: paths }), false);
}
test('main/weekly, every sensitive path, labels, old rename paths and incomplete inventories have explicit scope', () => scopeChecks(policy));

const finding = (rule, file, extra = {}) => ({ ruleId: rule, locations: [{ physicalLocation: { artifactLocation: { uri: file } } }], ...extra });
const snapshot = results => policy.findingSnapshot([{ runs: [{ results }] }]);
const first = () => snapshot([finding('js/one', 'private/synthetic.ts')]);
const second = () => snapshot([finding('js/two', 'other/synthetic.ts')]);

test('fingerprints preserve rule/file identity, deduplicate locations and exclude suppressions/messages/lines', () => {
  const rows = snapshot([finding('js/one', 'private/synthetic.ts', { message: { text: 'Do not publish this excerpt' } }),
    finding('js/one', 'private/synthetic.ts'), finding('js/hidden', 'secret.ts', { suppressions: [{ kind: 'inSource' }] }),
    finding('__proto__', 'awkward.ts')]);
  assert.equal(rows.length, 2);
  assert.equal(rows.find(row => row.rule === 'js/one').fingerprint, first()[0].fingerprint);
  assert.equal(policy.ruleCounts(rows).__proto__, 1);
  assert.doesNotMatch(JSON.stringify(rows), /private\/synthetic|secret\.ts|Do not publish/);
  assert.throws(() => snapshot([finding('rule', '')]));
  assert.throws(() => policy.findingSnapshot([]));
  assert.throws(() => policy.findingSnapshot([{ runs: [{}] }]));
});

test('baseline bootstraps silently; newly introduced fingerprints persist until resolved, without reopening old findings', () => {
  const a = first(), b = second();
  const initial = policy.advanceScan(a, null);
  assert.equal(initial.baseline, false); assert.deepEqual(initial.open, []);
  const introduced = policy.advanceScan([...a, ...b], initial);
  assert.deepEqual(introduced.open, b);
  const repeated = policy.advanceScan([...a, ...b], introduced);
  assert.deepEqual(repeated.open, b);
  assert.deepEqual(policy.advanceScan(a, repeated).open, []);
  assert.throws(() => policy.advanceScan(a, { version: 999, current: [], open: [] }));
  assert.throws(() => policy.advanceScan(a, { version: 1, current: [], open: [{ fingerprint: 'invalid', rule: 'x' }] }));
});

test('corrupt public incident state is unknown instead of a clean scanner', () => {
  const body = policy.scanAlertBody({ codeql: { scanner: 'codeql', baseline: true, runUrl: 'https://github.com/synthetic/repo/actions/runs/20', counts: { 'js/one': 1 } } });
  assert.throws(() => policy.readScanAlert(body.replace('| `js/one` | 1 |', '| js/one | invalid |')));
  assert.throws(() => policy.readScanAlert('<!-- studioos-scan-alert:v1 -->\n'));
});

function workflowChecks(codeql, semgrep) {
  for (const [name, text] of [['codeql', codeql], ['semgrep', semgrep]]) {
    const triggers = text.slice(text.indexOf('on:'), text.indexOf('permissions:'));
    assert.match(triggers, /push:\n\s+branches: \["?main"?\]/, name);
    assert.match(triggers, /types: \[opened, synchronize, reopened, labeled\]/, name);
    assert.match(triggers, /schedule:[\s\S]*cron:/, name);
    assert.doesNotMatch(triggers, /paths:|merge_group|pull_request_target|workflow_run/, name);
    assert.match(text, /needs: \[scope, visibility\]\n    if: needs.scope.outputs.scan == 'true'/, name);
    assert.match(text, /run: node scripts\/scan-scope.mjs scope/, name);
    assert.match(text, /run: node scripts\/scan-scope.mjs verify-artifact-read/, name);
    assert.match(text, /name: main scan findings[\s\S]*if: github.event_name == 'push' && github.ref == 'refs\/heads\/main'/, name);
    assert.match(text, /group: scan-main-findings\n      cancel-in-progress: false/, name);
    assert.match(text, /actions: read\n      issues: write/, name);
    assert.match(text, /retention-days: 90/, name);
    assert.equal((text.match(/include-hidden-files: true/g) || []).length, 2, 'snapshot and state folders both begin with a dot');
  }
  assert.match(semgrep, /group: semgrep-\$\{\{ github.event_name \}\}-\$\{\{ github.ref \}\}\n  cancel-in-progress: \$\{\{ github.event_name == 'pull_request' \}\}/);
}
test('both workflow gates preserve main/weekly coverage, PR supersession and main-only serialized alert effects', () => {
  workflowChecks(read('.github/workflows/codeql.yml'), read('.github/workflows/semgrep.yml'));
  assert.match(read('.github/labels.yml'), /name: "security-scan"/);
});

test('bounded JSON reads resist a size-check race and close the descriptor on every outcome', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'scan-json-race-5602-'));
  const file = join(dir, 'event.json');
  const small = JSON.stringify({ number: 42, pull_request: { labels: [], changed_files: 1 } });
  const large = JSON.stringify({ number: 42, pull_request: { labels: [{ name: 'security-scan' }] } }) + ' '.repeat(8 * 1024 * 1024);
  const env = { GITHUB_EVENT_PATH: file, GITHUB_EVENT_NAME: 'pull_request', GITHUB_REPOSITORY: 'synthetic/repo', GITHUB_RUN_ID: '20' };
  const original = { readFile: fs.readFileSync, read: fs.readSync, open: fs.openSync, close: fs.closeSync };
  const active = new Set();
  let race = true;
  let bytesRead = 0;
  fs.readFileSync = (path, ...args) => {
    // Replace the payload at the old path-read boundary, after its size check.
    if (race && path === file) writeFileSync(file, large);
    return original.readFile(path, ...args);
  };
  fs.openSync = (path, ...args) => {
    const fd = original.open(path, ...args);
    if (path === file) active.add(fd);
    return fd;
  };
  fs.readSync = (fd, ...args) => {
    const count = original.read(fd, ...args);
    if (active.has(fd)) bytesRead += count;
    return count;
  };
  fs.closeSync = fd => { active.delete(fd); return original.close(fd); };
  syncBuiltinESMExports();
  try {
    writeFileSync(file, small);
    assert.equal(await selectScope(env, async () => [{ filename: 'README.md' }]), false, 'a stale size check must not admit the replacement payload');
    race = false;
    writeFileSync(file, small + ' '.repeat(8 * 1024 * 1024 - Buffer.byteLength(small)));
    assert.equal(await selectScope(env, async () => [{ filename: 'README.md' }]), false, 'a valid payload at the byte limit remains readable');
    writeFileSync(file, large);
    bytesRead = 0;
    await assert.rejects(selectScope(env), /exceeds its size bound/);
    assert.ok(bytesRead <= 8 * 1024 * 1024 + 1, 'the read itself stops at the limit plus one byte');
    writeFileSync(file, '{');
    await assert.rejects(selectScope(env), SyntaxError);
    assert.equal(active.size, 0, 'success, oversize and malformed JSON all close their descriptor');
  } finally {
    fs.readFileSync = original.readFile; fs.readSync = original.read; fs.openSync = original.open; fs.closeSync = original.close;
    syncBuiltinESMExports();
    for (const fd of active) original.close(fd);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the effects reader inventories all PR pages, scans API caps/under-counts and fails on unreadable inventories', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'scope-5602-'));
  try {
    const file = join(dir, 'event.json');
    writeFileSync(file, JSON.stringify({ number: 42, pull_request: { labels: [], changed_files: 101 } }));
    const env = { GITHUB_EVENT_PATH: file, GITHUB_EVENT_NAME: 'pull_request', GITHUB_REPOSITORY: 'synthetic/repo', GITHUB_RUN_ID: '20' };
    let pages = 0;
    assert.equal(await selectScope(env, async path => { pages++; return path.endsWith('page=1') ? Array(100).fill({ filename: 'doc.md' }) : [{ filename: 'cloudflare-worker/sql/new.sql' }]; }), true);
    assert.equal(pages, 2);
    assert.equal(await selectScope(env, async () => [{ filename: 'README.md' }]), true, 'payload says the API inventory is incomplete');
    assert.equal(await selectScope(env, async () => Array(100).fill({ filename: 'README.md' })), true, '3000-file cap scans');
    await assert.rejects(selectScope(env, async () => { throw Error('Unavailable'); }));
    writeFileSync(file, JSON.stringify({ pull_request: { number: 42, labels: [{ name: 'security-scan' }] } }));
    assert.equal(await selectScope(env, async () => { throw Error('must not need files for a label override'); }), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('artifact proof redeems a different main run with actions:read, follows no signed URL and rejects denied access', async () => {
  const env = { GITHUB_REPOSITORY: 'synthetic/repo', GITHUB_RUN_ID: '20', GH_TOKEN: 'synthetic-token' };
  const api = async path => path.includes('/artifacts?') ? { artifacts: [{ id: 100, expired: false }] } : { workflow_runs: [{ id: 19 }] };
  let calls = 0;
  await verifyArtifactRead(env, api, async (url, init) => {
    calls++; assert.match(url, /\/artifacts\/100\/zip$/); assert.equal(init.redirect, 'manual');
    assert.equal(init.headers.authorization, 'Bearer synthetic-token'); return { status: 302 };
  });
  assert.equal(calls, 1);
  await assert.rejects(verifyArtifactRead(env, api, async () => ({ status: 403 })));
});

function stateApi({ prior = true, artifact = true, incident = null } = {}) {
  return async path => {
    if (path.endsWith('/actions/runs/20')) return { head_branch: 'main', event: 'push', workflow_id: 9 };
    if (path.includes('/workflows/9/runs?')) return { workflow_runs: prior ? [{ id: 19, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success' }] : [] };
    if (path.includes('/actions/runs/19/artifacts')) return { artifacts: artifact ? [{ name: 'scan-state-codeql', size_in_bytes: 1000, expired: false }] : [] };
    if (path.includes('/issues?')) return incident ? [incident] : [];
    throw Error('Unexpected synthetic API path: ' + path);
  };
}
const ctx = { scanner: 'codeql', repo: 'synthetic/repo', runId: 20, runUrl: 'https://github.com/synthetic/repo/actions/runs/20' };
test('main artifact comparison fences repository/run/scanner and never mistakes a lost incident baseline for recovery', async () => {
  const a = first(), b = second();
  const previous = { ...policy.advanceScan(a, null), repository: ctx.repo, scanner: 'codeql', run_id: 19 };
  const next = await prepareState({ ...ctx, current: [...a, ...b], readApi: stateApi(), download: async () => previous });
  assert.deepEqual(next.state.open, b); assert.deepEqual(next.facts.counts, { 'js/two': 1 });
  await assert.rejects(prepareState({ ...ctx, current: a, readApi: stateApi(), download: async () => ({ ...previous, repository: 'other/tenant' }) }));
  assert.equal(await previousState({ ...ctx, workflowId: 9, readApi: stateApi({ artifact: false }), download: async () => { throw Error('not called'); } }), null);
  const facts = { scanner: 'codeql', baseline: true, counts: { 'js/two': 1 }, runUrl: ctx.runUrl };
  const incident = { title: policy.SCAN_ALERT_TITLE, body: policy.scanAlertBody({ codeql: facts }) };
  const lost = await prepareState({ ...ctx, current: a, readApi: stateApi({ artifact: false, incident }), download: async () => previous });
  assert.equal(lost.state.history_unknown, true); assert.equal(lost.facts.baseline, false);
  const stillUnknown = await prepareState({ ...ctx, current: a, readApi: stateApi(), download: async () => ({ ...lost.state, run_id: 19 }) });
  assert.equal(stillUnknown.facts.baseline, false);
  await assert.rejects(prepareState({ ...ctx, current: a, readApi: async () => ({ head_branch: 'feature', event: 'pull_request' }) }));
});

function child(args, env) {
  return new Promise((resolveChild, reject) => {
    const p = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; p.stdout.on('data', b => { output += b; }); p.stderr.on('data', b => { output += b; });
    p.on('error', reject); p.on('exit', code => resolveChild({ code, output }));
  });
}
test('actual alert CLI opens once, adds the second scanner, preserves its findings and closes only after both clear', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'scan-alert-5602-'));
  const issues = [], calls = [];
  const server = createServer(async (req, res) => {
    let input = ''; for await (const chunk of req) input += chunk;
    const body = input ? JSON.parse(input) : null; calls.push({ method: req.method, url: req.url, body });
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET') return res.end(JSON.stringify(issues.filter(i => i.state === 'open')));
    if (req.method === 'POST') { issues.push({ ...body, number: 100, state: 'open' }); return res.end(JSON.stringify(issues[0])); }
    if (req.method === 'PATCH') {
      if (Object.hasOwn(body, 'body')) issues[0].body = body.body;
      if (Object.hasOwn(body, 'state')) issues[0].state = body.state;
      if (Object.hasOwn(body, 'state_reason')) issues[0].state_reason = body.state_reason;
      return res.end(JSON.stringify(issues[0]));
    }
    res.statusCode = 400; res.end('{}');
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const file = join(dir, 'facts.json');
  const send = async (scanner, counts, baseline = true) => {
    writeFileSync(file, JSON.stringify({ scanner, counts, baseline, runUrl: ctx.runUrl }));
    const result = await child(['scripts/github-alerts.mjs', 'scan'], { GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`, GITHUB_TOKEN: 'synthetic-only', GITHUB_REPOSITORY: ctx.repo, SCAN_FACTS_FILE: file, SLACK_GITHUB_WEBHOOK_URL: '' });
    assert.equal(result.code, 0); assert.doesNotMatch(result.output, /warning/i, result.output);
  };
  try {
    await send('codeql', { 'js/one': 1 }, false); assert.equal(calls.length, 0);
    const denied = await child(['scripts/github-alerts.mjs', 'scan'], { GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`, GITHUB_TOKEN: '', GITHUB_REPOSITORY: ctx.repo, SCAN_FACTS_FILE: file, SLACK_GITHUB_WEBHOOK_URL: '' });
    assert.deepEqual({ code: denied.code, calls: calls.length }, { code: 1, calls: 0 }, 'scan reporting retains main’s shared missing-token refusal');
    await send('codeql', {}); assert.equal(issues.length, 0);
    await send('codeql', { 'js/one': 1 }); assert.equal(issues.length, 1);
    await send('codeql', { 'js/one': 1 }); assert.equal(issues.length, 1);
    await send('semgrep', { 'py/two': 2 });
    await send('codeql', {}); assert.equal(issues[0].state, 'open', 'the other scanner still has an unresolved incident');
    assert.deepEqual(policy.readScanAlert(issues[0].body).semgrep.counts, Object.assign(Object.create(null), { 'py/two': 2 }));
    assert.doesNotMatch(issues[0].body, /synthetic\.ts|Do not publish|[a-f0-9]{64}/);
    await send('semgrep', {}); assert.equal(issues[0].state, 'closed');
    assert.equal(calls.filter(c => c.method === 'POST').length, 1);
  } finally { await new Promise(done => server.close(done)); rmSync(dir, { recursive: true, force: true }); }
});

test('mutations of sensitive paths, scope overrides, incident retention and supersession must fail the checks', async () => {
  const source = read('scripts/lib/scanScope.mjs');
  const changes = [
    ["path.startsWith('cloudflare-worker/sql/')", 'false'],
    ["path === 'cloudflare-worker/src/auth.ts'", 'false'],
    ["path.startsWith('cloudflare-worker/src/middleware/')", 'false'],
    ["path.startsWith('.github/')", 'false'],
    ['LOCKFILE.test(path)', 'false'],
    ["'scripts/sarif-summary.py', ", ''],
    ["label?.name) === 'security-scan'", "label?.name) === 'never'"],
    ['truncated || !Array.isArray(files)', 'false || !Array.isArray(files)'],
  ];
  for (const [before, after] of changes) {
    assert.ok(source.includes(before), before);
    const broken = await import('data:text/javascript;base64,' + Buffer.from(source.replace(before, after)).toString('base64'));
    assert.throws(() => scopeChecks(broken), 'must kill ' + before);
  }
  const brokenState = await import('data:text/javascript;base64,' + Buffer.from(source.replace(' || outstanding.has(row.fingerprint)', '')).toString('base64'));
  const initial = policy.advanceScan(first(), null), introduced = policy.advanceScan([...first(), ...second()], initial);
  assert.notDeepEqual(brokenState.advanceScan([...first(), ...second()], introduced).open, second(), 'dropping retention must break repeat handling');
  const c = read('.github/workflows/codeql.yml'), s = read('.github/workflows/semgrep.yml');
  assert.throws(() => workflowChecks(c, s.replace("cancel-in-progress: ${{ github.event_name == 'pull_request' }}", 'cancel-in-progress: false')));
});


test('Semgrep fingerprints run in Python without Node in the scanner and match the shared opaque contract',()=>{
 const dir=mkdtempSync(join(tmpdir(),'scan-python-5602-')),input=join(dir,'input.sarif'),output=join(dir,'snapshot.json');
 const result=(rule,uri,more={})=>({ruleId:rule,locations:[{physicalLocation:{artifactLocation:{uri}}}],...more});
 const sarif={runs:[{results:[result('rule.one','private/path.ts'),result('rule.one','private/path.ts'),result('rule.two','unicode/é.ts'),result('ignored','secret.ts',{suppressions:[{kind:'inSource'}]})]}]};
 const run=()=>spawnSync('python3',['scripts/scan-fingerprints.py',input,output],{cwd:root,env:{...process.env,GITHUB_REPOSITORY:'AxalNetwork/StudioOS',GITHUB_RUN_ID:'123'},encoding:'utf8'});
 try{
  writeFileSync(input,JSON.stringify(sarif));const good=run();assert.equal(good.status,0,good.stderr);
  const actual=JSON.parse(readFileSync(output,'utf8'));assert.deepEqual(actual.current,policy.findingSnapshot([sarif]));assert.equal(actual.scanner,'semgrep');assert.equal(actual.run_id,123);assert.doesNotMatch(JSON.stringify(actual),/private|unicode|secret/);
  for(const bad of [{runs:[]},{runs:[{}]},{runs:[{results:[{ruleId:'rule'}]}]}]){writeFileSync(input,JSON.stringify(bad));assert.notEqual(run().status,0);assert.throws(()=>policy.findingSnapshot([bad]));}
  writeFileSync(input,JSON.stringify(sarif));
  const source=read('scripts/scan-fingerprints.py');
  for(const [before,after] of [["rule + '\\0' + uri","rule + uri"],["if isinstance(result.get('suppressions'), list) and result['suppressions']:","if False:"]]){
   assert.ok(source.includes(before));const broken=join(dir,'mutated.py');writeFileSync(broken,source.replace(before,after));
   const r=spawnSync('python3',[broken,input,output],{env:{...process.env,GITHUB_REPOSITORY:'AxalNetwork/StudioOS',GITHUB_RUN_ID:'123'},encoding:'utf8'});assert.equal(r.status,0,r.stderr);
   assert.throws(()=>assert.deepEqual(JSON.parse(readFileSync(output,'utf8')).current,policy.findingSnapshot([sarif])),'fingerprint/suppression mutations must fail parity');
  }
  const workflow=read('.github/workflows/semgrep.yml'),scan=workflow.slice(workflow.indexOf('  scan:\n'),workflow.indexOf('  findings:\n'));
  assert.doesNotMatch(scan,/actions\/setup-node|run: node /);assert.match(scan,/scripts\/scan-fingerprints\.py/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
