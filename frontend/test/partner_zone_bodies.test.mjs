/**
 * The partner workspace zone bodies, held to the same rules as the advisor's —
 * plus the three the partner kit exists to enforce.
 *
 * WHY A PARTNER FILE AND NOT A WIDER GLOB IN THE ADVISOR ONE. The three
 * ZoneBody rules are shared through `_zoneGuards.mjs` and asserted from both
 * sides. Everything below them is partner-specific and would have no business
 * in an advisor-named file: the amber accent, the cents-versus-dollars rename,
 * and the requirement that a zone say what it cannot produce.
 *
 * The last of those is the one worth stating plainly, because it is a rule
 * about honesty rather than about code. Nine partner zones shipped for months
 * rendering a card that said "no store behind this yet", and every one of those
 * cards was TRUE. The stores now exist, the cards are gone, and the risk
 * inverts: a zone that quietly renders 0%, `$0` or "on track" where its store
 * is silent is a worse failure than the card ever was, because it looks like an
 * answer. So each zone must carry a `StatedLimit` naming what it cannot say.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import {
  assertLoadingNeverOutlivesError, assertNoNullDraftDeref, assertAbsentIsNotZero,
  jsxFilesUnder,
} from './_zoneGuards.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const ZONE_ROOT = 'frontend/src/pages/partner';

/** Every partner zone body — the bucket subfolders, not the kit or operations. */
function zoneBodies() {
  return ['pipeline', 'delivery', 'offers']
    .filter((d) => existsSync(resolve(process.cwd(), `${ZONE_ROOT}/${d}`)))
    .flatMap((d) => jsxFilesUnder(`${ZONE_ROOT}/${d}`));
}

test('the partner kit is the one import surface for a zone body', () => {
  const bodies = zoneBodies();
  assert.ok(bodies.length >= 3, `only ${bodies.length} partner zone bodies found — the scan is broken`);

  for (const file of bodies) {
    const src = codeOnly(read(file));

    // Reaching past the kit is how a zone acquires the advisor's emerald, or
    // the wrong `Field`, or `money` under a name that hides which unit it
    // takes. The kit re-exports everything these zones need; if something is
    // missing from it, the fix is to add it there.
    assert.doesNotMatch(src, /from '\.\.\/\.\.\/advisor\//,
      `${file} imports from the advisor tree directly — go through pages/partner/kit.jsx`);
    assert.doesNotMatch(src, /from '\.\.\/operations\/kit'/,
      `${file} imports the operations kit directly — go through pages/partner/kit.jsx`);
  }
});

test('neither money helper is importable into a partner zone under its old name', () => {
  // `money` TAKES CENTS and `moneyUsd` TAKES DOLLARS, and they have the same
  // call shape. Migrations 208/209 store `amount_cents` and `floor_cents`;
  // `engagements.price` beside them is grandfathered REAL dollars. Picking the
  // wrong one is a silent 100× error on a money figure that still looks
  // plausible on screen, which is exactly the class of bug no reviewer catches.
  // So the kit renames both, and neither original name survives as an import.
  for (const file of zoneBodies()) {
    const src = codeOnly(read(file));
    const imports = [...src.matchAll(/import\s*\{([^}]*)\}\s*from/g)].map((m) => m[1]).join(',');
    assert.doesNotMatch(imports, /\bmoney\b(?!\w)/,
      `${file} imports \`money\` — it takes CENTS; use moneyCents or moneyDollars`);
    assert.doesNotMatch(imports, /\bmoneyUsd\b/,
      `${file} imports \`moneyUsd\` — it takes DOLLARS; use moneyDollars`);
  }
});

test('the partner kit carries its own accent and does not re-export the advisor one', () => {
  const kit = read(`${ZONE_ROOT}/kit.jsx`);
  const code = codeOnly(kit);

  // Amber, written out as Tailwind literals rather than composed from
  // ACCENT.partner's hex — a class name built at runtime is one Tailwind never
  // scans and never ships.
  assert.match(code, /export const inputClass[\s\S]{0,400}?amber-500/,
    'the partner inputClass must carry the amber focus ring');
  assert.match(code, /export const buttonClass[\s\S]{0,400}?bg-amber-700/,
    'the partner buttonClass must be amber');

  // And the emerald pair must not be reachable from here by habit. A partner
  // zone that imported `inputClass` from this file and got emerald would be a
  // wrong accent that nothing would ever fail on.
  const reexports = [...code.matchAll(/export\s*\{([^}]*)\}\s*from\s*'([^']*)'/g)];
  for (const [, names, from] of reexports) {
    if (!from.includes('advisor')) continue;
    assert.doesNotMatch(names, /\binputClass\b/, 'the advisor inputClass must not be re-exported');
    assert.doesNotMatch(names, /\bbuttonClass\b/, 'the advisor buttonClass must not be re-exported');
  }
});

test('the two Field exports are told apart by name', () => {
  // `advisor/expertise/kit` exports a FORM INPUT wrapper ({label, hint,
  // children}); `advisor/network/kit` exports a READ-ONLY display pair
  // ({label, children}) that renders an italic em-dash when empty. A zone
  // importing both gets whichever the bundler resolved last, and the wrong one
  // still renders — a form field silently becoming a read-only row.
  const code = codeOnly(read(`${ZONE_ROOT}/kit.jsx`));
  assert.match(code, /Field as ReadField/, 'the read-only Field must arrive renamed');
  assert.match(code, /export \{ Field \} from '\.\.\/advisor\/expertise\/kit'/,
    'the form Field must be the one exported as `Field`');
});

