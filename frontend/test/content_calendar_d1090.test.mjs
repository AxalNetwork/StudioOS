// D1090 (#2955) — Distribution's content calendar card and Grow's From Notion
// mounts. Typed pieces are planned and edited here through in-page dialogs; a
// piece from Notion offers Delete only, and stays deleted. Mounted against a
// fake writer; no test reaches the Worker or Notion.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/content_calendar_d1090.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import ContentCalendar, { CONTENT_STATUS, contentBody, plannedLabel } from '../src/pages/cycles/ContentCalendar.jsx';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');

async function mount(el) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => root.render(el));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join('') : n.textContent || '');
  return {
    by, pr, text: (id) => txt(id ? by(id) : container).replace(/\s+/g, ' '),
    async click(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    async type(id, value) { const n = by(id); await act(async () => { pr(n).onChange({ target: { value } }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

function fakeApi() {
  const calls = [];
  return {
    calls,
    async content(...a) { calls.push(['content', ...a]); return { uid: 'new' }; },
    async contentUpdate(...a) { calls.push(['contentUpdate', ...a]); return { uid: a[1] }; },
    async contentDelete(...a) { calls.push(['contentDelete', ...a]); return { deleted: true }; },
  };
}
const PART = { state: 'ready', items: [
  { uid: 'c1', title: 'Launch post', planned_on: '2026-11-03', status: 'planned', url: 'https://acme.example/launch', source: 'manual', channel_uid: 'ch-news', channel_name: 'Newsletter' },
  { uid: 'c2', title: 'Podcast clip', planned_on: null, status: 'scheduled', url: null, source: 'notion', channel_uid: null, channel_name: null },
] };
const CHANNELS = [{ id: 'ch-news', name: 'Newsletter' }, { id: 'ch-li', name: 'LinkedIn' }];

test('the statuses are the Worker\'s; a missing date says so; the body sends a blank as none', () => {
  assert.deepEqual(CONTENT_STATUS.map(([v]) => v), ['idea', 'planned', 'scheduled', 'published', 'dropped']);
  assert.match(read('cloudflare-worker/src/services/growWriters.ts'), /CONTENT_STATUS = \['idea', 'planned', 'scheduled', 'published', 'dropped'\] as const/);
  assert.match(read('cloudflare-worker/sql/migrations/587_content_calendar_items.sql'), /CHECK \(status IN \('idea', 'planned', 'scheduled', 'published', 'dropped'\)\)/);
  assert.equal(plannedLabel(null), 'No date yet');
  assert.equal(plannedLabel('2026-11'), 'No date yet');
  assert.equal(plannedLabel('2026-11-03'), '3 Nov 2026');
  assert.deepEqual(contentBody({ title: ' Post ', planned_on: '', status: '', channel_uid: '', url: ' ' }), { title: 'Post', planned_on: null, status: 'idea', channel_uid: null, url: null });
});

test('the card: each piece with its date, channel and status; a Notion piece is marked and offers Delete, never Edit', async () => {
  const v = await mount(h(ContentCalendar, { part: PART, channels: CHANNELS, projectId: 701, reload() {}, api: fakeApi() }));
  try {
    assert.match(v.text('content-calendar'), /A plan, never a record of what was sent\./);
    assert.match(v.text('content-item-c1'), /^Launch post3 Nov 2026 · NewsletterPlannedEditDelete$/);
    assert.match(v.text('content-item-c2'), /^Podcast clipNo date yet · No channelScheduledFrom NotionDelete$/);
    assert.ok(v.by('content-edit-c1'));
    assert.ok(!v.by('content-edit-c2'), 'a Notion piece is edited in Notion');
    assert.ok(v.by('content-notion-c2'));
    assert.ok(!v.by('content-notion-c1'));
  } finally { await v.unmount(); }
});

test('Plan a piece opens a dialog that says what it changes, and sends what was typed', async () => {
  const api = fakeApi(); let reloaded = 0;
  const v = await mount(h(ContentCalendar, { part: { state: 'ready', items: [] }, channels: CHANNELS, projectId: 701, reload() { reloaded += 1; }, api }));
  try {
    assert.match(v.text('content-empty'), /Nothing planned yet/);
    await v.click('content-add');
    assert.match(v.text('content-what'), /Adds a piece to Distribution’s content calendar\. Nothing is published or sent\./);
    await v.click('content-save');
    assert.match(v.text('content-error'), /Give the piece a title\./);
    assert.equal(api.calls.length, 0);
    await v.type('content-title', 'Launch post');
    await v.type('content-date', '2026-11-03');
    await v.type('content-status', 'planned');
    await v.type('content-channel', 'ch-li');
    await v.click('content-save');
    assert.deepEqual(api.calls[0], ['content', 701, { title: 'Launch post', planned_on: '2026-11-03', status: 'planned', channel_uid: 'ch-li', url: null }]);
    assert.equal(reloaded, 1);
    assert.ok(!v.by('content-dialog'));
  } finally { await v.unmount(); }
});

test('Edit sends the typed piece\'s fields; Delete of a Notion piece says it stays deleted', async () => {
  const api = fakeApi();
  const v = await mount(h(ContentCalendar, { part: PART, channels: CHANNELS, projectId: 701, reload() {}, api }));
  try {
    await v.click('content-edit-c1');
    assert.equal(v.pr(v.by('content-title')).value, 'Launch post');
    await v.type('content-status', 'published');
    await v.click('content-save');
    assert.deepEqual(api.calls[0], ['contentUpdate', 701, 'c1', { title: 'Launch post', planned_on: '2026-11-03', status: 'published', channel_uid: 'ch-news', url: 'https://acme.example/launch' }]);
    await v.click('content-delete-c2');
    assert.match(v.text('content-delete-what'), /It stays deleted: the next sync from Notion does not bring it back\./);
    await v.click('content-delete-confirm');
    assert.deepEqual(api.calls[1], ['contentDelete', 701, 'c2']);
  } finally { await v.unmount(); }
});

test('an unreadable calendar says so with Try again; nothing is drawn without the part', async () => {
  let reloaded = 0;
  const v = await mount(h(ContentCalendar, { part: { state: 'unreadable', reason: 'Unreadable: the content calendar could not be read' }, projectId: 701, reload() { reloaded += 1; }, api: fakeApi() }));
  try {
    assert.match(v.text('content-unreadable'), /Unreadable: the content calendar could not be read/);
    assert.ok(!v.by('content-add'), 'no Plan a piece over an unread calendar');
    await v.click('content-retry');
    assert.equal(reloaded, 1);
  } finally { await v.unmount(); }
  const w = await mount(h(ContentCalendar, { part: undefined, projectId: 701 }));
  try { assert.equal(w.text(), ''); } finally { await w.unmount(); }
});

test('the wiring: the card and From Notion on Distribution, From Notion on Product improvement; dialogs in-page, dark mode', () => {
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  assert.match(route, /<ContentCalendar part=\{data\?\.parts\?\.content_calendar\} channels=\{data\?\.records\?\.rows\} projectId=\{ctx\.projectId\} reload=\{ctx\.reload\} \/>/);
  assert.match(route, /<FromNotion section="grow" projectId=\{ctx\.projectId\} module="distribution" \/>/);
  // D1608 (#3731): PostHog's part sits beside From Notion on Product improvement.
  assert.match(route, /'product-improvement': \(_data, ctx\) => \(<>\s*<FromNotion section="grow" projectId=\{ctx\.projectId\} module="product_improvement" \/>/);
  const card = read('frontend/src/pages/cycles/ContentCalendar.jsx');
  assert.doesNotMatch(card, /window\.(alert|confirm|prompt)/);
  for (const m of card.matchAll(/'([^']*\bbg-white\b[^']*)'/g)) assert.match(m[1], /dark:bg-/, m[1]);
  const client = read('frontend/src/lib/api/cycleWrites.js');
  assert.match(client, /content: \(projectId, body\) => request\('\/cycles\/grow\/channels\/content', \{ method: 'POST'/);
  assert.match(client, /contentDelete: \(projectId, uid\) => request\(`\/cycles\/grow\/channels\/content\/\$\{seg\(uid\)\}`, \{ method: 'DELETE'/);
});
