/**
 * HQ · Content and Platform — canvas H6.
 *
 * THE ARTBOARD'S SUBTITLE IS THE THING THIS FILE MOSTLY GUARDS. It reads
 * "one pipeline replacing three systems", and the temptation on a page
 * called Content is to draw that pipeline as though it had been built. It
 * has not, and it is not three either: news was never a separate store —
 * the `/api/admin/news` queue read the same `articles` table — and D166
 * RETIRED it, so there is now one admin queue over that table rather than
 * two. What is left is two stores with two meanings of "published".
 *
 * Two more claims the pages must not make: the master template library is a
 * LINK to the page that owns it rather than a second copy over the same
 * store, and Platform must never carry key material — it counts and states.
 *
 * The zone titles are read OFF THE ARTBOARD rather than retyped.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { TRIGGER_STATES } from '../../cloudflare-worker/src/util/cronHistory.ts';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const CONTENT = raw('frontend/src/pages/hq/ContentPage.jsx');
const PLATFORM = raw('frontend/src/pages/hq/PlatformPage.jsx');
const C = codeOnly(CONTENT);
const P = codeOnly(PLATFORM);
const APP = codeOnly(raw('frontend/src/App.jsx'));
const API = codeOnly(raw('frontend/src/lib/api.js'));
/**
 * Source text with JS string concatenation collapsed.
 *
 * The long `*_reason` messages are wrapped across several literals joined
 * with `+`, so a sentence a reader sees as one line does not exist as one
 * in the file — `/News is no longer a third/` failed on exactly that,
 * spanning the join. Collapsing first means these assertions are about the
 * MESSAGE and survive a rewrap, which is what they are actually for.
 */
const joined = (src) => src.replace(/'\s*\n\s*\+ '/g, '');
const CROUTE = joined(raw('cloudflare-worker/src/routes/admin_content.ts'));
const PROUTE = joined(raw('cloudflare-worker/src/routes/admin_platform.ts'));
const INDEX = raw('cloudflare-worker/src/index.ts');
const CANVAS = raw('design/canvases/integrated/Admin · Super.dc.html');

/** H6 alone, bounded at both ends. Unescaped — the canvas is HTML. */
function h6() {
  const a = CANVAS.indexOf('Content Studio and Platform');
  assert.ok(a >= 0, 'the H6 artboard could not be found in the canvas');
  const b = CANVAS.indexOf('Governance, and the "viewing as" overlay', a);
  assert.ok(b > a, 'H7 no longer follows H6 — this slice would run past the artboard');
  return CANVAS.slice(a, b).replaceAll('&amp;', '&');
}

test('both pages draw what the artboard draws', () => {
  const board = h6();
  for (const s of ['one pipeline replacing three systems', 'Master template library',
                   'Keys, flags, jobs', 'Content', 'Platform']) {
    assert.ok(board.includes(s), `the artboard no longer draws "${s}"`);
  }
  assert.match(CONTENT, /Master template library/, 'the Content page dropped the template zone');
  assert.match(PLATFORM, /Feature flags/, 'the Platform page dropped the flags zone');
  assert.match(PLATFORM, /Scheduled jobs/, 'the Platform page dropped the jobs zone');
});

test('the unified pipeline is NOT claimed, and news is not called a third system', () => {
  // The whole premise check. Getting this wrong in either direction is a
  // false statement: claiming the pipeline exists, or reporting news as
  // outstanding when the repo has already retired it.
  assert.match(CROUTE, /unified_pipeline_available: false/,
    'the route claims a unified pipeline exists');
  assert.match(CROUTE, /News is not a third/,
    'the reason does not record that news is no longer a separate queue');
  assert.match(C, /data\.unified_pipeline_reason/, 'the page does not show why the two are still two');

  // D166 RE-AIMED BOTH HALVES OF THIS TEST, and the second half is why it
  // needed saying. The premise used to be verified by READING
  // `routes/admin_news.ts` and asserting it read `FROM articles` behind a
  // `Deprecation` header. Deleting that file makes the read throw ENOENT, so
  // that half fails loudly and cannot be missed.
  //
  // The half above CANNOT: it scans `admin_content.ts`'s reason string, which
  // is a live API response body the SPA renders. Had the wording not moved
  // with the delete, this test would have gone on passing while the product
  // told operators that a retired router "already answers with a Deprecation
  // header". A guard that keeps passing on a sentence the code made false is
  // the defect this whole PR is about, one layer up — so the reason is
  // asserted to describe the retirement rather than the alias.
  assert.doesNotMatch(CROUTE, /Deprecation header pointing at/,
    'the reason still describes admin_news as a live deprecated alias');
  assert.ok(!existsSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/admin_news.ts')),
    'routes/admin_news.ts is back — D166 retired it for accepting in_review at publish');
});

