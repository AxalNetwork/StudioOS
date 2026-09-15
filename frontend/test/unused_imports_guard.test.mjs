/**
 * Task #156 — `check-unused-imports` covers destructured locals, and this file
 * is the only evidence it works.
 *
 * WHY THE TEST CARRIES THE WHOLE BURDEN: when the destructuring half was
 * written, **zero** destructured bindings in this repository were dead, across
 * 1,310 `const { … } =` patterns. So the guard's own run proves nothing — it
 * would print the same ✓ if the new code did nothing at all. `scripts/README.md`
 * is blunt about the remedy: "Write the failure first — a guard that cannot fail
 * on the bug it was written for is decoration."
 *
 * THE FIXTURES ARE NOT HYPOTHETICAL. Every one below is either a false positive
 * a draft actually produced against this repository, or a shape that would have
 * become one. In order of how much damage each would have done:
 *
 *   1. A NAIVE `split(',')` reported SEVEN findings — `identity`, `auditably`,
 *      `attributing` — which were fragments of English prose, not bindings. They
 *      came from string defaults in `frontend/src/components/brand/templates/`:
 *      `subheadline = 'Axal gives … payments, identity, and policy primitives …
 *      safely, auditably, and at scale.'`. Splitting on every comma walks
 *      straight into the sentence.
 *   2. BLANKING THE PATTERN AFTER the length-changing import/comment strips
 *      reported THIRTEEN findings, all named `content`, every one used on the
 *      very next line. `replace(…, '')` shortens the string, so indices taken
 *      from the source addressed the wrong text.
 *   3. A REST ELEMENT is the idiom `const { password, ...safe } = user` — the
 *      named field exists precisely to be excluded. Flagging it would demand a
 *      change that breaks working code, which is the failure mode that teaches
 *      people to switch a guard off.
 *
 * Run with:  node --test frontend/test/unused_imports_guard.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  deadBindings, destructureBindings, destructurePatterns, destructuredNames,
  matchBracket, namedImports, prepareBody, topIndexOf, topParts,
  used, withoutSafeComments, withoutStrings, withoutTemplates, TREES,
} from '../../scripts/check-unused-imports.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

/** Just the names, so a fixture reads as the claim it is making. */
const dead = (src) => deadBindings(src).map((d) => `${d.kind}:${d.name}`).sort();

// ---------------------------------------------------------------------------
// The failure, first

test('a destructured const nothing uses is reported', () => {
  assert.deepEqual(dead(`
    const { alive, deadOne } = source;
    console.log(alive);
  `), ['destructured:deadOne']);
});

test('the same binding, used, is not reported', () => {
  assert.deepEqual(dead(`
    const { alive, alsoAlive } = source;
    console.log(alive, alsoAlive);
  `), []);
});

test('a used binding and a dead one in the same pattern are told apart', () => {
  // Not just "the pattern has a problem" — which name is dead is the whole
  // value of the finding.
  const found = deadBindings('const { kept, dropped } = row;\nuse(kept);\n');
  assert.equal(found.length, 1);
  assert.equal(found[0].name, 'dropped');
  assert.equal(found[0].kind, 'destructured');
});

// ---------------------------------------------------------------------------
// FALSE POSITIVE 1 — prose read as bindings

test('a string default full of commas is not mistaken for a binding list', () => {
  // The exact shape from `brand/templates/*Preview.jsx`, which produced seven
  // findings whose names were words out of the sentence.
  const src = `
    export default function Preview({ data = {} }) {
      const {
        brandName = 'axal',
        subheadline = 'Axal gives autonomous AI agents the payments, identity, and policy primitives they need to transact on behalf of real businesses — safely, auditably, and at scale.',
        paletteBg = '#0b0e0f',
      } = data;
      return render(brandName, subheadline, paletteBg);
    }
  `;
  assert.deepEqual(dead(src), [], 'a fragment of the sentence was reported as a dead binding');
  // And positively: the three real bindings are the three that were found.
  const pats = destructurePatterns(withoutTemplates(src));
  assert.equal(pats.length, 1);
  assert.deepEqual(destructuredNames(pats[0].inner), ['brandName', 'subheadline', 'paletteBg']);
});

