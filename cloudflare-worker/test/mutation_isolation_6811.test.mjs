// D6811 (#6811): mutations must affect only private imports and cleanup must preserve the shared fixture checkout.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isolatedMutationSource } from './_isolated_mutation_source.mjs';

const cleanups = [];
afterEach(() => { while (cleanups.length) cleanups.pop()(); });
function fixture() {
  const parent = mkdtempSync(join(tmpdir(), 'mutation-6811-fixture-'));
  cleanups.push(() => rmSync(parent, { recursive: true, force: true }));
  const source = join(parent, 'checkout'), copies = join(parent, 'copies'); mkdirSync(copies);
  for (const path of ['cloudflare-worker/src', 'cloudflare-worker/sql', 'cloudflare-worker/test', 'frontend/src', 'scripts/lib', 'cloudflare-worker/ai-workers', 'cloudflare-worker-tail/src', 'merge-control/contract', 'agent-compute', 'meeting-bot']) mkdirSync(join(source, path), { recursive: true });
  for (const path of ['package.json', 'cloudflare-worker/package.json', 'frontend/package.json']) writeFileSync(join(source, path), '{"type":"module"}');
  writeFileSync(join(source, 'cloudflare-worker/src/state.mjs'), "export const action = () => 'manage';\n");
  writeFileSync(join(source, 'cloudflare-worker/src/record.mjs'), "export { action } from './state.mjs';\n");
  writeFileSync(join(source, 'agent-compute/failureCodes.ts'), 'export {};');
  writeFileSync(join(source, 'meeting-bot/notice.mjs'), 'export {};');
  const dependency = join(source, 'node_modules/synthetic-package/probe'); mkdirSync(dirname(dependency), { recursive: true }); writeFileSync(dependency, 'dependency bytes');
  return { source, copies };
}
function readAction(root) {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', 'const {action}=await import(process.argv[1]);process.stdout.write(action());', pathToFileURL(join(root, 'cloudflare-worker/src/record.mjs')).href], { cwd: root, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr); return child.stdout;
}

test('6811: private mutation is loaded by its child while an independent shared reader stays healthy', () => {
  const { source, copies } = fixture(), copy = isolatedMutationSource(source, copies); cleanups.push(copy.close);
  const original = join(source, 'cloudflare-worker/src/state.mjs'), mutated = join(copy.root, 'cloudflare-worker/src/state.mjs');
  assert.notEqual(copy.root, source); assert.notEqual(statSync(original).ino, statSync(mutated).ino);
  writeFileSync(mutated, "export const action = () => 'reconnect';\n");
  assert.equal(readAction(copy.root), 'reconnect'); assert.equal(readAction(source), 'manage');
  assert.equal(readFileSync(original, 'utf8'), "export const action = () => 'manage';\n");
  assert.equal(lstatSync(join(copy.root, 'node_modules')).isSymbolicLink(), true);
  assert.equal(readFileSync(join(copy.root, 'node_modules/synthetic-package/probe'), 'utf8'), 'dependency bytes');
});

test('6811: cleanup removes only the private copy, including after a failing child', () => {
  const { source, copies } = fixture(), copy = isolatedMutationSource(source, copies);
  try {
    writeFileSync(join(copy.root, 'cloudflare-worker/src/state.mjs'), "throw Error('synthetic mutant');\n");
    const child = spawnSync(process.execPath, [join(copy.root, 'cloudflare-worker/src/record.mjs')], { cwd: copy.root, encoding: 'utf8' });
    assert.notEqual(child.status, 0);
  } finally { copy.close(); }
  assert.equal(existsSync(copy.root), false); assert.deepEqual(readdirSync(copies), []);
  assert.equal(readAction(source), 'manage');
});

test('6811: an incomplete source tree refuses and removes its partial private copy', () => {
  const { source, copies } = fixture(); rmSync(join(source, 'frontend/src'), { recursive: true });
  assert.throws(() => isolatedMutationSource(source, copies), /ENOENT/);
  assert.deepEqual(readdirSync(copies), []); assert.equal(readAction(source), 'manage');
});
