// Task #27 — publish-time guard for EVERY landing visual template.
//
// The 21 server-rendered templates in
// `cloudflare-worker/src/services/landingTemplates.ts` (5 original six-tab
// layouts + 16 ported single-audience designs from Task #24/#25) are emitted
// as raw HTML strings via the RENDERERS dispatcher. A typo in any template —
// broken HTML, a missing/duplicated waitlist form, the wrong fixed audience,
// unescaped founder copy (XSS), or an accidental `@import` / external font that
// violates the strict CSP — would only surface once a founder publishes a page.
//
// This iterates every key in TEMPLATE_KEYS and asserts each rendered page is
// structurally sound, CSP-safe, and escapes hostile copy. The waitlist-capture
// shape is checked per architecture: the ported designs expose a single
// `#wl-form`/`#wl-msg` posting one fixed audience that must match the catalog
// entry; the original designs expose the six-tab `#wl-<audience>` capture.
//
// Complements `landing_templates.test.ts` (Task #26), which guards the 16
// ported designs' palette lockstep + signature colours. This file adds the
// XSS-escaping and CSP-font invariants and extends coverage to the original 5.
//
// Runs under the strip-types loader so it can import the worker TS source AND
// the frontend JS catalog. MUST stay in the `test:drift` file list in the root
// package.json or the gate silently skips it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderLandingTemplate, TEMPLATE_KEYS } from '../src/services/landingTemplates.ts';
import { TEMPLATES, AUDIENCES } from '../../frontend/src/lib/brand/templates.js';

const NONCE = 'test-nonce-abc123';
const SLUG = 'demo-co';

// XSS sentinel: a tag/attr-breaking payload that never legitimately appears in
// any template markup. Leading "Zz" keeps the SVG-logo initial a clean letter.
const XSS = 'Zz<x-pwn>"\'&</x-pwn>';
const XSS_RAW = '<x-pwn>';
const XSS_ESCAPED = '&lt;x-pwn&gt;';

// Drive every visible copy surface with the sentinel so escaping is exercised
// on the headline, subheadline, CTA, name, and every per-audience override.
function hostileRow(key: string): Record<string, string> {
  const row: Record<string, string> = {
    template: key,
    name: XSS,
    headline: XSS,
    subheadline: XSS,
    tagline: XSS,
    cta_text: XSS,
  };
  for (const a of AUDIENCES) {
    row[`audience_${a}_headline`] = XSS;
    row[`audience_${a}_body`] = XSS;
    row[`audience_${a}_cta`] = XSS;
  }
  return row;
}

function count(haystack: string, needle: string): number {
  let n = 0;
  let i = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, i);
    if (idx === -1) return n;
    n++;
    i = idx + needle.length;
  }
}

// Sanity: the catalog mirrors TEMPLATE_KEYS, and every audience the renderers
// post is a known one.
test('every TEMPLATE_KEYS entry has a renderer that produces HTML', () => {
  assert.ok(TEMPLATE_KEYS.length >= 21, `expected 21+ templates (got ${TEMPLATE_KEYS.length})`);
  for (const key of TEMPLATE_KEYS) {
    const html = renderLandingTemplate(hostileRow(key), { slug: SLUG, noindex: true, nonce: NONCE });
    assert.equal(typeof html, 'string');
    assert.ok(html.length > 200, `"${key}" rendered suspiciously short`);
  }
});

for (const key of TEMPLATE_KEYS) {
  test(`landing template "${key}" renders a safe, publishable page`, () => {
    const html = renderLandingTemplate(hostileRow(key), { slug: SLUG, noindex: true, nonce: NONCE });

    // ── Structural integrity ──────────────────────────────────────────
    assert.ok(html.startsWith('<!doctype html>'), 'starts with the doctype');
    assert.ok(/<\/html>\s*$/.test(html), 'closes the html element');
    assert.ok(!html.includes('${'), 'no unresolved template tokens');

    // ── CSP: every inline <script> carries the provided nonce ─────────
    assert.ok(html.includes(`nonce="${NONCE}"`), 'page carries the provided nonce');
    for (const m of html.matchAll(/<script\b([^>]*)>/g)) {
      assert.ok(
        m[1].includes(`nonce="${NONCE}"`),
        `every <script> must carry the nonce (offending: <script${m[1]}>)`,
      );
    }

    // ── XSS: hostile founder copy is escaped, never injected raw ──────
    assert.ok(!html.includes(XSS_RAW), 'hostile copy is not injected raw');
    assert.ok(html.includes(XSS_ESCAPED), 'hostile copy is rendered HTML-escaped');

    // ── CSP: no @import and no external font/stylesheet URLs ──────────
    assert.ok(!html.includes('@import'), 'no @import (CSP-forbidden)');
    assert.ok(
      !/https?:\/\/[^"')\s]*(fonts\.googleapis|fonts\.gstatic|use\.typekit|fonts\.bunny|fonts\.com|cloud\.typography)/i.test(html),
      'no external font URLs',
    );
    assert.ok(
      !/<link\b[^>]*rel=["']?stylesheet/i.test(html),
      'no external stylesheet <link>',
    );

    // ── Waitlist capture — branch by the two form architectures ───────
    const catalogAudiences = [...new Set(
      TEMPLATES.filter((t) => t.visualTemplate === key).map((t) => t.audience),
    )];

    if (html.includes('id="wl-form"')) {
      // Ported single-audience design: exactly one capture form + message node.
      assert.equal(count(html, 'id="wl-form"'), 1, 'exactly one #wl-form');
      assert.equal(count(html, 'id="wl-msg"'), 1, 'exactly one #wl-msg');
      assert.ok(
        html.includes(`/api/brand/landing/${SLUG}/waitlist`),
        'posts to the slug-scoped waitlist endpoint',
      );

      // Posts exactly one fixed audience, valid and matching the catalog entry.
      const posted = [...html.matchAll(/audience:"([^"]+)"/g)].map((m) => m[1]);
      assert.equal(posted.length, 1, `posts exactly one fixed audience (got ${posted.length})`);
      assert.ok(AUDIENCES.includes(posted[0]), `posted audience "${posted[0]}" is a known audience`);
      assert.equal(catalogAudiences.length, 1, `catalog maps "${key}" to exactly one audience`);
      assert.equal(
        posted[0],
        catalogAudiences[0],
        `posted audience matches the catalog audience for "${key}"`,
      );
    } else {
      // Original multi-audience design: the six-tab capture, exactly one
      // form + message node per audience (no duplicated/missing panels).
      for (const a of AUDIENCES) {
        assert.equal(count(html, `id="wl-${a}"`), 1, `exactly one #wl-${a} capture form`);
        assert.equal(count(html, `id="msg-${a}"`), 1, `exactly one #msg-${a} message node`);
      }
      assert.ok(
        html.includes(`/api/brand/landing/${SLUG}/waitlist`),
        'posts to the slug-scoped waitlist endpoint',
      );
      // The original styles are not catalog visualTemplate targets.
      assert.equal(catalogAudiences.length, 0, `original style "${key}" is not a catalog visualTemplate`);
    }
  });
}
