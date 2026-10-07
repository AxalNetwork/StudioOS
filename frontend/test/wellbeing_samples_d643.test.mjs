/**
 * D643 (#1438) — the screens' half of "stop listing sample experts as real".
 *
 *   · a member whose directory holds no expert at all reads "No wellbeing
 *     experts are listed yet.", never the filters line and never a sample;
 *   · the admin roster draws "Sample" on a development seed row, and only
 *     on one.
 *
 * The Worker half (no seed in production, no sample in a member read,
 * migration 433) is `cloudflare-worker/test/wellbeing_samples_d643.test.ts`.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/wellbeing_samples_d643.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { ExpertColumn, NO_EXPERTS_LISTED } from '../src/pages/wellbeing/WellbeingBookPage.jsx';
import { WellbeingExpertName } from '../src/pages/AdminPage.jsx';
import { codeOnly } from './_codeOnly.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (el) => html(el).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();

test('an empty directory says no expert is listed yet, not that the filters matched none', () => {
  assert.equal(NO_EXPERTS_LISTED, 'No wellbeing experts are listed yet.');
  const none = text(h(ExpertColumn, { status: 'ready', experts: [], directoryEmpty: true }));
  assert.equal(none, `1 · Expert ${NO_EXPERTS_LISTED}`);
  const filtered = text(h(ExpertColumn, { status: 'ready', experts: [], directoryEmpty: false }));
  assert.match(filtered, /No expert matches these filters\. Try clearing them\./);
  assert.doesNotMatch(filtered, /listed yet/);
  // A listed expert wins over the flag: the flag only speaks to an empty list.
  const one = text(h(ExpertColumn, {
    status: 'ready', directoryEmpty: true, timeZone: 'UTC',
    experts: [{ uid: 'real1', name: 'Rae Real', categories: [], services: [] }],
  }));
  assert.match(one, /Rae Real/);
  assert.doesNotMatch(one, /listed yet/);
  // Reading and a failed read are not "none listed".
  assert.doesNotMatch(text(h(ExpertColumn, { status: 'unreadable', directoryEmpty: true, onRetry: () => {} })), /listed yet/);
});

test('the page reads "none listed" from the Worker\'s total_active, and only when it is 0', () => {
  const page = codeOnly(read('frontend/src/pages/wellbeing/WellbeingBookPage.jsx'));
  assert.match(page, /total: Number\.isFinite\(r\?\.total_active\) \? r\.total_active : null/);
  assert.match(page, /directoryEmpty=\{list\.total === 0\}/);
  // The Worker's member read counts no sample in total_active (the Worker test pins it).
  const route = read('cloudflare-worker/src/routes/wellbeing.ts');
  assert.match(route, /total_active: experts\.length/);
});

test('the admin roster marks a sample "Sample", and a real expert not', () => {
  const sample = html(h(WellbeingExpertName, { expert: { uid: 'seed_marina_lopes', name: 'Marina Lopes', headline: 'Coach', is_sample: true } }));
  assert.match(sample, /data-testid="admin-wellbeing-sample-seed_marina_lopes"[^>]*>Sample</);
  const real = html(h(WellbeingExpertName, { expert: { uid: 'real1', name: 'Rae Real', headline: 'Coach', is_sample: false } }));
  assert.doesNotMatch(real, />Sample</);
  assert.match(real, /Rae Real/);
  const panel = codeOnly(read('frontend/src/pages/AdminPage.jsx'));
  assert.match(panel, /<WellbeingExpertName expert=\{e\} \/>/, 'the roster row draws the name cell');
});
