// D1030 (#2387) — My events: Upcoming, Hosting, Discover and Past, each at its
// own address, drawn from the reads that exist. Fixtures are worked out by hand
// from `GET /api/events`, `/suggested` and `GET /api/public/events`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Routes, Route } from 'react-router-dom';
import { h, mountForm, sourceModule } from './_form_d695.mjs';
import {
  JOIN_NOTE, joinState, seatSourceLabel, isMyEventsPath, TABS, discoverAction, goingGroups, hostAction, hostingGroups, isExplorer, isPast, needsYou, nextEvent, pastRows, placeOf,
  priceOf, splitTickets, statusOf, tabCounts, tabOf, tabsFor, whereOf,
} from '../src/pages/events/myEventsModel.js';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const pagePath = 'pages/events/MyEventsPage.jsx';
const page = read('frontend/src/' + pagePath);
const NOW = Date.parse('2026-11-10T12:00:00Z');
const at = (iso) => ({ starts_at: iso, ends_at: null, timezone: 'UTC' });

const ATTENDING = [
  { id: 1, title: 'Pricing Workshop', ...at('2026-11-12T18:00:00Z'), location_kind: 'virtual', location_url: 'https://example.test/join', reg_status: 'confirmed', payment_status: 'none', comp: true, checkin_code: 'K7Q2-9X4M' },
  { id: 2, title: 'Operators Social', ...at('2026-11-28T18:00:00Z'), location_kind: 'in_person', location_text: 'Rua Exemplo 10', reg_status: 'waitlisted', reg_waitlist_position: 3, comp: false, checkin_code: null },
  { id: 3, title: 'Climate Roundtable', ...at('2027-01-20T18:00:00Z'), location_kind: 'hybrid', reg_status: 'registered', comp: false, checkin_code: null },
  { id: 4, title: 'Founder Breakfast', ...at('2026-10-01T08:00:00Z'), reg_status: 'attended', comp: false, checkin_code: 'OLD-CODE' },
];
const HOSTING = [
  { id: 10, title: 'LP Briefing', ...at('2026-11-20T15:00:00Z'), status: 'rejected', visibility: 'public' },
  { id: 11, title: 'Old Draft', ...at('2026-11-01T15:00:00Z'), status: 'draft', visibility: 'private' },
  { id: 12, title: 'Fresh Draft', ...at('2026-12-01T15:00:00Z'), status: 'draft', visibility: 'unlisted' },
  { id: 13, title: 'Demo Day', ...at('2026-11-15T15:00:00Z'), status: 'published', visibility: 'public' },
  { id: 14, title: 'Waiting Workshop', ...at('2026-11-16T15:00:00Z'), status: 'pending_review', visibility: 'public' },
  { id: 15, title: 'Cancelled Social', ...at('2026-11-18T15:00:00Z'), status: 'cancelled', visibility: 'public' },
  { id: 16, title: 'Past Office Hours', ...at('2026-09-01T15:00:00Z'), status: 'published', visibility: 'public' },
];

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the tabs and their addresses; an Explorer has no Hosting', () => {
  assert.deepEqual(TABS.map((t) => t.key), ['upcoming', 'hosting', 'discover', 'past']);
  assert.equal(tabOf('/my/events'), 'upcoming');
  assert.equal(tabOf('/my/events/hosting/'), 'hosting');
  assert.equal(tabOf('/my/events/past'), 'past');
  assert.equal(tabOf('/my/events/nonsense'), 'upcoming');
  assert.ok(isExplorer({ role: 'exploring' }) && !isExplorer({ role: 'founder' }));
  assert.deepEqual(tabsFor({ role: 'exploring' }).map((t) => t.key), ['upcoming', 'discover', 'past']);
  assert.equal(tabsFor({ role: 'admin' }).length, 4);
});

test('a place in the canvas\'s words: Going, Waiting for the host, Waitlist · #n, Checked in', () => {
  assert.equal(placeOf({ reg_status: 'confirmed' }).label, 'Going');
  assert.equal(placeOf({ reg_status: 'registered' }).label, 'Waiting for the host', 'registered is approval-pending');
  assert.equal(placeOf({ reg_status: 'waitlisted', reg_waitlist_position: 3 }).label, 'Waitlist · #3');
  assert.equal(placeOf({ reg_status: 'waitlisted' }).label, 'Waitlist');
  assert.equal(placeOf({ reg_status: 'attended' }).label, 'Checked in');
  assert.equal(placeOf({ reg_status: 'published' }).label, 'Not recorded', 'an event status is never a place');
  assert.equal(statusOf({ status: 'rejected' }).label, 'Sent back');
  assert.equal(whereOf({ location_kind: 'virtual' }), 'Online');
  assert.equal(whereOf({}), 'Not recorded');
  assert.equal(priceOf({ price_cents: 4000, currency: 'eur' }), '€40');
  assert.equal(priceOf({ price_cents: 0 }), 'Free');
});

