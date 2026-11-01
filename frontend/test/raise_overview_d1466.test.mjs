// D1466 (#3714) — Raise › Overview: no dead space, no empty bands, one obvious next step.
// The shared overview's grid rules (all four cycles), Raise's lead row, the
// header Ask, the read-only staff summary and the refusal in plain words.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/raise_overview_d1466.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import CycleOverview, { CycleCard, FIGURE_COLS, figureCols, lastCardSpan } from '../src/pages/cycles/CycleOverview.jsx';
import RaiseLead, { RaiseAsk, RaiseFromTools, RaiseNextSteps, gainLabel, lastRead, nextStepItems } from '../src/pages/cycles/RaiseOverviewLead.jsx';
import PhoneCycleRoot from '../src/pages/cycles/PhoneCycleRoot.jsx';
import { OVERVIEWS, card, figure } from './_cycle_fixtures.mjs';

const read = (f) => readFileSync(resolve(process.cwd(), f), 'utf8');
const html = (el, entry = '/raise') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [entry] }, el));
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const figuresOf = (n) => Array.from({ length: n }, (_, i) => figure(`f${i}`, `Figure ${i}`, 10 + i, 'count'));
const gridClass = (out, id) => {
  const end = out.indexOf(`" data-testid="${id}"`);
  const start = end < 0 ? -1 : out.lastIndexOf('class="', end);
  const cls = start < 0 ? '' : out.slice(start + 'class="'.length, end);
  return cls.includes('"') ? '' : cls;
};

