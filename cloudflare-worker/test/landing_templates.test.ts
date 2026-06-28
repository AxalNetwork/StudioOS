// Task #26 — guard the recreated landing designs against two silent failure
// modes:
//   1. Palette drift — the worker's TEMPLATE_SIGNATURE_PALETTES and the
//      frontend's VISUAL_TEMPLATE_PALETTES are hand-mirrored; this asserts they
//      stay identical (same keys + same hex values).
//   2. Broken renders — each recreated template is rendered and checked for the
//      structural invariants the builder/publish flow depends on (doctype, the
//      single #wl-form/#wl-msg capture, the correct fixed audience, a nonce on
//      the inline script, and no unresolved ${...} template tokens).
//
// Runs under the strip-types loader so it can import BOTH the worker TS source
// and the frontend JS catalog. MUST stay in the test:drift file list in the
// root package.json or the gate silently skips it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderLandingTemplate,
  TEMPLATE_SIGNATURE_PALETTES,
} from '../src/services/landingTemplates.ts';
import {
  VISUAL_TEMPLATE_PALETTES,
  TEMPLATES,
  AUDIENCES,
} from '../../frontend/src/lib/brand/templates.js';

const PALETTE_FIELDS = ['theme_color', 'palette_bg', 'palette_ink', 'palette_secondary', 'palette_accent'];

test('signature palettes stay in lockstep across worker + frontend', () => {
  const workerKeys = Object.keys(TEMPLATE_SIGNATURE_PALETTES).sort();
  const frontendKeys = Object.keys(VISUAL_TEMPLATE_PALETTES).sort();
  assert.deepEqual(
    workerKeys,
    frontendKeys,
    `palette keys differ — worker:[${workerKeys}] frontend:[${frontendKeys}]`,
  );
  for (const key of workerKeys) {
    const w = TEMPLATE_SIGNATURE_PALETTES[key];
    const f = VISUAL_TEMPLATE_PALETTES[key];
    for (const field of PALETTE_FIELDS) {
      assert.equal(
        w[field],
        f[field],
        `${key}.${field} differs — worker:${w[field]} frontend:${f[field]}`,
      );
    }
  }
});

const baseRow = {
  name: 'Northwind Labs',
  tagline: 'The operating system for ambitious founders.',
  headline: 'Build, launch, and grow — all in one place.',
  subheadline: 'Everything early teams need to go from idea to traction.',
  cta_text: 'Join the waitlist',
  font_pairing: 'editorial',
};

// Iterate over the signature-palette keys so this auto-extends to every recreated
// design (current and future batches) without test edits.
for (const key of Object.keys(TEMPLATE_SIGNATURE_PALETTES)) {
  test(`recreated template "${key}" renders a well-formed page`, () => {
    const sig = TEMPLATE_SIGNATURE_PALETTES[key];
    const row = { ...baseRow, template: key, ...sig };
    const html = renderLandingTemplate(row, { noindex: true, nonce: 'test-nonce' });

    assert.ok(html.startsWith('<!doctype html>'), 'starts with doctype');
    assert.ok(html.includes('id="wl-form"'), 'has #wl-form');
    assert.ok(html.includes('id="wl-msg"'), 'has #wl-msg');
    assert.ok(html.includes('nonce="test-nonce"'), 'script carries the nonce');
    assert.ok(!html.includes('${'), 'no unresolved template tokens');
    assert.ok(html.includes(sig.palette_bg), 'signature bg colour present');
    assert.ok(html.includes(sig.theme_color), 'signature theme colour present');

    // Exactly one fixed audience is posted, and it is a valid audience.
    const matches = [...html.matchAll(/audience:"([^"]+)"/g)].map((m) => m[1]);
    assert.equal(matches.length, 1, `posts exactly one fixed audience (got ${matches.length})`);
    const posted = matches[0];
    assert.ok(AUDIENCES.includes(posted), `posted audience "${posted}" is a known audience`);

    // Cross-check: the posted audience matches the catalog entry that maps to
    // this visual template (when exactly one catalog entry maps to it).
    const catalogAudiences = [...new Set(TEMPLATES.filter((t) => t.visualTemplate === key).map((t) => t.audience))];
    if (catalogAudiences.length === 1) {
      assert.equal(posted, catalogAudiences[0], `posted audience matches catalog audience for "${key}"`);
    }
  });
}
