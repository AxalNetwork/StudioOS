/**
 * D693 (#1704) — Verdict's page parts that build from `main` before the module
 * joins the lists: Record a decision (test 18), the refused module page (test
 * 19's box), the decision memo (test 20) and `verdictApi.record` (test 22).
 * The closing PR adds the route, the tabs and Export summary. Every venture and
 * person below is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/verdict_module_d693.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { act } from 'react';
import FormLightbox from '../src/pages/cycles/FormLightbox.jsx';
import CycleModulePage from '../src/pages/cycles/CycleModulePage.jsx';
import { verdictForm, evidenceNote, DECISION_EVIDENCE_BAR } from '../src/pages/cycles/verdictForm.js';
import { FORMS, formFor, editFor } from '../src/pages/cycles/forms.js';
import { decisionMemoModel, decisionMemoFilename, MEMO_LIMITS } from '../src/lib/decisionMemoViewModel.js';
import { renderDecisionMemo } from '../src/lib/decisionMemoPdf.js';
import { verdictApi } from '../src/lib/api/verdict.js';
import { createRoot } from 'react-dom/client';
import { Route, Routes } from 'react-router-dom';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import CycleOverview from '../src/pages/cycles/CycleOverview.jsx';
import { MODULES } from '../src/pages/cycles/modules.js';
import { CLIENT_ACTIONS, dispatchOf } from '../src/pages/cycles/recordModel.js';
import { cyclesApi } from '../src/lib/api/cycles.js';
import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import { CARDS, RECORDS, MODULES as VALIDATE_MODULES } from '../src/pages/cycles/adapters/validate.js';
import { createPdfStub } from './_pdf-stub.mjs';
import { h, mountForm } from './_form_d695.mjs';
import { sourceModule, mutate, mutationCheck } from './_record_d696.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const stamp = new Date('2026-10-15T12:00:00.000Z');

/** Record a decision's choices, in #1703's form-options shape. */
const OPTIONS = {
  for: { options: [{ value: 'venture', label: 'The venture' }, { value: 'h-12', label: 'H2 · Dispatchers lose an hour a day' }] },
  evidence: {
    bar: 5,
    options: [
      { value: 'evidence-1', label: 'Pilot invoice · H2 · Measured', meta: '12 Oct', hypothesis_id: 12 },
      { value: 'pain-3-9', label: 'Interview · H2 · Pattern', meta: '9 Oct', hypothesis_id: 12 },
      { value: 'pain-4-2', label: 'Interview · H1 · Anecdote', meta: '3 Oct', hypothesis_id: null },
    ],
  },
};
const formProps = (extra = {}) => ({
  form: verdictForm, cycle: 'validate', slug: 'verdict', moduleName: 'Verdict',
  loadOptions: async () => OPTIONS, onSubmit: async () => {}, onClose() {}, ...extra,
});
const allStrings = (v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(allStrings)
  : v && typeof v === 'object' ? Object.values(v).flatMap(allStrings) : []);

// ---------------------------------------------------------------------------
// 18. Record a decision
// ---------------------------------------------------------------------------

test('18: Record a decision renders CO:335\'s copy, Proceed first, the 56px box, the foot and Record', async () => {
  const mount = await mountForm(h(FormLightbox, formProps()));
  try {
    await mount.flush();
    const text = mount.text();
    for (const copy of ['Validate · Verdict', 'Record a decision', 'For the venture or one hypothesis. Earlier decisions stay.',
      'Decision', 'Proceed', 'Pivot', 'Stop', 'For', 'The venture', 'H2 · Dispatchers lose an hour a day', 'Reasoning',
      'Evidence it rests on', 'Partners do not see decisions.', 'Record']) assert.ok(text.includes(copy), copy);
    assert.equal(text.includes('If Pivot: the new hypothesis'), false, 'If Pivot shows only while Pivot is chosen');
    assert.equal(/[[\]]/.test(text), false, 'no bracket reaches the page');
    const input = (name, value) => mount.nodes().find((n) => n.tagName === 'INPUT' && mount.props(n).name === name && mount.props(n).value === value);
    assert.equal(mount.props(input('decision', 'proceed')).checked, true, 'Proceed is the default');
    assert.equal(mount.props(input('for', 'venture')).checked, true, 'The venture is the default');
    const reasoning = mount.by('cycle-form-reasoning');
    assert.equal(reasoning.tagName, 'TEXTAREA');
    assert.equal(mount.props(reasoning).placeholder, 'Why, in your words');
    assert.equal(mount.props(reasoning).style.minHeight, '56px');
    assert.equal(mount.props(mount.by('cycle-form-save')).children, 'Record', 'the CTA is Record');
  } finally { await mount.unmount(); }
});

