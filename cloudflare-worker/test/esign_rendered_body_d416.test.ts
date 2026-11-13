/**
 * D416 — createAndSendEnvelope accepts an already-rendered body, so one
 * agreement can go to each party unchanged (per-party signing, D354).
 *
 * Every assertion runs the real function against node:sqlite through the
 * e-sign harness and reads the envelope and recipients rows back: what body
 * was stored, its hash, which path produced it, and that a refused send wrote
 * nothing. The template path is driven alongside it to show it is unchanged.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { createAndSendEnvelope, RenderedBodyError, UnfilledFieldsError } from '../src/routes/esign.ts';
import { freshDb, envFor, SENDER, RECIPIENT, OTHER_SENDER } from './_esign_harness.ts';

const AGREEMENT = {
  title: 'Co-founder Agreement — Acme Robotics',
  body: '# Co-founder Agreement\n\nBetween Sam Sender and Olu Other, effective 2026-10-05.\n\nEquity: 50 / 50, four-year vesting.\n',
};
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function base(over: Record<string, unknown> = {}) {
  return {
    adminUserId: SENDER,
    adminName: 'Sam Sender',
    recipientUserId: RECIPIENT,
    recipientEmail: 'party@example.test',
    recipientName: 'Ivy Investor',
    documentType: 'cofounder_agreement',
    appUrl: 'https://app.example.test',
    ...over,
  } as any;
}

const envelopes = (db: any) => db.prepare('SELECT * FROM esign_envelopes ORDER BY id').all() as any[];
const recipients = (db: any) => db.prepare('SELECT * FROM esign_recipients ORDER BY id').all() as any[];
/** The envelope_created audit event, from the table appendAudit writes. */
const createdEvent = (db: any, envelopeId: number) => {
  const row = db.prepare(
    "SELECT meta FROM esign_audit_events WHERE envelope_id = ? AND action = 'envelope_created'",
  ).get(envelopeId) as any;
  return row ? JSON.parse(row.meta || '{}') : null;
};

test('a rendered body is stored and hashed exactly as given, under its own title', async () => {
  const db = freshDb();
  const e = envFor(db);
  const r = await createAndSendEnvelope(e, base({ renderedBody: AGREEMENT }));
  assert.ok(r && r.envelope_id, 'the send did not land');
  const [env1] = envelopes(db);
  assert.equal(env1.document_body, AGREEMENT.body, 'the body was re-rendered or altered');
  assert.equal(env1.document_title, AGREEMENT.title);
  assert.equal(env1.body_sha256, sha(AGREEMENT.body), 'the hash is not of the bytes the party signs');
  assert.doesNotMatch(env1.document_body, /Ivy Investor/, 'the recipient was merged into a finished document');
  const [rec] = recipients(db);
  assert.equal(rec.envelope_id, env1.id, 'the recipients row did not ride in the same batch');
  assert.equal(rec.recipient_email, 'party@example.test');
});

test('per party: each party gets its own envelope over the same bytes', async () => {
  const db = freshDb();
  const e = envFor(db);
  const a = await createAndSendEnvelope(e, base({ renderedBody: AGREEMENT, recipientUserId: RECIPIENT, recipientEmail: 'a@example.test', recipientName: 'Party A' }));
  const b = await createAndSendEnvelope(e, base({ renderedBody: AGREEMENT, recipientUserId: OTHER_SENDER, recipientEmail: 'b@example.test', recipientName: 'Party B' }));
  assert.ok(a?.envelope_id && b?.envelope_id && a.envelope_id !== b.envelope_id, 'the two parties did not get two envelopes');
  const rows = envelopes(db);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].body_sha256, rows[1].body_sha256, 'the parties were sent different documents');
  assert.equal(rows[0].document_body, rows[1].document_body);
});

test('the one-pending-send rule still holds: the same party twice is already pending', async () => {
  const db = freshDb();
  const e = envFor(db);
  await createAndSendEnvelope(e, base({ renderedBody: AGREEMENT }));
  const again = await createAndSendEnvelope(e, base({ renderedBody: AGREEMENT }));
  assert.equal(again?.already_pending, true);
  assert.equal(envelopes(db).length, 1);
});

test('the audit trail says the body came from the caller', async () => {
  const db = freshDb();
  const e = envFor(db);
  const r = await createAndSendEnvelope(e, base({ renderedBody: AGREEMENT }));
  const created = createdEvent(db, r!.envelope_id);
  assert.ok(created, 'no envelope_created row');
  assert.equal(created.body_source, 'rendered');
});

test('refused before anything is written: no title, no body, or merge fields alongside', async () => {
  for (const [opts, reason] of [
    [{ renderedBody: { title: '  ', body: AGREEMENT.body } }, 'missing_title'],
    [{ renderedBody: { title: AGREEMENT.title, body: '' } }, 'missing_body'],
    [{ renderedBody: null }, 'missing_title'],
    [{ renderedBody: AGREEMENT, mergeFields: { company_name: 'Acme' } }, 'merge_fields_with_rendered_body'],
  ] as const) {
    const db = freshDb();
    await assert.rejects(
      createAndSendEnvelope(envFor(db), base(opts)),
      (err: any) => err instanceof RenderedBodyError && err.reason === reason,
      `expected ${reason}`,
    );
    let count = 0;
    try { count = envelopes(db).length; } catch { count = 0; }
    assert.equal(count, 0, `${reason}: an envelope was written`);
  }
});

test('a rendered body with a token still in it is refused, whatever refuseUnfilled says', async () => {
  const db = freshDb();
  const holey = { title: AGREEMENT.title, body: 'Between {{party_a}} and Olu Other.' };
  await assert.rejects(
    createAndSendEnvelope(envFor(db), base({ renderedBody: holey })),
    (err: any) => err instanceof UnfilledFieldsError && err.fields.includes('party_a'),
  );
  let count = 0;
  try { count = envelopes(db).length; } catch { count = 0; }
  assert.equal(count, 0);
});

test('the template path is unchanged: no rendered body means the body is built here, and says so', async () => {
  const db = freshDb();
  const e = envFor(db);
  const r = await createAndSendEnvelope(e, base({ documentType: 'investor_nda_axal' }));
  assert.ok(r?.envelope_id);
  const row = envelopes(db)[0];
  assert.notEqual(row.document_body, AGREEMENT.body);
  assert.ok(row.document_body.length > 0, 'the template path produced no body');
  assert.equal(createdEvent(db, row.id)?.body_source, 'template');
});

test('a rendered body wins even where the document type has a template of its own', async () => {
  const db = freshDb();
  const r = await createAndSendEnvelope(envFor(db), base({ documentType: 'investor_nda_axal', renderedBody: AGREEMENT }));
  assert.ok(r?.envelope_id);
  assert.equal(envelopes(db)[0].document_body, AGREEMENT.body, 'the template replaced the rendered document');
});
