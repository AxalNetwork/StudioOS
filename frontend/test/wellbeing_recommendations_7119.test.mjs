/**
 * D7119 part 2 (#7119): Recommendations and Choose interests on the Wellness home (canvas WLM-04, WLM-05, WLM-05B,
 * WLM-05C), on part 1's routes. Suggestions use only the member's choices, plus topics only with permission.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/wellbeing_recommendations_7119.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import * as M from '../src/pages/wellbeing/recommendationsModel.js';
import { SuggestionsSection } from '../src/pages/wellbeing/WellnessSuggestions.jsx';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

const OPTIONS = [
  { key: 'therapy', label: 'Licensed therapy', suggested_from_topics: false },
  { key: 'nutrition', label: 'General nutrition support', suggested_from_topics: true },
  { key: 'coaching', label: 'Coaching', suggested_from_topics: true },
  { key: 'spiritual', label: 'Spiritual guidance', suggested_from_topics: false },
];
const PREFS = (over = {}) => ({
  support_types: [], languages: [], timezone: null, price_max_cents: null, formats: [], suggestions: true, topic_consent: false,
  topic_sources: [], topic_consent_at: null, revision: 0, support_type_options: OPTIONS,
  topic_consent_scope: 'Only the topics you choose on a reflection. Never what you write, never your answers, never your bookings.', ...over,
});
const NOT_USED = ['Anything you wrote in a reflection', 'Your answers to the reflection questions', 'Your bookings and who you booked'];
const EXPERT = {
  kind: 'expert', uid: 'ex1', name: 'Synthetic Expert', headline: 'Coach', verified: true, support_types: [{ key: 'coaching', label: 'Coaching' }],
  languages: ['en'], timezones: ['UTC'], format: 'one_to_one', services: [{ uid: 's1', title: 'Session', duration_minutes: 50, price_cents: 14000, currency: 'USD' }],
  available: true, availability: 'windows', why: { used: [{ kind: 'interest', label: 'You chose Coaching' }], not_used: [...NOT_USED, 'Topics on your reflections (you have not allowed this)'] },
};
const SESSION = {
  kind: 'session', uid: 'gs1', title: 'Synthetic circle', support_type: { key: 'nutrition', label: 'General nutrition support' }, facilitator: { name: 'Synthetic Facilitator' },
  language: 'en', starts_at: '2026-11-25 18:00:00', seats_left: 3, state: 'open', available: true,
  why: { used: [{ kind: 'interest', label: 'You chose General nutrition support' }, { kind: 'format', label: 'You asked for group sessions' }], not_used: NOT_USED },
};

// ── The model ───────────────────────────────────────────────────────────────────────────────────────────────

test('model: a save sends only what changed, with the revision; consent needs a source; bad values are refused first', () => {
  const p = PREFS({ revision: 3 });
  assert.equal(M.prefsBody(M.prefsDraft(p), p), null, 'nothing changed sends nothing');
  const d = { ...M.prefsDraft(p), support_types: ['nutrition'], formats: ['group'], languages: 'EN, fr', price: '120' };
  assert.deepEqual(M.prefsBody(d, p), { support_types: ['nutrition'], formats: ['group'], languages: ['en', 'fr'], price_max_cents: 12000, base_revision: 3 });
  assert.ok(M.prefsBody({ ...M.prefsDraft(p), topic_consent: true }, p).problem, 'consent without a source is not sent');
  assert.deepEqual(M.prefsBody({ ...M.prefsDraft(p), topic_consent: true, topic_sources: ['week'] }, p), { topic_consent: true, topic_sources: ['week'], base_revision: 3 });
  const on = PREFS({ topic_consent: true, topic_sources: ['week'], revision: 4 });
  assert.deepEqual(M.prefsBody({ ...M.prefsDraft(on), topic_consent: false }, on), { topic_consent: false, base_revision: 4 }, 'revoking is one field');
  assert.ok(M.prefsBody({ ...M.prefsDraft(p), languages: 'english' }, p).problem);
  assert.ok(M.prefsBody({ ...M.prefsDraft(p), price: '-1' }, p).problem);
  assert.deepEqual(M.prefsBody({ ...M.prefsDraft(PREFS({ price_max_cents: 5000 })), price: '' }, PREFS({ price_max_cents: 5000 })), { price_max_cents: null, base_revision: 0 }, 'blank is no limit');
});

test('model: the chosen line, card facts, what was not shown, and the section’s states — unreadable is never none', () => {
  assert.match(M.chosenLine(PREFS()), /haven’t chosen any interests/);
  assert.equal(M.chosenLine(PREFS({ support_types: ['coaching', 'nutrition'] })), 'From what you chose: General nutrition support · Coaching. Spiritual guidance is off.');
  const e = M.cardFacts(EXPERT);
  assert.deepEqual(e.facts, [['Format', '1:1'], ['Language', 'en'], ['Time zone', 'UTC'], ['Price', 'From $140']]);
  assert.equal(e.next, 'Offers times to book');
  assert.equal(M.cardFacts({ ...EXPERT, available: false }).next, 'No open times right now');
  assert.equal(M.cardFacts({ ...EXPERT, services: [] }).facts[3][1], null, 'no price is Not recorded, never $0');
  const g = M.cardFacts(SESSION);
  assert.deepEqual([g.facts[0], g.facts[3], g.next], [['Format', 'Group'], ['Price', 'Free'], '3 seats left']);
  assert.equal(M.cardFacts({ ...SESSION, state: 'full', seats_left: 0 }).next, 'Full · no seats left');
  assert.equal(M.excludedLine({ dismissed: 1, language: 2, price: 0, format: 0 }), 'Not shown: 1 dismissed, 2 outside your languages.');
  assert.equal(M.excludedLine({ dismissed: 0, language: 0, price: 0, format: 0 }), null);
  assert.equal(M.sectionState({ state: 'unreadable' }), 'unreadable');
  assert.equal(M.sectionState({ state: 'ok', value: { state: 'weird' } }), 'unreadable');
  assert.equal(M.sectionState({ state: 'ok', value: { state: 'no_match' } }), 'no_match');
});

// ── Rendering ───────────────────────────────────────────────────────────────────────────────────────────────

const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
async function mount(routes) {
  const restore = installDocument();
  const prev = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (u, opts = {}) => {
    const key = `${opts.method || 'GET'} ${String(u).replace(/^.*\/api/, '').replace(/\?.*$/, '')}`;
    asked.push({ key, body: opts.body ? JSON.parse(opts.body) : null });
    const hit = routes[key];
    const out = typeof hit === 'function' ? await hit(opts) : hit;
    if (out && out.__status) return response({ error: out.code, message: 'refused' }, out.__status);
    return response(out ?? {});
  };
  localStorage.setItem('user', JSON.stringify({ id: 6, role: 'founder', name: 'Synthetic' }));
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  const flush = async () => { for (let i = 0; i < 14; i += 1) await act(async () => { await new Promise((r) => setImmediate(r)); }); };
  await act(async () => root.render(h(MemoryRouter, null, h(SuggestionsSection))));
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(document.body).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : (n.childNodes || []).map(txt).join(' ') || n.textContent || '');
  return {
    asked, has: (id) => !!by(id), props: (id) => pr(by(id)), text: (id) => txt(by(id)).replace(/\s+/g, ' ').trim(),
    click: async (id) => { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { pr(n).onClick({ preventDefault() {} }); }); await flush(); },
    change: async (id, value) => { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { pr(n).onChange({ target: { value } }); }); },
    submit: async (id) => { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { await pr(n).onSubmit({ preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = prev; localStorage.removeItem('user'); restore(); },
  };
}

test('cards: Why this? says what was used and what never is; Dismiss hides it with Undo; a group session needs no booking link here', async () => {
  let dismissed = false;
  const v = await mount({
    'GET /wellbeing/preferences': PREFS({ support_types: ['coaching', 'nutrition'], formats: ['group', 'one_to_one'] }),
    'GET /wellbeing/recommendations': () => ({ state: 'ok', items: dismissed ? [SESSION] : [EXPERT, SESSION], excluded: { dismissed: dismissed ? 1 : 0, language: 0, price: 0, format: 0 }, topic_consent: false }),
    'POST /wellbeing/recommendations/dismiss': () => { dismissed = true; return { dismissed: true }; },
    'DELETE /wellbeing/recommendations/dismiss/expert/ex1': () => { dismissed = false; return { dismissed: false }; },
  });
  try {
    assert.match(v.text('rec-chosen'), /General nutrition support · Coaching/);
    await v.click('button-rec-why-ex1');
    assert.match(v.text('rec-why-ex1'), /You chose Coaching.*Not used:.*Anything you wrote in a reflection.*Topics on your reflections/);
    assert.equal(v.props('rec-view-ex1').href, '/wellbeing/expert/ex1');
    assert.equal(v.has('rec-view-gs1'), false);
    assert.equal(v.text('rec-next-gs1'), '3 seats left');
    await v.click('button-rec-dismiss-ex1');
    const post = v.asked.find((a) => a.key === 'POST /wellbeing/recommendations/dismiss');
    assert.deepEqual(post.body, { kind: 'expert', uid: 'ex1' });
    assert.equal(v.has('rec-expert-ex1'), false);
    assert.match(v.text('rec-excluded'), /Not shown: 1 dismissed\./);
    await v.click('button-rec-undo');
    assert.equal(v.has('rec-expert-ex1'), true, 'Undo brings it back');
  } finally { await v.close(); }
});

test('states: nothing chosen, off, no match and a failed read each say their own thing; Browse all always stays', async () => {
  for (const [state, id] of [['choose_interests', 'rec-choose'], ['off', 'rec-off'], ['no_match', 'rec-none']]) {
    const v = await mount({ 'GET /wellbeing/preferences': PREFS(), 'GET /wellbeing/recommendations': { state, items: [], excluded: { dismissed: 0, language: 0, price: 0, format: 0 } } });
    try { assert.equal(v.has(id), true, state); assert.equal(v.props('rec-browse-all').href, '/wellbeing/book'); } finally { await v.close(); }
  }
  const bad = await mount({ 'GET /wellbeing/preferences': PREFS(), 'GET /wellbeing/recommendations': { __status: 503, code: 'recommendations_unreadable' } });
  try {
    assert.match(bad.text('rec-unreadable'), /This is not a claim that none match/);
    assert.equal(bad.has('rec-none'), false);
  } finally { await bad.close(); }
});

test('Choose interests: a nutrition interest and group format save with the revision; consent needs a source; Reset asks first', async () => {
  const v = await mount({
    'GET /wellbeing/preferences': PREFS({ revision: 2 }),
    'GET /wellbeing/recommendations': { state: 'choose_interests', items: [] },
    'PUT /wellbeing/preferences': PREFS({ support_types: ['nutrition'], formats: ['group'], revision: 3 }),
    'POST /wellbeing/preferences/reset': PREFS(),
  });
  try {
    await v.click('button-choose-interests');
    assert.match(v.text('interest-topic-scope'), /Never what you write/);
    await v.click('interest-nutrition');
    await v.click('interest-format-group');
    await v.click('interest-topic-consent');
    await v.submit('interests-panel');
    assert.match(v.text('interests-error'), /Choose which of your reflections/);
    assert.equal(v.asked.some((a) => a.key === 'PUT /wellbeing/preferences'), false, 'nothing is sent without a source');
    await v.click('interest-topic-consent');
    await v.submit('interests-panel');
    const put = v.asked.find((a) => a.key === 'PUT /wellbeing/preferences');
    assert.deepEqual(put.body, { support_types: ['nutrition'], formats: ['group'], base_revision: 2 });
    await v.click('button-choose-interests');
    await v.click('button-interests-reset');
    assert.equal(v.asked.some((a) => a.key === 'POST /wellbeing/preferences/reset'), false, 'Reset asks first');
    await v.click('button-interests-reset-confirm');
    assert.equal(v.asked.some((a) => a.key === 'POST /wellbeing/preferences/reset'), true);
  } finally { await v.close(); }
});

test('wiring: the home mounts Recommendations; the section reads no journal route; dark pairs; no clinical words', () => {
  const page = read('frontend/src/pages/WellbeingPage.jsx');
  assert.match(page, /<SuggestionsSection \/>/);
  const src = read('frontend/src/pages/wellbeing/WellnessSuggestions.jsx') + read('frontend/src/pages/wellbeing/recommendationsModel.js');
  assert.doesNotMatch(src, /wellbeingReflectionsApi|\/checkins|wellbeingMyCheckins/, 'opted out or in, the page never reads the journal itself');
  for (const m of src.matchAll(/className=\{?[`"]([^`"]*)/g)) {
    if (/\bbg-white\b/.test(m[1])) assert.match(m[1], /dark:bg-/, m[1]);
  }
  assert.doesNotMatch(src, /diagnos|prescrib|you need/i);
});
