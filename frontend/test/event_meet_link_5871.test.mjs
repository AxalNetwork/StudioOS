// #5871 (D3724 gap 13, D5871, NE1): "Create the meeting for me · Google Meet"
// in the event editor. The press asks the Save for the link (`add_meet: true`);
// the Worker makes it inside that save. Synthetic data; `fetch` is stubbed.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/event_meet_link_5871.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { Routes, Route } from 'react-router-dom';
import { mountContracts } from './_contracts_dom.mjs';
import EventEditorPage from '../src/pages/events/EventEditorPage.jsx';
import { CONNECT_HREF, MEET_WORDS, isMeetRefusal, meetOffered, meetPayload, meetRefusal } from '../src/pages/events/eventMeetModel.js';

const h = React.createElement;
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const byId = (v, key) => v.nodes().find((n) => v.props(n)?.['data-testid'] === key);
const press = async (v, node) => { assert.ok(node, 'node exists'); await act(async () => { v.props(node).onClick({ stopPropagation() {}, preventDefault() {} }); }); };
/** A node's text, as the fake DOM holds it (text children). */
const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
const MEET = 'https://meet.google.com/xyz-abcd-efg';
const NOT_CONNECTED = 'Google is not connected to your Axal account. Connect Google in Account › Connectors, then retry.';

async function withFetch(routes, fn) {
  const old = globalThis.fetch; const calls = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input), 'http://local.test'); const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path: url.pathname, method, body });
    for (const [match, reply] of routes) if (match(url.pathname, method, body)) { const [b, s] = reply(body); return json(b, s); }
    return json({});
  };
  try { return await fn(calls); } finally { globalThis.fetch = old; }
}

const editor = () => h(Routes, null, h(Route, { path: '/events/:id/edit', element: h(EventEditorPage) }));
const saved = (over = {}) => ({ id: 1, title: 'Synthetic night', status: 'draft', starts_at: '2026-12-04T18:00:00Z', ends_at: '2026-12-04T20:30:00Z', timezone: 'UTC', visibility: 'private', location_kind: 'virtual', location_url: null, topics: [], ...over });

test('the model: online and hybrid only, add_meet only when pressed, and the refusal in the Worker\'s words', () => {
  assert.equal(meetOffered('virtual'), true);
  assert.equal(meetOffered('hybrid'), true);
  assert.equal(meetOffered('in_person'), false);
  assert.deepEqual(meetPayload('asked', 'virtual'), { add_meet: true });
  assert.deepEqual(meetPayload('asked', 'in_person'), {}, 'never for in person, even pressed');
  assert.deepEqual(meetPayload('idle', 'hybrid'), {});
  assert.deepEqual(meetRefusal({ code: 'meet_not_connected', message: NOT_CONNECTED }), { text: NOT_CONNECTED, connect: true });
  assert.deepEqual(meetRefusal({ code: 'support_session_refused', message: 'A support session cannot.' }), { text: 'A support session cannot.', connect: false });
  assert.equal(meetRefusal({ code: 'bad_topic', message: 'x' }), null, 'another field\'s refusal is not the meeting\'s');
  assert.equal(isMeetRefusal(new Error('down')), false);
  assert.equal(meetRefusal({ code: 'meet_unreachable' }).text, MEET_WORDS.fallback);
});

test('editor: the press is offered for online and hybrid, never in person; Zoom is words, not a button', async () => {
  for (const [kind, offered] of [['virtual', true], ['hybrid', true], ['in_person', false]]) {
    await withFetch([[(p) => p === '/api/events/1', () => [{ event: saved({ location_kind: kind }), agenda: [] }]]], async () => {
      const v = await mountContracts(editor(), '/events/1/edit');
      try {
        for (let i = 0; i < 8; i++) await v.flush();
        assert.equal(!!byId(v, 'event-meet-press'), offered, `${kind}: the press`);
        assert.equal(v.text().includes(MEET_WORDS.press), offered);
        if (offered) {
          assert.ok(v.text().includes(MEET_WORDS.zoom), 'Zoom reads as not available');
          const zoom = byId(v, 'event-meet-zoom');
          assert.equal(zoom.tagName, 'SPAN', 'and is no button');
        }
        const buttons = v.nodes().filter((n) => n.tagName === 'BUTTON');
        if (offered) assert.ok(buttons.some((b) => textOf(b) === MEET_WORDS.press), 'the reader sees button text');
        assert.equal(buttons.some((b) => /Zoom|Teams/.test(textOf(b))), false, `${kind}: no Zoom or Teams button`);
      } finally { await v.unmount(); }
    });
  }
});

