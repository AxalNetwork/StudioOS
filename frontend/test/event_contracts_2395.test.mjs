// #2395: exercise the real editor, ticket views and calendar link with Worker-shaped replies.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { Routes, Route } from 'react-router-dom';
import { h, mountForm, sourceModule, textOf } from './_form_d695.mjs';

const read = path => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8');
const editorPath = 'pages/events/EventEditorPage.jsx';
const ticketsPath = 'pages/events/MyEventsPage.jsx';
const detailPath = 'pages/events/PublicEventDetailPage.jsx';
const editor = read(editorPath), tickets = read(ticketsPath), detail = read(detailPath);
const event = {
  id: 42, slug: 'fixture-talk', title: 'Fixture talk', type: 'workshop', summary: 'Stored summary', description: 'Stored description',
  starts_at: '2099-01-01T12:00:00Z', ends_at: '2099-01-01T14:00:00Z', timezone: 'UTC',
  location_kind: 'hybrid', location_text: 'Fixture room', location_url: 'https://example.test/meeting', cover_url: 'https://example.test/cover',
  capacity: 12, waitlist_enabled: false, approval_required: true, visibility: 'public', status: 'published',
  audience_rules: { mode: 'selected', roles: ['founder'], comp_investors: true },
};
const reply = { event, agenda: [{ id: 7, title: 'Stored agenda' }], registration: null, seats_taken: 1, is_full: false };
let fixture;
const key = '__eventContracts2395';
function prepare(overrides = {}) {
  fixture = { toast: { toast: null, showToast: () => {} }, updates: [], user: { id: 2, role: 'founder' }, phone: false, ...overrides };
  fixture.api = {
    get: async () => structuredClone(reply), eligibility: async () => ({ eligible: true, seats_taken: 1, is_full: false }),
    list: async () => ({ hosting: [], attending: [
      { ...event, reg_status: 'confirmed', payment_status: 'none', comp: true, checkin_code: 'own-code' },
      { ...event, id: 43, title: 'Waiting fixture', reg_status: 'waitlisted', comp: false, checkin_code: null },
    ] }),
    suggested: async () => ({ events: [] }),
    icsUrl: (id) => `/api/events/${id}/ics`,
    update: async (id, payload) => fixture.updates.push([id, payload]),
    register: async () => ({ status: 'confirmed' }),
    ...overrides.api,
  };
  globalThis[key] = fixture;
}
function stub(source) {
  return source
    .replace(/import \{ eventsApi \} from [^;]+;/, `const eventsApi = globalThis.${key}.api;`)
    .replace(/import \{ events, eventsPublic \} from [^;]+;/, `const events = globalThis.${key}.api; const eventsPublic = globalThis.${key}.publicApi;`)
    .replace(/import \{ useToast \} from [^;]+;/, `const useToast = () => globalThis.${key}.toast;`)
    .replace(/import PageExplainer[^;]+;/, 'const PageExplainer = () => null;')
    .replace(/import EventQRCode[^;]+;/, 'const EventQRCode = ({ value }) => <canvas data-ticket-code={value} />;')
    .replace(/import \{ usePhoneWidth \} from [^;]+;/, `const usePhoneWidth = () => globalThis.${key}.phone;`)
    .replace(/import \{ useAuth \} from [^;]+;/, `const useAuth = () => ({ user: globalThis.${key}.user });`)
    .replace(/import (PublicNav|PublicFooter|AxalCheckout|MemberRegistrationPanel)[^;]+;/g, (_m, name) => `const ${name} = () => null;`)
    .replace(/import WorkspaceShell[^;]+;/, 'const WorkspaceShell = ({ children }) => <div>{children}</div>;')
    .replace(/import\.meta\.env/g, '({})');
}
async function mount(source, path, route = '/events/:id/edit', url = '/events/42/edit') {
  const Page = (await sourceModule(stub(source), path)).default;
  return mountForm(h(Routes, { location: url }, h(Route, { path: route, element: h(Page) })), { phone: fixture.phone });
}
async function editorScenario(source = editor) {
  prepare();
  const ui = await mount(source, editorPath);
  try {
    await ui.flush();
    const values = ui.nodes().filter(n => ['INPUT','SELECT','TEXTAREA'].includes(n.tagName)).map(n => ui.props(n));
    for (const value of ['Fixture talk', 'workshop', 'Stored summary', 'Stored description', 'UTC', 'hybrid', 'Fixture room', 'https://example.test/meeting', 'https://example.test/cover', 12, 'public']) assert.ok(values.some(p => p.value === value), String(value));
    assert.equal(values.filter(p => p.type === 'datetime-local' && p.value).length, 2);
    assert.ok(values.some(p => p.type === 'checkbox' && p.checked === true));
    assert.equal(ui.text().includes('Send for review'), false, 'published status is retained');
    await ui.click('Save changes');
    assert.equal(fixture.updates.length, 1);
    const [id, payload] = fixture.updates[0];
    assert.equal(id, '42');
    assert.deepEqual({ ...payload, audience_rules_json: JSON.parse(payload.audience_rules_json) }, {
      title: event.title, type: event.type, summary: event.summary, description: event.description,
      starts_at: '2099-01-01T12:00:00.000Z', ends_at: '2099-01-01T14:00:00.000Z', timezone: 'UTC',
      location_kind: 'hybrid', location_text: event.location_text, location_url: event.location_url, cover_url: event.cover_url,
      capacity: 12, waitlist_enabled: 0, approval_required: 1, visibility: 'public', audience_rules_json: event.audience_rules,
    });
    assert.equal(Object.hasOwn(payload, 'agenda'), false, 'details edit leaves separately managed agenda alone');
  } finally { await ui.unmount(); }
}
async function failureScenario(source = editor) {
  for (const result of [null, { event: null, agenda: [] }, { event, agenda: null }, new Error('Fixture read refused')]) {
    prepare({ api: { get: async () => { if (result instanceof Error) throw result; return result; } } });
    const ui = await mount(source, editorPath);
    try {
      await ui.flush();
      assert.match(ui.text(), /Unreadable/);
      assert.equal(ui.nodes().some(n => n.tagName === 'INPUT'), false, 'failed read cannot save blank defaults');
    } finally { await ui.unmount(); }
  }
}
async function ticketScenario(source = tickets) {
  for (const phone of [false, true]) {
    prepare({ phone });
    const ui = await mount(source, ticketsPath, '/my/events', '/my/events');
    try {
      await ui.flush();
      // D1030 (#2387): on a desktop the tickets are Upcoming's, the next event with its code and the rest in Going.
      // D1037 (#2878, MEV18a): on a phone Upcoming draws the next event and Going as cards; the code is on the ticket.
      const text = ui.text();
      assert.match(text, /Going/);
      assert.match(text, /Waitlist/);
      assert.doesNotMatch(text, /published/);
      assert.match(text, /Free seat/);
      assert.equal(ui.nodes().filter(n => ui.props(n)['data-ticket-code'] === 'own-code').length, phone ? 0 : 1);
      assert.equal((text.match(/Free seat/g) || []).length, 1);
    } finally { await ui.unmount(); }
  }
  // D1037 (MEV18b): on a phone the ticket is a page of its own, with the member's own code and seat.
  prepare({ phone: true });
  const ui = await mount(source, ticketsPath, '/my/events/*', '/my/events/ticket/42');
  try {
    await ui.flush();
    assert.ok(ui.nodes().some(n => ui.props(n)['data-testid'] === 'my-events-ticket-drawer-page'), 'the ticket is a page, not a dialog');
    // The drawer draws the real QR (MyEventsDrawers.jsx); its code is printed under it in mono.
    const code = ui.nodes().find(n => ui.props(n)['data-testid'] === 'my-events-ticket-code-text');
    assert.ok(code, 'the code is drawn');
    assert.equal(textOf(code).trim(), 'own-code');
    const text = ui.text();
    assert.match(text, /Going/);
    assert.match(text, /Free seat/);
    assert.match(text, /Turn your screen brightness up at the door\./);
  } finally { await ui.unmount(); }
}
// Use the actual client URL functions, rather than duplicating them in mocks.
async function clients() {
  const api = read('lib/api.js');
  const scope = name => api.slice(api.indexOf('export const ' + name + ' = {'), api.indexOf('\n};', api.indexOf('export const ' + name + ' = {')) + 3);
  const core = await sourceModule(scope('events') + '\n' + scope('eventsPublic'), 'lib/api.js');
  const separate = await sourceModule(read('lib/eventsApi.js').replace(/import \{ request \} from [^;]+;/, 'const request = () => {};'), 'lib/eventsApi.js');
  return { ...core, separate: separate.eventsApi };
}
async function calendarScenario(source = detail) {
  const client = await clients();
  assert.equal(client.separate.icsUrl(42), '/api/events/42/ics');
  assert.equal(client.events.icsUrl(42), '/api/events/42/ics');
  for (const [user, slug, expected] of [[{ id: 2, role: 'founder' }, '42', '/api/events/42/ics'], [{ id: 2, role: 'founder' }, 'fixture-talk', '/api/events/42/ics'], [null, 'fixture-talk', '/api/public/events/fixture-talk/ics']]) {
    prepare({ user }); fixture.api.icsUrl = client.events.icsUrl;
    fixture.publicApi = { ...fixture.api, read: fixture.api.get, icsUrl: client.eventsPublic.icsUrl };
    const ui = await mount(source, detailPath, '/events/:slug', '/events/' + slug);
    try {
      await ui.flush();
      const form = ui.nodes().find(n => n.tagName === 'FORM');
      assert.ok(form);
      await act(async () => ui.props(form).onSubmit({ preventDefault() {} }));
      const link = ui.nodes().find(n => n.tagName === 'A' && textOf(n).includes('Download .ics'));
      assert.ok(link, 'calendar download link is present');
      assert.equal(ui.props(link).href, expected);
    } finally { await ui.unmount(); }
  }
}
test('#2395: populated editor preserves fields, status and audience rules on save', () => editorScenario());
test('#2395: unreadable detail never offers an empty edit form', () => failureScenario());
test('#2395: desktop and phone show registration status, own QR and free seat', () => ticketScenario());
test('#2395: member numeric ID calendar and visitor slug calendar', () => calendarScenario());

