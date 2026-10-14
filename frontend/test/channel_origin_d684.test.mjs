/**
 * D684 (#1578) — the origin badge for a session that came from a connected
 * channel, kept apart from the AI-assistant badge.
 *
 * Both write `submitted_via_name`, so before this the assistant helpers took a
 * Telegram session for an assistant's: "From Telegram" in the assistant's
 * badge, and the session opened on review.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/channel_origin_d684.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CHANNEL_ORIGINS, channelOrigin, originBadge } from '../src/pages/founder/channelOrigin.js';
import { ChannelOriginBadge } from '../src/pages/founder/ChannelOriginBadge.jsx';
import { AssistantBadge } from '../src/pages/founder/AssistantEntry.jsx';
import { openingStep, sessionBadge } from '../src/pages/founder/assistantSession.js';

const html = (el) => renderToStaticMarkup(el);
const channel = (key) => ({ channel: key === 'zoom' || key === 'google_meet' ? 'video' : 'text', submitted_via: key, submitted_via_name: CHANNEL_ORIGINS[key] });
const ASSISTANT = { channel: 'text', submitted_via: 'client-abc123', submitted_via_name: 'Claude', submitted_via_host: 'claude.ai' };

test('each of the four channels gets its own badge', () => {
  assert.deepEqual(Object.keys(CHANNEL_ORIGINS), ['telegram', 'whatsapp', 'zoom', 'google_meet']);
  for (const [key, label] of Object.entries(CHANNEL_ORIGINS)) {
    assert.equal(channelOrigin(channel(key)), key);
    assert.equal(originBadge(channel(key)), `From ${label}`);
    const h = html(React.createElement(ChannelOriginBadge, { session: channel(key) }));
    // D687: the channel's mark sits between the badge's opening tag and its words.
    assert.match(h, new RegExp(`data-testid="channel-origin-badge"[^>]*data-provider="${key}"[^>]*><svg[^>]*data-provider="${key}"[^>]*>.*?</svg>From ${label}<`));
  }
});

test('a session that is not from a channel carries no channel badge', () => {
  for (const s of [{}, { channel: 'in_person' }, ASSISTANT, { submitted_via: '' }, { submitted_via: 'Telegram' }, { submitted_via: 'constructor' }, null, undefined]) {
    assert.equal(channelOrigin(s), null);
    assert.equal(originBadge(s), null);
    assert.equal(html(React.createElement(ChannelOriginBadge, { session: s })), '');
  }
});

test('a channel session is not an assistant session: no assistant badge, and it does not open on review', () => {
  for (const key of Object.keys(CHANNEL_ORIGINS)) {
    assert.equal(sessionBadge(channel(key)), null, `${key} must not show the assistant badge`);
    // It opens on its own channel step (D684, #1581): what it waits for while
    // it is a draft, its transcript once the words are in. Never on review.
    assert.notEqual(openingStep(channel(key)), 'review', `${key} must not open on review`);
    assert.equal(openingStep({ ...channel(key), status: 'draft' }), 'channel');
    assert.equal(html(React.createElement(AssistantBadge, { session: channel(key) })), '');
  }
});

test('an assistant session is unchanged: its badge and review-first opening stay, and it has no channel badge', () => {
  assert.equal(sessionBadge(ASSISTANT), 'From Claude');
  assert.equal(openingStep(ASSISTANT), 'review');
  assert.match(html(React.createElement(AssistantBadge, { session: ASSISTANT })), />From Claude</);
  assert.equal(html(React.createElement(ChannelOriginBadge, { session: ASSISTANT })), '');
});

test('the two badges are told apart by colour, in both themes', () => {
  const a = html(React.createElement(AssistantBadge, { session: ASSISTANT }));
  const c = html(React.createElement(ChannelOriginBadge, { session: channel('telegram') }));
  assert.match(a, /violet/);
  assert.doesNotMatch(c, /violet/);
  assert.match(c, /bg-teal-50[^"]*dark:bg-teal-950/, 'the channel badge needs its dark pair');
  assert.match(c, /text-teal-800[^"]*dark:text-teal-200/);
});

test('the session page draws the channel badge beside the assistant badge', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/pages/founder/InterviewSessionPage.jsx', import.meta.url), 'utf8');
  assert.match(src, /<AssistantBadge session=\{session\} \/><ChannelOriginBadge session=\{session\} \/>/);
});
