/**
 * D8729 (#8729) — the founder Studio opens on the active venture and its next
 * action, on 1440 and on 390 × 844, and every link keeps that venture
 * (`design/incoming/Studio Home Founder Page.dc.html`, SFD00 to SFD16; the
 * owner took option A on Q1, Q2 and Q3 on 2026-11-27).
 *
 * Pinned here:
 *   · the venture is the first heading on both widths, and the Next card's one
 *     primary task comes before Eadwyn, the strip and the modules (SFD03, SFD12A, SFD14);
 *   · the Next card is the placed modules' own `card.next`, in layout order (Q2 A);
 *   · the task link opens the module's canonical `/new?project_id=` address, and
 *     the tile's Open link carries `?project_id=` (SFD07);
 *   · for two synthetic ventures, Open, the Next card task and the tile shortcut
 *     land in the selected venture, and Cancel (Back) returns to Studio in the
 *     same venture with focus on the control that left it (SFD06, SFD07);
 *   · the venture is resolved address → switcher's pick → the only venture →
 *     ask (Q1 A), and an unknown address is never swapped (SFD08, D4619);
 *   · a first venture, an unavailable venture and two ventures with none
 *     selected are separate paths (SFD08, SFD09, SFD10);
 *   · the Add feature dialog's first line names the venture (SFD05).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act, createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { installAppDom } from './_appDom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import FounderStudioBody from '../src/pages/founder/FounderStudioBody.jsx';
import { studioFromReads } from '../src/pages/studio/useStudioLayout.js';
import { startFounderStudioReads } from '../src/pages/founder/founderStudioReads.js';
import { NEXT, nextStepsOf, studioTaskLink, taskName, ventureHeadOf } from '../src/pages/founder/founderNextModel.js';
import { CHOOSE_REASON, chooseProject, unavailableProject } from '../src/pages/founder/founderStudioModel.js';
import { withVenture } from '../src/pages/studio/StudioModuleTile.jsx';

const USER = { name: '[Maya Ruiz]' };
const ATLAS = { id: 12, name: 'Atlas Orchard' };
const KILN = { id: 19, name: '[Kiln Ledger]' };
const VENTURES = [ATLAS, KILN];
const MODULES = { profile: 'founder', groups: [{ key: 'studio', label: 'Studio' }, { key: 'build', label: 'Build' }], modules: [
  { key: 'eadwyn_questions', title: 'Eadwyn’s questions', group: 'studio', purpose: 'p', href: null, default_size: '1/2', in_default: true, locked_by_plan: false, plan: null },
  { key: 'build_solution_design', title: 'Solution design', group: 'build', purpose: 'p', href: '/build/solution-design', default_size: '1/3', in_default: true, locked_by_plan: false, plan: null },
  { key: 'build_product_roadmap', title: 'Product roadmap', group: 'build', purpose: 'p', href: '/build/product-roadmap', default_size: '1/3', in_default: true, locked_by_plan: false, plan: null },
] };
const layoutOf = (keys) => ({ profile: 'founder', source: 'saved', layout: keys.map((key) => ({ key, size: '1/3' })), revision: 1, updated_at: null, dropped: [] });
const STUDIO = studioFromReads({ profile: 'founder', viewer: USER, modules: MODULES, layout: layoutOf(['build_solution_design', 'build_product_roadmap', 'eadwyn_questions']) });
const ADVISOR = { total: 24, answered: 18 };
const QUEUE = { queue: [{ id: 'q1', prompt: '[Who pays for yield records today?]' }] };
// The Worker's `next()` hrefs, as `cycle_build.ts` writes them (`?project=<id>`, `&add=1` for a first Add).
const buildRead = (v) => ({ cards: [
  { slug: 'solution-design', name: 'Solution design', state: 'empty', series: [], reason: 'No features yet. Linked and unlinked features appear here.', next: { text: 'Add feature', href: `/build/solution-design?project=${v.id}&add=1` } },
  { slug: 'product-roadmap', name: 'Product roadmap', state: 'ok', series: [], next: { text: 'Move the next planned item into Now', href: `/build/product-roadmap?project=${v.id}` } },
] });
const readsFor = (v) => ({ project: v, ventures: VENTURES, lab: { active: false }, advisor: ADVISOR, queue: QUEUE, lifecycle: { checklist: [] }, scores: [] });
const body = (props) => h(FounderStudioBody, { user: USER, onRetry() {}, studio: STUDIO, ...props });
const html = (el, url = '/studio?project_id=12') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [url] }, el));
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('the task link opens the module\'s canonical address for the venture Studio shows, and never another venture', () => {
  // Mutations checked: dropping the `/new` rewrite, or following a link that names another venture, fails this.
  assert.deepEqual(studioTaskLink('/build/solution-design?project=12&add=1', 12), { to: '/build/solution-design/new?project_id=12', add: true });
  assert.deepEqual(studioTaskLink('/build/product-roadmap?project=19', 19), { to: '/build/product-roadmap?project_id=19', add: false });
  assert.deepEqual(studioTaskLink('/raise/cap-table?project=12#holders', 12), { to: '/raise/cap-table?project_id=12#holders', add: false });
  assert.equal(studioTaskLink('/build/solution-design?project=19&add=1', 12), null, 'a link naming venture 19 is not followed from venture 12');
  assert.equal(studioTaskLink('https://example.test/x', 12), null);
  assert.equal(studioTaskLink('//evil.test/build', 12), null);
  assert.equal(taskName('Add feature', 'Atlas Orchard'), 'Add feature to Atlas Orchard');
  assert.equal(taskName('Link 2 features to a pain theme or hypothesis', '[Kiln Ledger]'), 'Link 2 features to a pain theme or hypothesis in [Kiln Ledger]');
  // The tile's Open link carries the venture; an href with its own query keeps it.
  assert.equal(withVenture('/build/solution-design', '?project_id=19'), '/build/solution-design?project_id=19');
  assert.equal(withVenture('/spinout-lab?tab=x', '?project_id=19'), '/spinout-lab?tab=x');
  assert.equal(withVenture('/build/solution-design', ''), '/build/solution-design');
});

test('the Next card is the placed modules\' own next steps, in layout order (Q2 A); a failed read is never "nothing to do"', () => {
  const cycles = { build: buildRead(ATLAS) };
  const reads = readsFor(ATLAS);
  const order = (keys) => nextStepsOf({ shown: layoutOf(keys).layout, cycles, reads, ventureId: 12 }).steps.map((s) => s.key);
  // Mutation checked: sorting the steps by key instead of by the layout fails the second assertion.
  assert.deepEqual(order(['build_solution_design', 'build_product_roadmap', 'eadwyn_questions']), ['build_solution_design', 'build_product_roadmap', 'eadwyn_questions']);
  assert.deepEqual(order(['eadwyn_questions', 'build_product_roadmap', 'build_solution_design']), ['eadwyn_questions', 'build_product_roadmap', 'build_solution_design']);
  assert.deepEqual(order(['build_product_roadmap']), ['build_product_roadmap'], 'an unplaced module adds no step');
  const first = nextStepsOf({ shown: layoutOf(['build_solution_design']).layout, cycles, reads, ventureId: 12 }).steps[0];
  assert.deepEqual({ source: first.source, text: first.text, to: first.to, add: first.add }, { source: 'Build · Solution design', text: 'Add feature', to: '/build/solution-design/new?project_id=12', add: true });
  const eadwyn = nextStepsOf({ shown: layoutOf(['eadwyn_questions']).layout, cycles, reads, ventureId: 12 }).steps[0];
  assert.equal(eadwyn.text, '6 questions are waiting on you');

  const shown = layoutOf(['build_solution_design']).layout;
  assert.equal(nextStepsOf({ shown, cycles: {}, reads, ventureId: 12 }).state, NEXT.LOADING, 'a placed cycle still reading holds the card');
  assert.equal(nextStepsOf({ shown, cycles, reads, ventureId: 12, layoutRead: 'loading' }).state, NEXT.LOADING);
  // Mutation checked: answering NONE for a failed read fails this.
  assert.equal(nextStepsOf({ shown, cycles: { build: { failed: 'down' } }, reads, ventureId: 12 }).state, NEXT.UNREADABLE);
  assert.equal(nextStepsOf({ shown, cycles: { build: { cards: [{ slug: 'solution-design', state: 'ok', next: null }] } }, reads, ventureId: 12 }).state, NEXT.NONE);
});

test('desktop: the venture is the first heading, then Next for it with Add feature as the one primary, then Eadwyn, the strip and the modules', () => {
  const out = html(body({ reads: readsFor(ATLAS), cycles: { build: buildRead(ATLAS) }, search: '?project_id=12' }, ), '/studio?project_id=12');
  // Mutation checked: drawing the venture as an h2 (or "Studio" as the h1) fails this.
  const firstHeading = out.match(/<h([1-6])[^>]*>(.*?)<\/h\1>/);
  assert.deepEqual([firstHeading[1], firstHeading[2]], ['1', 'Atlas Orchard']);
  assert.match(out, /<h2 id="studio-next-title"[^>]*>Next for Atlas Orchard<\/h2>/);
  const primary = out.match(/<a [^>]*data-testid="link-studio-next-primary"[^>]*>/)[0];
  assert.match(primary, /href="\/build\/solution-design\/new\?project_id=12"/);
  assert.match(primary, /aria-label="Add feature to Atlas Orchard"/);
  assert.match(primary, /class="sm-btn sm-btn-p/);
  assert.equal((out.match(/sm-btn-p/g) || []).length, 1, 'one primary action on the page');
  const at = (s) => out.indexOf(s);
  assert.ok(at('data-testid="link-studio-next-primary"') < at('data-testid="section-founder-advisor"'), 'venture work comes before Eadwyn');
  assert.ok(at('data-testid="section-founder-advisor"') < at('data-testid="founder-studio-strip"') && at('data-testid="founder-studio-strip"') < at('data-testid="studio-modules"'));
  assert.match(out, /button-studio-switch-venture/);
  assert.match(out, /aria-label="Eadwyn AI"/);
  // The tile's Open link and its own task shortcut keep the venture (SFD07).
  assert.match(out, /<a [^>]*data-testid="studio-tile-open-build_solution_design" href="\/build\/solution-design\?project_id=12"/);
  assert.match(out, /<a [^>]*id="studio-tile-next-build_solution_design"[^>]*href="\/build\/solution-design\/new\?project_id=12"/);
});

test('phone 390 × 844: the venture heading, Switch and the primary task come before the collapsed Eadwyn row and the strip (Q3 A)', () => {
  const out = html(body({ reads: readsFor(ATLAS), cycles: { build: buildRead(ATLAS) }, phone: true, children: h('div', null, 'STUB CHAT') }));
  const at = (s) => out.indexOf(s);
  const firstHeading = out.match(/<h([1-6])[^>]*>(.*?)<\/h\1>/);
  assert.deepEqual([firstHeading[1], firstHeading[2]], ['1', 'Atlas Orchard']);
  // Mutation checked: moving the Eadwyn row above the Next card fails this.
  assert.ok(at('text-founder-studio-title') < at('link-studio-next-primary') && at('link-studio-next-primary') < at('studio-eadwyn-row'));
  assert.ok(at('studio-eadwyn-row') < at('STUB CHAT') && at('STUB CHAT') < at('founder-studio-strip'));
  assert.match(out, /<section id="studio-chat" hidden=""/, 'the chat is mounted but collapsed');
  assert.match(out, /aria-expanded="false" aria-controls="studio-chat"/);
  assert.match(out, />Switch</);
  assert.match(out, /Today · Atlas Orchard · 6 questions waiting/);
  // The ticket form or a tab named in the address opens the row.
  assert.doesNotMatch(html(body({ reads: readsFor(ATLAS), cycles: { build: buildRead(ATLAS) }, phone: true, eadwynOpen: true })), /<section id="studio-chat" hidden=""/);
  // The bar above is not a heading any more.
  assert.doesNotMatch(codeOnly(read('../src/pages/founder/StudioPhone.jsx')), /<h1/);
});

test('two synthetic ventures: each link Studio writes names only the selected venture (SFD07)', () => {
  for (const [v, other] of [[ATLAS, KILN], [KILN, ATLAS]]) {
    const out = html(body({ reads: readsFor(v), cycles: { build: buildRead(v) }, search: `?project_id=${v.id}` }), `/studio?project_id=${v.id}`);
    const hrefs = [...out.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((x) => x.startsWith('/build'));
    assert.ok(hrefs.length >= 4, `the venture links are drawn: ${hrefs}`);
    for (const href of hrefs) {
      assert.match(href, new RegExp(`[?&]project_id=${v.id}(&|$|#)`), `${href} keeps ${v.name}`);
      assert.doesNotMatch(href, new RegExp(`project(_id)?=${other.id}\\b`), `${href} names the other venture`);
    }
  }
});

const reactProps = (node) => Object.entries(node).find(([key]) => key.startsWith('__reactProps$'))[1];
const click = (node) => act(async () => reactProps(node).onClick({ button: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, currentTarget: node, target: node }));

/** Studio and the module page under one router, so a task link, Cancel (Back) and the way back run for real. */
function mountReturn(v) {
  const probe = {};
  function Module() {
    const location = useLocation();
    const navigate = useNavigate();
    probe.module = location;
    // CycleRoute's closeAdd: an Add pushed from a page goes Back to it.
    probe.cancel = () => (location.state?.under ? navigate(-1) : navigate('/build/solution-design', { replace: true }));
    return h('p', { 'data-testid': 'module-page' }, location.pathname);
  }
  function Studio() {
    const location = useLocation();
    probe.studio = location;
    probe.navigate = useNavigate();
    return body({ reads: readsFor(v), cycles: { build: buildRead(v) }, search: `?project_id=${v.id}` });
  }
  const app = h(MemoryRouter, { initialEntries: [`/studio?project_id=${v.id}`] }, h(Routes, null,
    h(Route, { path: '/studio', element: h(Studio) }),
    h(Route, { path: '/build/solution-design/new', element: h(Module) }),
    h(Route, { path: '/build/solution-design', element: h(Module) }),
    h(Route, { path: '/build/product-roadmap', element: h(Module) })));
  return { probe, app };
}

