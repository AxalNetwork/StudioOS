import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadInventory, renderInventory, withInventory } from '../../scripts/workflow-inventory.mjs';

test('the README workflow table and merge queue listener list match the YAML', () => {
  const workflows = loadInventory();
  assert.ok(workflows.some(workflow => workflow.file === 'ci.yml'));
  const readme = readFileSync(new URL('../../.github/workflows/README.md', import.meta.url), 'utf8');
  const expected = withInventory(readme, renderInventory(workflows));
  assert.ok(readme === expected, 'Run node scripts/workflow-inventory.mjs --write to update the generated inventory.');
  const tableFiles = [...readme.matchAll(/^\| `([^\n`]+\.ya?ml)` \|/gm)].map(([, file]) => file);
  assert.deepEqual(tableFiles, workflows.map(workflow => workflow.file));
});
