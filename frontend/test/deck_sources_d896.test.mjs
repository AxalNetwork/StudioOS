/**
 * D896 (#2675, part 2 of #2434) — the deck's sources on the page: the chips,
 * the coverage meter (PD11), the Sources panel (PD10), the legend (PD10b) and
 * New deck's Sources step (PD4), from `GET /api/decks/sources`.
 *
 * What this file holds them to:
 *   · a slot nobody recorded reads "Not recorded on StudioOS" with its module,
 *     never 0, and is not counted as covered;
 *   · the meter draws each of its five states, and loading and error draw no counts;
 *   · a band is never a number, and nothing is a canvas sample;
 *   · each board renders in light and dark (every light surface carries its dark pair).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deck_sources_d896.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  GRADES, LEGEND_GRADES, LEGEND_SOURCES, NOT_ON_STUDIOOS, changedSince, chipOf, gapLine, groupSources, meterOf,
  missingRows, recordLine, scorecardDialog, staleKeys, valueText,
} from '../src/pages/raise/pitch/sourcesModel.js';
import { dayLabel } from '../src/pages/raise/pitch/pitchStudioModel.js';
import { CoverageMeter, SourceChip, SourcesLegend, SourcesPanel, SourcesStep, ScorecardDialog } from '../src/pages/raise/pitch/SourcesBoards.jsx';
import { deckSourcesApi } from '../src/lib/api/deckSources.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const h = React.createElement;
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));

/* ------------------------------------------------------------------ *
 * Fixtures, in the shape `GET /api/decks/sources` sends
 * ------------------------------------------------------------------ */

const base = (key, area, label, extra = {}) => ({
  source_key: key, area, label, module: extra.module || 'Grow › Revenue and traction', unit: 'count',
  href: extra.href || '/grow/revenue-and-traction?project=1', value: null, as_of: null, grade: 'Not recorded',
  source: null, record_ref: null, snapshot_hash: null, state: 'not_recorded', ...extra,
});
const rec = (key, area, label, value, extra = {}) => base(key, area, label, {
  value, state: 'recorded', grade: 'Measured', source: 'Recorded', snapshot_hash: 'a'.repeat(24), as_of: '2026-10-03', ...extra,
});

