/**
 * ESLint, for three rules that need scope analysis: `no-undef`, then
 * `no-unused-vars` (D164) and `no-use-before-define` (D307). It began as one.
 *
 * WHY A LINTER AND NOT ANOTHER `check-*.mjs`. This repo already carries two
 * bespoke guards aimed at this bug class, and one of them says in its own header
 * why they are not enough: *"A general undefined-identifier check is a linter's
 * job and would need real scope analysis to avoid false positives; hooks are
 * worth special-casing because they are the names most often added to a
 * component body long after the import line."* That is
 * `scripts/check-react-hook-imports.mjs`, written after `PublicNav.jsx` called
 * `useState` without importing it and took the public apex down with "Can't find
 * variable: useState" on first paint.
 *
 * The bug it could not catch is the other one: **a name declared in one
 * component and read in a sibling.** `FounderGrowFocus.jsx` had three —
 * `metCount`, `measured`, `readTargets` — declared in the host and read in
 * `FocusContent`, which blanked `/grow/focus` with a `ReferenceError` at render.
 * Vite bundled it without complaint, because an undefined identifier is a
 * RUNTIME error and not a build one. Two of the three were found by CodeQL and
 * the third by a browser.
 *
 * Scope analysis is what separates those cases, and writing scope analysis by
 * hand is writing a linter. So: a linter, with everything off except the rule
 * that needed it.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. No style rules, no `react-hooks`, no
 * `import/*`, no formatting. Every one of those is a judgement call about house
 * style that nobody has made, and turning them on here would put hundreds of
 * findings between this rule and the next person who runs it.
 *
 * The two bespoke scripts stay. `check-unused-imports.mjs` guards the opposite
 * direction — a name imported and never used — which `no-undef` cannot see, and
 * it reaches five trees this config does not (`cloudflare-worker/src`,
 * `scripts/`, and both test trees). `check-react-hook-imports.mjs` is scoped to
 * `frontend/src` exactly like this config, so within `.js`/`.jsx` it is now
 * coverage-redundant — verified by mutation, not assumed: deleting `useState`
 * from an import line is caught here too. It is kept for the `.ts`/`.tsx` gap
 * below and because it names the specific failure, which a generic
 * `'useState' is not defined` does not.
 *
 * THE GAP THIS FILE DOES NOT REACH: `frontend/src`'s `.ts`/`.tsx` files. The
 * glob below is `{js,jsx}` because espree cannot parse TypeScript, and that has
 * not changed. What HAS changed is the sentence this paragraph used to carry —
 * "the SPA has no tsconfig at all" — which stopped being true at #201/D96:
 * `frontend/tsconfig.json` exists and runs as `test:types:frontend`, inside
 * `test:drift`. So those files are type-checked, and an undefined name in them
 * is a compile error rather than something only the 14 hook names in
 * `check-react-hook-imports.mjs` would catch.
 *
 * D164 made that tsconfig carry the unused half too, with `noUnusedLocals`.
 * The division of labour across the three checks is now clean, and each covers
 * what the others structurally cannot:
 *
 *   this config          `.js`/`.jsx` — undefined names, unused ones, and
 *                        (D307) names read in their own scope before the
 *                        line that declares them
 *   frontend tsconfig    `.ts`/`.tsx` — all three, via tsc (TS2448 is the
 *                        third)
 *   check-unused-imports five trees this config never sees, imports and
 *                        destructured locals, including the worker and tests
 */
import globals from 'globals';

/**
 * Rule names the source already suppresses, defined as no-ops.
 *
 * 119 of the first run's 122 errors were not findings. They were
 * `eslint-disable` comments already in the source naming rules from plugins this
 * config does not install — `react-hooks/exhaustive-deps` (77),
 * `jsx-a11y/*` (2) — plus 40 "unused disable directive". ESLint errors on a
 * disable comment for a rule it cannot resolve, so those directives turned a
 * three-finding run into a wall.
 *
 * The alternatives were worse. Installing both plugins to make the names resolve
 * pulls in two dependencies for spelling alone. Deleting 119 comments from files
 * this task is not about would bury the two real bugs in an unreviewable diff,
 * and those comments are notes from whoever wrote the code — they say something
 * about the deps array even with no linter to enforce it.
 *
 * So the names resolve to rules that do nothing, and
 * `reportUnusedDisableDirectives` stays off because under that definition every
 * one of them is trivially unused. If a later pass turns these plugins on for
 * real, this block is what it deletes.
 */
const suppressed = (names) => ({
  rules: Object.fromEntries(names.map((n) => [n, { create: () => ({}) }])),
});

