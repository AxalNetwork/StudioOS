/**
 * D703 (#1665), PR 2a — the page mode the cycle's pushed pages draw with, not
 * yet mounted by `CycleRoute`:
 *   · `ui/Lightbox.jsx`'s bar function, `LightboxBarProvider`, `pageClass`
 *     and `useLightboxPage`;
 *   · `ui/ActionSheet.jsx`'s page mode;
 *   · `asPage` on the four action components, given directly (test 12's
 *     component cases);
 *   · test 13 (other callers keep their dialogs) and test 15 (dark pairs in
 *     `ui/`).
 * The route's cases (the size container not drawn, `closeAction`, the
 * module's back label) come with the closing PR, which passes `asPage`.
 *
 * Phone width is #1656's `matchMedia` stub (`_form_d695.mjs`). Every name is
 * made up.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/phone_cycle_pages_d703.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { h, mountForm, propsOf, textOf } from './_form_d695.mjs';
import Lightbox, { LightboxBarProvider, useLightboxPage } from '../src/ui/Lightbox.jsx';
import ActionSheet from '../src/ui/ActionSheet.jsx';
import * as ui from '../src/ui/index.js';
import RecordLightbox from '../src/pages/founder/RecordLightbox.jsx';
import RoundCallSheet, { CallLightbox } from '../src/pages/founder/RoundCallSheet.jsx';
import ShareUpdateLightbox from '../src/pages/founder/ShareUpdateLightbox.jsx';
import { ConnectToolView } from '../src/pages/account/ConnectToolSheet.jsx';
import { buildCatalogue } from '../src/pages/account/connectorsModel.js';
import { roundCallsApi } from '../src/lib/api/roundCalls.js';
import { shareUpdateApi } from '../src/lib/api/shareUpdate.js';

const read = (p) => readFileSync(p, 'utf8');
const GUTTER = 'px-[22px] pt-[14px] pb-[18px]';

/** A page bar as `CycleRoute`'s `phoneBar` will draw it: the title, the sub and Back, each findable. */
const barSeen = [];
const bar = (backLabel) => ({ title, sub, onBack }) => {
  barSeen.push({ title, sub });
  return h('div', { 'data-testid': 'cycle-bar' },
    h('button', { type: 'button', onClick: onBack, 'data-testid': 'cycle-bar-back' }, `‹ ${backLabel}`),
    h('h1', { 'data-testid': 'cycle-bar-title' }, title),
    sub ? h('p', { 'data-testid': 'cycle-bar-sub' }, sub) : null);
};
const asPage = (backLabel = 'Validate') => ({ pageBelow: 'lg', bar: bar(backLabel), pageClass: GUTTER });

function PageProbe({ out, id }) { out[id] = useLightboxPage(); return null; }
const dialogs = (m) => m.nodes().filter((n) => propsOf(n).role === 'dialog');
const all = (m, id) => m.nodes().filter((n) => propsOf(n)['data-testid'] === id);
const count = (text, word) => text.split(word).length - 1;

// ── Lightbox's page mode ──────────────────────────────────────────────────

test('8: a bar function draws with { title || label, sub, onBack }; onBack is onEscape when set, else onClose', async () => {
  const calls = [];
  const seen = [];
  const fn = (args) => { seen.push(args); return h('button', { type: 'button', onClick: args.onBack, 'data-testid': 'my-bar' }, args.title); };
  const m = await mountForm(h(Lightbox, { label: 'Connect a tool', sub: 'Pick one', pageBelow: 'lg', bar: fn, onClose: () => calls.push('close'), onEscape: () => calls.push('escape') }, 'Body'), { phone: true });
  try {
    assert.equal(seen.at(-1).title, 'Connect a tool', 'the label when there is no title');
    assert.equal(seen.at(-1).sub, 'Pick one');
    await m.click('Connect a tool');
    assert.deepEqual(calls, ['escape']);
    await m.render(h(Lightbox, { label: 'Record a session', title: 'Record a session', pageBelow: 'lg', bar: fn, onClose: () => calls.push('close') }, 'Body'));
    await m.click('Record a session');
    assert.deepEqual(calls, ['escape', 'close']);
    assert.equal(all(m, 'lightbox-back').length, 0, 'the default back bar is replaced');
  } finally { await m.unmount(); }
});

