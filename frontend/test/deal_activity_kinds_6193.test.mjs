/**
 * #6193 (D6193, DL14) — the deal activity's chips: All, Mine, Deal, Documents, Diligence, in canvas order.
 * Mounted chip behaviour is in deal_frame_d1152.test.mjs beside the Mine filter's.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deal_activity_kinds_6193.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACTIVITY_FILTERS, EMPTY, activityEmpty, activityShown } from '../src/pages/deal/dealFrameModel.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('#6193 the five chips are the canvas’s, in its order', () => {
  const canvas = read('design/incoming/Investor Deal Page.dc.html');
  const drawn = /title: 'Activity on this deal', tags: \[([^\]]+)\]/.exec(canvas)[1];
  assert.deepEqual(ACTIVITY_FILTERS.map(([, t]) => t), [...drawn.matchAll(/'([^']+)'/g)].map((m) => m[1]));
});

// Mutation checked: Mine reading `kind` (fails); an unknown kind dropped from Deal (fails).
test('#6193 each chip narrows on the Worker’s kind, and an empty one never claims nothing happened', () => {
  const rows = [
    { kind: 'documents', label: 'd', mine: false }, { kind: 'diligence', label: 'g', mine: true },
    { kind: 'deal', label: 'c', mine: true }, { label: 'x', mine: false },
  ];
  const labels = (f) => activityShown(rows, f).map((e) => e.label);
  assert.deepEqual(labels('all'), ['d', 'g', 'c', 'x']);
  assert.deepEqual(labels('mine'), ['g', 'c']);
  assert.deepEqual(labels('deal'), ['c', 'x']);
  assert.deepEqual(labels('documents'), ['d']);
  assert.deepEqual(labels('diligence'), ['g']);
  assert.deepEqual(activityShown(null, 'all'), []);
  assert.equal(activityEmpty('all'), EMPTY.activity);
  for (const f of ['deal', 'documents', 'diligence']) assert.match(activityEmpty(f), /you can read is recorded/, f);
  const src = read('frontend/src/pages/deal/DealNotes.jsx');
  assert.match(src, /ACTIVITY_FILTERS\.filter\(\(\[key\]\) => mineFilter \|\| key !== 'mine'\)/, 'Mine is the Notes tab’s only');
});
