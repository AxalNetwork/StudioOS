/** D6007 (#6007): Compare segments as a mode on the ICP page, the Primary ICP column, and the segment's profile fields. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { installDocument } from './_contracts_dom.mjs';
import { textOf, propsOf } from './_form_d695.mjs';
import {
  COMPARE_ROWS, addId, cellOf, chosenIds, compareIds, fitLine, inCompare, removeId, withCompare,
} from '../src/pages/cycles/segmentCompareModel.js';
import SegmentCompare, { segmentOptions } from '../src/pages/cycles/SegmentCompare.jsx';
import { cycleValidateApi } from '../src/lib/api/cycleValidate.js';
import { adaptModule } from '../src/pages/cycles/adapters/index.js';
import { EDITS } from '../src/pages/cycles/forms.js';
import validate from '../src/pages/cycles/defs/validate.jsx';

const h = React.createElement;
const sp = (s) => new URLSearchParams(s);

// Invented segments, as the Worker's compare read returns them.
const OPS = {
  id: 81, name: 'Fixture ops', source: 'icp_definition', primary: true,
  steps: { who_they_are: 'Ops leads at fixture firms', context: null, job_to_be_done: 'Close the month', urgency: 'high', value_promised: 'Close on day 2' },
  value_source: 'Fixture interview', interviews: 5, strong: 4, partial: 1, none: 0, unrecorded: 0, evidence: 'pattern',
  top_themes: [{ title: 'Theme One', mentions: 5 }, { title: 'Theme Two', mentions: 1 }],
  disqualifiers: ['Under 20 staff'], firmographics: [{ label: 'Region', value: 'Nordics' }],
};
const FIN = {
  id: 82, name: 'Fixture finance', source: 'manual', primary: false,
  steps: { who_they_are: null, context: null, job_to_be_done: null, urgency: null, value_promised: 'Payables closed in 3 days' },
  value_source: null, interviews: 0, strong: 0, partial: 0, none: 0, unrecorded: 0, evidence: null,
  top_themes: [], disqualifiers: null, firmographics: null,
};

test('the compare parameter: mode only when present, valid ids once each, at most four, other params kept', () => {
  assert.equal(inCompare(sp('project_id=1')), false);
  assert.equal(inCompare(sp('project_id=1&compare=')), true);
  assert.deepEqual(compareIds(sp('compare=81,0,abc,81,82, 83 ,84,85')), ['81', '82', '83', '84']);
  assert.equal(withCompare('?project_id=1', ['81', '82']), '?project_id=1&compare=81,82');
  assert.equal(withCompare('?project_id=1&compare=81,82', null), '?project_id=1');
  assert.equal(withCompare('', []), '?compare=');
});

test('the first columns: the ids named, topped up from the primary first, to three only when fewer than two are named', () => {
  const segs = [{ id: '81' }, { id: '82' }, { id: '83', primary: true }, { id: '84' }];
  assert.deepEqual(chosenIds([], segs), ['83', '81', '82']);
  assert.deepEqual(chosenIds(['82'], segs), ['82', '83', '81'], "a record's Compare opens beside the next ones");
  assert.deepEqual(chosenIds(['84', '81'], segs), ['84', '81'], 'two named are kept as named');
  assert.deepEqual(chosenIds([], [{ id: '81' }]), ['81']);
  assert.deepEqual(removeId(['81', '82'], '81'), ['81', '82'], 'never below two');
  assert.deepEqual(removeId(['81', '82', '83'], '81'), ['82', '83']);
  assert.deepEqual(addId(['81', '82', '83', '84'], '85'), ['81', '82', '83', '84'], 'never above four');
  assert.deepEqual(addId(['81', '82'], '81'), ['81', '82']);
  assert.deepEqual(addId(['81', '82'], '83'), ['81', '82', '83']);
});

test('each cell is the stored value, or the canvas words for one that is not recorded', () => {
  const row = (key) => COMPARE_ROWS.find((r) => r.key === key);
  assert.deepEqual(cellOf(row('context'), OPS), { empty: 'Not recorded' });
  assert.deepEqual(cellOf(row('urgency'), OPS), { value: 'High' });
  assert.deepEqual(cellOf(row('urgency'), FIN), { empty: 'Not set' });
  assert.deepEqual(cellOf(row('value_source'), FIN), { empty: 'Needs a source' }, 'a value promised with no source');
  assert.deepEqual(cellOf(row('value_source'), { ...FIN, steps: { ...FIN.steps, value_promised: null } }), { empty: 'Not recorded' });
  assert.deepEqual(cellOf(row('themes'), OPS), { value: ['Theme One (5)', 'Theme Two (1)'] });
  assert.deepEqual(cellOf(row('themes'), FIN), { empty: 'Not recorded' });
  assert.deepEqual(cellOf(row('disqualifiers'), FIN), { empty: 'Not recorded' });
  assert.deepEqual(cellOf(row('firmographics'), OPS), { value: ['Region: Nordics'] });
  assert.deepEqual(cellOf(row('evidence'), FIN), { empty: 'Not recorded' }, 'evidence stops at Pattern and is never guessed');
  assert.equal(fitLine(OPS), '5 interviews · 4 strong, 1 partial');
  assert.equal(fitLine(FIN), null);
  assert.deepEqual(cellOf(row('interviews'), FIN), { empty: 'No held interview yet' });
  assert.deepEqual(COMPARE_ROWS.map((r) => r.label), ['Who they are', 'Context', 'Job to be done', 'Urgency', 'Value promised',
    'Value source', 'Interviews and fit', 'Evidence', 'Top pain themes', 'Firmographics', 'Disqualifiers']);
});

test('the ICP list adapts the Primary ICP column: a star for the primary, a dash, never Not recorded, for the rest', () => {
  const data = adaptModule('validate', 'ideal-customer-profile', { records: {
    cols: ['Segment', 'Interviews', 'Strong fit', 'Evidence', 'Updated', 'Primary ICP'], total: 2, page: 1, page_size: 25,
    rows: [{ id: 81, segment: 'Fixture ops', interviews: 5, strong_fit: 4, evidence: 'pattern', updated: '2026-11-12', primary: true },
      { id: 82, segment: 'Fixture finance', interviews: 0, strong_fit: 0, evidence: null, updated: null, primary: false }],
  } });
  const [ops, fin] = data.records.rows;
  assert.deepEqual(ops.cells.primary, { text: '★ Primary', tone: 'v2' });
  assert.equal(fin.cells.primary, '—');
  assert.deepEqual(segmentOptions(data.records), [{ id: '81', name: 'Fixture ops', primary: true }, { id: '82', name: 'Fixture finance', primary: false }]);
});

test('the Edit form carries firmographics and disqualifiers and sends them, an emptied box as null', () => {
  const edit = EDITS.validate['ideal-customer-profile'];
  assert.ok(edit.fields.some((f) => f.name === 'firmographics' && f.input === 'textarea'));
  assert.ok(edit.fields.some((f) => f.name === 'disqualifiers'));
  assert.deepEqual(edit.toBody({ firmographics: ' Region: Nordics ', disqualifiers: '' }), { firmographics: 'Region: Nordics', disqualifiers: null });
  assert.deepEqual(edit.toBody({ name: 'Only rename' }), { name: 'Only rename' }, 'a field it did not show is not sent');
});

test('the Validate def: Compare segments is a tool link into the mode, and the mode owns the page only with the parameter', () => {
  const tool = validate.tools.get('ideal-customer-profile')('?project_id=7');
  assert.equal(tool.label, 'Compare segments');
  assert.equal(tool.href, '/validate/ideal-customer-profile?project_id=7&compare=');
  const home = validate.homes.get('ideal-customer-profile');
  assert.equal(home({}, { projectId: 7, searchParams: sp('project_id=7') }), null);
  const mode = home({}, { projectId: 7, searchParams: sp('project_id=7&compare=81,82') });
  assert.equal(typeof mode.body, 'function');
  assert.equal(mode.action, null);
  // CycleRoute hands the page's params to a home (and no other hub entry is added for it).
  const route = readFileSync(new URL('../src/pages/cycles/CycleRoute.jsx', import.meta.url), 'utf8');
  // The page's search params reach the home; other keys (D6865's search, fillsOn) may sit beside them.
  assert.match(route, /fnOf\(def\.homes, slug\)\?\.\(module, \{ projectId, reload: \(\) => setReload\(\(n\) => n \+ 1\), searchParams[,\s}]/);
});

function Probe() { const l = useLocation(); return h('output', { 'data-testid': 'where' }, l.pathname + l.search); }

async function mount(entry, props) {
  const restore = installDocument();
  const makeText = document.createTextNode.bind(document);
  document.createTextNode = (value) => {
    const node = makeText(value);
    Object.defineProperty(node, 'nodeValue', { get: () => node.textContent, set: (t) => { node.textContent = String(t); } });
    return node;
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [entry] }, h(SegmentCompare, props), h(Probe))); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const nodes = () => walk(container);
  const by = (id) => nodes().find((n) => propsOf(n)['data-testid'] === id);
  return {
    by, nodes, text: () => textOf(container), where: () => textOf(by('where')),
    async flush() { await act(async () => { await new Promise((r) => setImmediate(r)); }); },
    async click(node) { await act(async () => propsOf(node).onClick?.({ preventDefault() {}, button: 0 })); },
    async choose(node, value) { await act(async () => propsOf(node).onChange({ target: { value } })); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

const RECORDS = { rows: [
  { id: '81', recordId: '81', primary: true, cells: { segment: 'Fixture ops' } },
  { id: '82', recordId: '82', primary: false, cells: { segment: 'Fixture finance' } },
  { id: '83', recordId: '83', primary: false, cells: { segment: 'Fixture owners' } },
] };

function stubApi(answer) {
  const saved = { compareSegments: cycleValidateApi.compareSegments, setPrimarySegment: cycleValidateApi.setPrimarySegment };
  const calls = [];
  cycleValidateApi.compareSegments = async (projectId, ids) => { calls.push(['compare', projectId, ids.join(',')]); return answer(ids); };
  cycleValidateApi.setPrimarySegment = async (projectId, id, primary) => { calls.push(['primary', projectId, String(id), primary]); return { id, primary }; };
  return { calls, restore: () => Object.assign(cycleValidateApi, saved) };
}

test('the compare mode draws the columns read, Not recorded for unwritten values, and sets the primary from a header', async () => {
  const api = stubApi(() => ({ segments: [FIN, OPS], missing: [], can_write: true }));
  const ui = await mount('/validate/ideal-customer-profile?project_id=7&compare=82,81', { projectId: 7, records: RECORDS });
  try {
    await ui.flush();
    assert.deepEqual(api.calls[0], ['compare', 7, '82,81']);
    const text = ui.text();
    for (const words of ['Compare segments', 'Comparing 2 of up to 4', 'Fixture finance', 'Fixture ops', 'Ops leads at fixture firms',
      'Not set', 'Needs a source', '5 interviews · 4 strong, 1 partial', 'Theme One (5)', 'Region: Nordics', 'Under 20 staff', '★ Primary']) {
      assert.ok(text.includes(words), words);
    }
    assert.ok(text.includes('Not recorded'));
    // With two columns there is no Remove; Add offers the one not shown.
    assert.ok(!ui.nodes().some((n) => /^Remove /.test(propsOf(n)['aria-label'] || '')));
    const add = ui.by('segment-compare-add');
    assert.deepEqual(add.childNodes.slice(1).map((o) => propsOf(o).value), ['83']);
    await ui.choose(add, '83');
    assert.equal(ui.where(), '/validate/ideal-customer-profile?project_id=7&compare=82,81,83');
    // One Set primary, on the column that is not the primary.
    const set = ui.nodes().filter((n) => propsOf(n)['data-testid'] === 'segment-compare-set-primary');
    assert.equal(set.length, 1);
    const readsBefore = api.calls.filter((c) => c[0] === 'compare').length;
    await ui.click(set[0]);
    await ui.flush();
    assert.ok(api.calls.some((c) => c[0] === 'primary' && c[2] === '82' && c[3] === true));
    assert.equal(api.calls.filter((c) => c[0] === 'compare').length, readsBefore + 1, 'it reads again after saving');
    assert.equal(propsOf(ui.by('segment-compare-done')).href, '/validate/ideal-customer-profile?project_id=7');
  } finally { await ui.unmount(); api.restore(); }
});

test('with nothing named it opens on three, the primary first; a column can be removed down to two', async () => {
  const api = stubApi((ids) => ({ segments: ids.map((id) => ({ ...FIN, id: Number(id), name: `Segment ${id}`, primary: id === '81' })), missing: [], can_write: false }));
  const ui = await mount('/validate/ideal-customer-profile?project_id=7&compare=', { projectId: 7, records: RECORDS });
  try {
    await ui.flush();
    assert.deepEqual(api.calls[0], ['compare', 7, '81,82,83']);
    assert.ok(!ui.by('segment-compare-set-primary'), 'a reader sets nothing');
    const remove = ui.nodes().find((n) => propsOf(n)['aria-label'] === 'Remove Segment 82');
    await ui.click(remove);
    assert.equal(ui.where(), '/validate/ideal-customer-profile?project_id=7&compare=81,83');
  } finally { await ui.unmount(); api.restore(); }
});

test('a failed compare read says Unavailable with Retry; a refused one says Refused; a stale id is named, not drawn', async () => {
  let fail = { status: 503, message: 'The segments could not be read' };
  const api = stubApi((ids) => { if (fail) { const e = Object.assign(new Error(fail.message), { status: fail.status }); throw e; } return { segments: [OPS], missing: [Number(ids[1])], can_write: true }; });
  let ui = await mount('/validate/ideal-customer-profile?project_id=7&compare=81,84', { projectId: 7, records: RECORDS });
  try {
    await ui.flush();
    assert.ok(ui.text().includes('could not be read'));
    const retry = ui.nodes().find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === 'Retry');
    assert.ok(retry, 'Retry is offered');
    fail = null;
    await ui.click(retry);
    await ui.flush();
    assert.ok(ui.text().includes('One segment named in this link is archived'));
    assert.ok(ui.text().includes('Fixture ops'));
  } finally { await ui.unmount(); }
  fail = { status: 403, message: 'Forbidden' };
  ui = await mount('/validate/ideal-customer-profile?project_id=7&compare=81,82', { projectId: 7, records: RECORDS });
  try {
    await ui.flush();
    assert.ok(ui.nodes().some((n) => propsOf(n)['data-platform-state'] === 'refused'));
  } finally { await ui.unmount(); api.restore(); }
});

test('one segment cannot be compared: the page says what it needs instead of reading', async () => {
  const api = stubApi(() => { throw new Error('not called'); });
  const ui = await mount('/validate/ideal-customer-profile?project_id=7&compare=81', { projectId: 7, records: { rows: [RECORDS.rows[0]] } });
  try {
    await ui.flush();
    assert.equal(api.calls.length, 0);
    assert.ok(ui.text().includes('Compare needs two segments. Add another segment first.'));
  } finally { await ui.unmount(); api.restore(); }
});
