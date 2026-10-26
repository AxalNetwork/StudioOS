// D1037 (#2878, part 7 of #2387) — My events on a phone (MEV18a–c), with the
// page mounted at phone width (`matchMedia` matching PHONE_QUERY, below
// 1024px) and, where the layout differs, at desktop width. The page's own
// reads are stubbed as D1030's suite does; the drawer's and the check-in's go
// through the real clients to a stubbed fetch. Fixtures are worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { Routes, Route } from 'react-router-dom';
import { h, mountForm, sourceModule } from './_form_d695.mjs';
import { BRIGHTNESS, PHONE_ROOT, checkInLine, checkInResult, weekStrip } from '../src/pages/events/myEventsPhoneModel.js';
import { calendarItems } from '../src/pages/events/myEventsTabsModel.js';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const pagePath = 'pages/events/MyEventsPage.jsx';
const page = read('frontend/src/' + pagePath);
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

// The page keeps its own clock (`Date.now()`), so the fixtures are relative to today.
const DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();
const todayAt = (hhmm) => `${new Date().toISOString().slice(0, 10)}T${hhmm}:00Z`;
const T0 = Date.now();
const ATTENDING = [
  { id: 1, title: 'Pricing Workshop', starts_at: iso(T0 + 3 * DAY), ends_at: null, timezone: 'UTC', location_kind: 'virtual', location_url: 'https://example.test/join', reg_status: 'confirmed', payment_status: 'none', comp: true, comp_source: 'audience_rule', checkin_code: 'K7Q2-9X4M' },
  { id: 2, title: 'Operators Social', starts_at: iso(T0 + 18 * DAY), ends_at: null, timezone: 'UTC', location_kind: 'in_person', location_text: 'Rua Exemplo 10', reg_status: 'waitlisted', reg_waitlist_position: 3, comp: false, checkin_code: null },
  { id: 3, title: 'Climate Roundtable', starts_at: iso(T0 + 70 * DAY), ends_at: null, timezone: 'UTC', location_kind: 'hybrid', reg_status: 'registered', comp: false, checkin_code: null },
];
const PAST = { id: 4, title: 'Founder Breakfast', starts_at: iso(T0 - 20 * DAY), ends_at: null, timezone: 'UTC', reg_status: 'attended', outcome: 'attended', comp: false, checkin_code: 'OLD-CODE' };
// Northwind's demo night is today, so its one action is Check in (D1131 / D1036).
const HOSTING = [
  { id: 13, title: 'Northwind Demo Night', starts_at: todayAt('23:59'), ends_at: null, timezone: 'UTC', status: 'published', visibility: 'public', counts: { seats_taken: 42, checked_in: 31, waitlisted: 6, pending_approval: 3, capacity: 60 } },
  { id: 12, title: 'Fresh Draft', starts_at: iso(T0 + 30 * DAY), ends_at: null, timezone: 'UTC', status: 'draft', visibility: 'unlisted' },
];

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('MEV18a: the week strip is the week that holds today, Monday first, with each day\'s going and hosting', () => {
  // Tuesday 10 November 2026, noon in UTC.
  const NOW = Date.parse('2026-11-10T12:00:00Z');
  const items = calendarItems({
    upcoming: [{ id: 1, starts_at: '2026-11-12T18:00:00Z', reg_status: 'confirmed' }, { id: 2, starts_at: '2026-11-28T18:00:00Z', reg_status: 'waitlisted' }],
    hosting: [{ id: 13, starts_at: '2026-11-15T15:00:00Z', status: 'published' }, { id: 14, starts_at: '2026-11-12T09:00:00Z', status: 'published' }],
    now: NOW,
  });
  const w = weekStrip(items, NOW, 'UTC');
  assert.equal(w.title, '9–15 Nov');
  assert.equal(w.thisWeek, true);
  assert.deepEqual(w.days.map((d) => [d.weekday, d.day, d.going, d.hosting, d.today]), [
    ['Mon', 9, 0, 0, false], ['Tue', 10, 0, 0, true], ['Wed', 11, 0, 0, false], ['Thu', 12, 1, 1, false],
    ['Fri', 13, 0, 0, false], ['Sat', 14, 0, 0, false], ['Sun', 15, 0, 1, false],
  ]);
  assert.equal(w.days[3].key, '2026-11-12');
  assert.equal(w.days[3].label, 'Thu 12 Nov: 2 events: going to 1, hosting 1');
  assert.equal(w.days[1].label, 'Tue 10 Nov, today: no events');
  assert.equal(w.days[0].label, 'Mon 9 Nov: no events');
  const later = weekStrip(items, NOW, 'UTC', 3);
  assert.equal(later.title, '30 Nov – 6 Dec', 'a week across two months names both');
  assert.equal(later.thisWeek, false);
  assert.ok(later.days.every((d) => !d.today));
  assert.equal(weekStrip(items, NOW, 'UTC', 2).days.reduce((n, d) => n + d.going + d.hosting, 0), 0, 'a waitlist place is not a dot');
  // A Sunday is the end of its week, never the start of the next.
  assert.equal(weekStrip([], Date.parse('2026-11-15T12:00:00Z'), 'UTC').title, '9–15 Nov');
});

