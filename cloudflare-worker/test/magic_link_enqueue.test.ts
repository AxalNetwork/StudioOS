import test from 'node:test';
import assert from 'node:assert/strict';
import { send } from '../src/services/email/send.ts';

// The sign-in screen says the link was sent as soon as /magic/start answers.
// That answer is only honest if the message has been accepted by the queue
// the consumer actually drains. `Jobs.enqueue` writes the minute-cron table
// and returns, which is how the first press could show "sent" while no mail
// left until a later press happened to land on a drain.

test('a sign-in link is handed to the CF queue on the first send', async () => {
  const sent: Array<{ job_type: string; payload: Record<string, string> }> = [];
  const sql: string[] = [];
  const env = {
    USE_CF_QUEUE: 'true',
    APP_URL: 'https://axal.vc',
    JOB_QUEUE: {
      send: async (body: { job_type: string; payload: Record<string, string> }) => { sent.push(body); },
    },
    DB: {
      prepare(q: string) {
        sql.push(q);
        return {
          bind() { return this; },
          async run() { return { meta: { last_row_id: 7 } }; },
          async first() { return null; },
        };
      },
    },
  };

  const result = await send(env as any, 'auth_magic_link', 'person@example.com', {
    name: 'Person',
    magic_url: 'https://axal.vc/api/auth/magic/verify?token=example-token',
  });

  assert.equal(result.ok, true);
  assert.equal(sent.length, 1, 'the first send did not reach the queue');
  assert.equal(sent[0].job_type, 'email_send');
  assert.equal(sent[0].payload.to, 'person@example.com');
  assert.equal(sent[0].payload.template_key, 'auth_magic_link');
  assert.match(sent[0].payload.text, /example-token/);
  assert.ok(
    !sql.some((q) => /INSERT INTO queue_jobs/.test(q)),
    'the message was parked on the cron table instead of the queue',
  );
});
