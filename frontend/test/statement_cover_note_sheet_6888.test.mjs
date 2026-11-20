/**
 * D6888 part 1 (#6888, canvas D6217 PF-13a and PF-13h): Eadwyn's covering-note proposal mounted in the Statement
 * sheet's rail, for the sheet's chosen quarter-end.
 *
 *   - nothing runs on mount: no draft run and no `/api/research` read until the investor presses Propose;
 *   - the press drafts for the chosen date, and choosing another date drafts for that one;
 *   - Edit ticks "Include as a cover note" and puts the proposal in that box, where the investor edits it; the PDF
 *     takes the note from the box only (edited text in, unticked out);
 *   - Discard removes the proposal, calls nothing and leaves the box as it was;
 *   - when Eadwyn is off the card reads "Eadwyn is unavailable. The statement does not need it." and offers no Edit;
 *   - at 390 the rail is a collapsible card (its toggle names its state).
 *
 * The sheet is the real one against a stubbed `fetch`; the draft run is stubbed at `api.research`.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/statement_cover_note_sheet_6888.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import StatementSheet from '../src/pages/portfolio/StatementSheet.jsx';
import { COVER_NOTE_OFF, COVER_NOTE_RUN, COVER_NOTE_SURFACE } from '../src/pages/portfolio/coverNoteModel.js';

const h = React.createElement;
const ok = (value) => ({ state: 'ok', value });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const NOTE = 'Attached is my portfolio statement as of 30 Sep 2026, gross of fees and carry, in USD.';

const COMPLIANCE = { cadence: 'quarterly', as_of: '2026-11-14', period_until: '2026-09-30', period_complete: true, companies: [] };
const POS = {
  items: [
    { project_id: 1, project: { name: 'Company A', sector: 'Robotics', stage: 'Series A' }, total_invested: 2000000, rounds: 1, latest_round: 'Series A', vintage: 2025, latest_date: '2025-06-01', fmv: 5200000, multiple: 2.6, mark_as_of: '2026-09-30', mark_basis: 'round_price', unmarked: false, mark_unavailable_reason: null },
  ],
  scope: { rule: 'confirmed_commitment', text: 'Companies where you hold a confirmed commitment.' },
  fund_scope: null,
};
const AT = (date) => ({
  as_of: date, basis: 'gross', nav: 5200000, paid_in: 2000000, distributed: 0,
  returns: { tvpi: { state: 'computed', value: 2.6 }, dpi: { state: 'computed', value: 0 }, rvpi: { state: 'computed', value: 2.6 }, irr: { state: 'computed', value: 0.4 } },
  position_count: 1, unmarked_position_count: 0, unusable_mark_count: 0, mark_coverage: 1,
});

async function mountSheet({ run }) {
  const restore = installDocument();
  const realFetch = globalThis.fetch;
  const fetched = [];
  globalThis.fetch = async (u) => {
    const url = new URL(String(u), 'http://localhost');
    fetched.push(url.pathname);
    if (url.pathname === '/api/positions/analytics') return json(AT(url.searchParams.get('as_of')));
    if (url.pathname === '/api/positions') return json(POS);
    return json({});
  };
  const saved = { ...api.research };
  const calls = [];
  api.research.zoneDraftRun = async (...a) => { calls.push(['zoneDraftRun', ...a]); return run(); };
  api.research.zoneDrafts = async (...a) => { calls.push(['zoneDrafts', ...a]); return { items: [] }; };
  api.research.zoneDraftAccept = async (...a) => { calls.push(['zoneDraftAccept', ...a]); return {}; };
  api.research.zoneDraftDiscard = async (...a) => { calls.push(['zoneDraftDiscard', ...a]); return {}; };
  const exported = [];
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(box); };
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const button = (label) => nodes().find((n) => n.tagName?.toLowerCase() === 'button' && (n.textContent || '').trim() === label);
  const textOf = (n) => (n.nodeType === 3 ? n.textContent : (n.childNodes || []).map(textOf).join('') || n.textContent || '');
  // Microtasks and setImmediate only: no timer and no clock.
  const settle = async () => { for (let i = 0; i < 12; i += 1) await act(async () => { await new Promise((r) => setImmediate(r)); }); };
  await act(async () => root.render(h(MemoryRouter, null, h('div', { className: 'pf-shell' }, h(StatementSheet, {
    positions: ok(POS), compliance: ok(COMPLIANCE), investor: 'Investor A', from: 'Overview', onClose: () => {},
    exporter: async (inp) => { exported.push(inp); return { pages: 5 }; },
  })))));
  await settle();
  return {
    calls, fetched, exported, byId, props, button, settle,
    text: (id) => (byId(id) ? textOf(byId(id)) : ''),
    async press(label) { await act(async () => { await props(button(label)).onClick({ preventDefault() {} }); }); await settle(); },
    async click(id) { await act(async () => { await props(byId(id)).onClick({ preventDefault() {} }); }); await settle(); },
    async change(id, value) { await act(async () => { props(byId(id)).onChange({ target: { value, checked: value } }); }); await settle(); },
    async pick(date) {
      const radio = byId(`statement-date-${date}`).childNodes.find((n) => n.tagName === 'INPUT');
      await act(async () => { props(radio).onChange({}); });
      await settle();
    },
    async close() {
      await act(async () => root.unmount());
      globalThis.fetch = realFetch;
      Object.assign(api.research, saved);
      restore();
    },
  };
}

const proposes = () => async () => ({ item: { uid: null, body: NOTE, kept: false } });

test('the card is in the sheet\'s rail for the chosen date, and nothing runs on mount', async () => {
  const s = await mountSheet({ run: proposes() });
  try {
    assert.ok(s.byId('statement-eadwyn'), 'the sheet does not mount Eadwyn\'s rail');
    assert.ok(s.byId('statement-cover-note'), 'the rail does not hold the covering-note card');
    assert.match(s.props(s.byId('statement-sheet-layer')).className, /\bhas-rail\b/, 'the sheet does not make room for the rail');
    assert.deepEqual(s.calls, [], 'the card ran or read on mount');
    assert.ok(!s.fetched.some((p) => p.startsWith('/api/research')), 'a research read on mount');
    assert.equal(s.props(s.byId('checkbox-statement-cover')).checked, false);
    assert.ok(s.button(COVER_NOTE_RUN), 'no press to draft');
  } finally { await s.close(); }
});

test('the press drafts for the chosen quarter-end, and another date drafts for that one', async () => {
  const s = await mountSheet({ run: proposes() });
  try {
    await s.press(COVER_NOTE_RUN);
    assert.deepEqual(s.calls.map((c) => c.slice(0, 3)), [['zoneDraftRun', COVER_NOTE_SURFACE, '2026-09-30']]);
    await s.pick('2026-06-30');
    assert.ok(!s.text('statement-cover-note').includes(NOTE), 'the proposal outlived its date');
    await s.press(COVER_NOTE_RUN);
    assert.deepEqual(s.calls.map((c) => c[2]), ['2026-09-30', '2026-06-30']);
  } finally { await s.close(); }
});

test('Edit ticks "Include as a cover note" with the proposal in the box; the PDF takes the note from the box only', async () => {
  const s = await mountSheet({ run: proposes() });
  try {
    await s.press(COVER_NOTE_RUN);
    assert.ok(s.text('statement-cover-note').includes(NOTE));
    assert.equal(s.byId('input-statement-cover'), undefined, 'the box is open before Edit');
    await s.press('Edit');
    assert.equal(s.props(s.byId('checkbox-statement-cover')).checked, true, 'Edit does not tick the box');
    assert.equal(s.props(s.byId('input-statement-cover')).value, NOTE, 'Edit does not put the proposal in the box');
    // The investor edits it there, and the PDF prints the edited words.
    await s.change('input-statement-cover', `${NOTE} Call me with questions.`);
    await s.click('button-statement-download');
    assert.equal(s.exported.length, 1);
    assert.equal(s.exported[0].coverNote, `${NOTE} Call me with questions.`);
    assert.deepEqual(s.calls.map(([n]) => n), ['zoneDraftRun'], 'Edit or Download reached the Worker\'s drafts');
  } finally { await s.close(); }
  const t = await mountSheet({ run: proposes() });
  try {
    await t.press(COVER_NOTE_RUN);
    await t.press('Edit');
    await t.change('checkbox-statement-cover', false);
    await t.click('button-statement-download');
    assert.equal(t.exported[0].coverNote, null, 'an unticked box still sent the proposal');
  } finally { await t.close(); }
});

test('Discard removes the proposal, calls nothing and leaves the cover-note box as it was', async () => {
  const s = await mountSheet({ run: proposes() });
  try {
    await s.press(COVER_NOTE_RUN);
    await s.press('Discard');
    assert.ok(!s.text('statement-cover-note').includes(NOTE), 'Discard left the proposal');
    assert.ok(s.button(COVER_NOTE_RUN), 'Discard does not return to the press');
    assert.equal(s.props(s.byId('checkbox-statement-cover')).checked, false, 'Discard ticked the box');
    assert.deepEqual(s.calls.map(([n]) => n), ['zoneDraftRun'], 'Discard reached the Worker');
    assert.ok(!s.fetched.some((p) => p.startsWith('/api/research')));
    await s.click('button-statement-download');
    assert.equal(s.exported[0].coverNote, null, 'a discarded proposal reached the PDF');
  } finally { await s.close(); }
});

test('when Eadwyn is off the card says the statement does not need it, and the box is untouched', async () => {
  const s = await mountSheet({ run: async () => { throw Object.assign(new Error('AI assistance is off on this page.'), { code: 'assist_off', status: 403 }); } });
  try {
    await s.press(COVER_NOTE_RUN);
    assert.ok(s.text('statement-cover-note').includes(COVER_NOTE_OFF), 'the off sentence is not shown');
    assert.equal(s.button('Edit'), undefined);
    assert.equal(s.props(s.byId('checkbox-statement-cover')).checked, false);
    assert.ok(s.byId('button-statement-download'), 'the statement is still made without Eadwyn');
  } finally { await s.close(); }
});

test('at 390 the rail is a collapsible card; on a desktop it is the 320px column beside the sheet', async () => {
  const s = await mountSheet({ run: proposes() });
  try {
    assert.equal(s.props(s.byId('button-statement-eadwyn-toggle'))['aria-expanded'], 'false');
    await s.click('button-statement-eadwyn-toggle');
    assert.equal(s.props(s.byId('button-statement-eadwyn-toggle'))['aria-expanded'], 'true');
    assert.match(s.props(s.byId('statement-eadwyn')).className, /\bis-open\b/);
  } finally { await s.close(); }
  const css = readFileSync(new URL('../src/pages/portfolio/statement.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(min-width:641px\)\{[^}]*\.pst-layer\.has-rail \.pst-sheet\{margin-right:320px\}/);
  assert.match(css, /@media \(max-width:640px\)\{[\s\S]*\.pst-rail:not\(\.is-open\) \.pst-rail-body\{display:none\}/);
});
