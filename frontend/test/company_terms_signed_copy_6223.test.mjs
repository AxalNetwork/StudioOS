// D6223 (#6223) — Company Terms: the investor opens the signed document
// behind each duty. The Worker gives each duty `source.signed_copy`
// (`{ state, envelope_id }`); the document pill downloads the signed copy
// through the existing scoped `GET /api/legal/esign/:id/document` only when
// the state is `available`. A template duty keeps a plain pill and says no
// signed copy is recorded; a copy the investor may not open reads as not
// available; a failed lookup says Unavailable (state `unreadable`, D5129); a failed download says so and
// the page does not navigate.
//
// Mutation checked, each both ways (fails with the mutation, passes without):
//   - `available` with a missing or bad id still drawn as a link → the model test;
//   - every state other than available drawn as one sentence → the link-absent test;
//   - a signed duty with no `signed_copy` read as `not_signed` → the model test;
//   - the download calling a different envelope id → the link-present, download-failed and wiring tests;
//   - a failed download swallowed (no message) → the download-failed test;
//   - the plain pill replaced by the button whatever the state → the link-absent test.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/company_terms_signed_copy_6223.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { TermsCard } from '../src/pages/investor/CompanyReports.jsx';
import { TERMS_COPY_WORDS, termsCopy, termsRows } from '../src/pages/investor/portfolioReportsModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body), blob: async () => new Blob(['%PDF-1.4']) });

const duty = (uid, source) => ({ uid, kind: 'quarterly_kpi', title: 'Quarterly KPI report', cadence: 'quarterly', due_rule: 'after_end', due_days: 45, required_figures: [], defaulted: [], holding: { route: 'direct' }, source });
const COMPANY = {
  uid: 'p-abc', name: 'Acme Robotics',
  duties: [
    duty('d-open', { document: 'voting_rights', clause: '§1.1(b)', kind: 'signed_envelope', signed: true, signed_copy: { state: 'available', envelope_id: 501 } }),
    duty('d-tpl', { document: 'term_sheet', clause: '§2.2', kind: 'closing_template', signed: false, signed_copy: { state: 'not_signed', envelope_id: null } }),
    duty('d-shut', { document: 'voting_rights', clause: '§1.1(c)', kind: 'signed_envelope', signed: true, signed_copy: { state: 'not_available', envelope_id: null } }),
    duty('d-unread', { document: 'voting_rights', clause: '§1.1(d)', kind: 'signed_envelope', signed: true, signed_copy: { state: 'unreadable', envelope_id: null } }),
  ],
  periods: [],
};

test('the model: only `available` with a positive whole id opens; every other state says why in its own words', () => {
  assert.deepEqual(termsCopy({ signed: true, signed_copy: { state: 'available', envelope_id: 501 } }), { state: 'available', envelopeId: 501 });
  for (const bad of [null, 0, -3, 1.5, 'x', undefined]) {
    assert.deepEqual(termsCopy({ signed: true, signed_copy: { state: 'available', envelope_id: bad } }), { state: 'not_recorded', envelopeId: null }, String(bad));
  }
  for (const state of ['not_signed', 'not_available', 'unreadable']) {
    assert.deepEqual(termsCopy({ signed: true, signed_copy: { state, envelope_id: 9 } }), { state, envelopeId: null }, state);
  }
  assert.deepEqual(termsCopy({ signed: true }), { state: 'not_recorded', envelopeId: null }, 'a signed duty the read says nothing about is Not recorded');
  assert.deepEqual(termsCopy({ signed: false }), { state: 'not_signed', envelopeId: null });
  assert.equal(new Set(Object.values(TERMS_COPY_WORDS)).size, Object.keys(TERMS_COPY_WORDS).length, 'each state has its own sentence');
  assert.match(TERMS_COPY_WORDS.unreadable, /^Unavailable/, 'a failed read says Unavailable on screen (D5129)');
  assert.match(TERMS_COPY_WORDS.not_recorded, /^Not recorded/);
  assert.deepEqual(termsRows(COMPANY).map((r) => r.copy.state), ['available', 'not_signed', 'not_available', 'unreadable']);
});