test('18: no evidence starts checked, the note counts the checks, and If Pivot shows only on Pivot', async () => {
  const saved = [];
  const mount = await mountForm(h(FormLightbox, formProps({ onSubmit: async (v) => { saved.push(v); } })));
  try {
    await mount.flush();
    const checks = mount.nodes().filter((n) => n.tagName === 'INPUT' && mount.props(n).name === 'evidence');
    assert.equal(checks.length, 3);
    assert.ok(checks.every((n) => mount.props(n).checked === false), 'the founder states what it rests on');
    assert.ok(mount.text().includes('0 of 5 needed before a verdict is given. Below that it is withheld.'));
    await mount.choose('evidence', 'evidence-1');
    await mount.choose('evidence', 'pain-4-2');
    assert.ok(mount.text().includes('2 of 5 needed before a verdict is given. Below that it is withheld.'));
    await mount.choose('decision', 'pivot');
    const claim = mount.by('cycle-form-pivot_claim');
    assert.ok(claim, 'If Pivot appears');
    assert.equal(mount.props(claim).placeholder, 'Claim it starts');
    assert.ok(mount.text().includes('If Pivot: the new hypothesis'));
    await mount.input('pivot_claim', 'Fleet managers buy it');
    await mount.choose('decision', 'stop');
    assert.equal(mount.by('cycle-form-pivot_claim'), undefined, 'gone again off Pivot');
    await mount.submit();
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0].evidence, ['evidence-1', 'pain-4-2']);
    assert.equal(Object.hasOwn(saved[0], 'pivot_claim'), false, 'a hidden field is not sent');
  } finally { await mount.unmount(); }
  assert.equal(DECISION_EVIDENCE_BAR, 5);
  assert.equal(evidenceNote({ evidence: ['a'] }), '1 of 5 needed before a verdict is given. Below that it is withheld.');
  assert.equal(evidenceNote({}), '0 of 5 needed before a verdict is given. Below that it is withheld.');
});

test('18: ?for=h-12 presets For, and nothing else does', async () => {
  const mount = await mountForm(h(FormLightbox, formProps({ search: '?for=h-12&project_id=3' })));
  try {
    await mount.flush();
    const input = mount.nodes().find((n) => n.tagName === 'INPUT' && mount.props(n).name === 'for' && mount.props(n).value === 'h-12');
    assert.equal(mount.props(input).checked, true);
  } finally { await mount.unmount(); }
  const q = (s) => verdictForm.fromQuery(new URLSearchParams(s));
  assert.deepEqual(q('for=h-12'), { for: 'h-12' });
  assert.deepEqual(q('for=venture'), { for: 'venture' });
  for (const bad of ['', 'for=h-0', 'for=h-abc', 'for=12', 'for=h-12x', 'for=h-12345678901']) assert.deepEqual(q(bad), {}, bad);
});

test('18: the body is the Worker\'s, it submits through verdictApi.record, reads form-options, and has no Edit', async () => {
  const body = verdictForm.toBody({ decision: 'pivot', for: 'h-12', reasoning: '  Change the buyer ', evidence: ['a', 'b'], pivot_claim: ' Fleet managers buy it ' });
  assert.deepEqual(body, { decision: 'pivot', for: 'h-12', reasoning: 'Change the buyer', evidence: ['a', 'b'], pivot_claim: 'Fleet managers buy it' });
  assert.deepEqual(verdictForm.toBody({ decision: 'stop', for: 'zzz', reasoning: '', evidence: undefined, pivot_claim: 'ignored' }),
    { decision: 'stop', for: 'venture', reasoning: null, evidence: [] });
  const calls = [];
  const w = {
    verdict: { record: async (...a) => { calls.push(['record', ...a]); return { id: 9, state: 'withheld' }; } },
    formOptions: async (...a) => { calls.push(['formOptions', ...a]); return OPTIONS; },
  };
  assert.deepEqual(await verdictForm.submit(w, 3, { decision: 'proceed', for: 'venture', evidence: ['a'] }), { id: 9, state: 'withheld' });
  assert.deepEqual(await verdictForm.loadOptions(w, 3), OPTIONS);
  assert.deepEqual(calls, [
    ['record', 3, { decision: 'proceed', for: 'venture', reasoning: null, evidence: ['a'] }],
    ['formOptions', 'validate', 3, 'verdict'],
  ]);
  assert.equal('idOf' in verdictForm || 'valuesOf' in verdictForm, false, 'a decision is never edited');
  const ev = verdictForm.fields.find((f) => f.name === 'evidence');
  assert.equal(ev.kind, 'CK');
  assert.ok(ev.options.every((o) => !o.checked && !o.on), 'the form itself checks no evidence either');
  for (const s of allStrings(verdictForm)) assert.equal(/[[\]]/.test(s), false, s);
  // The closing PR registers it with the Verdict module, and no Edit beside it.
  assert.deepEqual(FORMS.validate.verdict, [verdictForm]);
  assert.equal(formFor('validate', 'verdict'), verdictForm);
  assert.equal(editFor('validate', 'verdict'), null);
});

// ---------------------------------------------------------------------------
// 19. A refused module page
// ---------------------------------------------------------------------------

