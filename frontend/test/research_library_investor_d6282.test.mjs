/**
 * D6282: an investor's Library offers the kinds an investor holds — never
 * `My playbook` or `About a client` — and its Diligence chip is live. Every
 * other licence keeps its six kinds, and Benchmarks stays off with its reason.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { kindOptionsFor, hasClients } from '../src/pages/research/LibraryZone.jsx';
import { INVESTOR_ZONE_FILTERS } from '../src/workspaces/investorZoneFilters.js';
import { codeOnly } from './_codeOnly.mjs';

const values = (role, current) => kindOptionsFor(role, current).map((k) => k.value);
const LIBRARY = codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src/pages/research/LibraryZone.jsx'), 'utf8'));

test('D6282: an investor is offered Diligence and no client or playbook kind', () => {
  assert.deepEqual(values('investor'), ['document', 'report', 'primary', 'legal', 'diligence']);
  assert.deepEqual(kindOptionsFor('investor').map((k) => k.label), ['Document', 'Report', 'Primary', 'Legal', 'Diligence']);
});

test('D6282: the other licences keep exactly their six kinds', () => {
  for (const role of ['founder', 'advisor', 'partner', undefined]) {
    assert.deepEqual(values(role), ['document', 'report', 'primary', 'legal', 'playbook', 'client'], String(role));
  }
});

test('D6282: editing keeps a document’s current kind even when the licence is not offered it', () => {
  assert.deepEqual(values('investor', 'client'), ['document', 'report', 'primary', 'legal', 'diligence', 'client']);
  assert.deepEqual(values('founder', 'diligence'), ['document', 'report', 'primary', 'legal', 'playbook', 'client', 'diligence']);
  assert.deepEqual(values('investor', 'diligence'), ['document', 'report', 'primary', 'legal', 'diligence']);
  assert.deepEqual(values('investor', 'benchmark'), ['document', 'report', 'primary', 'legal', 'diligence']);
});

test('D6282: both kind pickers read the licence, and the Diligence chip filters on the kind', () => {
  assert.equal((LIBRARY.match(/kindOptionsFor\(role(, document\.kind)?\)\.map\(/g) || []).length, 2);
  assert.doesNotMatch(LIBRARY, /\{KINDS\.map\(/);
  assert.match(LIBRARY, /\['client', 'playbook', 'report', 'primary', 'legal', 'diligence'\]\.includes\(filter\)/);
  assert.match(LIBRARY, /<DocumentMetadata document=\{d\} onSaved=\{load\} role=\{role\} \/>/);
});

test('D6282: the investor Library has no client wording', () => {
  assert.equal(hasClients('investor'), false);
  for (const role of ['founder', 'advisor', 'partner']) assert.equal(hasClients(role), true, role);
  assert.match(LIBRARY, /\{hasClients\(role\) && <StatedLimit title="What a shared document does and does not do">/);
  assert.match(LIBRARY, /housekeeping\.\{hasClients\(role\) && ' A document a client opened to you/);
  assert.match(LIBRARY, /body=\{hasClients\(role\)\s*\?/);
});

test('D6282: Diligence is a live chip; Benchmarks and Stale stay off with their reasons', () => {
  const chips = Object.fromEntries(INVESTOR_ZONE_FILTERS['research/library'].map((c) => [c.canvas, c]));
  assert.deepEqual([chips.Diligence.key, chips.Diligence.unbuilt], ['diligence', undefined]);
  assert.match(chips.Benchmarks.unbuilt, /a benchmark is a row in Benchmarking/);
  assert.match(chips.Stale.unbuilt, /age alone does not record whether a source is stale/);
});
