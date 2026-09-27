/**
 * Full /studio/archetype cinematic card — banners, route, locked copy.
 *
 * Compact /studio is the RPG preview. This page is the second Claude Design
 * surface: 21:9 banners, left overlay well, strengths / blind spots /
 * complements from ARCHETYPES. Sex `both` splits the banner 50/50. The SPA
 * route is declared in App.jsx with the same labRoles guard as /studio.
 *
 * Run with:  node --test frontend/test/studio_archetype_card.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { codeOnly } from './_codeOnly.mjs';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const meta = read('../src/lib/assessmentMeta.js');
const metaCode = codeOnly(meta);
const page = read('../src/pages/ArchetypeCardPage.jsx');
const pageCode = codeOnly(page);
const app = read('../src/App.jsx');
const appCode = codeOnly(app);

const archetypeBlock = meta.match(/export const ARCHETYPES = \{([\s\S]*?)\n\};/);
const ARCHETYPE_KEYS = [...(archetypeBlock?.[1] || '').matchAll(/^\s{2}([a-z][a-z0-9_]*):\s*\{/gm)].map((m) => m[1]);

test('archetypeBanner maps known slugs to male and female webp paths', () => {
  assert.match(metaCode, /export function archetypeBanner\(slug, variant = 'm'\)/);
  assert.match(metaCode, /if \(!ARCHETYPES\[key\]\) return null;/);
  assert.match(metaCode, /return female \? `\/archetypes\/banners\/\$\{key\}_f\.webp` : `\/archetypes\/banners\/\$\{key\}\.webp`;/);
  assert.doesNotMatch(codeOnly(meta.match(/export function archetypeBanner[\s\S]*?\n\}/)?.[0] || ''), /\$\{slug\}/,
    'the path must use the ARCHETYPES-checked key, not the raw argument');
});

test('public/archetypes/banners has the female and male pair for every slug', () => {
  const dir = fileURLToPath(new URL('../public/archetypes/banners/', import.meta.url));
  const maxBytes = 220 * 1024;
  assert.ok(ARCHETYPE_KEYS.length >= 16, `expected the four-per-role set, got ${ARCHETYPE_KEYS.length}`);
  for (const slug of ARCHETYPE_KEYS) {
    for (const name of [`${slug}.webp`, `${slug}_f.webp`]) {
      const path = `${dir}${name}`;
      assert.equal(existsSync(path), true, `missing ${name}`);
      const size = statSync(path).size;
      assert.ok(size > 10_000, `${name} is too small to be a cinematic banner (${size} bytes)`);
      assert.ok(size < maxBytes, `${name} is ${size} bytes — keep banners under 220KB`);
    }
  }
});

test('the full page uses cinematic banners, not pixel sprites', () => {
  assert.match(pageCode, /archetypeBanner\(latest\.slug/);
  assert.match(page, /aspect-ratio: 21 \/ 9/);
  assert.match(pageCode, /sex === 'both'/);
  assert.match(page, /grid-template-columns: 1fr 1fr/);
  assert.match(pageCode, /data-testid="archetype-banner"/);
  assert.match(pageCode, /data-sex=\{sex\}/);
  assert.doesNotMatch(pageCode, /archetypeIllustration/);
  assert.doesNotMatch(page, /image-rendering: pixelated/);
});

test('the full page shows locked ARCHETYPES copy and a back link', () => {
  assert.match(pageCode, /data-testid="archetype-strengths"/);
  assert.match(pageCode, /data-testid="archetype-blindspots"/);
  assert.match(pageCode, /data-testid="archetype-complements"/);
  assert.match(pageCode, /data-testid="archetype-matching"/);
  assert.match(pageCode, /meta\?\.strengths/);
  assert.match(pageCode, /meta\?\.blindSpots/);
  assert.match(pageCode, /meta\?\.complements/);
  assert.match(pageCode, /meta\?\.matching/);
  assert.match(pageCode, /Who you match with/);
  assert.match(pageCode, /to="\/studio"/);
  assert.match(pageCode, /Back to studio/);
  assert.match(pageCode, /Answer a few archetype questions in the advisor to reveal your archetype/);
});

test('every archetype has a complete profile: summary, description, matching', () => {
  assert.equal(ARCHETYPE_KEYS.length, 16, 'four archetypes per licence');
  const summaries = [...meta.matchAll(/^\s+summary: '/gm)];
  const descriptions = [...meta.matchAll(/^\s+description: '/gm)];
  const leans = [...meta.matchAll(/^\s+lean: '/gm)];
  const matching = [...meta.matchAll(/^\s+matching: \[/gm)];
  const whys = [...meta.matchAll(/why: '/g)];
  assert.equal(summaries.length, 16, 'every slug needs a compact summary');
  assert.equal(descriptions.length, 16, 'every slug needs a full description');
  assert.equal(leans.length, 16, 'every slug needs a trait lean');
  assert.equal(matching.length, 16, 'every slug needs a matching set');
  assert.ok(whys.length >= 16 * 4, `matching needs a why per pair, got ${whys.length}`);
  for (const slug of ARCHETYPE_KEYS) {
    const start = meta.indexOf(`  ${slug}: {`);
    assert.ok(start >= 0, slug);
    const rest = meta.slice(start);
    const end = rest.indexOf('\n  };') >= 0 ? rest.indexOf('\n  },') : rest.indexOf('\n};');
    const block = rest.slice(0, end > 0 ? end : 4000);
    assert.match(block, /summary: '/, `${slug} summary`);
    assert.match(block, /description: '[^']{180,}/, `${slug} description must be a full paragraph`);
    assert.match(block, /matching: \[/, `${slug} matching`);
    const strengthItems = [...block.matchAll(/^\s+'[^']+',$/gm)];
    assert.ok(strengthItems.length >= 10, `${slug} needs ≥4 strengths and ≥4 blind spots plus complements`);
  }
});

test('/studio/archetype is a real SPA route with the studio guard', () => {
  assert.match(appCode, /const ArchetypeCardPage = lazy\(\(\) => import\('\.\/pages\/ArchetypeCardPage'\)\)/);
  assert.match(appCode, /path="\/studio\/archetype"/);
  assert.match(appCode, /<ArchetypeCardPage activeRole=\{effectiveRole\} \/>/);
  const studio = app.match(/path="\/studio" element=\{guard\(labRoles\(\[([^\]]+)\]\)/);
  const full = app.match(/path="\/studio\/archetype" element=\{guard\(labRoles\(\[([^\]]+)\]\)/);
  assert.ok(studio && full, 'both routes must use labRoles');
  assert.equal(studio[1], full[1], 'the full card must admit the same licences as /studio');
});
