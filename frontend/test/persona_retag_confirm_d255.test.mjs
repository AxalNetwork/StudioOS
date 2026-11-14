/**
 * D255 — a re-tag asks before it acts, and a cancelled or failed one leaves
 * nothing saved. Since D1005 (#2820) that is SEG4's Move dialog
 * (`pages/admin/segments/MoveDialog.jsx`), which replaced the Admin Console's
 * PersonasPanel: its `<select>` fired the write from `onChange` behind a
 * browser `confirm()`, and had to reset its own uncontrolled DOM value when
 * the confirm was cancelled. The dialog is in the page (never a browser
 * pop-up), its segment `<select>` is controlled, and nothing is written until
 * its own Move button.
 *
 * Mounted on a stubbed fetch, on the minimal DOM the other mounted tests use.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/persona_retag_confirm_d255.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import MoveDialog from '../src/pages/admin/segments/MoveDialog.jsx';

const h = React.createElement;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const SEGMENTS = { segments: [
  { key: 'founder_new', name: 'Founder — New Venture', profile: 'founder', status: 'active' },
  { key: 'founder_scale', name: 'Founder — Scaling', profile: 'founder', status: 'active' },
] };
const MEMBER = { user_id: 7, name: 'Fay Example', profile: 'founder', segment: { key: 'founder_new', name: 'Founder — New Venture' } };

function stub(move) {
  const original = globalThis.fetch;
  const writes = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(String(url), 'http://x').pathname;
    if ((init.method || 'GET').toUpperCase() === 'POST') { writes.push({ path, body: JSON.parse(init.body) }); return move(); }
    return path === '/api/personas/segments' ? json(SEGMENTS) : json({}, 404);
  };
  return { writes, restore() { globalThis.fetch = original; } };
}

async function mount(handlers) {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, null, h(MoveDialog, { members: [MEMBER], ...handlers }))); });
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const node = (id) => { const n = walk(container).find((x) => props(x)?.['data-testid'] === id); assert.ok(n, `no ${id}`); return n; };
  return {
    has: (id) => walk(container).some((x) => props(x)?.['data-testid'] === id),
    of: (id) => textOf(node(id)),
    value: (id) => props(node(id)).value,
    async pick(value) { await act(async () => props(node('seg-move-dialog-target')).onChange({ target: { value } })); await settle(); },
    async click(id) { await act(async () => props(node(id)).onClick()); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

test('choosing a segment writes nothing; only the dialog\'s Move does, once, with that segment', async () => {
  // Mutation checked: the write fired from the select's onChange, as the console's did.
  const s = stub(() => json({ results: [{ user_id: 7, outcome: 'moved' }], moved: 1 }));
  let moved = null;
  const v = await mount({ onClose() {}, onMoved: (reply, target) => { moved = [reply.moved, target.key]; } });
  try {
    await v.pick('founder_scale');
    assert.equal(s.writes.length, 0, 'choosing a segment re-tagged the member');
    assert.match(v.of('seg-move-dialog-changes'), /Logged under your name\./, 'it says what changes before the write');
    await v.click('seg-move-dialog-go');
    assert.deepEqual(s.writes, [{ path: '/api/personas/admin/members/move', body: { user_ids: [7], persona_id: 'founder_scale' } }]);
    assert.deepEqual(moved, [1, 'founder_scale']);
  } finally { await v.unmount(); s.restore(); }
});

test('Cancel writes nothing and closes', async () => {
  // Mutation checked: Cancel running the move.
  const s = stub(() => json({ results: [], moved: 0 }));
  let closed = 0;
  const v = await mount({ onClose: () => { closed += 1; }, onMoved() { assert.fail('moved on Cancel'); } });
  try {
    await v.pick('founder_scale');
    await v.click('seg-move-dialog-cancel');
    assert.deepEqual([s.writes.length, closed], [0, 1]);
  } finally { await v.unmount(); s.restore(); }
});

test('a failed write stays in the dialog, says nothing changed, and keeps the choice to try again', async () => {
  // Mutations checked: a refusal reported as moved; the choice reset so Move cannot be pressed again.
  const s = stub(() => json({ detail: 'The move did not go through. Nothing changed. Try again.' }, 503));
  const v = await mount({ onClose() {}, onMoved() { assert.fail('a refused move reported as moved'); } });
  try {
    await v.pick('founder_scale');
    await v.click('seg-move-dialog-go');
    assert.match(v.of('seg-move-dialog-refusal'), /Nothing changed\. Try again\./);
    assert.equal(v.value('seg-move-dialog-target'), 'founder_scale', 'the select is controlled and keeps the choice');
    assert.ok(v.has('seg-move-dialog-go'));
  } finally { await v.unmount(); s.restore(); }
});

test('no browser confirm anywhere in a re-tag, and the console\'s panel is gone', () => {
  const src = readFileSync(resolve(process.cwd(), 'frontend/src/pages/admin/segments/MoveDialog.jsx'), 'utf8');
  assert.ok(!/\b(?:window\.)?(confirm|alert)\(/.test(src));
  assert.match(src, /value=\{key\}/, 'the segment select is controlled');
  assert.throws(() => readFileSync(resolve(process.cwd(), 'frontend/src/pages/admin/consoles/PersonasConsole.jsx')), /ENOENT/);
});
