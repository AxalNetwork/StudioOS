// D756 §1.7 (#1894) — the interviewee recording notice at /privacy/interviews.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/interview_notice_d756.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { INTERVIEW_NOTICE_VERSION, INTERVIEW_NOTICE_PATH, INTERVIEW_CONTACT_EMAIL, noticeVersionFrom } from '../src/lib/interviewNotice.js';

const { default: InterviewNoticePage, INTERVIEW_NOTICES } = await import('../src/pages/InterviewNoticePage.jsx');
const { default: PrivacyPage } = await import('../src/pages/PrivacyPage.jsx');
const { isPublicPath } = await import('../src/lib/api.js');

const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const render = (el, url = INTERVIEW_NOTICE_PATH) => renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: [url] }, el));
const page = (url, props = {}) => render(React.createElement(InterviewNoticePage, props), url);
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').replace(/ ([.,])/g, '$1').trim();
const article = (html) => text(html.slice(html.indexOf('<article'), html.indexOf('</article>')));

// The SHA-256 of version 1's rendered article text, with no contact address.
// Each wording change in review updates it, and the owner's approval comment
// quotes it. AFTER APPROVAL never change it: change the words in a version 2.
// D886 B9 updates the still-unpublished draft; this is not an approval record.
const V1_SHA256 = 'c39fb742f16e2bb5e25a1dff5e8abf3e55da5844ce2905cee234706acfc3b675';

