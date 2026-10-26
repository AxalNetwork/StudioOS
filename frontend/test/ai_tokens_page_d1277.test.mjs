// D1277 (#2482) — Account › Usage › AI tokens (TOKB1–TOKB13): the page at
// /account/usage/ai-tokens, third in Usage's column (Overview · Cost · AI tokens
// · Limits · Storage), its five cards in the canvas's order, each "Not read here
// yet" until #2482's steps land, Add tokens where every Add tokens goes today,
// and Overview's balance card keeping Open billing with a way here.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/ai_tokens_page_d1277.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import AiTokensPage from '../src/pages/account/AiTokensPage.jsx';
import { AI_TOKENS_PAGE, CARDS, NOT_YET, WAITS } from '../src/pages/account/aiTokensModel.js';
import { USAGE_PAGES, usagePageFor, usagePathFor } from '../src/pages/account/limitsModel.js';
import { ADD_TOKENS_PATH } from '../src/lib/aiTokens.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');

test('Usage’s column: Overview, Cost, AI tokens, Limits, Storage; the address opens the page', () => {
  assert.deepEqual(USAGE_PAGES.map((p) => p.label), ['Overview', 'Cost', 'AI tokens', 'Limits', 'Storage']);
  assert.equal(usagePageFor('/account/usage/ai-tokens'), 'ai-tokens');
  assert.equal(usagePageFor('/settings/usage/ai-tokens'), 'ai-tokens');
  assert.equal(usagePathFor('ai-tokens'), '/account/usage/ai-tokens');
});

test('five cards in the canvas’s order, each waiting with its reason; no wait says zero, none or credits', () => {
  assert.deepEqual(CARDS.map((c) => c.title), ['Available now', 'Held right now', 'What things cost', 'What stops spend', 'When tokens run out']);
  for (const c of CARDS) assert.ok(WAITS[c.id], c.id);
  for (const [k, w] of Object.entries(WAITS)) assert.ok(!/\b0\b|\bnone\b|credit/i.test(w), k);
  assert.equal(AI_TOKENS_PAGE.title, 'AI tokens');
});

test('rendered: the header, Add tokens to today’s path, and every card unread', () => {
  const out = renderToStaticMarkup(h(MemoryRouter, null, h(AiTokensPage)));
  assert.ok(out.includes(AI_TOKENS_PAGE.sub));
  assert.ok(out.includes(`href="${ADD_TOKENS_PATH}"`) && out.includes('data-testid="ai-tokens-add"'));
  for (const c of CARDS) assert.ok(out.includes(`data-testid="ai-tokens-wait-${c.id}"`), c.id);
  assert.equal((out.match(new RegExp(NOT_YET, 'g')) || []).length, CARDS.length);
  assert.ok(!/credits?\b/i.test(out.replace(/data-testid="[^"]*"/g, '')), 'one currency: AI tokens');
});

test('the wiring: the Account pane draws it, Overview links here, the canvas and the docs', () => {
  assert.ok(read('frontend/src/pages/SettingsPage.jsx').includes("usagePage === 'ai-tokens' ? <AiTokensPage /> :"));
  const ov = read('frontend/src/pages/account/UsageOverview.jsx');
  assert.ok(ov.includes("aiTokens: '/account/usage/ai-tokens'") && ov.includes('Holds and prices ›'));
  assert.ok(ov.includes('action={<Open card="balance">Open billing</Open>}'), 'the balance card keeps Open billing (#2210)');
  for (const f of ['AI Tokens Page.dc.html', 'AI tokens · Boards.dc.html']) assert.ok(existsSync(`design/incoming/${f}`), f);
  assert.ok(read('design/incoming/AI tokens · Boards.dc.html').includes('name="AI Tokens Page"'));
  assert.ok(existsSync('documentation/architecture/decisions/D1277.md'));
  assert.ok(existsSync('documentation/audits/AI_TOKENS_MAP_2026-10-26.md'));
});