const ITEMS = [
  rec('validate.interviews', 'validate', 'Interviews', 23, { module: 'Validate › Customer research', href: '/validate/customer-research?project=1' }),
  rec('validate.strong_fit', 'validate', 'Strong fit', 14, { module: 'Validate › Customer research' }),
  rec('validate.lois', 'validate', 'Letters of intent', 3, { source: 'Document', grade: 'Sourced', module: 'Validate › Demand signals' }),
  base('validate.competitors', 'validate', 'Competitors tracked', { module: 'Validate › Market intelligence', href: '/validate/market-intelligence?project=1' }),
  rec('build.must_haves', 'build', 'Must-haves done', 9, { of: 12, module: 'Build › Prototype / MVP' }),
  rec('build.commits_90d', 'build', 'Commits in 90 days', 212, { of: 2, source: 'Connector', record_ref: 'github_contributors:2', module: 'Build › Product roadmap' }),
  rec('raise.round_target', 'raise', 'Round', 1500000, { unit: 'usd', source: 'Document', grade: 'Reviewed', module: 'Raise › Round planner' }),
  rec('raise.round_close', 'raise', 'Close', '2026-12-15', { unit: 'date', source: 'Document', grade: 'Reviewed', module: 'Raise › Round planner' }),
  rec('grow.arr', 'grow', 'ARR', 203400, { unit: 'usd', source: 'Connector', record_ref: 'project_metrics:7' }),
  rec('grow.mrr', 'grow', 'MRR', 16950, { unit: 'usd', source: 'Connector', record_ref: 'project_metrics:7', as_of: '2026-09-30' }),
  rec('grow.paying_customers', 'grow', 'Paying customers', 42, { source: 'Typed', grade: 'Stated', record_ref: 'project_metrics:6' }),
  rec('grow.runway', 'grow', 'Runway', 14.2, { unit: 'months', source: 'Connector', record_ref: 'mercury_raise_facts:3', as_of: '2026-10-01' }),
  rec('grow.mercury_revenue', 'grow', 'Revenue last month', 1695000, { unit: 'cents', source: 'Connector', record_ref: 'mercury_raise_facts:1' }),
  base('grow.churn', 'grow', 'Churn, monthly', { unit: 'percent' }),
  base('grow.net_burn', 'grow', 'Net burn', { unit: 'cents', state: 'withheld' }),
  rec('team.skills', 'team', 'Skills', 'engineering · finance_ops', { unit: 'text' }),
  base('scoring.scorecard_band', 'scoring', 'Scorecard band', { unit: 'text', optional: true, module: 'Raise › Fundraising readiness' }),
  base('scoring.pmf_band', 'scoring', 'Product-market fit', { unit: 'text', optional: true, module: 'Raise › Fundraising readiness' }),
];
const COVERAGE = { slots: 16, filled: 13, by_grade: { Measured: 7, Reviewed: 2, Sourced: 1, Stated: 3 }, not_recorded: 3, unreadable: 0 };

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('a value is worded from its unit; nothing recorded is null, never 0', () => {
  const by = Object.fromEntries(ITEMS.map((i) => [i.source_key, i]));
  assert.equal(valueText(by['grow.mrr']), '$16,950');
  assert.equal(valueText(by['grow.mercury_revenue']), '$16,950', 'cents are divided, not shown raw');
  assert.equal(valueText(by['grow.runway']), '14.2 months');
  assert.equal(valueText(by['raise.round_target']), '$1,500,000');
  assert.equal(valueText(by['raise.round_close']), dayLabel('2026-12-15'));
  assert.equal(valueText(by['build.must_haves']), '9 of 12');
  assert.equal(valueText(by['build.commits_90d']), '212 by 2');
  assert.equal(valueText(by['team.skills']), 'engineering · finance_ops');
  assert.equal(valueText({ ...by['grow.mrr'], value: 0 }), '$0', 'a recorded zero is a real zero');
  for (const k of ['grow.churn', 'validate.competitors', 'grow.net_burn', 'scoring.scorecard_band']) assert.equal(valueText(by[k]), null, k);
  assert.equal(gapLine(by['grow.churn']), NOT_ON_STUDIOOS);
  assert.equal(gapLine(by['grow.net_burn']), 'Only the founder reads this');
  assert.equal(gapLine({ ...by['grow.churn'], state: 'unreadable' }), 'Could not be read');
});

test('the chip names the tool, the date and the grade, and explains itself', () => {
  const mrr = chipOf(ITEMS.find((i) => i.source_key === 'grow.mrr'));
  assert.deepEqual([mrr.source, mrr.record, mrr.date, mrr.grade], ['Connector', 'From Stripe', dayLabel('2026-09-30'), 'Measured']);
  assert.equal(mrr.title, 'Connector: from a connected tool. Measured: from a connected tool, or counted from records.');
  assert.equal(recordLine(ITEMS.find((i) => i.source_key === 'grow.runway')), 'From Mercury');
  assert.equal(recordLine(ITEMS.find((i) => i.source_key === 'build.commits_90d')), 'From GitHub');
  assert.equal(recordLine(ITEMS.find((i) => i.source_key === 'validate.lois')), 'From Validate › Demand signals');
  assert.equal(chipOf(ITEMS.find((i) => i.source_key === 'grow.churn')), null, 'no chip without a value');
});

test('groups: two per area, Grow three with MRR, paying customers and churn first, missing rows kept in view', () => {
  const groups = groupSources(ITEMS);
  assert.deepEqual(groups.map((g) => g.id), ['validate', 'build', 'raise', 'grow', 'team', 'scoring']);
  const v = groups.find((g) => g.id === 'validate');
  assert.deepEqual(v.items.map((i) => i.source_key), ['validate.interviews', 'validate.strong_fit']);
  assert.equal(v.more, 'Show 2 more');
  const g = groups.find((x) => x.id === 'grow');
  assert.deepEqual(g.items.map((i) => i.source_key).slice(0, 3), ['grow.mrr', 'grow.paying_customers', 'grow.churn']);
  assert.ok(!g.items.some((i) => i.state === 'withheld'), 'a withheld slot is not drawn');
  assert.equal(g.more, 'Show 3 more');
  const s = groups.find((x) => x.id === 'scoring');
  assert.equal(s.items.length, 2);
  assert.equal(s.more, null);
  assert.match(s.note, /never your raw score/);
  // Expanded, an area shows every row.
  assert.equal(groupSources(ITEMS, { expanded: new Set(['validate']) }).find((x) => x.id === 'validate').items.length, 4);
  // In Grow, a stale row past the count stays in view.
  const stale = new Map([['grow.runway', { as_of: '2026-09-01' }]]);
  assert.ok(groupSources(ITEMS, { stale }).find((x) => x.id === 'grow').items.some((i) => i.source_key === 'grow.runway'));
});

