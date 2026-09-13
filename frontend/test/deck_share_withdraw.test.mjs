/**
 * The control that ends a deck share link, and the four states it reads from.
 *
 * Task #196 gave `pitch_deck_share_tokens` a `revoked_at` column and the worker a
 * route that sets it. That half is tested next door
 * (`cloudflare-worker/test/deck_share_revoke.test.ts`). THIS half is the reason
 * the other half is worth having: a store and a route with nothing on screen
 * calling them is the same unreachable capability this repo has shipped three
 * times already — a registry kind with no propose route, a mode entry with no
 * switch, a switch with no band — and it is indistinguishable from the bug #196
 * describes, because in both cases the founder cannot stop the link.
 *
 * WHAT EACH ASSERTION HERE IS DEFENDING:
 *
 *   · THE CONTROL EXISTS AND IS CALLED. `api.deckRevokeShare` reaching no button
 *     leaves the panel exactly as it was: listing a link and its view count with
 *     no way to end it.
 *   · A WITHDRAWN LINK STAYS ON THE LIST. Filtering it out would take the
 *     impression history with it from the founder's point of view — the evidence
 *     they most want after discovering the link went somewhere it should not
 *     have — and would make the withdraw look like a delete, which is precisely
 *     what the migration refused to make it.
 *   · THE ROW THE FOUNDER IS LOOKING AT CHANGES. A toast over a row still reading
 *     "active" is the page contradicting itself about the one fact they came to
 *     check, so the reload is awaited rather than fired and forgotten.
 *   · THE FAILURE IS LOUD. They acted to stop something reaching someone; a
 *     swallowed error leaves them believing a live link is dead.
 *   · ONE RULE, BOTH PAGES. Raise · Pitch shows share state too and says on the
 *     page that it will not CHANGE it. Two pages computing state two ways is two
 *     answers with nothing to say which is current.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test \
 *     frontend/test/deck_share_withdraw.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeOnly } from './_codeOnly.mjs';

import { deckShareState, parseSqlUtc, toIsoUtc } from '../src/lib/deckShares.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(resolve(HERE, '..', p), 'utf8');

const PANEL = read('src/pages/PitchDeckPage.jsx');
const RAISE = read('src/pages/founder/FounderRaisePitch.jsx');
const API = read('src/lib/api.js');

const FUTURE = '2099-01-01 00:00:00';
const PAST = '2000-01-01 00:00:00';

// ------------------------------------------------------------------ the rule

test('the four states, and which one wins when several are true', () => {
  assert.equal(deckShareState({ expires_at: FUTURE }).key, 'live');
  assert.equal(deckShareState({ expires_at: FUTURE }).live, true);
  assert.equal(deckShareState({ expires_at: PAST }).key, 'expired');
  assert.equal(deckShareState({ expires_at: FUTURE, exhausted: true }).key, 'exhausted');
  assert.equal(deckShareState({ expires_at: FUTURE, revoked_at: '2026-09-01 00:00:00' }).key, 'revoked');

  // THE ORDER IS THE ASSERTION. Withdrawing sets `expires_at` too, so a revoked
  // link is ALWAYS also expired — and if `expired` won, every withdrawn link
  // would read "expired" and the founder would never learn that a person ended
  // it, which is the only thing `revoked_at` was added to say.
  const both = deckShareState({ expires_at: PAST, revoked_at: '2026-09-01 00:00:00', exhausted: true });
  assert.equal(both.key, 'revoked');
  assert.equal(both.label, 'withdrawn');
  assert.equal(both.live, false);

  // Only `live` is live. A state added later without a `live: false` would let
  // the Withdraw button appear on a dead link.
  for (const dead of [
    { expires_at: PAST },
    { expires_at: FUTURE, exhausted: true },
    { expires_at: FUTURE, revoked_at: '2026-09-01 00:00:00' },
  ]) assert.equal(deckShareState(dead).live, false);
});

/**
 * Run `fn` as if the browser were in `tz`.
 *
 * THIS IS NOT DECORATION, IT IS WHAT MAKES THE NEXT TEST ABLE TO FAIL. The first
 * version asserted `parseSqlUtc('2026-09-13 12:00:00') ===
 * Date.parse('2026-09-13T12:00:00Z')` and passed with the implementation replaced
 * by a bare `Date.parse(raw)` — because this container and CI both run
 * `Etc/UTC`, where local and UTC are the same instant and the assertion is a
 * tautology. The bug it is meant to catch can only exist somewhere else, so the
 * test has to go there.
 */
function withTz(tz, fn) {
  const prior = process.env.TZ;
  process.env.TZ = tz;
  try { return fn(); } finally {
    if (prior === undefined) delete process.env.TZ; else process.env.TZ = prior;
  }
}