test('the template library is linked, not rebuilt', () => {
  assert.match(CROUTE, /owned_by: '\/admin\/contracts'/, 'the route no longer names the owning page');
  assert.match(C, /to=\{templates\.owned_by\}/, 'the page hardcodes the destination instead of following the payload');
  // A second editing surface over the same store is exactly what must not
  // appear here.
  assert.doesNotMatch(C, /api\.adminContractsTemplates|\/templates\/legal|\/templates\/store/,
    'the Content page reads the template store directly — two consoles over one store');
});

test('Platform never carries key material', () => {
  assert.match(PROUTE, /secrets_included: false/, 'the payload no longer states that it holds no secrets');
  for (const leak of ['access_token', 'refresh_token', 'api_key_encrypted', 'client_secret']) {
    assert.ok(!PROUTE.includes(leak), `the platform route selects ${leak}`);
    assert.ok(!P.includes(leak), `the platform page renders ${leak}`);
  }
  // The artboard's reveal and revoke are deliberately absent — and this
  // asserts the absence of a CONTROL, not of a word. Matching /Reveal/
  // caught the page's own prose explaining that reveal lives elsewhere,
  // which is the opposite of the defect. A read-only summary has no
  // handlers of its own at all, so that is what is pinned.
  assert.doesNotMatch(P, /onClick=/,
    'the platform summary grew an interactive control — it is a read-only view');
  assert.doesNotMatch(P, /onSubmit=|<form/, 'the platform summary grew a form');
  assert.match(P, /integrations\.secrets_note/, 'the page does not tell the reader why there is no reveal here');
});

test('a job that went silent is not reported as healthy', () => {
  // D201 — RE-AIMED FROM SPELLING TO BEHAVIOUR. This test pinned three
  // literals: a 26-hour window, an ISO cutoff comparison and a `running`
  // state. All three were the defect. One window aged every cadence alike
  // (a dead every-minute scheduler unnoticed for a day, a healthy weekly
  // trigger stale six days in seven); the ISO cutoff misread rows stored as
  // `YYYY-MM-DD HH:MM:SS`; and no writer can leave a row that reads as
  // running. What must stay true is that the route reads each DECLARED
  // trigger against its own schedule, through the one module that owns the
  // table, and that the page draws exactly the states the route can return.
  // The states themselves are asserted, at fixed clocks and against real
  // SQLite, in cloudflare-worker/test/cron_record_d201.test.ts.
  assert.match(PROUTE, /triggerState\(t\.expr, row, now, STALE_GRACE_MINUTES\)/,
    'the route no longer reads each trigger against its own schedule');
  assert.match(PROUTE, /latestRunPerTrigger\(env, CRON_TRIGGERS\.map/,
    'the route no longer reads the declared triggers');
  assert.match(PROUTE, /grace_minutes: STALE_GRACE_MINUTES/, 'the grace is not stated in the payload');
  assert.doesNotMatch(PROUTE, /GROUP BY trigger_name/, 'the whole-table read came back');
  assert.doesNotMatch(PROUTE, /STALE_AFTER_HOURS/, 'the one window for every cadence came back');

  // THE PAGE'S TONES ARE EXACTLY THE ROUTE'S STATES. A tone for a state
  // nothing returns is decoration, and a state with no tone would draw as
  // whatever the fallback is.
  const open = PLATFORM.indexOf('const JOB_TONE = {');
  assert.ok(open >= 0, 'the page renders every job state the same');
  const body = PLATFORM.slice(open, PLATFORM.indexOf('};', open));
  const tones = [...body.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]).sort();
  assert.deepEqual(tones, [...TRIGGER_STATES].sort(), 'the page and the route disagree about the job states');
  assert.match(P, /JOB_TONE\[j\.state\] \|\| JOB_TONE\.never/,
    'an unknown state falls back to the healthy tone');
});

test('no absent figure is defaulted to a number, on either page', () => {
  for (const [name, src] of [['Content', C], ['Platform', P]]) {
    assert.doesNotMatch(src, /\|\|\s*0\b/, `${name}: an absent figure falls back to 0`);
    assert.doesNotMatch(src, /\?\?\s*0\b/, `${name}: an absent figure falls back to 0`);
  }
  // THREE STATS THAT MUST STAY PERMANENTLY BLANK, down from four in D112 —
  // and "Awaiting brand approval" left this list because it acquired a store,
  // not because the assertion was inconvenient. A content escalation carries
  // the branch that submitted it and takes an approve / request-changes
  // decision, so the count is real and is asserted in its own test below.
  // "Localised" STAYS, for the one part of H6's refusal that did not change:
  // nothing records that one piece is a localisation of another.
  for (const [src, label] of [[C, 'Localised'], [P, 'Flags'], [P, 'Overrides']]) {
    const at = src.indexOf(`label="${label}"`);
    assert.ok(at >= 0, `the ${label} stat is gone`);
    // BOUNDED TO THE ELEMENT, not to a character count. `at + 160` ran past
    // the closing tag into the NEXT <Stat>, so replacing this one's
    // value={null} with value={0} still matched the neighbour's — both
    // mutations escaped. The slice ends at this element's own `/>`.
    const end = src.indexOf('/>', at);
    assert.ok(end > at, `the ${label} stat is not a self-closing element any more`);
    assert.match(src.slice(at, end), /value=\{null\}/,
      `the ${label} stat acquired a value — there is no source for one`);
  }
});

