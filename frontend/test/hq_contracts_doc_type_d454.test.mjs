/**
 * D454 — HQ · Contracts doc-type registry (Session 16 item 5).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import { DocTypeRegistry, groupDocTypesByLayer, UNAVAILABLE } from '../src/pages/hq/ContractsPage.jsx';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = codeOnly(raw('frontend/src/pages/hq/ContractsPage.jsx'));
const API = codeOnly(raw('frontend/src/lib/api.js'));
const ROUTE = raw('cloudflare-worker/src/routes/admin_contracts.ts');

const SAMPLE = {
  type_count: 2,
  layers: [{ id: 'gp', label: 'GP', description: 'GP layer' }],
  items: [
    { doc_type: 'operating_agreement', title: 'Operating Agreement', layer: 'gp', party_roles: ['axal'], usage_count: 3, last_used_at: '2026-01-01T00:00:00Z' },
    { doc_type: 'lpa', title: 'LPA', layer: 'fund', party_roles: ['investor', 'axal'], usage_count: 0, last_used_at: null },
  ],
};

test('groupDocTypesByLayer keeps the four layers in canvas order', () => {
  const g = groupDocTypesByLayer(SAMPLE.items, [{ id: 'fund', label: 'Fund level' }, { id: 'gp', label: 'GP level' }]);
  assert.deepEqual(g.map((x) => x.id), ['gp', 'fund']);
  assert.equal(g[0].items.length, 1);
  assert.equal(g[1].items[0].doc_type, 'lpa');
});

test('the registry renders types, parties and usage', () => {
  const html = renderToStaticMarkup(
    React.createElement(DocTypeRegistry, { data: SAMPLE, onRetry: () => {} }),
  );
  assert.match(html, /Operating Agreement/);
  assert.match(html, /operating_agreement/);
  assert.match(html, /Axal VC/);
  assert.match(html, /data-testid="hq-doc-type-registry"/);
});

test('an unreadable registry is not an empty one', () => {
  const html = renderToStaticMarkup(
    React.createElement(DocTypeRegistry, { data: UNAVAILABLE, onRetry: () => {} }),
  );
  assert.match(html, /This is not a claim that no contract types exist/);
});

test('the page wires the doc-types endpoint and names oversight honestly', () => {
  assert.match(PAGE, /api\.adminContractDocTypes\(\)/);
  assert.match(PAGE, /DocTypeRegistry/);
  assert.match(PAGE, /Cross-tenant oversight/);
  assert.match(PAGE, /Unrecorded/);
  assert.doesNotMatch(PAGE, /registry the canvas draws above it has no store/);
  assert.match(API, /adminContractDocTypes:/);
  assert.match(ROUTE, /adminContracts\.get\('\/doc-types'/);
  assert.match(ROUTE, /party_roles:/);
});
