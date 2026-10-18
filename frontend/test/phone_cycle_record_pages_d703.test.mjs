/**
 * D703 (#1665), PR 3a — the phone record page, and the route cases that
 * waited on Validate's forms (#1810), #1659's record (#1785) and #1658's data
 * room (#1806):
 *
 *   · test 6 and test 11 on /validate/problem-discovery and its /new;
 *   · test 8's data-room case: "Open the files tool" for a founder;
 *   · test 9: a record below 1024px is `CycleBar` "‹ <Module>" over
 *     `RecordView`'s phone groups, and so is #1659's Customer research record;
 *   · test 10: a partner-shaped Customer research record, and a 404's
 *     "Record not found." under the bar;
 *   · test 11: an Edit opened from a record draws "‹ <record title>".
 *
 * Phone width is #1656's `matchMedia` stub. Every name is made up.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/phone_cycle_record_pages_d703.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import FormLightbox from '../src/pages/cycles/FormLightbox.jsx';
import { CycleBar } from '../src/pages/cycles/PhoneModulePage.jsx';
import { FORMS } from '../src/pages/cycles/forms.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { PHONE_QUERY } from '../src/workspaces/lens.jsx';
import { installDocument } from './_contracts_dom.mjs';
import { card } from './_cycle_fixtures.mjs';
import { fixture } from './_record_d696.mjs';

const h = React.createElement;
const Q = '?project_id=3';
const FOUNDER = { id: 9, role: 'founder', name: 'Ada Quill', email: 'ada@example.test', subscription_tier: 'free' };

const json = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const PAIN_ROWS = Array.from({ length: 25 }, (_, i) => ({ id: 100 + i, cells: { theme: `Theme ${i + 1}`, interviews: i } }));
const PROBLEM_DISCOVERY = {
  module: { slug: 'problem-discovery', name: 'Problem discovery', records_title: 'Pain themes' },
  card: { ...card('validate', 'Problem discovery', 0), caption: 'The pains interviews keep naming.', next: { text: 'Group two more interviews into a theme.' } },
  records: { cols: [{ key: 'theme', label: 'Theme' }, { key: 'interviews', label: 'Interviews' }], rows: PAIN_ROWS, total: 40, page: 1, page_size: 25, linkable: true },
};

/** The generic record, with a Next that names the record's own Edit. */
const RECORD = () => ({ ...fixture(), next: { text: 'Attach the first quote to this pain.', action: 'edit' } });

const SESSION = { id: 7, status: 'transcribed', channel: 'in_person', created_at: '2026-10-07 10:00:00', interview_id: 5 };
const FED = { key: 'fed', title: 'What it fed', gate: 'read', side: true, rows: [{ a: 'Manual reconciliation', b: '1 supports · 0 contradicts' }] };
const INTERVIEW = {
  cycle: 'validate', module: 'customer-research', id: '5', title: 'Rowan Vale', sub: 'Ops lead at Kestrel · 7 Oct · 34 min',
  pills: [{ text: 'Strong fit', tone: 'ok' }],
  facts: [{ label: 'Captured', value: 'Recorded in StudioOS' }, { label: 'Consent', value: 'Said yes out loud' },
    { label: 'ICP fit', value: 'Strong · Segment A' }, { label: 'Need-to-have', value: null, reason: 'No pain is judged yet.' }],
  main: [{ key: 'transcript', title: 'Transcript', gate: 'write', rows: [] }, { key: 'placements', title: 'Eadwyn’s placements', gate: 'write', rows: [] }],
  side: [FED, { key: 'cost', title: 'Cost', gate: 'write', side: true, rows: [] }],
  actions: [
    { key: 'edit-details', kind: 'form', label: 'Edit details', form: { title: 'Edit details', fields: [{ key: 'interviewee_name', label: 'Name', kind: 'T', value: 'Rowan Vale', required: true }] } },
    { key: 'delete', kind: 'write', label: 'Delete', tone: 'danger' },
  ],
  next: { text: 'Judge the pains this interview named.', action: 'edit-details' },
  activity: [{ a: 'Interview 5 details edited by Ada Quill', b: '2026-10-08' }], activity_total: 1,
};
// A partner's read (D690 decision 2): no writer-only section, no action, no next.
const PARTNER = { ...INTERVIEW, main: [], side: [FED], actions: [], next: null };

