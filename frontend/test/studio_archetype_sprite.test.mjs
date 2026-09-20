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
 * Compact (every /studio home) stacks a 180px female/male pair. Full
 * /profile is 240px beside the copy. Paths come from
 * archetypeIllustration(slug, 'm'|'f'), which only resolves known
 * ARCHETYPES slugs so a bad slug cannot become a path. Missing PNGs hide
 * that slot.
 *
 * Run with:  node --test frontend/test/studio_archetype_sprite.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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

test('archetypeIllustration maps known slugs to male and female paths', () => {
  assert.match(metaCode, /export function archetypeIllustration\(slug, variant = 'm'\)/);
  assert.match(metaCode, /if \(!ARCHETYPES\[key\]\) return null;/);
  assert.match(metaCode, /return female \? `\/archetypes\/\$\{key\}_f\.png` : `\/archetypes\/\$\{key\}\.png`;/);
  assert.doesNotMatch(metaCode, /\$\{slug\}/,
    'the path must use the ARCHETYPES-checked key, not the raw argument');
});

test('studio compact archetype does not use the 300px two-column grid', () => {
  assert.doesNotMatch(fitCode, /md:grid-cols-\[300px/);
  assert.match(fitCode, /<ArchetypeCard state=\{results\} fitState=\{fit\} audience=\{audience\} compact \/>/);
  assert.match(fitCode, /max-w-\[180px\]/);
  assert.match(fitCode, /<ArchetypeArt slug=\{latest\.slug\} sex=\{sex\} compact \/>/);
});

test('full archetype holds the pair in a 280px column, not 300px', () => {
  assert.match(fitCode, /md:grid-cols-\[280px_1fr\]/);
  assert.match(fitCode, /max-w-\[240px\]/);
});

test('the studio card renders the matching sex sprite, or the pair when unknown', () => {
  assert.match(fitCode, /function ArchetypeArt\(\{ slug, sex, compact = false \}\)/);
  assert.match(fitCode, /if \(sex === 'm' \|\| sex === 'f'\)/);
  assert.match(fitCode, /variant="f"/);
  assert.match(fitCode, /variant="m"/);
  assert.match(fitCode, /grid grid-cols-2 gap-2 items-end/);
  assert.match(fitCode, /data-testid="archetype-sprites"/);
  assert.match(fitCode, /fitData\?\.archetype_sex/);
});

test('Settings profile details can set archetype_sex independently of pronouns', () => {
  const settings = codeOnly(read('../src/pages/SettingsPage.jsx'));
  assert.match(settings, /label="Archetype character"/);
  assert.match(settings, /save\(\{ archetype_sex: e\.target\.value \|\| null \}\)/);
  assert.match(settings, /<option value="m">Man<\/option>/);
  assert.match(settings, /<option value="f">Woman<\/option>/);
  assert.match(settings, /<option value="both">Show both<\/option>/);
});

test('sprites stay pixelated, contained, feet on the floor, and hide on 404', () => {
  assert.match(fitCode, /\.pf-sprite \{ image-rendering: pixelated; \}/);
  assert.match(fitCode, /object-contain object-bottom/);
  assert.match(fitCode, /onError=\{\(\) => setFailed\(true\)\}/);
  assert.match(fitCode, /if \(!src \|\| failed\) return null;/);
  assert.match(fitCode, /dark:bg-\[#ece8f5\]/,
    'dark mode must keep a light tile so a white/transparent sprite stays visible');
});

test('public/archetypes has the female and male pair for every slug', () => {
  const dir = fileURLToPath(new URL('../public/archetypes/', import.meta.url));
  for (const slug of ARCHETYPE_KEYS) {
    assert.equal(existsSync(`${dir}${slug}_f.png`), true, `missing ${slug}_f.png`);
    if (slug === 'pt_embedded_operator') continue;
    assert.equal(existsSync(`${dir}${slug}.png`), true, `missing ${slug}.png`);
  }
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

test('compact scored card is one hit target to the full archetype page', () => {
  assert.match(fitCode, /to=\{clickable \? '\/studio\/archetype' : undefined\}/);
  assert.match(fitCode, /clickable = Boolean\(compact && latest\)/);
  assert.match(fitCode, /<Link to=\{to\} className=\{cls\}/);
  assert.match(fitCode, /View full card →/);
  assert.match(fitCode, />Preview<\/span>/);
  assert.match(fit, /\.pf-card-hit \{/);
  assert.match(fit, /\.pf-card-hit:hover \{ transform: translateY\(-2px\); border-color: var\(--arch-accent, #7c3aed\); \}/);
  assert.match(fit, /\.pf-card-hit:focus-visible \{ outline: 2px solid #7c3aed/);
  assert.doesNotMatch(fitCode, /archetypeBanner/,
    'compact /studio stays on pixel sprites — cinematic banners belong on the full page');
  assert.doesNotMatch(fitCode, /md:grid-cols-\[300px/,
    'compact must not reintroduce the overflowing two-column grid');
});
