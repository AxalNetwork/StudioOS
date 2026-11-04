// D4486 (#4486) — channel table columns, independent pills, supported actions and honest values.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { renderedText } from './_renderedText.mjs';
import ChannelsTab, { ChannelPill, ConnectionCard } from '../src/pages/cycles/distribution/ChannelsTab.jsx';
import { CHANNEL_COLUMNS, CHANNEL_DOORS, CHANNEL_PILLS, CONNECTION_PILLS, activityLabel, connectionAction, recorded, channelOptions } from '../src/pages/cycles/distribution/channelsModel.js';
import { growChannelsApi } from '../src/lib/api/growChannels.js';
import { formFor, editFor } from '../src/pages/cycles/forms.js';
const h = React.createElement;
const html = (element) => renderToStaticMarkup(h(MemoryRouter, null, element));

test('columns and rendered channel/connection pills keep channel state distinct from connectivity', () => {
  assert.deepEqual(CHANNEL_COLUMNS, ['Channel', 'Status', 'Owner', 'What it’s for', 'Last activity', 'Results']);
  assert.deepEqual(CHANNEL_PILLS.active, { label: 'Active', tone: 'lavender' });
  assert.deepEqual(CONNECTION_PILLS.connected, { label: 'Connected', tone: 'positive' });
  assert.deepEqual(CONNECTION_PILLS.expired, { label: 'Reconnect', tone: 'amber' });
  assert.match(html(h(ChannelPill, { value: 'active' })), /Active/);
  assert.match(html(h(ChannelPill, { value: 'connected', connection: true })), /Connected/);
  assert.doesNotMatch(html(h(ChannelPill, { value: 'active' })), /Connected/);
});

test('LinkedIn action is disabled, its approval reason visible, and every unsupported provider stays unavailable', () => {
  const connection = { key: 'linkedin', name: 'LinkedIn', status: 'not_offered', reason: 'Needs LinkedIn’s approval', href: null };
  const out = html(h(ConnectionCard, { connection, onAction() { throw new Error('disabled'); } }));
  assert.match(out, /<button[^>]*disabled/); assert.match(renderedText(out), /Needs LinkedIn’s approval/);
  assert.equal(connectionAction(connection).disabled, true);
  assert.equal(connectionAction({ ...connection, href: '/account/connectors' }).disabled, true);
  assert.equal(connectionAction({ status: 'connected', href: 'https://example.test' }).disabled, true);
  assert.equal(connectionAction({ status: 'connected', href: '/email' }).label, 'Disconnect');
  assert.equal(connectionAction({ status: 'error', href: '/email' }).label, 'Try again');
  assert.equal(connectionAction({ status: 'not_connected', href: '/account/connectors/telegram' }).disabled, false);
});

test('null is Not recorded, failed read is Unreadable, an observed zero remains zero', () => {
  assert.equal(recorded(null), 'Not recorded'); assert.equal(recorded(null, 'Unreadable: failed'), 'Unreadable');
  assert.equal(recorded(0), '0'); assert.equal(recorded(4), '4');
  assert.deepEqual(CHANNEL_DOORS.map((d) => d.href), ['/grow/launch', '/build/brand', '/comarketing']);
  assert.deepEqual(channelOptions([{ user_id: 2, name: 'Cal' }]).owner_user_id.opts, [{ value: '', label: 'Not assigned' }, { value: '2', label: 'Cal' }]);
});

test('recorded activity uses compact UTC labels while missing or invalid readings never invent activity', () => {
  const now = Date.parse('2026-11-04T14:30:00Z');
  assert.equal(activityLabel('2026-11-04T12:30:00Z', now), '2h ago');
  assert.equal(activityLabel('2026-11-04 14:20:00', now), 'Today');
  assert.equal(activityLabel('2026-11-03T20:00:00Z', now), 'Yesterday');
  assert.match(activityLabel('2026-10-28T10:00:00Z', now), /28/);
  assert.equal(activityLabel('bad', now), 'Unreadable');
});

test('existing channel forms carry purpose and member owner without changing the name Ask target', () => {
  const form = formFor('grow', 'distribution'); const edit = editFor('grow', 'distribution');
  for (const f of [form, edit]) {
    assert.equal(f.fields.find((x) => x.name === 'purpose').max, 140);
    assert.ok(f.fields.some((x) => x.name === 'owner_user_id'));
  }
  const b = form.toBody({ name: 'Search', state: 'testing', purpose: 'Reach teams', owner_user_id: '2' });
  assert.equal(b.purpose, 'Reach teams'); assert.equal(b.owner_user_id, 2);
  assert.equal(edit.toBody({ name: 'Search', state: 'active' }).owner_user_id, undefined);
  assert.equal(edit.toBody({ name: 'Search', state: 'active', owner_user_id: '', purpose: '' }).owner_user_id, null);
  const source = readFileSync(new URL('../src/lib/fillForms.js', import.meta.url), 'utf8');
  assert.match(source, /'grow\/distribution': 'Founder · Grow · Distribution'/);
});

test('the tab renders real column order, missing values, venture doors and no invented reach or clicks', async () => {
  const restore = installDocument(); const previous = growChannelsApi.channels;
  growChannelsApi.channels = async () => ({ can_write: false, members: [], connections: [], channels: [{ uid: 'a', name: 'Search', status: 'testing', owner: null, purpose: null, last_activity: null, results: null, campaigns: [] }] });
  const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
  try {
    await act(async () => { root.render(h(MemoryRouter, null, h(ChannelsTab, { projectId: 7 }))); });
    const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
    const nodes = walk(container); const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
    const text = (n) => n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '';
    assert.deepEqual(nodes.filter((n) => n.tagName === 'TH' && props(n).scope === 'col').map(text), CHANNEL_COLUMNS);
    assert.match(text(container), /Not recorded/); assert.doesNotMatch(text(container), /Reach|Clicks|0 leads/);
    for (const d of CHANNEL_DOORS) assert.ok(nodes.some((n) => n.tagName === 'A' && props(n).href === `${d.href}?project_id=7`));
    assert.doesNotMatch(text(container), /Add channel/);
  } finally { await act(async () => root.unmount()); growChannelsApi.channels = previous; restore(); }
});