test('#2395: behavioral checks reject editor, ticket and calendar regressions then accept restored code', async () => {
  const groups = [
    [editor, editorScenario, [
      ['const ev = reply.event;', 'const ev = reply;'],
      ['setStatus(ev.status', "setStatus('draft'"],
      ['setRules(ev.audience_rules || {});', 'setRules({});'],
    ]],
    [editor, failureScenario, [['if (loadError)', 'if (false)']]],
    [tickets, ticketScenario, [
      ["if (drawer?.kind === 'ticket') {", 'if (false) {'],
      ['const place = placeOf(t);', 'const place = placeOf({ ...t, reg_status: t.status });'],
      ['const code = ticket.checkin_code || null;', 'const code = null;'],
      ['{seat ? <Pill', '{false ? <Pill'],
    ]],
    [detail, calendarScenario, [['user ? events.icsUrl(event.id) : eventsPublic.icsUrl(slug)', 'eventsPublic.icsUrl(slug)']]],
  ];
  for (const [source, verify, mutants] of groups) {
    await verify(source);
    for (const [before, after] of mutants) {
      assert.ok(source.includes(before), before);
      await assert.rejects(() => verify(source.replace(before, after)), { name: 'AssertionError' }, before);
      await verify(source);
    }
  }
});

test('#2395: secondary calendar client rejects the obsolete event.ics route', async () => {
  const path = 'lib/eventsApi.js';
  const source = read(path).replace(/import \{ request \} from [^;]+;/, 'const request = () => {};');
  const check = async text => assert.equal((await sourceModule(text, path)).eventsApi.icsUrl(42), '/api/events/42/ics');
  const before = '${BASE}/events/${id}/ics';
  assert.ok(source.includes(before));
  await check(source);
  await assert.rejects(() => check(source.replace(before, '${BASE}/events/${id}/event.ics')), { name: 'AssertionError' });
  await check(source);
});
