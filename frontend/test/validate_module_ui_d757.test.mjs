/**
 * D757 §2.6–§2.7 (#1928) — each Validate module's "From your interviews"
 * panel, the records' interview findings, Customer research's Summary and
 * What it fed, and Verdict's interview line and preselected evidence.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/validate_module_ui_d757.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { h, mountForm, propsOf, textOf } from './_form_d695.mjs';
import { mutationCheck } from './_record_d696.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import CycleModulePage from '../src/pages/cycles/CycleModulePage.jsx';
import PhoneModulePage from '../src/pages/cycles/PhoneModulePage.jsx';
import FormLightbox from '../src/pages/cycles/FormLightbox.jsx';
import RecordView, { RecordPhoneProvider } from '../src/pages/cycles/RecordView.jsx';
import { FromYourInterviews, suggestionText } from '../src/pages/cycles/ValidateSections.jsx';
import {
  ACCEPT_ALL_MAX, NO_SUGGESTIONS, acceptAllBatches, acceptSuggestions, findingLine, heardLine, hms,
  suggestionsView, verdictInterviewLine,
} from '../src/pages/cycles/validatePhone.js';
import { verdictForm, withSuggestedEvidence } from '../src/pages/cycles/verdictForm.js';

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const worker = (p) => readFileSync(new URL(`../../cloudflare-worker/src/${p}`, import.meta.url), 'utf8');
const ssr = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const response = (body, status = 200) => ({
  ok: status < 400, status, headers: { get: (k) => (/content-type/i.test(k) ? 'application/json' : null) },
  json: async () => body, text: async () => JSON.stringify(body),
});

// Made-up suggestions, in #1925's `moduleSuggestions` shape.
const S1 = {
  id: 41, kind: 'job_to_be_done', payload: { job: 'Close the month without a spreadsheet' }, quote: 'every month end I rebuild the sheet',
  interviewee: 'Rowan Vale', interview_id: 7, session_id: 3, cite_from: 751000, segment_id: 88, speaker: 'Interviewee',
  href: '/validate/session/3?project=9#seg-88',
};
const S2 = {
  id: 42, kind: 'firmographic', payload: { attribute: 'company_size', value: '50–200' }, quote: null,
  interviewee: null, interview_id: 8, session_id: 3, cite_from: null, segment_id: null, speaker: null, href: null,
};
const S3 = {
  id: 43, kind: 'icp_fit', payload: { fit: 'strong', reason: 'Runs finance alone' }, quote: 'Quote withheld',
  interviewee: 'Ada Quill', interview_id: 9, session_id: null, cite_from: 5000, segment_id: null, speaker: null, href: null,
};
const WRITER = { can_write: true, suggestions: [S1, S2, S3] };

// ---------------------------------------------------------------------------
// 1. The panel: writers only, its rows, and its states
// ---------------------------------------------------------------------------

function verifyView(m) {
  assert.deepEqual(m.suggestionsView({ can_write: false, suggestions: [S1] }), { state: 'hidden', rows: [] }, 'a reader never sees it');
  assert.deepEqual(m.suggestionsView({ can_write: true }), { state: 'hidden', rows: [] }, 'no key: the read sent none');
  assert.equal(m.suggestionsView({ can_write: true, suggestions: null }).state, 'unreadable');
  assert.equal(m.suggestionsView({ can_write: true, suggestions: [] }).state, 'none');
  assert.equal(m.suggestionsView(WRITER).rows.length, 3);
  assert.equal(m.hms(751000), '00:12:31');
  assert.equal(m.hms(null), null);
  assert.equal(m.heardLine(S1), 'Heard in Rowan Vale · 00:12:31 · Interviewee');
  assert.equal(m.heardLine(S2), 'Heard in an interview');
}

test('1: the panel model: hidden for a reader, unreadable, none, some; the heard line', async () => {
  verifyView({ suggestionsView, hms, heardLine });
  await mutationCheck(src('pages/cycles/validatePhone.js'), 'pages/cycles/validatePhone.js', verifyView, [
    ["parts.can_write !== true || ", ''],
    ["return { state: 'unreadable', rows: [] };", "return { state: 'none', rows: [] };"],
    ["s?.speaker || null", 'null'],
    ['padStart(2, \'0\')', 'padStart(1, \'0\')'],
  ]);
});

test('1: a writer sees From your interviews with each row\'s words, quote and heard line linking the transcript; a reader sees nothing', () => {
  const html = ssr(h(FromYourInterviews, { parts: WRITER, onAccept() {}, onDiscard() {}, onAcceptAll() {} }));
  assert.match(html, /From your interviews/);
  assert.match(html, /Job to be done · Close the month without a spreadsheet/);
  assert.match(html, /Company size · 50–200/);
  assert.match(html, /Strong fit · Runs finance alone|Runs finance alone/, 'an older kind reads through placementText');
  assert.match(html, /every month end I rebuild the sheet/);
  assert.match(html, /Quote withheld/, 'the Worker\'s withheld quote is drawn as sent');
  assert.match(html, /href="\/validate\/session\/3\?project=9#seg-88"[^>]*>Heard in Rowan Vale · 00:12:31 · Interviewee</);
  assert.match(html, />Accept all</);
  assert.equal((html.match(/data-testid="validate-suggestion-accept"/g) || []).length, 3);
  assert.equal((html.match(/data-testid="validate-suggestion-edit"/g) || []).length, 3);
  assert.equal((html.match(/data-testid="validate-suggestion-discard"/g) || []).length, 3);

  for (const parts of [{ can_write: false }, { can_write: false, suggestions: [S1] }, { can_write: true }, null]) {
    assert.equal(ssr(h(FromYourInterviews, { parts, onAccept() {}, onDiscard() {}, onAcceptAll() {} })), '', JSON.stringify(parts));
  }
});

test('1: the empty state and the unreadable state', () => {
  const empty = ssr(h(FromYourInterviews, { parts: { can_write: true, suggestions: [] }, onAccept() {}, onDiscard() {}, onAcceptAll() {} }));
  assert.equal(NO_SUGGESTIONS, 'No suggestions from your interviews yet.');
  assert.match(empty, /No suggestions from your interviews yet\./);
  assert.doesNotMatch(empty, /Accept all/);
  const unreadable = ssr(h(FromYourInterviews, { parts: { can_write: true, suggestions: null }, onAccept() {}, onDiscard() {}, onAcceptAll() {} }));
  assert.match(unreadable, /could not be read/);
  assert.doesNotMatch(unreadable, /No suggestions from your interviews yet/, 'unreadable never reads as none');
});

test('1: every finding kind reads in the Worker\'s own words (findingLine read back)', () => {
  const caseLines = (text) => text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('case \''));
  const w = worker('services/interviewFindings.ts');
  const body = (text, start) => text.slice(text.indexOf(start), text.indexOf('\n}\n', text.indexOf(start)));
  const theirs = caseLines(body(w, 'export function findingLine('));
  const ours = caseLines(body(src('pages/cycles/validatePhone.js'), 'export function findingLine('));
  assert.equal(theirs.length, 12, 'D873 (#2520) added decision');
  assert.deepEqual(ours, theirs);
  for (const map of ['ATTRIBUTE_WORD', 'KIND_WORD', 'FOLLOW_UP_WORD']) {
    const line = (text) => text.split('\n').find((l) => l.startsWith(`const ${map}`))?.replace(/: Record<string, string>/, '').trim();
    const theirLine = w.split('\n').findIndex((l) => l.startsWith(`const ${map}`));
    const theirText = theirLine >= 0 ? w.split('\n').slice(theirLine, theirLine + 3).join(' ').replace(/\s+/g, ' ').replace(/: Record<string, string>/, '') : '';
    assert.ok(theirText.includes(line(src('pages/cycles/validatePhone.js')).replace(/\s+/g, ' ').replace(/ };$/, '')), map);
  }
  assert.deepEqual(findingLine('budget', { detail: 'Team budget', amount_cents: 120000, currency: 'usd', period: 'month' }), { what: 'Budget', detail: 'Team budget · 1,200 USD / month' });
  assert.equal(findingLine('pain_severity', {}), null);
  assert.equal(suggestionText({ kind: 'follow_up', payload: { kind: 'intro_offer', detail: 'Intro to their CFO' } }), 'Intro offered · Intro to their CFO');
  // D873 (#2520): a call's decision and action item read in the Worker's words.
  assert.equal(suggestionText({ kind: 'decision', payload: { statement: 'Fix the close first', owner_hint: 'Dana Ruiz' } }), 'Decision · Fix the close first · Dana Ruiz');
  assert.equal(suggestionText({ kind: 'follow_up', payload: { kind: 'action_item', detail: 'Send the checklist', owner_hint: 'Sam', due_hint: 'by Friday' } }), 'Action item · Send the checklist · Sam · by Friday');
  assert.equal(suggestionText({ kind: 'objection', payload: { about: 'price', detail: 'Too dear for one seat' } }), 'Objection · Price · Too dear for one seat');
  assert.equal(suggestionText({ kind: 'hypothesis_new', payload: { claim: 'Controllers buy it' } }), 'New hypothesis · Controllers buy it');
  assert.equal(suggestionText({ kind: 'segment', payload: { name: 'Solo controllers' } }), 'Segment: Solo controllers');
});

// ---------------------------------------------------------------------------
// 2. Accept, Edit and Discard
// ---------------------------------------------------------------------------

const rowButton = (m, id, testid) => m.nodes().find((n) => propsOf(n)['data-testid'] === testid
  && (() => { for (let p = n.parentNode; p; p = p.parentNode) if (propsOf(p)['data-id'] === id) return true; return false; })());
const press = (m, node) => act(async () => { await propsOf(node).onClick({ preventDefault() {} }); });

test('2: Accept sends the id; Edit then Save and accept sends the edited payload; Discard sends the id', async () => {
  const calls = [];
  const m = await mountForm(h(FromYourInterviews, {
    parts: WRITER,
    onAccept: async (...a) => { calls.push(['accept', ...a]); },
    onDiscard: async (...a) => { calls.push(['discard', ...a]); },
    onAcceptAll() {},
  }));
  try {
    await press(m, rowButton(m, 41, 'validate-suggestion-accept'));
    assert.deepEqual(calls.at(-1), ['accept', 41, undefined]);

    await press(m, rowButton(m, 42, 'validate-suggestion-edit'));
    const draft = m.by('validate-suggestion-draft');
    assert.ok(draft, 'Edit opens the payload');
    assert.deepEqual(JSON.parse(propsOf(draft).value), S2.payload);
    await act(async () => propsOf(draft).onChange({ target: { value: '{"attribute":"company_size","value":"200–500"}' } }));
    assert.equal(textOf(rowButton(m, 42, 'validate-suggestion-accept')), 'Save and accept');
    await press(m, rowButton(m, 42, 'validate-suggestion-accept'));
    assert.deepEqual(calls.at(-1), ['accept', 42, { attribute: 'company_size', value: '200–500' }]);

    await press(m, rowButton(m, 43, 'validate-suggestion-discard'));
    assert.deepEqual(calls.at(-1), ['discard', 43]);
    assert.equal(calls.length, 3);
  } finally { await m.unmount(); }
});

test('2: an edit that is not JSON accepts nothing; a refused Accept says it is still suggested', async () => {
  const calls = [];
  const m = await mountForm(h(FromYourInterviews, {
    parts: WRITER,
    onAccept: async (id) => { calls.push(id); throw new Error('That module refused it.'); },
    onDiscard: async () => {}, onAcceptAll() {},
  }));
  try {
    await press(m, rowButton(m, 41, 'validate-suggestion-edit'));
    await act(async () => propsOf(m.by('validate-suggestion-draft')).onChange({ target: { value: '{ not json' } }));
    await press(m, rowButton(m, 41, 'validate-suggestion-accept'));
    assert.deepEqual(calls, [], 'nothing was sent');
    assert.ok(m.text().includes('The edit is not valid JSON. Nothing was accepted.'));
    await press(m, rowButton(m, 42, 'validate-suggestion-accept'));
    assert.deepEqual(calls, [42]);
    assert.ok(m.text().includes('That module refused it. It is still suggested.'));
  } finally { await m.unmount(); }
});

// ---------------------------------------------------------------------------
// 3. Accept all
// ---------------------------------------------------------------------------

function verifyBatches(m) {
  const many = Array.from({ length: 51 }, (_, i) => ({ id: 100 + i, session_id: 5 }));
  const batches = m.acceptAllBatches([...many, { id: 7, session_id: 6 }, { id: 8, session_id: null }, { id: 'x', session_id: 5 }]);
  assert.equal(m.ACCEPT_ALL_MAX, 50);
  assert.deepEqual(batches.map((b) => [b.sessionId, b.ids.length]), [[5, 50], [5, 1], [6, 1], [null, 1]]);
  assert.deepEqual(batches[3].ids, [8]);
}

test('3: Accept all goes per session, at most 50 ids a call; a suggestion with no session is accepted on its own', async () => {
  verifyBatches({ acceptAllBatches, ACCEPT_ALL_MAX });
  await mutationCheck(src('pages/cycles/validatePhone.js'), 'pages/cycles/validatePhone.js', verifyBatches, [
    ['export const ACCEPT_ALL_MAX = 50;', 'export const ACCEPT_ALL_MAX = 51;'],
    ['i += ACCEPT_ALL_MAX', 'i += 1000'],
    ['else single.push({ sessionId: null, ids: [s.id] });', ''],
  ]);
  const calls = [];
  const sessions = {
    acceptAll: async (sid, ids) => { calls.push(['acceptAll', sid, ids]); return { results: ids.map((id) => ({ id, ok: id !== 41, ...(id === 41 ? { error: 'stale' } : {}) })), accepted: ids.length - 1, remaining: 0 }; },
    accept: async (id) => { calls.push(['accept', id]); throw new Error('refused'); },
  };
  const failed = await acceptSuggestions(acceptAllBatches(WRITER.suggestions), sessions);
  assert.deepEqual(calls, [['acceptAll', 3, [41, 42]], ['accept', 43]]);
  assert.equal(failed, 2, 'one refused in the batch, one on its own');
});

test('3: the panel\'s Accept all hands every row\'s batches over and says how many are still suggested', async () => {
  const seen = [];
  const m = await mountForm(h(FromYourInterviews, {
    parts: WRITER, onAccept() {}, onDiscard() {},
    onAcceptAll: async (batches) => { seen.push(batches); return 1; },
  }));
  try {
    await press(m, m.by('validate-suggestions-accept-all'));
    assert.deepEqual(seen, [[{ sessionId: 3, ids: [41, 42] }, { sessionId: null, ids: [43] }]]);
    assert.ok(m.text().includes('1 could not be accepted and is still suggested.'));
  } finally { await m.unmount(); }
});

// ---------------------------------------------------------------------------
// 4. Through CycleRoute: the routes, the re-read, and no panel on Verdict
// ---------------------------------------------------------------------------

async function mounted(url, handler) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push({ url: String(u), options }); return handler(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.click = () => {}; node.remove = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const walk = (node) => [node, ...(node.childNodes || []).flatMap(walk)];
  const byTestid = (id) => walk(container).find((n) => propsOf(n)?.['data-testid'] === id) || null;
  const all = (id) => walk(container).filter((n) => propsOf(n)?.['data-testid'] === id);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null,
    h(Route, { path: '/validate/:slug', element: h(CycleRoute, { cycle: 'validate' }) }),
  ))));
  const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  return {
    requests, byTestid, all, flush,
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}
const moduleRead = (slug, parts) => ({
  module: { slug, name: slug }, card: null,
  records: { cols: ['Item'], rows: [], total: 0, page: 1, page_size: 25, linkable: false }, parts,
});
const handlerFor = (slug, parts, extra = () => null) => (url, opts) => extra(url, opts)
  ?? (url.includes(`/cycles/validate/modules/${slug}?`) ? response(moduleRead(slug, parts)) : response({}));
const reads = (requests, slug) => requests.filter((r) => r.url.includes(`/cycles/validate/modules/${slug}?`)).length;

test('4: on a module page Accept, Discard and Accept all call #1925\'s routes and re-read the module', async () => {
  const m = await mounted('/validate/ideal-customer-profile?project_id=9', handlerFor('ideal-customer-profile', WRITER, (url) => (
    url.includes('/placements/accept') ? response({ results: [{ id: 41, ok: true }, { id: 42, ok: true }], accepted: 2, remaining: 0 })
      : /\/placements\/\d+\/(accept|discard)/.test(url) ? response({ ok: true }) : null)));
  try {
    assert.ok(m.byTestid('validate-from-interviews'), 'the panel is on the module page');
    const posts = () => m.requests.filter((r) => r.options.method === 'POST').map((r) => [r.url.replace(/^.*\/api/, ''), r.options.body ? JSON.parse(r.options.body) : null]);
    let before = reads(m.requests, 'ideal-customer-profile');
    await act(async () => { await propsOf(m.all('validate-suggestion-accept')[0]).onClick(); });
    await m.flush();
    assert.deepEqual(posts().at(-1), ['/founder/validate/placements/41/accept', {}]);
    assert.ok(reads(m.requests, 'ideal-customer-profile') > before, 're-read after Accept');

    before = reads(m.requests, 'ideal-customer-profile');
    await act(async () => { await propsOf(m.all('validate-suggestion-discard')[2]).onClick(); });
    await m.flush();
    assert.deepEqual(posts().at(-1), ['/founder/validate/placements/43/discard', null]);
    assert.ok(reads(m.requests, 'ideal-customer-profile') > before, 're-read after Discard');

    before = reads(m.requests, 'ideal-customer-profile');
    await act(async () => { await propsOf(m.byTestid('validate-suggestions-accept-all')).onClick(); });
    await m.flush();
    assert.deepEqual(posts().slice(-2), [
      ['/founder/validate/sessions/3/placements/accept', { ids: [41, 42] }],
      ['/founder/validate/placements/43/accept', {}],
    ]);
    assert.ok(reads(m.requests, 'ideal-customer-profile') > before, 're-read after Accept all');
  } finally { await m.close(); }
});

test('4: a reader\'s module page and Verdict draw no panel', async () => {
  const reader = await mounted('/validate/market-intelligence?project_id=9', handlerFor('market-intelligence', { can_write: false }));
  try { assert.equal(reader.byTestid('validate-from-interviews'), null); } finally { await reader.close(); }
  const verdict = await mounted('/validate/verdict?project_id=9', handlerFor('verdict', { can_write: true, suggestions: [] }));
  try { assert.equal(verdict.byTestid('validate-from-interviews'), null, 'there is no Verdict suggestion'); } finally { await verdict.close(); }
});

test('4: CycleRoute mounts the panel on Validate only, and not on Verdict', () => {
  const route = src('pages/cycles/CycleRoute.jsx');
  assert.match(route, /moduleStatus === 'ready' && cycle === 'validate' && slug !== 'verdict' && \(\s*<FromYourInterviews parts=\{module\?\.parts\}/);
});

// ---------------------------------------------------------------------------
// 5. The records: findings, Summary and What it fed, drawn as the Worker sends them
// ---------------------------------------------------------------------------

const RECORD = (main, side = []) => ({
  id: 7, title: 'A record', pills: [], facts: [], next: null, main, side, actions: [], activity: [], activity_total: 0,
});
const recordHtml = (record, moduleName) => ssr(h(RecordPhoneProvider, { phone: false }, h(RecordView, { record, cycleName: 'Validate', moduleName })));

test('5: ICP, Market and Demand records list their interview findings, each with its quote and interviewee', () => {
  const icp = recordHtml(RECORD([], [{ key: 'findings', title: 'From interviews', side: true, rows: [
    { a: 'Job to be done · Close the month without a spreadsheet', b: 'Rowan Vale' },
    { a: 'Company size · 50–200', b: 'Quote withheld' },
  ] }]), 'Ideal customer profile');
  for (const t of ['From interviews', 'Job to be done · Close the month without a spreadsheet', 'Company size · 50–200', 'Quote withheld']) assert.ok(icp.includes(t), t);
  const market = recordHtml(RECORD([], [{ key: 'findings', title: 'From interviews', side: true, rows: [{ a: 'Alternative · Status quo · Spreadsheets', b: 'Ada Quill' }] }]), 'Market intelligence');
  assert.ok(market.includes('Alternative · Status quo · Spreadsheets'));
  const demand = recordHtml(RECORD([], [{ key: 'findings', title: 'From the interview', side: true, rows: [], empty: 'No budget, timing, urgency, trigger or objection accepted from its interview.' }]), 'Demand signals');
  assert.ok(demand.includes('From the interview'));
  assert.ok(demand.includes('No budget, timing, urgency, trigger or objection accepted from its interview.'));
  // The sections are the Worker's (#1925): the three records name them.
  const w = worker('services/records/validate.ts');
  assert.match(w, /findingsSection\('findings', 'From interviews', findingKindsOf\('ideal-customer-profile'\)/);
  assert.match(w, /findingsSection\('findings', 'From interviews', findingKindsOf\('market-intelligence'\)/);
  assert.match(w, /findingsSection\('findings', 'From the interview', findingKindsOf\('demand-signals'\)/);
});

test('5: Customer research draws its Summary, a draft labelled, and What it fed, each module linked', () => {
  const html = recordHtml(RECORD([{ key: 'summary', title: 'Summary', rows: [
    { a: 'Draft · written by a model not recorded', tone: 'amb' },
    { a: 'Month end takes two days.' },
    { a: 'Send the pilot terms', c: 'Next step · you' },
  ] }], [{ key: 'fed', title: 'What it fed', side: true, rows: [
    { a: 'Pain themes', b: '2' },
    { a: 'Ideal customer profile', b: '3 accepted suggestions', href: '/validate/ideal-customer-profile?project=9' },
  ] }]), 'Customer research');
  for (const t of ['Summary', 'Draft · written by a model not recorded', 'Month end takes two days.', 'Next step · you', 'What it fed', '3 accepted suggestions']) assert.ok(html.includes(t), t);
  assert.match(html, /href="\/validate\/ideal-customer-profile\?project=9"[^>]*>Ideal customer profile</);
  const kept = recordHtml(RECORD([{ key: 'summary', title: 'Summary', rows: [{ a: 'Month end takes two days.' }] }]), 'Customer research');
  assert.doesNotMatch(kept, /Draft/, 'a kept summary carries no draft label');
  // InterviewRecord draws any section it does not own through RecordSection.
  assert.match(src('pages/founder/InterviewReviewPage.jsx'), /return <RecordSection key=\{section\.key \|\| section\.title\} section=\{section\}/);
});

// ---------------------------------------------------------------------------
// 6. Verdict: the interview line and the preselected evidence
// ---------------------------------------------------------------------------

const EVIDENCE = { count: 3, contradicting: 1, text: '3 new pieces of interview evidence since your last decision, 1 contradicting' };
const verdictData = (canWrite) => ({
  module: { slug: 'verdict', name: 'Verdict' },
  card: { slug: 'verdict', name: 'Verdict', state: 'empty', series: null, reason: 'No decision yet.', interview_evidence: EVIDENCE },
  records: { cols: [], rows: [], total: 0, page: 1, page_size: 25 }, parts: { can_write: canWrite },
});

function verifyLine(m) {
  assert.equal(m.verdictInterviewLine(verdictData(true)), EVIDENCE.text);
  assert.equal(m.verdictInterviewLine(verdictData(false)), null, 'partners never see it');
  assert.equal(m.verdictInterviewLine({ ...verdictData(true), card: { ...verdictData(true).card, interview_evidence: null } }), null);
}

test('6: the Verdict card shows the interview line to writers on both widths, and never to a reader', async () => {
  verifyLine({ verdictInterviewLine });
  await mutationCheck(src('pages/cycles/validatePhone.js'), 'pages/cycles/validatePhone.js', verifyLine, [
    ["if (data?.parts?.can_write !== true) return null;", ''],
  ]);
  for (const Page of [CycleModulePage, PhoneModulePage]) {
    const props = { cycle: 'validate', slug: 'verdict', moduleName: 'Verdict', status: 'ready', records: verdictData(true).records, recordsStatus: 'ready', search: '?project_id=9' };
    const writer = ssr(h(Page, { ...props, data: verdictData(true) }));
    assert.match(writer, /data-testid="verdict-interview-line"[^>]*>3 new pieces of interview evidence since your last decision, 1 contradicting</, Page.name);
    const reader = ssr(h(Page, { ...props, data: verdictData(false) }));
    assert.doesNotMatch(reader, /interview evidence/, `${Page.name}: a reader sees no line`);
  }
});

const OPTIONS = {
  for: { options: [{ value: 'venture', label: 'The venture' }] },
  evidence: {
    bar: 5, suggested_evidence: ['pain-3-9', 'pain-4-2'],
    options: [
      { value: 'evidence-1', label: 'Pilot invoice · H2 · Measured' },
      { value: 'pain-3-9', label: 'Interview · H2 · Pattern' },
      { value: 'pain-4-2', label: 'Interview · H1 · Anecdote' },
    ],
  },
};

function verifyPreselect(m) {
  const out = m.withSuggestedEvidence(OPTIONS);
  assert.deepEqual(out.evidence.options.map((o) => o.checked === true), [false, true, true]);
  assert.equal(m.withSuggestedEvidence({ evidence: { options: OPTIONS.evidence.options } }).evidence.options.some((o) => o.checked), false, 'none suggested: none checked');
}

test('6: Record a decision starts with the new interview evidence checked, and the founder may untick it', async () => {
  verifyPreselect({ withSuggestedEvidence });
  await mutationCheck(src('pages/cycles/verdictForm.js'), 'pages/cycles/verdictForm.js', verifyPreselect, [
    ['{ ...o, checked: true }', '{ ...o }'],
    ['suggested.has(String(o?.value))', 'true'],
  ]);
  const saved = [];
  const m = await mountForm(h(FormLightbox, {
    form: verdictForm, cycle: 'validate', slug: 'verdict', moduleName: 'Verdict',
    loadOptions: (projectId) => verdictForm.loadOptions({ formOptions: async () => OPTIONS }, projectId),
    onSubmit: async (v) => { saved.push(v); }, onClose() {},
  }));
  try {
    await m.flush();
    const box = (value) => m.nodes().find((n) => n.tagName === 'INPUT' && propsOf(n).name === 'evidence' && propsOf(n).value === value);
    assert.deepEqual(['evidence-1', 'pain-3-9', 'pain-4-2'].map((v) => propsOf(box(v)).checked), [false, true, true]);
    assert.ok(m.text().includes('2 of 5 needed before a verdict is given.'));
    await m.choose('evidence', 'pain-4-2');
    assert.equal(propsOf(box('pain-4-2')).checked, false, 'the founder unticked it');
    await m.submit();
    assert.deepEqual(saved[0].evidence, ['pain-3-9']);
  } finally { await m.unmount(); }
});
