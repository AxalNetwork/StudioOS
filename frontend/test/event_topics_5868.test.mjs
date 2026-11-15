// #5868 (D3724 gap 5): the editor's topics picker (NE1) and Discover's topic
// chips (ME5), against the Worker's `topics` field and `topic=` filter (D1487).
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/event_topics_5868.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { Routes, Route } from 'react-router-dom';
import { mountContracts } from './_contracts_dom.mjs';
import EventEditorPage from '../src/pages/events/EventEditorPage.jsx';
import { DiscoverTabFull } from '../src/pages/events/MyEventsTabs.jsx';
import { TOPICS } from '../src/pages/events/recommendationsModel.js';
import { EVENT_TOPICS_MAX, TOPICS_FULL, discoverParams, toggleTopic, topicPicker } from '../src/pages/events/myEventsTabsModel.js';

const h = React.createElement;
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const chip = (v, key) => v.nodes().find((n) => v.props(n)?.['data-testid'] === key);
const press = async (v, node) => { assert.ok(node, 'chip exists'); await act(async () => { v.props(node).onClick({ stopPropagation() {}, preventDefault() {} }); }); };

test('the frontend\'s topic keys are the Worker\'s EVENT_TOPICS, in order, and listed once', () => {
  const src = read('cloudflare-worker/src/services/eventTopics.ts');
  const worker = JSON.parse(src.match(/EVENT_TOPICS\s*=\s*(\[[^\]]*\])/)[1].replace(/'/g, '"'));
  assert.deepEqual(TOPICS.map((t) => t.key), worker);
  assert.ok(TOPICS.every((t) => t.label), 'every topic has a label');
  // One list: the editor and Discover read it from recommendationsModel.js, never their own.
  for (const p of ['frontend/src/pages/events/EventEditorPage.jsx', 'frontend/src/pages/events/MyEventsTabs.jsx', 'frontend/src/pages/events/myEventsTabsModel.js']) {
    assert.doesNotMatch(read(p), /'go_to_market'/, `${p} lists no topic slug of its own`);
  }
  assert.match(read('cloudflare-worker/src/routes/events.ts'), /validEventTopics\(body\.topics\)/, 'the Worker caps topics; the picker\'s 5 is its default');
  assert.match(read('cloudflare-worker/src/services/eventTopics.ts'), /max = 5/);
  assert.equal(EVENT_TOPICS_MAX, 5);
});

test('the picker: a sixth topic cannot be picked, and it says why', () => {
  let list = [];
  for (const k of ['ai', 'fundraising', 'climate', 'hiring', 'legal']) list = toggleTopic(list, k);
  assert.deepEqual(list, ['fundraising', 'ai', 'hiring', 'climate', 'legal'], 'kept in the Worker\'s order');
  assert.deepEqual(toggleTopic(list, 'product'), list, 'a sixth is refused');
  assert.deepEqual(toggleTopic(list, 'ai'), ['fundraising', 'hiring', 'climate', 'legal'], 'a picked one comes off');
  assert.deepEqual(toggleTopic([], 'blockchain'), [], 'an unknown slug is never sent');
  const p = topicPicker(list);
  assert.equal(p.count, '5 of 5');
  assert.equal(p.note, TOPICS_FULL);
  assert.ok(p.chips.find((c) => c.key === 'product').disabled);
  assert.ok(!p.chips.find((c) => c.key === 'ai').disabled, 'a picked one can still come off');
  assert.equal(topicPicker(['ai']).note, null);
  assert.deepEqual(discoverParams({ limit: 1, from: 'a', to: 'b', topic: 'ai', format: '', q: '' }), { limit: 1, offset: 0, from: 'a', to: 'b', topic: 'ai' });
});

async function withFetch(routes, fn) {
  const old = globalThis.fetch; const calls = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input), 'http://local.test'); calls.push({ path: url.pathname, search: url.search, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    for (const [match, reply] of routes) if (match(url.pathname, options.method || 'GET')) return json(reply(url, options));
    return json({});
  };
  try { return await fn(calls); } finally { globalThis.fetch = old; }
}

