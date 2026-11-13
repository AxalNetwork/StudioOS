// D4120 (#4120) — SkillEnergy: a skill's coded energy image (the SkillEnergy
// canvas, owner pick: style B, radiating rays), and the one table of area
// tokens that SkillEnergy, the Team › Skills area chips and the SkillRadar's
// axes share.
//
//   · the tokens: 8 areas in the radar's order, 8 distinct hue families, and
//     every token at least 4.5:1 on its background in both themes;
//   · determinism: the same input gives the same SVG; the slug, area and level
//     each change it;
//   · the canvas: every EN2 cell (8 areas × 5 levels × light and dark) hashes
//     to the canvas generator's own output;
//   · direction and density: the longest ray points at the area's angle, and
//     a higher level draws more;
//   · decorative: aria-hidden, no text inside, still unless motion is asked
//     for, and motion stops under prefers-reduced-motion;
//   · the wiring: a skill card draws its skill's image (none without a tagged
//     area), the chips carry the area dot, the radar's labels the area colour.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/skill_energy_d4120.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { SKILL_AXIS_ORDER } from '../src/lib/assessmentMeta.js';
import { SKILL_AREAS, SKILL_LEVELS, areaOf, areaVars } from '../src/lib/skillAreas.js';
import { SIZES, skillEnergySpec, skillEnergySvg, slugHash } from '../src/ui/skillEnergyModel.js';
import SkillEnergy from '../src/ui/SkillEnergy.jsx';
import { SkillEnergy as FromBarrel } from '../src/ui/index.js';
import { AreaDot, SkillCard, TaxChips } from '../src/pages/team/SkillParts.jsx';
import { energyOf, tagChip } from '../src/pages/team/skillsModel.js';
import { AreaTick } from '../src/components/play/SkillRadar.jsx';
import { EN2_HASHES, EN2_SLUGS } from './fixtures/skill_energy_en2.mjs';

const h = React.createElement;
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const UID = /se[0-9a-z]+B\d+[ld]\d_[0-9a-z]+/g;
const norm = (svg) => svg.replace(UID, 'UID');

// ---------------------------------------------------------------- the tokens

