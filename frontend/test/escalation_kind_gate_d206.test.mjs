/**
 * D206 — the branch's raise form offers the kinds its licence allows (H30).
 *
 * A white-label has no HQ brand desk, so `content` is an escalation its admins
 * could raise and nobody could answer. The worker refuses it at both ends; this
 * file pins what the branch's own page draws, rendered wherever it is pure:
 *
 *  - the offer is the SERVER's answer when it gave one, and every kind when it
 *    did not — loading, failed, or a payload older than the kind fields;
 *  - a hidden kind is a stated row with the server's reason and NO input, so
 *    there is nothing to select and nothing to send;
 *  - the row steps down with its background and a dashed edge, never opacity
 *    (H30's own contrast note: opacity takes the reason below 3:1);
 *  - a kind picked while loading that turns out hidden is replaced by an
 *    offered one, rather than sent;
 *  - a refusal renders its sentence, not its code.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';

import { kindsOffered, chosenKind, KindPicker } from '../src/pages/branch/BranchApprovals.jsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const PAGE = read('frontend/src/pages/branch/BranchApprovals.jsx');
const CODE = codeOnly(PAGE);
const HQ_OPS = read('cloudflare-worker/src/rpc/hqOps.ts');
const ROUTE = codeOnly(read('cloudflare-worker/src/routes/branch_escalations.ts'));
const CANVAS = read('design/canvases/integrated/Admin · Super.dc.html');

const ALL = ['moderation', 'content', 'seat_increase', 'other'];
const HIDDEN_REASON = 'Hidden for this kind — there is no brand desk to send it to.';
const BASIS_KNOWN = 'Read from the licence copy HQ pushed to this branch.';
const BASIS_UNKNOWN = 'This branch\'s licence copy does not say which kind of licence it runs under, '
  + 'so every kind is offered here and HQ, which holds the licence, decides.';

/** The lane payload's kind fields, in the three shapes the route sends. */
const WHITE_LABEL = {
  available: true, items: [],
  licence_kind: 'white_label', licence_kind_known: true,
  kinds_available: ['moderation', 'seat_increase', 'other'],
  kinds_hidden: [{ kind: 'content', reason: HIDDEN_REASON }],
  kind_basis: BASIS_KNOWN,
};
const SUBSIDIARY = {
  available: true, items: [],
  licence_kind: 'subsidiary', licence_kind_known: true,
  kinds_available: [...ALL], kinds_hidden: [], kind_basis: BASIS_KNOWN,
};
const UNKNOWN = {
  available: true, items: [],
  licence_kind: null, licence_kind_known: false,
  kinds_available: [...ALL], kinds_hidden: [], kind_basis: BASIS_UNKNOWN,
};

const noop = () => {};
const picker = (lane, picked = 'other') => {
  const offered = kindsOffered(lane);
  return renderToStaticMarkup(createElement(KindPicker, {
    offered, chosen: chosenKind(offered, picked), onChoose: noop,
  }));
};
/** Every `<input …>` opening tag in a render. */
const inputs = (html) => html.match(/<input\b[^>]*>/g) || [];
/** The hidden row's own markup, from its testid to the close of its element. */
function hiddenRow(html, kind) {
  const at = html.indexOf(`data-testid="branch-escalate-hidden-${kind}"`);
  assert.ok(at > 0, `no hidden row for ${kind}`);
  const open = html.lastIndexOf('<div', at);
  // The row is a <div> holding spans only, so its first </div> closes it.
  return html.slice(open, html.indexOf('</div>', at) + '</div>'.length);
}

// ─────────────────────────────────────────────────────── what is offered ──

test('while the lane is loading or has failed, every kind is offered — the server refuses anyway', () => {
  for (const lane of [null, undefined, Symbol('unavailable')]) {
    const o = kindsOffered(lane);
    assert.deepEqual(o.available, ALL);
    assert.deepEqual(o.hidden, []);
    assert.equal(o.known, false);
    assert.equal(o.basis, null, 'a basis sentence appeared with nothing read to base it on');
  }
});

test('a payload older than the kind fields offers every kind rather than none', () => {
  const o = kindsOffered({ available: true, items: [], kinds: ALL });
  assert.deepEqual(o.available, ALL);
  assert.deepEqual(o.hidden, []);
});

test('a white-label is offered three kinds, and content is hidden with the server’s reason', () => {
  const o = kindsOffered(WHITE_LABEL);
  assert.deepEqual(o.available, ['moderation', 'seat_increase', 'other']);
  assert.deepEqual(o.hidden, [{ kind: 'content', reason: HIDDEN_REASON }]);
  assert.equal(o.known, true);
  assert.equal(o.basis, BASIS_KNOWN);
});

