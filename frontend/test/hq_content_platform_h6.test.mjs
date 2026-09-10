/**
 * HQ · Content and Platform — canvas H6.
 *
 * THE ARTBOARD'S SUBTITLE IS THE THING THIS FILE MOSTLY GUARDS. It reads
 * "one pipeline replacing three systems", and the temptation on a page
 * called Content is to draw that pipeline as though it had been built. It
 * has not, and it is not three either: `admin_news.ts` reads the same
 * `articles` table and already answers with a Deprecation header, so news
 * is a deprecated alias rather than a third system. What is left is two
 * stores with two meanings of "published".
 *
 * Two more claims the pages must not make: the master template library is a
 * LINK to the page that owns it rather than a second copy over the same
 * store, and Platform must never carry key material — it counts and states.
 *
 * The zone titles are read OFF THE ARTBOARD rather than retyped.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

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
  // outstanding when the repo already collapsed it into articles.
  assert.match(CROUTE, /unified_pipeline_available: false/,
    'the route claims a unified pipeline exists');
  assert.match(CROUTE, /News is no longer a third/,
    'the reason does not record that news is already collapsed into articles');
  assert.match(C, /data\.unified_pipeline_reason/, 'the page does not show why the two are still two');
  // And the claim is verifiable rather than asserted: news really does read
  // the same table and really does ship the deprecation header.
  const NEWS = raw('cloudflare-worker/src/routes/admin_news.ts');
  assert.match(NEWS, /FROM articles/, 'admin_news no longer reads the articles table — recheck the premise');
  assert.match(NEWS, /Deprecation/, 'admin_news no longer announces itself as deprecated');
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
  // Three states, not two. A trigger whose last run succeeded but which
  // stopped firing a week ago is the failure mode a naive status column
  // hides completely.
  assert.match(PROUTE, /const STALE_AFTER_HOURS = 26;/, 'the staleness window is gone');
  assert.match(PROUTE, /started < cutoff \? 'stale'/, 'a silent trigger is no longer detected');
  assert.match(PROUTE, /row\.finished_at \? 'ok' : 'running'/, 'an unfinished run is no longer distinguished');
  assert.match(P, /JOB_TONE/, 'the page renders every job state the same');
});

test('no absent figure is defaulted to a number, on either page', () => {
  for (const [name, src] of [['Content', C], ['Platform', P]]) {
    assert.doesNotMatch(src, /\|\|\s*0\b/, `${name}: an absent figure falls back to 0`);
    assert.doesNotMatch(src, /\?\?\s*0\b/, `${name}: an absent figure falls back to 0`);
  }
  // The four stats that must stay permanently blank.
  for (const [src, label] of [[C, 'Localised'], [C, 'Awaiting brand approval'],
                              [P, 'Flags'], [P, 'Overrides']]) {
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
