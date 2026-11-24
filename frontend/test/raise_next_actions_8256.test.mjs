// D8256 (#8256) — Raise › Overview's next actions beyond readiness (RA-02): follow-ups due and an open
// objection merged before the readiness steps, in the board's order, each with its reason and its source
// record; a part that could not be read is said, never drawn as nothing due.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/raise_next_actions_8256.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { RaiseNextActions } from '../src/pages/cycles/RaiseOverviewLead.jsx';
import { NEXT_ACTIONS_MAX, followUpAction, nextActionsView, objectionAction } from '../src/pages/cycles/raiseOverviewModel.js';

const read = (f) => readFileSync(resolve(process.cwd(), f), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/raise?project_id=7'] }, el));
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');

const fu = (items, extra = {}) => ({ state: 'ok', items, capped: false, href: '/raise/capital-relationships/outreach?project=7', ...extra });
const f = (investor, due_on, overdue = false) => ({ prospect_id: 1, investor, step: 'Call', due_on, overdue });
const ob = (items, extra = {}) => ({ state: 'ok', items, capped: false, ...extra });
const o = (key, text, prospects, investors) => ({ key, text, count: prospects, prospects, investors, href: `/raise/investor-narrative/story?project=7&objection=${key}` });
const steps = {
  state: 'ok',
  items: [
    { item_key: 'data_room', label: 'Data room', text: '8 of 12 checklist items have a file', module_slug: 'data-room', href: '/raise/data-room?project=7', gain_points: 4 },
    { item_key: 'deck', label: 'Pitch deck', text: 'There is no deck yet', module_slug: 'pitch-deck', href: '/raise/pitch?project_id=7', gain_points: 2 },
  ],
};
const active = () => ({
  cards: [{ slug: 'data-room', name: 'Data room' }, { slug: 'pitch-deck', name: 'Pitch' }],
  next_steps: steps,
  follow_ups_due: fu([f('Ada · North Fund', '2026-11-20', true), f('Ben', '2026-11-22'), f('Edge', '2026-11-28')]),
  open_objections: ob([o('a1b2c3d4e5f60718', 'Customer concentration', 2, ['Ada · North Fund', 'Ben']), o('0011223344556677', 'Pricing is unproven', 1, ['Edge'])]),
});

test('the board\'s order: follow-ups, an open objection, then readiness steps; three at most', () => {
  const v = nextActionsView(active(), '?project_id=7');
  assert.equal(NEXT_ACTIONS_MAX, 3);
  assert.equal(v.state, 'ready');
  assert.deepEqual(v.items.map((i) => i.kind), ['follow_up', 'objection', 'readiness']);
  assert.deepEqual(v.items.map((i) => i.key), ['follow-ups', 'objection-a1b2c3d4e5f60718', 'data_room'], 'the biggest readiness gain fills the last place');
  assert.deepEqual(v.unread, []);
  const noFollowUps = nextActionsView({ ...active(), follow_ups_due: fu([]) });
  assert.deepEqual(noFollowUps.items.map((i) => i.key), ['objection-a1b2c3d4e5f60718', 'data_room', 'deck']);
  const onlyReadiness = nextActionsView({ ...active(), follow_ups_due: fu([]), open_objections: ob([]) });
  assert.deepEqual(onlyReadiness.items.map((i) => i.kind), ['readiness', 'readiness']);
});

test('follow-ups: who, how many are overdue, the earliest day and the link; a staff read says how many', () => {
  const a = followUpAction(active().follow_ups_due, '?project_id=7');
  assert.equal(a.title, 'Follow up with 3 investors');
  assert.equal(a.reason, 'Ada · North Fund, Ben and Edge have a next step due this week; 1 is overdue.');
  assert.equal(a.source, 'From Capital relationships · earliest due 20 Nov');
  assert.equal(a.href, '/raise/capital-relationships/outreach?project=7');
  assert.equal(a.cta, 'Open Outreach');
  const one = followUpAction(fu([f('Ada', '2026-11-25')]));
  assert.equal(one.title, 'Follow up with Ada');
  assert.equal(one.reason, 'Ada has a next step due this week.');
  const many = followUpAction(fu(['A', 'B', 'C', 'D', 'E'].map((n) => f(n, '2026-11-24')), { capped: true }));
  assert.equal(many.reason, 'A, B, C and 2 others have a next step due this week.');
  assert.match(many.source, /more not listed$/);
  const staff = followUpAction(fu([f(null, '2026-11-24', true), f(null, '2026-11-26', true)]));
  assert.equal(staff.title, 'Follow up with 2 investors');
  assert.equal(staff.reason, '2 investors have a next step due this week; 2 are overdue.');
  assert.equal(followUpAction(fu([])), null);
  assert.equal(followUpAction({ state: 'unreadable' }), null);
  assert.equal(followUpAction(null), null);
});

test('objections: the most heard open one, in its words, with who raised it and how many more are open', () => {
  const a = objectionAction(active().open_objections);
  assert.equal(a.title, 'Answer an open objection');
  assert.equal(a.reason, '“Customer concentration” was raised by 2 investors and has no answer in the narrative.');
  assert.equal(a.source, 'From investor feedback · Raised by Ada · North Fund and Ben · 1 more objection open');
  assert.equal(a.href, '/raise/investor-narrative/story?project=7&objection=a1b2c3d4e5f60718');
  const staff = objectionAction(ob([o('k000000000000001', 'Team is small', 1, null)]));
  assert.equal(staff.reason, '“Team is small” was raised by 1 investor and has no answer in the narrative.');
  assert.equal(staff.source, 'From investor feedback');
  assert.equal(objectionAction(ob([])), null);
  assert.equal(objectionAction({ state: 'unreadable' }), null);
});

test('an unreadable source is named, never read as nothing due; only every part unreadable is Unavailable', () => {
  const v = nextActionsView({ ...active(), follow_ups_due: { state: 'unreadable' } });
  assert.deepEqual(v.unread, ['Follow-ups due']);
  assert.deepEqual(v.items.map((i) => i.kind), ['objection', 'readiness', 'readiness']);
  const out = html(h(RaiseNextActions, { view: v, onRetry: () => {} }));
  assert.match(out, /data-testid="raise-next-unread"[\s\S]*?data-platform-state="unavailable"/);
  assert.match(text(out), /Follow-ups due could not be read, so it is not listed\. This is not a claim that nothing is due\./);
  assert.match(out, /aria-label="Try reading next actions again"/);
  const two = nextActionsView({ ...active(), follow_ups_due: { state: 'unreadable' }, open_objections: { state: 'unreadable' } });
  assert.deepEqual(two.unread, ['Follow-ups due', 'Open objections']);
  assert.match(text(html(h(RaiseNextActions, { view: two }))), /Follow-ups due and Open objections could not be read, so they are not listed\./);
  assert.deepEqual(nextActionsView({ next_steps: { state: 'unreadable' }, follow_ups_due: { state: 'unreadable' }, open_objections: { state: 'unreadable' } }), { state: 'unavailable' });
  const readinessGone = nextActionsView({ ...active(), next_steps: { state: 'unreadable' } });
  assert.deepEqual(readinessGone.items.map((i) => i.kind), ['follow_up', 'objection']);
  assert.deepEqual(readinessGone.unread, ['Readiness steps']);
  const nothing = html(h(RaiseNextActions, { view: nextActionsView({ next_steps: { state: 'unreadable' }, follow_ups_due: fu([]), open_objections: ob([]) }) }));
  assert.match(nothing, /data-testid="raise-next-none">Nothing else to list from what could be read\.</);
  assert.equal(nextActionsView({}), null, 'an absent part is not an empty one');
});

test('drawn: each action names its reason and source; the heading says what the actions are for; a reader gets no links', () => {
  const out = html(h(RaiseNextActions, { view: nextActionsView(active(), '?project_id=7') }));
  assert.match(out, /<h2[^>]*>3 actions to take next</);
  assert.match(out, /data-testid="raise-next-follow-ups" data-kind="follow_up"[\s\S]*?Why: <\/span>Ada · North Fund, Ben and Edge have a next step due this week; 1 is overdue\.[\s\S]*?data-testid="raise-next-source">From Capital relationships · earliest due 20 Nov</);
  assert.match(out, /data-testid="raise-next-objection-a1b2c3d4e5f60718" data-kind="objection"[\s\S]*?data-testid="raise-next-source">From investor feedback/);
  assert.match(out, /aria-label="Open Outreach for 3 follow-ups due" href="\/raise\/capital-relationships\/outreach\?project=7"/);
  assert.match(out, /aria-label="Answer the objection “Customer concentration”" href="\/raise\/investor-narrative\/story\?project=7&amp;objection=a1b2c3d4e5f60718"/);
  const followUp = out.slice(out.indexOf('raise-next-follow-ups'), out.indexOf('raise-next-objection'));
  assert.doesNotMatch(followUp, /Readiness impact/, 'a follow-up has no readiness impact');
  assert.match(out, /data-testid="raise-next-data_room" data-kind="readiness"[\s\S]*?Readiness impact \+4 points/);
  const ro = html(h(RaiseNextActions, { view: nextActionsView(active()), readOnly: true }));
  assert.doesNotMatch(ro, /href="\/raise\/capital-relationships\/outreach|objection=a1b2/, 'a reader gets no link that writes');
  const old = html(h(RaiseNextActions, { view: nextActionsView({ next_steps: steps }) }));
  assert.match(old, /<h2[^>]*>2 actions to improve readiness</, 'readiness steps alone keep their heading');
});

test('this file is the one D8256 names', () => {
  assert.match(read('documentation/architecture/decisions/D8256.md'), /raise_next_actions_8256\.test\.mjs/);
});
