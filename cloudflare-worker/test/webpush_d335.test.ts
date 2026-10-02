/**
 * D335 — Web Push crypto (RFC 8291 payload encryption, RFC 8292 VAPID JWT).
 *
 * No real push service in a unit test, so this verifies the two things a
 * fake service couldn't: the VAPID JWT is a genuine ES256 JWT whose
 * signature verifies against the configured public key, and the wire body
 * `sendWebPush` POSTs is a well-formed RFC 8188 aes128gcm record that a
 * subscriber holding the matching private key can actually decrypt back to
 * the original JSON payload. If either algorithm drifts from spec, a real
 * push service would silently drop the message — this is what would have
 * caught it.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/webpush_d335.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { signVapidJwt, sendWebPush } from '../src/services/webpush.ts';

function b64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = Buffer.from(pad, 'base64');
  return new Uint8Array(raw);
}
function bytesToB64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// A fixed, test-only VAPID key pair (ECDSA P-256) — NOT used anywhere real.
const VAPID_PUBLIC_KEY = 'BOycy4dGHw69lbfzmhH4Fr2Z24cbFs8anx3R1LDzT_0wAayFO8pUH0Chs2dL0PNW0rzVH0Qm3UsmJsM96mSNTwE';
const VAPID_PRIVATE_KEY = 'jivZ-O4GluX7-2-pey8R2dXVnXnyk_8c4AxXzisivlI';

function env(): any {
  return { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT: 'mailto:test@axal.example' };
}

test('signVapidJwt produces a three-part JWT whose signature verifies against the public key', async () => {
  const result = await signVapidJwt(env(), 'https://push.example.com');
  assert.ok(result, 'signVapidJwt returned null with both VAPID env vars set');
  const parts = result!.jwt.split('.');
  assert.equal(parts.length, 3, 'a JWT has exactly three dot-separated parts');

  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  assert.equal(header.alg, 'ES256');
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  assert.equal(claims.aud, 'https://push.example.com');
  assert.equal(claims.sub, 'mailto:test@axal.example');
  assert.ok(claims.exp > Math.floor(Date.now() / 1000), 'exp must be in the future');

  const pubKey = await crypto.subtle.importKey(
    'raw', b64urlToBytes(VAPID_PUBLIC_KEY), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'],
  );
  const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const sig = b64urlToBytes(parts[2]);
  const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pubKey, sig, signingInput);
  assert.equal(valid, true, 'the JWT signature does not verify against its own public key');
});

test('signVapidJwt returns null when VAPID is not configured', async () => {
  const result = await signVapidJwt({} as any, 'https://push.example.com');
  assert.equal(result, null);
});

test('sendWebPush produces a decryptable RFC 8188 aes128gcm record', async () => {
  // A fake subscriber: its own ECDH key pair + a 16-byte auth secret, in the
  // shape `PushSubscription.toJSON().keys` gives a browser caller.
  const subscriberKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
  ) as CryptoKeyPair;
  const subscriberPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', subscriberKeyPair.publicKey) as ArrayBuffer);
  const authSecret = crypto.getRandomValues(new Uint8Array(16));

  let capturedBody: Uint8Array | null = null;
  let capturedHeaders: Record<string, string> | null = null;
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async (_url: string, init: any) => {
    capturedBody = new Uint8Array(init.body);
    capturedHeaders = init.headers;
    return new Response(null, { status: 201 });
  };

  try {
    const result = await sendWebPush(
      env(),
      { endpoint: 'https://push.example.com/abc', p256dh: bytesToB64url(subscriberPublicRaw), auth: bytesToB64url(authSecret) },
      { title: 'Test', body: 'hello from D335' },
    );
    assert.deepEqual(result, { ok: true });
    assert.ok(capturedHeaders, 'fetch was never called');
    assert.equal(capturedHeaders!['Content-Encoding'], 'aes128gcm');
    assert.match(capturedHeaders!['Authorization'], /^vapid t=.+, k=.+$/);

    // Decrypt the record the way a browser's push service worker would,
    // per RFC 8291 §3.4 — reversing the exact derivation `sendWebPush` runs.
    const body = capturedBody!;
    const salt = body.slice(0, 16);
    const keyIdLen = body[20];
    const serverPublicRaw = body.slice(21, 21 + keyIdLen);
    const ciphertext = body.slice(21 + keyIdLen);

    const serverPublicKey = await crypto.subtle.importKey(
      'raw', serverPublicRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, [],
    );
    const sharedSecretBits = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: serverPublicKey } as EcdhKeyDeriveParams, subscriberKeyPair.privateKey, 256,
    );
    const hkdf = async (saltBytes: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) => {
      const key = await crypto.subtle.importKey('raw', ikm, { name: 'HKDF' }, false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info }, key, length * 8);
      return new Uint8Array(bits);
    };
    const concat = (...parts: Uint8Array[]) => {
      const total = parts.reduce((n, p) => n + p.length, 0);
      const out = new Uint8Array(total);
      let off = 0; for (const p of parts) { out.set(p, off); off += p.length; }
      return out;
    };
    const keyInfo = concat(new TextEncoder().encode('WebPush: info\0'), subscriberPublicRaw, serverPublicRaw);
    const ikm = await hkdf(authSecret, new Uint8Array(sharedSecretBits), keyInfo, 32);
    const cek = await hkdf(salt, ikm, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, ikm, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);

    const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['decrypt']);
    const plainWithDelim = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, cekKey, ciphertext));
    assert.equal(plainWithDelim[plainWithDelim.length - 1], 0x02, 'missing RFC 8188 last-record delimiter octet');
    const plaintext = plainWithDelim.slice(0, -1);
    const decoded = JSON.parse(new TextDecoder().decode(plaintext));
    assert.deepEqual(decoded, { title: 'Test', body: 'hello from D335' });
  } finally {
    (globalThis as any).fetch = originalFetch;
  }
});

test('sendWebPush marks a 410 response as gone', async () => {
  const subscriberKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
  ) as CryptoKeyPair;
  const subscriberPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', subscriberKeyPair.publicKey) as ArrayBuffer);
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => new Response(null, { status: 410 });
  try {
    const result = await sendWebPush(
      env(),
      { endpoint: 'https://push.example.com/dead', p256dh: bytesToB64url(subscriberPublicRaw), auth: bytesToB64url(crypto.getRandomValues(new Uint8Array(16))) },
      { title: 'x' },
    );
    assert.equal(result.ok, false);
    assert.equal((result as any).gone, true);
  } finally {
    (globalThis as any).fetch = originalFetch;
  }
});
