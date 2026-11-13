/**
 * D484 (#1025) — the review page sets the time an approved article goes out,
 * and HQ · Content (H6) shows the times.
 *
 * The worker half (the route, the cron, H6's read) is pinned on real SQLite in
 * `cloudflare-worker/test/article_publish_at_d484.test.ts`.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/article_publish_at_d484.test.mjs
 */
// A zone that is not UTC, so a test that confuses local and UTC fails.
process.env.TZ = 'Europe/Paris';

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';
import { localInputValue, publishAtFromLocal, utcLabel } from '../src/pages/admin/articlePublishAt.js';
import { MemoryRouter } from 'react-router-dom';
import QueueDialog from '../src/pages/admin/contentQueue/QueueDialog.jsx';
import { actionsFor, scheduleAt, scheduleFields } from '../src/pages/admin/contentQueue/pipelineModel.js';
import { PublishTimes } from '../src/pages/hq/ContentPage.jsx';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const html = (C, props) => renderToStaticMarkup(React.createElement(C, props));

// ── The time, across zones ────────────────────────────────────────────────

test('a datetime-local value is read in the browser\'s zone and sent as UTC', () => {
  // 7 October 2026: Paris is on summer time, UTC+2.
  assert.equal(publishAtFromLocal('2026-10-07T09:00'), '2026-10-07T07:00:00.000Z');
  // 7 December: winter time, UTC+1.
  assert.equal(publishAtFromLocal('2026-12-07T09:00'), '2026-12-07T08:00:00.000Z');
  for (const bad of ['', null, undefined, 'tomorrow', '2026-10-07', '2026-10-07T09:00Z', '07/10/2026 09:00']) {
    assert.equal(publishAtFromLocal(bad), null, String(bad));
  }
});

test('a stored time is shown in UTC, and prefilled back into the input in the browser\'s zone', () => {
  assert.equal(utcLabel('2026-10-07T07:00:00.000Z'), '2026-10-07 07:00 UTC');
  assert.equal(utcLabel('not a time'), null);
  assert.equal(utcLabel(null), null);
  assert.equal(localInputValue('2026-10-07T07:00:00.000Z'), '2026-10-07T09:00');
  assert.equal(localInputValue(null), '');
  // Round trip: what the input shows is what it sends back.
  assert.equal(publishAtFromLocal(localInputValue('2026-12-07T08:30:00.000Z')), '2026-12-07T08:30:00.000Z');
});

// ── The review page ───────────────────────────────────────────────────────

// D1295 (#3391): the time is set in Schedule's in-page dialog (ART6 E), on the
// same rule: read in the reader's zone, sent as UTC, shown back in UTC.

test('Schedule asks for a date and a time in the reader\'s zone, and sends nothing that is not ahead', () => {
  const markup = html(MemoryRouter, { children: React.createElement(QueueDialog, { kind: 'schedule', article: { id: 3, title: 'T', status: 'approved', publish_at: null }, onConfirm() {}, onClose() {} }) });
  assert.match(markup, /type="date"/);
  assert.match(markup, /type="time"/);
  const confirm = markup.match(/<button[^>]*data-testid="cq-dialog-confirm"[^>]*>/)[0];
  assert.match(confirm, /disabled=""/, 'no date, nothing to send');
  const now = Date.parse('2026-10-01T00:00:00Z');
  assert.equal(scheduleAt('2026-10-07', '09:00', now), '2026-10-07T07:00:00.000Z', 'Paris summer time is UTC+2');
  assert.equal(scheduleAt('2026-09-30', '09:00', now), null, 'a time in the past');
  assert.equal(scheduleAt('2027-12-07', '09:00', now), null, 'more than a year ahead');
  assert.equal(scheduleAt('', '09:00', now), null);
});

test('a scheduled article\'s dialog shows the stored time in UTC and prefills it in the reader\'s zone', () => {
  const markup = html(MemoryRouter, { children: React.createElement(QueueDialog, { kind: 'schedule', article: { id: 3, title: 'T', status: 'approved', publish_at: '2026-10-07T07:00:00.000Z' }, onConfirm() {}, onClose() {} }) });
  assert.match(renderedText(markup), /Set now: 2026-10-07 07:00 UTC/);
  assert.match(markup, /value="2026-10-07"/);
  assert.match(markup, /value="09:00"/);
  assert.deepEqual(scheduleFields(null), { date: '', time: '09:00' });
});