test('mounted, for two ventures: the Next card task and the tile shortcut land in the selected venture, and Cancel returns to Studio there with focus on the control that left', async (t) => {
  const { document, restore } = installAppDom({ url: 'http://localhost/studio' });
  t.after(restore);
  for (const v of [ATLAS, KILN]) {
    const { probe, app } = mountReturn(v);
    const root = createRoot(document.body.appendChild(document.createElement('div')));
    await act(async () => root.render(app));
    for (const id of ['studio-next-build_solution_design', 'studio-tile-next-build_solution_design']) {
      const link = document.getElementById(id);
      assert.ok(link, `${id} is drawn for ${v.name}`);
      await click(link);
      // Mutation checked: dropping `state.under` from StudioTaskLink makes Cancel replace to the module page, and this fails.
      assert.equal(`${probe.module.pathname}${probe.module.search}`, `/build/solution-design/new?project_id=${v.id}`, `${id} opens the Add for ${v.name}`);
      assert.equal(probe.module.state.under, `/studio?project_id=${v.id}`);
      assert.equal(probe.module.state.venture, v.name, 'the dialog can name the venture it was opened for');
      await act(async () => probe.cancel());
      assert.equal(`${probe.studio.pathname}${probe.studio.search}`, `/studio?project_id=${v.id}`, `Cancel returns to Studio in ${v.name}`);
      // Mutation checked: not stamping Studio's own entry with `focus` (or dropping useReturnFocus) fails this.
      // Compared by identity: a failure message must not serialise the document.
      assert.ok(document.activeElement === document.getElementById(id), `focus is back on ${id}, not ${document.activeElement?.id || document.activeElement?.tagName}`);
    }
    // The tile's Open link, then Back (the browser's), lands and returns in the same venture.
    const open = document.querySelector('[data-testid="studio-tile-open-build_solution_design"]');
    assert.equal(open.getAttribute('href'), `/build/solution-design?project_id=${v.id}`);
    await click(open);
    assert.equal(`${probe.module.pathname}${probe.module.search}`, `/build/solution-design?project_id=${v.id}`);
    await act(async () => probe.navigate(-1));
    assert.equal(`${probe.studio.pathname}${probe.studio.search}`, `/studio?project_id=${v.id}`);
    await act(async () => root.unmount());
  }
});

