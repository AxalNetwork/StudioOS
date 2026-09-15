/**
 * Crunchbase marketplace status + enrichment mapping.
 *
 * The Integrations card was parked as coming_soon even though connect,
 * /api/crunchbase/*, and ProjectDetail already called the live Basic API.
 * These assertions pin the unpark (beta) and the field mapping used when
 * a snapshot is applied to a project.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { REGISTRY, getDescriptor } from '../src/integrations/registry.ts';
import { mapToProjectFields, shapeOrg, type CrunchbaseSnapshot } from '../src/integrations/providers/crunchbase.ts';

test('Crunchbase is beta (connectable), not coming_soon', () => {
  const cb = getDescriptor('crunchbase');
  assert.ok(cb, 'crunchbase is in the registry');
  assert.equal(cb.status, 'beta');
  assert.equal(cb.auth_type, 'api_key');
  assert.equal(cb.tier, 'growth');
  assert.deepEqual(cb.capabilities, [
    'Company enrichment',
    'Funding history',
    'Competitor lookup',
  ]);
});

test('Carta and DocuSign are beta (connectable OAuth), not coming_soon', () => {
  const carta = getDescriptor('carta');
  assert.ok(carta, 'carta is in the registry');
  assert.equal(carta.status, 'beta');
  assert.equal(carta.auth_type, 'oauth2');
  assert.equal(carta.tier, 'studio');
  assert.deepEqual(carta.capabilities, [
    'Cap-table sync',
    'Stakeholder import',
    'Securities import',
  ]);

  const ds = getDescriptor('docusign');
  assert.ok(ds, 'docusign is in the registry');
  assert.equal(ds.status, 'beta');
  assert.equal(ds.auth_type, 'oauth2');
  assert.equal(ds.tier, 'studio');
  assert.deepEqual(ds.capabilities, [
    'Send envelopes',
    'Webhook on signed',
    'Template library',
  ]);
});

test('Salesforce and Affinity stay coming_soon', () => {
  for (const key of ['salesforce', 'affinity']) {
    const d = getDescriptor(key);
    assert.ok(d, `${key} is in the registry`);
    assert.equal(d.status, 'coming_soon', `${key} should remain waitlisted`);
  }
});

test('registry lists crunchbase exactly once', () => {
  const hits = REGISTRY.filter((p) => p.key === 'crunchbase');
  assert.equal(hits.length, 1);
});

test('shapeOrg + mapToProjectFields denormalize Basic org fields onto the project', () => {
  const snap = shapeOrg({
    uuid: 'org-uuid',
    identifier: { uuid: 'org-uuid', permalink: 'acme', value: 'Acme', image_url: null },
    properties: {
      short_description: 'Widgets',
      website: { value: 'https://acme.test' },
      founded_on: { value: '2019-04-01' },
      location_identifiers: [{ value: 'San Francisco' }],
      categories: [{ value: 'SaaS' }],
      category_groups: [{ value: 'Software' }],
      operating_status: 'active',
      num_employees_enum: 'c_00011_00050',
      funding_total: { value_usd: 12_500_000 },
      last_funding_type: 'series_a',
      last_funding_at: { value: '2024-01-15' },
    },
  });
  assert.equal(snap.name, 'Acme');
  assert.equal(snap.cb_url, 'https://www.crunchbase.com/organization/acme');
  const auto = mapToProjectFields(snap);
  assert.equal(auto.founded_year, 2019);
  assert.equal(auto.hq, 'San Francisco');
  assert.equal(auto.employee_count, 'c_00011_00050');
  assert.equal(auto.last_funding_round, 'series_a (2024-01-15)');
  assert.equal(auto.total_funding, 12_500_000);
});

test('mapToProjectFields handles a sparse snapshot', () => {
  const sparse: CrunchbaseSnapshot = {
    uuid: 'x',
    permalink: null,
    name: 'Unknown',
    image_url: null,
    short_description: null,
    website: null,
    linkedin: null,
    founded_on: null,
    hq_location: null,
    categories: [],
    category_groups: [],
    operating_status: null,
    company_type: null,
    employee_range: null,
    funding_total_usd: null,
    equity_funding_total_usd: null,
    num_funding_rounds: null,
    last_funding_type: null,
    last_funding_at: null,
    rank: null,
    cb_url: '',
    fetched_at: '2026-09-10T00:00:00.000Z',
  };
  assert.deepEqual(mapToProjectFields(sparse), {
    founded_year: null,
    hq: null,
    employee_count: null,
    last_funding_round: null,
    total_funding: null,
  });
});
