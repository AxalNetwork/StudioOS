/**
 * D686 §5.1 (#1596) — the cycle lightbox plumbing: the shell's residuals
 * (`size`, `onEscape`, the Tab filter, the scroll lock on the app scroller),
 * one Escape stack shared with `useEscapeClose`, `ActionSheet`, the four action
 * routes and three history redirects, and the history tab.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/cycle_lightbox_d686.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import Lightbox from '../src/ui/Lightbox.jsx';
import ActionSheet, { primary, ghost, danger } from '../src/ui/ActionSheet.jsx';
import { ActionSheet as Barrel } from '../src/ui/index.js';
import { lockScroll, scrollLocks, tabbable } from '../src/ui/lightboxFocus.js';
import { useEscapeClose } from '../src/components/useEscapeClose.js';
import { CYCLES, cycleTabs } from '../src/pages/cycles/cycleModel.js';
import { CycleHeader } from '../src/pages/cycles/CycleOverview.jsx';
import CycleRoute, { underSlug, underModule } from '../src/pages/cycles/CycleRoute.jsx';
import { MODULES } from '../src/pages/cycles/modules.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');

// ── The shell ────────────────────────────────────────────────────────────────

test('size "tall" is a fixed height whose body does not scroll; "fit" is unchanged; the canvas backdrop and shadow', () => {
  const tall = renderToStaticMarkup(h(Lightbox, { label: 'x', size: 'tall', onClose() {} }, h('p', null, 'B')));
  assert.match(tall, /h-\[min\(820px,calc\(100dvh-40px\)\)\]/);
  assert.match(tall, /data-testid="lightbox-body" class="min-h-0 flex-1 overflow-hidden"|class="min-h-0 flex-1 overflow-hidden" data-testid="lightbox-body"/);
  assert.doesNotMatch(tall, /max-h-\[min\(92vh,820px\)\]/);
  assert.match(tall, /max-sm:h-full/, 'still full screen on a phone');
  const fit = renderToStaticMarkup(h(Lightbox, { label: 'x', onClose() {} }, h('p', null, 'B')));
  assert.match(fit, /max-h-\[min\(92vh,820px\)\]/);
  assert.match(fit, /overflow-y-auto overscroll-contain/);
  assert.doesNotMatch(fit, /100dvh-40px/);
  assert.match(fit, /bg-zinc-900\/\[\.42\]/);
  assert.match(fit, /shadow-\[0_24px_64px_rgba\(24,24,27,\.24\)\]/);
  assert.match(fit, /p-5 max-sm:p-0/);
  assert.doesNotMatch(fit, /transform|animate-|filter /, 'a nested fixed dialog would be clipped by a transformed box');
});

async function mounted(element) {
  const restoreDoc = installDocument();
  const docKeys = []; const winKeys = [];
  const createElement = document.createElement.bind(document);
  document.createElement = (tag) => {
    const n = createElement(tag);
    n.querySelector = () => null; n.querySelectorAll = () => []; n.focus = function focus() { document.activeElement = this; };
    n.children = []; n.isConnected = true;
    return n;
  };
  document.addEventListener = (type, fn) => { if (type === 'keydown') docKeys.push(fn); };
  document.removeEventListener = (type, fn) => { const i = docKeys.indexOf(fn); if (i >= 0) docKeys.splice(i, 1); };
  const savedWin = [globalThis.addEventListener, globalThis.removeEventListener];
  globalThis.addEventListener = (type, fn) => { if (type === 'keydown') winKeys.push(fn); };
  globalThis.removeEventListener = (type, fn) => { const i = winKeys.indexOf(fn); if (i >= 0) winKeys.splice(i, 1); };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const render = (el) => act(async () => { root.render(el); });
  await render(element);
  /** An Escape as the browser delivers it: the document first, then the window. */
  const escape = async () => {
    const e = { key: 'Escape', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    await act(async () => { for (const fn of [...docKeys]) fn(e); for (const fn of [...winKeys]) fn(e); });
    return e;
  };
  return {
    render, escape, docKeys, winKeys, container,
    async unmount() { await act(async () => root.unmount()); [globalThis.addEventListener, globalThis.removeEventListener] = savedWin; restoreDoc(); },
  };
}

