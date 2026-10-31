// D1384 (#3692) — /compliance retired into Calendar's Compliance layer. The
// model's words and rules; `?layer=compliance`; the deadline in the shared
// right Sheet with Mark done, Reopen and Delete, each an in-page dialog that
// says what it does before anything is sent; New › Compliance deadline; and
// /compliance as a redirect with its links moved. The components run against
// a stubbed fetch through the real clients. Fixtures are invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { h, mountForm, sourceModule } from './_form_d695.mjs';
import {
  SAYS, createError, daysUntil, doneSays, nextDueOf, ownerLine, refusalOf, sourceLine, stateLine, stateOf,
} from '../src/pages/calendarComplianceModel.js';
import { FAMILIES, LAYERS } from '../src/pages/calendarViews.js';
import { kindsFrom, withKinds } from '../src/pages/calendarGrid.js';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, statusText: String(status), headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const DUE = {
  id: 'compliance_due:7', kind: 'compliance_due', source_id: 7, source_uid: 'filing-7', title: 'Fixture annual report',
  start_at: '2026-11-10', end_at: '2026-11-11', status: 'scheduled', all_day: true,
  location_kind: null, location_uri: null, notes: 'File with the state.', family: 'deadlines',
  my_role: { code: 'venture_deadline', words: 'Your venture’s deadline' }, can: { rsvp: false, reschedule: false, cancel: false, copy: false },
  href: null, cancel_reason: null, deal_name: null, project_id: 20, project_name: 'Fixture Labs', time_zone: null, people: [], my_rsvp: null,
  compliance: { state: 'overdue', due_date: '2026-11-10', event_type: 'annual_report', jurisdiction: 'US-DE', recurrence: 'annual', owner: null, source: 'auto' },
};
const DONE = { ...DUE, status: 'completed', compliance: { ...DUE.compliance, state: 'done', recurrence: 'one_time', owner: 'Fixture owner', source: 'manual' } };