test('the three ZoneBody rules hold on the partner tree too', () => {
  // Same rules, same file, different root — see `_zoneGuards.mjs`. These zones
  // are built on the identical ZoneBody and invite the identical mistakes; the
  // advisor tree having been checked for them proves nothing here.
  assertLoadingNeverOutlivesError(ZONE_ROOT, 3);
  assertNoNullDraftDeref(ZONE_ROOT, 3);
  // The partner columns that carry the absent-is-not-zero risk. `amount_cents`
  // and `floor_cents` are money; `hours_used` and `retained_hours` are the two
  // halves of utilisation, where a zero means "used none of what they bought"
  // rather than "nobody logged it".
  assertAbsentIsNotZero(ZONE_ROOT, [
    'amount_cents', 'floor_cents', 'hours_used', 'retained_hours', 'utilisation_pct',
  ]);
});

test('every partner zone body reads a list defensively', () => {
  // `scripts/check-workspace-frames.mjs` stubs a BARE `[]` for any path that
  // does not end in summary|overview|analytics|profile|me|progress|status —
  // none of the new partner paths does. A body that did `r.items.map(…)` would
  // therefore crash under the frame check on a shape the real API never sends,
  // which is a manufactured failure rather than a found one. Reading it
  // defensively costs nothing and makes the frame check's empty state real.
  for (const file of zoneBodies()) {
    const src = codeOnly(read(file));
    // EVERY `.items` READ IS CHECKED, not just the first, and the variable can
    // be called anything.
    //
    // The first version of this rule matched `Array.isArray(` against a fixed
    // list of variable names — r, d, res, resp — and asserted the file
    // contained ONE such call. Both halves were wrong: a body that read
    // `ppl?.items` guarded correctly failed because the name was not on the
    // list, and a body with three reads passed on the strength of guarding one.
    // The list was a stand-in for a real check.
    // Two idioms count, and both are real guards: an `Array.isArray(x?.items)`
    // test anywhere in the file for that name, or an array fallback at the read
    // itself (`x.items || []`). The second is what a body does when the value
    // is its OWN state, already normalised on the way in — demanding
    // `Array.isArray` there would be asking a page to re-check something it
    // guaranteed at the fetch, and it made this rule fail a correct file.
    // What neither form permits is the thing that actually crashes:
    // `r.items.map(…)` on a response nobody checked.
    const guarded = new Set(
      [...src.matchAll(/Array\.isArray\(\s*([A-Za-z_$][\w$]*)\s*\??\.\s*items\s*\)/g)]
        .map((m) => m[1]),
    );
    for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\s*\??\.\s*items\b(\s*(?:\|\||\?\?)\s*\[\s*\])?/g)) {
      if (guarded.has(m[1]) || m[2]) continue;
      assert.fail(
        `${file} reads \`${m[1]}.items\` with neither an \`Array.isArray(${m[1]}?.items)\` `
        + `guard nor an \`|| []\` fallback. check-workspace-frames stubs a bare [] for `
        + 'these paths, so an unguarded read crashes on a shape the real API never sends.');
    }
  }
});

test('a zone that cannot produce a figure says so on itself', () => {
  // The card that used to stand in front of each of these zones said what was
  // missing and why. Deleting the card must not delete the honesty: a zone that
  // renders a blank where the canvas asked for a number has told the reader
  // nothing, and a zone that renders a plausible zero has told them something
  // false. Each body carries a StatedLimit naming what it will not claim.
  for (const file of zoneBodies()) {
    const src = codeOnly(read(file));
    if (!/<ZoneBody/.test(src)) continue;
    assert.match(src, /<StatedLimit/,
      `${file} renders a zone with no StatedLimit — say what it cannot answer`);
  }
});

test('utilisation is never rendered as a zero, and its two nulls read differently', () => {
  const src = codeOnly(read(`${ZONE_ROOT}/pipeline/RetainersZone.jsx`));

  // The bar is drawn only where there is a real percentage. A `pct || 0` or a
  // width computed from a null would paint an empty bar, which says the client
  // used none of what they bought — the exact claim the store cannot make.
  assert.match(src, /if \(pct === null \|\| pct === undefined\)/,
    'the utilisation component must return before drawing a bar when there is no percentage');

  // And the reason is the WORKER'S sentence, printed rather than re-derived.
  // Two different nulls — "not sold by the hour" and "nobody has logged this
  // period" — are different facts, and only the worker knows which it is.
  assert.match(src, /utilisation_note/,
    'the zone must print the worker\'s own reason for a null utilisation');
  assert.match(src, /<NotComputable/,
    'a figure that cannot be computed must render as such, not as a blank');
});

test('MRR states what it counted', () => {
  const src = codeOnly(read(`${ZONE_ROOT}/pipeline/RetainersZone.jsx`));
  // A retainer with no amount is skipped rather than summed as zero, and the
  // stat's hint carries `mrr_basis` — how many rows are in the total — so a
  // monthly figure quietly counting three unpriced retainers as free is not
  // presentable as complete.
  assert.match(src, /mrr_basis/, 'the MRR stat must show what the total counted');
  assert.match(src, /mrr_cents != null \? moneyCents\(/,
    'a null MRR must render as an em-dash, never as $0');
});

test('the negotiations zone refuses a close probability', () => {
  const src = codeOnly(read(`${ZONE_ROOT}/pipeline/NegotiationsZone.jsx`));
  // The canvas puts a percentage beside each deal. Nothing records why a past
  // negotiation was won or lost, so there is no history to weight a live one
  // against — a figure drawn from stage alone would be the stage relabelled as
  // a forecast. The stat exists and reads as an em-dash, because removing it
  // would hide the gap rather than state it.
  assert.match(src, /Close probability/, 'the canvas asks for it, so the zone must address it');
  assert.match(src, /value="—"/, 'and it must be an em-dash rather than a computed number');
  assert.match(src, /No close probability/,
    'the StatedLimit must explain why, not merely leave a dash');
});
