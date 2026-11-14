/**
 * #5999 — the monthly interviews meter and "Set a target" on both widths.
 *
 * The meter and the target form were the phone root's alone
 * (`PhoneCycleRoot.jsx`, D703, D685 §5.12). They are now `CycleMeter.jsx`,
 * drawn by the phone root under its focus and by the desktop Validate lead
 * row (`ValidateLead` in `ValidateNextAction.jsx`) beside the next action,
 * from one selector (`rootMeter` in `validatePhone.js`). The owner chose to
 * add it to desktop on 2026-11-14, though the Validate v2 desktop canvas
 * (PR #5858) draws the count alone.
 *
 *   1. one read draws the same meter on desktop and phone;
 *   2. the control comes from the read's `can_write` (the owner's option B):
 *      a writer gets it on both widths; a reader, a read-only partner viewing
 *      the venture included, sees the meter without it; a venture handed in
 *      is not enough on its own;
 *   3. no meter for the read draws nothing on either width;
 *   4. both widths save through the one writer, with the same check and the
 *      same error sentence; the desktop route wires it to the real client.
 *
 * Mutation checked (each broke the named tests, then was restored):
 *   - `ValidateLead` reading `phoneMeter(raw)` in place of `rootMeter(...)`: 3 fails (a Stop drew a meter on desktop);
 *   - `CycleMeter`'s writer rule without `canWrite === true` (the old `projectId`-only rule): 2 and 2 (route) fail (a partner got "Set a target");
 *   - the phone root handing `CycleMeter` no `canWrite`: 2 and 4 fail (no writer on the phone);
 *   - `ValidateLead` handing `canWrite={true}`: 2 and 2 (route) fail (a reader got the control on desktop);
 *   - `CycleMeter`'s writer rule without `projectId != null`: 2 fails (a writer with no venture got the control);
 *   - `CycleMeter` without its `if (!meter) return null`: 3 fails (throws on a null meter);
 *   - `TargetForm`'s Worker refusal replaced by `TARGET_NOT_SAVED`: 4 fails (the Worker's words are lost on both widths);
 *   - `ValidateLead` handing `CycleMeter` no `projectId`: 2, 4 and 4 (route) fail;
 *   - `Meter` dropping "· <target_reason>": 1, 4 (route) and 2 (route) fail.
 *
 * Every name is made up. Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/validate_desktop_meter_5999.test.mjs
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
import PhoneCycleRoot from '../src/pages/cycles/PhoneCycleRoot.jsx';
import CycleMeter, { TARGET_NOT_SAVED } from '../src/pages/cycles/CycleMeter.jsx';
import { ValidateLead } from '../src/pages/cycles/ValidateNextAction.jsx';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import { rootMeter, phoneFocus, phoneMeter } from '../src/pages/cycles/validatePhone.js';
import { api } from '../src/lib/api.js';
import { aiBudgetApi } from '../src/lib/api/aiBudget.js';
import { railPrefsApi } from '../src/lib/api/railPrefs.js';
import { __resetEadwynPanelForTest } from '../src/ui/eadwynPanel.js';
import { __resetAssistModeForTest } from '../src/hooks/useAssistMode.js';
import { __resetRailPrefsSyncForTest } from '../src/ui/railModelChoice.js';

const h = React.createElement;
const P = 3;
const Q = `?project_id=${P}`;

const FOCUS = { rule: 'next_interview', eyebrow: 'Validate · Next', headline: 'Record the interview with Ada Quill.', why: 'Two more make a theme.', cta: { label: 'Record a session', href: `/validate/record${Q}` }, then: 'Group them.', secondary: [] };
/** A writer's read (the founder's own venture): the Worker sends `can_write: true`. */
const read = (o = {}) => ({ can_write: true, focus: FOCUS, meter: { key: 'interviews_this_month', label: 'Interviews this month', count: 14, target: 20, target_reason: null, display: '14 of 20' }, index: [], figures: [], cards: [], ...o });

/** The reads both widths must agree on: a target, no target with the Worker's reason, the figure fallback, an unreadable count. */
const READS = {
  'with a target': read(),
  'no target, the Worker\'s reason': read({ meter: { key: 'interviews_this_month', label: 'Interviews this month', count: 4, target: null, target_reason: 'No target set', display: '4' } }),
  'the meter part unreadable, the figure\'s count': read({ meter: null, figures: [{ key: 'interviews_this_month', value: 6 }] }),
  'the meter part and the figure unreadable': read({ meter: null, figures: [{ key: 'interviews_this_month', state: 'unreadable' }] }),
};

