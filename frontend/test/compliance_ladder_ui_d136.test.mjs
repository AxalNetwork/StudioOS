/**
 * D136 — the compliance ladder's two surfaces, and the door D135 did not build.
 *
 * THE FINDING THIS FILE WAS WRITTEN AGAINST. D135 shipped the whole ladder —
 * migration 264, the freeze inside `requireAdmin`, the minute sweep, five routes
 * and five `api.js` methods — and **every one of those five methods had zero
 * callers**. So HQ could not issue a notice and a frozen administrator could not
 * answer one. That is worse than inert: the sweep runs every minute, so a notice
 * inserted by SQL would have frozen an account whose only screen said nothing
 * about why.
 *
 * MOSTLY A SOURCE SCAN, AND ONE REAL UNIT TEST. `NoticesEditor`, `NoticeBanner`
 * and `NoticeCard` load in effects or depend on page state, which
 * `renderToStaticMarkup` never runs — the argument `licence_admins_ui_d134`
 * already makes. `toUtcInstant` is different: it is pure, and a date normaliser
 * is exactly the thing a scan cannot check, because the right version and the
 * wrong one are both one `new Date(...)`. So it is exported and called.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/compliance_ladder_ui_d136.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

const HQ_RAW = read('frontend/src/pages/admin/AdminLicences.jsx');
const HQ = codeOnly(HQ_RAW);
const MINE_RAW = read('frontend/src/pages/subsidiary/MyLicencePage.jsx');
const MINE = codeOnly(MINE_RAW);
const API = codeOnly(read('frontend/src/lib/api.js'));
const BAR_RAW = read('frontend/src/components/AdminFrozenBar.jsx');
const BAR = codeOnly(BAR_RAW);
const APP = codeOnly(read('frontend/src/App.jsx'));
const LADDER = read('cloudflare-worker/src/services/complianceLadder.ts');
const AUTH_ERRORS = read('cloudflare-worker/src/util/authErrors.ts');

/** The `NoticesEditor` body alone, so a neighbouring editor's controls cannot
 *  satisfy an assertion about this one — the bounding correction #576 made. */
function noticesEditor(src) {
  const at = src.indexOf('function NoticesEditor(');
  assert.ok(at > 0, 'NoticesEditor is gone — re-point this guard rather than deleting it');
  const end = src.indexOf('function Detail(', at);
  assert.ok(end > at, 'the marker after NoticesEditor moved — re-point the window');
  return src.slice(at, end);
}

test('the five notice methods finally have a caller', () => {
  // The whole reason this PR exists. Three on HQ's side, two on the
  // addressee's, all five dead on arrival in D135.
  for (const m of ['api.licenceNotices(', 'api.licenceNoticeIssue(', 'api.licenceNoticeReview(']) {
    assert.ok(HQ.includes(m), `${m} still has no caller — HQ cannot use the ladder it owns`);
  }
  for (const m of ['api.myNotices(', 'api.myNoticeRespond(']) {
    assert.ok(MINE.includes(m), `${m} still has no caller — a frozen admin cannot answer`);
  }
});

test('the Notices tab is mounted, unnumbered, beside Administrators and History', () => {
  assert.match(HQ, /const NOTICES_STEP = STEPS\.length \+ 3;/,
    'the tab has no step key of its own');
  assert.ok(HQ.includes('{step === NOTICES_STEP && <NoticesEditor'),
    'the tab exists and renders nothing');
  // Unnumbered means it is NOT in STEPS: adding it there renumbers the canvas's
  // six-step issue flow, which `hq_licences_h2h3` and `licence_admins_ui_d134`
  // both pin — and would say a licence cannot be issued without a notice.
  const steps = HQ.match(/const STEPS = \[[^\]]*\]/)?.[0] || '';
  assert.ok(steps.length > 0, 'the issue-flow step list moved — re-point this guard');
  assert.ok(!/Notice/i.test(steps),
    'Notices was added to the numbered issue flow, which renumbers the canvas');
  // Three unnumbered tabs now, each with its own key, and no two the same.
  const keys = new Set([
    HQ.match(/const HISTORY_STEP = (STEPS\.length \+ \d+);/)?.[1],
    HQ.match(/const ADMINS_STEP = (STEPS\.length \+ \d+);/)?.[1],
    HQ.match(/const NOTICES_STEP = (STEPS\.length \+ \d+);/)?.[1],
  ]);
  assert.equal(keys.size, 3, 'two unnumbered tabs share a step key, so one is unreachable');
});

