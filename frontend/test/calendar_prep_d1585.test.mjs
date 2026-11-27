// D1585 (#3832, deck v2 F6) — "Prep" on an investor meeting in the Calendar
// item drawer. The drawer runs against a stubbed fetch through the real
// clients; the brief is worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { h, mountForm, sourceModule } from './_form_d695.mjs';
import { STAGE_WORDS, linkLine, meetingLine, nextStepLine, objectionLine, readWords, whoLine } from '../src/pages/calendarPrepModel.js';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, statusText: String(status), headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const spaced = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(spaced).join(' ') : n.textContent || '');

const MEETING = {
  id: 'investor_meeting:11', kind: 'investor_meeting', source_id: 11, title: 'Investor meeting · Bluefern Capital',
  start_at: '2026-11-14T16:00:00Z', end_at: '2026-11-14T16:00:00Z', status: 'scheduled', location_kind: null, location_uri: null,
  notes: 'Meeting with Bluefern Capital, logged in Capital relationships.', family: 'meetings', my_role: { code: 'founder', words: 'Yours' },
  can: { rsvp: false, reschedule: false, cancel: false, copy: false }, href: '/raise/capital-relationships', project_name: 'Fixture AI Co',
  project_id: 101, prospect_id: 1, people: [],
};
const BRIEF = {
  prospect: { id: 1, name: 'Ada Fixture', firm: 'Bluefern Capital', stage: 'meeting', warm_path: 'Via Bea', next_step: 'Send the model', next_step_due: '2026-11-12' },
  meeting: { event_id: 11, kind: 'meeting', starts_at: '2026-11-14T16:00:00Z', note: 'Partner meeting' },
  last_met: { event_id: 10, kind: 'call', at: '2026-10-20T15:00:00Z' },
  timeline: { state: 'ok', items: [{ kind: 'note', note: 'Asked about churn', at: '2026-11-03 09:00:00' }] },
  deck: { state: 'ok', links: [{ link_id: 40, deck_id: 5, deck_title: 'Seed deck', sent_at: '2026-11-05 10:00:00', revoked: false, views: 2, read_seconds: 330, last_viewed_at: '2026-11-07', signals: [{ kind: 'first_view', at: '2026-11-05', words: 'Opened' }, { kind: 'revisit', at: '2026-11-07', words: 'Revisited after 48 h' }] }] },
  objections: { state: 'ok', theirs: [{ key: 'k1', text: 'Churn looks high', count: 2, prospects: 1, of_prospect: 2, answer: null }], elsewhere: [{ key: 'k2', text: 'Team lacks a CTO', count: 2, prospects: 2, of_prospect: 0, answer: 'We hired one' }] },
  basis: 'Read from Capital relationships, your deck links and the feedback you logged. No model ran.',
};

