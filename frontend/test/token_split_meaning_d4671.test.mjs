/**
 * D4671 (#4671) — `token_split_bps` has one recipient on every surface: the
 * Licensee. The signed agreement (clause 4.3) says "{{licence.token_split}} is
 * the Licensee's share"; HQ's console used to say "to HQ".
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/token_split_meaning_d4671.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as T from '../src/lib/tokenSplit.js';
import { shareCard } from '../src/lib/licencePage.js';
import { bpsPercent } from '../src/lib/bps.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('no label, in any surface that names the split, gives it to HQ', () => {
  for (const [k, v] of Object.entries(T)) assert.doesNotMatch(v, /\bHQ\b|Licensors?/i, k);
  assert.match(T.TOKEN_SPLIT_HQ_LABEL, /Licensee/);
  assert.match(T.TOKEN_SPLIT_HISTORY_LABEL, /Licensee/);
});

test('the console, history and branch page read their labels from the one module', () => {
  const admin = read('src/pages/admin/AdminLicences.jsx');
  assert.match(admin, /\{TOKEN_SPLIT_HQ_INPUT\}/);
  assert.match(admin, /label=\{TOKEN_SPLIT_HQ_LABEL\}/);
  assert.doesNotMatch(admin, /[Tt]oken split to HQ/);
  assert.match(read('src/pages/admin/licenceHistoryModel.js'), /token_split_bps: TOKEN_SPLIT_HISTORY_LABEL/);
  assert.match(read('src/pages/subsidiary/MyLicencePage.jsx'), /r\(TOKEN_SPLIT_OWN_LABEL,/);
});

test('the branch card reads the stored number as the Licensee\'s own share, exactly', () => {
  const card = shareCard({ token_split_bps: 3501, revenue_share_bps: 2000 });
  assert.equal(card.detail, `${T.TOKEN_SPLIT_OWN_DETAIL} 35.01%`);
  assert.equal(bpsPercent(3501), '35.01%');
});

test('the agreement text agrees: the same number is the Licensee\'s share', () => {
  const tpl = read('../cloudflare-worker/src/templates/legal/subsidiary_licence_agreement_v1.md');
  assert.match(tpl, /\{\{licence\.token_split\}\} is the Licensee's share, and the rest is the Licensors'/);
});

test('the contract card offers entity completion, shows the fingerprint, and will not send while a field is open', () => {
  const page = read('src/pages/admin/AdminLicences.jsx');
  assert.match(page, /api\.licenceEntityComplete\(licence\.uid, f\)/);
  assert.match(page, /data-testid="contract-fingerprint"/);
  assert.match(page, /disabled=\{sendBusy \|\| current\.unfilled_fields\?\.length > 0\}/);
  assert.match(read('src/lib/api.js'), /licenceEntityComplete: \(uid, fields\) =>\s+request\(`\/admin\/licences\/\$\{encodeURIComponent\(uid\)\}\/entity`, \{\s+method: 'PATCH'/);
});
