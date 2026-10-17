/** D694: cycle routes share one shell inset, with no hand-maintained slug list. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as espree from 'espree';
import { transformWithOxc } from 'vite';
import { Chart } from '../src/pages/cycles/CycleCharts.jsx';
import { MODULES } from '../src/pages/cycles/modules.js';
import { ACTION_PATHS, RECORD_ID, STATIC_CHILDREN, isCyclePath } from '../src/pages/cycles/cyclePaths.js';

const read = (path) => readFileSync(path, 'utf8');

test('cycle roots, every declared module, action, new page and record have the cycle gutter', () => {
  for (const cycle of Object.keys(MODULES)) {
    assert.equal(isCyclePath(`/${cycle}`), true);
    assert.equal(isCyclePath(`/${cycle}/${ACTION_PATHS[cycle]}`), true);
    for (const { slug } of MODULES[cycle]) {
      for (const suffix of ['', '/new', '/12', '/data_room']) {
        assert.equal(isCyclePath(`/${cycle}/${slug}${suffix}`), true, `${cycle}/${slug}${suffix}`);
      }
    }
  }
  assert.equal(isCyclePath('/validate/record/live'), true);
  assert.deepEqual(ACTION_PATHS, { validate: 'record', build: 'connect', raise: 'call', grow: 'update' });
  assert.deepEqual(STATIC_CHILDREN, ['/raise/cap-table/variants']);
  assert.equal(RECORD_ID.test('data_room'), true);
  const defs = read('frontend/src/pages/cycles/CycleRoute.jsx');
  for (const [cycle, action] of Object.entries(ACTION_PATHS)) {
    assert.match(defs, new RegExp(`${cycle}: \\{[\\s\\S]*?path: '${action}'`));
  }
});

test('legacy, static, unknown and malformed child routes keep their own shell', () => {
  for (const path of [
    '/raise/cap-table/variants', '/raise/cap-table/variants/a',
    '/validate/interviews', '/validate/interviews/5', '/validate/session/9', '/validate/inbox',
    '/raise/calls/abc', '/build/roadmap', '/raise/pitch', '/grow/focus', '/studio',
    '/validate/customer-research/Ab12', '/validate/customer-research/12/edit', '/validatex',
  ]) assert.equal(isCyclePath(path), false, path);
});

test('literal cycle routes mount a cycle page or a redirect', () => {
  const app = read('frontend/src/App.jsx');
  const routes = [...app.matchAll(/<Route path="([^":]+)" element=\{/g)];
  const exceptions = new Set(['/validate/record/live', '/raise/data-room']);
  for (const [index, route] of routes.entries()) {
    if (!isCyclePath(route[1]) || exceptions.has(route[1])) continue;
    const section = app.slice(route.index, routes[index + 1]?.index ?? app.length);
    assert.match(section, /<CycleRoute\b|<Navigate\b|<HistoryRedirect\b/, route[1]);
  }
});

test('App applies the predicate for every role without changing the pinned shell clauses', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /import \{ isCyclePath \} from '\.\/pages\/cycles\/cyclePaths';/);
  assert.match(app, /const fullBleedSurface = \(FULL_BLEED_BY_ROLE\[activeRole\] \|\| \[\]\)\.includes\(location\.pathname\)/);
  assert.match(app, /\|\| isCyclePath\(location\.pathname\);/);
  assert.match(app, /const flushSurface = fullBleedSurface;/);
  assert.match(read('frontend/src/pages/cycles/cyclePaths.js'), /^import \{ MODULES \} from '\.\/modules\.js';/);
});

// ---------- PR 2: the gutter, its size container, and the chart's scroll ------

const routePath = 'frontend/src/pages/cycles/CycleRoute.jsx';
const jsxName = (node) => node.openingElement.name.name;
const attr = (node, name) => node.openingElement.attributes.find((a) => a.type === 'JSXAttribute' && a.name.name === name);
const attrText = (node, name) => attr(node, name)?.value?.value ?? null;
/** Every JSX element (and, with `type`, every node of that type) in the source, with its JSX ancestors (nearest last). */
function jsxElements(source, type = 'JSXElement') {
  const ast = espree.parse(source, { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true }, range: true });
  const out = [];
  const visit = (node, chain) => {
    if (!node || typeof node.type !== 'string') return;
    const next = node.type === 'JSXElement' ? [...chain, node] : chain;
    if (node.type === type) out.push({ node, ancestors: chain });
    for (const [key, value] of Object.entries(node)) {
      if (key === 'parent' || key === 'range') continue;
      if (Array.isArray(value)) value.forEach((v) => visit(v, next));
      else if (value && typeof value.type === 'string') visit(value, next);
    }
  };
  visit(ast, []);
  return out;
}
const within = (outer, inner) => inner.range[0] >= outer.range[0] && inner.range[1] <= outer.range[1];

