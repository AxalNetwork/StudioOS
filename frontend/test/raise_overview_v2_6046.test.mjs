// D6046 (#6046, Raise V2 build 2/5) — Raise › Overview V2 on desktop, boards RA-01 to RA-09 and RA-13
// of `design/incoming/Raise v2 Page.dc.html` (D4863), drawn from the overview read (D663, D1610, D6045).
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/raise_overview_v2_6046.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import RaiseOverview, { RaiseOverviewView } from '../src/pages/cycles/RaiseOverview.jsx';
import { RaiseDetailedReadiness, RaisePitchCard, RaiseValue } from '../src/pages/cycles/RaiseOverviewLead.jsx';
import {
  activityView, chartSummary, detailedOpenByDefault, journeyView, materialsSplit, nextActionsView, pitchView, readinessView, sourcesView,
} from '../src/pages/cycles/raiseOverviewModel.js';
import { raisePrimaryAction } from '../src/pages/cycles/cycleModel.js';
import raiseDef from '../src/pages/cycles/defs/raise.jsx';
import { installDocument } from './_contracts_dom.mjs';
import { OVERVIEWS, card } from './_cycle_fixtures.mjs';

const read = (f) => readFileSync(resolve(process.cwd(), f), 'utf8');
const html = (el, entry = '/raise?project_id=7') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [entry] }, el));
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const Q = '?project_id=7';
const meta = (status = 'ready', extra = {}) => ({ status, read_at: '2026-11-09T14:05:00Z', source_updated_at: null, complete: status === 'ready', completeness_reason: status === 'ready' ? null : 'This source could not be read.', source: 'x', ...extra });

const readinessCard = (items) => card('raise', 'Fundraising readiness', 0, {
  series: [{ kind: 'hbar', items }, { kind: 'line', values: [30, 41, 52] }],
  next: { text: 'Score readiness', href: '/raise/fundraising-readiness?project=7&add=1' },
});
const emptyCard = (name, reason, next) => card('raise', name, 1, { state: 'empty', series: null, reason, next });

/** RA-01: no narrative saved, no deck, nothing in the room, nothing connected, no investor. */
function early() {
  return {
    cycle: 'raise',
    stage: { state: 'ok', key: 'prepare', label: 'Prepare', rule: 'No narrative version saved' },
    primary_action: { state: 'ok', key: 'prepare_to_raise', label: 'Prepare to raise', href: '/raise/fundraising-readiness?project=7', rule: 'No narrative version saved' },
    figures: [],
    cards: [
      readinessCard([
        { label: 'Investor narrative', value: 7 }, { label: 'Pitch deck', value: 5 }, { label: 'Data room', value: 3 },
        { label: 'Cap table', value: 8 }, { label: 'Use of funds', value: 6 }, { label: 'Traction proof', value: 2 },
        { label: 'Team', value: null }, { label: 'Product-market fit', value: 4 },
      ]),
      emptyCard('Investor narrative', 'No version saved yet.', { text: 'Create narrative', href: '/raise/investor-narrative/new?project=7' }),
      { ...emptyCard('Pitch', 'No deck yet.', null), slug: 'pitch-deck', pitch_state: { state: 'ok', key: 'no_deck', label: 'No deck', version: null, live_links: 0, to_fix: null, unsaved_changes: false } },
      emptyCard('Data room', 'No file in the room yet.', { text: 'Add files', href: '/raise/data-room/new?project=7' }),
      card('raise', 'Cap table', 4, { state: 'not_recorded', series: null, reason: 'No holders yet.', next: { text: 'Add holder', href: '/raise/cap-table/new?project=7' } }),
      emptyCard('Use of funds', 'No split saved yet.', { text: 'Set allocation', href: '/raise/use-of-funds/new?project=7' }),
      emptyCard('Capital relationships', 'No investor yet.', null),
    ],
    next_steps: { state: 'ok', items: [
      { item_key: 'traction', label: 'Traction proof', text: 'No revenue recorded for the last 3 months', module_slug: 'fundraising-readiness', href: '/grow/revenue-and-traction?project=7', gain_points: 9 },
      { item_key: 'team', label: 'Team', text: 'A person assesses this', module_slug: 'fundraising-readiness', href: '/raise/fundraising-readiness', gain_points: 12 },
      { item_key: 'data_room', label: 'Data room', text: '0 of 12 checklist items have a file', module_slug: 'data-room', href: '/raise/data-room?project=7', gain_points: 6 },
      { item_key: 'deck', label: 'Pitch deck', text: 'There is no deck yet', module_slug: 'pitch-deck', href: '/raise/pitch?project_id=7', gain_points: null },
    ] },
    connectors: [
      { key: 'mercury', label: 'Mercury', fact: null, as_of: null, state: 'not_connected' },
      { key: 'github', label: 'GitHub', fact: null, as_of: null, state: 'not_connected' },
    ],
    investor_activity: {
      in_pipeline: 0, active_conversations: 0, deck_views_8_weeks: 0, call_responses_this_month: null, recent: [],
      sources: { pipeline: meta(), deck_views: meta(), round_calls: { status: 'not_applicable', reason: 'Calls for capital are not switched on.' } },
    },
  };
}

