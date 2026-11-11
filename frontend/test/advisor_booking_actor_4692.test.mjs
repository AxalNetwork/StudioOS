/**
 * #4692 (D4692) — the two screens the booking rules reach.
 *
 * RUN YOUR SESSIONS, on a 409. D4703 made every lifecycle write conditional on
 * the status the panel had read, so a 409 means the session MOVED — the founder
 * cancelled it, or a second press got there first. The panel answered every
 * failure with "That could not be recorded. The session is unchanged", which
 * was wrong both ways round: the session had just changed, and the advisor was
 * left pressing the same button against the same stale list.
 *
 * AN ADVISOR'S OPEN HOURS, on the founder's side. `GET /api/advisors/:uid/slots`
 * answers the booking's own rules per slot (`unavailable_code`,
 * `paid_cap_reached`, #4949). Nothing read them, so the list offered a Book
 * button on hours the booking was certain to refuse.
 *
 * The Worker's half is cloudflare-worker/test/advisor_booking_actor_4692.test.ts.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/advisor_booking_actor_4692.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { h, mountForm, mutationCheck, sourceModule, textOf } from './_form_d695.mjs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const START = new Date(Date.now() + 3 * 86_400_000).toISOString();
const END = new Date(Date.parse(START) + 45 * 60_000).toISOString();

const SESSIONS_API = "import { api } from '../../../lib/api';";
const PAGE_API = "import { api } from '../lib/api';";

const SESSIONS_PATH = 'pages/advisor/practice/SessionActions.jsx';
/** `SessionActions.jsx`'s source with its api import replaced by a stub this file owns. */
function sessionsSource() {
  const source = read('../src/pages/advisor/practice/SessionActions.jsx');
  assert.ok(source.includes(SESSIONS_API));
  return source.replace(SESSIONS_API, 'const { api } = globalThis.__api4692Sessions;');
}

async function sessionsModule(apiStub) {
  globalThis.__api4692Sessions = { api: apiStub };
  return sourceModule(sessionsSource(), SESSIONS_PATH);
}

/** `AdvisorsPage.jsx` with its api replaced by a stub. */
async function pageModule(apiStub, source = read('../src/pages/AdvisorsPage.jsx')) {
  assert.ok(source.includes(PAGE_API));
  globalThis.__api4692Page = { api: apiStub };
  return sourceModule(source.replace(PAGE_API, 'const { api } = globalThis.__api4692Page;'), 'pages/AdvisorsPage.jsx');
}

const CONFIRMED = {
  id: 31, status: 'confirmed', topic: 'Synthetic session', startsAt: START,
  counterpartyName: 'Fran', awaitingDecision: false,
};
const refusal = (status) => Object.assign(new Error('refused'), { status });

const panel = (mod, onChanged) => h(mod.SessionLifecyclePanel, { bookings: [CONFIRMED], loading: false, onChanged });