const GUTTER = {
  phone: ['pt-[14px]', 'px-[22px]', 'pb-[18px]'],
  desktop: ['lg:pt-[22px]', 'lg:px-6', 'lg:pb-[30px]'],
  narrow: ['lg:@max-[760px]/cycle:pt-[14px]', 'lg:@max-[760px]/cycle:px-[14px]', 'lg:@max-[760px]/cycle:pb-[40px]'],
};
function assertBody(source) {
  const elements = jsxElements(source);
  const body = elements.find(({ node }) => attrText(node, 'data-testid') === 'cycle-route-body');
  assert.ok(body, 'cycle-route-body is found');
  const classes = attrText(body.node, 'className').split(/\s+/);
  for (const [where, list] of Object.entries(GUTTER)) {
    for (const c of list) assert.ok(classes.includes(c), `${where}: ${c}`);
  }
  assert.ok(!classes.includes('p-5'), 'no p-5');
  const container = body.ancestors.at(-1);
  assert.equal(jsxName(container), 'div');
  assert.ok(attrText(container, 'className').split(/\s+/).includes('@container/cycle'), 'the body\'s parent is the cycle size container');
  const frame = body.ancestors.at(-2);
  assert.equal(jsxName(frame), 'RailFrame', 'the container sits inside RailFrame');
  const named = (name) => elements.filter(({ node }) => node.openingElement.name.name === name).map(({ node }) => node);
  const forms = named('CreateStartupForm');
  assert.equal(forms.length, 1);
  assert.ok(within(body.node, forms[0]), 'CreateStartupForm is inside the body');
  // Decision 13: a `fixed` layer inside a size container is placed against the column in older browsers.
  // The forms are one `openForm` (#1656, D695): the dialog at its mount after the container at 1024px
  // and up, the page inside the body below it.
  const slots = jsxElements(source, 'JSXExpressionContainer');
  const code = (node) => source.slice(node.range[0], node.range[1]);
  const dialogMount = slots.filter(({ node }) => code(node) === '{!phone && openForm}').map(({ node }) => node);
  assert.equal(dialogMount.length, 1, 'the form dialog has one mount');
  // D697 decision 21: a further part's dialog that is a page is the body below 1024px too.
  const pageSlot = slots.filter(({ node }) => code(node) === '{phone && openForm ? openForm : phone && dialog?.page ? dialog.element : body}').map(({ node }) => node);
  assert.equal(pageSlot.length, 1, 'below 1024px the form is the body');
  assert.ok(within(body.node, pageSlot[0]), 'the form page sits in the body, in its gutter');
  for (const sheet of named('FormLightbox')) assert.ok(!within(container, sheet), 'no form dialog is drawn inside the container');
  // D697 decision 21: the one dialog a module's further parts open has one mount, after the container.
  const partsDialog = slots.filter(({ node }) => code(node) === '{dialog && !(phone && dialog.page) && dialog.element}').map(({ node }) => node);
  assert.equal(partsDialog.length, 1, 'the parts dialog has one mount');
  const overlays = [...dialogMount, ...partsDialog, ...named('Mount').filter((m) => attr(m, 'projectId'))];
  assert.equal(overlays.length, 3, 'the form mount, the parts dialog and the action Mount are found');
  for (const overlay of overlays) {
    const label = overlay.type === 'JSXElement' ? jsxName(overlay) : code(overlay);
    assert.ok(overlay.range[0] > container.range[1], `${label} comes after the size container closes`);
    assert.ok(within(frame, overlay), `${label} stays inside RailFrame`);
  }
}

test('the cycle body takes the canvas gutter in a cycle size container, and no overlay sits inside it', () => {
  const source = read(routePath);
  assertBody(source);
  // D703 (#1665's PR 2c): the container and body sit in the one `!actionPage` condition, which closes with them.
  const close = '      </div>\n      </div>\n      )}\n';
  const mount = '          onChanged={() => { dirty.current = true; }} />\n      )}\n';
  for (const [label, mutate] of [
    ['the closing tags back below the Mount', (src) => src.replace(close, '').replace(mount, mount + close)],
    ['no size container', (src) => src.replace('<div className="@container/cycle min-w-0">', '<div className="min-w-0">')],
    ['the narrow bottom', (src) => src.replace('lg:@max-[760px]/cycle:pb-[40px]', 'lg:pb-[40px]')],
    ['the phone sides', (src) => src.replace('px-[22px] ', 'px-5 ')],
    ['p-5 kept', (src) => src.replace('min-w-0 px-[22px]', 'min-w-0 p-5 px-[22px]')],
    ['the form dialog mounted inside the body', (src) => src.replace('      {!phone && openForm}\n', '').replace('        {phone && openForm ? openForm : phone && dialog?.page ? dialog.element : body}\n', '        {phone && openForm ? openForm : phone && dialog?.page ? dialog.element : body}\n        {!phone && openForm}\n')],
    ['the form page drawn outside the body', (src) => src.replace('{phone && openForm ? openForm : phone && dialog?.page ? dialog.element : body}', '{body}').replace('      {!phone && openForm}\n', '      {!phone && openForm}\n      {phone && openForm ? openForm : phone && dialog?.page ? dialog.element : body}\n')],
    ['the parts dialog drawn inside the body', (src) => src.replace('      {dialog && !(phone && dialog.page) && dialog.element}\n', '').replace('        {phone && openForm ? openForm : phone && dialog?.page ? dialog.element : body}\n', '        {phone && openForm ? openForm : phone && dialog?.page ? dialog.element : body}\n        {dialog && !(phone && dialog.page) && dialog.element}\n')],
  ]) {
    const mutated = mutate(source);
    assert.notEqual(mutated, source, `mutation applies: ${label}`);
    assert.throws(() => assertBody(mutated), { name: 'AssertionError' }, `mutation must fail: ${label}`);
  }
  assertBody(source);
});

