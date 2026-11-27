/**
 * D590 (#1217) — /incorporate/cofounder-agreement stays, as D352's default.
 * Removing either route, or any of the four links, fails this test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel) => readFileSync(resolve(process.cwd(), rel), 'utf8');

function routeLine(app, path) {
  const line = app.split('\n').find((l) => l.includes(`path="${path}"`));
  assert.ok(line, `${path} is not routed`);
  return line;
}

function agreementRoute(startup) {
  const m = startup.match(/export function cofounderAgreementRoute\(user\) \{([\s\S]*?)\n\}/);
  assert.ok(m, 'cofounderAgreementRoute is gone');
  return new Function('user', m[1]);
}

test('both routes stay, with the roles D352 recorded', () => {
  const app = read('frontend/src/App.jsx');
  const lab = routeLine(app, '/spinout-lab/cofounder-agreement');
  assert.match(lab, /element=\{guard\(labRoles\(\['admin'\]\), <SpinoutLabCofounderAgreementPage \/>\)\}/);
  const wizard = routeLine(app, '/incorporate/cofounder-agreement');
  assert.match(wizard, /element=\{guard\(labRoles\(\['admin', 'founder', 'partner'\]\), <CofounderAgreementPage \/>\)\}/);
  assert.doesNotMatch(wizard, /Navigate/);
});

test('cofounderAgreementRoute sends Lab accounts to the Lab page and everyone else to the wizard', () => {
  const go = agreementRoute(read('frontend/src/pages/SpinoutLabStartupPage.jsx'));
  const lab = '/spinout-lab/cofounder-agreement';
  const wizard = '/incorporate/cofounder-agreement';
  assert.equal(go({ role: 'admin' }), lab);
  assert.equal(go({ role: 'founder', spinout_lab_active: 1 }), lab);
  assert.equal(go({ role: 'partner', spinout_lab_active: 1 }), lab);
  assert.equal(go({ role: 'exploring', spinout_lab_active: 1 }), lab);
  assert.equal(go({ role: 'founder', spinout_lab_active: 0 }), wizard);
  assert.equal(go({ role: 'founder' }), wizard);
  assert.equal(go({ role: 'partner' }), wizard);
  assert.equal(go({ role: 'investor' }), wizard);
  assert.equal(go(null), wizard);
});

test('the four links still name the wizard, and the Lab card was not swapped in', () => {
  const startup = read('frontend/src/pages/SpinoutLabStartupPage.jsx');
  assert.match(startup, /to: cofounderAgreementRoute\(user\), testid: 'readiness-cofounder-agreement'/);
  assert.match(startup, /to=\{cofounderAgreementRoute\(user\)\}/);

  const legal = read('frontend/src/pages/LegalEnginePage.jsx');
  const founders = legal.slice(legal.indexOf("id: 'founders'"), legal.indexOf("id: 'compliance'"));
  assert.match(founders, /title: 'Founders & Agreements'/);
  assert.match(founders, /requiredTier: 'studio'/);
  assert.match(founders, /Component: CofounderAgreementPage,/);
  assert.doesNotMatch(founders, /SpinoutLab/);
  assert.match(legal, /import CofounderAgreementPage from '\.\/CofounderAgreementPage'/);

  const esign = read('cloudflare-worker/src/services/esignOriginators.ts');
  const offered = esign.slice(esign.indexOf("name: 'Co-founder Agreement'"), esign.indexOf("name: 'Co-founder Agreement'") + 400);
  assert.match(offered, /instead: \{ path: '\/incorporate\/cofounder-agreement', label: 'Open the Co-founder Agreement' \}/);

  const placement = read('frontend/src/lib/adminPlacement.js');
  assert.match(placement, /page\('More', 'Co-Founder Agreement', '\/incorporate\/cofounder-agreement', 'Founder agreement drafting\.'\)/);
});

test('D590 records that the route stays', () => {
  const d = read('documentation/architecture/decisions/D590.md');
  assert.match(d, /^## D590 — \S/m);
  assert.match(d, /\/incorporate\/cofounder-agreement` stays/);
  assert.match(d, /D352/);
  assert.match(d, /partners/);
  assert.match(d, /No route changes/);
});
