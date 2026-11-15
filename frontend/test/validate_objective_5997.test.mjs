/**
 * D5997 (#5997) — "Trying to learn:", the venture's validation objective, at
 * the top of Validate's desktop lead (`ValidateObjective.jsx` inside
 * `ValidateLead`), from the overview read's `objective`.
 *
 *   1. a recorded objective reads "Trying to learn: <text>" for everyone;
 *      empty reads Not recorded, with "Write it" for a writer only;
 *   2. the control follows the read's `can_write` (and a venture to save to):
 *      a reader, a partner included, gets the line and nothing to press;
 *   3. a writer writes, changes and clears it through `setObjective`, the
 *      local limit has the Worker's sentence, and a Worker refusal shows in
 *      its own words; a save re-reads the overview;
 *   4. V11: `restate` draws "After Pivot · Restate what you're trying to
 *      learn" with "Update the objective" for a writer, never for a reader;
 *   5. an unavailable part says so and offers no control; a read without
 *      `objective` draws the lead exactly as before;
 *   6. the route wires it: at 1024px /validate draws the line, and Save goes
 *      to PUT /api/cycles/validate/objective?project=<id>;
 *   7. source: every light class paired with dark, and the one caller of
 *      `setObjective`.
 *
 * Mutation checked (each broke the named tests, then was restored):
 *   - `writer` without `canWrite === true`: 2 and 6 (route) fail (a reader gets the control and the prompt);
 *   - `ValidateLead` handing `canWrite={true}`: 2 and 6 (route) fail;
 *   - the form's refusal replaced by `OBJECTIVE_NOT_SAVED`: 3 fails;
 *   - `objectiveValue` without the length check: 3 fails (an over-long objective is sent);
 *   - `ValidateLead` drawing the objective when the read has none: 5 fails.
 *
 * Every name is made up. Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/validate_objective_5997.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { renderedText } from './_renderedText.mjs';
import ValidateObjective, { OBJECTIVE_MAX, OBJECTIVE_TOO_LONG, OBJECTIVE_NOT_SAVED, objectiveValue } from '../src/pages/cycles/ValidateObjective.jsx';
import { ValidateLead } from '../src/pages/cycles/ValidateNextAction.jsx';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import { cycleValidateApi } from '../src/lib/api/cycleValidate.js';
import { api } from '../src/lib/api.js';
import { aiBudgetApi } from '../src/lib/api/aiBudget.js';
import { railPrefsApi } from '../src/lib/api/railPrefs.js';
import { __resetEadwynPanelForTest } from '../src/ui/eadwynPanel.js';
import { __resetAssistModeForTest } from '../src/hooks/useAssistMode.js';
import { __resetRailPrefsSyncForTest } from '../src/ui/railModelChoice.js';

const h = React.createElement;
const P = 3;
const Q = `?project_id=${P}`;
const QUESTION = 'Do ops teams lose enough time on carrier invoices to pay for reconciliation?';

const FOCUS = { rule: 'next_interview', eyebrow: 'Validate · Next', headline: 'Record the interview with Ada Quill.', why: 'Two more make a theme.', cta: { label: 'Record a session', href: `/validate/record${Q}` }, then: 'Group them.', secondary: [] };
const part = (o = {}) => ({ state: 'ok', text: QUESTION, updated_at: '2026-11-14 10:00:00', updated_by_name: 'Fay Founder', restate: false, ...o });
const read = (o = {}) => ({ can_write: true, focus: FOCUS, meter: null, index: [], figures: [], cards: [], objective: part(), ...o });
const desk = (raw, props = {}) => renderToStaticMarkup(h(MemoryRouter, null, h(ValidateLead, { raw, search: Q, projectId: P, ...props })));
/** Every RegExp metacharacter escaped, so a literal string matches as itself. */
const reEscape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const line = (out) => {
  const at = out.lastIndexOf('<', out.indexOf('data-testid="validate-objective"'));
  return renderedText(out.slice(at, out.lastIndexOf('<', out.indexOf('data-testid="validate-next-action"')))).trim();
};

