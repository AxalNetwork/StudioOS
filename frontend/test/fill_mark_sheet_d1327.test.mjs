// D1327 (#3488), Fill with Eadwyn part 4: FillMark and FillSheet.
//   - the model (`lib/fillSheet.js`): each mark's words, the card's lines, the
//     Preview's rows in AF6's order, each refusal in the canvas's words, the
//     stream without `meta`;
//   - the trigger: drawn only when the read says so (never on a typed,
//     never-fill or decision field, never for a reader);
//   - the sheet, mounted against a stubbed fetch: every state draws (loading,
//     error with its ref, nothing to fill, no source, sources, preview,
//     running, partial, each refusal, out of tokens with Add tokens, a changed
//     form); "Yours · kept" is never taken by Accept all; every checkbox is
//     labelled; no model name or option key reaches the markup; closing
//     returns focus to the trigger;
//   - the mark's Undo dialog; Validate's provenance cell; the "From GitHub" and
//     "From Mercury" heads.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fill_mark_sheet_d1327.test.mjs
import test from 'node:test';
import { codeOnly } from './_codeOnly.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  averageLine, cardLines, errorRef, markView, parseStream, partialLine, planRows, refusalView, sourceRows, topLine,
} from '../src/lib/fillSheet.js';
import { ConnectorMark, FillFormTrigger, FillMark, FillModuleTrigger, FillTrigger } from '../src/ui/FillMark.jsx';
import FillSheet from '../src/ui/FillSheet.jsx';
import { Cell } from '../src/pages/cycles/CycleModulePage.jsx';
import { RECORDS } from '../src/pages/cycles/adapters/validate.js';

const h = React.createElement;
const MODEL = 'SYNTHETIC_MODEL_NAME_D1327';

// ── The read (D1325's shape) ────────────────────────────────────────────────

