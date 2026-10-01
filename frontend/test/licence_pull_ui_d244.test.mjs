/**
 * D244 — the branch licence page says why no copy arrived.
 *
 * `GET /api/licence/mine` on a branch now fetches a missing copy from HQ once,
 * and its `licence_not_pushed` 404 carries a `pull` saying what that attempt
 * did — or why none was made. "HQ has not pushed this branch its licence yet"
 * is true in every one of those cases and tells the one administrator on the
 * deployment nothing to do, so the page has to render the server's sentence
 * rather than stop at the headline.
 *
 * Rendered, not scanned: `LicencePullNote` is exported so each state can be
 * drawn with `renderToStaticMarkup`. The page itself cannot be — it loads in
 * an effect, which a static render never runs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import { LicencePullNote } from '../src/pages/subsidiary/MyLicencePage.jsx';

const PAGE = codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src/pages/subsidiary/MyLicencePage.jsx'), 'utf8'));
const draw = (pull) => renderToStaticMarkup(React.createElement(LicencePullNote, { pull }));

test('a pull that reached HQ and failed says so, in the server\'s words, with the retry in UTC', () => {
  const html = draw({
    called: true, ok: false, at: '2026-09-24T10:00:00.000Z',
    reason: 'HQ did not answer within 3 seconds.',
    retry_after: '2026-09-24T10:05:00.000Z',
  });
  assert.match(html, /data-testid="licence-pull"/);
  assert.match(html, /asked HQ for the licence just now, and it did not arrive/);
  assert.match(html, /HQ did not answer within 3 seconds\./, 'the server\'s own sentence must reach the page');
  // The time the next attempt may happen, in UTC — the window is the server's,
  // not the reader's zone — with the instant itself on the element.
  assert.match(html, /<time dateTime="2026-09-24T10:05:00.000Z">2026-09-24 10:05 UTC<\/time>/);
});

test('a pull refused before calling says it did not ask, and why', () => {
  const html = draw({
    called: false, ok: false, at: null,
    reason: 'No pull was attempted: this branch has no RPC_SECRET, and HQ hands a branch its licence terms only when the request carries it.',
  });
  assert.match(html, /did not ask HQ for the licence this time/);
  assert.doesNotMatch(html, /asked HQ for the licence just now/,
    'a refusal made before calling must not read as an attempt that failed');
  assert.match(html, /no RPC_SECRET/);
  assert.doesNotMatch(html, /<time/, 'no retry time was given, so none may be drawn');
});

test('no pull from an older server draws nothing rather than a guess', () => {
  assert.equal(draw(null), '');
  assert.equal(draw(undefined), '');
});

test('a retry stamp that is not an ISO instant is not drawn as a garbled time', () => {
  const html = draw({ called: true, ok: false, at: null, reason: 'HQ declined: nope.', retry_after: 'soon' });
  assert.match(html, /HQ declined: nope\./);
  assert.doesNotMatch(html, /<time/);
});

test('the page carries the pull into state and draws it inside the not-pushed block', () => {
  assert.match(PAGE, /setData\(\{ notPushed: true, branch: e\?\.data\?\.branch \|\| null, pull: e\?\.data\?\.pull \|\| null \}\)/,
    'the 404\'s pull was dropped on the way into state');
  // Bounded to the not-pushed block itself, so a mount elsewhere on the page
  // cannot satisfy it.
  const at = PAGE.indexOf('data-testid="licence-not-pushed"');
  assert.ok(at > 0);
  const end = PAGE.indexOf('if (data.none)', at);
  assert.ok(end > at, 'the not-pushed block could not be bounded');
  assert.match(PAGE.slice(at, end), /<LicencePullNote pull=\{data\.pull\} \/>/,
    'the not-pushed state no longer draws the pull\'s sentence');
});