function serve(routes) {
  const sent = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    const method = options.method || 'GET';
    sent.push({ url: u, method, body: options.body ? JSON.parse(options.body) : null });
    for (const [pattern, answer] of routes) if (pattern.test(`${method} ${u}`)) return response(...answer);
    return response({ detail: 'Not found' }, 404);
  };
  return { sent, restore: () => { globalThis.fetch = previous; } };
}
const spaced = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(spaced).join(' ') : n.textContent || '');
async function mount(element, routes) {
  const net = serve(routes);
  const ui = await mountForm(element, { modal: true });
  const settle = async () => { for (let i = 0; i < 5; i += 1) await ui.flush(); };
  await settle();
  return {
    ...ui, sent: net.sent, settle,
    async press(n) { assert.ok(n, 'no such node'); assert.ok(!ui.props(n).disabled, 'it is enabled'); await act(async () => { await ui.props(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async type(n, value) { assert.ok(n, 'no such field'); await act(async () => ui.props(n).onChange({ target: { value } })); await settle(); },
    say(n) { assert.ok(n, 'no such node'); return spaced(n).replace(/\s+/g, ' ').trim(); },
    writes: () => net.sent.filter((s) => s.method !== 'GET'),
    async unmount() { await ui.unmount(); net.restore(); },
  };
}
const drawerModule = () => sourceModule(read('frontend/src/pages/CalendarItemDrawer.jsx'), 'pages/CalendarItemDrawer.jsx');
const sheetModule = () => sourceModule(read('frontend/src/pages/CalendarComplianceSheet.jsx'), 'pages/CalendarComplianceSheet.jsx');
const ITEM = (item) => [/GET .*\/api\/calendar\/item\/compliance_due\/7$/, [{ item }, 200]];

test('the model: a state in words, the next deadline a repeat adds, the owner never guessed', () => {
  assert.equal(daysUntil('2026-11-10', '2026-11-13'), -3);
  assert.equal(stateLine(DUE, '2026-11-13'), 'Overdue by 3 days');
  assert.equal(stateLine(DUE, '2026-11-11'), 'Overdue by 1 day');
  assert.equal(stateLine({ ...DUE, compliance: { ...DUE.compliance, state: 'due' } }, '2026-11-10'), 'Due today');
  assert.equal(stateLine({ ...DUE, compliance: { ...DUE.compliance, state: 'due' } }, '2026-10-29'), 'Due in 12 days');
  assert.equal(stateLine(DONE, '2027-01-01'), 'Done', 'done wins over the date');
  // The Worker's state decides; a reader's day that disagrees (another zone) drops the count, never the word.
  assert.equal(stateLine(DUE, '2026-11-05'), 'Overdue');
  assert.equal(stateLine({ ...DUE, compliance: { ...DUE.compliance, state: 'due' } }, '2026-11-12'), 'Due');
  assert.equal(stateOf({}), 'due');
  // The Worker's roll-forward: +365, +91 and +30 days; once adds nothing.
  assert.equal(nextDueOf('2026-11-10', 'annual'), '2027-11-10');
  assert.equal(nextDueOf('2026-11-10', 'quarterly'), '2027-02-09');
  assert.equal(nextDueOf('2026-11-10', 'monthly'), '2026-12-10');
  assert.equal(nextDueOf('2026-11-10', 'one_time'), null);
  assert.equal(doneSays(DUE), 'Marks it done. Because it repeats every year, the next one is added for Wed 10 Nov 2027.');
  assert.equal(doneSays(DONE), 'Marks it done. It does not repeat, so nothing new is added.');
  assert.deepEqual(ownerLine(DUE), { name: 'Not recorded', missing: 'Nobody recorded an owner for this deadline.' });
  assert.deepEqual(ownerLine(DONE), { name: 'Fixture owner', missing: null });
  assert.equal(sourceLine(DUE), 'Added automatically for the venture’s jurisdiction.');
  assert.equal(sourceLine(DONE), null);
  assert.match(refusalOf({ status: 402 }), /^Adding compliance deadlines is part of the Raise \+ Grow plan\./);
  assert.equal(refusalOf({ status: 404, data: { detail: 'Project not found' } }), 'Project not found');
  assert.equal(createError({ project_id: '', title: 'x', due_date: '2026-11-10' }), 'Choose a venture.');
  assert.equal(createError({ project_id: '20', title: ' ', due_date: '2026-11-10' }), 'Give the deadline a title.');
  assert.equal(createError({ project_id: '20', title: 'x', due_date: '' }), 'Choose a due date.');
  assert.equal(createError({ project_id: '20', title: 'x', due_date: '2026-11-10' }), null);
});

test('?layer=compliance is the Compliance source by name: it reads as its kinds, ?kinds= wins, and choosing kinds drops it', () => {
  const allowed = FAMILIES.flatMap((f) => f.kinds);
  assert.deepEqual(LAYERS.compliance, ['compliance_due']);
  assert.ok(FAMILIES.find((f) => f.key === 'deadlines').kinds.includes('compliance_due'), 'the layer is a registered kind, not a page-only filter');
  assert.deepEqual([...kindsFrom('?layer=compliance', allowed)], ['compliance_due']);
  assert.deepEqual([...kindsFrom('?layer=compliance&kinds=ic_meeting', allowed)], ['ic_meeting'], '?kinds= wins');
  assert.equal(kindsFrom('?layer=bogus', allowed), null, 'an unknown layer is everything');
  assert.equal(kindsFrom('?layer=compliance', allowed.filter((k) => k !== 'compliance_due')), null, 'a role without the kind sees everything it may');
  assert.equal(withKinds('?layer=compliance&date=2026-11-10', null, allowed), '?date=2026-11-10', 'Show everything drops the layer');
  assert.equal(withKinds('?layer=compliance', new Set(['ic_meeting']), allowed), '?kinds=ic_meeting');
});

test('a deadline opens in the shared right Sheet: state, day, venture, repeat, an owner said as not recorded, notes', async () => {
  const { default: Drawer } = await drawerModule();
  const ui = await mount(h(Drawer, { kind: 'compliance_due', id: '7', onClose() {} }), [ITEM(DUE)]);
  try {
    const sheet = ui.by('cal-item-drawer');
    assert.equal(ui.props(sheet).role, 'dialog');
    assert.equal(ui.props(sheet)['data-width'], 640);
    assert.ok(ui.by('cal-item-drawer-scrim'), 'the Sheet, not a centred lightbox');
    assert.ok(ui.by('cal-item-compliance_due'));
    assert.match(ui.say(ui.by('cal-compliance-state')), /^Overdue( by \d+ days?)?$/);
    assert.equal(ui.say(ui.by('cal-compliance-due')), 'Due Tue 10 Nov 2026 · all day');
    assert.match(ui.say(ui.by('cal-compliance-venture')), /Venture Fixture Labs Open venture Jurisdiction: US-DE/);
    assert.equal(ui.props(ui.by('cal-compliance-open-venture')).to ?? ui.props(ui.by('cal-compliance-open-venture')).href, '/projects/20');
    assert.equal(ui.say(ui.by('cal-compliance-repeats')), 'Repeats Every year');
    assert.equal(ui.say(ui.by('cal-compliance-owner')), 'Owner Not recorded Nobody recorded an owner for this deadline.');
    assert.equal(ui.say(ui.by('cal-compliance-notes')), 'Notes File with the state.');
    assert.ok(ui.by('cal-compliance-done') && ui.by('cal-compliance-delete') && !ui.by('cal-compliance-reopen'));
    assert.equal(ui.by('cal-item-reschedule'), undefined, 'none of a meeting\'s controls');
  } finally { await ui.unmount(); }
});

test('Mark done says what it adds before anything is sent, then writes through /compliance\'s own PATCH', async () => {
  const { default: Drawer } = await drawerModule();
  let changed = 0;
  const ui = await mount(h(Drawer, { kind: 'compliance_due', id: '7', onClose() {}, onChanged: () => { changed += 1; } }),
    [[/PATCH .*\/api\/compliance\/events\/7$/, [{ id: 7 }, 200]], ITEM(DUE)]);
  try {
    await ui.press(ui.by('cal-compliance-done'));
    assert.ok(ui.by('cal-compliance-done-dialog'), 'an in-page dialog, never a browser pop-up');
    assert.equal(ui.say(ui.by('cal-compliance-done-says')), doneSays(DUE));
    assert.deepEqual(ui.writes(), [], 'nothing is written before the dialog\'s button');
    await ui.press(ui.by('cal-compliance-done-save'));
    assert.deepEqual(ui.writes().map((s) => [s.method, s.url.replace(/^.*\/api/, '/api'), s.body]),
      [['PATCH', '/api/compliance/events/7', { completion_status: 'completed' }]]);
    assert.equal(changed, 1, 'the view behind re-reads');
    assert.equal(ui.by('cal-compliance-done-dialog'), undefined);
  } finally { await ui.unmount(); }
});

test('a refusal stays in the dialog; a done deadline offers Reopen; Delete says only this deadline goes', async () => {
  const { default: Drawer } = await drawerModule();
  let ui = await mount(h(Drawer, { kind: 'compliance_due', id: '7', onClose() {} }),
    [[/PATCH /, [{ detail: 'Forbidden' }, 403]], ITEM(DUE)]);
  try {
    await ui.press(ui.by('cal-compliance-done'));
    await ui.press(ui.by('cal-compliance-done-save'));
    assert.equal(ui.say(ui.by('cal-compliance-done-refused')), 'Forbidden');
    assert.ok(ui.by('cal-compliance-done-dialog'), 'the dialog stays open on a refusal');
  } finally { await ui.unmount(); }
  let closed = 0;
  ui = await mount(h(Drawer, { kind: 'compliance_due', id: '7', onClose: () => { closed += 1; } }),
    [[/PATCH /, [{ id: 7 }, 200]], [/DELETE .*\/api\/compliance\/events\/7$/, [{ ok: true }, 200]], ITEM(DONE)]);
  try {
    assert.equal(ui.say(ui.by('cal-compliance-state')), 'Done');
    assert.equal(ui.by('cal-compliance-done'), undefined);
    assert.equal(ui.say(ui.by('cal-compliance-owner')), 'Owner Fixture owner');
    await ui.press(ui.by('cal-compliance-reopen'));
    assert.equal(ui.say(ui.by('cal-compliance-reopen-says')), SAYS.reopen);
    await ui.press(ui.by('cal-compliance-reopen-save'));
    assert.deepEqual(ui.writes().at(-1).body, { completion_status: 'pending' });
    await ui.press(ui.by('cal-compliance-delete'));
    assert.equal(ui.say(ui.by('cal-compliance-delete-says')), SAYS.delete);
    await ui.press(ui.by('cal-compliance-delete-save'));
    assert.deepEqual(ui.writes().map((s) => s.method), ['PATCH', 'DELETE']);
    assert.equal(closed, 1, 'a deleted deadline closes its Sheet');
  } finally { await ui.unmount(); }
});

test('New › Compliance deadline: the venture first, checked as the Worker checks it, sent through /compliance\'s create', async () => {
  const { NewComplianceDialog } = await sheetModule();
  let done = 0;
  const ui = await mount(h(NewComplianceDialog, { onClose() {}, onDone: () => { done += 1; } }), [
    [/GET .*\/api\/projects/, [[{ id: 20, name: 'Fixture Labs' }, { id: 21, name: 'Second Fixture' }], 200]],
    [/POST .*\/api\/compliance\/events$/, [{ id: 9 }, 201]],
  ]);
  try {
    assert.equal(ui.say(ui.by('cal-compliance-new-says')), SAYS.create);
    await ui.press(ui.by('cal-compliance-new-save'));
    assert.equal(ui.say(ui.by('cal-compliance-new-error')), 'Choose a venture.');
    assert.deepEqual(ui.writes(), [], 'an incomplete deadline is not sent');
    await ui.type(ui.by('cal-compliance-new-venture'), '21');
    await ui.type(ui.by('cal-compliance-new-repeats'), 'quarterly');
    await ui.type(ui.by('cal-compliance-new-title'), '  Fixture franchise tax  ');
    await ui.type(ui.by('cal-compliance-new-due'), '2026-12-01');
    await ui.press(ui.by('cal-compliance-new-save'));
    assert.deepEqual(ui.writes().map((s) => s.body), [{
      project_id: 21, event_type: 'annual_report', recurrence: 'quarterly', title: 'Fixture franchise tax', description: null, due_date: '2026-12-01',
    }]);
    assert.equal(done, 1);
  } finally { await ui.unmount(); }
});

test('a plan refusal on create is said in words; unreadable ventures say so instead of an empty list', async () => {
  const { NewComplianceDialog } = await sheetModule();
  let ui = await mount(h(NewComplianceDialog, { onClose() {}, onDone() {} }), [
    [/GET .*\/api\/projects/, [[{ id: 20, name: 'Fixture Labs' }], 200]],
    [/POST /, [{ detail: 'upgrade' }, 402]],
  ]);
  try {
    assert.equal(ui.props(ui.by('cal-compliance-new-venture')).value, '20', 'one venture is chosen for you');
    await ui.type(ui.by('cal-compliance-new-title'), 'Fixture filing');
    await ui.type(ui.by('cal-compliance-new-due'), '2026-12-01');
    await ui.press(ui.by('cal-compliance-new-save'));
    assert.match(ui.say(ui.by('cal-compliance-new-refused')), /Raise \+ Grow plan/);
  } finally { await ui.unmount(); }
  ui = await mount(h(NewComplianceDialog, { onClose() {}, onDone() {} }), [[/GET .*\/api\/projects/, [{ detail: 'down' }, 500]]]);
  try {
    assert.equal(ui.say(ui.by('cal-compliance-new-ventures-unread')), 'Your ventures couldn’t be read. Close this and try again.');
    assert.ok(ui.props(ui.by('cal-compliance-new-save')).disabled, 'nothing can be sent without a venture list');
  } finally { await ui.unmount(); }
});

test('/compliance only redirects, and nothing in the app still sends people there', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /<Route path="\/compliance" element=\{<Navigate to="\/calendar\?layer=compliance" replace \/>\} \/>/);
  assert.match(read('cloudflare-worker/src/services/redirectRoutes.ts'), /\{ path: '\/compliance' \}/);
  // The embedded Legal Engine card is a different address and stays.
  assert.match(app, /path="\/raise\/legal-engine\/compliance"/);
  for (const file of [
    'frontend/src/sidebarConfig.js', 'frontend/src/lib/adminPlacement.js', 'frontend/src/pages/cycles/CycleRoute.jsx',
    'frontend/src/pages/founder/FounderRaiseLegal.jsx', 'cloudflare-worker/src/routes/assistant.ts',
    'cloudflare-worker/src/services/advisor/tools.ts', 'cloudflare-worker/src/services/onboardingChecklist.ts',
  ]) {
    assert.doesNotMatch(read(file).replace(/\/\/.*$/gm, ''), /['"`]\/compliance(?:['"`?])/, `${file} still links to /compliance`);
  }
  for (const file of ['frontend/src/pages/cycles/CycleRoute.jsx', 'frontend/src/pages/founder/FounderRaiseLegal.jsx', 'cloudflare-worker/src/routes/assistant.ts', 'cloudflare-worker/src/services/onboardingChecklist.ts']) {
    assert.match(read(file), /\/calendar\?layer=compliance/, `${file} does not open the Compliance layer`);
  }
});