const refusedPage = (src) => src.default({ cycle: 'validate', slug: 'verdict', data: null, status: 'refused', message: 'Partners do not see decisions.', onRetry() {} });
function assertRefused(mod) {
  const html = renderToStaticMarkup(h(MemoryRouter, null, refusedPage(mod)));
  assert.match(html, /data-testid="cycle-module-refused"/);
  assert.ok(html.includes('Partners do not see decisions.'));
  for (const absent of ['cycle-module-chart', 'cycle-records', 'cycle-module-unreadable', 'Retry', 'could not be read']) {
    assert.equal(html.includes(absent), false, absent);
  }
  assert.match(html, /dark:bg-gray-900/, 'drawn in dark mode too');
  // The unreadable state is unchanged: it still names the failure and offers Retry.
  const broken = renderToStaticMarkup(h(MemoryRouter, null, mod.default({ cycle: 'validate', slug: 'verdict', data: null, status: 'unreadable', message: '', onRetry() {} })));
  assert.match(broken, /data-testid="cycle-module-unreadable"/);
  assert.equal(broken.includes('cycle-module-refused'), false);
}

test('19: a refused module page draws the Worker\'s sentence, with no chart, no table and no Retry', async () => {
  assertRefused({ default: CycleModulePage });
  await mutationCheck(read('src/pages/cycles/CycleModulePage.jsx'), 'pages/cycles/CycleModulePage.jsx', assertRefused, [
    ["{status === 'refused' ? (", "{false ? ("],
    ["{message || 'You do not have access to this module.'}", "{'Something went wrong.'}"],
    ['data-testid="cycle-module-refused"', 'data-testid="cycle-module-unreadable"'],
  ], true);
});

/** A Validate module page through the real CycleRoute, its module read answering `fail`. */
async function routeWith(fail) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const fetchBefore = globalThis.fetch;
  const moduleBefore = cyclesApi.module;
  globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}), text: async () => '{}' });
  cyclesApi.module = async () => { throw fail; };
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  try {
    await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/validate/experiments?project_id=7'] },
      h(Routes, null, h(Route, { path: '/validate/:slug', element: h(CycleRoute, { cycle: 'validate' }) })))));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const nodes = walk(container);
    return {
      text: textOf(container),
      refused: nodes.some((n) => Object.entries(n).some(([k, v]) => k.startsWith('__reactProps$') && v?.['data-testid'] === 'cycle-module-refused')),
      buttons: nodes.filter((n) => n.tagName === 'BUTTON').map(textOf),
    };
  } finally {
    await act(async () => root.unmount());
    cyclesApi.module = moduleBefore;
    globalThis.fetch = fetchBefore;
    restore();
  }
}
const httpError = (status, message) => Object.assign(new Error(message), { status });

test('19: a 403 module read is drawn as refused through CycleRoute, with the Worker\'s sentence and no Retry', async () => {
  const refused = await routeWith(httpError(403, 'Partners do not see decisions.'));
  // The AI rail beside the page has its own Retry; only the module's body is asserted here.
  const retries = (v) => v.buttons.filter((b) => /Retry|Try again/.test(b)).length;
  assert.equal(refused.refused, true, 'the refused box is drawn');
  assert.match(refused.text, /Partners do not see decisions\./);
  // D703 (#1665): a read with no card is named from the cycle's list, never by its slug.
  assert.doesNotMatch(refused.text, /Experiments and evidence could not be read/);
  // Any other failure is still a failure, with its Retry.
  const failed = await routeWith(httpError(500, 'Boom'));
  assert.equal(failed.refused, false);
  assert.match(failed.text, /Experiments and evidence could not be read/);
  assert.doesNotMatch(failed.text, /Boom/, 'a failure never prints the error text');
  assert.equal(retries(refused), retries(failed) - 1, 'a refusal draws no Retry of its own');
});

// ---------------------------------------------------------------------------
// 21. Loading
// ---------------------------------------------------------------------------

test('21: a loading overview draws one placeholder per module of its cycle (decision 14)', () => {
  const count = (cycle) => (renderToStaticMarkup(h(MemoryRouter, null, h(CycleOverview, { cycle, data: null })))
    .match(/data-testid="card-loading"/g) || []).length;
  for (const cycle of ['validate', 'raise', 'grow', 'build']) assert.equal(count(cycle), MODULES[cycle].length, cycle);
  assert.deepEqual(['raise', 'grow', 'build'].map(count), [7, 7, 6]);
});

// ---------------------------------------------------------------------------
// 20. The decision memo
// ---------------------------------------------------------------------------

