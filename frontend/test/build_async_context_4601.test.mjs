/**
 * D4601 (#4601) — Build's delayed answers stay with the request that asked.
 *
 *   1. Send to…: while Prepare is pending the tabs, the items and the
 *      repository are disabled, and the result is drawn from the request's own
 *      snapshot (provider, items, repository, answer), so an answer cannot
 *      appear under another provider or with another count, even when a control
 *      is driven past `disabled`.
 *   2. A card retry belongs to the overview it started under (cycle, venture,
 *      generation). A retry for venture A that answers after the page shows
 *      venture B, or after the overview was read again, changes nothing; of two
 *      retries of one card, the older answer never replaces the newer.
 *   3. Copy succeeds only after the clipboard accepted the text. No clipboard
 *      API, or a refusal, reports the manual-copy sentence.
 *
 * Every answer is held and released by the test, in the order the test picks.
 * Each group also runs on mutants of the sources that must fail.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/build_async_context_4601.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { OVERVIEWS, card } from './_cycle_fixtures.mjs';
import { mutationCheck, propsOf, sourceModule, textOf } from './_form_d695.mjs';
import RealSend from '../src/pages/cycles/BuildPlanSend.jsx';
import RealRoute from '../src/pages/cycles/CycleRoute.jsx';

const h = React.createElement;
const read = (rel) => readFileSync(new URL('../src/' + rel, import.meta.url), 'utf8');
const SEND = 'pages/cycles/BuildPlanSend.jsx';
const ROUTE = 'pages/cycles/CycleRoute.jsx';
const walk = (node) => [node, ...(node.childNodes || []).flatMap(walk)];
const reply = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
/** A promise the test settles. */
const held = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

// ───────────────────────────────────────────────────────────────── Send to…

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ITEMS = [{ uid: A, title: 'Setup wizard' }, { uid: B, title: 'Live ETA panel' }];
const LOVABLE = { provider: 'lovable', text: 'Build a clickable prototype.', prompt_chars: 321, link: 'https://lovable.dev/?autosubmit=true#prompt=Build', handoffs: [] };
const ISSUES = { provider: 'github', issues: [{ plan_item_uid: A, title: 'Setup wizard', body: 'b', url: 'https://github.com/northwind/app/issues/new' }], markdown: '## Setup wizard', repository: 'northwind/app', handoffs: [] };

async function mountSend(Send, { navigator: clipboard = undefined } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia, navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator') };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  if (clipboard !== undefined) Object.defineProperty(globalThis, 'navigator', { value: clipboard, configurable: true, writable: true });
  const posts = [];
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (options.method === 'POST') { const post = { path, body: JSON.parse(options.body), ...held() }; posts.push(post); return post.promise; }
    if (/\/connectors\/g-mine\/repositories/.test(path)) return reply({ ok: true, selected: ['northwind/app', 'northwind/site'], available: [] });
    if (/\/connectors$/.test(path)) return reply({ ok: true, items: [{ uid: 'g-mine', provider_key: 'github', status: 'connected', config: { project_id: 3 } }] });
    return reply({});
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, h(Send, { projectId: 3, items: ITEMS, onClose() {} }))));
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const by = (id) => walk(document.body).find((n) => propsOf(n)['data-testid'] === id);
  return {
    posts, flush, by, props: (id) => propsOf(by(id)), text: (id) => textOf(by(id)), has: (id) => Boolean(by(id)),
    sheet: () => textOf(by('plan-send')),
    click: async (id) => { await act(async () => { propsOf(by(id)).onClick?.({ preventDefault() {} }); }); await flush(); },
    change: async (id, value) => { await act(async () => { propsOf(by(id)).onChange({ target: { value } }); }); await flush(); },
    answer: async (post, body) => { await act(async () => { post.resolve(reply(body)); }); await flush(); },
    async close() {
      await act(async () => root.unmount());
      Object.assign(globalThis, { fetch: previous.fetch, matchMedia: previous.matchMedia });
      if (previous.navigator) Object.defineProperty(globalThis, 'navigator', previous.navigator);
      restore();
    },
  };
}