test('search, grade filter and Stale only narrow the panel', () => {
  assert.deepEqual(groupSources(ITEMS, { search: 'runway' }).flatMap((g) => g.items.map((i) => i.source_key)), ['grow.runway']);
  const reviewed = groupSources(ITEMS, { grade: 'Reviewed' }).flatMap((g) => g.items.map((i) => i.source_key));
  assert.deepEqual(reviewed, ['raise.round_target', 'raise.round_close']);
  const gaps = groupSources(ITEMS, { grade: 'Not recorded', expanded: new Set(['validate', 'grow']) }).flatMap((g) => g.items.map((i) => i.source_key));
  assert.ok(gaps.includes('grow.churn') && gaps.includes('validate.competitors') && !gaps.includes('grow.mrr'));
  const stale = staleKeys({ rows: [{ source_key: 'grow.mrr', state: 'stale', bound: { as_of: '2026-09-30' } }, { source_key: 'build.commits_90d', state: 'fresh' }] });
  assert.deepEqual([...stale.keys()], ['grow.mrr']);
  assert.deepEqual(groupSources(ITEMS, { staleOnly: true, stale }).flatMap((g) => g.items.map((i) => i.source_key)), ['grow.mrr']);
  assert.equal(changedSince(stale.get('grow.mrr')), `Changed since ${dayLabel('2026-09-30')}`);
});

test('the meter counts only filled slots, by grade, with the gap last', () => {
  const m = meterOf(COVERAGE);
  assert.equal(m.label, '13 of 16 slots');
  assert.deepEqual(m.segments.map((s) => [s.key, s.n]), [['Measured', 7], ['Reviewed', 2], ['Sourced', 1], ['Stated', 3], ['Not recorded', 3]]);
  assert.equal(m.state, 'partial');
  assert.equal(meterOf({ slots: 4, filled: 4, by_grade: { Measured: 4 } }).state, 'full');
  assert.equal(meterOf({ slots: 4, filled: 0, by_grade: {} }).state, 'empty');
  assert.equal(meterOf({ slots: 0, filled: 0, by_grade: {} }).state, 'empty');
  assert.equal(meterOf(null), null, 'no coverage read, no counts');
  // An unreadable slot is a gap on the bar, not filled.
  assert.equal(meterOf({ slots: 5, filled: 3, by_grade: { Measured: 3 }, not_recorded: 1, unreadable: 1 }).segments.at(-1).n, 2);
});

test('missing lists every unrecorded slot with its module, and never a Scoring row', () => {
  const rows = missingRows(ITEMS);
  assert.deepEqual(rows.map((r) => r.key), ['validate.competitors', 'grow.churn']);
  assert.deepEqual(rows[1], { key: 'grow.churn', label: 'Churn, monthly', text: 'Add it in Grow › Revenue and traction ›', href: '/grow/revenue-and-traction?project=1' });
});

test('the scorecard dialog says a band, never the number; with no band it cannot be included', () => {
  const none = scorecardDialog(ITEMS.find((i) => i.source_key === 'scoring.scorecard_band'));
  assert.equal(none.title, 'Include your scorecard band on this deck?');
  assert.equal(none.canInclude, false);
  assert.match(none.body, /Never the number\.$/);
  const band = scorecardDialog({ ...ITEMS.find((i) => i.source_key === 'scoring.pmf_band'), state: 'recorded', value: 'Fair · Medium confidence' });
  assert.equal(band.title, 'Include your Product-market fit band on this deck?');
  assert.equal(band.canInclude, true);
  assert.equal(band.body, 'Investors will see Fair · Medium confidence, the model version and the date. Never the number.');
});

test('the legend: five sources, five grades, in the canvas order', () => {
  assert.deepEqual(LEGEND_SOURCES.map((s) => s.id), ['Connector', 'Document', 'Recorded', 'Signed', 'Typed']);
  assert.deepEqual(LEGEND_GRADES.map((g) => g.id), [...GRADES, 'Not recorded']);
});

