// #4155 (K2 #4189 wired) — HQ › Decks › Feature flags, live: each toggle opens
// an in-page reason step, nothing is written until Save, and Save sends the
// row the other way with the reason through `PUT /api/admin/feature-flags`.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_decks_flags_4189.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { FLAG_REASON_MAX, FLAG_REASON_MIN, adminFeatureFlagsApi } from '../src/lib/api/adminFeatureFlags.js';
import HqDecksPage from '../src/pages/hq/decks/HqDecksPage.jsx';
import { BUILD, NOT_RECORDED, defaultRow, flagChange, flagLabel, flagRows, reachLabel } from '../src/pages/hq/decks/hqDecksModel.js';

const h = React.createElement;
const WHY = 'Rehearsal is paused while the timing notes are fixed.';
const LABELS = { 'deck:rehearsal': { label: 'Rehearsal', description: 'Founders record a run-through of their deck and get timing and delivery notes.' } };
const REPLY = {
  flags: [
    { key: 'deck:rehearsal', scope: 'global', scope_id: '', enabled: true, updated_by: { uid: 'u-hana', name: 'Hana HQ' }, updated_at: '2026-11-03 09:00:00', affected: 41 },
    { key: 'grid_generate', scope: 'user', scope_id: '42', enabled: false, updated_by: null, updated_at: '2026-11-02 09:00:00', affected: null },
  ],
  keys: ['grid_generate', 'deck:rehearsal', 'deck:logo_wall'],
  labels: { ...LABELS, 'deck:logo_wall': { label: 'Logo wall', description: 'Founders add customer logos.' } },
  cache_s: 60,
};