test('Upcoming: the next event, the groups by when, and Needs you from what the reads hold', () => {
  const { upcoming, past } = splitTickets(ATTENDING, NOW);
  assert.deepEqual(upcoming.map((t) => t.id), [1, 2, 3]);
  assert.deepEqual(past.map((t) => t.id), [4]);
  assert.equal(nextEvent(upcoming).id, 1);
  assert.equal(nextEvent([{ reg_status: 'waitlisted' }]), null, 'a waitlist place is not your next event');
  const groups = goingGroups(upcoming.slice(1), NOW);
  assert.deepEqual(groups.map((g) => [g.label, g.rows.map((t) => t.id)]), [['Later this month', [2]], ['Later', [3]]]);
  assert.deepEqual(needsYou(HOSTING).map((n) => n.action.to), ['/events/10/edit']);
  assert.ok(isPast({ starts_at: '2026-11-01T00:00:00Z' }, NOW) && !isPast({ starts_at: '2026-11-11T00:00:00Z' }, NOW));
});

test('Hosting: grouped by what each needs, hidden when empty, searched from two characters', () => {
  const g = hostingGroups(HOSTING, NOW);
  assert.deepEqual(g.map((x) => [x.key, x.rows.map((e) => e.id)]), [
    ['needs', [11, 10]], ['draft', [12]], ['review', [14]], ['published', [16, 13]], ['cancelled', [15]],
  ]);
  assert.equal(hostingGroups(HOSTING, NOW, 'd').length, 5, 'one character does not filter');
  assert.deepEqual(hostingGroups(HOSTING, NOW, 'demo').map((x) => x.rows.map((e) => e.id)), [[13]]);
  assert.deepEqual(hostAction({ id: 10, status: 'rejected' }), { label: 'Edit and resend', to: '/events/10/edit' });
  assert.deepEqual(hostAction({ id: 13, status: 'published' }), { label: 'Manage', to: '/events/13/manage' });
  assert.equal(hostAction({ id: 14, status: 'pending_review' }).label, null);
});

test('Past, the counts and Discover\'s action', () => {
  const rows = pastRows(splitTickets(ATTENDING, NOW).past, HOSTING, NOW);
  // The draft whose date passed (11) never ran: it stays in Hosting's Needs you, not on Past.
  assert.deepEqual(rows.map((r) => [r.key, r.result]), [['t-4', 'Checked in'], ['h-16', 'Hosted']]);
  assert.deepEqual(tabCounts({ attending: ATTENDING, hosting: HOSTING, ok: true }, NOW), { upcoming: 3, hosting: 7, past: 2 });
  assert.deepEqual(tabCounts({ attending: [], hosting: [], ok: false }, NOW), { upcoming: null, hosting: null, past: null }, 'a failed read is a dash, never 0');
  assert.equal(discoverAction({ id: 1, slug: 's' }, new Set([1])).label, 'Going');
  assert.deepEqual(discoverAction({ id: 9, slug: 'demo-day' }, new Set()), { label: 'Open event', to: '/events/demo-day' });
});

/* ------------------------------------------------------------------ *
 * The page, mounted on stubbed reads
 * ------------------------------------------------------------------ */