/** A record read shaped as #1703's (`services/records/verdict.ts`). */
function record({ withheld = false, evidence = 3, commitments = 2 } = {}) {
  return {
    cycle: 'validate', module: 'verdict', id: '41',
    title: 'Proceed · Dispatchers lose an hour a day',
    sub: `Recorded 12 Oct by Fay Founder · rests on ${evidence} pieces of evidence`,
    pills: [{ text: 'Proceed', tone: 'ok' }, withheld ? { text: 'Withheld', tone: 'grey' } : { text: 'Current', tone: 'v1' }],
    facts: [
      { label: 'Decision', value: 'Proceed' },
      { label: 'For', value: 'H2 · Dispatchers lose an hour a day' },
      { label: 'Evidence', value: `${evidence} items` },
      withheld ? { label: 'Supersedes', value: 'Nothing, withheld' } : { label: 'Supersedes', value: null, reason: 'Recorded before decisions named what they replaced.' },
    ],
    main: [
      { key: 'reasoning', title: 'Reasoning', rows: [{ a: 'Three fleets paid for the pilot.' }], empty: 'No reasoning recorded.' },
      { key: 'evidence', title: 'Evidence it rests on', rows: Array.from({ length: evidence }, (_, i) => ({
        a: `Pilot invoice ${i + 1} · H2`, b: 'Measured · 12 Oct', c: i === 0 ? 'Contradicts' : 'Supports', tone: i === 0 ? 'bad' : 'ok',
      })), empty: 'No evidence checked.' },
    ],
    side: [
      { key: 'commitments', title: 'Commitments it created', rows: Array.from({ length: commitments }, (_, i) => ({ a: `Book pilot ${i + 1}`, b: 'Fay Founder · 24 Oct' })), empty: 'No commitments yet.', action: { key: 'add-commitment' } },
      { key: 'memo', title: 'Memo', rows: [{ a: 'Decision memo', b: 'Export PDF', action: 'export-memo' }] },
    ],
    actions: [{ key: 'record-new-decision', label: 'Record a new decision', kind: 'link', href: '/validate/verdict/new?project=1&for=h-12' }],
    activity: [{ summary: 'Activity row that never reaches the memo' }],
  };
}
const textOf = (doc) => doc.calls.filter((c) => c.op === 'text').map((c) => c.text).join('\n');

function assertModel(m) {
  const model = m.decisionMemoModel(record(), { venture: 'Acme Dispatch', generatedAt: stamp });
  assert.deepEqual({ venture: model.venture, title: model.title, decision: model.decision, status: model.status, scope: model.scope, supersedes: model.supersedes, withheld: model.withheld, date: model.date }, {
    venture: 'Acme Dispatch', title: 'Proceed · Dispatchers lose an hour a day', decision: 'Proceed', status: 'Current',
    scope: 'H2 · Dispatchers lose an hour a day', supersedes: 'Not recorded', withheld: null, date: '2026-10-15',
  });
  assert.equal(model.supersedesReason, 'Recorded before decisions named what they replaced.');
  assert.equal(model.sub, 'Recorded 12 Oct by Fay Founder · rests on 3 pieces of evidence');
  assert.equal(model.reasoning, 'Three fleets paid for the pilot.');
  assert.deepEqual(model.evidence.rows[0], { label: 'Pilot invoice 1 · H2', meta: 'Measured · 12 Oct', direction: 'Contradicts' });
  assert.deepEqual(model.commitments.rows, [{ label: 'Book pilot 1', meta: 'Fay Founder · 24 Oct' }, { label: 'Book pilot 2', meta: 'Fay Founder · 24 Oct' }]);
  assert.equal(model.evidence.more, null);
  const json = JSON.stringify(model);
  for (const absent of ['Activity row', 'Record a new decision', 'Export PDF', 'add-commitment']) assert.equal(json.includes(absent), false, absent);
  for (const s of allStrings(model)) assert.equal(/[[\]]/.test(s), false, s);
  const withheld = m.decisionMemoModel(record({ withheld: true }), { venture: 'Acme Dispatch', generatedAt: stamp });
  assert.equal(withheld.withheld, 'Withheld: 3 of 5 pieces of evidence');
  assert.equal(withheld.status, 'Withheld');
  const big = m.decisionMemoModel(record({ evidence: 40, commitments: 12 }), { venture: 'Acme Dispatch', generatedAt: stamp });
  assert.equal(big.evidence.rows.length, MEMO_LIMITS.evidence);
  assert.equal(big.evidence.more, `${40 - MEMO_LIMITS.evidence} more in StudioOS`);
  assert.equal(big.commitments.rows.length, MEMO_LIMITS.commitments);
  assert.equal(big.commitments.more, `${12 - MEMO_LIMITS.commitments} more in StudioOS`);
  const empty = m.decisionMemoModel({ title: 'Stop · the venture', main: [], side: [] }, { generatedAt: stamp });
  assert.equal(empty.venture, 'The venture');
  assert.equal(empty.reasoning, 'No reasoning recorded.');
  assert.equal(empty.evidence.empty, 'Nothing recorded.');
  assert.equal(m.decisionMemoFilename(model), 'decision-memo-acme-dispatch-2026-10-15.pdf');
  assert.equal(m.decisionMemoFilename({ ...model, venture: '../../A / B? <tag>' }), 'decision-memo-a-b-tag-2026-10-15.pdf');
  assert.equal(m.decisionMemoFilename({ ...model, venture: '你好' }), 'decision-memo-venture-2026-10-15.pdf');
  assert.throws(() => m.decisionMemoModel(record(), { generatedAt: 'invalid' }), TypeError);
}