test('Accept and Reject are disabled until the addressee has answered', () => {
  // D134's `still_an_admin` precedent, one route over. The server answers 409
  // `not_responded` to every review of a notice nobody has replied to, so a UI
  // that offered the buttons anyway would teach the operator that its controls
  // are advisory.
  const body = noticesEditor(HQ);
  assert.match(body, /const reviewable = n\.status === 'responded';/,
    'the reviewable test is gone, or no longer reads the status the server checks');
  const accept = body.indexOf("decision: 'accept'");
  const reject = body.indexOf("decision: 'reject'");
  assert.ok(accept > 0 && reject > 0, 'one of the two review actions is gone');
  for (const [name, at] of [['Accept', accept], ['Reject', reject]]) {
    assert.match(body.slice(Math.max(0, at - 400), at), /disabled=\{busy \|\| !reviewable\}/,
      `${name} is offered before the addressee has responded, and the server refuses every click`);
  }
  assert.ok(HQ_RAW.includes('there is\n                      nothing to review until they have')
    || /nothing to review until they have/.test(HQ_RAW),
  'the row does not say why the two buttons are dark');
});

test('the addressee is a picker over this licence\'s own administrators', () => {
  // `POST /notices` resolves the address against `licence_admins` and answers
  // 404 `not_an_administrator` for anybody else, so a free-text box would be a
  // field whose wrong answers are only discoverable by submitting.
  const body = noticesEditor(HQ);
  assert.ok(body.includes('api.licenceAdmins(licence.uid)'),
    'the addressee options are not read from this licence\'s administrators');
  assert.match(body, /admins\.map\(\(a\) => \(\s*<option/,
    'the administrators are fetched and not offered');
  assert.ok(!/type="email"/.test(body),
    'the addressee is a free-text email box, which offers addresses the server refuses');
  // Its own failure state, distinct from "this licence has none".
  assert.match(body, /setAdmins\(null\)/,
    'a failed administrator read falls back to an empty list, so it reads as "nobody"');
});

test('the response window is a bounded count of days, never a date picker', () => {
  const body = noticesEditor(HQ);
  assert.ok(!/type="date"/.test(body),
    'the deadline is picked as a date in the browser\'s zone; the server computes it in SQL');
  assert.match(body, /type="number" min=\{RESPOND_DAYS\.min\} max=\{RESPOND_DAYS\.max\}/,
    'the day count is unbounded on screen while the server clamps it silently');
  // The same three numbers `services/complianceLadder.ts` declares, so the form
  // cannot offer a window the server would quietly correct.
  assert.match(HQ, /const RESPOND_DAYS = \{ min: 1, max: 90, def: 14 \};/);
  assert.match(LADDER, /export const MIN_RESPOND_DAYS = 1;/);
  assert.match(LADDER, /export const MAX_RESPOND_DAYS = 90;/);
  assert.match(LADDER, /export const DEFAULT_RESPOND_DAYS = 14;/);
});

test('an unreadable notice store is not an empty list, on either surface', () => {
  // `notices_available: false` arrives with a 200 and an empty array, so the
  // unreadable state has to be read off the FLAG. Telling somebody whose account
  // is frozen that they have no notices leaves them no route out of the freeze —
  // the #204 distinction on the surface where it costs the most.
  for (const [name, code, raw] of [['HQ', HQ, HQ_RAW], ['the addressee', MINE, MINE_RAW]]) {
    assert.match(code, /notices_available === false/,
      `${name} reads the list's length rather than the availability flag`);
    assert.ok(/setItems\(null\)|setNotices\(null\)/.test(code),
      `${name} has no unreadable state — a failed read renders as "none"`);
    assert.ok(raw.includes('This is not the same as'),
      `${name}'s unreadable state does not say what it is`);
  }
});

test('the addressee\'s three ladder states are three different claims', () => {
  // `issued` is a reminder and nothing is frozen; `overdue` and `rejected` are a
  // freeze. One banner for both would be a false alarm in one direction and a
  // silent freeze in the other.
  assert.match(MINE, /const FREEZING = new Set\(\['overdue', 'rejected'\]\);/);
  assert.match(MINE, /const ANSWERABLE = new Set\(\['issued', 'overdue'\]\);/);
  assert.ok(MINE_RAW.includes('data-testid="licence-frozen-banner"'), 'no frozen banner');
  assert.ok(MINE_RAW.includes('data-testid="licence-notice-banner"'),
    'an in-window notice renders as a freeze, or not at all');
});

test('the SPA agrees with the worker about which statuses freeze', () => {
  // ONE DEFINITION, and `util/authErrors.ts` says why: the gate that refuses and
  // the screen that explains the refusal reading different sets is how an
  // account comes to be frozen by something no page mentions. The SPA cannot
  // import a worker module, so the agreement is asserted instead of assumed.
  const decl = AUTH_ERRORS.match(/FREEZING_STATUSES: readonly \[([^\]]*)\]/)?.[1];
  assert.ok(decl, 'FREEZING_STATUSES moved — re-point this guard rather than deleting it');
  const server = decl.split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean).sort();
  assert.deepEqual(server, ['overdue', 'rejected'], 'the worker\'s freezing set changed');
  const spaMine = MINE.match(/const FREEZING = new Set\(\[([^\]]*)\]\)/)?.[1] || '';
  const spaHq = HQ.match(/const FREEZING_NOTICE_STATUSES = new Set\(\[([^\]]*)\]\)/)?.[1] || '';
  for (const [name, raw] of [['MyLicencePage', spaMine], ['AdminLicences', spaHq]]) {
    const got = raw.split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean).sort();
    assert.deepEqual(got, server, `${name} disagrees with the worker about what freezes`);
  }
});

