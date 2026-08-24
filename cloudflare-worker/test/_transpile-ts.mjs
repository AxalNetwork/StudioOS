/**
 * Type-erasure helper for the tests that load worker `.ts` source as text.
 *
 * Twelve test files read a `.ts` file off disk, snip out the function or route
 * body under test, and run it — either through `new Function(...)` or by
 * writing the result to a temporary `.mjs` and importing it. All of them need
 * exactly one thing from a compiler: the types gone. None of them need
 * downlevelling (the worker targets ES2022 and the tests run on Node 22) and
 * none need module-format conversion (the `new Function` callers strip
 * `import`/`export` themselves first; the file-writing callers want the ESM
 * they already have).
 *
 * They used to get that from `typescript`'s `ts.transpileModule`. TypeScript 7
 * is the native port and ships no JS compiler API at all — `ts.transpileModule`,
 * `ts.ScriptTarget` and `ts.ModuleKind` are all `undefined` on the 7.x package,
 * so every one of those helpers threw
 * `Cannot read properties of undefined (reading 'ES2022')` and took 90 tests
 * down with it the moment dependabot bumped 6.0.3 → 7.0.2 (#282). `tsc
 * --noEmit` was unaffected, which is why `worker (typecheck)` stayed green while
 * `test:drift` went red.
 *
 * Node's own type stripping does the same job and is not tied to the compiler
 * version, so this helper cannot break that way again. `mode: 'transform'` is
 * deliberate: it keeps the non-erasable syntax (`enum`, `namespace`, parameter
 * properties) working the way `transpileModule` did, instead of throwing on it.
 */
import { stripTypeScriptTypes } from 'node:module';

/**
 * Erase TypeScript types from `src`, returning runnable JavaScript.
 *
 * @param {string} src TypeScript source text.
 * @returns {string} The same code with types removed.
 */
export function transpileTs(src) {
  return stripTypeScriptTypes(src, { mode: 'transform' });
}

export default transpileTs;
