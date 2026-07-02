/**
 * Founder-initiated Contacts invites must carry a Reply-To pointing at the
 * inviting founder so a recipient's reply reaches them, not the unmonitored
 * noreply mailbox — while the From address stays on Axal's authenticated domain
 * (noreply@axal.vc) for DKIM/SPF/DMARC alignment.
 *
 * Pins the REAL builder (buildContactInviteRaw in services/email.ts):
 *   1. Reply-To is the founder's registered email.
 *   2. From address remains noreply@axal.vc; display name reflects the founder.
 *   3. No founder email -> no Reply-To (but the invite still builds).
 *   4. Founder-controlled name/email is header-injection-safe (CR/LF stripped,
 *      angle-bracket spoofing neutralised by quoting).
 *
 * Run via the strip-types loader (see package.json test:drift).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContactInviteRaw } from '../src/services/email.ts';

const LINK = 'https://axal.vc';

// Headers are everything before the first blank line; split on CRLF.
function headerLines(raw: string): string[] {
  return raw.split('\r\n\r\n')[0].split('\r\n');
}

test('contact invite sets Reply-To to the founder and keeps From on noreply@axal.vc', () => {
  const raw = buildContactInviteRaw(
    'jane@hercompany.com',
    'Jane Prospect',
    'John Founder',
    'john@hisco.com',
    'Acme Labs',
    LINK,
    'Would love to chat!',
  );

  const lines = headerLines(raw);
  const from = lines.find((l) => l.startsWith('From:'));
  const replyTo = lines.find((l) => l.startsWith('Reply-To:'));

  assert.ok(from, 'From header present');
  assert.ok(replyTo, 'Reply-To header present');

  // From address stays on the authenticated domain; display name reflects founder.
  assert.match(from!, /<noreply@axal\.vc>$/);
  assert.match(from!, /John Founder via Axal StudioOS/);

  // Reply-To routes replies straight to the founder's registered email.
  assert.equal(replyTo, 'Reply-To: John Founder <john@hisco.com>');
});

test('contact invite with no founder email omits Reply-To but still builds with From on noreply@axal.vc', () => {
  const raw = buildContactInviteRaw(
    'jane@hercompany.com', 'Jane', 'John Founder', '', 'Acme Labs', LINK, '',
  );
  const lines = headerLines(raw);
  assert.equal(lines.find((l) => l.startsWith('Reply-To:')), undefined, 'no Reply-To when founder email missing');
  assert.match(lines.find((l) => l.startsWith('From:'))!, /<noreply@axal\.vc>$/);
});

test('contact invite neutralises header-injection in founder-controlled name/email', () => {
  const raw = buildContactInviteRaw(
    'jane@hercompany.com',
    'Jane',
    'Evil\r\nBcc: victim@evil.com',
    'attacker@evil.com>\r\nX-Injected: 1',
    'Acme Labs',
    LINK,
    'hi',
  );
  const lines = headerLines(raw);
  // No smuggled headers survive into the header block.
  assert.equal(lines.find((l) => l.startsWith('Bcc:')), undefined, 'no injected Bcc header');
  assert.equal(lines.find((l) => l.startsWith('X-Injected:')), undefined, 'no injected X-Injected header');
  // From still ends on the authenticated address; a second spoofed address can't appear.
  assert.match(lines.find((l) => l.startsWith('From:'))!, /<noreply@axal\.vc>$/);
});