function serve(routes) {
  const sent = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    const method = options.method || 'GET';
    sent.push({ url: u, method });
    for (const [pattern, answer] of routes) if (pattern.test(`${method} ${u}`)) return response(...answer);
    return response({ detail: 'Not found' }, 404);
  };
  return { sent, restore: () => { globalThis.fetch = previous; } };
}
async function mount(element, routes) {
  const net = serve(routes);
  const ui = await mountForm(element, { modal: true });
  const settle = async () => { for (let i = 0; i < 5; i += 1) await ui.flush(); };
  await settle();
  return {
    ...ui, sent: net.sent, settle,
    press: async (n) => { assert.ok(n, 'no such node'); await act(async () => { await ui.props(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    say: (n) => { assert.ok(n, 'no such node'); return spaced(n).replace(/\s+/g, ' ').trim(); },
    all: (id) => ui.nodes().filter((n) => ui.props(n)['data-testid'] === id),
    async unmount() { await ui.unmount(); net.restore(); },
  };
}
const drawerModule = () => sourceModule(read('frontend/src/pages/CalendarItemDrawer.jsx'), 'pages/CalendarItemDrawer.jsx');
const ITEM = (item) => [/GET .*\/api\/calendar\/item\//, [{ item }, 200]];
const BRIEF_ROUTE = (body, status = 200) => [/GET .*\/api\/cycles\/raise\/prospects\/1\/brief\?project=101&event=11$/, [body, status]];

test('D1585 words: who, the next step, read time, a link, an objection, a meeting', () => {
  assert.equal(whoLine(BRIEF.prospect), 'Ada Fixture · Bluefern Capital · Meeting');
  assert.equal(whoLine({ stage: 'diligence' }), 'Not recorded · Diligence');
  assert.equal(nextStepLine(BRIEF.prospect), 'Send the model · due 2026-11-12');
  assert.equal(nextStepLine({ next_step: null }), null);
  // A recorded zero is "Not read yet", never "0 min read".
  assert.deepEqual([readWords(0), readWords(40), readWords(330)], ['Not read yet', 'Under a minute read', '6 min read']);
  assert.equal(linkLine(BRIEF.deck.links[0]), 'Seed deck · sent 2026-11-05 · 2 views · 6 min read');
  assert.equal(linkLine({ deck_title: null, sent_at: '2026-11-01 10:00:00', revoked: true }), 'Deck · sent 2026-11-01 · Withdrawn');
  assert.equal(objectionLine(BRIEF.objections.theirs[0], true), 'Churn looks high · they said it 2 times · No answer yet');
  assert.equal(objectionLine(BRIEF.objections.elsewhere[0], false), 'Team lacks a CTO · 2 investors · You have an answer');
  assert.equal(meetingLine(BRIEF.last_met, 'Last met'), 'Last met · Call · 2026-10-20');
  assert.equal(meetingLine(null, 'Last met'), null);
  assert.equal(STAGE_WORDS.to_contact, 'To contact');
});

test('D1585: Prep on an investor meeting reads the brief only when pressed, and shows it with no email', async () => {
  const { default: Drawer } = await drawerModule();
  const ui = await mount(h(Drawer, { kind: 'investor_meeting', id: '11', onClose() {} }), [ITEM(MEETING), BRIEF_ROUTE(BRIEF)]);
  try {
    assert.ok(ui.by('cal-item-prep'));
    // Mutation checked: CalendarPrep loading on mount → the brief is read before Prep is pressed and this fails.
    assert.ok(!ui.sent.some((s) => s.url.includes('/brief')), 'nothing is read before Prep is pressed');
    await ui.press(ui.by('cal-item-prep-open'));
    assert.ok(ui.sent.some((s) => /\/api\/cycles\/raise\/prospects\/1\/brief\?project=101&event=11$/.test(s.url)), 'this meeting\'s brief');
    assert.equal(ui.say(ui.by('cal-prep-who')), 'Ada Fixture · Bluefern Capital · Meeting');
    assert.match(ui.say(ui.by('cal-prep-next')), /Send the model · due 2026-11-12/);
    assert.equal(ui.say(ui.by('cal-prep-last')), 'Last met · Call · 2026-10-20');
    assert.match(ui.say(ui.by('cal-prep-theirs')), /Churn looks high · they said it 2 times · No answer yet/);
    assert.match(ui.say(ui.by('cal-prep-elsewhere')), /Team lacks a CTO/);
    assert.match(ui.say(ui.by('cal-prep-link')), /Seed deck · sent 2026-11-05 · 2 views · 6 min read · Opened · Revisited after 48 h/);
    assert.match(ui.say(ui.by('cal-prep-basis')), /No model ran/);
    assert.doesNotMatch(ui.text(), /@/);
  } finally { await ui.unmount(); }
});

test('D1585: a part that could not be read says so; a failed brief offers Retry; no Prep without a prospect', async () => {
  const { default: Drawer } = await drawerModule();
  const partial = { ...BRIEF, deck: { state: 'unreadable' }, objections: { state: 'unreadable' } };
  let ui = await mount(h(Drawer, { kind: 'investor_meeting', id: '11', onClose() {} }), [ITEM(MEETING), BRIEF_ROUTE(partial)]);
  try {
    await ui.press(ui.by('cal-item-prep-open'));
    // Mutation checked: an unreadable part drawn as its empty line → "No deck link was made" shows and this fails.
    assert.equal(ui.say(ui.by('cal-prep-deck-unreadable')), 'Could not be read.');
    assert.equal(ui.say(ui.by('cal-prep-theirs-unreadable')), 'Could not be read.');
    assert.doesNotMatch(ui.text(), /No deck link was made|raised no objection/);
  } finally { await ui.unmount(); }
  ui = await mount(h(Drawer, { kind: 'investor_meeting', id: '11', onClose() {} }), [ITEM(MEETING), BRIEF_ROUTE({ detail: 'nope' }, 503)]);
  try {
    await ui.press(ui.by('cal-item-prep-open'));
    assert.match(ui.text(), /The brief/);
    assert.ok(!ui.by('cal-item-prep-brief'));
  } finally { await ui.unmount(); }
  ui = await mount(h(Drawer, { kind: 'investor_meeting', id: '11', onClose() {} }), [ITEM({ ...MEETING, prospect_id: null })]);
  try { assert.ok(!ui.by('cal-item-prep'), 'no prospect, no Prep'); } finally { await ui.unmount(); }
});