test('the frozen banner is above the page, not instead of it, and cannot be dismissed', () => {
  // A freeze stops writes, not reading. A page that replaced itself would be
  // enforcing something the server does not — and the licence terms are exactly
  // what somebody answering a notice about fees needs to look at.
  const banner = MINE.indexOf('<NoticeBanner notices={notices} />');
  assert.ok(banner > 0, 'the banner is not rendered');
  const none = MINE.indexOf('if (data.none)');
  const firstPanel = MINE.indexOf('<Panel icon={Map}');
  assert.ok(none > 0 && firstPanel > 0, 'the page\'s shape moved — re-point this guard');
  assert.ok(banner > none,
    'the banner sits inside or above an early return, so it renders where the licence does not');
  assert.ok(banner < firstPanel,
    'the banner renders after the licence panels, so a frozen admin reads their terms first');
  // Not dismissible, and nothing persists: the two existing `*Banner*`
  // components clear themselves through localStorage, which is fine for content
  // and is not fine for a compliance freeze.
  assert.ok(!/localStorage|sessionStorage/.test(MINE),
    'the notices surface persists something to the browser, so one click can silence a freeze');
  assert.ok(!/localStorage|sessionStorage/.test(BAR),
    'the frozen bar remembers a dismissal, so the next refusal would be silent');
});

test('answering needs the server\'s own floor, and only where the server accepts it', () => {
  assert.match(MINE, /draft\.trim\(\)\.length < 10/,
    'the ten-character floor is server-side only, so the form posts a request it knows will fail');
  assert.match(MINE, /const answerable = ANSWERABLE\.has\(notice\.status\);/,
    'the response form is offered for statuses the server answers 409 to');
  assert.ok(MINE_RAW.includes('Answering late is still answering'),
    'nothing tells an overdue addressee that the late answer is the one that lifts it');
});

test('answering does not claim the matter is settled', () => {
  // `routes/licence.ts` states it: writing "paid it" settles nothing, and the
  // freeze lifting is not the same as HQ accepting. Saying only the first half
  // would be the more flattering sentence and the false one.
  assert.ok(MINE_RAW.includes('HQ accepts or rejects, and a rejection freezes the account again'),
    'the success copy implies the response ends it');
  assert.ok(MINE_RAW.includes('Answered and with HQ'),
    'a responded notice does not say it is waiting on HQ');
});

