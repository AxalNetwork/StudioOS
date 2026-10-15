/**
 * D696 PR 1: real renderer and callbacks, without a live route or Worker read.
 * node --import ./frontend/test/_deck-loader.mjs --test frontend/test/record_page_d696.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import RecordView from '../src/pages/cycles/RecordView.jsx';
import * as rules from '../src/pages/cycles/recordModel.js';
import { mountContracts } from './_contracts_dom.mjs';
import { fixture, mutationCheck } from './_record_d696.mjs';

const h = React.createElement;
const context = { cycleName: 'Validate', moduleName: 'Problem discovery' };
const source = readFileSync(new URL('../src/pages/cycles/recordModel.js', import.meta.url), 'utf8');
const viewSource = readFileSync(new URL('../src/pages/cycles/RecordView.jsx', import.meta.url), 'utf8');
const markup = (View = RecordView, record = fixture(), extra = {}) => renderToStaticMarkup(h(View, { record, ...context, ...extra }));

function assertLinks(m) {
  assert.equal(m.rowLinks({ linkable: true }, { id: '7' }), true);
  assert.equal(m.rowLinks({}, { id: '7' }), false);
  assert.equal(m.rowLinks({ linkable: 'true' }, { id: '7' }), false);
  assert.equal(m.rowLinks({ linkable: true }, { id: 'fallback-7', recordId: null }), false);
  assert.equal(m.rowLinks({ linkable: true }, { id: 'fallback-7', recordId: 'worker-7' }), true);
  for (const id of ['Ab', 'a b', 'investors:Example Holder:0', 'Team', 'new', '', '../7']) assert.equal(m.rowLinks({ linkable: true }, { id }), false, id);
  assert.equal(m.recordId({ id: 7 }), '7');
  assert.equal(m.recordHref('validate', 'problem-discovery', '7', '?project_id=3&view=all'), '/validate/problem-discovery/7?project_id=3&view=all');
  assert.equal(m.recordHref('no-cycle', 'problem-discovery', '7'), null);
  assert.equal(m.recordHref('build', '../other', '7'), null);
  assert.equal(m.recordHref('build', 'solution-design', 'a b'), null);
  assert.equal(m.sectionId('Validate', 'Problem discovery', 'Quotes'), 'rec-validate-problem-discovery-quotes');
}
test('links need linkable plus a genuine valid Worker id and preserve the venture', async () => {
  assertLinks(rules);
  await mutationCheck(source, 'pages/cycles/recordModel.js', assertLinks, [
    ["records?.linkable === true", 'true'],
    ["Object.hasOwn(row, 'recordId')", 'row.recordId != null'],
    ["id !== 'new'", 'true'],
    ['+ query;', "+ '';"],
    ["'rec-' + slug", "'section-' + slug"],
  ]);
});

function assertRows(m) {
  assert.equal(m.toneOf('vio'), 'v1'); assert.equal(m.toneOf('amb'), 'warn');
  for (const tone of ['v1', 'v2', 'v3', 'grey', 'ok', 'warn', 'bad', 'muted']) assert.equal(m.toneOf(tone), tone);
  assert.equal(m.toneOf('invented'), null);
  assert.deepEqual(m.rowView({ a: 'A', b: 0, c: 'Ready', tone: 'amb', href: '/build' }),
    { a: 'A', b: 0, c: 'Ready', tone: 'warn', href: '/build', action: undefined });
  assert.equal(m.rowView({ href: 'https://example.invalid' }).href, null);
  assert.deepEqual(m.pillView({ text: 'Curated', tone: 'vio' }), { text: 'Curated', tone: 'v1' });
}
test('row mapping preserves zero, third-column status and canvas tone aliases', async () => {
  assertRows(rules);
  await mutationCheck(source, 'pages/cycles/recordModel.js', assertRows, [
    ["tone === 'vio' ? 'v1'", "tone === 'vio' ? null"],
    ["tone === 'amb' ? 'warn'", "tone === 'amb' ? null"],
    ["c: row.c ?? ''", "c: ''"],
    ["b: row.b ?? ''", "b: row.b || ''"],
  ]);
});

function assertDispatch(m) {
  const r = fixture(); const map = m.declaredActions(r);
  assert.deepEqual(r.actions.map(m.dispatchOf), ['link', 'mailto', 'form', 'write', 'client', 'write', null, null, null]);
  for (const href of ['//example.invalid', '/\\example.invalid', '/\n/evil', 'https://example.invalid']) assert.equal(m.dispatchOf({ key: 'x', kind: 'link', href }), null);
  assert.equal(m.dispatchOf({ key: 'x', kind: 'invented' }), null);
  assert.equal(typeof m.CLIENT_ACTIONS.get('export-persona'), 'function');
  const body = { occurrence: 'meeting-3' };
  assert.equal(m.rowAction({ key: 'open-minutes', body, kind: 'link', href: 'https://example.invalid' }, map).body, body);
  assert.equal(m.rowAction({ key: 'open-minutes', body, kind: 'link' }, map).kind, 'write');
  assert.equal(m.rowAction('undeclared', map), null);
  assert.equal(m.rowAction({ key: 'undeclared', kind: 'write' }, map), null);
  assert.equal(m.rowAction('attach', map).kind, 'form');
  assert.equal(m.rowAction('add-theme', map).kind, 'form');
}
test('only declared actions dispatch, using the declaration and the row body', async () => {
  assertDispatch(rules);
  await mutationCheck(source, 'pages/cycles/recordModel.js', assertDispatch, [
    ["if (CLIENT_ACTIONS.has(action.key))", 'if (false)'],
    ["return 'mailto';", "return 'link';"],
    ['if (recordLink(action.href))', 'if (action.href)'],
    ['{ ...action, body: reference.body }', '{ ...action, ...reference }'],
    ["...(record?.side ?? [])", '...[]'],
  ]);
});

function assertLayout(module) {
  const out = markup(module.default);
  for (const word of ['Curated', 'Needs evidence', 'Not recorded', 'No urgency score has been recorded.', 'Attach a quote', 'Add theme', 'No evidence attached.', 'Nothing recorded here yet.', 'Harbour segment created', '15 Oct 2026', 'Show all']) assert.ok(out.includes(word), word);
  assert.equal((out.match(/tracking-\[0.09em\]/g) || []).length, 4);
  assert.match(out, />0<\/div>/);
  for (const cls of ['bg-axal-violet', 'text-red-700', 'dark:text-red-300', 'dark:bg-gray-900', '@[760px]/cycle:grid-cols-4', '@[760px]/cycle:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]', 'grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto]', 'scroll-mt-4']) assert.ok(out.includes(cls), cls);
  for (const id of ['quotes', 'activity']) assert.ok(out.includes('id="rec-validate-problem-discovery-' + id + '"'));
  for (const forbidden of ['Unsafe URL', 'External URL', 'Missing URL', 'Never send me', 'Never display this next step', 'role="dialog"']) assert.ok(!out.includes(forbidden), forbidden);
  const r = fixture(); r.activity_total = 1;
  assert.ok(!markup(module.default, r).includes('Show all'));
  const empty = { ...r, actions: [], main: [], side: [], activity: [], activity_total: 0 };
  const none = markup(module.default, empty);
  assert.ok(!none.includes('<button')); assert.ok(!none.includes('Quotes')); assert.ok(!none.includes('Pain themes'));
  const override = markup(module.default, r, { activity: [...r.activity, { a: 'A real appended event', b: '16 Oct 2026' }] });
  assert.ok(override.includes('A real appended event'));
  assert.ok(!override.includes('Show all'));
}
test('canvas layout, real activity, missing facts, omissions and empty states render', async () => {
  assertLayout({ default: RecordView });
  await mutationCheck(viewSource, 'pages/cycles/RecordView.jsx', assertLayout, [
    ['fact.value == null', '!fact.value'],
    ['total > rows.length', 'total >= rows.length'],
    ["section.empty || 'Nothing recorded here yet.'", "'Different empty copy'"],
    ["{text(row.a)}</span>", "{'Template event'}</span>"],
    ['rows={activity ?? record.activity}', 'rows={record.activity}'],
    ['@[760px]/cycle:grid-cols-4', 'grid-cols-4'],
    ['bg-axal-violet text-white', 'bg-white text-white'],
    ['scroll-mt-4', 'scroll-mt-0'],
  ], true);
});

test('unknown tones stay plain and main versus side rows keep three versus two cells', () => {
  const r = { ...fixture(), main: [{ key: 'plain', title: 'Plain', rows: [{ a: 'Left', b: 'Middle', c: 'Unknown status', tone: 'unrecognized' }] }], side: [{ key: 'side', title: 'Side', rows: [{ a: 'Side key', b: 'Side value' }] }] };
  const out = markup(RecordView, r);
  assert.match(out, /<span>Unknown status<\/span>/);
  assert.match(out, /Side key/); assert.match(out, /Side value/);
});

async function assertClicks(module) {
  const seen = []; const r = fixture();
  const m = await mountContracts(h(module.default, { record: r, ...context,
    onForm: (a) => seen.push(['form', a]), onWrite: (a) => seen.push(['write', a]),
    onClient: (a) => seen.push(['client', a]), onLink: (a) => seen.push(['link', a]),
    onShowAll: () => seen.push(['activity']),
  }));
  try {
    await m.click('Edit'); await m.click('Delete'); await m.click('Export persona');
    await m.click('Attach a quote'); await m.click('Add theme'); await m.click('Show all');
    const buttons = m.nodes().filter((node) => node.tagName === 'BUTTON' && m.props(node)?.children === 'Open minutes');
    assert.equal(buttons.length, 3, 'top action plus two real row actions');
    for (const node of buttons) await act(async () => m.props(node).onClick());
    const links = m.nodes().filter((node) => node.tagName === 'A' && ['Compare segments', 'Draft email'].includes(m.props(node)?.children));
    assert.equal(links.length, 2);
    let prevented = 0;
    for (const node of links) await act(async () => m.props(node).onClick({ button: 0, preventDefault() { prevented++; } }));
    assert.equal(prevented, 2);
    await act(async () => m.props(links[0]).onClick({ button: 0, ctrlKey: true, preventDefault() { throw Error('must keep new tab'); } }));
    assert.equal(seen.filter(([kind]) => kind === 'link').length, 2);
    assert.deepEqual(seen.slice(0, 6).map(([kind]) => kind), ['form', 'write', 'client', 'form', 'form', 'activity']);
    assert.equal(seen[1][1], r.actions[3]); assert.equal(seen[1][1].confirm, 'Delete this record?');
    const writes = seen.filter(([kind]) => kind === 'write');
    assert.equal(writes.length, 4);
    assert.deepEqual(writes.at(-1)[1].body, { occurrence: 'meeting-3' });
    assert.ok(seen.every(([, action]) => !action || action.key !== 'undeclared'));
    assert.equal(m.nodes().some((n) => m.props(n)?.role === 'dialog'), false);
  } finally { await m.unmount(); }
}
test('clicks reach parent callbacks with confirm and row body; no dialog is mounted', async () => {
  await assertClicks({ default: RecordView });
  await mutationCheck(viewSource, 'pages/cycles/RecordView.jsx', assertClicks, [
    ["kind === 'form' ? onForm", "kind === 'form' ? onWrite"],
    ["kind === 'write' ? onWrite : onClient", "kind === 'write' ? onClient : onClient"],
    ['onClick={onShowAll}', 'onClick={() => {}}'],
  ], true);
});

async function assertDownloads(m) {
  const calls = []; const effects = { open: (...args) => calls.push(['open', ...args]), onError: (s) => calls.push(['error', s]), reread: async () => calls.push(['read']) };
  assert.equal(await m.finishRecordWrite({ open: { url: '/api/files/dl/t' } }, effects), 'opened');
  assert.deepEqual(calls, [['open', '/api/files/dl/t', '_blank', 'noopener,noreferrer']]);
  for (const url of ['https://example.invalid/x', '//example.invalid', '/api/files/dl/\\evil', '/api/other', '']) {
    calls.length = 0; assert.equal(await m.finishRecordWrite({ open: { url } }, effects), 'refused');
    assert.deepEqual(calls, [['error', 'That file could not be opened.']]);
  }
  calls.length = 0; assert.equal(await m.finishRecordWrite({ ok: true }, effects), 'saved');
  assert.deepEqual(calls, [['read']]);
  calls.length = 0; assert.equal(await m.finishRecordWrite({ open: { parts: [] } }, effects), 'parts');
  assert.deepEqual(calls, []);
}
test('signed download writes open safely without re-reading; other URLs are refused', async () => {
  await assertDownloads(rules);
  await mutationCheck(source, 'pages/cycles/recordModel.js', assertDownloads, [
    ["url.startsWith('/api/files/dl/')", 'true'],
    ["'noopener,noreferrer'", "'noopener'"],
    ["return 'opened';", "await reread(); return 'opened';"],
    ["onError('That file could not be opened.');", "onError('Failed.');"],
    ['await reread();', ''],
  ]);
});
