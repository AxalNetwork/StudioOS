/**
 * `/inbox` — the address the mailer has been linking to all along (D144).
 *
 * WHAT WAS BROKEN. `services/notify.ts` builds `${root}/inbox` into every
 * notification email, under a comment calling it "the in-app inbox at
 * `/inbox`". `App.jsx` registered no such route, so the link 404'd. The inbox
 * itself was never missing: `NotificationBell` is mounted in the shell and has
 * always had the list, the rows, mark-read and per-row navigation. What was
 * missing was a URL, because a dropdown does not have one.
 *
 * SO THE ASSERTIONS COME IN TWO KINDS. The rendered ones read
 * `NotificationList` — pure and prop-driven, so `renderToStaticMarkup` reaches
 * every state without a fetch stub. The wiring ones read source, including the
 * WORKER's `notify.ts`: the frontend's loader resolves TypeScript while the
 * worker's cannot resolve the SPA's extensionless imports, so a cross-language
 * assertion lives on this side (measured both ways in D141).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import NotificationList, { timeAgo } from '../src/components/NotificationList.jsx';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const APP = read('frontend/src/App.jsx');
const BELL = read('frontend/src/components/NotificationBell.jsx');
const PAGE = read('frontend/src/pages/InboxPage.jsx');
const NOTIFY = read('cloudflare-worker/src/services/notify.ts');

const ROWS = [
  { id: 1, title: 'An escalation is past its SLA', body: 'fr raised "x"', type: 'hq_escalation_sla_breached', created_at: new Date().toISOString(), read_at: null, link: '/hq' },
  { id: 2, title: 'Contract signed', body: null, type: 'contract_signed', created_at: new Date().toISOString(), read_at: new Date().toISOString(), link: null },
];

test('the mailer links at /inbox and the SPA now registers it', () => {
  // The worker half, read across the language boundary rather than restated.
  assert.ok(NOTIFY.includes('${root}/inbox'), 'notify.ts no longer builds the inbox link this pins');
  // The SPA half. Without this route that link is a 404, which is the defect.
  assert.ok(
    /<Route\s+path="\/inbox"/.test(APP),
    '/inbox must be a registered route — notify.ts has been linking to it regardless',
  );
});

test('the route admits every role, exploring included', () => {
  const at = APP.indexOf('<Route path="/inbox"');
  assert.ok(at > 0);
  // Bounded to this route's own element so a neighbouring route cannot satisfy it.
  const el = APP.slice(at, at + 220);
  for (const role of ['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring']) {
    assert.ok(el.includes(`'${role}'`), `/inbox must admit ${role} — a decision notification is often all they have`);
  }
});

test('the bell and the page render ONE list component, not two copies', () => {
  assert.match(BELL, /import NotificationList from '\.\/NotificationList'/);
  assert.match(PAGE, /import NotificationList from '\.\.\/components\/NotificationList'/);
  assert.ok(BELL.includes('<NotificationList'), 'the bell must render the shared list');
  assert.ok(PAGE.includes('<NotificationList'), 'the page must render the shared list');
  // Neither may keep its own row rendering. `read_at ? '' :` is the row's own
  // unread-tint expression, and it belongs in exactly one file.
  for (const [name, src] of [['NotificationBell', BELL], ['InboxPage', PAGE]]) {
    assert.ok(
      !src.includes("read_at ? '' :"),
      `${name} declares its own notification row — that is the drift this component exists to prevent`,
    );
  }
});

test('the bell offers a way to reach the page', () => {
  // A dropdown with no link to the page would leave /inbox reachable only from
  // an email, which is how a surface gets built and then never found.
  assert.ok(BELL.includes("navigate('/inbox')"), 'the bell must link to /inbox');
});

test('an unreadable list is not an empty one', () => {
  const html = renderToStaticMarkup(React.createElement(NotificationList, { items: [], unreadable: true }));
  assert.ok(!html.includes('caught up'), 'a failed read must never claim the inbox is empty');
  assert.match(html, /could not be loaded/, 'it must say the read failed');
  // And the honest-empty state is still available and still distinct.
  const empty = renderToStaticMarkup(React.createElement(NotificationList, { items: [] }));
  assert.match(empty, /caught up/);
  assert.ok(!empty.includes('could not be loaded'));
});

test('both callers distinguish a failed read from an empty one', () => {
  for (const [name, src] of [['NotificationBell', BELL], ['InboxPage', PAGE]]) {
    assert.ok(
      src.includes('setUnreadable(true)'),
      `${name}'s catch must mark the read unreadable, not fall through to an empty list`,
    );
    assert.ok(
      src.includes('unreadable={unreadable}'),
      `${name} must pass that state to the list, or it cannot render it`,
    );
  }
});

test('the loading state is neither of the two', () => {
  const html = renderToStaticMarkup(React.createElement(NotificationList, { items: [], loading: true }));
  assert.match(html, /Loading/);
  assert.ok(!html.includes('caught up'), 'a list still loading has not said it is empty');
  assert.ok(!html.includes('could not be loaded'), 'nor that it failed');
});

test('rows render their title, body, type and age, and mark unread visibly', () => {
  const html = renderToStaticMarkup(React.createElement(NotificationList, { items: ROWS, onItemClick: () => {} }));
  assert.match(html, /An escalation is past its SLA/);
  assert.match(html, /Contract signed/);
  assert.match(html, /hq_escalation_sla_breached/, 'the type is shown, which is how a reader tells two alike titles apart');
  assert.match(html, /fr raised/, 'a body renders when present');
  // Exactly one unread tint, for the one unread row.
  const tints = html.split('bg-violet-50/40').length - 1;
  assert.equal(tints, 1, 'the unread tint must mark the unread row and only it');
});

test('timeAgo is bounded and never renders NaN at a reader', () => {
  const now = Date.now();
  assert.equal(timeAgo(new Date(now - 5_000).toISOString()), '5s');
  assert.equal(timeAgo(new Date(now - 5 * 60_000).toISOString()), '5m');
  assert.equal(timeAgo(new Date(now - 5 * 3_600_000).toISOString()), '5h');
  assert.equal(timeAgo(new Date(now - 5 * 86_400_000).toISOString()), '5d');
  assert.equal(timeAgo(null), '', 'a missing stamp renders nothing, never "NaN ago"');
  assert.equal(timeAgo('not a date'), '');
});

test('the page adds no new /api method — every route it needs already exists', () => {
  // D144 is a page, not a store. If this ever fails, the change grew a backend
  // half and check-api-drift is the gate that then matters.
  const calls = [...PAGE.matchAll(/api\.([A-Za-z0-9_]+)\(/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(calls)].sort(),
    ['listNotifications', 'markNotificationsRead'],
    'the page may only use the two methods the bell already used',
  );
});
