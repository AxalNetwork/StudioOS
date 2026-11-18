/** D5531: actual archive/cache/executable recovery, fail-closed integrity and pinned CLI metadata. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { archiveName, digest, installScanner } from '../../scripts/ci/scanner-acquisition.mjs';

const execute = promisify(execFile);
const cli = new URL('../../scripts/ci/install-scanner.mjs', import.meta.url).pathname;
async function fixture(t, name, binaryVersion) {
  const root = await mkdtemp(join(tmpdir(), 'scanner-5531-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const version = name === 'gitleaks' ? '8.21.2' : '2.27.3';
  const content = join(root, 'content');
  const target = name === 'gitleaks' ? 'gitleaks' : 'codeql/codeql';
  await mkdir(join(content, name === 'gitleaks' ? '' : 'codeql'), { recursive: true });
  await writeFile(join(content, target), `#!/bin/sh\nif [ "$1" = version ]; then printf '%s\\n' '${binaryVersion || version}'; else printf 'scanned:%s\\n' "$*"; fi\n`, { mode: 0o700 });
  const source = join(root, 'release.tar.gz');
  await execute('tar', ['-czf', source, '-C', content, target]);
  const tool = { name, version, url: `https://github.com/example/scanner/releases/download/v${version}/release.tar.gz`, sha256: await digest(source) };
  const options = { tool, platform: 'linux', arch: 'x64', cacheDir: join(root, 'cache'), workDir: join(root, 'jobs'), sleep: async () => {} };
  const download = (_url, destination) => copyFile(source, destination);
  const install = overrides => installScanner({ ...options, download, ...overrides });
  const scan = async installed => {
    let binary = installed.binary;
    if (!binary) {
      await execute('tar', ['-xzf', installed.archive, '-C', installed.directory]);
      binary = join(installed.directory, target);
    }
    const languages = name === 'codeql' ? ['javascript-typescript', 'python'] : ['commit-range'];
    for (const language of languages) assert.match((await execute(binary, ['scan', language])).stdout, new RegExp(`scanned:scan ${language}`));
  };
  return { root, content, target, source, tool, options, install, scan };
}

for (const name of ['gitleaks', 'codeql']) {
  test(`${name}: healthy cold acquisition and later offline cache both reach scanning`, async t => {
    const f = await fixture(t, name);
    const first = await f.install();
    await f.scan(first);
    let remoteCalls = 0;
    const second = await f.install({ download: async () => { remoteCalls++; throw Error('host unavailable'); } });
    await f.scan(second);
    assert.equal(remoteCalls, 0, 'a verified version-matched local archive needs no release host');
    assert.notEqual(first.directory, second.directory, 'executables never reuse a prior job directory');
  });
  test(`${name}: bounded outage recovery completes scanning after the host recovers`, async t => {
    const f = await fixture(t, name);
    let attempts = 0; const delays = [];
    const result = await f.install({ download: async (_url, destination) => {
      if (++attempts < 3) { await writeFile(destination, 'partial response'); throw Error('504'); }
      await copyFile(f.source, destination);
    }, sleep: async delay => { delays.push(delay); } });
    await f.scan(result);
    assert.equal(attempts, 3); assert.deepEqual(delays, [5000, 10000]);
  });
  test(`${name}: no usable copy and an exhausted release host fail acquisition before scanning`, async t => {
    const f = await fixture(t, name); let calls = 0;
    await assert.rejects(f.install({ download: async () => { calls++; throw Error('504'); } }), new RegExp(`${name} ${f.tool.version}: acquisition exhausted after 5 attempts; scan did not start`));
    assert.equal(calls, 5); assert.deepEqual(await readdir(f.options.workDir), []);
  });
  test(`${name}: poisoned cache cannot supply executable bytes and a corrupt download is refused`, async t => {
    const f = await fixture(t, name); await mkdir(f.options.cacheDir);
    const marker = join(f.root, 'untrusted-executed');
    await writeFile(join(f.content, f.target), `#!/bin/sh\ntouch '${marker}'\nprintf '%s\\n' '${f.tool.version}'\n`, { mode: 0o700 });
    const poison = join(f.root, 'poison.tar.gz');
    await execute('tar', ['-czf', poison, '-C', f.content, f.target]);
    await copyFile(poison, join(f.options.cacheDir, archiveName(f.tool)));
    let downloads = 0;
    await assert.rejects(f.install({ download: async (_url, destination) => { downloads++; await copyFile(poison, destination); } }), /acquisition integrity check failed/);
    assert.equal(downloads, 1); assert.deepEqual(await readdir(f.options.workDir), []);
    await assert.rejects(readFile(marker), { code: 'ENOENT' }, 'no unverified executable ran, even when it claimed the right version');
    const recovered = await f.install(); await f.scan(recovered);
    assert.equal(await digest(join(f.options.cacheDir, archiveName(f.tool))), f.tool.sha256);
  });
  test(`${name}: a cache swapped during copying is reverified before extraction`, async t => {
    const f = await fixture(t, name); await f.install(); let remoteCalls = 0;
    const installed = await f.install({ copyArchive: async (_source, destination) => writeFile(destination, 'swapped bytes'), download: async (_url, destination) => { remoteCalls++; await copyFile(f.source, destination); } });
    await f.scan(installed);
    assert.equal(remoteCalls, 1, 'the swapped copy is refused and replaced by a verified release');
  });
}

test('unsupported runners refuse before a transfer; Gitleaks must report its pinned version', async t => {
  const f = await fixture(t, 'gitleaks', '0.0.0');
  await assert.rejects(f.install({ platform: 'darwin', download: async () => assert.fail('unsupported runner must not download') }), /acquisition unsupported on darwin/);
  await assert.rejects(f.install(), /gitleaks 8.21.2: acquisition version check failed/);
});

test('CLI metadata uses reviewed pins and performs no acquisition despite caller version overrides', async t => {
  const root = await mkdtemp(join(tmpdir(), 'scanner-metadata-5531-')); t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'output');
  await execute(process.execPath, [cli, 'gitleaks', '--metadata'], { env: { ...process.env, RUNNER_TEMP: root, GITHUB_OUTPUT: output, GITLEAKS_VERSION: '0.0.0', SCANNER_URL: 'https://untrusted.invalid/tool' } });
  assert.match(await readFile(output, 'utf8'), /gitleaks-8\.21\.2-5bc41815076e6ed6ef8fbecc9d9b75bcae31f39029ceb55da08086315316e3ba/);
  assert.deepEqual(await readdir(root), ['output']);
});
