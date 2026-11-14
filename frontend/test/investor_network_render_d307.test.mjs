/**
 * The investor Network page renders at all (D307).
 *
 * #871 put a `useMemo` whose dependency array reads `visibleRelationships`
 * thirty lines ABOVE the `const` that declares it. A dependency array is
 * evaluated when the hook is called, during render, so every render threw
 * "Cannot access 'visibleRelationships' before initialization" and every
 * investor `/network` zone showed the error card from the 11:42Z deploy on.
 *
 * Nothing caught it because nothing rendered the page. The four network
 * guards read its source as text, and `lint:undef` enabled `no-undef` and
 * `no-unused-vars` only — a same-scope temporal-dead-zone read satisfies
 * both, because the name IS defined, just later. So this file RENDERS the
 * page, once as the overview and once per zone: a static render does not run
 * effects, so the book is still loading, and the render still has to get past
 * every hook call to reach the skeleton.
 *
 * The class is guarded by the linter, not by a regex here. `eslint.config.mjs`
 * arms `no-use-before-define` with `{ functions: false, variables: false }`,
 * which reports exactly a same-scope read above its declaration — the shape of
 * this defect in ANY component, not just this one. A first draft of this file
 * scanned this component's dependency arrays by regex instead; that is the
 * scope analysis the config's own header says belongs to a linter, and it
 * watched one file. The last test pins the rule and its two options, so the
 * guard cannot be quietly switched off or widened into noise.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

// `api.js` reads the token and the CSRF cookie at call time, not at import,
// but the page's module graph is loaded here with no DOM at all.
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.document ??= { cookie: '', getElementById: () => null };

const { default: InvestorNetworkWorkspace } = await import('../src/pages/investor/InvestorNetworkWorkspace.jsx');
const { default: eslintConfig } = await import('../../eslint.config.mjs');

const render = (props) => renderToStaticMarkup(
  createElement(MemoryRouter, { initialEntries: ['/network'] },
    createElement(InvestorNetworkWorkspace, props)),
);

for (const zone of [null, 'relationships', 'introductions', 'organizations']) {
  test(`the page renders, zone ${zone ?? 'overview'}`, () => {
    let html;
    assert.doesNotThrow(() => { html = render({ zone, embedded: true }); },
      'the investor Network page throws during render');
    assert.ok(html && html.length > 0, 'the render produced no markup');
  });
}

test('the SPA lint refuses a same-scope read above its declaration', () => {
  const spa = eslintConfig.find((block) =>
    Array.isArray(block.files) && block.files.includes('frontend/src/**/*.{js,jsx}') && block.rules);
  assert.ok(spa, 'the frontend/src config block was not found');
  const rule = spa.rules['no-use-before-define'];
  assert.ok(Array.isArray(rule), 'no-use-before-define is not armed on frontend/src');
  assert.equal(rule[0], 'error', 'no-use-before-define must fail the lint, not warn');
  // `variables: false` is what keeps a closure reading a later `const` legal
  // while still reporting a read in the SAME scope — the TDZ shape. `true`
  // would bury this defect under 74 safe closure reads; dropping the option
  // object would add 1502 hoisted function calls on top.
  assert.deepEqual(rule[1], { functions: false, variables: false },
    'the options changed; re-measure the finding counts in eslint.config.mjs before shipping');
});
