// D4478: the real lesson footer, connection events, latest-position queue and empty reading.
import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import LessonPlayer from '../src/pages/learning/LessonPlayer.jsx';
import LessonFooter from '../src/pages/learning/LessonFooter.jsx';
import { lessonPositionLine, markCompleteReason, progressRefusal } from '../src/pages/learning/lessonFooterModel.js';
import { queuedPositionWriter } from '../src/pages/learning/lessonPositionWriter.js';

const html = (element) => renderToStaticMarkup(h(MemoryRouter, null, element));
const settle = async () => { await new Promise((resolve) => setTimeout(resolve, 0)); };
const ITEM = { uid: 'video-one', title: 'The script', kind: 'video', thumbnail_url: '/poster.png', duration_seconds: 100, chapters: [{ start_seconds: 0, title: 'Intro' }, { start_seconds: 20, title: 'The script' }] };
const VIDEO = { src: '/api/learning/items/video-one/video', embed: false };
const textOf = (node) => node.childNodes?.length ? node.childNodes.map(textOf).join('') : node.textContent || '';

async function mount(element, { online = true } = {}) {
  const restore = installDocument();
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: online } });
  const events = new EventTarget();
  window.addEventListener = events.addEventListener.bind(events);
  window.removeEventListener = events.removeEventListener.bind(events);
  const box = document.createElement('div'); document.body.appendChild(box);
  const root = createRoot(box);
  const render = (next) => root.render(h(MemoryRouter, { initialEntries: ['/learning/videos/video-one'] }, next));
  await act(async () => render(element));
  const nodes = () => { const walk = (node) => [node, ...(node.childNodes || []).flatMap(walk)]; return walk(box); };
  const props = (node) => Object.entries(node).find(([key]) => key.startsWith('__reactProps$'))?.[1];
  const byId = (id) => nodes().find((node) => props(node)?.['data-testid'] === id);
  const video = () => nodes().find((node) => node.tagName === 'VIDEO');
  return {
    nodes, props, byId, text: () => textOf(box),
    async time(seconds) { await act(async () => { props(video()).onTimeUpdate({ currentTarget: { currentTime: seconds, duration: 100 } }); }); },
    async pause(seconds) { await act(async () => { props(video()).onPause({ currentTarget: { currentTime: seconds, duration: 100 } }); }); },
    async online(value) { await act(async () => { navigator.onLine = value; events.dispatchEvent(new Event(value ? 'online' : 'offline')); await settle(); }); },
    async render(next) { await act(async () => render(next)); },
    async flush() { await act(settle); },
    async unmount() {
      await act(async () => root.unmount());
      if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor); else delete globalThis.navigator;
      restore();
    },
  };
}

test('D4478: lesson positions name known zero-based order, optionally with a module; unknown order draws nothing', () => {
  assert.equal(lessonPositionLine({ index: 2, total: 5, moduleTitle: 'Module 2: Interviews' }), 'Lesson 3 of 5 in Module 2: Interviews');
  assert.equal(lessonPositionLine({ index: 2, total: 5 }), 'Lesson 3 of 5');
  assert.equal(lessonPositionLine({ index: 0, total: 1, moduleTitle: '  ' }), 'Lesson 1 of 1');
  for (const value of [{ index: 2, total: null }, { total: 5 }, { index: null, total: 5 }, { index: -1, total: 5 }, { index: 5, total: 5 }, { index: 0, total: 0 }, { index: 1.5, total: 5 }]) assert.equal(lessonPositionLine(value), null);
});

test('D4478: completion reasons distinguish saving, no content/handler, and an available action', () => {
  assert.equal(markCompleteReason({ marking: true, hasBody: false, hasHandler: true }), 'Saving');
  assert.equal(markCompleteReason({ marking: false, hasBody: false, hasHandler: true }), 'Nothing to complete yet');
  assert.equal(markCompleteReason({ marking: false, hasBody: true, hasHandler: false }), 'Nothing to complete yet');
  assert.equal(markCompleteReason({ marking: false, hasBody: true, hasHandler: true }), null);
});

test('D4478: footer has named navigation, known position, and no invented position', () => {
  const markup = html(h(LessonFooter, { index: 2, total: 5, moduleTitle: 'Module 2: Interviews', prev: { href: '/learning/courses/example/previous' }, next: { href: '/learning/courses/example/next' }, onMarkComplete() {} }));
  assert.match(markup, /Lesson 3 of 5 in Module 2: Interviews/);
  assert.match(markup, /aria-label="Previous lesson"[^>]*href="\/learning\/courses\/example\/previous"/);
  assert.match(markup, /aria-label="Next lesson"[^>]*href="\/learning\/courses\/example\/next"/);
  assert.doesNotMatch(html(h(LessonFooter, { index: 0, total: null, onMarkComplete() {} })), /Lesson 1|Lesson 0|of 0/);
});

test('D4478: Saving replaces the centre and its disabled button has an accessible reason', async () => {
  const view = await mount(h(LessonFooter, { index: 2, total: 5, marking: true, onMarkComplete() {} }));
  try {
    const button = view.byId('button-mark-complete');
    assert.equal(view.props(button).disabled, true);
    assert.equal(view.props(button).title, 'Saving');
    const reasonId = view.props(button)['aria-describedby'];
    assert.equal(textOf(view.nodes().find((node) => view.props(node)?.id === reasonId)), 'Saving');
    assert.equal(textOf(view.byId('lesson-position')), 'Saving…');
    assert.doesNotMatch(view.text(), /Lesson 3 of 5/);
  } finally { await view.unmount(); }
});