test('HQ is told when one accept is not enough', () => {
  // `POST /notices/:uid/review` returns `freeze_holders` and `reinstated`
  // precisely because accepting one of two leaves the account frozen. Rendering
  // only "accepted" would read as an account released that is not.
  assert.ok(HQ_RAW.includes('data-testid="licence-freeze-holders"'));
  assert.ok(HQ_RAW.includes('Accepting one is not enough'));
  // AND IT HAS TO BE REACHABLE. The two lines above are satisfied by markup
  // sitting inside a branch that can never render — which is exactly what the
  // mutation that replaced the gate with `false` produced, and it walked
  // through the first version of this test. Read backwards from the element to
  // its own gate and require that the gate mentions the count, which pins the
  // property rather than the spelling: rewording the condition is fine,
  // rendering the line without consulting `holders` is not.
  const gateAt = HQ.indexOf('data-testid="licence-freeze-holders"');
  assert.ok(gateAt > 0, 'the freeze-holder line is gone');
  assert.match(HQ.slice(Math.max(0, gateAt - 120), gateAt), /holders/,
    'the freeze-holder line renders without consulting the count, or is unreachable');
  assert.match(HQ, /setLastReview\(res\)/, 'the review response is discarded');
  assert.ok(HQ_RAW.includes('still holding the freeze'),
    'the outcome of a review never says whether the freeze lifted');
});

test('there is one clock on HQ\'s screen and it counts up, not down', () => {
  // The owner's call: no second deadline. "Frozen since <date>, N days" and
  // worst-first sorting are what HQ judges on; a countdown would say the
  // platform decides when an account has had long enough.
  assert.ok(HQ_RAW.includes('data-testid="licence-notice-frozen-for"'));
  assert.ok(HQ_RAW.includes('Frozen since {String(n.froze_at || \'\').slice(0, 10)}'),
    'the frozen-for line does not read froze_at');
  const body = noticesEditor(HQ);
  // The value behind that line, not just the line. Replacing the computation
  // with a constant left the markup untouched and rendered "Frozen since · 0
  // days" against notices that are not frozen at all — the same escape the
  // freeze-holder count made, one element over. Both halves are claims about
  // the value: it comes from the freeze STAMP, and only for a status that
  // actually freezes.
  const frozenAssign = body.match(/const frozenDays = [^;]*;/)?.[0] || '';
  assert.match(frozenAssign, /FREEZING_NOTICE_STATUSES/,
    'how long an account has been frozen is computed for statuses that do not freeze it');
  assert.match(frozenAssign, /froze_at/,
    'how long an account has been frozen is not computed from froze_at');
  assert.match(body, /noticeRank\(a\.status\) - noticeRank\(b\.status\)/,
    'the list is not sorted worst-first');
  assert.match(HQ, /const noticeRank = \(status\) => \{[\s\S]*?FREEZING_NOTICE_STATUSES\.has\(status\)\) return 0;/,
    'the freezing statuses do not sort first');
  // Terminating stays the deliberate act it already was, at the top of the page.
  assert.ok(!body.includes('api.licenceTerminate'),
    'terminating was folded into the notices tab, which makes it a step of a sequence');
});

