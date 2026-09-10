/**
 * `/calendar` — `design/incoming/Calendar.dc.html`, boards C1–C6, element by
 * element, plus the two rules the canvas exists to enforce.
 *
 * WHAT THE CANVAS ASKED FOR THAT WAS NOT THERE:
 *
 *   a chip per kind       `partner_office_hour` had none, so office hours
 *                         were reachable only under "All". The kinds were
 *                         hardcoded in THREE places in the page and one of
 *                         the three had drifted
 *   counts on the chips   there were none at all
 *   a range segment       Week / Month / Agenda; the page fetched one fixed
 *                         window and never said which
 *   the 328px rail        both provider cards were full-width blocks stacked
 *                         above the agenda
 *   the three promises    sync / push / .ics were never distinguished
 *   a 74px time column    the time sat inline in the row's second line
 *   empty vs degraded     one "Nothing on your calendar yet." covered an
 *                         empty range, a broken source and a failed request
 *
 * THE TWO STRONG ASSERTIONS. Everything else here is a comparison against the
 * canvas; these two are comparisons against the CODE, because they are the
 * failures that already happened:
 *
 *   · the page's kinds equal the union the worker can emit — parsed from
 *     `CalendarEvent` in `services/calendar.ts`, not from the canvas, which
 *     draws only five. A seventh kind added without a chip fails here.
 *   · the page's `PUSHABLE_KINDS` equals the route's. The canvas draws a push
 *     control on a Calendly event and `routes/calendar.ts` refuses that with a
 *     400 — so the page follows the route, and this keeps the two in step.
 *
 * SIX KINDS, NOT FIVE, and the deviation is asserted rather than glossed: the
 * canvas leaves `expert_booking` out because it believed nothing produced it.
 * Something does; the write was broken. Migration 235 fixed it, so the kind is
 * drawn — and this file checks the canvas still says what it says, so the day
 * someone re-exports the canvas with six kinds, the note stops being true and
 * a maintainer is told.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { escapeRe } from './_escapeRe.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

const CANVAS = raw('design/incoming/Calendar.dc.html');
const pageRaw = raw('frontend/src/pages/CalendarPage.jsx');
const page = codeOnly(pageRaw);
const css = raw('frontend/src/pages/calendarPage.css');
const service = raw('cloudflare-worker/src/services/calendar.ts');
const route = raw('cloudflare-worker/src/routes/calendar.ts');

/**
 * The canvas keeps its fixtures in the script block, not in the markup, and
 * both halves are needed. Each slice below is bounded at BOTH ends: an
 * unbounded `indexOf` has sliced the wrong block in this repo's canvas suites
 * before, and a slice that runs to the end of the file will happily "find" a
 * string that belongs to a different board.
 */
const TEMPLATE = CANVAS.slice(CANVAS.indexOf('<sc-for list="{{ boards }}"'), CANVAS.indexOf('<script type="text/x-dc" data-dc-script=""'));
// nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag
// -- `CANVAS` is a design file read off disk by `readFileSync` in a Node test.
// It is sliced into strings and matched with regexes; nothing here renders,
// reaches a DOM, or takes external input, so the XSS the rule describes has
// nowhere to happen. The literal is a SEARCH TERM for the end of the canvas's
// data block, which is the tightest bound available and the one this file's
// header insists every slice must have.
const SCRIPT = CANVAS.slice(CANVAS.lastIndexOf('class Component extends DCLogic'), CANVAS.lastIndexOf('</script>'));
const KINDS_BLOCK = SCRIPT.slice(SCRIPT.indexOf('══ FIVE KINDS'), SCRIPT.indexOf('const dotFor'));
const BOARDS = SCRIPT.slice(SCRIPT.indexOf('return { boards: ['), SCRIPT.length);

for (const [name, slice] of [['TEMPLATE', TEMPLATE], ['SCRIPT', SCRIPT], ['KINDS_BLOCK', KINDS_BLOCK], ['BOARDS', BOARDS]]) {
  assert.ok(slice.length > 200 && slice.length < CANVAS.length,
    `the ${name} slice did not bound anything — the canvas markers have moved`);
}