const key = '__myEventsD1030';
function prepare({ user = { id: 2, role: 'founder' }, list, publicList, suggested } = {}) {
  // A stable toast, as the real hook's: a new showToast each render would re-run the page's load without end.
  globalThis[key] = {
    user,
    toast: { toast: null, showToast: () => {} },
    calls: [],
    api: {
      list: list || (async () => ({ hosting: HOSTING, attending: ATTENDING })),
      suggested: suggested || (async () => ({ events: [{ id: 30, slug: 'pricing', title: 'Suggested Talk', ...at('2026-12-02T10:00:00Z'), suggestion_reason: 'Matches your track' }] })),
      icsUrl: (id) => `/api/events/${id}/ics`,
    },
    publicApi: { list: publicList || (async (p) => { globalThis[key].calls.push(p); return { events: [{ id: 1, slug: 'pricing-workshop', title: 'Pricing Workshop', ...at('2026-11-12T18:00:00Z'), price_cents: 0 }, { id: 31, slug: 'demo-day', title: 'Demo Day · Cohort 6', ...at('2026-11-30T18:00:00Z'), price_cents: 4000, currency: 'usd' }] }; }) },
  };
}
function stub(source) {
  return source
    .replace(/import \{ eventsApi \} from [^;]+;/, `const eventsApi = globalThis.${key}.api;`)
    .replace(/import \{ eventsPublic \} from [^;]+;/, `const eventsPublic = globalThis.${key}.publicApi;`)
    .replace(/import \{ useAuth \} from [^;]+;/, `const useAuth = () => ({ user: globalThis.${key}.user });`)
    .replace(/import \{ useToast \} from [^;]+;/, `const useToast = () => globalThis.${key}.toast;`)
    .replace(/import PageExplainer[^;]+;/, 'const PageExplainer = () => null;')
    .replace(/import EventQRCode[^;]+;/, 'const EventQRCode = ({ value }) => <canvas data-ticket-code={value} />;')
    .replace(/import \{ usePhoneWidth \} from [^;]+;/, 'const usePhoneWidth = () => false;');
}
async function mount(url, source = page) {
  const Page = (await sourceModule(stub(source), pagePath)).default;
  const ui = await mountForm(h(Routes, { location: url }, h(Route, { path: '/my/events/*', element: h(Page) }), h(Route, { path: '/my/events', element: h(Page) })));
  await ui.flush();
  const ids = () => ui.nodes().map((n) => ui.props(n)['data-testid']).filter(Boolean);
  return { ...ui, ids, count: (id) => ids().filter((x) => x === id).length, hrefs: () => ui.nodes().map((n) => ui.props(n).to || ui.props(n).href).filter(Boolean) };
}