test('commas inside calls, arrays and objects do not split a piece either', () => {
  const inner = " a = fn(1, 2), b = [3, 4], c = { d: 5, e: 6 }, f ";
  assert.deepEqual(topParts(inner).map((p) => p.text.trim()),
    ['a = fn(1, 2)', 'b = [3, 4]', 'c = { d: 5, e: 6 }', 'f']);
  // The offsets have to survive the split, because the body preparation blanks
  // by offset — a piece reported at the wrong place blanks the wrong text.
  for (const piece of topParts(inner)) {
    assert.equal(inner.slice(piece.at, piece.at + piece.text.length), piece.text);
  }
});

test('a quote inside a string does not unbalance the scan', () => {
  // `it\\'s` and a `}` inside a literal are both things real copy contains.
  const src = `const { note = 'it\\'s fine, honestly } ', other } = x;\nuse(note, other);\n`;
  assert.deepEqual(dead(src), []);
});

test('a `}` inside a string default does not end the pattern early', () => {
  assert.deepEqual(dead(`const { keptOne = '}', deadOne } = x;\nuse(keptOne);\n`),
    ['destructured:deadOne'],
    'a binding after a string-embedded brace was lost — the pattern ended early');
});

test('an object literal default does not end the pattern early', () => {
  // THIS is what pins brace matching at the call site, and it took a second
  // try to find: quoted strings are blanked before the scan, so a `}` inside
  // one no longer reaches the brace scanner. An object default does, and
  // `const { x = {} } = props` is an everyday shape here.
  //
  // With a plain `indexOf('}')` the pattern below ends at the default's own
  // brace, the text after it does not start with `=`, and the whole declaration
  // is skipped — so `deadOne` is never reported.
  assert.deepEqual(dead('const { opts = { a: 1 }, deadOne } = x;\nuse(opts);\n'),
    ['destructured:deadOne'],
    'a binding after an object default was lost — the pattern ended early');
  // An array default is the same shape with the other bracket.
  assert.deepEqual(dead('const { list = [1, 2], deadTwo } = x;\nuse(list);\n'),
    ['destructured:deadTwo']);
  // And the empty-object default, which is the common one, still parses.
  assert.deepEqual(destructuredNames(' a = {}, b '), ['a', 'b']);
});

// ---------------------------------------------------------------------------
// FALSE POSITIVE 2 — the index/ordering trap

test('a binding used on the next line is never reported', () => {
  // Thirteen `content` findings came from blanking pattern spans AFTER the
  // import and comment strips had already changed the string's length.
  const src = `
import { templateContent } from './kit';

// a whole-line comment, which the body preparation removes
/*
 * and a column-0 block comment, which it also removes
 */
export default function P({ data = {} }) {
  const {
    brandName = 'axal',
    content = null,
  } = data;
  const c = templateContent(content, 'seed-stage-spark');
  return render(brandName, c);
}
  `;
  assert.deepEqual(dead(src), [],
    'a binding used immediately after the pattern was reported dead — check the blank/strip order');
});

test('the right-hand side is never blanked, only the pattern', () => {
  // `const { a } = x; const { b } = a;` is a real use of `a`. Blanking the
  // whole statement instead of just the `{ … }` would report it dead.
  assert.deepEqual(dead('const { outer } = first;\nconst { inner } = outer;\nuse(inner);\n'), []);
  // The span the helper reports must stop at the closing brace.
  const [p] = destructurePatterns('const { outer } = first;');
  assert.equal('const { outer } = first;'.slice(p.start, p.end), '{ outer }');
});

test('prepareBody blanks the binding without moving anything', () => {
  const src = 'const { a } = b;\nkeep(a);\n';
  const body = prepareBody(src, destructureBindings(src));
  assert.equal(body.length, src.length, 'blanking changed the length, so indices no longer line up');
  assert.match(body, /keep\(a\);/, 'the usage line was damaged');
  // The declaration's own `a` is gone; everything else on that line stays, so
  // a right-hand side that references another binding still reads as a use.
  assert.equal(body.split('\n')[0], 'const {   } = b;');
  // Line structure survives, so a line number stays meaningful.
  assert.equal(body.split('\n').length, src.split('\n').length);
});