test('onEscape replaces onClose for the key; an Escape already handled is ignored', async () => {
  const log = [];
  const m = await mounted(h(Lightbox, { label: 'x', onClose: () => log.push('close'), onEscape: () => log.push('escape') }, h('button', null, 'ok')));
  try {
    await m.escape();
    assert.deepEqual(log, ['escape']);
    const handled = { key: 'Escape', defaultPrevented: true, preventDefault() {} };
    for (const fn of m.docKeys) fn(handled);
    assert.deepEqual(log, ['escape'], 'a defaultPrevented Escape does nothing');
  } finally { await m.unmount(); }
});

function Nested({ log }) {
  useEscapeClose(() => log.push('nested'));
  return h('div', { role: 'dialog', 'aria-modal': 'true' }, 'nested');
}

test('one Escape closes one layer: the nested dialog first, then the lightbox', async () => {
  const log = [];
  const tree = (nested) => h(Lightbox, { label: 'x', onClose: () => log.push('lightbox') }, nested ? h(Nested, { log }) : h('p', null, 'body'));
  const m = await mounted(tree(false));
  try {
    await m.render(tree(true));
    const first = await m.escape();
    assert.deepEqual(log, ['nested'], 'only the dialog on top acts');
    assert.equal(first.defaultPrevented, true);
    await m.render(tree(false));
    await m.escape();
    assert.deepEqual(log, ['nested', 'lightbox']);
    assert.equal(m.winKeys.length, 0, 'the nested dialog let go of its listener');
  } finally { await m.unmount(); }
});

test('a dialog under a lightbox stays open while the lightbox takes the Escape', async () => {
  const log = [];
  const tree = (lb) => h('div', null, h(Nested, { log }), lb ? h(Lightbox, { label: 'x', onClose: () => log.push('lightbox') }, h('p', null, 'b')) : null);
  const m = await mounted(tree(false));
  try {
    await m.render(tree(true));
    await m.escape();
    assert.deepEqual(log, ['lightbox'], 'the dialog underneath is not on top, so it does not close too');
  } finally { await m.unmount(); }
});

function Closed({ log, open }) {
  useEscapeClose(() => log.push('closed-modal'), { active: open });
  return null;
}

test('a modal mounted but closed is not on the stack, so it never swallows the lightbox\'s Escape', async () => {
  const log = [];
  const m = await mounted(h('div', null, h(Lightbox, { label: 'x', onClose: () => log.push('lightbox') }, h('p', null, 'b')), h(Closed, { log, open: false })));
  try {
    await m.escape();
    assert.deepEqual(log, ['lightbox']);
    assert.equal(m.winKeys.length, 0);
  } finally { await m.unmount(); }
});

