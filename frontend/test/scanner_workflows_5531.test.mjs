/** D5531 part 2: run trusted-base bootstrap against a hostile checkout and retain scan/gate policy. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const scannerFiles = ['install-scanner.mjs', 'scanner-acquisition.mjs', 'scanner-tools.json'];
const ci = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const fast = ci.slice(ci.indexOf('\n  fast:\n'), ci.indexOf('\n  landing:\n'));
const callers = [
  { name: 'standalone Gitleaks', tool: 'gitleaks', source: await readFile(new URL('../../.github/workflows/gitleaks.yml', import.meta.url), 'utf8') },
  { name: 'fast Gitleaks', tool: 'gitleaks', source: fast },
  { name: 'CodeQL', tool: 'codeql', source: await readFile(new URL('../../.github/workflows/codeql.yml', import.meta.url), 'utf8') },
];
function step(source, name) {
  const block = source.split(/^ {6}- /m).find(s => s.startsWith(`name: ${name}\n`));
  assert.ok(block, `missing ${name}`); return block;
}
function bootstrap(source) {
  const run = step(source, 'Load trusted scanner installer').match(/^ {8}run: \|\n((?:^ {10}.*\n)+)/m);
  assert.ok(run, 'the trusted bootstrap is an inspectable shell step');
  return run[1].replace(/^ {10}/gm, '');
}
async function fixture(t, missing = false) {
  const root = await mkdtemp(join(tmpdir(), 'scanner-wiring-5531-')); t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'checkout'), temporary = join(root, 'runner'); await mkdir(join(repo, 'scripts/ci'), { recursive: true }); await mkdir(temporary);
  const git = async (...args) => (await execute('git', ['-C', repo, ...args])).stdout.trim();
  await git('init', '-q'); await git('config', 'user.name', 'Synthetic scanner fixture'); await git('config', 'user.email', 'scanner@example.invalid');
  for (const file of scannerFiles) if (!missing || file !== 'scanner-tools.json') {
    await writeFile(join(repo, 'scripts/ci', file), await readFile(new URL(`../../scripts/ci/${file}`, import.meta.url)));
  }
  await git('add', '.'); await git('commit', '-qm', 'trusted acquisition base'); const base = await git('rev-parse', 'HEAD');
  const marker = join(root, 'pr-installer-executed');
  await writeFile(join(repo, 'scripts/ci/install-scanner.mjs'), `import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(marker)},'untrusted');`);
  if (missing) await writeFile(join(repo, 'scripts/ci/scanner-tools.json'), await readFile(new URL('../../scripts/ci/scanner-tools.json', import.meta.url)));
  await git('add', '.'); await git('commit', '-qm', 'hostile PR installer'); const head = await git('rev-parse', 'HEAD');
  const output = join(root, 'output');
  const env = { ...process.env, EVENT: 'pull_request', PR_BASE: base, GROUP_BASE: '', MAIN_SHA: head, REF: 'refs/pull/1/merge', RUNNER_TEMP: temporary, GITHUB_OUTPUT: output };
  return { root, repo, temporary, base, head, marker, output, env };
}

for (const caller of callers) {
  test(`${caller.name}: bootstrap ignores a hostile PR checkout and uses its trusted base pins`, async t => {
    const f = await fixture(t);
    await execute('bash', ['-c', bootstrap(caller.source)], { cwd: f.repo, env: f.env });
    const output = await readFile(f.output, 'utf8');
    assert.match(output, new RegExp(`scanner-linux-x64-${caller.tool}-${caller.tool === 'gitleaks' ? '8\\.21\\.2' : '2\\.27\\.3'}-`));
    await assert.rejects(readFile(f.marker), { code: 'ENOENT' });
    for (const file of scannerFiles) assert.equal(await readFile(join(f.temporary, 'trusted-scanner-installer', file), 'utf8'), await readFile(new URL(`../../scripts/ci/${file}`, import.meta.url), 'utf8'));
  });
  test(`${caller.name}: missing trusted base or missing trusted installer file fails closed`, async t => {
    const f = await fixture(t, true);
    await assert.rejects(execute('bash', ['-c', bootstrap(caller.source)], { cwd: f.repo, env: { ...f.env, PR_BASE: '' } }));
    await assert.rejects(readFile(f.output), { code: 'ENOENT' });
    await assert.rejects(execute('bash', ['-c', bootstrap(caller.source)], { cwd: f.repo, env: f.env }));
    await assert.rejects(readFile(f.marker), { code: 'ENOENT' });
  });
  test(`${caller.name}: exact archive cache is restored before acquisition and saved on trusted main only`, () => {
    const restore = step(caller.source, `Restore pinned ${caller.tool} archive`);
    const save = step(caller.source, `Save verified ${caller.tool} archive on main only`);
    assert.match(restore, /actions\/cache\/restore@[a-f0-9]{40}/);
    assert.match(restore, /path: \$\{\{ steps\.scanner_pins\.outputs\.cache-file \}\}/);
    assert.match(restore, /key: \$\{\{ steps\.scanner_pins\.outputs\.key \}\}/);
    assert.doesNotMatch(restore, /restore-keys:/);
    assert.match(save, /github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
    assert.match(save, /\.outcome == 'success'/);
    assert.match(save, /actions\/cache\/save@[a-f0-9]{40}/);
    const install = caller.tool === 'gitleaks' ? 'Install gitleaks' : 'Acquire verified CodeQL bundle';
    assert.ok(caller.source.indexOf(`name: Restore pinned ${caller.tool}`) < caller.source.indexOf(`name: ${install}`));
    assert.match(step(caller.source, install), new RegExp(`run: node "\\$\\{\\{ steps\\.scanner_pins\\.outputs\\.installer \\}\\}" ${caller.tool}`));
  });
}

test('CodeQL consumes the verified local archive for both original languages and retains scan policy', () => {
  const source = callers.find(c => c.tool === 'codeql').source;
  assert.match(step(source, 'Initialize CodeQL'), /tools: \$\{\{ steps\.acquire_tools\.outputs\.archive \}\}/);
  for (const language of ['javascript-typescript', 'python']) assert.match(source, new RegExp(`language: ${language}`));
  assert.match(source, /queries: security-extended,security-and-quality/);
  assert.match(source, /timeout-minutes: 60/);
  assert.match(source, /security-events: write/);
  assert.doesNotMatch(source, /continue-on-error:/);
});
