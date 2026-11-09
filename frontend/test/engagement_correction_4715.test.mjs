/**
 * #4715 (D4715) — correcting a signed engagement's terms from Practice ·
 * Engagements: only the changed terms, a required reason and the version the
 * form was opened on are sent, and the history reads each correction with its
 * before, after and reason.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/engagement_correction_4715.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { correctionBody, correctionForm, historyLine } from '../src/pages/advisor/practice/engagementCorrection.js';

const h = React.createElement;
const json = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const SIGNED = { id: 3, client_name: 'Synthetic Co', lane: 'signed', shape: 'retainer', cycles: 1, outcome: 'active', started_at: '2026-10-01',
  scope_label: 'Two sessions a month', scope_includes: 'Two sessions', scope_excludes: null, amount_cents: 500000, term_ends_at: null,
  updated_at: '2026-10-01T09:00:00.000Z', founder_user_id: null };

test('correctionBody: only the changed terms, the reason and the version read', () => {
  const form = { ...correctionForm(SIGNED), amount: '4500', reason: '  Synthetic: fee typed wrong ' };
  assert.deepEqual(correctionBody(SIGNED, form), { body: { amount_cents: 450000, correction_reason: 'Synthetic: fee typed wrong', expected_updated_at: SIGNED.updated_at } });
  assert.match(correctionBody(SIGNED, { ...correctionForm(SIGNED), amount: '4500' }).error, /Say why/);
  assert.match(correctionBody(SIGNED, { ...correctionForm(SIGNED), reason: 'x' }).error, /Nothing in the terms has changed/);
  assert.ok(correctionBody(SIGNED, { ...correctionForm(SIGNED), amount: '12,50,0', reason: 'x' }).error, 'an unreadable amount is refused');
  assert.deepEqual(correctionBody(SIGNED, { ...correctionForm(SIGNED), scope_excludes: 'Not in scope: hiring', reason: 'x' }).body.scope_excludes, 'Not in scope: hiring');
});

test('historyLine: a correction reads its fields before and after, and its reason', () => {
  assert.equal(historyLine({ kind: 'signed', created_at: '2026-10-01T09:00:00Z' }), 'Signed · 2026-10-01');
  const line = historyLine({ kind: 'corrected', created_at: '2026-10-05T09:00:00Z', note: 'Synthetic: fee typed wrong',
    changes: [{ field: 'amount_cents', from: 500000, to: 450000 }, { field: 'scope_excludes', from: null, to: 'Not in scope: hiring' }] });
  assert.match(line, /^Terms corrected · 2026-10-05 · Amount: \$5,000(\.00)? → \$4,500(\.00)?; Not in scope: not recorded → Not in scope: hiring · Reason: Synthetic: fee typed wrong$/);
});

async function mount(handle) {
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify({ id: 90, role: 'advisor', name: 'Ada' }));
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const seen = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u), 'http://x');
    const call = { method: (init.method || 'GET').toUpperCase(), path: url.pathname, body: init.body ? JSON.parse(init.body) : null };
    seen.push(call);
    return handle(call);
  };
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const { default: EngagementsZone } = await import('../src/pages/advisor/practice/EngagementsZone.jsx');
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => root.render(h(MemoryRouter, null, h(EngagementsZone))));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  const named = (form, name) => walk(form).find((n) => props(n)?.name === name);
  return {
    seen, settle, text: () => textOf(document.body), byTestId, textOf,
    async press(label) { const b = walk(document.body).find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === label); assert.ok(b, `no button ${label}`); await act(async () => { props(b).onClick({ preventDefault() {} }); }); await settle(); },
    async type(form, name, value) { const n = named(form, name); assert.ok(n, `no field ${name}`); await act(async () => { props(n).onChange({ target: { value } }); }); },
    async submit(form) { await act(async () => { props(form).onSubmit({ preventDefault() {} }); }); await settle(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

test('mounted Engagements: a signed card corrects its terms with a reason, and the history shows it', async () => {
  let row = { ...SIGNED };
  const events = [{ uid: 'ev-1', kind: 'signed', created_at: '2026-10-01T09:00:00Z' }];
  const m = await mount(async (c) => {
    if (c.path === '/api/advisors/me/engagements') return json({ items: [row], totals: { active: 1 } });
    if (c.path === '/api/advisors/me/bookings') return json({ items: [] });
    if (c.path === '/api/advisors/me/engagements/3' && c.method === 'PATCH') {
      row = { ...row, amount_cents: c.body.amount_cents, updated_at: '2026-10-05T09:00:00.000Z' };
      events.push({ uid: 'ev-2', kind: 'corrected', created_at: '2026-10-05T09:00:00Z', note: c.body.correction_reason, changes: [{ field: 'amount_cents', from: 500000, to: c.body.amount_cents }] });
      return json(row);
    }
    if (c.path === '/api/advisors/me/engagements/3/events') return json({ items: events });
    return json({});
  });
  try {
    await m.press('Correct terms');
    const form = m.byTestId('correct-form-3');
    assert.ok(form, 'the correction form opens on the signed card');
    await m.type(form, 'amount', '4500');
    await m.submit(form);
    assert.equal(m.seen.filter((c) => c.method === 'PATCH').length, 0, 'no reason, no request');
    assert.match(m.text(), /Say why the signed terms are being corrected/);
    await m.type(m.byTestId('correct-form-3'), 'reason', 'Synthetic: fee typed wrong');
    await m.submit(m.byTestId('correct-form-3'));
    const patch = m.seen.find((c) => c.method === 'PATCH');
    assert.deepEqual(patch.body, { amount_cents: 450000, correction_reason: 'Synthetic: fee typed wrong', expected_updated_at: SIGNED.updated_at });
    assert.equal(m.byTestId('correct-form-3'), undefined, 'the form closes once recorded');
    await m.press('History');
    const text = m.textOf(m.byTestId('history-3'));
    assert.match(text, /Signed · 2026-10-01/);
    assert.match(text, /Terms corrected · 2026-10-05 · Amount: .* → .*· Reason: Synthetic: fee typed wrong/);
  } finally { await m.close(); }
});