async function assertHandoff(Send) {
  // Lovable, two items, pending.
  let v = await mountSend(Send);
  try {
    await v.change(`plan-send-item-${A}`, 'on'); await v.change(`plan-send-item-${B}`, 'on');
    await v.click('plan-send-prepare');
    assert.equal(v.posts.length, 1);
    assert.deepEqual(v.posts[0].body, { provider: 'lovable', items: [A, B] });
    // The controls hold still.
    for (const id of ['github', 'notion', 'vercel', 'lovable']) assert.equal(v.props(`plan-send-tab-${id}`).disabled, true, `the ${id} tab is frozen`);
    for (const uid of [A, B]) assert.equal(v.props(`plan-send-item-${uid}`).disabled, true, 'the items are frozen');
    // Driven past `disabled` (assistive technology, a stale handler): the answer is still the request's own.
    await v.click('plan-send-tab-github');
    await v.change(`plan-send-item-${B}`, 'off');
    await v.answer(v.posts[0], LOVABLE);
    assert.ok(v.has('plan-send-result-lovable'), 'a Lovable answer is drawn as Lovable');
    assert.ok(!v.has('plan-send-result-github'));
    assert.equal(v.props('plan-send-tab-lovable')['aria-selected'], true, 'the tab names the provider that was sent');
    assert.equal(v.props('plan-send-tab-github')['aria-selected'], false);
    assert.match(v.text('plan-send-opens'), /Lovable/);
    assert.match(v.sheet(), /Send · 2 accepted items/, 'the count is the submitted count');
    assert.equal(v.text('plan-send-counter'), '321 / 4,000');
    assert.equal(v.props('plan-send-open').href, LOVABLE.link);
  } finally { await v.close(); }

  // GitHub with a picked repository, pending; the repository selector is frozen and the answer keeps its repository.
  v = await mountSend(Send);
  try {
    await v.click('plan-send-tab-github');
    await v.change(`plan-send-item-${A}`, 'on');
    assert.equal(v.props('plan-send-repo').value, 'northwind/app');
    await v.click('plan-send-prepare');
    assert.deepEqual(v.posts[0].body, { provider: 'github', items: [A], repository: 'northwind/app' });
    assert.equal(v.props('plan-send-repo').disabled, true, 'the repository is frozen while Prepare is pending');
    await v.change('plan-send-repo', 'northwind/site');
    await v.click('plan-send-tab-lovable');
    await v.click('plan-send-tab-notion');
    await v.answer(v.posts[0], ISSUES);
    assert.ok(v.has('plan-send-result-github') && !v.has('plan-send-result-notion'), 'the answer is drawn for GitHub');
    assert.equal(v.props('plan-send-tab-github')['aria-selected'], true);
    assert.equal(v.props('plan-send-issue-open').href, ISSUES.issues[0].url);
    assert.match(v.sheet(), /Send · 1 accepted item(?!s)/);
  } finally { await v.close(); }

  // A refusal arrives for the request that was sent, and the controls come back.
  v = await mountSend(Send);
  try {
    await v.change(`plan-send-item-${A}`, 'on');
    await v.click('plan-send-prepare');
    await act(async () => { v.posts[0].resolve(reply({ code: 'pii_found', message: 'x', findings: [{ kind: 'email', in: A }] }, 422)); });
    await v.flush();
    assert.match(v.text('plan-send-refused'), /Nothing was sent or recorded\./);
    assert.equal(v.props('plan-send-tab-github').disabled, false, 'the tabs work again');
    assert.equal(v.props(`plan-send-item-${A}`).disabled, false);
  } finally { await v.close(); }
}