const field = (f, extra = {}) => ({
  field: f, label: f[0].toUpperCase() + f.slice(1), table: 'features', column: f, class: 'composition', sources: [],
  value: null, mark: null, never_fill: null, offered_to_eadwyn: true, trigger: true, waiting: [], choices: [], ...extra,
});
const READ = {
  page: 'Founder · Build · Features', form: 'feature', project: 7, record: null, can_fill: true, marks_state: 'ok',
  sources: [
    { key: 'eadwyn', kind: 'eadwyn', label: 'Eadwyn', state: 'ok', as_of: null },
    { key: 'connector:github', kind: 'connector', label: 'GitHub', state: 'ok', as_of: '2026-10-12T09:00:00Z' },
    { key: 'connector:linear', kind: 'connector', label: 'Linear', state: 'not_connected', as_of: null },
    { key: 'module:validate', kind: 'module', label: 'Validate', state: 'ok', as_of: null },
  ],
  fields: [
    field('title', { waiting: [{ source: 'connector:github', field: 'title', value: 'Fleet sync', label: 'Fleet sync', ref: 'gh-1' }] }),
    field('summary', { value: 'My own words', waiting: [{ source: 'connector:github', field: 'summary', value: 'Repo summary', label: 'Repo summary', ref: 'gh-2' }] }),
    field('hypothesis', { offered_to_eadwyn: false, choices: [{ source: 'module:validate', value: 3, label: 'H3 · Fleets pay', ref: 3 }] }),
    field('notes'),
    field('effort'),
    field('signature', { never_fill: { category: 'signature', label: 'Signatures and consents' }, offered_to_eadwyn: false, trigger: false }),
  ],
  quote: { option: 'form:feature', state: 'ok', runs: 9, average_microusd: 1100 },
};
const sse = (events) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}`).join('\n\n');
const DONE = { proposals: [{ uid: 'p1', field: 'notes', value: 'Sync every fleet nightly' }], dropped: [{ field: 'effort', why: 'no_citation' }], usage_log_id: 41, charged_microusd: 1200, budget: {} };

// ── The model ───────────────────────────────────────────────────────────────

test('each mark says where the value came from, and a failed read is "Unreadable", never "Typed"', () => {
  assert.equal(markView(null), null, 'a founder-typed value carries no mark');
  assert.equal(markView(null, { readOnly: true }).text, 'Typed', 'a reader sees the muted "Typed"');
  assert.equal(markView({ state: 'unreadable' }).text, 'Unreadable');
  assert.equal(markView({ state: 'unreadable' }, { readOnly: true }).text, 'Unreadable');
  assert.equal(markView({ source_kind: 'eadwyn' }, { placed: true }).text, 'Not saved');
  assert.equal(markView({ source_kind: 'eadwyn' }).text, 'Eadwyn');
  assert.equal(markView({ source_kind: 'eadwyn', edited: true, fill_class: 'sourced' }).text, 'Eadwyn · edited');
  assert.equal(markView({ source_kind: 'eadwyn', fill_class: 'sourced' }).text, 'Eadwyn · sourced');
  assert.equal(markView({ source_kind: 'connector', source_ref: 'mercury', source_as_of: '2026-10-12T00:00:00Z' }).text, 'Connector · Mercury · 12 Oct');
  assert.equal(markView({ source_kind: 'module', source_ref: 'validate/hypotheses', source_label: 'recorded' }).text, 'Recorded · From Validate');
});

test('the card names the source, its quote and the run, never a model', () => {
  const lines = cardLines({ source_kind: 'eadwyn', edited: true, proposed_value: '$4.2B', model: MODEL, citation: { source: 'Gartner 2026', quote: 'It is $4.2B.' } }, 'Run: Fill · charged $0.0012');
  assert.deepEqual(lines, ['Eadwyn proposed this and you changed it before saving.', 'Source: Gartner 2026', '“It is $4.2B.”', 'It proposed: $4.2B', 'Run: Fill · charged $0.0012']);
  assert.deepEqual(cardLines({ source_kind: 'connector', source_ref: 'github', source_as_of: '2026-10-12' }, null), ['From GitHub, as of 12 Oct.']);
  assert.deepEqual(cardLines({ state: 'unreadable' }, 'x'), []);
});

test('the average is the member’s own, and never a zero', () => {
  assert.equal(averageLine({ state: 'ok', runs: 9, average_microusd: 1100 }), 'Your average: $0.0011 over 9 runs');
  assert.equal(averageLine({ state: 'ok', runs: 1, average_microusd: 1100 }), 'Your average: $0.0011 over 1 run');
  assert.equal(averageLine({ state: 'ok', runs: 0, average_microusd: null }), 'No average yet. The cost shows after the run.');
  assert.equal(averageLine({ state: 'ok', runs: 0, average_microusd: 0 }), 'No average yet. The cost shows after the run.', 'no runs is never "$0 over 0 runs"');
  assert.match(averageLine({ state: 'unreadable' }), /could not be read/);
});

test('sources come first, Eadwyn last; the Preview orders a connector before a module before Eadwyn and keeps a typed value', () => {
  assert.deepEqual(sourceRows(READ).map((s) => [s.key, s.tickable]), [
    ['connector:github', true], ['connector:linear', false], ['module:validate', true], ['eadwyn', true],
  ]);
  const both = { ...READ, fields: [field('title', { waiting: [
    { source: 'eadwyn', field: 'title', value: 'From Eadwyn', ref: 'prop-9' },
    { source: 'connector:github', field: 'title', value: 'From GitHub', label: 'From GitHub', ref: 'gh-1' },
  ] })] };
  const [row] = planRows(both, { ticked: new Set(['eadwyn', 'connector:github']) });
  assert.deepEqual(row.candidates.map((c) => c.kind), ['connector', 'eadwyn'], 'a connector’s fact comes before Eadwyn');
  assert.equal(row.candidates[1].proposal_uid, 'prop-9', 'an earlier run’s value is its proposal');
  assert.equal(row.accept, true);

  const rows = planRows(READ, { ticked: new Set(['connector:github', 'module:validate', 'eadwyn']), run: DONE });
  const by = Object.fromEntries(rows.map((r) => [r.field, r]));
  assert.equal(rows.some((r) => r.field === 'signature'), false, 'a never-fill field has no row');
  assert.equal(by.summary.kept, true); assert.equal(by.summary.accept, false, 'a typed value is never ticked');
  assert.equal(by.hypothesis.candidates.length, 0); assert.equal(by.hypothesis.choices[0].shown, 'H3 · Fleets pay', 'a module offers choices, never a value');
  assert.equal(by.notes.candidates[0].proposal_uid, 'p1');
  assert.equal(by.effort.reason, 'Eadwyn left this blank: nothing in your records supports it.');
  assert.equal(planRows(READ, { ticked: new Set() }).find((r) => r.field === 'notes').reason, 'No source said it.');
  assert.equal(topLine(rows, {}, 1200), '5 fields · 1 from your sources · 1 from Eadwyn · charged $0.0012');
  assert.equal(partialLine(rows), 'Filled 3 of 4.');
});

test('each refusal is the canvas’s sentence, and a key-shaped message is never shown', () => {
  assert.equal(refusalView({ code: 'assist_off' }).kind, 'off');
  for (const code of ['guard_blocked', 'guard_blocked_output', 'guard_unavailable', 'misconfigured']) assert.equal(refusalView({ code }).kind, 'guard', code);
  assert.match(refusalView({ code: 'guard_blocked' }, { charged: 900 }).text, /charged \$0\.0009/);
  assert.doesNotMatch(refusalView({ code: 'guard_unavailable' }).text, /charged \$/);
  for (const code of ['budget_user_day', 'budget_user_month', 'budget_org_month', 'kill_switch']) {
    const v = refusalView({ code });
    assert.equal(v.kind, 'tokens', code); assert.equal(v.addTokens, true, code);
  }
  assert.equal(refusalView({ code: 'spend_limit', message: 'Your limit resets on 1 Nov.' }).text, 'Your limit resets on 1 Nov.');
  assert.equal(refusalView({ code: 'ai_paused' }).kind, 'tokens');
  assert.equal(refusalView({ code: 'record_changed' }).again, true);
  assert.equal(refusalView({ code: 'nothing_to_fill' }).kind, 'empty');
  assert.equal(refusalView({ code: 'x', message: 'some_internal_key' }).text, 'Eadwyn could not be reached. Nothing was proposed.');
});

test('the stream is read without `meta`, which names the model', () => {
  const events = parseStream(sse([['meta', { model: MODEL, hold_microusd: 2000 }], ['guard', { input: 'ok' }], ['done', DONE]]) + '\n\nevent: done\ndata: {broken');
  assert.deepEqual(events.map((e) => e.event), ['guard', 'done']);
  assert.doesNotMatch(JSON.stringify(events), new RegExp(MODEL));
  assert.match(errorRef(12345), /^[0-9A-F]{4}-[0-9A-F]{4}$/);
});

// ── The trigger ─────────────────────────────────────────────────────────────

test('the trigger is drawn only when the read offers it: never on a typed, never-fill or decision field, never for a reader', () => {
  const html = (props) => renderToStaticMarkup(h(FillTrigger, props));
  for (const why of ['typed', 'never_fill', 'decision', 'reader']) {
    assert.equal(html({ field: field('x', { trigger: false, why }), onOpen() {} }), '', why);
  }
  const on = html({ field: field('title'), onOpen() {} });
  assert.match(on, /aria-label="Ask Eadwyn to fill Title"/);
  assert.match(on, /data-testid="fill-trigger-title"/);
  assert.match(html({ field: field('title'), aiOff: true, onOpen() {} }), /aria-label="Ask to fill Title from your sources"/);
});

// ── The sheet, mounted ──────────────────────────────────────────────────────

async function mount(element, { routes = {}, activeElement } = {}) {
  const restoreDoc = installDocument();
  const createElement = document.createElement.bind(document);
  document.createElement = (tag) => {
    const n = createElement(tag);
    n.querySelector = () => null; n.querySelectorAll = () => []; n.focus = function focus() { document.activeElement = this; };
    n.children = []; n.isConnected = true; n.offsetParent = {};
    return n;
  };
  document.querySelectorAll = () => [];
  document.body.style = { overflow: 'auto', paddingRight: '' };
  if (activeElement) document.activeElement = activeElement;
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    if (!key) throw new Error(`unrouted ${url}`);
    return routes[key](calls.at(-1));
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, null, element)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const all = () => walk(container);
  const byTestId = (id) => all().find((n) => props(n)['data-testid'] === id);
  const text = (n = container) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const flush = async () => { for (let i = 0; i < 4; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  const press = async (id) => { const n = byTestId(id); assert.ok(n, `missing ${id}`); assert.ok(!props(n).disabled, `${id} is disabled`); await act(async () => { props(n).onClick({ preventDefault() {}, stopPropagation() {} }); }); await flush(); };
  // Every attribute React was given, so a test can read the whole markup for a word.
  const markup = () => all().map((n) => (n.nodeType === 3 ? n.textContent : JSON.stringify(Object.fromEntries(Object.entries(props(n)).filter(([, v]) => typeof v !== 'function' && typeof v !== 'object'))))).join('\n');
  await flush();
  return {
    calls, all, props, byTestId, text, flush, press, markup,
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = realFetch; restoreDoc(); },
  };
}
const json = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: new Map(), json: async () => body, text: async () => JSON.stringify(body) });
const stream = (events) => ({ ok: true, status: 200, json: async () => ({}), text: async () => sse(events) });
const sheet = (props = {}) => h(FillSheet, { page: READ.page, form: 'feature', project: 7, title: 'Add feature', onClose() {}, onPlace() {}, ...props });

test('loading, then an error with its reference and Try again', async () => {
  let release;
  const m = await mount(sheet(), { routes: { '/api/fills/sheet': () => new Promise((r) => { release = r; }) } });
  try {
    assert.ok(m.byTestId('fill-sheet'), 'the sheet is D1317’s Sheet');
    const titleId = m.props(m.byTestId('fill-sheet'))['aria-labelledby'];
    assert.equal(m.text(m.all().find((n) => m.props(n).id === titleId)), 'Add feature');
    assert.match(m.text(m.byTestId('fill-sheet')), /Ask Eadwyn\s*Add feature/);
    assert.ok(m.byTestId('fill-sheet-loading'));
    await act(async () => { release(json({ detail: 'boom' }, 500)); }); await m.flush();
    assert.ok(m.byTestId('fill-sheet-error'));
    assert.match(m.text(m.byTestId('fill-sheet-error')), /We could not read your sources\. Try again\./);
    assert.match(m.text(m.byTestId('fill-sheet-ref')), /^ref [0-9A-F]{4}-[0-9A-F]{4}$/);
  } finally { await m.unmount(); }
});

test('nothing to fill when every field has a value; the page’s own values count', async () => {
  const m = await mount(sheet({ values: { title: 'a', notes: 'b', effort: 'M', hypothesis: 3 } }), { routes: { '/api/fills/sheet': () => json(READ) } });
  try {
    assert.ok(m.byTestId('fill-sheet-nothing'));
    assert.equal(m.byTestId('fill-sheet-preview'), undefined);
  } finally { await m.unmount(); }
});

test('sources: each with a labelled checkbox, a Connect link, the member’s average, and "No source has anything" when none does', async () => {
  const m = await mount(sheet(), { routes: { '/api/fills/sheet': () => json(READ) } });
  try {
    assert.ok(m.byTestId('fill-sheet-sources'));
    const boxes = m.all().filter((n) => n.tagName === 'INPUT' && m.props(n).type === 'checkbox');
    assert.equal(boxes.length, 4);
    for (const b of boxes) assert.match(String(m.props(b)['aria-label'] || ''), /^Use \w/);
    assert.equal(m.byTestId('fill-sheet-no-source'), undefined);
    assert.equal(m.props(m.byTestId('fill-source-connect-connector:linear')).href, '/account/connectors/linear');
    assert.equal(m.text(m.byTestId('fill-source-average')), 'Your average: $0.0011 over 9 runs');
    assert.match(m.text(m.byTestId('fill-source-connector:github')), /2 values · last sync 12 Oct.*No AI tokens/);
  } finally { await m.unmount(); }
  const empty = { ...READ, fields: READ.fields.map((f) => ({ ...f, waiting: [], choices: [] })) };
  const e = await mount(sheet(), { routes: { '/api/fills/sheet': () => json(empty) } });
  try { assert.ok(e.byTestId('fill-sheet-no-source')); } finally { await e.unmount(); }
});

test('preview: a real table, "Yours · kept" outside Accept all, "Use GitHub’s instead", partial, and no model in the markup', async () => {
  const placed = []; let closed = 0;
  const m = await mount(sheet({ onPlace: (l) => placed.push(...l), onClose: () => { closed += 1; } }), { routes: {
    '/api/fills/sheet': () => json(READ),
    '/api/ai/rail/run': () => stream([['meta', { model: MODEL, hold_microusd: 2000 }], ['guard', { input: 'ok', output: 'ok' }], ['done', DONE]]),
  } });
  try {
    await m.press('fill-sheet-preview');
    const run = m.calls.find((c) => c.url === '/api/ai/rail/run');
    assert.equal(run.body.option, 'form:feature'); assert.equal(run.body.project, 7);
    assert.ok(m.byTestId('fill-sheet-table'));
    assert.equal(m.text(m.byTestId('fill-sheet-topline')), '5 fields · 1 from your sources · 1 from Eadwyn · charged $0.0012');
    assert.equal(m.text(m.byTestId('fill-sheet-partial')), 'Filled 3 of 4.');
    assert.equal(m.text(m.byTestId('fill-row-kept-summary')), 'Yours · kept');
    assert.equal(m.text(m.byTestId('fill-row-reason-effort')), 'Eadwyn left this blank: nothing in your records supports it.');
    assert.match(m.text(m.byTestId('fill-sheet-never')), /Signature: Eadwyn never fills signatures and consents\./);
    // Every checkbox is named.
    const boxes = m.all().filter((n) => n.tagName === 'INPUT' && m.props(n).type === 'checkbox');
    assert.ok(boxes.length >= 2);
    for (const b of boxes) assert.match(String(m.props(b)['aria-label'] || ''), /^Accept \w/);
    assert.ok(m.byTestId('fill-row-choose-hypothesis'));
    assert.equal(m.props(m.byTestId('fill-row-choose-hypothesis'))['aria-label'], 'Hypothesis: choose a record');
    // No model name, no option key.
    assert.doesNotMatch(m.markup(), new RegExp(`${MODEL}|form:feature|Model:`));
    assert.equal(m.text(m.byTestId('fill-sheet-accept-all')), 'Accept all (2)', 'the typed summary is not counted');
    await m.press('fill-sheet-accept-all');
    assert.deepEqual(placed.map((p) => [p.field, p.value, p.source_kind, p.proposal_uid]), [
      ['title', 'Fleet sync', 'connector', null], ['notes', 'Sync every fleet nightly', 'eadwyn', 'p1'],
    ]);
    assert.equal(closed, 1);
  } finally { await m.unmount(); }
});

test('"Use GitHub’s instead" takes one typed field, by the member’s own press', async () => {
  const placed = [];
  const m = await mount(sheet({ onPlace: (l) => placed.push(...l), aiOff: true }), { routes: { '/api/fills/sheet': () => json(READ) } });
  try {
    await m.press('fill-sheet-preview');
    assert.equal(m.calls.some((c) => c.url === '/api/ai/rail/run'), false, 'AI off: nothing runs');
    assert.match(m.text(m.byTestId('fill-row-use-summary')), /^Use GitHub’s instead$/);
    await m.press('fill-row-use-summary');
    assert.equal(m.byTestId('fill-row-kept-summary'), undefined);
    assert.equal(m.text(m.byTestId('fill-sheet-accept-all')), 'Accept all (1)', 'Accept all still leaves the typed value alone');
    await m.press('fill-sheet-accept-selected');
    assert.deepEqual(placed.map((p) => [p.field, p.value]), [['title', 'Fleet sync'], ['summary', 'Repo summary']]);
  } finally { await m.unmount(); }
  const all = [];
  const n = await mount(sheet({ onPlace: (l) => all.push(...l), aiOff: true }), { routes: { '/api/fills/sheet': () => json(READ) } });
  try {
    await n.press('fill-sheet-preview');
    await n.press('fill-row-use-summary');
    await n.press('fill-sheet-accept-all');
    assert.deepEqual(all.map((p) => p.field), ['title'], 'Accept all never takes a typed field');
  } finally { await n.unmount(); }
});

test('running: the sheet says Eadwyn is checking, Accept all waits, and closing warns of the charge', async () => {
  const m = await mount(sheet(), { routes: { '/api/fills/sheet': () => json(READ), '/api/ai/rail/run': () => new Promise(() => {}) } });
  try {
    await m.press('fill-sheet-preview');
    assert.ok(m.byTestId('fill-sheet-running'));
    const all = m.props(m.byTestId('fill-sheet-accept-all'));
    assert.equal(all.disabled, true); assert.equal(all.title, 'Ready when every value is checked.');
    assert.match(m.text(), /Closing drops the result\. A run that started is still charged\./);
  } finally { await m.unmount(); }
});

for (const [name, answer, kind, extra] of [
  ['assist off', { refusal: { code: 'assist_off', status: 403, message: 'assist_off' } }, 'off'],
  ['the guard', { refusal: { code: 'guard_blocked', status: 422, message: 'x' }, charged_microusd: 900 }, 'guard'],
  ['out of tokens', { refusal: { code: 'budget_user_month', status: 402, message: 'x' } }, 'tokens', 'add'],
  ['a changed form', { proposals: [], dropped: [{ field: 'notes', why: 'record_changed' }], charged_microusd: 0 }, 'changed', 'again'],
]) {
  test(`refused: ${name}`, async () => {
    const m = await mount(sheet({ turnOnHref: '/account/ai' }), { routes: { '/api/fills/sheet': () => json(READ), '/api/ai/rail/run': () => stream([['meta', { model: MODEL }], ['done', answer]]) } });
    try {
      await m.press('fill-sheet-preview');
      assert.ok(m.byTestId(`fill-sheet-refused-${kind}`), m.text());
      assert.ok(m.byTestId('fill-row-title'), 'the sources’ values stay offered');
      if (extra === 'add') {
        assert.equal(m.props(m.byTestId('fill-sheet-add-tokens')).href, '/pricing?for=models#add-tokens');
        assert.equal(m.text(m.byTestId('fill-sheet-sources-only')), 'Ask from your sources only');
        await m.press('fill-sheet-sources-only');
        assert.equal(m.calls.filter((c) => c.url === '/api/ai/rail/run').length, 1, 'sources only runs nothing');
      }
      if (extra === 'again') assert.ok(m.byTestId('fill-sheet-again'));
      if (kind === 'off') assert.match(m.text(), /Turn it on/);
      assert.doesNotMatch(m.markup(), new RegExp(MODEL));
    } finally { await m.unmount(); }
  });
}

test('refused before the stream: nothing_to_fill is the empty state', async () => {
  const m = await mount(sheet(), { routes: { '/api/fills/sheet': () => json(READ), '/api/ai/rail/run': () => json({ code: 'nothing_to_fill', detail: 'nothing_to_fill' }, 400) } });
  try {
    await m.press('fill-sheet-preview');
    assert.ok(m.byTestId('fill-sheet-refused-empty'), m.text());
  } finally { await m.unmount(); }
});

test('closing the sheet returns focus to the trigger that opened it', async () => {
  const trigger = { focused: 0, isConnected: true, focus() { this.focused += 1; } };
  const m = await mount(sheet(), { routes: { '/api/fills/sheet': () => json(READ) }, activeElement: trigger });
  assert.equal(document.activeElement, m.byTestId('fill-sheet'), 'focus moved into the sheet');
  await m.unmount();
  assert.equal(trigger.focused, 1);
});

// ── The mark ────────────────────────────────────────────────────────────────

test('the mark opens its card; Undo asks first, then restores what was there', async () => {
  const undone = [];
  const mark = { source_kind: 'eadwyn', fill_class: 'sourced', provenance_id: 7, prior_value: null, model: MODEL, run: null };
  const m = await mount(h(FillMark, { mark, onUndone: (r) => undone.push(r) }), { routes: { '/api/fills/7/undo': () => json({ ok: true, id: 7, value: null }) } });
  try {
    assert.equal(m.text(m.byTestId('fill-mark')), 'Eadwyn · sourced');
    assert.doesNotMatch(m.markup(), new RegExp(MODEL));
    await m.press('fill-mark');
    assert.match(m.text(m.byTestId('fill-mark-card')), /Eadwyn supplied this value\.Run: not recorded/);
    await m.press('fill-mark-undo');
    assert.ok(m.byTestId('fill-undo-dialog'));
    assert.equal(m.text(m.byTestId('fill-undo-prior')), 'It goes back to: Blank');
    assert.equal(m.calls.length, 0, 'nothing is undone before the confirm');
    await m.press('fill-undo-confirm');
    assert.deepEqual(m.calls.map((c) => [c.method, c.url]), [['POST', '/api/fills/7/undo']]);
    assert.deepEqual(undone, [{ ok: true, id: 7, value: null }]);
  } finally { await m.unmount(); }
  const r = await mount(h(FillMark, { mark, readOnly: true, onUndone() {} }));
  try {
    await r.press('fill-mark');
    assert.ok(r.byTestId('fill-mark-card'));
    assert.equal(r.byTestId('fill-mark-undo'), undefined, 'a reader is never offered Undo');
  } finally { await r.unmount(); }
});

test('Validate’s provenance cell is the mark; the From GitHub and From Mercury heads carry the connector mark', () => {
  const row = (provenance) => RECORDS.experiments.row({ id: 1, code: 'H1', claim: 'c', provenance }).cells.source;
  assert.deepEqual(row('eadwyn_edited'), { fill: { source_kind: 'eadwyn', edited: true }, text: 'Eadwyn · edited' });
  assert.equal(row(null), null, 'a founder’s own claim has no mark');
  assert.match(renderToStaticMarkup(h(Cell, { cell: row('unreadable') })), /data-kind="unreadable"[^>]*>Unreadable</);
  assert.match(renderToStaticMarkup(h(Cell, { cell: row('eadwyn') })), /data-testid="fill-mark"/);
  assert.match(renderToStaticMarkup(h(ConnectorMark, { provider: 'mercury' })), />Connector · Mercury</);
  for (const [file, provider] of [
    ['cycles/MvpFromGithub.jsx', 'github'], ['cycles/RoadmapFromGithub.jsx', 'github'], ['cycles/FoundingTeamFromCode.jsx', 'github'],
    ['cycles/CompanyFromCode.jsx', 'github'], ['cycles/SolutionDesignFromCode.jsx', 'github'], ['cycles/MercuryRaiseFeed.jsx', 'mercury'],
    ['cycles/GrowFromMercury.jsx', 'mercury'], ['investor/FromMercury.jsx', 'mercury'],
  ]) {
    const src = readFileSync(`frontend/src/pages/${file}`, 'utf8');
    assert.match(src, new RegExp(`From ${provider === 'github' ? 'GitHub' : 'Mercury'}\\s*<ConnectorMark provider="${provider}" \\/>\\s*</h2>`), file);
  }
});


test('Ask controls keep their labels, waiting counts and mode-specific glyphs', () => {
  const cases = [
    [FillFormTrigger, {}, 'Ask', 'Ask Eadwyn', 'Ask Eadwyn', false],
    [FillFormTrigger, { aiOff: true }, 'Ask', 'Ask (from your sources)', 'Ask (from your sources)', true],
    [FillModuleTrigger, { waiting: 0 }, 'Ask', 'Ask Eadwyn', 'Ask Eadwyn', false],
    [FillModuleTrigger, { waiting: 2 }, 'Ask 2 waiting', 'Ask Eadwyn, 2 waiting', 'Ask Eadwyn', false],
    [FillModuleTrigger, { aiOff: true, waiting: 0 }, 'Ask', 'Ask (from your sources)', 'Ask (from your sources)', true],
    [FillModuleTrigger, { aiOff: true, waiting: 2 }, 'Ask 2 waiting', 'Ask (from your sources), 2 waiting', 'Ask (from your sources)', true],
    [FillTrigger, { field: field('title') }, '', 'Ask Eadwyn to fill Title', 'Ask Eadwyn', false],
    [FillTrigger, { field: field('title'), aiOff: true }, '', 'Ask to fill Title from your sources', 'Ask (from your sources)', true],
  ];
  for (const [Component, props, text, name, title, neutral] of cases) {
    const html = renderToStaticMarkup(h(Component, props));
    assert.deepEqual({
      text: html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
      name: /aria-label="([^"]*)"/.exec(html)?.[1], title: /title="([^"]*)"/.exec(html)?.[1],
      glyph: html.includes('<svg'), neutral: html.includes('stroke="currentColor"'), oldLabel: html.includes('Fill with Eadwyn'),
    }, { text, name, title, glyph: true, neutral, oldLabel: false });
  }
});

test('the shared Ask surfaces contain no retired button copy or internal AUTOFILL name', () => {
  for (const file of ['ui/FillMark.jsx', 'ui/FillSheet.jsx', 'ui/useScopedFill.jsx', 'pages/cycles/FillRowsPanel.jsx',
    'pages/cycles/FormLightbox.jsx', 'pages/admin/PublicationDetail.jsx', 'pages/raise/dataroom/checklistModel.js', 'pages/deal/dealFrameModel.js']) {
    const src = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(codeOnly(src), /Fill with Eadwyn|waits in Fill|AUTOFILL/, file);
  }
});
