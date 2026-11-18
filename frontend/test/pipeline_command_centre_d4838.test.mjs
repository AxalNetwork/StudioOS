/**
 * D4838 (#4838, part 1) — Pipeline v2: `/pipeline` is a first-run setup path or a command centre, and no outcome
 * metric prints a zero without a population. Rendered and executed, not matched as source text, except where the
 * property IS the source (the route wiring).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';

import {
  ok, unreadable, setupSteps, isFirstRun, openPipelineMetric, weightedMetric, winRateMetric, cycleMetric,
  attentionItems, riskItems, lifecycleStrip, railSteps, quotesEverSent, movementView, activityRows, EVENT_WORDS, MOVEMENT_SHOWN,
} from '../src/pages/partner/pipeline/commandCentre.js';
import { FirstRun, CommandCentre, pipelineView, readPipeline } from '../src/pages/partner/pipeline/PipelineCommandCentre.jsx';

const render = (C, props) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(C, props)));
const routes = codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src/workspaces/partner/PartnerBucketRoutes.jsx'), 'utf8'));
const zoneSrc = (name) => readFileSync(resolve(process.cwd(), `frontend/src/pages/partner/pipeline/${name}.jsx`), 'utf8');
const analyticsZone = zoneSrc('AnalyticsZone');

/** The live first-run firm (#4838's browser audit): no rule, no service, nothing sent. Payloads as the Worker answers. */
const firstRunSources = () => ({
  leads: ok({ items: [], open_count: 0, strong_fit_count: null, passed_count: 0, scoring: 'none',
    scoring_note: 'This firm has stated no fit rule and listed no service, so there is nothing to score a lead against.' }),
  proposals: ok({ items: [], live_count: 0, live_value_dollars: 0, decided_count: 0, won_count: 0, lost_count: 0,
    withdrawn_count: 0, win_rate_pct: null, win_rate_basis: 'No quote has been decided yet.', read_receipts: 'none' }),
  negotiations: ok({ items: [], open_count: 0, tracked_count: 0, live_value_dollars: 0, awaiting_us_count: 0 }),
  retainers: ok({ items: [], retainer_count: 0, active_count: 0, mrr_cents: null }),
  analytics: ok({ pipeline: { accepted: 0, rejected: 0, pending: 0, won_value: 0, median_cycle_days: null, win_rate_pct: null },
    forecast: { weighted_value: 0, unweighted_value: 0, by_stage: [], note: 'Weighted over undecided quotes only.' } }),
  fitRules: ok({ items: [] }),
  services: ok({ items: [] }),
  activity: ok({ items: [] }),
});

/** D5942's feed as the Worker answers it: newest first, each event naming its opportunity. */
const FEED = [
  { key: 'proposal_lost:3', kind: 'proposal_lost', occurred_at: '2026-11-14T10:00:00Z', opportunity: { need_id: 33, uid: 'n-33', title: 'Pinecrest rebuild' } },
  { key: 'negotiation_moved:7', kind: 'negotiation_moved', occurred_at: '2026-11-12T09:00:00Z', opportunity: { need_id: 32, uid: 'n-32', title: 'Verwood payments' } },
  { key: 'mystery:1', kind: 'mystery', occurred_at: '2026-11-11T09:00:00Z', opportunity: { need_id: 31, uid: 'n-31', title: 'Unknown' } },
  { key: 'passed:4', kind: 'passed', occurred_at: '2026-11-10T08:00:00Z', opportunity: { need_id: 13, uid: 'n-13', title: 'Mining ops' } },
];