test('20: the memo model carries every section from the record read, and nothing else', async () => {
  assertModel({ decisionMemoModel, decisionMemoFilename });
  await mutationCheck(read('src/lib/decisionMemoViewModel.js'), 'lib/decisionMemoViewModel.js', assertModel, [
    ["status === 'Withheld' ? `Withheld: ${checked} of ${BAR} pieces of evidence` : null", 'null'],
    ['more: more ? `${more} more in StudioOS` : null', 'more: null'],
    ['rows: rows.slice(0, limit).map(row)', 'rows: rows.map(row)'],
    ["scope: factValue(factOf(record, 'For'))", "scope: factValue(factOf(record, 'Decision'))"],
    ['return `decision-memo-${slug}-${model?.date}.pdf`;', 'return `memo-${slug}.pdf`;'],
    ["(fact?.value == null ? 'Not recorded'", "(fact?.value == null ? ''"],
  ]);
});

function assertPage(m) {
  for (const r of [record(), record({ withheld: true }), record({ evidence: 40, commitments: 12 }), { title: 'W'.repeat(4000), sub: 'W'.repeat(4000), main: [], side: [] }]) {
    const doc = createPdfStub();
    m.renderDecisionMemo(doc, decisionMemoModel(r, { venture: 'Acme Dispatch', generatedAt: stamp }));
    assert.equal(doc.pageCount, 1);
    assert.equal(doc.calls.some((c) => c.op === 'addPage'), false);
    assert.ok(doc.maxY <= 792, `letter height: ${doc.maxY}`);
    assert.ok(doc.maxX <= 612, `letter width: ${doc.maxX}`);
    assert.ok(doc.calls.filter((c) => c.op === 'text').every((c) => c.left >= 0 && c.left + c.width <= 612 && c.y >= 0 && c.y + c.height <= 792));
  }
  const big = createPdfStub();
  m.renderDecisionMemo(big, decisionMemoModel(record({ evidence: 40, commitments: 12 }), { venture: 'Acme Dispatch', generatedAt: stamp }));
  const text = textOf(big);
  for (const copy of ['DECISION MEMO', 'Acme Dispatch', 'Proceed · Dispatchers lose an hour a day', 'Reasoning', 'Three fleets paid for the pilot.',
    'Evidence it rests on', 'Pilot invoice 1 · H2', 'Contradicts', 'Commitments it created', 'Book pilot 1', '32 more in StudioOS', '6 more in StudioOS']) {
    assert.ok(text.includes(copy), copy);
  }
  assert.equal(text.includes('Pilot invoice 9 · H2'), false, 'the ninth item is counted, not drawn');
  const withheld = createPdfStub();
  m.renderDecisionMemo(withheld, decisionMemoModel(record({ withheld: true }), { venture: 'Acme Dispatch', generatedAt: stamp }));
  assert.ok(textOf(withheld).includes('Withheld: 3 of 5 pieces of evidence'));
}

test('20: the memo is one letter page, with 40 evidence items and 12 commitments ending in "<n> more in StudioOS"', async () => {
  assertPage({ renderDecisionMemo });
  await mutationCheck(read('src/lib/decisionMemoPdf.js'), 'lib/decisionMemoPdf.js', assertPage, [
    ['if (model.evidence.more) write(model.evidence.more,', 'if (false) write(model.evidence.more,'],
    ['if (model.withheld) write(model.withheld,', 'if (false) write(model.withheld,'],
    ["b.hline(40, 776, 1000, EDGE);", "doc.addPage(); b.hline(40, 776, 1000, EDGE);"],
    ['const y = 438 + i * 36;', 'const y = 438 + i * 360;'],
    ["let rest = String(value ?? '');", "let rest = String(value ?? ''); if (rest.length > 100) return [rest];"],
  ]);
});

test('20: the record\'s Export memo is a client action that draws the memo', () => {
  assert.equal(dispatchOf({ key: 'export-memo' }), 'client');
  assert.equal(typeof CLIENT_ACTIONS.get('export-memo'), 'function');
  assert.match(read('src/pages/cycles/recordModel.js'), /\['export-memo', \(record\) => exportDecisionMemoPdf\(record\)\]/);
});

test('20: Export memo loads jsPDF, draws the page and saves the dated file', async () => {
  const verify = async (source) => {
    const doc = createPdfStub(); let options; let properties;
    doc.setProperties = (p) => { properties = p; };
    globalThis.__d693JsPDF = class { constructor(o) { options = o; return doc; } };
    try {
      const mod = await sourceModule(mutate(source, "await import('jspdf')", '({ jsPDF: globalThis.__d693JsPDF })'), 'lib/decisionMemoPdf.js');
      const out = await mod.exportDecisionMemoPdf(record(), { venture: 'Acme Dispatch', generatedAt: stamp });
      assert.deepEqual(options, { orientation: 'portrait', unit: 'pt', format: 'letter', compress: true });
      assert.equal(properties.title, 'Decision memo');
      assert.deepEqual(out, { filename: 'decision-memo-acme-dispatch-2026-10-15.pdf' });
      assert.deepEqual(doc.calls.filter((c) => c.op === 'save'), [{ op: 'save', name: out.filename }]);
      assert.ok(textOf(doc).includes('Three fleets paid for the pilot.'));
    } finally { delete globalThis.__d693JsPDF; }
  };
  const src = read('src/lib/decisionMemoPdf.js');
  await verify(src);
  for (const [before, after] of [['doc.save(filename);', ''], ['renderDecisionMemo(doc, model);', ''], ["format: 'letter'", "format: 'a4'"]]) {
    await assert.rejects(() => verify(mutate(src, before, after)), { name: 'AssertionError' }, before);
  }
});

