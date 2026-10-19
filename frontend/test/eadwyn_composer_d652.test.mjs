/**
 * D652 (#1464) — the Eadwyn composer in the Worker AI rail.
 *
 *   · the "+" menu: "Add a file" and "Connectors ›"; the list links Browse
 *     to the hub's Discover tab and Manage to the hub, and (D753, #1992) a
 *     blocked row's reason to that connector's page;
 *   · a connector that needs attention is greyed, says why, and its switch is
 *     disabled; a switch is on only when the conversation turned it on;
 *   · an answer that used a connector names it and its freshness;
 *   · a proposed write is a card with Send and Cancel, showing the record
 *     and every field the Worker resolved, with the model's line labelled
 *     as Eadwyn's words; once decided the buttons are gone;
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
  // D753 (#1992): Browse opens the hub's Discover tab, Manage the hub, and the blocked row's reason its own page.
  assert.deepEqual(html.match(/href="\/account\/connectors[^"]*"/g), [
    'href="/account/connectors?tab=discover"', 'href="/account/connectors"', 'href="/account/connectors/hubspot"',
  ]);
  assert.match(html, /<a [^>]*href="\/account\/connectors\/hubspot"[^>]*>Sign-in expired<\/a>/, 'the reason links the connector\'s page');

  assert.match(switchOf(html, 'stripe'), /aria-checked="true"/);
  assert.match(switchOf(html, 'calendly'), /aria-checked="false"/, 'a switch the conversation did not turn on is on');
  const hub = switchOf(html, 'hubspot');
  assert.match(hub, /aria-checked="false"/, 'a connector needing attention reads as on');
  assert.match(hub, /disabled=""/, 'a connector needing attention can be switched');
  assert.match(html, /data-testid="eadwyn-connector-hubspot" class="ead-conn is-blocked"|class="ead-conn is-blocked" data-testid="eadwyn-connector-hubspot"/);
  assert.match(html, />Sign-in expired</);
  assert.doesNotMatch(switchOf(html, 'stripe'), /disabled/);
});

test('/account/connectors is the Connectors section D651 built', () => {
  // D700 — the deep-link map moved, unchanged, to account/accountPhone.js.
  const paths = codeOnly(read('frontend/src/pages/account/accountPhone.js'));
  assert.match(paths, /\n\s*connectors: 'connectors',/);
});

test('the connector list says when it could not be read, and when there is nothing yet', () => {
  assert.match(renderToStaticMarkup(h(ConnectorList, { connectors: [], enabled: [], onToggle: noop, error: 'Your connectors could not be read.' })), /could not be read/);
  assert.match(renderToStaticMarkup(h(ConnectorList, { connectors: [], enabled: [], onToggle: noop })), /No connectors yet/);
});

const ACTION = {
  uid: 'a'.repeat(32), connector: 'hubspot', connector_name: 'HubSpot', target: 'New HubSpot company "Mine"',
  summary: 'Totally different name, safe to send', payload: { project_id: 5 }, status: 'pending', result_summary: null,
  content: {
    target: 'New HubSpot company "Mine"',
    fields: [{ name: 'name', value: 'Mine' }, { name: 'industry', value: 'Climate' }, { name: 'description', value: null }],
  },
};

test('a pending action is a card with Send and Cancel and every field Send sends', () => {
  const html = renderToStaticMarkup(h(ActionCard, { action: ACTION, onSend: noop, onCancel: noop }));
  assert.match(html, />Ready to send to HubSpot</);
  assert.match(html, /data-testid="text-eadwyn-action-target">New HubSpot company &quot;Mine&quot;</);
  assert.match(html, /<dt>name<\/dt><dd>Mine<\/dd>.*<dt>industry<\/dt><dd>Climate<\/dd>.*<dt>description<\/dt><dd>\(empty\)<\/dd>/s,
    'the card does not list each field Send would send');
  // The model's line is never presented as what is sent.
  assert.match(html, /data-testid="text-eadwyn-action-summary">Eadwyn’s words: Totally different name, safe to send</);
  assert.ok(html.indexOf('Eadwyn’s words') > html.indexOf('<dt>name</dt>'), 'the model\'s words come before what is sent');
  assert.match(html, /data-testid="button-eadwyn-send"/);
  assert.doesNotMatch(html, /data-testid="button-eadwyn-send"[^>]*disabled/);
  assert.match(html, /data-testid="button-eadwyn-cancel"/);
});

test('a card stored before content existed says so, and its Send is off', () => {
  const html = renderToStaticMarkup(h(ActionCard, { action: { ...ACTION, content: null }, onSend: noop, onCancel: noop }));
  assert.match(html, /data-testid="text-eadwyn-action-legacy"/);
  assert.match(html, /<button[^>]*disabled=""[^>]*data-testid="button-eadwyn-send"/);
});

test('a decided action has no buttons and says what happened', () => {
  for (const [status, words] of [['sent', /Sent to HubSpot\./], ['cancelled', /Cancelled\. Nothing was sent\./], ['failed', /Not sent/], ['failed', /not known whether this arrived/], ['expired', /expired before it was sent/]]) {
    const result_summary = String(words).includes('not known') ? 'The send stopped part-way, so it is not known whether this arrived.' : null;
    const html = renderToStaticMarkup(h(ActionCard, { action: { ...ACTION, status, result_summary }, onSend: noop, onCancel: noop }));
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

// The owner, 2026-10-10: the Worker AI rail is the AIRail canvas, which has
// no chat. The composer stays built and tested above, unmounted, until a
// canvas gives it a place of its own.
test('the Worker AI rail carries no chat: the composer is not mounted, and the AIRail canvas draws none', () => {
  const rail = codeOnly(read('frontend/src/ui/WorkerRail.jsx'));
  assert.doesNotMatch(rail, /EadwynComposer/, 'the rail imports or mounts the composer again');
  assert.doesNotMatch(rail, /Ask Eadwyn/);
  const canvas = read('design/canvases/integrated/AIRail.dc.html');
  assert.doesNotMatch(canvas, /Ask Eadwyn|EadwynComposer/, 'the AIRail canvas now draws a chat; revisit this guard');
  const research = codeOnly(read('frontend/src/workspaces/ResearchWorkspace.jsx'));
  assert.doesNotMatch(research, /composer answers/, 'a rail note promises a composer the rail does not have');
});
