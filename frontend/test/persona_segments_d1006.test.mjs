/**
 * D1006 (#2821, part 9 of #2378) — Unclassified (SEG5), Edit segment and
 * Suggest a change (SEG6), Suggestions (SEG7) and the page-wide Activity
 * (SEG8). Mounted on a stubbed `fetch`; every name and value is invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/persona_segments_d1006.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { PersonaSegmentsPage } from '../src/pages/admin/segments/PersonaSegments.jsx';
import { SegmentPage } from '../src/pages/admin/segments/SegmentPage.jsx';
import { tabOf } from '../src/pages/admin/segments/segModel.js';
import { activityRow } from '../src/pages/admin/segments/segmentPageModel.js';
import {
  askView, askedLine, declineProblem, editChanges, editDraftOf, editProblem, suggestBody, suggestProblem, suggestionRow, unclassifiedParams, whyBars, whySummary,
} from '../src/pages/admin/segments/segmentWorkModel.js';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

const SEG = {
  key: 'angel_scout', name: 'Angel / Scout', profile: 'investor', status: 'active', version: 4,
  who: 'Individual angels writing small early checks.', typical: ['[Typical one]'],
  needs: [{ id: 'n1', text: 'Co-invest next to the studio.', answered_by: [{ kind: 'program', ref: 'co_invest' }] }, { id: 'n2', text: 'Deal flow.', answered_by: [] }],
  offers: { programs: [], perks: [], content: [] },
};
const ROWS = [
  { user_id: 7, name: '[Member A]', email: 'a@example.com', profile: 'founder', joined: '2026-10-01 10:00:00', last_active: null, why: 'not_started', asked_at: null },
  { user_id: 8, name: '[Member B]', email: 'b@example.com', profile: 'investor', joined: '2026-09-20T10:00:00Z', last_active: '2026-10-20T10:00:00Z', why: 'started', asked_at: new Date(Date.now() - 3 * 86400000).toISOString() },
];
const MEMBERS = { total: 2, page: 1, page_size: 25, rows: ROWS, why_counts: { not_started: 1, started: 1, not_offered: 0 }, unreadable: [] };
const SUGS = [
  { uid: 's1', segment_key: 'angel_scout', kind: 'need', text: 'Quarterly reporting in one place.', status: 'open', suggested_by_name: '[Admin B]', studio: 'hq', created_at: '2026-10-20T09:00:00Z' },
  { uid: 's2', segment_key: null, kind: 'new_segment', text: 'University spin-out teams.', status: 'declined', decline_reason: 'Spin-out Lab covers it.', suggested_by_name: '[Admin C]', studio: 'north', created_at: '2026-10-18T09:00:00Z' },
];

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the tabs: Activity and Suggestions are the page\'s, never a segment key', () => {
  assert.equal(tabOf('/admin/persona-segments/activity'), 'activity');
  assert.equal(tabOf('/admin/persona-segments/suggestions/'), 'suggestions');
  assert.equal(tabOf('/admin/persona-segments/angel_scout'), null);
  const app = read('frontend/src/App.jsx');
  // Mutation checked: drop the static route → /activity opens a segment called "activity".
  assert.match(app, /path="\/admin\/persona-segments\/activity" element=\{guard\(\['admin'\], <PersonaSegments \/>\)\}/);
  assert.match(app, /path="\/admin\/persona-segments\/suggestions" element=\{guard\(\['admin'\], <PersonaSegments \/>\)\}/);
  assert.ok(app.indexOf('/admin/persona-segments/activity"') < app.indexOf('/admin/persona-segments/:key"'));
});

test('Unclassified: the reasons, a reason the store could not read is Not recorded, never 0', () => {
  const bars = whyBars(MEMBERS);
  assert.deepEqual(bars.map((b) => [b.key, b.text]), [['not_started', '1'], ['started', '1'], ['not_offered', '0']]);
  // Mutation checked: `?? 0` → an unread reason reads as a measured zero.
  const partial = whyBars({ why_counts: { not_started: null, started: null, not_offered: 3 } });
  assert.deepEqual(partial.map((b) => b.text), ['Not recorded', 'Not recorded', '3']);
  assert.match(whySummary(MEMBERS), /^Of 2 members with no segment: 1 skipped the sign-up chat, 1 started, did not finish, 0 their profile has no segment yet\.$/);
  assert.match(whySummary({ total: 3, why_counts: { not_offered: 3 } }), /could not be read/);
  assert.deepEqual(unclassifiedParams({ q: 'a', why: 'started' }), { segment: 'none', why: 'started', q: undefined, profile: undefined, active: undefined, sort: 'joined', page: undefined });
});

test('Ask to finish: the 30-day rule skips who was asked recently, and the outcome in words', () => {
  const v = askView(ROWS);
  assert.match(v.notice, /We will send 2 members one notice/);
  // Mutation checked: count everyone → "Send to 2" while one is skipped.
  assert.equal(v.send, 'Send to 1');
  assert.match(v.rule, /1 had one recently and is skipped/);
  assert.equal(askView([ROWS[1]]).canSend, false);
  assert.equal(askedLine({ asked: 1, results: [{ outcome: 'asked' }, { outcome: 'asked_recently' }] }), '1 member was asked to finish their profile. 1 had been asked in the last 30 days.');
});

test('Edit segment: only what changed is sent, with the version read; a kept need keeps what answers it', () => {
  const d = editDraftOf(SEG);
  assert.equal(editChanges(SEG, d).body, null, 'nothing changed is nothing sent');
  const next = { ...d, status: 'draft', needs: 'Co-invest next to the studio.\nQuarterly reporting in one place.' };
  const c = editChanges(SEG, next);
  assert.equal(c.body.expected_version, 4);
  assert.equal(c.body.status, 'draft');
  assert.equal(c.body.name, undefined, 'an unchanged field is not sent');
  // Mutation checked: rebuild every need empty → a kept need loses what answers it.
  assert.deepEqual(c.body.needs[0], { id: 'n1', text: 'Co-invest next to the studio.', answered_by: [{ kind: 'program', ref: 'co_invest' }] });
  assert.deepEqual(c.body.needs[1], { text: 'Quarterly reporting in one place.', answered_by: [] });
  assert.ok(c.say.includes('Status goes from Active to Draft.'));
  assert.ok(c.say.includes('Need ‘Quarterly reporting in one place.’ is added, with nothing answering it yet.'));
  assert.ok(c.say.includes('Need ‘Deal flow.’ is removed.'));
  assert.equal(editProblem({ ...d, name: ' ' }), 'A segment needs a name.');
  assert.equal(editProblem({ ...d, needs: 'a\na' }), 'The same need is written twice.');
  assert.equal(editProblem(d), null);
});

test('Suggest a change and decline: their rules', () => {
  assert.equal(suggestProblem({ kind: 'need', segment_key: '', text: 'x' }), 'Pick the segment it is about.');
  assert.equal(suggestProblem({ kind: 'new_segment', segment_key: '', text: 'x' }), null);
  assert.deepEqual(suggestBody({ kind: 'new_segment', segment_key: 'angel_scout', text: ' New one ' }), { kind: 'new_segment', text: 'New one' });
  assert.deepEqual(suggestBody({ kind: 'offer', segment_key: 'angel_scout', text: 'x' }), { kind: 'offer', text: 'x', segment_key: 'angel_scout' });
  assert.equal(declineProblem('   '), 'Write one line the admin will read.');
  assert.equal(declineProblem('x'.repeat(201)), 'One line, at most 200 characters.');
  assert.equal(declineProblem('Perks already answers this.'), null);
  const r = suggestionRow(SUGS[1]);
  assert.equal(r.title, 'A new segment · A new segment');
  assert.equal(r.from, '[Admin C] · north');
  assert.equal(r.decline, 'Declined by HQ: ‘Spin-out Lab covers it.’');
  assert.equal(suggestionRow(SUGS[0], () => 'Angel / Scout').from, '[Admin B] · HQ-held');
});

test('the page-wide Activity names each move from and to', () => {
  const r = { kind: 'move', actor: { name: '[Admin A]' }, member: { name: '[Member C]' }, from: { key: 'a', name: 'Angel / Scout' }, to: { key: 'b', name: 'Corporate VC' }, at: '2026-10-18T10:42:00Z' };
  // Mutation checked: keep the segment wording with no key → "moved out to" on the page-wide list.
  assert.equal(activityRow(r, null).text, '[Admin A] moved [Member C] from Angel / Scout to Corporate VC.');
  assert.equal(activityRow(r, 'b').text, '[Admin A] moved [Member C] into Corporate VC from Angel / Scout.');
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function stub(over = {}) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url), 'http://x');
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path: u.pathname, search: u.search, body });
    const key = `${method} ${u.pathname}`;
    if (over[key]) return over[key](body, u);
    if (key === 'GET /api/personas/admin/segments') return json({ members: { available: true, no_segment: 2 } });
    if (key === 'GET /api/personas/admin/members') return json(MEMBERS);
    if (key === 'POST /api/personas/admin/members/ask-to-finish') return json({ results: body.user_ids.map((id) => ({ user_id: id, outcome: 'asked' })), asked: body.user_ids.length });
    if (key === 'GET /api/personas/segments') return json({ segments: [SEG] });
    if (key === 'GET /api/personas/segments/angel_scout') return json({ segment: SEG, history: [] });
    if (key === 'PATCH /api/personas/segments/angel_scout') return json({ segment: { ...SEG, version: 5 }, changed: Object.keys(body) });
    if (key === 'GET /api/personas/segments/suggestions') return json({ suggestions: SUGS, scope: 'all' });
    if (key === 'POST /api/personas/segments/suggestions') return json({ suggestion: { uid: 's9' }, notice: {} }, 201);
    if (key === 'POST /api/personas/segments/suggestions/s1/decide') return json({ suggestion: {}, edit: body.decision === 'accept' ? { segment_key: 'angel_scout', expected_version: 4, field: 'needs', text: 'Quarterly reporting in one place.' } : null, notice: {} });
    if (key === 'GET /api/personas/admin/activity') return json({ total: 1, page: 1, page_size: 25, sources: {}, rows: [{ kind: 'move', actor: { name: '[Admin A]' }, member: { name: '[Member C]' }, from: null, to: { key: 'angel_scout', name: 'Angel / Scout' }, at: '2026-10-18T10:42:00Z' }] });
    return json({});
  };
  return { calls, restore() { globalThis.fetch = original; } };
}

async function render(url, { superAdmin = false, page = 'segments' } = {}) {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const el = page === 'segment' ? h(SegmentPage, { superAdmin }) : h(PersonaSegmentsPage, { superAdmin });
  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null, h(Route, { path: '*', element: el }))));
  });
  const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byId = (id) => walk(container).find((n) => props(n)?.['data-testid'] === id);
  return {
    of: (id) => { const n = byId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    has: (id) => Boolean(byId(id)),
    props: (id) => props(byId(id)),
    async click(id) { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    async change(id, value, checked) { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onChange?.({ target: { value, checked } }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

test('SEG5 mounted: the reasons, the list with joined and last active, and Ask to finish after its dialog', async () => {
  const s = stub();
  const v = await render('/admin/persona-segments/unclassified');
  try {
    assert.ok(s.calls.some((c) => c.path === '/api/personas/admin/members' && c.search.includes('segment=none')), 'reads the members with no segment');
    assert.match(v.of('seg-why-not_started'), /Skipped the sign-up chat\s*1/);
    assert.match(v.of('seg-unc-row-7'), /\[Member A\].*Founders.*1 Oct 2026.*Never.*Skipped the sign-up chat/s);
    assert.match(v.of('seg-unc-row-8'), /Asked /);
    await v.click('seg-why-started');
    assert.ok(s.calls.some((c) => c.path === '/api/personas/admin/members' && c.search.includes('why=started')), 'a reason filters the list');
    await v.change('seg-unc-pick-7', null, true);
    await v.change('seg-unc-pick-8', null, true);
    await v.click('seg-unc-ask');
    // Mutation checked: send on the bar's button → a notice with no dialog.
    assert.ok(!s.calls.some((c) => c.path.endsWith('/ask-to-finish')));
    assert.match(v.of('seg-ask-rule'), /1 had one recently and is skipped/);
    await v.click('seg-ask-send');
    assert.deepEqual(s.calls.find((c) => c.path.endsWith('/ask-to-finish')).body, { user_ids: [7, 8] });
    assert.match(v.of('seg-unc-done'), /2 members were asked/);
  } finally { await v.unmount(); s.restore(); }
});

test('SEG5 mounted: a failed read says so and is never "everyone has a segment"', async () => {
  const s = stub({ 'GET /api/personas/admin/members': () => json({ error: 'members_unreadable' }, 503) });
  const v = await render('/admin/persona-segments/unclassified');
  try {
    assert.match(v.of('seg-why-failed'), /could not be read\. That is not the same as none\./);
    assert.ok(!v.has('seg-unc-none'));
  } finally { await v.unmount(); s.restore(); }
});

test('SEG6 mounted: a Super Admin edits in a lightbox, confirms what changes, and the PATCH carries the version', async () => {
  const s = stub();
  const v = await render('/admin/persona-segments/angel_scout', { superAdmin: true, page: 'segment' });
  try {
    await v.click('seg-page-edit');
    assert.ok(v.has('seg-edit'));
    // D1317: a segment's editor is the shared Sheet (620 → 640px); its confirmation stays centred.
    assert.equal(v.props('seg-edit').role, 'dialog');
    assert.ok(v.props('seg-edit')['aria-labelledby']);
    assert.equal(v.props('seg-edit')['data-width'], 640);
    assert.equal(v.props('seg-edit-next').disabled, true, 'nothing changed, nothing to save');
    await v.change('seg-edit-status-draft', 'draft', true);
    await v.click('seg-edit-next');
    assert.equal(v.props('seg-edit-confirm')['data-width'], undefined, 'the confirmation is the centred lightbox');
    // Mutation checked: save on the form's button → a write with no confirm.
    assert.ok(!s.calls.some((c) => c.method === 'PATCH'));
    assert.match(v.of('seg-edit-changes'), /Status goes from Active to Draft\./);
    await v.click('seg-edit-save');
    assert.deepEqual(s.calls.find((c) => c.method === 'PATCH').body, { expected_version: 4, status: 'draft' });
    assert.match(v.of('seg-page-moved'), /Saved\. The segment profile is changed for every studio\./);
  } finally { await v.unmount(); s.restore(); }
});

test('SEG6 mounted: an Admin suggests a change instead, and it says HQ answers on Activity', async () => {
  const s = stub();
  const v = await render('/admin/persona-segments/angel_scout', { page: 'segment' });
  try {
    assert.ok(!v.has('seg-page-edit'), 'an Admin cannot edit');
    await v.click('seg-page-suggest');
    await v.click('seg-suggest-kind-offer');
    await v.change('seg-suggest-text', 'A co-invest club.');
    await v.click('seg-suggest-send');
    assert.deepEqual(s.calls.find((c) => c.method === 'POST' && c.path === '/api/personas/segments/suggestions').body, { kind: 'offer', text: 'A co-invest club.', segment_key: 'angel_scout' });
    assert.match(v.of('seg-page-moved'), /HQ answers on the Activity tab/);
  } finally { await v.unmount(); s.restore(); }
});

test('SEG7 mounted: Accept opens Edit segment filled in; Decline needs its line', async () => {
  const s = stub();
  const v = await render('/admin/persona-segments/suggestions', { superAdmin: true });
  try {
    assert.ok(v.has('seg-tab-suggestions'));
    assert.match(v.of('seg-suggestion-s1'), /Angel \/ Scout · A need.*Quarterly reporting/s);
    await v.click('seg-decline-s1');
    assert.equal(v.props('seg-decline-send').disabled, true);
    await v.change('seg-decline-reason', 'Perks already answers this.');
    await v.click('seg-decline-send');
    assert.deepEqual(s.calls.find((c) => c.path.endsWith('/s1/decide')).body, { decision: 'decline', reason: 'Perks already answers this.' });
    await v.click('seg-accept-s1');
    assert.ok(v.has('seg-edit'), 'Accept opens Edit segment');
    assert.match(String(v.props('seg-edit-needs').value), /Quarterly reporting in one place\./, 'filled in from the edit target');
  } finally { await v.unmount(); s.restore(); }
  const admin = await render('/admin/persona-segments/suggestions');
  try {
    assert.ok(!admin.has('seg-tab-suggestions'), 'an Admin has no Suggestions tab');
    assert.ok(admin.has('seg-suggestions-refused'));
  } finally { await admin.unmount(); }
});

test('SEG8 mounted: the page-wide Activity, and an Admin\'s own suggestions under it', async () => {
  const s = stub();
  const v = await render('/admin/persona-segments/activity');
  try {
    assert.ok(s.calls.some((c) => c.path === '/api/personas/admin/activity' && !c.search.includes('segment=')), 'every segment\'s activity');
    assert.match(v.of('seg-page-activity-list'), /\[Admin A\] moved \[Member C\] to Angel \/ Scout\./);
    assert.match(v.of('seg-activity-suggestions'), /Your suggestions/);
    assert.match(v.of('seg-activity-suggestions'), /Declined by HQ: ‘Spin-out Lab covers it\.’/);
  } finally { await v.unmount(); s.restore(); }
});

test('the source keeps the house rules: no browser pop-up, no answer shown', () => {
  const src = read('frontend/src/pages/admin/segments/SegmentWork.jsx').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(src, /window\.(alert|confirm|prompt)\(|\b(alert|confirm)\(/);
  assert.doesNotMatch(src, /\banswers?\(/, 'no member answer read here');
});
