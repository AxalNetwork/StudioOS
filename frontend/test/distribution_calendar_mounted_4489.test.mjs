/** D4489 — mounted shared read and calendar route integration. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PostPreview from '../src/pages/cycles/distribution/PostPreview.jsx';
import { readFileSync } from 'node:fs';
import { mountContracts } from './_contracts_dom.mjs';
import { CalendarWeek } from '../src/pages/cycles/distribution/CalendarTab.jsx';
const h = React.createElement;
test('Overview reads an inclusive Monday-Sunday week and shows the real pieces', async () => {
  const calls = [];
  const m = await mountContracts(h(CalendarWeek, { projectId: 7, api: { pieces: async (...args) => { calls.push(args); return { pieces: [{ uid: 'a', title: 'Customer story', planned_on: '2026-11-05', status: 'scheduled' }] }; } } }));
  try {
    await m.flush(); assert.equal(calls.length, 1); assert.equal(calls[0][0], 7);
    const { from, to } = calls[0][1]; assert.equal(new Date(from).getUTCDay(), 1); assert.equal(new Date(to).getUTCDay(), 0);
    assert.equal(new Date(to) - new Date(from), 6 * 86400000); assert.match(m.text(), /Customer story/); assert.match(m.text(), /Scheduled/);
  } finally { await m.unmount(); }
});
test('failed weekly read is Unreadable with retry, never empty or a raw server error', async () => {
  let fail = true;
  const m = await mountContracts(h(CalendarWeek, { projectId: 7, api: { pieces: async () => { if (fail) throw new Error('private server detail'); return { pieces: [] }; } } }));
  try { await m.flush(); assert.match(m.text(), /Unreadable/); assert.doesNotMatch(m.text(), /private server detail|Nothing planned/); fail = false; await m.click('Try again'); await m.flush(); assert.match(m.text(), /Nothing planned this week/); } finally { await m.unmount(); }
});
test('Calendar is a real tab and Overview retires the old list', () => {
  const s = readFileSync(new URL('../src/pages/cycles/CycleRoute.jsx', import.meta.url), 'utf8');
  assert.match(s, /distributionTab === 'calendar'.*<CalendarTab projectId=\{projectId\}/);
  assert.match(s, /<CalendarWeek projectId=\{ctx.projectId\}/); assert.doesNotMatch(s, /<ContentCalendar/);
});

test('preview renders local raster URLs and leaves URL/HTML payloads out of image sources', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin: 'https://axal.example' } });
  try {
    const image = 'blob:https://axal.example/01234567-89ab-cdef-0123-456789abcdef';
    const local = renderToStaticMarkup(h(PostPreview, { image, text: '<script>alert(1)</script>' }));
    assert.ok(local.includes(`src="${image}"`));
    assert.ok(local.includes('&lt;script&gt;')); assert.ok(!local.includes('<script>'));
    for (const image of ['javascript:alert(1)', '<img src=x onerror=alert(1)>', 'https://remote.example/image.png']) {
      const html = renderToStaticMarkup(h(PostPreview, { image }));
      assert.ok(!html.includes('<img')); assert.match(html, /Image not recorded/);
    }
  } finally {
    if (original) Object.defineProperty(globalThis, 'location', original); else delete globalThis.location;
  }
});
