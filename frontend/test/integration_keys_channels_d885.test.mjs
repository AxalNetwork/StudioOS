/**
 * D885 (#2561) on the page: HQ › Integration keys › Channels. The words are
 * pure (`lib/channelKeys.js`); the section is rendered to static markup; the
 * console's wiring and the client are read as source. What the Worker sends is
 * pinned by cloudflare-worker/test/integration_keys_channels_d885.test.ts.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/integration_keys_channels_d885.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ROLLOUT_WORDS, channelBadge, removeChannelText, rolloutLine, secretStateText, setPayload,
} from '../src/lib/channelKeys.js';
import ChannelKeysSection from '../src/pages/admin/consoles/ChannelKeysSection.jsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const h = React.createElement;

/** The Worker's shape for the three channels (no values exist in it to leak). */
const CHANNELS = [
  {
    key: 'whatsapp', label: 'WhatsApp · members\' own numbers (way A)', configured: false,
    secrets: [
      { name: 'WHATSAPP_APP_ID', set: true, generate: false }, { name: 'WHATSAPP_APP_SECRET', set: false, generate: false },
      { name: 'WHATSAPP_VERIFY_TOKEN', set: false, generate: true }, { name: 'WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID', set: false, generate: false },
    ],
    vars: [], webhook_url: 'https://axal.vc/api/channels/whatsapp/webhook', register_webhook_href: null,
    rollout: { var: 'WHATSAPP_CHANNEL', value: 'canary', changed_by: 'pr' },
    guide_href: 'https://github.com/AxalNetwork/StudioOS/blob/main/documentation/operations/WHATSAPP.md',
  },
  {
    key: 'whatsapp_axal', label: 'WhatsApp · through Axal\'s number (way B)', configured: false,
    secrets: [{ name: 'WHATSAPP_AXAL_ACCESS_TOKEN', set: false, generate: false }],
    vars: [{ name: 'WHATSAPP_AXAL_DISPLAY_NUMBER', set: false, changed_by: 'pr' }],
    webhook_url: null, register_webhook_href: null, rollout: { var: 'WHATSAPP_CHANNEL', value: 'off', changed_by: 'pr' }, guide_href: 'javascript:alert(1)',
  },
  {
    key: 'telegram_channel', label: 'Telegram · interview bot (not the news bot)', configured: true,
    secrets: [{ name: 'TELEGRAM_CHANNEL_WEBHOOK_SECRET', set: true, generate: true }],
    vars: [], webhook_url: 'https://axal.vc/api/channels/telegram/webhook', register_webhook_href: '/admin/telegram',
    rollout: { var: 'TELEGRAM_CHANNEL', value: 'on', changed_by: 'pr' }, guide_href: null,
  },
];
const render = (holds) => renderToStaticMarkup(h(ChannelKeysSection, { channels: CHANNELS, holdsSecretWrites: holds, onChanged() {}, showToast() {} }));

