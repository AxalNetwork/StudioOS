// D1414 (#3696, INC1–INC7) — Incorporate redesigned: six steps with Review,
// your own projects only, the `?project=` prefill and its refusal, Start
// fresh, the catalog quote's one price (owner Q5), the status timeline from
// the order's own row, the company only when the order carries `company_uid`
// (Q9), no gate (Q6), no bank link (Q7), the device draft, and the dead
// `api.incorporateProject` gone. Mounted on a stubbed fetch.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/incorporate_d1414.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { readDecision } from './_decisions.mjs';
import { renderedText } from './_renderedText.mjs';
import IncorporateFlow from '../src/pages/incorporate/IncorporateFlow.jsx';
import IncorporationTimeline from '../src/pages/incorporate/IncorporationTimeline.jsx';
import IncorporateDone from '../src/pages/incorporate/IncorporateDone.jsx';
import { askPanel, orderCompany } from '../src/pages/incorporate/incorporateAdapter.js';
import {
  DRAFT_KEY, NOT_YOURS, STATE_FEE, STEPS, cofounderStatus, deadline83b, loadDraft, ownProjects, prefill, recommend, saveDraft, stepLine, timeline,
} from '../src/pages/incorporate/incorporateModel.js';
import { api } from '../src/lib/api.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const ok = (value) => ({ available: true, value });
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const JURISDICTIONS = { jurisdictions: [
  { id: 'us_de_ccorp', label: 'Delaware C-Corp', country: 'Delaware', est_cost_usd: [500, 1500], time_to_form_days: [1, 7], fundraising_friendly: true, summary: 'The default for VC-backed startups.', pros: ['What US investors expect', 'Settled case law'], cons: ['A yearly franchise tax', 'Needs a US registered agent'] },
  { id: 'us_wy_ccorp', label: 'Wyoming C-Corp', country: 'Wyoming', est_cost_usd: [100, 600], time_to_form_days: [1, 7], fundraising_friendly: false, summary: 'A low-cost corporation in the US.', pros: ['Low yearly fees'], cons: ['Less case law'] },
] };
const PROJECTS = { projects: [
  { id: 2, name: '[Orbit Notes]', my_seat: 'owner', company_uid: null, company_name: null },
  { id: 3, name: '[Ledgerline]', my_seat: 'owner', company_uid: 'nl', company_name: '[Northwind Labs]' },
  { id: 4, name: '[Someone else’s]', my_seat: 'cofounder', company_uid: null },
] };
const QUOTE = { jurisdiction_id: 'us_de_ccorp', label: 'Delaware C-Corp', amount_cents: 94800, currency: 'usd', source: 'catalog',
  registered_agent: { price_id: 'price_ra', amount_cents: 14900, currency: 'usd', interval: 'year', product_name: 'Registered agent' } };

function worker(over = {}) {
  return (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const path = new URL(url, 'http://x').pathname;
    const key = `${method} ${path}`;
    if (over[key]) return over[key](init, url);
    if (key === 'GET /api/legal/jurisdictions') return response(JURISDICTIONS);
    if (key === 'GET /api/account/projects') return response(PROJECTS);
    if (key === 'GET /api/legal/name-check') return response({ status: 'available' });
    if (key === 'GET /api/legal/documents') return response([{ id: 1, template_name: 'cofounder_agreement', status: 'signed', signed_at: '2026-10-03 10:00:00' }]);
    if (key === 'GET /api/legal/incorporation/quote') return response(QUOTE);
    if (key === 'POST /api/projects') return response({ id: 77, name: '[Fresh]' });
    if (key === 'POST /api/legal/incorporation/order') return response({ dev: true, status: 'paid', incorporation_id: 31 });
    if (key === 'GET /api/legal/incorporate/status') return response({ id: 31, status: 'paid', company_name: '[Orbit Notes Inc.]', paid_at: '2026-10-30 10:00:00', packet_document_id: null, filed_on: null });
    if (path.startsWith('/api/company-ein/')) return response({ recorded: false, last4: null, masked: null, can_edit: true });
    if (key === 'GET /api/legal/83b/trackers') return response({ trackers: [] });
    return response({});
  };
}