// 1 ───────────────────────────────────────────────────────────────────────────
test('a 409 on a lifecycle press says the session moved and offers the reload, which reloads', async () => {
  let reloads = 0;
  const mod = await sessionsModule({ completeAdvisorBooking: async () => { throw refusal(409); } });
  const f = await mountForm(panel(mod, async () => { reloads += 1; }));
  try {
    await f.click('Session held');
    await f.flush();
    const text = f.text();
    assert.match(text, /changed somewhere else/, 'it says the session moved');
    assert.match(text, /nothing here was recorded/, 'and that this press did not land');
    assert.ok(!/The session is unchanged/.test(text), 'it no longer claims the session is unchanged');
    const reload = f.by('lifecycle-reload');
    assert.ok(reload, 'the reload is offered');
    assert.equal(reloads, 0, 'the refused press did not reload on its own');
    await f.click(textOf(reload).trim());
    await f.flush();
    assert.equal(reloads, 1, 'pressing it reloads the sessions');
    assert.equal(f.by('lifecycle-reload'), undefined, 'and the offer goes once it is taken');
  } finally { await f.unmount(); }
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('any other failure keeps the old message and offers no reload', async () => {
  // A 500 means the write never happened, so "unchanged" is the true thing to
  // say and a reload would show the advisor exactly what they already have.
  const mod = await sessionsModule({ completeAdvisorBooking: async () => { throw refusal(500); } });
  const f = await mountForm(panel(mod, async () => {}));
  try {
    await f.click('Session held');
    await f.flush();
    assert.match(f.text(), /The session is unchanged/);
    assert.ok(!/changed somewhere else/.test(f.text()));
    assert.equal(f.by('lifecycle-reload'), undefined, 'nothing to reload');
  } finally { await f.unmount(); }
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('the 409 branch is what produces the offer, not any failure', async () => {
  // Mutations checked: the 409 test widened to every error; the 409 branch
  // dropped back to the single message; the reload button removed.
  // The module destructures its api once, when it is evaluated, so the status
  // is swapped on the stub itself rather than by reassigning the holder.
  let status = 500;
  globalThis.__api4692Sessions = { api: { completeAdvisorBooking: async () => { throw refusal(status); } } };
  const press = async (mod, code) => {
    status = code;
    const f = await mountForm(panel(mod, async () => {}));
    try {
      await f.click('Session held');
      await f.flush();
      return { offered: Boolean(f.by('lifecycle-reload')), text: f.text() };
    } finally { await f.unmount(); }
  };
  await mutationCheck(
    sessionsSource(),
    SESSIONS_PATH,
    async (mod) => {
      const five = await press(mod, 500);
      assert.equal(five.offered, false, 'a 500 offers no reload');
      assert.match(five.text, /The session is unchanged/);
      const nine = await press(mod, 409);
      assert.equal(nine.offered, true, 'a 409 does');
      assert.match(nine.text, /changed somewhere else/);
    },
    [
      ['if (e?.status === 409) {', 'if (e?.status === 409 || e) {'],
      ['setStale(true);', 'setStale(false);'],
    ],
  ).finally(() => {
    globalThis.__api4692Sessions = undefined;
  });
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('an hour the booking would refuse is listed with its reason and no Book button', async () => {
  const slot = (id, extra) => ({
    id, uid: `s-${id}`, advisor_id: 1, starts_at: START, ends_at: END, capacity: 1, taken: 0,
    available: 1, is_cancelled: false, has_meeting_link: false, unavailable_code: null,
    paid_cap_reached: false, ...extra,
  });
  const items = [
    slot(1, {}),
    slot(2, { unavailable_code: 'min_notice' }),
    slot(3, { unavailable_code: 'blackout' }),
    slot(4, { unavailable_code: 'buffer' }),
  ];
  const mod = await pageModule({ listAdvisorSlots: async () => ({ items }) });
  const f = await mountForm(h(mod.AdvisorDetail, { advisor: { uid: 'a-1', display_name: 'Synthetic Advisor' }, onClose() {} }), { modal: true });
  try {
    await f.flush();
    const books = f.nodes().filter((n) => n.tagName === 'BUTTON' && textOf(n).trim() === 'Book');
    assert.equal(books.length, 1, 'only the hour that passes the rules can be booked');
    assert.match(f.props(books[0])['aria-label'], /45 minutes/);
    for (const [id, phrase] of [[2, /Too soon/], [3, /does not hold sessions/], [4, /Too close to another session/]]) {
      const row = f.by(`slot-unavailable-${id}`);
      assert.ok(row, `slot ${id} is still listed`);
      assert.match(textOf(row), phrase, `slot ${id} says why`);
      assert.match(textOf(row), /Not bookable/);
    }
    assert.equal(f.by('slot-unavailable-1'), undefined, 'the bookable hour is not listed as refused');
    assert.equal(f.by('slots-all-ruled-out'), undefined, 'and one bookable hour is not "none"');
  } finally { await f.unmount(); }
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('the paid cap stops a paid session only, and all-refused hours never read as no availability', async () => {
  const capped = {
    id: 9, uid: 's-9', advisor_id: 1, starts_at: START, ends_at: END, capacity: 1, taken: 0, available: 1,
    is_cancelled: false, has_meeting_link: false, unavailable_code: null, paid_cap_reached: true,
  };
  const paid = { id: 5, name: 'Deep dive', duration_minutes: 45, price_cents: 20000, is_free_intro: 0, is_included: 0 };
  const free = { id: 6, name: 'Intro', duration_minutes: 45, price_cents: 0, is_free_intro: 1, is_included: 0 };
  const advisor = { uid: 'a-1', display_name: 'Synthetic Advisor' };

  const mod = await pageModule({ listAdvisorSlots: async () => ({ items: [capped] }) });
  const f = await mountForm(h(mod.AdvisorDetail, { advisor, sessionType: paid, onClose() {} }), { modal: true });
  try {
    await f.flush();
    assert.ok(f.by('slot-unavailable-9'), 'a paid session cannot take an hour in a week at the cap');
    assert.match(textOf(f.by('slot-unavailable-9')), /paid sessions they accept/);
    // The founder is not told there is nothing — the hour is there, and says why.
    assert.ok(f.by('slots-all-ruled-out'), 'with no bookable hour left, the list says so without claiming none exist');
    assert.ok(!/No open slots/.test(f.text()), 'never "no open slots" when hours were read');
    assert.equal(f.nodes().filter((n) => n.tagName === 'BUTTON' && textOf(n).trim() === 'Book').length, 0);
  } finally { await f.unmount(); }

  const g = await mountForm(h(mod.AdvisorDetail, { advisor, sessionType: free, onClose() {} }), { modal: true });
  try {
    await g.flush();
    assert.equal(g.by('slot-unavailable-9'), undefined, 'the same hour takes a free intro');
    assert.equal(g.nodes().filter((n) => n.tagName === 'BUTTON' && textOf(n).trim() === 'Book').length, 1);
  } finally { await g.unmount(); }
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('a response without the verdict fields offers every hour, as it did before #4949', async () => {
  // An older Worker, or the FastAPI dev backend, sends neither field. Absent is
  // no verdict, never a refusal: the founder must not lose a bookable hour to a
  // field that was not sent.
  const bare = { id: 11, uid: 's-11', advisor_id: 1, starts_at: START, ends_at: END, capacity: 1, taken: 0, available: 1, is_cancelled: false };
  const mod = await pageModule({ listAdvisorSlots: async () => ({ items: [bare] }) });
  const f = await mountForm(h(mod.AdvisorDetail, { advisor: { uid: 'a-1', display_name: 'Synthetic Advisor' }, onClose() {} }), { modal: true });
  try {
    await f.flush();
    assert.equal(f.nodes().filter((n) => n.tagName === 'BUTTON' && textOf(n).trim() === 'Book').length, 1);
    assert.equal(f.by('slot-unavailable-11'), undefined);
  } finally { await f.unmount(); }
});
