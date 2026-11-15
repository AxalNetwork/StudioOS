/**
 * D5077 (#5077, Build module UX 2 of 3) — Build module pages lead with the
 * founder's work: Connect a tool leaves the module header, the connector parts
 * draw in a Sources region under the records (BD7, BD8; folded at zero, BD18 A),
 * Eadwyn's suggestions are the module's own asks (BD21 B) on the page at zero,
 * in the rail, and folded on the phone (BD24 A), and the rail's models, safety
 * line and usage fold into "AI settings" on those pages (BD21 A).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/build_sources_eadwyn_d5077.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { codeOnly } from './_codeOnly.mjs';

import CycleModulePage, { ModuleAsk, ModuleAskView } from '../src/pages/cycles/CycleModulePage.jsx';
import PhoneModulePage, { PhoneAskEntryView } from '../src/pages/cycles/PhoneModulePage.jsx';
import { primaryForModule } from '../src/pages/cycles/CycleRoute.jsx';
import buildDef from '../src/pages/cycles/defs/build.jsx';
import { MODULES } from '../src/pages/cycles/modules.js';
import { BUILD_ASKS, BUILD_RAIL_NOTES, asksCountLabel, moduleAsks, moduleRailNote } from '../src/pages/cycles/buildEadwyn.js';
import WorkerRail, { RailAsks } from '../src/ui/WorkerRail.jsx';
import AskPanel from '../src/ui/AskPanel.jsx';
import { __resetEadwynPanelForTest, useAskPanel, useAskRail } from '../src/ui/eadwynPanel.js';
import { mountForm, propsOf, textOf } from './_form_d695.mjs';

const html = (el, entry = '/build/solution-design') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [entry] }, el));
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const SIX = ['solution-design', 'prototype-mvp', 'product-roadmap', 'founding-team', 'company-creation', 'operating-systems'];
const cols = [{ key: 'name', label: 'Feature' }];
const recs = (n) => ({ cols, rows: Array.from({ length: n }, (_, i) => ({ id: i + 1, cells: { name: `Feature ${i + 1}` } })), total: n, page: 1, page_size: 25 });
const card = { key: 'solution-design', name: 'Solution design', state: 'empty', reason: 'No features recorded yet.', next: null, charts: [] };
const ADD = [{ text: 'Add feature', href: '/build/solution-design/new' }];
const CONNECT = { label: 'Connect a tool', href: '/build/connect?project_id=7' };
const part = h('div', { 'data-testid': 'build-part-github' }, 'From GitHub');
const MODEL_WORDS = /model|price|pricing|token|allowance|top-up|balance|per 1M|\$/i;

test('BD21 B: each of the six Build modules has its own asks, in Eadwyn\'s voice, with no model or billing word', () => {
  assert.deepEqual(Object.keys(BUILD_ASKS), SIX);
  assert.deepEqual(MODULES.build.map((m) => m.slug).sort(), [...SIX].sort(), 'every Build module, and only they');
  for (const slug of SIX) {
    const asks = moduleAsks('build', slug);
    assert.ok(Array.isArray(asks) && asks.length >= 2 && asks.length <= 6, slug);
    for (const a of asks) {
      assert.doesNotMatch(a, /advisor|advice|recommend|fiduciary/i, `${slug}: ${a}`);
      assert.doesNotMatch(a, MODEL_WORDS, `${slug}: ${a}`);
    }
  }
  assert.equal(new Set(SIX.flatMap((s) => BUILD_ASKS[s])).size, SIX.flatMap((s) => BUILD_ASKS[s]).length, 'no ask is generic across modules');
  // The canvas's own wording, where it names no sample record.
  assert.ok(BUILD_ASKS['solution-design'].includes('Which features have no evidence link?'));
  assert.ok(BUILD_ASKS['prototype-mvp'].includes('Which must-have should be next?'));
  assert.ok(BUILD_ASKS['company-creation'].includes('What is still outstanding to form the company?'));
  // Off a Build module there are none.
  assert.equal(moduleAsks('validate', 'solution-design'), null);
  assert.equal(moduleAsks('build', null), null);
  assert.equal(moduleAsks('build', 'toString'), null, 'an inherited key is not a module');
  assert.equal(asksCountLabel(BUILD_ASKS['solution-design']), '3 suggestions for this module');
  assert.equal(asksCountLabel(['One']), '1 suggestion for this module');
});

test('the rail\'s sentence: Monday plans, retros and annotations only on Operating systems, roadmap ordering only on the roadmap', () => {
  assert.deepEqual(Object.keys(BUILD_RAIL_NOTES), SIX);
  for (const slug of SIX) {
    const note = moduleRailNote('build', slug);
    assert.notEqual(note, undefined, slug);
    const rituals = /Monday|retro|annotat/i.test(note || '');
    assert.equal(rituals, slug === 'operating-systems', `${slug}: rituals`);
    assert.equal(/ordering/i.test(note || ''), slug === 'product-roadmap', `${slug}: ordering`);
    assert.equal(BUILD_ASKS[slug].some((a) => /Monday|retro/i.test(a)), slug === 'operating-systems', `${slug}: ritual asks`);
  }
  assert.equal(moduleRailNote('build', null), undefined, 'the overview keeps the desk\'s sentence');
  assert.equal(moduleRailNote('grow', 'operating-systems'), undefined);
  assert.equal(buildDef.asks, BUILD_ASKS);
  assert.equal(buildDef.railNotes, BUILD_RAIL_NOTES);
});

test('Connect a tool is the Build overview\'s primary only: no Build module header carries it; other cycles keep theirs', () => {
  assert.equal(primaryForModule('build', null, '?project_id=7').label, 'Connect a tool');
  for (const slug of SIX) assert.equal(primaryForModule('build', slug, '?project_id=7'), null, slug);
  assert.equal(primaryForModule('validate', 'experiments', '?project_id=7').label, 'Record a session');
  assert.equal(primaryForModule('raise', 'pitch-deck', '?project_id=7').label, 'Build your deck');
  assert.equal(buildDef.sourcesRegion, true);
});

test('BD7, BD8: from the first record, the connector parts sit in an open Sources region under the records, with Connect or manage tools', () => {
  const out = html(h(CycleModulePage, { cycle: 'build', slug: 'solution-design', data: { card, records: recs(3) }, add: ADD, action: null, query: {}, sources: part, sourcesAction: CONNECT, asks: BUILD_ASKS['solution-design'] }));
  assert.doesNotMatch(out, /data-testid="cycle-action"/, 'no Connect a tool in the header');
  assert.match(out, /<section[^>]*data-testid="module-sources"[^>]*data-stage="open"/);
  assert.match(text(out), /Sources · what your tools report/);
  assert.ok(out.indexOf('data-testid="cycle-records"') < out.indexOf('data-testid="module-sources"'), 'core work first');
  assert.ok(out.indexOf('data-testid="module-sources"') < out.indexOf('build-part-github'), 'the part is inside Sources');
  assert.match(out, /data-testid="module-sources-manage"[^>]*href="\/build\/connect\?project_id=7"[^>]*>Connect or manage tools →</);
  assert.doesNotMatch(out, /data-testid="module-ask"/, 'past zero the asks are the rail\'s, not the page\'s');
  // Eadwyn's bands (children) stay in place, above Sources.
  const banded = html(h(CycleModulePage, { cycle: 'build', slug: 'operating-systems', data: { card, records: recs(3) }, add: ADD, query: {}, sources: part, sourcesAction: CONNECT },
    h('div', { 'data-testid': 'zone-draft' }, 'Proposal · Monday plan')));
  assert.ok(banded.indexOf('zone-draft') < banded.indexOf('module-sources'));
  assert.doesNotMatch(banded, /<details[^>]*module-sources/);
});

test('BD18 A: at zero, no connector state shows: Sources is one closed line, and the module\'s Ask sits under the first action', () => {
  const out = html(h(CycleModulePage, { cycle: 'build', slug: 'solution-design', data: { card, records: recs(0) }, add: ADD, query: {}, sources: part, sourcesAction: CONNECT, asks: BUILD_ASKS['solution-design'] }));
  assert.match(out, /<details[^>]*data-testid="module-sources"[^>]*data-stage="zero"/);
  assert.doesNotMatch(out, /<details[^>]* open/);
  assert.ok(out.indexOf('records-zero-action') < out.indexOf('module-sources'));
  assert.match(text(out), /Sources What your tools report appears here once the first record exists/);
  assert.doesNotMatch(text(out), /Sources and Eadwyn drafts/, 'nothing but sources was handed');
  // A list of nulls and falses (CycleRoute's children on Build) is no Eadwyn band.
  const empty = html(h(CycleModulePage, { cycle: 'build', slug: 'solution-design', data: { card, records: recs(0) }, add: ADD, query: {} }, null, false, []));
  assert.doesNotMatch(empty, /module-sources/, 'nothing to fold, no fold');
  // Server rendering registers no rail, so Ask does not serve here and the block draws nothing.
  assert.doesNotMatch(out, /data-testid="module-ask"/);
});

test('BD18 A: the Ask block shows the module\'s asks, never a model, price or allowance, and needs Ask to serve', () => {
  const asks = BUILD_ASKS['prototype-mvp'];
  const out = renderToStaticMarkup(h(ModuleAskView, { asks, available: true, onAsk: () => {} }));
  assert.match(out, /aria-label="Ask Eadwyn about this module"/);
  assert.match(text(out), /Ask Eadwyn Suggestions never run on their own Ask about this module…/);
  for (const a of asks) assert.ok(text(out).includes(a), a);
  assert.equal((out.match(/data-testid="module-ask-chip"/g) || []).length, asks.length);
  assert.doesNotMatch(text(out), MODEL_WORDS);
  assert.equal(renderToStaticMarkup(h(ModuleAskView, { asks, available: false, onAsk: () => {} })), '', 'no Ask where it does not serve');
  assert.equal(renderToStaticMarkup(h(ModuleAskView, { asks: [], available: true, onAsk: () => {} })), '');
});

test('BD24 A: on the phone, zero folds Ask into one row and Sources into one line; past zero, Sources follows the rows', () => {
  const view = renderToStaticMarkup(h(PhoneAskEntryView, { asks: BUILD_ASKS['solution-design'], available: true, onOpen: () => {} }));
  assert.match(text(view), /Ask Eadwyn 3 suggestions for this module/);
  assert.doesNotMatch(text(view), MODEL_WORDS);
  assert.equal(renderToStaticMarkup(h(PhoneAskEntryView, { asks: BUILD_ASKS['solution-design'], available: false, onOpen: () => {} })), '');

  const zero = html(h(PhoneModulePage, { cycle: 'build', slug: 'solution-design', data: { card, records: recs(0) }, add: ADD, query: {}, sources: part, sourcesAction: CONNECT, asks: BUILD_ASKS['solution-design'] }));
  assert.match(zero, /<details[^>]*data-testid="module-sources"[^>]*data-stage="zero"/);
  assert.ok(zero.indexOf('phone-module-cta') < zero.indexOf('module-sources'));

  const few = html(h(PhoneModulePage, { cycle: 'build', slug: 'solution-design', data: { card, records: recs(2) }, add: ADD, query: {}, sources: part, sourcesAction: CONNECT, asks: BUILD_ASKS['solution-design'] }));
  assert.match(few, /<section[^>]*data-testid="module-sources"[^>]*data-stage="open"/);
  assert.ok(few.indexOf('phone-module-records') < few.indexOf('module-sources'), 'rows first');
  assert.match(few, /data-testid="module-sources-manage"/);
  assert.doesNotMatch(few, /data-testid="phone-module-ask"/, 'past zero, Ask is the bar\'s Eadwyn button');
});

test('BD21 A: with foldSettings the rail\'s models, safety line and usage sit inside one closed AI settings; without it, nothing moves', () => {
  const folded = renderToStaticMarkup(h(WorkerRail, { workspace: 'Build', prompts: BUILD_ASKS['solution-design'], foldSettings: true }));
  const fold = folded.indexOf('data-testid="worker-rail-ai-settings"');
  assert.ok(fold > 0, 'the fold is drawn');
  assert.match(folded, /<details class="fwr-settings" data-testid="worker-rail-ai-settings"><summary class="fwr-settings-summary">AI settings<\/summary>/);
  assert.doesNotMatch(folded, /<details class="fwr-settings"[^>]* open/);
  assert.ok(folded.indexOf('data-testid="worker-rail-suggestions"') > fold, 'the model block is inside the fold');
  assert.ok(folded.indexOf('data-testid="worker-rail-usage"') > fold, 'the usage is inside the fold');
  assert.ok(folded.indexOf('data-testid="text-worker-rail-safety"') > fold, 'the safety line is inside the fold');
  assert.ok(folded.indexOf('switch-worker-rail-ai-off') < fold, 'the AI switch stays at the top');

  const plain = renderToStaticMarkup(h(WorkerRail, { workspace: 'Build', prompts: BUILD_ASKS['solution-design'] }));
  assert.doesNotMatch(plain, /worker-rail-ai-settings|worker-rail-asks/);
  assert.match(plain, /data-testid="worker-rail-usage"/);
});

function Rail({ out, page = 'Founder · Build · Solution design', label = 'Build · Solution design' }) {
  useAskRail(true, page, label);
  out.ask = useAskPanel();
  return null;
}

test('an ask opens the one Ask panel with its words in the composer, and sends nothing; the rail lists the same asks first', async () => {
  __resetEadwynPanelForTest();
  const out = {};
  const asks = BUILD_ASKS['solution-design'];
  const m = await mountForm(h('div', null, h(Rail, { out }), h(ModuleAsk, { asks }), h(RailAsks, { prompts: asks, label: 'Build · Solution design' })));
  try {
    assert.equal(out.ask.available, true);
    assert.equal(out.ask.open, false);
    const chips = m.nodes().filter((n) => propsOf(n)['data-testid'] === 'module-ask-chip');
    assert.deepEqual(chips.map(textOf), [...asks]);
    const railAsks = m.nodes().filter((n) => propsOf(n)['data-testid'] === 'button-worker-rail-ask');
    assert.deepEqual(railAsks.map(textOf), [...asks], 'the rail and the page offer the same asks');

    await m.click(asks[1]);
    assert.equal(out.ask.open, true);
    assert.equal(out.ask.draft?.text, asks[1], 'the ask is in the composer');

    await m.click('Ask about this module…');
    assert.equal(out.ask.open, true);
    assert.equal(out.ask.draft, null, 'the box opens Ask empty');

    const first = m.nodes().find((n) => propsOf(n)['data-testid'] === 'button-worker-rail-ask');
    await act(async () => propsOf(first).onClick());
    assert.equal(out.ask.draft?.text, asks[0]);
    assert.equal(out.ask.label, 'Build · Solution design');
  } finally {
    await m.unmount();
    __resetEadwynPanelForTest();
  }
});

test('the Ask panel puts an opened ask in its composer and sends nothing', async () => {
  __resetEadwynPanelForTest();
  const out = {};
  const m = await mountForm(h('div', null, h(Rail, { out })));
  try {
    await act(async () => { (await import('../src/ui/eadwynPanel.js')).openAskPanel(undefined, 'Which features have no evidence link?'); });
    // No page key: the panel reads no conversation, and nothing is sent.
    await m.render(h('div', null, h(Rail, { out }), h(AskPanel, { page: null, label: 'Build · Solution design', aiOn: true, onClose: () => {} })));
    const box = m.nodes().find((n) => n.tagName === 'TEXTAREA' || (n.tagName === 'INPUT' && propsOf(n).type !== 'checkbox'));
    assert.ok(box, 'the composer');
    assert.equal(propsOf(box).value, 'Which features have no evidence link?');
    assert.equal(out.ask.open, true);
  } finally {
    await m.unmount();
    __resetEadwynPanelForTest();
  }
});

test('CycleRoute wires it: the asks reach the rail with its settings folded, and Build\'s parts go to Sources, not children', () => {
  const src = codeOnly(readFileSync(new URL('../src/pages/cycles/CycleRoute.jsx', import.meta.url), 'utf8'));
  assert.match(src, /const moduleAsks = slug && !narrativeAdmin && def\.asks && Object\.hasOwn\(def\.asks, slug\) \? def\.asks\[slug\] : null;/);
  assert.match(src, /<WorkerRail[\s\S]*?\{\.\.\.\(moduleNote !== undefined \? \{ note: moduleNote \} : \{\}\)\}\s*prompts=\{moduleAsks\}\s*foldSettings=\{Boolean\(moduleAsks\)\}/);
  assert.match(src, /const moduleSources = def\.sourcesRegion \? parts : null;/);
  assert.match(src, /sources=\{moduleSources\}\s*sourcesAction=\{def\.sourcesRegion && def\.action \? def\.action\(q, openAction\) : null\}\s*asks=\{moduleAsks\}/);
  assert.match(src, /\{def\.sourcesRegion \? null : parts\}/, 'other cycles keep their parts as children');
});
