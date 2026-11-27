/**
 * D330 — AdminX.jsx and AdminTelegram.jsx say why no draft was made.
 *
 * D301 (task 434) made `runAggregator`/`runXAggregator` skip persisting any
 * draft with `drafted: false` — the X advisors draft's only figure
 * (`partner_office_hours`) had no replacement, so it is the one draft that
 * never reaches `x_posts`. D301's own D-entry filed the page-side fix "for
 * after Session 1's D258 … merges", reasoning the two changes would collide
 * on the same render logic — but D258 (#811) had already merged before
 * D301's PR (#817) was even opened, so that filing was stale on arrival
 * (corrected in place in D330's entry). This file pins the fix: both pages'
 * preview surfaces read `d.drafted` and print `d.reason` instead of
 * rendering an empty draft.
 *
 * Static, over CODE ONLY (`_codeOnly.mjs`) rather than live-API rendering:
 * neither page takes its `api` module as a prop, so there is no seam to
 * inject a fake `previewAggregator` response without changing the pages'
 * own architecture, which is out of this task's scope. The assertions pin
 * what the code DOES with a `drafted: false` draft, not a rendered DOM.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

const X_RAW = raw('frontend/src/pages/admin/AdminX.jsx');
const X = codeOnly(X_RAW);
const TG_RAW = raw('frontend/src/pages/admin/AdminTelegram.jsx');
const TG = codeOnly(TG_RAW);

test('AdminX.jsx branches on d.drafted and never renders an empty thread for it', () => {
  assert.match(X, /d\.drafted\s*===\s*false/,
    'the X aggregator preview no longer checks drafted — the not-drafted case is invisible again');
  // The reason line and the thread render must be mutually exclusive on the
  // same draft — a ternary (or equivalent if/else), not two independent ifs
  // that could both fire.
  const previewFnAt = X.indexOf('function AggregatorTab');
  assert.ok(previewFnAt >= 0, 'AggregatorTab was renamed or removed');
  const body = X.slice(previewFnAt, X.indexOf('\n}\n', previewFnAt) + 3);
  assert.match(body, /d\.drafted === false \?/,
    'the not-drafted branch is not a ternary guarding the thread render');
  assert.match(body, /d\.reason/, 'the reason from the worker is never read');
});

test('AdminX.jsx shows the worker reason, not a placeholder, when one is given', () => {
  assert.match(X, /No draft was made:.*\{d\.reason \|\| 'no reason was given'\}/s,
    'a present reason is not distinguished from its absence — the fallback must be the ONLY text without one');
});

test('AdminTelegram.jsx gained a preview surface that reads the aggregator preview endpoint', () => {
  assert.match(TG, /api\.previewAggregator\(/,
    'no call to the existing GET /aggregator/preview route — the not-drafted audience stays invisible');
  assert.match(TG, /setPreview\(/, 'the preview response is never stored for render');
});

test('AdminTelegram.jsx branches on d.drafted for the preview list, same as AdminX', () => {
  assert.match(TG, /d\.drafted\s*===\s*false/,
    'the Telegram preview list no longer checks drafted');
  assert.match(TG, /No draft was made:.*\{d\.reason \|\| 'no reason was given'\}/s,
    'the Telegram preview does not print the worker reason with the same honest fallback as X');
});

test('neither page invents a number or a body for an undrafted audience', () => {
  // A regression this shape invites: printing `d.body_md` / `d.thread` even
  // when `drafted` is false, because the payload still carries the (empty)
  // fields. Scoped to each not-drafted branch specifically.
  const xBranch = X.match(/d\.drafted === false \? \(([\s\S]*?)\) : \(/);
  assert.ok(xBranch, 'could not isolate the X not-drafted branch to check it');
  assert.ok(!/d\.thread/.test(xBranch[1]), 'the X not-drafted branch still renders d.thread');

  const tgBranch = TG.match(/d\.drafted === false \? \(([\s\S]*?)\) : \(/);
  assert.ok(tgBranch, 'could not isolate the Telegram not-drafted branch to check it');
  assert.ok(!/d\.body_md/.test(tgBranch[1]), 'the Telegram not-drafted branch still renders d.body_md');
});