test('every step of prepareBody preserves length', () => {
  // The thirteen `content` false positives came from a step that did not, so
  // this is checked on real files rather than a fixture.
  for (const p of ['scripts/check-unused-imports.mjs', 'frontend/src/pages/TrustCenterPage.jsx']) {
    const src = read(p);
    assert.equal(prepareBody(src, destructureBindings(src)).length, src.length, `${p} changed length`);
    assert.equal(withoutSafeComments(src).length, src.length, `${p}: comment blanking changed length`);
    assert.equal(withoutTemplates(src).length, src.length, `${p}: template blanking changed length`);
  }
});

// ---------------------------------------------------------------------------
// FALSE POSITIVE 3 — the deliberate-omission idiom

test('a rest element skips the whole pattern, siblings included', () => {
  // `password` here is named IN ORDER to be excluded from `safe`. Reporting it
  // would ask for a change that breaks the code.
  assert.deepEqual(dead('const { password, ...safe } = user;\nsend(safe);\n'), []);
  assert.equal(destructuredNames(' password, ...safe '), null);
  assert.equal(destructuredNames(' ...only '), null);
  // Nine such patterns existed in the trees when this was written; the count is
  // not the point, but that the skip is unconditional is.
  assert.equal(destructuredNames(' a, b, ...rest '), null);
});

// ---------------------------------------------------------------------------
// Shapes the guard refuses to guess about

test('nested patterns are skipped, not misparsed', () => {
  for (const inner of [
    ' a: { b } ',          // nested object
    ' a, b: { c } ',       // nested alongside a plain one
    ' a: [first] ',        // nested array
  ]) {
    assert.equal(destructuredNames(inner), null, `${inner} was parsed rather than skipped`);
  }
  // And end to end: a nested pattern produces no finding either way.
  assert.deepEqual(dead('const { a: { b } } = x;\nuse(b);\n'), []);
  assert.deepEqual(dead('const { a: { unusedInner } } = x;\n'), [],
    'a nested pattern was reported — it must be skipped, since the parse is not trusted');
});

test('a computed key binds the name after the colon', () => {
  // `{ [k]: v }` genuinely binds `v`, so it is read rather than skipped.
  assert.deepEqual(destructuredNames(' [key]: value '), ['value']);
  assert.deepEqual(dead('const { [key]: value } = x;\nuse(value);\n'), []);
  assert.deepEqual(dead('const { [key]: value } = x;\n'), ['destructured:value']);
});

test('a default or computed key may reference another binding, and that counts', () => {
  // THE FALSE POSITIVE THAT KILLED "BLANK THE WHOLE PATTERN". A default and a
  // computed key are ordinary expressions; blanking the `{ … }` span wholesale
  // erased these uses and reported both `fallback` and `keyName` dead.
  assert.deepEqual(dead('const { fallback } = cfg;\nconst { size = fallback } = opts;\nuse(size);\n'), [],
    '`fallback` is used as a default — only the binding name may be blanked');
  assert.deepEqual(dead('const { keyName } = cfg;\nconst { [keyName]: picked } = row;\nuse(picked);\n'), [],
    '`keyName` is used as a computed key — only the binding name may be blanked');
});

test('the guard does not trip over example code in its own comments', () => {
  // It has now done this twice: CodeQL alert 5943 came from the docblock
  // mentioning `statSync`, and the destructuring half first reported three
  // bindings dead that exist only inside this very file's doc comments.
  const src = [
    '/**',
    ' * An example, not code:',
    ' *     const { onlyInAComment } = x;',
    ' */',
    'const { real } = y;',
    'use(real);',
    '',
  ].join('\n');
  assert.deepEqual(dead(src), [], 'a declaration inside a comment was treated as real');
  // Same for a whole-line `//`.
  assert.deepEqual(dead('// const { alsoJustProse } = x;\nconst { r } = y;\nuse(r);\n'), []);
  // And the guard's own source must stay clean, which is the live version of
  // this assertion.
  assert.deepEqual(dead(read('scripts/check-unused-imports.mjs')), []);
});

