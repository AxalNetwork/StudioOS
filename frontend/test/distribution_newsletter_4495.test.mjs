/**
 * D4495 (#4495, DS6, MK6b): the Newsletter tab in its not-connected state, the only one until the
 * Beehiiv connector (#2407) exists.
 *
 *   · the not-connected copy, and Connect Beehiiv disabled with its visible reason;
 *   · Opens, Clicks and Unsubscribes read "Not recorded", with "Recorded after the first send.";
 *   · no request at all, and none to Axal's house newsletter (`/api/newsletter`, D810);
 *   · no lists, editor or subscribers are drawn; the tab is mounted for tab="newsletter".
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/distribution_newsletter_4495.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { readFileSync } from 'node:fs';
import { mountContracts } from './_contracts_dom.mjs';
import NewsletterTab, { NEWSLETTER_COPY, NEWSLETTER_METRICS } from '../src/pages/cycles/distribution/NewsletterTab.jsx';

const h = React.createElement;
const read = (f) => readFileSync(f, 'utf8');
const tx = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(tx).join('') : n.textContent || '');

async function mount() {
  const old = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push([String(url), init?.method || 'GET']); return Response.json({}); };
  const m = await mountContracts(h(NewsletterTab), '/grow/distribution/newsletter?project_id=7');
  await m.flush(); await m.flush();
  const by = (id) => m.nodes().find((n) => m.props(n)?.['data-testid'] === id);
  return { ...m, by, calls, async close() { await m.unmount(); globalThis.fetch = old; } };
}

test('the not-connected card: its copy, and Connect Beehiiv disabled with a visible reason', async () => {
  // Mutations checked: Connect enabled; the reason hidden or not tied to the button.
  const m = await mount();
  try {
    const card = m.by('newsletter-not-connected');
    assert.match(tx(card), /Connect Beehiiv to send your newsletter\./);
    assert.match(tx(card), /Your subscribers stay in your Beehiiv account\./);
    const connect = m.by('newsletter-connect');
    assert.equal(tx(connect), 'Connect Beehiiv');
    assert.equal(m.props(connect).disabled, true, 'not offered until the connector exists');
    const reason = m.by('newsletter-connect-reason');
    assert.equal(tx(reason), 'Not offered yet', 'the reason is visible text, not a tooltip');
    assert.equal(m.props(connect)['aria-describedby'], m.props(reason).id, 'and is the button\'s description');
    assert.match(m.props(connect).className, /min-h-\[44px\]/, '44px target');
  } finally { await m.close(); }
});

test('Results: Opens, Clicks and Unsubscribes each read Not recorded, never 0', async () => {
  // Mutation checked: a metric drawn as 0.
  const m = await mount();
  try {
    assert.deepEqual(NEWSLETTER_METRICS, ['Opens', 'Clicks', 'Unsubscribes']);
    for (const label of NEWSLETTER_METRICS) {
      const cell = m.by(`newsletter-metric-${label.toLowerCase()}`);
      assert.equal(tx(cell), `${label}Not recorded`);
    }
    const results = tx(m.by('newsletter-results'));
    assert.match(results, /Recorded after the first send\./);
    assert.doesNotMatch(results, /\b0\b/, 'no zero anywhere');
  } finally { await m.close(); }
});

test('no request reaches /api/newsletter, or anywhere: the tab reads nothing', async () => {
  // Mutation checked: a subscriber read added to the tab.
  const m = await mount();
  try {
    assert.deepEqual(m.calls, [], 'no request at all');
    assert.ok(!m.calls.some(([u]) => u.includes('/api/newsletter')));
  } finally { await m.close(); }
  // The header comment names /api/newsletter to say it is never used; the code is read without comments.
  const code = read('frontend/src/pages/cycles/distribution/NewsletterTab.jsx').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /lib\/api|fetch\(|request\(|\/api\//, 'no client, fetch or API path');
  assert.doesNotMatch(code, /newsletterApi/i, 'never Axal\'s house newsletter client');
});

test('nothing is invented: no lists, editor, subscribers or sends, and no Fill', async () => {
  const m = await mount();
  try {
    const text = m.text();
    for (const absent of ['Lists', 'Subscribers', 'Send a test', 'Schedule', 'Ask Eadwyn', 'Fill']) assert.ok(!text.includes(absent), absent);
    assert.ok(!m.nodes().some((n) => ['INPUT', 'TEXTAREA', 'TABLE'].includes(n.tagName)), 'no editor or list table');
  } finally { await m.close(); }
});

test('mounted for tab="newsletter", with dark classes on the new component', () => {
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  assert.match(route, /import NewsletterTab from '\.\/distribution\/NewsletterTab\.jsx';/);
  assert.match(route, /distributionTab === 'newsletter' \? <NewsletterTab \/> : <ComingSoon \/>/);
  const src = read('frontend/src/pages/cycles/distribution/NewsletterTab.jsx');
  assert.ok((src.match(/dark:/g) || []).length >= 6, 'dark classes');
  assert.equal(NEWSLETTER_COPY.reason, 'Not offered yet');
});