test('a subsidiary and an unknown kind are both offered all four', () => {
  assert.deepEqual(kindsOffered(SUBSIDIARY).available, ALL);
  assert.deepEqual(kindsOffered(SUBSIDIARY).hidden, []);
  const u = kindsOffered(UNKNOWN);
  assert.deepEqual(u.available, ALL);
  assert.equal(u.known, false, 'an unknown kind read as known');
});

test('the gate applies even when the escalation store could not be read', () => {
  // The route computes the gate from the licence copy, apart from the lane's
  // own read — so a lane that is `available: false` still says what is hidden.
  const o = kindsOffered({ ...WHITE_LABEL, available: false, reason: 'migration 261', items: undefined });
  assert.deepEqual(o.hidden.map((h) => h.kind), ['content']);
  assert.ok(!o.available.includes('content'));
});

test('a kind this page cannot name is never drawn, and a hidden kind is never also offered', () => {
  const o = kindsOffered({
    ...SUBSIDIARY,
    kinds_available: [...ALL, 'franchise_review'],
    kinds_hidden: [{ kind: 'content', reason: HIDDEN_REASON }, { kind: 'franchise_review', reason: 'x' }],
  });
  assert.ok(!o.available.includes('franchise_review'), 'an unnamed kind would render as a blank choice');
  assert.deepEqual(o.hidden.map((h) => h.kind), ['content']);
  assert.ok(!o.available.includes('content'), 'a kind listed as hidden is still offered');
});

test('a hidden kind with no reason still says why, in the route’s own fallback words', () => {
  const o = kindsOffered({ ...WHITE_LABEL, kinds_hidden: [{ kind: 'content', reason: '   ' }] });
  assert.equal(o.hidden[0].reason, 'HQ does not take this kind of escalation from this branch.');
  assert.match(ROUTE, /HQ does not take this kind of escalation from this branch\./,
    'the fallback no longer matches the route\'s own sentence for an HQ refusal');
});

// ────────────────────────────────────────────────────────── what is sent ──

test('a kind picked while loading that turns out hidden is replaced, not sent', () => {
  const wl = kindsOffered(WHITE_LABEL);
  assert.equal(chosenKind(wl, 'content'), 'other', 'the form would send a kind the licence hides');
  assert.equal(chosenKind(wl, 'seat_increase'), 'seat_increase', 'an offered pick was overridden');
  assert.equal(chosenKind(kindsOffered(null), 'content'), 'content', 'a pick was dropped while nothing was read');
  assert.equal(chosenKind({ available: ['moderation'], hidden: [] }, 'content'), 'moderation');
  assert.equal(chosenKind({ available: [], hidden: [] }, 'other'), null,
    'with nothing offered the form must have nothing to send');
});

