/**
 * #4742 (S1 audit items 1, 2 and 4) — real mounts, through the existing clients
 * and a synthetic Worker, for the two wiring gaps a static render cannot catch:
 *
 *   1. LearningStudio.jsx never passed `onCopyToStream` to StudioContentTable,
 *      so "Copy to Stream" never drew and the storage banner never counted an
 *      uploaded file the route had not yet copied. Pinned here: the button
 *      draws from the route's real `{ state: 'none' }` shape, clicking it
 *      calls `POST /admin/learning/stream/migrations` with the item's uid, a
 *      success moves the row to "Copying…", and a refusal shows the route's
 *      own `error.data.message` — never a transport `Error.message` such as
 *      "Failed to fetch".
 *   2. `GET /admin/learning/items` left `stream_uid` out of `ITEM_SELECT`, so
 *      a copied, verified file could never draw "Stream · Ready" in the
 *      studio. Pinned here end to end, through the real read.
 *   4. MemberProgram.jsx's Join showed `err.message` on a refused enrolment,
 *      which is a transport/internal sentence, not product copy. Pinned here:
 *      a `TypeError('Failed to fetch')` shows the fixed fallback, and a
 *      structured refusal shows its own `data.message`.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/learning_studio_stream_copy_integration_4742.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import LearningStudio from '../src/pages/learning/LearningStudio.jsx';
import MemberProgramPage from '../src/pages/learning/MemberProgram.jsx';

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

function studioServer({ items = [ITEM()], migrateReply = null } = {}) {
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

// ── Item 1: the button draws, clicking it calls the route, and the banner counts ──

test('Copy to Stream draws from {state:"none"}, the banner counts one, and clicking it calls migrateVideoToStream(uid)', async () => {
  await withStudio({}, async (page, fixture) => {
    assert.match(page.text(), /1 uploaded video still plays from storage\./, 'the banner counts the one uncopied upload');
    const button = page.find('button-copy-stream-v1');
    assert.ok(button, '"Copy to Stream" is drawn for an r2 item whose stream_copy is {state:"none"}');
    assert.equal(text(button).trim(), 'Copy to Stream');
    await page.click('button-copy-stream-v1');
    const posted = fixture.calls.filter((c) => c.method === 'POST' && c.path === '/api/admin/learning/stream/migrations');
    assert.equal(posted.length, 1, 'migrateVideoToStream posted exactly once');
    assert.deepEqual(posted[0].body, { item_uid: 'v1' }, 'the route is called with the item\'s uid');
    // The row moves to "Copying…" on the route's 202, without waiting for the next GET /items;
    // it still counts in the banner, which is honest about an upload not yet verified on Stream.
    assert.match(page.text(), /Copying…/);
    assert.match(page.text(), /1 uploaded video still plays from storage\./);
    assert.equal(page.find('button-copy-stream-v1'), undefined, 'the button is gone once it is copying');
  });
});

test('a refused copy shows the route\'s own error.data.message, never e.message', async () => {
  await withStudio({ migrateReply: { status: 409, body: { error: 'already_copied', message: 'This file is already copied, or its copy is still running.', detail: 'This file is already copied, or its copy is still running.' } } }, async (page) => {
    await page.click('button-copy-stream-v1');
    assert.match(page.text(), /This file is already copied, or its copy is still running\./);
    assert.match(page.text(), /Copy failed/);
    // Mutation checked: read `err.message` instead of `err?.data?.message` → still passes here (request()
    // sets both to the same sentence for a real refusal), but the next assertion below would then fail.
  });
});

test('a transport failure never shows e.message as the copy\'s refusal', async () => {
  await withStudio({}, async (page) => {
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    await page.click('button-copy-stream-v1');
    assert.doesNotMatch(page.text(), /Failed to fetch/, 'a transport Error.message is never shown as product copy');
    assert.match(page.text(), /The copy could not be started\. Try again\./);
  });
});

// ── Item 2: a verified Stream video reads "Stream · Ready" through the real read ──

test('GET /items carrying a truthy stream_uid draws "Stream · Ready" in the studio', async () => {
  await withStudio({ items: [ITEM({ stream_uid: 'c'.repeat(32), video_source: 'r2', stream_copy: { state: 'verified', stream_uid: 'c'.repeat(32) } })] }, async (page) => {
    assert.match(page.text(), /Stream · Ready/);
    assert.doesNotMatch(page.text(), /Uploaded file/, 'a verified Stream video is not drawn as "Uploaded file" any more');
  });
});

// ── Item 4: MemberProgram's Join reads only the route's structured refusal ──

const PROGRAM = { uid: 'p1', name: 'Founder track', region: 'Remote', enrolment: 'open', status: 'published' };
const CONTENTS = [{ subject_kind: 'course', subject_uid: 'c1', title: 'Intro', status: 'published', position: 1 }];

function programServer({ joinReply = null } = {}) {
  const calls = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetch = async (url, init = {}) => {
    const path = new URL(String(url), 'https://synthetic.test').pathname;
    const method = init.method || 'GET';
    calls.push({ method, path });
    if (path === '/api/learning/programs/p1' && method === 'GET') {
      return json({ program: PROGRAM, contents: CONTENTS, enrolled: false });
    }
    if (path === '/api/learning/programs/p1/enrol' && method === 'POST') {
      if (joinReply?.status) return json(joinReply.body, joinReply.status);
      return json({ enrolment: { program_uid: 'p1', status: 'active' } });
    }
    throw new Error(`Unexpected synthetic request ${method} ${path}`);
  };
  return { fetch, calls };
}

async function withMemberProgram(options, run) {
  const fixture = programServer(options), original = globalThis.fetch;
  globalThis.fetch = fixture.fetch;
  let page;
  try { page = await mounted(h(MemberProgramPage, { uid: 'p1' }), '/learning/my-programs/p1'); await run(page, fixture); }
  finally { if (page) await page.close(); globalThis.fetch = original; }
}

test('a refused Join shows homeRefusal\'s fallback for a transport error, never "Failed to fetch"', async () => {
  await withMemberProgram({}, async (page) => {
    globalThis.fetch = async (url, init = {}) => {
      if (String(url).includes('/enrol')) throw new TypeError('Failed to fetch');
      return programServer().fetch(url, init);
    };
    await page.click('member-program-join');
    const said = text(page.find('member-program-join-error'));
    assert.doesNotMatch(said, /Failed to fetch/, 'a transport Error.message is never shown as product copy');
    assert.match(said, /You could not be enrolled\. Try again\./);
  });
});

test('a refused Join with a structured refusal shows the route\'s own message', async () => {
  await withMemberProgram({ joinReply: { status: 409, body: { error: 'already_enrolled', message: 'You are already enrolled in this program.', detail: 'You are already enrolled in this program.' } } }, async (page) => {
    await page.click('member-program-join');
    assert.equal(text(page.find('member-program-join-error')).trim(), 'You are already enrolled in this program.');
  });
});