// ── 1. The line ───────────────────────────────────────────────────────────

test('1: "Trying to learn:" with the stored text; empty reads Not recorded, and "Write it" only for a writer', () => {
  const out = desk(read());
  assert.ok(out.indexOf('data-testid="validate-objective"') < out.indexOf('data-testid="validate-next-action"'), 'above the next action');
  assert.match(line(out), new RegExp(`Trying to learn:\\s*${reEscape(QUESTION)}\\s*Change`));
  assert.doesNotMatch(out, /Write it/);
  const empty = desk(read({ objective: part({ text: null }) }));
  assert.match(line(empty), /Trying to learn:\s*Not recorded\s*Write it/);
  assert.match(empty, /data-state="not_recorded"/);
  // A blank string is not a recorded objective.
  assert.match(line(desk(read({ objective: part({ text: '   ' }) }))), /Not recorded/);
});

// ── 2. Readers ────────────────────────────────────────────────────────────

test('2: a reader, a partner included, sees the line and nothing to press', () => {
  for (const [who, raw, pid] of [
    ['a read-only partner', read({ can_write: false }), P],
    ['a read with no can_write', read({ can_write: undefined }), P],
    ['a writer with no venture to save to', read(), null],
  ]) {
    for (const objective of [part(), part({ text: null }), part({ restate: true })]) {
      const out = desk({ ...raw, objective }, { projectId: pid });
      assert.match(out, /data-testid="validate-objective"/, `${who}: the line`);
      assert.doesNotMatch(out, /validate-objective-(open|form|update|restate)|Write it|Change<|Update the objective/, `${who}: and no control`);
    }
  }
  assert.match(line(desk(read({ can_write: false }))), new RegExp(`^Trying to learn:\\s*${reEscape(QUESTION)}$`));
});

// ── 3. Write, change, clear ───────────────────────────────────────────────

async function mount(tree) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(tree); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  return {
    pr, by,
    text: (id) => txt(id ? by(id) : container).replace(/\s+/g, ' ').trim(),
    act: (fn) => act(async () => { await fn(); }),
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}
const click = (m, id) => m.act(() => m.pr(m.by(id)).onClick());
async function type(m, value) {
  await m.act(() => m.pr(m.by('validate-objective-input')).onChange({ target: { value } }));
  await m.act(() => m.pr(m.by('validate-objective-form')).onSubmit({ preventDefault() {} }));
  return m.by('validate-objective-error') ? m.text('validate-objective-error') : null;
}

