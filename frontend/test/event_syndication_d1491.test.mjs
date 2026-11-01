// D1491 (#3725) — Event syndication's screens before the Worker core (D1490).
// The model's words and rules, and that nothing on the page claims a post.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CAPABILITY_LABEL, CHANNELS, LOG_ACTION, ROW_STATUS, SETTINGS_TYPES, SKIP_REASONS, SYNDICATION_SERVICE_READY, TABS,
  approveLabel, channelStatus, charCount, registrationsText, syncLine, syndicateNote, tabFor,
} from '../src/pages/hq/eventSyndication/syndicationModel.js';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

test('SY1: the five channels in the canvas order, with what each can do', () => {
  assert.deepEqual(CHANNELS.map((c) => c.key), ['luma', 'eventbrite', 'google_business', 'linkedin', 'facebook']);
  assert.deepEqual(CHANNELS.filter((c) => c.capability === 'creates_events').map((c) => c.key), ['luma', 'eventbrite', 'google_business']);
  assert.deepEqual(CHANNELS.filter((c) => c.pendingOwner).map((c) => c.key), ['linkedin', 'facebook'], 'the link-post fallback is owner question D');
  assert.equal(CAPABILITY_LABEL.posts_link, 'Posts a link');
  for (const c of CHANNELS) assert.ok(c.needs.length > 20, c.key);
});

test('until the Worker core ships, every channel is "Not available yet" and the page says nothing posts', () => {
  assert.equal(SYNDICATION_SERVICE_READY, false);
  assert.deepEqual(channelStatus(null), { key: 'not_available', label: 'Not available yet', tone: 'muted', line: 'The syndication service is being built.' });
  const page = read('pages/hq/eventSyndication/EventSyndicationPage.jsx');
  assert.match(page, /Nothing is posted to other channels yet\./);
  assert.match(page, /const status = channelStatus\(null\);/);
  assert.doesNotMatch(page, /from '\.\.\/\.\.\/\.\.\/lib\/api/, 'no read before D1490 has routes');
  assert.match(page, /<button type="button" disabled title=\{NOT_YET\}[^>]*>Connect<\/button>/);
});

test('SY1 status chips from an account (for D1490 wiring)', () => {
  const now = Date.parse('2026-11-01T00:00:00Z');
  assert.equal(channelStatus({ status: 'active' }, { now }).label, 'Connected');
  assert.equal(channelStatus({ status: 'active', expires_at: '2026-11-13T00:00:00Z' }, { now }).label, 'Expires in 12 days');
  assert.equal(channelStatus({ status: 'active', expires_at: '2026-11-02T00:00:00Z' }, { now }).label, 'Expires in 1 day');
  assert.equal(channelStatus({ status: 'active', expires_at: '2026-10-30T00:00:00Z' }, { now }).label, 'Expired');
  assert.equal(channelStatus({ status: 'expired' }, { now }).label, 'Expired');
  assert.deepEqual(channelStatus({ status: 'error', last_error: 'Token revoked' }, { now }).line, 'Token revoked');
});

test('once D1490 serves reads: no account is "Not connected" only where the adapter exists', () => {
  assert.equal(channelStatus(null, { serviceReady: true, adapterReady: true }).label, 'Not connected');
  assert.deepEqual(channelStatus(null, { serviceReady: true }), { key: 'not_available', label: 'Not available yet', tone: 'muted', line: 'Waiting for the platform’s approval.' });
  assert.equal(channelStatus({ status: 'disconnected' }, { serviceReady: true, adapterReady: true }).key, 'not_connected');
  assert.equal(syndicateNote('public', { serviceReady: true }), 'Posts when an admin approves this event.');
  assert.equal(syndicateNote('unlisted', { serviceReady: true }), 'Unlisted and private events are never posted to other channels.');
});

test('SY3 and SY5 words; a count the service did not import is "Not recorded", never 0', () => {
  assert.equal(ROW_STATUS.selected.label, 'Will post on approval');
  assert.equal(ROW_STATUS.failed.tone, 'red');
  assert.equal(syncLine({ sync_state: 'unsupported' }, 'linkedin'), 'LinkedIn can’t edit posts. Edit it on LinkedIn ↗');
  assert.equal(syncLine({ sync_state: 'in_sync' }, 'luma'), 'Update sent');
  assert.equal(syncLine({}, 'luma'), null);
  assert.equal(registrationsText(null), 'Not recorded');
  assert.equal(registrationsText(undefined), 'Not recorded');
  assert.equal(registrationsText(0), '0');
  assert.equal(registrationsText(9), '9');
  assert.equal(LOG_ACTION.withdraw, 'Withdrawn');
  assert.deepEqual(SKIP_REASONS, ['Private event', 'Not approved for the public calendar', 'Event has started', 'Account expired', 'Host not allowed by HQ settings']);
});

test('SY2b approve sentence and SY2a counters', () => {
  assert.equal(approveLabel(0), 'Approve and publish');
  assert.equal(approveLabel(1), 'Approve, publish and post to 1 channel');
  assert.equal(approveLabel(3), 'Approve, publish and post to 3 channels');
  assert.deepEqual(charCount('x'.repeat(64), 100), { text: '64 / 100', over: false });
  assert.equal(charCount('x'.repeat(101), 100).over, true);
});

test('SY2a/SY2u: only a public event can syndicate, and today nothing does', () => {
  assert.equal(syndicateNote('unlisted'), 'Unlisted and private events are never posted to other channels.');
  assert.equal(syndicateNote('private'), 'Unlisted and private events are never posted to other channels.');
  assert.match(syndicateNote('public'), /^Other channels: none yet\./);
  const editor = read('pages/events/EventEditorPage.jsx');
  assert.match(editor, /\{syndicateNote\(form\.visibility\)\}/);
});

test('SY6: the twelve event types, and the tabs at their addresses', () => {
  assert.equal(SETTINGS_TYPES.length, 12);
  assert.deepEqual(TABS.map((t) => t.to), ['/admin/platform/event-syndication', '/admin/platform/event-syndication/log', '/admin/platform/event-syndication/settings']);
  assert.equal(tabFor('/admin/platform/event-syndication'), 'channels');
  assert.equal(tabFor('/admin/platform/event-syndication/log'), 'log');
  assert.equal(tabFor('/admin/platform/event-syndication/settings/'), 'settings');
});

test('the routes are Super Admin only and the hub links them', () => {
  const app = read('App.jsx');
  for (const p of ['', '/log', '/settings']) {
    assert.ok(app.includes(`<Route path="/admin/platform/event-syndication${p}" element={guard(['admin'], hqOnly(<HqEventSyndicationPage />))} />`), p);
  }
  assert.match(read('pages/hq/PlatformPage.jsx'), /<Link to="\/admin\/platform\/event-syndication"/);
  for (const f of ['Event Syndication Page.dc.html', 'Event Syndication · Boards.dc.html']) {
    assert.ok(readFileSync(new URL(`../../design/incoming/${f}`, import.meta.url), 'utf8').length > 1000, f);
  }
});