test('D756 the page renders signed out, reads no API, and is public to the 401 handler', () => {
  const html = page(INTERVIEW_NOTICE_PATH);
  assert.match(html, /<h1 id="ax-legal-h" class="ax-legal-h1">When a founder records you<\/h1>/);
  const code = src('frontend/src/pages/InterviewNoticePage.jsx') + src('frontend/src/lib/interviewNotice.js');
  assert.doesNotMatch(code, /lib\/api|request\(|fetch\(|localStorage|useAuth/, 'the page reads nothing');
  assert.equal(isPublicPath('/privacy/interviews'), true);
  assert.equal(isPublicPath('/privacy'), true);
});

test('D756 the route, the OG entry, the sitemap and the live smoke all carry /privacy/interviews', () => {
  const app = src('frontend/src/App.jsx');
  const route = app.match(/<Route path="\/privacy\/interviews" element=\{<InterviewNoticePage \/>\} \/>/);
  assert.ok(route, 'App.jsx routes it');
  const line = app.split('\n').find((l) => l.includes('path="/privacy/interviews"'));
  assert.doesNotMatch(line, /guard\(/, 'outside every guard');
  assert.match(src('frontend/src/lib/ogRegistry.js'), /path: '\/privacy\/interviews',/);
  assert.match(src('frontend/public/sitemap.xml'), /<loc>https:\/\/axal\.vc\/privacy\/interviews<\/loc>/);
  assert.match(src('scripts/check-spa-live.mjs'), /\{ path: '\/privacy\/interviews', shell: true \}/);
});

test('D756 the Worker, the page and the route name the same version and path', () => {
  const worker = src('cloudflare-worker/src/services/channels/consentNotice.ts');
  const version = Number(worker.match(/export const CONSENT_NOTICE_VERSION = (\d+);/)?.[1]);
  const path = worker.match(/export const CONSENT_NOTICE_PATH = '([^']+)';/)?.[1];
  assert.equal(version, INTERVIEW_NOTICE_VERSION, 'Worker and SPA versions');
  assert.equal(INTERVIEW_NOTICE_VERSION, Math.max(...Object.keys(INTERVIEW_NOTICES).map(Number)), 'the current version has its words');
  assert.equal(path, INTERVIEW_NOTICE_PATH, 'Worker and SPA paths');
  assert.match(src('frontend/src/App.jsx'), new RegExp(`<Route path="${INTERVIEW_NOTICE_PATH}" `), 'the route is the path');
  assert.match(page(INTERVIEW_NOTICE_PATH), /Notice version 1/);
});

test('D756 ?n= shows a known version and otherwise the current one, echoing nothing', () => {
  for (const url of ['/privacy/interviews?n=1', '/privacy/interviews']) assert.match(page(url), /Last updated [^<]* · Notice version 1</);
  for (const [n, shown] of [['99', '99'], ['abc', 'abc'], ['-1', '-1'], ['1e3', '1e3'], ['%3Cb%3E', '<b>']]) {
    const html = page(`/privacy/interviews?n=${n}`);
    assert.match(html, /Notice version 1</, n);
    assert.ok(!text(html).includes(shown) && !html.includes('&lt;b&gt;'), `${n} is not echoed`);
    assert.doesNotMatch(html, /error|invalid|unknown/i, n);
    assert.doesNotMatch(html, /The current one is/, `${n}: no "older version" line`);
  }
  assert.deepEqual(noticeVersionFrom('n=1', [1]), { shown: 1, asked: 1 });
  assert.deepEqual(noticeVersionFrom('', [1]), { shown: 1, asked: null });
  assert.deepEqual(noticeVersionFrom('n=1e3', [1]), { shown: 1, asked: null });
  assert.deepEqual(noticeVersionFrom('n=0042', [1]), { shown: 1, asked: null }, 'more than three digits');
  assert.deepEqual(noticeVersionFrom('n=7', [1]), { shown: 1, asked: 7 });
  assert.deepEqual(noticeVersionFrom('n=1', [1, 2], 2), { shown: 1, asked: 1 });

  // Two versions: an old link shows the old words and points to the current one.
  const p = (t) => React.createElement('p', null, t);
  const two = { ...INTERVIEW_NOTICES, 2: { updated: 'Synthetic date', intro: p('Synthetic intro two.'), sections: () => [{ n: '01', h: 'Synthetic', body: p('Synthetic body.') }] } };
  const old = page('/privacy/interviews?n=1', { notices: two, current: 2 });
  assert.match(old, /Notice version 1</);
  assert.match(text(old), /This is the notice you were sent\. The current one is version 2\./);
  assert.match(old, /<a href="\/privacy\/interviews"[^>]*>version 2<\/a>/);
  assert.doesNotMatch(old, /Synthetic intro two/);
  const now = page('/privacy/interviews', { notices: two, current: 2 });
  assert.match(now, /Notice version 2</);
  assert.doesNotMatch(now, /The current one is/);
});

test('D756 with no contact address the page prints none, and no placeholder', () => {
  assert.equal(INTERVIEW_CONTACT_EMAIL, null, 'the owner has not named one yet');
  const html = page(INTERVIEW_NOTICE_PATH, { contactEmail: null });
  assert.doesNotMatch(html, /mailto:/);
  assert.doesNotMatch(html, /Questions about this document/);
  assert.doesNotMatch(article(html), /TODO|TBD|\[|placeholder/i);
  assert.match(article(html), /Ask the founder to delete it\./);
  const withEmail = page(INTERVIEW_NOTICE_PATH, { contactEmail: 'x@example.com' });
  assert.match(text(withEmail), /Ask the founder to delete it, or write to x@example\.com\./);
  assert.match(withEmail, /Questions about this document\? Write to <a href="mailto:x@example\.com">x@example\.com<\/a>\./);
});

test('D756 the six sections, in order, say what the code does', () => {
  const html = page(INTERVIEW_NOTICE_PATH);
  const heads = [...html.matchAll(/<h2 id="ax-legal-s\d+" class="ax-legal-h2">([^<]+)<\/h2>/g)].map((m) => m[1]);
  assert.deepEqual(heads, ['What is recorded', 'Why', 'Who can read it', 'How long it is kept', 'How to decline or stop', 'How to ask for deletion']);
  const body = article(html);
  for (const words of ['Reply NO or STOP in the chat', 'deleted after 30 days', 'kept until the founder deletes it', 'Axal VC never messages you first',
    'quoted only if you agree to that separately', 'administrators and partners can read what the founder writes down', 'Cloudflare stores the recording']) {
    assert.ok(body.includes(words), words);
  }
});

test('D756 version 1\'s words are frozen once approved', () => {
  const body = article(page(INTERVIEW_NOTICE_PATH, { contactEmail: null }));
  const sha = createHash('sha256').update(body).digest('hex');
  assert.equal(sha, V1_SHA256, 'version 1\'s words changed: update the hash in review, or add a version 2 after approval');
});

test('D756 the Privacy Policy links to the notice under its own section', () => {
  const html = render(React.createElement(PrivacyPage), '/privacy');
  assert.match(html, /<span class="ax-mono ax-legal-n">08<\/span><h2 id="ax-legal-s8" class="ax-legal-h2">Interviews recorded by founders<\/h2>/);
  assert.match(html, /href="\/privacy\/interviews"/);
  assert.match(html, /<span class="ax-mono ax-legal-n">09<\/span><h2 id="ax-legal-s9" class="ax-legal-h2">Contact us<\/h2>/);
});
