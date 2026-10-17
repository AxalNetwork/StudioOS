/**
 * D703 (#1665), PR 2b — the module page and the record as pushed pages on a
 * phone, rendered directly, not yet mounted by `CycleRoute`:
 *   · `PhoneModulePage.jsx` with `CycleBar` and `PHONE_GUTTER`: test 6's page
 *     cases, tests 7 and 8, and test 10's refused module;
 *   · `RecordView.jsx`'s phone layout under `RecordPhoneProvider`: test 9;
 *   · `PhoneBar`'s `back.onClick`, and test 15's dark pairs for it;
 *   · test 14's part for the new file.
 * The route's cases (the phone switch, the record's bar, the Add and action
 * pages) come with the closing PR. Every name is made up.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/phone_cycle_module_pages_d703.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { h, mountForm, propsOf, textOf } from './_form_d695.mjs';
import PhoneModulePage, { CycleBar, PHONE_GUTTER, phoneRow } from '../src/pages/cycles/PhoneModulePage.jsx';
import RecordView, { RecordPhoneProvider } from '../src/pages/cycles/RecordView.jsx';
import { PhoneBar } from '../src/ui/phone/PhoneBar.jsx';
import { __resetEadwynPanelForTest, useEadwynPanel, useEadwynRailServes } from '../src/ui/eadwynPanel.js';

const Q = '?project_id=3';
const read = (p) => readFileSync(p, 'utf8');
const ssr = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
/** The opening tag that carries `data-testid="<id>"`, by string search. */
const tag = (out, id) => {
  const at = out.indexOf(`data-testid="${id}"`);
  return at < 0 ? '' : out.slice(out.lastIndexOf('<', at), out.indexOf('>', at) + 1);
};
const all = (m, id) => m.nodes().filter((n) => propsOf(n)['data-testid'] === id);
/** Tap the row or button whose text starts with `label` (a row's text ends with its ›). */
const tap = async (m, label) => {
  const node = m.nodes().find((n) => n.tagName === 'BUTTON' && textOf(n).trim().startsWith(label));
  assert.ok(node, `button: ${label}`);
  propsOf(node).onClick({ preventDefault() {} });
  await m.flush();
};

// ── Fixtures ──────────────────────────────────────────────────────────────

const COLS = [{ key: 'theme', label: 'Theme' }, { key: 'evidence', label: 'Evidence' }, { key: 'status', label: 'Status' }];
const row = (id, theme, evidence, status, tone = 'ok') => ({ id, cells: { theme, evidence, status: { text: status, tone } } });
const PAIN = {
  module: { name: 'Problem discovery', records_title: 'Pain themes' },
  card: { slug: 'problem-discovery', name: 'Problem discovery', caption: 'Pain themes ranked by severity', range: 'Last 90 days', state: 'ok',
    series: [{ kind: 'hbar', items: [{ label: 'Dispatch delays', value: 6 }, { label: 'Manual invoicing', value: 3 }] }],
    next: { text: 'Group two more interviews into a theme', href: `/validate/problem-discovery${Q}` } },
  records: { cols: COLS, rows: [row(11, 'Dispatch delays', '6 interviews', 'Validated'), row(12, 'Manual invoicing', null, 'Open', 'warn')],
    total: 40, page: 1, page_size: 25, linkable: true,
    filters: [{ key: 'status', label: 'Status', options: [{ value: 'open', label: 'Open' }] }], sorts: [{ key: 'severity', label: 'Severity' }, { key: 'newest', label: 'Newest' }] },
};
const ADD = [{ text: 'Add theme', href: `/validate/problem-discovery/new${Q}`, state: { under: `/validate/problem-discovery${Q}` } }];
const page = (props = {}) => h(PhoneModulePage, { cycle: 'validate', slug: 'problem-discovery', data: PAIN, search: Q, add: ADD, ...props });

function PanelOn({ out }) { useEadwynRailServes(true); out.panel = useEadwynPanel(); return null; }

// ── 6. Module page ────────────────────────────────────────────────────────