test('a deferred Prepare is drawn for the provider, items and repository it was sent with, and the controls hold still meanwhile', async () => {
  await assertHandoff(RealSend);
  await mutationCheck(read(SEND), SEND, (m) => assertHandoff(m.default), [
    // Two layers hold the provider: the tab follows the snapshot, and the result is drawn from it. Each alone is covered by the other.
    ['      setTool(sent.tool);\n', ''],
    ['const count = result ? result.uids.length : picked.length;', 'const count = picked.length;'],
    ['onClick={() => choose(p.id)} disabled={busy}', 'onClick={() => choose(p.id)}'],
    ['checked={chosen.has(i.uid)} disabled={busy}', 'checked={chosen.has(i.uid)}'],
    ['<select value={repo} disabled={busy}', '<select value={repo}'],
  ]);
  const neither = read(SEND).replace('      setTool(sent.tool);\n', '').replace('<Result tool={result.tool}', '<Result tool={tool}');
  assert.notEqual(neither, read(SEND));
  await assert.rejects(async () => assertHandoff((await sourceModule(neither, SEND)).default), { name: 'AssertionError' }, 'with neither layer the answer is drawn under the wrong provider');
});

async function assertClipboard(Send) {
  const copyOf = async (navigatorValue) => {
    const v = await mountSend(Send, { navigator: navigatorValue });
    try {
      await v.change(`plan-send-item-${A}`, 'on');
      await v.click('plan-send-prepare');
      await v.answer(v.posts[0], LOVABLE);
      await v.click('plan-send-copy');
      return v.text('plan-send-said');
    } finally { await v.close(); }
  };
  const written = [];
  assert.equal(await copyOf({ clipboard: { writeText: async (t) => { written.push(t); } } }), 'Copied.');
  assert.deepEqual(written, [LOVABLE.text]);
  assert.equal(await copyOf({}), 'Could not copy. Select the text and copy it yourself.', 'no clipboard API is a failure, never a success');
  assert.equal(await copyOf({ clipboard: {} }), 'Could not copy. Select the text and copy it yourself.', 'a clipboard without writeText is a failure');
  assert.equal(await copyOf({ clipboard: { writeText: async () => { throw new Error('denied'); } } }), 'Could not copy. Select the text and copy it yourself.', 'a refusal is a failure');
}

test('Copy says Copied only after the clipboard accepted the text; a missing or refusing clipboard gives the manual-copy sentence', async () => {
  await assertClipboard(RealSend);
  await mutationCheck(read(SEND), SEND, (m) => assertClipboard(m.default), [
    ["  if (typeof clipboard?.writeText !== 'function') return false;\n  try { await clipboard.writeText(text); return true; }", "  try { await clipboard?.writeText?.(text); return true; }"],
    ['  try { await clipboard.writeText(text); return true; } catch { return false; }', '  try { await clipboard.writeText(text); return true; } catch { return true; }'],
  ]);
});

// ───────────────────────────────────────────────────────────────── card retry

const CAPTION_A = 'Venture A, read again.';
const CAPTION_A2 = 'Venture A, the newer retry.';
const CAPTION_B = 'Venture B overview.';
const unreadable = (cycle) => ({ ...card(cycle, 'Operating systems', 5), state: 'unreadable', series: null, reason: 'Stripe could not be read.' });
const ready = (caption) => ({ ...card('build', 'Operating systems', 5), caption });
const overviewFor = (project, cardOf) => {
  const data = structuredClone(OVERVIEWS.build);
  data.cards[5] = cardOf;
  return { ...data, project };
};

