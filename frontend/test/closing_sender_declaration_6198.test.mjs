/** D6198 (#6198): an investor records "I have sent it" without Mercury. Sent, not yet confirmed; never Received. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { declarationOf, roomLines, ROOM_WAITS } from '../src/pages/closing/roomModel.js';

test('declarationOf: the newest active declaration, in the line\'s currency; a withdrawn one is history', () => {
  const line = { uid: 'l1', currency: 'USD', sender_declarations: [
    { uid: 'd1', sent_on: '2026-10-01', amount_cents: 100, reference: null, withdrawn_at: '2026-10-02T00:00:00Z' },
    { uid: 'd2', sent_on: '2026-10-20', amount_cents: 25000050, reference: 'Seed wire', withdrawn_at: null },
  ] };
  assert.deepEqual(declarationOf(line), { uid: 'd2', sentOn: '2026-10-20', amount: '$250,000.50', reference: 'Seed wire' });
  assert.equal(declarationOf({ sender_declarations: [{ uid: 'x', withdrawn_at: 'y' }] }), null);
  assert.equal(declarationOf({}), null);
  const [row] = roomLines({ currency: 'USD', lines: [{ ...line, status: 'sent', amount_cents: 25000050 }] }, [], 'investor');
  assert.equal(row.status, 'Sent, not yet confirmed', 'a declared line reads Sent, never Received');
  assert.equal(row.declaration.uid, 'd2');
});

test('the room asks for no account or card number and sends through the investor route', () => {
  assert.doesNotMatch(ROOM_WAITS.sentWord, /No route records it/);
  // D8926: the investor's room, and with it this form, moved to InvestorRoom.jsx.
  const src = readFileSync(new URL('../src/pages/closing/InvestorRoom.jsx', import.meta.url), 'utf8');
  assert.match(src, /closingsApi\.declareSent\(closing\.uid, row\.uid, \{ sent_on: form\.sentOn, amount_cents: amount\.minor/);
  assert.match(src, /Leave out account and card numbers\./);
  assert.doesNotMatch(src, /account_number: form|iban/i, 'no bank detail field');
});
