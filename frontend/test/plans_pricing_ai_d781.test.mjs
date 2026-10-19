/**
 * D781 (#2106) part 2 — `/plans-and-pricing` says how AI is priced, in D762's
 * words: a run is paid from the member's AI allowance first, then from their
 * tokens (D762 §1, D629's hold), above the token packs that pay for it.
 *
 * The owner's price sentence, "Model prices are Cloudflare's published rates
 * plus 25%." (D720's owner step 4), is not drawn yet: `billingMode`
 * (`cloudflare-worker/src/services/ai/pricing.ts`) answers 'cost' whatever
 * `AI_BILLING` says until D762's billing PR (#2019) makes it read the
 * variable, so the sentence would not be what a member pays.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/plans_pricing_ai_d781.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { AI_DRAW_LINE } from '../src/lib/aiTokens.js';

register(new URL('./_airailRender-hook.mjs', import.meta.url));

test('the draw-order sentence is D762\'s: the allowance first, then tokens', () => {
  assert.equal(AI_DRAW_LINE, 'Each run is paid from your AI allowance first, then from your tokens.');
});

test('/plans-and-pricing draws it under "How AI is priced", above the token packs', async () => {
  const ProductsPage = (await import('../src/pages/ProductsPage.jsx')).default;
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: ['/plans-and-pricing'] }, React.createElement(ProductsPage)));
  const section = /<section id="ai-pricing"[^>]*>([\s\S]*?)<\/section>/.exec(html)?.[1] ?? '';
  assert.match(section, />How AI is priced</);
  assert.equal(/data-testid="text-ai-draw-line">([^<]*)</.exec(section)?.[1], AI_DRAW_LINE);
  assert.ok(html.indexOf('id="ai-pricing"') > 0 && html.indexOf('id="ai-pricing"') < html.indexOf('id="token-packs"'),
    'the pricing line comes before the packs');
});
