/**
 * Deals · Commit governance — D461. Conditions, minutes and recusal, wired.
 *
 * The ID3 artboard draws three records the commit room did not hold, and the
 * zone now builds all three over migration 334 and the widened vote
 * vocabulary. This file pins the WIRING rather than the copy: which api.js
 * method each control calls, on which record, and who is offered which
 * control. The worker half of every one of these is pinned in
 * `cloudflare-worker/test/ic_conditions_minutes.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const ZONE = codeOnly(read('frontend/src/pages/investor/deals/CommitZone.jsx'));
const CLOSING = codeOnly(read('frontend/src/pages/investor/deals/ClosingZone.jsx'));
const API = read('frontend/src/lib/api.js');

test('Add condition posts to the current decision, and only when there is one', () => {
  assert.match(ZONE, /api\.icAddCondition\(current\.uid, \{ body \}\)/,
    'the form must attach the condition to the decision the first chip shows');
  assert.match(API, /icAddCondition: \(uid, body\) => request\(`\/ic\/\$\{uid\}\/conditions`/,
    'api.js lost the conditions write');
  // No decision open → the op is disabled with the reason, not clickable.
  assert.match(ZONE, /disabled: true, title: 'No decision is open, so there is nothing to attach a condition to\.'/,
    'the op must say why it is disabled when no decision is open');
  // An empty condition is refused on the page before the route is asked.
  assert.match(ZONE, /if \(!body\)/, 'an empty condition body must not reach the route');
});

test('resolving a condition is offered only to the decision’s author or an admin', () => {
  assert.match(ZONE, /api\.icResolveCondition\(cond\.uid, status\)/, 'the resolve call is gone');
  assert.match(API, /icResolveCondition: \(uid, status\) => request\(`\/ic\/conditions\/\$\{uid\}`/,
    'api.js lost the resolve write');
  // The page decides before the click — the route's 403 is not the explanation.
  assert.match(ZONE, /Number\(dec\.created_by\) === Number\(user\?\.id\) \|\| user\?\.role === 'admin'/,
    'the resolve control must be gated on the decision’s author or an admin');
  // And only an OPEN condition offers one: met and waived are recorded states.
  assert.match(ZONE, /cond\.status === 'open' && mayResolve\(cond\)/,
    'a resolved condition still offers the control');
});

test('the minutes view records through the meeting and exports what was recorded', () => {
  assert.match(ZONE, /api\.icRecordMinutes\(minutesBlock\.meeting_uid, minutesForm\.text\)/,
    'the minutes form must write to the linked meeting');
  assert.match(API, /icRecordMinutes: \(uid, minutes\) => request\(`\/ic\/meetings\/\$\{uid\}\/minutes`/,
    'api.js lost the minutes write');
  // The form is the organiser's (or an admin's): the route refuses anyone
  // else, so the page must not offer it to them.
  assert.match(ZONE, /minutesBlock\.may_record &&/, 'the record form is offered to a reader the route refuses');
  // The export is disabled with the reason when there is nothing to export.
  assert.match(ZONE, /disabled: true, title: 'No minutes are recorded for the linked meeting yet\.'/,
    'the export must say why it is disabled when no minutes are recorded');
});

test('the Closing zone’s Blocking view lists the open conditions on deals at closing', () => {
  assert.match(CLOSING, /api\.icConditions\('open'\)/, 'the zone never reads the open conditions');
  assert.match(API, /icConditions: \(status\) => request\(`\/ic\/conditions\$\{status/,
    'api.js lost the conditions read');
  // The rows narrow to the deals at closing — a condition on a pipeline deal
  // is the commit room's to show, not this stage's.
  assert.match(CLOSING, /conditions\.filter\(\(cond\) => cond\.deal_id != null && ids\.has\(cond\.deal_id\)\)/,
    'the blocking rows must narrow to deals at closing');
  // A failed conditions read is unreadable with a retry, never an empty
  // "nothing is blocking".
  assert.match(CLOSING, /The conditions record could not be read\. That is not a claim that nothing is blocking\./,
    'a failed conditions read must not render as nothing blocking');
});
