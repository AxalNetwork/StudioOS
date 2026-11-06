/**
 * D4589 (#4589) — Validate's one next-action policy, drawn on desktop and on
 * a phone. Each case below is a venture state given as the policy's facts;
 * the Worker's own pure policy (`cloudflare-worker/src/services/
 * validateNextAction.ts`, imported as is) turns it into the overview's
 * `focus`, and the test renders that one read through the desktop panel
 * (`ValidateNextAction.jsx`) and the phone root (`PhoneCycleRoot.jsx`). Both
 * must show the same headline, reason, primary action and exact href, and the
 * same secondary actions, for every case the issue names. The Worker-side
 * reads of these facts are `cloudflare-worker/test/validate_next_action_d4589.test.ts`.
 *
 * Every name is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/validate_next_action_d4589.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import PhoneCycleRoot from '../src/pages/cycles/PhoneCycleRoot.jsx';
import ValidateNextAction from '../src/pages/cycles/ValidateNextAction.jsx';
import CycleOverview from '../src/pages/cycles/CycleOverview.jsx';
import { nextAction, UNREAD } from '../../cloudflare-worker/src/services/validateNextAction.ts';

const h = React.createElement;
const P = 8;
const Q = `?project=${P}`;
const dayMonth = (v) => (v ? '12 Oct' : null);

const claim = (o) => ({ id: 31, code: 'H1', status: 'testing', supporting: 0, contradicting: 0, fit_unrecorded: 0, ...o });
const base = (o = {}) => ({
  projectId: P, canWrite: true, ownsVenture: true, canReadDecision: true,
  interviews: 6, review: null, decision: null, claims: [], results: [],
  meterTail: ' You are at 6 of 10 this month.', then: 'Link evidence to H2.', readerFocus: null, dayMonth, ...o,
});

/** The issue's cases: state → the rule, the primary href and the secondary hrefs both presentations must show. */
const CASES = [
  ['no interview yet', base({ interviews: 0 }), 'first_interview', `/validate/record?project=${P}`, []],
  ['outstanding interview review', base({ review: { interviewId: 41, sessionId: 19, headline: 'Review the interview with Dana Vale from 12 Oct.', why: 'It is transcribed but not yet placed.' } }),
    'review', `/validate/customer-research/41?project_id=${P}&session=19`, [`/validate/record?project=${P}`]],
  ['Stop is respected: review it, reopening is the founder’s own decision', base({ decision: { id: 77, decision: 'stop', decided_at: '2026-10-12' }, claims: [claim({ supporting: 2, contradicting: 3 })] }),
    'stopped', `/validate/verdict/77?project=${P}`, [`/validate/verdict/new?project=${P}&for=venture`]],
  ['pending review comes before a Stop (evidence already gathered)', base({ decision: { id: 77, decision: 'stop', decided_at: '2026-10-12' }, review: { interviewId: 41, sessionId: 19, headline: 'Review the interview with Dana Vale.', why: 'It is transcribed but not yet placed.' } }),
    'review', `/validate/customer-research/41?project_id=${P}&session=19`, [`/validate/record?project=${P}`]],
  ['missing customer fit', base({ claims: [claim({ status: 'not_recorded', supporting: 1, fit_unrecorded: 2 })] }),
    'missing_fit', `/validate/experiments/31?project=${P}`, [`/validate/record?project=${P}`]],
  ['experiment done with no observed result', base({ results: [{ hypothesisId: 32, code: 'H2', title: 'Pricing page test' }] }),
    'record_result', `/validate/experiments/32?project=${P}`, [`/validate/record?project=${P}`]],
  ['conflicting findings need an explicit next test', base({ claims: [claim({ supporting: 3, contradicting: 2 })] }),
    'next_test', `/validate/experiments/31?project=${P}`, [`/validate/record?project=${P}`]],
  ['a decision is ready to consider (never recorded for the founder)', base({ claims: [claim({ status: 'supported', supporting: 5 })] }),
    'decision_ready', `/validate/verdict/new?project=${P}&for=venture`, [`/validate/record?project=${P}`]],
  ['an existing Proceed exposes the existing Plan the build handoff', base({ decision: { id: 78, decision: 'proceed', decided_at: '2026-10-12' }, claims: [claim({ status: 'supported', supporting: 5 })] }),
    'plan_build', `/build/plan?project_id=${P}`, [`/validate/record?project=${P}`, `/validate/verdict/78?project=${P}`]],
  ['an existing Pivot exposes it too', base({ decision: { id: 79, decision: 'pivot', decided_at: '2026-10-12' } }),
    'plan_build', `/build/plan?project_id=${P}`, [`/validate/record?project=${P}`, `/validate/verdict/79?project=${P}`]],
  ['an admin who is not the founder is not offered Plan the build', base({ ownsVenture: false, decision: { id: 78, decision: 'proceed', decided_at: '2026-10-12' } }),
    'next_interview', `/validate/record?project=${P}`, []],
  ['nothing outstanding: record the next conversation', base(), 'next_interview', `/validate/record?project=${P}`, []],
  ['a reader is never sent to a write', base({ canWrite: false, readerFocus: { rule: 'card', eyebrow: 'Validate · Next', headline: 'Open the pain map.', why: null, cta: { label: 'Open the pain map', href: `/validate/problem-discovery?project=${P}` }, then: null } }),
    'card', `/validate/problem-discovery?project=${P}`, []],
];