/** A populated firm, every field one the Worker returns today. */
const populated = () => ({
  ...firstRunSources(),
  leads: ok({ open_count: 3, strong_fit_count: 1, passed_count: 2, scoring: 'fit_rules', scoring_note: 'A score is a count of your own stated rules.',
    items: [
      { need_id: 11, who: 'Lumen Pay', title: 'Payments build', score: 86, days_old: 3, excluded_by: null },
      { need_id: 12, who: 'Orchard AI', title: 'Data audit', score: null, days_old: 1, excluded_by: null },
      { need_id: 13, who: 'Shale', title: 'Mining ops', score: null, days_old: 9, excluded_by: 'We do not work in mining.' },
    ] }),
  proposals: ok({ live_count: 2, live_value_dollars: 30000, decided_count: 3, won_count: 0, lost_count: 3, withdrawn_count: 0,
    win_rate_pct: 0, win_rate_basis: 'Won over won plus lost; 2 open and 0 withdrawn are not in it.',
    items: [
      { quote_id: 1, client: 'Northshore', status: 'submitted', days_since_sent: 9, price_dollars: 12000 },
      { quote_id: 2, client: 'Verwood', status: 'submitted', days_since_sent: 20, price_dollars: 18000 },
      { quote_id: 3, client: 'Pinecrest', status: 'rejected', days_since_sent: 40, price_dollars: 9000 },
    ] }),
  negotiations: ok({ open_count: 1, tracked_count: 1, live_value_dollars: 18000, awaiting_us_count: 1,
    items: [{ quote_id: 2, founder_name: 'Verwood', price: 18000,
      negotiation: { open: true, ball: 'us', stage: 'terms', open_question: 'Cancellation period', days_stalled: 8 } }] }),
  retainers: ok({ retainer_count: 3, active_count: 3, mrr_cents: 1450000,
    items: [
      { engagement_id: 21, founder_name: 'Halden Robotics', utilisation_pct: 118, retainer: { active: true, days_to_renewal: 97, current_monthly_cents: 550000 } },
      { engagement_id: 22, founder_name: 'Kestrel Bio', utilisation_pct: 82, retainer: { active: true, days_to_renewal: 21, current_monthly_cents: 600000 } },
      { engagement_id: 23, founder_name: 'Orbit Grid', utilisation_pct: 35, retainer: { active: true, days_to_renewal: null, current_monthly_cents: 300000 } },
      { engagement_id: 24, founder_name: 'Old Client', utilisation_pct: 140, retainer: { active: false, days_to_renewal: 5, current_monthly_cents: null } },
    ] }),
  analytics: ok({ pipeline: { accepted: 0, rejected: 3, pending: 2, won_value: 0, median_cycle_days: 23, win_rate_pct: 0 },
    forecast: { weighted_value: 9000, unweighted_value: 30000, by_stage: [{ stage: 'submitted', count: 2, value: 30000, weighted: 9000, weight: 0.3 }], note: 'Weighted over undecided quotes only.' } }),
  fitRules: ok({ items: [{ id: 1, kind: 'budget_floor', is_active: 1 }] }),
  services: ok({ items: [] }),
  activity: ok({ items: FEED }),
});

test('first run renders the setup path, its two CTAs to the real editors, and no outcome zero', () => {
  const view = pipelineView(firstRunSources());
  assert.equal(view.firstRun, true);
  const html = render(FirstRun, { steps: view.steps, scoringNote: view.scoringNote });
  const text = renderedText(html);
  assert.match(html, /data-testid="pipeline-first-run"/);
  assert.match(html, /href="\/offers\/catalog"[^>]*data-testid="pipeline-setup-add-services"|data-testid="pipeline-setup-add-services"[^>]*href="\/offers\/catalog"/);
  assert.match(html, /href="\/offers\/audience-fit"/);
  assert.ok(text.includes('Add services') && text.includes('Set fit rules'));
  for (const label of ['Company profile exists', 'Add services', 'Set fit rules', 'Review matching leads', 'Draft the first proposal']) {
    assert.ok(text.includes(label), `setup step missing: ${label}`);
  }
  assert.match(html, /aria-label="Setup progress, 1 of 5 done"/);
  assert.ok(text.includes('How lead matching works'));
  assert.ok(text.includes('Lead') && text.includes('Retainer') && text.includes('Demand Insights'));
  // THE AUDIT'S FINDING: "$0 won" beside "no quote has been decided".
  assert.doesNotMatch(text, /\$0|0%|\bwon\b/i, 'a first-run outcome zero is back');
});

