/**
 * Three rules about `<ZoneBody>` callers, in one place, for every licence.
 *
 * WHY THIS FILE EXISTS. All three were written in
 * `advisor_expertise_zones.test.mjs` and walked `frontend/src/pages/advisor`
 * only. That was correct while the advisor tree was the only one with zones
 * built on the kit; it stopped being correct the moment the partner zones were
 * written on the same primitives, and the failure would have been silent —
 * a partner zone with the exact bug an advisor zone is forbidden from having,
 * passing a green suite. Extending the advisor file's globs to cover
 * `pages/partner` was the other option and it is worse: an advisor-named test
 * asserting partner files is a naming lie, and the next author looking for the
 * partner rules would not find them there.
 *
 * Each rule pins a defect that actually shipped. None is hypothetical:
 *
 *   1. `loading` ORing a guard in unsubordinated → the zone can never render
 *      its own error card. `/expertise/profile` spun forever in production.
 *   2. `useState(null)` dereferenced without `?.` inside ZoneBody children →
 *      throws on the FIRST render whatever `loading` says, because children are
 *      built before ZoneBody decides whether to show them.
 *   3. `|| 0` / `?? 0` on a money or count field → "not recorded" rendered as
 *      a zero, which is a different claim.
 *
 * Callers pass a root and a minimum count. The minimum is not decoration: a
 * parse that finds nothing passes silently, which is the failure mode the whole
 * exercise exists to prevent.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

/** Every `.jsx` under a root, recursively, as repo-relative paths. */
export function jsxFilesUnder(root) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(resolve(process.cwd(), d), { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${d}/${e.name}`);
      else if (e.name.endsWith('.jsx')) out.push(`${d}/${e.name}`);
    }
  };
  walk(root);
  return out;
}

/**
 * Every `<ZoneBody …>` opening tag in a source, raw.
 *
 * The tag spans several lines at most call sites, so this balances braces and
 * stops at the first `>` outside one — a line-based read would truncate every
 * multi-line call and check nothing.
 */
export function zoneBodyTags(code) {
  const tags = [];
  let at = code.indexOf('<ZoneBody');
  while (at !== -1) {
    let depth = 0;
    let end = at;
    for (let i = at; i < code.length; i += 1) {
      const ch = code[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (ch === '>' && depth === 0) { end = i; break; }
    }
    tags.push(code.slice(at, end + 1));
    at = code.indexOf('<ZoneBody', end + 1);
  }
  return tags;
}

/** The `loading={…}` expression of one tag, brace-balanced. */
export function loadingExpr(tag) {
  const key = 'loading={';
  const at = tag.indexOf(key);
  if (at === -1) return null;
  let depth = 1;
  for (let i = at + key.length; i < tag.length; i += 1) {
    if (tag[i] === '{') depth += 1;
    else if (tag[i] === '}') { depth -= 1; if (depth === 0) return tag.slice(at + key.length, i); }
  }
  return null;
}

/**
 * RULE 1 — no zone holds `loading` true past its own error.
 *
 * `ZoneBody` tests `loading` before `error`, so a caller that ORs a
 * data-presence check into `loading` makes its own error card unreachable: the
 * failed read sets `error` and leaves the data null, `!data` stays true, and
 * the skeleton renders for good with the captured message never shown.
 *
 * A `loading` expression may OR something in only if it also subordinates that
 * to the error state (`… && !x.error`), so an error always beats the skeleton.
 */
export function assertLoadingNeverOutlivesError(root, minTags) {
  const OR = /\|\|/;
  const SUBORDINATED = /&&\s*!\s*(?:[\w$]+\.)*error\b/;
  let checked = 0;
  for (const file of jsxFilesUnder(root)) {
    const code = codeOnly(read(file));
    for (const tag of zoneBodyTags(code)) {
      const expr = loadingExpr(tag);
      assert.ok(expr !== null, `${file} has a ZoneBody with no loading prop`);
      checked += 1;
      if (!OR.test(expr)) continue;
      assert.match(expr, SUBORDINATED,
        `${file}: loading={${expr.trim()}} ORs a guard in without subordinating it `
        + 'to the error state, so this zone can never render its own error card');
    }
  }
  assert.ok(checked >= minTags,
    `expected at least ${minTags} ZoneBody call sites under ${root}, parsed ${checked}`);
  return checked;
}

/**
 * RULE 2 — a ZoneBody caller never holds its draft as null.
 *
 * React evaluates a component's children WHEN THE PARENT RENDERS, before
 * ZoneBody looks at `loading` to choose between a skeleton and them. So a null
 * dereferenced in those children throws on the very first render, every time,
 * whatever `loading` says. `loading` cannot guard an expression that is BUILT
 * before it is read.
 *
 * The fix is to seed the state with its own empty shape. Optional chaining is
 * fine — `x?.y` is safe to construct — so only an unguarded deref fails.
 */
export function assertNoNullDraftDeref(root, minFiles) {
  const files = jsxFilesUnder(root).filter((f) => read(f).includes('<ZoneBody'));
  assert.ok(files.length >= minFiles,
    `only ${files.length} ZoneBody callers found under ${root} — the scan is broken`);

  for (const file of files) {
    const src = codeOnly(read(file));
    for (const m of src.matchAll(/const \[(\w+), set\w+\] = useState\(null\)/g)) {
      const name = m[1];
      const deref = new RegExp(`(?<![\\w?.])${name}\\.[a-z_]`, 'i');
      assert.ok(!deref.test(src),
        `${file}: \`${name}\` starts as null and is dereferenced without \`?.\`. `
        + 'Inside <ZoneBody> children that throws on the first render, whatever '
        + '`loading` says — seed it with its empty shape instead.');
    }
  }
  return files.length;
}

/**
 * RULE 3 — absent is never coerced to zero.
 *
 * `money`/`moneyCents` return null for an absent amount precisely so the caller
 * must decide what absent looks like. A `?? 0` or `|| 0` anywhere in that chain
 * turns "no price set" into "$0.00" — an advisor who has not priced a service
 * has not said it is free, and a client with no logged hours has not used none.
 *
 * `fields` are the column names that carry this risk on the tree being checked.
 */
export function assertAbsentIsNotZero(root, fields) {
  for (const file of jsxFilesUnder(root)) {
    const src = codeOnly(read(file));
    for (const field of fields) {
      assert.doesNotMatch(src, new RegExp(`${field}\\s*\\|\\|\\s*0`),
        `${file} coerces an absent ${field} to zero`);
      assert.doesNotMatch(src, new RegExp(`${field}\\s*\\?\\?\\s*0`),
        `${file} coerces an absent ${field} to zero`);
    }
  }
}