export default [
  {
    // The SPA's JS and JSX. The worker is out of scope for a good reason —
    // `tsc --noEmit` over `cloudflare-worker/src` already refuses an undefined
    // name, the same guarantee by a better route, and it is in `test:drift` as
    // `test:types`. The SPA's own `.ts`/`.tsx` files are out of scope for a bad
    // one: see the gap in the header.
    files: ['frontend/src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        // espree parses JSX natively; no Babel parser is needed for this rule.
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        // Vite's define-time constants and the two build globals this app reads.
        __APP_VERSION__: 'readonly',
        __BUILD_TIME__: 'readonly',
        process: 'readonly',
      },
    },
    plugins: {
      'react-hooks': suppressed(['exhaustive-deps', 'rules-of-hooks']),
      'jsx-a11y': suppressed([
        'no-static-element-interactions', 'click-events-have-key-events',
      ]),
    },
    linterOptions: {
      // Off, because every directive above is "unused" against a no-op rule. See
      // the `suppressed` docblock.
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      'no-undef': 'error',
      /**
       * D164 — the other half of the same bug class, and the reason eighteen
       * CodeQL "unused variable" alerts got through at once.
       *
       * `check-unused-imports.mjs` covers a name IMPORTED or DESTRUCTURED and
       * never used; its detection is `const\s*(?=\{)`, a lookahead that
       * REQUIRES a brace, so a plain `const Foo = …` or `function Foo()` is
       * invisible to it by construction. Scope analysis is what separates a
       * declaration nobody reads from one read in a sibling closure, and that
       * is this linter's job, not a regex's — the same argument the `no-undef`
       * docblock above makes, pointed the other way.
       *
       * FOUR SCOPING DECISIONS, each one measured rather than defaulted. Run
       * bare, this rule reports 523 findings; every exclusion below is here
       * because the alternative is worse, not because the number was too big.
       *
       *   args: 'none' — 78 findings, almost all positional React callback
       *     parameters (`(event, index) => …` using only `index`). You cannot
       *     drop a leading parameter without changing what the rest bind to,
       *     so the rule would demand renames that buy nothing.
       *
       *   caughtErrors: 'none' — `catch {}` without a binding is already the
       *     house style; flagging `catch (e)` where `e` goes unread would push
       *     people to drop the binding they may want when debugging.
       *
       *   ignoreRestSiblings: true — THE ONE THAT WOULD HAVE CAUSED A BUG.
       *     `const { plan, tier, investor_tier, ...rest } = metadata` names
       *     those three ONLY to omit them from `rest`; the binding being unread
       *     is the entire point. Deleting them, as an autofix proposed, would
       *     silently carry the keys through — a behaviour change dressed as
       *     cleanup. `AdminPage.jsx` and `NeedsBoardPage.jsx` both use the
       *     idiom with a comment saying why.
       *
       *   varsIgnorePattern '^(React|_)$' — 425 of the 523 are the identifier
       *     `React`, the legacy `import React from 'react'` that 446 files
       *     still carry although both the Vite plugin and tsconfig use the
       *     automatic JSX runtime. Removing them is a codemod and its own PR,
       *     so this is a SCOPING decision awaiting that work, not a
       *     suppression — and `check-unused-imports.mjs:18` already declines
       *     default imports for a related reason. `_` is the throwaway binding
       *     in `for (const _ of str) n++`, where the syntax requires a name
       *     and the value is genuinely not wanted.
       *
       * What survives all four is 20 real findings, which is why this ships
       * with no baseline file: a ledger holding entries the same commit
       * deletes is a file that exists only to be deleted again.
       */
      'no-unused-vars': ['error', {
        args: 'none',
        caughtErrors: 'none',
        ignoreRestSiblings: true,
        varsIgnorePattern: '^(React|_)$',
      }],
      /**
       * D307 — a name read before its `const` runs, in the same scope.
       *
       * #871 put a `useMemo` in `InvestorNetworkWorkspace.jsx` whose dependency
       * array named `visibleRelationships` thirty lines ABOVE the `const` that
       * declares it. A dependency array is evaluated when the hook is CALLED,
       * during render, so the read hit the temporal dead zone and every render
       * of every investor `/network` zone threw "Cannot access
       * 'visibleRelationships' before initialization". `no-undef` cannot see it —
       * the name IS defined, just later — and neither can a bundler, because a
       * TDZ read is a runtime error, the same reason the header gives for why
       * this file exists at all.
       *
       * TWO OPTIONS, each measured across the SPA's `.js`/`.jsx` with a scratch
       * config (`--no-config-lookup` silently ignores `.jsx`, so that run's
       * "zero" covered `.js` only and was thrown away):
       *
       *   defaults                        1576 findings
       *   functions: false                  74
       *   functions: false, variables: false 0
       *
       *   functions: false — a function DECLARATION is hoisted with its body, so
       *     calling one above where it is written is correct JavaScript, and
       *     1502 of the 1576 were exactly that: helpers kept at the bottom of a
       *     module, which is house style.
       *
       *   variables: false — the remaining 74 were all a closure in one scope
       *     reading a `const` from an enclosing one (a handler, an effect, a
       *     callback that runs AFTER the declaration line has executed). Sampled
       *     and every one safe. With this option the rule still reports a read
       *     in the SAME scope as its declaration — which is exactly the TDZ
       *     shape: a dependency array, a hook argument, or any expression that
       *     runs during render above the line that initialises it.
       *
       * Verified against the defect rather than argued: with the original
       * ordering restored the rule reports it at the dependency array
       * (`InvestorNetworkWorkspace.jsx`, 255:7), and with the rule removed the
       * same ordering lints clean. `classes` stays at its default; it changed no
       * finding either way. `.ts`/`.tsx` are covered by `tsc`, which refuses a
       * same-scope use before declaration as TS2448 in `test:types:frontend`.
       */
      'no-use-before-define': ['error', { functions: false, variables: false }],
    },
  },
  {
    /**
     * The deck builders run in the browser AND under `node --test`.
     *
     * `buildDeck.js` ends `abToBase64` with
     * `(typeof btoa === 'function') ? btoa(bin) : Buffer.from(bin, 'binary')…` —
     * correct in both places, and `no-undef` cannot see that the `Buffer` branch
     * is unreachable in a browser. This is the one finding of the three that was
     * the rule's blind spot rather than a bug, so it is declared rather than
     * changed: rewriting working code to satisfy a linter that cannot read a
     * `typeof` guard would be the wrong way round.
     *
     * Scoped to `decks/` alone. Declaring node globals across the whole SPA would
     * hide a real `process.env` or `require` reaching a browser bundle.
     */
    files: ['frontend/src/decks/**/*.{js,jsx}'],
    languageOptions: { globals: { ...globals.node } },
  },
];
