/**
 * #4649 (Learning audit 4/5) — Copy to Stream's last gaps, on a real mount of
 * LearningStudio through the existing clients and a synthetic Worker shaped
 * like `GET /admin/learning/items` and `POST /admin/learning/stream/migrations`:
 *
 *   1. a second click while the POST is in flight starts no second copy: the
 *      row draws "Starting copy…" with no button until the route answers;
 *   2. "Try again" after a failure is the same single-flight path;
 *   3. a copy table the route could not read (`{ state: 'unreadable' }`) draws
 *      no Copy to Stream and no count: the banner says it could not be read,
 *      with Try again, never "0 uploaded videos";
 *   4. Stream off (503) is a failed copy in the route's own words, retryable;
 *   5. copying, verified and failed draw from the read on a fresh mount.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/learning_studio_copy_pending_4649.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import LearningStudio from '../src/pages/learning/LearningStudio.jsx';

const h = React.createElement;
const props = (node) => Object.entries(node || {}).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
const text = (node) => (node?.nodeType === 3 ? node.textContent : node?.childNodes?.length ? node.childNodes.map(text).join('') : node?.textContent || '');
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };

async function mounted(element, path = '/learning/studio') {
  const restore = installDocument(), previousMatchMedia = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  const walk = (node) => [node, ...(node.childNodes || []).flatMap(walk)];
  const nodes = () => walk(document.body);
  const find = (id) => nodes().find((node) => props(node)['data-testid'] === id);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [path] }, element)); await settle(); });
  return {
    nodes, find, props: (id) => props(find(id)), text: () => text(document.body),
    async click(id) {
      const node = find(id);
      assert.ok(node, `control ${id} exists`);
      assert.ok(!props(node).disabled, 'control enabled');
      await act(async () => { await props(node).onClick({ button: 0, preventDefault() {} }); await settle(); });
    },
    async close() { await act(async () => root.unmount()); globalThis.matchMedia = previousMatchMedia; restore(); },
  };
}

// ── A synthetic Worker for the studio's reads and the migration route ──────

const ITEM = (over = {}) => ({
  uid: 'v1', kind: 'video', title: 'Pricing basics', summary: null, body: null, video_source: 'r2', video_url: null,
  duration_seconds: 614, thumbnail_url: null, transcript: null, topic: null, level: null, visibility: 'open',
  status: 'draft', created_by: 1, created_at: '2026-11-01T10:00:00.000Z', updated_at: '2026-11-01T10:00:00.000Z',
  published_at: null, stream_uid: null, stream_copy: { state: 'none' }, ...over,
});

function studioServer({ items = [ITEM()], migrateReply = null, hold = null } = {}) {
  const calls = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetch = async (url, init = {}) => {
    const path = new URL(String(url), 'https://synthetic.test').pathname;
    const method = init.method || 'GET';
    let body = null;
    if (typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch { /* not JSON */ } }
    calls.push({ method, path, body });
    if (path === '/api/admin/learning/items') return json({ items });
    if (path === '/api/admin/learning/courses') return json({ courses: [] });
    if (path === '/api/admin/learning/exercises') return json({ exercises: [] });
    if (path === '/api/admin/learning/exams') return json({ exams: [] });
    if (path === '/api/admin/learning/webinars') return json({ webinars: [] });
    if (path === '/api/admin/learning/stream/migrations' && method === 'POST') {
      if (hold) await hold.promise;
      if (migrateReply?.status) return json(migrateReply.body, migrateReply.status);
      return json({ copy: { stream_uid: 'c'.repeat(32), state: 'copying' } }, 202);
    }
    throw new Error(`Unexpected synthetic request ${method} ${path}`);
  };
  return { fetch, calls };
}

async function withStudio(options, run) {
  const fixture = studioServer(options), original = globalThis.fetch;
  globalThis.fetch = fixture.fetch;
  let page;
  try { page = await mounted(h(LearningStudio, {}), '/learning/studio'); await run(page, fixture); }
  finally { if (page) await page.close(); globalThis.fetch = original; }
}

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const posts = (fixture) => fixture.calls.filter((c) => c.method === 'POST' && c.path === '/api/admin/learning/stream/migrations');

/** Two clicks in one tick, the way a double-click lands: both reach the handler before any re-render. */
async function doubleClick(page, id) {
  const node = page.find(id);
  assert.ok(node, `control ${id} exists`);
  const { onClick } = props(node);
  await act(async () => { onClick({ button: 0, preventDefault() {} }); onClick({ button: 0, preventDefault() {} }); await settle(); });
}

