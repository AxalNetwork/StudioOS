// D4665 (#4665): the composer's send operation — one key per composition across retries, a new key for a
// changed message, unknown outcomes never reported as "nothing was sent", and uncertainty never read as sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeSendOperation, newOperationKey, readOutcome, sendFailure, UNSURE_LINE } from '../src/pages/email/sendOperation.js';

test('a key is stable while the message is, new when anything in it changes, and shaped for the server', () => {
  const op = makeSendOperation();
  const a = op.keyFor(['acct', 'x@example.invalid', 'S', 'B', 'draft']);
  assert.match(a, /^[A-Za-z0-9_-]{16,64}$/);
  assert.equal(op.keyFor(['acct', 'x@example.invalid', 'S', 'B', 'draft']), a, 'a retry of the same message keeps its operation');
  for (const changed of [['acct', 'y@example.invalid', 'S', 'B', 'draft'], ['acct', 'x@example.invalid', 'S2', 'B', 'draft'], ['acct', 'x@example.invalid', 'S', 'B2', 'draft']]) {
    assert.notEqual(op.keyFor(changed), a, 'an edited message is a new operation');
  }
  const b = op.keyFor(['acct', 'x@example.invalid', 'S', 'B', 'draft']);
  op.forget();
  assert.notEqual(op.keyFor(['acct', 'x@example.invalid', 'S', 'B', 'draft']), b, 'a settled operation is not reused');
  assert.notEqual(newOperationKey(), newOperationKey());
});

test('the recorded outcome is read as recorded: accepted needs its sent row, uncertain and pending are never sent, a bare reply is not recorded', () => {
  assert.equal(readOutcome({ operation: { state: 'accepted', uid: 'u' }, sent: { uid: 'u' } }).state, 'accepted');
  assert.equal(readOutcome({ operation: { state: 'accepted', uid: 'u' } }).state, 'unrecorded', 'accepted without a sent row is not shown as done');
  assert.equal(readOutcome({ operation: { state: 'uncertain', uid: 'u' }, error: { code: 'send_uncertain' } }).state, 'uncertain');
  assert.equal(readOutcome({ operation: { state: 'pending', uid: 'u' } }).state, 'pending');
  assert.equal(readOutcome({ sent: { uid: 'u' } }).state, 'accepted', 'the reply before operations existed');
  assert.equal(readOutcome({}).state, 'unrecorded');
  assert.equal(readOutcome(null).state, 'unrecorded');
});

test('a request that got no answer does not say "Nothing was sent"; a server answer ends the operation', () => {
  const lost = sendFailure(new TypeError('Failed to fetch'));
  assert.equal(lost.ended, false);
  assert.doesNotMatch(lost.line, /Nothing was sent/);
  assert.match(lost.line, /will not send twice/);
  const refused = sendFailure(Object.assign(new Error('Reconnect the mailbox.'), { status: 409 }));
  assert.deepEqual([refused.ended, refused.line], [true, 'Reconnect the mailbox.']);
  assert.doesNotMatch(UNSURE_LINE, /Nothing was sent/);
});

test('both composers send through one operation key and offer the reconcile step', () => {
  for (const f of ['ComposeSheet.jsx', 'RecordCompose.jsx']) {
    const src = readFileSync(new URL(`../src/pages/email/${f}`, import.meta.url), 'utf8');
    assert.match(src, /operation_key: key/, `${f} sends its operation key`);
    assert.match(src, /readOutcome\(r\)/, `${f} reads the recorded outcome`);
    assert.match(src, /<SendUncertain/, `${f} offers the reconcile step`);
    assert.match(src, /disabled=\{[^}]*!!unsure\}/, `${f} holds Send while an outcome is unknown`);
    assert.doesNotMatch(src, /e\?\.message \|\| 'The mail server refused it\. Nothing was sent\.'\)/, `${f} no longer claims nothing was sent for every failure`);
  }
});
