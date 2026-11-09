/**
 * D4800 (#4800, second slice) — the Overview's "Recent security events" and
 * the MFA finding that names its administrators. Pure model plus a server
 * render of the section; the Worker half is
 * cloudflare-worker/test/security_overview_mfa_names_4800.test.ts.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/security_overview_recent_4800.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { buildOverview, recentEvents, namedAdmins, RECENT_EVENTS } from '../src/pages/hq/security/overviewModel.js';
import { RecentEvents } from '../src/pages/hq/security/OverviewWorkspace.jsx';

const AT = '2026-11-09T09:00:00.000Z';
const ready = (value) => ({ state: 'ready', value, at: AT });
const row = (i, o = {}) => ({ key: `k${i}`, source: 'security_events', action: 'gate.totp', outcome: 'refused', target: 'detail=factor_required', at: `2026-11-09 08:${String(50 - i).padStart(2, '0')}:00`, actor: `user ${i}`, ...o });
const FEED = { rows: Array.from({ length: 9 }, (_, i) => row(i)), sources: [{ table: 'security_events', available: true }], filter: 'all', applied: {} };
const render = (recent) => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(RecentEvents, { recent, onRetry: () => {} })));

test('recent events: the newest rows in Events\' words, raw action kept, at most RECENT_EVENTS', () => {
  const r = recentEvents(ready(FEED));
  assert.equal(r.state, 'rows');
  assert.equal(r.rows.length, RECENT_EVENTS);
  assert.equal(r.rows[0].label, 'Multi-factor authentication required');
  assert.equal(r.rows[0].raw, 'gate.totp detail=factor_required');
  assert.equal(r.rows[0].word, 'Refused');
  assert.equal(r.rows[0].at, '2026-11-09 08:50 UTC');
  const html = render(r);
  assert.equal((html.match(/data-testid="security-recent-row"/g) || []).length, RECENT_EVENTS);
  assert.match(html, /Open Events/);
});

test('an unreadable ledger is never "no events"; a read empty ledger is a measured zero; loading claims nothing', () => {
  // Mutation checked: an unreadable feed drawn as the empty state.
  const un = recentEvents({ state: 'unreadable', at: AT });
  assert.equal(un.state, 'unavailable');
  const unHtml = render(un);
  assert.match(unHtml, /could not be read/);
  assert.match(unHtml, /Retry/);
  assert.doesNotMatch(unHtml, /No events/);
  const empty = recentEvents(ready({ ...FEED, rows: [] }));
  assert.equal(empty.state, 'empty');
  assert.match(render(empty), /holds no row in its window/);
  assert.equal(recentEvents({ state: 'loading' }).state, 'loading');
  assert.equal(recentEvents(undefined).state, 'loading');
});

test('a narrowed or partial read says so beside the list', () => {
  const narrowed = recentEvents(ready({ ...FEED, filter: 'refusals' }));
  assert.equal(narrowed.filtered, true);
  assert.match(render(narrowed), /newest matching rows, not the newest rows/);
  const searched = recentEvents(ready({ ...FEED, applied: { q: 'ada' } }));
  assert.equal(searched.filtered, true);
  const partial = recentEvents(ready({ ...FEED, sources: [{ table: 'security_events', available: true }, { table: 'activity_logs', available: false }] }));
  assert.equal(partial.partial, true);
  assert.match(render(partial), /rows from it may be missing/);
  assert.equal(recentEvents(ready(FEED)).filtered, false);
});

test('the MFA finding names the administrators the Worker returned, and only them', () => {
  // Mutation checked: the names dropped from the finding.
  const overview = ready({ mfa: { available: true, admins_total: 3, admins_with_mfa: 1, admins_without_mfa: [
    { id: 2, name: 'Ada Admin', email: 'ada@example.test' }, { id: 3, name: '', email: 'bo@example.test' },
  ] } });
  const model = buildOverview({ overview, feed: ready(FEED) });
  const f = model.findings.find((x) => x.id === 'mfa-gap');
  assert.ok(f, 'the finding is open');
  assert.match(f.detail, /1 of 3 HQ administrators/);
  assert.match(f.detail, /Without one: Ada Admin \(ada@example\.test\), bo@example\.test\./);
  assert.equal(f.admins.length, 2);
  assert.equal(model.recent.state, 'rows', 'the overview model carries the recent events');
  // An older Worker returns no names: the count stands alone and nothing is guessed.
  assert.equal(namedAdmins(undefined, 2), '');
  assert.equal(namedAdmins([{ id: 9, name: 'Ann' }], 3), ' Without one: Ann and 2 more.');
});