test('a double click while the POST is in flight starts one copy, and the row says "Starting copy…" with no button', async () => {
  const hold = deferred();
  await withStudio({ hold }, async (page, fixture) => {
    await doubleClick(page, 'button-copy-stream-v1');
    assert.equal(posts(fixture).length, 1, 'one POST for two clicks');
    assert.ok(page.find('copy-starting-v1'), '"Starting copy…" while the route has not answered');
    assert.equal(page.find('button-copy-stream-v1'), undefined, 'no button to click again');
    assert.match(page.text(), /1 uploaded video still plays from storage\./, 'still counted: nothing is verified yet');
    await act(async () => { hold.resolve(); await settle(); });
    assert.equal(page.find('copy-starting-v1'), undefined);
    assert.match(page.text(), /Copying…/, 'the route\'s 202 moves it to Copying…');
    assert.equal(posts(fixture).length, 1);
  });
  // Mutation checked: removing the `copyPending` ref guard → two POSTs here.
});

test('"Try again" after a failure is single-flight too, and a second failure stays retryable', async () => {
  const hold = deferred();
  const refusal = { status: 502, body: { error: 'stream_copy_failed', message: 'Stream did not accept the copy.', detail: 'Stream did not accept the copy.' } };
  await withStudio({ items: [ITEM({ stream_copy: { state: 'failed', stream_uid: 'f'.repeat(32), error_code: 'x', error_message: 'Stream rejected the source.' } })], migrateReply: refusal, hold }, async (page, fixture) => {
    assert.ok(page.find('copy-failed-v1'), 'the read\'s failed copy draws "Copy failed"');
    assert.match(page.text(), /Stream rejected the source\./);
    const retry = page.nodes().find((n) => props(n).onClick && text(n).trim() === 'Try again' && n !== page.find('studio-storage-banner-retry'));
    assert.ok(retry, 'Try again is drawn');
    const { onClick } = props(retry);
    await act(async () => { onClick({ button: 0 }); onClick({ button: 0 }); await settle(); });
    assert.equal(posts(fixture).length, 1, 'one POST for two clicks on Try again');
    assert.ok(page.find('copy-starting-v1'));
    await act(async () => { hold.resolve(); await settle(); });
    assert.match(page.text(), /Stream did not accept the copy\./, 'the second refusal in the route\'s words');
    assert.ok(page.find('copy-failed-v1'), 'and it can be tried again');
  });
});

test('Stream off (503) is a failed copy in the route\'s own words, with Try again', async () => {
  await withStudio({ migrateReply: { status: 503, body: { error: 'stream_unavailable', message: 'Stream is not configured on this platform.', detail: 'Stream is not configured on this platform.' } } }, async (page, fixture) => {
    await page.click('button-copy-stream-v1');
    assert.equal(posts(fixture).length, 1);
    assert.match(page.text(), /Stream is not configured on this platform\./);
    assert.ok(page.find('copy-failed-v1'));
  });
});

test('a copy table the route could not read: no Copy to Stream, no count, an Unreadable banner with Try again', async () => {
  const items = [ITEM({ uid: 'v1', stream_copy: { state: 'unreadable' } }), ITEM({ uid: 'v2', title: 'Unit economics', stream_copy: { state: 'unreadable' } })];
  await withStudio({ items }, async (page, fixture) => {
    assert.equal(page.find('button-copy-stream-v1'), undefined, 'no Copy to Stream for a file whose copy could not be read');
    assert.equal(page.find('studio-storage-banner'), undefined, 'no count');
    assert.ok(page.find('studio-storage-banner-unreadable'));
    assert.match(page.text(), /Whether uploaded videos still play from storage could not be read\./);
    assert.doesNotMatch(page.text(), /0 uploaded videos/);
    assert.match(page.text(), /Copy state unreadable/);
    const before = fixture.calls.filter((c) => c.path === '/api/admin/learning/items').length;
    await page.click('studio-storage-banner-retry');
    assert.ok(fixture.calls.filter((c) => c.path === '/api/admin/learning/items').length > before, 'Try again reads the list again');
    assert.equal(posts(fixture).length, 0, 'and starts no copy');
  });
});

test('copying, verified and failed draw from the read on a fresh mount, and the banner agrees with the rows', async () => {
  const items = [
    ITEM({ uid: 'a', title: 'A', stream_copy: { state: 'none' } }),
    ITEM({ uid: 'b', title: 'B', stream_copy: { state: 'copying', stream_uid: 'b'.repeat(32) } }),
    ITEM({ uid: 'c', title: 'C', stream_copy: { state: 'failed', stream_uid: 'c'.repeat(32), error_code: null, error_message: null } }),
    ITEM({ uid: 'd', title: 'D', stream_copy: { state: 'verified', stream_uid: 'd'.repeat(32), verified_at: '2026-11-02T00:00:00Z' } }),
  ];
  await withStudio({ items }, async (page) => {
    assert.ok(page.find('button-copy-stream-a'));
    assert.match(text(page.find('studio-video-b')), /Copying…/);
    assert.ok(page.find('copy-failed-c'));
    assert.match(text(page.find('studio-video-d')), /Verified/);
    assert.match(page.text(), /3 uploaded videos still play from storage\./, 'none, copying and failed are counted; verified is not');
  });
});
