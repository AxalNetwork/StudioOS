/**
 * The Grow zone's refusals are checked against the store, not against a belief.
 *
 * FOUR OF GROW'S FOURTEEN WERE FALSE, and each was false in a different way —
 * which is why this file asserts the evidence rather than the wording:
 *
 *   · `grow/talent` → `Post a role` — "no role posting is stored". `job_postings`
 *     IS the store, it carries the very `project_id` this desk's role chips filter
 *     on, `jobs.create()` writes one, and `/jobs/new` is a mounted founder route.
 *   · `grow/talent` → `Bulk reject` — "no candidate records exist to act on".
 *     `job_applications` exists and this page already tabulates it. The real gap
 *     is narrower: no endpoint sets an application's status.
 *   · `grow/customers` → `Stalled` — "no activity timeline is stored".
 *     `waitlist_signups` carries four activity stamps and `WAITLIST_SELECT`
 *     returns every one.
 *   · `grow/capital-match` → `Warm path only` — "nothing joins a prospect to a
 *     relationship in the network book". Migration 128 adds
 *     `raise_prospects.contact_id` and indexes it.
 *
 * TEN WERE TRUE and are left alone. Two of those ten are dynamic-group reasons
 * used exactly as intended — the page supplies names when it has them, and the
 * reason covers the empty case — which is the distinction this file has to keep
 * straight, because getting it wrong in the other direction would delete a
 * correct refusal.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/grow_zone_contract.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const read = (p) => codeOnly(raw(p));

const FILTERS = raw('frontend/src/workspaces/founderZoneFilters.js');
const ACTIONS = raw('frontend/src/workspaces/founderZoneActions.js');
const TALENT = read('frontend/src/pages/founder/FounderGrowTalent.jsx');
const CUSTOMERS = read('frontend/src/pages/founder/FounderGrowCustomers.jsx');
const CAPITAL = read('frontend/src/pages/founder/FounderGrowCapitalMatch.jsx');
const APP = raw('frontend/src/App.jsx');
const API = raw('frontend/src/lib/api.js');
const PROGRESS = raw('cloudflare-worker/src/routes/progress.ts');
const JOBS_ROUTE = raw('cloudflare-worker/src/routes/jobs.ts');

function zoneBlock(src, zone) {
  const at = src.indexOf(`'${zone}'`);
  assert.ok(at > 0, `${zone} left the table`);
  return codeOnly(src.slice(at, src.indexOf('\n  ],', at)));
}

test('Post a role links to the editor the job board already has', () => {
  const block = zoneBlock(ACTIONS, 'grow/talent');
  assert.match(block, /label: 'Post a role', to: '\/jobs\/new'/);
  // SCOPED TO THE ONE ENTRY, and the first version was not: a lazy `[\s\S]{0,200}`
  // after the label ran straight into `Bulk reject`'s `unbuilt:` and failed a
  // correct file. An entry ends at its own `},`.
  const entry = block.slice(block.indexOf("label: 'Post a role'"));
  assert.ok(!entry.slice(0, entry.indexOf('},')).includes('unbuilt:'), 'Post a role is a refusal again');
  // The three facts that made the refusal false, each checked at its source.
  assert.match(API, /create: \(payload\) => request\('\/jobs'/, 'jobs.create() is gone');
  assert.match(APP, /path="\/jobs\/new"/, 'the job editor route is gone');
  assert.match(JOBS_ROUTE, /INSERT INTO job_postings/, 'nothing writes a posting any more');
});

test('Bulk reject names the writer it lacks, not records that exist', () => {
  const block = zoneBlock(ACTIONS, 'grow/talent');
  const m = block.match(/label: 'Bulk reject', unbuilt: '((?:[^'\\]|\\.)*)'/);
  assert.ok(m, 'Bulk reject stopped being a stated gap — if a writer landed, make it a handler');
  // It must NOT deny the records: they are read on this very page.
  assert.doesNotMatch(m[1], /no candidate records exist/,
    'Bulk reject denies candidate records that jobs.applications() returns and this page tabulates');
  assert.match(m[1], /no endpoint sets an application status/);
  assert.ok(TALENT.includes('jobsApi.applications('), 'the page stopped reading applications');
  // And the claim's other half: there is genuinely no status writer. If one is
  // added, this fails and the refusal has to become a handler.
  assert.ok(!/UPDATE job_applications\s+SET status/i.test(JOBS_ROUTE),
    'an application-status writer exists now, so Bulk reject is no longer a gap');
});

test('Stalled is live, and computed from the stamps the route returns', () => {
  const block = zoneBlock(FILTERS, 'grow/customers');
  assert.match(block, /canvas: 'Stalled', key: 'stalled'/);
  assert.ok(CUSTOMERS.includes("view === 'stalled'"), 'nothing branches on the stalled view');
  // All four stamps, because the newest is the last touch — reading only
  // `created_at` would call an account invited yesterday stalled since March.
  for (const stamp of ['promoted_at', 'followed_up_at', 'invited_at', 'created_at']) {
    assert.ok(CUSTOMERS.includes(stamp), `the stalled rule stopped reading ${stamp}`);
  }
  assert.match(PROGRESS, /crm_status, invited_at, followed_up_at, promoted_at/,
    'WAITLIST_SELECT stopped returning the activity stamps');
  // A row with no parseable stamp must NOT be called stalled: silence about a
  // date is not evidence of neglect, and the accusation sends a founder chasing
  // a live account.
  assert.match(CUSTOMERS, /return times\.length \? Math\.max\(\.\.\.times\) : null/);
  assert.match(CUSTOMERS, /return at != null && Date\.now\(\) - at > STALL_DAYS/);
});

test('Warm path only is live, and a warm path is the stored contact id', () => {
  const block = zoneBlock(FILTERS, 'grow/capital-match');
  assert.match(block, /canvas: 'Warm path only', key: 'warm'/);
  assert.ok(CAPITAL.includes("view === 'warm'"), 'nothing branches on the warm view');
  // Nothing is inferred from a shared domain or a similar name — the join is a
  // stored column, and migration 128 is what put it there.
  assert.match(CAPITAL, /row\?\.contact_id != null/);
  assert.match(
    raw('cloudflare-worker/sql/migrations/128_contact_promotion.sql'),
    /raise_prospects\(contact_id\)/,
    'the contact join this chip rests on is gone',
  );
});

test('the two dynamic-group reasons are the correct use of one, not a leftover', () => {
  // THE DISTINCTION THIS WHOLE PASS TURNS ON. A dynamic group with an `unbuilt`
  // reason is RIGHT when the page supplies names as soon as it has any: the chips
  // are the stored ones, and the reason covers the empty case. It is WRONG when
  // the page supplies nothing ever — then the reason is about the page.
  //
  // Both of Grow's survived this check: each page passes a `dynamic:` map built
  // from rows it has loaded. Deleting either as "false" would have been the error
  // in the opposite direction from the four above.
  assert.match(TALENT, /dynamic: \{ roles: jobs\./, 'the talent page stopped supplying role chips');
  assert.match(CAPITAL, /dynamic: \{ stages: stages\./, 'the capital page stopped supplying stage chips');
  assert.match(zoneBlock(FILTERS, 'grow/talent'), /unbuilt: 'no job post is linked to this startup yet'/);
  assert.match(zoneBlock(FILTERS, 'grow/capital-match'), /unbuilt: 'no prospect records a stage yet'/);
});

test('the refusals that survive still describe something absent', () => {
  // Spot-checked against the schema rather than re-read: each of these names a
  // table or column, and `check-sqlite-tables` would notice if one appeared.
  const all = codeOnly(FILTERS) + codeOnly(ACTIONS);
  for (const [phrase, why] of [
    ['no experiment log is connected', 'no experiment table exists'],
    ['experiments are not a stored record', 'same'],
    ['no market segment is stored on a customer record', 'a record stores its capture source, not a segment'],
    ['segments are not stored', 'same'],
    ['no sequence store exists', 'nothing sends mail from here'],
    ['no outreach drafting runs on this desk', 'no outreach store'],
    ['a calendar event has no publication state', 'calendar_events.status is cancelled-semantics'],
    ['no article or content record is connected to this startup', 'articles has author_user_id and no project_id'],
  ]) {
    assert.ok(all.includes(phrase), `a surviving Grow refusal changed its words: "${phrase}" (${why})`);
  }
});
