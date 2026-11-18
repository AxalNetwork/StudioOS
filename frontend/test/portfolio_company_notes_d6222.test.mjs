/**
 * D6222 (#6222) — the investor's private notes on a portfolio company, on the
 * company workspace's Overview (`/portfolio/companies/:uid`): What changed's
 * "Save as my note", and the Notes card with add, edit and delete, each note
 * with its dates; loading, none yet, Unreadable with Retry, and a failed save
 * that keeps the text. The real page is mounted against a stubbed `fetch`.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/portfolio_company_notes_d6222.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import PortfolioCompanyPage from '../src/pages/investor/PortfolioCompanyPage.jsx';
import { NOTE_SENTENCES, noteDates } from '../src/pages/portfolio/CompanyNotes.jsx';
import { whatChangedSource, whatChangedText } from '../src/pages/investor/portfolioReportsModel.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

/* ------------------------------------------------------------------ fixtures */

const fig = (key, label, unit, value) => ({ key, label, module: 'revenue-and-traction', unit, value, source: { word: 'Connector', provider: 'stripe', computed: false }, as_of: '2026-06-30', shared_from_mercury: false, typed: false, left_out: false, left_out_reason: null });
const REPORTS = [
  { uid: 'r1', period: { label: '2026-Q1', start: '2026-01-01', end: '2026-03-31' }, sent_at: '2026-05-10', revision: 1, corrected: false, figures: [fig('mrr', 'MRR', 'usd', 31200)] },
  { uid: 'r2', period: { label: '2026-Q2', start: '2026-04-01', end: '2026-06-30' }, sent_at: '2026-08-18', revision: 1, corrected: false, figures: [fig('mrr', 'MRR', 'usd', 44100)] },
];
const ACME = { uid: 'p-abc', name: 'Acme Robotics', duties: [], periods: [] };
const POSITION = { project_id: 4, project: { uid: 'p-abc', name: 'Acme Robotics', stage: 'Seed', sector: 'Robotics' }, total_invested: 250000, rounds: 1, latest_ownership_pct: 6.2, latest_round: 'Seed', first_date: '2025-06-15', fmv: null, multiple: null, unmarked: true };
const NOTE = { uid: 'n1', body: 'Hiring is behind plan.', source: null, created_at: '2026-10-02T09:00:00.000Z', updated_at: '2026-10-02T09:00:00.000Z', edited: false };
const NOTES_PATH = '/portfolio-notes/companies/p-abc';
const ROUTES = (over = {}) => ({
  '/positions': { items: [POSITION] },
  '/reporting/companies/p-abc': { ok: true, can_act: true, company: ACME },
  '/reporting/companies/p-abc/figures': { ok: true, reports: REPORTS },
  '/portfolio/health/p-abc': { latest: null, history: [] },
  '/portfolio-support': { entries: [], companies: [], page: { next_offset: null }, page_state: 'recorded', totals: {} },
  [NOTES_PATH]: { ok: true, items: [NOTE], can_write: true, write_refusal: null },
  ...over,
});

/* ------------------------------------------------------------------ harness */

async function at(routes, url = '/portfolio/companies/p-abc') {
  const restore = installDocument();
  const prev = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (u, opts = {}) => {
    const path = String(u).replace(/^.*\/api/, '');
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    asked.push({ path, method, body });
    const hit = routes[`${method} ${path}`] ?? routes[path];
    const out = typeof hit === 'function' ? await hit(path, body) : hit;
    if (out && out.__status) return response({ error: out.error, message: out.message }, out.__status);
    return response(out ?? {});
  };
  localStorage.setItem('user', JSON.stringify({ id: 6, role: 'investor', name: 'Ivy' }));
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  const flush = async () => { for (let i = 0; i < 16; i += 1) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); }); };
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null,
    h(Route, { path: '/portfolio/companies/:uid', element: h(PortfolioCompanyPage) })))));
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(document.body).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : (n.childNodes || []).map(txt).join(' ') || n.textContent || '');
  return {
    asked, by, has: (id) => !!by(id), props: (id) => pr(by(id)),
    text: (id) => txt(by(id)).replace(/\s+/g, ' ').trim(),
    writes: () => asked.filter((a) => a.method !== 'GET').map((a) => [a.method, a.path, a.body]),
    click: async (id) => { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { await pr(n).onClick({ preventDefault() {} }); }); await flush(); },
    type: async (id, value) => { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { pr(n).onChange({ target: { value } }); }); await flush(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = prev; localStorage.removeItem('user'); restore(); },
  };
}

