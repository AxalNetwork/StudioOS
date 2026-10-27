/** D1315 (#2418): structure_with_studioos is listed as structure_with_axalvc; the old name still calls it and stays the stored name. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { registeredTools, toolAliases } from '../src/mcp/server.ts';
import { METERING_POLICY, toolOperation } from '../src/services/metering.ts';

test('only the new name is listed; the old one is an alias of it, never listed', () => {
  const names = registeredTools().map((t) => t.name);
  assert.ok(names.includes('structure_with_axalvc'));
  // Mutation checked: list the old name too → this fails.
  assert.ok(!names.includes('structure_with_studioos'));
  const aliases = toolAliases(registeredTools());
  assert.equal(aliases.get('structure_with_studioos'), 'structure_with_axalvc');
  // Every other tool keeps its name and has no alias.
  assert.deepEqual([...aliases.keys()], ['structure_with_studioos']);
});

test('an alias that collides with a listed name is ignored, so a rename can never shadow a tool', () => {
  const tools: any[] = [{ name: 'a', aliases: ['b'] }, { name: 'b' }];
  assert.equal(toolAliases(tools).has('b'), false);
});

test('stored values do not move: the ledger, the call log and the price keep structure_with_studioos', () => {
  const tool = registeredTools().find((t) => t.name === 'structure_with_axalvc')!;
  assert.equal(tool.storedAs, 'structure_with_studioos');
  assert.ok(toolOperation('structure_with_studioos') in METERING_POLICY.operations);
  assert.ok(!(toolOperation('structure_with_axalvc') in METERING_POLICY.operations), 'no second price under the new name');
});