const phone = (raw, props = {}) => renderToStaticMarkup(h(MemoryRouter, null, h(PhoneCycleRoot, { cycle: 'validate', raw, search: Q, ...props })));
const desk = (raw, props = {}) => renderToStaticMarkup(h(MemoryRouter, null, h(ValidateLead, { raw, search: Q, ...props })));

/** The element carrying `data-testid="<id>"` and everything inside it (React's static markup, divs balanced). */
function subtree(out, id) {
  const at = out.indexOf(`data-testid="${id}"`);
  if (at < 0) return '';
  const start = out.lastIndexOf('<', at);
  let depth = 0;
  const re = /<(\/?)div\b[^>]*>/g;
  re.lastIndex = start;
  for (let m = re.exec(out); m; m = re.exec(out)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return out.slice(start, m.index + m[0].length);
  }
  return out.slice(start);
}
/** A meter with its frame's class and its testid prefix taken out, so the two widths compare. */
const meterOf = (out, ids) => subtree(out, `${ids}-meter`).replace(/^<div class="[^"]*"/, '<div').replaceAll(`${ids}-`, 'X-');

// ── 1. One read, one meter ────────────────────────────────────────────────

test('1: one read draws the same meter on desktop and phone, and both draw `rootMeter`', () => {
  for (const [name, raw] of Object.entries(READS)) {
    const p = meterOf(phone(raw), 'phone');
    const d = meterOf(desk(raw), 'validate');
    assert.ok(p.length > 0, `${name}: the phone draws a meter`);
    assert.equal(d, p, `${name}: the same meter on both widths`);
    assert.deepEqual(rootMeter(raw, phoneFocus(raw, Q, 'validate'), 'validate'), phoneMeter(raw, 'validate'), `${name}: the shared selector is the overview meter part`);
  }
  // The words, once, so an equal pair of wrong meters cannot pass.
  assert.match(renderedText(meterOf(desk(READS['with a target']), 'validate')), /Interviews this month\s*14 of 20/);
  assert.match(desk(READS['with a target']), /role="progressbar"[^>]*aria-valuenow="70"/);
  assert.match(renderedText(meterOf(desk(READS['no target, the Worker\'s reason']), 'validate')), /4 · No target set/);
  assert.match(renderedText(meterOf(desk(READS['the meter part unreadable, the figure\'s count']), 'validate')), /6 · No target set/);
  assert.match(renderedText(meterOf(desk(READS['the meter part and the figure unreadable']), 'validate')), /Unreadable/);
  // Desktop: beside the next action in the lead row, in a lead-row card.
  const out = desk(READS['with a target']);
  assert.ok(out.indexOf('data-testid="validate-next-action"') < out.indexOf('data-testid="validate-meter"'));
  assert.match(out, /data-testid="validate-lead"/);
  assert.match(out, /class="grid grid-cols-1 items-stretch gap-3 xl:grid-cols-\[minmax\(0,3fr\)_minmax\(0,2fr\)\]"/, 'laid out as Raise\'s lead row');
  assert.match(subtree(out, 'validate-meter'), /^<div class="rounded-xl border border-axal-hairline bg-white[^"]*dark:border-gray-800 dark:bg-gray-900"/);
});

// ── 2. Writers and readers ────────────────────────────────────────────────

