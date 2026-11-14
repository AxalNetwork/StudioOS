/**
 * D620 (#1323) — the compact archetype card on /studio and the top of
 * /studio/archetype, built to the #1006 board (`Studio · Archetype card`,
 * A1–A23), with S1's four recommendations kept:
 *   1. `both` keeps D325's split banner;
 *   2. the copy later decisions set stays (Eadwyn, never "the advisor";
 *      D325's failed read; D594's locked line naming the plan);
 *   3. D325's Level / XP bar stays, under Confidence;
 *   4. the newer board wins for the compact card.
 *
 * The compact card is rendered. The page reads four sources on mount, so its
 * layout is asserted on its code.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ArchetypeCard } from '../src/components/profile/ProfileFitSection.jsx';
import { complementAccent } from '../src/pages/ArchetypeCardPage.jsx';
import { ARCHETYPES } from '../src/lib/assessmentMeta.js';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), 'utf8');
const html = (el) => renderToStaticMarkup(createElement(MemoryRouter, null, el));
const sectionSrc = read('components/profile/ProfileFitSection.jsx');
const pageSrc = read('pages/ArchetypeCardPage.jsx');
const pageCode = codeOnly(pageSrc);

const fit = (sex, confidence = 0.82) => ({
  data: { archetype: { slug: 'fo_missionary', label: 'The Missionary', confidence }, archetype_sex: sex },
  error: '',
});
const compact = (fitState, extra = {}) => html(createElement(ArchetypeCard, {
  state: { data: { results: [] }, error: '' }, fitState, audience: 'founder', compact: true, ...extra,
}));

// ── A1–A4 · the compact card ───────────────────────────────────────────────

test('A1: no Preview chip; "View full card →" sits in a footer row under a hairline, with the illustration setting', () => {
  const markup = compact(fit('f'));
  assert.doesNotMatch(renderedText(markup), /Preview/, 'the board draws no Preview chip');
  const footer = /<div class="([^"]*)" data-testid="archetype-compact-footer">(.*?)<\/div>/.exec(markup);
  assert.ok(footer, 'the footer row is drawn');
  assert.match(footer[1], /\bborder-t\b/, 'the footer sits under a hairline');
  assert.match(footer[1], /\bjustify-between\b/);
  assert.match(renderedText(footer[2]), /^View full card →\s*illustration · f$/);
  assert.equal((renderedText(markup).match(/View full card/g) || []).length, 1, 'one "View full card", in the footer');
  assert.match(compact(fit('both')), /data-testid="archetype-compact-sex">illustration · both</);
});

test('hover adds a shadow to the lift and the accent border; the focus ring is offset 3px', () => {
  const hover = [...sectionSrc.matchAll(/\.pf-card-hit:hover \{([^}]*)\}/g)].map((m) => m[1]);
  const focus = [...sectionSrc.matchAll(/\.pf-card-hit:focus-visible \{([^}]*)\}/g)].map((m) => m[1]);
  assert.equal(hover.length, 2, 'the band and the full layout each carry the rule');
  for (const h of hover) {
    assert.match(h, /transform: translateY\(-2px\)/);
    assert.match(h, /box-shadow: 0 6px 18px rgba\(24,24,27,\.08\)/);
    assert.match(h, /border-color: var\(--arch-accent, #7c3aed\)/);
  }
  assert.equal(focus.length, 2);
  for (const f of focus) assert.match(f, /outline: 2px solid #7c3aed; outline-offset: 3px;/);
});

test('A9: on a phone the sprite is 96px beside the copy and the description is left to the page', () => {
  const markup = compact(fit('f'));
  const head = /<div class="([^"]*)" data-testid="archetype-compact-head">/.exec(markup);
  assert.ok(head);
  assert.match(head[1], /\bflex\b.*\bitems-center\b/, 'beside, below md');
  assert.match(head[1], /\bmd:flex-col\b/, 'stacked again from md up');
  assert.match(markup, /<div class="w-\[96px\] shrink-0 md:w-auto" data-testid="archetype-compact-art">/);
  assert.match(markup, /<div class="hidden md:block" data-testid="archetype-description">/, 'the description is hidden on a phone');
  // The full (non-compact) card still shows the description everywhere.
  const full = html(createElement(ArchetypeCard, { state: { data: { results: [] }, error: '' }, fitState: fit('f'), audience: 'founder' }));
  assert.doesNotMatch(full, /hidden md:block" data-testid="archetype-description"/);
});

// ── A10 · locked ───────────────────────────────────────────────────────────

test('A10: the lock keeps D594\'s line naming the plan, then "Primary archetype · Locked" and what unlocking does', () => {
  const plan = { licence: 'founder', tier: 'growth' };
  const markup = compact({ data: { archetype_access: { locked: true, required_plan: plan } }, error: '' }, { state: { data: null, error: '' } });
  const text = renderedText(markup);
  assert.match(text, /Your archetype is part of the Growth plan\. Your answers are kept\.\s*Primary archetype\s*Locked\s*The reading unlocks with the plan\./);
  assert.equal((text.match(/answers are kept/g) || []).length, 1, 'the answers being kept is said once');
  assert.match(markup, /data-testid="archetype-locked-status">Locked</);
  assert.doesNotMatch(markup, /<a\b/);
});

// ── A5–A8 · the top of /studio/archetype ───────────────────────────────────

test('A5: a crumb row at the top, and "‹ Back to studio" with the slug at the card\'s foot', () => {
  assert.match(pageCode, /<Link to="\/studio"[^>]*data-testid="archetype-crumb-studio">‹ Studio<\/Link>/);
  assert.match(pageCode, /Profile &amp; Fit · Archetype/);
  const foot = pageCode.slice(pageCode.indexOf('data-testid="archetype-back"') - 300, pageCode.indexOf('data-testid="archetype-slug"') + 80);
  assert.match(foot, /to="\/studio"/);
  assert.match(foot, /‹ Back to studio/);
  assert.match(foot, /data-testid="archetype-slug">\{latest\.slug\}/);
  assert.ok(pageCode.indexOf('archetype-crumbs') < pageCode.indexOf('{loading && ('), 'the crumb row is above every state');
});

test('the banner: the licence chip beside "Primary archetype", a 32px title, the tagline with a confidence pill, a 3px hairline', () => {
  assert.match(pageCode, /<span className="acp-chip" data-testid="archetype-licence">\{licence\}<\/span>\s*<span className="acp-lbl acp-bloom">Primary archetype<\/span>/);
  assert.match(pageCode, /const licence = archetypeLicenceTitle\(audience\)\.replace\(\/ archetype\$\/, ''\);/);
  assert.match(pageSrc, /\.acp-title \{[^}]*font-size: 32px;[^}]*font-weight: 900;/);
  // The pill exists only with a reading: no figure is invented.
  assert.match(pageCode, /\{pct != null && \(\s*<span className="acp-chip acp-mono acp-pill" data-testid="archetype-confidence-pill">\{pct\}% confidence<\/span>/);
  assert.match(pageCode, /<div className="acp-hairline" style=\{\{ background: accent \}\}/);
  assert.match(pageSrc, /\.acp-hairline \{[^}]*height: 3px;/);
  // The still carries its own dark well: the overlay draws no gradient.
  const well = /\.acp-well \{([^}]*)\}/.exec(pageSrc)[1];
  assert.doesNotMatch(well, /gradient/);
});

test('S1 recommendation 1: `both` keeps the split banner rather than resolving to one still', () => {
  assert.match(pageCode, /\{sex === 'both' \? \(\s*<div className="acp-split">\s*<BannerImg src=\{archetypeBanner\(latest\.slug, 'f'\)\} \/>\s*<BannerImg src=\{archetypeBanner\(latest\.slug, 'm'\)\} \/>/);
  assert.doesNotMatch(pageCode, /resolveSex|sex === 'both' \? 'm'/);
});

test('the 7/5 layout: copy left; Confidence (with the XP bar), Complements, "How we read this", Illustration right', () => {
  const left = pageCode.indexOf('md:col-span-7');
  const right = pageCode.indexOf('md:col-span-5');
  assert.ok(left > 0 && right > left, 'a 7-column copy side, then a 5-column well side');
  const order = (labels, from, to) => {
    let at = from;
    for (const l of labels) {
      const i = pageCode.indexOf(l, at);
      assert.ok(i > at && i < to, `${l} is out of order`);
      at = i;
    }
  };
  order(['Core approach', 'Description', '>Strengths<', '>Blind spots<'], left, right);
  order(['>Confidence<', '<XpBar xp={xp} onRetry={readXp} />', '>Complements<', 'How we read this', '>Illustration<'], right, pageCode.indexOf('archetype-back'));
  assert.match(pageCode, /\{sex === 'both' \? 'm · f \(both\)' : sex\}/);
  // The confidence bar only with a figure; "N/A" and the reason without one.
  assert.match(pageCode, /\{pct != null \? `\$\{pct\}%` : 'N\/A'\}/);
  assert.match(pageCode, /'no reading recorded yet'/);
  assert.match(pageCode, /\{pct != null && \(\s*<div className="mt-2\.5 h-\[5px\]/);
});

test('S1 recommendation 2: the read is from Eadwyn, never "the advisor"', () => {
  assert.match(pageCode, /From your conversation with Eadwyn, not a quiz\./);
  assert.match(pageCode, /'from your conversation with Eadwyn'/);
  assert.doesNotMatch(pageCode, /advisor conversation/i);
  // D325's failed read and D594's locked line stay.
  assert.match(pageCode, /<Unreadable what="Your archetype" claim="This is not a claim that you have none\."/);
  assert.match(pageCode, /\{lockedLine\(lock\)\}/);
});

test('each complement chip is edged in that archetype\'s own colour', () => {
  assert.equal(complementAccent('The Rocketeer'), ARCHETYPES.fo_rocketeer.accent);
  assert.equal(complementAccent('Sage Guide'), ARCHETYPES.mt_sage_guide.accent);
  assert.equal(complementAccent('Not an archetype'), '#ececf1', 'an unknown label keeps the grey hairline');
  for (const a of Object.values(ARCHETYPES)) {
    for (const c of a.complements || []) assert.notEqual(complementAccent(c), '#ececf1', `${c} has no colour`);
  }
  assert.match(pageCode, /<span key=\{c\} className="acp-comp" style=\{\{ borderColor: complementAccent\(c\) \}\}>/);
});