/* ------------------------------------------------------------------ tests */

test('the model: What changed names the two reports it compared, and its text keeps each change’s source and periods', () => {
  assert.deepEqual(whatChangedSource(REPORTS.slice().reverse()), { source: 'what_changed', from_report_uid: 'r1', to_report_uid: 'r2' });
  assert.equal(whatChangedSource(REPORTS.slice(0, 1)), null, 'one report compares nothing');
  assert.equal(whatChangedText([{ text: 'MRR $1 → $2', sub: 'Stripe · Q1 2026 → Q2 2026' }, { text: 'The Sep 2026 report has not arrived', sub: '' }]),
    'MRR $1 → $2 (Stripe · Q1 2026 → Q2 2026)\nThe Sep 2026 report has not arrived');
  assert.equal(noteDates(NOTE), 'Written 2 Oct 2026');
  assert.equal(noteDates({ ...NOTE, edited: true, updated_at: '2026-11-03T08:00:00Z' }), 'Written 2 Oct 2026 · edited 3 Nov 2026');
});

test('every refusal code the notes router gives has a sentence on the page', () => {
  const src = readFileSync(new URL('../../cloudflare-worker/src/routes/portfolio_notes.ts', import.meta.url), 'utf8');
  const table = /export const NOTE_REFUSALS = \{([\s\S]*?)\} as const;/.exec(src);
  assert.ok(table, 'the router keeps its refusal table');
  const codes = [...table[1].matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]);
  assert.ok(codes.length >= 8, `found ${codes.length} codes`);
  for (const code of codes) assert.ok(NOTE_SENTENCES[code], `notes refusal code ${code} has no sentence`);
});

test('the placeholder is gone; Save as my note writes What changed with its two reports, and the note is listed with its date', async () => {
  const v = await at(ROUTES({
    [`POST ${NOTES_PATH}`]: (p, body) => ({ ok: true, note: { uid: 'n2', body: body.body, source: { kind: 'what_changed', from_report_uid: body.from_report_uid, to_report_uid: body.to_report_uid }, created_at: '2026-11-17T10:00:00.000Z', updated_at: '2026-11-17T10:00:00.000Z', edited: false } }),
  }));
  try {
    assert.ok(!v.has('company-what-changed-note'));
    assert.doesNotMatch(v.text('company-what-changed'), /waits for a notes store/);
    assert.match(v.text('company-note-dates-n1'), /^Written 2 Oct 2026$/);
    await v.click('button-save-what-changed');
    const [[method, path, body]] = v.writes();
    assert.equal(`${method} ${path}`, `POST ${NOTES_PATH}`);
    assert.equal(body.source, 'what_changed');
    assert.equal(body.from_report_uid, 'r1');
    assert.equal(body.to_report_uid, 'r2');
    assert.match(body.body, /^MRR \$31,200 → \$44,100 \(.*Q1 2026 → Q2 2026\)$/);
    assert.match(v.text('company-what-changed-save-status'), /Saved to Your notes below/);
    assert.match(v.text('company-note-n2'), /MRR \$31,200 → \$44,100.*Written 17 Nov 2026 · from What changed/);
    assert.ok(v.has('company-note-n1'), 'the older note stays');
  } finally { await v.close(); }
});

test('a failed What changed save keeps the text in the Notes box with the sentence for its code', async () => {
  const v = await at(ROUTES({ [`POST ${NOTES_PATH}`]: { __status: 409, error: 'source_not_received', message: 'raw worker words' } }));
  try {
    await v.click('button-save-what-changed');
    assert.match(v.text('company-what-changed-save-status'), /Not saved/);
    assert.match(v.props('input-company-note-new').value, /^MRR \$31,200 → \$44,100/);
    assert.equal(v.text('company-note-add-error'), NOTE_SENTENCES.source_not_received);
  } finally { await v.close(); }
});