test('RO00, RO09: the figure row has one column per figure up to its width, never an empty track', () => {
  assert.deepEqual(Object.keys(FIGURE_COLS), ['1', '2', '3', '4', '5', '6']);
  for (const [n, want, never] of [
    [2, 'sm:grid-cols-2', /xl:grid-cols-4|grid-cols-3/],
    [4, 'xl:grid-cols-4', /grid-cols-3|grid-cols-6/],
    [6, 'min-[90rem]:grid-cols-6', /xl:grid-cols-4/],
  ]) {
    const out = html(h(CycleOverview, { cycle: 'raise', data: { ...OVERVIEWS.raise, figures: figuresOf(n) } }));
    const cls = gridClass(out, 'cycle-figures');
    assert.ok(cls.includes(want), `${n} figures: ${cls}`);
    assert.doesNotMatch(cls, never, `${n} figures leave no empty track`);
    assert.equal((out.match(/data-testid="cycle-figure-/g) || []).length, n, 'one tile per figure the read returns');
  }
  // 6 figures read 3 + 3 at 1024 and 1280.
  assert.match(figureCols(6), /sm:grid-cols-3/);
  assert.doesNotMatch(read('frontend/src/pages/cycles/CycleOverview.jsx'), /xl:grid-cols-4" data-testid="cycle-figures"/, 'no fixed four-column row');
});

test('RO00: module cards are equal height per row, three columns from 1280, and the last card fills its row', () => {
  const out = html(h(CycleOverview, { cycle: 'raise', data: OVERVIEWS.raise }));
  const cls = gridClass(out, 'cycle-cards');
  assert.match(cls, /items-stretch/);
  assert.doesNotMatch(cls, /items-start/, 'items-start left cards of uneven height');
  assert.match(cls, /lg:grid-cols-2 xl:grid-cols-3/);
  // Seven cards: Capital relationships spans the whole last row in both layouts.
  assert.equal(lastCardSpan(7), 'lg:col-span-2 xl:col-span-3');
  assert.match(out, /class="[^"]*lg:col-span-2 xl:col-span-3" data-testid="cycle-card-capital-relationships"/);
  assert.equal((out.match(/col-span-/g) || []).length, 2, 'only the last card spans');
  // The spanning card lays its charts side by side rather than stretching one.
  assert.match(out, /data-testid="cycle-card-capital-relationships"[\s\S]*?class="grid grid-cols-1 items-start gap-5 lg:grid-cols-2" data-testid="card-charts-wide"/);
  assert.equal((out.match(/card-charts-wide/g) || []).length, 1, 'only the spanning card');
  // Every count fills its rows at 2 and 3 columns.
  for (let n = 1; n <= 12; n++) {
    const s = lastCardSpan(n);
    const lg = n % 2 === 1 ? 2 : 1;
    const xl = n % 3 === 0 ? 1 : 4 - (n % 3);
    assert.equal(/lg:col-span-2/.test(s) ? 2 : 1, lg, `${n} at 2 columns`);
    assert.equal(Number(s.match(/xl:col-span-(\d)/)?.[1] || (lg === 2 ? 2 : 1)), xl === 4 ? 1 : xl, `${n} at 3 columns`);
  }
});

test('RO01, RO06: an empty or too-little card is one muted line and its first step, never a dashed box', () => {
  const src = read('frontend/src/pages/cycles/CycleOverview.jsx');
  assert.doesNotMatch(src, /border-dashed/, 'no dashed box on the overview');
  const empty = html(h(CycleCard, { cycle: 'raise', card: card('raise', 'Pitch deck', 2, { state: 'empty', series: null, reason: 'No deck yet. Views per week appear here.', next: { text: 'Build your deck', href: '/raise/pitch' } }), search: '?project_id=7' }));
  assert.match(empty, /data-state="empty"/);
  assert.match(text(empty), /No deck yet\. Views per week appear here\. Build your deck ›/);
  assert.match(empty, /href="\/raise\/pitch\?project_id=7"/, 'the first step keeps the venture');
  assert.match(empty, /bg-\[#faf9fc\]/, 'empty cards are drawn lighter');
  const little = html(h(CycleCard, { cycle: 'raise', card: card('raise', 'Use of funds', 5, { state: 'too_little', series: null, reason: 'Fewer than 3 points so far; the line appears at 3.' }) }));
  assert.match(little, /<p class="m-0 text-\[12\.5px\][^"]*text-axal-muted[^"]*" data-testid="card-too-little">Fewer than 3 points so far/);
  const nr = html(h(CycleCard, { cycle: 'raise', card: card('raise', 'Cap table', 4, { state: 'not_recorded', series: null, reason: 'The cap table has not been computed yet.' }) }));
  assert.match(nr, />Not recorded</);
  assert.doesNotMatch(nr, /text-red|border-dashed/, 'not recorded is never red or dashed');
});

test('RO06: a card holding more than two charts is cut off with "More in the module ›" to its page', () => {
  const tall = card('raise', 'Fundraising readiness', 0, {
    series: [
      { kind: 'hbar', items: [{ label: 'Pitch deck', value: 7 }, { label: 'Data room', value: 6 }] },
      { kind: 'line', values: [30, 41, 52, 64] },
      { kind: 'rows', items: [{ label: 'Founders', value: '2 recorded' }] },
    ],
  });
  const out = html(h(CycleCard, { cycle: 'raise', card: tall, search: '?project_id=7' }));
  assert.match(out, /<a [^>]*data-testid="cycle-card-more" href="\/raise\/fundraising-readiness\?project_id=7"[^>]*>More in the module ›</);
  assert.doesNotMatch(out, /Founders/, 'the third chart stays on the module page');
  const short = html(h(CycleCard, { cycle: 'raise', card: OVERVIEWS.raise.cards[1] }));
  assert.doesNotMatch(short, /cycle-card-more/, 'a card that fits is not cut off');
});

test('RO14: a read-only summary has an amber Read only bar, no primary action and no Ask', () => {
  const staff = { ...OVERVIEWS.raise, mode: 'summary', read_only: true, figures: figuresOf(4) };
  const out = html(h(CycleOverview, { cycle: 'raise', data: staff, action: { label: 'Build your deck', href: '/raise/pitch' }, ask: h('button', { 'data-testid': 'raise-ask' }, 'Ask') }));
  assert.match(out, /data-testid="cycle-overview-read-only"/);
  assert.match(text(out), /Read only · HQ summary\./);
  assert.doesNotMatch(out, /data-testid="cycle-action"/, 'no Build your deck');
  assert.doesNotMatch(out, /data-testid="raise-ask"/, 'no Ask');
  const member = html(h(CycleOverview, { cycle: 'raise', data: OVERVIEWS.raise, action: { label: 'Build your deck', href: '/raise/pitch' }, ask: h('button', { 'data-testid': 'raise-ask' }, 'Ask') }));
  assert.match(member, /data-testid="cycle-action"[^>]*>Build your deck</);
  assert.match(member, /cycle-action[\s\S]*data-testid="raise-ask"/, 'a member sees Ask after the primary action');
  assert.doesNotMatch(member, /cycle-overview-read-only/);
});

test('RO15, RO11: a refusal is the Worker sentence in muted ink; only a failed read is red', () => {
  const refused = html(h(CycleOverview, { cycle: 'raise', data: null, status: 'refused', message: 'You cannot open this venture’s Raise. Switch company, or ask its founder for access.' }));
  assert.match(refused, /role="status"[^>]*data-testid="cycle-overview-refused">You cannot open this venture’s Raise\. Switch company, or ask its founder for access\.</);
  assert.doesNotMatch(refused, /text-red|role="alert"|cycle-overview-unreadable/);
  const failed = html(h(CycleOverview, { cycle: 'raise', data: null, status: 'unreadable' }));
  assert.match(text(failed), /The Raise overview could not be read\. This is not a claim that nothing is recorded\./);
  const phone = html(h(PhoneCycleRoot, { cycle: 'raise', raw: null, status: 'refused', message: 'This venture could not be found.' }));
  assert.match(phone, /data-testid="phone-root-refused">This venture could not be found\.</);
  assert.doesNotMatch(phone, /text-red/);
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  assert.match(route, /const refused = \[403, 404\]\.includes\(error\?\.status\);/);
  assert.match(route, /setOverviewStatus\(refused \? 'refused' : 'unreadable'\);/);
});

test('RO04: Next steps list the biggest gains first, never Team, at most three, and an unknown gain is Not recorded', () => {
  const part = { state: 'ok', items: [
    { item_key: 'cap_table', label: 'Cap table', text: 'No vesting recorded for the founders', module_slug: 'cap-table', href: '/raise/cap-table', gain_points: 2 },
    { item_key: 'team', label: 'Team', text: 'A person assesses this', module_slug: 'fundraising-readiness', href: '/raise/fundraising-readiness', gain_points: 9 },
    { item_key: 'data_room', label: 'Data room', text: 'No customer contracts or LOIs uploaded', module_slug: 'data-room', href: '/raise/data-room', gain_points: 4 },
    { item_key: 'traction', label: 'Traction proof', text: 'No revenue recorded for the last 3 months', module_slug: 'fundraising-readiness', href: '/grow/revenue-and-traction', gain_points: null },
    { item_key: 'pitch_deck', label: 'Pitch deck', text: 'The Ask slide is out of sync with Use of funds', module_slug: 'pitch-deck', href: '/raise/pitch-deck', gain_points: 3 },
  ] };
  assert.deepEqual(nextStepItems(part).map((i) => i.item_key), ['data_room', 'pitch_deck', 'cap_table']);
  assert.equal(gainLabel(9), '+9 points');
  for (const g of [null, undefined, 0, -1, NaN]) assert.equal(gainLabel(g), null, String(g));
  const out = html(h(RaiseNextSteps, { part, cards: OVERVIEWS.raise.cards, search: '?project_id=7' }));
  assert.doesNotMatch(out, /next-step-team/, 'Team is never a step');
  assert.match(text(out), /Next steps The steps that raise your readiness most Data room No customer contracts or LOIs uploaded Data room \+4 points Open ›/);
  assert.match(out, /href="\/raise\/data-room\?project_id=7"/, 'each step opens its module for the same venture');
  const unknown = html(h(RaiseNextSteps, { part: { state: 'ok', items: [part.items[3]] } }));
  assert.match(unknown, /data-testid="next-step-gain-unrecorded">Not recorded</);
  assert.doesNotMatch(unknown, /\+0 points/);
  const empty = html(h(RaiseNextSteps, { part: { state: 'empty', items: [] }, search: '?project_id=7' }));
  assert.match(text(empty), /Score readiness No readiness items are scored yet .*Not recorded Score readiness/);
  assert.match(empty, /href="\/raise\/fundraising-readiness\?project_id=7"/);
  const failed = html(h(RaiseNextSteps, { part: { state: 'unreadable' }, onRetry() {} }));
  assert.match(failed, /role="alert"[^>]*>.*Next steps could not be read\..*Try again/);
  const ro = html(h(RaiseNextSteps, { part, readOnly: true }));
  assert.doesNotMatch(ro, /<a /, 'a read-only viewer gets no links that write');
  assert.match(text(ro), /Read only\. The founder takes these steps\./);
});

test('RO07: From your tools says when each source was last read; a missing read is Not recorded, never a date or 0', () => {
  assert.equal(lastRead('28 Oct, 09:14'), 'Read 28 Oct, 09:14');
  for (const v of [null, undefined, '']) assert.equal(lastRead(v), 'Last read · Not recorded');
  const part = [
    { key: 'mercury', label: 'Mercury', fact: '16.5 months of runway · cash and net burn', as_of: '28 Oct, 09:14', state: 'connected' },
    { key: 'github', label: 'GitHub', fact: 'Contributors to 2 repositories', as_of: null, state: 'connected' },
    { key: 'stripe', label: 'Stripe', fact: null, as_of: null, state: 'not_connected' },
    { key: 'notion', label: 'Notion', fact: null, as_of: null, state: 'unreadable' },
  ];
  const out = html(h(RaiseFromTools, { part, onRetry() {} }));
  const t = text(out);
  assert.match(t, /Mercury 16\.5 months of runway · cash and net burn Read 28 Oct, 09:14/);
  assert.match(t, /GitHub Contributors to 2 repositories Last read · Not recorded/);
  assert.match(out, /data-testid="tool-stripe"[\s\S]*?Not connected · <a[^>]*href="\/account\/integrations"[^>]*>Connect</);
  assert.match(out, /data-testid="tool-notion"[\s\S]*?role="alert"[\s\S]*?Notion could not be read\./);
  assert.equal((out.match(/role="alert"/g) || []).length, 1, 'red only for the row that could not be read');
  assert.equal((out.match(/class="[^"]*text-red-700/g) || []).length, 1);
  assert.doesNotMatch(t, /\b0\b|@/, 'no zero and no email');
  const failed = html(h(RaiseFromTools, { part: { state: 'unreadable' }, onRetry() {} }));
  assert.match(text(failed), /Your connected tools could not be read\. Try again/);
});

test('RO03: the lead row draws only the parts the read returns, side by side at 3 : 2', () => {
  assert.equal(html(h(RaiseLead, { data: OVERVIEWS.raise })), '', 'no part, no row: an absent part is not an empty one');
  const both = html(h(RaiseLead, { data: { ...OVERVIEWS.raise, next_steps: { state: 'empty', items: [] }, connectors: [] } }));
  assert.match(both, /xl:grid-cols-\[minmax\(0,3fr\)_minmax\(0,2fr\)\]/);
  assert.match(both, /raise-next-steps[\s\S]*raise-from-tools/);
  const one = html(h(RaiseLead, { data: { ...OVERVIEWS.raise, connectors: [] } }));
  assert.doesNotMatch(one, /grid-cols-\[minmax/, 'one card alone spans the row');
  const page = html(h(CycleOverview, { cycle: 'raise', data: OVERVIEWS.raise, lead: h('div', { 'data-testid': 'lead-slot' }) }));
  assert.match(page, /cycle-figures[\s\S]*lead-slot[\s\S]*cycle-cards/, 'the lead row sits between the figures and the cards');
  assert.doesNotMatch(html(h(CycleOverview, { cycle: 'raise', data: null, lead: h('div', { 'data-testid': 'lead-slot' }) })), /lead-slot/, 'not while loading');
});

test('RO00, RO08: Raise header Ask opens Eadwyn on "Raise · Overview", only where the panel serves the viewer', () => {
  assert.equal(html(h(RaiseAsk)), '', 'no panel for this viewer, no Ask');
  const lead = read('frontend/src/pages/cycles/RaiseOverviewLead.jsx');
  // D1443 (#3706): Ask opens the Ask panel (PageAsk), which serves only where a rail serves the viewer.
  assert.match(lead, /<PageAsk label="Raise · Overview" testId="raise-ask" \/>/);
  assert.doesNotMatch(lead, /\bFill\b/, 'Ask, never Fill');
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  assert.match(route, /ask=\{cycle === 'raise' && projectId \? <RaiseAsk \/> : null\}/);
  assert.match(route, /lead=\{cycle === 'raise' \? <RaiseLead data=\{rawOverview\} search=\{q\}/);
});

test('the Raise Overview canvases are on disk, unedited intake', () => {
  assert.ok(read('design/incoming/Raise Overview Page.dc.html').length > 50000);
  const boards = read('design/incoming/Raise Overview · Boards.dc.html');
  assert.match(boards, /dc-import name="Raise Overview Page"/);
  for (const id of ['RO01', 'RO05', 'RO09', 'RO14', 'RO18']) assert.ok(boards.includes(`B('${id}'`), id);
});
