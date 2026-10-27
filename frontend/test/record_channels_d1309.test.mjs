/**
 * D1309 (#2507, #2515, #2525) — Record a session's channels at their own
 * addresses, each pointing at where today's version of its boards is and at
 * the task that builds the rest.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/record_channels_d1309.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RECORD_CHANNELS, channelOf } from '../src/pages/founder/recordChannels.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('three channels, each at its own address, each naming its task', () => {
  assert.deepEqual(RECORD_CHANNELS.map((c) => c.to), ['/validate/record/whatsapp', '/validate/record/telegram', '/validate/record/calls']);
  assert.deepEqual(RECORD_CHANNELS.map((c) => c.task), [2507, 2515, 2525]);
  assert.equal(channelOf('/validate/record/telegram').key, 'telegram');
  assert.equal(channelOf('/validate/record/calls/').key, 'calls');
  // Mutation checked: fall back to WhatsApp for any segment → 'live' reads as a channel.
  assert.equal(channelOf('/validate/record/live'), null);
  assert.equal(channelOf('/validate/record'), null);
});

test('App.jsx serves each address as a static route, so /validate/:slug/:id never reads it as a record', () => {
  const app = read('frontend/src/App.jsx');
  // Mutation checked: drop a route → its channel falls to CycleRoute's record mode.
  for (const c of RECORD_CHANNELS) {
    assert.match(app, new RegExp(`path="${c.to}" element=\\{guard\\(labRoles\\(\\['admin', 'founder'\\]\\), <RecordChannelPage />\\)\\}`), c.to);
  }
});

// D862 (#2507), D869 (#2515) and D878 (#2525) build the three channels' boards, so each page draws its tool;
// record_whatsapp_d862.test.mjs, record_telegram_d869.test.mjs and record_calls_d878.test.mjs mount them.
