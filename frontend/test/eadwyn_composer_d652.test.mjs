/**
 * D652 (#1464) — the Eadwyn composer in the Worker AI rail.
 *
 *   · the "+" menu: "Add a file" and "Connectors ›"; the list links to
 *     /account/connectors twice, as Browse and Manage;
 *   · a connector that needs attention is greyed, says why, and its switch is
 *     disabled; a switch is on only when the conversation turned it on;
 *   · an answer that used a connector names it and its freshness;
 *   · a proposed write is a card with Send and Cancel, showing the exact
 *     payload; once decided the buttons are gone;
 *   · confirm sends no body, so the Worker sends what it stored.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/eadwyn_composer_d652.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import EadwynComposer, { ConnectorList, ActionCard, EadwynThread, freshness, sourceLine } from '../src/ui/EadwynComposer.jsx';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const h = React.createElement;
const NOW = Date.parse('2026-10-09T12:00:00Z');
const noop = () => {};

const CONNECTORS = [
  { key: 'stripe', name: 'Stripe', reason: '' },
  { key: 'hubspot', name: 'HubSpot', reason: 'Sign-in expired' },
  { key: 'calendly', name: 'Calendly', reason: '' },
];

const switchOf = (html, key) => {
  const at = html.indexOf(`data-testid="switch-eadwyn-${key}"`);
  assert.ok(at > 0, `no switch for ${key}`);
  const open = html.lastIndexOf('<button', at);
  return html.slice(open, html.indexOf('>', at) + 1);
};

test('freshness reads like the canvas: "12 min ago", and says nothing it cannot read', () => {
  assert.equal(freshness('2026-10-09T11:48:00Z', NOW), '12 min ago');
  // In a zone that is not UTC, so a D1 timestamp read as local time is wrong.
  const tz = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    assert.equal(freshness('2026-10-09 11:48:00', NOW), '12 min ago', 'a D1 timestamp was not read as UTC');
  } finally {
    if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
  }
  assert.equal(freshness('2026-10-09T11:59:40Z', NOW), 'just now');
  assert.equal(freshness('2026-10-09T09:00:00Z', NOW), '3 h ago');
  assert.equal(freshness('2026-10-08T12:00:00Z', NOW), '1 day ago');
  assert.equal(freshness('2026-10-06T12:00:00Z', NOW), '3 days ago');
  assert.equal(freshness(null, NOW), '');
  assert.equal(freshness('not a date', NOW), '');
  assert.equal(sourceLine({ key: 'stripe', name: 'Stripe', as_of: '2026-10-09T11:48:00Z' }, NOW), 'From Stripe · 12 min ago');
  assert.equal(sourceLine({ key: 'stripe', name: 'Stripe', as_of: null }, NOW), 'From Stripe · time not recorded');
});

test('the connector list: switches follow the conversation, a connector needing attention is greyed with its reason', () => {
  const html = renderToStaticMarkup(h(ConnectorList, { connectors: CONNECTORS, enabled: ['stripe', 'hubspot'], onToggle: noop }));
  assert.match(html, />Browse connectors</);
  assert.match(html, />Manage connectors</);
  assert.equal((html.match(/href="\/account\/connectors[^"]*"/g) || []).length, 2, 'Browse and Manage do not both open /account/connectors');

  assert.match(switchOf(html, 'stripe'), /aria-checked="true"/);
  assert.match(switchOf(html, 'calendly'), /aria-checked="false"/, 'a switch the conversation did not turn on is on');
  const hub = switchOf(html, 'hubspot');
  assert.match(hub, /aria-checked="false"/, 'a connector needing attention reads as on');
  assert.match(hub, /disabled=""/, 'a connector needing attention can be switched');
  assert.match(html, /data-testid="eadwyn-connector-hubspot" class="ead-conn is-blocked"|class="ead-conn is-blocked" data-testid="eadwyn-connector-hubspot"/);
  assert.match(html, />Sign-in expired</);
  assert.doesNotMatch(switchOf(html, 'stripe'), /disabled/);
});

test('/account/connectors opens a page today: the Integrations tab, until #1463 builds Connectors', () => {
  const settings = codeOnly(read('frontend/src/pages/SettingsPage.jsx'));
  assert.match(settings, /\n\s*connectors: 'integrations',/);
});

test('the connector list says when it could not be read, and when there is nothing yet', () => {
  assert.match(renderToStaticMarkup(h(ConnectorList, { connectors: [], enabled: [], onToggle: noop, error: 'Your connectors could not be read.' })), /could not be read/);
  assert.match(renderToStaticMarkup(h(ConnectorList, { connectors: [], enabled: [], onToggle: noop })), /No connectors yet/);
});

const ACTION = {
  uid: 'a'.repeat(32), connector: 'hubspot', connector_name: 'HubSpot', target: 'Company #5',
  summary: 'Company · Mine', payload: { project_id: 5 }, status: 'pending', result_summary: null,
};

test('a pending action is a card with Send and Cancel and the exact payload', () => {
  const html = renderToStaticMarkup(h(ActionCard, { action: ACTION, onSend: noop, onCancel: noop }));
  assert.match(html, />Ready to send to HubSpot</);
  assert.match(html, />Company #5 · Company · Mine</);
  assert.match(html, /data-testid="text-eadwyn-action-payload">\{&quot;project_id&quot;:5\}</, 'the card does not show the payload Send would send');
  assert.match(html, /data-testid="button-eadwyn-send"/);
  assert.match(html, /data-testid="button-eadwyn-cancel"/);
});

test('a decided action has no buttons and says what happened', () => {
  for (const [status, words] of [['sent', /Sent to HubSpot\./], ['cancelled', /Cancelled\. Nothing was sent\./], ['failed', /Not sent/], ['expired', /expired before it was sent/]]) {
    const html = renderToStaticMarkup(h(ActionCard, { action: { ...ACTION, status }, onSend: noop, onCancel: noop }));
    assert.doesNotMatch(html, /button-eadwyn-send|button-eadwyn-cancel/, `a ${status} action can still be sent or cancelled`);
    assert.match(html, words);
  }
});

test('an answer that used a connector names it and its freshness; its action card sits under it', () => {
  const html = renderToStaticMarkup(h(EadwynThread, {
    now: NOW,
    messages: [
      { id: 1, role: 'user', content: 'What is MRR?' },
      { id: 2, role: 'assistant', content: 'MRR is 38,400.', sources: [{ key: 'stripe', name: 'Stripe', as_of: '2026-10-09T11:48:00Z' }], action_uid: ACTION.uid },
      { id: 3, role: 'assistant', content: 'No connector here.', sources: [] },
    ],
    actions: [ACTION],
    onSend: noop,
    onCancel: noop,
  }));
  assert.equal((html.match(/data-testid="text-eadwyn-source"/g) || []).length, 1, 'a source line was drawn under an answer that read nothing');
  assert.match(html, />From Stripe · 12 min ago</);
  assert.ok(html.indexOf('MRR is 38,400.') < html.indexOf('Ready to send to HubSpot'), 'the card is not under its answer');
});

test('the composer renders the question box and the "+"; the menu offers "Add a file" and "Connectors ›"', () => {
  const html = renderToStaticMarkup(h(EadwynComposer, { workspace: 'Build' }));
  assert.match(html, /placeholder="Ask Eadwyn…"/);
  assert.match(html, /data-testid="button-eadwyn-plus"/);
  assert.match(html, /aria-expanded="false"/);
  const src = codeOnly(read('frontend/src/ui/EadwynComposer.jsx'));
  assert.match(src, /data-testid="button-eadwyn-add-file">Add a file</);
  assert.match(src, /data-testid="button-eadwyn-connectors">Connectors <span aria-hidden="true">›<\/span>/);
});

test('Send posts no body: what goes out is what the Worker stored and showed', () => {
  const api = codeOnly(read('frontend/src/lib/api/eadwyn.js'));
  assert.match(api, /confirmAction: \(uid\) => request\(`\/eadwyn\/actions\/\$\{enc\(uid\)\}\/confirm`, \{ method: 'POST' \}\)/);
  const src = codeOnly(read('frontend/src/ui/EadwynComposer.jsx'));
  assert.match(src, /eadwynApi\.confirmAction\(actionUid\)/);
  assert.doesNotMatch(src, /confirmAction\([^)]*,/, 'the composer passes something to confirm');
});

test('the switches are the conversation\'s: read from it, written to it as a whole set, and a new conversation starts with none', () => {
  const src = codeOnly(read('frontend/src/ui/EadwynComposer.jsx'));
  assert.match(src, /connectors: r\.conversation\?\.connectors \|\| \[\]/);
  assert.match(src, /eadwynApi\.setConnectors\(id, keys\)/);
  assert.match(src, /const startOver = useCallback\(\(\) => \{\s*remember\(null\);\s*setConv\(\{ messages: \[\], actions: \[\], connectors: \[\] \}\);/);
  assert.doesNotMatch(src, /safeWriteJSON\([^)]*connectors/, 'switches are kept in the browser, not on the conversation');
});

test('the rail mounts the composer on the rail\'s model and page, and re-reads spend after a run', () => {
  const rail = codeOnly(read('frontend/src/ui/WorkerRail.jsx'));
  assert.match(rail, /import EadwynComposer from '\.\/EadwynComposer';/);
  assert.match(rail, /<EadwynComposer\s+workspace=\{workspace\}\s+model=\{activeModel \|\| undefined\}\s+page=\{pagePath \|\| undefined\}\s+onRan=\{\(\) => \{ reload\(\); budgetReading\.reload\(\); \}\}\s*\/>/);
});