const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
const pr = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
const settle = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });

/** `CycleRoute` under App's Validate and Raise lines, for a signed-in founder, every request answered by `answer`. */
async function mount(entry, answer, { phone = true } = {}) {
  const restore = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  const store = new Map([['user', JSON.stringify(FOUNDER)]]);
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia, localStorage: globalThis.localStorage };
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); }, key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; },
  };
  const requests = [];
  globalThis.fetch = async (u, o = {}) => { requests.push({ url: String(u), method: o.method || 'GET' }); return answer(String(u)) ?? json({}); };
  globalThis.matchMedia = (query) => ({ matches: phone && query === PHONE_QUERY, media: query, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const at = {};
  function Address() { const l = useLocation(); Object.assign(at, { path: l.pathname, search: l.search }); return null; }
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [entry] }, h(AuthProvider, null, h(Address), h(Routes, null,
    h(Route, { path: '/validate/:slug', element: h(CycleRoute, { cycle: 'validate' }) }),
    h(Route, { path: '/validate/:slug/new', element: h(CycleRoute, { cycle: 'validate', adding: true }) }),
    h(Route, { path: '/validate/:slug/:id', element: h(CycleRoute, { cycle: 'validate', record: true }) }),
    h(Route, { path: '/validate/customer-research/:id', element: h(CycleRoute, { cycle: 'validate', slug: 'customer-research', record: true }) }),
    h(Route, { path: '/raise/data-room', element: h(CycleRoute, { cycle: 'raise', slug: 'data-room' }) }),
  )))));
  await settle();
  const all = (id) => walk(container).filter((n) => pr(n)['data-testid'] === id);
  const fibers = (type) => {
    const key = Object.keys(container).find((k) => k.startsWith('__reactContainer$'));
    const out = []; const stack = [container[key]?.stateNode?.current ?? container[key]];
    while (stack.length) { const n = stack.pop(); if (!n) continue; if (n.type === type) out.push(n.memoizedProps); stack.push(n.sibling, n.child); }
    return out;
  };
  return {
    at, requests, all, by: (id) => all(id)[0], fibers,
    text: (from = container) => txt(from).replace(/\s+/g, ' '),
    async press(label) {
      // A phone row's button holds its title and a chevron, so match the label as a word run.
      const n = walk(container).find((x) => x.tagName === 'BUTTON' && txt(x).replace(/\s+/g, ' ').trim().startsWith(label));
      assert.ok(n, `button ${label}`);
      await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle();
    },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

const reads = (table) => (url) => {
  for (const [key, body] of Object.entries(table)) if (url.includes(key)) return typeof body === 'function' ? body() : json(body);
  return null;
};
const interviewReads = (read, extra = {}) => reads({
  ...extra,
  '/cycles/validate/modules/customer-research/records/5?': read,
  '/founder/validate/interviews/5/sessions': { interview: { id: 5, project_id: 3 }, items: [SESSION] },
  '/founder/validate/sessions/7/receipt': { items: [] },
  '/founder/validate/sessions/7/placements': { runs: [] },
  '/founder/validate/sessions/7': { session: SESSION, segments: [] },
  '/progress/discovery/3': { project_id: 3, interviews: [{ id: 5, interviewee_name: 'Rowan Vale', pains: [] }] },
});

// ── 6. The module route, on Validate's own Problem discovery ─────────────

test('6 (route): below 1024px /validate/problem-discovery is the pushed module page: its bar, One next thing, the Add CTA, the chart and "Pain themes · 1–25 of 40"', async () => {
  const m = await mount(`/validate/problem-discovery${Q}`, reads({ '/cycles/validate/modules/problem-discovery': PROBLEM_DISCOVERY }));
  try {
    assert.equal(m.all('phone-module').length, 1);
    assert.equal(m.by('cycle-module'), undefined, 'CycleModulePage does not render');
    const bars = m.fibers(CycleBar);
    assert.equal(bars.length, 1);
    assert.deepEqual([bars[0].back.label, bars[0].back.to, bars[0].title, bars[0].sub, bars[0].eadwynLabel],
      ['Validate', `/validate${Q}`, 'Problem discovery', 'The pains interviews keep naming.', 'Validate · Problem discovery']);
    assert.match(m.text(m.by('phone-module-next')), /Group two more interviews into a theme\./);
    assert.equal(pr(m.by('phone-module-cta')).href, `/validate/problem-discovery/new${Q}`);
    // The heading's own props: this DOM stub keeps a text node's first-render value.
    const heading = walk(m.by('phone-module-chart')).find((n) => n.tagName === 'H2');
    assert.equal([pr(heading).children].flat().join(''), 'Problem discovery · at a glance');
    assert.match(m.text(), /Pain themes · 1–25 of 40/);
  } finally { await m.close(); }
});

// ── 11. The Add page, and an Edit opened from a record ───────────────────

test('11 (route): below 1024px /validate/problem-discovery/new draws CycleBar "‹ Problem discovery", "New theme" and "Validate · New theme", with no bar handed to FormLightbox; Back closes it', async () => {
  const title = FORMS.validate['problem-discovery'][0].title;
  assert.equal(title, 'New theme');
  const m = await mount(`/validate/problem-discovery/new${Q}`, reads({ '/cycles/validate/modules/problem-discovery': PROBLEM_DISCOVERY }));
  try {
    assert.equal(m.all('cycle-form-page').length, 1, 'the form is the page');
    const forms = m.fibers(FormLightbox);
    assert.equal(forms.length, 1);
    assert.equal(forms[0].bar, undefined, 'FormLightbox is handed no bar');
    const bars = m.fibers(CycleBar);
    assert.equal(bars.length, 1);
    assert.deepEqual([bars[0].back.label, bars[0].title, bars[0].eadwynLabel], ['Problem discovery', 'New theme', 'Validate · New theme']);
    await act(async () => { bars[0].back.onClick(); }); await settle();
    assert.deepEqual([m.at.path, m.at.search], ['/validate/problem-discovery', Q], 'Back is #1656\'s close, to the module');
  } finally { await m.close(); }
});

// ── 9. The record page ───────────────────────────────────────────────────

test('9 (route): below 1024px a record is CycleBar "‹ <Module>" over RecordView\'s phone groups; at 1024px today\'s header and cards', async () => {
  const answer = reads({ '/cycles/validate/modules/problem-discovery/records/7?': RECORD() });
  let m = await mount(`/validate/problem-discovery/7${Q}`, answer);
  try {
    const bars = m.fibers(CycleBar);
    assert.equal(bars.length, 1, 'one bar');
    assert.deepEqual([bars[0].back.label, bars[0].back.to, bars[0].title, bars[0].sub, bars[0].eadwynLabel],
      ['Problem discovery', `/validate/problem-discovery${Q}`, 'Harbour operators', 'Teams coordinating local shipments.', 'Validate · Harbour operators']);
    assert.equal(m.by('cycle-header'), undefined, 'no desktop header under the bar');
    assert.equal(pr(m.by('record-view'))['data-phone'], 'true', 'RecordView draws its phone layout');
    assert.match(m.text(m.by('record-next')), /Next for this record.*Attach the first quote to this pain\./);
    assert.equal(m.text(m.by('record-next-cta')).trim(), 'Edit', 'the CTA carries the named action\'s label');
    assert.match(m.text(m.by('record-pills')), /Curated.*Needs evidence/);
    const facts = m.text(m.by('record-facts'));
    assert.match(facts, /At a glance/);
    assert.match(facts, /Not recorded/);
    assert.match(m.text(m.by('record-activity')), /Activity.*Show all/);
    assert.match(m.text(m.by('record-actions')), /Actions.*Delete/);
  } finally { await m.close(); }
  m = await mount(`/validate/problem-discovery/7${Q}`, answer, { phone: false });
  try {
    assert.equal(m.fibers(CycleBar).length, 0, 'no bar at 1024px');
    assert.ok(m.by('cycle-header'), 'the desktop header');
    assert.equal(pr(m.by('record-view'))['data-phone'], undefined, 'the desktop cards');
  } finally { await m.close(); }
});

test('9 and 11 (route): the Next CTA runs the record\'s Edit, and the Edit page draws CycleBar "‹ <record title>"', async () => {
  const m = await mount(`/validate/problem-discovery/7${Q}`, reads({ '/cycles/validate/modules/problem-discovery/records/7?': RECORD() }));
  try {
    await act(async () => { pr(m.by('record-next-cta')).onClick(); }); await settle();
    assert.equal(m.fibers(FormLightbox).length, 1, 'the Edit is open');
    const bars = m.fibers(CycleBar);
    assert.equal(bars.length, 1, 'one bar, the page\'s');
    assert.equal(bars[0].back.label, 'Harbour operators', 'Back returns to the record');
    assert.equal(m.by('record-view'), undefined, 'the form is the body\'s only content');
  } finally { await m.close(); }
});

test('9 (route): #1659\'s Customer research record gets the same bar and groups, and its Edit details page draws "‹ Rowan Vale"', async () => {
  const m = await mount(`/validate/customer-research/5${Q}`, interviewReads(INTERVIEW));
  try {
    assert.ok(m.by('interview-record'), 'drawn through def.recordPage');
    const bars = m.fibers(CycleBar);
    assert.equal(bars.length, 1);
    assert.deepEqual([bars[0].back.label, bars[0].back.to, bars[0].title, bars[0].eadwynLabel],
      ['Customer research', `/validate/customer-research${Q}`, 'Rowan Vale', 'Validate · Rowan Vale']);
    assert.match(m.text(m.by('record-facts')), /At a glance.*Not recorded/);
    assert.match(m.text(m.by('record-actions')), /Actions/);
    await m.press('Edit details');
    const page = m.fibers(CycleBar);
    assert.equal(page.length, 1);
    assert.deepEqual([page[0].back.label, page[0].title], ['Rowan Vale', 'Edit details']);
    assert.equal(m.by('interview-record'), undefined, 'the page is the body\'s only content');
  } finally { await m.close(); }
});

// ── 10. Gates on the record page ─────────────────────────────────────────

test('10 (route): a partner-shaped Customer research record draws no Transcript, placements, Cost or Next CTA', async () => {
  const m = await mount(`/validate/customer-research/5${Q}`, interviewReads(PARTNER));
  try {
    assert.equal(m.fibers(CycleBar).length, 1, 'the bar');
    const all = m.text();
    assert.doesNotMatch(all, /Transcript|Eadwyn’s placements|Cost|Edit details/);
    assert.equal(m.by('record-next-cta'), undefined);
    assert.match(all, /Manual reconciliation/, 'What it fed stays');
  } finally { await m.close(); }
});

test('10 (route): a record read that answers 404 draws "Record not found." under the bar, with no facts, actions or CTA', async () => {
  const m = await mount(`/validate/problem-discovery/7${Q}`,
    reads({ '/cycles/validate/modules/problem-discovery/records/7?': () => json({ detail: 'Record not found.' }, 404) }));
  try {
    const bars = m.fibers(CycleBar);
    assert.equal(bars.length, 1, 'the bar still draws');
    assert.deepEqual([bars[0].back.label, bars[0].back.to], ['Problem discovery', `/validate/problem-discovery${Q}`]);
    assert.match(m.text(m.by('cycle-record-page')), /Record not found\./);
    for (const id of ['record-view', 'record-facts', 'record-actions', 'record-next-cta']) assert.equal(m.by(id), undefined, id);
  } finally { await m.close(); }
});

// ── 8. The data room's tool link ─────────────────────────────────────────

test('8 (route): for a founder, /raise/data-room below 1024px draws "Open the files tool" → ?mode=workspace, whatever the read\'s Add points at', async () => {
  const m = await mount(`/raise/data-room${Q}`, reads({
    '/cycles/raise/modules/data-room': {
      module: { slug: 'data-room', name: 'Data room' },
      records: { cols: [{ key: 'name', label: 'File' }], rows: [], total: 0, add: { text: 'Upload a file', href: '/raise/data-room?mode=elsewhere' } },
    },
  }));
  try {
    assert.equal(m.all('phone-module').length, 1);
    const tools = m.all('phone-module-tool').map((n) => ({ text: m.text(n).trim(), href: pr(n).href ?? pr(n).to }));
    assert.deepEqual(tools.filter((t) => /Open the files tool/.test(t.text)).map((t) => t.href), [`/raise/data-room?mode=workspace&project_id=3`]);
  } finally { await m.close(); }
});
