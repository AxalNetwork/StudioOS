/**
 * Branch · Contracts — canvas S5 + S10, and the producer that unblocked it
 * (D147).
 *
 * WHAT THIS FILE IS FOR. `/branch/contracts` rendered a stated notice promising
 * *"Active contracts with the template version travelling on the row, HQ's
 * master library read-only with its as-of stamp and archived versions visible
 * but unusable, and pending signatures."* One of those three now has a source
 * and two do not, and the risk on this page is not a wrong number — it is the
 * page quietly claiming the other two.
 *
 * So the assertions are aimed at four things a screen over a COPY can get
 * wrong, each of which this repo has already been bitten by once:
 *
 *   1. AN ABSENT COPY RENDERED AS AN EMPTY ONE. D107 fixed exactly this on the
 *      licence copy, where "you administer no licence" and "HQ has not pushed
 *      yours" had been one sentence. Here there are THREE states, not two.
 *   2. A STAMP THAT IS THE BRANCH'S CLOCK. The age on screen must be the age of
 *      HQ's assertion, which is why the payload's `pushed_at` is what renders.
 *   3. A CONTROL THAT EXISTS TO BE REFUSED. D.9 puts authoring at HQ and
 *      `requireHqAuthoring` enforces it; a greyed edit button here would be the
 *      `still_an_admin` mistake D134 named.
 *   4. A REASON TYPED INTO THE PAGE RATHER THAN READ OFF THE PAYLOAD. D131's
 *      rule: a page holding its own copy of an absence's reason is a second
 *      place to update, and the one that is not updated is the one that lies.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/branch_contracts_s5s10.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

const APP_RAW = raw('frontend/src/App.jsx');
const APP = codeOnly(APP_RAW);
const PAGE_RAW = raw('frontend/src/pages/branch/BranchContracts.jsx');
const PAGE = codeOnly(PAGE_RAW);
const API = codeOnly(raw('frontend/src/lib/api.js'));
const ADMIN_TEMPLATES = codeOnly(raw('frontend/src/pages/admin/AdminTemplates.jsx'));
const WORKER_ROUTE = raw('cloudflare-worker/src/routes/branch_templates.ts');
const WORKER_HQ = raw('cloudflare-worker/src/routes/admin_contracts.ts');

test('the route renders the page, and the pending notice is gone from it', () => {
  // D151 — props left open; see the twin note in branch_insights_s6. What is
  // pinned is the gate and the component, not the absence of a prop.
  assert.match(
    APP,
    /path="\/branch\/contracts" element=\{guard\(\['admin'\], <BranchContracts[\s/]/,
    '/branch/contracts must mount the real page',
  );
  // THE NOTICE MUST BE GONE FROM THIS ROUTE SPECIFICALLY, not merely rarer in
  // the file: `/branch/insights` and `/branch/settings` legitimately still
  // render one, so a whole-file scan for `BranchZonePending` would pass while
  // this route kept its notice.
  //
  // AND THE WINDOW IS BOUNDED BY THE NEXT `<Route`, NOT BY A CHARACTER COUNT.
  // The first draft of this assertion took 400 characters and failed on correct
  // code, because the contracts route is one short line and the window reached
  // into the insights route's notice. A fixed-width window over variable-width
  // neighbours is an assertion about line lengths.
  const at = APP.indexOf('path="/branch/contracts"');
  assert.ok(at > 0);
  const next = APP.indexOf('<Route', at);
  const element = APP.slice(at, next > at ? next : at + 200);
  assert.ok(
    !element.includes('BranchZonePending'),
    'the contracts route must not still render the pending notice',
  );
  assert.ok(
    // Props left open (D151): the window proves the element is this route's
    // and not the next one's, which the component name does on its own.
    element.includes('<BranchContracts'),
    'and the window must actually contain this route\'s element, or it is measuring nothing',
  );
});

test('the page reads the branch copy, and nothing else', () => {
  assert.match(PAGE, /api\.branchTemplates\(\)/, 'the page must read the copy route');
  assert.match(API, /branchTemplates:\s*\(\)\s*=>\s*request\('\/branch\/templates'\)/,
    'the api method must point at the branch route, not an HQ one');
  // A BRANCH MUST NOT REACH HQ'S OWN STORE. `adminTemplateStore*` is
  // super-admin-gated and answers "HQ only" on a branch, so a page calling it
  // would render a refusal instead of the copy that is sitting right there.
  assert.ok(
    !/adminTemplateStore/.test(PAGE),
    'the branch page must never call HQ\'s template-store methods',
  );
});

test('THREE read states, and none of them is an empty list standing in for the others', () => {
  // unreadable — the table is not there
  assert.match(PAGE, /data\?\.available === false/, 'an unreadable table must have its own branch');
  assert.match(PAGE, /<Unreadable[\s\S]{0,200}claim=\{data\.reason\}/,
    'and it must render the SERVER\'s reason rather than a typed one');
  // never pushed — the table is there and HQ has not spoken
  assert.match(PAGE, /never_pushed_reason/, 'never-pushed must render its own server reason');
  // pushed and empty — HQ spoke and had nothing
  assert.match(PAGE, /HQ&rsquo;s library is empty/,
    'a pushed-but-empty library is a claim about HQ and needs its own sentence');
  // and the three must be distinguishable in order: the empty-list case is
  // reached only AFTER the never-pushed case, or the two collapse into one.
  assert.ok(
    PAGE.indexOf('never_pushed_reason') < PAGE.indexOf('HQ&rsquo;s library is empty'),
    'never-pushed must be tested before the empty list, or it can never be reached',
  );
});

test('the age on screen is HQ\'s stamp, never this browser\'s idea of now', () => {
  assert.match(PAGE, /const pushedAt = data\?\.pushed_at/,
    'the stamp must come off the payload');
  assert.match(PAGE, /data-testid="branch-templates-asof"/);
  assert.ok(
    !/updated_at/.test(PAGE),
    'the branch\'s own write time must not reach the screen — it is not the age of the fact',
  );
});

test('there is no authoring control, and the refusal is stated rather than drawn disabled', () => {
  for (const verb of ['Edit', 'New template', 'Delete', 'Save']) {
    assert.ok(!PAGE.includes(`>${verb}<`), `the branch page must not draw a ${verb} control`);
  }
  assert.ok(!/<button/.test(PAGE), 'the library is read-only: no button belongs on this page at all');
  assert.match(PAGE_RAW, /Changing a template is a Content submission/,
    'the page must say what changing a template actually is');
});

test('what the copy leaves at HQ is read off the payload, not typed into the page', () => {
  assert.match(PAGE, /data\?\.not_carried/, 'the page renders the server\'s list');
  assert.match(PAGE, /\(data\.not_carried \|\| \[\]\)\.map/);
  // THE TWO FIELDS ARE NAMED IN THE WORKER, AND ONLY THERE. A page that also
  // spelt them would be the second place to update the day HQ starts sending
  // one, and it is the one that would go stale.
  assert.ok(
    !PAGE.includes("'body_md'") && !PAGE.includes('"body_md"'),
    'the page must not name body_md itself',
  );
  assert.match(WORKER_ROUTE, /field: 'body_md'/);
  assert.match(WORKER_ROUTE, /field: 'archived versions'/);
});

test('the active-contracts block states its gap with the TRUE cause (D199)', () => {
  // RE-AIMED, NOT LOOSENED. This matched `licence_contracts` inside the
  // block's reason, because the reason named that table as where a branch's
  // contracts live. That was the wrong table: it holds the licence agreement
  // and nothing else, and this branch's own contracts are rows in its own
  // database. A sentence CORRECTING the attribution still contains the table's
  // name, so the old match would pass on the opposite claim — a lexical scan
  // cannot tell a rule from its violation. So it asserts the claim itself.
  assert.match(PAGE, /data-testid="branch-contracts-ledger"/);
  const at = PAGE.indexOf('data-testid="branch-contracts-ledger"');
  const block = PAGE.slice(at, PAGE.indexOf('</Card>', at));
  assert.match(block, /<Unrecorded reason="[^"]*rows in this branch's own database/,
    'the block no longer says whose database the contracts are in');
  assert.match(block, /holds only the licence agreement itself/,
    'the block no longer says what HQ\'s ledger actually holds');
  assert.doesNotMatch(block, /live in HQ's `licence_contracts`|no branch-side read/i,
    'the misattributed cause is back');
  // Still no table: the rows are readable, but the screen that tables them is
  // not built, and two of its columns are recorded for no e-sign envelope.
  assert.ok(!/<table/.test(PAGE), 'a table appeared without the columns S5 draws having a source');
});

test('HQ can push, and the push is the whole library rather than one template', () => {
  assert.match(API, /adminTemplatesPublish:\s*\(\)\s*=>/,
    'the publish method takes NO slug — the library travels as a set');
  assert.match(ADMIN_TEMPLATES, /data-testid="template-publish"/, 'HQ needs a control, or the producer has no caller');
  assert.match(ADMIN_TEMPLATES, /api\.adminTemplatesPublish\(\)/);
  assert.match(WORKER_HQ, /adminContracts\.post\('\/templates\/publish'/);
  assert.match(WORKER_HQ, /fanOut<[^>]*>\(\s*\n?\s*c\.env, 'publishTemplate'/,
    'the route must fan out to every branch rather than one');
});

test('zero branches is an answer the SERVER supplies, so the page cannot drift from it', () => {
  assert.match(WORKER_HQ, /branches_reason:/, 'the worker owns the no-branch sentence');
  assert.match(ADMIN_TEMPLATES, /publishResult\.branches_reason/,
    'and the page renders it rather than writing its own');
  assert.ok(
    !/No branch Worker is bound/.test(ADMIN_TEMPLATES),
    'the page must not carry a second copy of that sentence',
  );
});

test('a push that failed to send says the library is untouched', () => {
  // A FAILED SEND IS NOT A FAILED SAVE, and an operator who reads it as one
  // goes back to check what they just wrote. The two are different sentences.
  assert.match(ADMIN_TEMPLATES, /Nothing in it changed/);
  assert.match(ADMIN_TEMPLATES, /data-testid="template-publish-error"/);
});
