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
import { SizeSettingsLabel, MinimumPill } from '../src/pages/admin/AdminCohortApplications.jsx';

const render = (C, props) => renderToStaticMarkup(React.createElement(C, props));
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const cycle = (o = {}) => ({ id: 7, applicant_counts: { approved: 2, activated: 1 }, meets_minimum: true, ...o });

test('unread settings say so; read ones show their numbers', () => {
  assert.match(render(SizeSettingsLabel, { settings: null }), /data-testid="app-settings-unreadable"[^>]*>Min · Max unreadable</);
  assert.equal(text(render(SizeSettingsLabel, { settings: { min: 4, max: 20 } })), 'Min 4 · Max 20');
});

test('a cycle is never passed or failed against a minimum nobody read', () => {
  for (const [settings, meets] of [[null, true], [null, false], [{ min: 4, max: 20 }, null]]) {
    const html = render(MinimumPill, { cycle: cycle({ meets_minimum: meets }), settings });
    assert.match(html, /data-testid="cycle-minimum-unreadable-7"/, JSON.stringify({ settings, meets }));
    assert.equal(text(html), '3 approved · minimum unreadable');
    assert.doesNotMatch(html, /emerald|amber/, 'no pass or fail colour');
  }
});

test('with a minimum read, the pill passes or fails the cycle against it', () => {
  const pass = render(MinimumPill, { cycle: cycle(), settings: { min: 3, max: 20 } });
  assert.equal(text(pass), '3/3 approved');
  assert.match(pass, /emerald/);
  const fail = render(MinimumPill, { cycle: cycle({ meets_minimum: false }), settings: { min: 5, max: 20 } });
  assert.equal(text(fail), '3/5 approved');
  assert.match(fail, /amber/);
});

test('the console holds no typed default for the settings', () => {
  const src = readFileSync(resolve(process.cwd(), 'frontend/src/pages/admin/AdminCohortApplications.jsx'), 'utf8');
  assert.doesNotMatch(src, /\{\s*min:\s*\d+,\s*max:\s*\d+\s*\}/, 'a typed { min, max } stands in for the read');
  assert.match(src, /setSettings\(apps\?\.settings \?\? null\);/);
});
