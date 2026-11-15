// D6381: an import attribute must not erase live uses through a later embedded import.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { deadBindings, prepareBody } from '../../scripts/check-unused-imports.mjs';

const embeddedImport = "const generated = `\nimport { Embedded } from 'fixture';\n`;\n";

test('a default JSON import with attributes preserves real import and local uses before embedded code', () => {
  const source = [
    'import {',
    '  Used,',
    "} from 'fixture';",
    "import catalog from './fixture.json' with { type: 'json' };",
    'const { local } = catalog;',
    'Used(local);',
    embeddedImport,
  ].join('\n');
  assert.deepEqual(deadBindings(source), []);
  const body = prepareBody(source);
  assert.equal(body.length, source.length);
  assert.equal(body.split('\n').length, source.split('\n').length);
  assert.ok(body.includes('Used(local);'));
});

test('named imports with attributes retain live uses and still report unused named and local bindings', () => {
  const source = [
    'import {',
    '  kept, dropped as deadImport, type, json,',
    "} from 'fixture' with { type: 'json', fixture: '}json' };",
    'const { liveLocal, deadLocal } = kept;',
    'run(liveLocal);',
    embeddedImport,
  ].join('\n');
  assert.deepEqual(deadBindings(source), [
    { name: 'deadImport', kind: 'imported' },
    { name: 'type', kind: 'imported' },
    { name: 'json', kind: 'imported' },
    { name: 'deadLocal', kind: 'destructured' },
  ]);
});

test('side-effect imports cannot consume later declarations and uses', () => {
  const source = [
    "import { Used } from 'fixture';",
    "import './setup.mjs';",
    'const { local, deadLocal } = source;',
    'Used(local);',
    embeddedImport,
  ].join('\n');
  assert.deepEqual(deadBindings(source), [{ name: 'deadLocal', kind: 'destructured' }]);
});

test('the unchanged workflow delivery regression has no dead bindings', () => {
  const source = readFileSync(new URL('./workflow_channel_delivery_6370.test.mjs', import.meta.url), 'utf8');
  assert.deepEqual(deadBindings(source), []);
});
