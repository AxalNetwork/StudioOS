/**
 * #6998 (X16): the cookie banner and preferences name only what loads.
 *
 * Observed 2026-11-16 in a fresh signed-out Chromium session per consent
 * state (recorded in the PR): no choice → only `axal:client-errors`
 * (first-party error reports); every choice writes `axal_cookie_consent_v1`;
 * sign-up measurement on → the `axal:funnel_*` keys and POST /api/track;
 * referral cookie on → the first-party `axal_ref` cookie. Third-party hosts
 * in every state: Google Fonts and Cloudflare Turnstile (on /register), no
 * cookie from either; no analytics or advertising script.
 *
 *   1  Each name the banner uses is an optional row's `banner`, and that row
 *      names the module it controls, which gates on its key: the banner cannot
 *      name a category with no behaviour behind it.
 *   2  The banner and the dialog never name a category nothing sets
 *      (Functional, Preferences, Advertising, Marketing purposes) and say
 *      nothing third-party measures or advertises.
 *   3  The rows are titled for what they are; Essential names the error
 *      reports it keeps without consent.
 *
 * Mutation checked (each broke a test below, then was restored):
 *   · OPTIONAL_PURPOSES drops the `r.controls` filter and a row without a
 *     module is added → test 1 fails.
 *   · the banner names "analytics and marketing purposes" again → test 2 fails.
 *   · the referral row is titled "Marketing" again → test 3 fails.
 *   · Essential's description loses "error reports" → test 3 fails.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/cookie_wording_6998.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
globalThis.localStorage = memoryStorage();
globalThis.sessionStorage = memoryStorage();

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const consent = await import('../src/lib/cookieConsent.js');
const banner = await import('../src/components/CookieConsent.jsx');
const { default: CookieConsent, CookiePreferencesDialog, OPTIONAL_PURPOSES, bannerText } = banner;
const render = (el) => renderToStaticMarkup(React.createElement(MemoryRouter, null, el));
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

test('1: every category the banner names has a row whose module gates on it', () => {
  const optional = consent.COOKIE_ROWS.filter((r) => !r.locked);
  assert.deepEqual(OPTIONAL_PURPOSES, ['sign-up measurement', 'a referral cookie']);
  for (const name of OPTIONAL_PURPOSES) {
    const row = optional.find((r) => r.banner === name);
    assert.ok(row, `"${name}" is no row's banner name`);
    assert.ok(row.controls?.module, `"${name}" names no module`);
    assert.match(read(row.controls.module), new RegExp(`hasConsent\\(\\s*['"]${row.key}['"]\\s*\\)`), `${row.controls.module} does not gate on ${row.key}`);
  }
  assert.equal(OPTIONAL_PURPOSES.length, optional.length, 'every optional row is named, and nothing else');
  localStorage.clear();
  const html = text(render(React.createElement(CookieConsent)));
  assert.ok(html.includes(bannerText()), 'the banner draws that sentence');
  assert.equal(bannerText(),
    'Essential storage keeps you signed in and remembers this choice. With “Accept all”, Axal also keeps sign-up measurement and a referral cookie, both first-party. Nothing loads from a third party to measure you or show you ads.');
  assert.equal(bannerText([]), 'Essential storage keeps you signed in and remembers this choice. Nothing else is stored.');
  assert.match(bannerText(['a referral cookie']), /keeps a referral cookie, first-party\./);
});

test('2: neither the banner nor the dialog names a category with nothing behind it', () => {
  localStorage.clear();
  const bannerHtml = text(render(React.createElement(CookieConsent)));
  const dialogHtml = text(render(React.createElement(CookiePreferencesDialog, { prefs: consent.getConsent().categories, saved: false })));
  for (const html of [bannerHtml, dialogHtml]) {
    assert.doesNotMatch(html, /\bFunctional\b|\bPreferences\b(?! saved)|\bAdvertising\b|\bMarketing\b|analytics (and|or) marketing|marketing purposes/,
      'no category the code does not gate');
    assert.match(html, /Nothing loads from a third party to measure you or show you ads\./);
  }
});

test('3: the rows are titled for what they set, and Essential names its error reports', () => {
  const byKey = Object.fromEntries(consent.COOKIE_ROWS.map((r) => [r.key, r]));
  assert.deepEqual(consent.COOKIE_ROWS.map((r) => r.title), ['Essential', 'Sign-up measurement', 'Referral cookie']);
  assert.deepEqual(byKey.advertising.controls.storage, ['axal_ref']);
  assert.match(byKey.essential.description, /error reports sent only to Axal/);
  assert.match(read('frontend/src/lib/log.js'), /const RING_KEY = 'axal:client-errors';/, 'the error-report key Essential covers');
});