test('an expiry with no timezone is read as UTC, not as local time', () => {
  // D1 stores `datetime('now')` — 'YYYY-MM-DD HH:MM:SS', no zone — and
  // `Date.parse` on that reads it as LOCAL. A founder five hours west of UTC
  // would see a link that expired five hours ago as still live, which is the
  // wrong direction to be wrong in.
  const UTC_NOON = Date.parse('2026-09-13T12:00:00Z');

  withTz('America/New_York', () => {
    // The self-check first: in this zone a naive parse of the same string lands
    // somewhere else. If this ever stops being true the assertion below has gone
    // back to proving nothing, and it should fail loudly rather than pass.
    assert.notEqual(Date.parse('2026-09-13 12:00:00'), UTC_NOON,
      'this timezone no longer distinguishes a local parse from a UTC one');
    assert.equal(parseSqlUtc('2026-09-13 12:00:00'), UTC_NOON,
      'a zoneless D1 timestamp is being read as local time');

    // And the state that depends on it: a link that expired one second ago is
    // expired, five timezones from the server that stamped it.
    assert.equal(deckShareState({ expires_at: '2026-09-13 12:00:00' }, UTC_NOON + 1000).key, 'expired');
    assert.equal(deckShareState({ expires_at: '2026-09-13 12:00:00' }, UTC_NOON - 1000).key, 'live');
  });

  // East of UTC as well, because the two zones fail in opposite directions and a
  // half-fix passes one of them.
  withTz('Asia/Tokyo', () => {
    assert.notEqual(Date.parse('2026-09-13 12:00:00'), UTC_NOON);
    assert.equal(parseSqlUtc('2026-09-13 12:00:00'), UTC_NOON);
    assert.equal(deckShareState({ expires_at: '2026-09-13 12:00:00' }, UTC_NOON + 1000).key, 'expired');
  });

  // An already-zoned value is not double-stamped.
  assert.equal(parseSqlUtc('2026-09-13T12:00:00Z'), UTC_NOON);
  assert.ok(Number.isNaN(parseSqlUtc('')));
  assert.ok(Number.isNaN(parseSqlUtc(null)));

  // THE SEPARATOR IS CHECKED ON THE STRING, not through Date.parse. V8 accepts
  // '2026-09-13 12:00:00Z' via its legacy fallback and reads it as UTC, so every
  // parse-based assertion above passes with the space left in — and Node has only
  // V8, so nothing here can speak for the Safari a founder may be using. What is
  // actually required is the ISO-8601 grammar, and that is a property of the
  // value: exactly one 'T', a trailing 'Z', and no space left behind.
  assert.equal(toIsoUtc('2026-09-13 12:00:00'), '2026-09-13T12:00:00Z');
  assert.equal(toIsoUtc('2026-09-13T12:00:00Z'), '2026-09-13T12:00:00Z');
  assert.equal(toIsoUtc('  2026-09-13 12:00:00  '), '2026-09-13T12:00:00Z');
  assert.equal(toIsoUtc(''), '');
  assert.equal(toIsoUtc(null), '');
  assert.equal(toIsoUtc(undefined), '');
  for (const input of ['2026-09-13 12:00:00', '2026-09-13T12:00:00', '2026-09-13T12:00:00Z']) {
    const iso = toIsoUtc(input);
    assert.doesNotMatch(iso, / /, `${input} normalised to a value with a space in it`);
    assert.match(iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
      `${input} did not normalise to a strict ISO-8601 instant`);
  }

  // The boundary is exact, and decided against an injected clock rather than the
  // real one — otherwise the case cannot be asserted at all.
  assert.equal(deckShareState({ expires_at: '2026-09-13 12:00:00' }, UTC_NOON - 1).key, 'live');
  assert.equal(deckShareState({ expires_at: '2026-09-13 12:00:00' }, UTC_NOON).key, 'expired');
});

test('an expiry the server never sent does not make a link dead', () => {
  // `exhausted` and `revoked_at` are definite; a MISSING `expires_at` is not
  // evidence of anything. Treating an absent value as an expiry in the past would
  // report every link dead the first time the route dropped the field — and the
  // founder would stop trusting the panel rather than suspect the payload.
  assert.equal(deckShareState({}).key, 'live');
  assert.equal(deckShareState({ expires_at: null }).key, 'live');
  assert.equal(deckShareState({ expires_at: 'not a date' }).key, 'live');
});

// ----------------------------------------------------------------- the panel