const chartsPath = 'pages/cycles/CycleCharts.jsx';
let serial = 0;
/** CycleCharts.jsx built from a given source, its one relative import pinned to the real file. */
async function chartsFrom(source) {
  const url = new URL('../src/' + chartsPath, import.meta.url);
  const require = createRequire(url);
  const js = (await transformWithOxc(source, url.pathname, { jsx: { runtime: 'automatic' } })).code
    .replace(/from\s*['"]\.\/cycleModel['"]/, `from ${JSON.stringify(new URL('./cycleModel.js', url).href)}`)
    .replace(/from\s*['"](react\/jsx-runtime)['"]/, (_m, spec) => `from ${JSON.stringify(pathToFileURL(require.resolve(spec)).href)}`);
  return import('data:text/javascript;base64,' + Buffer.from(js).toString('base64') + '#d694-' + serial++);
}
const HBAR = { kind: 'hbar', items: [{ label: 'Onboarding takes weeks', value: 11, tone: 'v1' }, { label: 'Reports by hand', value: 6, tone: 'v2' }], legend: [{ label: 'Severe', tone: 'v1' }, { label: 'Real', tone: 'v2' }] };
function assertChart(ChartComponent) {
  const html = renderToStaticMarkup(React.createElement(ChartComponent, { spec: HBAR, label: 'Pain themes' }));
  const m = /^<div data-chart="hbar" class="([^"]*)"><div class="([^"]*)">(<svg[\s\S]*<\/svg>)(<div class="mt-1\.5[\s\S]*)<\/div><\/div>$/.exec(html);
  assert.ok(m, `outer, inner, SVG, then the legend inside the inner box: ${html.slice(0, 160)}`);
  const outer = m[1].split(/\s+/);
  const inner = m[2].split(/\s+/);
  assert.ok(outer.includes('min-w-0'));
  assert.ok(outer.includes('@max-[760px]/cycle:overflow-x-auto'), 'scrolls under the cycle query');
  assert.ok(!outer.some((c) => /^overflow/.test(c)), 'and only under it: a wide column gets no scrollbar');
  assert.ok(inner.includes('@max-[760px]/cycle:min-w-[480px]'), 'keeps 480px under the same query');
  assert.ok(!inner.some((c) => /^min-w-/.test(c)), 'and only under it');
  assert.match(m[3], /^<svg[^>]* width="100%"/, 'the SVG still scales in a wide column');
  assert.match(m[4], /Severe[\s\S]*Real/, 'the legend stays with the chart');
}

test('a chart keeps 480px and scrolls sideways only in a cycle column under 760px', async () => {
  assertChart(Chart);
  const source = readFileSync(new URL('../src/' + chartsPath, import.meta.url), 'utf8');
  assertChart((await chartsFrom(source)).Chart);
  for (const [before, after] of [
    ['className="min-w-0 @max-[760px]/cycle:overflow-x-auto"', 'className="min-w-0 overflow-x-auto"'],
    ['className="min-w-0 @max-[760px]/cycle:overflow-x-auto"', 'className="@max-[760px]/cycle:overflow-x-auto"'],
    ['<div className="@max-[760px]/cycle:min-w-[480px]">', '<div className="min-w-[480px]">'],
    ['        <Legend items={spec.legend} />\n      </div>\n', '      </div>\n      <Legend items={spec.legend} />\n'],
  ]) {
    assert.ok(source.includes(before), 'mutation target: ' + before);
    const { Chart: mutated } = await chartsFrom(source.replace(before, after));
    assert.throws(() => assertChart(mutated), { name: 'AssertionError' }, 'mutation must fail: ' + after);
  }
});
