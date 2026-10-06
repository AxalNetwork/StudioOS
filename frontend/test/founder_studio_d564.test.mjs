/**
 * D564 (#1168) — the founder's /studio, built to `Founder Studio.dc.html`.
 *
 * Pinned by rendering `FounderStudioBody` over fixture reads (the home itself
 * mounts StudioInterview, whose imports reach Worker modules):
 *   - /studio draws the canvas's zones for a founder;
 *   - each zone is loading, unreadable (with Retry), not recorded (with its
 *     reason), empty, or ready, and a missing store is never drawn as zero;
 *   - no founder route or label says "Home".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';
import FounderStudioBody from '../src/pages/founder/FounderStudioBody.jsx';
import {
  summaryOf, progressOf, actionsOf, activityOf, modulesOf, profileOf, questionsOf, headerOf, companyProgress,
  failedRead, READY, LOADING, UNREADABLE, NOT_RECORDED, EMPTY,
} from '../src/pages/founder/founderStudioModel.js';
import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';

const NOW = Date.parse('2026-10-06T12:00:00Z');
const USER = { name: 'Fay Founder', email: 'fay@example.test' };
const LAB = {
  active: true, week: 2, days_remaining: 18, cohort: '4',
  milestones: [
    { key: 'project_created', week: 1 }, { key: 'customer_interview_logged_1', week: 1 },
    { key: 'customer_interview_logged_2', week: 1 }, { key: 'customer_interview_logged_3', week: 1 },
    { key: 'customer_interview_logged_4', week: 1 }, { key: 'customer_interview_logged_5', week: 1 },
    { key: 'okrs_created', week: 2 },
  ],
  unlocked_features: ['spinout-lab', 'projects', 'customer-discovery', 'market-intelligence', 'profiling', 'roadmap', 'brand-builder', 'pitch-deck'],
};
const ADVISOR = {
  total: 23, answered: 18,
  profiling: { applicable: true, percent: 68, complete: false, sections: [
    { key: 'product', label: 'Product', percent: 84, confident: true },
    { key: 'fundraising', label: 'Fundraising', percent: 36, confident: false },
  ] },
};
const QUEUE = { queue: [{ id: 'q1', prompt: 'Have you ever owned a revenue number end to end?', importance: 'high' }] };
const READS = {
  project: { id: 7, name: 'NovaCraft AI' },
  lab: LAB,
  advisor: ADVISOR,
  queue: QUEUE,
  lifecycle: { checklist: [
    { key: 'a', label: 'Lock MVP scope', done: false, href: '/build/roadmap' },
    { key: 'b', label: 'Set a 90-day roadmap', done: true, href: '/build/roadmap' },
  ] },
  scores: { scores: [{ total_score: 71.4, tier: 'B' }] },
  activity: { items: [
    { action: 'customer_interview_logged', details: 'Ops lead, Acme', created_at: '2026-10-06 09:00:00' },
    { action: 'okrs_created', details: '{"n":3}', created_at: '2026-10-05 09:00:00' },
    { action: 'old_thing', details: null, created_at: '2026-09-20 09:00:00' },
  ] },
};
const render = (reads, extra = {}) => renderedText(renderToStaticMarkup(createElement(MemoryRouter, null,
  createElement(FounderStudioBody, { user: USER, reads, onRetry: () => {}, now: NOW, ...extra }))));

test('/studio draws the canvas’s zones for a founder', () => {
  const t = render(READS);
  for (const zone of ['Do these next', 'Company progress', 'Eadwyn’s questions', 'Activity across the platform', 'Module map', 'Your founder profile', 'Holding progress', 'What this adds up to']) {
    assert.match(t, new RegExp(zone), `${zone} is missing`);
  }
  assert.match(t, /Week 2 · Day 11/);
  assert.match(t, /NovaCraft AI · Fay Founder · Cohort 4/);
  assert.match(t, /Lock MVP scope/);
  assert.doesNotMatch(t, /Set a 90-day roadmap/, 'a done checklist item was listed as next');
  assert.match(t, /Have you ever owned a revenue number end to end\?/);
  assert.match(t, /18 answered · 5 open/);
  assert.match(t, /Customer interview logged · Ops lead, Acme/);
  assert.doesNotMatch(t, /Old thing/, 'activity older than seven days was drawn');
  assert.match(t, /Readiness71/);
});

test('the summary strip reads each store, and a missing one is Not recorded, never a zero', () => {
  const ready = summaryOf(READS);
  assert.deepEqual(ready.map((x) => [x.k, x.state, x.v]), [
    ['Company progress', READY, `${companyProgress(LAB).percent}%`],
    ['Profile complete', READY, '68%'],
    ['Questions answered', READY, '18'],
    ['Modules active', READY, '7'],
    ['Tasks done', READY, '7'],
    ['Readiness', READY, '71'],
  ]);
  assert.equal(ready[1].sub, '1 gap');
  const bare = summaryOf({ ...READS, lab: { ...LAB, active: false }, scores: { scores: [] }, lifecycle: { checklist: [] } });
  for (const k of ['Venture progress', 'Modules active', 'Tasks done', 'Readiness']) {
    const tl = bare.find((x) => x.k === k);
    assert.equal(tl.state, NOT_RECORDED, `${k} was drawn without a store`);
    assert.equal(tl.v, null);
    assert.ok(tl.reason, `${k} has no reason`);
  }
  const t = render({ ...READS, scores: { scores: [] } });
  assert.match(t, /ReadinessNot recorded/);
  assert.doesNotMatch(t, /Readiness0/);
});

test('a failed read is Unreadable in its own zone, with a retry, and blanks nothing else', () => {
  const reads = { ...READS, lab: failedRead('lab down'), activity: failedRead('activity down') };
  assert.equal(progressOf(reads.lab).state, UNREADABLE);
  assert.equal(modulesOf(reads).state, UNREADABLE);
  assert.equal(activityOf({ activity: reads.activity, now: NOW }).state, UNREADABLE);
  const s = summaryOf(reads);
  assert.equal(s.find((x) => x.k === 'Company progress').state, UNREADABLE);
  assert.equal(s.find((x) => x.k === 'Profile complete').state, READY, 'a Lab failure blanked the profile tile');
  const t = render(reads);
  assert.match(t, /The Lab state could not be read/);
  assert.match(t, /Your activity could not be read/);
  assert.match(t, /Retry/);
  assert.match(t, /Lock MVP scope/, 'one failure blanked the actions');
  assert.match(t, /Have you ever owned a revenue number/, 'one failure blanked the questions');
});

test('every read still in flight is loading, never empty and never a zero', () => {
  const t = render({});
  assert.doesNotMatch(t, /Nothing is waiting on you|Nothing recorded in the last 7 days|No question is waiting/);
  assert.match(t, /Reading…/);
  for (const z of [actionsOf({}), progressOf(undefined), questionsOf({}), activityOf({ activity: undefined, now: NOW }), modulesOf({})]) {
    assert.equal(z.state, LOADING);
  }
  assert.ok(summaryOf({}).every((x) => x.state === LOADING || x.state === NOT_RECORDED));
  assert.ok(summaryOf({}).every((x) => x.v === null));
});

test('empty is said as empty: nothing waiting, nothing this week', () => {
  assert.equal(actionsOf({ ...READS, lifecycle: { checklist: [{ label: 'x', done: true }] } }).state, EMPTY);
  assert.equal(activityOf({ activity: { items: [] }, now: NOW }).state, EMPTY);
  const t = render({ ...READS, lifecycle: { checklist: [] }, activity: { items: [] }, queue: { queue: [] } });
  assert.match(t, /Nothing is waiting on you right now/);
  assert.match(t, /Nothing recorded in the last 7 days/);
  assert.match(t, /No question is waiting on you/);
});

test('with no company record the strip and the actions say so', () => {
  const reads = { ...READS, project: null, lifecycle: null, scores: null };
  assert.deepEqual(actionsOf(reads).items.map((a) => a.title), ['Create your startup record']);
  assert.equal(summaryOf(reads).find((x) => x.k === 'Readiness').state, NOT_RECORDED);
  assert.match(render(reads), /No company record yet/);
});

test('the zones with no store say Not recorded with the reason, and draw nothing', () => {
  const t = render(READS);
  assert.match(t, /Holding progressNot recorded/);
  assert.match(t, /Nothing records a blocker or its severity yet/);
  assert.match(t, /What this adds up toNot recorded/);
  assert.doesNotMatch(t, /Strongest signal|Weakest evidence|Critical|Unlocks /, 'canvas sample text was drawn');
});

test('Company progress: the Lab’s ladder, what shipped, what is open this week, and the gate', () => {
  const p = progressOf(LAB);
  assert.deepEqual(p.ladder.map((l) => l.state), ['Complete', 'In progress', 'Locked', 'Locked']);
  assert.ok(p.shipped.includes('Create startup record'));
  assert.ok(p.shipped.includes('Log 5 customer interviews'));
  assert.ok(!p.stillOpen.some((x) => /OKRs/.test(x)), 'a done deliverable is still open');
  assert.match(p.gate, /^Week 3 opens when /);
  const indie = progressOf({ ...LAB, active: false });
  assert.equal(indie.cohort, false);
  assert.deepEqual(indie.stillOpen, []);
  assert.match(indie.gate, /No gates outside a cohort/);
  assert.ok(indie.ladder.every((l) => l.state === 'Not started'));
});

test('the module map is Active or Locked from the Lab, and a per-module percent is not drawn', () => {
  const m = modulesOf({ lab: LAB });
  assert.equal(m.items.find((x) => x.key === 'roadmap').state, 'Active');
  assert.deepEqual([m.items.find((x) => x.key === 'scoring').state, m.items.find((x) => x.key === 'scoring').note], ['Locked', 'Week 3']);
  assert.ok(!render(READS).includes('%</span>'), 'a module percent was drawn');
  assert.ok(modulesOf({ lab: { ...LAB, active: false } }).items.every((x) => x.state === 'Locked' && x.note === 'Cohort only'));
});

test('the profile zone reads completion and confidence from the advisor, and mounts the shared archetype card', () => {
  const p = profileOf(READS);
  assert.deepEqual(p.completion, { state: READY, pct: 68 });
  assert.deepEqual(p.dimensions.items.map((d) => [d.name, d.label]), [['Product', 'High'], ['Fundraising', 'Low']]);
  const na = profileOf({ advisor: { profiling: { applicable: false, percent: 0 } } }).completion;
  assert.deepEqual([na.state, na.reason], [NOT_RECORDED, 'No profiling questions apply to this account yet.'], 'an inapplicable profile read as 0%');
  const t = render(READS, { profileCard: createElement('div', null, 'ARCHETYPE CARD') });
  assert.match(t, /ARCHETYPE CARD/);
  const home = codeOnly(readFileSync(new URL('../src/pages/founder/FounderStudioHome.jsx', import.meta.url), 'utf8'));
  assert.match(home, /profileCard=\{<ProfileFitSection compact \/>\}/);
  assert.match(home, /<StudioInterview persona="founder"/, 'Eadwyn is no longer on the founder Studio');
});

test('the header links a Lab member to the Lab record and anyone else to Build', () => {
  assert.equal(headerOf({ user: USER, project: { id: 7 }, lab: LAB }).profileHref, '/spinout-lab/startup');
  assert.equal(headerOf({ user: USER, project: { id: 7 }, lab: { ...LAB, active: false } }).profileHref, '/build?project_id=7');
  assert.equal(headerOf({ user: USER, project: null, lab: { ...LAB, active: false } }).phase, 'Independent · not in a cohort');
});

test('no founder route or label says Home', () => {
  const labels = (role) => SIDEBAR_GROUPS[role].flatMap((g) => [g.label, ...(g.items || []).map((i) => i.label)]);
  for (const role of ['founder', 'investor', 'advisor', 'partner']) {
    assert.ok(!labels(role).includes('Home'), `${role}'s sidebar says Home`);
    assert.equal(SIDEBAR_GROUPS[role][0].items[0].to, '/studio');
  }
  assert.doesNotMatch(render(READS), /\bHome\b/);
  assert.ok(existsSync(new URL('../../design/canvases/integrated/Founder Studio.dc.html', import.meta.url)), 'the canvas is not in integrated/');
  assert.ok(!existsSync(new URL('../../design/canvases/backlog/Founder Studio.dc.html', import.meta.url)), 'the canvas is still in backlog/');
});