test('setup steps come from the record; services are done from either side, and unknown is not "not done"', () => {
  const s = (src) => Object.fromEntries(setupSteps(src).map((x) => [x.key, x.done]));
  assert.deepEqual(s(firstRunSources()), { profile: true, services: false, rules: false, leads: false, proposal: false });
  const p = populated();
  // Rules exist and the caller's own catalogue is empty: a colleague may hold it.
  assert.equal(s(p).services, null);
  assert.equal(s({ ...p, services: ok({ items: [{ id: 1, is_active: true }] }) }).services, true);
  assert.equal(s({ ...p, fitRules: ok({ items: [] }) }).services, true, 'scored with no rule means scored against an offering');
  assert.equal(s({ ...p, services: ok({ items: [{ id: 1, is_active: 0 }] }) }).services, null, 'a draft offering counted as listed');
  assert.equal(s({ ...p, fitRules: unreadable() }).rules, null, 'an unreadable rule list became "not set"');
  assert.deepEqual([s(p).rules, s(p).leads, s(p).proposal], [true, true, true]);
});

test('first run needs every source read and nothing ever in the lifecycle', () => {
  assert.equal(isFirstRun(firstRunSources()), true);
  assert.equal(isFirstRun({ ...firstRunSources(), proposals: unreadable() }), false, 'an unreadable read was taken as an empty pipeline');
  assert.equal(isFirstRun({ ...firstRunSources(), leads: ok({ scoring: 'fit_rules', items: [] }) }), false);
  assert.equal(isFirstRun({ ...firstRunSources(), retainers: ok({ retainer_count: 1, items: [] }) }), false);
  assert.equal(quotesEverSent(ok({ live_count: 0, decided_count: 0, withdrawn_count: 1 })), 1, 'a withdrawn quote was not counted as sent');
  assert.equal(quotesEverSent(unreadable()), null);
});

test('zero only with a population: none is words, a real zero is zero, a failed read is Unreadable', () => {
  const none = firstRunSources();
  assert.deepEqual([openPipelineMetric(none.proposals).state, openPipelineMetric(none.proposals).value], ['none', 'No open quotes']);
  assert.deepEqual([winRateMetric(none.proposals).state, winRateMetric(none.proposals).value], ['none', 'No decided quotes']);
  assert.deepEqual([cycleMetric(none.analytics).state, cycleMetric(none.analytics).value], ['none', 'No decided quotes']);
  assert.deepEqual([weightedMetric(none.analytics).state, weightedMetric(none.analytics).value], ['none', 'Nothing open to forecast']);
  // Three decided, all lost: 0% is the truth, with its denominator.
  const p = populated();
  assert.deepEqual([winRateMetric(p.proposals).value, winRateMetric(p.proposals).basis], ['0%', '0 of 3 decided']);
  assert.equal(openPipelineMetric(p.proposals).value, '$30,000');
  assert.equal(openPipelineMetric(p.proposals).basis, '2 open quotes · not revenue');
  assert.equal(weightedMetric(p.analytics).value, '$9,000');
  assert.equal(cycleMetric(p.analytics).value, '23 days');
  assert.equal(cycleMetric({ state: 'ok', data: { pipeline: { accepted: 1, rejected: 0, median_cycle_days: null } } }).value, 'Not recorded');
  for (const m of [openPipelineMetric(unreadable()), winRateMetric(unreadable()), weightedMetric(unreadable()), cycleMetric(unreadable())]) {
    assert.equal(m.state, 'unreadable');
    assert.equal(m.value, null, `${m.label} turned a failed read into a value`);
  }
  // Every metric that prints a value says how.
  for (const m of [winRateMetric(p.proposals), weightedMetric(p.analytics), openPipelineMetric(p.proposals), cycleMetric(p.analytics)]) {
    assert.ok(m.how, `${m.label} has no How calculated`);
  }
});

