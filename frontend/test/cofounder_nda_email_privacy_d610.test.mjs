/**
 * D610 (#1310) — Co-founder matching: Connections tab renders notice when
 * the counterparty's email is withheld until both parties sign the NDA.
 *
 * Run with:
 *   node --test frontend/test/cofounder_nda_email_privacy_d610.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = read('frontend/src/pages/CofounderPage.jsx');

test('CofounderPage renders "Shown once you have both signed the NDA" when counterparty email is withheld', () => {
  assert.match(PAGE, /Shown once you have both signed the NDA/);
  assert.match(PAGE, /!cp\.email\s*&&\s*<span[^>]*>Shown once you have both signed the NDA<\/span>/);
});
