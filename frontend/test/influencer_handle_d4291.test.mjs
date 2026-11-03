// D4289 P2 (#4291) — the first-touch cookie keeps a handle as a handle, and the
// /@handle stub. Worker side: cloudflare-worker/test/influencer_handles_d4291.test.ts.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/influencer_handle_d4291.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CODE_DAYS, HANDLE_DAYS, handleRef, keepFirstTouch, normaliseRef, readRefCookie } from '../src/lib/referralRef.js';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const fakeDoc = (cookie = '') => {
  const writes = [];
  return { writes, get cookie() { return cookie; }, set cookie(v) { writes.push(v); cookie = v.split(';')[0]; } };
};

test('a handle reference stays a handle; a code is normalised as before', () => {
  // Mutation checked: run the code normaliser first → `@jane` becomes `JANE`.
  assert.equal(handleRef('@Jane'), 'h:jane');
  assert.equal(handleRef('@jane/YT'), 'h:jane:yt');
  assert.equal(handleRef('h:jane:yt'), 'h:jane:yt');
  for (const v of ['jane', '@ja', '@jane/yt/x', 'h:jane:y t', null]) assert.equal(handleRef(v), null, String(v));
  assert.equal(normaliseRef('@axalfan'), 'h:axalfan', 'never read as the code FAN');
  assert.equal(normaliseRef('axal-ab12'), 'AB12');
  assert.equal(normaliseRef('  '), '');
  assert.equal(readRefCookie('a=1; axal_ref=h%3Ajane%3Ayt; b=2'), 'h:jane:yt');
  assert.equal(readRefCookie(''), '');
});

test('first touch wins; a handle holds 90 days and a code 30', () => {
  // Mutation checked: give a handle the code's 30 days → the max-age reads 2592000.
  const d = fakeDoc();
  assert.equal(keepFirstTouch('@jane/yt', d, { protocol: 'https:' }), 'h:jane:yt');
  assert.match(d.writes[0], new RegExp(`^axal_ref=h%3Ajane%3Ayt; path=/; max-age=${HANDLE_DAYS * 86400}; SameSite=Lax; Secure$`));
  assert.equal(keepFirstTouch('@kim', d), '', 'an existing cookie is never replaced');
  assert.equal(d.writes.length, 1);
  const c = fakeDoc();
  keepFirstTouch('ab12', c, { protocol: 'http:' });
  assert.equal(c.writes[0], `axal_ref=AB12; path=/; max-age=${CODE_DAYS * 86400}; SameSite=Lax`);
});

test('the app, the register page and the stub use the one reader', () => {
  const app = read('App.jsx');
  assert.match(app, /keepFirstTouch\(code\); \/\/ first-touch wins/);
  assert.doesNotMatch(app, /replace\(\/\[\^A-Z0-9\]\/g, ''\)/, 'no second copy of the code normaliser');
  const reg = read('pages/RegisterPage.jsx');
  assert.match(reg, /const r = params\.get\('ref'\) \|\| readRefCookie\(\);\n\s+if \(r\) setRefCode\(normaliseRef\(r\) \|\| r\.toUpperCase\(\)\);/);
  const routes = read('routes/influencerHandle.jsx');
  assert.match(routes, /<Route path="\/:at" element=\{<HandlePage \/>\} \/>/);
  assert.match(routes, /<Route path="\/:at\/:channel" element=\{<HandlePage \/>\} \/>/);
  const page = read('pages/influencer/HandlePage.jsx');
  assert.match(page, /if \(!isHandle\) return <NotFoundPage \/>;/, 'a segment without @ is the 404');
  assert.match(page, /if \(d\?\.state === 'live' && d\.ref\) keepFirstTouch\(d\.ref\);/, 'only a live handle sets the cookie');
  assert.match(page, /data-testid="handle-disclosure">\{d\.disclosure\}/);
  assert.match(read('lib/api/publicHandles.js'), /'X-Axal-Visitor': visitor/);
});
