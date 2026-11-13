/**
 * D4600 (#4600) — Build's progress says only what it recorded, and a filing's
 * proof is retried against the filing that already exists.
 *
 * Progress. The lead never says "None is built or live yet" while an item's
 * Built or Live is not recorded; an item that cannot be built or live (a risk,
 * a prototype test) is no evidence either way; a completed test is its own
 * bucket, not a built or live product; and the lead, the chart, the Stage
 * filter and the item stages count the same items.
 *
 * Filing. The form creates the step and then uploads its proof. When the upload
 * fails, the form keeps the created step's id: the saved filing is shown to the
 * page behind it, the button becomes Retry proof upload, every other field is
 * frozen, and the next press uploads to the same step. Neither retry creates a
 * second filing.
 *
 * Each group also runs on mutants of the model, forms.js and FormLightbox.jsx
 * that must fail.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/build_progress_4600.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { h, mountForm, mutationCheck, propsOf, textOf } from './_form_d695.mjs';
import * as realModel from '../src/pages/cycles/buildProgressModel.js';
import * as realForms from '../src/pages/cycles/forms.js';
import RealLightbox from '../src/pages/cycles/FormLightbox.jsx';

const read = (rel) => readFileSync(new URL('../src/' + rel, import.meta.url), 'utf8');
const MODEL = 'pages/cycles/buildProgressModel.js';
const FORMS = 'pages/cycles/forms.js';
const LIGHTBOX = 'pages/cycles/FormLightbox.jsx';
const P = 3;

// ───────────────────────────────────────────────────────────────── progress

const item = (uid, kind, title) => ({
  uid, kind, status: 'accepted', payload: { title }, evidence: [], decided_at: '2026-10-12 15:00:00', landed_table: 'mvp_features', landed_id: '1', marker: 'VB-' + uid,
});
const planOf = (...items) => ({
  modules: { 'solution-design': items, 'prototype-mvp': [], 'product-roadmap': [], 'company-creation': [], 'operating-systems': [], 'founding-team': [] },
});
const NOT_YET = { reported: true, done: false, source: 'Build › MVP scope', value: 'In Progress' };
const DONE = { reported: true, done: true, at: '2026-10-14 10:00:00', source: 'Build › MVP scope', value: 'Done' };
const UNREAD = { reported: false, reason: 'No connector reports a deploy here' };
const state = (uid, kind, cells) => ({ plan_item_uid: uid, kind, ...cells });

const F1 = 'f1111111-1111-4111-8111-111111111111';
const F2 = 'f2222222-2222-4222-8222-222222222222';
const T1 = 't1111111-1111-4111-8111-111111111111';
const R1 = 'r1111111-1111-4111-8111-111111111111';

function assertLeads(m) {
  const rows = (items, states) => m.progressRows(planOf(...items), [], [], states);
  const feature = (uid) => item(uid, 'feature', 'Feature ' + uid.slice(0, 2));
  const test_ = item(T1, 'prototype-test', 'Setup test');
  const risk = item(R1, 'risk', 'Migration risk');

  // One item reported "Not yet", the other not recorded: neither "none" nor "all not built".
  const mixed = rows([feature(F1), feature(F2)], [state(F1, 'feature', { built: NOT_YET, live: NOT_YET, tested: UNREAD })]);
  assert.equal(m.stageLead(mixed), '2 accepted items, 0 sent to a tool. Built or live: 1 not yet, 1 not recorded.');
  assert.doesNotMatch(m.stageLead(mixed), /None is built or live/);

  // Every item that can be built or live is reported "Not yet": then, and only then, "None".
  const none = rows([feature(F1), feature(F2)], [
    state(F1, 'feature', { built: NOT_YET, live: NOT_YET, tested: UNREAD }), state(F2, 'feature', { built: NOT_YET, live: NOT_YET, tested: UNREAD })]);
  assert.equal(m.stageLead(none), '2 accepted items, 0 sent to a tool. None is built or live yet.');

  // One stage of an item reported, its sibling not: the item is not recorded, never "Not yet".
  const half = rows([feature(F1)], [state(F1, 'feature', { built: NOT_YET, live: UNREAD, tested: UNREAD })]);
  assert.equal(m.stageLead(half), '1 accepted item, 0 sent to a tool. Built and live are not recorded here yet.');

  // Nothing reported, and a failed read: not recorded, in the same words.
  assert.equal(m.stageLead(rows([feature(F1), feature(F2)], undefined)), '2 accepted items, 0 sent to a tool. Built and live are not recorded here yet.');
  assert.equal(m.stageLead(rows([feature(F1), feature(F2)], null)), '2 accepted items, 0 sent to a tool. Built and live are not recorded here yet.');

  // Items that cannot be built or live say nothing about built or live.
  const inapplicable = rows([risk, test_], [state(T1, 'prototype-test', { tested: NOT_YET })]);
  assert.equal(m.stageLead(inapplicable), '2 accepted items, 0 sent to a tool.');

  // Some built, some not recorded: the count stands, and the rest is said.
  const some = rows([feature(F1), feature(F2)], [state(F1, 'feature', { built: DONE, live: UNREAD, tested: UNREAD })]);
  assert.equal(m.stageLead(some), '1 of 2 accepted items are built or live. Built or live: 1 not recorded.');
}

test('the lead: "None is built or live yet" only when every item that can be built or live is reported Not yet', async () => {
  assertLeads(realModel);
  await mutationCheck(read(MODEL), MODEL, assertLeads, [
    ["  return cells.every((c) => c.state === 'notyet') ? 'no' : 'unknown';", "  return cells.some((c) => c.state === 'notyet') ? 'no' : 'unknown';"],
    ["  if (!no && !unknown) return `${head}${testedLine}`;", "  if (!unknown) return `${head} None is built or live yet.${testedLine}`;"],
    ["  if (!unknown) return `${head} None is built or live yet.${testedLine}`;\n  if (!no) return", "  if (!no) return `${head} None is built or live yet.${testedLine}`;\n  if (!unknown) return `${head} None is built or live yet.${testedLine}`;\n  if (!no) return"],
    ["  const cells = ['built', 'live'].map((k) => r.stages[k]).filter((c) => c && c.state !== 'na');\n  if (!cells.length) return 'na';", "  const cells = ['built', 'live'].map((k) => r.stages[k]).filter((c) => c && c.state !== 'na');\n  if (!cells.length) return 'unknown';"],
    ["${unknown ? unknownLine : ''}", "${''}"],
  ]);
});

function assertTested(m) {
  const planItems = [item(F1, 'feature', 'Live ETA panel'), item(T1, 'prototype-test', 'Setup test'), item(F2, 'feature', 'Carrier export')];
  const states = [
    state(F1, 'feature', { built: DONE, live: UNREAD, tested: DONE }),
    state(T1, 'prototype-test', { tested: DONE }),
    state(F2, 'feature', { built: NOT_YET, live: NOT_YET, tested: UNREAD }),
  ];
  const rows = m.progressRows(planOf(...planItems), [], [], states);
  const by = Object.fromEntries(rows.map((r) => [r.uid, r]));
  // A completed prototype test is a tested item. Built and live do not apply to it.
  assert.deepEqual(['built', 'live'].map((k) => by[T1].stages[k].state), ['na', 'na']);
  assert.equal(by[T1].stages.tested.state, 'done');
  assert.equal(by[T1].bucket, 'tested', 'a completed test is not a built or live product');
  // A built and tested feature is built; a feature reported Not yet and untested is where its other stages put it.
  assert.equal(by[F1].bucket, 'built');
  assert.equal(by[F2].bucket, 'accepted');
  assert.equal(m.bucketOf('feature', { built: { state: 'notyet' }, live: { state: 'na' }, tested: { state: 'done' } }), 'tested');
  assert.equal(m.bucketOf('feature', { built: { state: 'done' }, tested: { state: 'done' } }), 'built');
  assert.equal(m.stageLead(rows), '1 of 3 accepted items are built or live. 1 tested, not built or live.');

  // The lead, the chart and the Stage filter count the same items.
  const chart = m.stageChart(rows).find((x) => x.module === 'solution-design');
  assert.deepEqual(chart.counts, { accepted: 1, sent: 0, progress: 0, built: 1, tested: 1, notstarted: 0, unrecorded: 0 });
  assert.equal(chart.total, 3);
  for (const b of m.BUCKETS) {
    assert.equal(m.filterRows(rows, { ...m.PROGRESS_FILTERS, stage: b.id }).length, chart.counts[b.id], `the ${b.label} filter and bar agree`);
  }
  assert.deepEqual(m.STAGE_FILTERS.map(([id]) => id), m.BUCKETS.map((b) => b.id));
  assert.ok(m.BUCKETS.some((b) => b.id === 'tested' && b.label === 'Tested'));
  assert.equal(m.BUCKETS.find((b) => b.id === 'built').label, 'Built or live');
  assert.equal(chart.counts.built + chart.counts.tested + chart.counts.accepted, chart.total);

  // A test alone: nothing is claimed about built or live, and its failed read leaves it Accepted.
  const only = m.progressRows(planOf(planItems[1]), [], [], [states[1]]);
  assert.equal(m.stageLead(only), '1 accepted item, 0 sent to a tool. 1 tested, not built or live.');
  const blind = m.progressRows(planOf(planItems[1]), [], [], null);
  assert.equal(blind[0].bucket, 'accepted');
  assert.equal(blind[0].stages.tested.state, 'unrecorded');
}

test('a completed test is Tested, not Built or live; the lead, bars, filter and item stages agree', async () => {
  assertTested(realModel);
  await mutationCheck(read(MODEL), MODEL, assertTested, [
    ["  if (stage.tested?.state === 'done') return 'tested';", "  if (stage.tested?.state === 'done') return 'built';"],
    ["  if (['built', 'live'].some((k) => stage[k]?.state === 'done')) return 'built';", "  if (['built', 'live', 'tested'].some((k) => stage[k]?.state === 'done')) return 'built';"],
    ["  { id: 'tested', label: 'Tested' },\n", ''],
    ["const testedLine = tested ? ` ${tested} tested, not built or live.` : '';", "const testedLine = '';"],
    ["  const tested = rows.filter((r) => r.bucket === 'tested').length;", "  const tested = rows.filter((r) => r.stages.tested.state === 'done').length;"],
  ]);
});

// ───────────────────────────────────────────────────────────────── filing

const file = () => new File(['%PDF-1.4'], 'proof.pdf', { type: 'application/pdf' });

async function mountFiling(forms, Lightbox, { upload, create = async () => ({ id: 9 }) }) {
  const form = forms.FORMS.build['company-creation'][0];
  const calls = [];
  const events = { saved: [], closed: 0 };
  const w = {
    build: new Proxy({}, { get: (_t, name) => async (...args) => { calls.push([name, ...args]); return name === 'formationStep' ? create(...args) : { id: 9 }; } }),
    formOptions: async () => ({ jurisdiction: { options: [{ value: 'DE', label: 'DE' }] }, for_holder_id: { options: [] } }),
    recordAction: async (...args) => { calls.push(['recordAction', ...args]); return upload(...args); },
  };
  const ui = await mountForm(h(Lightbox, {
    form, cycle: 'build', slug: 'company-creation',
    onSubmit: (v, memory) => form.submit(w, P, v, memory),
    onSaved: (r) => events.saved.push(r), onClose: () => { events.closed++; },
    loadOptions: () => form.loadOptions(w, P),
  }));
  await ui.flush();
  const sends = (name) => calls.filter((c) => c[0] === name);
  const button = () => ui.by('cycle-form-save');
  const kinds = () => ui.nodes().filter((n) => n.tagName === 'INPUT' && propsOf(n).name === 'kind' && propsOf(n).type === 'radio');
  return { ...ui, calls, events, sends, button, kinds };
}

async function assertRetry({ forms, Lightbox }) {
  // The first upload fails, the second works.
  let attempts = 0;
  const ui = await mountFiling(forms, Lightbox, { upload: async () => { attempts++; if (attempts === 1) throw new Error('Storage is unavailable'); return { ok: true }; } });
  try {
    await ui.input('proof', file());
    await ui.submit();
    assert.equal(ui.sends('formationStep').length, 1);
    assert.equal(ui.sends('recordAction').length, 1);
    // The saved filing is shown to the page behind the form; the form stays open and says which part is left.
    assert.deepEqual(ui.events.saved, [{ id: 9 }], 'the page behind refreshes with the saved filing');
    assert.equal(ui.events.closed, 0);
    assert.match(textOf(ui.by('cycle-form-refusal')), /The filing was added; its proof was not stored: Storage is unavailable\./);
    assert.match(textOf(ui.by('cycle-form-refusal')), /Press Retry proof upload to try the upload again\. The filing is not added twice\./);
    assert.equal(textOf(ui.button()).trim(), 'Retry proof upload');
    assert.ok(ui.kinds().length > 0 && ui.kinds().every((n) => propsOf(n).disabled), 'the saved fields are frozen');
    assert.ok(!propsOf(ui.by('cycle-form-proof')).disabled, 'the proof can be chosen again');
    // The retry uploads to the same step and creates nothing.
    await ui.submit();
    assert.equal(ui.sends('formationStep').length, 1, 'exactly one filing');
    assert.deepEqual(ui.sends('recordAction').map((c) => c[4]), ['step-9', 'step-9'], 'both uploads target the one filing');
    assert.equal(ui.events.closed, 1);
  } finally { await ui.unmount(); }

  // Two failures, then success: still one filing.
  attempts = 0;
  const twice = await mountFiling(forms, Lightbox, { upload: async () => { attempts++; if (attempts < 3) throw new Error('Timed out'); return { ok: true }; } });
  try {
    await twice.input('proof', file());
    await twice.submit(); await twice.submit(); await twice.submit();
    assert.equal(twice.sends('formationStep').length, 1);
    assert.deepEqual(twice.sends('recordAction').map((c) => c[4]), ['step-9', 'step-9', 'step-9']);
    assert.equal(twice.events.closed, 1);
  } finally { await twice.unmount(); }

  // After a half success, a Retry with no file creates nothing and uploads nothing, and says why.
  const bare = await mountFiling(forms, Lightbox, { upload: async () => { throw new Error('No'); } });
  try {
    await bare.input('proof', file());
    await bare.submit();
    await bare.input('proof', null);
    await bare.submit();
    assert.equal(bare.sends('formationStep').length, 1);
    assert.equal(bare.sends('recordAction').length, 1);
    assert.match(textOf(bare.by('cycle-form-refusal')), /Choose the proof file to upload, or close this form: the filing is already added\./);
    assert.equal(bare.events.closed, 0);
    assert.equal(textOf(bare.button()).trim(), 'Retry proof upload');
  } finally { await bare.unmount(); }

  // A filing whose creation fails has nothing to retry: the button stays Add filing and a second press creates.
  let created = 0;
  const failing = await mountFiling(forms, Lightbox, { upload: async () => ({ ok: true }) });
  try {
    failing.calls.length = 0;
    await failing.submit();
    assert.equal(failing.sends('formationStep').length, 1);
    assert.equal(failing.sends('recordAction').length, 0, 'no proof, no upload');
    assert.equal(failing.events.closed, 1);
    assert.deepEqual(failing.events.saved, [{ id: 9 }]);
    created++;
  } finally { await failing.unmount(); }
  assert.equal(created, 1);

  // The create answer itself is lost: the same open form retries with one key.
  let createAttempts = 0;
  const ambiguous = await mountFiling(forms, Lightbox, {
    upload: async () => ({ ok: true }),
    create: async () => { createAttempts += 1; if (createAttempts === 1) throw new Error('The answer was lost'); return { id: 9, replayed: true }; },
  });
  try {
    await ambiguous.submit();
    await ambiguous.submit();
    const creates = ambiguous.sends('formationStep');
    assert.equal(creates.length, 2);
    assert.match(creates[0][3], /^[A-Za-z0-9_-]{8,128}$/);
    assert.equal(creates[1][3], creates[0][3], 'the key belongs to the open form, not one press');
  } finally { await ambiguous.unmount(); }
}

test('a failed proof upload keeps the created filing: one filing, both uploads to its id, the form shows what is left', async () => {
  await assertRetry({ forms: realForms, Lightbox: RealLightbox });
  await mutationCheck(read(FORMS), FORMS, (m) => assertRetry({ forms: m, Lightbox: RealLightbox }), [
    ["    const made = memory.filing || await w.build.formationStep(projectId, buildFiling.toBody(v), memory.idempotencyKey);", "    const made = await w.build.formationStep(projectId, buildFiling.toBody(v), memory.idempotencyKey);"],
    ["    memory.idempotencyKey ||= filingIdempotencyKey();", "    memory.idempotencyKey = filingIdempotencyKey();"],
    ["        memory.filing = made;\n", ''],
    ["    if (memory.filing && !hasFile) {", "    if (false) {"],
    ["const PROOF_RETRY = 'Retry proof upload';", "const PROOF_RETRY = 'Add filing';"],
  ]);
  await mutationCheck(read(LIGHTBOX), LIGHTBOX, (m) => assertRetry({ forms: realForms, Lightbox: m.default }), [
    ["const result = await onSubmit(sent, memory.current);", "const result = await onSubmit(sent);"],
    ["      if (error?.partial && !partial) onSaved?.(error.partial.result);\n", ''],
    ["      if (error?.partial) setPartial(error.partial);\n", ''],
    ["{busy ? 'Saving…' : partial?.cta || base.cta", "{busy ? 'Saving…' : base.cta"],
    ["busy={busy || !!readOnly || (!!partial && field.name !== partial.only)}", "busy={busy || !!readOnly}"],
    ["busy={busy || !!readOnly || (!!partial && field.name !== partial.only)}", "busy={busy || !!readOnly || !!partial}"],
  ]);
});
