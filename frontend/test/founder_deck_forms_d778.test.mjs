/**
 * D778 part 5 (#2103) — the pitch deck's form fills through the run path. A press
 * sends its own option with the run (`X-Rail-Option`), keeping the mounted rail's
 * page; a fill comes back as a proposal, kept card by card, so nothing is written
 * before Keep.
 *
 * D898 group E (#2676) retired the template builder these were first wired in. A
 * template is started from New deck (`NewDeck.jsx`), which this file reads.
 * #4734: the studio's "draft from project" component (`form:deck`) was unmounted
 * by D1604 and is removed, with its rail option and its press tests. The API
 * method and the Worker's autofill route stay, and the method's headers are still
 * tested below.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/founder_deck_forms_d778.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { api } from '../src/lib/api.js';
import { railPressHeaders } from '../src/lib/railPage.js';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';

test('a template start is New deck\'s: the press headers, its own option', () => {
  const newDeck = codeOnly(readFileSync(new URL('../src/pages/raise/pitch/NewDeck.jsx', import.meta.url), 'utf8'));
  assert.match(newDeck, /const RAIL = \{ outline: 'deck:outline', build: 'deck:build', template: 'form:deck-template' \};/);
  assert.match(newDeck, /api\.deckApplyMethod\(projectId, start\.id, railPressHeaders\(RAIL\.template\)\)/);
});

test('the existing API methods send the press\'s headers on the request itself', async () => {
  // Mutation checked: drop `headers` from either method → its request carries no option.
  const restore = installDocument();
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => { seen.push({ url: String(url), init }); return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    await api.deckApplyMethod(7, 'yc_seed', railPressHeaders('form:deck-template'));
    await api.deckAutofill(10, railPressHeaders('form:deck'));
    const apply = seen.find((s) => s.url.endsWith('/decks/apply-method'));
    const fill = seen.find((s) => s.url.endsWith('/decks/10/autofill'));
    assert.equal(apply.init.headers['X-Rail-Option'], 'form%3Adeck-template');
    assert.deepEqual(JSON.parse(apply.init.body), { project_id: 7, method_id: 'yc_seed' });
    assert.equal(fill.init.headers['X-Rail-Option'], 'form%3Adeck');
  } finally { globalThis.fetch = realFetch; restore(); }
});