/** A fact that could not be read: the step is unavailable on both, never progress. */
const UNAVAILABLE = [
  ['interviews unreadable', base({ interviews: UNREAD }), /The interviews could not be read/],
  ['sessions unreadable', base({ review: UNREAD }), /The interview sessions could not be read/],
  ['decision unreadable', base({ decision: UNREAD }), /The current decision could not be read/],
  ['claims unreadable', base({ claims: UNREAD }), /The hypotheses and their evidence could not be read/],
  ['experiments unreadable', base({ results: UNREAD }), /The experiments could not be read/],
];

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/<[^>]+>/g, '').trim();
/** Every `<a>` or element carrying `data-testid="<id>"`: its href and its text. */
function pick(out, id) {
  const found = [];
  let at = out.indexOf(`data-testid="${id}"`);
  while (at >= 0) {
    const open = out.lastIndexOf('<', at);
    const tagEnd = out.indexOf('>', at);
    const name = out.slice(open + 1).match(/^[a-z0-9]+/)[0];
    const close = out.indexOf(`</${name}>`, tagEnd);
    const href = out.slice(open, tagEnd).match(/href="([^"]*)"/);
    found.push({ href: href ? decode(href[1]) : null, text: decode(out.slice(tagEnd + 1, close)) });
    at = out.indexOf(`data-testid="${id}"`, tagEnd);
  }
  return found;
}
const raw = (focus) => ({ focus, figures: [], cards: [], index: [], meter: null });
const desktop = (focus) => renderToStaticMarkup(h(MemoryRouter, null, h(ValidateNextAction, { raw: raw(focus), search: Q })));
const phone = (focus) => renderToStaticMarkup(h(MemoryRouter, null, h(PhoneCycleRoot, { cycle: 'validate', raw: raw(focus), search: Q, projectId: P })));