/** The canvas's own kind table, parsed rather than retyped. */
const canvasKinds = [...KINDS_BLOCK.matchAll(/\{\s*id:'(\w+)',\s*label:'([^']+)',\s*src:'([^']+)',\s*hue:'(#[0-9a-f]{6})',\s*dHue:'(#[0-9a-f]{6})',\s*shape:'([^']*)'\s*\}/g)]
  .map((m) => ({ id: m[1], label: m[2], src: m[3], hue: m[4], dHue: m[5], shape: m[6] }));

/** The page's kind table, likewise. */
const pageKinds = [...(codeOnly(pageRaw).match(/const KINDS = \[([\s\S]*?)\n\];/)?.[1] || '')
  .matchAll(/\{ id: '(\w+)', label: '([^']+)', src: '([^']+)' \}/g)]
  .map((m) => ({ id: m[1], label: m[2], src: m[3] }));

test('the canvas and the page were both parsed, so a silent zero-match cannot pass', () => {
  assert.equal(canvasKinds.length, 5, 'the canvas kind table no longer parses as five entries');
  assert.equal(pageKinds.length, 6, 'the page kind table no longer parses as six entries');
});

test('the page draws a chip for every kind the worker can emit, and no others', () => {
  // Parsed from the union, NOT from the canvas: the canvas draws five and the
  // worker emits six. This is the assertion that fails the day a seventh kind
  // is added — which is exactly how partner_office_hour lost its chip.
  const union = service.match(/\n {2}kind: ((?:'\w+'(?:\s*\|\s*)?)+);/)?.[1] || '';
  const emitted = [...union.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
  assert.equal(emitted.length, 6, 'the CalendarEvent kind union did not parse');
  assert.deepEqual(pageKinds.map((k) => k.id).sort(), emitted,
    'a kind the worker can emit has no chip on /calendar, or a chip names a kind it cannot');

  // And the worker's own reader table agrees with the union — tsc enforces it
  // through Record<CalendarEvent['kind'], …>, and this says so out loud so the
  // day someone widens that type the guarantee is not lost quietly.
  const readers = service.match(/const READERS: Readonly<Record<CalendarEvent\['kind'\], CalendarReader>> = \{([\s\S]*?)\n\};/)?.[1] || '';
  assert.deepEqual([...readers.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]).sort(), emitted,
    'a kind in the union has no reader, or a reader has no kind');
});

test('the five kinds the canvas draws keep its labels, sources, hues and dot shapes', () => {
  for (const k of canvasKinds) {
    const mine = pageKinds.find((p) => p.id === k.id);
    assert.ok(mine, `the canvas draws ${k.id} and the page does not`);
    assert.equal(mine.label, k.label, `${k.id} is labelled differently from the canvas`);
    assert.equal(mine.src, k.src, `${k.id} names a different source from the canvas`);
    // Hue and shape live in the stylesheet, one rule per kind, both themes.
    assert.match(css, new RegExp(`--k-${escapeRe(k.id)}: ${escapeRe(k.hue)};`), `${k.id} lost its light hue`);
    assert.match(css, new RegExp(`--k-${escapeRe(k.id)}: ${escapeRe(k.dHue)};`), `${k.id} lost its dark hue`);
    const dot = css.match(new RegExp(`\\.cal-dot\\[data-kind='${escapeRe(k.id)}'\\] \\{([^}]*)\\}`))?.[1] || '';
    assert.match(dot, new RegExp(`border-radius: ${escapeRe(k.shape)};`),
      `${k.id}'s dot is no longer the shape the canvas draws`);
    assert.match(dot, new RegExp(`background: var\\(--k-${escapeRe(k.id)}\\)`), `${k.id}'s dot stopped using its own hue`);
  }
});

test('the sixth kind is derived in the canvas\'s idiom rather than borrowed from it', () => {
  const drawnShapes = canvasKinds.map((k) => k.shape);
  const drawnHues = canvasKinds.flatMap((k) => [k.hue, k.dHue]);
  const dot = css.match(/\.cal-dot\[data-kind='expert_booking'\] \{([^}]*)\}/)?.[1] || '';
  const shape = dot.match(/border-radius: ([^;]+);/)?.[1];
  assert.ok(shape, 'expert_booking has no dot');
  assert.ok(!drawnShapes.includes(shape), 'expert_booking reuses a shape the canvas already assigned');
  const light = css.match(/--k-expert_booking: (#[0-9a-f]{6});/)?.[1];
  const dark = css.match(/--k-expert_booking: (#[0-9a-f]{6});[\s\S]*?--k-expert_booking: (#[0-9a-f]{6});/)?.[2];
  assert.ok(light && dark && light !== dark, 'expert_booking does not lift to a separate dark hue');
  for (const h of [light, dark]) {
    assert.ok(!drawnHues.includes(h), `expert_booking reuses ${h}, a hue the canvas already assigned`);
  }
  // And the accent itself, which no kind may take.
  assert.ok(![light, dark].includes('#6d28d9'), 'expert_booking took the violet accent');

  // The canvas's stated reason for omitting it is recorded, and the docblock
  // says why it no longer holds. If the canvas is ever re-exported saying
  // something else, this fails and the note gets revisited.
  assert.match(KINDS_BLOCK, /expert_booking is\s*\n?\s*\/\/ in the type union and produced by nothing/,
    'the canvas no longer gives the reason the page\'s docblock quotes');
  assert.match(pageRaw, /SIX KINDS, NOT THE CANVAS'S FIVE/,
    'the deviation from the canvas is no longer recorded in the page');
});

test('push is drawn for exactly the kinds the route accepts', () => {
  const routeSet = route.match(/const PUSHABLE_KINDS = new Set\(\[([\s\S]*?)\]\);/)?.[1] || '';
  const pageSet = page.match(/const PUSHABLE_KINDS = new Set\(\[([\s\S]*?)\]\);/)?.[1] || '';
  const ids = (s) => [...s.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
  assert.equal(ids(routeSet).length, 4, 'the route PUSHABLE_KINDS set did not parse');
  assert.deepEqual(ids(pageSet), ids(routeSet),
    '/calendar draws a push control the route would refuse, or hides one it would accept');

  // The canvas draws push on a Calendly event; the route refuses it. The page
  // follows the route and states the reason where the control would have been.
  assert.ok(!ids(routeSet).includes('calendly_event'), 'the route now accepts calendly_event — revisit this deviation');
  assert.match(CANVAS, /kind:'calendly_event'[\s\S]{0,400}?actions:\['push'\]/,
    'the canvas no longer draws push on a Calendly event — revisit the recorded deviation');
  assert.match(page, /const unpushable = !cancelled && !PUSHABLE_KINDS\.has\(ev\.kind\);/,
    'a kind the route will not push no longer states its reason');
});

test('every count on the page comes from the one fetched list', () => {
  // The canvas's headline rule. `inRange` is the only list; the All chip, each
  // kind chip and each day group must all read from it, and nothing may count
  // a second list. This is the failure this codebase shipped twice.
  assert.match(page, /const inRange = items;/, 'the single list is gone');
  assert.match(page, /out\[k\.id\] = Array\.isArray\(inRange\) \? inRange\.filter\(\(e\) => e\.kind === k\.id\)\.length : null;/,
    'the kind counts no longer come from inRange');
  assert.match(page, /return filter \? inRange\.filter\(\(e\) => e\.kind === filter\) : inRange;/,
    'the rendered pool no longer comes from inRange');
  assert.match(page, /for \(const e of pool\)/, 'the day groups no longer come from the pool');
  assert.match(page, /All\{Array\.isArray\(inRange\) \? <b>\{inRange\.length\}<\/b> : null\}/,
    'the All chip no longer advertises the unfiltered count');
  assert.match(page, /\{d\.events\.length\} \{d\.events\.length === 1 \? 'event' : 'events'\}/,
    'a day group no longer counts its own rendered events');
  // No other array may be counted into a chip or a group.
  assert.doesNotMatch(page, /\.length\}<\/b>/g.source ? /<b>\{(?!inRange\.length|counts\[k\.id\])[^}]*\.length\}<\/b>/ : /$^/,
    'a chip is counting something other than the one list');
});

test('the canvas layout is built: header, gate strip, controls, agenda beside a 328px rail', () => {
  assert.match(css, /\.cal-rail \{ width: 328px;/, 'the rail is not the canvas\'s 328px');
  assert.match(css, /\.cal-row \{ display: grid; grid-template-columns: 74px 1fr;/, 'the time column is not the canvas\'s 74px');
  assert.match(css, /\.cal-body \{ display: flex;/, 'the agenda and rail no longer sit side by side');
  // Order on the page: the gate strip and the controls are full-width rows
  // above the split, exactly as the canvas draws them.
  const order = ['className="cal-head"', 'className="cal-gate"', 'className="cal-controls"', 'className="cal-body"', 'className="cal-main"', 'className="cal-rail"'];
  let at = -1;
  for (const marker of order) {
    const next = page.indexOf(marker);
    assert.ok(next > at, `${marker} is out of the canvas's order`);
    at = next;
  }
});

test('the header carries the three canvas actions and the IC gate matches canScheduleIc', () => {
  assert.match(TEMPLATE, /New IC meeting/);
  assert.match(TEMPLATE, /New check-in/);
  assert.match(TEMPLATE, /Subscribe · \.ics/);
  for (const label of ['New IC meeting', 'New check-in', 'Subscribe · .ics']) {
    assert.ok(page.includes(label), `the header lost "${label}"`);
  }
  assert.match(page, /const canIC = role === 'admin' \|\| role === 'investor';/,
    'the IC gate no longer mirrors canScheduleIc');
  assert.match(route, /return r === 'admin' \|\| r === 'investor';/,
    'canScheduleIc changed — the page gate must follow it');
  // Absent, not disabled — and the reason where the control would have been.
  assert.match(page, /\{canIC && \(/, 'the IC control is being disabled rather than withheld');
  assert.match(pageRaw, /Creating an IC meeting is limited to admins and investors, so the control is not/,
    'the gate strip lost the canvas\'s wording');
});

test('the range segment is Week / Month / Agenda with Agenda selected first', () => {
  assert.match(SCRIPT, /const RANGES = \['Week','Month','Agenda'\];/, 'the canvas range list changed');
  assert.match(SCRIPT, /const sel = o\.range \|\| 'Agenda';/, 'the canvas no longer defaults to Agenda');
  assert.deepEqual(
    [...(page.match(/const RANGES = \[([\s\S]*?)\];/)?.[1] || '').matchAll(/'(\w+)', '(\w+)'/g)].map((m) => m[2]),
    ['Week', 'Month', 'Agenda'],
    'the page no longer offers the canvas\'s three ranges',
  );
  assert.match(page, /useState\('agenda'\)/, 'the page no longer opens on Agenda');
  assert.match(page, /aria-pressed=\{range === id\}/, 'the selected range is not announced');
});

test('empty range, degraded source and failed request are three different states', () => {
  // The canvas's distinction: an empty range means the sources ANSWERED.
  assert.match(TEMPLATE, /All five sources answered and returned nothing for this range\./,
    'the canvas empty-range copy changed');
  assert.match(pageRaw, /sources answered and returned nothing for this range\. That means the calendar is working/,
    'the empty range no longer says the sources answered');
  assert.match(pageRaw, /did not respond\.\s*\n\s*The other \{KINDS\.length - failedSources\.length\} sources loaded\./,
    'the degraded banner no longer names what loaded');
  assert.match(page, /className="cal-alert" role="alert"/, 'a failed request no longer renders its own state');
  assert.match(page, /setItems\(null\);/, 'a failed request is being stored as an empty list');
  // And they cannot render as each other: the empty card requires a real list.
  assert.match(page, /\{!loading && Array\.isArray\(inRange\) && inRange\.length === 0 && \(/,
    'the empty-range card can render over a request that never answered');
});

test('the rail carries the three promises and the source legend', () => {
  for (const s of ['Sync a calendar', 'Push one event', 'Subscribe · .ics']) {
    assert.ok(TEMPLATE.includes(s), `the canvas no longer names "${s}"`);
    assert.ok(pageRaw.includes(s), `the rail lost "${s}"`);
  }
  assert.match(pageRaw, /Ongoing, per provider\./);
  assert.match(pageRaw, /One-time, per event\. A copy is written once; later changes here do not follow it\./);
  assert.match(pageRaw, /Read-only feed for any client\. No account connection, no write access\./);
  // The legend lists every kind with the store it comes from.
  assert.match(page, /<span className="cal-mono">\{k\.src\}<\/span>/, 'the legend no longer names each kind\'s source');
  for (const k of pageKinds) {
    assert.ok(page.includes(`src: '${k.src}'`), `${k.id} lost its source`);
  }
});

test('nothing absent renders as a dash or a plausible zero', () => {
  // The canvas's rule, and the reason it is a rule: a zero and an unknown look
  // identical, and only one of them is a fact about the reader.
  assert.match(TEMPLATE, /Not recorded/);
  assert.doesNotMatch(page, /[>{]\s*[—–-]\s*[<}]/, 'a bare dash is being rendered as a value');
  // A chip with no readable list carries no number at all rather than a zero.
  assert.match(page, /\{counts\[k\.id\] === null \? null : <b>\{counts\[k\.id\]\}<\/b>\}/,
    'a chip prints a count when the list could not be read');
  // Every "Not recorded" on the rail is followed by the reason it is missing.
  const spec = page.match(/const SPEC = \{([\s\S]*?)\n  \};/)?.[1] || '';
  const states = [...spec.matchAll(/^ {4}(\w+): \{/gm)].map((m) => m[1]);
  assert.deepEqual(states, ['reading', 'unconfigured', 'off', 'connected', 'failed'],
    'the provider states changed without this guard');
  assert.equal([...spec.matchAll(/whyNoSync: /g)].length, states.length,
    'a provider state can show "Not recorded" with no reason beside it');
  assert.equal([...spec.matchAll(/\n {6}why: /g)].length, states.length,
    'a provider state has no why-line');
});

test('with no provider connected the push control is withheld and the note names the right remedy', () => {
  // The canvas derives this rather than flagging it, and is explicit that a
  // token that EXPIRED needs reconnecting while one never connected needs
  // connecting. C6 draws an expired Google as no provider at all.
  assert.match(SCRIPT, /const noProvider = !gConn && !mConn;/);
  assert.match(SCRIPT, /const gConn = \(o\.google \|\| 'connected'\) === 'connected';/,
    'the canvas no longer treats a failed provider as unusable for push');
  assert.match(page, /const anyConnected = gState === 'connected' \|\| mState === 'connected';/,
    'a provider whose sync was refused is being treated as pushable');
  assert.match(page, /const mayPush = !cancelled && PUSHABLE_KINDS\.has\(ev\.kind\) && canPush;/,
    'the push control no longer depends on a connection');
  assert.match(pageRaw, /reconnect it in the panel on the right/, 'the reconnect remedy is gone');
  assert.match(pageRaw, /Connect Google or Outlook in the panel on the right/, 'the connect remedy is gone');
  assert.match(page, /\(gState === 'failed' \|\| mState === 'failed'\)/,
    'the two remedies are no longer told apart');
});

test('every control on an event row is drawn only where the route would accept it', () => {
  assert.match(page, /const mayRsvp = !cancelled && ev\.kind === 'ic_meeting' && isAttendee;/,
    'RSVP is drawn for someone with no attendee row');
  assert.match(page, /const mayCancel = !cancelled && \(/, 'cancel is drawn on a cancelled event');
  assert.match(page, /\(ev\.kind === 'ic_meeting' && \(isAdmin \|\| isOrganiser\)\)/,
    'cancel on an IC meeting no longer follows the route\'s organiser-or-admin rule');
  assert.match(route, /if \(!\(isAdmin\(lc\(user\.role\)\) \|\| m\.organizer_user_id === user\.id\)\) \{/,
    'the IC cancel rule changed — the page must follow it');
  // Every RSVP value the page offers is one the route accepts.
  const accepted = route.match(/if \(!\['accepted', 'declined', 'tentative'\]\.includes\(rsvp\)\)/);
  assert.ok(accepted, 'the RSVP value check moved');
  assert.deepEqual(
    [...(page.match(/const RSVP_CHOICES = \[([\s\S]*?)\];/)?.[1] || '').matchAll(/'(\w+)'/g)]
      .map((m) => m[1]).filter((v) => !['Yes', 'Maybe', 'No'].includes(v)).sort(),
    ['accepted', 'declined', 'tentative'],
    'the page offers an RSVP value the route would reject',
  );
});

test('both themes are first class — every token has two values and no colour is light-only', () => {
  const light = css.match(/\.cal \{([\s\S]*?)\n\}/)?.[1] || '';
  const dark = css.match(/\.dark \.cal \{([\s\S]*?)\n\}/)?.[1] || '';
  const names = (s) => [...s.matchAll(/(--[\w-]+):/g)].map((m) => m[1]).sort();
  assert.ok(names(light).length >= 30, 'the light token block did not parse');
  assert.deepEqual(names(dark), names(light), 'a token exists in one theme and not the other');
  // Nothing outside the two token blocks may name a colour directly.
  const rest = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(light, '').replace(dark, '');
  const stray = [...rest.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
  assert.deepEqual(stray, [], `a rule hardcodes a colour instead of using a token: ${stray.join(', ')}`);
  // Dark lifts the kind hues rather than reusing the light ones.
  for (const k of pageKinds) {
    const l = light.match(new RegExp(`--k-${escapeRe(k.id)}: (#[0-9a-f]{6})`))?.[1];
    const d = dark.match(new RegExp(`--k-${escapeRe(k.id)}: (#[0-9a-f]{6})`))?.[1];
    assert.ok(l && d && l !== d, `${k.id} does not lift to a dark hue`);
  }
});

test('the explainer above the agenda names only sources that exist', () => {
  // FOUND BY LOADING THE BUILT PAGE IN A BROWSER, not by reading it. The
  // shared explainer for this page promised "office hours, board meetings,
  // filings — alongside your personal events": there is no board-meeting
  // source, no filing source, and the sync is ONE-WAY, so nothing the reader
  // keeps on Google is ever read back in. Three false claims sitting on the
  // one page whose whole rule is not making them.
  const explainers = raw('frontend/src/lib/explainers.js');
  const entry = explainers.match(/\n  calendar: \{([\s\S]*?)\n  \},/)?.[1] || '';
  assert.ok(entry.includes('body:'), 'the calendar explainer entry did not parse');
  for (const claim of ['board meeting', 'filing', 'alongside your personal events']) {
    assert.ok(!entry.toLowerCase().includes(claim),
      `the calendar explainer still promises "${claim}", which this page has no source for`);
  }
  // And every source it does name is one of the six.
  assert.match(entry, /events you keep there are not read back in/i,
    'the explainer no longer says the sync is one-way');
  const externalReader = service.includes("kind: 'google_external'") || service.includes("kind: 'microsoft_external'");
  assert.equal(externalReader, false,
    'the worker now emits external events — the explainer may say so again, and a chip is owed');
});

test('the explainer sits outside the header row, so the canvas actions stay beside the title', () => {
  // Inside the header's left column it stretched the flex row and pushed the
  // three actions onto a line of their own — visible only in a browser.
  const head = page.slice(page.indexOf('className="cal-head"'), page.indexOf('className="cal-explainer"'));
  assert.ok(head.length > 100, 'the header no longer precedes the explainer strip');
  assert.ok(!head.includes('PageExplainer'), 'the explainer is back inside the header row');
  assert.match(page, /<div className="cal-explainer"><PageExplainer pageKey="calendar" \/><\/div>/,
    'the explainer strip is gone — the page would lose its explainer entirely');
  assert.match(css, /\.cal-explainer \{ padding: 12px 24px 0; \}/, 'the strip lost its gutter');
});

test('no sentence splices a kind label in where a lower-case noun belongs', () => {
  // "A Expert session event cannot be copied…" — wrong article and a label
  // capitalised mid-sentence, because the copy interpolated KIND_LABEL into
  // running prose. Labels are chips and eyebrows; prose says "this event".
  assert.match(page, /This event cannot be copied one at a time/,
    'the unpushable note no longer reads as a sentence');
  assert.doesNotMatch(page, /\bA \{KIND_LABEL/, 'a kind label is being spliced in after an article again');
});

test('a meeting service is named only on its exact host or a real subdomain', () => {
  // WAS `h.endsWith('meet.google.com')`, which is also true of
  // `evilmeet.google.com`. CodeQL called it incomplete URL substring
  // sanitization and was right: the word sits directly beside the link a
  // reader is about to click, which is the worst place to be approximately
  // correct. `us02web.zoom.us` is why the subdomain arm has to exist at all,
  // and the leading dot is the whole fix.
  const table = page.match(/const MEETING_HOSTS = \[([\s\S]*?)\n\];/)?.[1] || '';
  const hosts = [...table.matchAll(/\['([^']+)', '([^']+)'\]/g)].map((m) => m[1]);
  assert.deepEqual(hosts.sort(), ['meet.google.com', 'teams.microsoft.com', 'whereby.com', 'zoom.us'],
    'the meeting-host table changed without this guard');
  assert.match(page, /if \(h === host \|\| h\.endsWith\(`\.\$\{host\}`\)\) return word;/,
    'a meeting host is matched without an exact-or-dot-boundary test');
  // And no bare suffix test survives anywhere on the page: `.endsWith('x')`
  // against a hostname is the shape of the bug, whatever it is comparing.
  assert.doesNotMatch(page, /\bh\.endsWith\('/, 'a hostname is being matched by bare suffix again');
});

test('every value read out of the canvas is escaped before it becomes a pattern', () => {
  // `_escapeRe.mjs` exists for these sites and says why. One of them had also
  // grown `.replace(/[%]/g, '%')` — a replacement of a substring with itself,
  // which CodeQL flagged: `%` is not a regex metacharacter and never needed
  // escaping, while `{`, `(` and `$` do and a border-radius is one edit from
  // carrying one.
  const built = [...page.matchAll(/new RegExp\(`[^`]*`\)/g)].map((m) => m[0]);
  assert.ok(built.length === 0, 'the page itself should build no RegExp from interpolated values');
  const guard = raw('frontend/test/calendar_page_c1.test.mjs');
  for (const site of guard.match(/new RegExp\(`[^`]*\$\{[^`]*`\)/g) || []) {
    for (const interp of site.match(/\$\{([^}]*)\}/g) || []) {
      // A `.replace(...)` standing in for escapeRe fails here too, which is
      // what brings back the self-replacement CodeQL flagged. Asserting
      // against that literal directly cannot work: this file reads its own
      // source, so the assertion would match itself.
      assert.match(interp, /escapeRe\(/,
        `this pattern interpolates a raw value: ${site}`);
    }
  }
});

test('the page prints none of the canvas fixture', () => {
  assert.doesNotMatch(pageRaw, /Halyard Security|Meridian Robotics|Priya Nair|Perkins Coie|Thornbury Capital|Kelp Bio|LoopSense|Ashurst|Marcus Chen|Verity Health|7 – 13 Sep 2026|2 min ago|4 hrs ago/);
});
