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

// Task #10 — guard that a CONFIGURED brand logo actually renders on EVERY
// signature template, in the nav AND a secondary brand surface (hero/footer).
//
// Palette presence is enforced above; logo presence was not. 11 of the 16
// signature templates silently dropped a configured logo_url (rendering a
// decorative monogram/dot/square instead) and the other 5 only showed it once
// in the nav. This locks the logo in so a future template edit can't ship a
// logo-less page without a test failing.
//
// "Configured" keys off the <img> emitted from row.logo_url — NOT the
// always-present svgLogo fallback, which is intentional when no logo is set.
const LOGO_URL = 'https://cdn.example.com/brandkit/logo-SIGNATURE.png';

function countOccurrences(haystack, needle) {
  let n = 0;
  let i = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, i);
    if (idx === -1) return n;
    n++;
    i = idx + needle.length;
  }
}

// The nav is the first <nav>...</nav>. The "secondary" brand surface is any
// markup after that nav closes (hero/sections/footer).
function navSlice(html) {
  const open = html.indexOf('<nav');
  if (open === -1) return '';
  const close = html.indexOf('</nav>', open);
  return close === -1 ? '' : html.slice(open, close + '</nav>'.length);
}
function afterNav(html) {
  const close = html.indexOf('</nav>');
  return close === -1 ? '' : html.slice(close + '</nav>'.length);
}

for (const key of Object.keys(TEMPLATE_SIGNATURE_PALETTES)) {
  test(`signature template "${key}" renders a configured logo in nav + hero/footer`, () => {
    const sig = TEMPLATE_SIGNATURE_PALETTES[key];
    const row = { ...baseRow, template: key, ...sig, logo_url: LOGO_URL };
    const html = renderLandingTemplate(row, { noindex: true, nonce: 'test-nonce' });

    // The configured logo must be emitted as an <img> carrying the configured
    // src — not the svgLogo monogram fallback, and not merely a URL reference in
    // an og:image/meta tag.
    const IMG = `<img src="${LOGO_URL}"`;
    assert.ok(
      html.includes(IMG),
      `"${key}" must render the configured logo as an <img src>`,
    );

    // It appears as an <img> at least twice: once in the nav and once in a
    // secondary brand surface (hero or footer).
    const total = countOccurrences(html, IMG);
    assert.ok(
      total >= 2,
      `"${key}" must render the configured logo <img> in nav + hero/footer (found ${total} occurrence(s))`,
    );

    assert.ok(
      navSlice(html).includes(IMG),
      `"${key}" must render the configured logo <img> inside the <nav>`,
    );
    assert.ok(
      afterNav(html).includes(IMG),
      `"${key}" must render the configured logo <img> in the hero/footer (after the nav)`,
    );
  });
}