function world(projects, { fail = false } = {}) {
  const calls = [];
  const committed = {};
  const client = {
    listProjects: async () => { calls.push('projects'); if (fail) throw new Error('projects down'); return projects; },
    getLifecycle: async (id) => { calls.push(`lifecycle:${id}`); return {}; },
    getScores: async (id) => { calls.push(`scores:${id}`); return []; },
    advisor: { progress: async () => ({}), queue: async () => ({}) },
  };
  const lab = { state: async () => ({}) };
  return {
    calls, committed,
    run: (requestedProjectId, preferredProjectId = null) => startFounderStudioReads({ requestedProjectId, preferredProjectId, client, lab, onRead: (k, v) => { committed[k] = v; } }),
  };
}

test('the venture is resolved address → the switcher\'s pick → the only venture → ask (Q1 A), and an unknown address is never swapped', async () => {
  let w = world(VENTURES);
  await w.run('19', '12');
  assert.deepEqual(w.committed.project, KILN, 'the address wins over the pick');
  w = world(VENTURES);
  await w.run(null, '19');
  // Mutation checked: ignoring `preferredProjectId` reads the first venture (or asks) here.
  assert.deepEqual(w.committed.project, KILN, 'with no address, the switcher\'s pick');
  assert.deepEqual(w.committed.ventures, [{ id: 12, name: 'Atlas Orchard' }, { id: 19, name: '[Kiln Ledger]' }]);
  w = world([KILN]);
  await w.run(null, '99');
  assert.deepEqual(w.committed.project, KILN, 'a pick that is not one of theirs falls to the only venture');
  w = world(VENTURES);
  await w.run(null, null);
  // Mutation checked: taking the first venture here (option B) fails this.
  assert.deepEqual(w.committed.project, chooseProject(2), 'two ventures and none selected: ask');
  assert.equal(w.committed.project.failed, CHOOSE_REASON);
  assert.equal(w.calls.some((c) => c.startsWith('lifecycle') || c.startsWith('scores')), false, 'nothing is read for a venture not chosen');
  w = world(VENTURES);
  await w.run('7', '12');
  assert.deepEqual(w.committed.project, unavailableProject('7'), 'an address naming no venture of theirs is unavailable, never the pick');
  w = world([]);
  await w.run(null, '12');
  assert.equal(w.committed.project, null, 'no venture at all is the first-venture path');
  w = world(VENTURES, { fail: true });
  await w.run(null, null);
  assert.equal(w.committed.ventures.failed, 'projects down');
});