test('2: the control follows the read\'s can_write on both widths: a writer gets it; a reader, a partner included, sees the meter without it', () => {
  const raw = READS['with a target'];
  const none = READS['no target, the Worker\'s reason'];
  const partner = { ...raw, can_write: false };
  const unsent = { ...raw, can_write: undefined };
  for (const [draw, ids] of [[phone, 'phone'], [desk, 'validate']]) {
    assert.match(renderedText(draw(raw, { projectId: P })), /Change the target/, `${ids}: a writer with a target`);
    assert.match(renderedText(draw(none, { projectId: P })), /Set a target/, `${ids}: a writer with none`);
    for (const [who, r, pid] of [['a read-only partner viewing the venture', partner, P], ['a read with no can_write, a venture handed in', unsent, P], ['a writer with no venture to save to', raw, null]]) {
      const out = draw(r, { projectId: pid });
      assert.match(out, new RegExp(`data-testid="${ids}-meter"`), `${ids}, ${who}: the meter`);
      assert.doesNotMatch(out, /-target-open|-target-form|Set a target|Change the target/, `${ids}, ${who}: and no control`);
    }
    // The reader's meter is the writer's, less the control.
    assert.equal(meterOf(draw(partner, { projectId: P }), ids), meterOf(draw(raw, { projectId: P }), ids).replace(/<button[^]*?<\/button>/, ''), `${ids}: the same meter`);
  }
  // The control is Validate's alone, on the shared component as on the phone.
  assert.doesNotMatch(renderToStaticMarkup(h(CycleMeter, { meter: phoneMeter(raw, 'validate'), cycle: 'raise', canWrite: true, projectId: P })), /target-open/);
});

// ── 3. No meter, nothing ──────────────────────────────────────────────────

test('3: where the read gives no meter, neither width draws one, and the shared component draws nothing', () => {
  assert.equal(renderToStaticMarkup(h(CycleMeter, { meter: null, projectId: P })), '');
  const NONE = {
    'a Stop': read({ focus: { ...FOCUS, rule: 'stopped' } }),
    'a step that could not be worked out': read({ focus: { rule: 'unavailable', state: 'unavailable', eyebrow: 'Validate · Next', headline: 'The next step could not be worked out.', why: 'A read failed.' } }),
    'the first conversation': read({ focus: null, cards: [{ slug: 'customer-research', state: 'empty' }] }),
    'no focus at all': read({ focus: null }),
  };
  for (const [name, raw] of Object.entries(NONE)) {
    assert.equal(rootMeter(raw, phoneFocus(raw, Q, 'validate'), 'validate'), null, `${name}: no meter`);
    assert.doesNotMatch(phone(raw, { projectId: P }), /phone-meter|phone-target/, `${name}: phone`);
    const d = desk(raw, { projectId: P });
    assert.doesNotMatch(d, /validate-meter|validate-target|validate-lead/, `${name}: desktop draws no meter and no row of two`);
    // The next action stays as it was before #5999.
    assert.equal(d.includes('data-testid="validate-next-action"'), raw.focus != null || raw.cards.length > 0, `${name}: the next action as before`);
  }
});

// ── 4. One writer, one sentence ───────────────────────────────────────────

/** Mount a tree through the stub DOM; `by(id)` finds a node by testid. */
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

/** Open the form, type `value`, submit; returns the error line's text, or null. */
async function submit(m, ids, value) {
  if (m.by(`${ids}-target-open`)) await m.act(() => m.pr(m.by(`${ids}-target-open`)).onClick());
  await m.act(() => m.pr(m.by(`${ids}-target-input`)).onChange({ target: { value } }));
  await m.act(() => m.pr(m.by(`${ids}-target-form`)).onSubmit({ preventDefault() {} }));
  return m.by(`${ids}-target-error`) ? m.text(`${ids}-target-error`) : null;
}

test('4: both widths check the same way, send the same call, and show the same error sentence', async () => {
  const raw = READS['no target, the Worker\'s reason'];
  const seen = {};
  for (const ids of ['phone', 'validate']) {
    const calls = [];
    let changed = 0;
    let refuse;
    const api2 = { setInterviewsTarget: async (pid, v) => { calls.push([pid, v]); if (refuse !== undefined) throw new Error(refuse); return { ok: true }; } };
    const props = { raw, search: Q, projectId: P, api: api2, onChanged: () => { changed += 1; } };
    const m = await mount(h(MemoryRouter, null, ids === 'phone' ? h(PhoneCycleRoot, { cycle: 'validate', ...props }) : h(ValidateLead, props)));
    try {
      const local = await submit(m, ids, '0');
      assert.deepEqual(calls, [], `${ids}: a zero is never sent`);
      refuse = 'The target is a whole number of interviews a month, above zero';
      const worker = await submit(m, ids, '25');
      refuse = '';
      const fallback = await submit(m, ids, '25');
      refuse = undefined;
      assert.equal(await submit(m, ids, '25'), null, `${ids}: saved`);
      assert.deepEqual(calls, [[P, 25], [P, 25], [P, 25]], `${ids}: the one writer, the venture and the value`);
      assert.equal(changed, 1, `${ids}: a save re-reads the overview`);
      assert.equal(Boolean(m.by(`${ids}-target-form`)), false, `${ids}: and closes the form`);
      seen[ids] = [local, worker, fallback];
    } finally { await m.unmount(); }
  }
  assert.deepEqual(seen.validate, seen.phone, 'the same sentences on both widths');
  assert.deepEqual(seen.phone, ['Enter a whole number of interviews a month, above zero.', 'The target is a whole number of interviews a month, above zero', TARGET_NOT_SAVED]);
  assert.equal(TARGET_NOT_SAVED, 'The target could not be saved.');
});

