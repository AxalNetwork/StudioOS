/**
 * D490 — #871 follow-ups: private notes, dated touches, void-touch honesty.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = codeOnly(read('frontend/src/pages/investor/InvestorNetworkWorkspace.jsx'));
const ROUTE = read('cloudflare-worker/src/routes/partnernet.ts');

test('the book exposes private notes, dated touches, and refuses void touches in the UI', () => {
  assert.match(PAGE, /my_private_note/, 'the page never reads the caller’s private note');
  assert.match(PAGE, /private_note:/, 'the private note write is unwired');
  assert.match(PAGE, /input-touch-date/, 'the touch form never carries a date');
  assert.match(PAGE, /empty touch must not move the cold flag/, 'void touches are not refused before the route is asked');
  assert.match(PAGE, /no touches logged yet/, 'an empty log still reads as unavailable');
});

test('the route scopes private notes and refuses void touches', () => {
  assert.match(ROUTE, /my_private_note/, 'GET never scopes private notes to the caller');
  assert.match(ROUTE, /touch_requires_substance/, 'void touches are still accepted');
  assert.match(ROUTE, /parseRemindAt/, 'calendar reminder dates are not normalized');
  assert.match(ROUTE, /mergePrivateNote/, 'private notes are not merged per party');
});