test('the public list sends topic= with the other filters', async () => {
  const { eventsPublic } = await import('../src/lib/api.js');
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  try { await withFetch([], async (calls) => {
    await eventsPublic.list({ limit: 1, format: 'hybrid', topic: 'climate' });
    const q = new URLSearchParams(calls.at(-1).search);
    assert.equal(calls.at(-1).path, '/api/public/events');
    assert.equal(q.get('topic'), 'climate');
    assert.equal(q.get('format'), 'hybrid');
    await eventsPublic.list({ limit: 1 });
    assert.equal(new URLSearchParams(calls.at(-1).search).has('topic'), false);
  }); } finally { if (had) Object.defineProperty(globalThis, 'localStorage', had); else delete globalThis.localStorage; }
});

test('editor: an event saved with topics shows them again, and a change is saved as `topics`', async () => {
  const event = { id: 1, title: 'Synthetic event', status: 'draft', starts_at: '2026-12-12T17:30:00Z', ends_at: null, timezone: 'UTC', visibility: 'private', capacity: null, topics: ['ai', 'climate'] };
  await withFetch([
    [(p, m) => p === '/api/events/1' && m === 'PATCH', (_u, o) => ({ event: { ...event, ...JSON.parse(o.body) } })],
    [(p) => p === '/api/events/1', () => ({ event, agenda: [] })],
    [(p) => p.endsWith('/roster'), () => ({ registrations: [] })],
  ], async (calls) => {
    const v = await mountContracts(h(Routes, null, h(Route, { path: '/events/:id/edit', element: h(EventEditorPage) })), '/events/1/edit');
    try {
      for (let i = 0; i < 8; i++) await v.flush();
      assert.equal(v.props(chip(v, 'event-topic-ai'))['aria-pressed'], true);
      assert.equal(v.props(chip(v, 'event-topic-climate'))['aria-pressed'], true);
      assert.equal(v.props(chip(v, 'event-topic-legal'))['aria-pressed'], false);
      assert.match(v.text(), /2 of 5/);
      for (const k of ['fundraising', 'hiring', 'legal']) await press(v, chip(v, `event-topic-${k}`));
      assert.match(v.text(), /5 of 5/);
      assert.equal(v.props(chip(v, 'event-topic-product')).disabled, true, 'a sixth cannot be picked');
      assert.ok(v.text().includes(TOPICS_FULL), 'and the picker says why');
      await v.click('Save changes');
      const patch = calls.find((c) => c.method === 'PATCH');
      assert.deepEqual(patch.body.topics, ['fundraising', 'ai', 'hiring', 'climate', 'legal']);
    } finally { await v.unmount(); }
  });
});

test('editor: a reply with no topics list is "Unreadable", and the save leaves topics alone', async () => {
  const event = { id: 1, title: 'Synthetic event', status: 'draft', starts_at: '2026-12-12T17:30:00Z', timezone: 'UTC', visibility: 'private' };
  await withFetch([
    [(p, m) => p === '/api/events/1' && m === 'PATCH', () => ({ event })],
    [(p) => p === '/api/events/1', () => ({ event, agenda: [] })],
  ], async (calls) => {
    const v = await mountContracts(h(Routes, null, h(Route, { path: '/events/:id/edit', element: h(EventEditorPage) })), '/events/1/edit');
    try {
      for (let i = 0; i < 8; i++) await v.flush();
      assert.ok(chip(v, 'event-topics-unread'));
      assert.equal(chip(v, 'event-topic-ai'), undefined);
      await v.click('Save changes');
      assert.equal('topics' in calls.find((c) => c.method === 'PATCH').body, false, 'never [] for a list that was not read');
    } finally { await v.unmount(); }
  });
});

