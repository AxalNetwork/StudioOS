/**
 * D3701 (Research v2, #3701), part 2 — the RS-01 Overview: the house header,
 * a question whose examples fill the field and never run, and cards that each
 * read, fail and retry on their own. Projects and briefs have no store, so
 * they say Not recorded with the reason.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_v2_overview_3701.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { readFileSync } from 'node:fs';
import ResearchHome from '../src/pages/research/ResearchHome.jsx';
import FounderResearchDesk from '../src/pages/founder/FounderResearchDesk.jsx';
import { api } from '../src/lib/api.js';
import {
  EXAMPLES, NOT_RECORDED_REASONS, briefsCard, continueCard, evidenceCard, projectsCard, shortDate, trackingCard,
} from '../src/pages/research/researchHome.js';
import { codeOnly } from './_codeOnly.mjs';
import { mountContracts } from './_contracts_dom.mjs';

const h = React.createElement;
const ok = (value) => ({ status: 'ok', value });
const byTid = (ui, id) => ui.nodes().find((n) => ui.props(n)?.['data-testid'] === id) || null;
const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');

test('each card is loading, unreadable or ok — a failed read is never an empty list', () => {
  for (const card of [continueCard, evidenceCard, trackingCard]) {
    assert.equal(card(undefined).state, 'loading');
    assert.equal(card({ status: 'loading' }).state, 'loading');
    // Mutation checked: drop the `failed` branch → a failed read reads as ok with no rows.
    assert.equal(card({ status: 'failed' }).state, 'unreadable', card.name);
  }
  assert.deepEqual(continueCard(ok({ items: [] })), { state: 'ok', last: null });
  assert.deepEqual(evidenceCard(ok({ items: [] })).rows, []);
});

test('Continue is the newest Ask exchange; projects and briefs are Not recorded, with the reason', () => {
  const c = continueCard(ok({ items: [
    { question: 'Newest', reason: 'no_source', created_at: '2026-11-08 10:00:00' },
    { question: 'Older', reason: 'answered', created_at: '2026-11-01 10:00:00' },
  ] }));
  assert.deepEqual(c.last, { question: 'Newest', at: '2026-11-08 10:00:00', answered: false });
  assert.deepEqual(projectsCard(), { state: 'not_recorded', reason: NOT_RECORDED_REASONS.projects });
  assert.equal(briefsCard().state, 'not_recorded');
  assert.match(NOT_RECORDED_REASONS.projects, /not stored yet/);
});

test('recent evidence is newest first, three rows, each with index state and answerability apart', () => {
  const items = [
    { uid: 'a', title: 'A', created_at: '2026-11-01', index_state: 'indexed', in_ask: true },
    { uid: 'c', title: 'C', created_at: '2026-11-07', index_state: 'pending', in_ask: false },
    { uid: 'b', title: 'B', created_at: '2026-11-05', index_state: 'indexed', in_ask: false, source: 'client' },
    { uid: 'd', title: 'D', created_at: '2026-10-01', index_state: 'failed', in_ask: false },
  ];
  const e = evidenceCard(ok({ items }));
  // Mutation checked: drop the sort → the rows come back in the payload's order.
  assert.deepEqual(e.rows.map((r) => r.uid), ['c', 'b', 'a']);
  assert.equal(e.total, 4);
  const b = e.rows.find((r) => r.uid === 'b');
  assert.deepEqual([b.index.label, b.answer.label], ['Indexed', 'Not answerable']);
});

test('tracking lists the funds on the list and says markets and companies are not tracked', () => {
  const t = trackingCard(ok({ items: [{ uid: 'f 1', name: 'Northwind Seed' }, { uid: 'x', name: '' }] }));
  assert.deepEqual(t.chips, [{ key: 'f 1', label: 'Fund · Northwind Seed', to: '/research/funds/f%201' }]);
  assert.equal(t.other, NOT_RECORDED_REASONS.trackingOther);
});

test('a missing or broken date is Not recorded, never today', () => {
  assert.equal(shortDate(null), 'Date not recorded');
  assert.equal(shortDate('not a date'), 'Date not recorded');
  assert.equal(shortDate('2026-11-08 10:00:00'), '8 Nov 2026');
});

function stub(over) {
  const real = { askSessions: api.research.askSessions, documents: api.research.documents, funds: api.research.funds };
  const calls = { askSessions: 0 };
  api.research.askSessions = over.askSessions || (async () => ({ items: [] }));
  const wrapAsk = api.research.askSessions;
  api.research.askSessions = async (...a) => { calls.askSessions += 1; return wrapAsk(...a); };
  api.research.documents = over.documents || (async () => ({ items: [] }));
  api.research.funds = over.funds || (async () => ({ items: [] }));
  return { calls, restore() { Object.assign(api.research, real); } };
}
const settle = async (m) => { for (let i = 0; i < 4; i += 1) await m.flush(); };

test('one unreadable card retries alone, and the others still draw', async () => {
  let fail = true;
  const s = stub({
    askSessions: async () => { if (fail) throw new Error('down'); return { items: [{ question: 'Which SOWs cap revisions?', reason: 'answered', created_at: '2026-11-08 10:00:00' }] }; },
    documents: async () => ({ items: [{ uid: 'a', title: 'EU Data Act', created_at: '2026-11-08', index_state: 'indexed', in_ask: true }] }),
  });
  const m = await mountContracts(h(ResearchHome), '/research');
  try {
    await settle(m);
    assert.match(textOf(byTid(m, 'rh-continue')), /Could not be read/);
    assert.doesNotMatch(textOf(byTid(m, 'rh-continue')), /Nothing to continue yet/, 'a failed read is not an empty history');
    assert.match(textOf(byTid(m, 'rh-evidence-a')), /EU Data Act.*✓ Indexed.*✓ Answerable/);
    assert.match(textOf(byTid(m, 'rh-projects')), /Not recorded.*Research projects are not stored yet/);
    assert.match(textOf(byTid(m, 'rh-briefs')), /Not recorded/);
    const before = s.calls.askSessions;
    fail = false;
    await act(async () => { m.props(byTid(m, 'rh-continue-retry')).onClick(); });
    await settle(m);
    // Mutation checked: Retry wired to nothing → the card stays unreadable.
    assert.equal(s.calls.askSessions, before + 1, 'Retry reads that card again');
    assert.match(textOf(byTid(m, 'rh-continue-question')), /Which SOWs cap revisions\?/);
  } finally { await m.unmount(); s.restore(); }
});

test('the desk: an example fills the question and never runs it; operational detail is collapsed', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  const realAsk = api.research.ask;
  const asked = [];
  api.research.ask = async (...a) => { asked.push(a); return {}; };
  const oldMedia = globalThis.matchMedia;
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const m = await mountContracts(h(FounderResearchDesk), '/research', { id: 1, role: 'founder' });
  try {
    await settle(m);
    await act(async () => { m.props(byTid(m, 'button-research-example-0')).onClick(); });
    await settle(m);
    assert.equal(m.props(byTid(m, 'input-research-question')).value, EXAMPLES[0], 'the example fills the field');
    // Mutation checked: the example calls `api.research.ask(text)` → a question is sent without a press.
    assert.equal(asked.length, 0, 'an example never runs');
    assert.match(textOf(byTid(m, 'button-research-ask')), /Start research/);
    assert.ok(byTid(m, 'button-new-research'), 'the violet primary is on the page');
    assert.ok(byTid(m, 'research-home'));
    const coverage = byTid(m, 'research-source-coverage');
    assert.equal(coverage?.tagName, 'DETAILS', 'operational detail sits in a collapsed panel');
    assert.equal(m.props(coverage).open, undefined, 'collapsed by default');
  } finally {
    await m.unmount(); globalThis.fetch = realFetch; api.research.ask = realAsk; globalThis.matchMedia = oldMedia;
  }
});

test('the header carries one violet primary and the shared Ask', () => {
  const desk = codeOnly(readFileSync('frontend/src/pages/founder/FounderResearchDesk.jsx', 'utf8'));
  assert.equal((desk.match(/className="rh-primary"/g) || []).length, 1, 'one primary action on the header');
  assert.match(desk, /<HeaderAsk \/>/);
  assert.match(desk, /<h1>Research with evidence, not assumptions<\/h1>/);
});