test('add, edit and delete a note; a failed add or edit keeps the text', async () => {
  let fail = true;
  const v = await at(ROUTES({
    [`POST ${NOTES_PATH}`]: (p, body) => (fail ? { __status: 503, error: 'note_write_failed', message: 'x' }
      : { ok: true, note: { uid: 'n3', body: body.body, source: null, created_at: '2026-11-17T10:00:00Z', updated_at: '2026-11-17T10:00:00Z', edited: false } }),
    'PUT /portfolio-notes/n1': (p, body) => (fail ? { __status: 404, error: 'note_not_found', message: 'x' }
      : { ok: true, note: { ...NOTE, body: body.body, updated_at: '2026-11-17T11:00:00Z', edited: true } }),
    'DELETE /portfolio-notes/n1': { ok: true, deleted: true },
  }));
  try {
    await v.type('input-company-note-new', 'Board seat next round?');
    await v.click('button-add-company-note');
    assert.equal(v.text('company-note-add-error'), NOTE_SENTENCES.note_write_failed);
    assert.equal(v.props('input-company-note-new').value, 'Board seat next round?', 'the failed save keeps the text');
    fail = false;
    await v.click('button-add-company-note');
    assert.deepEqual(v.writes().at(-1), ['POST', NOTES_PATH, { body: 'Board seat next round?' }]);
    assert.equal(v.props('input-company-note-new').value, '');
    assert.match(v.text('company-note-n3'), /Board seat next round\?.*Written 17 Nov 2026/);

    fail = true;
    await v.click('button-edit-company-note-n1');
    await v.type('input-company-note-n1', 'Hiring caught up.');
    await v.click('button-save-company-note-n1');
    assert.equal(v.text('company-note-error-n1'), NOTE_SENTENCES.note_not_found);
    assert.equal(v.props('input-company-note-n1').value, 'Hiring caught up.', 'the failed edit keeps the text');
    fail = false;
    await v.click('button-save-company-note-n1');
    assert.deepEqual(v.writes().at(-1), ['PUT', '/portfolio-notes/n1', { body: 'Hiring caught up.' }]);
    assert.match(v.text('company-note-n1'), /Hiring caught up\. Written 2 Oct 2026 · edited 17 Nov 2026/);

    await v.click('button-delete-company-note-n1');
    assert.ok(v.has('company-note-confirm-n1'), 'delete asks in the page first');
    assert.equal(v.writes().filter(([m]) => m === 'DELETE').length, 0);
    await v.click('button-confirm-delete-company-note-n1');
    assert.deepEqual(v.writes().at(-1), ['DELETE', '/portfolio-notes/n1', undefined]);
    assert.ok(!v.has('company-note-n1'));
  } finally { await v.close(); }
});

test('none yet, Unreadable with a Retry (never "no notes"), and a support session that cannot write', async () => {
  const none = await at(ROUTES({ [NOTES_PATH]: { ok: true, items: [], can_write: true, write_refusal: null } }));
  try { assert.match(none.text('company-notes-none'), /no notes on this company yet/); } finally { await none.close(); }

  let down = true;
  const v = await at(ROUTES({ [NOTES_PATH]: () => (down ? { __status: 503, error: 'notes_unreadable', message: 'x' } : { ok: true, items: [NOTE], can_write: true }) }));
  try {
    assert.match(v.text('company-notes-unreadable'), /Your notes could not be read.*not a claim that you have none/);
    assert.ok(!v.has('company-notes-none'), 'a failed read is not "no notes"');
    assert.ok(!v.has('button-save-what-changed'), 'nothing is saved into a store that could not be read');
    down = false;
    await v.click('button-retry-company-notes');
    assert.ok(v.has('company-note-n1'));
    assert.ok(v.has('button-save-what-changed'));
  } finally { await v.close(); }

  const support = await at(ROUTES({ [NOTES_PATH]: { ok: true, items: [NOTE], can_write: false, write_refusal: 'A support session cannot write an investor’s notes.' } }));
  try {
    assert.ok(support.has('company-note-n1'));
    assert.ok(!support.has('company-note-add') && !support.has('button-edit-company-note-n1') && !support.has('button-save-what-changed'));
    assert.match(support.text('company-notes-readonly'), /support session cannot write/);
  } finally { await support.close(); }
});
