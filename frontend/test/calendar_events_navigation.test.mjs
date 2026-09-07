import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), 'frontend/src');
const sidebar = readFileSync(resolve(root, 'sidebarConfig.js'), 'utf8');
const app = readFileSync(resolve(root, 'App.jsx'), 'utf8');

test('Calendar and Events are not present as standalone sidebar items', () => {
  assert.doesNotMatch(sidebar, /to:\s*['"]\/calendar['"][^}]*label:\s*['"]Calendar['"]/);
  assert.doesNotMatch(sidebar, /to:\s*['"]\/my\/events['"][^}]*label:\s*['"]Events['"]/);
  assert.doesNotMatch(sidebar, /to:\s*['"]\/articles\/draft['"][^}]*label:\s*['"]Articles['"]/);
});

test('Calendar, Events, and Articles appear in the user dropdown before the Help Center', () => {
  // `to="/tickets"` until the Support Hub became the Help Center. The old path
  // still exists in App.jsx as a redirect route (`path="/tickets"`), which is
  // why this reads `to="/help"`: a `to=` is a menu link, a `path=` is a route,
  // and only the first belongs in a menu-order assertion.
  const trustIndex = app.indexOf('to="/trust"');
  const calendarIndex = app.indexOf('to="/calendar"');
  const eventsIndex = app.indexOf('to="/my/events"');
  const articlesIndex = app.indexOf('to="/articles/draft"');
  const helpIndex = app.indexOf('to="/help"');

  assert.ok(trustIndex >= 0, 'Trust Center menu item should exist');
  assert.ok(calendarIndex > trustIndex, 'Calendar should follow Trust Center');
  assert.ok(eventsIndex > calendarIndex, 'Events should follow Calendar');
  assert.ok(articlesIndex > eventsIndex, 'Articles should follow Events');
  assert.ok(helpIndex > articlesIndex, 'the Help Center should follow Articles');
});

test('the Help Center is reachable before KYC, and the old path still resolves', () => {
  // Two ways this rename could strand someone, both of them silent.
  //
  // RequireAuth holds an un-KYC'd user on a small allowlist of paths. Support
  // is on it precisely because that is when a person needs to ask for help —
  // renaming the route without renaming the allowlist entry would have made
  // the Help Center unreachable exactly then.
  //
  // Task #103 moved the mechanism, so this moved with it. `/help` is no
  // longer a member of the exact-match array: the Help Center took `/help`
  // and the ticket flow went to `/help/tickets`, and an exact-match list
  // cannot express "and everything under it". It could not express
  // `/help/<id>` either, which is why an un-KYC'd investor clicking "Open
  // ticket" in a notification used to be bounced to /kyc — the very reason
  // this test exists, happening to the address the test did not name. The
  // subtree check below is the same intent over a wider door.
  assert.match(app, /const onHelpPath = location\.pathname === '\/help' \|\| location\.pathname\.startsWith\('\/help\/'\)/,
    'the pre-KYC exemption must cover the whole /help subtree, or support is walled off');
  assert.match(app, /!onHelpPath &&/,
    'the exemption must be consulted by the gate, not merely computed');
  assert.doesNotMatch(app, /ALLOWED_BEFORE_KYC = \[[^\]]*'\/tickets'/,
    'a stale allowlist entry guards a path nothing renders');

  // And the worker emits /tickets links into notification rows that are
  // already in people's feeds, so both old paths must still land — now on
  // the ticket flow's new address rather than on the Help Center home.
  assert.match(app, /path="\/tickets"\s+element=\{<Navigate to="\/help\/tickets" replace \/>\}/);
  assert.match(app, /path="\/tickets\/:id"/,
    'tickets.ts emits /tickets/<id> for its "Open ticket" CTA');
});