test('6: a module page is the bar, One next thing, its 52px Add, the chart at a glance and "<records> · <count>"', () => {
  const out = ssr(page());
  const text = renderedText(out);
  assert.ok(tag(out, 'cycle-bar'), 'CycleBar');
  assert.ok(out.includes(`href="/validate${Q}"`) && text.includes('‹ Validate'), 'Back to the cycle, with the venture');
  assert.ok(text.includes('Problem discovery') && text.includes('Pain themes ranked by severity'), 'title and caption');
  assert.ok(text.includes('One next thing') && text.includes('Group two more interviews into a theme'));
  const cta = tag(out, 'phone-module-cta');
  assert.ok(cta.includes(`href="/validate/problem-discovery/new${Q}"`));
  assert.ok(cta.includes('min-h-[52px]') && cta.includes('rounded-[14px]'));
  assert.ok(text.includes('Problem discovery · at a glance') && text.includes('Last 90 days'));
  assert.ok(out.includes('@max-[760px]/cycle:min-w-[480px]'), '#1655\'s chart wrapper');
  assert.ok(text.includes('Pain themes · 1–2 of 40'), 'recordsCount\'s label, as the desktop table counts');
  assert.doesNotMatch(out, /data-testid="cycle-module"/, 'not the desktop page');
  // With no next, the Add label is the headline; with no Add, no CTA.
  const noNext = renderedText(ssr(page({ data: { ...PAIN, card: { ...PAIN.card, next: null } } })));
  assert.ok(noNext.includes('One next thing') && noNext.includes('Add theme'));
  const none = ssr(page({ add: [], data: { ...PAIN, records: { ...PAIN.records, add: undefined } } }));
  assert.equal(tag(none, 'phone-module-cta'), '', 'no Add, no button');
  assert.ok(renderedText(none).includes('Group two more interviews into a theme'), 'the headline stands alone');
});

test('6: the Eadwyn button is labelled "<Cycle> · <Module>"; Customer research\'s Add opens Record a session on a plain tap', async () => {
  __resetEadwynPanelForTest();
  const out = {};
  const opened = [];
  const research = { ...PAIN, module: { name: 'Customer research', records_title: 'Interviews' }, card: { ...PAIN.card, slug: 'customer-research', name: 'Customer research' } };
  const m = await mountForm(h(React.Fragment, null, h(PanelOn, { out }),
    page({ slug: 'customer-research', data: research, add: [{ text: 'Record a session', href: `/validate/record${Q}`, onOpen: () => opened.push(1) }] })));
  try {
    assert.equal(all(m, 'button-eadwyn-open').length, 1, 'one page button');
    propsOf(all(m, 'button-eadwyn-open')[0]).onClick();
    await m.flush();
    assert.equal(out.panel.label, 'Validate · Customer research');
    const cta = all(m, 'phone-module-cta')[0];
    assert.equal(propsOf(cta).href ?? propsOf(cta).to, `/validate/record${Q}`);
    let prevented = false;
    propsOf(cta).onClick({ button: 0, preventDefault() { prevented = true; } });
    assert.deepEqual(opened, [1]);
    assert.equal(prevented, true);
  } finally { await m.unmount(); __resetEadwynPanelForTest(); }
});

test('10 and 6: a refused module read draws the Worker\'s sentence and nothing else; an unreadable one, Unreadable under the bar', () => {
  const refused = ssr(page({ status: 'refused', message: 'Partners do not see decisions.', data: null, slug: 'verdict' }));
  assert.ok(renderedText(refused).includes('Partners do not see decisions.'));
  for (const id of ['phone-module-chart', 'phone-module-records', 'phone-module-cta', 'phone-module-next']) assert.equal(tag(refused, id), '', id);
  assert.ok(tag(refused, 'cycle-bar'), 'the bar still goes back');
  const broken = ssr(page({ status: 'unreadable', data: null }));
  assert.ok(renderedText(broken).includes('This is not a claim that nothing is recorded.'));
  assert.equal(tag(broken, 'phone-module-records'), '');
});

// ── 7. Rows ───────────────────────────────────────────────────────────────

