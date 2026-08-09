/**
 * Guards the REAL template previews on /spinout-lab/brand.
 *
 * The library used to render every template as a TemplateThumb — generic
 * colored bars and boxes — plus a one-size-fits-all preview-modal artboard.
 * That is exactly the failure this suite prevents from regressing:
 *
 *   1. Every catalog template (frontend/src/lib/brand/templates.js TEMPLATES)
 *      must resolve to a real component in the preview registry — never to
 *      the placeholder fallback.
 *   2. Each preview must actually render ITS design: a per-template
 *      structural marker taken from the source in brandtemplates/ (or, for
 *      the in-house proof-builder, from the worker's own renderer) must
 *      appear in the rendered HTML. A generic layout can't pass 16 different
 *      markers.
 *   3. The founder's dynamic values (ctaText always; brandName wherever the
 *      design surfaces the brand) must flow into the render.
 *   4. Previews must be visually distinct — no two templates may share the
 *      same markup.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/brand_template_previews.test.mjs
 * MUST stay in the test:drift file list via the frontend glob.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PREVIEW_REGISTRY, getPreviewComponent, PREVIEW_NATURAL_WIDTH } from '../src/components/brand/templates/templateRegistry.js';
import { TEMPLATES, VISUAL_TEMPLATE_KEYS } from '../src/lib/brand/templates.js';

const render = (Comp, data = {}) => renderToStaticMarkup(React.createElement(Comp, { data }));

/** One structural marker per template — a string that belongs to THAT
 *  design's signature section (its source's real copy/structure), so a
 *  flattened generic layout cannot satisfy the table. */
const STRUCTURAL_MARKERS = {
  'capital-ready-kit': 'Use of funds',
  'capital-storyteller': 'Confidential',
  // Was "Powering agents at" — that logo wall listed real third-party brands
  // (Ramp, Linear, Notion…) that no founder's page ever renders and the worker
  // has no counterpart for, so it was dropped when the preview moved onto the
  // shared content model. The bar chart is this design's real signature.
  'seed-stage-spark': 'Growth by period',
  'distribution-deck': 'distribution case for',
  'pilot-partner-page': 'isn', // the "Who this isn't/isn’t for" anti-persona section
  'partner-hub': 'customer wins twice',
  'partner-pipeline-pro': 'Lever',
  'co-founder-builder': 'weak points',
  'co-founder-canvas': 'The gap is me.',
  'cofounder-connect': 'Working', // the status-pill built-rows list
  'co-founder-quest': 'What we need',
  'advisor-connect': 'arrangement',
  'mentor-connect': 'not this quarter',
  'mentor-connect-page': 'Private link',
  'builders-launchpad': 'request access',
  'proof-builder': 'receipts', // in-house original — marker from its own worker renderer
};

test('every catalog template resolves to a REAL preview component (no placeholder fallback)', () => {
  for (const t of TEMPLATES) {
    assert.ok(
      getPreviewComponent(t.visualTemplate),
      `"${t.id}" (visual "${t.visualTemplate}") has no real preview component — it would fall back to the generic TemplateThumb placeholder`,
    );
  }
});

test('registry keys are all real visual-template keys (no stale entries)', () => {
  for (const key of Object.keys(PREVIEW_REGISTRY)) {
    assert.ok(VISUAL_TEMPLATE_KEYS.includes(key), `registry key "${key}" is not a known visual template`);
  }
  assert.equal(typeof PREVIEW_NATURAL_WIDTH, 'number');
});

for (const [key, marker] of Object.entries(STRUCTURAL_MARKERS)) {
  test(`"${key}" preview renders its own design's structure, not a generic layout`, () => {
    const Comp = PREVIEW_REGISTRY[key];
    assert.ok(Comp, `no component registered for "${key}"`);
    const html = render(Comp);
    assert.ok(html.includes(`data-testid="template-preview-${key}"`), `root testid missing for "${key}"`);
    assert.ok(html.length > 2500, `"${key}" preview renders almost nothing (${html.length} chars) — a bar/box placeholder, not a design`);
    assert.ok(
      html.includes(marker),
      `"${key}" preview is missing its signature-section marker "${marker}" — the design was flattened or replaced with a generic layout`,
    );
  });
}

test('dynamic ctaText flows into every preview; brandName flows wherever the design shows the brand', () => {
  for (const key of Object.keys(PREVIEW_REGISTRY)) {
    const html = render(PREVIEW_REGISTRY[key], { brandName: 'Zephyrly', ctaText: 'CTA_SENTINEL_42' });
    assert.ok(html.includes('CTA_SENTINEL_42'), `"${key}" does not render the founder's CTA label`);
    // Case-insensitive: some designs (seed-stage-spark) faithfully lowercase
    // the brand in their mono nav treatment.
    assert.ok(html.toLowerCase().includes('zephyrly'), `"${key}" does not surface the founder's brand name anywhere`);
  }
});

test('no two template previews render identical markup (designs stay distinct)', () => {
  const rendered = Object.entries(PREVIEW_REGISTRY).map(([key, Comp]) => [key, render(Comp)]);
  for (let i = 0; i < rendered.length; i++) {
    for (let j = i + 1; j < rendered.length; j++) {
      assert.notEqual(
        rendered[i][1], rendered[j][1],
        `"${rendered[i][0]}" and "${rendered[j][0]}" render byte-identical markup — two templates collapsed into one design`,
      );
    }
  }
});
