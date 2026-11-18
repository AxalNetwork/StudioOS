/**
 * #4843 part 1 (D4843) — Offers · Visibility redrawn to board OF-05 of the Offers v2 canvas:
 * the question first ("Where does our work come from?"), one primary action (+ Add surface),
 * missing attribution as an action (N engagements have no source recorded · Review
 * attribution), one table (Source, Kind, Engagements, Won, Views, Trend) whose unmeasured
 * columns read Not measured / Not recorded with the reason one press away, and the same rows
 * as labelled cards on a phone (OF-09).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/offers_visibility_of05_4843.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { act } from 'react';
import { loadZone, mountZone, stubApi } from './_offers_4688.mjs';
import { FOOT, TREND_WHY, VIEWS_WHY, captionOf, missingSource, sourceRows } from '../src/pages/partner/offers/visibilityModel.js';

const SURFACES = [
  { id: 1, name: 'Axal directory', kind: 'directory', is_active: 1, engagement_count: 3, won_value: 42000, views_note: null },
  { id: 2, name: 'Acme referral', kind: 'referral', is_active: 1, engagement_count: 6, won_value: 90000, views_note: 'No impression is recorded for a referral.' },
  { id: 3, name: 'Old event', kind: 'event', is_active: 0, engagement_count: 1, won_value: null, views_note: null },
];
const READ = { items: SURFACES, engagement_total: 14, unattributed_count: 4 };

// ------------------------------------------------------------------ the model

test('sourceRows: most engagements first, then by name; kinds in words; won kept as recorded', () => {
  const rows = sourceRows(SURFACES);
  assert.deepEqual(rows.map((r) => r.name), ['Acme referral', 'Axal directory', 'Old event']);
  assert.deepEqual(rows.map((r) => r.kind), ['Referral', 'Directory', 'Event']);
  assert.equal(rows[2].won, null, 'a won value never recorded is never 0');
  assert.equal(rows[2].retired, true);
  assert.equal(rows[0].viewsWhy, 'No impression is recorded for a referral.', 'the read’s own reason wins');
  assert.equal(rows[1].viewsWhy, VIEWS_WHY);
  const tie = sourceRows([{ id: 9, name: 'B', engagement_count: 2 }, { id: 8, name: 'A', engagement_count: 2 }]);
  assert.deepEqual(tie.map((r) => r.name), ['A', 'B']);
  assert.deepEqual(sourceRows(null), []);
});

test('captionOf: total and attributed from the read; nothing when no total is recorded', () => {
  assert.equal(captionOf(READ), '14 engagements · 10 attributed');
  assert.equal(captionOf({ engagement_total: 1, unattributed_count: 0 }), '1 engagement · 1 attributed');
  assert.equal(captionOf({ engagement_total: 2, unattributed_count: 5 }), '2 engagements · 0 attributed', 'never negative');
  assert.equal(captionOf({}), null);
});

test('missingSource: an action only when engagements name no surface, and Review only when one can be named', () => {
  const m = missingSource(READ, SURFACES);
  assert.equal(m.title, '4 engagements have no source recorded');
  assert.equal(m.line, 'They aren’t counted against any surface below.');
  assert.equal(m.canFix, true);
  assert.equal(missingSource({ unattributed_count: 1 }, SURFACES).title, '1 engagement has no source recorded');
  assert.equal(missingSource({ unattributed_count: 0 }, SURFACES), null);
  const noSurface = missingSource({ unattributed_count: 2 }, [{ is_active: 0 }]);
  assert.equal(noSurface.canFix, false, 'Review attribution needs a surface to attribute to');
  assert.match(noSurface.line, /Add a surface to attribute them/);
});

// ------------------------------------------------------------------ mounted

async function mounted(read = READ) {
  const restore = stubApi({
    getPartnerVisibility: async () => read,
    listPartnerAttribution: async () => ({ items: [{ engagement_id: 7, engagement_uid: 'e7', need_title: 'Board pack', status: 'won', price: 12000, surface_id: null }] }),
  });
  const Zone = await loadZone('VisibilityZone.jsx');
  const v = await mountZone(Zone);
  await v.flush();
  return { v, restore };
}

test('mounted: the question, one primary action, the missing-source action and the table', async () => {
  const { v, restore } = await mounted();
  try {
    const page = v.textIn('visibility-sources');
    assert.match(v.text(), /Where does our work come from\?/);
    assert.match(v.text(), /Engagements and won value by the surface that brought them in\./);
    assert.ok(v.has('+ Add surface'), 'the one primary action');
    assert.equal(v.textIn('visibility-missing').includes('4 engagements have no source recorded'), true);
    const review = v.editor('visibility-review');
    assert.equal(v.props(review).href, '#visibility-attribution', 'Review attribution goes to the attribution list');
    assert.equal(v.props(v.editor('visibility-attribution')).id, 'visibility-attribution', 'which is on the page, at that anchor');
    assert.equal(v.textIn('visibility-caption'), '14 engagements · 10 attributed');
    // Rows in order, figures as recorded, Views and Trend never a number.
    assert.match(page, /Acme referral.*Referral.*6.*\$90K.*Not measured.*Not recorded/s);
    assert.match(v.textIn('visibility-row-3'), /Old event.*Retired.*Event1Not recorded/, 'a won value never recorded reads Not recorded');
    assert.doesNotMatch(v.textIn('visibility-row-1'), /\b0\b/, 'no zero for Views or Trend');
    assert.equal(v.textIn('visibility-foot'), FOOT);
    // The limitations prose is gone from the page.
    assert.doesNotMatch(v.text(), /What this zone does not claim|Reads through to Delivery|Best converter|Directory views/);
  } finally { await v.unmount(); restore(); }
});

test('mounted: Not measured ⓘ discloses its reason on request, and closes again', async () => {
  const { v, restore } = await mounted();
  try {
    assert.equal(v.editor('visibility-views-2-reason'), undefined, 'the reason is not on the page until asked for');
    const why = v.editor('visibility-views-2-why');
    assert.equal(v.props(why)['aria-expanded'], false);
    assert.equal(v.props(why)['aria-label'], 'Why this is not measured');
    await act(async () => { v.props(why).onClick(); });
    assert.equal(v.textIn('visibility-views-2-reason'), 'No impression is recorded for a referral.');
    assert.equal(v.props(v.editor('visibility-views-2-why'))['aria-expanded'], true);
    await act(async () => { v.props(v.editor('visibility-trend-2-why')).onClick(); });
    assert.equal(v.textIn('visibility-trend-2-reason'), TREND_WHY);
    await act(async () => { v.props(v.editor('visibility-views-2-why')).onClick(); });
    assert.equal(v.editor('visibility-views-2-reason'), undefined);
  } finally { await v.unmount(); restore(); }
});

test('mounted: a phone reads the same rows as labelled cards; with every engagement attributed, no notice', async () => {
  const { v, restore } = await mounted({ ...READ, unattributed_count: 0 });
  try {
    assert.equal(v.editor('visibility-missing'), undefined, 'nothing to fix, nothing shown');
    const cards = v.textIn('visibility-cards');
    assert.match(cards, /Acme referral.*Referral.*Engagements6.*Won\$90K.*ViewsNot measured/s);
    assert.match(v.props(v.editor('visibility-cards')).className, /sm:hidden/);
    const table = v.nodes().find((n) => n.tagName === 'TABLE' && /sm:table/.test(v.props(n).className || ''));
    assert.ok(table, 'the desk table hides on a phone');
  } finally { await v.unmount(); restore(); }
});

test('mounted: with no active surface to attribute to, the notice says to add one and offers no Review', async () => {
  const { v, restore } = await mounted({ items: [SURFACES[2]], engagement_total: 3, unattributed_count: 2 });
  try {
    assert.match(v.textIn('visibility-missing'), /2 engagements have no source recorded.*Add a surface to attribute them/s);
    assert.equal(v.editor('visibility-review'), undefined);
  } finally { await v.unmount(); restore(); }
});

test('the decision file names the board, what was removed and what is not measured', () => {
  const f = 'documentation/architecture/decisions/D4843.md';
  assert.ok(existsSync(f));
  const d = readFileSync(f, 'utf8');
  assert.match(d, /^## D4843 — .*\(#4843\)$/m);
  for (const s of ['OF-05', 'Review attribution', 'Not measured', 'Trend', 'OF-09', 'D4843-p2.md', 'D4843-p3.md']) assert.ok(d.includes(s), s);
});
