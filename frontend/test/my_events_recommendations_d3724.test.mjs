// D3724 (#3724 Part D and the NE2 cover step): My events' "Recommended for
// you" with Why this?, Not for me and Tune, behind the adapter (wired to the
// routes by #4738, see my_events_recommendations_4738.test.mjs); and the
// editor's cover step.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/my_events_recommendations_d3724.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { h, mountForm } from './_form_d695.mjs';
import RecommendedRow from '../src/pages/events/RecommendedRow.jsx';
import EventCoverStep from '../src/pages/events/EventCoverStep.jsx';
import * as adapter from '../src/pages/events/recommendationsAdapter.js';
import {
  EMPTY_LINE, ERROR_LINE, EXPLORER_REASON, FEW_LINE, GOALS_TOO_LONG, NOT_ON, NOT_RECORDED, OFF_LINE,
  checkPrefs, explainQuoteLine, reasonsOf, registerState, rowState, signalWord, travelWords,
} from '../src/pages/events/recommendationsModel.js';
import { COVER_RULE, TOO_SMALL, WRONG_TYPE, checkCoverFile, coverPrompt } from '../src/pages/events/eventCoverModel.js';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const ready = (events, extra = {}) => ({ status: 'ready', data: { available: true, value: { enabled: true, profile: 'founder', signals: { interests: 'read', goals: 'not_recorded', travel_km: 'unreadable' }, events, ...extra } } });
const EV = [
  { id: 7, slug: 'pricing', title: 'Pricing Workshop', starts_at: '2026-12-02T18:00:00Z', registration_eligible: true, saved: false, reasons: [{ code: 'raise_round', text: 'You have a Seed round open.' }] },
  { id: 8, title: 'Operators Social', starts_at: '2026-12-09T18:00:00Z', reasons: [] },
];

test('the row\'s state: every answer is named, and none is "empty" unless the Worker said so', () => {
  assert.equal(rowState(null).kind, 'loading');
  assert.equal(rowState({ status: 'error' }).line, ERROR_LINE);
  assert.deepEqual(rowState({ status: 'ready', data: { available: false, reason: 'Recommendations aren’t switched on yet.' } }), { kind: 'not_on', line: 'Recommendations aren’t switched on yet.' });
  assert.equal(rowState({ status: 'ready', data: { available: false } }).line, NOT_ON);
  assert.equal(rowState({ status: 'ready', data: { available: true, value: { enabled: false, events: [] } } }).line, OFF_LINE);
  assert.equal(rowState({ status: 'ready', data: { available: true, value: { enabled: true } } }).kind, 'error', 'a reply with no list is not an empty list');
  assert.equal(rowState(ready([], { signals: { interests: 'not_recorded', goals: 'not_recorded' } })).line, FEW_LINE);
  assert.equal(rowState(ready([], { signals: { interests: 'read' } })).line, EMPTY_LINE);
  assert.equal(rowState(ready(EV)).kind, 'ready');
});

test('reasons are the stored words; a missing figure is Not recorded, never 0', () => {
  assert.deepEqual(reasonsOf(EV[0]), ['You have a Seed round open.']);
  assert.deepEqual(reasonsOf(EV[1]), []);
  assert.deepEqual(reasonsOf(EV[1], { explorer: true }), [EXPLORER_REASON]);
  assert.equal(signalWord('read'), 'Used');
  assert.equal(signalWord('not_recorded'), NOT_RECORDED);
  assert.equal(signalWord(undefined), NOT_RECORDED);
  assert.equal(signalWord('unreadable'), 'Could not be read');
  assert.equal(travelWords(''), NOT_RECORDED);
  assert.equal(travelWords(null), NOT_RECORDED);
  assert.equal(travelWords(0), '0 km', 'a recorded zero is a zero');
  assert.equal(explainQuoteLine(null), 'Price not recorded');
  assert.equal(explainQuoteLine({ microusd: 40000 }), 'Costs $0.04 from your AI tokens');
  assert.equal(registerState({ registration_eligible: false }, true).line, 'Not open to Explorers');
  assert.equal(registerState({}).line, 'Eligibility not recorded');
  assert.equal(registerState({ registration_eligible: true, full: true }).line, 'Join the waitlist');
  assert.equal(checkPrefs({ goals: 'x'.repeat(501) }).error, GOALS_TOO_LONG);
  assert.equal(checkPrefs({ goals: 'x'.repeat(500) }).ok, true);
  assert.equal(checkPrefs({ travel_km: 'far' }).field, 'travel_km');
});

