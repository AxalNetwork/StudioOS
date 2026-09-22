/**
 * D196 — the four Kind surfaces, guarded for the first time.
 *
 * WHAT THIS FILE IS FOR. `AdminLicences.jsx` has shipped `licence-kind`,
 * `licence-kind-pill`, `licence-brand-kit` and `licence-domain-strip` since
 * the licence console was built, and **no test asserted any of them**. Every
 * one reads `d.kind` or writes `form.kind` against a table that had no such
 * column until migration 279, so the pill fell through to its subsidiary
 * branch for every licence and the create path refused white-label outright.
 * This adds the guard rather than re-aiming one.
 *
 * THE ASSERTION THAT MATTERS MOST is not any single testid — it is that the
 * picker's vocabulary and the ledger's are read out of their own two files and
 * compared. A hand-typed list in the SPA and a CHECK in SQL are the classic
 * pair that drifts; here a third kind added to either side fails.
 *
 * EVERY BLOCK IS BOUNDED AT BOTH ENDS. D150 was caught by an assertion a
 * NEIGHBOURING element satisfied while the element under test had lost its
 * own copy entirely, so each slice below stops at its element's own closing
 * tag and is asserted to contain no other testid.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/licence_kind_ui_d196.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { codeOnly } from './_codeOnly.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

const PAGE = read('frontend/src/pages/admin/AdminLicences.jsx');
const SRC = codeOnly(PAGE);
const ROUTE = codeOnly(read('cloudflare-worker/src/routes/admin_licences.ts'));
const CONTENT = read('frontend/src/pages/hq/ContentPage.jsx');

/**
 * One element's own markup, bounded at both ends.
 *
 * The testid must occur exactly ONCE — a second occurrence would make the
 * start ambiguous — and the slice must carry no other `data-testid`, which is
 * what stops a neighbouring element satisfying an assertion about this one.
 */
function block(testid, closer) {
  const needle = `data-testid="${testid}"`;
  const count = SRC.split(needle).length - 1;
  assert.equal(count, 1, `${testid} occurs ${count} times, so its block cannot be bounded`);
  const at = SRC.indexOf(needle);
  const end = SRC.indexOf(closer, at);
  assert.ok(end > at, `${testid} never reaches its closing ${closer}`);
  const slice = SRC.slice(at + needle.length, end);
  assert.doesNotMatch(slice, /data-testid=/,
    `the ${testid} slice reaches another element, so it is not bounded to its own`);
  return slice;
}

