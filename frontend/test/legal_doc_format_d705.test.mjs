// D705 (#1716) — the admin preview's mirror of legalDocFormat names the Fund
// Axal VC Spin-Out Lab Fund I LP, signs each Axal party under its own title,
// has the Fund sign through its general partner, and routes the same slugs as
// the worker. PaperPreview draws the capacity line.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AXAL_ENTITIES,
  AXAL_SIGNATORY_NAME,
  AXAL_SIGNATORY_TITLE,
  axalEntityKeyForDoc,
  buildExecutionBlock,
  buildPreamble,
} from '../src/lib/legalDocFormat.js';
import PaperPreview from '../src/components/PaperPreview.jsx';

const FUND_SIGNS = [
  'subscription', 'investor_subscription_pro', 'investor_subscription_inst', 'subscription booklet & lpa',
  'co-investment side letter', 'safe', 'term_sheet', 'spa', 'voting_rights',
];
const STAYS_GP = [
  'lpa', 'ppm', 'mgmt_company', 'carried_interest', 'investor_nda_axal', 'accreditation_v1',
  'spv joinder agreement', 'strategic side letter / focused spv', 'secondary purchase agreement',
];

/** The string literals of one `const NAME = new Set([...])` in a source file. */
function setLiterals(file, name) {
  const src = readFileSync(new URL(file, import.meta.url), 'utf8');
  const at = src.indexOf(`const ${name} = new Set([`);
  assert.ok(at >= 0, `${name} in ${file}`);
  const body = src.slice(at, src.indexOf(']);', at));
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
}

test('D705: the mirror routes the same nine slugs to the Fund as the worker does', () => {
  for (const s of FUND_SIGNS) assert.equal(axalEntityKeyForDoc(s), 'fund', s);
  for (const s of STAYS_GP) assert.equal(axalEntityKeyForDoc(s), 'gp', s);
  assert.deepEqual(
    setLiterals('../src/lib/legalDocFormat.js', 'FUND_SIGNS_D705'),
    setLiterals('../../cloudflare-worker/src/services/legalDocFormat.ts', 'FUND_SIGNS_D705'),
  );
  assert.deepEqual(setLiterals('../src/lib/legalDocFormat.js', 'FUND_SIGNS_D705'), [...FUND_SIGNS].sort());
});

test('D705: the mirror names the Fund and signs each party under its own title', () => {
  assert.equal(AXAL_ENTITIES.fund.name, 'Axal VC Spin-Out Lab Fund I LP');
  assert.ok(buildPreamble({ documentTitle: 'SAFE', axalEntityKey: 'fund' })
    .includes('Axal VC Spin-Out Lab Fund I LP, a Delaware limited partnership, acting by its general partner Axal VC GP LLC'));
  const axal = (key) => buildExecutionBlock({ kind: 'agreement', axalEntityKey: key }).parties.find((p) => p.role === 'axal');
  const fund = axal('fund');
  assert.deepEqual([fund.heading, fund.through, fund.name, fund.title], [
    'Axal VC Spin-Out Lab Fund I LP', 'By: Axal VC GP LLC, its general partner', `Name: ${AXAL_SIGNATORY_NAME}`, 'Title: General Partner',
  ]);
  assert.equal(axal('gp').title, 'Title: General Partner');
  assert.equal(axal('gp').through, undefined);
  assert.equal(axal('management').title, 'Title: Managing Partner');
  assert.equal(AXAL_SIGNATORY_TITLE, 'Managing Partner');
});

test('D705: PaperPreview draws the Fund\'s capacity line on a subscription, and none on a Management document', () => {
  const sub = renderToStaticMarkup(createElement(PaperPreview, { title: 'Subscription Agreement', body: 'The Investor subscribes.', docType: 'subscription' }));
  assert.ok(sub.includes('Axal VC Spin-Out Lab Fund I LP'));
  assert.ok(sub.includes('By: Axal VC GP LLC, its general partner'));
  assert.ok(sub.includes('Title: General Partner'));
  assert.ok(sub.indexOf('By: Axal VC GP LLC, its general partner') < sub.indexOf('By: ___'), 'the capacity line precedes the signature line');
  const mgmt = renderToStaticMarkup(createElement(PaperPreview, { title: 'Mentor Agreement', body: 'The Mentor advises.', docType: 'mentor_nda_axal' }));
  assert.ok(mgmt.includes('Title: Managing Partner'));
  assert.ok(!mgmt.includes('its general partner'));
});

test('D705: no code or named page prints the old fund name', () => {
  for (const f of [
    '../src/lib/legalDocFormat.js', '../src/brand/gvpn.ts', '../src/pages/TeamPage.jsx',
    '../src/pages/templates/InvestorDealflowHomePage.jsx', '../src/pages/RiskDisclosuresPage.jsx',
    '../../cloudflare-worker/src/services/legalDocFormat.ts', '../../cloudflare-worker/src/routes/esign.ts',
    '../../README.md', '../../documentation/architecture/LEGAL_ENTITIES.md',
  ]) assert.equal(readFileSync(new URL(f, import.meta.url), 'utf8').includes('Axal VC Fund I, LP'), false, f);
});