test('9: LightboxBarProvider gives a page its bar; a bar passed to the Lightbox wins; with neither, its own bar', async () => {
  const fn = ({ title, onBack }) => h('button', { type: 'button', onClick: onBack, 'data-testid': 'provided-bar' }, `‹ Problem discovery · ${title}`);
  let closed = 0;
  const page = (extra = {}) => h(LightboxBarProvider, { bar: fn }, h(Lightbox, { label: 'New theme', title: 'New theme', pageBelow: 'lg', onClose: () => { closed += 1; }, ...extra }, 'Fields'));
  const m = await mountForm(page(), { phone: true });
  try {
    assert.equal(textOf(m.by('provided-bar')), '‹ Problem discovery · New theme');
    assert.equal(m.by('lightbox-back'), undefined);
    await m.click('‹ Problem discovery · New theme');
    assert.equal(closed, 1);
    await m.render(page({ bar: h('div', { 'data-testid': 'own-bar' }, 'Own') }));
    assert.ok(m.by('own-bar'));
    assert.equal(m.by('provided-bar'), undefined, 'an element bar wins over the provider');
    await m.render(h(Lightbox, { label: 'New theme', title: 'New theme', pageBelow: 'lg', onClose() {} }, 'Fields'));
    assert.ok(m.by('lightbox-back'), 'no provider: the page draws its own bar');
    // A dialog ignores the provider: it is not a page.
    await m.setPhone(false);
    await m.render(page());
    assert.equal(m.by('provided-bar'), undefined);
    assert.equal(dialogs(m).length, 1);
  } finally { await m.unmount(); }
});

test('10: pageClass is the page root\'s class; useLightboxPage is true in a page and false in a dialog, nested or not', async () => {
  const out = {};
  const nested = h(Lightbox, { label: 'Settings', title: 'Settings', onClose() {}, testId: 'inner' }, h(PageProbe, { out, id: 'inner' }));
  const m = await mountForm(h(Lightbox, { label: 'Share an update', pageBelow: 'lg', pageClass: GUTTER, onClose() {} }, h(PageProbe, { out, id: 'page' }), nested, h(PageProbe, { out, id: 'after' })), { phone: true });
  try {
    assert.ok(propsOf(m.by('lightbox-page')).className.endsWith(GUTTER));
    assert.equal(out.page, true);
    assert.equal(out.after, true);
    assert.equal(out.inner, false, 'a dialog opened inside a page keeps its header');
    assert.equal(dialogs(m).length, 1, 'the nested one is a dialog');
    await m.setPhone(false);
    assert.equal(out.page, false);
    assert.doesNotMatch(propsOf(m.by('lightbox')).className, /px-\[22px\]/, 'the gutter is a page\'s only');
  } finally { await m.unmount(); }
  // Outside any lightbox.
  const plain = await mountForm(h(PageProbe, { out, id: 'outside' }), { phone: true });
  try { assert.equal(out.outside, false); } finally { await plain.unmount(); }
  assert.equal(ui.LightboxBarProvider, LightboxBarProvider);
  assert.equal(ui.useLightboxPage, useLightboxPage);
});

