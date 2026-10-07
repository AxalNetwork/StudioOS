/**
 * D588 — the scoring page's share sheet says what the link shows and hides
 * before it exists, and the link is shown once.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel) => readFileSync(resolve(process.cwd(), rel), 'utf8');
const page = read('frontend/src/pages/SpinoutLabScoringPage.jsx');
const sheet = read('frontend/src/components/spinout/LabReportShareSheet.jsx');
const openPage = read('frontend/src/pages/LabReportSharePage.jsx');
const worker = read('cloudflare-worker/src/services/labReportShare.ts');
const api = read('frontend/src/lib/api.js');
const index = read('cloudflare-worker/src/index.ts');

const SENTENCES = [
  'The latest official total score and its tier.',
  'Dimension scores, the inputs behind them, notes, and who scored it.',
  'The latest official total, its tier, and the six dimension scores.',
  'The raw inputs, notes, and who scored it.',
];

test('the share button names why it is off, and the sheet is the D588 copy', () => {
  assert.doesNotMatch(page, /needs a share link/);
  assert.match(page, /Share — no project/);
  assert.match(page, /Share — run a scoring run first/);
  assert.match(page, /LabReportShareSheet/);
  assert.match(page, /disabled=\{!project \|\| !vm\.hasData\}/);
  for (const sentence of SENTENCES) {
    assert.match(worker, new RegExp(sentence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(sheet, new RegExp(sentence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(sheet, /data-testid="lab-report-share-once"/);
  assert.match(sheet, /I agree to share this official scoring report/);
  assert.doesNotMatch(sheet, /item\.token/);
  assert.match(api, /export \* from '\.\/api\/labReportShares\.js';/);
  assert.match(index, /app\.route\('\/api\/lab-report-shares', labReportShares\);/);
  assert.match(openPage, /report\.shows/);
  assert.match(openPage, /report\.hides/);
  assert.match(openPage, /lab-share-open-absent/);
});