test('a 423 announces itself wherever it is met', () => {
  // `423` appeared NOWHERE in frontend/src before this, so a frozen admin's
  // every click produced whatever generic error the page happened to print.
  assert.match(API, /res\.status === 423 && err && err\.code === 'admin_frozen'/,
    'the compliance freeze has no client-side identity');
  assert.match(API, /studioos:admin_frozen/, 'nothing is dispatched, so nothing can listen');
  assert.match(API, /notice: err\.notice \|\| null/,
    'the notice riding in the 423 body is thrown away, so the bar has nothing to name');
  // The two branches this one was modelled on must still work — a listener
  // inserted in the wrong place could return or throw early.
  assert.match(API, /res\.status === 402 && typeof window !== 'undefined'/,
    'the tier-required branch was disturbed');
  assert.match(API, /err\.code === 'step_up_required'/, 'the step-up branch was disturbed');
  // And the structured error still reaches every caller's own catch. BOUNDED:
  // `lastIndexOf('throw e;')` finds an unrelated one 2,000 lines further down a
  // 3,000-line module, so the first version of this passed with the throw
  // deleted. The claim is about the refusal branch's OWN exit, so the window is
  // from the dispatch to the start of the success path.
  const at = API.indexOf('studioos:admin_frozen');
  const successAt = API.indexOf('const data = await res.json()', at);
  assert.ok(successAt > at, 'the request helper\'s success path moved — re-point this guard');
  // ANCHORED TO THE BRANCH'S CLOSING THROW, not to "a throw somewhere in the
  // window". The step-up block below the dispatch has its own `throw e;` for
  // the user-cancelled case, so a looser version of this was satisfied by that
  // one and passed with the branch's real exit deleted — the second time in
  // this file an assertion was answered by a neighbour.
  assert.match(API.slice(at, successAt), /throw e;\s*\}\s*$/,
    'the refusal branch stopped throwing, so pages stop seeing the error at all');
});