test('the Engagement panel can withdraw a link, and only a live one', () => {
  const src = codeOnly(PANEL);
  assert.match(API, /deckRevokeShare: \(id, shareId\) =>/,
    'the client has no method for the withdraw route');
  assert.match(API, /request\(`\/decks\/\$\{id\}\/shares\/\$\{shareId\}`, \{ method: 'DELETE' \}\)/);

  // THE BUTTON IS MOUNTED AND WIRED. A handler nothing calls is the same as no
  // handler, which is the state this task found the feature in.
  assert.match(src, /const onRevokeShare = async \(shareId\) => \{/);
  assert.match(src, /await api\.deckRevokeShare\(deck\.id, shareId\)/);
  assert.match(src, /<EngagementPanel data=\{engagement\} onRevoke=\{onRevokeShare\} revoking=\{revoking\} \/>/,
    'the panel is not given the withdraw handler');
  assert.match(src, /onClick=\{\(\) => onRevoke\(s\.id\)\}/, 'no control calls the handler');

  // OFFERED ONLY ON A LINK THAT STILL OPENS. On a dead one it would change
  // nothing the founder can see, which is how a control teaches people not to
  // trust it.
  assert.match(src, /\{st\.live && typeof onRevoke === 'function' && \(/,
    'Withdraw is offered on links that are already dead');
  assert.match(src, /const st = deckShareState\(s\);/,
    'the panel computes share state itself rather than using the one rule');
});

test('a withdrawn link is still listed, marked, and never hidden', () => {
  const src = codeOnly(PANEL);
  // No filter drops a row by state. `slice` is the existing length cap and is
  // state-blind, which is what it should be.
  assert.match(src, /\{shares\.slice\(0, 5\)\.map\(\(s\) => \{/);
  assert.doesNotMatch(src, /shares\.filter\(/,
    'the panel filters its share list — a withdrawn link must stay visible');
  // Every state has a colour, so none renders as unstyled text.
  for (const key of ['revoked', 'exhausted', 'expired', 'live']) {
    assert.match(src, new RegExp(`  ${key}: 'text-`), `${key} has no tone`);
  }
  assert.match(src, /<span className=\{SHARE_TONE\[st\.key\]\}>\{st\.label\}<\/span>/);
  // The old two-state render is gone. It called an EXPIRED link active, and after
  // #196 it would have called a WITHDRAWN one active too.
  assert.doesNotMatch(src, /s\.exhausted \? 'gone' : 'active'/,
    'the panel is back to two states and will call a withdrawn link active');
});

test('the row changes before the founder is told it did', () => {
  const src = codeOnly(PANEL);
  const at = src.indexOf('const onRevokeShare = async (shareId) => {');
  assert.ok(at > 0, 'the withdraw handler is gone');
  const fn = src.slice(at, src.indexOf('\n  };', at));

  // AWAITED, not fired and forgotten. `onShare` next door does
  // `api.deckEngagement(...).then(setEngagement)` because a new row appearing
  // late is harmless; a row that still says "active" after a withdraw is not.
  const reload = fn.indexOf('const fresh = await api.deckEngagement(deck.id)');
  const toast = fn.indexOf("addToast('Share link withdrawn.");
  assert.ok(reload > 0, 'the withdraw does not reload the panel');
  assert.ok(toast > reload, 'the panel is told the link is withdrawn before the row is refreshed');
  assert.match(fn, /if \(fresh\) setEngagement\(fresh\)/,
    'a failed reload blanks the panel the founder was just reading');

  // THE FAILURE IS LOUD AND REPORTED. They acted to stop something reaching
  // someone; silence here reads as success.
  assert.match(fn, /setError\(e\.message \|\| 'Could not withdraw that share link/,
    'a failed withdraw is swallowed');
  assert.match(fn, /reportError\('PitchDeckPage:revokeShare', e\)/);
  // And the button is disabled only while ITS OWN row is in flight.
  assert.match(src, /disabled=\{revoking === s\.id\}/);
  assert.match(fn, /finally \{ setRevoking\(null\); \}/,
    'a failed withdraw leaves the button spinning forever');
});

// ------------------------------------------------------- the read-only page

test('Raise · Pitch reads share state from fields the API actually returns', () => {
  // `row.status` HAS NEVER EXISTED on a deck share row: the engagement route
  // returns `revoked_at`, `exhausted`, `expires_at`, `view_count`, `view_limit`
  // and `last_viewed_at`. The cell therefore read "Share record" for every row
  // and the stat under "Share links" counted 0 expiring forever — and after #196
  // a withdrawn link would have been indistinguishable here from a live one.
  const src = codeOnly(RAISE);
  assert.match(src, /import \{ deckShareState \} from '\.\.\/\.\.\/lib\/deckShares'/,
    'the read-only page has its own idea of what a share link’s state is');
  assert.match(src, /const states = rawRows\.map\(\(row\) => deckShareState\(row\)\);/);
  assert.match(src, /source: text\(row\.status, states\[index\]\.label\),/,
    'the state cell falls back to nothing when `status` is absent, which is always');
  assert.doesNotMatch(src, /includes\('expir'\)/,
    'the page still counts links by searching a `status` string that is never sent');
  assert.match(src, /const deadCount = states\.filter\(\(s\) => !s\.live\)\.length;/);
  assert.match(RAISE, /\$\{analytics\.deadCount\} no longer open/,
    'the share-link stat no longer says how many links are dead');

  // The dropped `last_viewed_at` is read now too — the route sends it and the
  // column said "Activity not recorded" over it.
  assert.match(src, /row\.updated_at \|\| row\.last_viewed_at \?/,
    'the last-activity column ignores the timestamp the route actually sends');

  // AND THE PAGE STILL DOES NOT ACT. Its own note promises this, and the promise
  // is only worth keeping while it is true — the withdraw lives one click away in
  // the editor the page already links to.
  assert.match(RAISE, /never mints, revokes, or edits a share link/);
  assert.doesNotMatch(src, /deckRevokeShare/,
    'the read-only collection view now revokes, contradicting its own note');
});
