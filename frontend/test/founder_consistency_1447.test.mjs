/**
 * #1447 — founder workspace consistency (from #1440, the founder blueprint).
 *
 *   - Liquidity is a working link in every Raise zone, not a disabled
 *     "Liquidity unavailable" pill: `/raise/liquidity` exists.
 *   - Grow lists `/comarketing` under the founder's name for it, not the admin
 *     palette's "Co-Marketing Review".
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
import AlsoIn from '../src/workspaces/AlsoIn.jsx';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const ZONES = {
  Status: 'FounderRaiseStatus.jsx',
  Pitch: 'FounderRaisePitch.jsx',
  Capital: 'FounderRaiseCapital.jsx',
  Legal: 'FounderRaiseLegal.jsx',
  'Data room': 'FounderRaiseDataRoom.jsx',
};

test('every Raise zone links Liquidity like its siblings, and none says it is unavailable', () => {
  for (const [zone, file] of Object.entries(ZONES)) {
    const code = codeOnly(read(`../src/pages/founder/${file}`));
    const nav = /<nav [^>]*aria-label="Raise sections"[\s\S]*?<\/nav>/.exec(code)?.[0];
    assert.ok(nav, `${zone}: no "Raise sections" row`);
    assert.match(nav, /<LensLink to=\{`\/raise\/liquidity\$\{query\}`\}>Liquidity<\/LensLink>/, `${zone}: Liquidity is not a link`);
    // Its siblings in the same row are the same element, so the treatment matches.
    assert.match(nav, /<LensLink to=\{`\/raise\/capital\$\{query\}`\}/, `${zone}: the row's siblings are not LensLinks`);
    assert.doesNotMatch(code, /Liquidity unavailable/, `${zone} still says Liquidity is unavailable`);
  }
});

test('the Liquidity link opens a real route', () => {
  assert.match(read('../src/App.jsx'), /<Route path="\/raise\/liquidity"/);
});

test('Grow lists co-marketing under the founder\'s label, and the partner keeps the palette one', () => {
  const founder = alsoInFor('founder', 'Grow').find((w) => w.route === '/comarketing');
  assert.ok(founder, 'Grow no longer lists /comarketing');
  assert.equal(founder.label, 'Co-marketing');
  assert.doesNotMatch(founder.description, /review/i);
  const partner = alsoInFor('partner', 'Offers').find((w) => w.route === '/comarketing');
  assert.equal(partner.label, 'Co-Marketing Review');
  // Rendered: the Grow desk draws this list.
  const html = renderToStaticMarkup(h(MemoryRouter, null, h(AlsoIn, { role: 'founder', row: 'Grow' })));
  assert.match(html, /href="\/comarketing"[^>]*>Co-marketing<\/a>/);
  assert.doesNotMatch(html, /Co-Marketing Review/);
});

test('the sidebar comment states the stage order the rows follow', () => {
  const src = read('../src/sidebarConfig.js');
  assert.doesNotMatch(src, /Home → Build → Validate → Raise → Launch/);
  assert.match(src, /Validate · Build\n\s*\/\/ · Raise · Grow · Network · Research \(#1447\)/);
});
