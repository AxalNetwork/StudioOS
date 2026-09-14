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

/** Every value the worker's own union admits, plus the two non-values. */
const WORKER_UNION = ['fundraising', 'commercial', 'event', 'narrative'];

test('the flow is decided per category, and undecided is not a synonym for deal pack', () => {
  assert.equal(shareDeckFlow('commercial'), FEEDBACK);
  assert.equal(shareDeckFlow('fundraising'), DEAL_PACK);
  assert.equal(shareDeckFlow('event'), DEAL_PACK, 'an event deck no longer falls through — it is a decision now');

  // `'narrative'` is the interesting null. The repo does not agree with itself:
  // the worker files `sequoia_classic` and `narrative_brand` under it, while the
  // frontend registry calls the first `fundraising` and the second `commercial`.
  // Picking one would be guessing which half is right, which is the bug.
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

  // Nothing promised where nothing can be delivered.
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
  assert.equal(render({ category: 'narrative', projectName: 'Basepoint', embedded: true }), '');
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