for (const writer of [true, false]) test(writer ? '4 (route): at 1024px /validate draws the meter in the lead row, and Save goes to PUT /api/cycles/validate/interviews-target'
  : '2 (route): at 1024px a read-only partner\'s read (can_write: false) draws the meter in the lead row with no control', async () => {
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
    if (path.includes('/cycles/validate/interviews-target')) sent.push([init.method, path, init.body]);
    const body = path.includes('/cycles/validate/overview') ? { ...READS['no target, the Worker\'s reason'], can_write: writer } : {};
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) };
  };
  const m = await mount(h(MemoryRouter, { initialEntries: [`/validate${Q}`] }, h(Routes, null, h(Route, { path: '/validate', element: h(CycleRoute, { cycle: 'validate' }) }))));
  try {
    await m.act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r)); });
    assert.ok(Boolean(m.by('cycle-overview')), 'the desktop overview');
    assert.ok(Boolean(m.by('validate-lead') && m.by('validate-meter')), 'the meter in the lead row');
    assert.equal(Boolean(m.by('phone-meter')), false, 'and no phone root');
    assert.match(m.text('validate-meter'), /4 · No target set/);
    if (!writer) {
      // Booleans, not nodes: a failed assert would print the whole stub DOM.
      assert.equal(Boolean(m.by('validate-target-open')), false, 'a reader gets no control');
      assert.doesNotMatch(m.text('validate-meter'), /Set a target/);
      return;
    }
    assert.equal(await submit(m, 'validate', '12'), null);
    assert.deepEqual(sent, [['PUT', `/api/cycles/validate/interviews-target?project=${P}`, JSON.stringify({ value: 12 })]]);
  } finally {
    await m.unmount();
    globalThis.fetch = fetchBefore; globalThis.matchMedia = media;
    Object.assign(api, { myAiSpend: real.myAiSpend, aiPricing: real.aiPricing }); Object.assign(aiBudgetApi, { mine: real.mine, topUp: real.topUp }); railPrefsApi.read = real.read;
    __resetEadwynPanelForTest(); __resetAssistModeForTest(); __resetRailPrefsSyncForTest();
  }
});

// ── Source ────────────────────────────────────────────────────────────────

test('the shared file: no breakpoint or width of its own, every light class paired with dark, and the one caller of setInterviewsTarget', () => {
  const src = readFileSync('frontend/src/pages/cycles/CycleMeter.jsx', 'utf8');
  assert.doesNotMatch(src, /\bmd:|matchMedia|innerWidth/);
  for (const light of ['text-gray-900', 'text-gray-600', 'bg-violet-700', 'text-violet-700', 'bg-[#ececf1]', 'bg-white', 'border-axal-hairline']) {
    for (const line of src.split('\n').filter((l) => l.includes(`${light} `) || l.includes(`${light}"`))) {
      assert.match(line, /dark:/, `${light} without a dark: pair: ${line.trim().slice(0, 80)}`);
    }
  }
  assert.match(src, /api\.setInterviewsTarget\(projectId, v\.value\)/);
  for (const f of ['PhoneCycleRoot.jsx', 'ValidateNextAction.jsx', 'CycleRoute.jsx']) {
    assert.doesNotMatch(readFileSync(`frontend/src/pages/cycles/${f}`, 'utf8'), /setInterviewsTarget|function TargetForm/, `${f} draws the shared form, not its own`);
  }
  assert.match(readFileSync('frontend/src/pages/cycles/CycleRoute.jsx', 'utf8'), /<ValidateLead raw=\{rawOverview\} search=\{q\} openAction=\{openAction\} projectId=\{projectId\} onChanged=\{\(\) => setReload\(\(n\) => n \+ 1\)\} \/>/);
});