test('a rename binds the new name, and the old name is not a binding', () => {
  assert.deepEqual(destructuredNames(' original: renamed '), ['renamed']);
  assert.deepEqual(dead('const { original: renamed } = x;\nuse(renamed);\n'), []);
  assert.deepEqual(dead('const { original: renamed } = x;\nuse(original);\n'),
    ['destructured:renamed'], 'the key was treated as the binding');
});

test('a default value leaves the binding on the left', () => {
  assert.deepEqual(destructuredNames(' withDefault = 1 '), ['withDefault']);
  assert.deepEqual(destructuredNames(' a = () => b '), ['a'], 'an arrow default ate the binding');
  assert.deepEqual(destructuredNames(' a = x === y '), ['a'], 'an == default ate the binding');
  assert.deepEqual(dead('const { withDefault = 1 } = x;\nuse(withDefault);\n'), []);
});

test('only `const` declarations are examined', () => {
  // Parameters are an API declaration as much as a binding, and `let`/`var`
  // widen the surface for no extra findings. Narrowness is the policy.
  for (const src of [
    'function f({ unusedProp }) { return 1; }\nf();\n',
    'const f = ({ unusedProp }) => 1;\nf();\n',
    'let { unusedLet } = x;\n',
    'var { unusedVar } = x;\n',
    'try { g(); } catch ({ message }) { h(); }\n',
    'for (const { loopVar } of rows) { noop(); }\n',   // not a `= ` declaration
  ]) {
    assert.deepEqual(dead(src), [], `${src.split('\n')[0]} was examined`);
  }
});

test('`const` must be its own word, not the tail of an identifier', () => {
  assert.deepEqual(destructurePatterns('myconst { a } = x;'), []);
  assert.deepEqual(destructurePatterns('obj.const { a } = x;'), []);
  assert.equal(destructurePatterns('const { a } = x;').length, 1);
  assert.equal(destructurePatterns('export const { a } = x;').length, 1);
  // A pattern not followed by `=` is not a destructuring declaration.
  assert.deepEqual(destructurePatterns('const { a } => x;'), []);
  assert.deepEqual(destructurePatterns('const { a } == x;'), []);
});

// ---------------------------------------------------------------------------
// Where a usage may legitimately live

test('a name used only inside a template literal counts as used', () => {
  // The asymmetry the import half already relies on: templates are blanked to
  // FIND declarations, and left intact for the usage search.
  assert.deepEqual(dead('const { inTemplate } = x;\nconst s = `value: ${inTemplate}`;\nsend(s);\n'), []);
});

test('a name used only in JSX counts as used', () => {
  assert.deepEqual(dead('const { label } = props2;\nreturn <span>{label}</span>;\n'), []);
  assert.deepEqual(dead('const { cls } = props2;\nreturn <div className={cls} />;\n'), []);
});

test('a declaration inside a quoted string is not a declaration', () => {
  // Found by running the guard over THIS FILE: its own fixtures put example
  // declarations in quoted strings, and `onlyInAComment` and `alsoJustProse`
  // were reported as dead bindings. Blanking backticks alone is not enough.
  assert.deepEqual(dead(`const line = 'const { notReal } = y;';\nemit(line);\n`), []);
  assert.deepEqual(dead(`const line = "const { alsoNotReal } = y;";\nemit(line);\n`), []);
  // And the module path survives, or the import half stops matching entirely.
  assert.deepEqual(dead("import { Wanted } from 'some-module';\nuse(Wanted);\n"), []);
  assert.deepEqual(dead("import { Wanted } from 'some-module';\n"), ['imported:Wanted'],
    'string blanking reached the module path, so imports are no longer recognised at all');
  // The blanking preserves length, like every other step.
  const src = read('frontend/test/unused_imports_guard.test.mjs');
  assert.equal(withoutStrings(src).length, src.length);
});

