/**
 * #6028 (D6028) — Build Overview V2 (BD1 desktop, BD2 phone), drawn from the
 * read D6027 built: one dominant action, the status strip with sources, Needs
 * attention, the Build Plan preview and compact module cards. Each state the
 * issue names: loading, an empty venture, a partial read, refused and read
 * only; plus a failed overview. Nothing reads 0 where nothing is recorded, and
 * a failed part says so alone with its own retry.
 *
 * Every name, date and count below is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/build_overview_v2_6028.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import BuildOverview from '../src/pages/cycles/BuildOverview.jsx';
import { attentionView, buildReadOnly, moduleCards, nextAction, overviewForViewer, planPreview, statusStrip } from '../src/pages/cycles/buildOverviewModel.js';

const Q = '?project_id=7';
const href = (slug) => `/build/${slug}?project=7`;
const card = (slug, name, state, extra = {}) => ({ slug, name, state, range: 'Now', caption: `${name} caption`, series: [], next: null, reason: null, ...extra });
const CARDS = [
  card('solution-design', 'Solution design', 'ok', { next: { text: 'Link evidence', href: href('solution-design') } }),
  card('prototype-mvp', 'Prototype / MVP', 'ok'),
  card('product-roadmap', 'Product roadmap', 'ok'),
  card('founding-team', 'Founding team', 'ok'),
  card('company-creation', 'Company creation', 'ok'),
  card('operating-systems', 'Operating systems', 'ok'),
];
const INDEX = [
  { key: 'tools', title: 'Tools', detail: 'Connected tools', value: null, href: href('operating-systems') },
  { key: 'solution-design', title: 'Solution design', detail: '4 features linked to a pain or hypothesis', value: '', href: href('solution-design') },
  { key: 'prototype-mvp', title: 'Prototype / MVP', detail: 'Must-haves done', value: '2 of 5', href: href('prototype-mvp') },
  { key: 'product-roadmap', title: 'Product roadmap', detail: 'Shipped this month', value: '0', href: href('product-roadmap') },
  { key: 'founding-team', title: 'Founding team', detail: 'Split and vesting', value: null, href: href('founding-team') },
  { key: 'company-creation', title: 'Company creation', detail: 'Next filing 9 Mar', value: '', href: href('company-creation') },
  { key: 'operating-systems', title: 'Operating systems', detail: 'Systems connected', value: '2 of 5', href: href('operating-systems') },
];
const fig = (key, label, value, unit, state, module, reason = null) => ({ key, label, value, unit, state, module, reason, source: 'x', spark: [] });
const FIGURES = [
  fig('must_haves_done', 'Must-haves done', [2, 5], 'of', 'ok', 'prototype-mvp'),
  fig('days_to_mvp', 'Days to the MVP date', null, 'days', 'not_recorded', 'prototype-mvp', 'No MVP target date has been recorded.'),
  fig('roadmap_shipped', 'Roadmap shipped this month', 0, 'items', 'ok', 'product-roadmap'),
  fig('systems_connected', 'Systems connected', [2, 5], 'of', 'ok', 'operating-systems'),
];
const item = (key, tone, title, detail, module, action) => ({ key, tone, title, detail, module, href: href(module), action });
const ATTENTION = {
  state: 'ready', unreadable: [],
  items: [
    item('must_haves', 'blocked', '2 must-haves need unblocking', '2 blocked', 'prototype-mvp', { label: 'Open must-haves', href: href('prototype-mvp') }),
    item('mvp_date', 'not_recorded', 'MVP target date not recorded', 'The overview counts days to the MVP from this date.', 'prototype-mvp', { label: 'Set target', href: `${href('prototype-mvp')}#mvp-target-date` }),
  ],
};
const PLAN = {
  state: 'ready', status: 'open', accepted: 4, waiting: 2, href: '/build/plan?project=7',
  items: [{ uid: 'p1', title: 'Guided import', kind: 'feature', module: 'prototype-mvp', module_label: 'Prototype / MVP' },
    { uid: 'p2', title: null, kind: 'test', module: 'solution-design', module_label: 'Solution design' }],
};
const FOCUS = { rule: 'set_mvp_date', eyebrow: 'Build · Next', headline: 'Set the MVP target date.', why: 'No MVP target date is recorded.', cta: { label: 'Set target', href: `${href('prototype-mvp')}#mvp-target-date` }, then: null };
const RAW = { cycle: 'build', figures: FIGURES, cards: CARDS, attention: ATTENTION, plan: PLAN, focus: FOCUS, meter: null, index: INDEX };

const render = (props = {}) => renderToStaticMarkup(h(MemoryRouter, null, h(BuildOverview, {
  raw: RAW, data: { cards: RAW.cards, figures: RAW.figures }, status: 'ready', search: Q, onRetry() {}, onRetryCard() {}, ...props,
})));
const testids = (html) => [...html.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1]);
const count = (html, re) => (html.match(re) || []).length;
const PRIMARY_CLASS = /class="[^"]*bg-axal-violet px-4[^"]*"/g;

test('one dominant action: the Next card holds the only primary; the header has no Connect a tool', () => {
  const html = render();
  assert.match(html, /data-testid="build-next-cta"[^>]*>Set target →<\/a>|<a[^>]*data-testid="build-next-cta"[^>]*>Set target →/);
  assert.equal(count(html, PRIMARY_CLASS), 1, 'one primary button on the page');
  assert.doesNotMatch(html, /data-testid="cycle-action"/, 'no header action on /build');
  assert.doesNotMatch(html, /Connect a tool/);
  assert.match(html, /Turn what you proved into a company\./);
});

test('module cards carry one status sentence and one link each', () => {
  const html = render();
  for (const c of CARDS) {
    const start = html.indexOf(`data-testid="build-module-${c.slug}"`);
    assert.ok(start > 0, c.slug);
    const block = html.slice(start, html.indexOf('</article>', start));
    assert.equal(count(block, /<a /g), 1, `${c.slug} has one link`);
    assert.equal(count(block, /data-testid="build-module-sentence"/g), 1, `${c.slug} has one sentence`);
  }
  const cards = moduleCards(RAW, Q);
  assert.equal(cards.find((c) => c.slug === 'prototype-mvp').sentence, 'Must-haves done · 2 of 5');
  assert.equal(cards.find((c) => c.slug === 'solution-design').link.label, 'Link evidence', 'a writer gets the card\'s next step');
  assert.deepEqual(cards.find((c) => c.slug === 'founding-team'), { slug: 'founding-team', name: 'Founding team', state: 'not_recorded', sentence: 'Split and vesting: not recorded.', link: { label: 'Open Founding team', href: '/build/founding-team?project_id=7' }, retry: false });
});

test('nothing reads 0 where the value is not recorded; a recorded 0 stays 0', () => {
  const strip = statusStrip(RAW, Q);
  const days = strip.find((f) => f.key === 'days_to_mvp');
  assert.equal(days.state, 'not_recorded');
  assert.equal(days.value, null);
  assert.equal(days.source, 'Prototype / MVP');
  assert.equal(strip.find((f) => f.key === 'roadmap_shipped').value, '0', 'a recorded zero is a value');
  const html = render();
  const block = html.slice(html.indexOf('data-testid="build-status-days_to_mvp"'), html.indexOf('data-testid="build-status-roadmap_shipped"'));
  assert.match(block, /Not recorded/);
  assert.doesNotMatch(block, />0</);
  assert.equal(statusStrip({ figures: [fig('days_to_mvp', 'Days', -3, 'days', 'ok', 'prototype-mvp')] })[0].value, '3 days past');
  // A plan with no counts is not "0 accepted".
  assert.equal(planPreview({ plan: { ...PLAN, accepted: null } }).state, 'unreadable');
  assert.equal(planPreview({ plan: { state: 'not_recorded', items: [], href: '/build/plan?project=7' } }).line, null);
});

test('loading draws a skeleton in the page\'s shape and no claim', () => {
  const html = render({ raw: null, data: null, status: 'loading' });
  assert.ok(testids(html).includes('build-overview-loading'));
  assert.match(html, /aria-busy="true"/);
  assert.doesNotMatch(html, /Not recorded|could not be read|Nothing needs attention/);
  assert.doesNotMatch(html, /data-testid="cycle-action"/);
});

test('an empty venture: the first-feature action, Not recorded figures, no plan prepared, each module its reason', () => {
  const empty = {
    ...RAW,
    focus: { rule: 'first_feature', eyebrow: 'Build · Next', headline: 'Add the first feature.', why: 'Nothing in Build is recorded yet.', cta: { label: 'Add feature', href: `${href('solution-design')}&add=1` }, then: null },
    figures: [fig('must_haves_done', 'Must-haves done', null, 'of', 'not_recorded', 'prototype-mvp', 'No must-haves marked.'), FIGURES[1]],
    cards: CARDS.map((c) => ({ ...c, state: 'empty', reason: `No ${c.name} records yet.`, next: null })),
    attention: { state: 'ready', unreadable: [], items: [ATTENTION.items[1]] },
    plan: { state: 'not_recorded', status: null, accepted: null, waiting: null, items: [], href: '/build/plan?project=7' },
    index: INDEX.map((r) => ({ ...r, value: null })),
  };
  const html = render({ raw: empty, data: { cards: empty.cards } });
  assert.match(html, /Add the first feature\./);
  assert.match(html, /href="\/build\/solution-design\?project=7&amp;add=1"/);
  assert.equal(count(html, /Not recorded/g) >= 3, true);
  assert.match(html, /no Build Plan has been prepared/);
  assert.match(html, /No Solution design records yet\./);
  assert.doesNotMatch(html, /2 of 5|accepted ·/);
});

test('a partial read: each failed part says so alone and offers its own retry; the rest stays drawn', () => {
  const partial = {
    ...RAW,
    figures: [FIGURES[0], { ...FIGURES[3], state: 'unreadable', value: null, reason: 'integration_companies is unreadable.' }],
    cards: CARDS.map((c) => (c.slug === 'operating-systems' ? { ...c, state: 'unreadable', reason: 'Operating systems could not be read.' } : c)),
    attention: { state: 'partial', unreadable: ['operating-systems'], items: [ATTENTION.items[0], { key: 'operating-systems_unreadable', tone: 'unreadable', title: 'Operating systems could not be read', detail: 'This does not mean nothing needs attention there.', module: 'operating-systems', href: href('operating-systems'), action: null }] },
    plan: { state: 'unreadable', status: null, accepted: null, waiting: null, items: [], href: '/build/plan?project=7' },
    index: INDEX.map((r) => (r.key === 'operating-systems' ? { ...r, value: 'Unreadable' } : r)),
  };
  const retried = [];
  const html = render({ raw: partial, data: { cards: partial.cards }, onRetryCard: (slug) => retried.push(slug) });
  const ids = testids(html);
  assert.ok(ids.includes('build-attention-retry-operating-systems_unreadable'), 'the failed attention source has its own retry');
  assert.ok(ids.includes('build-attention-must_haves'), 'the readable blocker stays');
  assert.match(html, /The Build Plan could not be read/);
  assert.match(html, /data-testid="build-status-systems_connected" data-state="unreadable"/);
  assert.match(html, /data-testid="build-module-operating-systems" data-state="unreadable"/);
  assert.match(html, /data-testid="build-module-prototype-mvp" data-state="ok"/);
  assert.doesNotMatch(html, /Nothing needs attention/);
  const view = attentionView(partial);
  assert.equal(view.state, 'partial');
  assert.equal(view.count, 1, 'an unreadable source is not counted as a blocker');
  assert.equal(view.items[1].link, null);
  // A card read again is no longer drawn unreadable, though the first read's index said so.
  const again = moduleCards(partial, Q, false, CARDS);
  assert.equal(again.find((c) => c.slug === 'operating-systems').state, 'ok');
  // Every source failed: no item named, so the section is one Unreadable, never "nothing needs attention".
  assert.equal(attentionView({ attention: { state: 'unreadable', items: [], unreadable: ['plan'] } }).state, 'unreadable');
  assert.equal(attentionView({}).state, 'unreadable');
  assert.equal(attentionView({ attention: { state: 'unreadable', items: partial.attention.items.slice(1), unreadable: [] } }).state, 'partial');
});

test('refused and unreadable overviews draw their own sentence, with no action', () => {
  const refused = render({ raw: null, data: null, status: 'refused', message: 'You cannot open this venture.' });
  assert.match(refused, /data-testid="build-overview-refused"[^>]*>You cannot open this venture\./);
  assert.doesNotMatch(refused, /Try again|Retry|build-next/);
  const failed = render({ raw: null, data: null, status: 'unreadable' });
  assert.match(failed, /The Build overview could not be read\. This is not a claim that nothing is recorded\./);
  assert.match(failed, /Retry<\/button>/);
  assert.doesNotMatch(failed, /build-next|cycle-action/);
});

test('read only: a restricted plan marks a reader who cannot write; no write action is drawn', () => {
  const reader = {
    ...RAW,
    focus: { rule: null, eyebrow: 'Build · Next', headline: 'Add the first feature.', why: null, cta: { label: 'Add feature', href: `${href('solution-design')}&add=1` }, then: null },
    attention: { ...ATTENTION, items: ATTENTION.items.map((i) => ({ ...i, action: null })) },
    plan: { state: 'restricted', status: null, accepted: null, waiting: null, items: [], href: '/build/plan?project=7' },
  };
  assert.equal(buildReadOnly(reader), true);
  assert.equal(buildReadOnly(RAW), false);
  assert.equal(buildReadOnly(RAW, true), true);
  const html = render({ raw: reader, data: { cards: reader.cards } });
  assert.ok(testids(html).includes('build-overview-read-only'));
  assert.doesNotMatch(html, /add=1/, 'the focus opens the module, not its Add form');
  assert.match(html, /data-testid="build-next-cta"[^>]*>Open →/);
  assert.doesNotMatch(html, /Set target|Link evidence/, 'no write action, from the Worker or a card');
  assert.match(html, /Open Prototype \/ MVP/);
  assert.match(html, /The Build Plan is open to the venture’s founders\./);
  assert.doesNotMatch(html, /build-overview-ask/);
  assert.equal(overviewForViewer(reader, true).focus.cta.href, href('solution-design'));
  assert.equal(overviewForViewer(RAW, false), RAW);
});

test('Needs attention: a writer gets the Worker\'s action, anyone else the record; an unsafe link is dropped', () => {
  const writer = attentionView(RAW);
  assert.deepEqual(writer.items[1].link, { label: 'Set target', href: `${href('prototype-mvp')}#mvp-target-date` });
  const reader = attentionView(RAW, true);
  assert.deepEqual(reader.items[1].link, { label: 'Open Prototype / MVP', href: href('prototype-mvp') });
  const bad = attentionView({ attention: { state: 'ready', items: [{ ...ATTENTION.items[0], href: 'https://elsewhere.example', action: { label: 'Go', href: '//elsewhere.example' } }] } });
  assert.equal(bad.items[0].link, null);
  assert.match(render({ raw: { ...RAW, attention: { state: 'ready', items: [], unreadable: [] } } }), /data-testid="build-attention-none"/);
});

test('the plan preview shows its counts and first waiting proposals; a paused plan says so', () => {
  const plan = planPreview(RAW, Q);
  assert.equal(plan.line, '4 accepted · 2 waiting for decision');
  assert.deepEqual(plan.items.map((i) => [i.title, i.meta]), [['Guided import', 'Feature · Prototype / MVP'], [null, 'Test · Solution design']]);
  assert.equal(plan.href, '/build/plan?project=7');
  assert.equal(planPreview({ plan: { ...PLAN, status: 'paused' } }).line, 'Paused · 4 accepted · 2 waiting for decision');
  const html = render();
  assert.match(html, /Guided import/);
  assert.match(html, /data-testid="build-plan-open"/);
});

test('phone: the phone root frame with Build\'s tabs, the next action, Needs attention and the plan row\'s counts', () => {
  const html = render({ phone: true });
  const ids = testids(html);
  for (const id of ['phone-root', 'build-phone-tabs', 'phone-focus', 'phone-focus-cta', 'build-attention', 'phone-index-build-plan']) assert.ok(ids.includes(id), id);
  assert.ok(ids.indexOf('phone-focus') < ids.indexOf('build-attention') && ids.indexOf('build-attention') < ids.indexOf('phone-index'), 'attention sits between the next action and the index');
  assert.match(html, /4 accepted · 2 waiting for decision/);
  assert.doesNotMatch(html, /build-overview-v2|cycle-header/);
  const many = { ...RAW, attention: { state: 'ready', unreadable: [], items: [1, 2, 3, 4].map((n) => item(`k${n}`, 'blocked', `Blocker ${n}`, null, 'prototype-mvp', null)) } };
  const four = render({ phone: true, raw: many });
  assert.match(four, /Blocker 3/);
  assert.doesNotMatch(four, /Blocker 4/, 'the phone draws three rows and the count');
  const loading = render({ phone: true, raw: null, status: 'loading' });
  assert.ok(testids(loading).includes('build-phone-tabs'));
  assert.doesNotMatch(loading, /build-attention/);
});

test('nextAction reads the Worker focus; an unavailable step has no primary', () => {
  assert.equal(nextAction(RAW, Q).href, `${href('prototype-mvp')}#mvp-target-date`);
  const unavailable = { ...RAW, focus: { rule: 'unavailable', eyebrow: 'Build · Next', headline: 'The next step could not be worked out.', why: 'Part of Build could not be read.', cta: null, then: null, state: 'unavailable' } };
  const html = render({ raw: unavailable });
  assert.match(html, /The next step could not be worked out\./);
  assert.doesNotMatch(html, /build-next-cta/);
  assert.equal(count(html, PRIMARY_CLASS), 0);
});

test('wiring: def.Overview mounts the page lazily; CycleRoute passes the phone, retry and action', () => {
  const def = readFileSync(new URL('../src/pages/cycles/defs/build.jsx', import.meta.url), 'utf8');
  assert.match(def, /const BuildOverview = lazyStep\(\(\) => import\('\.\.\/BuildOverview'\)\);/);
  assert.match(def, /^ {2}Overview: BuildOverview,$/m);
  const route = readFileSync(new URL('../src/pages/cycles/CycleRoute.jsx', import.meta.url), 'utf8');
  assert.match(route, /phone=\{phone\} projectId=\{projectId\} openAction=\{openAction\} onChanged=\{\(\) => setReload\(\(n\) => n \+ 1\)\} onRetryCard=\{retryCard\}/);
  // `/build?new=1` stays the one place a startup is created, and the no-venture state is CycleRoute's own.
  assert.match(def, /creates: true,/);
  assert.match(route, /to="\/build\?new=1" data-testid="cycle-create-venture"/);
});