test('11: in a page, ActionSheet draws no header row and keeps its sub first; the frame flows. In a dialog, as before', async () => {
  const sheet = h(ActionSheet, { eyebrow: 'Build', title: 'Connect a tool', sub: 'Each one says what it feeds.', onClose() {}, steps: ['One', 'Two'], footer: h('button', null, 'Done') }, 'Rows');
  const m = await mountForm(h(Lightbox, { label: 'Connect a tool', size: 'tall', pageBelow: 'lg', bar: bar('Build'), onClose() {} }, sheet), { phone: true });
  try {
    const frame = m.by('action-sheet');
    assert.equal(propsOf(frame)['data-page'], 'true');
    assert.doesNotMatch(propsOf(frame).className, /\bh-full\b/);
    assert.equal(m.by('action-sheet-close'), undefined, 'no ×');
    assert.equal(m.nodes().filter((n) => n.tagName === 'H2').length, 0, 'no header title');
    assert.equal(count(textOf(m.by('lightbox-page')), 'Connect a tool'), 1, 'the title once, in the bar');
    assert.equal(propsOf(frame.childNodes[0])['data-testid'], 'action-sheet-sub', 'the sub is the first line');
    assert.ok(m.by('action-sheet-steps') && textOf(m.by('action-sheet-body')).includes('Rows'));
    assert.doesNotMatch(propsOf(m.by('action-sheet-body')).className, /overflow-y-auto/);
    assert.equal(textOf(m.by('cycle-bar-title')), 'Connect a tool');
    await m.setPhone(false);
    assert.ok(m.by('action-sheet-close'), 'a dialog keeps its header');
    assert.match(propsOf(m.by('action-sheet')).className, /\bh-full\b/);
    assert.equal(m.by('action-sheet-sub'), undefined);
  } finally { await m.unmount(); }
});

// ── 12. The four actions given asPage directly ────────────────────────────

const MODELS = { live: [{ model: 'nova', label: 'Nova-3 live', price_usd_per_minute: 0.0092, choosable: true }], final: [{ model: 'whisper', label: 'Whisper', price_usd_per_minute: 0.0005, choosable: true }], defaults: { live: 'nova', final: 'whisper' } };
const BOARD = { hypotheses: [] };
const CATALOGUE = buildCatalogue({ providers: [{ key: 'hubspot', display_name: 'HubSpot', category: 'CRM', status: 'live', has_implementation: true, feeds: ['capital_relationships'] }], items: [] });

function stubAction() {
  const saved = { availability: roundCallsApi.availability, context: shareUpdateApi.context, draft: shareUpdateApi.draftLines };
  const never = () => new Promise(() => {});
  roundCallsApi.availability = never; shareUpdateApi.context = never; shareUpdateApi.draftLines = never;
  return () => { roundCallsApi.availability = saved.availability; shareUpdateApi.context = saved.context; shareUpdateApi.draftLines = saved.draft; };
}

const ACTIONS = [
  { name: 'Record a session', testId: 'record-lightbox', el: (p) => h(RecordLightbox, { projectId: 3, initialModels: MODELS, initialBoard: BOARD, channels: [], onClose() {}, onStarted() {}, ...p }), sub: 'It lands in Interviews when you stop.' },
  { name: 'Connect a tool', testId: 'connect-tool-lightbox', el: (p) => h(ConnectToolView, { data: { status: 'ready', catalogue: CATALOGUE, reload() {} }, onClose() {}, ...p }) },
  { name: 'Call for Capital', testId: 'round-call-lightbox', el: (p) => h(RoundCallSheet, { projectId: 3, onClose() {}, ...p }) },
  { name: 'Share an update', testId: 'share-update-lightbox', el: (p) => h(ShareUpdateLightbox, { projectId: 3, onClose() {}, onSent() {}, ...p }) },
];

for (const a of ACTIONS) {
  test(`12: ${a.name} given asPage is a page below 1024px, with the bar and the gutter, and a dialog from 1024px`, async () => {
    const unstub = stubAction();
    barSeen.length = 0;
    const m = await mountForm(a.el({ asPage: asPage('Build') }), { phone: true });
    try {
      assert.equal(dialogs(m).length, 0, 'no role="dialog"');
      assert.equal(m.by(`${a.testId}-layer`), undefined, 'no fixed inset-0 z-[80] layer');
      const page = m.by(`${a.testId}-page`);
      assert.ok(page, 'the page');
      assert.ok(propsOf(page).className.endsWith(GUTTER), 'the cycle gutter on the page root');
      assert.equal(textOf(m.by('cycle-bar-back')), '‹ Build');
      assert.equal(barSeen.at(-1).title, a.name === 'Call for Capital' ? 'Call for Capital' : a.name);
      if (a.sub) assert.equal(textOf(m.by('cycle-bar-sub')), a.sub);
      assert.equal(m.nodes().filter((n) => propsOf(n)['aria-label'] === 'Close').length, 0, 'no × in a page');
      await m.setPhone(false);
      assert.equal(dialogs(m).length, 1, 'from 1024px, today\'s dialog');
      assert.ok(m.by(`${a.testId}-layer`));
      assert.equal(m.by('cycle-bar'), undefined);
    } finally { await m.unmount(); unstub(); }
  });
}