test('the owner\'s five questions are decided (D1487): D3724 points to it, and no screen says "pending owner"', () => {
  const d = read('documentation/architecture/decisions/D3724.md');
  assert.match(d, /^## D3724 — .+ \(#3724\)$/m);
  assert.match(d, /### The owner's questions \(decided, D1487\)/);
  assert.doesNotMatch(d, /Pending owner \|/);
  assert.match(d, /## §gaps/);
  const model = read('frontend/src/pages/events/recommendationsModel.js');
  assert.doesNotMatch(model, /PENDING_OWNER|PENDING_WORD|Pending owner/);
  assert.doesNotMatch(read('frontend/src/pages/events/recommendationsAdapter.js'), /not on main yet/);
  assert.doesNotMatch(model, /not on main\s+\* yet|not on main yet/);
  assert.match(read('documentation/architecture/decisions/D1487.md'), /owner confirmed S1's defaults on 2026-11-04/);
});

test('not available: one line, then today\'s Suggested card, nothing faked', () => {
  const html = renderToStaticMarkup(h(MemoryRouter, null, h(RecommendedRow, {
    read: { status: 'ready', data: { available: false, reason: NOT_ON } },
    fallback: h('section', { 'data-testid': 'my-events-suggested' }, 'Suggested for you'),
  })));
  assert.match(html, /data-state="not_on"/);
  assert.match(html, /Recommendations aren’t available right now\./);
  assert.match(html, /data-testid="my-events-suggested"/);
  assert.doesNotMatch(html, /my-events-recommended-card/);
});

test('a failed read is Unreadable with Retry, never an empty row', () => {
  const html = renderToStaticMarkup(h(MemoryRouter, null, h(RecommendedRow, { read: { status: 'error', reload: () => {} }, fallback: h('i', null, 'fallback') })));
  assert.match(html, /data-state="error"/);
  assert.match(html, /That is not the same as having none\./);
  assert.match(html, /Try again|Retry/);
});

test('ready: cards with Register, Save, Not for me and Why this?; Why this is free and prices Explain before it runs', async () => {
  const calls = [];
  const act = {
    feedback: async (id, body) => { calls.push(['feedback', id, body]); return { available: true, value: { verdict: body.verdict } }; },
    explainQuote: async (id) => { calls.push(['quote', id]); return { available: true, value: { microusd: 40000, quote_uid: 'q-1' } }; },
    explain: async (id, uid) => { calls.push(['explain', id, uid]); return { available: true, value: { text: 'It matches your round.' } }; },
    savePrefs: async (p) => { calls.push(['prefs', p]); return { available: true, value: p }; },
  };
  const ui = await mountForm(h(RecommendedRow, { read: ready(EV), act }), { modal: true });
  try {
    assert.equal(ui.nodes().filter((n) => ui.props(n)['data-testid'] === 'my-events-recommended-card').length, 2);
    assert.match(ui.text(), /You have a Seed round open\./);
    assert.match(ui.text(), /Eligibility not recorded/, 'an unread eligibility is said');
    await ui.click('Why this?');
    assert.match(ui.text(), /Why you’re seeing this/);
    assert.match(ui.text(), /Reading them is free/);
    assert.deepEqual(calls, [], 'opening Why this? runs nothing');
    await ui.click('See the cost');
    assert.match(ui.text(), /Costs \$0\.04 from your AI tokens/);
    assert.deepEqual(calls.map((c) => c[0]), ['quote'], 'the quote runs nothing else');
    await ui.click('Ask Eadwyn');
    assert.match(ui.text(), /It matches your round\./);
    assert.deepEqual(calls.map((c) => c[0]), ['quote', 'explain']);
    assert.deepEqual(calls[1], ['explain', 7, 'q-1'], 'Explain runs with the quote that was shown');
    assert.doesNotMatch(ui.text(), /question \d on #3724|Pending owner/);
  } finally { await ui.unmount(); }
});

test('Not for me: a reason chip, hidden with Undo; the host never sees it', async () => {
  const calls = [];
  const act = { feedback: async (id, body) => { calls.push([id, body]); return { available: true, value: {} }; } };
  const ui = await mountForm(h(RecommendedRow, { read: ready(EV), act }), { modal: true });
  try {
    await ui.click('Not for me');
    assert.match(ui.text(), /The host never sees this\./);
    await ui.click('Timing');
    await ui.click('Hide it');
    assert.deepEqual(calls, [[7, { verdict: 'not_for_me', reason: 'timing' }]]);
    assert.match(ui.text(), /Hidden\. Fewer like this\./);
    assert.equal(ui.nodes().filter((n) => ui.props(n)['data-testid'] === 'my-events-recommended-card').length, 1);
    await ui.click('Undo');
    assert.deepEqual(calls[1], [7, { verdict: null }]);
    assert.equal(ui.nodes().filter((n) => ui.props(n)['data-testid'] === 'my-events-recommended-card').length, 2);
  } finally { await ui.unmount(); }
});

test('Tune: goals over 500 are refused before sending; signals read Not recorded; the adapter\'s refusal is shown', async () => {
  const sent = [];
  const writes = { savePrefs: async (p) => { sent.push(p); return adapter.unavailable('Sign in again to save.'); } };
  const ui = await mountForm(h(RecommendedRow, { read: ready(EV), act: writes }), { modal: true });
  try {
    await ui.click('Tune recommendations');
    assert.match(ui.text(), /GoalsNot recorded/);
    assert.match(ui.text(), /Travel rangeCould not be read/);
    assert.doesNotMatch(ui.text(), /Pending owner|five questions/);
    const goals = ui.nodes().find((n) => n.tagName === 'TEXTAREA');
    await act(async () => ui.props(goals).onChange({ target: { value: 'x'.repeat(501) } }));
    await ui.click('Save preferences');
    assert.match(ui.text(), /Goals can be at most 500 characters\./);
    assert.equal(sent.length, 0);
    await act(async () => ui.props(ui.nodes().find((n) => n.tagName === 'TEXTAREA')).onChange({ target: { value: 'Raise a seed round' } }));
    await ui.click('Save preferences');
    assert.equal(sent.length, 1);
    assert.match(ui.text(), /Sign in again to save\./);
  } finally { await ui.unmount(); }
});

test('the page wires the row through the adapter, keeps Suggested as its fallback, and the tabs import no client', () => {
  const page = read('frontend/src/pages/events/MyEventsPage.jsx');
  assert.match(page, /import \* as recommendations from '\.\/recommendationsAdapter'/);
  assert.match(page, /recommendations\.recommended\(8\)/);
  assert.match(page, /<RecommendedRow read=\{recommended\} act=\{RECOMMEND_ACT\} explorer=\{explorer\}\s+fallback=\{<SuggestedCard /);
  assert.match(page, /layout="grid" fallback=\{fallback\}/);
  const tabs = read('frontend/src/pages/events/MyEventsTabs.jsx');
  assert.doesNotMatch(tabs, /from '\.\.\/\.\.\/lib\//, 'the tabs import no client');
  assert.match(tabs, /\(recommended \|\| \(\(x\) => x\)\)\(<>/);
  const row = read('frontend/src/pages/events/RecommendedRow.jsx');
  assert.doesNotMatch(row, /lib\/api|eventsApi/, 'the row imports no client');
  const ad = read('frontend/src/pages/events/recommendationsAdapter.js');
  assert.match(ad, /eventRecommendationsApi/, 'the adapter calls the client the Worker routes sit behind');
});

test('cover step: JPG or PNG at least 1200 × 675; the prompt is the event\'s own words and draws no one', () => {
  assert.equal(checkCoverFile({ type: 'image/gif', width: 2000, height: 2000 }).error, WRONG_TYPE);
  assert.equal(checkCoverFile({ type: 'image/png', width: 1199, height: 675 }).error, TOO_SMALL);
  assert.equal(checkCoverFile({ type: 'image/jpeg', width: 1200, height: 675 }).ok, true);
  const p = coverPrompt({ title: 'Pricing Workshop', summary: 'Price a B2B product', type: 'workshop', location_kind: 'in_person', location_text: 'Lisbon' }, { style: 'illustration', overlay: 'title_date' });
  assert.match(p, /^a flat illustration for a workshop, about “Pricing Workshop”, Price a B2B product, set in Lisbon, no people, no faces, no logos, leave calm space/);
  assert.doesNotMatch(coverPrompt({ title: 'Online', location_kind: 'virtual', location_text: 'https://meet' }), /set in/);
  assert.ok(coverPrompt({ title: 'x'.repeat(2000), summary: 'y'.repeat(2000) }).length <= 600);
});

test('cover step: Upload and Generate as tabs; the link stays; a new event is told to save first; upload says it is not on', async () => {
  const set = () => {};
  const html = renderToStaticMarkup(h(EventCoverStep, { id: null, form: { cover_url: '' }, set }));
  assert.match(html, /Cover image URL/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /JPG or PNG, at least 1200 × 675/);
  const ui = await mountForm(h(EventCoverStep, { id: null, form: { cover_url: '' }, set }));
  try {
    await ui.click('Generate with Eadwyn');
    assert.ok(ui.text().includes(COVER_RULE), 'the rule is shown');
    assert.ok(ui.by('event-cover-save-first'));
    assert.equal(ui.by('event-cover-draw'), undefined, 'no press for an unsaved event');
  } finally { await ui.unmount(); }
  const saved = await mountForm(h(EventCoverStep, { id: '5', form: { cover_url: '', title: 'Demo Day', type: 'demo_day' }, set, coverQuote: async () => null, coverDraw: async () => null }));
  try {
    await saved.click('Generate with Eadwyn');
    await saved.click('Write the prompt from this event');
    const input = saved.by('event-cover-draw-prompt');
    assert.match(saved.props(input).value, /^a photograph for a demo day, about “Demo Day”/);
  } finally { await saved.unmount(); }
});
