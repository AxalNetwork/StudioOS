// D8257 (#8257) — Raise › Overview reads each readiness area by its key and status (RA-01 "N need
// attention", RA-09 Stale readiness), never by its label.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/raise_readiness_keys_8257.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { RaiseDetailedReadiness, RaiseReadinessSummary } from '../src/pages/cycles/RaiseOverviewLead.jsx';
import { attentionWords, readinessView, staleReadiness } from '../src/pages/cycles/raiseOverviewModel.js';

const read = (f) => readFileSync(resolve(process.cwd(), f), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/raise?project_id=7'] }, el));
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const raw = (items) => ({
  cards: [{ slug: 'fundraising-readiness', name: 'Fundraising readiness', state: 'ok', series: [{ kind: 'hbar', items }], next: null, reason: null }],
});
const bar = (key, label, value, status, assessed_at = '2026-11-02') => ({ key, label, value, status, assessed_at: value == null && status === 'not_recorded' ? null : assessed_at });

const mixed = () => raw([
  bar('narrative', 'Investor narrative', 9, 'ready'),
  bar('deck', 'Pitch deck', 0, 'missing'),
  bar('data_room', 'Data room', 4, 'attention'),
  bar('use_of_funds', 'Use of funds', 7, 'stale', '2026-10-14'),
  bar('cap_table', 'Cap table', null, 'unavailable'),
  bar('team', 'Team', null, 'not_recorded'),
  bar('pmf', 'Product-market fit', 6, 'ready'),
]);

test('each status is read from the area, and the ones that need attention are counted as Fundraising readiness counts them', () => {
  const v = readinessView(mixed());
  assert.equal(v.state, 'ready');
  assert.deepEqual(v.areas.map((a) => [a.key, a.status]), [
    ['narrative', 'ready'], ['deck', 'missing'], ['data_room', 'attention'], ['use_of_funds', 'stale'], ['cap_table', 'unavailable'], ['team', 'not_recorded'],
  ]);
  assert.equal(v.total, 6, 'Product-market fit is left out (RA-16)');
  assert.equal(v.assessed, 5, 'every area but the one nobody assessed');
  assert.deepEqual(v.unassessed, ['Team']);
  assert.equal(v.attention, 4, 'missing, needs attention, stale and unavailable; ready and not recorded are not');
  assert.equal(attentionWords(v), '4 need attention');
  assert.equal(attentionWords({ attention: 1 }), '1 needs attention');
  assert.equal(attentionWords({ attention: 0 }), 'None needs attention');
  assert.equal(v.areas.find((a) => a.key === 'use_of_funds').assessedAt, '2026-10-14');
  assert.equal(v.areas.find((a) => a.key === 'team').assessedAt, null);
});

test('Product-market fit is left out by its key, never by its label', () => {
  const renamed = readinessView(raw([bar('narrative', 'Investor narrative', 9, 'ready'), bar('pmf', 'PMF evidence', 6, 'ready')]));
  assert.deepEqual(renamed.areas.map((a) => a.key), ['narrative'], 'a renamed PMF bar is still left out');
  const lookalike = readinessView(raw([bar('traction', 'Product-market fit', 6, 'ready')]));
  assert.deepEqual(lookalike.areas.map((a) => a.key), ['traction'], 'an area labelled like PMF is still an area');
  const src = read('frontend/src/pages/cycles/raiseOverviewModel.js');
  assert.doesNotMatch(src, /product\[- \]market/i, 'no rule matches an area by its label');
  assert.doesNotMatch(src, /(?<!typeof \w+)\.label\s*[!=]==\s*['\"`]|\.test\([^)]*\.label|\.label(\.trim\(\))?\.(match|includes|startsWith)/, 'no label comparison in the model');
});

test('a bar from a read with no status falls back to its score; an unknown status is not trusted', () => {
  const v = readinessView(raw([{ key: 'deck', label: 'Pitch deck', value: 5 }, { key: 'team', label: 'Team', value: null }, { key: 'traction', label: 'Traction', value: 3, status: 'great' }]));
  assert.deepEqual(v.areas.map((a) => a.status), ['ready', 'not_recorded', 'ready']);
  assert.equal(v.attention, 0);
  assert.equal(v.areas[0].assessedAt, null, 'no day sent, none drawn');
  assert.equal(readinessView(raw([{ key: 'deck', label: 'Pitch deck', value: 5, status: 'ready', assessed_at: 'yesterday' }])).areas[0].assessedAt, null, 'only a day is a day');
});

test('RA-01: the summary says how many need attention', () => {
  const out = html(h(RaiseReadinessSummary, { view: readinessView(mixed()), search: '?project_id=7' }));
  assert.match(out, /data-testid="raise-readiness-attention" data-count="4">4 need attention</);
  assert.match(text(out), /5 of 6 areas assessed 4 need attention Team has no score yet/);
  const none = html(h(RaiseReadinessSummary, { view: readinessView(raw([bar('narrative', 'Investor narrative', 9, 'ready')])) }));
  assert.match(none, />None needs attention</);
});

test('RA-09 Stale: the stale areas are named with when they were assessed, and Re-assess for a viewer who may act', () => {
  const v = readinessView(mixed());
  const s = staleReadiness(v);
  assert.deepEqual(s.names, ['Use of funds']);
  assert.equal(s.since, '2026-10-14');
  assert.equal(s.sentence, 'Use of funds was assessed before its evidence changed. Re-assess to update.');
  const two = staleReadiness(readinessView(raw([bar('deck', 'Pitch deck', 5, 'stale', '2026-11-01'), bar('cap_table', 'Cap table', 6, 'stale', '2026-10-20')])));
  assert.equal(two.since, '2026-10-20', 'the oldest scoring day');
  assert.equal(two.sentence, 'Pitch deck and Cap table were assessed before their evidence changed. Re-assess to update.');
  assert.equal(staleReadiness(readinessView(raw([bar('deck', 'Pitch deck', 5, 'ready')]))), null, 'nothing stale: no Stale note');
  assert.equal(staleReadiness({ state: 'unavailable' }), null);

  const out = html(h(RaiseReadinessSummary, { view: v, search: '?project_id=7' }));
  assert.match(out, /data-testid="raise-readiness-stale"[\s\S]*?data-platform-state="stale"/);
  assert.match(text(out), /Use of funds was assessed before its evidence changed\. Re-assess to update\./);
  assert.match(out, /aria-label="Re-assess Use of funds" href="\/raise\/fundraising-readiness\?project_id=7"[^>]*>Re-assess</);
  const ro = html(h(RaiseReadinessSummary, { view: v, readOnly: true }));
  assert.match(ro, /data-testid="raise-readiness-stale"/, 'a reader still sees the area is stale');
  assert.doesNotMatch(ro, />Re-assess</, 'a reader is not offered Re-assess');
  assert.doesNotMatch(html(h(RaiseReadinessSummary, { view: readinessView(raw([bar('deck', 'Pitch deck', 5, 'ready')])) })), /raise-readiness-stale/);
});

test('RA-07: a stale area carries the Stale chip in the bars and the table', () => {
  const v = readinessView(mixed());
  for (const mode of ['bars', 'table']) {
    const out = html(h(RaiseDetailedReadiness, { view: v, defaultMode: mode }));
    assert.equal((out.match(/data-platform-state="stale"/g) || []).length, 1, mode);
  }
});

test('the Overview mount passes readOnly to the summary', () => {
  assert.match(read('frontend/src/pages/cycles/RaiseOverview.jsx'), /<RaiseReadinessSummary view=\{readiness\} search=\{s\} readOnly=\{readOnly\}/);
});

test('this file is the one D8257 names', () => {
  assert.match(read('documentation/architecture/decisions/D8257.md'), /raise_readiness_keys_8257\.test\.mjs/);
});