test('MEV18c: the sheet\'s line counts the seats taken that are checked in; a count not read is said, never 0', () => {
  const e = { title: 'Northwind Demo Night', counts: { checked_in: 31, seats_taken: 42 } };
  assert.equal(checkInLine(e), 'Northwind Demo Night · 31 of 42 checked in');
  assert.equal(checkInLine(e, 2), 'Northwind Demo Night · 33 of 42 checked in');
  assert.equal(checkInLine({ title: 'No counts' }), 'No counts · Checked in: not read here yet');
  assert.equal(checkInLine({ title: 'Half', counts: { seats_taken: 42 } }), 'Half · Checked in: not read here yet');
  assert.equal(checkInLine({ counts: { checked_in: 0, seats_taken: 0 } }), 'Not recorded · 0 of 0 checked in', 'a real zero is a zero');
  assert.equal(checkInResult({ registration: { name: 'Ada' } }), 'Checked in: Ada');
  assert.equal(checkInResult({ already_checked_in: true, registration: { name: 'Ada' } }), 'Already checked in: Ada');
  assert.equal(checkInResult({}), 'Checked in.');
  assert.equal(BRIGHTNESS, 'Turn your screen brightness up at the door.');
});

/* ------------------------------------------------------------------ *
 * The page at phone width
 * ------------------------------------------------------------------ */