test('12: Connect a tool\'s Back steps from a tool\'s panel to the list, then closes', async () => {
  let closed = 0;
  const m = await mountForm(h(ConnectToolView, { data: { status: 'ready', catalogue: CATALOGUE, reload() {} }, onClose: () => { closed += 1; }, asPage: asPage('Build') }), { phone: true });
  try {
    assert.ok(m.by('tool-row-hubspot'), 'the list');
    await m.click('Connect');
    assert.equal(m.by('tool-row-hubspot'), undefined, 'the panel is open');
    await m.click('‹ Build');
    assert.ok(m.by('tool-row-hubspot'), 'Back returned to the list');
    assert.equal(closed, 0);
    await m.click('‹ Build');
    assert.equal(closed, 1);
  } finally { await m.unmount(); }
});

// ── 13. Other callers keep their dialogs ──────────────────────────────────

test('13: without asPage, a round call and a nested Connect a tool are dialogs below 1024px, and useLightboxPage is false inside', async () => {
  const unstub = stubAction();
  const out = {};
  const m = await mountForm(h(CallLightbox, { onClose() {} }, h(PageProbe, { out, id: 'call' })), { phone: true });
  try {
    assert.equal(dialogs(m).length, 1);
    assert.equal(out.call, false);
    await m.render(h(RoundCallSheet, { projectId: 3, onClose() {} }));
    assert.equal(dialogs(m).length, 1, 'RoundCallSheet with no asPage');
    // Share an update's page holds a Connect a tool of its own: a dialog with its header row.
    await m.render(h(Lightbox, { label: 'Share an update', pageBelow: 'lg', bar: bar('Grow'), onClose() {} },
      h(ConnectToolView, { data: { status: 'ready', catalogue: CATALOGUE, reload() {} }, onClose() {} })));
    assert.ok(m.by('lightbox-page'));
    assert.equal(dialogs(m).length, 1, 'the nested Connect a tool');
    assert.ok(m.by('connect-tool-sheet-close'), 'its header row, with ×');
  } finally { await m.unmount(); unstub(); }
  // Only CycleRoute's Mount will pass it: the other callers never do.
  for (const file of ['frontend/src/pages/founder/RaiseCallPage.jsx', 'frontend/src/pages/founder/RoundCallPage.jsx', 'frontend/src/pages/founder/ShareUpdateSheet.jsx']) {
    assert.doesNotMatch(read(file), /asPage/, file);
  }
  assert.match(read('frontend/src/pages/founder/RoundCallSheet.jsx'), /const \[page,setPage\]|\bpage\b/, 'RoundCallSheet\'s own page state is untouched');
});

// ── 15. Dark mode in ui/ ──────────────────────────────────────────────────

test('15: every light class D703 adds to Lightbox.jsx and ActionSheet.jsx has its dark: pair', () => {
  const sheet = read('frontend/src/ui/ActionSheet.jsx');
  const subLine = sheet.split('\n').find((l) => l.includes('-sub`}'));
  assert.ok(subLine, 'the page-mode sub line');
  assert.match(subLine, /text-axal-muted dark:text-gray-400/);
  const box = read('frontend/src/ui/Lightbox.jsx');
  const pageRoot = box.split('\n').find((l) => l.includes("testId + '-page'"));
  assert.match(pageRoot, /bg-white text-axal-ink dark:bg-gray-950 dark:text-gray-100/);
});
