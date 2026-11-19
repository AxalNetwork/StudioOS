/**
 * D6888 (#6888): Eadwyn's covering-note proposal card for the statement sheet (D6217 PF-13a, PF-13h).
 *
 *   - what each answer from `POST /api/research/drafts` reads as, Eadwyn off above all: "Eadwyn is unavailable. The
 *     statement does not need it.";
 *   - the card, mounted: nothing runs on mount; the press runs once, for the date, under the card's option; the
 *     proposal offers Copy, Edit and Discard, Edit hands the text to the sheet, and nothing is accepted, stored or
 *     deleted on the Worker; when Eadwyn is off the card says so;
 *   - the rail option row.
 *
 * Runs are stubbed at `api.research`; nothing reaches the Worker.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/statement_cover_note_6888.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { RailPageProvider } from '../src/ui/railCrumbs.js';
import { api } from '../src/lib/api.js';
import { INVESTOR_RAIL_OPTIONS } from '../src/lib/railOptions/investor.js';
import StatementCoverNote from '../src/pages/portfolio/StatementCoverNote.jsx';
import {
  COVER_NOTE_NO_BOOK, COVER_NOTE_OFF, COVER_NOTE_OPTION, COVER_NOTE_SURFACE, coverNoteNotice,
} from '../src/pages/portfolio/coverNoteModel.js';

const h = React.createElement;
const err = (code, status, message = 'A sentence from the Worker.', data) => Object.assign(new Error(message), { code, status, ...(data ? { data } : {}) });

// ------------------------------------------------------------------ what an answer reads as

test('Eadwyn off, paused or unable to answer reads as the canvas sentence', () => {
  assert.equal(COVER_NOTE_OFF, 'Eadwyn is unavailable. The statement does not need it.');
  for (const e of [err('assist_off', 403), err('ai_paused', 403), err('draft_unavailable', 503), err('draft_unfaithful', 503), new Error('Failed to fetch'), null]) {
    assert.deepEqual(coverNoteNotice(e), { kind: 'off', text: COVER_NOTE_OFF, link: null }, String(e?.code));
  }
});

test('nothing to cover, a withheld draft and an empty allowance each keep their own words', () => {
  assert.deepEqual(coverNoteNotice(err('nothing_to_draft', 409)), { kind: 'nothing', text: COVER_NOTE_NO_BOOK, link: null });
  const withheld = coverNoteNotice(err('guard_blocked_output', 503, 'Eadwyn withheld this draft.', { link: { href: '/help/guard', label: 'Why' } }));
  assert.deepEqual(withheld, { kind: 'withheld', text: 'Eadwyn withheld this draft.', link: { href: '/help/guard', label: 'Why' } });
  assert.deepEqual(coverNoteNotice(err('budget_user_month', 402, 'Your AI allowance cannot cover this run.')),
    { kind: 'budget', text: 'Your AI allowance cannot cover this run.', link: null });
});

// ------------------------------------------------------------------ the card

async function mount({ run, onEdit }) {
  const saved = { ...api.research };
  const calls = [];
  api.research.zoneDraftRun = async (...a) => { calls.push(['zoneDraftRun', ...a]); return run(); };
  api.research.zoneDrafts = async (...a) => { calls.push(['zoneDrafts', ...a]); return { items: [] }; };
  api.research.zoneDraftAccept = async (...a) => { calls.push(['zoneDraftAccept', ...a]); return {}; };
  api.research.zoneDraftDiscard = async (...a) => { calls.push(['zoneDraftDiscard', ...a]); return {}; };
  const restore = installDocument();
  const copied = [];
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async (t) => { copied.push(t); } } } });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  // Microtasks only: every stub here resolves at once, so no timer (and no clock) is needed.
  const settle = () => act(async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const button = (label) => walk(container).find((n) => n.tagName?.toLowerCase() === 'button' && (n.textContent || '').trim() === label);
  const text = () => walk(container).map((n) => (n.nodeType === 3 ? (n.nodeValue ?? n.textContent ?? '') : (n.childNodes.length ? '' : n.textContent || ''))).join(' ');
  const press = async (label) => { await act(async () => { await props(button(label)).onClick(); }); await settle(); };
  await act(async () => {
    root.render(h(MemoryRouter, null, h(RailPageProvider, { role: 'investor' }, h(StatementCoverNote, { asOf: '2026-09-30', onEdit }))));
  });
  await settle();
  const done = async () => {
    await act(async () => root.unmount());
    restore();
    if (nav) Object.defineProperty(globalThis, 'navigator', nav); else delete globalThis.navigator;
    Object.assign(api.research, saved);
  };
  return { calls, copied, button, text, press, done };
}

test('the card proposes on the press, for the date, and Copy, Edit and Discard write nothing on the Worker', async () => {
  const edited = [];
  const NOTE = 'Attached is my portfolio statement as of 30 Sep 2026, gross of fees and carry.';
  const m = await mount({ run: async () => ({ item: { uid: null, body: NOTE, kept: false } }), onEdit: (t) => edited.push(t) });
  try {
    assert.deepEqual(m.calls, [], 'the card ran or read on mount');
    await m.press('Propose a covering note');
    assert.equal(m.calls.length, 1);
    const [name, surface, scope, , headers] = m.calls[0];
    assert.deepEqual([name, surface, scope], ['zoneDraftRun', COVER_NOTE_SURFACE, '2026-09-30']);
    assert.equal(decodeURIComponent(headers['X-Rail-Option']), COVER_NOTE_OPTION);
    assert.ok(m.text().includes(NOTE), 'the proposal is not shown');
    assert.ok(m.text().includes('Proposal · not in the PDF'));

    await m.press('Copy');
    assert.deepEqual(m.copied, [NOTE]);
    await m.press('Edit');
    assert.deepEqual(edited, [NOTE], 'Edit does not hand the text to the sheet');
    await m.press('Discard');
    assert.ok(!m.text().includes(NOTE), 'Discard left the proposal');
    assert.ok(m.button('Propose a covering note'), 'Discard does not return to the press');
    assert.deepEqual(m.calls.map(([n]) => n), ['zoneDraftRun'], 'Copy, Edit or Discard reached the Worker');
  } finally { await m.done(); }
});

test('when Eadwyn is off, the card says the statement does not need it, and offers no proposal', async () => {
  const m = await mount({ run: async () => { throw err('assist_off', 403, 'AI assistance is off on this page.'); } });
  try {
    await m.press('Propose a covering note');
    assert.ok(m.text().includes(COVER_NOTE_OFF), 'the off sentence is not shown');
    assert.equal(m.button('Copy'), undefined);
    assert.equal(m.button('Edit'), undefined);
    assert.deepEqual(m.calls.map(([n]) => n), ['zoneDraftRun']);
  } finally { await m.done(); }
});

// ------------------------------------------------------------------ the rail option

test('the rail option names the card on the Portfolio board, with the numbers kind and the draft handler', () => {
  const row = INVESTOR_RAIL_OPTIONS.find((o) => o.key === COVER_NOTE_OPTION);
  assert.deepEqual(row, {
    page: 'Investor · Portfolio', key: 'draft:statement-cover-note', label: 'Propose a covering note', kind: 'numbers', handler: 'draft',
    source: { file: 'pages/portfolio/StatementCoverNote.jsx', match: 'surface="portfolio/statement"' },
  });
});