// ---------------------------------------------------------------------------
// 22. The API module
// ---------------------------------------------------------------------------

test('22: verdictApi holds record alone, a POST to the mounted decisions route, re-exported by api.js', async () => {
  assert.deepEqual(Object.keys(verdictApi), ['record']);
  const src = read('src/lib/api/verdict.js');
  assert.match(src, /request\(`\/cycles\/validate\/decisions\?project=\$\{encodeURIComponent\(projectId\)\}`, \{ method: 'POST', body: JSON\.stringify\(body\) \}\)/);
  assert.match(read('../cloudflare-worker/src/index.ts'), /app\.route\('\/api\/cycles\/validate\/decisions', cycleVerdict\);/);
  assert.match(read('../cloudflare-worker/src/routes/cycle_verdict.ts'), /\.post\('\/'/);
  const api = read('src/lib/api.js');
  const block = api.slice(api.indexOf('// api-modules:begin'), api.indexOf('// api-modules:end'));
  assert.match(block, /export \* from '\.\/api\/usage\.js';\nexport \* from '\.\/api\/verdict\.js';\n$/);
  const sent = [];
  const mod = await sourceModule(mutate(src, "import { request } from '../api.js';", 'const request = (...a) => { globalThis.__d693Sent.push(a); return Promise.resolve({ ok: true }); };'), 'lib/api/verdict.js');
  globalThis.__d693Sent = sent;
  try {
    await mod.verdictApi.record(7, { decision: 'stop', for: 'venture' });
  } finally { delete globalThis.__d693Sent; }
  assert.deepEqual(sent, [['/cycles/validate/decisions?project=7', { method: 'POST', body: '{"decision":"stop","for":"venture"}' }]]);
  await act(async () => {});
});

// ---------------------------------------------------------------------------
// #1704 closing PR: the module on the page
// ---------------------------------------------------------------------------

/** The Verdict module read, as `routes/cycle_validate.ts` sends it. */
const VERDICT_READ = {
  module: { slug: 'verdict', name: 'Verdict', records_title: 'Decisions' },
  card: {
    slug: 'verdict', name: 'Verdict', range: 'All time', caption: 'Every decision, oldest to newest, never overwritten.',
    state: 'ok', reason: null,
    next: { text: 'Record the decision for the sprint ending 24 Oct.', href: '/validate/verdict/new?project=7&for=h-12' },
    series: {
      decisions: [
        { decision: 'proceed', state: 'given', date: '2026-07-14' },
        { decision: 'pivot', state: 'withheld', date: '2026-09-03' },
        { decision: 'proceed', state: 'given', date: '2026-10-12' },
      ],
      current: { decision: 'proceed', date: '2026-10-12', evidence: 6 },
      next: { date: '2026-10-24' },
    },
  },
  records: {
    cols: ['Decision', 'For', 'Reasoning', 'Evidence', 'Date · by'],
    rows: [
      { id: 41, decision: 'proceed', state: 'given', for: 'The venture', reasoning: 'Three fleets paid for the pilot.', evidence: 6, date: '2026-10-12', by: 'Fay Founder' },
      { id: 40, decision: 'stop', state: 'withheld', for: 'H2 · Dispatchers lose an hour a day', reasoning: '2 of 5 pieces of evidence', evidence: 2, date: '2026-10-05', by: 'Fay Founder' },
      { id: 39, decision: 'pivot', state: 'given', for: 'H1 · Fleets pay', reasoning: 'Starts H4 · Owners decide', evidence: 5, date: '2026-09-03', by: 'Ada Admin' },
    ],
    total: 3, page: 1, page_size: 25, linkable: true,
    filters: [{ key: 'decision', label: 'Decision', options: [] }, { key: 'for', label: 'For', options: [] }],
    sorts: [{ key: 'newest', label: 'Newest' }, { key: 'oldest', label: 'Oldest' }],
  },
  parts: { can_write: true },
  can_read_decisions: true,
};

/** A route through the real CycleRoute: `/validate/:slug` and App.jsx's static `/validate/verdict` line. */
async function mountRoute(url, read) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const before = { fetch: globalThis.fetch, module: cyclesApi.module, overview: cyclesApi.overview, exportSummary: api.exportValidateSummary };
  const calls = [];
  globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}), text: async () => '{}' });
  cyclesApi.module = async (...args) => { calls.push(['module', ...args]); return read(args[2]); };
  cyclesApi.overview = async (...args) => { calls.push(['overview', ...args]); return read(null); };
  api.exportValidateSummary = async (...args) => { calls.push(['exportValidateSummary', ...args]); };
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null,
    h(Route, { path: '/validate', element: h(CycleRoute, { cycle: 'validate' }) }),
    h(Route, { path: '/validate/verdict', element: h(CycleRoute, { cycle: 'validate', slug: 'verdict' }) }),
    h(Route, { path: '/validate/:slug', element: h(CycleRoute, { cycle: 'validate' }) })))));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return {
    calls,
    text: () => textOf(container),
    nodes: () => walk(container),
    hrefs: () => walk(container).filter((n) => n.tagName === 'A').map((n) => props(n).href).filter(Boolean),
    async click(label) {
      const b = walk(container).find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === label);
      assert.ok(b, `No button: ${label}`);
      await act(async () => { await props(b).onClick?.({ preventDefault() {}, stopPropagation() {} }); });
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    },
    async unmount() {
      await act(async () => root.unmount());
      Object.assign(globalThis, { fetch: before.fetch });
      cyclesApi.module = before.module; cyclesApi.overview = before.overview; api.exportValidateSummary = before.exportSummary;
      restore();
    },
  };
}

