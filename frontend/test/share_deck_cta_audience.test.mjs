/**
 * A share link may not promise something its own post-NDA step cannot deliver.
 *
 * WHAT #205 WAS. `ShareDeckCTA` asked `category === 'commercial'` and let
 * everything else inherit the fundraising copy — "the SAFE, term sheet, and side
 * letters are ready for your review". `ShareViewerSignupModal` gated both the
 * deal-pack fetch and the post-NDA branch on `category === 'fundraising'`. For an
 * `'event'` deck those two disagreed, so a Demo Day viewer read the promise,
 * signed the NDA on the strength of it, and landed on a panel with NO BRANCH AT
 * ALL. Not an error state, not an empty state — nothing rendered. The NDA was
 * already signed by then.
 *
 * Neither file could see it, because neither knew what the other branched on.
 * So the rule now lives in `lib/shareDeckAudience.js` and the durable assertion
 * here is the LAST test: neither file may compare `category` to a literal again.
 * A render test pins today's behaviour; that one pins the coupling that made
 * today's behaviour possible to get wrong.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/share_deck_cta_audience.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DEAL_PACK, FEEDBACK, asksForFeedback, offersDealPack, shareDeckFlow,
} from '../src/lib/shareDeckAudience.js';
import ShareDeckCTA from '../src/components/ShareDeckCTA.jsx';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const render = (props) => renderToStaticMarkup(React.createElement(ShareDeckCTA, props));

/**
 * Every value the worker's own union admits — READ OUT OF THE SOURCE, not
 * copied.
 *
 * It was a hand-written list until #207, and that is precisely how it went
 * stale: it named `'narrative'` for as long as the worker did, so the loop
 * below could only ever check what someone remembered to type here. Parsed, the
 * constant cannot lag the union — add a fifth category to `methods.ts` without
 * mapping it and the next test fails on the spot.
 */
const WORKER_UNION = (() => {
  const src = raw('cloudflare-worker/src/services/decks/methods.ts');
  const decl = /category:\s*((?:'[a-z_]+'\s*\|\s*)*'[a-z_]+')\s*;/.exec(src);
  assert.ok(decl, "could not find the `category` union in methods.ts — has the field been renamed?");
  return [...decl[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
})();

test('the union the worker admits is exactly the set this map can route', () => {
  // THE HOLE #207 CAME THROUGH. A category the worker emits but this map does
  // not know renders NO CTA — correct as a failure mode, silent as a release.
  // `'narrative'` sat in that gap for as long as it existed.
  assert.deepEqual([...WORKER_UNION].sort(), ['commercial', 'event', 'fundraising']);
  for (const category of WORKER_UNION) {
    assert.ok(shareDeckFlow(category),
      `the worker can emit "${category}" and no share link knows what to promise for it`);
  }
});

test('the flow is decided per category, and unknown is not a synonym for deal pack', () => {
  assert.equal(shareDeckFlow('commercial'), FEEDBACK);
  assert.equal(shareDeckFlow('fundraising'), DEAL_PACK);
  assert.equal(shareDeckFlow('event'), DEAL_PACK, 'an event deck no longer falls through — it is a decision now');

  // `'narrative'` is a RETIRED value, and it must keep refusing. #207 removed it
  // from all three tables (D102) after D97 left it deliberately unmapped; a
  // stored deck, a cached response or an old link can still carry the string,
  // and the right answer for it is the same as it always was — promise nothing.
  assert.equal(shareDeckFlow('narrative'), null);
  assert.equal(shareDeckFlow('made_up'), null);
  assert.equal(shareDeckFlow(''), null);
  assert.equal(shareDeckFlow(undefined), null);
  assert.equal(shareDeckFlow(null), null);
});

test('the CTA promises the deal pack only where the modal will actually fetch one', () => {
  // THE INVARIANT #205 BROKE, asserted directly rather than inferred. For every
  // value the worker can emit, the card's promise and the modal's prefetch must
  // be the same answer — they are now the same call, and this fails the moment
  // they stop being.
  for (const category of WORKER_UNION) {
    const promised = offersDealPack(category);
    const asked = asksForFeedback(category);
    assert.ok(!(promised && asked), `${category} cannot be both flows`);
    assert.equal(promised || asked, shareDeckFlow(category) !== null,
      `${category}: a category with a flow must be exactly one of the two`);
  }
});

test('each category renders the copy it can honour, and the rest render nothing', () => {
  const commercial = render({ category: 'commercial', projectName: 'Basepoint' });
  assert.match(commercial, /Tell the team what you think/);
  assert.match(commercial, /Join &amp; give feedback|Join &amp;amp; give feedback|Join & give feedback/);
  assert.doesNotMatch(commercial, /SAFE, term sheet/, 'a feedback deck must not offer a deal pack');

  for (const category of ['fundraising', 'event']) {
    const html = render({ category, projectName: 'Basepoint' });
    assert.match(html, /Want to review the deal\?/, `${category} should offer the deal review`);
    assert.match(html, /SAFE, term sheet, and side letters/, `${category} should name what it offers`);
    assert.match(html, /Basepoint/, `${category} should name the startup`);
  }

  // Nothing promised where nothing can be delivered. `'narrative'` is here as a
  // retired value rather than an undecided one since #207 — a string an old link
  // may still carry, and still not a promise.
  for (const category of ['narrative', 'made_up', '', undefined, null]) {
    assert.equal(render({ category, projectName: 'Basepoint' }), '',
      `category ${JSON.stringify(category)} must render no CTA at all`);
  }
});

test('the embedded variant follows the same rule as the standalone card', () => {
  // The Spin-Out deck injects this into its dark "Deal Readiness" slide. It has
  // its own palette and its own copy path (`makeBody(projShort)`), so it is a
  // second place the promise is made and a second place it could drift.
  const event = render({ category: 'event', projectName: 'Basepoint', embedded: true });
  assert.match(event, /Want to review the deal\?/);
  assert.equal(render({ category: 'retired_or_unknown', projectName: 'Basepoint', embedded: true }), '');
});

test('neither file may compare `category` to a literal again', () => {
  // THE ASSERTION THAT OUTLIVES THE OTHERS. The render tests above pin what the
  // code does today; this pins the thing that let it be wrong — two files each
  // holding their own idea of what a category means. Both now ask
  // `lib/shareDeckAudience`; a new `category === 'whatever'` in either one is
  // how they start disagreeing again, silently.
  for (const file of [
    'frontend/src/components/ShareDeckCTA.jsx',
    'frontend/src/components/ShareViewerSignupModal.jsx',
  ]) {
    const code = codeOnly(raw(file));
    const bare = [...code.matchAll(/category\s*===\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    assert.deepEqual(bare, [],
      `${file} compares category to ${bare.join(', ')} directly — route it through `
      + 'lib/shareDeckAudience so the card and the modal cannot disagree');
    assert.ok(code.includes("from '../lib/shareDeckAudience'"),
      `${file} should decide the flow through the shared predicate`);
  }
});