test('Analytics’ weighted forecast is no longer $0 over nothing open', () => {
  assert.match(analyticsZone, /value=\{forecastOpen \? moneyDollars\(f\.weighted_value\) : ''\}/);
  assert.match(analyticsZone, /nr=\{!forecastOpen\}/);
  // The zones' money notes: none live is words, not "$0 in play" / "$0 carried".
  assert.match(zoneSrc('ProposalsZone'), /note=\{d\?\.live_count \? `\$\{moneyDollars\(d\.live_value_dollars \?\? 0\)\} in play` : 'nothing in play'\}/);
  assert.match(zoneSrc('NegotiationsZone'), /\? `\$\{moneyDollars\(d\?\.live_value_dollars \?\? 0\)\} carried` : 'nothing carried'\}/);
});

test('needs attention is facts on recorded fields, most urgent first; an ended retainer asks nothing', () => {
  const items = attentionItems(populated());
  assert.deepEqual(items.map((a) => a.key), ['neg-2', 'over-21', 'renew-22', 'quote-1', 'low-23', 'lead-11']);
  const byKey = Object.fromEntries(items.map((a) => [a.key, a]));
  assert.equal(byKey['neg-2'].issue, 'Negotiation waiting on us');
  assert.equal(byKey['neg-2'].detail, 'Cancellation period · 8 days since it moved');
  assert.equal(byKey['quote-1'].issue, 'No reply recorded', 'a quote in no recorded state was called unopened or unanswered');
  assert.equal(byKey['quote-1'].detail, 'Sent 9 days ago · $12,000');
  assert.equal(byKey['renew-22'].detail, '$6,000 / month equivalent');
  assert.ok(!items.some((a) => a.key === 'quote-2'), 'a quote in an open negotiation was flagged as no reply');
  assert.ok(!items.some((a) => a.key.endsWith('-24')), 'an ended retainer asked for action');
  assert.ok(!items.some((a) => a.key === 'lead-13' || a.key === 'lead-12'), 'an excluded or unscored lead was called strong');
  assert.ok(items.every((a) => a.to.startsWith('/pipeline/')));
});

test('risks and the lifecycle strip read the same records; Unreadable is never a count', () => {
  const risks = riskItems(populated());
  assert.deepEqual(risks.map((r) => r.text), ['Scope overrun · 118%', 'Renews in 21 days', 'Proposal stalled · 9 days', 'Negotiation stalled · 8 days']);
  const strip = lifecycleStrip(populated());
  assert.deepEqual(strip.map((c) => [c.label, c.count, c.sub]), [
    ['Leads', 3, '1 strong fit'],
    ['Proposals', 2, '$30,000 open'],
    ['Negotiations', 1, '$18,000 · 1 waiting on us'],
    ['Retainers', 3, '$14,500 / month equivalent'],
  ]);
  const empty = lifecycleStrip(firstRunSources());
  assert.deepEqual(empty.map((c) => c.sub), ['not scored · no fit rule or service', 'none open', 'none open', 'none active']);
  const failed = lifecycleStrip({ ...populated(), retainers: unreadable() });
  assert.deepEqual([failed[3].state, failed[3].count], ['unreadable', null]);
});

