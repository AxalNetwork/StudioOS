/**
 * D5202 (#5202): Connected is about the credential; whether its events loaded is a dimension of its own.
 *
 * The rail showed a green "Connected" for a provider whose events came back `rate_limited` or `unreadable`, so
 * the member read "Connected" over a gap in their agenda. Only `reconnect` ever reached the row.
 *
 *   · read health is read from the server's `sources`, and a provider with no row was not asked;
 *   · a connected provider whose read failed renders Connected AND its read state, with a scoped retry;
 *   · `reconnect` stays the connection's state, so it is not counted twice;
 *   · the retry re-reads that provider alone, and leaves the other sources and their events alone;
 *   · the evidence a support reader sees is fixed words and numbers, never a title, an address or a body.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { READ_HEALTH, connectionRow, externalReadError, readEvidence, readHealth, readHealthOf } from '../src/pages/calendarConnectedModel.js';

const src = (over = {}) => ({ kind: 'external_google', ok: true, error: null, latency_ms: 42, items: 3, at: '2026-11-09T12:00:00.000Z', ...over });

test('read health comes from the server\'s sources, and a provider that was not asked is not a failure', () => {
  assert.equal(readHealth([src()], 'google'), 'healthy');
  assert.equal(readHealth([src({ truncated: true })], 'google'), 'truncated');
  assert.equal(readHealth([src({ ok: false, error: 'rate_limited' })], 'google'), 'rate_limited');
  assert.equal(readHealth([src({ ok: false, error: 'unreadable' })], 'google'), 'unavailable');
  assert.equal(readHealth([src({ ok: false, error: null })], 'google'), 'unavailable', 'a failure with no code is still a failure');
  // A withdrawn credential is the connection's state; counting it here would say the same thing twice.
  assert.equal(readHealth([src({ ok: false, error: 'reconnect' })], 'google'), 'not_read');
  // No row: the member has no such connection, so nothing was read and nothing failed.
  assert.equal(readHealth([], 'google'), 'not_read');
  assert.equal(readHealth(null, 'google'), 'not_read');
  assert.equal(readHealth([src()], 'microsoft'), 'not_read', 'Google\'s row answered for Outlook');
  assert.equal(readHealth([src({ ok: false, error: 'unreadable' })], 'google', { loading: true }), 'reading');
  // Outlook reads its own row.
  assert.equal(readHealth([src({ kind: 'external_microsoft', ok: false, error: 'rate_limited' })], 'microsoft'), 'rate_limited');
  for (const h of READ_HEALTH) assert.equal(readHealthOf(h.key).key, h.key);
  assert.equal(readHealthOf('nonsense').key, 'reading', 'an unknown health is not read as healthy');
});

test('a connected provider whose events did not load says both, and offers a retry of that read alone', () => {
  const row = connectionRow('google', 'connected', { connected: true }, 'unavailable');
  assert.equal(row.state, 'connected', 'the connection was downgraded by a read');
  assert.match(row.pill, /Connected/);
  assert.equal(row.healthPill, 'Events temporarily unavailable');
  assert.equal(row.healthTone, 'a');
  assert.match(row.sub, /could not be read just now/);
  assert.match(row.sub, /not a sign that the connection is broken/);
  assert.deepEqual(row.actions.map((a) => a.key), ['retry-read', 'sync', 'manage'], 'no scoped retry, or it is not first');
  assert.equal(row.actions[0].label, 'Try reading its events again');

  const limited = connectionRow('microsoft', 'connected', { connected: true }, 'rate_limited');
  assert.equal(limited.healthPill, 'Rate limited');
  assert.match(limited.sub, /slow down/);
  assert.deepEqual(limited.actions.map((a) => a.key), ['retry-read', 'sync', 'disconnect']);

  const part = connectionRow('google', 'connected', { connected: true }, 'truncated');
  assert.equal(part.healthPill, 'Partially loaded');
  assert.match(part.sub, /Narrow the date range/);

  // Healthy and not-read add nothing: the row reads as it always did.
  for (const health of ['healthy', 'not_read', null]) {
    const clean = connectionRow('google', 'connected', { connected: true }, health);
    assert.equal(clean.healthPill, null, `${health} added a pill`);
    assert.deepEqual(clean.actions.map((a) => a.key), ['sync', 'manage'], `${health} added an action`);
    assert.doesNotMatch(clean.sub, /temporarily unavailable|Rate limited|Narrow the date/);
  }
});

test('the connection\'s own states keep their wording, whatever the read did', () => {
  const off = connectionRow('google', 'off', null, 'unavailable');
  assert.match(off.sub, /Not connected/);
  assert.deepEqual(off.actions.map((a) => a.key), ['connect'], 'a disconnected provider offered a read retry');
  const recon = connectionRow('google', 'reconnect', null, 'not_read');
  assert.match(recon.sub, /expired or was withdrawn/);
  assert.equal(recon.healthPill, null);
  const unconf = connectionRow('microsoft', 'unconfigured', null, 'unavailable');
  assert.deepEqual(unconf.actions, []);
});

test('externalReadError still reports the page\'s own codes, unchanged', () => {
  assert.equal(externalReadError([src({ ok: false, error: 'reconnect' })], 'google'), 'reconnect');
  assert.equal(externalReadError([src({ ok: false, error: 'rate_limited' })], 'google'), 'rate_limited');
  assert.equal(externalReadError([src()], 'google'), null);
  assert.equal(externalReadError([], 'google'), null);
});

test('the evidence a support reader sees is fixed words and numbers only', () => {
  const got = readEvidence([src({ ok: false, error: 'unreadable', reason: 'http_5xx', items: 0, latency_ms: 9123 })], 'google');
  assert.deepEqual(got, {
    kind: 'external_google', outcome: 'unreadable', reason: 'http_5xx', latency_ms: 9123, items: 0,
    truncated: false, at: '2026-11-09T12:00:00.000Z',
  });
  assert.deepEqual(readEvidence([src()], 'google'), {
    kind: 'external_google', outcome: 'ok', reason: null, latency_ms: 42, items: 3, truncated: false, at: '2026-11-09T12:00:00.000Z',
  });
  assert.equal(readEvidence([], 'google'), null);
  // Anything the server did not send reads as unknown, never as a number or a sentence of our own.
  const sparse = readEvidence([{ kind: 'external_google', ok: false }], 'google');
  assert.deepEqual([sparse.outcome, sparse.reason, sparse.latency_ms, sparse.items, sparse.at], ['unreadable', null, null, null, null]);
  // Only the named fields travel: a row that carried private text cannot leak it through this reader.
  const dirty = readEvidence([src({ title: 'Synthetic private dinner', organizer_email: 'someone@example.test' })], 'google');
  assert.deepEqual(Object.keys(dirty).sort(), ['at', 'items', 'kind', 'latency_ms', 'outcome', 'reason', 'truncated']);
});
