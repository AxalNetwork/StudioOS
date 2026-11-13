/**
 * D511 — the cohort console never shows a minimum it did not read.
 *
 * The admin overview used to fall back to a typed `{ min: 1, max: 25 }` when
 * the Worker sent no settings, and drew every cycle's pill against it. Now
 * `settings` is null when the Worker could not read them, and the two pieces
 * that print them say so. Both are rendered for real. The Worker half is in
 * cloudflare-worker/test/lab_gates_d511.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SizeSettingsLabel } from '../src/pages/admin/AdminCohortApplications.jsx';
import { capacityOf } from '../src/pages/admin/lab/applicationsModel.js';

const render = (C, props) => renderToStaticMarkup(React.createElement(C, props));
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('unread settings say so; read ones show their numbers', () => {
  assert.match(render(SizeSettingsLabel, { settings: null }), /data-testid="app-settings-unreadable"[^>]*>Min · Max unreadable</);
  assert.equal(text(render(SizeSettingsLabel, { settings: { min: 4, max: 20 } })), 'Min 4 · Max 20');
});

// D948: the cycle pill went with the Cycles console; Applications' capacity bar
// (SL2) judges a cohort against the minimum now, and the same rule holds there.
const overview = (settings, approved = { available: true, value: 3 }) => ({ status: 'ready', data: { blocks: {
  cohorts: { available: true, items: [{ id: 7, cohort: '2026-12', year: 2026, month: 12, app_status: 'open', approved, force_proceed: 0 }] },
  settings,
} } });

test('a cohort is never passed or failed against a minimum nobody read', () => {
  for (const [settings, approved] of [
    [{ available: false, reason: 'Minimum and places could not be read, so no cohort is judged against them.' }, undefined],
    [undefined, undefined],
    [{ available: true, min: 4, places: 20 }, { available: false, reason: 'The pool could not be read.' }],
  ]) {
    const cap = capacityOf(overview(settings, approved), '2026-12');
    assert.equal(cap.state, 'unreadable', JSON.stringify({ settings, approved }));
    assert.equal(cap.minimum, undefined, 'no pass or fail');
    assert.match(cap.reason, /could not be read/);
  }
});

test('with a minimum read, the bar passes or fails the cohort against it', () => {
  assert.deepEqual(capacityOf(overview({ available: true, min: 3, places: 20 }), '2026-12').minimum, { met: true, text: 'Minimum 3 met' });
  assert.deepEqual(capacityOf(overview({ available: true, min: 5, places: 20 }), '2026-12').minimum, { met: false, text: 'Below the minimum of 5' });
});

test('the console holds no typed default for the settings', () => {
  const src = readFileSync(resolve(process.cwd(), 'frontend/src/pages/admin/AdminCohortApplications.jsx'), 'utf8');
  assert.doesNotMatch(src, /\{\s*min:\s*\d+,\s*max:\s*\d+\s*\}/, 'a typed { min, max } stands in for the read');
  assert.match(src, /setSettings\(apps\?\.settings \?\? null\);/);
});