/** RA-02: investors in the pipeline, a reviewed deck, the materials recorded, sources of each freshness. */
function active() {
  const base = OVERVIEWS.raise;
  return {
    ...base,
    figures: [],
    stage: { state: 'ok', key: 'run_the_raise', label: 'Run the raise', rule: 'At least one investor is in the pipeline' },
    primary_action: { state: 'ok', key: 'add_investor', label: 'Add investor', href: '/raise/capital-relationships/new?project=7', rule: 'At least one investor is in the pipeline' },
    cards: [readinessCard([{ label: 'Investor narrative', value: 9 }, { label: 'Team', value: 7 }]),
      ...base.cards.slice(1).map((c) => (c.slug === 'pitch-deck' ? { ...c, pitch_state: { state: 'ok', key: 'reviewed', label: 'Reviewed, ready to send', version: 6, live_links: 0, to_fix: 0, unsaved_changes: false } } : c))],
    next_steps: { state: 'ok', items: [{ item_key: 'data_room', label: 'Data room', text: '8 of 12 checklist items have a file', module_slug: 'data-room', href: '/raise/data-room?project=7', gain_points: 4 }] },
    connectors: [
      { key: 'mercury', label: 'Mercury', fact: '18 months of runway · cash and net burn', as_of: '2026-11-09 14:05', state: 'connected' },
      { key: 'github', label: 'GitHub', fact: 'Contributors to 2 repositories', as_of: null, state: 'connected' },
      { key: 'google', label: 'Google Workspace', fact: null, as_of: null, state: 'unreadable' },
    ],
    investor_activity: {
      in_pipeline: 14, active_conversations: 6, deck_views_8_weeks: 21, call_responses_this_month: 4,
      recent: [
        { at: '2026-11-09 10:00:00', kind: 'deck_opened', investor: 'Investor A', detail: 'Opened the deck' },
        { at: '2026-11-08 09:00:00', kind: 'prospect_updated', investor: 'Investor B · Fund B', detail: 'Stage: Diligence' },
      ],
      sources: { pipeline: meta(), deck_views: meta(), round_calls: meta() },
    },
  };
}

const view = (raw, props = {}) => html(h(RaiseOverviewView, { raw, status: 'ready', search: Q, projectId: 7, ...props }));

