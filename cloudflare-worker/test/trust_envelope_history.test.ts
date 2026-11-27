/**
 * Envelope history — the per-agreement timeline, and what it refuses to ship.
 *
 * Two things are on trial here, and the second is the one that matters:
 *
 *   1. The timeline is REAL. `routes/esign.ts` appends `envelope_created`,
 *      `envelope_viewed` and `envelope_signed`, which is exactly the
 *      Sent / Viewed / Signed the canvas draws. Nothing is synthesised from
 *      two timestamps and presented as a sequence of events.
 *
 *   2. `esign_audit_events` carries `ip`, `ua`, `signer_email` and `meta`.
 *      A counterparty's IP address has no business on this page, and the
 *      authorisation is the only thing standing between one party's audit
 *      trail and anyone who can guess an envelope uuid. Both are asserted
 *      against the SQL the function actually issues, not against its intent.
 *
 * Run with the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/trust_envelope_history.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { envelopeHistory, ENVELOPE_EVENT_LABELS } from '../src/services/trust.ts';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const CALLER = { id: 7, email: 'Sam@Example.com' };

type Ev = { action: string; ts: string };

/**
 * A D1 stand-in that records every statement it is asked to prepare, so the
 * assertions below can read the real SQL rather than trust a description of
 * it. The recipient join is evaluated, not faked: a test that hardcodes
 * "the caller is a recipient" cannot fail when the WHERE clause stops
 * checking.
 */
function fakeDb(opts: {
  envelope?: { id: number; completed_at?: string | null; audit_log?: string | null };
  recipients?: Array<{ user_id: number | null; email: string | null }>;
  events?: Ev[];
  eventsThrow?: boolean;
} = {}) {
  const sqls: string[] = [];
  const env: any = {
    DB: {
      prepare(sql: string) {
        sqls.push(sql);
        let bound: any[] = [];
        const isEnvelope = /FROM esign_envelopes/i.test(sql);
        return {
          bind(...a: any[]) { bound = a; return this; },
          async first() {
            if (!isEnvelope) throw new Error(`unexpected first() on: ${sql}`);
            if (!opts.envelope) return null;
            const [, callerId, callerEmail] = bound;
            // The join, evaluated. Both halves of the OR are read off the SQL
            // so dropping either one changes the answer.
            const byId = /r\.user_id\s*=\s*\?/.test(sql);
            const byEmail = /LOWER\(IFNULL\(r\.recipient_email[^)]*\)\)\s*=\s*LOWER\(\?\)/.test(sql);
            const match = (opts.recipients || []).some(r =>
              (byId && r.user_id != null && r.user_id === callerId)
              || (byEmail && !!r.email && r.email.toLowerCase() === String(callerEmail || '').toLowerCase()));
            return match ? { ...opts.envelope } : null;
          },
          async all() {
            if (opts.eventsThrow) throw new Error('no such table: esign_audit_events');
            return { results: (opts.events || []).slice() };
          },
        };
      },
    },
  };
  return { env, sqls };
}

const RECIPIENT_BY_ID = [{ user_id: 7, email: 'someone-else@example.com' }];

test('a recipient gets the Sent / Viewed / Signed trail the canvas draws', async () => {
  const { env } = fakeDb({
    envelope: { id: 3, completed_at: null, audit_log: '[]' },
    recipients: RECIPIENT_BY_ID,
    events: [
      { action: 'envelope_created', ts: '2026-03-10T09:00:00Z' },
      { action: 'envelope_viewed', ts: '2026-03-11T08:22:00Z' },
      { action: 'envelope_signed', ts: '2026-03-14T15:05:00Z' },
    ],
  });
  const h = await envelopeHistory(env, 'env-uuid', CALLER);
  assert.deepEqual(h, [
    { action: 'envelope_created', at: '2026-03-10T09:00:00Z' },
    { action: 'envelope_viewed', at: '2026-03-11T08:22:00Z' },
    { action: 'envelope_signed', at: '2026-03-14T15:05:00Z' },
  ]);
  // And every one of those three is an action the signing flow really writes.
  const esign = read('cloudflare-worker/src/routes/esign.ts');
  for (const a of ['envelope_created', 'envelope_viewed', 'envelope_signed']) {
    assert.match(esign, new RegExp(`action: '${a}'`),
      `${a} is no longer appended — the timeline would have a hole where the canvas draws a step`);
  }
});