test('the populated root draws attention first, then metrics, lifecycle, movement (the feed) and risks', () => {
  const view = pipelineView(populated());
  assert.equal(view.firstRun, false);
  const html = render(CommandCentre, { view });
  const order = ['pipeline-attention', 'pipeline-metrics', 'pipeline-lifecycle', 'pipeline-movement', 'pipeline-risks'];
  const at = order.map((id) => html.indexOf(`data-testid="${id}"`));
  assert.ok(at.every((i) => i >= 0), 'a section is missing');
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'the command centre is out of the canvas’s order');
  const movement = renderedText(html.slice(at[3], at[4]));
  // D4838 part 9 (#5943): Recent movement is the recorded feed, newest first, each event with its opportunity.
  assert.match(movement, /Recent movement\s*Nov 14, 2026\s*Proposal lost · Pinecrest rebuild\s*Nov 12, 2026\s*Negotiation last moved · Verwood payments\s*Nov 10, 2026\s*Lead passed · Mining ops/);
  assert.doesNotMatch(movement, /Not recorded|Unknown/, 'an unknown kind or a placeholder was drawn');
  const text = renderedText(html);
  assert.ok(text.includes('How calculated'));
  assert.ok(text.includes('0 of 3 decided'));
  assert.doesNotMatch(text, /opened|unopened|read receipt/i, 'a client open was implied; nothing records one');
  // Phone (PP02m): 2×2 metrics, a lifecycle row that scrolls, 44px actions.
  assert.match(html, /data-testid="pipeline-metrics" class="grid grid-cols-2 gap-2\.5 lg:grid-cols-4"|class="grid grid-cols-2 gap-2\.5 lg:grid-cols-4" data-testid="pipeline-metrics"/);
  assert.match(html, /overflow-x-auto[^"]*md:grid/);
  assert.match(html, /min-h-\[44px\]/);
});

test('one failed read is Unreadable where it would be drawn, never zero', () => {
  const view = pipelineView({ ...populated(), proposals: unreadable() });
  const html = render(CommandCentre, { view });
  const text = renderedText(html);
  assert.match(text, /Open pipeline could not be read/);
  assert.match(text, /Win rate could not be read/);
  assert.doesNotMatch(text, /No open quotes|No decided quotes/, 'a failed read was drawn as an empty population');
  const all = pipelineView({ ...populated(), leads: unreadable(), proposals: unreadable(), negotiations: unreadable(), retainers: unreadable() });
  assert.equal(all.failed, true);
  assert.equal(all.firstRun, false);
});

test('readPipeline settles every read, and "no partner profile" is said once rather than as seven failures', async () => {
  const good = Object.fromEntries(Object.entries(firstRunSources()).map(([k, v]) => [k, async () => v.data]));
  const r = await readPipeline({ ...good, analytics: async () => { throw new Error('boom'); } });
  assert.equal(r.noProfile, false);
  assert.equal(r.sources.analytics.state, 'unreadable');
  assert.equal(r.sources.leads.state, 'ok');
  const np = await readPipeline({ ...good, leads: async () => { throw new Error('No partner profile linked to this account'); } });
  assert.equal(np.noProfile, true);
});

test('the Eadwyn rail shows this page’s next steps, not models: setup on first run, attention when populated', () => {
  const first = pipelineView(firstRunSources());
  const r1 = railSteps(first);
  assert.equal(r1.state, 'ready');
  assert.deepEqual(r1.items.map((i) => i.to), ['/offers/catalog', '/offers/audience-fit', '/pipeline/leads']);
  assert.doesNotMatch(r1.foot, /advis|recommend|fiduciar/i);
  const r2 = railSteps(pipelineView(populated()));
  assert.equal(r2.items[0].text, 'Verwood · Negotiation waiting on us');
  assert.equal(railSteps({ loading: true }).state, 'loading');
  assert.equal(railSteps({ failed: true }).state, 'unavailable');
  assert.equal(railSteps({ attention: [] }).state, 'empty');
});

test('the route renders the command centre at /pipeline and follows its state in the title and the rail', () => {
  assert.match(routes, /const pipelineRoot = isRoot && prefix === '\/pipeline';/);
  assert.match(routes, /if \(pipelineRoot\) \{\s*return <Suspense fallback=\{<Loading \/>\}><PipelineCommandCentre onView=\{setPipelineView\} \/><\/Suspense>;/);
  assert.match(routes, /title=\{firstRun \? 'Set up your pipeline' : \(isRoot \? bucketTitle\(bucket\) : undefined\)\}/);
  assert.match(routes, /steps=\{pipelineRoot \? pipelineView\?\.rail/);
  assert.match(routes, /usageAt=\{pipelineRoot \? '\/account\/ai-tokens' : null\}/);
  assert.doesNotMatch(routes, /'\/pipeline': 'Win the work\./, 'the intro repeats the title');
});

/* ------------------------------------------------------------------ *
 * D4838 part 9 (#5943): Recent movement and the sheet's Activity from D5942's lifecycle feed
 * ------------------------------------------------------------------ */

test('Recent movement: the feed newest first; an empty answered feed says nothing moved; a failed read is Unreadable', () => {
  const ok3 = movementView(ok({ items: FEED }));
  assert.equal(ok3.state, 'ok');
  assert.deepEqual(ok3.rows.map((r) => [r.text, r.who]), [
    ['Proposal lost', 'Pinecrest rebuild'], ['Negotiation last moved', 'Verwood payments'], ['Lead passed', 'Mining ops'],
  ], 'the feed order is kept and an unknown kind is left out');
  // No event is derived on the page: the rows are the feed's, in the feed's order, and nothing else.
  const reversed = movementView(ok({ items: [...FEED].reverse() }));
  assert.deepEqual(reversed.rows.map((r) => r.text), ['Lead passed', 'Negotiation last moved', 'Proposal lost'], 'the page re-sorted the feed');
  assert.deepEqual(movementView(ok({ items: Array.from({ length: 20 }, (_, i) => ({ key: `passed:${i}`, kind: 'passed', occurred_at: '2026-11-01T00:00:00Z' })) })).rows.length, MOVEMENT_SHOWN);

  const empty = render(CommandCentre, { view: pipelineView({ ...populated(), activity: ok({ items: [] }) }) });
  assert.match(empty, /data-testid="pipeline-movement-none"/);
  assert.match(renderedText(empty), /Nothing has moved yet/);
  assert.doesNotMatch(empty, /pipeline-movement-unreadable/);

  for (const bad of [unreadable(), undefined]) {
    const html = render(CommandCentre, { view: pipelineView({ ...populated(), activity: bad }) });
    assert.match(html, /data-testid="pipeline-movement-unreadable"/, 'a failed or missing feed read was not Unreadable');
    assert.doesNotMatch(html, /pipeline-movement-none|Nothing has moved/, 'a failed read was drawn as nothing moved');
  }
  // One failed feed read does not take the page down: the zones still draw.
  assert.equal(pipelineView({ ...populated(), activity: unreadable() }).failed, false);
});

test('first run still draws no movement, and the feed does not decide first run', () => {
  const view = pipelineView({ ...firstRunSources(), activity: ok({ items: FEED }) });
  assert.equal(view.firstRun, true, 'a feed event turned first run into the command centre');
  const html = render(FirstRun, { steps: view.steps, scoringNote: view.scoringNote });
  assert.doesNotMatch(html, /pipeline-movement/);
});

test('the page asks the feed through its API module, and the sheet uses the same words for the same kinds', async () => {
  const src = readFileSync(resolve(process.cwd(), 'frontend/src/pages/partner/pipeline/PipelineCommandCentre.jsx'), 'utf8');
  assert.match(src, /activity: \(\) => partnerPipelineActivityApi\.list\(\{ limit: MOVEMENT_SHOWN \}\)/);
  assert.doesNotMatch(codeOnly(src), /Nothing joins lead, proposal/, 'the old placeholder is still drawn');
  const sheet = await import('../src/pages/partner/pipeline/OpportunitySheet.jsx');
  assert.equal(sheet.activityRows, activityRows, 'the sheet keeps its own event words');
  assert.deepEqual(Object.keys(EVENT_WORDS), ['passed', 'proposal_version', 'proposal_won', 'proposal_lost', 'negotiation_moved', 'retainer_created', 'retainer_ended']);
  // A "no partner profile" from the feed is said once, like any other read.
  const good = Object.fromEntries(Object.entries(firstRunSources()).map(([k, v]) => [k, async () => v.data]));
  const r = await readPipeline({ ...good, activity: async () => { throw new Error('boom'); } });
  assert.equal(r.sources.activity.state, 'unreadable');
  assert.equal(r.noProfile, false);
});