test('editor: pressed, the Save asks for the link, and the made link lands in the join field', async () => {
  await withFetch([
    [(p, m) => p === '/api/events/1' && m === 'PATCH', (b) => [{ event: saved({ ...b, location_url: b.add_meet ? MEET : b.location_url }) }]],
    [(p) => p === '/api/events/1', () => [{ event: saved(), agenda: [] }]],
  ], async (calls) => {
    const v = await mountContracts(editor(), '/events/1/edit');
    try {
      for (let i = 0; i < 8; i++) await v.flush();
      assert.equal(calls.some((c) => c.method !== 'GET'), false, 'nothing is made before the Save');
      await press(v, byId(v, 'event-meet-press'));
      assert.ok(v.text().includes(MEET_WORDS.asked));
      assert.equal(v.props(byId(v, 'event-join-link')).disabled, true);
      await v.click('Save changes');
      for (let i = 0; i < 4; i++) await v.flush();
      const patch = calls.find((c) => c.method === 'PATCH');
      assert.equal(patch.body.add_meet, true);
      assert.equal(v.props(byId(v, 'event-join-link')).value, MEET, 'the link is in the field');
      assert.ok(byId(v, 'event-meet-made'));
      await v.click('Save changes');
      for (let i = 0; i < 4; i++) await v.flush();
      const second = calls.filter((c) => c.method === 'PATCH')[1];
      assert.equal('add_meet' in second.body, false, 'a later Save makes no second link');
      assert.equal(second.body.location_url, MEET, 'and keeps the made one');
    } finally { await v.unmount(); }
  });
});

test('editor: no Google account — the refusal in plain words, a link to connect, and the typed link still saves', async () => {
  await withFetch([
    [(p, m, b) => p === '/api/events/1' && m === 'PATCH' && b.add_meet, () => [{ error: 'meet_not_connected', message: NOT_CONNECTED }, 409]],
    [(p, m) => p === '/api/events/1' && m === 'PATCH', (b) => [{ event: saved(b) }]],
    [(p) => p === '/api/events/1', () => [{ event: saved(), agenda: [] }]],
  ], async (calls) => {
    const v = await mountContracts(editor(), '/events/1/edit');
    try {
      for (let i = 0; i < 8; i++) await v.flush();
      await press(v, byId(v, 'event-meet-press'));
      await v.click('Save changes');
      for (let i = 0; i < 4; i++) await v.flush();
      const said = byId(v, 'event-meet-refused');
      assert.ok(said, 'the refusal is shown');
      assert.ok(textOf(said).includes(NOT_CONNECTED));
      assert.equal(v.props(byId(v, 'event-meet-connect')).href, CONNECT_HREF);
      const field = byId(v, 'event-join-link');
      assert.equal(v.props(field).disabled, false, 'the typed link field works');
      await act(async () => v.props(field).onChange({ target: { value: 'https://example.invalid/room' } }));
      await v.click('Save changes');
      for (let i = 0; i < 4; i++) await v.flush();
      const last = calls.filter((c) => c.method === 'PATCH').at(-1);
      assert.equal('add_meet' in last.body, false);
      assert.equal(last.body.location_url, 'https://example.invalid/room');
    } finally { await v.unmount(); }
  });
});

test('editor: a new event can be given its meeting before its first save', async () => {
  await withFetch([[(p, m) => p === '/api/events' && m === 'POST', () => [{ event: { id: 9 } }, 201]]], async (calls) => {
    const v = await mountContracts(h(Routes, null, h(Route, { path: '/events/new', element: h(EventEditorPage) }), h(Route, { path: '/events/:id/edit', element: h('p', null, 'landed') })), '/events/new');
    try {
      await v.flush();
      const title = v.nodes().find((n) => n.tagName === 'INPUT' && v.props(n)?.placeholder === 'Spring Demo Day');
      await act(async () => v.props(title).onChange({ target: { value: 'Synthetic launch' } }));
      const start = v.nodes().filter((n) => v.props(n)?.type === 'datetime-local')[0];
      await act(async () => v.props(start).onChange({ target: { value: '2026-12-12T18:00' } }));
      await press(v, byId(v, 'event-meet-press'));
      await v.click('Create event');
      await v.flush();
      const post = calls.find((c) => c.method === 'POST' && c.path === '/api/events');
      assert.equal(post.body.add_meet, true);
      assert.equal(post.body.title, 'Synthetic launch');
    } finally { await v.unmount(); }
  });
});

test('wiring: one client method on the mounted Save routes, and no join link on the social preview', () => {
  const api = read('frontend/src/lib/eventsApi.js');
  assert.match(api, /saveWithMeet: \(id, data\) =>/);
  assert.match(api, /request\(`\/events\/\$\{id\}`, \{ method: 'PATCH', body: JSON\.stringify\(\{ \.\.\.data, add_meet: true \}\) \}\)/);
  assert.match(api, /request\('\/events', \{ method: 'POST', body: JSON\.stringify\(\{ \.\.\.data, add_meet: true \}\) \}\)/);
  const worker = read('cloudflare-worker/src/routes/events.ts');
  assert.match(worker, /eventMeet\(c, u, body\.add_meet/);
  assert.doesNotMatch(read('frontend/src/pages/events/EventEditorPreview.jsx'), /location_url/, 'the preview and social card draw no join link');
});
