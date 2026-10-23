/** #2410: render the existing post card; all API traffic is synthetic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PostsTab, xPostId } from '../src/pages/admin/AdminX.jsx';
import { adminX } from '../src/lib/api.js';
import { renderedText } from './_renderedText.mjs';

function card(status, tweet_id = null) {
  return renderToStaticMarkup(createElement(PostsTab, {
    posts: [{ id: 7, account_id: 1, body: 'A product update.', status, tweet_id, media_r2_keys: ['x/fixture.png'], alt_texts: [], alt_proposals: {} }],
    accounts: [{ id: 1, handle: 'fixture' }], mode: 'drafts', onReload() {}, notify() {},
  }));
}
const buttons = (markup) => [...markup.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map(match => renderedText(match[1]).trim());
test('#2410 pending, uncertain, legacy failed and receipted cards offer no Send, Schedule, Edit or caption generation', () => {
  for (const [status, id] of [['sending', null], ['unknown', null], ['failed', null], ['failed', '100001'], ['draft', '100001']]) {
    const names = buttons(card(status, id));
    for (const unsafe of ['Send', 'Schedule', 'Edit', 'Alt']) assert.equal(names.includes(unsafe), false, `${status}: ${unsafe}`);
    if (['unknown', 'failed'].includes(status)) {
      assert.equal(names.includes('I found it on X'), true);
      assert.equal(names.includes('I checked: not sent'), id === null, 'an accepted ID cannot be erased');
    } else assert.equal(names.includes('I checked: not sent'), false, 'an active send is not reviewable');
  }
  const names = buttons(card('draft'));
  for (const allowed of ['Send', 'Schedule', 'Edit', 'Alt']) assert.equal(names.includes(allowed), true, `draft: ${allowed}`);
  assert.match(renderedText(card('unknown')), /Needs checking.*Check X before another send/);
});

test('#2410 checked-post entry accepts only an X post link or a numeric ID', () => {
  for (const input of ['123456', ' https://x.com/fixture/status/123456?s=20 ', 'https://twitter.com/fixture/status/123456']) assert.equal(xPostId(input), '123456');
  for (const input of ['', 'https://example.test/fixture/status/123456', 'javascript:123456', 'https://x.com/fixture/status/not-an-id', '1'.repeat(31), 'x'.repeat(2049)]) assert.equal(xPostId(input), null);
});

test('#2410 recording a checked result calls the recovery endpoint, never Send', async () => {
  const real = globalThis.fetch, calls = [];
  const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method, body: JSON.parse(init.body) });
    return Response.json({ ok: true, status: 'draft' });
  };
  try {
    const payload = { outcome: 'not_sent', checked_x: true, reason: 'Checked X directly.' };
    await adminX.resolvePost(7, payload);
    assert.equal(calls.length, 1); assert.match(calls[0].url, /\/api\/admin\/x\/posts\/7\/resolve$/);
    assert.equal(calls[0].method, 'POST'); assert.deepEqual(calls[0].body, payload);
  } finally {
    globalThis.fetch = real;
    if (storage) Object.defineProperty(globalThis, 'localStorage', storage);
    else delete globalThis.localStorage;
  }
});

test('#2410 a reload includes unknown and in-progress sends instead of hiding them', () => {
  const source = readFileSync(new URL('../src/pages/admin/AdminX.jsx', import.meta.url), 'utf8');
  const statuses = /api\.listPosts\(\{ status: '([^']+)'/.exec(source)?.[1].split(',');
  assert.ok(statuses?.includes('unknown')); assert.ok(statuses.includes('sending'));
});
