/**
 * D7255: private-file permissions, link refusals, descriptor-bound edits and
 * CLI recovery regressions with disposable local fixtures.
 *
 * D7255 (#7255): exercise real descriptors, permissions, link replacement and
 * mutation recovery in private fixtures.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, watch, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateDirectory, regularTextFile, writePrivateFile } from '../local-files.mjs';

const roots = [];
afterEach(() => { while (roots.length) rmSync(roots.pop(), { recursive: true, force: true }); });
const fixture = () => { const root = mkdtempSync(join(tmpdir(), 'local-files-7255-')); roots.push(root); return root; };

test('private operator state has owner-only permissions even under a permissive umask', () => {
  const root = fixture(), dir = join(root, 'private');
  const before = process.umask(0);
  try {
    privateDirectory(dir);
    assert.equal(statSync(dir).mode & 0o777, 0o700);
    const path = join(dir, 'summary.json'); writePrivateFile(path, 'original', true);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.throws(() => writePrivateFile(path, 'clobbered', true), /EEXIST/);
    assert.equal(readFileSync(path, 'utf8'), 'original');
    writePrivateFile(path, 'new'); assert.equal(readFileSync(path, 'utf8'), 'new');
  } finally { process.umask(before); }
});

test('shared directories and directory symlinks are refused without changing a target', () => {
  const root = fixture(), shared = join(root, 'shared'); mkdirSync(shared); chmodSync(shared, 0o777);
  assert.throws(() => privateDirectory(shared), /must be private/);
  const owned = join(root, 'owned'); privateDirectory(owned);
  const alias = join(root, 'alias'); symlinkSync(owned, alias);
  assert.throws(() => privateDirectory(alias), /must be private/);
  assert.deepEqual(readdirSync(shared), []);
});

test('private output rejects symlinks and hard links before any truncation', () => {
  const root = fixture(), original = join(root, 'original'); writeFileSync(original, 'protected');
  const alias = join(root, 'alias'); symlinkSync(original, alias);
  assert.throws(() => writePrivateFile(alias, 'bad'));
  const hard = join(root, 'hard'); linkSync(original, hard);
  assert.throws(() => writePrivateFile(hard, 'bad'), /regular, unlinked file/);
  assert.equal(readFileSync(original, 'utf8'), 'protected');
});

test('regular text edits pin the inode through path replacement and truncate at the correct UTF-8 length', () => {
  const root = fixture(), file = join(root, 'README.md'), held = join(root, 'held'), target = join(root, 'outside');
  writeFileSync(file, 'original content'); writeFileSync(target, 'untouched');
  const original = regularTextFile(file, (text) => {
    assert.equal(text, 'original content'); renameSync(file, held); symlinkSync(target, file); return 'é';
  });
  assert.equal(original, 'original content');
  assert.equal(readFileSync(held, 'utf8'), 'é');
  assert.equal(readFileSync(target, 'utf8'), 'untouched');
  assert.throws(() => regularTextFile(file));
  assert.throws(() => regularTextFile(root), /regular local file/);
  assert.equal(regularTextFile(join(root, 'missing')), null);
});

test('the mutation CLI restores its source and recovers an interrupted run from private Git metadata', { timeout: 30000 }, async (t) => {
  const root = fixture();
  const cli = fileURLToPath(new URL('../mutation-check.mjs', import.meta.url));
  const git = (...args) => { const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  git('init', '-q'); git('config', 'user.email', 'synthetic@example.test'); git('config', 'user.name', 'Synthetic test');
  mkdirSync(join(root, 'scripts/lib'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  const source = join(root, 'scripts/probe.mjs'); writeFileSync(source, 'export const answer = 1;\n');
  writeFileSync(join(root, 'scripts/lib/probe.test.mjs'), "import {test} from 'node:test'; import assert from 'node:assert/strict'; import {answer} from '../probe.mjs'; test('answer is correct',()=>assert.equal(answer,1));\n");
  git('add', '.'); git('commit', '-qm', 'synthetic fixture');
  const spec = join(root, 'spec.json'); writeFileSync(spec, JSON.stringify([{ id: 'answer', file: 'scripts/probe.mjs', find: 'answer = 1', replace: 'answer = 2', test: 'scripts/lib/probe.test.mjs', expect: 'answer is correct' }]));
  const run = () => spawnSync(process.execPath, [cli, 'run', '--spec', spec], { cwd: root, encoding: 'utf8', timeout: 30000 });
  const state = resolve(root, git('rev-parse', '--git-path', 'studioos-mutation-check'));
  const outside = join(root, 'outside'); mkdirSync(outside); symlinkSync(outside, state);
  const refused = run(); assert.notEqual(refused.status, 0); assert.deepEqual(readdirSync(outside), []);
  rmSync(state);
  const ok = run(); assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /caught/);
  assert.equal(readFileSync(source, 'utf8'), 'export const answer = 1;\n');
  assert.equal(existsSync(state), false);

  // Interrupt a real mutant after its child has loaded the changed bytes.
  const marker = join(root, 'mutant-held');
  writeFileSync(join(root, 'scripts/lib/probe.test.mjs'), "import {test} from 'node:test'; import assert from 'node:assert/strict'; import {watch,writeFileSync} from 'node:fs'; import {answer} from '../probe.mjs'; test('answer is correct',async()=>{if(answer===2){writeFileSync('mutant-held',String(process.pid));await new Promise(()=>{watch('.',()=>{});});}assert.equal(answer,1);});\n");
  let testPid, watcher;
  const ready = new Promise((resolveReady, rejectReady) => {
    watcher = watch(root, (_event, name) => {
      if (name !== 'mutant-held') return;
      try {
        const pid = readFileSync(marker, 'utf8');
        if (!/^[1-9][0-9]*$/.test(pid)) return;
        testPid = Number(pid); watcher.close(); resolveReady();
      } catch (error) { if (error.code !== 'ENOENT') rejectReady(error); }
    });
    watcher.on('error', rejectReady);
    t.signal.addEventListener('abort', () => rejectReady(new Error('the mutation child never loaded its mutant')), { once: true });
  });
  const running = spawn(process.execPath, [cli, 'run', '--spec', spec], { cwd: root, stdio: 'ignore' });
  try {
    await ready;
    const journal = join(state, 'journal.json'), saved = JSON.parse(readFileSync(journal, 'utf8'));
    assert.equal(statSync(state).mode & 0o777, 0o700);
    assert.equal(statSync(journal).mode & 0o777, 0o600);
    assert.equal(statSync(saved.files[0].backup).mode & 0o777, 0o600);
    assert.match(readFileSync(source, 'utf8'), /answer = 2/);
    await new Promise(resolve => { running.once('exit', resolve); running.kill('SIGKILL'); });
    process.kill(testPid, 'SIGKILL'); testPid = null;
    const recovered = spawnSync(process.execPath, [cli, 'restore'], { cwd: root, encoding: 'utf8' });
    assert.equal(recovered.status, 0, recovered.stdout + recovered.stderr);
    assert.equal(readFileSync(source, 'utf8'), 'export const answer = 1;\n');
    assert.equal(existsSync(state), false);
  } finally {
    watcher.close();
    if (testPid) { try { process.kill(testPid, 'SIGKILL'); } catch { /* already exited */ } }
    if (running.exitCode === null && running.signalCode === null) running.kill('SIGKILL');
  }
});