async function mount(routes = {}) {
  const restore = installDocument();
  const prev = { fetch: globalThis.fetch, create: URL.createObjectURL, revoke: URL.revokeObjectURL, open: globalThis.open };
  const asked = [];
  const saved = [];
  const opened = [];
  URL.createObjectURL = () => 'blob:terms';
  URL.revokeObjectURL = () => {};
  globalThis.open = (...a) => { opened.push(a); return null; };
  const createElement = document.createElement.bind(document);
  document.createElement = (tag) => {
    const n = createElement(tag);
    if (String(tag).toLowerCase() === 'a') Object.assign(n, { click() { saved.push(n.download); }, remove() {} });
    return n;
  };
  globalThis.fetch = async (u) => {
    const path = String(u).replace(/^.*\/api/, '');
    asked.push(path);
    const hit = routes[path];
    if (hit instanceof Error) return response({ detail: hit.message }, Number(hit.status) || 500);
    return response(hit ?? {});
  };
  localStorage.setItem('user', JSON.stringify({ id: 6, role: 'investor', name: 'Ivy' }));
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  const flush = () => act(async () => { for (let i = 0; i < 16; i += 1) await new Promise((r) => setImmediate(r)); });
  await act(async () => root.render(h(TermsCard, { company: COMPANY })));
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(document.body).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : (n.childNodes || []).map(txt).join(' ') || n.textContent || '');
  return {
    asked, saved, opened, has: (id) => !!by(id), tag: (id) => String(by(id)?.tagName || by(id)?.nodeName || '').toLowerCase(),
    text: (id) => txt(by(id)).replace(/\s+/g, ' ').trim(),
    click: async (id) => { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { await pr(n).onClick({ preventDefault() {} }); }); await flush(); },
    async close() {
      await act(async () => root.unmount());
      globalThis.fetch = prev.fetch; globalThis.open = prev.open;
      URL.createObjectURL = prev.create; URL.revokeObjectURL = prev.revoke;
      localStorage.removeItem('user'); restore();
    },
  };
}

test('link present: the signed duty’s document pill downloads the investor’s own copy through the existing e-sign read', async () => {
  const v = await mount();
  try {
    assert.equal(v.tag('company-term-doc-d-open'), 'button');
    assert.match(v.text('company-term-doc-d-open'), /Investors’ Rights Agreement §1\.1\(b\) · Download signed copy/);
    assert.ok(!v.has('company-term-copy-d-open'), 'no message before a press');
    await v.click('company-term-doc-d-open');
    assert.deepEqual(v.asked, ['/legal/esign/501/document']);
    assert.deepEqual(v.saved, ['axal-signed-501.pdf']);
  } finally { await v.close(); }
});

test('link absent: a template duty, a copy not open to you and an unreadable lookup each keep the plain pill and say why', async () => {
  const v = await mount();
  try {
    for (const uid of ['d-tpl', 'd-shut', 'd-unread']) assert.equal(v.tag(`company-term-doc-${uid}`), 'span', uid);
    assert.equal(v.text('company-term-copy-d-tpl'), TERMS_COPY_WORDS.not_signed);
    assert.equal(v.text('company-term-copy-d-shut'), TERMS_COPY_WORDS.not_available);
    assert.equal(v.text('company-term-copy-d-unread'), TERMS_COPY_WORDS.unreadable);
    assert.deepEqual(v.asked, [], 'nothing is fetched until a press');
  } finally { await v.close(); }
});

test('download failed: the row says so, nothing is saved and the page does not navigate', async () => {
  const v = await mount({ '/legal/esign/501/document': Object.assign(new Error('Envelope not found'), { status: 404 }) });
  try {
    await v.click('company-term-doc-d-open');
    assert.deepEqual(v.asked, ['/legal/esign/501/document']);
    assert.deepEqual(v.saved, []);
    assert.deepEqual(v.opened, []);
    assert.equal(v.text('company-term-copy-d-open'), TERMS_COPY_WORDS.failed);
    assert.equal(v.tag('company-term-doc-d-open'), 'button', 'the press stays available to try again');
  } finally { await v.close(); }
});

test('the wiring: the download is D6199’s scoped e-sign read, not a second document read', () => {
  const src = read('frontend/src/pages/investor/CompanyReports.jsx');
  assert.match(src, /closingsApi\.signedCopyBlob\(row\.copy\.envelopeId\)/);
  assert.doesNotMatch(src, /\/legal\/esign\//, 'the page itself names no document route');
});