test('separate paths: first venture, unavailable venture, two ventures with none selected, and a failed projects read (SFD08 to SFD10)', () => {
  assert.equal(ventureHeadOf({ project: undefined }).kind, 'loading');
  assert.deepEqual(ventureHeadOf({ project: ATLAS, ventures: VENTURES }), { kind: 'venture', title: 'Atlas Orchard' });
  assert.deepEqual(ventureHeadOf({ project: null, ventures: [] }), { kind: 'first', title: 'Studio' });
  assert.deepEqual(ventureHeadOf({ project: unavailableProject('7'), ventures: VENTURES }), { kind: 'unavailable', title: 'Venture not available' });
  assert.deepEqual(ventureHeadOf({ project: chooseProject(2), ventures: VENTURES }), { kind: 'choose', title: 'Studio' });
  assert.deepEqual(ventureHeadOf({ project: { failed: 'down' }, ventures: { failed: 'down' } }), { kind: 'unreadable', title: 'Studio' });

  const first = html(body({ reads: { ...readsFor(null), project: null, ventures: [] } }), '/studio');
  assert.match(first, /<h1[^>]*>Studio<\/h1>/);
  assert.match(first, /Start your first venture/);
  assert.match(first, /href="\/build\?new=1"[^>]*>Create your startup</);
  assert.doesNotMatch(first, /button-studio-switch-venture|studio-next-title/);

  const unavailable = html(body({ reads: { ...readsFor(null), project: unavailableProject('7'), lifecycle: unavailableProject('7'), scores: unavailableProject('7') } }), '/studio?project_id=7');
  assert.match(unavailable, /<h1[^>]*>Venture not available<\/h1>/);
  // Mutation checked: the bare "Open your Studio" link in place of the member's ventures fails this.
  assert.match(unavailable, /href="\/studio\?project_id=12"[^>]*>.*Atlas Orchard/);
  assert.match(unavailable, /href="\/studio\?project_id=19"[^>]*>.*\[Kiln Ledger\]/);
  assert.doesNotMatch(unavailable, /link-founder-project-unavailable-studio|Next for/);

  const choose = html(body({ reads: { ...readsFor(null), project: chooseProject(2), lifecycle: chooseProject(2), scores: chooseProject(2) } }), '/studio');
  assert.match(choose, /<h2 id="studio-choose-title"[^>]*>Which venture are you working on\?<\/h2>/);
  assert.match(choose, /You have 2\. Studio opens the one you pick\./);
  assert.match(choose, /href="\/studio\?project_id=12"/);
  assert.match(choose, /href="\/studio\?project_id=19"/);
  assert.doesNotMatch(choose, /Next for/);

  const failed = html(body({ reads: { ...readsFor(null), project: { failed: 'down' }, ventures: { failed: 'down' }, lifecycle: { failed: 'down' }, scores: { failed: 'down' } } }), '/studio');
  assert.match(failed, /Your ventures could not be read\. This is not a sign that you have none\./);
  assert.match(failed, />.*Try again</);
});

