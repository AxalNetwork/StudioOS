/**
 * Studio archetype sprites — sized for the 3-column Profile & Fit band.
 *
 * WHAT WENT WRONG. ArchetypeCard used `md:grid-cols-[300px_1fr]` inside a
 * studio column that is ~400px before padding. At a 1024px viewport the
 * content pane is ~270px, so the 300px gradient label overflowed the card
 * and the neighbouring skills/values columns. Pixel-art sprites need a
 * box that matches the radar (210px), not a second column that does not
 * fit.
 *
 * Compact (every /studio home) is a vertical 180px sprite. Full /profile
 * is 240px beside the copy. Paths come from archetypeIllustration, which
 * only resolves known ARCHETYPES slugs so a bad slug cannot become a path.
 * Missing PNGs hide the box.
 *
 * Run with:  node --test frontend/test/studio_archetype_sprite.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { codeOnly } from './_codeOnly.mjs';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const meta = read('../src/lib/assessmentMeta.js');
const fit = read('../src/components/profile/ProfileFitSection.jsx');
const fitCode = codeOnly(fit);
const metaCode = codeOnly(meta);

const SLUG_RE = /^[a-z][a-z0-9_]*$/;
const archetypeBlock = meta.match(/export const ARCHETYPES = \{([\s\S]*?)\n\};/);
const ARCHETYPE_KEYS = [...(archetypeBlock?.[1] || '').matchAll(/^\s{2}([a-z][a-z0-9_]*):\s*\{/gm)].map((m) => m[1]);

test('every ARCHETYPES key is a path-safe slug', () => {
  assert.ok(ARCHETYPE_KEYS.length >= 16, `expected the four-per-role set, got ${ARCHETYPE_KEYS.length}`);
  for (const slug of ARCHETYPE_KEYS) {
    assert.match(slug, SLUG_RE, `${slug} cannot be a public PNG filename`);
  }
});

test('archetypeIllustration maps known slugs and rejects everything else', () => {
  assert.match(metaCode, /export function archetypeIllustration\(slug\)/);
  assert.match(metaCode, /if \(!ARCHETYPES\[key\]\) return null;/);
  assert.match(metaCode, /return `\/archetypes\/\$\{key\}\.png`;/);
  assert.doesNotMatch(metaCode, /\$\{slug\}/,
    'the path must use the ARCHETYPES-checked key, not the raw argument');
});

test('studio compact archetype does not use the 300px two-column grid', () => {
  assert.doesNotMatch(fitCode, /md:grid-cols-\[300px/);
  assert.match(fitCode, /<ArchetypeCard state=\{results\} fitState=\{fit\} audience=\{audience\} compact \/>/);
  assert.match(fitCode, /h-\[180px\] w-\[180px\]/);
});

test('full archetype is 240px beside copy, not 300px', () => {
  assert.match(fitCode, /md:grid-cols-\[240px_1fr\]/);
  assert.match(fitCode, /h-\[240px\] w-\[240px\]/);
});

test('sprites stay pixelated, contained, feet on the floor, and hide on 404', () => {
  assert.match(fitCode, /\.pf-sprite \{ image-rendering: pixelated; \}/);
  assert.match(fitCode, /object-contain object-bottom/);
  assert.match(fitCode, /onError=\{\(\) => setFailed\(true\)\}/);
  assert.match(fitCode, /if \(!src \|\| failed\) return null;/);
  assert.match(fitCode, /dark:bg-\[#ece8f5\]/,
    'dark mode must keep a light tile so a white/transparent sprite stays visible');
});

test('every studio home still mounts ProfileFitSection compact', () => {
  const founder = codeOnly(read('../src/pages/founder/FounderStudioHome.jsx'));
  const investor = codeOnly(read('../src/pages/investor/InvestorStudioHome.jsx'));
  const advisor = codeOnly(read('../src/pages/advisor/AdvisorStudioHome.jsx'));
  const partner = codeOnly(read('../src/pages/partner/PartnerStudioHome.jsx'));
  assert.match(founder, /<ProfileFitSection compact \/>/);
  assert.match(investor, /<ProfileFitSection compact audience="investor" \/>/);
  assert.match(advisor, /<ProfileFitSection compact studio audience="advisor"/);
  assert.match(partner, /<ProfileFitSection compact studio audience="partner"/);
});
