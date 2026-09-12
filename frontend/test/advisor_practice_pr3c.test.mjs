/**
 * PR3c — the client's half of the open receipt, and the link that made it
 * reachable.
 *
 * WHAT THIS FILE IS FOR. `cloudflare-worker/test/advisor_deliverables_received.test.ts`
 * drives both routes against real SQLite; what it cannot see is the front end.
 * Three things would break the receipt from the browser alone, and each looks
 * fine in a screenshot:
 *
 *   * AN ADVISOR-SIDE OPEN IN `api.js`. The store has exactly one writer of
 *     `opened_at` and it is the founder's route. A second method here, or a call
 *     to one from an advisor page, would put the practice back in charge of a
 *     metric about itself — and no worker test would notice.
 *   * A LINK CONTROL THAT TYPES AN ID. The worker now requires a relationship, so
 *     a free-text field would refuse most of what a reader put in it. The control
 *     must offer the accounts the API will accept, which is what
 *     `DocumentShares` established.
 *   * A SECOND FORMATTER FOR AN INSTANT. `sent_at` and `opened_at` are instants;
 *     the founder's card must read them through the same `shortMoment` the
 *     advisor's page uses, not a local copy that could drift a day.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const API = read('frontend/src/lib/api.js');
const GRANT = read('frontend/src/pages/raise/AdvisorGrantSection.jsx');
const G = codeOnly(GRANT);
const ENGAGEMENTS = read('frontend/src/pages/advisor/practice/EngagementsZone.jsx');
const E = codeOnly(ENGAGEMENTS);
const DELIVERY = codeOnly(read('frontend/src/pages/advisor/practice/DeliveryZone.jsx'));
const WORKER = read('cloudflare-worker/src/routes/advisors.ts');

// ---------------------------------------------------------------------------
// One writer, and it is the client's
// ---------------------------------------------------------------------------
test('the client library has exactly one open-receipt writer, and no advisor page calls it', () => {
  // The method exists — without it the founder cannot record anything and the
  // advisor's three receipt tiles are decoration.
  assert.match(API, /openReceivedDeliverableVersion: \(uid\) =>/);
  assert.match(API, /\/advisors\/received\/deliverables\/\$\{encodeURIComponent\(uid\)\}\/open/);

  // And it is the ONLY one. Searching method NAMES rather than prose keeps the
  // docblocks that explain the rule from failing the rule — the self-matching
  // trap this repo keeps re-finding.
  const methods = [...API.matchAll(/^\s{2}(\w+):\s*\(/gm)].map((m) => m[1]);
  const openers = methods.filter((n) => /open/i.test(n) && /deliverable/i.test(n));
  assert.deepEqual(openers, ['openReceivedDeliverableVersion'],
    `exactly one opener, found: ${openers.join(', ')}`);

  // THE ADVISOR'S OWN PAGES MAY NOT CALL IT. This is the browser half of the
  // invariant the worker test asserts against SQL.
  for (const [name, src] of [['DeliveryZone', DELIVERY], ['EngagementsZone', E]]) {
    assert.ok(!/api\.openReceivedDeliverableVersion/.test(src),
      `${name} calls the client's open route`);
    for (const call of [...src.matchAll(/api\.(\w+)/g)].map((m) => m[1])) {
      assert.ok(!/open/i.test(call), `${name} calls api.${call}, which looks like an open write`);
    }
  }
});

test('the founder card writes the receipt and the advisor is never offered one', () => {
  assert.match(G, /api\.listReceivedDeliverables\(\)/);
  assert.match(G, /api\.openReceivedDeliverableVersion\(uid\)/);
  // FIRST OPEN WINS SHOWS UP AS A DISAPPEARING BUTTON, not a counter: an opened
  // version renders its day, an unopened one renders the control.
  assert.match(G, /v\.opened_at \?/);
  assert.match(GRANT, /Mark open/);
  assert.match(GRANT, /first time you opened it/i);
});

// ---------------------------------------------------------------------------
// The link
// ---------------------------------------------------------------------------
test('the worker requires a relationship, not just an account', () => {
  // DERIVED FROM THE WORKER, so a loosened resolver fails here too. Both facts
  // must appear in the resolver's own query.
  const at = WORKER.indexOf('async function engagementClientUser');
  assert.ok(at > 0, 'the resolver must still exist');
  const fn = WORKER.slice(at, WORKER.indexOf('\n}', at));
  assert.match(fn, /FROM advisor_bookings b/);
  assert.match(fn, /FROM advisor_client_grants g/);
  assert.match(fn, /g\.status = 'active'/);
  // It resolves to null rather than throwing, so an unrelated account leaves the
  // card's client NAME in place instead of failing the write.
  assert.match(fn, /return u \? Number\(u\.id\) : null;/);
});

test('the link control offers accounts the API will accept, and never a typed id', () => {
  // The candidates come from this advisor's own bookings — the relationship the
  // worker checks — and they are a tolerated second source, so an advisor whose
  // bookings will not load still has a contract board.
  assert.match(E, /api\.listMyAdvisorBookings\(\)\.catch\(\(\) => null\)/);
  assert.match(E, /b\.client_user_id/);
  // A SELECT, not an input: the set is closed.
  assert.match(E, /data-testid=\{`link-pr2-\$\{e\.id\}`\}/);
  assert.match(E, /<select id=\{`link-pr2-\$\{e\.id\}`\}/);
  const block = ENGAGEMENTS.slice(ENGAGEMENTS.indexOf('Client account'), ENGAGEMENTS.indexOf('Client account') + 1400);
  assert.ok(!/type="text"/.test(block) && !/type="number"/.test(block),
    'a typed id would be refused by the worker for almost every value');
  // It PATCHes the engagement, and null clears it.
  assert.match(E, /founder_user_id: value === '' \? null : Number\(value\)/);
});

test('the card says what the link buys, and stays honest when there is nobody to link', () => {
  // BOTH STATES ARE ASSERTED SEPARATELY, and mutation-checking is why. An
  // alternation over the two lines passed when one of them was gutted, because
  // the other still matched — an assertion that cannot tell which string is
  // present is not holding either of them.
  assert.match(ENGAGEMENTS, /Linked\. Work products can be sent to them, and they can record having opened one\./,
    'the linked card must say what the link bought');
  assert.match(ENGAGEMENTS, /Only a linked client can be sent a work product, or record that they opened one\./,
    'the unlinked card must say what the link would buy');
  // The empty case is a fact about the reader's own book, not a broken control.
  assert.match(ENGAGEMENTS, /Nobody has booked you yet/);
  // And the contract works either way — 238 keeps the client a name on purpose.
  assert.match(ENGAGEMENTS, /The contract works either way/);
  assert.match(ENGAGEMENTS, /Not linked — a name only/);
});

// ---------------------------------------------------------------------------
// The seam between the two sides
// ---------------------------------------------------------------------------
test('one definition of a local day, shared rather than copied', () => {
  assert.match(G, /import \{ shortMoment \} from '\.\.\/advisor\/practice\/deliveryTrail'/);
  // No second formatter on the founder's card.
  assert.ok(!/toLocaleDateString/.test(G),
    'the card must read an instant through the shared formatter, not its own');
});

test('a draft is neither listed nor openable, and the card says why', () => {
  // The worker filters on `sent_at IS NOT NULL` in both routes; the card explains
  // the consequence rather than leaving a founder wondering where something is.
  // CODE ONLY. The open route's docblock explains the filter in prose, so a raw
  // count over the file finds four — the self-matching trap, one more time.
  const code = codeOnly(WORKER);
  const routes = code.slice(code.indexOf("advisors.get('/received/deliverables'"));
  assert.equal((routes.match(/sent_at IS NOT NULL/g) || []).length, 3,
    'the read filters twice (row and version) and the open once');
  assert.match(GRANT, /work in progress until they hand it over/);
});

test('the founder card states the two things it is not', () => {
  // NOT GRANT-GATED — everything above it in that section is project-scoped and
  // this list is keyed on the reader's own account through the engagement.
  assert.match(GRANT, /not from the grants above/);
  // AND SIGN-OFF IS NOT RECORDED. 239 carries the column and nothing writes it;
  // saying so is the difference between a stated gap and a silent one.
  assert.match(GRANT, /Signing a work product off is not recorded/);
  const signOff = [...WORKER.matchAll(/UPDATE\s+advisor_deliverable_versions\s+SET\s+([^`]*?)WHERE/gs)];
  for (const [, setClause] of signOff) {
    assert.ok(!/signed_off_at/.test(setClause), 'nothing may write signed_off_at yet');
  }
});

test('the receipt route is mounted where a founder can reach it, with no advisor gate', () => {
  const at = WORKER.indexOf("advisors.post('/received/deliverables/:uid/open'");
  assert.ok(at > 0);
  const handler = WORKER.slice(at, WORKER.indexOf('});', at));
  assert.match(handler, /await requireAuth\(c\)/);
  // `requireMyAdvisor` here would lock the client out of their own receipt, which
  // is the one mistake that would make this whole PR a no-op.
  assert.ok(!/requireMyAdvisor/.test(handler),
    'the client is not an advisor; gating on an advisor profile would refuse every founder');
  assert.match(handler, /WHERE id = \? AND opened_at IS NULL/);
});
