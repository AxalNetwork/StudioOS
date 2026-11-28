// In-suite mutation checks rewrite source through `_atomic_write.mjs`, so a parallel reader never imports a truncated module.
//
// Merge-queue run 43657801960 (suite worker-3-of-6) failed in a file that
// changes nothing: `captable_scenarios_d1018.test.ts` read `systemsState.ts`
// while D5065's mutation runner was rewriting it with `writeFileSync`, which
// truncates before it writes, and got "does not provide an export named
// 'SYSTEM_ACTION_LABEL'". The helper writes a temporary file beside the source
// and renames it over it. This file pins the helper's behaviour and fails if a
// suite restores a mutated file with a plain `writeFileSync(file, original)`.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileAtomic } from './_atomic_write.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const cleanups = [];
afterEach(() => { while (cleanups.length) cleanups.pop()(); });
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'atomic-write-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a reader that opened the file before the write reads the whole old copy, never a truncated one', () => {
  const dir = scratch(), file = join(dir, 'state.mjs');
  const before = "export const action = () => 'manage';\nexport const LABEL = 'Manage';\n";
  writeFileSync(file, before);
  const fd = openSync(file, 'r');
  try {
    writeFileAtomic(file, "export const action = () => 'reconnect';\n");
    // A truncate-then-write would leave this descriptor reading the new bytes (or none).
    const buffer = Buffer.alloc(Buffer.byteLength(before) + 16);
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    assert.equal(buffer.subarray(0, read).toString('utf8'), before);
  } finally { closeSync(fd); }
  assert.equal(readFileSync(file, 'utf8'), "export const action = () => 'reconnect';\n");
});

test('the replacement keeps the mode and leaves no temporary file behind', () => {
  const dir = scratch(), file = join(dir, 'tool.mjs');
  writeFileSync(file, 'old');
  chmodSync(file, 0o750);
  writeFileAtomic(file, 'new');
  assert.equal(statSync(file).mode & 0o777, 0o750);
  assert.equal(readFileSync(file, 'utf8'), 'new');
  assert.deepEqual(readdirSync(dir), ['tool.mjs']);
});

test('a file that does not exist is refused, not created', () => {
  const dir = scratch(), file = join(dir, 'missing.ts');
  assert.throws(() => writeFileAtomic(file, 'x'), { code: 'ENOENT' });
  assert.deepEqual(readdirSync(dir), []);
});

test('a failed rename removes the temporary file', () => {
  const dir = scratch(), target = join(dir, 'folder');
  // A regular file cannot be renamed over a non-empty directory, so the rename fails after the temporary write.
  mkdirSync(target);
  writeFileSync(join(target, 'child'), 'x');
  assert.throws(() => writeFileAtomic(target, 'x'));
  assert.deepEqual(readdirSync(dir), ['folder']);
});

// Every place a suite or a mutation script lives. A `*.test.*` or `*.mutations.*`
// file that restores a mutated source with `writeFileSync(<file>, original…)`
// rewrites a file others may be importing; it must use `writeFileAtomic`.
const SCANNED = ['cloudflare-worker/test', 'frontend/test', 'scripts'];
const SUITE = /\.(test|mutations)\.(m?js|ts|jsx|tsx|cjs)$/;
const RESTORE = /\bwriteFileSync\(\s*(?:[^,()]|\([^()]*\))+,\s*original\b/;
function* suites(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* suites(path);
    else if (SUITE.test(entry.name)) yield path;
  }
}

test('no suite rewrites a mutated source with a truncating writeFileSync', () => {
  const offenders = [];
  let scanned = 0;
  for (const base of SCANNED) for (const file of suites(resolve(ROOT, base))) {
    scanned += 1;
    if (file === SELF) continue; // its examples spell out the idiom it refuses
    const text = readFileSync(file, 'utf8');
    text.split('\n').forEach((line, i) => { if (RESTORE.test(line)) offenders.push(`${relative(ROOT, file)}:${i + 1}`); });
  }
  assert.ok(scanned > 100, `the scan found only ${scanned} suites; the folders moved`);
  assert.deepEqual(offenders, [], 'write mutated and restored sources with writeFileAtomic from cloudflare-worker/test/_atomic_write.mjs');
});

test('the guard pattern recognises the restore idiom it exists to refuse', () => {
  for (const line of [
    '    } finally { writeFileSync(file, original); }',
    "      writeFileSync(file, original.replace(check.before, check.after));",
    "writeFileSync(route,original.replace(before,after));result=run();",
    '    writeFileSync(join(root, check.file), original);',
  ]) assert.match(line, RESTORE, line);
  for (const line of [
    '    } finally { writeFileAtomic(file, original); }',
    "writeFileSync(p,source.replaceAll(before,after));",
    "writeFileSync(join(dir, 'x.json'), JSON.stringify(original));",
  ]) assert.doesNotMatch(line, RESTORE, line);
});