test('nothing but the action and the instant leaves the worker', async () => {
  // The disclosure test. Every event carries ip, ua, signer_email and meta in
  // the table; a spread would ship all four to a counterparty's browser.
  const { env, sqls } = fakeDb({
    envelope: { id: 3, completed_at: null, audit_log: null },
    recipients: RECIPIENT_BY_ID,
    events: [{
      action: 'envelope_viewed', ts: '2026-03-11T08:22:00Z',
      ip: '203.0.113.9', ua: 'Mozilla/5.0', signer_email: 'other@example.com',
      meta: '{"note":"private"}',
    } as any],
  });
  const h = await envelopeHistory(env, 'env-uuid', CALLER);
  assert.deepEqual(Object.keys(h![0]).sort(), ['action', 'at']);
  const blob = JSON.stringify(h);
  for (const secret of ['203.0.113.9', 'Mozilla', 'other@example.com', 'private']) {
    assert.ok(!blob.includes(secret), `${secret} reached the client`);
  }
  // The SELECT itself must not even ask for them.
  const audit = sqls.find(s => /esign_audit_events/i.test(s)) || '';
  assert.match(audit, /SELECT action, ts FROM esign_audit_events/);
  for (const col of ['ip', 'ua', 'signer_email', 'meta']) {
    assert.ok(!new RegExp(`SELECT[^;]*\\b${col}\\b`, 'i').test(audit),
      `the audit select asks for ${col}`);
  }
});

test('a non-recipient gets null — and it is null, not an empty timeline', async () => {
  // Null and [] mean different things to the route: null is a 404 that does
  // not confirm the envelope exists, [] is "yours, nothing recorded".
  const { env } = fakeDb({
    envelope: { id: 3, completed_at: null, audit_log: null },
    recipients: [{ user_id: 99, email: 'nobody@example.com' }],
    events: [{ action: 'envelope_signed', ts: '2026-03-14T15:05:00Z' }],
  });
  assert.equal(await envelopeHistory(env, 'env-uuid', CALLER), null);
});

test('an envelope that does not exist is indistinguishable from one that is not yours', async () => {
  const { env } = fakeDb({ envelope: undefined });
  assert.equal(await envelopeHistory(env, 'no-such-uuid', CALLER), null);
});

test('a legacy recipient row with no user_id is still matched, by email', async () => {
  // `/agreements` builds its pending list by email precisely because
  // `recipient_user_id` is not set on legacy rows. A row that can appear in
  // the list must be expandable, or the control is a dead end.
  const { env } = fakeDb({
    envelope: { id: 3, completed_at: null, audit_log: null },
    recipients: [{ user_id: null, email: 'SAM@example.com' }],
    events: [{ action: 'envelope_created', ts: '2026-03-10T09:00:00Z' }],
  });
  const h = await envelopeHistory(env, 'env-uuid', CALLER);
  assert.equal(h?.length, 1, 'the email match is case-sensitive, or gone');
});

test('a completed envelope ends on Completed, from the stored column', async () => {
  // `completed_at` has no audit action of its own, so without this the
  // timeline of a finished envelope stops at the last signature.
  const { env } = fakeDb({
    envelope: { id: 3, completed_at: '2026-03-14T16:00:00Z', audit_log: null },
    recipients: RECIPIENT_BY_ID,
    events: [{ action: 'envelope_signed', ts: '2026-03-14T15:05:00Z' }],
  });
  const h = await envelopeHistory(env, 'env-uuid', CALLER);
  assert.deepEqual(h!.map(e => e.action), ['envelope_signed', 'envelope_completed']);
  assert.equal(h![1].at, '2026-03-14T16:00:00Z');
  // An envelope still in flight gets no such row invented for it.
  const open = fakeDb({
    envelope: { id: 3, completed_at: null, audit_log: null },
    recipients: RECIPIENT_BY_ID,
    events: [{ action: 'envelope_signed', ts: '2026-03-14T15:05:00Z' }],
  });
  const h2 = await envelopeHistory(open.env, 'env-uuid', CALLER);
  assert.deepEqual(h2!.map(e => e.action), ['envelope_signed']);
});

test('events come back in time order even when the table does not', async () => {
  // `completed_at` is appended after the query, so an unsorted result would
  // put the end of the story in the middle of it.
  const { env } = fakeDb({
    envelope: { id: 3, completed_at: '2026-03-12T10:00:00Z', audit_log: null },
    recipients: RECIPIENT_BY_ID,
    events: [
      { action: 'envelope_signed', ts: '2026-03-14T15:05:00Z' },
      { action: 'envelope_created', ts: '2026-03-10T09:00:00Z' },
    ],
  });
  const h = await envelopeHistory(env, 'env-uuid', CALLER);
  assert.deepEqual(h!.map(e => e.action),
    ['envelope_created', 'envelope_completed', 'envelope_signed']);
});

