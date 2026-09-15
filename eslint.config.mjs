/**
 * ESLint, for one rule: `no-undef`.
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
 * THE GAP THIS DOES NOT CLOSE: `frontend/src`'s 27 `.ts`/`.tsx` files.
 * The glob below is `{js,jsx}` because espree cannot parse TypeScript, and the
 * usual answer — "`tsc --noEmit` already refuses an undefined name" — is not
 * available here: `test:types` compiles `cloudflare-worker` ONLY, and the SPA
 * has no tsconfig at all. Vite strips those types without checking them. So
 * those 27 files are guarded against this bug class only by the 14 hook names
 * `check-react-hook-imports.mjs` knows.
 *
 * The gap is real and currently empty: a probe tsconfig over those files
 * reports 15 errors and **zero** TS2304 ("cannot find name"), so nothing is
 * undefined in them today. Closing it properly means a frontend `tsc --noEmit`,
 * which means first resolving those 15 — a miscategorised template pair, a
 * timeline handed `{year, event}` where it wants `{date, label}`, an `.initials`
 * read off a `{name}` object. Each is a judgement about deck output rather than
 * a lint fix, so it is its own task instead of being bolted onto this one.
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
