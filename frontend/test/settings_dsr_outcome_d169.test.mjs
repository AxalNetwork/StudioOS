/**
 * D169 — the subject was told the outcome by a feed and by nothing else.
 *
 * THE DEFECT. `users.deletion_requested_at` is the OPEN flag; D168's close
 * clears it. So the moment HQ decided, the amber "Deletion requested <date>"
 * line on Settings simply DISAPPEARED — the subject asked, waited out a GDPR
 * Art. 12(3) clock, and the screen returned to as if they never asked. The
 * close does write them an `activity_logs` row, so the outcome reached the
 * Cmd+K recent feed, twenty rows deep, on a surface nobody opens for this.
 *
 * TWO FINDINGS THE BUILD CORRECTED, both recorded rather than quietly done.
 *
 * 1. THE "DUPLICATE" BLOCK WAS NOT ONE BLOCK RENDERED TWICE — one of the two
 *    NEVER RENDERED. `AccountDeletionCard` (Account tab) is live;
 *    `PrivacySection`'s `{!hideAccountDelete && …}` copy was structurally dead,
 *    because its one and only call site always passed `hideAccountDelete`.
 *    Both were born in the same commit, `02c6a12b1`, when the tabbed Settings
 *    split created the new card and SUPPRESSED the old copy instead of
 *    deleting it. The plan said to collapse the live one INTO the first, which
 *    would have deleted the working control and hidden this notice where
 *    nobody could see it. Measured, then reversed.
 *
 * 2. THE AMBER LINE HAS BEEN MIS-PARSING ITS OWN STAMP SINCE IT SHIPPED.
 *    `deletion_requested_at` is written `datetime('now')` — SQL
 *    `YYYY-MM-DD HH:MM:SS` — and a bare `new Date()` on that reads as the
 *    READER'S LOCAL time in V8 and NaN elsewhere. Pre-existing, in the exact
 *    line this change edits, and identical to the bug this notice would have
 *    shipped with; both go through `toUtcInstant` now.
 *
 * WHY THIS RENDERS RATHER THAN SCANS. A source scan can show the word
 * "declined" is present. It cannot show that a WITHDRAWN row is credited to
 * the subject rather than to HQ, that the reason HQ typed survives to the
 * screen verbatim, or that an unreadable ledger renders its own reason instead
 * of nothing — and rendering nothing is precisely the defect being closed. So
 * the component is its own module and is rendered for real. The structural
 * half below stays a scan, bounded at both ends.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import DsrOutcomeNotice from '../src/components/DsrOutcomeNotice.jsx';

const at = (p) => resolve(process.cwd(), p);
const raw = (p) => readFileSync(at(p), 'utf8');

const PAGE = raw('frontend/src/pages/SettingsPage.jsx');
const PAGE_CODE = codeOnly(PAGE);
const API = codeOnly(raw('frontend/src/lib/api.js'));

const render = (outcome) => renderToStaticMarkup(React.createElement(DsrOutcomeNotice, { outcome }));
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ').trim();

/** `AccountDeletionCard`'s own JSX, bounded at both ends. */
function cardSource() {
  const start = PAGE_CODE.indexOf('function AccountDeletionCard(');
  assert.ok(start > 0, 'AccountDeletionCard is gone');
  const rest = PAGE_CODE.slice(start + 1);
  const ends = [rest.indexOf('\nfunction '), rest.indexOf('\nconst '), rest.indexOf('\nexport ')].filter((i) => i >= 0);
  assert.ok(ends.length > 0, 'the card has no end — the bound would run to EOF');
  return rest.slice(0, Math.min(...ends));
}

// ---------------------------------------------------------------- rendered

test('a subject with no decision behind them is shown nothing — and neither is one who never asked', () => {
  assert.equal(render(undefined), '', 'no payload yet must render nothing, not a skeleton claim');
  assert.equal(render({ available: true, last_closed: null }), '',
    'a readable ledger with no closed row is a genuine absence');
});

test('a DENIAL reaches the subject, with the reason HQ typed, verbatim', () => {
  const out = text(render({
    available: true,
    last_closed: {
      outcome: 'denied',
      closed_at: '2026-09-19 16:23:16',
      close_reason: 'Retention obligation under the partnership agreement until 2027.',
    },
  }));
  assert.match(out, /declined your erasure request/i, 'a denial must say it was declined');
  assert.match(out, /Axal VC HQ/, 'and say who decided');
  assert.match(out, /Retention obligation under the partnership agreement until 2027\./,
    'the reason is shown VERBATIM — it is written to be read by a regulator, and the '
    + 'subject is the person it is about');
});