async function mountOverview(Route_) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const retries = [];
  const overviews = { 3: [unreadable('build')], 4: [ready(CAPTION_B)] };
  const seen = { 3: 0, 4: 0 };
  globalThis.fetch = async (url) => {
    const path = String(url);
    const project = /project=(\d+)/.exec(path)?.[1];
    if (/\/cycles\/build\/overview/.test(path)) {
      const list = overviews[project];
      const cardOf = list[Math.min(seen[project]++, list.length - 1)];
      return reply(overviewFor(project, cardOf));
    }
    if (/\/cycles\/build\/modules\/operating-systems/.test(path)) {
      const retry = { project, ...held() };
      retries.push(retry);
      return retry.promise;
    }
    return reply({});
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const at = {};
  function Address() { const navigate = useNavigate(); const location = useLocation(); Object.assign(at, { navigate, search: location.search }); return null; }
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/build?project_id=3'] }, h(Address), h(Routes, null, h(Route, { path: '/build', element: h(Route_, { cycle: 'build' }) })))));
  const settle = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await settle();
  const by = (id) => walk(container).find((n) => propsOf(n)['data-testid'] === id);
  const cardNode = () => by('cycle-card-operating-systems');
  return {
    at, retries, overviews, settle, cardNode, state: () => cardNode()?.parentNode && propsOf(cardNode())['data-state'], text: () => textOf(cardNode()),
    go: async (project) => { await act(async () => at.navigate('/build?project_id=' + project)); await settle(); },
    retry: async () => {
      const button = walk(cardNode()).find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === 'Try again');
      assert.ok(button, 'the unreadable card offers Try again');
      await act(async () => { propsOf(button).onClick({ preventDefault() {} }); }); await settle();
    },
    answer: async (retry, body) => { await act(async () => { retry.resolve(reply({ card: body })); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

async function assertRetries(Route_) {
  // The retry answers while its venture is still on screen: it applies.
  let m = await mountOverview(Route_);
  try {
    assert.equal(m.state(), 'unreadable');
    await m.retry();
    assert.equal(m.retries.length, 1);
    await m.answer(m.retries[0], ready(CAPTION_A));
    assert.equal(m.state(), 'ok');
    assert.match(m.text(), new RegExp(CAPTION_A));
  } finally { await m.unmount(); }

  // A retry for venture A answers last, after venture B is on screen: B keeps its own card.
  m = await mountOverview(Route_);
  try {
    await m.retry();
    await m.go(4);
    assert.match(m.text(), new RegExp(CAPTION_B), 'venture B is on screen');
    await m.answer(m.retries[0], ready(CAPTION_A));
    assert.match(m.text(), new RegExp(CAPTION_B), 'A\'s answer did not replace B\'s card');
    assert.doesNotMatch(m.text(), new RegExp(CAPTION_A));
  } finally { await m.unmount(); }

  // Back to venture A, read again: an older retry cannot replace the newer read.
  m = await mountOverview(Route_);
  try {
    m.overviews[3] = [unreadable('build'), ready(CAPTION_A2)];
    await m.retry();
    await m.go(4);
    await m.go(3);
    assert.match(m.text(), new RegExp(CAPTION_A2), 'A is read again');
    await m.answer(m.retries[0], ready(CAPTION_A));
    assert.match(m.text(), new RegExp(CAPTION_A2), 'the older retry did not replace the newer read');
  } finally { await m.unmount(); }

  // Two retries of one card: the older answer, arriving last, loses.
  m = await mountOverview(Route_);
  try {
    await m.retry();
    await m.retry();
    assert.equal(m.retries.length, 2);
    await m.answer(m.retries[1], ready(CAPTION_A2));
    await m.answer(m.retries[0], ready(CAPTION_A));
    assert.match(m.text(), new RegExp(CAPTION_A2), 'the newer retry stands');
    assert.doesNotMatch(m.text(), new RegExp(CAPTION_A));
  } finally { await m.unmount(); }
}

test('a card retry started for one venture or read cannot change the overview that replaced it, whichever answers last', async () => {
  await assertRetries(RealRoute);
  const mutants = [
    ['        if (overviewId.current.key !== started || retrySeq.current[cardSlug] !== seq) return;\n', '        if (retrySeq.current[cardSlug] !== seq) return;\n'],
    ['        if (overviewId.current.key !== started || retrySeq.current[cardSlug] !== seq) return;\n', '        if (overviewId.current.key !== started) return;\n'],
    ['        if (overviewId.current.key !== started || retrySeq.current[cardSlug] !== seq) return;\n', ''],
    ['    overviewId.current = { gen: overviewId.current.gen + 1, key: `${cycle}|${projectId}|${overviewId.current.gen + 1}` };\n', '    overviewId.current = { gen: 1, key: `${cycle}|${projectId}` };\n'],
  ];
  const source = read(ROUTE);
  for (const [before, after] of mutants) {
    assert.ok(source.includes(before), 'mutation target: ' + before);
    const module = await sourceModule(source.replace(before, after), ROUTE);
    await assert.rejects(async () => assertRetries(module.default), { name: 'AssertionError' }, 'mutation must fail: ' + before);
  }
});