test('the words: configured only when the Worker says so, set or not set, the rollout and that a PR changes it', () => {
  assert.equal(channelBadge({ configured: true }).text, 'Configured');
  for (const row of [{ configured: false }, { configured: 'yes' }, {}, null]) assert.equal(channelBadge(row).text, 'Not configured', JSON.stringify(row));
  assert.equal(secretStateText({ set: true }), 'Set');
  for (const s of [{ set: false }, { set: 'true' }, null]) assert.equal(secretStateText(s), 'Not set');
  assert.equal(rolloutLine({ var: 'WHATSAPP_CHANNEL', value: 'canary' }),
    `WHATSAPP_CHANNEL is "canary": ${ROLLOUT_WORDS.canary}. It is changed by a PR to wrangler.toml, not here.`);
  assert.match(rolloutLine({ var: 'TELEGRAM_CHANNEL', value: 'weird' }), /: Unknown\./);
  assert.equal(rolloutLine(null), '');
  assert.match(removeChannelText(CHANNELS[2]), /^Remove Telegram · interview bot \(not the news bot\)'s secrets \(TELEGRAM_CHANNEL_WEBHOOK_SECRET\)\?/);
});

test('a save sends only the channel\'s own names that were typed, trimmed', () => {
  const row = CHANNELS[0];
  assert.deepEqual(setPayload(row, { WHATSAPP_APP_ID: ' a ', WHATSAPP_APP_SECRET: '   ', SLACK_CLIENT_SECRET: 'x', WHATSAPP_VERIFY_TOKEN: 'v' }),
    { WHATSAPP_APP_ID: 'a', WHATSAPP_VERIFY_TOKEN: 'v' });
  assert.deepEqual(setPayload(row, {}), {});
  assert.deepEqual(setPayload(null, { A: 'x' }), {});
});

test('the section: each channel with its secrets\' state, webhook, rollout and runbook; actions only for the holder', () => {
  const html = render(true);
  for (const c of CHANNELS) assert.ok(html.includes(`data-testid="channel-key-${c.key}"`), c.key);
  assert.match(html, /data-testid="channel-key-secret-WHATSAPP_APP_ID".*?>Set</);
  assert.match(html, /data-testid="channel-key-secret-WHATSAPP_APP_SECRET".*?>Not set</);
  assert.match(html, /WHATSAPP_AXAL_DISPLAY_NUMBER<\/code><span[^>]*>Not set · set in wrangler.toml by a PR/);
  assert.ok(html.includes('https://axal.vc/api/channels/whatsapp/webhook'));
  assert.match(html, /The public base URL is not set, so there is no webhook address to register\./);
  assert.match(html, /href="\/admin\/telegram"/);
  assert.match(html, /href="https:\/\/github.com\/AxalNetwork\/StudioOS\/blob\/main\/documentation\/operations\/WHATSAPP.md"/);
  assert.ok(!html.includes('javascript:'), 'a guide outside the repository is not linked');
  assert.equal((html.match(/>Generate</g) || []).length, 2, 'Generate on the two secrets Axal can choose, and no other');
  assert.equal((html.match(/>Rotate</g) || []).length, 2, 'Rotate on a set secret only');
  assert.equal((html.match(/>Set secrets</g) || []).length, 3);
  const plain = render(false);
  for (const action of ['>Generate<', '>Rotate<', '>Set secrets<', 'Remove']) assert.ok(!plain.includes(action), `${action} shown without the write bar`);
  assert.ok(plain.includes('channel-key-secret-WHATSAPP_APP_ID'), 'the state is still shown');
});

test('the console draws the section from the list\'s `channels`, and the client calls only the three routes', () => {
  const consoleSrc = read('frontend/src/pages/admin/consoles/IntegrationKeysConsole.jsx');
  assert.match(consoleSrc, /setChannels\(Array\.isArray\(r\.channels\) \? r\.channels : \[\]\)/);
  assert.match(consoleSrc, /<ChannelKeysSection channels=\{channels\} holdsSecretWrites=\{holdsSecretWrites\}/);
  const client = read('frontend/src/lib/api/channelKeys.js');
  const paths = [...client.matchAll(/request\(`([^`]+)`/g)].map((m) => m[1]);
  assert.deepEqual(paths, [
    '/admin/integration-keys/channels/${enc(channel)}', '/admin/integration-keys/channels/${enc(channel)}/rotate',
    '/admin/integration-keys/channels/${enc(channel)}/rotate', '/admin/integration-keys/channels/${enc(channel)}',
  ]);
  assert.match(read('frontend/src/lib/api.js'), /export \* from '\.\/api\/channelKeys\.js';/);
  const section = read('frontend/src/pages/admin/consoles/ChannelKeysSection.jsx');
  assert.match(section, /from '\.\.\/\.\.\/\.\.\/lib\/api\/channelKeys\.js'/, 'imported from its module, not through api.js');
  assert.ok(!/console\.(log|info)\(/.test(section), 'nothing is logged');
});