const response = (body, status = 200) => ({ ok: status < 400, status, statusText: String(status), headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

/** The Worker, stubbed: what was sent, and what each call answers. */
function serve({ put = () => [{ ok: true }, 200] } = {}) {
  const sent = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    sent.push({ url: String(url), method, body: options.body ? JSON.parse(options.body) : null });
    if (/\/api\/admin\/feature-flags$/.test(String(url))) return method === 'PUT' ? response(...put()) : response(REPLY);
    return response({ detail: 'Not found' }, 404);
  };
  return { sent, restore: () => { globalThis.fetch = previous; } };
}

test('the client: set refuses a missing or short reason before anything is sent, and sends the trimmed reason in the PUT body', async () => {
  // Mutation checked: the reason check removed → a bare set reaches fetch; `reason: why` dropped from the body → the body check fails.
  const w = serve();
  const restore = installDocument();
  try {
    for (const bad of [undefined, '', '   ', 'too short', 'x'.repeat(FLAG_REASON_MAX + 1)]) {
      await assert.rejects(adminFeatureFlagsApi.set({ key: 'grid_generate', scope: 'global', enabled: false }, bad), (e) => e.code === 'reason_required');
    }
    assert.equal(w.sent.length, 0, 'nothing leaves without a reason');
    await adminFeatureFlagsApi.set({ key: 'deck:rehearsal', scope: 'role', scope_id: 'founder', enabled: false }, `  ${WHY}  `);
    assert.equal(w.sent.length, 1);
    assert.match(w.sent[0].url, /\/api\/admin\/feature-flags$/);
    assert.equal(w.sent[0].method, 'PUT');
    assert.deepEqual(w.sent[0].body, { key: 'deck:rehearsal', scope: 'role', scope_id: 'founder', enabled: false, reason: WHY });
  } finally { restore(); w.restore(); }
});

test('the client\'s reason bounds are the Worker\'s', () => {
  const route = readFileSync(new URL('../../cloudflare-worker/src/routes/admin_feature_flags.ts', import.meta.url), 'utf8');
  assert.equal(Number(route.match(/export const REASON_MIN = (\d+);/)[1]), FLAG_REASON_MIN);
  assert.match(route, new RegExp(`reason\\.length > ${FLAG_REASON_MAX}\\b`));
});

test('the model: deck features by their label, the writer by name only, and a reach that was not counted is never 0', () => {
  // Mutation checked: reachLabel answering 0 for null → the "Not recorded" check fails; flagRows reading updated_by.uid → the name check fails.
  assert.equal(BUILD.K2.live, true);
  assert.deepEqual(flagLabel('deck:rehearsal', LABELS), { name: 'Rehearsal', what: LABELS['deck:rehearsal'].description });
  assert.equal(flagLabel('deck:unlabelled', LABELS).name, 'deck:unlabelled', 'an unlabelled key reads by its key, never a guess');
  const [reh, grid] = flagRows(REPLY);
  assert.deepEqual([reh.name, reh.by, reh.reaches, reh.on], ['Rehearsal', 'Hana HQ', '41 members', true]);
  assert.deepEqual([grid.by, grid.reaches, grid.scope], [NOT_RECORDED, NOT_RECORDED, 'One named person']);
  assert.equal(reachLabel(null), NOT_RECORDED);
  assert.equal(reachLabel(undefined), NOT_RECORDED);
  assert.equal(reachLabel(0), '0 members', 'a counted zero is a zero');
  assert.equal(reachLabel(1), '1 member');
  assert.deepEqual(flagChange(reh), { key: 'deck:rehearsal', scope: 'global', scope_id: '', enabled: false });
  assert.deepEqual(flagChange(grid), { key: 'grid_generate', scope: 'user', scope_id: '42', enabled: true }, 'the same row, the other way');
  assert.deepEqual(flagChange(defaultRow('deck:logo_wall')), { key: 'deck:logo_wall', scope: 'global', scope_id: '', enabled: false }, 'a default-on key writes the global row off');
});

async function mount() {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: ['/admin/platform/decks/flags'] }, h(HqDecksPage))); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const all = (re) => walk(container).filter((n) => re.test(String(pr(n)['data-testid'] ?? '')));
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    by, all, pr, text: (n = container) => text(n).replace(/\s+/g, ' '),
    async press(n) { assert.ok(n, 'drawn'); await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    async type(n, value) { assert.ok(n, 'drawn'); await act(async () => { pr(n).onChange?.({ target: { value } }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

const TOGGLE = 'deck-flag-toggle-deck:rehearsal|global|';

test('HD2: with K2 live every toggle is enabled; a toggle opens the reason step and writes nothing until Save', async () => {
  // Mutation checked: the toggle `disabled` always → the enabled check fails; Save armed without a reason → the disabled check fails;
  // the toggle writing at once → the "nothing yet" check fails; Save not sending flagChange(row) → the body check fails.
  const w = serve();
  const m = await mount();
  try {
    const toggles = m.all(/^deck-flag-toggle-/);
    assert.equal(toggles.length, 3, 'two rows and one default-on key');
    for (const t of toggles) assert.equal(m.pr(t).disabled, false);
    assert.equal(m.by('deck-flags-not-yet'), undefined, 'no "Not switched on yet" line');
    const page = m.text();
    assert.match(page, /Rehearsal .* Hana HQ/);
    assert.match(page, /Reaches 41 members/);
    assert.match(page, /Reaches Not recorded/);
    assert.doesNotMatch(page, /Reaches 0\b/, 'an uncounted reach is never 0');
    assert.doesNotMatch(page, /u-hana|@|\b42\b/, 'names only: no uid, email or user id');

    await m.press(m.by(TOGGLE));
    assert.ok(m.by('deck-flag-sheet'), 'the reason step is in the page');
    assert.match(m.text(m.by('deck-flag-sheet')), /Switch Rehearsal off/);
    assert.equal(w.sent.filter((s) => s.method === 'PUT').length, 0, 'nothing written yet');
    assert.equal(m.pr(m.by('deck-flag-save')).disabled, true, 'no reason, no Save');
    await m.type(m.by('deck-flag-reason'), 'too short');
    assert.equal(m.pr(m.by('deck-flag-save')).disabled, true);
    await m.type(m.by('deck-flag-reason'), WHY);
    assert.equal(m.pr(m.by('deck-flag-save')).disabled, false);
    await m.press(m.by('deck-flag-save'));
    const puts = w.sent.filter((s) => s.method === 'PUT');
    assert.equal(puts.length, 1);
    assert.deepEqual(puts[0].body, { key: 'deck:rehearsal', scope: 'global', scope_id: '', enabled: false, reason: WHY });
    assert.equal(m.by('deck-flag-sheet'), undefined, 'the sheet closes on save');
    assert.equal(w.sent.filter((s) => s.method === 'GET').length, 2, 'the flags are read again');
  } finally { await m.unmount(); w.restore(); }
});

test('HD2: a failed write says so in the house style and keeps the sheet, with Try again', async () => {
  // Mutation checked: the catch not setting `failed` → no alert and no Try again.
  const w = serve({ put: () => [{ detail: 'down' }, 503] });
  const m = await mount();
  try {
    await m.press(m.by(TOGGLE));
    await m.type(m.by('deck-flag-reason'), WHY);
    await m.press(m.by('deck-flag-save'));
    assert.match(m.text(m.by('deck-flag-failed')), /Could not be saved\. Nothing was changed\. Try again\./);
    assert.equal(m.text(m.by('deck-flag-save')).trim(), 'Try again');
    assert.ok(m.by('deck-flag-sheet'), 'the sheet stays open with the reason');
  } finally { await m.unmount(); w.restore(); }
});

test('HD2: a failed read says "Could not be read" with Try again, never an empty list', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => response({ detail: 'down' }, 503);
  const m = await mount();
  try {
    assert.match(m.text(m.by('deck-flags-unreadable')), /Could not be read\. The feature flags did not load\. .* Try again/);
    assert.equal(m.by('deck-flags-table'), undefined);
  } finally { await m.unmount(); globalThis.fetch = previous; }
});

test('HD2: while K2 is not live the toggles stay off and say why', async () => {
  // Mutation checked: `disabled={!BUILD.K2.live}` → `disabled={false}` → a toggle is enabled here.
  const w = serve();
  BUILD.K2.live = false;
  const m = await mount();
  try {
    for (const t of m.all(/^deck-flag-toggle-/)) assert.equal(m.pr(t).disabled, true);
    assert.match(m.text(m.by('deck-flags-not-yet')), /Not switched on yet\./);
  } finally { BUILD.K2.live = true; await m.unmount(); w.restore(); }
});