test('a status no lane names is surfaced rather than swallowed', () => {
  // `articles.status` has NO check constraint, so a new status can appear
  // with no schema change and silently vanish from the lane totals.
  assert.match(CROUTE, /unmapped_statuses/, 'the route no longer reports unmapped statuses');
  assert.match(C, /pipeline\.unmapped_statuses\.length > 0/, 'the page never shows them');
});

test('both pages are wired, gated, and mounted before the catch-all', () => {
  assert.match(API, /hqContent: \(\) => request\('\/admin\/content\/summary'\)/, 'the content api method is gone');
  assert.match(API, /hqPlatform: \(\) => request\('\/admin\/platform\/summary'\)/, 'the platform api method is gone');
  for (const path of ['/admin/content', '/admin/platform']) {
    assert.ok(APP.includes(`path="${path}"`), `${path} is not registered`);
  }
  const catchAll = INDEX.indexOf("app.route('/api/admin', admin)");
  for (const r of ['content', 'platform']) {
    const at = INDEX.indexOf(`app.route('/api/admin/${r}'`);
    assert.ok(at >= 0, `the ${r} worker route is not mounted`);
    assert.ok(catchAll > at, `the ${r} route is mounted after the catch-all, so it never runs`);
  }
  for (const [name, route] of [['content', CROUTE], ['platform', PROUTE]]) {
    assert.match(route, /requireSuperAdmin\(c\)/, `the ${name} route does not re-check the elevation`);
  }
});

test('the honesty pair is imported on both pages, not declared again', () => {
  for (const [name, src] of [['Content', C], ['Platform', P]]) {
    assert.match(src, /import \{[^}]*Unrecorded[^}]*Unreadable[^}]*\} from '\.\.\/\.\.\/ui'/,
      `${name} does not import the shared honesty pair`);
    assert.doesNotMatch(src, /function Unrecorded\(|function Unreadable\(/,
      `${name} declares its own copy of a shared component`);
  }
});

test('an unreadable summary is distinguished from an empty one, on both pages', () => {
  for (const [name, src, claim] of [
    ['Content', C, 'This is not a claim that nothing is in progress.'],
    ['Platform', P, 'This is not a claim that nothing is connected.'],
  ]) {
    assert.match(src, /const UNAVAILABLE = Symbol\('unavailable'\)/, `${name}: the failed-read state is gone`);
    assert.ok(src.includes(`claim="${claim}"`), `${name}: the unreadable state does not say what it is not`);
  }
  // And an empty job history is stated as empty rather than left blank —
  // "readable and empty" is a different fact from "could not be read".
  assert.match(P, /readable and empty/, 'an empty job history renders as nothing at all');
});

test('the localisation lane is real, and the one absence it does NOT close is named', () => {
  // D112 — WHERE THE "Awaiting brand approval" ASSERTION WENT. It moved rather
  // than disappeared: the figure it pinned as permanently blank now has a
  // store, so what must be asserted is that the store is read and that the
  // remaining absence is still stated. A deleted assertion would have left
  // both halves unguarded.
  assert.match(C, /api\.escalations\(\{ kind: 'content' \}\)/,
    'the lane does not read content escalations');
  assert.match(C, /label="Submitted for approval"/, 'the submitted count is gone');
  assert.match(C, /onRetry=\{loadLane\}/, 'an unreadable lane cannot be retried on its own');

  // The count comes from the lane's own length — never a `|| 0`, and never a
  // figure invented when the lane could not be read.
  const at = C.indexOf('label="Submitted for approval"');
  const end = C.indexOf('/>', at);
  assert.match(C.slice(at, end), /laneItems \? String\(laneItems\.length\) : null/,
    'the submitted count is defaulted rather than left absent when the lane is unreadable');

  // AND THE REFUSAL SURVIVES, NARROWED. The route's sentence is rendered, and
  // it still names the link nothing records — deleting it would make the lane
  // read as a count of translations.
  assert.match(C, /data\.localisation_reason/, 'the narrowed refusal is no longer rendered');
  // CROUTE, NOT `raw` — the narrowed sentence wraps mid-phrase ("a localisation
  // of " + "another"), so the raw text does not contain the phrase a reader
  // sees. That is the whole reason `joined` exists at the top of this file, and
  // an assertion that reads the unjoined text fails on the correct code.
  assert.match(CROUTE, /localisation of another/, 'the route stopped naming the missing link');
  assert.doesNotMatch(CROUTE, /no brand-approval state/,
    'the route still claims no brand-approval state exists, which D112 made false');
});
