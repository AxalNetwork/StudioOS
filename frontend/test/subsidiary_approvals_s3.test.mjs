/**
 * Branch · Approvals — canvas S3's outbound lane, and what it must not promise.
 *
 * WHAT THIS FILE IS FOR. This is the first branch surface that WRITES, and the
 * two ways it can lie are both quiet:
 *
 *   1. A REPLY BOX THAT WRITES NOWHERE. The canvas draws the answer as "a
 *      thread with HQ's decision and who made it". What exists is one `answer`
 *      column with an author and a time. A textarea beside it would be the
 *      most expensive thing on this screen, because the person using it would
 *      believe they had replied and nobody would ever read it.
 *   2. AN UNDELIVERED RAISE SHOWN AS ONE HQ HAS. The branch keeps a row when
 *      the binding is down. If that row rendered like the others, a branch
 *      admin would wait on a queue their item never reached.
 *
 * And one that is not about this page at all but is settled here because this
 * is where it becomes visible: **a suspended branch can still escalate.** The
 * frozen banner names an appeal and the appeal is this form.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = raw('frontend/src/pages/branch/BranchApprovals.jsx');
const SRC = codeOnly(PAGE);
const APP = codeOnly(raw('frontend/src/App.jsx'));
const API = codeOnly(raw('frontend/src/lib/api.js'));
const ROUTE = raw('cloudflare-worker/src/routes/branch_escalations.ts');
const HQ_ROUTE = raw('cloudflare-worker/src/routes/admin_escalations.ts');
const INDEX = raw('cloudflare-worker/src/index.ts');
const CANVAS = raw('design/canvases/integrated/Admin · Subsidiary.dc.html');

/**
 * S3 alone, bounded at both ends — and it was not, which is why this changed.
 *
 * THE OLD ANCHOR WAS A BARE WORD AND IT WORKED BY COINCIDENCE. It sliced
 * 12,000 characters from `indexOf('Approvals')` while calling itself bounded
 * at both ends. The first occurrence of that word is not S3: on the canvas
 * D194 landed it sits inside S1's support-ticket card ("Approvals filter loses
 * state on reload") at offset 12,826, with S3 at 39,774 — so the window
 * covered S1 and never reached the artboard it names. On the smaller canvas
 * the same slice happened to span the gap, and the assertion below passed for
 * a reason that had nothing to do with S3.
 *
 * Now it anchors on the artboard's own id and stops at the next one, so the
 * window IS S3 and cannot silently become some other screen. This is a
 * narrowing: a phrase that appears anywhere else in the canvas no longer
 * satisfies an assertion about this artboard.
 */
function s3() {
  const a = CANVAS.indexOf('id="s3"');
  const b = CANVAS.indexOf('id="s4"');
  assert.ok(a >= 0, 'the S3 artboard could not be found in the canvas');
  assert.ok(b > a, 'S4 no longer follows S3, so S3 has no end bound');
  return CANVAS.slice(a, b).replaceAll('&amp;', '&');
}

test('the artboard draws a To-HQ lane, and the page is it', () => {
  const board = s3();
  assert.ok(/To HQ/i.test(board), 'the artboard no longer draws a To-HQ lane');
  assert.match(PAGE, /To HQ/, 'the page dropped the outbound lane');
  // The four kinds are the canvas's, not invented here.
  for (const kind of ['moderation', 'content', 'seat_increase', 'other']) {
    assert.match(SRC, new RegExp(`'${kind}'`), `the ${kind} escalation kind is gone`);
  }
});

