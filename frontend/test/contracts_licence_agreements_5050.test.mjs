/**
 * D5050 (#5050) — a licence agreement's row in Contracts: its context without opening it, its legal state
 * (the document's), and its deep links. A draft has no envelope, so it says so and opens on its licence.
 * Every reference and name is synthetic.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/contracts_licence_agreements_5050.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { AgreementContextCell } from '../src/pages/admin/contracts/AgreementList.jsx';
import {
  AGREEMENT_TYPE_OPTIONS, LEGAL_STATUS_OPTIONS, PACKAGE_OPTIONS, PROGRAM_OPTIONS, agreementContextLine, agreementTemplateLine,
} from '../src/lib/contractAgreements.js';

const render = (agreement) => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(AgreementContextCell, { agreement })));
const schedule = {
  agreement_type: 'program_schedule_addendum', agreement_type_label: 'Program schedule / addendum', licence_uid: 'lic_1', licence_ref: 'AXL-001',
  territory: ['FR'], program_name: 'Spin-Out Lab', package_name: null, package_version: null, template_slug: 'program_schedule', template_version: null,
  legal_status: 'executed', legal_status_label: 'Executed', is_current: true, document_available: true, document_reason: null,
  links: { licence: '/admin/licences/lic_1', program_access: '/admin/licences/programs/studio/lic_1', package: null, package_reason: null },
};
const packageDraft = {
  ...schedule, agreement_type: 'package', agreement_type_label: 'Package agreement', program_name: null, package_name: 'Venture Building',
  package_version: 2, template_slug: 'package_venture_building_master', template_version: 3, legal_status: 'draft', legal_status_label: 'Draft',
  document_available: false, document_reason: 'Not sent: there is no envelope or signed document yet.',
  links: { licence: '/admin/licences/lic_1', program_access: null, package: null, package_reason: 'There is no package page yet (#5021 builds the package store).' },
};

test('D5050 a row carries its licence, territory and program without being opened', () => {
  assert.equal(agreementContextLine(schedule), 'Program schedule / addendum · AXL-001 · FR · Spin-Out Lab');
  assert.equal(agreementContextLine(packageDraft), 'Package agreement · AXL-001 · FR · Venture Building · v2');
  assert.equal(agreementTemplateLine(packageDraft), 'package_venture_building_master v3');
  assert.equal(agreementContextLine(null), null);
  const html = render(schedule);
  assert.match(html, /Program schedule \/ addendum · AXL-001 · FR · Spin-Out Lab/);
  assert.match(html, /href="\/admin\/licences\/lic_1"[^>]*>Open licence/);
  assert.match(html, /href="\/admin\/licences\/programs\/studio\/lic_1"[^>]*>Open Program access/);
  assert.match(html, /<span class="font-semibold">Executed<\/span>/);
  assert.doesNotMatch(html, /history/);
});

test('D5050 a draft reads Draft and says it has no document; a package with no page says Not recorded', () => {
  const html = render(packageDraft);
  assert.match(html, /<span class="font-semibold">Draft<\/span>/);
  assert.match(html, /Not sent: there is no envelope or signed document yet\./);
  assert.match(html, /Not recorded.*no package page yet/s);
  assert.doesNotMatch(html, /Open Program access/);
  assert.doesNotMatch(html, /Executed/);
  // A superseded version is history.
  assert.match(render({ ...schedule, legal_status: 'superseded', legal_status_label: 'Superseded', is_current: false }), /Superseded<\/span> · history/);
  assert.equal(render(null), '');
});

test('D5050 the filter choices are the Worker\'s values', () => {
  // The Worker is the authority (services/contractAgreementSources.ts, services/agreementTemplates.ts).
  const sources = readFileSync('cloudflare-worker/src/services/contractAgreementSources.ts', 'utf8');
  const listOf = (name) => [...sources.match(new RegExp(`export const ${name} = \\[([^\\]]+)\\]`))[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(AGREEMENT_TYPE_OPTIONS.map(([v]) => v).filter(Boolean), listOf('AGREEMENT_TYPES'));
  assert.deepEqual(LEGAL_STATUS_OPTIONS.map(([v]) => v).filter(Boolean), listOf('LEGAL_STATUSES'));
  const templates = readFileSync('cloudflare-worker/src/services/agreementTemplates.ts', 'utf8');
  const packages = [...templates.slice(templates.indexOf('export const PACKAGES')).split('];')[0].matchAll(/key: '([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(PACKAGE_OPTIONS.map(([v]) => v).filter(Boolean), packages);
  assert.ok(PROGRAM_OPTIONS.some(([v]) => v === 'spinout-lab'));
});