test('a declaration inside a template literal is not a declaration', () => {
  // A test that assembles source in a template and evaluates it at runtime —
  // `cloudflare-worker/test/wellbeing_route.test.mjs` does exactly this, and it
  // produced four false positives when the import half was widened to the test
  // trees.
  assert.deepEqual(dead('const composed = `const { notReal } = y;`;\nrun(composed);\n'), []);
});

test('shorthand object construction is a use', () => {
  assert.deepEqual(dead('const { a, b } = x;\nconst payload = { a, b };\nsend(payload);\n'), []);
});

// ---------------------------------------------------------------------------
// The import half, unchanged

test('the import half still finds an unused named import', () => {
  assert.deepEqual(dead("import { Used, Unused } from 'lucide-react';\nrender(Used);\n"),
    ['imported:Unused']);
});

test('a type-only import is unwrapped before it is checked', () => {
  // Eight false positives in `captable.ts` came from leaving the `type `
  // prefix on, which made every one read as unused.
  assert.deepEqual(namedImports("import { type Foo, Bar } from './t';").map((n) => n.name),
    ['Foo', 'Bar']);
  assert.deepEqual(dead("import { type Foo } from './t';\nconst x: Foo = y;\n"), []);
  assert.deepEqual(dead("import { type Foo } from './t';\n"), ['imported:Foo']);
});

test('an alias and a default-plus-named import still resolve', () => {
  assert.deepEqual(namedImports("import { original as alias } from 'm';").map((n) => n.name), ['alias']);
  assert.deepEqual(namedImports("import React, { useState } from 'react';").map((n) => n.name), ['useState']);
  assert.deepEqual(dead("import React, { useState } from 'react';\nuseState(0);\nReact;\n"), []);
});

test('both kinds are reported together, each labelled', () => {
  const found = deadBindings("import { DeadImport } from 'm';\nconst { deadLocal } = x;\n");
  assert.deepEqual(found.map((f) => f.kind).sort(), ['destructured', 'imported']);
  assert.deepEqual(found.map((f) => f.name).sort(), ['DeadImport', 'deadLocal']);
});

// ---------------------------------------------------------------------------
// The bracket scanner, on its own

test('matchBracket finds the real closing brace', () => {
  const s = 'const { a: fn(1), b } = x;';
  const open = s.indexOf('{');
  assert.equal(s.slice(open, matchBracket(s, open)), '{ a: fn(1), b }');
  // A `}` inside a string is not the end.
  const q = `{ a = '} not the end', b }`;
  assert.equal(matchBracket(q, 0), q.length);
  // Unbalanced input is refused, never guessed at.
  assert.equal(matchBracket('{ a, b', 0), -1);
  assert.equal(matchBracket('{ a )', 0), -1, 'a mismatched closer was accepted');
});

test('topIndexOf ignores everything that is not top level', () => {
  assert.equal(topIndexOf('a = 1', '='), 2);
  assert.equal(topIndexOf('a === b', '='), -1, '=== was read as an assignment');
  assert.equal(topIndexOf('a => b', '='), -1, 'an arrow was read as an assignment');
  assert.equal(topIndexOf("a = '=' ", '='), 2);
  assert.equal(topIndexOf('fn(x = 1)', '='), -1, 'an = inside a call was top level');
  assert.equal(topIndexOf('key: value', ':'), 3);
  assert.equal(topIndexOf('a: { b: c }', ':'), 1, 'the nested colon won');
});

// ---------------------------------------------------------------------------
// The whole-identifier test, which used to be a constructed regex

test('a name matches only as a whole identifier', () => {
  assert.equal(used('use(name);', 'name'), true);
  assert.equal(used('const xnamey = 1;', 'name'), false, 'a substring counted as a use');
  assert.equal(used('const name_2 = 1;', 'name'), false);
  assert.equal(used('const _name = 1;', 'name'), false);
  assert.equal(used('const name2 = 1;', 'name2'), true);
  // Both file edges count as boundaries.
  assert.equal(used('name', 'name'), true);
  assert.equal(used('name;', 'name'), true);
  assert.equal(used('(name', 'name'), true);
  assert.equal(used('', 'name'), false);
  // A property access is a use, same as the `\b` version treated it.
  assert.equal(used('obj.name', 'name'), true);
  // And the scan must not stop at the first near-miss.
  assert.equal(used('xnamey; then name;', 'name'), true,
    'the search gave up after a rejected candidate');
});