test('7: a linkable row opens its record, a synthetic one is plain, one the desktop could edit opens its Edit; the pill is kept', async () => {
  const out = ssr(page());
  assert.ok(out.includes(`href="/validate/problem-discovery/11${Q}"`) && out.includes(`href="/validate/problem-discovery/12${Q}"`));
  const research = ssr(page({ slug: 'customer-research', data: { ...PAIN, card: { ...PAIN.card, slug: 'customer-research', name: 'Customer research' } } }));
  assert.ok(research.includes(`href="/validate/customer-research/11${Q}"`));
  // No `linkable`, or a synthetic id: plain rows with no ›.
  const plain = ssr(page({ data: { ...PAIN, records: { ...PAIN.records, linkable: false } } }));
  assert.doesNotMatch(plain, /href="\/validate\/problem-discovery\/1[12]/);
  assert.doesNotMatch(renderedText(plain.slice(plain.indexOf('phone-module-records'), plain.indexOf('phone-module-pages'))), /›/);
  const synthetic = ssr(page({ data: { ...PAIN, records: { ...PAIN.records, rows: [{ ...row('pain-3-9', 'Odd', 'x', 'Open'), id: 'new' }] } } }));
  assert.doesNotMatch(synthetic, /problem-discovery\/new\?project_id=3"[^>]*data-testid="phone-module-row"/);
  // The Decisions list keeps its decision pill (CO:256, D-k).
  const decisions = { ...PAIN, module: { name: 'Verdict', records_title: 'Decisions' },
    records: { cols: [{ key: 'decision', label: 'Decision' }, { key: 'on', label: 'On' }], rows: [{ id: 5, cells: { decision: { text: 'Proceed', tone: 'ok' }, on: '12 Oct · Ada Quill' } }], total: 1, page: 1, page_size: 25, linkable: true } };
  const v = ssr(page({ slug: 'verdict', data: decisions }));
  assert.match(v, /Proceed<\/span>/);
  assert.deepEqual(phoneRow(decisions.records.cols, decisions.records.rows[0]), { title: 'Proceed', description: '12 Oct · Ada Quill', pill: { label: 'Proceed', tone: 'ok' } });
  assert.deepEqual(phoneRow(COLS, PAIN.records.rows[1]), { title: 'Manual invoicing', description: 'Not recorded', pill: { label: 'Open', tone: 'warn' } }, 'a missing cell is Not recorded, never blank');
  // Edit on a tap where the row does not link.
  const edits = [];
  const m = await mountForm(page({ data: { ...PAIN, records: { ...PAIN.records, linkable: false } }, rowAction: (r) => ({ text: 'Edit', onClick: () => edits.push(r.id) }) }));
  try {
    const rows = all(m, 'phone-module-row');
    assert.equal(rows[0].tagName, 'BUTTON');
    propsOf(rows[0]).onClick();
    assert.deepEqual(edits, [11]);
  } finally { await m.unmount(); }
});

test('7: ‹ and › page through onQuery', async () => {
  const calls = [];
  const m = await mountForm(page({ onQuery: (q) => calls.push(q), data: { ...PAIN, records: { ...PAIN.records, total: 100, page: 2 } } }));
  try {
    const nav = all(m, 'phone-module-pages')[0];
    assert.ok(nav);
    await m.click('›');
    await m.click('‹');
    assert.deepEqual(calls.map((q) => q.page), [3, 1]);
  } finally { await m.unmount(); }
});

// ── 8. Below the rows ─────────────────────────────────────────────────────

test('8: search, a filter and the sort call onQuery; the tool links and children follow the rows, in order', async () => {
  const calls = [];
  const kids = h('section', { id: 'tools', 'data-testid': 'module-children' }, 'Tools history');
  const m = await mountForm(page({ onQuery: (q) => calls.push(q), tools: [{ label: 'Open the files tool', href: `/raise/data-room?mode=workspace&project_id=3` }], children: kids }));
  try {
    const input = m.nodes().find((n) => n.tagName === 'INPUT' && propsOf(n).type === 'search');
    await m.flush();
    propsOf(input).onChange({ target: { value: '  dispatch ' } });
    await m.flush();
    propsOf(m.nodes().find((n) => n.tagName === 'FORM')).onSubmit({ preventDefault() {} });
    const selects = m.nodes().filter((n) => n.tagName === 'SELECT');
    propsOf(selects[0]).onChange({ target: { value: 'open' } });
    propsOf(selects[1]).onChange({ target: { value: 'newest' } });
    assert.deepEqual(calls, [{ page: 1, q: 'dispatch' }, { page: 1, filter: { status: 'open' } }, { page: 1, sort: 'newest' }]);
    // Order: rows, then the tool link, then children.
    const order = m.nodes().map((n) => propsOf(n)['data-testid']).filter((id) => ['phone-module-records', 'phone-module-tool', 'module-children'].includes(id));
    assert.deepEqual(order, ['phone-module-records', 'phone-module-tool', 'module-children']);
    assert.equal(textOf(all(m, 'phone-module-tool')[0]), 'Open the files tool');
    assert.equal(propsOf(all(m, 'phone-module-tool')[0]).href ?? propsOf(all(m, 'phone-module-tool')[0]).to, '/raise/data-room?mode=workspace&project_id=3', 'the door as handed');
    assert.equal(all(m, 'module-children')[0] && propsOf(all(m, 'module-children')[0]).id, 'tools');
  } finally { await m.unmount(); }
});

// ── 9. The record page ────────────────────────────────────────────────────

const RECORD = {
  title: 'Dispatch delays', sub: 'Pain theme · 6 interviews',
  pills: [{ text: 'Validated', tone: 'ok' }],
  facts: [{ label: 'Severity', value: 'High' }, { label: 'Interviews', value: 6 }, { label: 'First heard', value: '3 Sep' }, { label: 'Owner', value: null, reason: 'No owner was named when this theme was grouped.' }],
  next: { text: 'Link this theme to a hypothesis', action: 'link-hypothesis' },
  main: [{ key: 'quotes', title: 'Quotes', gate: 'read', rows: [{ a: '"We lose an hour a day"', b: 'Ada Quill · 12 Oct', c: 'Strong', tone: 'ok' }], action: 'add-quote' }],
  side: [{ key: 'links', title: 'Linked hypotheses', gate: 'read', side: true, rows: [] }],
  actions: [
    { key: 'link-hypothesis', label: 'Link a hypothesis', kind: 'form', tone: 'primary', form: { title: 'Link', fields: [] } },
    { key: 'add-quote', label: 'Add a quote', kind: 'form', form: { title: 'Quote', fields: [] } },
    { key: 'delete', label: 'Delete', kind: 'write', tone: 'danger', confirm: 'Delete this theme?' },
  ],
  activity: [{ a: 'Created by Ada Quill', b: '2026-09-03' }], activity_total: 30,
};
const recordPage = (record, handlers = {}, phone = true) => h(RecordPhoneProvider, { phone },
  h(RecordView, { record, cycleName: 'Validate', moduleName: 'Problem discovery', ...handlers }));

test('9: on a phone a record is Next for this record, its pills, At a glance, its sections with anchors, Activity and Actions', async () => {
  const forms = []; const writes = []; let all30 = 0;
  const m = await mountForm(recordPage(RECORD, { onForm: (a) => forms.push(a.key), onWrite: (a) => writes.push(a.key), onLink() {}, onClient() {}, onShowAll: () => { all30 += 1; } }));
  try {
    const text = m.text();
    assert.ok(text.indexOf('Next for this record') < text.indexOf('Validated'), 'Next first, then the pills');
    const cta = all(m, 'record-next-cta')[0];
    assert.equal(textOf(cta), 'Link a hypothesis', 'the named action\'s label');
    propsOf(cta).onClick();
    assert.deepEqual(forms, ['link-hypothesis'], 'run through the record\'s handlers, not a link back');
    for (const label of ['At a glance', 'Severity', 'High', 'Owner', 'Not recorded', 'No owner was named when this theme was grouped.']) assert.ok(text.includes(label), label);
    const ids = m.nodes().map((n) => propsOf(n).id).filter(Boolean);
    assert.ok(ids.includes('rec-validate-problem-discovery-quotes'));
    assert.ok(ids.includes('rec-validate-problem-discovery-linked-hypotheses'));
    assert.ok(ids.includes('rec-validate-problem-discovery-activity'));
    const quotes = m.nodes().find((n) => propsOf(n).id === 'rec-validate-problem-discovery-quotes');
    assert.match(textOf(quotes).trim(), /^Quotes"We lose an hour a day"[\s\S]*Add a quote›$/, 'the section action is its group\'s last row');
    await tap(m, 'Add a quote');
    assert.deepEqual(forms, ['link-hypothesis', 'add-quote']);
    await tap(m, 'Show all');
    assert.equal(all30, 1);
    const actions = text.slice(text.lastIndexOf('Actions'));
    assert.ok(actions.includes('Link a hypothesis') && actions.includes('Delete'));
    const red = m.nodes().filter((n) => n.tagName === 'SPAN' && /\btext-red-700\b/.test(propsOf(n).className || ''));
    assert.deepEqual(red.map((n) => textOf(n)), ['Delete'], 'Delete, and only Delete, in red');
    assert.match(propsOf(red[0]).className, /dark:text-red-300/);
    await tap(m, 'Delete');
    assert.deepEqual(writes, ['delete']);
    assert.equal(propsOf(all(m, 'record-view')[0])['data-phone'], 'true');
  } finally { await m.unmount(); }
});

test('9 and 10: no CTA when the read declares no such action; an omitted section draws nothing; at desktop, today\'s cards', () => {
  const reader = { ...RECORD, actions: [], main: [], side: [] };
  const out = ssr(recordPage(reader));
  assert.ok(renderedText(out).includes('Link this theme to a hypothesis'), 'the headline stands alone');
  assert.equal(tag(out, 'record-next-cta'), '');
  assert.doesNotMatch(out, /rec-validate-problem-discovery-quotes/);
  assert.equal(tag(out, 'record-actions'), '', 'no actions, no group');
  const desk = ssr(recordPage(RECORD, {}, false));
  assert.doesNotMatch(desk, /data-phone=/);
  assert.equal(tag(desk, 'record-next'), '');
  assert.ok(tag(desk, 'record-facts').includes('grid'), 'the desktop facts grid');
});

// ── 15. PhoneBar's back.onClick ───────────────────────────────────────────

test('15: PhoneBar\'s back.onClick is a button that calls it, never the no-history fallback; CycleBar lifts the bar out of the gutter', async () => {
  let back = 0;
  const m = await mountForm(h(PhoneBar, { back: { label: 'Problem discovery', onClick: () => { back += 1; } }, title: 'New theme' }));
  try {
    const button = m.nodes().find((n) => n.tagName === 'BUTTON' && textOf(n).includes('‹ Problem discovery'));
    assert.ok(button);
    assert.match(propsOf(button).className, /text-violet-700 dark:text-violet-300/);
    propsOf(button).onClick();
    assert.equal(back, 1);
    assert.equal(m.nodes().filter((n) => n.tagName === 'A').length, 0, 'no link');
  } finally { await m.unmount(); }
  const bar = tag(ssr(h(CycleBar, { back: { label: 'Validate', to: `/validate${Q}` }, title: 'Problem discovery' })), 'cycle-bar');
  for (const cls of ['sticky', 'top-0', '-mx-[22px]', '-mt-[14px]', 'mb-[14px]']) assert.ok(bar.includes(cls), cls);
  const body = read('frontend/src/pages/cycles/CycleRoute.jsx').split('\n').find((l) => l.includes('data-testid="cycle-route-body"'));
  for (const cls of PHONE_GUTTER.split(' ')) assert.ok(body.includes(cls), `PHONE_GUTTER's ${cls} is the body's below lg`);
});

// ── 14. One breakpoint (this PR's part) ───────────────────────────────────

test('14: PhoneModulePage has no md: rule and reads no width; every light class has its dark pair', () => {
  const src = read('frontend/src/pages/cycles/PhoneModulePage.jsx');
  assert.doesNotMatch(src, /\bmd:/);
  assert.doesNotMatch(src, /matchMedia|innerWidth/);
  for (const line of src.split('\n').filter((l) => /className="[^"]*\b(bg-white|text-gray-900|bg-violet-700|text-violet-700|border-gray-200)\b/.test(l))) {
    assert.match(line, /dark:/, line.trim().slice(0, 80));
  }
  assert.doesNotMatch(read('frontend/src/pages/cycles/RecordView.jsx'), /matchMedia|innerWidth/);
});