test('D4478: an empty reading omits the footer and names what is not published', () => {
  for (const completed of [false, true]) {
  const markup = html(h(LessonPlayer, { status: 'ready', completed, lesson: { kind: 'reading' }, item: { uid: 'reading', kind: 'reading', body: '  ' }, onMarkComplete() {} }));
  assert.doesNotMatch(markup, /data-testid="lesson-footer"/);
  assert.match(markup, /disabled="" title="Nothing to complete yet" aria-describedby=/);
  assert.match(markup, /No text yet/);
  assert.match(markup, /Not recorded/);
  assert.match(markup, /This reading has no text published yet\./);
  }
});

test('D4478: offline events retain only the newest time, flush once on online, and leave completion available', async () => {
  const writes = [];
  const view = await mount(h(LessonPlayer, { status: 'ready', item: ITEM, video: VIDEO, onPosition: (s, p) => { writes.push([s, p]); }, onMarkComplete() {} }), { online: false });
  try {
    assert.ok(view.byId('lesson-offline'));
    assert.match(view.text(), /You are offline\.Progress will save when you reconnect\./);
    assert.equal(view.props(view.byId('button-mark-complete')).disabled, false);
    await view.time(12); await view.time(26); await view.pause(27);
    assert.deepEqual(writes, []);
    await view.online(true); await view.flush();
    assert.deepEqual(writes, [[27, 27]]);
    assert.equal(view.byId('lesson-offline'), undefined);
    await view.online(true); await view.flush();
    assert.deepEqual(writes, [[27, 27]], 'a duplicate online event cannot duplicate the saved position');
  } finally { await view.unmount(); }
});

test('D4478: offline ticks inside the throttle window still retain the latest position', async () => {
  let online = true, now = 0;
  const writes = [];
  const writer = queuedPositionWriter((s, p) => writes.push([s, p]), { online: () => online, now: () => now });
  try {
    writer.tick(10, 100); await settle();
    online = false; now = 1000;
    writer.tick(12, 100); writer.tick(18, 100);
    online = true;
    assert.equal(writer.reconnect(), true);
    await settle();
    assert.deepEqual(writes, [[10, 10], [18, 18]]);
  } finally { writer.dispose(); }
});

test('D4478: reconnect during a request waits for it, then flushes the latest queued position', async () => {
  let online = true, release;
  const writes = [];
  const writer = queuedPositionWriter((s, p) => { writes.push([s, p]); if (s === 10) return new Promise((resolve) => { release = resolve; }); }, { online: () => online });
  try {
    writer.flush(10, 100); await settle();
    online = false; writer.tick(12, 100); writer.flush(28, 100);
    online = true;
    assert.equal(writer.reconnect(), false);
    release(); await settle(); await settle();
    assert.deepEqual(writes, [[10, 10], [28, 28]]);
  } finally { writer.dispose(); }
});

test('D4478: changing the video discards its queued time instead of writing it to the new item', async () => {
  const writes = [];
  const first = (s) => writes.push(['one', s]);
  const second = (s) => writes.push(['two', s]);
  const view = await mount(h(LessonPlayer, { status: 'ready', item: ITEM, video: VIDEO, onPosition: first }), { online: false });
  try {
    await view.time(25);
    await view.render(h(LessonPlayer, { status: 'ready', item: { ...ITEM, uid: 'video-two' }, video: { src: '/api/learning/items/video-two/video', embed: false }, onPosition: second }));
    await view.online(true); await view.flush();
    assert.deepEqual(writes, []);
    await view.time(6); await view.flush();
    assert.deepEqual(writes, [['two', 6]]);
  } finally { await view.unmount(); }
});

test('D4478: failed progress writes show the route refusal, never an exception message', async () => {
  const view = await mount(h(LessonPlayer, { status: 'ready', item: ITEM, video: VIDEO, onPosition: async () => { throw Object.assign(new Error('Internal transport detail'), { data: { code: 'progress_refused', message: 'Your profile cannot record this progress.' } }); } }));
  try {
    await view.time(12); await view.flush();
    assert.match(view.text(), /Your profile cannot record this progress\./);
    assert.doesNotMatch(view.text(), /Internal transport detail/);
  } finally { await view.unmount(); }
});


test('D4478: an old source refusal cannot appear under the next video', async () => {
  let reject;
  const view = await mount(h(LessonPlayer, { status: 'ready', item: ITEM, video: VIDEO, onPosition: () => new Promise((_resolve, fail) => { reject = fail; }) }));
  try {
    await view.time(12);
    await view.render(h(LessonPlayer, { status: 'ready', item: { ...ITEM, uid: 'video-two' }, video: { src: '/api/learning/items/video-two/video', embed: false }, onPosition() {} }));
    reject({ data: { message: 'Old video refused this position.' } });
    await view.flush();
    assert.doesNotMatch(view.text(), /Old video refused this position/);
  } finally { await view.unmount(); }
});


test('D4478: refusal words come from structured route data, never Error.message', () => {
  assert.equal(progressRefusal({ data: { error: { message: 'This lesson is not published.' } }, message: 'Internal transport detail' }), 'This lesson is not published.');
  assert.equal(progressRefusal(new Error('Internal transport detail')), 'Your progress could not be saved.');
});


test('D4478: the uploaded-file fallback identifies its source and records no invented chapters', () => {
  const markup = html(h(LessonPlayer, { status: 'ready', item: { ...ITEM, video_source: 'r2', chapters: [] }, video: VIDEO }));
  assert.match(markup, /aria-label="Video \(uploaded file\)"/);
  assert.match(markup, /data-testid="lesson-uploaded-file">Uploaded file/);
  assert.match(markup, /data-testid="lesson-chapters-none"/);
});