test('a SQL stamp is read as UTC — asserted on the INSTANT, which is the only half that can fail', () => {
  // The D136 lesson, one surface over: `YYYY-MM-DD HH:MM:SS` is not in the
  // `Date` grammar, so a bare `new Date()` reads it as the READER'S LOCAL time
  // in V8 and returns NaN elsewhere.
  //
  // MY FIRST DRAFT OF THIS ASSERTION COULD NOT FAIL, and that is worth the
  // words: it checked the rendered date was not "Invalid Date", which V8
  // satisfies WITHOUT the fix because it parses the stamp happily — just in
  // the wrong zone. And comparing formatted dates is no better, since on a UTC
  // runner the right and wrong readings format identically. So the component
  // emits the normalised instant as `<time dateTime>`, and that is what is
  // pinned: it differs under every timezone, this runner's included.
  const html = render({
    available: true,
    last_closed: { outcome: 'denied', closed_at: '2026-09-20 02:00:00', close_reason: null },
  });
  assert.match(html, /dateTime="2026-09-20T02:00:00Z"/,
    'the stamp must be normalised to UTC before it is read');
  assert.ok(!/dateTime="2026-09-20 02:00:00"/.test(html),
    'the raw SQL shape must never reach `new Date` — that is the bug');
  assert.ok(!/Invalid Date/.test(text(html)), 'and it must still parse');
});

test('a FULFILMENT says the erasure was carried out — and does not claim the platform did it', () => {
  const out = text(render({
    available: true,
    last_closed: { outcome: 'fulfilled', closed_at: '2026-09-19 16:23:16', close_reason: 'Erasure carried out manually.' },
  }));
  assert.match(out, /carried out/i);
  assert.match(out, /Axal VC HQ recorded/, 'HQ RECORDED it — this platform performs no erasure (D168)');
});

test("a WITHDRAWAL is credited to the subject, never to HQ, and invents no reason", () => {
  const out = text(render({
    available: true,
    last_closed: { outcome: 'withdrawn', closed_at: '2026-09-19 16:23:16', close_reason: null },
  }));
  assert.match(out, /You cancelled your deletion request/i);
  assert.ok(!/Axal VC HQ/.test(out),
    'HQ cannot write `withdrawn` — crediting it would say the subject changed their mind when they did not');
  assert.ok(!/Reason given/.test(out), 'a withdrawal carries no HQ reason, so none may be shown');
});

test('an UNREADABLE ledger renders its own reason — it never renders as silence', () => {
  // #204. Rendering nothing here would reproduce the exact defect D169 closes,
  // on the exact screen, for the subject whose request WAS decided.
  const reason = 'The record of any earlier deletion request could not be read just now.';
  const html = render({ available: false, reason });
  assert.notEqual(html, '', 'an unreadable store must say so rather than vanish');
  assert.match(text(html), /could not be read/);
  assert.ok(!/declined|carried out|You cancelled/i.test(text(html)),
    'and it must not guess at an outcome it could not read');
});

// -------------------------------------------------------------- structural

test('the notice is mounted, and ONLY while no request is open', () => {
  const card = cardSource();
  assert.match(card, /<DsrOutcomeNotice\s+outcome=\{data\.dsr_outcome\}/,
    'the card must render the notice from the settings payload');
  assert.match(card, /!data\.deletion_requested_at\s*&&\s*<DsrOutcomeNotice/,
    'an OPEN request owns the amber line; showing a previous outcome beside it would put a '
    + 'stale denial next to a live re-ask, which is reachable — asking again after a refusal '
    + 'opens a new row and leaves the old outcome in place');
});

test('there is exactly ONE deletion control left, and the dead branch is gone', () => {
  assert.equal(PAGE_CODE.split('hideAccountDelete').length - 1, 0,
    'the suppression flag and the branch it hid are both gone');
  assert.equal(PAGE_CODE.split('Deletion requested').length - 1, 1,
    'one render site for the open state — a second copy is a second thing that can drift, '
    + 'and the one that was there never rendered at all');
  assert.equal(PAGE_CODE.split('api.cancelAccountDeletion').length - 1, 1,
    'and one handler set behind it');
});

test('the amber line stops mis-parsing its own stamp', () => {
  assert.ok(!/new Date\(data\.deletion_requested_at\)/.test(PAGE_CODE),
    'a bare `new Date()` on a SQL stamp reads as the reader’s LOCAL time in V8 and NaN elsewhere');
  assert.match(PAGE_CODE, /new Date\(toUtcInstant\(data\.deletion_requested_at\)\)/,
    'it goes through the one shared normaliser, not a sixth local copy of the fix');
});

test('no new /api/* method is owed — the outcome rides the settings payload', () => {
  assert.ok(!/dsrOutcome|dsr_outcome|myDsrOutcome/.test(API),
    'a second fetch for a field the settings GET already carries would be a second round trip '
    + 'and a new entry for the drift gate to police');
});
