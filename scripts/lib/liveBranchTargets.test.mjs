import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { liveBranchTargets } from '../check-branch-live.mjs';

const example = JSON.parse(readFileSync(new URL('../../infra/branches/_example.json', import.meta.url), 'utf8'));
const branch = (code, id) => ({ file: `${code}.json`, entry: {
  ...structuredClone(example), code, hostname: `${code}.axal.vc`, status: 'live',
  ids: { d1: `00000000-0000-4000-8000-${id.padStart(12, '0')}`, kv_tokens: `${id}1`.padStart(32, '0'), kv_rate_limits: `${id}2`.padStart(32, '0') },
} });

test('an example-only checkout is a blocker, not a passing zero-target run', () => {
  assert.throws(() => liveBranchTargets([{ file: '_example.json', entry: example }], null), /No live or provisioning/);
});

test('plans only declared branch hosts and includes provisioning targets', () => {
  const fr = branch('fr', '1');
  const de = branch('de', '2'); de.entry.status = 'provisioning';
  assert.deepEqual(liveBranchTargets([fr, de], null), [
    { code: 'fr', host: 'https://fr.axal.vc' }, { code: 'de', host: 'https://de.axal.vc' },
  ]);
  assert.deepEqual(liveBranchTargets([fr, de], null, 'de'), [{ code: 'de', host: 'https://de.axal.vc' }]);
});

test('rejects unknown, suspended, HQ, URL and option selections', () => {
  const fr = branch('fr', '1');
  for (const code of ['hq', 'https://fr.axal.vc', '--remote']) {
    assert.throws(() => liveBranchTargets([fr], null, code), /Select a branch code/);
  }
  assert.throws(() => liveBranchTargets([fr], null, 'de'), /No declaration/);
  fr.entry.status = 'suspended';
  assert.throws(() => liveBranchTargets([fr], null, 'fr'), /suspended/);
});

test('refuses storage shared between branches or with HQ before any request', () => {
  const fr = branch('fr', '1'); const de = branch('de', '2');
  de.entry.ids.d1 = fr.entry.ids.d1;
  assert.throws(() => liveBranchTargets([fr, de], null, 'fr'), /shares a d1 resource/);
  de.entry.ids.d1 = branch('de', '2').entry.ids.d1;
  de.entry.ids.kv_tokens = fr.entry.ids.kv_rate_limits;
  assert.throws(() => liveBranchTargets([fr, de], null), /shares a kv resource/);
  assert.throws(() => liveBranchTargets([fr], new Set([fr.entry.ids.d1])), /HQ/);
});

test('refuses a declared hostname that points away from its branch', () => {
  const fr = branch('fr', '1'); fr.entry.hostname = 'app.axal.vc';
  assert.throws(() => liveBranchTargets([fr], null), /hostname/);
});