test('the hooks and modals that bound Escape on their own now use the one stack', () => {
  const rail = read('frontend/src/ui/WorkerRail.jsx');
  assert.match(rail, /useEscapeClose\(\(\) => dispatchSheet\(\{ type: 'escape' \}\), \{ active: sheet\.open \}\);/);
  assert.doesNotMatch(rail, /document\.addEventListener\('keydown'/);
  assert.match(read('frontend/src/components/PaywallModal.jsx'), /useEscapeClose\(\(\) => setOpen\(false\), \{ active: open \}\);/);
  assert.match(read('frontend/src/components/StepUpModal.jsx'), /useEscapeClose\(cancel, \{ active: open \}\);/);
  assert.match(read('frontend/src/components/KeyboardShortcutsOverlay.jsx'), /useEscapeClose\(\(\) => setOpen\(false\), \{ active: open \}\);/);
  assert.match(read('frontend/src/components/useEscapeClose.js'), /MOUNT ORDER/);
});

// ── Tab and the scroll lock ──────────────────────────────────────────────────

function node(attrs = {}, rects = 1) {
  return { attrs, parentNode: null, hasAttribute(k) { return k in this.attrs; }, getClientRects() { return { length: rects }; } };
}
function box(controls, modals = []) {
  return { attrs: {}, hasAttribute() { return false; }, querySelectorAll(sel) { return sel === '[aria-modal="true"]' ? modals : controls; } };
}

test('Tab keeps a fixed control (no offsetParent) and drops an inert, hidden or undrawn one; a nested modal scopes it', () => {
  const b = box([]);
  const fixed = node(); fixed.offsetParent = null; fixed.parentNode = b;
  const undrawn = node({}, 0); undrawn.parentNode = b;
  const inertWrap = node({ inert: '' }); inertWrap.parentNode = b;
  const insideInert = node(); insideInert.parentNode = inertWrap;
  const hiddenWrap = node({ hidden: '' }); hiddenWrap.parentNode = b;
  const insideHidden = node(); insideHidden.parentNode = hiddenWrap;
  const all = [fixed, undrawn, insideInert, insideHidden];
  const scope = box(all);
  scope.querySelectorAll = (sel) => (sel === '[aria-modal="true"]' ? [] : all);
  assert.deepEqual(tabbable(scope), [fixed]);
  assert.deepEqual(tabbable(scope, undrawn), [fixed, undrawn], 'the focused control is never dropped');
  const inner = node(); const nestedModal = { querySelectorAll: () => [inner] }; inner.parentNode = nestedModal;
  const outer = box([fixed, inner], [nestedModal]);
  assert.deepEqual(tabbable(outer), [inner], 'Tab stays inside the innermost modal dialog');
  assert.deepEqual(tabbable(null), []);
  assert.match(read('frontend/src/ui/Lightbox.jsx'), /const list = tabbable\(el, document\.activeElement\);/, 're-read on every Tab');
});

test('the scroll lock also holds the app scroller, and puts its overflow and position back on the last close', () => {
  const body = { style: { overflow: 'auto', paddingRight: '' } };
  const app = { style: { overflow: 'scroll', scrollbarGutter: '' }, scrollTop: 340 };
  const r1 = lockScroll(body, [app]);
  assert.equal(app.style.overflow, 'hidden');
  assert.equal(app.style.scrollbarGutter, 'stable');
  const r2 = lockScroll(body, [app]);
  app.scrollTop = 0;
  r1();
  assert.equal(app.style.overflow, 'hidden', 'one dialog still open');
  r2();
  assert.equal(scrollLocks(), 0);
  assert.deepEqual([app.style.overflow, app.style.scrollbarGutter, app.scrollTop, body.style.overflow], ['scroll', '', 340, 'auto']);
});

// ── ActionSheet ──────────────────────────────────────────────────────────────

test('ActionSheet: the header, the pills with aria-current, the banner role, the footNote, the × and the dark classes', () => {
  const out = renderToStaticMarkup(h(ActionSheet, {
    eyebrow: 'Raise', title: 'Call for Capital', titleId: 'cfc', sub: 'A call is never public.', onClose() {},
    steps: ['The round', 'Materials', 'Audience'], step: 1, banner: { tone: 'error', text: 'Unreadable' }, footNote: 'Step 2 of 3',
    footer: h('button', { className: primary }, 'Next'),
  }, h('p', null, 'BODY')));
  assert.match(out, /<h2 id="cfc"[^>]*>Call for Capital<\/h2>/);
  assert.match(out, /uppercase[^"]*">Raise</);
  assert.match(out, /aria-label="Close"[^>]*>×<\/button>|<button[^>]*aria-label="Close"/);
  assert.match(out, /h-\[30px\] w-\[30px\][^"]*rounded-full/);
  assert.match(out, /<li class="[^"]*bg-violet-50 text-violet-700[^"]*">1 · The round<\/li>/, 'a done step');
  assert.match(out, /<li aria-current="step" class="[^"]*bg-violet-600 text-white[^"]*">2 · Materials<\/li>/, 'the current step');
  assert.match(out, /<li class="[^"]*border border-axal-hairline text-axal-muted[^"]*">3 · Audience<\/li>/, 'a step to do');
  assert.match(out, /role="alert" data-tone="error"/);
  assert.match(out, /min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4[^>]*>.*BODY/);
  assert.match(out, /Step 2 of 3/);
  for (const dark of ['dark:border-gray-800', 'dark:text-gray-100', 'dark:bg-violet-500', 'dark:bg-red-950/40']) assert.ok(out.includes(dark), dark);
  for (const cls of [primary, ghost, danger]) assert.match(cls, /dark:/);
  assert.match(renderToStaticMarkup(h(ActionSheet, { title: 'x', banner: { tone: 'info', text: 'Saved' } })), /role="status"/);
  assert.doesNotMatch(renderToStaticMarkup(h(ActionSheet, { title: 'x' })), /aria-label="Close"|aria-label="Steps"|<footer/, 'nothing it was not given');
  assert.equal(Barrel, ActionSheet);
});

// ── Routes ───────────────────────────────────────────────────────────────────

test('the three action routes are literal routes with their guard and `lightbox`, ahead of their slug route; the redirects keep the search and add the hash', () => {
  const app = read('frontend/src/App.jsx');
  const routes = [
    ['/build/connect', "guard(['admin', 'founder'], <CycleRoute cycle=\"build\" lightbox />)", '/build/:slug'],
    ['/raise/call', "guard(labRoles(['admin', 'founder']), <CycleRoute cycle=\"raise\" lightbox />)", '/raise/:slug'],
    ['/grow/update', "guard(['admin', 'founder'], <CycleRoute cycle=\"grow\" lightbox />)", '/grow/:slug'],
    ['/validate/record', "guard(labRoles(['admin', 'founder']), <CycleRoute cycle=\"validate\" lightbox />)", '/validate/:slug'],
  ];
  for (const [path, element, slug] of routes) {
    const at = app.indexOf(`<Route path="${path}" element={`);
    assert.ok(at > 0, path);
    const line = app.slice(at, app.indexOf('\n', at));
    assert.ok(line.includes(element), `${path} → ${element}`);
    assert.doesNotMatch(line, /<Navigate/);
    assert.ok(at < app.indexOf(`<Route path="${slug}"`), `${path} is declared before ${slug}`);
  }
  for (const [path, to, hash] of [['/build/tools', '/build/operating-systems', '#tools'], ['/raise/calls', '/raise/capital-relationships', '#calls'], ['/grow/updates', '/grow/durable-company-building', '#updates']]) {
    assert.match(app, new RegExp(`<Route path="${path}" element=\\{guard\\([^\\n]*<HistoryRedirect to="${to}" hash="${hash}" />\\)\\} />`), path);
  }
  assert.match(app, /export function HistoryRedirect\(\{ to, hash \}\) \{\s*const location = useLocation\(\);\s*return <Navigate replace to=\{\{ pathname: to, search: location\.search, hash \}\} \/>;/);
});

test('one mechanism: each cycle names its path and Mount; opening pushes state.under; closing and finishing follow the rules', () => {
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  for (const [cycle, path, mount] of [['validate', 'record', 'ValidateMount'], ['build', 'connect', 'BuildMount'], ['raise', 'call', 'RaiseMount'], ['grow', 'update', 'GrowMount']]) {
    const def = route.slice(route.indexOf(`\n  ${cycle}: {`), route.indexOf('\n  },', route.indexOf(`\n  ${cycle}: {`)));
    assert.match(def, new RegExp(`path: '${path}',\\s*Mount: ${mount},`), cycle);
    assert.match(def, new RegExp(`href: \`/${cycle}/${path}\\$\\{q\\}\`, onOpen: open`), `${cycle} keeps the venture and opens in place`);
  }
  assert.doesNotMatch(route, /href: '\/round-calls'/, 'Raise no longer drops the venture');
  assert.doesNotMatch(route, /sheetOpen|def\.sheet|onClick: open/);
  assert.equal((route.match(/<Mount projectId=\{projectId\}/g) || []).length, 1, 'one mount for every cycle');
  assert.match(route, /fnOf\(def\.parts, slug\)\?\.\(module, \{ projectId, reload: \(\) => setReload\(\(n\) => n \+ 1\), openAction \}\)/);
  assert.match(route, /if \(!lightbox && dirty\.current\) \{ dirty\.current = false; setReload\(\(n\) => n \+ 1\); \}/, 'a change reloads once the lightbox is gone, not behind it');
  const close = route.slice(route.indexOf('const closeAction = () => {'), route.indexOf('};', route.indexOf('const closeAction = () => {')));
  assert.doesNotMatch(close, /dirty|setReload/, 'one place re-reads: the effect on leaving the lightbox, which Back reaches too');
  assert.equal(underSlug('/raise/capital-relationships?project_id=7', 'raise', 'call'), 'capital-relationships');
  assert.equal(underSlug('/raise/call?project_id=7', 'raise', 'call'), null, 'the action route is not a module');
  assert.equal(underSlug('/grow/distribution', 'raise', 'call'), null, 'another cycle\'s path is not this one\'s');
  assert.equal(underModule(MODULES.build, '/build/operating-systems', 'build', 'connect'), 'operating-systems');
  assert.equal(underModule(MODULES.build, '/build/roadmap', 'build', 'connect'), null, 'a tool page is not a module');
});

test('the CTA says it opens a dialog only when it does', () => {
  const opens = renderToStaticMarkup(h(MemoryRouter, null, h(CycleHeader, { cycle: 'raise', cards: [], action: { label: 'Call for Capital', href: '/raise/call?project_id=7', onOpen() {} } })));
  assert.match(opens, /href="\/raise\/call\?project_id=7"[^>]*aria-haspopup="dialog"|aria-haspopup="dialog"[^>]*href="\/raise\/call\?project_id=7"/);
  const link = renderToStaticMarkup(h(MemoryRouter, null, h(CycleHeader, { cycle: 'raise', cards: [], action: { label: 'Call for Capital', href: '/raise/call?project_id=7' } })));
  assert.doesNotMatch(link, /aria-haspopup/);
});

// ── The history tab ──────────────────────────────────────────────────────────

const cards = (cycle) => MODULES[cycle].map((m) => ({ slug: m.slug, name: m.name }));

test('history: Interviews second in Validate; a history that is not live is not drawn; none without module tabs', () => {
  assert.deepEqual(cycleTabs('validate', cards('validate'), null, '?project_id=7').slice(0, 2).map((t) => [t.name, t.href]), [['Overview', '/validate?project_id=7'], ['Interviews', '/validate/interviews?project_id=7']]);
  assert.equal(cycleTabs('validate', cards('validate'), 'interviews').find((t) => t.key === 'interviews').active, true);
  for (const c of ['grow']) {
    assert.equal(CYCLES[c].history.live, false, `${c} goes live when its section ships`);
    assert.equal(cycleTabs(c, cards(c)).some((t) => t.key === CYCLES[c].history.key), false, `${c} draws no history yet`);
  }
  // #1598: Raise's Calls section shipped, so its history is live.
  assert.equal(CYCLES.raise.history.live, true);
  assert.equal(cycleTabs('raise', cards('raise')).some((t) => t.key === 'calls'), true);
  assert.deepEqual(cycleTabs('validate', []).map((t) => t.name), ['Overview'], 'no history tab without module tabs');
  assert.deepEqual(cycleTabs('validate', [{ slug: 'x', name: 'Interviews' }]).filter((t) => t.name === 'Interviews').length, 1, 'never twice');
});

test('Build\'s Tools is live now its section ships (#1597): second, on Operating systems\' #tools, keeping the venture', () => {
  assert.equal(CYCLES.build.history.live, true);
  const tabs = cycleTabs('build', cards('build'), 'operating-systems', '?project_id=7');
  assert.deepEqual([tabs[1].key, tabs[1].name, tabs[1].href, tabs[1].active], ['tools', 'Tools', '/build/operating-systems?project_id=7#tools', false]);
  assert.equal(tabs.filter((t) => t.name === 'Tools').length, 1);
  assert.equal(tabs.find((t) => t.key === 'operating-systems').active, true, 'the module tab keeps aria-current');
  assert.match(read('frontend/src/pages/cycles/ToolsHistory.jsx'), /<section id="tools"/, 'the hash lands on the section');
});

test('a live history keeps ?project_id= and its hash, and is never current outside Validate', () => {
  const saved = CYCLES.raise.history.live;
  CYCLES.raise.history.live = true;
  try {
    const tabs = cycleTabs('raise', cards('raise'), 'capital-relationships', '?project_id=7');
    assert.deepEqual([tabs[1].name, tabs[1].href, tabs[1].active], ['Calls', '/raise/capital-relationships?project_id=7#calls', false]);
    assert.equal(tabs.find((t) => t.key === 'capital-relationships').active, true, 'the module tab keeps aria-current');
    const out = renderToStaticMarkup(h(MemoryRouter, null, h(CycleHeader, { cycle: 'raise', cards: cards('raise'), active: 'capital-relationships', search: '?project_id=7' })));
    const values = [...out.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(values).size, values.length, 'the phone select has one value per tab');
    assert.match(out, /<option value="calls">Calls<\/option>/);
  } finally { CYCLES.raise.history.live = saved; }
});

test('every live history path is a static route in App.jsx or a module of its cycle', () => {
  const app = read('frontend/src/App.jsx');
  for (const c of Object.keys(CYCLES)) {
    const hist = CYCLES[c].history;
    if (!hist) continue;
    const slug = hist.path.split('/')[2];
    assert.ok(app.includes(`<Route path="${hist.path}"`) || MODULES[c].some((m) => m.slug === slug), `${c}: ${hist.path}`);
  }
});

// ── Validate keeps the venture ───────────────────────────────────────────────

test('the Validate tools read the venture from the address, and their links keep it', () => {
  const ws = read('frontend/src/workspaces/founder/FounderValidateWorkspace.jsx');
  assert.match(ws, /const asked = Number\(searchParams\.get\('project_id'\) \|\| searchParams\.get\('project'\)\) \|\| null;/);
  assert.match(ws, /if \(asked\) \{ setProjectId\(asked\); setReady\(true\); return undefined; \}/, 'the first venture only when none is asked for');
  assert.equal((ws.match(/to=\{`\/validate\/interviews\$\{keep\}`\}/g) || []).length, 2);
  assert.match(read('frontend/src/workspaces/ZoneNav.jsx'), /to=\{`\$\{zonePath\(bucket, zone\)\}\$\{projectSearch\(location\.search\)\}`\}/);
  assert.match(read('frontend/src/pages/cycles/founderToolNavigation.js'), /\{ path: '\/validate\/interviews', cycle: 'validate', module: 'customer-research' \}/);
});

// ── The re-read after a change, however the lightbox closes ──────────────────

/** The first component in the rendered tree whose function has this name. */
function fiberNamed(container, name) {
  const key = Object.keys(container).find((k) => k.startsWith('__reactContainer$'));
  const stack = [container[key]];
  while (stack.length) {
    const f = stack.pop();
    if (!f) continue;
    if (f.type?.name === name) return f;
    stack.push(f.sibling, f.child);
  }
  return null;
}

test('a lightbox that changed something re-reads the page under it when it closes: by Back, by ×, and not at all without a change', async () => {
  const reads = [];
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    reads.push(String(url));
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}), text: async () => '{}' };
  };
  let nav;
  const Grab = () => { nav = useNavigate(); return null; };
  const under = '/build/operating-systems?project_id=7';
  const connect = { pathname: '/build/connect', search: '?project_id=7', state: { under } };
  // As App.jsx mounts them: the action route and the module route render the same page.
  const m = await mounted(h(MemoryRouter, { initialEntries: [under, connect], initialIndex: 1 },
    h(Grab),
    h(Routes, null,
      h(Route, { path: '/build/connect', element: h(CycleRoute, { cycle: 'build', lightbox: true }) }),
      h(Route, { path: '/build/:slug', element: h(CycleRoute, { cycle: 'build' }) }))));
  const moduleReads = () => reads.filter((u) => u.includes('/cycles/build/modules/operating-systems')).length;
  const mount = () => fiberNamed(m.container, 'BuildMount');
  try {
    assert.ok(mount(), 'the lightbox is open over the module page');
    const before = moduleReads();
    assert.ok(before >= 1, 'the page under the lightbox was read');
    // A tool connected: nothing reloads behind the lightbox.
    await act(async () => { mount().memoizedProps.onChanged(); });
    assert.equal(moduleReads(), before, 'no re-read while the lightbox is open');
    // The browser's Back, which never calls closeAction.
    await act(async () => { nav(-1); });
    assert.equal(mount(), null, 'Back closed the lightbox');
    assert.equal(moduleReads(), before + 1, 'Back re-read the page the change touched');
    // × after a change re-reads too.
    await act(async () => { nav('/build/connect?project_id=7', { state: { under } }); });
    await act(async () => { mount().memoizedProps.onChanged(); });
    await act(async () => { mount().memoizedProps.onClose(); });
    assert.equal(mount(), null);
    assert.equal(moduleReads(), before + 2, '× re-read it once');
    // Open and closed with no change: no re-read.
    await act(async () => { nav('/build/connect?project_id=7', { state: { under } }); });
    await act(async () => { nav(-1); });
    assert.equal(moduleReads(), before + 2, 'nothing changed, nothing re-read');
  } finally {
    await m.unmount();
    globalThis.fetch = savedFetch;
  }
});

test('the docs say what the code does: useEscapeClose names the mount-order hazard; the Grow row names /grow/update', () => {
  const hook = read('frontend/src/components/useEscapeClose.js');
  assert.match(hook, /THE HAZARD: within one commit React runs a child's effects before its\s+\* parent's\./);
  assert.match(hook, /the first Escape\s+\* closes the lightbox, nested dialog and all/);
  const row = read('documentation/architecture/ROUTE_MAP.md').split('\n').find((l) => l.startsWith('| Grow · Share an update |'));
  assert.match(row, /\| `\/grow\/update` \(D686 S02-A, #1596\): the Grow page with the sheet open over it/);
  assert.match(row, /`\/grow\/updates` redirects to `\/grow\/durable-company-building#updates`/);
  assert.doesNotMatch(row, /`\/grow` \(the cycle overview's primary action\) → the sheet/);
});