test('the form sends the derived kind, and cannot submit without one', () => {
  assert.match(CODE, /const chosen = chosenKind\(offered, kind\);/, 'the choice is not derived from what is offered');
  assert.match(CODE, /api\.branchEscalate\(\{ kind: chosen,/, 'the raise sends the raw pick, not the offered one');
  // RE-AIMED IN D275, EVERY TERM KEPT: the button and the handler gained a
  // fourth refusal (an item picked with no relation), and the three below are
  // still each required, in the same order.
  assert.match(CODE, /disabled=\{!subject\.trim\(\) \|\| sending \|\| !chosen \|\| needsRelation\}/,
    'the submit stays enabled with no kind to send');
  // The handler refuses too, and not only the button. In a browser a disabled
  // default button also blocks Enter-to-submit, so this is the second lock —
  // but a mutation run showed dropping it changed nothing any test could see.
  assert.match(CODE, /if \(!subject\.trim\(\) \|\| sending \|\| !chosen \|\| needsRelation\) return;/,
    'the submit handler would send with no kind to send; only the button stops it');
});

// ─────────────────────────────────────────────────────── what is rendered ──

test('a white-label renders three choices and a hidden row with no input for content', () => {
  const html = picker(WHITE_LABEL);
  const tags = inputs(html);
  assert.equal(tags.length, 3, `expected three radios, found ${tags.length}`);
  assert.ok(!tags.some((t) => /value="content"/.test(t)), 'content is still a choice on a white-label');
  const row = hiddenRow(html, 'content');
  assert.doesNotMatch(row, /<input|<button|<select|<textarea/, 'the hidden row carries a control');
  const text = renderedText(row);
  assert.match(text, /Content for brand approval/, 'the hidden row does not name the kind');
  assert.ok(text.includes(HIDDEN_REASON), 'the hidden row does not say why');
  assert.match(text, /Hidden/, 'the hidden row has no Hidden pill');
});

test('the hidden row steps down with a dashed edge and a background, never opacity', () => {
  const row = hiddenRow(picker(WHITE_LABEL), 'content');
  const cls = (row.match(/class="([^"]*)"/) || [])[1] || '';
  assert.match(cls, /\bborder-dashed\b/, 'the hidden row lost its dashed edge');
  assert.match(cls, /\bbg-zinc-50\b/, 'the hidden row lost its stepped-down ground');
  assert.doesNotMatch(row, /opacity-/, 'the hidden row is dimmed with opacity, which takes its reason below 3:1');
  // The reason is muted ink at full strength, not the faint grey that would
  // repeat the contrast failure by another route.
  assert.doesNotMatch(row, /text-axal-faint/, 'the reason is set in faint ink');
});

test('the provenance sentence appears only where it explains something on screen', () => {
  assert.ok(picker(WHITE_LABEL).includes('data-testid="branch-escalate-kind-basis"'),
    'a hidden kind is drawn with no word on where the rule came from');
  assert.ok(renderedText(picker(UNKNOWN)).includes(BASIS_UNKNOWN),
    'an unknown kind offers everything without saying HQ decides');
  assert.ok(!picker(SUBSIDIARY).includes('branch-escalate-kind-basis'),
    'a subsidiary with nothing hidden grew a provenance line about nothing');
  assert.ok(!picker(null).includes('branch-escalate-kind-basis'),
    'a provenance line appeared before anything was read');
});

test('a subsidiary and a loading lane render all four choices, the pick checked', () => {
  for (const lane of [SUBSIDIARY, null]) {
    const tags = inputs(picker(lane, 'seat_increase'));
    assert.deepEqual(tags.map((t) => (t.match(/value="([^"]+)"/) || [])[1]), ALL);
    const checked = tags.filter((t) => /\bchecked=""/.test(t));
    assert.equal(checked.length, 1, 'more or fewer than one kind is checked');
    assert.match(checked[0], /value="seat_increase"/, 'the checked radio is not the pick');
  }
});

// ─────────────────────────────────────────── the words, and where they live ──

test('the reason is the server’s, and it is canvas H30’s sentence', () => {
  // Typed once, in the worker, and read by the page — so a page that retyped
  // it would be a second copy free to drift.
  assert.ok(!CODE.includes('there is no brand desk to send it to'),
    'the page types the hidden reason instead of reading the server\'s');
  assert.ok(HQ_OPS.includes(`'${HIDDEN_REASON}'`), 'the worker no longer carries the H30 sentence');
  const at = CANVAS.indexOf('wlEscKinds:');
  assert.ok(at > 0, 'the canvas no longer draws H30\'s kind list');
  assert.ok(CANVAS.slice(at, CANVAS.indexOf(']', at)).includes(HIDDEN_REASON),
    'H30\'s hidden-kind note and the worker\'s have drifted apart');
});

test('a refusal renders its sentence, not its code', () => {
  // `request()` puts a string `error` into `err.message` — `kind_not_available`
  // here — and keeps the body on `err.data`, whose `message` is the sentence.
  const at = CODE.indexOf('setSendError(err');
  assert.ok(at > 0, 'the raise no longer reports its failure');
  const line = CODE.slice(at, CODE.indexOf(';', at));
  assert.ok(line.indexOf('err?.data?.message') > 0, 'the refusal\'s sentence is not read');
  assert.ok(line.indexOf('err?.data?.message') < line.indexOf('err?.message'),
    'the code is read before the sentence, so the form prints kind_not_available');
});

test('the header no longer says the board is missing — it has rendered since D130', () => {
  assert.doesNotMatch(CODE, /not here yet/, 'the header still says the four local queues are not here');
  assert.doesNotMatch(CODE, /the four things this territory/,
    'the header counts four kinds, which a white-label is not offered');
});

test('the route sends whether the kind is known, rather than leaving the page to guess', () => {
  assert.match(ROUTE, /licence_kind_known: gate\.known/, 'the lane read stopped saying whether the kind is known');
  assert.match(ROUTE, /kinds_available: gate\.available/);
  assert.match(ROUTE, /kinds_hidden: gate\.hidden/);
});
