/**
 * D325 — the archetype card's completion: Retry on a failed read, one label
 * for the one hit target, alt text on the sprites, a single tile when one
 * sprite file is missing, the phone layout's rows, the values as two-pole
 * sliders, and the Level / XP bar on the full page.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  ArchetypeCard, SkillsRadarCard, ValuesLeanCard, pairTiles, skillsRow, spriteAlt, valueSlider, valuesRow,
} from '../src/components/profile/ProfileFitSection.jsx';
import { XpBar, xpBarView } from '../src/components/profile/xpBar.jsx';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), 'utf8');
const html = (el) => renderToStaticMarkup(createElement(MemoryRouter, null, el));
const text = (el) => renderedText(html(el));

// ── Retry on a failed read ──────────────────────────────────────────────────

test('each band card whose read failed says so and offers a retry, never the raw error', () => {
  const failed = { data: null, error: 'D1_ERROR: SQLITE_BUSY' };
  const skills = text(createElement(SkillsRadarCard, { state: failed, onRetry: () => {} }));
  const values = text(createElement(ValuesLeanCard, { state: failed, onRetry: () => {} }));
  const arch = text(createElement(ArchetypeCard, { state: failed, fitState: { data: null, error: 'x' }, compact: true, onRetry: () => {} }));
  assert.match(skills, /Your skills radar could not be read\..*Retry/);
  assert.match(values, /Your values could not be read\..*Retry/);
  assert.match(arch, /Your archetype could not be read\. This is not a claim that you have none\..*Retry/);
  for (const t of [skills, values, arch]) assert.doesNotMatch(t, /SQLITE|D1_ERROR/);
});

test('every mount of each card retries its own source, and only that', () => {
  // Pinned per mount, not anywhere in the file: the band and the full layout
  // each mount all three cards, and a match in one must not cover the other.
  const src = codeOnly(read('components/profile/ProfileFitSection.jsx'));
  const expect = {
    SkillsRadarCard: [/<SkillsRadarCard state=[^\n]*/g, /onRetry=\{\(\) => read\('radar'\)\} \/>$/],
    ValuesLeanCard: [/<ValuesLeanCard state=[^\n]*/g, /onRetry=\{\(\) => read\('values'\)\} \/>$/],
    ArchetypeCard: [/<ArchetypeCard state=[^\n]*/g, /onRetry=\{\(\) => \{ read\('results'\); read\('fit'\); \}\} \/>$/],
  };
  for (const [tag, [mount, re]] of Object.entries(expect)) {
    const found = [...src.matchAll(mount)].map((m) => m[0]);
    assert.equal(found.length, 2, `${tag} is mounted by the band and by the full layout`);
    for (const m of found) assert.match(m, re, m);
  }
});

// ── The one hit target's label, and the sprites' alt text ───────────────────

const fitState = { data: { archetype: { slug: 'fo_missionary', label: 'The Missionary', confidence: 0.82 }, archetype_sex: 'both' }, error: '' };

test('the compact card carries the canvas label: licence, name, confidence, and where it goes', () => {
  const markup = html(createElement(ArchetypeCard, { state: { data: { results: [] }, error: '' }, fitState, audience: 'founder', compact: true }));
  assert.match(markup, /aria-label="Founder archetype: The Missionary, 82% confidence\. View full card"/);
  const noConf = html(createElement(ArchetypeCard, {
    state: { data: { results: [] }, error: '' },
    fitState: { data: { archetype: { slug: 'fo_missionary', label: 'The Missionary', confidence: null } }, error: '' },
    audience: 'founder', compact: true,
  }));
  assert.match(noConf, /aria-label="Founder archetype: The Missionary\. View full card"/, 'no confidence, no figure');
});

test('each sprite is described: the archetype and which of the pair it is', () => {
  const markup = html(createElement(ArchetypeCard, { state: { data: { results: [] }, error: '' }, fitState, audience: 'founder', compact: true }));
  assert.match(markup, /alt="The Missionary, woman"/);
  assert.match(markup, /alt="The Missionary, man"/);
  assert.doesNotMatch(markup, /alt=""/);
  assert.equal(spriteAlt('The Sage Guide', 'f'), 'The Sage Guide, woman');
  assert.equal(spriteAlt(null, 'm'), '');
});

