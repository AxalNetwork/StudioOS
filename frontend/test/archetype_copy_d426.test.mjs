/**
 * D426 — the 16 displayed archetypes stay complete, both banners stay on
 * disk, and no string that names Eadwyn calls that output advice.
 *
 * The profiles and the banners were already on main (D320, D325). This file
 * is the guard. Scout and Steward live only on the v2 engine list (#982);
 * they get no profile and no banner.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ARCHETYPES as ENGINE, ARCHETYPES_V2 } from '../../cloudflare-worker/src/services/archetypeScoring.ts';
import { ARCHETYPES, archetypeBanner } from '../src/lib/assessmentMeta.js';
import { visibleText } from '../../scripts/check-regulated-wording.mjs';

const PERSONAS = ['founder', 'investor', 'partner', 'advisor'];
const STRING_FIELDS = ['label', 'tagline', 'lean', 'summary', 'description', 'icon', 'accent'];
const ADVICE = /\badvice\b/i;
const NAMES_EADWYN = /\bEadwyn\b/;

const displayed = PERSONAS.flatMap((persona) => ENGINE[persona]);
const slugs = displayed.map((def) => def.slug);

function walkStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) walkStrings(item, out);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) walkStrings(item, out);
  return out;
}

test('the engine shows 16 archetypes, and Scout and Steward are not among them', () => {
  for (const persona of PERSONAS) {
    assert.equal(ENGINE[persona].length, 4, persona);
  }
  assert.equal(ENGINE.coach, ENGINE.advisor, 'coach shares the advisor set');
  assert.equal(new Set(slugs).size, 16);
  assert.deepEqual(Object.keys(ARCHETYPES), slugs);
  const v2 = [...new Set(Object.values(ARCHETYPES_V2).flat().map((def) => def.slug))];
  assert.deepEqual(v2.filter((slug) => !slugs.includes(slug)).sort(), ['scout', 'steward']);
  assert.equal(ARCHETYPES.scout, undefined);
  assert.equal(ARCHETYPES.steward, undefined);
});

test('every displayed slug has every profile field, five strengths, five blind spots and five matches', () => {
  for (const def of displayed) {
    const meta = ARCHETYPES[def.slug];
    assert.ok(meta, def.slug);
    for (const field of STRING_FIELDS) {
      assert.equal(typeof meta[field], 'string', `${def.slug}.${field}`);
      assert.ok(meta[field].trim().length > 0, `${def.slug}.${field} is empty`);
    }
    assert.equal(meta.label, def.label, def.slug);
    assert.equal(meta.tagline, def.tagline, def.slug);
    assert.match(meta.accent, /^#[0-9a-fA-F]{6}$/, def.slug);
    assert.ok(meta.description.length >= 180, `${def.slug} description is a full paragraph`);
    assert.equal(meta.strengths.length, 5, def.slug);
    assert.equal(meta.blindSpots.length, 5, def.slug);
    assert.equal(meta.matching.length, 5, def.slug);
    for (const item of [...meta.strengths, ...meta.blindSpots]) {
      assert.equal(typeof item, 'string', def.slug);
      assert.ok(item.trim().length > 0, def.slug);
    }
    for (const pair of meta.matching) {
      assert.equal(typeof pair.label, 'string', def.slug);
      assert.ok(pair.label.trim().length > 0, def.slug);
      assert.equal(typeof pair.why, 'string', def.slug);
      assert.ok(pair.why.trim().length > 0, def.slug);
    }
    assert.deepEqual(meta.complements, meta.matching.map((pair) => pair.label), def.slug);
  }
});

test('all 32 banners are present, and Scout and Steward have none', () => {
  const dir = fileURLToPath(new URL('../public/archetypes/banners/', import.meta.url));
  const expected = slugs.flatMap((slug) => [`${slug}.webp`, `${slug}_f.webp`]).sort();
  const files = readdirSync(dir).filter((name) => name.endsWith('.webp')).sort();
  assert.equal(expected.length, 32);
  assert.deepEqual(files, expected);
  for (const slug of slugs) {
    assert.equal(archetypeBanner(slug, 'm'), `/archetypes/banners/${slug}.webp`);
    assert.equal(archetypeBanner(slug, 'f'), `/archetypes/banners/${slug}_f.webp`);
    for (const name of [`${slug}.webp`, `${slug}_f.webp`]) {
      const path = `${dir}${name}`;
      assert.equal(existsSync(path), true, name);
      const size = statSync(path).size;
      assert.ok(size > 10_000, `${name} is too small to be a banner (${size} bytes)`);
      assert.ok(size < 220 * 1024, `${name} is ${size} bytes — keep banners under 220KB`);
    }
  }
  assert.equal(archetypeBanner('scout'), null);
  assert.equal(archetypeBanner('steward'), null);
  assert.equal(existsSync(`${dir}scout.webp`), false);
  assert.equal(existsSync(`${dir}scout_f.webp`), false);
  assert.equal(existsSync(`${dir}steward.webp`), false);
  assert.equal(existsSync(`${dir}steward_f.webp`), false);
});

test('nothing that names Eadwyn calls that output advice', () => {
  const page = readFileSync(fileURLToPath(new URL('../src/pages/ArchetypeCardPage.jsx', import.meta.url)), 'utf8');
  const band = readFileSync(fileURLToPath(new URL('../src/components/profile/ProfileFitSection.jsx', import.meta.url)), 'utf8');
  const texts = [...walkStrings(ARCHETYPES), ...visibleText(page), ...visibleText(band)];
  const named = texts.filter((text) => NAMES_EADWYN.test(text));
  assert.ok(named.length >= 4, 'the card and the profile band still name Eadwyn');
  for (const text of named) assert.doesNotMatch(text, ADVICE, text);
  // Human operators may still be described with this word (D320). Those two
  // lines name the operator, not Eadwyn.
  const operator = ARCHETYPES.pt_embedded_operator;
  assert.match(operator.summary, /\badvice\b/);
  assert.match(operator.strengths[0], /\badvice\b/);
  assert.doesNotMatch(operator.summary, NAMES_EADWYN);
  assert.doesNotMatch(operator.strengths[0], NAMES_EADWYN);
});