test('editor: a new event is created with its topics', async () => {
  await withFetch([[(p, m) => p === '/api/events' && m === 'POST', () => ({ id: 9 })], [(p) => p === '/api/events/9', () => ({ event: { id: 9, title: 'T', starts_at: '2026-12-12T17:30:00Z', timezone: 'UTC', topics: ['product'] }, agenda: [] })]], async (calls) => {
    const v = await mountContracts(h(Routes, null, h(Route, { path: '/events/new', element: h(EventEditorPage) }), h(Route, { path: '/events/:id/edit', element: h('p', null, 'landed') })), '/events/new');
    try {
      await v.flush();
      const title = v.nodes().find((n) => n.tagName === 'INPUT' && v.props(n)?.placeholder === 'Spring Demo Day');
      await act(async () => v.props(title).onChange({ target: { value: 'Topic night' } }));
      const start = v.nodes().filter((n) => v.props(n)?.type === 'datetime-local')[0];
      await act(async () => v.props(start).onChange({ target: { value: '2026-12-12T18:00' } }));
      await press(v, chip(v, 'event-topic-product'));
      await v.click('Create event');
      await v.flush();
      assert.deepEqual(calls.find((c) => c.method === 'POST' && c.path === '/api/events').body.topics, ['product']);
    } finally { await v.unmount(); }
  });
});

const NOW = Date.parse('2026-11-14T12:00:00Z');
const row = (i, topics) => ({ id: i, slug: `e${i}`, title: `Event ${i}`, type: 'meetup', starts_at: '2026-11-20T18:00:00Z', price_cents: 0, topics });
const ALL = [...Array.from({ length: 27 }, (_, i) => row(i + 1, [])), row(100, ['ai']), row(101, ['ai', 'climate']), row(102, ['climate'])];

function discoverApi({ fail = false } = {}) {
  const calls = [];
  return {
    calls,
    publicList: async (p) => {
      calls.push(p);
      if (fail) throw new Error('down');
      const events = ALL.filter((e) => !p.topic || e.topics.includes(p.topic));
      return { events: events.slice(0, p.limit), total: events.length };
    },
    eligibility: async () => ({ eligible: true }),
    register: async () => ({}),
  };
}
const mountDiscover = (api) => mountContracts(h(DiscoverTabFull, { api, held: new Set(), invitations: [], suggested: [], suggestionsRead: null, onRegistered() {}, onAccept() {}, now: NOW }), '/my/events/discover');
const rows = (v) => v.nodes().filter((n) => v.props(n)?.['data-testid'] === 'my-events-discover-row').length;

test('Discover: a topic chip narrows the list and the page count; picking it again restores them', async () => {
  const api = discoverApi();
  const v = await mountDiscover(api);
  try {
    for (let i = 0; i < 6; i++) await v.flush();
    assert.equal(TOPICS.length, v.nodes().filter((n) => /^my-events-discover-topic-/.test(v.props(n)?.['data-testid'] || '')).length, 'one chip per topic');
    assert.equal(rows(v), 25);
    assert.match(v.text(), /1–25 of 30/);
    await press(v, chip(v, 'my-events-discover-topic-ai'));
    for (let i = 0; i < 6; i++) await v.flush();
    assert.equal(v.props(chip(v, 'my-events-discover-topic-ai'))['aria-pressed'], true);
    assert.equal(rows(v), 2);
    assert.match(v.text(), /1–2 of 2/);
    assert.doesNotMatch(v.text(), /of 30/);
    const sent = api.calls.filter((p) => p.topic === 'ai');
    assert.ok(sent.some((p) => p.limit === 100) && sent.some((p) => p.limit === 1), 'the list and the month counts both send topic=');
    await press(v, chip(v, 'my-events-discover-topic-ai'));
    for (let i = 0; i < 6; i++) await v.flush();
    assert.equal(rows(v), 25);
    assert.match(v.text(), /1–25 of 30/);
    assert.equal(api.calls.at(-1).topic, undefined);
  } finally { await v.unmount(); }
});

test('Discover: a failed read with a topic is still Unreadable with Retry, not an empty list', async () => {
  const v = await mountDiscover(discoverApi({ fail: true }));
  try {
    await press(v, chip(v, 'my-events-discover-topic-climate'));
    for (let i = 0; i < 6; i++) await v.flush();
    assert.ok(chip(v, 'my-events-discover-unreadable'));
    assert.equal(chip(v, 'my-events-discover-none'), undefined);
    assert.match(v.text(), /The public calendar could not be read\..*Retry/);
  } finally { await v.unmount(); }
});