// ── A missing sprite file degrades to one centred tile ──────────────────────

test('pairTiles drops a slot whose file is missing, so one sprite is one tile', () => {
  assert.deepEqual(pairTiles('fo_missionary'), ['f', 'm']);
  assert.deepEqual(pairTiles('pt_embedded_operator', { m: true }), ['f'], 'pt_embedded_operator has no male file');
  assert.deepEqual(pairTiles('fo_missionary', { f: true, m: true }), []);
  assert.deepEqual(pairTiles('not_a_slug'), []);
});

test('the pair lays out as one centred 180px tile when a single sprite remains', () => {
  const src = codeOnly(read('components/profile/ProfileFitSection.jsx'));
  assert.match(src, /className=\{single \? 'mx-auto w-full max-w-\[180px\]' : 'grid grid-cols-2 gap-2 items-end'\}/);
  assert.match(src, /useEffect\(\(\) => \{ if \(failed && onMissing\) onMissing\(variant\); \}, \[failed, onMissing, variant\]\);/,
    'a sprite that 404s tells the pair');
});

// ── The phone layout's rows ─────────────────────────────────────────────────

const radar = { data: { axes: [
  { slug: 'product', label: 'Product', score: 80 }, { slug: 'gtm', label: 'GTM', score: 60 },
  { slug: 'design', label: 'Design', score: 70 }, { slug: 'ops', label: 'Ops', score: 0 },
] }, error: '' };
const values = { data: { vector: [
  { dimension_slug: 'founder_mission_vs_profit', dimension_label: 'Mission vs. Profit', is_bipolar: true, pole_low: 'Profit-First', pole_high: 'Mission-First', score: 1.5, confidence: 0.8 },
  { dimension_slug: 'founder_speed_vs_quality', dimension_label: 'Speed vs. Quality', is_bipolar: true, pole_low: 'Quality-First', pole_high: 'Speed-First', score: -0.2, confidence: 0.5 },
  { dimension_slug: 'founder_risk_appetite', dimension_label: 'Risk Appetite', is_bipolar: true, pole_low: 'Risk-Averse', pole_high: 'Risk-Seeking', score: -1.2, confidence: 0.2 },
  { dimension_slug: 'schwartz_achievement', dimension_label: 'Achievement', is_bipolar: false, pole_low: null, pole_high: null, score: 1.6, confidence: 0.7 },
], summary: { top: [{ label: 'Mission vs. Profit' }] } }, error: '' };

test('the Skills row names the three strongest measured axes, strongest first', () => {
  assert.equal(skillsRow(radar), 'Product · Design · GTM');
  assert.equal(skillsRow({ data: { axes: [{ score: 0 }] }, error: '' }), 'Nothing measured yet');
  assert.equal(skillsRow({ data: null, error: 'x' }), 'Could not be read');
  assert.equal(skillsRow({ data: null, error: '' }), 'Loading…');
});

test('the Values row names the leans, not balanced spectrums', () => {
  assert.equal(valuesRow(values), 'Leans Mission-First · Leans Risk-Averse');
  assert.equal(valuesRow({ data: { vector: [] }, error: '' }), 'Nothing measured yet');
  assert.equal(valuesRow({ data: null, error: 'x' }), 'Could not be read');
});

test('on a phone the band is Skills row, the archetype card, then the Values row; each row opens its card', () => {
  const src = codeOnly(read('components/profile/ProfileFitSection.jsx'));
  const band = src.slice(src.indexOf('data-testid="profile-fit-label"'));
  const skills = band.indexOf('order-1 ');
  const values = band.indexOf('order-3 ');
  const arch = band.indexOf('order-2 ');
  assert.ok(skills > 0 && values > skills && arch > values, 'desktop source order Skills, Values, Archetype');
  assert.match(band, /<BandRow title="Skills"[\s\S]*?testId="row-profile-skills" \/>/);
  assert.match(band, /<div className=\{openRow\.skills \? '' : 'hidden md:block'\}>/, 'the Skills card is hidden on a phone until its row opens it');
  assert.match(band, /<div className=\{openRow\.values \? '' : 'hidden md:block'\}>/);
  assert.match(src, /aria-expanded=\{open\}/);
  assert.match(band, />Profile &amp; Fit</);
});