test('a pre-audit-table envelope falls back to the legacy JSON column', async () => {
  // `esign_audit_events` replaced the `audit_log` blob, which routes/esign.ts
  // describes as "kept for backward compatibility but no longer written to".
  // Without the fallback every older envelope expands to nothing and looks as
  // though it has no history at all.
  const { env } = fakeDb({
    envelope: {
      id: 3, completed_at: null,
      audit_log: JSON.stringify([
        { ts: '2026-01-04T09:00:00Z', action: 'envelope_created', ip: '198.51.100.4' },
        { ts: '2026-01-08T10:30:00Z', action: 'envelope_signed', signer_email: 'x@y.z' },
      ]),
    },
    recipients: RECIPIENT_BY_ID,
    events: [],
  });
  const h = await envelopeHistory(env, 'env-uuid', CALLER);
  assert.deepEqual(h, [
    { action: 'envelope_created', at: '2026-01-04T09:00:00Z' },
    { action: 'envelope_signed', at: '2026-01-08T10:30:00Z' },
  ]);
  // The legacy blob's ip and email are dropped on the same terms as the table's.
  assert.ok(!JSON.stringify(h).includes('198.51.100.4'));
  assert.ok(!JSON.stringify(h).includes('x@y.z'));
});

test('the fallback never overrides a real trail', async () => {
  // Both present: the append-only table is the source of truth, and mixing
  // the two would double every event on an envelope that has both.
  const { env } = fakeDb({
    envelope: {
      id: 3, completed_at: null,
      audit_log: JSON.stringify([{ ts: '2020-01-01T00:00:00Z', action: 'envelope_created' }]),
    },
    recipients: RECIPIENT_BY_ID,
    events: [{ action: 'envelope_signed', ts: '2026-03-14T15:05:00Z' }],
  });
  const h = await envelopeHistory(env, 'env-uuid', CALLER);
  assert.deepEqual(h!.map(e => e.action), ['envelope_signed']);
});

test('a missing audit table degrades to the fallback, it does not throw', async () => {
  // /trust/agreements is reachable on a stale D1 where the lazy migration in
  // routes/esign.ts has never run. Expanding a row must not 500 the page.
  const { env } = fakeDb({
    envelope: {
      id: 3, completed_at: null,
      audit_log: JSON.stringify([{ ts: '2026-01-04T09:00:00Z', action: 'envelope_created' }]),
    },
    recipients: RECIPIENT_BY_ID,
    eventsThrow: true,
  });
  const h = await envelopeHistory(env, 'env-uuid', CALLER);
  assert.deepEqual(h!.map(e => e.action), ['envelope_created']);
});

test('a malformed legacy blob is no history, not a crash', async () => {
  for (const blob of ['not json', '{"not":"an array"}', '[{"no":"action"}]', '[null]']) {
    const { env } = fakeDb({
      envelope: { id: 3, completed_at: null, audit_log: blob },
      recipients: RECIPIENT_BY_ID,
      events: [],
    });
    assert.deepEqual(await envelopeHistory(env, 'env-uuid', CALLER), [],
      `${blob} did not degrade to an empty timeline`);
  }
});

test('the label maps on both sides of the wire are identical', async () => {
  // No shared module exists between `frontend/src` and `cloudflare-worker/src`
  // in this repo, so the map genuinely exists twice — the same situation as
  // the trust score, handled the same way: import both and compare, rather
  // than trust that two lists were edited together.
  const client = await import('../../frontend/src/lib/trustCenter.js');
  assert.deepEqual(client.ENVELOPE_EVENT_LABELS, ENVELOPE_EVENT_LABELS,
    'the worker and the page disagree about what an audit action is called');
  // Sent / Viewed / Signed, as drawn.
  assert.equal(ENVELOPE_EVENT_LABELS.envelope_created, 'Sent');
  assert.equal(ENVELOPE_EVENT_LABELS.envelope_viewed, 'Viewed');
  assert.equal(ENVELOPE_EVENT_LABELS.envelope_signed, 'Signed');
});

test('every action the signing flow appends has a label', () => {
  // Parsed out of esign.ts rather than listed here: a new `appendAudit` call
  // should fail this test, not render as a raw column value on the page.
  const esign = read('cloudflare-worker/src/routes/esign.ts');
  const actions = new Set(
    [...esign.matchAll(/action: '([a-z_]+)'/g)].map(m => m[1]),
  );
  assert.ok(actions.size >= 5, `parsed only ${actions.size} audit actions out of esign.ts`);
  const unlabelled = [...actions].filter(a => !ENVELOPE_EVENT_LABELS[a]);
  assert.deepEqual(unlabelled, [],
    `esign.ts appends ${unlabelled.join(', ')} and neither side has a word for it`);
});
