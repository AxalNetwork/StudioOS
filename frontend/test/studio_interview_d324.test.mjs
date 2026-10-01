/**
 * D324 — every Studio home collapses Eadwyn to one row once the interview is
 * complete, and the assessment band's empty state is one designed card.
 *
 * The row and its helpers are rendered here. StudioInterview.jsx (the wrapper)
 * and the five homes mount PersonalAdvisor, whose imports reach Worker
 * modules, so their wiring is pinned in source.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  InterviewCompleteRow, STUDIO_CHAT_ANCHOR, interviewSummary, topProposals,
} from '../src/components/advisor/interviewCompleteRow.jsx';
import { AssessmentNotStartedCard, assessmentNotStarted } from '../src/components/profile/ProfileFitSection.jsx';
import { CHAT_ANCHOR } from '../src/pages/admin/StudioPosture.jsx';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), 'utf8');
const html = (el) => renderToStaticMarkup(createElement(MemoryRouter, null, el));
const text = (el) => renderedText(html(el));

// ── What the server says about the interview ────────────────────────────────

test('interviewSummary reads the canonical `overall` block, and the flat fields only without it', () => {
  const s = interviewSummary({
    overall: { total: 14, answered: 12, skipped: 2, percent: 100, complete: true },
    total: 99, answered: 0, complete: false,
  });
  assert.deepEqual(s, { complete: true, total: 14, answered: 12, skipped: 2, percent: 100 });
  const flat = interviewSummary({ total: 14, answered: 14, skipped: 0, percent: 100, complete: true });
  assert.equal(flat.complete, true);
  assert.equal(flat.total, 14);
});

test('only the server saying complete collapses the chat; a partial or failed read never does', () => {
  assert.equal(interviewSummary({ overall: { total: 14, answered: 14, percent: 100 } }).complete, false, 'no complete flag, no collapse');
  assert.equal(interviewSummary({ overall: { complete: 'true' } }).complete, false, 'a truthy string is not the flag');
  assert.equal(interviewSummary(null), null);
  const blank = interviewSummary({ overall: { complete: true, total: null, answered: '' } });
  assert.equal(blank.total, null, 'an absent total stays absent');
  assert.equal(blank.answered, null);
});

// ── The top three open proposals ────────────────────────────────────────────

const QUEUE = {
  queue: [
    { id: 'q1', prompt: 'Set an intro call filter', page_target: '/expertise/profile', importance: 'high' },
    { id: 'q2', prompt: 'Consent to show client outcomes', page_target: null, importance: 'normal' },
    { id: 'q3', prompt: 'Session-note auto-send', page_target: '/account', importance: 'normal' },
    { id: 'q4', prompt: 'A fourth proposal', page_target: '/x', importance: 'normal' },
  ],
};
const resolve = {
  predictTarget: (id) => (id === 'q2' ? { page_target: '/advisor/advisory/clients', label: 'Consent' } : null),
  pageLabel: (to) => ({ '/expertise/profile': 'Storefront', '/advisor/advisory/clients': 'Clients', '/account': 'Settings' }[to] || to),
};

test('topProposals keeps the Worker ranking, takes three, and finds each page', () => {
  const top = topProposals(QUEUE, resolve);
  assert.deepEqual(top.map((p) => p.id), ['q1', 'q2', 'q3'], 'the queue order, not re-sorted, and only three');
  assert.equal(top[0].to, '/expertise/profile');
  assert.equal(top[0].label, 'Storefront');
  assert.equal(top[0].high, true);
  assert.equal(top[1].to, '/advisor/advisory/clients', 'a question with no page_target falls back to the catalogue');
  assert.equal(top[1].label, 'Clients');
  assert.equal(top[2].high, false);
});

test('topProposals: an empty queue is a real none, and a payload that is not a queue is not', () => {
  assert.deepEqual(topProposals({ queue: [] }), []);
  assert.equal(topProposals({}), null);
  assert.equal(topProposals(null), null);
  assert.deepEqual(topProposals({ queue: [{ id: 'x', prompt: '   ' }] }), [], 'a proposal with no words is dropped');
});

// ── The row ─────────────────────────────────────────────────────────────────

const summary = interviewSummary({ overall: { total: 14, answered: 14, skipped: 0, percent: 100, complete: true } });
const row = (proposals, extra = {}) => createElement(InterviewCompleteRow, {
  persona: 'advisor', summary, proposals, onResume: () => {}, onOpenTicket: () => {}, onRetryProposals: () => {}, ...extra,
});

test('the row says who, how much, and that the interview is complete', () => {
  const t = text(row({ state: 'ready', items: [] }));
  assert.match(t, /Eadwyn/);
  assert.match(t, /advisor · 14\/14 answered \(100%\) · interview complete/);
  const skipped = interviewSummary({ overall: { total: 14, answered: 12, skipped: 2, percent: 100, complete: true } });
  assert.match(text(row({ state: 'ready', items: [] }, { summary: skipped })), /12\/14 answered \(100%\) · 2 skipped · interview complete/);
});

test('the row draws the three proposals as links to their pages, and offers a ticket and Resume', () => {
  const markup = html(row({ state: 'ready', items: topProposals(QUEUE, resolve) }));
  const t = renderedText(markup);
  assert.match(t, /Set an intro call filter — Open Storefront →/);
  assert.match(t, /Consent to show client outcomes — Open Clients →/);
  assert.match(t, /Session-note auto-send — Open Settings →/);
  assert.doesNotMatch(t, /A fourth proposal/);
  assert.match(markup, /href="\/expertise\/profile"/);
  assert.match(t, /High ·/, 'a high-importance proposal is marked');
  assert.match(t, /Open a ticket/);
  assert.match(t, /Resume/);
});

test('with no open proposals the row says so; a failed read says it failed, with a retry', () => {
  assert.match(text(row({ state: 'ready', items: [] })), /No open proposals\./);
  const failed = text(row({ state: 'unreadable', items: [] }));
  assert.match(failed, /Eadwyn's open proposals could not be read\. This is not a claim that none are open\./);
  assert.match(failed, /Retry/);
  assert.doesNotMatch(failed, /No open proposals/);
  assert.match(text(row({ state: 'loading', items: [] })), /Loading open proposals/);
});

// ── The wrapper, and the five homes ─────────────────────────────────────────

test('StudioInterview reads progress and the queue, collapses only on a complete interview, and reopens to the ticket', () => {
  const src = codeOnly(read('components/advisor/StudioInterview.jsx'));
  assert.match(src, /api\.advisor\.progress\(\)/);
  assert.match(src, /api\.advisor\.queue\(\)/);
  assert.match(src, /const collapsed = summary\?\.complete === true && !reopened;/);
  assert.match(src, /onOpenTicket=\{\(\) => setReopened\('ticket'\)\}/);
  assert.match(src, /initialTicketOpen=\{reopened === 'ticket'\}/);
  assert.match(src, /<div id=\{STUDIO_CHAT_ANCHOR\}/);
  assert.match(src, /items \? \{ state: 'ready', items \} : \{ state: 'unreadable', items: \[\] \}/, 'a malformed queue is unreadable, not empty');
});

test('PersonalAdvisor can open with the ticket form already open, and defaults to closed', () => {
  const src = codeOnly(read('components/advisor/PersonalAdvisor.jsx'));
  assert.match(src, /initialTicketOpen = false/);
  assert.match(src, /const \[ticketOpen, setTicketOpen\] = useState\(initialTicketOpen\);/);
});

test('all five Studio homes mount Eadwyn through StudioInterview, once, and none mounts the chat directly', () => {
  const homes = {
    founder: 'pages/founder/FounderStudioHome.jsx',
    investor: 'pages/investor/InvestorStudioHome.jsx',
    advisor: 'pages/advisor/AdvisorStudioHome.jsx',
    partner: 'pages/partner/PartnerStudioHome.jsx',
    admin: 'pages/admin/AdminStudioHome.jsx',
  };
  for (const [persona, rel] of Object.entries(homes)) {
    const src = codeOnly(read(rel));
    assert.equal((src.match(/<StudioInterview\b/g) || []).length, 1, `${rel} mounts StudioInterview once`);
    assert.match(src, new RegExp(`<StudioInterview persona="${persona}"`), `${rel} names its persona`);
    assert.doesNotMatch(src, /<PersonalAdvisor\b/, `${rel} still mounts the chat directly`);
  }
});

test('the advisor home no longer hard-codes proposals or keeps its own collapse', () => {
  const src = codeOnly(read('pages/advisor/AdvisorStudioHome.jsx'));
  for (const gone of ['Intro call filter', 'Session-note auto-send', 'advisor-evidence-strip', 'assistantProgress', 'interviewComplete']) {
    assert.ok(!src.includes(gone), `${gone} is still in the advisor home`);
  }
});

test('the chat anchor is defined once, and the admin posture links to it', () => {
  assert.equal(STUDIO_CHAT_ANCHOR, 'studio-chat');
  assert.equal(CHAT_ANCHOR, STUDIO_CHAT_ANCHOR);
});

// ── The band's empty state ──────────────────────────────────────────────────

const empty = {
  radar: { data: { axes: [{ slug: 'a', score: 0, skill_count: 0 }] }, error: '' },
  values: { data: { vector: [{ dimension_slug: 'v', confidence: 0 }] }, error: '' },
  results: { data: { results: [] }, error: '' },
  fit: { data: { archetype: null }, error: '' },
};

test('assessmentNotStarted is true only when every read answered and every one is empty', () => {
  assert.equal(assessmentNotStarted(empty), true);
  assert.equal(assessmentNotStarted({ ...empty, radar: { data: null, error: '' } }), false, 'a read still loading is not "not started"');
  assert.equal(assessmentNotStarted({ ...empty, values: { data: null, error: 'boom' } }), false, 'a failed read is not "not started"');
  assert.equal(assessmentNotStarted({ ...empty, radar: { data: { axes: [{ score: 40 }] }, error: '' } }), false);
  assert.equal(assessmentNotStarted({ ...empty, values: { data: { vector: [{ confidence: 0.2 }] }, error: '' } }), false);
  assert.equal(assessmentNotStarted({ ...empty, results: { data: { results: [{ archetype_slug: 'x' }] }, error: '' } }), false);
  assert.equal(assessmentNotStarted({ ...empty, fit: { data: { archetype: { slug: 'x' } }, error: '' } }), false);
});

test('the empty card says the assessment has not started and offers one action, to the chat', () => {
  const markup = html(createElement(AssessmentNotStartedCard, { audience: 'partner' }));
  const t = renderedText(markup);
  assert.match(t, /Assessment not started/);
  assert.match(t, /the chat above, a few at a time/);
  assert.equal((markup.match(/<a\b/g) || []).length, 1, 'one action');
  assert.match(markup, /href="#studio-chat"[^>]*>Begin with the chat</);
  assert.match(markup, /data-testid="partner-assessment-empty"/);
});

test('the Studio band draws the empty card in place of the three cards when nothing has started', () => {
  const src = codeOnly(read('components/profile/ProfileFitSection.jsx'));
  assert.match(src, /assessmentNotStarted\(\{ radar, values, results, fit \}\) \? \(\s*<div data-testid=\{`\$\{audience\}-assessment-band`\}><AssessmentNotStartedCard audience=\{audience\} \/><\/div>/);
});