// ── Values as two-pole sliders ──────────────────────────────────────────────

test('valueSlider places the score between its poles and names the lean', () => {
  assert.deepEqual(valueSlider(values.data.vector[0]), { pos: 88, lean: 'Leans Mission-First' });
  assert.deepEqual(valueSlider(values.data.vector[1]), { pos: 45, lean: 'Balanced' }, '|score| under 0.5 is balanced');
  assert.deepEqual(valueSlider(values.data.vector[2]), { pos: 20, lean: 'Leans Risk-Averse' });
  assert.equal(valueSlider({ ...values.data.vector[0], score: 9 }).pos, 100, 'a score past the scale is clamped');
  assert.equal(valueSlider(values.data.vector[3]), null, 'a unipolar dimension has no slider');
  assert.equal(valueSlider({ pole_low: 'a', pole_high: 'b', score: null }), null);
});

test('the Values card draws the bipolar spectrums as sliders and keeps the unipolar ones as bars', () => {
  const markup = html(createElement(ValuesLeanCard, { state: values }));
  const t = renderedText(markup);
  assert.match(markup, /data-testid="values-sliders"/);
  assert.match(markup, /aria-label="Mission vs\. Profit: Leans Mission-First, high confidence"/);
  assert.match(markup, /aria-label="Speed vs\. Quality: Balanced, medium confidence"/);
  assert.match(markup, /left:88%/);
  assert.match(t, /Profit-First\s*Mission-First/);
  assert.match(t, /Working principles/);
  assert.match(t, /Achievement/);
});

// ── The Level / XP bar ──────────────────────────────────────────────────────

const standing = { recorded: true, xp: 950, level: 4, level_floor: 900, next_level_xp: 1600, updated_at: null };

test('xpBarView is the share of the current level already earned', () => {
  assert.deepEqual(xpBarView(standing), { level: 4, xp: 950, next: 1600, pct: 7, recorded: true });
  assert.equal(xpBarView({ ...standing, xp: 1600 }).pct, 100);
  assert.equal(xpBarView({ ...standing, level_floor: 1600 }), null, 'a band with no width is not a standing');
  assert.equal(xpBarView({}), null);
  assert.equal(xpBarView(null), null);
});

test('the bar draws the level, the XP against the next level, and an accessible progress value', () => {
  const markup = html(createElement(XpBar, { xp: { state: 'ready', data: standing } }));
  const t = renderedText(markup);
  assert.match(t, /Level 4/);
  assert.match(t, /950 \/ 1600 XP/);
  assert.match(markup, /role="progressbar"[^>]*aria-valuenow="7"/);
  assert.doesNotMatch(t, /No XP awarded yet/);
});

test('no XP yet is said plainly; a failed or malformed read is Unreadable with a retry', () => {
  const zero = text(createElement(XpBar, { xp: { state: 'ready', data: { recorded: false, xp: 0, level: 1, level_floor: 0, next_level_xp: 100 } } }));
  assert.match(zero, /Level 1/);
  assert.match(zero, /0 \/ 100 XP/);
  assert.match(zero, /No XP awarded yet/);
  const failed = text(createElement(XpBar, { xp: { state: 'unreadable', data: null }, onRetry: () => {} }));
  assert.match(failed, /Your level and XP could not be read\..*Retry/);
  assert.doesNotMatch(failed, /Level \d/);
  assert.match(text(createElement(XpBar, { xp: { state: 'ready', data: { xp: 'x' } }, onRetry: () => {} })), /could not be read/);
});

test('the full archetype page reads the XP standing, draws the bar, and retries a failed archetype read', () => {
  const page = codeOnly(read('pages/ArchetypeCardPage.jsx'));
  assert.match(page, /assessment\.myXp\(\)/);
  assert.match(page, /<XpBar xp=\{xp\} onRetry=\{readXp\} \/>/);
  assert.match(page, /<Unreadable what="Your archetype"[^>]*onRetry=\{\(\) => setRetry\(\(n\) => n \+ 1\)\} \/>/);
  assert.doesNotMatch(page, /\{fit\.error \|\| results\.error\}/, 'the raw error is not printed');
  assert.match(codeOnly(read('lib/api.js')), /myXp: \(\) => request\('\/assessment\/xp\/me'\)/);
});
