/**
 * #5363 — a zone whose read is refused with 403 `advisor_licence_required`
 * shows the licence sentence and no Try again; any other failure keeps its
 * own sentence and Try again. One mounted zone per surface: Expertise
 * (Services, read through `usePagedList`) and Practice (Opportunities).
 *
 * Synthetic data only; the api import is swapped for a stub that throws.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/advisor_licence_refusal_5363.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { h, mountForm, sourceModule } from './_form_d695.mjs';
import { LICENCE_SENTENCES, isLicenceSentence, zoneError } from '../src/pages/advisor/expertise/licenceRefusal.js';

const STUB = 'export const control = { code: null };\n'
  + 'const refusal = () => { const e = new Error("Synthetic refusal text that must not be shown"); if (control.code) e.code = control.code; throw e; };\n'
  + 'const api = new Proxy({}, { get: () => async () => refusal() });\n';

async function zoneWithStub(path) {
  const src = readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
  const swapped = src.replace(/^import \{ api \} from '..\/..\/..\/lib\/api';\n/m, STUB);
  assert.notEqual(swapped, src, `${path}: the api import was swapped`);
  return sourceModule(swapped, path);
}

async function mounted(module, code) {
  module.control.code = code;
  const f = await mountForm(h(module.default)); // mountForm supplies the router
  await f.flush();
  const text = f.text();
  await f.unmount();
  return text;
}

test('zoneError reads the code, never the message', () => {
  assert.equal(zoneError({ code: 'advisor_licence_required', message: 'x' }, 'Fallback.'), LICENCE_SENTENCES.expertise);
  assert.equal(zoneError({ code: 'advisor_licence_required' }, 'Fallback.', 'practice'), LICENCE_SENTENCES.practice);
  assert.equal(zoneError({ code: 'advisor_profile_missing' }, 'Fallback.'), 'Fallback.');
  assert.equal(zoneError(null, 'Fallback.'), 'Fallback.');
  assert.ok(isLicenceSentence(LICENCE_SENTENCES.practice));
  assert.ok(!isLicenceSentence('Fallback.'));
});

for (const [surface, path, other] of [
  ['Expertise', 'pages/advisor/expertise/ServicesZone.jsx', 'Your services could not be read.'],
  ['Practice', 'pages/advisor/practice/OpportunitiesZone.jsx', 'Synthetic refusal text'],
]) {
  test(`${surface}: the licence refusal renders the licence sentence and no Try again`, async () => {
    const module = await zoneWithStub(path);
    // The zone's own card. Services also draws its add-service form above it,
    // whose suggestion line has a retry of its own; that is not the zone's.
    const refused = await mounted(module, 'advisor_licence_required');
    const card = refused.slice(refused.indexOf('Advisor licence'));
    assert.ok(refused.includes('Advisor licence'), refused.slice(0, 400));
    assert.ok(card.includes(LICENCE_SENTENCES[surface.toLowerCase()]), card);
    assert.ok(!card.includes('Try again'), `no retry for a licence refusal: ${card}`);
    assert.ok(!refused.includes('Synthetic refusal text'), 'never the thrown text');
    assert.ok(!refused.includes('This did not load'));

    const failed = await mounted(module, null);
    const failedCard = failed.slice(failed.indexOf('Source unavailable'));
    assert.ok(failed.includes('Source unavailable'), failed.slice(0, 400));
    assert.ok(failedCard.includes(other), failedCard);
    assert.ok(failedCard.includes('Try again'), 'any other failure keeps its retry');
    assert.ok(!failed.includes('needs the Advisor licence'));
  });
}