test('a `$`-prefixed identifier is matched — the bug `\\b` hid', () => {
  // `\b` uses JavaScript's word definition, in which `$` is NOT a word
  // character, so `\b\$foo\b` never matched ` $foo;` and a `$`-prefixed
  // binding read as dead however much it was used. No such binding exists in
  // the repo today, which is why this went unnoticed rather than unbroken.
  assert.equal(used('const x = $dollar;', '$dollar'), true);
  assert.deepEqual(dead('const { $ref } = x;\nuse($ref);\n'), []);
  assert.deepEqual(dead('const { $ref } = x;\n'), ['destructured:$ref']);
  assert.equal(used('const x = $dollarish;', '$dollar'), false,
    'a $-prefixed name matched a longer identifier');

  // AND THE OTHER DIRECTION, which is what actually requires `$` to be in
  // IDENT_CHAR: a `$` ADJACENT to the match means this is a different
  // identifier. `$` inside the name never tests the character class at all,
  // because only the two boundary characters are inspected.
  assert.equal(used('const $name = 1;', 'name'), false,
    '`$name` was read as a use of `name` — `$` is missing from IDENT_CHAR');
  assert.equal(used('const name$ = 1;', 'name'), false,
    '`name$` was read as a use of `name`');
  assert.deepEqual(dead('const { name } = x;\nuse($name);\n'), ['destructured:name'],
    '`$name` counted as a use of the binding `name`');
});

test('the guard builds no regex from a name', () => {
  // Semgrep alert 6079 (`detect-non-literal-regexp`) fired on the constructed
  // pattern. A plain scan removes the shape instead of suppressing it, and
  // this keeps it removed — a `nosemgrep` comment here would be the tell that
  // someone put the regex back.
  const src = read('scripts/check-unused-imports.mjs');
  assert.doesNotMatch(src, /new RegExp/,
    'a constructed regex is back in the guard — Semgrep will flag it again');
  assert.doesNotMatch(src, /nosemgrep/,
    'the finding was suppressed rather than fixed');
});

// ---------------------------------------------------------------------------
// Wiring

test('the guard runs in test:guards and is documented', () => {
  const pkg = read('package.json');
  assert.match(pkg, /node scripts\/check-unused-imports\.mjs/,
    'the guard is not in test:guards, so nothing runs it on a PR');
  const readme = read('scripts/README.md');
  assert.match(readme, /`check-unused-imports\.mjs`/,
    'add the check-unused-imports.mjs row to scripts/README.md');
  const row = readme.split('\n').find((l) => l.includes('`check-unused-imports.mjs`')) || '';
  // Both halves, and the one caveat a reader would otherwise be surprised by.
  // Matching merely /destructur/i was too loose: the row names the destructured
  // shape early on, so it passed even when the narrowing claim was removed.
  assert.match(row, /import \{ a \} from/, 'the README row no longer names the import shape');
  assert.match(row, /const \{ a \} = obj/, 'the README row no longer names the destructured shape');
  assert.match(row, /`const` only/, 'the README row dropped the const-only narrowing');
  assert.match(row, /rest element/, 'the README row dropped the rest-element caveat');
});

test('importing the guard does not run the scan', () => {
  // It calls `process.exit(1)` on a finding, so an unguarded module body would
  // kill this test process the moment anything in the repo went dead.
  const src = read('scripts/check-unused-imports.mjs');
  assert.match(src, /if \(import\.meta\.url === pathToFileURL\(process\.argv\[1\] \|\| ''\)\.href\) main\(\);/,
    'the scan is not behind a main guard');
  const body = src.slice(src.indexOf('function main()'));
  assert.match(body, /process\.exit\(1\)/, 'a finding no longer fails the guard');
  // And the exports this test depends on are real.
  assert.ok(Array.isArray(TREES) && TREES.includes('frontend/src'));
});