test('the API module names the two Worker routes, mounted before decks', () => {
  // `request` needs a browser; the paths are what scripts/check-api-drift.mjs matches against the Worker.
  const mod = read('frontend/src/lib/api/deckSources.js');
  assert.match(mod, /request\(`\/decks\/sources\?project_id=\$\{enc\(projectId\)\}\$\{includeScoring \? '&include=scoring' : ''\}`\)/);
  assert.match(mod, /request\(`\/decks\/\$\{enc\(deckId\)\}\/refresh`, \{ method: 'POST'/);
  assert.equal(typeof deckSourcesApi.list, 'function');
  assert.equal(typeof deckSourcesApi.refresh, 'function');
  const index = read('cloudflare-worker/src/index.ts');
  assert.ok(index.indexOf("app.route('/api/decks', deckSources)") > 0);
  assert.ok(index.indexOf("app.route('/api/decks', deckSources)") < index.indexOf("app.route('/api/decks', decks)"), 'before decks, whose GET /:id would answer /sources');
  assert.match(read('frontend/src/lib/api.js'), /^export \* from '\.\/api\/deckSources\.js';$/m);
});

/* ------------------------------------------------------------------ *
 * The boards, rendered
 * ------------------------------------------------------------------ */

test('PD11: each meter state renders; loading and error draw no counts', () => {
  const partial = html(h(CoverageMeter, { coverage: COVERAGE, size: 'M', legend: true }));
  assert.match(partial, /data-state="partial"/);
  assert.match(partial, /13 of 16/);
  assert.match(partial, /aria-label="13 of 16 slots: 7 Measured, 2 Reviewed, 1 Sourced, 3 Stated, 3 Not recorded"/);
  assert.match(html(h(CoverageMeter, { coverage: { slots: 2, filled: 2, by_grade: { Measured: 2 } }, size: 'S' })), /data-state="full"/);
  const empty = html(h(CoverageMeter, { coverage: { slots: 9, filled: 0, by_grade: {} }, size: 'L' }));
  assert.match(empty, /data-state="empty"/);
  assert.match(empty, /border-dashed/);
  const loading = html(h(CoverageMeter, { coverage: COVERAGE, status: 'loading' }));
  assert.match(loading, /data-state="loading"/);
  assert.match(loading, /Reading…/);
  assert.doesNotMatch(loading, /13 of 16/);
  assert.doesNotMatch(loading, /could not be read/);
  assert.match(loading, /animate-pulse/);
  const error = html(h(CoverageMeter, { coverage: COVERAGE, status: 'error', onRetry: () => {} }));
  assert.match(error, /data-state="error"/);
  assert.match(error, /Coverage could not be read/);
  assert.match(error, /Try again/);
  assert.doesNotMatch(error, /13 of 16/);
  // Each size has its own height.
  assert.match(html(h(CoverageMeter, { coverage: COVERAGE, size: 'S' })), /h-1\.5/);
  assert.match(html(h(CoverageMeter, { coverage: COVERAGE, size: 'L' })), /h-4/);
});

test('PD10: the panel draws chips, the dashed missing row with its link, Show more and the Scoring toggles', () => {
  const out = html(h(SourcesPanel, { items: ITEMS, stale: new Map([['grow.mrr', { as_of: '2026-09-01' }]]) }));
  assert.match(out, /data-testid="sources-panel"/);
  assert.match(out, /Search sources/);
  assert.match(out, /All grades/);
  assert.match(out, /Stale only/);
  assert.match(out, /How sources and grades work ›/);
  assert.match(out, /data-testid="source-chip-grow.mrr"/);
  assert.match(out, /From Stripe/);
  assert.ok(out.includes(`Changed since ${dayLabel('2026-09-01')}`));
  assert.match(out, /Not recorded on StudioOS · <a[^>]*href="\/grow\/revenue-and-traction\?project=1"[^>]*>Add it in Grow › Revenue and traction ›<\/a>/);
  assert.match(out, /Show 2 more ▾/);
  assert.match(out, /role="switch" aria-checked="false" aria-label="Include Scorecard band"/);
  assert.doesNotMatch(out, /Net burn/, 'a withheld slot is not drawn');
  assert.match(html(h(SourcesPanel, { items: ITEMS, status: 'error', onRetry: () => {} })), /Sources could not be read\./);
});

test('PD10b and the scorecard dialog render', () => {
  const legend = html(h(SourcesLegend, { onClose: () => {} }));
  for (const s of LEGEND_SOURCES) assert.ok(legend.includes(s.line), s.id);
  for (const g of LEGEND_GRADES) assert.ok(legend.includes(g.line), g.id);
  assert.match(legend, /Investors see the same chips\./);
  const dialog = html(h(ScorecardDialog, { item: ITEMS.find((i) => i.source_key === 'scoring.scorecard_band'), onKeepOff: () => {}, onInclude: () => {} }));
  assert.match(dialog, /Include your scorecard band on this deck\?/);
  assert.match(dialog, /Keep it off/);
  assert.match(dialog, /<button[^>]*disabled=""[^>]*>Include the band<\/button>/);
});

test('PD4: the Sources step draws every area, the meter, Missing and Continue', () => {
  const out = html(h(SourcesStep, { items: ITEMS, coverage: COVERAGE, onContinue: () => {} }));
  assert.match(out, /data-testid="sources-step"/);
  for (const a of ['validate', 'build', 'raise', 'grow', 'team', 'scoring']) assert.match(out, new RegExp(`data-testid="sources-step-${a}"`), a);
  assert.match(out, /13 of 16 slots/);
  assert.match(out, /can be filled from your records/);
  assert.match(out, />Missing</);
  assert.match(out, /Continue to outline/);
  // Recorded rows start chosen; a row with no value cannot be.
  assert.match(out, /aria-label="Use Interviews" checked=""/);
  assert.match(out, /aria-label="Use Churn, monthly" disabled=""/);
  const empty = html(h(SourcesStep, { items: ITEMS.map((i) => ({ ...i, state: 'not_recorded', value: null })), coverage: { slots: 16, filled: 0, by_grade: {} } }));
  assert.match(empty, /StudioOS has nothing to fill from yet/);
});

test('no canvas sample and no zero stands in for a missing value', () => {
  const all = [
    html(h(SourcesPanel, { items: ITEMS })), html(h(SourcesStep, { items: ITEMS, coverage: COVERAGE })),
    html(h(CoverageMeter, { coverage: COVERAGE })), html(h(SourceChip, { item: ITEMS[0] })),
  ].join('\n');
  // The words a reader sees: markup and its class names (Tailwind's `h-[18px]`) stripped.
  const text = all.replace(/<[^>]*>/g, ' ');
  assert.doesNotMatch(text, /\[[^\]]*\]/, 'no bracketed canvas sample');
  assert.doesNotMatch(all, /Northwind/);
  assert.doesNotMatch(all, /Churn, monthly<\/span><span[^>]*>0</);
});

test('dark mode: every light surface in the boards carries its dark pair', () => {
  const src = read('frontend/src/pages/raise/pitch/SourcesBoards.jsx');
  for (const [light, dark] of [['bg-white', 'dark:bg-'], ['border-axal-hairline', 'dark:border-'], ['text-axal-ink', 'dark:text-'], ['text-axal-muted', 'dark:text-'], ['bg-axal-hairline', 'dark:bg-']]) {
    for (const m of src.matchAll(/(?:className=|const [A-Z_]+ = )(['"`])([^'"`]*)\1/g)) {
      if (m[2].split(/\s+/).includes(light)) assert.ok(m[2].includes(dark), `${light} without ${dark}: ${m[2]}`);
    }
  }
});

test('PD2: the current-deck card mounts the coverage meter from the sources read, and the studio line is the canvas\u2019s', () => {
  const studio = read('frontend/src/pages/raise/pitch/PitchStudio.jsx');
  const card = studio.slice(studio.indexOf('function CurrentDeck('), studio.indexOf('function Versions('));
  assert.ok(card.length > 0, 'CurrentDeck is found');
  assert.match(card, /const sources = useDeckSources\(project\?\.id\);/);
  assert.match(card, /<CoverageMeter coverage=\{sources\.data\?\.coverage\} status=\{sources\.status\} size="M" onRetry=\{sources\.retry\} \/>/);
  assert.match(studio, /import \{ CoverageMeter, useDeckSources \} from '\.\/SourcesBoards';/);
  assert.match(read('frontend/src/pages/raise/pitch/pitchStudioModel.js'), /export const LINE = 'Build your deck from what StudioOS already knows\. Every figure shows its source\.';/);
});
