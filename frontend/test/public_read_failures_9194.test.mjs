/**
 * #9194 — a public page whose read fails says it could not be read and offers
 * Try again; it never prints the server's own text for a 5xx, 429 or network
 * failure, and /circles never turns a failed read into "No circles are
 * published yet". 404 wording on the profile pages is unchanged.
 *
 * Each page is mounted on a stubbed `fetch` (the shim in `_contracts_dom.mjs`),
 * its read answered 503 with a distinctive `detail`.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/public_read_failures_9194.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { pageReadFailure } from '../src/lib/pageReadFailure.js';
import PublicProfilePage from '../src/pages/PublicProfilePage.jsx';
import PublicStartupProfilePage from '../src/pages/PublicStartupProfilePage.jsx';
import PublicPartnerProfilePage from '../src/pages/PublicPartnerProfilePage.jsx';
import PublicDirectoryPage from '../src/pages/PublicDirectoryPage.jsx';
import StatusPage from '../src/pages/StatusPage.jsx';
import ChangelogPage from '../src/pages/ChangelogPage.jsx';
import ESignPage from '../src/pages/ESignPage.jsx';
import CirclesPage from '../src/pages/CirclesPage.jsx';

const h = React.createElement;
const SECRET = 'D1_ERROR: upstream exploded at shard 7';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// ---------------------------------------------------------------- the helper

test('pageReadFailure: 404 keeps the page’s words, other 4xx the server’s sentence, 5xx/429/network the page’s own', () => {
  const words = { notFound: 'Profile not found', unreadable: 'Could not be read.' };
  const err = (status, message) => Object.assign(new Error(message), status ? { status } : {});
  assert.deepEqual(pageReadFailure(err(404, 'x'), words), { kind: 'not_found', message: 'Profile not found', retry: false });
  assert.deepEqual(pageReadFailure(err(410, 'This link has expired.'), words), { kind: 'refused', message: 'This link has expired.', retry: true });
  assert.deepEqual(pageReadFailure(err(403, 'not_allowed'), words), { kind: 'unreadable', message: 'Could not be read.', retry: true }, 'a bare machine code is not a sentence');
  for (const e of [err(503, SECRET), err(500, SECRET), err(429, SECRET), err(0, SECRET), new TypeError('Failed to fetch')]) {
    assert.deepEqual(pageReadFailure(e, words), { kind: 'unreadable', message: 'Could not be read.', retry: true });
  }
  assert.equal(pageReadFailure(err(404, 'Envelope gone.'), { unreadable: 'u' }).message, 'Envelope gone.', 'a page with no not-found sentence shows the 404’s own');
});

// ---------------------------------------------------------------- mounted

async function mount({ url, route, page, api, answer }) {
  const restore = installDocument();
  // SitePage forces the light theme on <html>, and the pages write their meta tags into <head>.
  const html = document.documentElement;
  html.classList = { contains: () => false, add() {}, remove() {}, toggle() {} };
  html.dataset = {};
  const make = document.createElement;
  document.createElement = (tag) => Object.assign(make(tag), { remove() { this.parentNode?.removeChild(this); } });
  document.head = document.createElement('head');
  document.head.querySelector = () => null;
  document.head.querySelectorAll = () => [];
  const previous = { matchMedia: globalThis.matchMedia, error: console.error };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  // A failed read is reported (`reportError`), which logs; keep the output quiet.
  console.error = () => {};
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (u) => {
    const p = new URL(String(u), 'http://x').pathname;
    if (p === api) { calls.push(p); return answer.current(); }
    return json({});
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  // A turn of the event loop per pass, not a timer: the stubbed read settles without waiting on the clock (D5614).
  const settle = async (n = 8) => { for (let i = 0; i < n; i += 1) await act(async () => { await new Promise((r) => setImmediate(r)); }); };
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null, h(Route, { path: route, element: h(page) })))); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  return {
    calls,
    text: () => textOf(container),
    hasButton: (label) => walk(container).some((n) => n.tagName === 'BUTTON' && textOf(n) === label),
    async click(label) {
      const btn = walk(container).find((n) => n.tagName === 'BUTTON' && textOf(n) === label);
      assert.ok(btn, `no ${label} button`);
      await act(async () => { props(btn).onClick(); });
      await settle();
    },
    async unmount() {
      await act(async () => root.unmount());
      globalThis.fetch = original; globalThis.matchMedia = previous.matchMedia; console.error = previous.error;
      restore();
    },
  };
}

const PAGES = [
  { name: 'PublicProfilePage', page: PublicProfilePage, url: '/u/ada', route: '/u/:handle', api: '/api/public/u/ada',
    words: 'This profile could not be read just now', notFound: 'Profile not found', ok: { handle: 'ada', name: 'Ada Example', role: 'founder' }, okText: 'Ada Example' },
  { name: 'PublicStartupProfilePage', page: PublicStartupProfilePage, url: '/startups/acme', route: '/startups/:handle', api: '/api/public/startup/acme',
    words: 'This startup profile could not be read just now', notFound: 'Startup not found', ok: { handle: 'acme', name: 'Acme Example' }, okText: 'Acme Example' },
  { name: 'PublicPartnerProfilePage', page: PublicPartnerProfilePage, url: '/partners/firm', route: '/partners/:slug', api: '/api/public/p/firm',
    words: 'This partner profile could not be read just now', notFound: 'Partner not found', ok: { slug: 'firm', name: 'Firm Example' }, okText: 'Firm Example' },
  { name: 'PublicDirectoryPage', page: PublicDirectoryPage, url: '/directory', route: '/directory', api: '/api/public/partners',
    words: 'The directory could not be read, which is not a claim that no one is listed.', ok: { partners: [], total: 0 }, okText: 'No one is listed in the directory yet.' },
  { name: 'StatusPage', page: StatusPage, url: '/status', route: '/status', api: '/api/public/status',
    words: 'The status record could not be read just now, so this page makes no claim about any service.', ok: { services: [], incidents: [] }, okText: 'No incidents in the last 90 days' },
  { name: 'ChangelogPage', page: ChangelogPage, url: '/changelog', route: '/changelog', api: '/api/public/changelog',
    words: 'The release notes could not be read, which is not a claim that there are none.', ok: { entries: [] }, okText: 'No public release notes yet' },
  { name: 'ESignPage', page: ESignPage, url: '/esign/tok', route: '/esign/:token', api: '/api/legal/esign/sign/tok',
    words: 'This signing link could not be read just now. Nothing has been signed or declined.', ok: { status: 'signed' }, okText: 'Already signed' },
  { name: 'CirclesPage', page: CirclesPage, url: '/circles', route: '/circles', api: '/api/public/circles',
    words: 'The circles could not be read, which is not a claim that there are none.', ok: { circles: [] }, okText: 'No circles are published yet.' },
];

for (const p of PAGES) {
  test(`${p.name}: a 503 says the page’s words, not the server’s, and Try again repeats the read`, async () => {
    const answer = { current: () => json({ detail: SECRET }, 503) };
    const m = await mount({ ...p, answer });
    try {
      assert.ok(m.text().includes(p.words), `${p.name} says ${JSON.stringify(m.text().slice(0, 400))}`);
      assert.ok(!m.text().includes(SECRET), 'the server’s text is not shown');
      assert.ok(!m.text().includes('No circles are published yet.'), 'a failed read is not an empty list');
      const before = m.calls.length;
      assert.ok(before >= 1);
      answer.current = () => json(p.ok);
      await m.click('Try again');
      assert.ok(m.calls.length > before, 'Try again re-calls the API');
      assert.ok(m.text().includes(p.okText), `after the retry ${p.name} draws the read: ${JSON.stringify(m.text().slice(0, 400))}`);
      assert.ok(!m.text().includes(p.words));
    } finally { await m.unmount(); }
  });

  test(`${p.name}: a network failure says the page’s words`, async () => {
    const m = await mount({ ...p, answer: { current: () => { throw new TypeError(SECRET); } } });
    try {
      assert.ok(m.text().includes(p.words));
      assert.ok(!m.text().includes(SECRET));
      assert.ok(m.hasButton('Try again'));
    } finally { await m.unmount(); }
  });

  if (p.notFound) {
    test(`${p.name}: a 404 keeps “${p.notFound}” and offers no retry`, async () => {
      const m = await mount({ ...p, answer: { current: () => json({ detail: SECRET }, 404) } });
      try {
        assert.ok(m.text().includes(p.notFound));
        assert.ok(!m.text().includes(SECRET));
        assert.ok(!m.hasButton('Try again'));
      } finally { await m.unmount(); }
    });
  }
}

test('CirclesPage: an empty successful read still says none are published, with no Try again', async () => {
  const m = await mount({ ...PAGES.at(-1), answer: { current: () => json({ circles: [] }) } });
  try {
    assert.ok(m.text().includes('No circles are published yet.'));
    assert.ok(!m.text().includes('could not be read'));
    assert.ok(!m.hasButton('Try again'));
  } finally { await m.unmount(); }
});