test('the Add feature dialog is kept, with a first line naming the venture it was opened for (SFD05)', () => {
  const lightbox = codeOnly(read('../src/pages/cycles/FormLightbox.jsx'));
  assert.match(lightbox, /const eyebrow = \[typeof venture === 'string' && venture\.trim\(\) \? venture\.trim\(\) : null, CYCLES\[cycleKey\]\?\.name \|\| cycle, name\]/);
  const route = codeOnly(read('../src/pages/cycles/CycleRoute.jsx'));
  // Only for the venture in the address, and only when the dialog was opened from a page (`state.under`).
  assert.match(route, /venture=\{location\.state\?\.under && location\.state\?\.ventureId != null && String\(location\.state\.ventureId\) === String\(projectId\) \? location\.state\.venture : null\}/);
  // closeAdd still goes Back when `state.under` is set, which is the way back to Studio.
  assert.match(route, /const closeAdd = \(\) => \{\n\s+if \(location\.state\?\.under\) \{ navigate\(-1\); return; \}/);
});

test('the keyboard layout controls are kept, and the venture header and Next card are not tiles (SFD13)', () => {
  const tile = codeOnly(read('../src/pages/studio/StudioModuleTile.jsx'));
  assert.match(tile, /Press Space to lift, then the arrow keys\./);
  assert.match(tile, /role="radiogroup"/);
  const grid = codeOnly(read('../src/pages/studio/StudioModuleGrid.jsx'));
  assert.match(grid, /aria-live|announce/);
  const editing = html(body({ reads: readsFor(ATLAS), cycles: { build: buildRead(ATLAS) }, studio: { ...STUDIO, editing: true } }));
  // The Next card stays put and dims with the other fixed blocks while the grid is edited.
  assert.match(editing, /class="[^"]*sm-dim[^"]*" aria-labelledby="studio-next-title"/);
});