async function mount(url = '/incorporate', { handle = worker() } = {}) {
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify({ id: 2, role: 'founder', name: '[Avery Stone]' }));
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const seen = [];
  globalThis.fetch = async (u, init = {}) => {
    let body = null;
    try { body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : null; } catch { body = null; }
    seen.push({ call: `${(init.method || 'GET').toUpperCase()} ${new URL(String(u), 'http://x').pathname}`, body });
    return handle(String(u), init);
  };
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null, h(Route, { path: '/incorporate', element: h(IncorporateFlow) })))));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  const fire = async (id, name, arg) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n)[name](arg); }); await settle(); };
  return {
    seen, settle,
    calls: () => seen.map((s) => s.call),
    writes: () => seen.filter((s) => !s.call.startsWith('GET ') && s.call !== 'POST /api/client-error'),
    text: () => textOf(document.body),
    of: (id) => { const n = byId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    has: (id) => Boolean(byId(id)), prop: (id, k) => props(byId(id))?.[k],
    click: (id) => fire(id, 'onClick'), change: (id, v) => fire(id, 'onChange', { target: { value: v, checked: v } }),
    wait: async (ms) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); await settle(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

// ---------------------------------------------------------------- the model

test('six steps with Review, and the phone\'s line', () => {
  assert.deepEqual(STEPS.map((s) => s.label), ['Tell us your goals', 'Compare jurisdictions', 'Company details', 'Review', 'Pay & file', 'Done']);
  assert.equal(stepLine(2), 'Step 3 of 6 · Company details');
  assert.equal(recommend({ raisingVc: 'yes_eu' }), 'uk_ltd');
  assert.equal(recommend({}), 'us_de_ccorp');
  const d = readDecision(1414);
  assert.match(d, /^## D1414 — /);
  for (const issue of ['#3855', '#3706']) assert.ok(d.includes(issue), `D1414 names ${issue}`);
});

test('only your own projects; the prefill names one of them, and refuses one that is not yours', () => {
  const own = ownProjects(PROJECTS);
  assert.deepEqual(own.map((p) => [p.id, p.sub]), [[2, 'Not in a company'], [3, 'In [Northwind Labs]']], 'a co-founder seat is not yours to incorporate');
  assert.deepEqual(prefill(own, '2'), { id: 2, refused: false, name: '[Orbit Notes]' });
  assert.deepEqual(prefill(own, '4'), { id: null, refused: true });
  assert.deepEqual(prefill(own, null), { id: null, refused: false });
});

test('the co-founder agreement\'s status comes from the documents, and an unread list is not "Not started"', () => {
  assert.deepEqual(cofounderStatus([{ template_name: 'cofounder_agreement', status: 'signed', signed_at: '2026-10-03' }]), { kind: 'signed', on: '2026-10-03' });
  assert.deepEqual(cofounderStatus([{ template_name: 'cofounder_agreement', status: 'generated' }]), { kind: 'drafted' });
  assert.deepEqual(cofounderStatus([{ template_name: 'nda', status: 'signed' }]), { kind: 'none' });
  assert.deepEqual(cofounderStatus(null), { kind: 'unread' });
});

test('the timeline is the order\'s own row: no EIN or bank status invented; Filed only when filed', () => {
  const paid = timeline({ status: 'paid', paid_at: '2026-10-30 10:00:00' });
  assert.deepEqual(paid.map((s) => [s.key, s.done]), [['submitted', true], ['packet', false], ['filed', false]]);
  assert.equal(paid[0].line, 'Paid · 30 Oct');
  assert.equal(paid[2].line, 'Waiting for Axal VC to record the filing');
  const filed = timeline({ status: 'filed', paid_at: '2026-10-30', packet_document_id: 5, filed_on: '2026-11-02' });
  assert.deepEqual(filed.map((s) => s.done), [true, true, true]);
  assert.equal(filed[2].line, 'Filed with the state · 2 Nov');
  assert.ok(!JSON.stringify([...paid, ...filed]).match(/EIN|bank/i), 'EIN is its own row, and there is no bank row');
  assert.deepEqual(deadline83b({ trackers: [] }), { kind: 'none' });
  assert.equal(deadline83b(null).kind, 'unread');
  assert.equal(deadline83b({ trackers: [{ deadline_date: '2026-11-29', days_left: 29, mailed_at: null }] }).line, 'Due 29 Nov · 29 days left');
});

test('the device draft: kept and read back; a store that throws or holds junk is "no draft", and the flow goes on', () => {
  const mem = new Map();
  const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  assert.equal(saveDraft({ step: 2, pick: 2 }, store), true);
  assert.deepEqual(loadDraft(store), { step: 2, pick: 2 });
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(saveDraft({ step: 1 }, throwing), false);
  assert.equal(loadDraft(throwing), null);
  mem.set(DRAFT_KEY, '{not json');
  assert.equal(loadDraft(store), null);
});

test('the company is the order\'s (owner Q9, #3855): drawn only from company_uid, never promised', () => {
  assert.deepEqual(orderCompany({ company_uid: 'nl', company_name: 'X' }), { available: true, value: { uid: 'nl', name: 'X' } });
  assert.deepEqual(orderCompany({ status: 'paid' }), { available: false, reason: 'The company is linked when the order carries it.', waitsOn: '#3855' });
  assert.equal(askPanel().waitsOn, '#3706');
  const wrap = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
  const without = wrap(h(IncorporationTimeline, { order: { status: 'paid' }, projectId: 2 }));
  assert.doesNotMatch(without, /timeline-company|Open company|appears in Portfolio/);
  const withCo = wrap(h(IncorporationTimeline, { order: { status: 'paid', company_uid: 'nl', company_name: '[Orbit Notes Inc.]' }, projectId: 2, projectName: '[Orbit Notes]' }));
  assert.match(renderedText(withCo), /\[Orbit Notes Inc\.\] now appears in Portfolio, linked to \[Orbit Notes\]\. Filing in progress\.Open company/);
  assert.match(withCo, /href="\/account\/portfolio\/nl"/);
  const done = wrap(h(IncorporateDone, { order: { status: 'paid' }, projectId: 2, companyName: '[Orbit Notes Inc.]' }));
  assert.match(renderedText(done), /\[Orbit Notes Inc\.\] is on its way/);
  assert.doesNotMatch(done, /done-open-company/);
  assert.match(done, /href="\/account\/portfolio\/projects\/2"/, 'Back to the project, always');
  assert.doesNotMatch(renderedText(done), /bank/i, 'no bank link (owner Q7)');
});

// ---------------------------------------------------------------- mounted

test('mounted: ?project= prefills from your own projects ("From [name]"); never GET /api/projects', async () => {
  const v = await mount('/incorporate?project=2');
  try {
    assert.match(v.of('incorporate-from'), /From \[Orbit Notes\]/);
    assert.equal(v.prop('incorporate-primary', 'disabled'), false, 'the prefilled project is picked');
    assert.ok(v.calls().includes('GET /api/account/projects'));
    assert.ok(!v.calls().includes('GET /api/projects'), 'the every-venture read');
    assert.match(v.of('incorporate-pick'), /Only your own projects are listed\./);
    assert.doesNotMatch(v.text(), /Someone else/);
  } finally { await v.close(); }
});

test('mounted: a project that is not yours says so (INC5f), and nothing is picked', async () => {
  const v = await mount('/incorporate?project=4');
  try {
    assert.equal(v.of('incorporate-not-yours'), NOT_YOURS);
    assert.equal(v.prop('incorporate-primary', 'disabled'), true);
  } finally { await v.close(); }
});

test('mounted: the walk with a prefilled project; the quote is one price with the RA offer, and the state fee at filing', async () => {
  const w = await mount('/incorporate?project=2');
  try {
    await w.click('incorporate-primary');
    assert.match(w.of('incorporate-compare'), /Delaware C-Corp.*VC-friendly.*Recommended.*\$500–\$1,500.*1–7 days.*What US investors expect.*A yearly franchise tax/s);
    await w.click('incorporate-primary');
    await w.change('incorporate-company-name', '[Orbit Notes Inc.]');
    await w.wait(700);
    assert.match(w.of('incorporate-name-available'), /Available in Delaware/);
    assert.match(w.of('incorporate-cofounder'), /Signed 3 Oct.*Open Co-founder Agreement ›/s);
    assert.match(w.of('incorporate-details'), /You record these on the company once it exists\./);
    await w.click('incorporate-primary');
    assert.match(w.of('incorporate-review'), /Project\[Orbit Notes\].*Company name\[Orbit Notes Inc\.\] · available.*Officers and directorsRecorded on the company once it exists/s);
    assert.match(w.of('incorporate-order'), /\$948.*Registered agent · optional, added after you pay\$149\/year.*Total today\$948/s);
    assert.equal(w.of('incorporate-state-fee'), STATE_FEE);
    assert.doesNotMatch(w.of('incorporate-order'), /State filing fee|filing service/, 'no itemised breakdown (owner Q5)');
    await w.click('incorporate-primary');
    await w.click('incorporate-primary');
    const orders = w.writes().filter((x) => x.call === 'POST /api/legal/incorporation/order');
    assert.equal(orders.length, 1);
    assert.equal(orders[0].body.project_id, 2);
    assert.match(w.of('incorporation-timeline'), /Submitted.*Paid · 30 Oct.*Packet ready.*Filed.*Waiting for Axal VC to record the filing/s);
    assert.match(w.of('timeline-ein'), /EINNot recorded.*Add EIN/s);
    assert.ok(!w.has('timeline-company'), 'no company before the order carries it');
    assert.doesNotMatch(w.text(), /bank/i);
    await w.click('incorporate-primary');
    assert.ok(w.has('incorporate-done'));
    assert.ok(!w.has('done-open-company'));
  } finally { await w.close(); }
});

test('mounted: one block failing is said alone (INC5d); the pick still draws', async () => {
  const v = await mount('/incorporate?project=2', { handle: worker({ 'GET /api/legal/jurisdictions': () => response({ error: 'x' }, 503) }) });
  try {
    assert.ok(v.has('incorporate-pick'));
    await v.click('incorporate-primary');
    assert.match(v.of('incorporate-jurisdictions-unread'), /^Jurisdiction options could not be read\.Try again$/);
  } finally { await v.close(); }
});

test('mounted: Start fresh posts the project first, standalone, and orders that project', async () => {
  const v = await mount('/incorporate');
  try {
    await v.change('incorporate-fresh-radio', true);
    await v.change('incorporate-fresh-name', '[Fresh]');
    await v.click('incorporate-primary');
    await v.click('incorporate-primary');
    await v.change('incorporate-company-name', '[Fresh Inc.]');
    await v.wait(700);
    await v.click('incorporate-primary');
    await v.click('incorporate-primary');
    await v.click('incorporate-primary');
    const w = v.writes();
    assert.deepEqual(w.map((x) => x.call), ['POST /api/projects', 'POST /api/legal/incorporation/order']);
    assert.deepEqual(w[0].body, { name: '[Fresh]', company_id: null });
    assert.equal(w[1].body.project_id, 77, 'the order is for the project just created');
    assert.ok(!v.calls().includes('GET /api/legal/documents'), 'a fresh project has no co-founder agreement to read');
  } finally { await v.close(); }
});

// ---------------------------------------------------------------- source pins

test('the dead client is gone: no api.incorporateProject, no drift entry, and the project page opens Incorporate prefilled', () => {
  assert.equal(api.incorporateProject, undefined);
  assert.doesNotMatch(read('frontend/src/lib/api.js'), /incorporateProject/);
  assert.doesNotMatch(read('scripts/api-drift-baseline.json'), /"POST \/api\/legal\/incorporate"/);
  assert.match(read('frontend/src/pages/ProjectDetail.jsx'), /navigate\(`\/incorporate\?project=\$\{encodeURIComponent\(id\)\}`\)/);
  assert.match(read('frontend/src/pages/IncorporatePage.jsx'), /export \{ default \} from '\.\/incorporate\/IncorporateFlow\.jsx';/);
});

test('house rules in the source: own projects only, no gate, no bank, no Fill, no field trigger before #3706', () => {
  const dir = 'frontend/src/pages/incorporate';
  const src = readdirSync(dir).filter((f) => /\.jsx?$/.test(f)).map((f) => codeOnly(read(`${dir}/${f}`))).join('\n');
  assert.doesNotMatch(src, /listProjects\(/, 'the every-venture read');
  assert.doesNotMatch(src, /See plans|Validate \+ Build|ensureTier/, 'no plan gate (owner Q6)');
  assert.doesNotMatch(src, /bank account/i, 'no bank link (owner Q7)');
  assert.doesNotMatch(src, /\bFill\b/);
  assert.doesNotMatch(src, /FillFormTrigger|FillTrigger|Ask Eadwyn to fill/, 'no field trigger until #3706');
  assert.match(src, /import AskButton from '\.\.\/team\/AskButton\.jsx';/, 'Ask is the shared button, which draws nothing until its panel exists');
});
