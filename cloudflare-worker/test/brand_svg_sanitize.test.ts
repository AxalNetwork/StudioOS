/**
 * Task #33 — stored-XSS guard for founder-uploaded logo SVGs (Worker path).
 *
 * `logo_svg` is saved by founders and rendered RAW into the public landing page
 * (`row.logo_svg` in cloudflare-worker/src/services/landingTemplates.ts), so it
 * is a classic stored-XSS sink. `sanitizeSvg` in
 * cloudflare-worker/src/routes/brand.ts strips the dangerous constructs at the
 * WRITE boundary (the upsert paths). This test locks that guarantee so a future
 * edit can't silently weaken it and only surface once a founder's page is
 * exploited in the wild.
 *
 * Sibling of landing_templates_render.test.ts (Task #27), which covers escaping
 * of template COPY but deliberately NOT the raw logo_svg sink.
 *
 * "Neutralized" = the sanitizer either strips the dangerous token OR drops the
 * whole SVG (returns null). Both outcomes are safe, so every assertion accepts
 * either — mirroring the sanitizer's own strip-then-drop belt-and-suspenders.
 *
 * Run under the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/brand_svg_sanitize.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSvg } from '../src/routes/brand.ts';

// A dangerous token is neutralized when the output is null (SVG dropped) or the
// token is absent from the returned markup (stripped). Case-insensitive.
function assertNeutralized(result: string | null, ...tokens: string[]): void {
  for (const t of tokens) {
    const gone = result === null || !result.toLowerCase().includes(t.toLowerCase());
    assert.ok(gone, `expected "${t}" to be neutralized, got: ${JSON.stringify(result)}`);
  }
}

test('sanitizeSvg strips <script> tags and their payload', () => {
  const r = sanitizeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg"><script>alert('xss')</script><path d="M0 0"/></svg>`,
  );
  assertNeutralized(r, '<script', 'script', "alert('xss')");
  // The benign geometry survives — the SVG wasn't nuked wholesale.
  assert.ok(r && r.includes('<path'), `expected <path> to survive, got: ${JSON.stringify(r)}`);
});

test('sanitizeSvg strips event-handler attributes (onload/onclick/onmouseover)', () => {
  const r = sanitizeSvg(
    `<svg onload="alert(1)"><rect onclick="steal()"/><path onmouseover="x=1" d="M0 0"/></svg>`,
  );
  assertNeutralized(r, 'onload', 'onclick', 'onmouseover', 'alert(1)', 'steal()');
});

test('sanitizeSvg strips javascript: URLs', () => {
  const r = sanitizeSvg(
    `<svg><a href="javascript:alert(document.cookie)"><path d="M0 0"/></a></svg>`,
  );
  assertNeutralized(r, 'javascript:', 'alert(document.cookie)');
});

test('sanitizeSvg strips <foreignObject> and any HTML it smuggles', () => {
  const r = sanitizeSvg(
    `<svg><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></body></foreignObject><path d="M0 0"/></svg>`,
  );
  assertNeutralized(r, 'foreignObject', '<script', 'alert(1)');
});

test('sanitizeSvg strips external references (http(s) href / xlink:href)', () => {
  const r1 = sanitizeSvg(`<svg><a href="https://evil.example/steal"><path d="M0 0"/></a></svg>`);
  assertNeutralized(r1, 'href', 'https://evil.example');
  const r2 = sanitizeSvg(`<svg><path xlink:href="http://evil.example/x" d="M0 0"/></svg>`);
  assertNeutralized(r2, 'xlink:href', 'href', 'http://evil.example');
});

test('sanitizeSvg neutralizes obfuscated nested payloads (fixed-point loop)', () => {
  // A single-pass stripper would reconstruct <script> here; the loop + the
  // final belt-and-suspenders check must still neutralize it.
  const r = sanitizeSvg(`<svg><scr<script>ipt>alert(1)</script><path d="M0 0"/></svg>`);
  assertNeutralized(r, '<script', 'javascript:', 'onload', 'onerror');
});

test('sanitizeSvg returns null for non-SVG or empty input', () => {
  assert.equal(sanitizeSvg('<div>hi</div>'), null);
  assert.equal(sanitizeSvg('<img src=x onerror=alert(1)>'), null);
  assert.equal(sanitizeSvg('just text'), null);
  assert.equal(sanitizeSvg(''), null);
  assert.equal(sanitizeSvg(null), null);
  assert.equal(sanitizeSvg(undefined), null);
});

test('sanitizeSvg preserves a benign SVG unchanged (still renders)', () => {
  const benign =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="200" height="200">` +
    `<circle cx="50" cy="50" r="46" fill="#7c3aed"/>` +
    `<path d="M10 10 H 90 V 90 H 10 Z" fill="#fff"/></svg>`;
  const r = sanitizeSvg(benign);
  assert.equal(r, benign);
  assert.ok(r!.includes('<circle') && r!.includes('<path'));
});
