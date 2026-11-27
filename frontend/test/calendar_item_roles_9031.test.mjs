// #9031 — the Calendar item drawer says who is who on a booking: an advisor
// session's advisor and founder (SAV02's People, D8732), and a partner office
// hour's partner and the founder who asked. The words come from the Worker
// (`STAND_WORDS` in services/calendar/itemRead.ts); the fixtures below take
// them from that file, so the drawer is checked against the Worker's words and
// not a copy. The drawer runs against a stubbed fetch through the real client.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { h, mountForm, sourceModule } from './_form_d695.mjs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, statusText: String(status), headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

/** The Worker's own table, read from its source: role → words. */
function standWords() {
  const src = read('cloudflare-worker/src/services/calendar/itemRead.ts');
  const body = src.match(/const STAND_WORDS[^=]*=\s*\{([\s\S]*?)\};/);
  assert.ok(body, 'STAND_WORDS is in itemRead.ts');
  return Object.fromEntries([...body[1].matchAll(/(\w+):\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));
}

const T0 = Date.now() + 30 * 3_600_000;
const iso = (ms) => new Date(ms).toISOString();
const BOOKING = {
  id: 'advisor_booking:60', kind: 'advisor_booking', source_id: 60, title: 'Advisor session — Pricing',
  start_at: iso(T0), end_at: iso(T0 + 3_600_000), status: 'confirmed', location_kind: 'video', location_uri: null, notes: null,
  family: 'meetings', my_role: { code: 'giving', words: 'You give this session' }, can: { rsvp: false, reschedule: false, cancel: false, copy: false },
  all_day: false, href: null, cancel_reason: null, deal_name: null, project_name: null, time_zone: null, pushed_to: [], my_rsvp: null,
};

async function peopleLine(item) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => (/\/api\/calendar\/item\//.test(String(url)) ? response({ item }) : response({ detail: 'Not found' }, 404));
  const { default: Drawer } = await sourceModule(read('frontend/src/pages/CalendarItemDrawer.jsx'), 'pages/CalendarItemDrawer.jsx');
  const ui = await mountForm(h(Drawer, { kind: item.kind, id: String(item.source_id), onClose() {} }), { modal: true });
  try {
    for (let i = 0; i < 5; i += 1) await act(async () => { await ui.flush(); });
    const rows = ui.nodes().filter((n) => ui.props(n)['data-testid'] === 'cal-item-person');
    const say = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(say).join(' ') : n.textContent || '');
    return rows.map((r) => say(r).replace(/\s+/g, ' ').trim());
  } finally { await ui.unmount(); globalThis.fetch = previous; }
}

test('#9031: the Worker names all four sides of a booking, each pair in distinct words', () => {
  const w = standWords();
  assert.equal(w.advisor, 'Advisor', 'SAV02 People: the advisor');
  assert.equal(w.mentee, 'Founder', 'SAV02 People: the founder who booked');
  assert.equal(w.partner, 'Partner');
  assert.equal(w.requester, 'Founder', 'a partner booking\'s requester is its founder_user_id');
  assert.notEqual(w.advisor, w.mentee);
  assert.notEqual(w.partner, w.requester);
  for (const role of ['advisor', 'mentee', 'partner', 'requester']) assert.notEqual(w[role], 'Invited', `${role} no longer reads "Invited"`);
  assert.equal(w.organizer, 'Organiser', 'the IC meeting words are unchanged');
});

test('#9031: the drawer\'s People for an advisor session and a partner office hour say who is who', async () => {
  const w = standWords();
  const advisor = await peopleLine({ ...BOOKING, people: [
    { name: 'Fixture Advisor', profile: 'Advisor', stands: w.advisor, answer: null },
    { name: 'Fixture Founder', profile: 'Founder', stands: w.mentee, answer: null },
  ] });
  assert.deepEqual(advisor, ['Fixture Advisor · Advisor Advisor', 'Fixture Founder · Founder Founder']);

  const partner = await peopleLine({ ...BOOKING, id: 'partner_office_hour:80', kind: 'partner_office_hour', source_id: 80, title: 'Partner office hours — Hiring', people: [
    { name: 'Fixture Partner', profile: null, stands: w.partner, answer: null },
    { name: 'Fixture Founder', profile: 'Founder', stands: w.requester, answer: null },
  ] });
  assert.deepEqual(partner, ['Fixture Partner Partner', 'Fixture Founder · Founder Founder']);
});