const key = '__myEventsD1037';
function prepare({ user = { id: 2, role: 'founder' }, list } = {}) {
  globalThis[key] = {
    user,
    toast: { toast: null, showToast: () => {} },
    lists: 0,
    api: {
      list: list || (async () => { globalThis[key].lists += 1; return { hosting: HOSTING, attending: ATTENDING, past: { places: [PAST], total: 1 } }; }),
      invitations: async () => ({ invitations: [] }),
      feedStatus: async () => ({ subscribed: false, created_at: null, last_used_at: null }),
      calendarLinks: async () => ({ google: 'https://calendar.example.test/g', outlook: null, ics: '/api/events/1/ics' }),
      eligibility: async () => { throw new Error('not stubbed'); },
      suggested: async () => ({ events: [] }),
      icsUrl: (id) => `/api/events/${id}/ics`,
    },
    publicApi: { list: async () => ({ events: [] }) },
  };
}
function stub(source) {
  return source
    .replace(/import \{ eventsApi \} from [^;]+;/, `const eventsApi = globalThis.${key}.api;`)
    .replace(/import \{ eventsPublic \} from [^;]+;/, `const eventsPublic = globalThis.${key}.publicApi;`)
    .replace(/import \{ useAuth \} from [^;]+;/, `const useAuth = () => ({ user: globalThis.${key}.user });`)
    .replace(/import \{ useToast \} from [^;]+;/, `const useToast = () => globalThis.${key}.toast;`)
    .replace(/import PageExplainer[^;]+;/, 'const PageExplainer = () => null;');
}
/** The drawer's and the check-in's reads, through the real clients. */
function serve() {
  const posted = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    if ((options.method || 'GET') === 'POST' && /\/api\/events\/13\/checkin\//.test(u)) {
      posted.push(u);
      return response(u.endsWith('/SEEN') ? { already_checked_in: true, registration: { name: 'Bea' } } : { registration: { name: 'Ada' } });
    }
    if (/\/api\/events\/1$/.test(u)) return response({ event: ATTENDING[0], agenda: [], registration: { reg_status: 'confirmed' } });
    if (/\/api\/calendar\/event-links\/1$/.test(u)) return response({ google: 'https://calendar.example.test/g', outlook: null });
    if (/\/api\/events\/13$/.test(u)) return response({ event: HOSTING[0], agenda: [], registration: null });
    return response({ detail: 'Not found' }, 404);
  };
  return { posted, restore: () => { globalThis.fetch = previous; } };
}
async function mount(url, { phone = true } = {}) {
  const net = serve();
  const Page = (await sourceModule(stub(page), pagePath)).default;
  const ui = await mountForm(h(Routes, { location: url }, h(Route, { path: '/my/events/*', element: h(Page) }), h(Route, { path: '/my/events', element: h(Page) })), { phone, modal: true });
  for (let i = 0; i < 4; i += 1) await ui.flush();
  const ids = () => ui.nodes().map((n) => ui.props(n)['data-testid']).filter(Boolean);
  const all = (id) => ui.nodes().filter((n) => ui.props(n)['data-testid'] === id);
  const cls = (n) => { assert.ok(n, 'no such node'); return String(ui.props(n).className || ''); };
  const underRoot = (n) => { for (let p = n; p; p = p.parentNode) if (String(ui.props(p).className || '').split(/\s+/).includes(PHONE_ROOT)) return true; return false; };
  const press = async (n) => { assert.ok(n, 'no such node'); await act(async () => { await ui.props(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); for (let i = 0; i < 4; i += 1) await ui.flush(); };
  const sheets = () => ui.nodes().filter((n) => ui.props(n)['data-phone'] === 'sheet');
  return {
    ...ui, ids, all, cls, underRoot, press, sheets, posted: net.posted,
    count: (id) => all(id).length,
    say: (n) => { assert.ok(n, 'no such node'); return spaced(n).replace(/\s+/g, ' ').trim(); },
    async unmount() { await ui.unmount(); net.restore(); },
  };
}
const hasClass = (cls, c) => cls.split(/\s+/).includes(c);
/** Text with a space between elements, as a reader hears it (the harness's `textOf` runs them together). */
const spaced = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(spaced).join(' ') : n.textContent || '');

test('MEV18a at phone width: the account bar, the tabs sideways, the week strip, the next event full width and Going as cards', async () => {
  prepare();
  const ui = await mount('/my/events');
  try {
    const root = ui.by('my-events-phone');
    assert.ok(root, 'the phone page');
    assert.ok(hasClass(ui.cls(root), PHONE_ROOT) && hasClass(ui.cls(root), '-m-4'), 'the 44px root, in the account pages\' frame');
    assert.match(ui.text(), /‹ Back\s*Events\s*Workshops, office hours, LP briefings and Demo Day\./, 'the account bar: ‹ Back, the title and its sub');
    assert.ok(hasClass(ui.cls(ui.by('my-events-tabs')), 'overflow-x-auto'), 'the tabs scroll sideways');
    assert.deepEqual(ui.all('my-events-tabs')[0] && ui.nodes().filter((n) => /^my-events-tab-/.test(ui.props(n)['data-testid'] || '')).map((n) => ui.props(n)['data-testid']),
      ['my-events-tab-upcoming', 'my-events-tab-hosting', 'my-events-tab-discover', 'my-events-tab-past']);
    assert.ok(ui.by('my-events-phone-upcoming'));
    assert.equal(ui.count('my-events-calendar'), 0, 'no month calendar: the week strip');
    assert.equal(ui.count('my-events-week-day') + ui.count('my-events-week-today-cell'), 7);
    assert.equal(ui.count('my-events-week-today-cell'), 1);
    assert.equal(ui.count('my-events-week-today'), 0, 'this week needs no Today');
    const next = ui.by('my-events-next');
    assert.match(ui.say(next), /^Your next event .*Pricing Workshop/);
    assert.match(ui.say(next), /Free seat · /);
    assert.equal(ui.props(ui.by('my-events-next-ticket')).href, '/my/events/ticket/1');
    assert.equal(ui.count('my-events-ticket'), 0, 'the code is on the ticket, not on Upcoming');
    assert.equal(ui.count('my-events-going-card'), 2, 'Going as cards: the waitlist place and the one waiting for the host');
    assert.match(ui.say(ui.all('my-events-going-card')[0]), /Operators Social .*Waitlist · #3 Show ticket/);
    // Add to calendar opens a bottom sheet with the links.
    await ui.press(ui.by('my-events-next-calendar'));
    const sheet = ui.sheets();
    assert.equal(sheet.length, 1);
    assert.equal(ui.props(sheet[0])['data-testid'], 'my-events-add-calendar-dialog-layer');
    assert.ok(ui.underRoot(sheet[0]), 'its buttons are 44px targets');
    assert.equal(ui.props(ui.by('my-events-add-calendar-google')).href, 'https://calendar.example.test/g');
  } finally { await ui.unmount(); }
});

test('MEV18a: a day of the strip shows only its events, and the week moves', async () => {
  prepare();
  const ui = await mount('/my/events');
  try {
    const before = ui.say(ui.by('my-events-week-title'));
    // The next event is three days out: this week or the next. Its day is the one going to 1.
    const going = () => ui.nodes().find((n) => ui.props(n).role === 'gridcell' && /going to 1/.test(String(ui.props(n)['aria-label'] || '')));
    if (!going()) await ui.press(ui.by('my-events-week-next'));
    const day = going();
    assert.ok(day, 'the next event\'s day carries its dot');
    await ui.press(day);
    assert.equal(ui.props(going())['aria-pressed'], true);
    assert.ok(ui.by('my-events-week-clear'));
    assert.ok(ui.by('my-events-going-day-none'), 'the day holds only the next event, so Going is empty for it');
    await ui.press(ui.by('my-events-week-clear'));
    assert.equal(ui.count('my-events-going-card'), 2);
    if (ui.by('my-events-week-today')) await ui.press(ui.by('my-events-week-today'));
    assert.equal(ui.say(ui.by('my-events-week-title')), before);
    await ui.press(ui.by('my-events-week-next'));
    assert.notEqual(ui.say(ui.by('my-events-week-title')), before);
    assert.ok(ui.by('my-events-week-today'), 'another week offers Today');
    assert.equal(ui.count('my-events-week-today-cell'), 0);
    await ui.press(ui.by('my-events-week-today'));
    assert.equal(ui.say(ui.by('my-events-week-title')), before);
  } finally { await ui.unmount(); }
});

test('MEV18a at desktop width: the month calendar and the next event\'s code, and no phone root', async () => {
  prepare();
  const ui = await mount('/my/events', { phone: false });
  try {
    assert.ok(ui.by('my-events'));
    assert.equal(ui.count('my-events-phone'), 0);
    assert.ok(ui.by('my-events-calendar'));
    assert.equal(ui.count('my-events-week'), 0);
    assert.ok(ui.by('my-events-ticket'), 'the desktop next event carries its code');
  } finally { await ui.unmount(); }
});

/* ------------------------------------------------------------------ *
 * MEV18b: the ticket full screen
 * ------------------------------------------------------------------ */

test('MEV18b at phone width: ‹ Events, the code large and in mono, the brightness line, when and where, Add to calendar; no tabs behind it', async () => {
  prepare();
  const ui = await mount('/my/events/ticket/1');
  try {
    const root = ui.by('my-events-phone-ticket');
    assert.ok(root && hasClass(ui.cls(root), PHONE_ROOT));
    assert.ok(ui.by('my-events-ticket-drawer-page'), 'the drawer drawn as a page');
    assert.equal(ui.count('my-events-ticket-drawer-layer'), 0, 'not a dialog');
    for (const id of ['my-events-tabs', 'my-events-phone-upcoming', 'my-events-week']) assert.equal(ui.count(id), 0, `${id} is not behind the ticket`);
    assert.match(ui.text(), /‹ Events\s*Pricing Workshop/, 'Back goes to Events; the title is the event');
    assert.equal(ui.say(ui.by('my-events-ticket-code-text')), 'K7Q2-9X4M');
    assert.ok(hasClass(ui.cls(ui.by('my-events-ticket-code-text')), 'font-mono'));
    assert.equal(ui.say(ui.by('my-events-ticket-code-line')), 'Show this at the door. The host scans it to check you in. Turn your screen brightness up at the door.');
    assert.ok(ui.by('my-events-ticket-where') && ui.by('my-events-ticket-calendar') && ui.by('my-events-ticket-seat'));
    assert.equal(ui.props(ui.by('my-events-ticket-ics')).href, '/api/events/1/ics');
    assert.equal(ui.count('my-events-ticket-close'), 0, 'the bar is the way back');
    assert.ok(ui.by('my-events-ticket-cancel'), 'the place can still be cancelled');
  } finally { await ui.unmount(); }
  const d = await mount('/my/events/ticket/1', { phone: false });
  try {
    assert.ok(d.by('my-events-ticket-drawer-layer'), 'on a desktop the drawer is over Upcoming');
    assert.ok(d.by('my-events-ticket-close') && d.by('my-events-tabs'));
    assert.equal(d.say(d.by('my-events-ticket-code-line')), 'Show this at the door. The host scans it to check you in.');
  } finally { await d.unmount(); }
});

/* ------------------------------------------------------------------ *
 * MEV18c: Hosting on the day
 * ------------------------------------------------------------------ */

test('MEV18c at phone width: the row\'s Check in opens the camera sheet with "31 of 42 checked in", and each check-in counts', async () => {
  prepare();
  const ui = await mount('/my/events/hosting');
  try {
    assert.ok(hasClass(ui.cls(ui.by('my-events-phone')), PHONE_ROOT));
    assert.ok(ui.by('my-events-new'), 'New event, full width');
    assert.equal(ui.count('my-events-host-checkin'), 1, 'the event\'s day only');
    assert.ok(!ui.nodes().some((n) => ui.props(n).href === '/events/13/manage/check-in'), 'not a link away on a phone');
    await ui.press(ui.by('my-events-host-checkin'));
    const sheet = ui.by('my-events-checkin-sheet-layer');
    assert.ok(sheet && ui.props(sheet)['data-phone'] === 'sheet', 'a bottom sheet');
    assert.ok(ui.underRoot(sheet));
    assert.match(ui.say(ui.by('my-events-checkin-sheet')), /Check in Northwind Demo Night · 31 of 42 checked in/);
    // No BarcodeDetector here: the typed code, as a phone without one gets.
    const field = ui.by('checkin-manual-code');
    assert.ok(field, 'Enter a code');
    await act(async () => { ui.props(field).onChange({ target: { value: 'CODE-1' } }); });
    await act(async () => { ui.props(ui.by('checkin-manual')).onSubmit({ preventDefault() {} }); });
    for (let i = 0; i < 4; i += 1) await ui.flush();
    assert.deepEqual(ui.posted, ['/api/events/13/checkin/CODE-1']);
    assert.equal(ui.say(ui.by('my-events-checkin-result')), 'Checked in: Ada');
    assert.match(ui.say(ui.by('my-events-checkin-sheet')), /32 of 42 checked in/);
    await act(async () => { ui.props(ui.by('checkin-manual-code')).onChange({ target: { value: 'SEEN' } }); });
    await act(async () => { ui.props(ui.by('checkin-manual')).onSubmit({ preventDefault() {} }); });
    for (let i = 0; i < 4; i += 1) await ui.flush();
    assert.equal(ui.say(ui.by('my-events-checkin-result')), 'Already checked in: Bea');
    assert.match(ui.say(ui.by('my-events-checkin-sheet')), /32 of 42 checked in/, 'someone already in is not counted twice');
    const lists = globalThis[key].lists;
    await ui.press(ui.by('my-events-checkin-done'));
    assert.equal(ui.count('my-events-checkin-sheet-layer'), 0, 'Done closes it');
    assert.equal(globalThis[key].lists, lists + 1, 'and Hosting re-reads its counts');
  } finally { await ui.unmount(); }
  const d = await mount('/my/events/hosting', { phone: false });
  try {
    assert.equal(d.count('my-events-host-checkin'), 0);
    assert.ok(d.nodes().some((n) => d.props(n).href === '/events/13/manage/check-in'), 'on a desktop Check in opens the check-in page');
  } finally { await d.unmount(); }
});

test('the hosted drawer and every dialog on the page are bottom sheets', async () => {
  prepare();
  const ui = await mount('/my/events/hosting/13');
  try {
    const layer = ui.by('my-events-hosted-drawer-layer');
    assert.ok(layer && ui.props(layer)['data-phone'] === 'sheet');
    assert.ok(ui.underRoot(layer));
  } finally { await ui.unmount(); }
  // Every Lightbox the page draws, but the ticket (a page), says phone="sheet".
  for (const f of ['MyEventsPage.jsx', 'MyEventsTabs.jsx', 'MyEventsDrawers.jsx', 'MyEventsPhone.jsx']) {
    const src = read(`frontend/src/pages/events/${f}`);
    // Each opening tag, to the end of the line that names its testId.
    for (const m of src.matchAll(/<Lightbox\b[\s\S]*?testId=[^\n]*/g)) {
      if (/testId="my-events-ticket-drawer"/.test(m[0])) { assert.match(m[0], /pageBelow=\{page \? 'lg' : undefined\}/, 'the ticket is a page on a phone'); continue; }
      assert.match(m[0], /phone="sheet"/, `${f}: ${m[0].slice(0, 90)}`);
    }
  }
});

/* ------------------------------------------------------------------ *
 * Each tab at phone width
 * ------------------------------------------------------------------ */

test('each tab at phone width sits in the phone root under the bar and the tabs', async () => {
  for (const [url, id] of [['/my/events', 'my-events-phone-upcoming'], ['/my/events/hosting', 'my-events-hosted-row'], ['/my/events/discover', 'my-events-discover'], ['/my/events/past', 'my-events-past']]) {
    prepare();
    const ui = await mount(url);
    try {
      const body = ui.by(id);
      assert.ok(body, `${url}: ${id}`);
      assert.ok(ui.underRoot(body), `${url}: its controls are 44px targets`);
      assert.ok(ui.by('my-events-tabs'));
      assert.equal(ui.props(ui.nodes().find((n) => ui.props(n)['aria-current'] === 'page')).href, url);
    } finally { await ui.unmount(); }
  }
  // An Explorer's phone: no Hosting tab and no New event.
  prepare({ user: { id: 3, role: 'exploring' } });
  const ex = await mount('/my/events');
  try {
    assert.equal(ex.count('my-events-tab-hosting'), 0);
    assert.equal(ex.count('my-events-new'), 0);
    assert.ok(ex.by('my-events-explorer-line'));
  } finally { await ex.unmount(); }
});

test('a failed read on a phone says so where the tab would be, never "none"', async () => {
  prepare({ list: async () => { throw new Error('down'); } });
  const ui = await mount('/my/events');
  try {
    assert.ok(ui.by('my-events-unreadable'));
    assert.equal(ui.count('my-events-nothing'), 0);
    assert.match(ui.say(ui.by('my-events-count-upcoming')), /^— \( ?Could not be read ?\)$/, 'a dash, never 0');
  } finally { await ui.unmount(); }
});

/* ------------------------------------------------------------------ *
 * The source
 * ------------------------------------------------------------------ */

test('the 44 × 44px rule, A7m retired, and the account bar kept', () => {
  const css = read('frontend/src/pages/events/myEventsPhone.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (selector) => [...css.matchAll(/([^{}]*)\{([^}]*)\}/g)].filter((m) => m[1].split(',').map((s) => s.trim()).includes(selector)).map((m) => m[2]).join(';');
  for (const sel of ['.my-events-phone button', '.my-events-phone select', '.my-events-phone textarea', '.my-events-phone a', ".my-events-phone input:not([type='checkbox']):not([type='radio'])"]) {
    assert.match(rule(sel), /min-height:\s*44px/, sel);
  }
  for (const sel of ['.my-events-phone button', '.my-events-phone select']) assert.match(rule(sel), /min-width:\s*44px/, sel);
  assert.match(rule(".my-events-phone label:has(> input[type='checkbox'])"), /min-height:\s*44px/);
  assert.ok(!/@layer/.test(css));
  assert.equal(PHONE_ROOT, 'my-events-phone');
  assert.match(read('frontend/src/pages/events/MyEventsPhone.jsx'), /import '\.\/myEventsPhone\.css';/);
  assert.doesNotMatch(page, /EventsPhoneView|eventsPhoneGroups|AccountPhonePage |AttendingList/, 'A7m is gone from this page');
  assert.match(page, /<PhoneBar back=\{\{ label: 'Back' \}\} title=\{page\.title\} sub=\{page\.sub\} eadwynLabel=\{page\.title\} \/>/);
  assert.match(page, /<PhoneBar back=\{\{ label: 'Events', onClick: onBack \}\} title=\{title\} eadwynLabel=\{page\.title\} \/>/);
  assert.doesNotMatch(page + read('frontend/src/pages/events/MyEventsPhone.jsx'), /Open Eadwyn for this page/, 'no Eadwyn button of its own');
  // MEV18b's code is large: QRCode draws the canvas itself, so its size is read from the drawer's source.
  assert.match(read('frontend/src/pages/events/MyEventsDrawers.jsx'), /<EventQRCode value=\{place\.checkin_code\} size=\{page \? 240 : 210\} \/>/);
  // The scanner the manage page uses is the same one the sheet draws.
  const scanner = read('frontend/src/components/events/CheckinScanner.jsx');
  assert.match(scanner, /export function useScanner\(/);
  assert.match(scanner, /export function ScannerView\(/);
  assert.match(scanner, /export default function CheckinScanner\(\{ onDetect, onClose, busy = false \}\) \{\s*const scanner = useScanner\(\{ onDetect, busy \}\);/);
});
