// D754 (#1982) — the live smoke's WhatsApp webhook check: an unsigned body
// accepted (any 2xx) fails it; a 401 or 403 passes it, and so does the 503 a
// webhook answers while its secrets are unset.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WHATSAPP_WEBHOOK_PATH, UNSIGNED_PROBE_BODY, webhookGuardVerdict, probeUnsignedWebhook } from './webhookGuard.mjs';

test('a 2xx fails the check; 401 and 403 pass as guarded; 503 passes as unconfigured', () => {
  for (const s of [200, 201, 204]) {
    const v = webhookGuardVerdict(s);
    assert.equal(v.ok, false, `${s} must fail`);
    assert.equal(v.kind, 'accepted');
    assert.match(v.reason, /accepted an unsigned body/);
  }
  for (const s of [401, 403]) assert.deepEqual(webhookGuardVerdict(s), { ok: true, kind: 'guarded', reason: null });
  assert.deepEqual(webhookGuardVerdict(503), { ok: true, kind: 'unconfigured', reason: null });
  assert.equal(webhookGuardVerdict(500).ok, true, 'only an acceptance fails this check');
});

test('the probe POSTs an unsigned, entry-less body to the webhook and judges the status', async () => {
  const seen = [];
  const fake = (status) => async (url, init) => { seen.push({ url, init }); return new Response('{}', { status }); };
  const accepted = await probeUnsignedWebhook('https://axal.vc/', fake(200));
  assert.equal(accepted.ok, false);
  assert.equal(accepted.status, 200);
  const guarded = await probeUnsignedWebhook('https://axal.vc', fake(401));
  assert.equal(guarded.ok, true);
  assert.equal(guarded.kind, 'guarded');
  const { url, init } = seen[0];
  assert.equal(url, 'https://axal.vc' + WHATSAPP_WEBHOOK_PATH);
  assert.equal(init.method, 'POST');
  const names = Object.keys(init.headers).map((h) => h.toLowerCase());
  assert.ok(!names.includes('x-hub-signature-256') && !names.includes('x-hub-signature'), 'no signature is ever sent');
  assert.deepEqual(JSON.parse(init.body), { object: 'whatsapp_business_account', entry: [] }, 'a body that stores nothing even if accepted');
  assert.equal(init.body, UNSIGNED_PROBE_BODY);
});

test('a request that fails outright is not this check\'s failure', async () => {
  const r = await probeUnsignedWebhook('https://axal.vc', async () => { throw new Error('offline'); });
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'unreachable');
});

test('check-spa-live.mjs runs the probe on every host and counts an acceptance as a failure', () => {
  const smoke = readFileSync(new URL('../check-spa-live.mjs', import.meta.url), 'utf8');
  assert.match(smoke, /from '\.\/lib\/webhookGuard\.mjs'/);
  assert.match(smoke, /await probeUnsignedWebhook\(base, fetch/);
  assert.match(smoke, /if \(!hook\.ok\) \{[\s\S]{0,200}failures\.push/);
});
