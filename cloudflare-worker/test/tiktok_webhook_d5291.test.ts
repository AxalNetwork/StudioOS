/** TikTok deauthorization callbacks verify the exact body and timestamp (#5291). */
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import test from 'node:test';
import { verifyTikTokSignature } from '../src/routes/tiktok_webhook.ts';

test('TikTok signature binds the body and rejects replays and duplicate fields', async () => {
  const timestamp = 1_780_000_000;
  const body = '{"event":"authorization.removed"}';
  const secret = randomBytes(32).toString('hex');
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  const header = `t=${timestamp},s=${signature}`;
  assert.equal(await verifyTikTokSignature(secret, header, body, timestamp * 1000), true);
  assert.equal(await verifyTikTokSignature(secret, header, body + ' ', timestamp * 1000), false);
  assert.equal(await verifyTikTokSignature(secret, header, body, (timestamp + 301) * 1000), false);
  assert.equal(await verifyTikTokSignature(secret, `${header},s=${signature}`, body, timestamp * 1000), false);
});