test('the drawer offers Schedule and Clear time on approved articles only, and sends through api.schedule', () => {
  const viewer = { userId: 9, superAdmin: false };
  assert.ok(actionsFor({ status: 'approved', publish_at: null, author_user_id: 2 }, viewer).includes('schedule'));
  assert.ok(actionsFor({ status: 'approved', publish_at: '2026-10-07T07:00:00.000Z', author_user_id: 2 }, viewer).includes('clear'));
  for (const status of ['submitted', 'in_review', 'published', 'rejected']) {
    assert.ok(!actionsFor({ status, author_user_id: 2 }, viewer).some((a) => a === 'schedule' || a === 'clear'), status);
  }
  const drawer = codeOnly(read('frontend/src/pages/admin/contentQueue/ReviewDrawer.jsx'));
  assert.match(drawer, /schedule: \(id, r\) => api\.schedule\(id, r\.publishAt\)/);
  assert.match(drawer, /clear: \(id\) => api\.schedule\(id, null\)/);
});

test('api.adminArticles.schedule posts publish_at, a time or null, to the worker route', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), method: init?.method, body: init?.body });
    return new Response('{"article":{}}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const { adminArticles } = await import('../src/lib/api.js');
    await adminArticles.schedule(7, '2026-10-07T07:00:00.000Z');
    await adminArticles.schedule(7, null);
  } finally { globalThis.fetch = real; }
  assert.match(sent[0].url, /\/admin\/articles\/7\/schedule$/);
  assert.equal(sent[0].method, 'POST');
  assert.deepEqual(JSON.parse(sent[0].body), { publish_at: '2026-10-07T07:00:00.000Z' });
  assert.deepEqual(JSON.parse(sent[1].body), { publish_at: null });
});

// ── H6 ────────────────────────────────────────────────────────────────────

const PT = {
  recorded: true, scheduled: 2, unscheduled: 1,
  next: [
    { id: 4, title: 'Seed terms, explained', publish_at: '2026-10-07T07:00:00.000Z' },
    { id: 9, title: 'Q4 letter', publish_at: '2026-10-08T13:30:00.000Z' },
  ],
  note: 'An approved article with a publish time goes out when it passes, checked every minute.',
};

test('H6 shows how many approved articles have a time, how many wait, and the soonest, in UTC', () => {
  const markup = html(PublishTimes, { pt: PT });
  assert.match(markup, /data-testid="hq-content-publish-time" data-state="recorded"/);
  const t = renderedText(markup);
  assert.match(t, /Publish time · 2 approved articles set to go out, 1 waiting for a manual publish\./);
  const items = [...markup.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => renderedText(m[1]));
  assert.deepEqual(items, ['2026-10-07 07:00 UTC · Seed terms, explained', '2026-10-08 13:30 UTC · Q4 letter']);
  assert.match(t, /checked every minute/);
  const one = renderedText(html(PublishTimes, { pt: { ...PT, scheduled: 1, next: PT.next.slice(0, 1) } }));
  assert.match(one, /1 approved article set to go out/);
  const none = html(PublishTimes, { pt: { ...PT, scheduled: 0, unscheduled: 3, next: [] } });
  assert.match(renderedText(none), /0 approved articles set to go out, 3 waiting/);
  assert.doesNotMatch(none, /hq-content-publish-next/, 'no list when nothing is timed');
});

test('H6 without the times read says Not recorded with the reason, never "none scheduled"', () => {
  const reason = 'The publish times could not be read on this database (migration 346).';
  const markup = html(PublishTimes, { pt: { recorded: false, reason } });
  assert.match(markup, /data-testid="hq-content-publish-time"/);
  assert.doesNotMatch(markup, /data-state="recorded"/);
  assert.match(renderedText(markup), /Not recorded/);
  assert.ok(renderedText(markup).includes(reason));
  assert.doesNotMatch(renderedText(markup), /0 approved/);
  assert.match(renderedText(html(PublishTimes, { pt: undefined })), /Not recorded/);
});