test('Upcoming: the tabs with counts, the next event with its code, Going, Needs you, Hosting soon and suggestions', async () => {
  prepare();
  const ui = await mount('/my/events');
  try {
    const ids = ui.ids();
    for (const id of ['my-events-tabs', 'my-events-tab-hosting', 'my-events-new', 'my-events-next', 'my-events-ticket', 'my-events-going', 'my-events-needs', 'my-events-hosting-soon', 'my-events-suggested']) assert.ok(ids.includes(id), id);
    const text = ui.text();
    assert.match(text, /Pricing Workshop/);
    assert.match(text, /Free seat/);
    assert.equal(ui.count('my-events-presenting'),0);
    assert.match(text, /K7Q2-9X4M/);
    assert.match(text, /Waitlist · #3/);
    assert.match(text, /Waiting for the host/);
    assert.match(text, /LP Briefing was sent back by an admin\./);
    assert.equal(ui.nodes().filter((n) => ui.props(n)['data-ticket-code']).length, 1, 'only the next event shows its code');
    assert.ok(!text.includes('OLD-CODE'), 'a past ticket is not on Upcoming');
    assert.ok(ui.hrefs().includes('/api/events/1/ics'));
    assert.ok(!ui.hrefs().some(href => href === 'https://example.test/join'), 'Join is quiet before its window');
    assert.match(text,/The join link opens 15 minutes before the start/);
    assert.ok(ui.hrefs().includes('/my/events/discover'));
  } finally { await ui.unmount(); }
});

test('an Explorer: no Hosting tab, no New event, the line, and no hosted events anywhere', async () => {
  prepare({ user: { id: 3, role: 'exploring' } });
  const ui = await mount('/my/events/hosting');
  try {
    const ids = ui.ids();
    assert.ok(!ids.includes('my-events-tab-hosting') && !ids.includes('my-events-new'));
    assert.ok(ids.includes('my-events-explorer-line'));
    assert.match(ui.text(), /Hosting opens once your profile is set\./);
    assert.ok(!ids.includes('my-events-hosting-soon') && !ids.includes('my-events-needs'));
  } finally { await ui.unmount(); }
});

test('Hosting: the groups, each row\'s one action, and the review desk line for an admin only', async () => {
  prepare();
  const ui = await mount('/my/events/hosting');
  try {
    for (const g of ['needs', 'draft', 'review', 'published', 'cancelled']) assert.ok(ui.ids().includes(`my-events-group-${g}`), g);
    assert.equal(ui.count('my-events-hosted-row'), 7);
    assert.ok(ui.hrefs().includes('/events/13/manage') && ui.hrefs().includes('/events/10/edit'));
    assert.ok(!ui.ids().includes('my-events-review-line'));
  } finally { await ui.unmount(); }
  prepare({ user: { id: 1, role: 'admin' } });
  const admin = await mount('/my/events/hosting');
  try {
    assert.ok(admin.ids().includes('my-events-review-line'));
    assert.ok(admin.hrefs().includes('/admin/events/review'));
  } finally { await admin.unmount(); }
});

test('Discover reads the public calendar from now, marks what you hold, and answers alone when it fails', async () => {
  prepare();
  const ui = await mount('/my/events/discover');
  try {
    assert.equal(ui.count('my-events-discover-row'), 2);
    assert.ok(globalThis[key].calls[0].from, 'only upcoming events');
    assert.equal(globalThis[key].calls[0].limit, 25);
    assert.match(ui.text(), /Going/);
    assert.match(ui.text(), /\$40/);
    assert.ok(ui.hrefs().includes('/events/demo-day'));
  } finally { await ui.unmount(); }
  prepare({ publicList: async () => { throw new Error('boom'); }, list: async () => { throw new Error('list down'); } });
  const failed = await mount('/my/events/discover');
  try {
    assert.ok(failed.ids().includes('my-events-discover-unreadable'));
    assert.ok(!failed.ids().includes('my-events-discover-none'), 'a failed read is not "nothing on"');
  } finally { await failed.unmount(); }
});

test('Past: places and hosted events, newest first, with Replay "Not recorded"; a failed list is never "none"', async () => {
  prepare();
  const ui = await mount('/my/events/past');
  try {
    assert.equal(ui.count('my-events-past-row'), 2);
    assert.match(ui.text(), /Checked in/);
    assert.match(ui.text(), /Replay: Not recorded/);
  } finally { await ui.unmount(); }
  prepare({ list: async () => { throw new Error('down'); } });
  const failed = await mount('/my/events/past');
  try {
    assert.ok(failed.ids().includes('my-events-unreadable'));
    assert.ok(!failed.ids().includes('my-events-past-none'));
    assert.match(failed.text(), /That is not the same as having none\./);
    assert.match(failed.text(), /—/, 'the counts are dashes');
  } finally { await failed.unmount(); }
});

/* ------------------------------------------------------------------ *
 * The source
 * ------------------------------------------------------------------ */

test('the wiring: four routes under one guard with Explorers in, the phone view kept, and the canvas in incoming', () => {
  const app = read('frontend/src/App.jsx');
  for (const p of ['/my/events', '/my/events/hosting', '/my/events/discover', '/my/events/past']) {
    assert.ok(app.split('\n').some((line) => line.trim() === `<Route path="${p}" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <MyEventsPage />)} />`), p);
  }
  assert.match(page, /if \(phone\) \{[\s\S]*?<EventsPhoneView /, 'the phone keeps A7m until the phone part');
  assert.doesNotMatch(page, /\b(alert|confirm)\(/);
  for (const f of ['My Events Page.dc.html', 'My Events · Boards.dc.html']) {
    const src = read(`design/incoming/${f}`);
    assert.match(src, /<script src="\.\/support\.js"><\/script>/, f);
    assert.doesNotMatch(src, /@font-face|__claude_design_branding/, f);
  }
  assert.match(read('design/incoming/My Events · Boards.dc.html'), /dc-import name="My Events Page"/);
  assert.ok(existsSync(new URL('../../documentation/architecture/decisions/D1030.md', import.meta.url)));
});


test('D1131: Join opens exactly 15 minutes before start and requires the existing seat entitlement',()=>{
  const start=Date.parse('2026-11-10T12:00:00Z');const ticket={starts_at:'2026-11-10 12:00:00',ends_at:'2026-11-10T13:00:00Z',reg_status:'confirmed',payment_status:'paid',location_url:'https://example.test/join'};
  assert.deepEqual(joinState(ticket,start-900001),{available:false,note:JOIN_NOTE});
  assert.equal(joinState(ticket,start-900000).available,true);assert.equal(joinState(ticket,start+3600000).available,false);
  for(const payment_status of ['pending','refunded',null,'unknown']) assert.equal(joinState({...ticket,payment_status},start).available,false);
  for(const payment_status of ['none','free','paid']) assert.equal(joinState({...ticket,payment_status},start).available,true);
  assert.equal(joinState({...ticket,reg_status:'waitlisted'},start).available,false);
  assert.equal(joinState({...ticket,status:'cancelled'},start).available,false);
  assert.equal(joinState({...ticket,starts_at:null},start).available,false);
  assert.equal(joinState({...ticket,location_url:null},start).available,false);
});

test('D1131: only stored seat sources are named; account Current respects the path boundary',()=>{
  assert.equal(seatSourceLabel({comp:true,comp_source:'startup_founder'}),'Free seat · Startup founder');
  assert.equal(seatSourceLabel({comp:true,comp_source:'official_partner'}),'Free seat · Official partner');
  assert.equal(seatSourceLabel({comp:true,role:'founder'}),'Free seat · Source not recorded');assert.equal(seatSourceLabel({comp:false,comp_source:'startup_founder'}),null);
  for(const path of ['/my/events','/my/events/hosting','/my/events/past','/my/events/ticket/1']) assert.equal(isMyEventsPath(path),true);
  for(const path of ['/events','/my/events-other','/calendar']) assert.equal(isMyEventsPath(path),false);
});

test('D1131: a durable promotion makes the off-waitlist row; a current status alone never does',()=>{
  const t={...ATTENDING[0],registration_id:21,promoted_at:'2026-11-09T12:00:00Z'};
  const rows=needsYou([],[t],NOW);assert.equal(rows[0].pill,'Off the waitlist');assert.match(rows[0].text,/A seat opened at Pricing Workshop.*You’re going/);assert.equal(rows[0].action.to,'/events/1');
  assert.equal(needsYou([],[{...t,promoted_at:null}],NOW).length,0);
  assert.equal(needsYou([],[{...t,reg_status:'cancelled'}],NOW).length,0);
  assert.equal(needsYou([],[{...t,status:'cancelled'}],NOW).length,0);
  assert.equal(needsYou([],[{...t,starts_at:'2020-01-01T00:00:00Z'}],NOW).length,0);
  assert.match(needsYou([],[{...t,payment_status:'pending'}],NOW)[0].text,/Pay to confirm/);
  assert.match(needsYou([],[{...t,reg_status:'registered'}],NOW)[0].text,/Waiting for the host/);
});

test('D1131: the desktop join control, speaker and seat-source pills use the recorded fields',async()=>{
  const original=Date.now;const start=Date.parse('2026-11-12T18:00:00Z');
  for(const offset of [-900001,-900000]){
    Date.now=()=>start+offset;
    prepare({list:async()=>({hosting:[],attending:[{...ATTENDING[0],ends_at:'2026-11-12T19:00:00Z',comp_source:'startup_founder',is_speaker:true}]})});
    const ui=await mount('/my/events');
    try{
      assert.equal(ui.count('my-events-presenting'),1);assert.match(ui.text(),/Free seat · Startup founder/);
      assert.equal(ui.hrefs().some(href => href === 'https://example.test/join'),offset===-900000);
      if(offset===-900001) assert.match(ui.text(),/The join link opens 15 minutes before the start/);
    }finally{await ui.unmount();Date.now=original;}
  }
});

test('D1131: Hosting and Hosting soon show Check in only on the published event’s own day',async()=>{
  const original=Date.now;Date.now=()=>Date.parse('2026-11-15T12:00:00Z');
  try{
    for(const path of ['/my/events','/my/events/hosting']){
      prepare();const ui=await mount(path);
      try{assert.ok(ui.hrefs().includes('/events/13/manage/check-in'));assert.match(ui.text(),/Check in/);assert.ok(!ui.hrefs().includes('/events/10/manage/check-in'));}finally{await ui.unmount();}
    }
    const event={id:99,status:'published',starts_at:'2026-11-10T16:00:00Z',timezone:'Asia/Tokyo'};
    assert.equal(hostAction(event,Date.parse('2026-11-10T15:00:00Z')).label,'Check in');
    assert.equal(hostAction(event,Date.parse('2026-11-10T14:59:59Z')).label,'Manage');
  }finally{Date.now=original;}
});

test('D1131: Explorer suggestions separate closed, eligible and unknown; failures keep the next event readable',async()=>{
  prepare({user:{role:'exploring'},suggested:async()=>({events:[{id:40,title:'Closed',registration_eligible:false,suggestion_reason:'Popular with new members'},{id:41,title:'Open',registration_eligible:true,suggestion_reason:'Popular with new members'},{id:42,title:'Unknown'}]})});
  const ui=await mount('/my/events');
  try{assert.equal(ui.count('my-events-suggested-closed'),1);assert.equal(ui.count('my-events-suggested-register'),1);assert.match(ui.text(),/Not open to Explorers/);assert.match(ui.text(),/The host opened this event to selected profiles/);assert.match(ui.text(),/Popular with new members/);assert.match(ui.text(),/Eligibility not recorded/);}finally{await ui.unmount();}
  let reads=0;prepare({suggested:async()=>{reads++;if(reads===1)throw Error('synthetic');return {events:[]};}});
  const failed=await mount('/my/events');
  try{assert.match(failed.text(),/Suggested events/);assert.ok(!failed.text().includes('Nothing to suggest right now.'));assert.equal(failed.count('my-events-next'),1);await failed.click('Retry');await failed.flush();assert.equal(reads,2);assert.match(failed.text(),/Nothing to suggest right now/);}finally{await failed.unmount();}
});
