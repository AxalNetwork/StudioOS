/**
 * D684 (#1578) — the inbox's reply copy: the 24-hour window, and the rule that
 * Telegram is "Sent", never "Delivered".
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/channel_copy_d684.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { providerName, replyWindowCopy, sendStatusLabel } from '../src/pages/founder/channelCopy.js';

test('an open window says how long it lasts and where the reply goes out from', () => {
  for (const [provider, name] of [['whatsapp', 'WhatsApp'], ['telegram', 'Telegram']]) {
    const c = replyWindowCopy({ provider, reply_window_open: true });
    assert.equal(c.open, true);
    assert.match(c.text, /24 hours after the last message from your contact/);
    assert.match(c.text, new RegExp(`from your ${name} account`));
  }
});

test('a closed WhatsApp window says templates are not available and nothing is sent', () => {
  const c = replyWindowCopy({ provider: 'whatsapp', reply_window_open: false });
  assert.equal(c.open, false);
  assert.match(c.text, /more than 24 hours/);
  assert.match(c.text, /approved template/);
  assert.match(c.text, /not available yet/);
  assert.match(c.text, /nothing is sent from here/);
});

test('a closed Telegram window sends the member back to Telegram', () => {
  const c = replyWindowCopy({ provider: 'telegram', reply_window_open: false });
  assert.equal(c.open, false);
  // D756: Telegram counts from the contact's last message too.
  assert.equal(c.text, 'It has been more than 24 hours since your contact last wrote, so Telegram does not let Axal reply. Reply from Telegram, or wait for your contact to write.');
  assert.match(c.text, /Reply from Telegram/);
  assert.doesNotMatch(c.text, /template/);
});

test('a thread that does not say whether it is open is not treated as open', () => {
  for (const t of [undefined, null, {}, { provider: 'whatsapp' }, { provider: 'whatsapp', reply_window_open: 'true' }, { provider: 'telegram', reply_window_open: 1 }]) {
    const c = replyWindowCopy(t);
    assert.equal(c.open, false);
    assert.equal(c.text, 'Not recorded whether you can reply here.');
  }
});

test('Telegram is "Sent", never "Delivered" or "Read"; WhatsApp reports both', () => {
  assert.equal(sendStatusLabel('telegram', 'submitted'), 'Sent');
  assert.equal(sendStatusLabel('telegram', 'delivered'), 'Sent', 'Telegram does not report delivery');
  assert.equal(sendStatusLabel('telegram', 'read'), 'Sent');
  assert.equal(sendStatusLabel('whatsapp', 'submitted'), 'Sent');
  assert.equal(sendStatusLabel('whatsapp', 'delivered'), 'Delivered');
  assert.equal(sendStatusLabel('whatsapp', 'read'), 'Read');
});

test('a failed or unknown status is said plainly, never as sent', () => {
  assert.equal(sendStatusLabel('whatsapp', 'failed'), 'Not sent');
  assert.equal(sendStatusLabel('telegram', 'failed'), 'Not sent');
  assert.equal(sendStatusLabel('whatsapp', 'pending'), 'Sending');
  assert.equal(sendStatusLabel('telegram', undefined), 'Not recorded');
  assert.equal(sendStatusLabel('telegram', 'bogus'), 'Not recorded');
});

test('the copy never uses a word the product avoids', () => {
  const all = [
    replyWindowCopy({ provider: 'whatsapp', reply_window_open: true }).text,
    replyWindowCopy({ provider: 'whatsapp', reply_window_open: false }).text,
    replyWindowCopy({ provider: 'telegram', reply_window_open: false }).text,
  ].join(' ');
  assert.doesNotMatch(all, /advis|recommend|fiduciary/i);
  assert.equal(providerName('constructor'), 'this app');
});
