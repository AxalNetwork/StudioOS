/**
 * D590 (#1217) — Spin-Out Lab: /incorporate/cofounder-agreement is retained
 * (D352's stated default, matching #1209).
 *
 * Guard test pinning both routes, their persona permissions, and all
 * inbound links across the platform.
 *
 * Run with:
 *   node --test frontend/test/cofounder_agreement_retention_d590.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

const APP = read('frontend/src/App.jsx');
const STARTUP_PAGE = read('frontend/src/pages/SpinoutLabStartupPage.jsx');
const LEGAL_ENGINE = read('frontend/src/pages/LegalEnginePage.jsx');
const ESIGN_ORIGINATORS = read('cloudflare-worker/src/services/esignOriginators.ts');
const ADMIN_PLACEMENT = read('frontend/src/lib/adminPlacement.js');

test('App.jsx registers both co-founder agreement routes with appropriate persona guards', () => {
  // /incorporate/cofounder-agreement admits admins, founders and partners
  assert.match(
    APP,
    /<Route\s+path="\/incorporate\/cofounder-agreement"\s+element=\{guard\(labRoles\(\['admin',\s*'founder',\s*'partner'\]\),\s*<CofounderAgreementPage\s*\/>\)\}/,
    '/incorporate/cofounder-agreement must remain mounted and admit admin, founder, partner',
  );

  // /spinout-lab/cofounder-agreement admits admins and active Lab members
  assert.match(
    APP,
    /<Route\s+path="\/spinout-lab\/cofounder-agreement"\s+element=\{guard\(labRoles\(\['admin'\]\),\s*<SpinoutLabCofounderAgreementPage\s*\/>\)\}/,
    '/spinout-lab/cofounder-agreement must remain mounted for Lab members/admins',
  );
});

test('SpinoutLabStartupPage cofounderAgreementRoute branches between Lab and standalone wizard', () => {
  // cofounderAgreementRoute must be exported and route correctly based on admin / spinout_lab_active
  assert.match(STARTUP_PAGE, /export function cofounderAgreementRoute\(user\)/);
  assert.match(STARTUP_PAGE, /user\?\.role === 'admin' \|\| user\?\.spinout_lab_active === 1/);
  assert.match(STARTUP_PAGE, /'\/?spinout-lab\/cofounder-agreement'/);
  assert.match(STARTUP_PAGE, /'\/?incorporate\/cofounder-agreement'/);
});

test('LegalEnginePage Founders & Agreements card embeds CofounderAgreementPage', () => {
  // Card 'founders' embeds CofounderAgreementPage under the Studio tier gate
  assert.match(LEGAL_ENGINE, /id:\s*'founders'/);
  assert.match(LEGAL_ENGINE, /to:\s*'\/raise\/legal-engine\/founders'/);
  assert.match(LEGAL_ENGINE, /Component:\s*CofounderAgreementPage/);
});

test('esignOriginators links NOT_OFFERED to /incorporate/cofounder-agreement', () => {
  assert.match(
    ESIGN_ORIGINATORS,
    /path:\s*'\/incorporate\/cofounder-agreement',\s*label:\s*'Open the Co-founder Agreement'/,
    'Send for Signature NOT_OFFERED must point to standalone cofounder agreement wizard',
  );
});

test('adminPlacement catalog lists /incorporate/cofounder-agreement', () => {
  assert.match(
    ADMIN_PLACEMENT,
    /page\('More',\s*'Co-Founder Agreement',\s*'\/incorporate\/cofounder-agreement'/,
    'Admin placement catalog must retain cofounder agreement link',
  );
});
