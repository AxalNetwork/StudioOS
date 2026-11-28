/**
 * #9207 — the SPA shell sends Cross-Origin-Resource-Policy, and still no
 * Cross-Origin-Opener-Policy.
 *
 * The API has sent `Cross-Origin-Resource-Policy: same-site` since Task #33
 * (middleware/securityHeaders.ts); the shell on both hosts sent none. It now
 * carries the same value from the `/*` block of `frontend/public/_headers`,
 * and the Worker's record cards (services/socialCards.ts SHELL_HEADERS), which
 * `_headers` does not reach, send it too. The email logo and the /og/ cards are
 * detached from it, because other sites are meant to show them.
 *
 * The issue also asked for `Cross-Origin-Opener-Policy: same-origin-allow-popups`.
 * D722 forbids any COOP on the shell (google_popup_headers_d722.test.mjs), so
 * that half waits for the owner and this test holds the file to D722.
 *
 * Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/shell_corp_9207.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const HEADERS = read('frontend/public/_headers');

/** `_headers` as [{ pattern, set: Map(lower-name → value), detached: Set(lower-name) }], comments dropped. */
function parseHeaders(text) {
  const rules = [];
  let cur = null;
  for (const raw of text.split('\n')) {
    if (/^\s*#/.test(raw) || !raw.trim()) continue;
    if (!/^\s/.test(raw)) { cur = { pattern: raw.trim(), set: new Map(), detached: new Set() }; rules.push(cur); continue; }
    if (!cur) continue;
    const line = raw.trim();
    if (line.startsWith('!')) { cur.detached.add(line.slice(1).trim().toLowerCase()); continue; }
    const at = line.indexOf(':');
    if (at > 0) cur.set.set(line.slice(0, at).trim().toLowerCase(), line.slice(at + 1).trim());
  }
  return rules;
}

const rules = parseHeaders(HEADERS);
const shell = rules.find((r) => r.pattern === '/*');

test('the /* block sends Cross-Origin-Resource-Policy: same-site', () => {
  assert.ok(shell, '_headers has no /* rule');
  assert.equal(shell.set.get('x-frame-options'), 'DENY', 'the parse found the shell rule');
  assert.equal(shell.set.get('cross-origin-resource-policy'), 'same-site');
});

test('the value is the Worker middleware’s own', () => {
  const m = /h\.set\(\s*'Cross-Origin-Resource-Policy'\s*,\s*'([^']+)'/.exec(read('cloudflare-worker/src/middleware/securityHeaders.ts'));
  assert.ok(m, 'securityHeaders.ts no longer sets Cross-Origin-Resource-Policy with a literal value');
  assert.equal(shell.set.get('cross-origin-resource-policy'), m[1]);
});

test('the shell sends no Cross-Origin-Opener-Policy (D722)', () => {
  for (const r of rules) {
    assert.ok(!r.set.has('cross-origin-opener-policy'), `${r.pattern} sends a COOP; D722 forbids one on the shell`);
  }
});

test('the email logo and the /og/ cards are detached from it, after the /* rule', () => {
  const shellAt = rules.indexOf(shell);
  for (const pattern of ['/axal-mark.png', '/og/*']) {
    const at = rules.findIndex((r) => r.pattern === pattern && r.detached.has('cross-origin-resource-policy'));
    assert.ok(at > shellAt, `${pattern} must detach Cross-Origin-Resource-Policy in a rule after /*`);
  }
  assert.match(read('cloudflare-worker/src/services/email.ts'), /https:\/\/axal\.vc\/axal-mark\.png/,
    'the emails no longer show /axal-mark.png; move the detach rule to the image they show');
});

test('the record cards send it too (socialCards.ts SHELL_HEADERS)', () => {
  const src = read('cloudflare-worker/src/services/socialCards.ts');
  const block = /export const SHELL_HEADERS[^{]*\{([\s\S]*?)\n\};/.exec(src);
  assert.ok(block, 'SHELL_HEADERS not found in socialCards.ts');
  assert.match(block[1], /'cross-origin-resource-policy':\s*'same-site'/);
});

test('check-spa-live.mjs asserts it on every shell route', () => {
  const src = read('scripts/check-spa-live.mjs');
  const list = /const REQUIRED_SHELL_HEADERS = \[([\s\S]*?)\n\];/.exec(src);
  assert.ok(list, 'REQUIRED_SHELL_HEADERS not found');
  assert.match(list[1], /\['cross-origin-resource-policy', \/\^same-site\$\/i\]/);
});
