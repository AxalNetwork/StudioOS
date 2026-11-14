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
 *   · ONE PAGE, THE SERVER'S THREE FACTS. The Pitch deck studio's Share &
 *     analytics tab (D894) is the one place a link is withdrawn. It calls a link
 *     live on the three facts the claim query refuses on: not withdrawn, not
 *     expired (the module record's expiry cell) and not used up (the engagement
 *     read's `exhausted`, which the records do not carry). D898 group E (#2676)
 *     retired the template builder, whose Engagement panel was the second page,
 *     and with it `lib/deckShares.js`, which only that panel read.
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

import { linkRows } from '../src/pages/raise/pitch/pitchStudioModel.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(resolve(HERE, '..', p), 'utf8');

const STUDIO = read('src/pages/raise/pitch/PitchStudio.jsx');
const STUDIO_MODEL = read('src/pages/raise/pitch/pitchStudioModel.js');

const FUTURE = '2099-01-01 00:00:00';

// ------------------------------------------------------- the studio (D894)

test('Pitch deck studio · Share & analytics withdraws through the link record, after a dialog, and never a dead link', () => {
  // The read-only Pitch page this replaced promised it "never mints, revokes, or
  // edits a share link". The studio's Share & analytics tab (PD19) draws Withdraw
  // on each live link, so the promise is now about HOW it withdraws: through the
  // link record's own `revoke` action (D696), which keeps the views and logs
  // `deck_link_revoked`, after a dialog that says what changes.
  const src = codeOnly(STUDIO);
  assert.match(src, /cyclesApi\.recordAction\('raise', reads\.project\.id, 'pitch-deck', withdraw\.id, 'revoke'\)/);
  // D1111: the records say used up for every version's links, so a link is
  // live or dead, never unknown; Withdraw is drawn on each live one.
  assert.match(src, /!readOnly && l\.live \? <button/, 'Withdraw is drawn on every live link, and never for a reader');
  assert.match(src, /title="Withdraw this link\?"/);
  assert.match(STUDIO, /link stops opening at once\. Its views stay listed\./);
  assert.doesNotMatch(src, /deckRevokeShare/, 'a second way to end a link is back');
  // A withdrawn, expired or used-up link stays listed, marked.
  assert.doesNotMatch(codeOnly(STUDIO_MODEL), /rows\.filter\(/, 'a link is filtered out of the list');
});

test('the studio calls a used-up link dead, though the record still says active', () => {
  // A one-view link (`view_limit: 1`), opened once, its 24
  // hours not up: the claim refuses it (`view_count < view_limit`), the
  // engagement read says `exhausted`, and the module record still says active.
  const usedUp = { id: 14, expires_at: FUTURE, view_limit: 1, view_count: 1, exhausted: true, revoked_at: null };
  const record = { rows: [{ id: 14, cells: { link: '[Fund B]', expires: { text: '2099-01-01', tone: 'ok' }, views: 1 } }] };
  const [row] = linkRows(record, { shares: [usedUp] });
  assert.equal(row.live, false, 'the studio calls a used-up link live');
  assert.equal(row.expires, 'Used up');
  // The same link with a view left is live.
  const fresh = { ...usedUp, view_count: 0, exhausted: false };
  assert.equal(linkRows(record, { shares: [fresh] })[0].live, true);
  // A link the records say is withdrawn or expired is dead whatever the shares say.
  assert.equal(linkRows({ rows: [{ id: 14, cells: { expires: { text: 'Revoked', tone: 'muted' }, views: 1 } }] }, { shares: [fresh] })[0].live, false);
});