test('RA-01 early raise: Prepare to raise, Prepare current, coverage with the unassessed area named, three next actions, one table', () => {
  const out = view(early(), { role: 'founder' });
  const t = text(out);
  assert.match(out, /data-raise-overview="v2"/);
  // RA-03: the Worker's action, never the fixed Build your deck.
  assert.match(out, /data-testid="cycle-action" href="\/raise\/fundraising-readiness\?project=7"[^>]*>Prepare to raise</);
  assert.doesNotMatch(t, /Build your deck/);
  assert.match(t, /From story to capital: get ready, build the materials, run the raise\./);
  // The journey: Prepare is the step the viewer is on; Build the story is Next and the rest Later.
  assert.match(out, /<li aria-current="step" data-testid="raise-journey-prepare" data-stage-status="current"/);
  assert.equal((out.match(/aria-current="step"/g) || []).length, 1);
  assert.match(out, /data-testid="raise-journey-build_the_story" data-stage-status="next"/);
  assert.match(out, /data-testid="raise-journey-run_the_raise" data-stage-status="later"/);
  assert.match(t, /Stage chosen from your records: No narrative version saved\./);
  // Readiness: 6 of 7 areas (PMF is RA-16's, not an area), Team named, never a 0.
  assert.match(t, /Fundraising readiness 6 of 7 areas assessed Team has no score yet, so it is not counted\./);
  // Next actions come before the score breakdown, at most three, Team never, an unknown gain Not recorded.
  assert.ok(out.indexOf('raise-next-actions') < out.indexOf('raise-detailed-readiness'), 'next actions before detailed readiness');
  assert.ok(out.indexOf('raise-readiness"') < out.indexOf('raise-next-actions'), 'the summary, then the actions');
  assert.match(t, /3 actions to improve readiness/);
  assert.doesNotMatch(out, /raise-next-team/);
  assert.match(t, /Traction proof Why: No revenue recorded for the last 3 months Readiness impact \+9 points Open Fundraising readiness/);
  assert.match(out, /data-testid="raise-next-deck"[\s\S]*?Readiness impact · Not recorded/);
  assert.doesNotMatch(t, /\+0 points/);
  // One status table for the five materials, not five empty cards.
  assert.match(out, /data-testid="raise-materials-table"/);
  for (const slug of ['investor-narrative', 'pitch-deck', 'data-room', 'cap-table', 'use-of-funds']) assert.match(out, new RegExp(`data-testid="raise-material-row-${slug}"`), slug);
  assert.doesNotMatch(out, /data-testid="cycle-card-/, 'no empty module card');
  assert.doesNotMatch(out, /raise-materials-cards/);
  assert.match(t, /Nothing set up for this raise yet\./);
  assert.match(out, /aria-label="Build pitch: Pitch"[^>]*>Build pitch</);
  assert.match(out, /href="\/raise\/pitch\?project_id=7"/);
  // Investor activity and connected evidence each collapse to one actionable line.
  assert.match(out, /data-testid="raise-activity-empty"[\s\S]*?No investors in your pipeline yet\.[\s\S]*?aria-label="Add investor to the pipeline"/);
  assert.match(out, /href="\/raise\/capital-relationships\/pipeline\?project_id=7&amp;open=add"/);
  assert.match(out, /data-testid="raise-sources-none"[\s\S]*?Connect sources</);
  assert.equal((out.match(/>Connect sources</g) || []).length, 1, 'one Connect sources message');
  // Detailed readiness is open in early raise; Related company setup comes last.
  assert.match(out, /data-testid="raise-detailed-readiness" data-open="true"/);
  assert.ok(out.indexOf('raise-related-setup') > out.indexOf('raise-detailed-readiness'));
  assert.match(out, /href="\/incorporate"[^>]*>Incorporate ›/);
  assert.match(out, /href="\/incorporate\/cofounder-agreement"[^>]*>Co-Founder Agreement ›/);
  // The founder's Share outside Axal sits beside the action (D6897).
  assert.match(out, /data-testid="share-status-open"/);
});

test('RA-02 active raise: Add investor, Run the raise current, rich cards, Pitch reviewed with Share, activity counts and feed, per-source rows, readiness collapsed', () => {
  const out = view(active());
  const t = text(out);
  assert.match(out, /data-testid="cycle-action" href="\/raise\/capital-relationships\/new\?project=7"[^>]*>Add investor</);
  assert.match(out, /data-testid="raise-journey-run_the_raise" data-stage-status="current"/);
  assert.match(out, /data-testid="raise-journey-prepare" data-stage-status="earlier"/);
  const strip = text(out.match(/data-testid="raise-journey"[\s\S]*?<\/section>/)[0]);
  assert.doesNotMatch(strip, /\bDone\b/, 'no store says a stage is complete');
  assert.match(strip, /Prepare Earlier .*Run the raise You are here/);
  assert.match(out, /data-testid="raise-materials-cards"/);
  assert.doesNotMatch(out, /raise-materials-table/);
  for (const slug of ['investor-narrative', 'data-room', 'cap-table', 'use-of-funds']) assert.match(out, new RegExp(`data-testid="cycle-card-${slug}"`), slug);
  assert.match(out, /data-testid="raise-pitch-card" data-pitch-state="reviewed"/);
  assert.match(out, /aria-label="Share · Pitch"[^>]*>Share</);
  assert.match(out, /href="\/raise\/pitch\/share\?project_id=7"/);
  assert.match(t, /Investor activity Capital relationships › In pipeline 14 Active conversations 6 Call responses this month 4 Deck views · 8 weeks 21/);
  assert.match(t, /2026-11-09 Investor A Opened the deck/);
  assert.match(out, /data-testid="raise-source-mercury" data-state="connected"[\s\S]*?Read 2026-11-09 14:05/);
  assert.match(out, /data-testid="raise-source-github"[\s\S]*?Last read · Not recorded/);
  assert.match(out, /data-testid="raise-source-google" data-state="unreadable"[\s\S]*?Unavailable/);
  assert.match(t, /1 action to improve readiness/);
  assert.match(out, /data-testid="raise-detailed-readiness" data-open="false"/);
  assert.equal(detailedOpenByDefault(active()), false);
  assert.equal(detailedOpenByDefault(early()), true);
  assert.equal(detailedOpenByDefault({ stage: { state: 'unreadable' } }), true, 'an unknown stage keeps the detail open');
});

test('RA-03: the primary action is the Worker\'s for each of the four states; none for staff, an unknown stage or a foreign address', () => {
  const rule = (key, label, href) => ({ primary_action: { state: 'ok', key, label, href, rule: 'r' } });
  assert.deepEqual(['prepare_to_raise', 'build_pitch', 'share_with_investor', 'add_investor'].map((k, i) => raisePrimaryAction(rule(k, ['Prepare to raise', 'Build pitch', 'Share with investor', 'Add investor'][i], '/raise/x?project=7'))?.label),
    ['Prepare to raise', 'Build pitch', 'Share with investor', 'Add investor']);
  assert.equal(raisePrimaryAction(rule('build_pitch', 'Build pitch', '/raise/pitch-deck?project=7')).href, '/raise/pitch?project_id=7', 'a legacy Pitch address opens the Studio');
  for (const raw of [null, {}, { primary_action: null }, { primary_action: { state: 'unreadable', reason: 'x' } }, { primary_action: { state: 'unreadable', label: 'Add investor', href: '/raise' } }, rule('x', 'X', 'https://evil.test'), rule('x', '', '/raise')]) {
    assert.equal(raisePrimaryAction(raw), null, JSON.stringify(raw));
  }
  const unknown = { ...early(), stage: { state: 'unreadable', reason: 'The investor pipeline could not be read, so the stage is not known.' }, primary_action: { state: 'unreadable', reason: 'The investor pipeline could not be read, so the stage is not known.' } };
  const out = view(unknown);
  assert.doesNotMatch(out, /data-testid="cycle-action"/);
  assert.match(text(out), /No primary action is offered: The investor pipeline could not be read/);
  assert.doesNotMatch(out, /aria-current="step"/, 'no stage is claimed');
  assert.match(text(out), /The stage is Unavailable\./);
  assert.equal(journeyView(unknown).stages.every((s) => s.status === null), true);
  // The Overview's action is not the module pages' Build your deck, which stays theirs.
  assert.equal(raiseDef.action('?project_id=7').label, 'Build your deck');
  assert.equal(typeof raiseDef.Overview, 'function', 'Raise draws its own Overview');
});

test('RA-05: the Pitch card in each state, Share offered only once a saved version is reviewed', () => {
  const pc = (p, activity) => html(h(RaisePitchCard, { card: { slug: 'pitch-deck', pitch_state: { state: 'ok', version: 6, live_links: 0, to_fix: 2, unsaved_changes: false, ...p } }, activity, search: Q }));
  assert.match(text(pc({ key: 'no_deck', version: null })), /Pitch No deck Share isn’t offered until a saved version exists\. Build pitch/);
  const draft = pc({ key: 'draft', version: null });
  assert.match(text(draft), /Working draft only Saved version Not recorded/);
  assert.match(draft, /href="\/raise\/pitch\/edit\?project_id=7"[^>]*>Continue editing</);
  const saved = pc({ key: 'saved', unsaved_changes: true });
  assert.match(text(saved), /Saved, not reviewed Saved version v6 Preflight Needs attention · 2 items to fix Unsaved changes beside the saved version Review preflight/);
  assert.match(saved, /<button type="button"[^>]*aria-disabled="true"[^>]*data-testid="raise-pitch-share-blocked">Share/);
  assert.doesNotMatch(saved, /href="\/raise\/pitch\/share/, 'no Share link before review');
  assert.match(pc({ key: 'reviewed', to_fix: 0 }), /aria-label="Share · Pitch"/);
  const shared = pc({ key: 'shared', live_links: 3 }, { deck_views_8_weeks: 21, sources: { deck_views: meta() } });
  assert.match(text(shared), /Shared Shared version v6 Live links 3 Views · 8 weeks 21 Manage links/);
  const unread = pc({ key: 'shared', live_links: 3 }, { deck_views_8_weeks: null, sources: { deck_views: meta('unavailable') } });
  assert.match(unread, /Views · 8 weeks<\/dt><dd[^>]*><span[^>]*data-platform-state="unavailable"/, 'unreadable views are Unavailable, never 0');
  assert.match(text(html(h(RaisePitchCard, { card: { slug: 'pitch-deck', pitch_state: { state: 'unreadable', reason: 'The deck could not be read, so its state is not known.' } } }))), /The deck could not be read\./);
  assert.equal(pitchView({ slug: 'pitch-deck' }), null, 'no state from the Worker, no Pitch card of its own');
  const ro = html(h(RaisePitchCard, { card: { slug: 'pitch-deck', pitch_state: { state: 'ok', key: 'reviewed', version: 6 } }, readOnly: true }));
  assert.doesNotMatch(ro, /<a /, 'a reader gets no Pitch action');
  // A Pitch with a state other than No deck is a card even beside empty materials; No deck is a table row.
  assert.deepEqual(materialsSplit(early()).table.map((c) => c.slug), ['investor-narrative', 'pitch-deck', 'data-room', 'cap-table', 'use-of-funds']);
  const drafted = early();
  drafted.cards[2] = { ...drafted.cards[2], pitch_state: { state: 'ok', key: 'draft' } };
  assert.deepEqual(materialsSplit(drafted).cards.map((c) => c.slug), ['pitch-deck']);
});

test('RA-06: connected evidence is one message with nothing connected, else one row each; the list unreadable is Unavailable', () => {
  assert.equal(sourcesView(early()).state, 'none');
  assert.equal(sourcesView({ connectors: [] }).state, 'none');
  assert.equal(sourcesView({ connectors: { state: 'unreadable' } }).state, 'unavailable');
  assert.equal(sourcesView({}), null, 'no list in the read, no section');
  const out = view({ ...active(), connectors: { state: 'unreadable' } });
  assert.match(out, /data-testid="raise-sources-unavailable"/);
  assert.match(text(out), /Your connected sources could not be read\./);
  const ro = view({ ...early(), read_only: true, mode: 'summary' });
  assert.match(ro, /data-testid="raise-sources-none"/);
  assert.doesNotMatch(ro, />Connect sources</, 'a reader is not offered Connect');
});

test('RA-07: detailed readiness is a titled chart with a summary and a Bars / Table switch; an unassessed area is Not recorded, never 0', () => {
  const v = readinessView(early());
  assert.equal(v.total, 7, 'Product-market fit is not an area (RA-16)');
  assert.deepEqual(v.unassessed, ['Team']);
  assert.equal(chartSummary(v), 'Summary: 6 of 7 areas assessed. Highest Cap table (8 of 10), lowest Traction proof (2 of 10). Team is not scored.');
  const bars = html(h(RaiseDetailedReadiness, { view: v }));
  assert.match(bars, /<h2 id="([^"]+)-title"[^>]*>Detailed readiness<\/h2>/);
  assert.match(bars, /role="img" aria-labelledby="[^"]+-title" aria-describedby="[^"]+-summary"/);
  assert.match(bars, /role="radiogroup" aria-label="Readiness view"/);
  assert.match(bars, /role="radio" aria-checked="true" data-testid="raise-detailed-mode-bars"[^>]*>Bars/);
  assert.match(bars, /role="radio" aria-checked="false" data-testid="raise-detailed-mode-table"[^>]*>Table/);
  assert.equal((bars.match(/data-bar-state="not_recorded"/g) || []).length, 1);
  assert.match(bars, /data-bar-state="not_recorded"><\/span><b[^>]*><\/b><span><span[^>]*data-platform-state="not_recorded"/, 'an empty, hatched track, no figure');
  assert.match(bars, /bg-\[repeating-linear-gradient/, 'hatched');
  assert.doesNotMatch(text(bars), /Team 0|0 \/ 10/);
  const table = html(h(RaiseDetailedReadiness, { view: v, defaultMode: 'table' }));
  assert.match(table, /<table[^>]*data-testid="raise-detailed-table"/);
  assert.match(text(table), /Team Not recorded/);
  assert.match(text(table), /Cap table 8/);
  assert.equal(readinessView({ cards: [{ slug: 'fundraising-readiness', state: 'unreadable', reason: 'The readiness scores could not be read.' }] }).state, 'unavailable');
  assert.equal(readinessView({ cards: [{ slug: 'fundraising-readiness', state: 'empty' }] }).state, 'none');
});

test('RA-07: the switch and the disclosure work in the DOM', async () => {
  const restore = installDocument();
  const host = document.createElement('div');
  const root = createRoot(host);
  const nodes = (n) => [n, ...n.childNodes.flatMap(nodes)];
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1];
  const byId = (id) => nodes(host).find((n) => props(n)?.['data-testid'] === id);
  try {
    await act(async () => root.render(h(MemoryRouter, null, h(RaiseDetailedReadiness, { view: readinessView(early()), defaultOpen: false }))));
    assert.equal(props(byId('raise-detailed-toggle'))['aria-expanded'], false);
    await act(async () => props(byId('raise-detailed-toggle')).onClick());
    assert.equal(props(byId('raise-detailed-toggle'))['aria-expanded'], true);
    assert.ok(byId('raise-detailed-bars'));
    await act(async () => props(byId('raise-detailed-mode-table')).onClick());
    assert.equal(byId('raise-detailed-bars'), undefined, 'the bars give way to the table');
    assert.ok(byId('raise-detailed-table'));
    assert.equal(props(byId('raise-detailed-mode-table'))['aria-checked'], true);
  } finally {
    await act(async () => root.unmount());
    restore();
  }
});

test('RA-08: one value component: 0 is a measured value, Not recorded, Unavailable and Not applicable are chips', () => {
  assert.match(html(h(RaiseValue, { state: 'value', value: 0 })), /data-value-state="value">0</);
  for (const s of ['not_recorded', 'unavailable', 'not_applicable']) {
    const out = html(h(RaiseValue, { state: s, value: null }));
    assert.match(out, new RegExp(`data-value-state="${s}"`));
    assert.doesNotMatch(text(out), /\b0\b/);
  }
  // A source that could not be read leaves its figures Unavailable, never 0; calls off are Not applicable.
  const a = activityView({ investor_activity: { in_pipeline: null, active_conversations: null, deck_views_8_weeks: 0, call_responses_this_month: null,
    sources: { pipeline: meta('unavailable', { completeness_reason: 'The investor pipeline could not be read.' }), deck_views: meta(), round_calls: { status: 'not_applicable', reason: 'Calls for capital are not switched on.' } } } });
  assert.deepEqual(a.figures.map((f) => [f.key, f.state, f.value]), [
    ['in_pipeline', 'unavailable', null], ['active_conversations', 'unavailable', null], ['call_responses', 'not_applicable', null], ['deck_views', 'value', 0],
  ]);
  assert.equal(a.state, 'ready', 'an unreadable pipeline is never the empty line');
  const out = view({ ...active(), investor_activity: { in_pipeline: null, active_conversations: null, deck_views_8_weeks: 0, call_responses_this_month: null, sources: { pipeline: meta('unavailable'), deck_views: meta(), round_calls: { status: 'not_applicable', reason: 'Calls for capital are not switched on.' } } } });
  assert.match(out, /data-testid="raise-activity-in_pipeline"[\s\S]*?data-value-state="unavailable"/);
  assert.match(out, /data-testid="raise-activity-call_responses"[\s\S]*?data-value-state="not_applicable"[\s\S]*?Calls for capital are not switched on\./);
  assert.match(out, /data-testid="raise-activity-deck_views"[\s\S]*?data-value-state="value">0</);
  assert.equal(activityView({}), null);
});

test('RA-09 states: loading, an unreadable card, unreadable next actions, the overview refused and failed', () => {
  const loading = html(h(RaiseOverviewView, { raw: null, status: 'loading', search: Q }));
  assert.match(loading, /aria-busy="true" data-testid="raise-overview-loading"/);
  assert.match(loading, /role="status" class="sr-only">Loading Raise overview</);
  assert.doesNotMatch(loading, /data-testid="cycle-action"/, 'no action before the read');
  // A card that could not be read is Unavailable with its own Retry; the others stay drawn.
  const raw = active();
  raw.cards = raw.cards.map((c) => (c.slug === 'cap-table' ? { ...c, state: 'unreadable', series: null, reason: 'The cap table could not be read.' } : c));
  const out = html(h(RaiseOverviewView, { raw, status: 'ready', search: Q, onRetryCard() {} }));
  assert.match(out, /data-testid="cycle-card-cap-table" data-state="unreadable"[\s\S]*?The cap table could not be read\.[\s\S]*?Try again/);
  assert.match(out, /data-testid="cycle-card-data-room" data-state="ok"/);
  const steps = view({ ...early(), next_steps: { state: 'unreadable', items: [] } }, { onRetry() {} });
  assert.match(steps, /data-testid="raise-next-unavailable"/);
  assert.equal(nextActionsView({ next_steps: { state: 'unreadable' } }).state, 'unavailable');
  assert.equal(nextActionsView({}), null);
  // Readiness that could not be read never says 0 of N.
  const rd = early();
  rd.cards[0] = { ...rd.cards[0], state: 'unreadable', series: null, reason: 'The readiness scores could not be read.' };
  const rdOut = view(rd);
  assert.match(rdOut, /data-testid="raise-readiness" data-state="unavailable"/);
  assert.doesNotMatch(text(rdOut), /\d+ of \d+ areas assessed/);
  const refused = html(h(RaiseOverviewView, { raw: null, status: 'refused', message: 'You cannot open this venture’s Raise.' }));
  assert.match(refused, /role="status"[^>]*data-testid="cycle-overview-refused">You cannot open this venture’s Raise\.</);
  assert.doesNotMatch(refused, /text-red|role="alert"/);
  const failed = html(h(RaiseOverviewView, { raw: null, status: 'unreadable' }));
  assert.match(text(failed), /The Raise overview could not be read\. This is not a claim that nothing is recorded\./);
});

test('staff read-only: the amber bar, no primary action, no Ask or Share, counts only, no link that writes', () => {
  const staff = { ...active(), read_only: true, mode: 'summary', primary_action: null };
  delete staff.investor_activity.recent;
  const out = view(staff, { role: 'admin' });
  assert.match(out, /data-testid="cycle-overview-read-only"/);
  assert.match(text(out), /Read only · HQ summary\./);
  assert.doesNotMatch(out, /data-testid="cycle-action"|data-testid="raise-ask"|share-status-open/);
  assert.doesNotMatch(out, /raise-activity-feed/, 'no investor names');
  assert.doesNotMatch(out, /aria-label="Open Data room for/, 'no next-action link');
  assert.match(text(out), /Read only\. The founder takes these steps\./);
  assert.doesNotMatch(out, /Manage connected sources|aria-label="Share · Pitch"/);
  // Even a read that sends an action is drawn without it for a reader.
  assert.doesNotMatch(view({ ...staff, primary_action: active().primary_action }), /data-testid="cycle-action"/);
  // A support session (`readOnly` from the route) reads the same way.
  assert.doesNotMatch(view(active(), { readOnly: true }), /data-testid="cycle-action"/);
});

test('explicit link names: every action link says what it opens, and the journey says each tool\'s mark in words', () => {
  const out = view(early());
  for (const m of out.matchAll(/<a [^>]*>([^<]*)</g)) assert.ok(m[1].trim() || /aria-label=/.test(m[0]), `a link with no name: ${m[0]}`);
  assert.match(out, /aria-label="Open capital relationships"/);
  assert.match(out, /aria-label="Review fundraising readiness"/);
  assert.match(out, /aria-label="Create narrative: Investor narrative"/);
  assert.match(out, /Readiness<span class="sr-only">, has records<\/span>/);
  assert.match(out, /Pitch<span class="sr-only">, nothing recorded yet<\/span>/);
  assert.match(out, /data-mark="none" href="\/raise\/evidence\?project_id=7"[^>]*>Evidence</, 'Evidence has no card here, so no mark');
});

test('RA-13 dark mode: every colour on the page has its dark pair', () => {
  for (const f of ['frontend/src/pages/cycles/RaiseOverview.jsx', 'frontend/src/pages/cycles/RaiseOverviewLead.jsx']) {
    const src = read(f);
    for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const cls = m[1] ?? m[2];
      if (/\b(bg-white|bg-axal-lavender|text-axal-ink)\b/.test(cls)) assert.match(cls, /dark:/, `${f}: ${cls.slice(0, 80)}`);
    }
  }
});

test('the route draws Raise V2 through its def on desktop and keeps the phone root below 1024px', () => {
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  assert.match(route, /body = def\?\.Overview \? <>/);
  assert.doesNotMatch(route, /RaiseLead|RaiseAsk/, 'Raise left the shared overview branch');
  const phone = html(h(RaiseOverview, { phone: true, raw: active(), status: 'ready', search: Q }));
  assert.match(phone, /data-testid="phone-cycle-root"|phone-index-/);
  assert.doesNotMatch(phone, /data-raise-overview="v2"/);
});

test('the canvas the page is built to is on disk, unedited intake', () => {
  const boards = read('design/incoming/Raise v2 · Boards.dc.html');
  for (const id of ['RA-01', 'RA-02', 'RA-03', 'RA-04', 'RA-05', 'RA-06', 'RA-07', 'RA-08', 'RA-09', 'RA-13']) assert.ok(boards.includes(`['${id}'`), id);
});