test('3: a writer writes, changes and clears it through setObjective; the limit and the Worker\'s refusal in their own words', async () => {
  assert.deepEqual(objectiveValue('  Do they\n pay? '), { value: 'Do they pay?' });
  assert.deepEqual(objectiveValue('   '), { value: null });
  assert.deepEqual(objectiveValue('🚚'.repeat(OBJECTIVE_MAX)), { value: '🚚'.repeat(OBJECTIVE_MAX) });
  assert.deepEqual(objectiveValue('a'.repeat(OBJECTIVE_MAX + 1)), { error: OBJECTIVE_TOO_LONG });
  assert.equal(OBJECTIVE_TOO_LONG, 'Keep what you are trying to learn to 280 characters', 'the Worker\'s sentence');

  const calls = [];
  let changed = 0;
  let refuse;
  const api2 = { setObjective: async (pid, v) => { calls.push([pid, v]); if (refuse !== undefined) throw new Error(refuse); return { ok: true }; } };
  const draw = (objective) => h(MemoryRouter, null, h(ValidateLead, { raw: read({ objective }), search: Q, projectId: P, api: api2, onChanged: () => { changed += 1; } }));

  // Write: Not recorded → Write it → Save.
  let m = await mount(draw(part({ text: null })));
  try {
    assert.equal(m.text('validate-objective-open'), 'Write it');
    await click(m, 'validate-objective-open');
    assert.equal(Boolean(m.by('validate-objective-clear')), false, 'nothing to clear yet');
    assert.match(m.text('validate-objective-left'), /^280 characters left$/);
    assert.equal(await type(m, 'a'.repeat(OBJECTIVE_MAX + 1)), OBJECTIVE_TOO_LONG);
    assert.deepEqual(calls, [], 'an over-long objective is never sent');
    refuse = 'The write failed';
    assert.equal(await type(m, 'Will they pay?'), 'The write failed', 'the Worker\'s words');
    refuse = '';
    assert.equal(await type(m, 'Will they pay?'), OBJECTIVE_NOT_SAVED, 'the fallback when the Worker gave none');
    refuse = undefined;
    assert.equal(await type(m, '  Will they\n pay?  '), null);
    assert.deepEqual(calls.at(-1), [P, 'Will they pay?']);
    assert.equal(changed, 1, 'a save re-reads the overview');
    assert.equal(Boolean(m.by('validate-objective-form')), false, 'and closes the form');
  } finally { await m.unmount(); }

  // Change and clear: Change → the stored text in the field → Save; Clear sends null.
  m = await mount(draw(part()));
  try {
    assert.equal(m.text('validate-objective-open'), 'Change');
    await click(m, 'validate-objective-open');
    assert.equal(m.pr(m.by('validate-objective-input')).value, QUESTION, 'the field opens on the stored text');
    assert.equal(await type(m, 'Who pays first?'), null);
    assert.deepEqual(calls.at(-1), [P, 'Who pays first?']);
    await click(m, 'validate-objective-open');
    await click(m, 'validate-objective-clear');
    assert.deepEqual(calls.at(-1), [P, null], 'Clear sends null');
    await click(m, 'validate-objective-open');
    assert.equal(await type(m, '   '), null);
    assert.deepEqual(calls.at(-1), [P, null], 'an emptied field clears too');
    assert.equal(changed, 4);
  } finally { await m.unmount(); }
});

// ── 4. V11 ────────────────────────────────────────────────────────────────

test('4: V11 — after a Pivot a writer is asked to restate, and Update the objective opens the field', async () => {
  const out = desk(read({ objective: part({ restate: true }) }));
  assert.match(renderedText(out), /After Pivot\s*Restate what you’re trying to learn\s*Your decision changes the customer or offer\. Update the objective and hypotheses before planning a build\.\s*Update the objective/);
  assert.doesNotMatch(desk(read()), /After Pivot/, 'no prompt without restate');
  const calls = [];
  const m = await mount(h(MemoryRouter, null, h(ValidateLead, { raw: read({ objective: part({ restate: true }) }), search: Q, projectId: P, api: { setObjective: async (...a) => { calls.push(a); } } })));
  try {
    await click(m, 'validate-objective-update');
    assert.ok(m.by('validate-objective-form'), 'the same field');
    assert.equal(Boolean(m.by('validate-objective-restate')), false, 'the prompt gives way to it');
    assert.equal(await type(m, 'Do finance leads feel it?'), null);
    assert.deepEqual(calls, [[P, 'Do finance leads feel it?']]);
  } finally { await m.unmount(); }
});

// ── 5. Unavailable, and older reads ───────────────────────────────────────

test('5: an unavailable part says so with no control; a read without objective draws the lead as before', () => {
  const out = desk(read({ objective: { state: 'unavailable', reason: 'What you are trying to learn could not be read.' } }));
  assert.match(line(out), /^Trying to learn:\s*What you are trying to learn could not be read\.$/);
  assert.match(out, /data-state="unavailable"/);
  assert.doesNotMatch(out, /validate-objective-open|Write it/);
  const before = read({ objective: undefined });
  delete before.objective;
  const plain = desk(before);
  assert.doesNotMatch(plain, /validate-objective|validate-lead-stack/);
  assert.equal(plain, renderToStaticMarkup(h(MemoryRouter, null, h(ValidateLead, { raw: before, search: Q, projectId: P }))));
  assert.match(plain, /^<div class="grid grid-cols-1[^"]*" data-testid="validate-lead">/, 'the lead row itself, unwrapped');
  assert.equal(renderToStaticMarkup(h(ValidateObjective, { part: undefined })), '');
});

