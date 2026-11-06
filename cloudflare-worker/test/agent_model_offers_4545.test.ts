// #4545 — Team's model picker receives the same member-billed token rates as
// the catalogue, without inventing a value where a unit is absent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { agentModels } from '../src/services/agents/modelOffers.ts';

test('agent model offers expose member-billed input and output token prices', () => {
  const models = agentModels({} as any, { id: 1, role: 'admin', is_super_admin: 1, subscription_tier: 'growth', subscription_status: 'active' } as any);
  const phone = models.find((m) => m.id === '@cf/daily-co/phonellm-mini-alpha-2');
  assert.ok(phone);
  assert.equal(phone.input_usd_per_million, 0.07500625);
  assert.equal(phone.output_usd_per_million, 0.2999975);
  assert.ok(models.every((m) => Object.hasOwn(m, 'input_usd_per_million') && Object.hasOwn(m, 'output_usd_per_million')));
});
