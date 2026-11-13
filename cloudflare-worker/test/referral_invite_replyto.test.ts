/**
 * Task #5 — network/referral invites must carry a Reply-To pointing at the
 * inviting user so a recipient's reply reaches the sender, not the unmonitored
 * noreply mailbox — while the From address stays on Axal's authenticated
 * domain (noreply@axal.vc) for DKIM/SPF/DMARC alignment.
 *
 * Pins the REAL builder (buildReferralInviteRaw in services/email.ts):
 *   1. Reply-To is the sender's registered email.
 *   2. From address remains noreply@axal.vc; display name reflects the sender.
 *   3. No sender email -> no Reply-To (but the invite still builds).
 *   4. Sender-controlled name/email is header-injection-safe (CR/LF stripped,
 *      angle-bracket spoofing neutralised by quoting).
 *
 * Run via the strip-types loader (see package.json test:drift).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReferralInviteRaw } from '../src/services/email.ts';

const LINK = 'https://axal.vc/register?ref=AXC123&invitee=jane%40hercompany.com';

// Headers are everything before the first blank line; split on CRLF.
function headerLines(raw: string): string[] {
  return raw.split('\r\n\r\n')[0].split('\r\n');
}

test('referral invite sets Reply-To to the sender and keeps From on noreply@axal.vc', () => {
  const raw = buildReferralInviteRaw(
    'jane@hercompany.com',
    'Jane Founder',
    'John Sender',
    'john@hisco.com',
    LINK,
    'AXC123',
    'Come build with us!',
  );

  const lines = headerLines(raw);
  const from = lines.find((l) => l.startsWith('From:'));
  const replyTo = lines.find((l) => l.startsWith('Reply-To:'));

  assert.ok(from, 'From header present');
  assert.ok(replyTo, 'Reply-To header present');

  // From address stays on the authenticated domain; display name reflects sender.
  assert.match(from!, /<noreply@axal\.vc>$/);
  assert.match(from!, /John Sender via Axal StudioOS/);

  // Reply-To routes replies straight to the sender's registered email.
  assert.equal(replyTo, 'Reply-To: John Sender <john@hisco.com>');
});

test('referral invite with no sender email omits Reply-To but still builds with From on noreply@axal.vc', () => {
  const raw = buildReferralInviteRaw(
    'jane@hercompany.com', 'Jane', 'John Sender', '', LINK, 'AXC123', '',
  );
  const lines = headerLines(raw);
  assert.equal(lines.find((l) => l.startsWith('Reply-To:')), undefined, 'no Reply-To when sender email missing');
  assert.match(lines.find((l) => l.startsWith('From:'))!, /<noreply@axal\.vc>$/);
});

test('CR/LF in sender name/email is stripped (no header injection)', () => {
  const raw = buildReferralInviteRaw(
    'jane@hercompany.com',
    'Jane',
    'Evil\r\nBcc: attacker@evil.com',
    'john@hisco.com\r\nBcc: attacker2@evil.com',
    LINK,
    'AXC123',
    '',
  );

  // No smuggled Bcc header anywhere in the raw message.
  assert.doesNotMatch(raw, /\r\nBcc:/i);

  const lines = headerLines(raw);
  // From + Reply-To each occupy exactly one header line.
  assert.equal(lines.filter((l) => l.startsWith('From:')).length, 1);
  assert.equal(lines.filter((l) => l.startsWith('Reply-To:')).length, 1);

  const from = lines.find((l) => l.startsWith('From:'))!;
  const replyTo = lines.find((l) => l.startsWith('Reply-To:'))!;
  assert.match(from, /<noreply@axal\.vc>$/);
  // The CR/LF was collapsed to a space so the injected text rode along inside
  // the single From line, never as its own header.
  assert.ok(from.includes('Bcc: attacker@evil.com'));
  assert.ok(replyTo.includes('Bcc: attacker2@evil.com'));
});

test('angle brackets in sender name are quoted so they cannot spoof a second From address', () => {
  const raw = buildReferralInviteRaw(
    'jane@hercompany.com',
    'Jane',
    'Mallory <mallory@evil.com>',
    'john@hisco.com',
    LINK,
    'AXC123',
    '',
  );
  const from = headerLines(raw).find((l) => l.startsWith('From:'))!;
  // The malicious addr-spec is inside a quoted display name; the only real
  // address is noreply@axal.vc.
  assert.equal(from, 'From: "Mallory <mallory@evil.com> via Axal StudioOS" <noreply@axal.vc>');
});