test('the bar points at the page the worker already names', () => {
  // `complianceLadder.ts` sends the freeze notification with
  // `link: '/admin/my-licence'`. The bar going anywhere else would be a second
  // answer to "where do I fix this", and the two would drift.
  assert.match(LADDER, /link: '\/admin\/my-licence'/,
    'the worker\'s freeze notification no longer names this page — re-point both');
  assert.ok(BAR.includes('to="/admin/my-licence"'),
    'the bar does not link to the one page that can lift the freeze');
  assert.match(APP, /<SafeMount name="AdminFrozenBar"><AdminFrozenBar \/><\/SafeMount>/,
    'the bar is not mounted, so the 423 event has no listener');
  assert.match(BAR, /window\.addEventListener\('studioos:admin_frozen'/,
    'the bar does not listen for the event api.js dispatches');
});

test('one sentence explains the freeze, in all three places that explain it', () => {
  // The worker already shipped it twice — the notification body and the email
  // template. A third wording of one fact is how two surfaces come to disagree
  // about what lifts a freeze.
  const SENTENCE = 'Writes are paused; reading is not. Answering the notice is what lifts it.';
  assert.ok(LADDER.includes(SENTENCE), 'the worker\'s sentence changed — re-point all three');
  assert.ok(MINE_RAW.includes(SENTENCE), '/admin/my-licence invents its own wording');
  assert.ok(BAR_RAW.includes(SENTENCE), 'the frozen bar invents its own wording');
});

// THE TESTS BELOW MUST NOT RUN IN UTC, and that is not a preference.
//
// The defect is that `new Date('2026-09-20 14:00:00')` is read by V8 as the
// READER'S LOCAL time while the server wrote it as UTC. On a UTC machine those
// two are the same instant — so an assertion about them, run here, passes
// whether or not the normalisation exists. It was written that way first, the
// mutation that reverts `daysTo` to a bare `new Date(iso)` walked straight
// through it, and this comment is what that cost.
//
// CI and this container both run UTC (`new Date().getTimezoneOffset()` is 0),
// which is precisely the machine on which the honest-looking version of this
// test is decoration. So the zone is set for the duration and restored after:
// an assertion that cannot fail on the machines that run it is not a guard.
const OFFSET_ZONE = 'America/New_York'; // UTC-4/-5 — never 0, in any season.
function inZone(fn) {
  const prev = process.env.TZ;
  process.env.TZ = OFFSET_ZONE;
  // Fail loudly rather than silently re-becoming the UTC test: if this runtime
  // ignores a late TZ change, the assertions below prove nothing.
  assert.notEqual(new Date().getTimezoneOffset(), 0,
    'the runtime ignored the TZ change, so these assertions cannot fail — fix the harness, not the test');
  try { fn(); } finally {
    if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev;
  }
}

test('toUtcInstant reads both stamp formats the server writes', async () => {
  // THE ONE REAL UNIT TEST HERE, and the reason it is one: `daysTo` was
  // `new Date(iso)`, which is correct for `renews_on` (a bare date, UTC midnight
  // by spec) and wrong for `respond_by` (SQL `YYYY-MM-DD HH:MM:SS`, which V8
  // reads as the READER'S LOCAL TIME and other engines reject). A source scan
  // cannot tell the two versions apart — both are one `new Date(...)`.
  const { toUtcInstant } = await import('../src/pages/admin/AdminLicences.jsx');

  // The SQL form, which `datetime('now', '+N days')` writes and the sweep
  // compares against `datetime('now')` — so it is UTC, and must parse as UTC.
  assert.equal(toUtcInstant('2026-09-20 14:00:00'), '2026-09-20T14:00:00Z');
  // The bare date, untouched: `renews_on`'s existing caller must keep working.
  assert.equal(toUtcInstant('2026-09-20'), '2026-09-20');
  // Already zoned — left exactly as it is rather than stamped twice.
  assert.equal(toUtcInstant('2026-09-20T14:00:00Z'), '2026-09-20T14:00:00Z');
  assert.equal(toUtcInstant('2026-09-20T14:00:00+02:00'), '2026-09-20T14:00:00+02:00');
  // Absent is absent, and must not become the epoch.
  assert.equal(toUtcInstant(null), null);
  assert.equal(toUtcInstant(''), null);
  assert.equal(toUtcInstant('   '), null);

  inZone(() => {
    assert.equal(
      new Date(toUtcInstant('2026-09-20 14:00:00')).getTime(),
      Date.UTC(2026, 8, 20, 14, 0, 0),
      'a SQL stamp is read in the reader\'s own zone, so the deadline moves by their offset',
    );
    assert.equal(new Date(toUtcInstant('2026-09-20')).getTime(), Date.UTC(2026, 8, 20),
      'the bare-date form stopped parsing as UTC midnight, so renews_on moved too');
  });
});

test('daysTo counts from the normalised instant, not the reader\'s zone', async () => {
  const { daysTo, toUtcInstant } = await import('../src/pages/admin/AdminLicences.jsx');
  assert.equal(typeof toUtcInstant, 'function');
  assert.equal(daysTo(null), null);
  assert.equal(daysTo('not a date'), null);

  inZone(() => {
    // The arithmetic itself, on whole days.
    const sql = (ms) => new Date(Date.now() + ms).toISOString().replace('T', ' ').slice(0, 19);
    for (const [days, label] of [[6, 'in six days'], [-3, 'three days overdue'], [1, 'tomorrow']]) {
      assert.equal(daysTo(sql(days * 86400000)), days, `a deadline ${label} is counted wrongly`);
    }

    // AND THE DISCRIMINATOR, WHICH WHOLE DAYS ARE NOT. `Math.round` swallows a
    // four-hour misread at every exact day multiple — 6.0 and 6.167 are both
    // "6" — so the first version of this assertion passed under the mutation
    // that reverts `daysTo` to a bare `new Date(iso)`. Sweeping the hour is
    // what makes it fail: whatever the reader's offset, some hours of the day
    // put the two parses on opposite sides of the rounding boundary.
    //
    // The claim is the one that matters and needs no knowledge of the offset:
    // the SQL spelling and the explicit-Z spelling OF THE SAME INSTANT must
    // produce the same number of days.
    for (let h = 0; h < 24; h += 1) {
      // Milliseconds zeroed on purpose: `toISOString()` emits `.000Z` and the
      // SQL form has no sub-second field, so without this the two spellings are
      // up to 999 ms APART — and at +12h, which is exactly the rounding
      // boundary, that alone flips the answer. The test would then fail on
      // correct code, which is the other way to have an assertion that proves
      // nothing.
      const at = Math.floor((Date.now() + 6 * 86400000 + h * 3600000) / 1000) * 1000;
      const isoZ = new Date(at).toISOString();
      const asSql = isoZ.replace('T', ' ').slice(0, 19);
      assert.equal(daysTo(asSql), daysTo(isoZ),
        `at +${h}h the SQL stamp and the same instant written with a Z give different counts — `
        + 'the SQL form is being read in the reader\'s zone');
    }
    // And the bare date its other caller passes still works from here.
    assert.equal(typeof daysTo('2099-01-01'), 'number');
  });
});
