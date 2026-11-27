// D8258 (#8258) — Raise › Overview's connected evidence: Fresh, Stale and Not recorded by each source's own
// window (RA-06), a lost connection with Reconnect (RA-09 Source disconnected), and a failed read still
// Unavailable with Try again.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/raise_source_freshness_8258.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { RaiseConnectedEvidence } from '../src/pages/cycles/RaiseOverviewLead.jsx';
import { sourcesView, windowWords } from '../src/pages/cycles/raiseOverviewModel.js';

const read = (f) => readFileSync(resolve(process.cwd(), f), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/raise?project_id=7'] }, el));
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const row = (key, label, state, extra = {}) => ({ key, label, state, fact: null, as_of: null, fresh_within_hours: 168, freshness: null, ...extra });

const four = () => ({
  connectors: [
    row('mercury', 'Mercury', 'connected', { fact: '18 months of runway · cash and net burn', as_of: '2026-11-22 09:00:00', fresh_within_hours: 48, freshness: 'fresh' }),
    row('github', 'GitHub', 'connected', { fact: 'Contributors to 2 repositories', as_of: '2026-11-13 10:00:00', freshness: 'stale' }),
    row('google', 'Google Workspace', 'disconnected'),
    row('notion', 'Notion', 'unreadable'),
  ],
});

test('each row keeps its state; freshness only for a connected source', () => {
  const v = sourcesView(four());
  assert.equal(v.state, 'ready');
  assert.deepEqual(v.rows.map((r) => [r.key, r.state, r.freshness]), [
    ['mercury', 'connected', 'fresh'], ['github', 'connected', 'stale'], ['google', 'disconnected', null], ['notion', 'unreadable', null],
  ]);
  assert.deepEqual(v.disconnected, ['Google Workspace']);
  assert.equal(v.rows[0].window, '2 days');
  assert.equal(v.rows[1].window, '1 week');
  assert.equal(v.rows[2].window, null, 'no window for a source that is not read');
});

test('an unknown state is Unavailable, never Connected; an unknown freshness is not drawn; no last read is Not recorded', () => {
  const v = sourcesView({ connectors: [row('a', 'A', 'weird'), row('b', 'B', 'connected', { as_of: '2026-11-20', freshness: 'great' }), row('c', 'C', 'connected')] });
  assert.deepEqual(v.rows.map((r) => [r.state, r.freshness]), [['unreadable', null], ['connected', null], ['connected', 'not_recorded']]);
  assert.equal(sourcesView({ connectors: [row('g', 'G', 'disconnected')] }).state, 'ready', 'a lost connection is something to show, not "nothing connected"');
  assert.equal(sourcesView({ connectors: [row('g', 'G', 'not_connected')] }).state, 'none');
});

test('windows in plain words', () => {
  assert.equal(windowWords(48), '2 days');
  assert.equal(windowWords(24), '1 day');
  assert.equal(windowWords(168), '1 week');
  assert.equal(windowWords(336), '2 weeks');
  assert.equal(windowWords(6), '6 hours');
  assert.equal(windowWords(1), '1 hour');
  for (const bad of [0, -1, NaN, null, undefined, '48']) assert.equal(windowWords(bad), null, String(bad));
});

test('RA-06: Fresh beside its last read, Stale as the shared chip, Not recorded never a date', () => {
  const out = html(h(RaiseConnectedEvidence, { view: sourcesView(four()), onRetry: () => {} }));
  assert.match(out, /data-testid="raise-source-mercury" data-state="connected"[\s\S]*?data-freshness="fresh"[^>]*>Fresh<[\s\S]*?Read 2026-11-22 09:00:00/);
  assert.match(out, /data-testid="raise-source-github" data-state="connected"[\s\S]*?data-platform-state="stale"[^>]*data-freshness="stale"/);
  assert.match(text(out), /Older than 1 week\./, 'the window is said to a screen reader');
  assert.doesNotMatch(out.slice(out.indexOf('raise-source-github'), out.indexOf('raise-source-google')), />Fresh</, 'Stale is never Fresh');
  const nr = html(h(RaiseConnectedEvidence, { view: sourcesView({ connectors: [row('c', 'C', 'connected')] }) }));
  assert.match(nr, /data-freshness="not_recorded"[\s\S]*?Last read · Not recorded/);
});

test('RA-09: a disconnected source says so with Reconnect; a failed read is Unavailable with Try again', () => {
  const out = html(h(RaiseConnectedEvidence, { view: sourcesView(four()), onRetry: () => {} }));
  const google = out.slice(out.indexOf('raise-source-google'), out.indexOf('raise-source-notion'));
  assert.match(google, /data-state="disconnected"/);
  assert.match(text(google), /Google Workspace was disconnected\. Its figures are not read until it is reconnected\./);
  assert.match(google, /data-testid="raise-source-disconnected"[^>]*>Disconnected</);
  assert.match(google, /aria-label="Reconnect Google Workspace" href="\/account\/connectors"[^>]*>Reconnect</);
  assert.doesNotMatch(google, /Try again|data-platform-state="unavailable"/, 'a lost connection is not a failed read');
  const notion = out.slice(out.indexOf('raise-source-notion'));
  assert.match(notion, /data-platform-state="unavailable"/);
  assert.match(notion, /aria-label="Try reading Notion again"[^>]*>Try again</);
  assert.doesNotMatch(notion, /Reconnect/, 'a failed read is not a lost connection');
  const ro = html(h(RaiseConnectedEvidence, { view: sourcesView(four()), readOnly: true }));
  assert.match(ro, /data-testid="raise-source-disconnected"/, 'a reader still sees the connection is lost');
  assert.doesNotMatch(ro, />Reconnect</, 'a reader is not offered Reconnect');
});

test('this file is the one D8258 names', () => {
  assert.match(read('documentation/architecture/decisions/D8258.md'), /raise_source_freshness_8258\.test\.mjs/);
});
