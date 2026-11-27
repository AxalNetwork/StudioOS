/**
 * D4574 H4 (#4574) — four static imports that put page code in the shell, kept out.
 *
 * Measured on the #4573 fixture (`rm -rf docs && npm run build && node scripts/perf/bundle-baseline.mjs`): the critical
 * path fell from 90 files / 85 modulepreloads / 502.9 KiB brotli to 26 / 24 / 380.1 KiB when these four went:
 *   1. DataRoomMoved imported `useMovedNotice` from the ui barrel, which carried Charts, FillSheet and every primitive;
 *   2. App imported UseOfFundsMovedRedirect statically, whose model carries the whole forecast model;
 *   3. portfolioAdapter imported agentsAdapter statically, so CompanySwitcher carried Team's agent, skill and
 *      assessment models onto every signed-in page;
 *   4. RecordingPill imported two helpers from RecordingView, carrying the whole recording view.
 * Each assertion fails if its import comes back. The helpers that moved keep their behaviour and their old exports.
 *
 * Mutation checked: each of the four imports restored → its assertion fails.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { codeOnly } from './_codeOnly.mjs';
import { clock, short } from '../src/pages/founder/recordingClock.js';
import * as view from '../src/pages/founder/RecordingView.jsx';

const src = (p) => codeOnly(readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8'));

test('DataRoomMoved takes its hook from its own module, never the ui barrel', () => {
  const s = src('pages/raise/dataroom/DataRoomMoved.jsx');
  assert.match(s, /import \{ useMovedNotice \} from '\.\.\/\.\.\/\.\.\/ui\/AdminPageHeader';/);
  assert.doesNotMatch(s, /from '(\.\.\/)+ui(\/index(\.js)?)?'/, 'the ui barrel is back on the shell path');
});

test('the old use-of-funds address redirects through a lazy route element', () => {
  const s = src('App.jsx');
  assert.match(s, /const UseOfFundsMovedRedirect = lazy\(\(\) => import\('\.\/pages\/raise\/useoffunds\/UseOfFundsMovedRedirect'\)\);/);
  assert.doesNotMatch(s, /import UseOfFundsMovedRedirect from/, 'a static import of the redirect is back');
});

test('the portfolio adapter loads Team\'s agents only when a project\'s agents are asked for', () => {
  const s = src('pages/account/companies/portfolioAdapter.js');
  assert.doesNotMatch(s, /^import .*agentsAdapter/m, 'a static import of agentsAdapter is back');
  assert.match(s, /export async function projectAgents\(id\) \{[\s\S]*?await import\('\.\.\/\.\.\/team\/agentsAdapter\.js'\)/);
});

test('the recording pill takes the timer and theme hook from recordingClock, not the whole view', () => {
  const s = src('pages/founder/RecordingPill.jsx');
  assert.match(s, /import \{ clock, useDarkTheme \} from '\.\/recordingClock';/);
  assert.doesNotMatch(s, /from '\.\/RecordingView'/, 'the pill imports the recording view again');
  // The helpers behave as before, and RecordingView still exports them for its other importers.
  assert.equal(clock(3723000), '01:02:03');
  assert.equal(clock(-5), '00:00:00');
  assert.equal(short(61000), '01:01');
  assert.equal(view.clock, clock);
  assert.equal(view.short, short);
  assert.equal(typeof view.useDarkTheme, 'function');
});