test('17: /validate/verdict renders the Decisions table from the module read, with Export summary under it', async () => {
  const v = await mountRoute('/validate/verdict?project_id=7', () => VERDICT_READ);
  try {
    const reads = v.calls.filter((c) => c[0] === 'module');
    assert.ok(reads.length >= 1 && reads.every((c) => c[1] === 'validate' && c[3] === 'verdict'), JSON.stringify(reads));
    const t = v.text();
    assert.match(t, /Decisions/);
    assert.match(t, /Three fleets paid for the pilot\./);
    assert.match(t, /Withheld/);
    assert.match(t, /2 of 5 pieces of evidence/);
    assert.match(t, /Starts H4 · Owners decide/);
    assert.match(t, /12 Oct · Fay Founder/);
    assert.match(t, /Proceed/);
    assert.match(t, /the venture’s current verdict · 12 Oct · rests on 6 pieces of evidence/);
    assert.ok(v.hrefs().some((href) => /^\/validate\/verdict\/41(\?|$)/.test(href)), 'a row opens its record');
    // Test 21: Export summary sits under the table and calls the CSV export.
    await v.click('Export summary');
    assert.deepEqual(v.calls.filter((c) => c[0] === 'exportValidateSummary'), [['exportValidateSummary', 7]]);
  } finally { await v.unmount(); }
});

test('19: with can_read_decisions false, a module page draws no Verdict tab; with true it does', async () => {
  const tabsOf = (v) => v.hrefs().filter((href) => /^\/validate\/verdict(\?|$)/.test(href)).length;
  const read = (can) => (slug) => ({ ...VERDICT_READ, module: { slug: 'experiments', name: 'Experiments and evidence', records_title: 'Hypotheses' },
    card: { ...VERDICT_READ.card, slug: 'experiments', name: 'Experiments and evidence', state: 'empty', series: null, next: null }, records: { ...VERDICT_READ.records, cols: [], rows: [], total: 0 }, can_read_decisions: can });
  const hidden = await mountRoute('/validate/experiments?project_id=7', read(false));
  try { assert.equal(tabsOf(hidden), 0, 'a partner sees no Verdict tab'); } finally { await hidden.unmount(); }
  const shown = await mountRoute('/validate/experiments?project_id=7', read(true));
  try { assert.ok(tabsOf(shown) > 0, 'the founder sees the Verdict tab'); } finally { await shown.unmount(); }
  // A 403 on the Verdict read drops the tab too, and draws the Worker's sentence.
  const refused = await mountRoute('/validate/verdict?project_id=7', () => { throw Object.assign(new Error('Partners do not see decisions.'), { status: 403 }); });
  try {
    assert.match(refused.text(), /Partners do not see decisions\./);
    assert.equal(tabsOf(refused), 0, 'a refused Verdict read drops its tab');
  } finally { await refused.unmount(); }
});

test('17: App.jsx keeps /validate/verdict a static line with its guard, rendering the Verdict module; no line of its own for :id or new', () => {
  const app = read('src/App.jsx');
  assert.match(app, /<Route path="\/validate\/verdict" element=\{guard\(labRoles\(\['admin', 'founder'\]\), <CycleRoute cycle="validate" slug="verdict" \/>\)\} \/>/);
  assert.doesNotMatch(app, /path="\/validate\/verdict\/(:id|new)"/);
  // Every static /validate/<slug> line whose slug is a module renders CycleRoute.
  for (const m of VALIDATE_MODULES) {
    const line = new RegExp(`<Route path="/validate/${m.slug}" element=\\{[^\\n]*`).exec(app)?.[0];
    if (line) assert.match(line, /<CycleRoute cycle="validate"/, `/validate/${m.slug} is shadowed`);
  }
});

