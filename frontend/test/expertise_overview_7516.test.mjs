/**
 * D7516 (#7516, Expertise v2 EX-01, EX-03, EX-04b) — the Expertise Overview's
 * Next step, its four-dimension status strip on #5129's StateChip, and the
 * admin preview with no advisor selected.
 *
 * The model, the lead and the board are the real files; the API is a stub and
 * every fixture is synthetic. Each test names the rule it pins.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { h, mountForm, textOf } from './_form_d695.mjs';
import ViewModeContext from '../src/contexts/ViewModeContext.js';
import ExpertiseOverview from '../src/pages/advisor/expertise/ExpertiseOverview.jsx';
import {
  CHOOSE_ADVISOR_PATH, DIMENSIONS, MAX_STEPS, completionOf, dimensionState, isAdvisorPreview, nextSteps, statusStrip,
} from '../src/pages/advisor/expertise/overviewModel.js';
import BucketBoard from '../src/workspaces/BucketBoard.jsx';
import advisorExpertiseBoard from '../src/workspaces/boards/advisorExpertise.js';
import { bucketForPath } from '../src/workspaces/shellConfig.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const flush = () => new Promise((resolve) => setImmediate(resolve));

// ─────────────────────────────────────────── fixtures (synthetic)

const PROFILE = {
  uid: 'adv-7516', display_name: 'Synthetic Advisor', is_active: true,
  headline: 'Pricing for seed teams', sectors: ['Fintech'], stages: ['Seed'], languages: [],
  country: 'Portugal', availability_note: '', headshot_url: null,
};
const SERVICES = {
  items: [{ id: 1, title: 'Board readiness review', price_cents: null, is_active: true }],
  page: { total: 3, next_offset: null }, counts: { total: 3, live: 2, unpriced: 1 },
  publication_counts: { draft: 1, published: 2, hidden: 0 },
};
const PROOF = {
  items: [
    { id: 11, title: 'Enterprise GTM', attested: false, status: 'self_stated', consents: [{ state: 'needs_reconfirmation', attester_name: 'R. Example' }] },
    { id: 12, title: 'Series A close', attested: true, status: 'attested', consents: [{ state: 'confirmed', attester_name: 'Q. Example' }] },
  ],
  page: { total: 2, next_offset: null }, counts: { total: 2, attested: 1, self_stated: 1, awaiting: 0, needs_reconfirmation: 1 },
};
const THINKING = {
  items: [{ id: 21, title: 'Pricing your first retainer', status: 'changes_requested' }],
  page: { total: 7, next_offset: null }, counts: { total: 7, published: 6 },
};
const VISIBILITY = {
  surfaces: [
    { kind: 'booking_link', name: '/b/a', is_active: true, requests: 2 },
    { kind: 'booking_link', name: '/b/b', is_active: false, requests: 0 },
    { kind: 'no_link', name: 'Booked without a link', requests: 0 },
  ],
  links: { total: 2, next_offset: null }, requests: { total: 2 },
  unlinked_services: { items: [{ uid: 'st1', name: 'Intro call' }], more: false },
};
const ok = (data) => ({ state: 'ready', data, error: null, retry() {} });
const err = (code = null) => ({ state: 'error', data: null, error: 'This section could not be read.', code, retry() {} });
const LOADING = { state: 'loading', data: null, error: null, retry() {} };
const allReady = (over = {}) => ({
  profile: ok(PROFILE), services: ok(SERVICES), proof: ok(PROOF), thinking: ok(THINKING), visibility: ok(VISIBILITY), ...over,
});
const cellOf = (sources, key) => statusStrip(sources).find((c) => c.key === key);

// ─────────────────────────────────────────── the four dimensions (EX-01)

test('the strip is exactly the four dimensions #4823 names, in its order', () => {
  // Mutation checked: a fifth dimension added, or two swapped → the list differs.
  assert.deepEqual(DIMENSIONS.map((d) => d.label), ['Completion', 'Publication', 'Verification', 'Availability']);
});

test('Completion counts the Profile meter’s fields from the saved profile, and names the missing ones', () => {
  // Mutation checked: `filled` replaced by a truthy check → an empty list counts as filled and "4 of 7" becomes "6 of 7".
  assert.deepEqual(completionOf(PROFILE), { complete: 4, total: 7, missing: ['Languages', 'Availability window', 'Headshot'] });
  const c = cellOf(allReady(), 'completion');
  assert.equal(c.state, 'value');
  assert.equal(c.value.word, 'Incomplete');
  assert.equal(c.value.fact, '4 of 7 fields');
  assert.equal(c.value.sub, 'Missing: languages, availability window, headshot.');
  const none = cellOf(allReady({ profile: ok(null) }), 'completion');
  assert.equal(none.value.word, 'No profile yet');
  assert.equal(none.value.fact, null, 'no profile is not "0 of 7"');
});

test('Publication reads the whole-list counts: services published, articles published, listed or not; proof stays private', () => {
  // Mutation checked: `publication_counts.published` read as `counts.live` → "3 services published".
  const c = cellOf(allReady({ services: ok({ ...SERVICES, counts: { ...SERVICES.counts, live: 3 } }) }), 'publication');
  assert.equal(c.value.word, 'Profile listed');
  assert.equal(c.value.fact, '2 services published · 6 articles published');
  assert.match(c.value.sub, /Proof is private to you/);
  assert.deepEqual(c.value.action, { label: 'Preview public profile ↗', to: '/advisors/adv-7516' });
  const unlisted = cellOf(allReady({ profile: ok({ ...PROFILE, is_active: false }) }), 'publication');
  assert.equal(unlisted.value.word, 'Profile not listed');
});

test('Verification is confirmed, awaiting, self-stated and needs reconfirmation, every one from the whole-list counts', () => {
  const c = cellOf(allReady(), 'verification');
  assert.equal(c.value.fact, '1 confirmed · 0 awaiting');
  assert.equal(c.value.sub, '1 self-stated · 1 needs reconfirmation.');
  // D7807 (#7807): a partial page reads the Worker's whole-list figure, never the page's.
  // Mutation checked: `num(c.needs_reconfirmation)` replaced by the old `wholePage(...) ? reconfirmations(proof).length : null` → the paged sub drops "40 need reconfirmation".
  const paged = cellOf(allReady({ proof: ok({ ...PROOF, page: { total: 300, next_offset: 200 }, counts: { ...PROOF.counts, total: 300, self_stated: 299, needs_reconfirmation: 40 } }) }), 'verification');
  assert.equal(paged.value.sub, '299 self-stated · 40 need reconfirmation.', 'a page of 300 claims states the whole list’s figure');
  // Mutation checked: `num(c.needs_reconfirmation)` replaced by `reconfirmations(proof).length` → the stale row on the page is counted and "1 needs reconfirmation" appears.
  const unread = cellOf(allReady({ proof: ok({ ...PROOF, counts: { ...PROOF.counts, needs_reconfirmation: null } }) }), 'verification');
  assert.equal(unread.value.sub, '1 self-stated.', 'a count that did not come back is left out, never counted off the page');
  const empty = cellOf(allReady({ proof: ok({ items: [], page: { total: 0, next_offset: null }, counts: { total: 0, attested: 0, self_stated: 0, awaiting: 0 } }) }), 'verification');
  assert.equal(empty.value.word, 'No claims yet');
});

test('Availability is live booking links of the total, and the session types no live link sells', () => {
  // Mutation checked: live counted with no is_active filter → "2 live booking links of 2".
  const c = cellOf(allReady(), 'availability');
  assert.equal(c.value.fact, '1 live booking link of 2');
  assert.equal(c.value.sub, '1 active session type has no live link.');
  assert.equal(c.value.action.to, '/practice/sessions');
  const paged = cellOf(allReady({ visibility: ok({ ...VISIBILITY, links: { total: 250, next_offset: 100 } }) }), 'availability');
  assert.equal(paged.value.fact, '250 booking links', 'a partial page of links states the total, not a live count');
  const none = cellOf(allReady({ visibility: ok({ ...VISIBILITY, surfaces: [], links: { total: 0, next_offset: null }, unlinked_services: { items: [] } }) }), 'availability');
  assert.equal(none.value.fact, 'No booking link');
  assert.equal(none.value.word, 'Not bookable');
});

test('a dimension is Loading, Refused, Unavailable or Partial from its own reads, never a value it could not read', () => {
  // Mutation checked: partial folded into value → the publication cell claims to be whole with Services unread.
  assert.equal(dimensionState(allReady({ proof: LOADING }), ['proof']), 'loading');
  assert.equal(dimensionState(allReady({ proof: err('advisor_licence_required') }), ['proof']), 'refused');
  assert.equal(dimensionState(allReady({ proof: err() }), ['proof']), 'unavailable');
  const pub = cellOf(allReady({ services: err() }), 'publication');
  assert.equal(pub.state, 'partial');
  assert.equal(pub.value.fact, '6 articles published', 'the failed read is left out, never shown as 0');
  assert.deepEqual(pub.retry, ['services']);
  const refusedRead = cellOf(allReady({ profile: err('advisor_licence_required') }), 'completion');
  assert.equal(refusedRead.state, 'refused');
  assert.deepEqual(refusedRead.retry, [], 'a refusal is an answer: nothing to retry');
});

// ─────────────────────────────────────────── the Next step (EX-01, EX-04b)

test('the Next step waits for every read, leads with the reconfirmation, and offers at most three', () => {
  // Mutation checked: MAX_STEPS raised to 4 → four steps; the reconfirm rule moved after the profile gaps → it no longer leads.
  assert.equal(nextSteps(allReady({ visibility: LOADING })).state, 'loading', 'a step is not chosen while a read is in flight');
  const n = nextSteps(allReady());
  assert.equal(n.state, 'ready');
  assert.equal(MAX_STEPS, 3);
  assert.equal(n.steps.length, 3);
  assert.equal(n.steps[0].title, 'Ask R. Example to reconfirm “Enterprise GTM”');
  assert.equal(n.steps[0].to, '/expertise/proof');
  assert.equal(n.steps[1].title, 'Review editor feedback on “Pricing your first retainer”');
  assert.equal(n.steps[1].to, '/articles/edit/21');
  assert.equal(n.steps[2].title, 'Fill in 3 profile fields a match reads');
  assert.deepEqual(n.unread, []);
});

test('no profile makes Create profile the only step; a failed read offers none of its steps and is named', () => {
  // Mutation checked: the create-profile break removed → later steps join it; unread no longer collected → the list is empty.
  const none = nextSteps(allReady({ profile: ok(null), services: ok({ items: [], counts: { total: 0, unpriced: 0 } }), proof: err(), thinking: ok({ items: [], counts: { total: 0 } }), visibility: err() }));
  assert.deepEqual(none.steps.map((s) => s.key), ['create-profile']);
  const partial = nextSteps(allReady({ proof: err(), thinking: err() }));
  assert.ok(!partial.steps.some((s) => s.area === 'Proof' || s.area === 'Thinking'), 'no step from a read that failed');
  assert.deepEqual(partial.unread, ['Proof', 'Thinking']);
  assert.equal(partial.steps[0].key, 'fill-profile');
});

test('a record that supports no step draws no card', async () => {
  // Mutation checked: the empty-steps return dropped → an empty violet card renders.
  const done = allReady({
    profile: ok({ ...PROFILE, languages: ['English'], availability_note: 'Tuesdays', headshot_url: 'https://example.invalid/h.png' }),
    services: ok({ ...SERVICES, counts: { ...SERVICES.counts, unpriced: 0 } }),
    proof: ok({ items: [], page: { total: 1, next_offset: null }, counts: { total: 1, attested: 1, self_stated: 0, awaiting: 0 } }),
    thinking: ok({ items: [], counts: { total: 1, published: 1 } }),
    visibility: ok({ ...VISIBILITY, unlinked_services: { items: [] } }),
  });
  assert.deepEqual(nextSteps(done).steps, []);
  const f = await mountForm(h(ExpertiseOverview, { sources: done }));
  try {
    assert.ok(!f.by('expertise-next-step'));
    assert.ok(f.by('expertise-status'), 'the strip still draws');
  } finally { await f.unmount(); }
});

test('the card draws the step full width on a phone, with a 48px button, and the strip’s actions are 44px there', async () => {
  // Mutation checked: `max-sm:w-full` or `max-sm:min-h-[48px]` dropped from the action → the class checks fail.
  const f = await mountForm(h(ExpertiseOverview, { sources: allReady(), fallback: h('div', { 'data-testid': 'sections' }) }));
  try {
    const card = f.by('expertise-next-step');
    assert.match(textOf(card), /Next step · Proof/);
    assert.match(textOf(card), /Ask R\. Example to reconfirm “Enterprise GTM”/);
    assert.match(textOf(card), /Also worth doing/);
    const action = f.by('expertise-next-step-action');
    assert.equal(f.props(action).href, '/expertise/proof');
    assert.match(f.props(action).className, /max-sm:w-full/);
    assert.match(f.props(action).className, /max-sm:min-h-\[48px\]/);
    assert.match(f.props(f.by('expertise-status-action-completion')).className, /max-sm:min-h-\[44px\]/);
    assert.ok(f.by('sections'), 'the sections follow the lead');
    assert.doesNotMatch(f.text(), /recommend|advice|fiduciary/i, 'regulated words stay out of the overview');
  } finally { await f.unmount(); }
});

test('a failed read is #5129’s Unavailable chip with its own Retry, which reads only that source again', async () => {
  // Mutation checked: Retry calling every source's retry → the profile is read again too.
  const calls = [];
  const sources = allReady({
    proof: { ...err(), retry: () => calls.push('proof') },
    services: { ...err(), retry: () => calls.push('services') },
    profile: { ...ok(PROFILE), retry: () => calls.push('profile') },
  });
  const f = await mountForm(h(ExpertiseOverview, { sources }));
  try {
    const ver = f.by('expertise-status-verification');
    assert.equal(f.props(ver)['data-state'], 'unavailable');
    assert.ok(f.nodes().some((n) => f.props(n)['data-platform-state'] === 'unavailable'), 'the Unavailable StateChip');
    assert.match(textOf(ver), /Proof could not be read\. This is not a claim that none exist\./);
    assert.doesNotMatch(textOf(ver), /\b0 confirmed\b/);
    await act(async () => f.props(f.by('expertise-status-retry-verification')).onClick({}));
    assert.deepEqual(calls, ['proof']);
    assert.ok(f.nodes().some((n) => f.props(n)['data-platform-state'] === 'partial'), 'Publication without Services is Partial');
    assert.match(textOf(f.by('expertise-next-step-unread')), /Services and Proof could not be read/);
  } finally { await f.unmount(); }
});

// ─────────────────────────────────────────── the admin preview (EX-03)

test('the preview is an administrator browsing as Advisor, not a support session and not an advisor', () => {
  // Mutation checked: `isImpersonating !== true` dropped → a support session reads as a preview.
  assert.equal(isAdvisorPreview({ isAdmin: true, isImpersonating: false, viewMode: 'advisor' }), true);
  assert.equal(isAdvisorPreview({ isAdmin: true, isImpersonating: true, viewMode: 'advisor' }), false);
  assert.equal(isAdvisorPreview({ isAdmin: false, isImpersonating: false, viewMode: 'advisor' }), false);
  assert.equal(isAdvisorPreview({ isAdmin: true, isImpersonating: false, viewMode: 'founder' }), false);
  assert.equal(isAdvisorPreview(null), false);
});

test('an admin previewing the role sees one state and a data-free layout instead of the sections, with Impersonate and Exit', async () => {
  // Mutation checked: the preview branch removed → the strip and the sections render for the admin.
  let exits = 0;
  const view = { isAdmin: true, isImpersonating: false, viewMode: 'advisor', exitPreview: () => { exits += 1; } };
  const el = h(ViewModeContext.Provider, { value: view }, h(ExpertiseOverview, { sources: allReady(), fallback: h('div', { 'data-testid': 'sections' }) }));
  const f = await mountForm(el);
  try {
    assert.ok(f.by('expertise-admin-preview'));
    assert.match(f.text(), /Select an advisor to view their Expertise/);
    assert.match(textOf(f.by('expertise-preview-layout')), /Layout only · no data/);
    assert.ok(!f.by('sections'), 'no section explains an absence');
    assert.ok(!f.by('expertise-status'));
    assert.doesNotMatch(f.text(), /4 of 7|Enterprise GTM/, 'nothing read is shown');
    await f.click('Exit preview');
    assert.equal(exits, 1);
    await f.click('Impersonate an advisor');
    assert.equal(exits, 2, 'Impersonate leaves the preview before opening All accounts');
    assert.equal(CHOOSE_ADVISOR_PATH, '/admin/accounts/all');
  } finally { await f.unmount(); }
  const advisor = await mountForm(h(ViewModeContext.Provider, { value: { isAdmin: false, viewMode: 'advisor' } },
    h(ExpertiseOverview, { sources: allReady(), fallback: h('div', { 'data-testid': 'sections' }) })));
  try {
    assert.ok(!advisor.by('expertise-admin-preview'), 'an advisor never sees the preview');
    assert.ok(advisor.by('sections'));
  } finally { await advisor.unmount(); }
});

// ─────────────────────────────────────────── the board

test('the Expertise board leads with the overview, which reads the board’s sources and nothing twice', async () => {
  // Mutation checked: `sources={byKey}` dropped from BucketBoard → the strip stays loading; `lead` removed → no strip.
  const calls = { profile: 0, services: 0, proof: 0, thinking: 0, visibility: 0 };
  const api = {
    getMyAdvisor: async () => { calls.profile += 1; return PROFILE; },
    listMyAdvisorServices: async () => { calls.services += 1; return SERVICES; },
    listMyAdvisorProof: async () => { calls.proof += 1; return PROOF; },
    listMyAdvisorThinking: async () => { calls.thinking += 1; return THINKING; },
    getMyAdvisorVisibility: async () => { calls.visibility += 1; return VISIBILITY; },
  };
  const bucket = bucketForPath('advisor', '/expertise');
  const f = await mountForm(h(BucketBoard, { bucket, role: 'advisor', board: advisorExpertiseBoard('advisor', api) }));
  try {
    for (let i = 0; i < 20 && !f.by('expertise-status'); i += 1) await act(async () => { await flush(); });
    assert.ok(f.by('expertise-status'), 'the lazy lead loaded');
    await act(async () => { await flush(); });
    assert.equal(textOf(f.by('expertise-status-fact-completion')), '4 of 7 fields');
    assert.match(textOf(f.by('expertise-next-step')), /Ask R\. Example to reconfirm/);
    assert.ok(f.nodes().some((n) => f.props(n).id === 'ex-proof'), 'the sections still render below');
    assert.deepEqual(calls, { profile: 1, services: 1, proof: 1, thinking: 1, visibility: 1 }, 'one read per source');
  } finally { await f.unmount(); }
});

test('every light surface in the overview carries its dark pair', () => {
  // Mutation checked: a `dark:bg-gray-900` removed → this and check-dark-mode fail.
  const src = read('frontend/src/pages/advisor/expertise/ExpertiseOverview.jsx');
  for (const line of src.split('\n')) {
    if (/\bbg-white\b/.test(line)) assert.match(line, /dark:bg-/, line.trim());
    if (/\btext-gray-(700|800|900)\b/.test(line)) assert.match(line, /dark:text-/, line.trim());
  }
});
