/**
 * D1419 (#3698) — the Studio modularity canvas on all four Studios: the fixed
 * blocks, the module grid over the Worker's layout store (D1421, D1418,
 * D1594), Customise with Done as the one save, the module map, the notices,
 * no AIRail on /studio, the founder's modules below 1024px, and the seam for
 * Eadwyn's layout proposals (#3864).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/studio_canvas_d1419.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';
import {
  STUDIO_MAX, TILE, add, canAdd, cycleKey, cycleTileState, cyclesPlaced, droppedLines, layoutProfileFor, move, moveDown, moveUp,
  readFailureOf, recommended, remove, resize, saveFailureOf, search, toSave, CYCLE_KEYS,
} from '../src/pages/studio/studioLayoutModel.js';
import { FALLBACK_DEFAULTS, FALLBACK_TITLES, fallbackLayout } from '../src/pages/studio/studioFallback.js';
import { deriveStudio, studioFromReads, useStudioLayout } from '../src/pages/studio/useStudioLayout.js';
import StudioModules, { EMPTY_LINE } from '../src/pages/studio/StudioModules.jsx';
import { TileBody } from '../src/pages/studio/StudioModuleTile.jsx';
import { ModuleMapBody } from '../src/pages/studio/ModuleMapLightbox.jsx';
import { CustomiseButton } from '../src/pages/studio/StudioParts.jsx';
import { PROPOSALS_ISSUE, applyProposal, propose } from '../src/pages/studio/studioProposalsAdapter.js';
import { founderNoStoreTiles } from '../src/pages/studio/tiles/founderTiles.jsx';
import FounderStudioBody from '../src/pages/founder/FounderStudioBody.jsx';
import { summaryOf } from '../src/pages/founder/founderStudioModel.js';
import { NO_RAIL_ROUTES } from '../src/lib/railPages.js';
import { RENDER_NOT_YET } from './_airailRender.mjs';

const h = React.createElement;
const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (el) => renderedText(html(el));

// The Worker's answers (D1418, D1594), as `GET /api/studio/modules` and `/layout` send them.
const mod = (key, title, group, size, extra = {}) => ({ key, title, group, purpose: `${title}, in a line.`, href: null, default_size: size, in_default: false, cohort_only: false, locked_by_plan: false, plan: null, ...extra });
const FOUNDER = {
  profile: 'founder',
  groups: [{ key: 'studio', label: 'Studio' }, { key: 'validate', label: 'Validate' }, { key: 'raise', label: 'Raise' }],
  modules: [
    mod('company_progress', 'Company progress', 'studio', 'full', { in_default: true }),
    mod('eadwyn_questions', 'Eadwyn’s questions', 'studio', '1/2', { in_default: true }),
    mod('lab_tools', 'Lab tools', 'studio', '1/2', { in_default: true, href: '/spinout-lab' }),
    mod('validate_customer_research', 'Customer research', 'validate', '1/3', { href: '/validate/customer-research' }),
    mod('validate_experiments', 'Experiments and evidence', 'validate', '1/3', { href: '/validate/experiments' }),
    mod('raise_cap_table', 'Cap table', 'raise', '1/3', { locked_by_plan: true, plan: { tier: 'studio', name: 'Raise + Grow', plan_key: 'founder_growth' } }),
  ],
};
const DEFAULT = { profile: 'founder', source: 'default', layout: [{ key: 'company_progress', size: 'full' }, { key: 'eadwyn_questions', size: '1/2' }, { key: 'lab_tools', size: '1/2' }], revision: null, updated_at: null, dropped: [] };
const ready = (title) => ({ state: TILE.READY, body: h('p', null, `${title} body`) });
const TILES = { company_progress: ready('Company progress'), eadwyn_questions: ready('Questions'), lab_tools: ready('Lab tools'), validate_customer_research: ready('Customer research') };
const member = { role: 'founder', name: 'Fay Founder' };
const founder = (over = {}) => studioFromReads({ profile: 'founder', viewer: member, modules: FOUNDER, layout: DEFAULT, ...over });

// ---------------------------------------------------------------- the intake

test('the intake: both canvases landed in design/incoming with support.js, the grid imports the page, and D1419 records them', () => {
  const page = read('design/incoming/Studio Modularity Page.dc.html');
  const grid = read('design/incoming/Studio Modularity · Boards.dc.html');
  for (const f of [page, grid]) assert.ok(f.includes('src="./support.js"'));
  assert.match(grid, /dc-import name="Studio Modularity Page"/);
  assert.ok(page.includes("sm13a") && page.includes("sm14") && page.includes("sm12a"), 'the page draws the boards');
  assert.ok(page.includes('src="/axal-mark.png"') && page.includes('src="/eadwyn-ai.png"'), 'the two named image edits');
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(page + grid), 'an asset uuid was left unresolved');
  assert.ok(existsSync(new URL('../../documentation/architecture/decisions/D1419.md', import.meta.url)));
});

test('the fallback default is held equal to the Worker’s STUDIO_DEFAULTS and titles, key for key', () => {
  // Mutations checked: a size changed (Earnings at 1/2), a key dropped, a title retyped.
  const ts = read('cloudflare-worker/src/services/studioModules.ts');
  const block = ts.slice(ts.indexOf('export const STUDIO_DEFAULTS'), ts.indexOf('};', ts.indexOf('export const STUDIO_DEFAULTS')));
  const worker = {};
  for (const m of block.matchAll(/(\w+): \[([\s\S]*?)\],/g)) worker[m[1]] = [...m[2].matchAll(/\{ key: '(\w+)', size: '([^']+)' \}/g)].map((x) => ({ key: x[1], size: x[2] }));
  assert.deepEqual(Object.keys(worker).sort(), ['advisor', 'founder', 'investor', 'partner']);
  assert.deepEqual(JSON.parse(JSON.stringify(FALLBACK_DEFAULTS)), worker);
  const titles = Object.fromEntries([...ts.matchAll(/\{ key: '(\w+)', profile: '\w+', title: '([^']+)'/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual({ ...FALLBACK_TITLES }, titles);
  // A copy, so an edit never reaches the table.
  const copy = fallbackLayout('founder'); copy[0].size = '1/3';
  assert.equal(FALLBACK_DEFAULTS.founder[0].size, 'full');
});

test('the cycle module keys are the Worker’s, one per module of the four cycles', () => {
  assert.equal(Object.keys(CYCLE_KEYS).length, 27);
  assert.equal(cycleKey('build', 'prototype-mvp'), 'build_prototype_mvp');
  assert.deepEqual(CYCLE_KEYS.raise_cap_table, { cycle: 'raise', slug: 'cap-table', name: 'Cap table' });
  assert.deepEqual(cyclesPlaced([{ key: 'raise_cap_table' }, { key: 'raise_data_room' }, { key: 'lab_tools' }, { key: 'validate_verdict' }]), ['raise', 'validate']);
});

// ---------------------------------------------------------------- the model

test('edits are local and bounded: move, Move up and Move down, add at the end at its size, the cap of 12, remove, resize', () => {
  const l = DEFAULT.layout;
  assert.deepEqual(moveDown(l, 'company_progress').map((e) => e.key), ['eadwyn_questions', 'company_progress', 'lab_tools']);
  assert.deepEqual(moveUp(l, 'lab_tools').map((e) => e.key), ['company_progress', 'lab_tools', 'eadwyn_questions']);
  assert.deepEqual(moveUp(l, 'company_progress'), l, 'the first cannot move up');
  assert.deepEqual(move(l, 0, 2).map((e) => e.key), ['eadwyn_questions', 'lab_tools', 'company_progress']);
  const added = add(l, FOUNDER.modules[3]);
  assert.deepEqual(added.at(-1), { key: 'validate_customer_research', size: '1/3' }, 'added at the end, at its default size');
  assert.equal(add(added, FOUNDER.modules[3]).length, 4, 'placed once');
  assert.equal(add(l, FOUNDER.modules[5]).length, 3, 'a plan-locked module is never added');
  const twelve = Array.from({ length: STUDIO_MAX }, (_, i) => ({ key: `m${i}`, size: '1/3' }));
  assert.equal(canAdd(twelve), false);
  assert.equal(add(twelve, FOUNDER.modules[3]).length, STUDIO_MAX, 'the cap holds');
  assert.deepEqual(remove(l, 'lab_tools').map((e) => e.key), ['company_progress', 'eadwyn_questions']);
  assert.equal(resize(l, 'lab_tools', 'full')[2].size, 'full');
  assert.equal(resize(l, 'lab_tools', '2/3')[2].size, '1/2', 'a size the Worker refuses is never set');
  assert.deepEqual(toSave([{ key: 'a', size: '1/3', title: 'x', locked_by_plan: false }]), [{ key: 'a', size: '1/3' }]);
});

test('Recommended is the unplaced defaults, never a locked one; search reads titles and purposes', () => {
  assert.deepEqual(recommended(FOUNDER.modules, [{ key: 'company_progress' }]).map((m) => m.key), ['eadwyn_questions', 'lab_tools']);
  assert.deepEqual(recommended([{ ...FOUNDER.modules[5], in_default: true }], []), []);
  assert.deepEqual(search(FOUNDER.modules, 'cap').map((m) => m.key), ['raise_cap_table']);
  assert.deepEqual(search(FOUNDER.modules, 'pricing calculator'), []);
});

test('a dropped module is named by its title, never by its key, with why it left', () => {
  // Mutation checked: falling back to `d.key` when the title is null turns this red.
  const lines = droppedLines([
    { key: 'raise_data_room', title: 'Data room', reason: 'plan', plan: { name: 'Raise + Grow' } },
    { key: 'founder_actions', title: 'Do these next', reason: 'not_offered', plan: null },
    { key: 'gone_key_x', title: null, reason: 'not_offered', plan: null },
  ]);
  assert.deepEqual(lines, [
    'Data room was removed from your layout because it is no longer available on your plan.',
    'Do these next was removed from your layout because your Studio no longer offers it.',
    'A module was removed from your layout because your Studio no longer offers it.',
  ]);
  assert.ok(!lines.join(' ').includes('_'), 'a key reached the page');
});

test('refusals are read by status and code: no Studio, an unreadable row, a stale save, a locked module', () => {
  assert.equal(readFailureOf({ status: 403, code: 'no_studio_profile' }), 'no_profile');
  assert.equal(readFailureOf({ status: 500, code: 'layout_unreadable' }), 'layout_unreadable');
  assert.equal(readFailureOf({ status: 503 }), 'failed');
  assert.deepEqual(saveFailureOf({ status: 409, code: 'stale_layout', data: { revision: 4 } }), { kind: 'stale' });
  assert.deepEqual(saveFailureOf({ status: 402, code: 'module_locked', data: { key: 'raise_cap_table', plan: { name: 'Raise + Grow' } } }), { kind: 'locked', key: 'raise_cap_table', plan: { name: 'Raise + Grow' } });
  assert.deepEqual(saveFailureOf({ status: 400, code: 'too_many_modules' }), { kind: 'failed' });
});

test('an administrator always names the profile; a member never does', () => {
  assert.equal(layoutProfileFor({ role: 'admin' }, 'investor'), 'investor');
  assert.equal(layoutProfileFor({ role: 'investor' }, 'investor'), undefined);
  const admin = deriveStudio({ profile: 'investor', viewer: { role: 'admin' }, modules: FOUNDER, layout: DEFAULT });
  assert.equal(admin.canCustomise, false, 'an admin preview has no Customise (SM11)');
  assert.equal(admin.readOnly, true);
});

// ---------------------------------------------------------------- the tile

test('the tile frame’s states: Not recorded is never 0 and never red; a failed read is "could not be read · Try again", alone', () => {
  // Mutations checked: Not recorded drawn as 0; the claim sentence added back to the failed read.
  const nr = html(h(TileBody, { title: 'Holding progress', spec: { state: TILE.NOT_RECORDED, reason: 'No store yet.' } }));
  assert.match(renderedText(nr), /^Not recordedNo store yet\.$/);
  assert.doesNotMatch(nr, /sm-err|text-red|\b0\b/);
  const bad = renderedText(html(h(TileBody, { title: 'Eadwyn’s questions', spec: { state: TILE.UNREADABLE, onRetry() {} } })));
  assert.equal(bad, 'Eadwyn’s questions could not be read · Try again');
  assert.match(text(h(TileBody, { title: 'x', spec: { state: TILE.LOADING } })), /^Reading…$/);
  assert.equal(text(h(TileBody, { title: 'x', spec: { state: TILE.EMPTY, empty: 'No question is waiting on you.' } })), 'No question is waiting on you.');
  assert.equal(text(h(TileBody, { title: 'x', spec: { state: TILE.WITHHELD } })), 'Withheld in administrator preview');
  assert.equal(text(h(TileBody, { title: 'x', spec: ready('X') })), 'X body');
});

test('a cycle module is its card on the cycle’s overview: loading, could not be read, not recorded, or ready', () => {
  assert.equal(cycleTileState(undefined, 'cap-table').state, TILE.LOADING);
  assert.equal(cycleTileState({ failed: 'x' }, 'cap-table').state, TILE.UNREADABLE);
  assert.equal(cycleTileState({ noProject: true }, 'cap-table').state, TILE.NOT_RECORDED);
  assert.equal(cycleTileState({ cards: [{ slug: 'cap-table', state: 'not_recorded', reason: 'No round yet.' }] }, 'cap-table').reason, 'No round yet.');
  assert.equal(cycleTileState({ cards: [{ slug: 'cap-table', state: 'ok', series: [] }] }, 'cap-table').state, TILE.READY);
});

// ---------------------------------------------------------------- the page

test('the fixed blocks are drawn in every layout, an empty one included, and never carry an edit control', () => {
  // Mutation checked: giving the strip a handle (or dropping its lock) turns this red.
  for (const studio of [founder(), founder({ layout: { ...DEFAULT, source: 'saved', layout: [], revision: 3 } }), founder({ editing: true, draft: DEFAULT.layout })]) {
    const out = html(h(FounderStudioBody, { user: member, reads: {}, onRetry() {}, studio }));
    const strip = out.slice(out.indexOf('data-testid="founder-studio-strip"'), out.indexOf('data-testid="zone-founder-profile"'));
    const profile = out.slice(out.indexOf('data-testid="zone-founder-profile"'), out.indexOf('data-testid="studio-modules"'));
    for (const block of [strip, profile]) {
      assert.match(block, /aria-label="Fixed: always on your Studio"/);
      assert.doesNotMatch(block, /aria-label="Move |aria-label="Remove |aria-label="Size of /);
    }
  }
  const editing = html(h(FounderStudioBody, { user: member, reads: {}, onRetry() {}, studio: founder({ editing: true, draft: DEFAULT.layout }) }));
  assert.match(editing, /aria-label="Move Company progress\. Press Space to lift, then the arrow keys\."/);
  assert.match(editing, /role="radiogroup" aria-label="Size of Lab tools"/);
  assert.match(editing, /aria-label="Remove Eadwyn’s questions"/);
  // The no-store blocks are drawn but never edited: the Worker does not offer them (D1418 §3).
  assert.doesNotMatch(editing, /aria-label="Move Holding progress|aria-label="Remove What this adds up to/);
  assert.match(renderedText(editing), /3 of 12 modules/);
});

test('the founder’s two no-store blocks read Not recorded with their reason, never a 0', () => {
  const t = text(h(FounderStudioBody, { user: member, reads: {}, onRetry() {}, studio: founder() }));
  for (const x of founderNoStoreTiles()) {
    assert.ok(t.includes(`${x.title}Not recorded${x.spec.reason}`), x.title);
  }
  assert.doesNotMatch(t, /Holding progress0|What this adds up to0/);
});

test('SM8a: a failed layout read draws the default with its note and Try again, and offers no Customise', () => {
  const failed = founder({ layout: { failed: true, kind: 'failed' } });
  assert.deepEqual(failed.placed, FALLBACK_DEFAULTS.founder);
  assert.equal(failed.canCustomise, false);
  const t = text(h(StudioModules, { studio: failed, tiles: TILES }));
  assert.match(t, /^Your layout could not be read; showing the default\.Try again/);
  for (const title of ['Company progress', 'Eadwyn’s questions', 'Lab tools']) assert.ok(t.includes(title), title);
  assert.equal(html(h(CustomiseButton, { studio: failed })), '');
  const row = text(h(StudioModules, { studio: founder({ layout: { failed: true, kind: 'layout_unreadable' } }), tiles: TILES }));
  assert.match(row, /Your saved layout could not be read; showing the default\.Reset to default/);
});

test('SM8d: a saved empty layout stays empty and never falls back to the default', () => {
  // Mutation checked: treating `[]` like a missing row draws the default here.
  const empty = founder({ layout: { ...DEFAULT, source: 'saved', layout: [], revision: 2 } });
  assert.deepEqual(empty.placed, []);
  const t = text(h(StudioModules, { studio: empty, tiles: TILES }));
  assert.ok(t.includes(EMPTY_LINE));
  assert.match(t, /0 of 12 placed/);
  assert.doesNotMatch(t, /Company progress|Lab tools/);
});

test('SM8b: dropped modules are named above the grid; SM12a: no Studio profile says so', () => {
  const t = text(h(StudioModules, { studio: founder({ layout: { ...DEFAULT, source: 'saved', revision: 1, dropped: [{ key: 'raise_data_room', title: 'Data room', reason: 'plan', plan: null }] } }), tiles: TILES }));
  assert.match(t, /Data room was removed from your layout because it is no longer available on your plan\./);
  assert.doesNotMatch(t, /raise_data_room/);
  const none = html(h(StudioModules, { studio: founder({ layout: { failed: true, kind: 'no_profile' } }), tiles: TILES }));
  assert.match(renderedText(none), /Studio layouts are for founder, investor, advisor and operating partner profiles\.Choose a profile/);
  assert.match(none, /href="\/onboarding"/);
});

test('the module map: groups, Recommended, a locked entry names its plan, the cap turns every Add off, and an empty search says so', () => {
  // Mutations checked: Add left on at 12; the plan name dropped from the locked line.
  const body = (draft, query = '') => text(h(ModuleMapBody, { profile: 'founder', catalogue: FOUNDER.modules, groups: FOUNDER.groups, draft, onAdd() {}, onLocked() {}, query }));
  const open = body(DEFAULT.layout.slice(0, 1));
  assert.match(open, /Founder modules · 1 of 12 placed/);
  assert.match(open, /Recommended for you2/);
  assert.match(open, /Included in Raise \+ Grow/);
  assert.match(open, /Studio3.*Validate2.*Raise1/);
  const twelve = [...DEFAULT.layout, ...Array.from({ length: 9 }, (_, i) => ({ key: `x${i}`, size: '1/3' }))];
  const full = html(h(ModuleMapBody, { profile: 'founder', catalogue: FOUNDER.modules, groups: FOUNDER.groups, draft: twelve, onAdd() {}, onLocked() {} }));
  assert.match(renderedText(full), /Your Studio holds 12 modules\. Remove one to add another\./);
  const adds = [...full.matchAll(/<button[^>]*class="sm-add"[^>]*>/g)].map((m) => m[0]);
  assert.ok(adds.length >= 2 && adds.every((b) => b.includes('aria-disabled="true"')), 'an Add is still on at 12');
  assert.doesNotMatch(renderedText(full), /Recommended for you/);
  assert.match(body(DEFAULT.layout, 'pricing calculator'), /No module matches “pricing calculator”\.\s*Clear the search/);
});

test('the strip keeps main’s labels: Company progress in a cohort, Venture progress outside one (owner answer I)', () => {
  assert.equal(summaryOf({ lab: { active: true, week: 1, milestones: [] } })[0].k, 'Company progress');
  assert.equal(summaryOf({ lab: { active: false }, lifecycle: { checklist: [{ done: true }] } })[0].k, 'Venture progress');
});

test('below 1024px the founder body draws the strip, the profile card and the modules, with Customise in a bottom bar', () => {
  const out = html(h(FounderStudioBody, { user: member, reads: {}, onRetry() {}, studio: founder(), phone: true }));
  assert.doesNotMatch(out, /data-testid="text-founder-studio-title"|data-testid="section-founder-advisor"/, 'the phone draws its own bar and chat above');
  const at = (id) => out.indexOf(`data-testid="${id}"`);
  assert.ok(at('founder-studio-strip') < at('zone-founder-profile') && at('zone-founder-profile') < at('studio-modules') && at('studio-modules') < at('studio-phone-customise'));
});

// ---------------------------------------------------------------- the hook, mounted

function fakeApi({ layout = DEFAULT, modules = FOUNDER, save = null } = {}) {
  const calls = [];
  return {
    calls,
    modules: async (p) => { calls.push(['modules', p]); return modules; },
    layout: async (p) => { calls.push(['layout', p]); return layout; },
    saveLayout: async (l, rev, p) => { calls.push(['save', l, rev, p]); if (save) throw save; return { ...layout, source: 'saved', layout: l, revision: (rev || 0) + 1 }; },
    resetLayout: async (p) => { calls.push(['reset', p]); return DEFAULT; },
  };
}

async function mount({ api, viewer = member, profile = 'founder', readOnly = false }) {
  const restore = installDocument();
  const previous = globalThis.matchMedia;
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  function Page() {
    const studio = useStudioLayout({ profile, viewer, readOnly, api });
    return h('div', null, h(CustomiseButton, { studio }), h(StudioModules, { studio, tiles: TILES }));
  }
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => root.render(h(MemoryRouter, null, h(Page))));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const find = (pred) => walk(container).find((n) => { const p = props(n); return p && pred(p, n); });
  const call = async (pred, name, arg) => { const n = find(pred); assert.ok(n, 'no such control'); await act(async () => { props(n)[name](arg); }); await settle(); };
  return {
    text: () => textOf(container),
    has: (pred) => Boolean(find(pred)),
    click: (pred) => call(pred, 'onClick', { stopPropagation() {}, preventDefault() {} }),
    key: (pred, key) => call(pred, 'onKeyDown', { key, preventDefault() {} }),
    order: () => walk(container).filter((n) => props(n)?.['data-testid']?.startsWith('studio-tile-') && n.tagName === 'ARTICLE').map((n) => props(n)['data-testid'].slice('studio-tile-'.length)),
    async close() { await act(async () => root.unmount()); globalThis.matchMedia = previous; restore(); },
  };
}

const byTestId = (id) => (p) => p['data-testid'] === id;
const byLabel = (label) => (p) => p['aria-label'] === label;

test('Customise: Space lifts, the arrow keys move, Done saves once with [{ key, size }] and the read’s revision', async () => {
  // Mutations checked: saving per move (two calls); sending the draft with extra fields; dropping the revision.
  const api = fakeApi({ layout: { ...DEFAULT, source: 'saved', revision: 5 } });
  const v = await mount({ api });
  try {
    assert.deepEqual(api.calls, [['modules', undefined], ['layout', undefined]], 'a member never names their profile');
    await v.click(byTestId('button-studio-customise'));
    assert.match(v.text(), /Customise your Studio/);
    const handle = byLabel('Move Company progress. Press Space to lift, then the arrow keys.');
    await v.key(handle, ' ');
    await v.key(handle, 'ArrowDown');
    await v.key(handle, 'ArrowDown');
    await v.key(handle, ' ');
    assert.deepEqual(v.order(), ['eadwyn_questions', 'lab_tools', 'company_progress']);
    // Move up through the ⋯ menu.
    await v.click(byLabel('More for Lab tools'));
    await v.click((p) => p.role === 'menuitem' && p.children === 'Move up');
    assert.deepEqual(v.order(), ['lab_tools', 'eadwyn_questions', 'company_progress']);
    await v.click(byLabel('Remove Eadwyn’s questions'));
    assert.equal(api.calls.filter((c) => c[0] === 'save').length, 0, 'nothing saves before Done');
    await v.click(byTestId('button-studio-done'));
    const saves = api.calls.filter((c) => c[0] === 'save');
    assert.equal(saves.length, 1);
    assert.deepEqual(saves[0], ['save', [{ key: 'lab_tools', size: '1/2' }, { key: 'company_progress', size: 'full' }], 5, undefined]);
    assert.match(v.text(), /Saved/);
    assert.doesNotMatch(v.text(), /Customise your Studio/);
  } finally { await v.close(); }
});

test('Escape puts a lifted module back; Done with nothing changed saves nothing', async () => {
  const api = fakeApi();
  const v = await mount({ api });
  try {
    await v.click(byTestId('button-studio-customise'));
    const handle = byLabel('Move Lab tools. Press Space to lift, then the arrow keys.');
    await v.key(handle, ' ');
    await v.key(handle, 'ArrowUp');
    await v.key(handle, 'Escape');
    assert.deepEqual(v.order(), ['company_progress', 'eadwyn_questions', 'lab_tools']);
    await v.click(byTestId('button-studio-done'));
    assert.equal(api.calls.filter((c) => c[0] === 'save').length, 0);
  } finally { await v.close(); }
});

test('a failed save keeps the edits: 409 is "changed in another tab" with Reload layout; 402 names the plan', async () => {
  for (const [err, line, button] of [
    [Object.assign(new Error('x'), { status: 409, code: 'stale_layout', data: { revision: 9 } }), /Your layout changed in another tab\./, 'Reload layout'],
    [Object.assign(new Error('x'), { status: 402, code: 'module_locked', data: { key: 'lab_tools', plan: { name: 'Raise + Grow' } } }), /Lab tools is not on your plan\. Included in Raise \+ Grow\./, 'See plans'],
    [Object.assign(new Error('x'), { status: 503 }), /Your layout could not be saved\./, 'Try again'],
  ]) {
    const v = await mount({ api: fakeApi({ save: err }) });
    try {
      await v.click(byTestId('button-studio-customise'));
      await v.click(byLabel('Remove Lab tools'));
      await v.click(byTestId('button-studio-done'));
      assert.match(v.text(), line);
      assert.ok(v.text().includes(button), button);
      assert.match(v.text(), /Customise your Studio/, 'edit mode was left');
      assert.deepEqual(v.order(), ['company_progress', 'eadwyn_questions'], 'the edits were lost');
    } finally { await v.close(); }
  }
});

test('an administrator previewing sends the profile on every read and is offered no Customise (SM11)', async () => {
  // Mutation checked: not sending `profile` for an admin (every read is 400 invalid_profile).
  const api = fakeApi();
  const v = await mount({ api, viewer: { role: 'admin', name: 'Hal Admin' }, profile: 'investor', readOnly: true });
  try {
    assert.deepEqual(api.calls, [['modules', 'investor'], ['layout', 'investor']]);
    assert.equal(v.has(byTestId('button-studio-customise')), false);
    assert.match(v.text(), /Default layout3 modules/);
  } finally { await v.close(); }
});

test('the 12 cap: the edit bar counts placed modules, and the module map turns Add off', async () => {
  const twelve = { ...DEFAULT, source: 'saved', revision: 1, layout: Array.from({ length: 12 }, (_, i) => ({ key: `x${i}`, size: '1/3' })) };
  const v = await mount({ api: fakeApi({ layout: twelve }) });
  try {
    await v.click(byTestId('button-studio-customise'));
    assert.match(v.text(), /12 of 12 modules/);
    await v.click(byTestId('button-studio-add'));
    assert.match(v.text(), /Your Studio holds 12 modules\. Remove one to add another\./);
    assert.ok(v.has((p) => p['aria-label'] === 'Add Customer research' && p['aria-disabled'] === 'true'));
  } finally { await v.close(); }
});

// ---------------------------------------------------------------- the rail, the seam, the house rules

test('no AIRail on /studio for any profile: railCount 0 rows for every member Studio, no rail in the homes, and the ratchet lines are gone', () => {
  // Mutation checked: removing the founder/investor/partner row (the census then expects a rail).
  for (const role of ['founder', 'investor', 'advisor', 'partner']) {
    const row = NO_RAIL_ROUTES.find((n) => n.route === '/studio' && n.railCount === 0 && n.roles.includes(role));
    assert.ok(row, role);
    assert.match(row.why, /Owner request/);
  }
  assert.ok(NO_RAIL_ROUTES.some((n) => n.route === '/studio/tickets/new' && n.railCount === 0 && n.roles.includes('founder')));
  const listed = Object.values(RENDER_NOT_YET).flat();
  for (const name of ['Founder /studio', 'Founder /studio/tickets/new', 'Investor /studio']) assert.ok(!listed.includes(name), name);
  for (const f of ['frontend/src/pages/founder/FounderStudioBody.jsx', 'frontend/src/pages/investor/InvestorStudioHome.jsx', 'frontend/src/pages/advisor/AdvisorStudioHome.jsx', 'frontend/src/pages/partner/PartnerStudioHome.jsx', 'frontend/src/pages/partner/PartnerHomeP2.jsx']) {
    assert.doesNotMatch(codeOnly(read(f)), /<RailFrame\b|<WorkerRail\b|AssistRail/, f);
  }
});

test('Eadwyn’s layout proposals go through the seam, unavailable and keyed to #3864, until its route exists', async () => {
  // Tripwire: the day the Worker grows the `studio:layout` run, `propose` must stop answering unavailable.
  assert.deepEqual(await propose('founder'), { available: false, reason: 'Eadwyn’s layout proposals aren’t available yet.', issue: '#3864' });
  assert.equal(PROPOSALS_ISSUE, '#3864');
  const worker = readdirSync(new URL('../../cloudflare-worker/src/routes/', import.meta.url)).map((f) => read(join('cloudflare-worker/src/routes', f))).join('\n');
  const wired = /['"]studio:layout['"]/.test(worker);
  const seam = codeOnly(read('frontend/src/pages/studio/studioProposalsAdapter.js'));
  if (wired) assert.doesNotMatch(seam, /export const propose = async \([^)]*\) => unavailable\(\);/, '#3864 landed: wire propose through its client method');
  else assert.match(seam, /export const propose = async \([^)]*\) => unavailable\(\);/);
  // Accept applies rows to a copy and never places what the Worker would refuse.
  const after = applyProposal(DEFAULT.layout, [{ op: 'add', key: 'validate_customer_research', size: '1/2' }, { op: 'add', key: 'raise_cap_table' }, { op: 'add', key: 'nope' }, { op: 'remove', key: 'lab_tools' }], FOUNDER.modules);
  assert.deepEqual(after, [{ key: 'company_progress', size: 'full' }, { key: 'eadwyn_questions', size: '1/2' }, { key: 'validate_customer_research', size: '1/2' }]);
  assert.equal(DEFAULT.layout.length, 3, 'the layout passed in was changed');
});

test('house rules across the Studio files: no /api path outside the client, no "Fill", no email, no zero for an absent figure', () => {
  const dir = new URL('../src/pages/studio/', import.meta.url);
  const files = [];
  const walk = (u, rel = '') => { for (const e of readdirSync(u, { withFileTypes: true })) { if (e.isDirectory()) walk(new URL(`${e.name}/`, u), `${rel}${e.name}/`); else if (/\.(jsx?|mjs)$/.test(e.name)) files.push(`frontend/src/pages/studio/${rel}${e.name}`); } };
  walk(dir);
  assert.ok(files.length >= 10, files.join(', '));
  for (const f of [...files, 'frontend/src/pages/founder/FounderStudioBody.jsx', 'frontend/src/pages/partner/PartnerHomeP2.jsx']) {
    const code = codeOnly(read(f));
    assert.doesNotMatch(code, /['"`]\/api\//, `${f} names an /api path`);
    assert.doesNotMatch(code, /\bFill\b/, `${f} says Fill`);
    assert.doesNotMatch(code, /\.email\b/, `${f} reads an email`);
    assert.doesNotMatch(code, /(\|\||\?\?)\s*0\b/, `${f} falls back to 0`);
  }
  // The client is the Worker's: four methods, no fifth for a route that does not exist.
  const client = codeOnly(read('frontend/src/lib/api/studioLayout.js'));
  assert.deepEqual([...client.matchAll(/^\s{2}(\w+): \(/gm)].map((m) => m[1]), ['modules', 'layout', 'saveLayout', 'resetLayout']);
});