/** What each presentation shows: headline, why, primary label and href, secondary hrefs. */
function seen(out, ids) {
  // A plain string search, not a RegExp built from a variable (code scanning 6939).
  const at = out.indexOf(`id="${ids.title}"`);
  const open = at < 0 ? -1 : out.indexOf('>', at);
  const head = open < 0 ? null : [null, out.slice(open + 1, out.indexOf('<', open))];
  const cta = pick(out, ids.cta)[0] || null;
  return {
    headline: head ? decode(head[1]) : null,
    why: pick(out, ids.why)[0]?.text ?? null,
    cta: cta ? { label: cta.text, href: cta.href } : null,
    secondary: (ids.secondaryWrap ? pick(out, ids.secondaryWrap)[0] ? [...out.slice(out.indexOf(`data-testid="${ids.secondaryWrap}"`)).split('</div>')[0].matchAll(/href="([^"]*)"/g)].map((m) => decode(m[1])) : [] : pick(out, ids.secondary).map((s) => s.href)),
  };
}
const DESK = { title: 'validate-next-title', why: 'validate-next-why', cta: 'validate-next-cta', secondary: 'validate-next-secondary' };
const PHONE = { title: 'phone-focus-title', why: 'phone-focus-why', cta: 'phone-focus-cta', secondaryWrap: 'phone-focus-secondary' };

for (const [name, facts, rule, href, secondary] of CASES) {
  test(`same action on desktop and phone: ${name}`, () => {
    const focus = nextAction(facts);
    assert.equal(focus.rule, rule);
    assert.equal(focus.cta.href, href, 'the exact, venture-aware destination');
    assert.ok(focus.why === null ? rule === 'card' : focus.why.length > 0, 'a short reason');
    if (rule !== 'card') assert.ok(href.includes(`project=${P}`) || href.includes(`project_id=${P}`), 'the href names the venture');
    const d = seen(desktop(focus), DESK);
    const p = seen(phone(focus), PHONE);
    assert.deepEqual(d, p, 'desktop and phone draw the same action');
    assert.equal(d.headline, focus.headline);
    assert.deepEqual(d.cta, { label: focus.cta.label, href });
    assert.deepEqual(d.secondary, secondary);
  });
}

for (const [name, facts, why] of UNAVAILABLE) {
  test(`unavailable on both, never progress: ${name}`, () => {
    const focus = nextAction(facts);
    assert.equal(focus.rule, 'unavailable');
    assert.equal(focus.state, 'unavailable');
    assert.equal(focus.cta, null);
    const d = seen(desktop(focus), DESK);
    const p = seen(phone(focus), PHONE);
    assert.deepEqual(d, p);
    assert.equal(d.cta, null, 'no primary action from a read that failed');
    assert.match(d.why, why);
    assert.match(d.why, /This is not a claim that nothing is waiting\./);
    assert.deepEqual(d.secondary, [`/validate/record?project=${P}`], 'recording stays in reach');
  });
}

test('the policy is pure: the same facts give the same action, and it never names a decision as made', () => {
  for (const [, facts] of CASES) assert.deepEqual(nextAction(facts), nextAction(facts));
  const ready = nextAction(base({ claims: [claim({ status: 'supported', supporting: 5 })] }));
  assert.match(ready.why, /is yours to record; nothing here records it for you\./);
  const stop = nextAction(base({ decision: { id: 77, decision: 'stop', decided_at: '2026-10-12' } }));
  assert.equal(stop.headline, 'You decided to stop on 12 Oct.');
  assert.ok(!stop.secondary.some((s) => s.href.startsWith('/validate/record') || s.href.startsWith('/build/')), 'a Stop never prompts recording or building');
});

test('a Stop draws no interview meter on the phone; the desktop overview draws the panel in its lead row', () => {
  const stop = nextAction(base({ decision: { id: 77, decision: 'stop', decided_at: '2026-10-12' } }));
  assert.equal(phone(stop).includes('data-testid="phone-meter"'), false);
  const out = renderToStaticMarkup(h(MemoryRouter, null, h(CycleOverview, {
    cycle: 'validate', data: { figures: [], cards: [] }, status: 'ready', search: Q,
    lead: h(ValidateNextAction, { raw: raw(stop), search: Q }),
  })));
  assert.ok(out.includes('data-testid="validate-next-action"'));
  assert.ok(out.includes('data-rule="stopped"'));
});

test('a focus the Worker could not send falls back on both without crashing the desktop panel', () => {
  // The focus part failed (null): the adapter's own fallbacks carry no Worker `secondary`.
  const empty = { focus: null, figures: [], index: [], meter: null, cards: [{ slug: 'customer-research', name: 'Customer research', state: 'empty' }] };
  const card = { focus: null, figures: [], index: [], meter: null, cards: [{ slug: 'problem-discovery', name: 'Problem discovery', next: { text: 'Open the pain map', href: `/validate/problem-discovery${Q}` } }] };
  for (const r of [empty, card]) {
    const d = seen(renderToStaticMarkup(h(MemoryRouter, null, h(ValidateNextAction, { raw: r, search: Q }))), DESK);
    const p = seen(renderToStaticMarkup(h(MemoryRouter, null, h(PhoneCycleRoot, { cycle: 'validate', raw: r, search: Q, projectId: P }))), PHONE);
    assert.ok(d.cta, 'the desktop panel draws the fallback');
    assert.deepEqual(d.secondary, []);
    assert.equal(d.cta.href, p.cta.href);
  }
});

test('no focus draws no panel; a loading overview draws no lead', () => {
  assert.equal(desktop(null), '');
  const out = renderToStaticMarkup(h(MemoryRouter, null, h(CycleOverview, {
    cycle: 'validate', data: null, status: 'loading', search: Q, lead: h('div', { 'data-testid': 'lead' }),
  })));
  assert.equal(out.includes('data-testid="lead"'), false);
});