// ── 6. The route ──────────────────────────────────────────────────────────

for (const writer of [true, false]) test(`6 (route): at 1024px /validate draws "Trying to learn:"${writer ? ', and Save goes to PUT /api/cycles/validate/objective' : ' for a reader with no control'}`, async () => {
  __resetEadwynPanelForTest(); __resetAssistModeForTest(); __resetRailPrefsSyncForTest();
  const real = { myAiSpend: api.myAiSpend, aiPricing: api.aiPricing, mine: aiBudgetApi.mine, topUp: aiBudgetApi.topUp, read: railPrefsApi.read };
  const never = () => new Promise(() => {});
  api.myAiSpend = never; api.aiPricing = never; aiBudgetApi.mine = never; aiBudgetApi.topUp = never;
  railPrefsApi.read = () => Promise.resolve({ ok: true, modes: {}, models: {} });
  const media = globalThis.matchMedia;
  globalThis.matchMedia = (query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} });
  const fetchBefore = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url);
    if (path.includes('/cycles/validate/objective')) sent.push([init.method, path, init.body]);
    const body = path.includes('/cycles/validate/overview') ? read({ can_write: writer, objective: part({ text: null }) }) : {};
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) };
  };
  const m = await mount(h(MemoryRouter, { initialEntries: [`/validate${Q}`] }, h(Routes, null, h(Route, { path: '/validate', element: h(CycleRoute, { cycle: 'validate' }) }))));
  try {
    await m.act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r)); });
    assert.ok(Boolean(m.by('cycle-overview')), 'the desktop overview');
    assert.match(m.text('validate-objective-line'), /^Trying to learn: Not recorded/);
    if (!writer) {
      assert.equal(Boolean(m.by('validate-objective-open')), false, 'a reader gets no control');
      return;
    }
    await click(m, 'validate-objective-open');
    assert.equal(await type(m, 'Will they pay?'), null);
    assert.deepEqual(sent, [['PUT', `/api/cycles/validate/objective?project=${P}`, JSON.stringify({ value: 'Will they pay?' })]]);
  } finally {
    await m.unmount();
    globalThis.fetch = fetchBefore; globalThis.matchMedia = media;
    Object.assign(api, { myAiSpend: real.myAiSpend, aiPricing: real.aiPricing }); Object.assign(aiBudgetApi, { mine: real.mine, topUp: real.topUp }); railPrefsApi.read = real.read;
    __resetEadwynPanelForTest(); __resetAssistModeForTest(); __resetRailPrefsSyncForTest();
  }
});

// ── 7. Source ─────────────────────────────────────────────────────────────

test('7: every light class paired with dark, and setObjective called from this file alone', () => {
  const src = readFileSync('frontend/src/pages/cycles/ValidateObjective.jsx', 'utf8');
  assert.doesNotMatch(src, /\bmd:|matchMedia|innerWidth/);
  for (const light of ['text-gray-900', 'text-gray-600', 'text-gray-700', 'bg-violet-700', 'text-violet-700', 'bg-white', 'border-axal-hairline', 'border-gray-300', 'text-axal-ink', 'text-red-700']) {
    for (const l of src.split('\n').filter((x) => x.includes(`${light} `) || x.includes(`${light}"`) || x.includes(`${light}'`))) {
      assert.match(l, /dark:/, `${light} without a dark: pair: ${l.trim().slice(0, 80)}`);
    }
  }
  assert.match(src, /api\.setObjective\(projectId, v\.value\)/);
  assert.equal(typeof cycleValidateApi.setObjective, 'function');
  for (const f of ['ValidateNextAction.jsx', 'CycleRoute.jsx', 'CycleOverview.jsx', 'PhoneCycleRoot.jsx']) {
    assert.doesNotMatch(readFileSync(`frontend/src/pages/cycles/${f}`, 'utf8'), /setObjective/, `${f} draws the shared control, not its own`);
  }
});