test('the page ships the board AND the lane, and still names what is missing', () => {
  // RE-POINTED, NOT RELAXED (D130). This read `match(SRC, /BranchZonePending/)`
  // with the reason "the four local queues need PR 13's read model" — and PR 13
  // built it, so the notice had to go and this assertion had to move with it.
  // Loosening it to "a notice OR a board" would have been the
  // assertion-that-cannot-fail this programme keeps catching: it would pass on
  // a page that shipped neither.
  //
  // The property it guarded is unchanged and still the point: the page is
  // explicit about what it does not have. What it does not have is now
  // narrower, so the assertion names the narrower things.
  assert.match(SRC, /branch-board-rows/, 'the work board is gone');
  assert.doesNotMatch(SRC, /BranchZonePending/,
    'the notice came back — the board it stood in for now exists, so the notice would be false');
  // SRC, NOT PAGE: `codeOnly` strips comments, and the distinction is the
  // point. The page's docblock says "D130 IS PR 13" — history, and true. What
  // must never come back is RENDERED copy promising the board as future work,
  // which is what a reader would act on.
  assert.doesNotMatch(SRC, /PR 13/,
    'the page renders PR 13 as future work; PR 13 IS this page');
  // The three things that genuinely still have no store, each with its reason.
  assert.match(PAGE, /Assignment and history/, 'the assignment gap lost its statement');
  assert.match(PAGE, /AI-drafted decision note/, 'the AI-note gap lost its statement');
  assert.match(PAGE, /no thread/, 'the single-decision shape lost its statement');
});

test('there is no reply box — the answer is one decision and the page says so', () => {
  // The assertion that matters most on this page. A second textarea would be
  // one beside the ANSWER; the one that exists is the raise form's `detail`.
  const textareas = (SRC.match(/<textarea/g) || []).length;
  assert.equal(textareas, 1,
    'a second textarea appeared — if it sits beside HQ\'s answer it is a reply box that writes nowhere');
  // STRUCTURAL, NOT A WORD SCAN. The first version of this assertion grepped
  // for "reply" and matched the very sentence that tells the reader there is
  // no reply box. What it must actually check is that HQ's answer block
  // carries no form control, so it is bounded to that block.
  const at = SRC.indexOf('{it.answer && (');
  assert.ok(at > 0, 'the answer block is gone');
  const answerBlock = SRC.slice(at, SRC.indexOf('</li>', at));
  assert.doesNotMatch(answerBlock, /<textarea|<input|<form|onSubmit/,
    'a form control sits inside HQ\'s answer — that is a reply box, and it writes nowhere');
  // And the shape is stated from the SERVER's own words rather than retyped.
  assert.match(SRC, /lane\.answer_note/, 'the page does not tell the reader the answer is not a thread');
  assert.match(ROUTE, /answer_shape: 'single_decision'/, 'the route stopped declaring the answer shape');
});

test('an undelivered raise is its own state, with its reason, and claims no HQ id', () => {
  assert.match(SRC, /undelivered/, 'the undelivered state is gone from the page');
  assert.match(SRC, /it\.delivery_error/, 'an undelivered raise does not say why');
  assert.match(PAGE, /has not reached HQ/, 'the page does not tell the reader it is not on HQ\'s queue');
  // The route keeps the row rather than dropping it — the property behind the
  // state. Checked on the route because that is where the row is written.
  assert.match(ROUTE, /hqUid \? 'open' : 'undelivered'/,
    'the route no longer distinguishes a delivered raise from an undelivered one');
});

test('the escalation route is NOT suspension-gated — it is the appeal path', () => {
  // THE TRAP. Every other branch write answers 423 while suspended (D107), and
  // the frozen banner tells people to appeal by escalating. Gating this would
  // make the banner point at a locked door.
  // CODE, NOT COMMENTS. The first version scanned the raw file and matched the
  // comment that explains why the gate is absent — an assertion that fails on
  // the correct implementation is worse than none.
  assert.doesNotMatch(codeOnly(ROUTE), /requireBranchNotSuspended/,
    'the escalation route is gated on suspension, so a frozen branch cannot appeal');
  // The reason IS in a comment, and that is where it belongs — asserted on the
  // raw text on purpose.
  assert.match(ROUTE, /appeal/i, 'the route does not record why it is ungated');
  // Said on the form too, because it is the one thing different about it.
  assert.match(PAGE, /while a licence is suspended/, 'the form does not say it survives a freeze');
});