test('16, 21: Validate lists seven modules, Verdict last, and its loading overview draws seven placeholders', () => {
  assert.equal(VALIDATE_MODULES.length, 7);
  assert.deepEqual(VALIDATE_MODULES.at(-1), { slug: 'verdict', name: 'Verdict' });
  const loading = renderToStaticMarkup(h(MemoryRouter, null, h(CycleOverview, { cycle: 'validate', data: null })));
  assert.equal((loading.match(/data-testid="card-loading"/g) || []).length, 7);
});

test('12: the card adapter draws the timeline (Withheld hollow, Next last) and the big verdict', () => {
  const [timeline, big] = CARDS.verdict(VERDICT_READ.card.series);
  assert.deepEqual(timeline, { kind: 'timeline', steps: [
    { label: 'Proceed', date: '14 Jul', done: true }, { label: 'Withheld', date: '3 Sep', done: false },
    { label: 'Proceed', date: '12 Oct', done: true }, { label: 'Next', date: '24 Oct', done: false },
  ] });
  assert.deepEqual(big, { kind: 'big', value: 'Proceed', label: 'the venture’s current verdict · 12 Oct · rests on 6 pieces of evidence' });
  // One piece; an old-route decision drops the clause; one step and no Next draws no timeline.
  assert.match(CARDS.verdict({ ...VERDICT_READ.card.series, current: { decision: 'stop', date: '2026-10-12', evidence: 1 } })[1].label, /rests on 1 piece of evidence$/);
  assert.equal(CARDS.verdict({ ...VERDICT_READ.card.series, current: { decision: 'stop', date: '2026-10-12', evidence: null } })[1].label, 'the venture’s current verdict · 12 Oct');
  assert.deepEqual(CARDS.verdict({ decisions: [{ decision: 'proceed', state: 'given', date: '2026-10-12' }], current: { decision: 'proceed', date: '2026-10-12', evidence: 5 }, next: null }).map((x) => x.kind), ['big']);
  assert.deepEqual(CARDS.verdict(null), []);
  // The table's keys follow the Worker's columns.
  assert.deepEqual(RECORDS.verdict.keys, ['decision', 'for', 'reasoning', 'evidence', 'date']);
  assert.deepEqual(RECORDS.verdict.row(VERDICT_READ.records.rows[1]).cells.decision, { text: 'Withheld', tone: 'grey' });
});

test('18: Record a decision at /validate/verdict/new reads its For and Evidence from form-options and records through POST /decisions', async () => {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const fetchBefore = globalThis.fetch;
  const moduleBefore = cyclesApi.module;
  const sent = [];
  const json = (body) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    sent.push([init.method || 'GET', u, init.body ?? null]);
    if (u.includes('/cycles/validate/modules/verdict/form-options')) return json(OPTIONS);
    if (u.includes('/cycles/validate/decisions')) return json({ id: 51, state: 'withheld' });
    return json({});
  };
  cyclesApi.module = async () => VERDICT_READ;
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const lightbox = () => {
    const key = Object.keys(container).find((k) => k.startsWith('__reactContainer$'));
    const stack = [container[key]];
    while (stack.length) {
      const node = stack.pop();
      if (!node) continue;
      if (node.type?.name === 'FormLightbox') return node.memoizedProps;
      stack.push(node.sibling, node.child);
    }
    return null;
  };
  try {
    await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/validate/verdict/new?project_id=7&for=h-12'] }, h(Routes, null,
      h(Route, { path: '/validate/verdict', element: h(CycleRoute, { cycle: 'validate', slug: 'verdict' }) }),
      h(Route, { path: '/validate/:slug/new', element: h(CycleRoute, { cycle: 'validate', adding: true }) }),
      h(Route, { path: '/validate/:slug', element: h(CycleRoute, { cycle: 'validate' }) })))));
    for (let i = 0; i < 3; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const props = lightbox();
    assert.equal(props?.form?.key, 'decision', 'Record a decision is the open form');
    assert.equal(typeof props.loadOptions, 'function', 'the Add is handed its choices');
    assert.ok(sent.some(([m, u]) => m === 'GET' && /\/cycles\/validate\/modules\/verdict\/form-options\?project=7/.test(u)), JSON.stringify(sent));
    assert.match(textOf(container), /Pilot invoice · H2 · Measured/, 'the evidence choices are drawn');
    await act(async () => { await props.onSubmit({ decision: 'proceed', for: 'h-12', reasoning: 'Fleets paid.', evidence: ['evidence-1'] }); });
    const post = sent.find(([m, u]) => m === 'POST' && /\/cycles\/validate\/decisions\?project=7$/.test(u));
    assert.ok(post, JSON.stringify(sent));
    assert.deepEqual(JSON.parse(post[2]), { decision: 'proceed', for: 'h-12', reasoning: 'Fleets paid.', evidence: ['evidence-1'] });
  } finally {
    await act(async () => root.unmount());
    cyclesApi.module = moduleBefore;
    globalThis.fetch = fetchBefore;
    restore();
  }
});
