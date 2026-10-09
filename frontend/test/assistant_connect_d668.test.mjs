/**
 * D668 (#1498) — connect an AI assistant (D665): the consent page, the AI
 * assistants group on Connectors, and "From an AI assistant" in Record a
 * session, rendered from fixtures (nothing is mounted until #1496 and #1497
 * reach `main`).
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/assistant_connect_d668.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { ConsentView } from '../src/pages/connect/ConnectAssistantPage.jsx';
import { approveBody, canApprove, consentState, safeRedirect, signInPath } from '../src/pages/connect/assistantConsentModel.js';
import AssistantsGroup, { GrantsList } from '../src/pages/account/AssistantsGroup.jsx';
import { ASSISTANTS, MCP_SERVER_URL, grantsAfterRevoke } from '../src/pages/account/assistantSetup.js';
import { AssistantBadge, AssistantEntry } from '../src/pages/founder/AssistantEntry.jsx';
import { openingStep, placementSource, starterPrompt } from '../src/pages/founder/assistantSession.js';

const REQUEST = { client_name: 'ChatGPT', redirect_host: 'chatgpt.com', companies: [{ id: 7, name: 'Northwind' }, { id: 9, name: 'Acme' }] };
const html = (el) => renderToStaticMarkup(React.createElement(MemoryRouter, null, el));
const consent = (props) => { const h = html(React.createElement(ConsentView, props)); return { h, text: renderedText(h) }; };

test('the consent page always shows the redirect host, larger than the self-declared name', () => {
  const { h, text } = consent({ request: REQUEST });
  assert.match(h, /data-testid="consent-redirect-host"[^]*chatgpt\.com/);
  assert.match(text, /It returns to\s*chatgpt\.com/);
  assert.match(text, /Read your Validate context/);
  assert.match(text, /Submit interviews for your review/);
  assert.match(text, /It cannot change a module, delete anything, or see other companies\./);
  // A request with no host says so; a name never stands in for it.
  const nohost = consent({ request: { ...REQUEST, redirect_host: '' } }).text;
  assert.match(nohost, /It returns to\s*Not recorded/);
  // A name that claims to be a host is drawn as the name only.
  const spoof = consent({ request: { ...REQUEST, client_name: 'claude.ai', redirect_host: 'evil.example' } }).text;
  assert.match(spoof, /It returns to\s*evil\.example/);
});

test('Approve sends exactly the ticked companies the request offered', () => {
  assert.deepEqual(approveBody(REQUEST, new Set(['9'])), { companies: [9] });
  assert.deepEqual(approveBody(REQUEST, ['7', '9', '42']), { companies: [7, 9] }, 'a company not offered is dropped');
  assert.deepEqual(approveBody(REQUEST, []), { companies: [] });
  assert.equal(canApprove(REQUEST, []), false);
  assert.equal(canApprove(REQUEST, ['9']), true);
  const none = consent({ request: REQUEST }).h;
  const approveTag = (h) => h.match(/<button[^>]*data-testid="button-consent-approve"[^>]*>/)[0];
  assert.match(approveTag(none), /disabled=""/, 'nothing ticked: Approve is off');
  const one = consent({ request: REQUEST, initialTicked: [9] }).h;
  assert.doesNotMatch(approveTag(one), /disabled=""/);
  const box = (h, id) => h.match(new RegExp(`<input[^>]*data-testid="consent-company-${id}"[^>]*>`))[0];
  assert.match(box(one, 9), /checked=""/);
  assert.doesNotMatch(box(one, 7), /checked=""/);
});

test('the expired, used, empty, off and unreadable states render, and none can approve', () => {
  assert.equal(consentState({ error: { status: 410 } }), 'expired');
  assert.equal(consentState({ error: { status: 409 } }), 'used');
  assert.equal(consentState({ error: { status: 404 } }), 'off');
  assert.equal(consentState({ error: { status: 500 } }), 'unreadable');
  assert.equal(consentState({ request: { ...REQUEST, companies: [] } }), 'empty');
  assert.match(consent({ error: { status: 410 } }).text, /Start again from your assistant/);
  assert.match(consent({ error: { status: 409 } }).text, /already used[^]*Start again from your assistant/);
  assert.match(consent({ error: { status: 404 } }).text, /Not available yet/);
  const empty = consent({ request: { ...REQUEST, companies: [] } });
  assert.match(empty.text, /no company you can write to/);
  assert.match(empty.text, /chatgpt\.com/, 'the host still shows');
  for (const e of [{ status: 410 }, { status: 409 }, { status: 404 }, { status: 500 }]) assert.doesNotMatch(consent({ error: e }).h, /button-consent-approve/);
  assert.doesNotMatch(empty.h, /button-consent-approve/);
});

test('signed out goes to sign-in and back; only an https redirect is followed', () => {
  assert.equal(signInPath({ pathname: '/connect/assistant', search: '?request=abc' }), '/login?next=%2Fconnect%2Fassistant%3Frequest%3Dabc');
  assert.equal(safeRedirect('https://chatgpt.com/cb?code=1'), 'https://chatgpt.com/cb?code=1');
  assert.equal(safeRedirect('http://localhost:3000/cb'), 'http://localhost:3000/cb');
  assert.equal(safeRedirect('javascript:alert(1)'), null);
  assert.equal(safeRedirect('http://evil.example/cb'), null);
  assert.equal(safeRedirect('/relative'), null);
});

test('the setup cards hold the one server URL, link the vendor\'s page and say its limits', () => {
  const h = html(React.createElement(AssistantsGroup, { grants: [], status: 'ready' }));
  assert.deepEqual(ASSISTANTS.map((a) => a.name), ['ChatGPT', 'Claude', 'Gemini', 'Grok', 'Another MCP client']);
  const urls = [...h.matchAll(/data-testid="assistant-server-url">([^<]*)</g)].map((m) => m[1]);
  assert.equal(urls.length, ASSISTANTS.length);
  assert.deepEqual([...new Set(urls)], [MCP_SERVER_URL]);
  assert.equal(MCP_SERVER_URL, 'https://axal.vc/api/mcp');
  for (const a of ASSISTANTS) {
    assert.match(a.doc, /^https:\/\//);
    assert.ok(h.includes(`href="${a.doc}"`), `${a.name} links its doc`);
  }
  assert.match(renderedText(h), /Business, Enterprise and Edu/);
  assert.match(renderedText(h), /personal Google Account/);
  assert.match(renderedText(h), /paid Grok plans/);
});

test('Revoke asks first, then the row is gone', () => {
  const grants = [
    { id: 'g1', client_name: 'Claude', redirect_host: 'claude.ai', companies: [{ id: 7, name: 'Northwind' }], connected_at: '2026-10-01T09:00:00Z', last_used_at: null },
    { id: 'g2', client_name: 'Grok', redirect_host: 'grok.com', companies: [], connected_at: null, last_used_at: '2026-10-08T00:00:00Z' },
  ];
  const list = html(React.createElement(GrantsList, { grants }));
  const text = renderedText(list.match(/<table[^]*<\/table>/)[0]);
  assert.match(text, /Claudeclaude\.aiNorthwind2026-10-01Never used/);
  assert.match(text, /Grokgrok\.comNot recordedNot recorded2026-10-08/);
  assert.equal((list.match(/data-testid="button-revoke-g1"/g) || []).length, 2, 'the table and the phone card each offer it');
  assert.doesNotMatch(list, /button-revoke-yes-g1/, 'the first press only asks');
  const asking = html(React.createElement(GrantsList, { grants, initialConfirming: 'g1' }));
  assert.match(renderedText(asking), /Revoke now\? It stops at once\./);
  assert.match(asking, /data-testid="button-revoke-yes-g1"/);
  assert.deepEqual(grantsAfterRevoke(grants, 'g1').map((g) => g.id), ['g2']);
  assert.doesNotMatch(html(React.createElement(GrantsList, { grants: grantsAfterRevoke(grants, 'g1') })), /assistant-grant-g1/);
  assert.match(renderedText(html(React.createElement(GrantsList, { grants: [] }))), /No assistant is connected yet/);
  assert.match(html(React.createElement(GrantsList, { status: 'unreadable' })), /assistant-grants-unreadable/);
});

test('the sheet\'s entry: three steps, the consent line, the link, and a starter prompt naming the company', () => {
  const h = html(React.createElement(AssistantEntry, { companyName: 'Northwind' }));
  const text = renderedText(h);
  assert.match(text, /Connect your assistant[^]*Run the interview there[^]*Review it here/);
  assert.match(text, /consent must cover your AI assistant processing the interview/);
  assert.match(h, /href="\/account\/connectors#ai-assistants"/);
  assert.match(text, /StudioOS never sends it anywhere/);
  const p = starterPrompt('Northwind');
  assert.match(p, /^Use the StudioOS connector for Northwind\./);
  assert.match(p, /quote the transcript word for word/);
  assert.match(starterPrompt(''), /for my company/);
});

test('a placement\'s label names its source; an assistant session carries its badge and opens on review', () => {
  assert.equal(placementSource({ proposed_by: 'assistant', proposed_by_name: 'ChatGPT', proposed_by_host: 'chatgpt.com' }), 'Proposed by ChatGPT (chatgpt.com)');
  assert.equal(placementSource({ proposed_by: 'studioos' }), 'Proposed by StudioOS');
  assert.equal(placementSource({}), 'Proposed by StudioOS');
  assert.equal(placementSource({ submitted_via_name: 'Grok' }), 'Proposed by Grok (host not recorded)');
  const s = { submitted_via_name: 'Claude', submitted_via_host: 'claude.ai' };
  assert.equal(openingStep(s), 'review');
  assert.equal(openingStep({ channel: 'video' }), null);
  assert.match(html(React.createElement(AssistantBadge, { session: s })), />From Claude</);
  assert.equal(html(React.createElement(AssistantBadge, { session: { channel: 'video' } })), '');
});
