/**
 * D722 — the shell's headers must leave Google's window able to talk back.
 *
 * Google's sign-in window hands its code to /login by postMessage, and GIS
 * watches the window it opened to know when it closes. Both need the page's
 * Cross-Origin-Opener-Policy to be unset (or `unsafe-none`). `same-origin`
 * severs the link: the window opens, the person signs in, and the page never
 * hears back.
 *
 * `same-origin-allow-popups` is NOT the safe middle it looks like. When a page
 * on another origin opens axal.vc in a window of ITS own — an AI client's MCP
 * OAuth window that lands on /login — that policy on our page cuts the link to
 * the opener, and that sign-in breaks instead. So the rule is: no COOP on the
 * shell at all. The Worker's `same-origin` on `/api/*` JSON is harmless —
 * COOP only acts on documents.
 *
 * The shell sends no CSP today (see the note in `_headers`). If it ever gains
 * one, it must admit GIS: the script, its stylesheet, and accounts.google.com
 * for connections and the frame GIS uses. The checker is exercised on a
 * fixture below, so it is not vacuous while there is nothing to check.
 *
 * Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/google_popup_headers_d722.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const HEADERS = readFileSync(path.join(ROOT, 'frontend/public/_headers'), 'utf8');
const INDEX = readFileSync(path.join(ROOT, 'frontend/index.html'), 'utf8');

/** `_headers` as [{ pattern, headers: Map(lower-name → value) }], comments dropped. */
function parseHeaders(text) {
  const rules = [];
  let cur = null;
  for (const raw of text.split('\n')) {
    if (/^\s*#/.test(raw) || !raw.trim()) continue;
    if (!/^\s/.test(raw)) { cur = { pattern: raw.trim(), headers: new Map() }; rules.push(cur); continue; }
    const at = raw.indexOf(':');
    if (cur && at > 0) cur.headers.set(raw.slice(0, at).trim().toLowerCase(), raw.slice(at + 1).trim());
  }
  return rules;
}

/** The directives a CSP must carry for GIS's code client, or the reasons it does not. */
function gisCspProblems(csp) {
  const dir = new Map();
  for (const part of String(csp).split(';')) {
    const [name, ...vals] = part.trim().split(/\s+/);
    if (name) dir.set(name.toLowerCase(), vals);
  }
  const allows = (name, needle) => {
    const vals = dir.get(name) || dir.get('default-src') || [];
    return vals.some((v) => v === '*' || v === 'https:' || v === 'https://accounts.google.com' || v.startsWith(needle));
  };
  const problems = [];
  if (!allows('script-src', 'https://accounts.google.com/gsi/client')) problems.push('script-src does not admit https://accounts.google.com/gsi/client');
  if (!allows('style-src', 'https://accounts.google.com/gsi/style')) problems.push('style-src does not admit https://accounts.google.com/gsi/style');
  if (!allows('connect-src', 'https://accounts.google.com/')) problems.push('connect-src does not admit https://accounts.google.com');
  if (!allows('frame-src', 'https://accounts.google.com/')) problems.push('frame-src does not admit https://accounts.google.com');
  return problems;
}

test('the parse found the shell rule, so the checks below are not vacuous', () => {
  const rules = parseHeaders(HEADERS);
  const shell = rules.find((r) => r.pattern === '/*');
  assert.ok(shell, '_headers has no /* rule');
  assert.equal(shell.headers.get('x-frame-options'), 'DENY');
});

test('no Cross-Origin-Opener-Policy on the shell — neither same-origin nor same-origin-allow-popups', () => {
  for (const r of parseHeaders(HEADERS)) {
    const coop = r.headers.get('cross-origin-opener-policy');
    if (coop === undefined) continue;
    assert.equal(coop.toLowerCase(), 'unsafe-none',
      `${r.pattern} sends COOP "${coop}": same-origin cuts Google's window off from /login, ` +
      'and same-origin-allow-popups cuts off a window that opened /login (MCP sign-in)');
  }
});

test('any CSP the shell gains admits Google’s script, style, connections and frame', () => {
  const csps = [];
  for (const r of parseHeaders(HEADERS)) {
    for (const name of ['content-security-policy', 'content-security-policy-report-only']) {
      if (r.headers.has(name)) csps.push([`${r.pattern} ${name}`, r.headers.get(name)]);
    }
  }
  for (const m of INDEX.matchAll(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*content=["']([^"']+)["']/gi)) {
    csps.push(['index.html meta', m[1]]);
  }
  for (const [where, csp] of csps) assert.deepEqual(gisCspProblems(csp), [], where);
});

test('the CSP checker itself: a CSP that admits GIS passes, one that does not is named', () => {
  const good = "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; "
    + 'style-src https://accounts.google.com/gsi/style; connect-src https://accounts.google.com/gsi/; '
    + 'frame-src https://accounts.google.com/gsi/';
  assert.deepEqual(gisCspProblems(good), []);
  assert.equal(gisCspProblems("default-src 'self'").length, 4);
  assert.deepEqual(gisCspProblems("default-src 'self' https:"), [], 'https: admits all four');
  assert.match(gisCspProblems("default-src https:; script-src 'self'").join(), /script-src/);
});