test('the SPA offers exactly the kinds the ledger admits', () => {
  // The whole point of D196: one vocabulary, read from both files rather than
  // restated here. A third kind on either side — a button the CHECK refuses,
  // or a column value with no control — fails this.
  const picker = block('licence-kind', '</p>');
  const spa = [...picker.matchAll(/\['([a-z_]+)',\s*'[^']*'\]/g)].map((m) => m[1]);
  assert.deepEqual(spa, ['subsidiary', 'white_label'],
    'the Kind control no longer offers exactly the two kinds');

  const decl = ROUTE.match(/LICENCE_KINDS\s*=\s*\[([^\]]*)\]/);
  assert.ok(decl, 'the worker no longer names its licence kinds in one place');
  const ledger = [...decl[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(spa, ledger,
    'the picker and the ledger disagree about which kinds exist');
});

test('the create path SENDS the kind and no longer refuses white-label', () => {
  // The refusal is DELETED, not reworded, because the reason it gave — "the
  // ledger has no kind column" — stopped being true rather than being
  // rephrased. D111's narrow-don't-delete applies to a refusal that is partly
  // still true; this one is not.
  // BOUNDED TO THE LICENCE FORM. `kind: form.kind` also appears in the NOTICE
  // form eight hundred lines up, whose `kind` is a notice kind — so an
  // unbounded match is satisfied by a different form entirely. Measured:
  // deleting the licence payload's line escaped the first version of this.
  const at = SRC.indexOf('async function create(e)');
  assert.ok(at > 0, 'the licence create handler is gone');
  const creator = SRC.slice(at, SRC.indexOf('api.licenceCreate', at));
  assert.match(creator, /kind:\s*form\.kind/, 'the create payload no longer carries the chosen kind');
  assert.doesNotMatch(SRC, /ledger has no kind column/,
    'the page still tells an operator the ledger cannot store a kind');
  assert.doesNotMatch(SRC, /disabled=\{form\.kind/,
    'the submit button is still gated on the chosen kind');
  assert.doesNotMatch(SRC, /White-label is not stored yet/,
    'the submit button still labels white-label as unstorable');
});

test('the pill reads the stored kind, and its two branches say different things', () => {
  const pill = block('licence-kind-pill', '</div>');
  assert.match(pill, /d\.kind === 'white_label'/,
    'the pill stopped reading the stored kind, so every licence reads the same');
  // THE TERNARY IS MATCHED AS A TERNARY. A scan for quoted runs inside this
  // slice returns the WHITESPACE between the strings — `\n ? ` and `\n : ` —
  // because a quote both opens and closes a run, so the first version of this
  // assertion compared two pieces of indentation, found them different, and
  // passed on a pill whose branches were identical. Measured, not reasoned.
  const ternary = pill.match(/\?\s*'([^']+)'\s*:\s*'([^']+)'/);
  assert.ok(ternary, 'the pill no longer renders one sentence per kind');
  assert.notEqual(ternary[1], ternary[2],
    'both pill branches render the same sentence, so the kind is invisible again');
  assert.match(ternary[1], /White-label/,
    'the white-label branch stopped naming the kind it is for');
});

test('the white-label explainer describes the host, not a missing column', () => {
  const picker = block('licence-kind', '</p>');
  assert.match(picker, /no HQ brand desk/,
    'the white-label explainer stopped saying HQ does not approve their brand');
  // A SENTENCE ONLY THE WHITE-LABEL BRANCH CARRIES. Both branches mention
  // Settings → Domain, so matching that phrase inside this slice is satisfied
  // by the subsidiary copy — which is what let the first version of this pass
  // with the white-label host sentence deleted.
  assert.match(picker, /Members land on a platform host at activation/,
    'the explainer stopped saying a white-label starts on a platform host');
  assert.match(picker, /Settings → Domain/,
    'neither branch says where a custom host is bound');
  assert.match(picker, /Super Admin stays on axal\.vc/,
    'the explainer stopped saying Super Admin keeps its own host');
});

test('the domain strip reads the store, and HQ\'s only control is Detach (D197)', () => {
  // RE-AIMED, NOT LOOSENED. This assertion said the strip must read
  // "Not recorded" and carry no `<button`, because `d.custom_domain` was a
  // field no table had. D197 built the store, so the refusal it pinned stopped
  // being true — the ninth time in this programme a guard has had to be
  // re-aimed the day the refusal it pinned expired, and leaving it would have
  // made the test the thing preventing the fix.
  //
  // What replaces it is the property H31 actually states: "There is no
  // Approve, no Add domain, and no DNS editor for HQ to complete on a tenant's
  // behalf." So the strip may carry EXACTLY ONE control, and it must be the
  // detach.
  const at = SRC.indexOf('data-testid="licence-domain-strip"');
  assert.ok(at > 0, 'the domain strip is gone');
  const end = SRC.indexOf('{d.blockers?.length', at);
  assert.ok(end > at, 'the strip never reaches the block that follows it');
  const strip = SRC.slice(at, end);

  // H31's five columns, each present and each named.
  for (const label of ['Platform host', 'Custom host', 'State', 'Certificate', 'Primary']) {
    assert.ok(strip.includes(`label="${label}"`), `the strip lost its ${label} column`);
  }
  // THE HOST IS READ OFF THE STORE, not off the phantom field D196 measured.
  assert.match(strip, /d\.domain\?\.hostname/, 'the strip stopped reading the bound host');
  assert.doesNotMatch(strip, /custom_domain/,
    'the strip went back to a field no table has ever had');
  // AN UNREADABLE REGISTER IS ITS OWN STATE — never "no host bound".
  assert.match(strip, /d\.domain_available === false/,
    'an unreadable host register renders as no host bound');
  // EXACTLY ONE CONTROL, and it is the detach.
  const buttons = (strip.match(/<button/g) || []).length;
  assert.equal(buttons, 1, `the strip carries ${buttons} controls; H31 allows one, and it is Detach`);
  assert.match(strip, /data-testid="licence-domain-detach"/, 'the one control is not the detach');
  assert.doesNotMatch(strip, /Approve|Add domain|Edit DNS/,
    'HQ grew a control H31 says it does not get');
  // The footer that says why there is nothing else here.
  assert.match(strip, /Status only — the records live in the tenant/,
    'the strip stopped saying the records are the tenant\'s');
});

test('the brand kit is drawn only for a white-label, and still says whose mark it is', () => {
  // RE-AIMED BY D198, AND THE TENTH INSTANCE OF THE CLASS. This asserted
  // `nulls >= 3` — that at least three of the block's fields read as
  // unrecorded — because when D196 shipped there was no store behind any of
  // them. Migration 281 built one, so the assertion pinning their absence
  // became the thing preventing the fix. A guard that pins a REFUSAL has to
  // move the day the refusal stops being true.
  //
  // What did NOT change is the claim the block exists to avoid making, so that
  // is what it asserts now: a white-label's mark is theirs, HQ does not approve
  // it, and the whole block is drawn only for the kind that has one. Bounded
  // to the heading and its own intro paragraph — the block now contains four
  // further testids, so `</div>` would reach into a neighbour's.
  const kit = block('licence-brand-kit', '</p>');
  assert.match(kit, /A white-label operator sets their own mark\. HQ does not approve it\./,
    'the brand kit stopped saying whose mark it is');

  // THE GATE, ASSERTED AS A GATE. H26: "Unique to this kind · an Axal
  // subsidiary never sees this step." Both halves are load-bearing — the tab
  // is what an operator clicks, and the mount is what decides what renders.
  assert.match(SRC, /\{d\.kind === 'white_label' && \(\s*<button[\s\S]{0,200}?data-testid="licence-brand-tab"/,
    'the Brand kit tab is drawn for every licence, which H26 forbids in its own words');
  assert.match(SRC, /step === BRAND_STEP && d\.kind === 'white_label'/,
    'the brand-kit editor mounts without re-checking the kind');
  // And the step is UNNUMBERED: a numbered step only some licences have would
  // renumber the flow per licence, which two other files pin as six.
  assert.doesNotMatch(SRC, /const STEPS = \[[^\]]*Brand/,
    'the brand kit became a numbered step, which renumbers the flow per licence');
});

test('the brand-desk refusal is NARROWED, not deleted', () => {
  // D111's pattern, and both halves are load-bearing. Drop the first and HQ
  // looks like it approves a white-label's brand; drop the second and the lane
  // looks like it already filters, which it does not — an escalation carries a
  // branch code, and the kind is two joins away.
  const at = CONTENT.indexOf('data-testid="hq-brand-desk-scope"');
  assert.ok(at > 0, 'the brand-desk scope note is gone');
  const scope = CONTENT.slice(at, CONTENT.indexOf('</p>', at));
  assert.match(scope, /A white-label has no HQ brand desk/,
    'the refusal is gone, so HQ reads as approving a white-label brand');
  assert.match(scope, /does not filter on that yet/,
    'the lane now claims to filter by kind, which nothing in it does');
});