const lum = (hx) => {
  const c = [1, 3, 5].map((i) => parseInt(hx.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// OKLCH hue, the space the canvas built the 8 families in (sRGB → linear → OKLab).
const hueOf = (hx) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hx.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return (Math.atan2(B, A) * 180 / Math.PI + 360) % 360;
};
const hueGap = (a, b) => { const x = Math.abs(a - b) % 360; return Math.min(x, 360 - x); };

test('the 8 areas are the radar\'s 8 axes, in its order, each 45° apart clockwise from the top', () => {
  assert.deepEqual(SKILL_AREAS.map((a) => a.axis), SKILL_AXIS_ORDER);
  assert.deepEqual(SKILL_AREAS.map((a) => a.angle), [0, 45, 90, 135, 180, 225, 270, 315]);
  assert.equal(areaOf('finance_ops').name, 'Finance');
  assert.equal(areaOf('Finance').axis, 'finance_ops');
  assert.equal(areaOf('finance').axis, 'finance_ops');
  assert.equal(areaOf('nope'), null);
  assert.deepEqual(areaVars('legal_compliance'), { '--area-l': '#bf2374', '--area-d': '#ec72a6' });
  assert.equal(areaVars(''), undefined);
});

test('8 distinct hue families, and each area also has its own stroke rhythm (colour-blind safe)', () => {
  for (const theme of ['light', 'dark']) {
    const hues = SKILL_AREAS.map((a) => hueOf(a[theme]));
    for (let i = 0; i < hues.length; i++) for (let j = i + 1; j < hues.length; j++) {
      assert.ok(hueGap(hues[i], hues[j]) >= 15, `${theme}: ${SKILL_AREAS[i].name} and ${SKILL_AREAS[j].name} are ${hueGap(hues[i], hues[j]).toFixed(0)}° apart`);
    }
  }
  assert.equal(new Set(SKILL_AREAS.map((a) => a.hue)).size, 8);
  assert.equal(new Set(SKILL_AREAS.map((a) => a.dash)).size, 8, 'every area draws its own dash pattern');
  assert.equal(SKILL_AREAS[0].light, '#7c3aed', 'Product is Axal violet');
  assert.equal(SKILL_AREAS[0].dark, '#a78bfa');
});

test('every token is at least 4.5:1: light on #ffffff, dark on #111827', () => {
  for (const a of SKILL_AREAS) {
    assert.ok(contrast(a.light, '#ffffff') >= 4.5, `${a.name} light ${contrast(a.light, '#ffffff').toFixed(2)}:1`);
    assert.ok(contrast(a.dark, '#111827') >= 4.5, `${a.name} dark ${contrast(a.dark, '#111827').toFixed(2)}:1`);
  }
});

// ---------------------------------------------------------------- the generator

test('determinism: the same input gives the same SVG; the slug, the area and the level each change it', () => {
  const base = { slug: 'runway-model', area: 'Finance', level: 3, size: 96, theme: 'light' };
  assert.equal(skillEnergySvg(base), skillEnergySvg({ ...base }));
  assert.equal(slugHash('runway-model'), slugHash('runway-model'));
  assert.notEqual(norm(skillEnergySvg({ ...base, slug: 'burn-review' })), norm(skillEnergySvg(base)));
  assert.notEqual(norm(skillEnergySvg({ ...base, area: 'Legal' })), norm(skillEnergySvg(base)));
  assert.notEqual(norm(skillEnergySvg({ ...base, level: 4 })), norm(skillEnergySvg(base)));
  // EN3: six Finance skills at Proficient are six different pictures.
  const six = ['runway-model', 'unit-economics', 'burn-review', 'pricing-model', 'cash-forecast', 'budget-variance'].map((slug) => norm(skillEnergySvg({ ...base, slug, size: 160 })));
  assert.equal(new Set(six).size, 6);
});

test('the canvas: every EN2 cell (8 areas × 5 levels, light and dark, 96 px) is the canvas generator\'s own SVG', () => {
  assert.equal(Object.keys(EN2_HASHES).length, 80);
  for (const theme of ['light', 'dark']) {
    for (const a of SKILL_AREAS) {
      for (let level = 1; level <= 5; level++) {
        const svg = skillEnergySvg({ slug: EN2_SLUGS[a.name], area: a.name, level, size: 96, theme });
        const got = createHash('sha256').update(norm(svg)).digest('hex').slice(0, 16);
        assert.equal(got, EN2_HASHES[`${theme}:${a.name}:${level}`], `EN2 ${theme} ${a.name} level ${level}`);
      }
    }
  }
});

test('direction: the longest ray points at the area\'s angle on the radar, at every size', () => {
  for (const a of SKILL_AREAS) {
    for (const size of SIZES) {
      const s = skillEnergySpec({ slug: EN2_SLUGS[a.name], area: a.name, level: 3, size });
      let best = null;
      for (const p of s.strokes) {
        const m = /^M([\d.-]+) ([\d.-]+)L([\d.-]+) ([\d.-]+)$/.exec(p.d);
        if (!m) continue;
        const [x0, y0, x1, y1] = m.slice(1).map(Number), len = Math.hypot(x1 - x0, y1 - y0);
        if (!best || len > best.len) best = { len, deg: (Math.atan2(x1 - x0, -(y1 - y0)) * 180 / Math.PI + 360) % 360 };
      }
      assert.ok(hueGap(best.deg, a.angle) <= 25, `${a.name} at ${size}px points at ${best.deg.toFixed(0)}°, not ${a.angle}°`);
    }
  }
});

test('density: each level draws more than the one below, and 48 px still draws enough to read', () => {
  for (const a of SKILL_AREAS) {
    const n = SKILL_LEVELS.map((l) => skillEnergySpec({ slug: EN2_SLUGS[a.name], area: a.name, level: l.level, size: 96 }).strokes.length);
    for (let i = 1; i < n.length; i++) assert.ok(n[i] > n[i - 1], `${a.name}: level ${i + 1} draws ${n[i]}, level ${i} ${n[i - 1]}`);
    assert.ok(skillEnergySpec({ slug: EN2_SLUGS[a.name], area: a.name, level: 1, size: 48 }).strokes.length >= 3);
  }
});

// ---------------------------------------------------------------- decorative

test('decorative: aria-hidden, focusable false, no text inside, still by default; motion stops under prefers-reduced-motion', () => {
  const still = skillEnergySvg({ slug: 'launch-plan', area: 'Marketing', level: 4, size: 160 });
  assert.match(still, /aria-hidden="true"/);
  assert.match(still, /focusable="false"/);
  assert.doesNotMatch(still, /<text|<title|<desc/);
  assert.doesNotMatch(still, /animation|@keyframes/);
  const moving = skillEnergySvg({ slug: 'launch-plan', area: 'Marketing', level: 4, size: 160, motion: true });
  assert.match(moving, /@keyframes[^]*6s ease-in-out infinite[^]*@media \(prefers-reduced-motion:reduce\)\{[^}]*animation:none/);
});

test('the component: both themes drawn and switched by the page\'s .dark class, aria-hidden, no text; one theme when asked', () => {
  assert.equal(FromBarrel, SkillEnergy, 'exported from ui/index.js');
  const out = html(h(SkillEnergy, { slug: 'runway-model', area: 'finance_ops', level: 3 }));
  assert.equal((out.match(/<svg/g) || []).length, 2);
  assert.match(out, /class="block dark:hidden"><svg[^>]*aria-hidden="true"/);
  assert.match(out, /class="hidden dark:block"><svg[^>]*aria-hidden="true"/);
  assert.match(out, /stroke="#98610c"/, 'Finance light');
  assert.match(out, /stroke="#dd8d01"/, 'Finance dark');
  assert.doesNotMatch(out, /<text/);
  const ids = [...out.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'the light and dark drawings never share an id');
  const two = html(h('div', null, h(SkillEnergy, { slug: 'runway-model', area: 'Finance' }), h(SkillEnergy, { slug: 'runway-model', area: 'Finance' })));
  const ids2 = [...two.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ids2.length, 8);
  assert.equal(new Set(ids2).size, 8, 'two copies of one skill on a page never share a clip or gradient id');
  const one = html(h(SkillEnergy, { slug: 'runway-model', area: 'Finance', theme: 'dark', size: 48 }));
  assert.equal((one.match(/<svg/g) || []).length, 1);
  assert.match(one, /width="48"/);
  assert.match(html(h(SkillEnergy, { slug: 'x', area: 'Design', size: 33 })), /width="96"/, 'an unknown size draws at 96');
});

// ---------------------------------------------------------------- the wiring

const tag = (category_slug, level) => ({ category_slug, category_label: areaOf(category_slug)?.name, level, skill_slug: `${category_slug}-x` });

test('a skill card draws its skill\'s image from the first tag with an area and a level; none without one', () => {
  const s = { uid: 's1', slug: 'investor-update', name: 'Monthly investor update', status: 'published', taxonomy: [tag('capital_network', 3)] };
  assert.deepEqual(energyOf(s), { slug: 'investor-update', area: 'capital_network', level: 3 });
  assert.deepEqual(energyOf({ uid: 'u9', taxonomy: [{ category_slug: 'nope', level: 3 }, tag('design', 'Expert')] }), { slug: 'u9', area: 'design', level: 5 });
  assert.equal(energyOf({ uid: 'u1', taxonomy: [] }), null);
  assert.equal(energyOf({ uid: 'u1', taxonomy: [{ category_slug: 'design', level: null }] }), null);
  const card = html(h(SkillCard, { s, onOpen() {}, onAssign() {} }));
  assert.match(card, /data-testid="skill-energy"/);
  assert.match(card, /stroke="#a336ae"/, 'Capital light');
  assert.doesNotMatch(html(h(SkillCard, { s: { ...s, taxonomy: [] }, onOpen() {}, onAssign() {} })), /skill-energy/);
});

test('the area chips carry the area\'s dot from the same tokens; the radar\'s labels take the area colour', () => {
  assert.equal(tagChip(tag('legal_compliance', 2)).text, 'Legal · Working');
  const chips = html(h(TaxChips, { tags: [tag('legal_compliance', 2)] }));
  assert.match(chips, /data-testid="area-dot"/);
  assert.match(chips, /--area-l:#bf2374;--area-d:#ec72a6/);
  assert.match(chips, /bg-\[var\(--area-l\)\] dark:bg-\[var\(--area-d\)\]/);
  assert.equal(html(h(AreaDot, { area: 'nope' })), '');
  const tick = renderToStaticMarkup(h('svg', null, h(AreaTick, { x: 1, y: 2, textAnchor: 'middle', payload: { index: 5, value: 'Finance' }, data: [0, 1, 2, 3, 4, 5].map((i) => ({ slug: SKILL_AXIS_ORDER[i] })) })));
  assert.match(tick, /--area-l:#98610c;--area-d:#dd8d01/);
  assert.match(tick, /fill-\[var\(--area-l\)\] dark:fill-\[var\(--area-d\)\]/);
  assert.match(tick, />Finance<\/text>/);
});
