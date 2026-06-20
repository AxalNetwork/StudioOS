/**
 * Brand template catalog & matching — Task #30.
 *
 * Guards the data layer that powers the audience-first Brand & Landing wizard:
 *   1. Catalog integrity — every template has valid, unique, in-enum fields and
 *      maps to one of the existing visual styles.
 *   2. Audience coverage — every audience has at least one template and one
 *      recommended pick, and filtering returns recommended-first.
 *   3. Helpers — get-by-id, infer-defaults, suggest-audience-and-goal, and the
 *      copy seeder all behave and fill every field.
 *
 * Plain ESM imports (no TS), so it runs cleanly under the shared frontend test
 * loader.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test \
 *     frontend/test/brand_templates.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TEMPLATES,
  AUDIENCES,
  ASSET_TYPES,
  GOALS,
  VISUAL_TEMPLATE_KEYS,
  AUDIENCE_LABELS,
  getTemplateById,
  getTemplatesByAudience,
  inferDefaultsFromTemplate,
} from '../src/lib/brand/templates.js';
import {
  suggestAudienceAndGoal,
  getRecommendedTemplatesForAudience,
  generateInitialBrandKit,
} from '../src/lib/brand/flow.js';

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ── Catalog integrity ──────────────────────────────────────────────

test('catalog contains all 16 supplied templates', () => {
  assert.equal(TEMPLATES.length, 16);
});

test('every template has valid, in-enum fields', () => {
  for (const t of TEMPLATES) {
    assert.ok(KEBAB.test(t.id), `id "${t.id}" must be kebab-case`);
    assert.ok(t.label && typeof t.label === 'string', `${t.id} needs a label`);
    assert.ok(AUDIENCES.includes(t.audience), `${t.id} audience "${t.audience}" invalid`);
    assert.ok(ASSET_TYPES.includes(t.assetType), `${t.id} assetType "${t.assetType}" invalid`);
    assert.ok(GOALS.includes(t.primaryGoal), `${t.id} primaryGoal "${t.primaryGoal}" invalid`);
    assert.ok(VISUAL_TEMPLATE_KEYS.includes(t.visualTemplate), `${t.id} visualTemplate "${t.visualTemplate}" invalid`);
    assert.ok(t.defaultCtaLabel && t.defaultCtaLabel.trim().length > 0, `${t.id} needs a CTA label`);
    assert.ok(KEBAB.test(t.defaultSlug), `${t.id} slug "${t.defaultSlug}" must be kebab-case`);
  }
});

test('template ids and slugs are unique', () => {
  const ids = TEMPLATES.map((t) => t.id);
  const slugs = TEMPLATES.map((t) => t.defaultSlug);
  assert.equal(new Set(ids).size, ids.length, 'duplicate ids');
  assert.equal(new Set(slugs).size, slugs.length, 'duplicate slugs');
});

// ── Audience coverage ──────────────────────────────────────────────

test('every audience has at least one template and one recommended pick', () => {
  for (const a of AUDIENCES) {
    const list = getTemplatesByAudience(a);
    assert.ok(list.length >= 1, `audience ${a} has no templates`);
    assert.ok(list.some((t) => t.recommended), `audience ${a} has no recommended template`);
    assert.ok(AUDIENCE_LABELS[a], `audience ${a} missing a display label`);
  }
});

test('getTemplatesByAudience returns only that audience, recommended-first', () => {
  for (const a of AUDIENCES) {
    const list = getTemplatesByAudience(a);
    assert.ok(list.every((t) => t.audience === a), `leaked non-${a} template`);
    // recommended entries must all precede non-recommended ones
    let seenNonRecommended = false;
    for (const t of list) {
      if (!t.recommended) seenNonRecommended = true;
      else assert.ok(!seenNonRecommended, `recommended ${t.id} appears after a non-recommended one`);
    }
  }
});

test('every template belongs to a known audience bucket (no orphans)', () => {
  const bucketed = AUDIENCES.flatMap((a) => getTemplatesByAudience(a));
  assert.equal(bucketed.length, TEMPLATES.length);
});

// ── Helpers ────────────────────────────────────────────────────────

test('getTemplateById finds entries and returns undefined for unknown ids', () => {
  assert.equal(getTemplateById('capital-ready-kit')?.label, 'Capital Ready Kit');
  assert.equal(getTemplateById('does-not-exist'), undefined);
});

test('inferDefaultsFromTemplate mirrors the catalog entry', () => {
  const t = getTemplateById('pilot-partner-page');
  assert.deepEqual(inferDefaultsFromTemplate('pilot-partner-page'), {
    audience: t.audience,
    primaryGoal: t.primaryGoal,
    defaultCtaLabel: t.defaultCtaLabel,
  });
  assert.equal(inferDefaultsFromTemplate('nope'), undefined);
});

test('getRecommendedTemplatesForAudience matches getTemplatesByAudience', () => {
  for (const a of AUDIENCES) {
    assert.deepEqual(
      getRecommendedTemplatesForAudience(a).map((t) => t.id),
      getTemplatesByAudience(a).map((t) => t.id),
    );
  }
});

// ── suggestAudienceAndGoal ─────────────────────────────────────────

test('suggestAudienceAndGoal defaults to customer / join_waitlist', () => {
  assert.deepEqual(suggestAudienceAndGoal({ name: 'Acme' }), {
    audience: 'customer',
    goal: 'join_waitlist',
  });
});

test('suggestAudienceAndGoal respects a valid preferred audience and yields a valid goal', () => {
  for (const a of AUDIENCES) {
    const { audience, goal } = suggestAudienceAndGoal({ name: 'Acme' }, a);
    assert.equal(audience, a);
    assert.ok(GOALS.includes(goal), `goal for ${a} not in enum`);
  }
});

test('suggestAudienceAndGoal ignores an invalid preferred audience', () => {
  const { audience } = suggestAudienceAndGoal({ name: 'Acme' }, 'martians');
  assert.equal(audience, 'customer');
});

// ── generateInitialBrandKit ────────────────────────────────────────

test('generateInitialBrandKit fills every field and uses the template CTA + project name', () => {
  const project = { name: 'HelioCloud', oneLiner: 'Less ops, more outcomes.' };
  const template = getTemplateById('proof-builder');
  const kit = generateInitialBrandKit(project, template, 'join_waitlist');
  assert.equal(kit.brandName, 'HelioCloud');
  assert.equal(kit.ctaLabel, template.defaultCtaLabel);
  assert.ok(kit.headline.trim().length > 0);
  assert.ok(kit.subheadline.trim().length > 0);
});

test('generateInitialBrandKit produces non-empty copy for every goal', () => {
  const project = { name: 'HelioCloud', oneLiner: 'Less ops, more outcomes.' };
  for (const g of GOALS) {
    const template = TEMPLATES.find((t) => t.primaryGoal === g) || TEMPLATES[0];
    const kit = generateInitialBrandKit(project, template, g);
    assert.ok(kit.headline.trim().length > 0, `empty headline for ${g}`);
    assert.ok(kit.subheadline.trim().length > 0, `empty subheadline for ${g}`);
    assert.ok(kit.ctaLabel.trim().length > 0, `empty CTA for ${g}`);
  }
});

test('generateInitialBrandKit degrades gracefully with sparse input', () => {
  const template = getTemplateById('advisor-connect');
  const kit = generateInitialBrandKit({}, template, undefined);
  assert.ok(kit.brandName.trim().length > 0);
  assert.ok(kit.headline.trim().length > 0);
  assert.ok(kit.subheadline.trim().length > 0);
  assert.equal(kit.ctaLabel, template.defaultCtaLabel);
});