test('the page is wired: api methods, route, and the branch tier', () => {
  assert.match(API, /branchEscalations: \(\) => request\('\/branch\/escalations'\)/,
    'the lane read method is gone or points elsewhere');
  assert.match(API, /branchEscalate: \(data\) =>/, 'the raise method is gone');
  assert.match(APP, /path="\/branch\/approvals"/, 'the route is not registered');
  // D151 — props left open. This pinned the prop-less spelling, so the route
  // gaining `user` (so the rail can name its branch) failed a guard about
  // whether the page is mounted at all — which the prop does not change.
  assert.match(APP, /<BranchApprovals[\s/]/, 'the page is not mounted');
  // Mounted under its OWN prefix, not /api/admin: it is not an HQ console
  // route and must not inherit that surface's gates.
  assert.match(INDEX, /app\.route\('\/api\/branch', branchEscalationRoutes\)/,
    'the branch surface is mounted somewhere other than /api/branch');
});

test('HQ\'s answer records the decision and reports delivery separately', () => {
  // The D111 promo-ceiling precedent, applied to a decision. An unreachable
  // branch must not make a recorded decision look like one that never
  // happened, or an operator enters it twice.
  assert.match(HQ_ROUTE, /pushed/, 'the answer route no longer reports whether the push landed');
  assert.match(HQ_ROUTE, /THE PUSH IS REPORTED, NEVER THROWN/,
    'the route stopped recording why the two facts are separate');
  assert.match(API, /escalationAnswer: \(uid, data\) =>/, 'the answer method is gone');
  // Mounted before the /api/admin catch-all, or the catch-all answers first.
  const escAt = INDEX.indexOf("app.route('/api/admin', adminEscalations)");
  const catchAllAt = INDEX.indexOf("app.route('/api/admin', admin)");
  assert.ok(escAt >= 0, 'the answer route is not mounted');
  assert.ok(catchAllAt > escAt, 'the answer route is mounted after the catch-all, so it never runs');
});

test('H6\'s localisation refusal is NARROWED, not deleted', () => {
  // D111's pattern. Two of the three absences closed; the third is the reason
  // the header's count still has no source, and deleting the sentence would
  // make the lane look like it counts translations.
  const content = codeOnly(raw('frontend/src/pages/hq/ContentPage.jsx'));
  const contentRoute = raw('cloudflare-worker/src/routes/admin_content.ts');
  assert.match(content, /data\.localisation_reason/, 'the narrowed refusal is no longer rendered');
  assert.match(contentRoute, /NARROWED IN D112, NOT DELETED/, 'the route lost the record of what changed');
  assert.match(contentRoute, /localisation_lane_endpoint/, 'the summary does not point at the lane');
  // The lane reads the escalation board, on its own state and its own retry.
  assert.match(content, /api\.escalations\(\{ kind: 'content' \}\)/, 'the lane does not read content escalations');
  assert.match(content, /onRetry=\{loadLane\}/, 'an unreadable lane cannot be retried on its own');
  // And the ONE stat that must stay blank is still blank, for the one reason
  // that did not change.
  const at = content.indexOf('label="Localised"');
  assert.ok(at >= 0, 'the Localised stat is gone');
  const end = content.indexOf('/>', at);
  assert.match(content.slice(at, end), /value=\{null\}/,
    'the Localised stat acquired a value — nothing records that one piece localises another');
});

test('no absent figure on the branch lane is defaulted to a number', () => {
  // The rule every HQ page holds, held here: `|| 0` on a figure with no source
  // is the change that turns an honest screen into a confident wrong one.
  assert.doesNotMatch(SRC, /\|\|\s*0\b/, 'an absent figure falls back to 0');
  assert.doesNotMatch(SRC, /\?\?\s*0\b/, 'an absent figure falls back to 0');
  // An unreadable lane is not an empty one, and the page distinguishes them.
  assert.match(SRC, /<Unreadable/, 'an unreadable lane renders as something else');
  assert.match(PAGE, /not a claim that nothing was raised/,
    'an unreadable lane is indistinguishable from an empty one');
  assert.match(PAGE, /store exists and is empty/, 'an empty lane does not say it is empty rather than broken');
});
