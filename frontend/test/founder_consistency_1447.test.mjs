/**
 * #1447 — founder workspace consistency (from #1440, the founder blueprint).
 *
 *   - Liquidity was a working link in every Raise zone. The owner removed
 *     Liquidity & Exits (2026-10-20), so no Raise zone links it any more and
 *     `/raise/liquidity` is not a route.
 *   - D4439 moves founder co-marketing to Grow's Partner network module;
 *     partners retain the original Offers/palette address.
 *   - The sidebar's stage comment states the order the rows and the Worker's
 *     lifecycle actually follow. The lifecycle order itself is tested in
 *     `cloudflare-worker/test/lifecycle_order_1447.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import { alsoInFor } from '../src/lib/adminPlacement.js';
import FounderCoMarketingPage from '../src/pages/founder/FounderCoMarketingPage.jsx';
import { moduleToolLinks } from '../src/pages/cycles/founderToolNavigation.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const ZONES = {
  Status: 'FounderRaiseStatus.jsx',
  Capital: 'FounderRaiseCapital.jsx',
  Legal: 'FounderRaiseLegal.jsx',
  // D1109 (#2989): the Data room zone (`FounderRaiseDataRoom.jsx`, the access view) is retired;
  // its address forwards to the Data room tool's Access tab, which has no Raise sections row.
};

test('no Raise zone links Liquidity, and none says it is unavailable', () => {
  for (const [zone, file] of Object.entries(ZONES)) {
    const code = codeOnly(read(`../src/pages/founder/${file}`));
    const nav = /<nav [^>]*aria-label="Raise sections"[\s\S]*?<\/nav>/.exec(code)?.[0];
    assert.ok(nav, `${zone}: no "Raise sections" row`);
    assert.doesNotMatch(nav, /\/raise\/liquidity/, `${zone}: the row still links Liquidity`);
    // Its siblings in the same row are the same element, so the treatment matches.
    assert.match(nav, /<LensLink to=\{`\/raise\/capital\$\{query\}`\}/, `${zone}: the row's siblings are not LensLinks`);
    assert.doesNotMatch(code, /Liquidity unavailable/, `${zone} still says Liquidity is unavailable`);
  }
});

test('Liquidity has no route left: /raise/liquidity and /liquidity are gone', () => {
  const app = read('../src/App.jsx');
  assert.doesNotMatch(app, /<Route path="\/raise\/liquidity"/);
  assert.doesNotMatch(app, /<Route path="\/liquidity"/);
});

test('Grow Partner network opens the founder feed, and partners keep their Offers address', () => {
  const founder = { role: 'founder', subscription_tier: 'studio' };
  assert.deepEqual(moduleToolLinks('grow', 'partner-network', founder, '?project_id=41'),
    [{ label: 'Open co-marketing', href: '/grow/partner-network/co-marketing?project_id=41' }]);
  assert.equal(alsoInFor('founder', 'Grow').some(w => w.route === '/comarketing'), false);
  const partner = alsoInFor('partner', 'Offers').find(w => w.route === '/comarketing');
  assert.equal(partner.label, 'Co-Marketing Review');
  const html = renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/grow/partner-network/co-marketing?project_id=41'] },
    h(FounderCoMarketingPage, { user: founder })));
  assert.match(html, /href="\/grow\/partner-network\?project_id=41"/);
  assert.doesNotMatch(html, /Co-Marketing Review|Propose a pitch/);
});

test('the sidebar comment states the stage order the rows follow', () => {
  const src = read('../src/sidebarConfig.js');
  assert.doesNotMatch(src, /Home → Build → Validate → Raise → Launch/);
  assert.match(src, /Validate · Build\n\s*\/\/ · Raise · Grow · Network · Research \(#1447\)/);
});
