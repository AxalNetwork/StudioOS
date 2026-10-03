/**
 * D335 — Web Push (RFC 8291 payload encryption, RFC 8292 VAPID auth).
 *
 * No npm `web-push` here: that package shells out to Node's `crypto`
 * module, which the Workers runtime doesn't have. Everything below is
 * built on `crypto.subtle`, which Workers does implement for the three
 * primitives this needs — ECDH (P-256), HKDF, AES-GCM, and ECDSA (P-256)
 * for the VAPID JWT.
 *
 * `sendWebPush` does the whole RFC 8291 §3.4 derivation: an ephemeral
 * ECDH key pair, HKDF-derived content-encryption key and nonce from the
 * shared secret plus the subscription's `auth` secret, and an
 * aes128gcm-encoded body with the 16-byte padding-length header RFC 8188
 * requires. A push service that can't decrypt what this produces is a bug
 * in this file, not in the subscriber's browser.
 */
import type { Env } from '../types';

/**
 * Codex review on D334: `/push/subscribe` accepted any non-empty string as
 * `endpoint`, and `/push/test` then did a server-side `fetch()` to it — an
 * authenticated client could persist an arbitrary URL and get this Worker
 * to make outbound POST requests to it on demand, including to a loopback
 * or private-range address if DNS or an IP literal pointed there. This is
 * the one gate both the subscribe route and `sendWebPush` now share: HTTPS
 * only, no literal IP host (v4 or bracketed v6), no `localhost` / loopback
 * / link-local / `.internal`/`.local` hostname, reasonable length. It
 * cannot catch a hostname that resolves to a private address only at
 * fetch time — no synchronous DNS check is available here — so this is
 * defense in depth, not a complete guarantee; Workers' own sandboxed
 * egress is the other layer.
 */
export function isAllowedPushEndpoint(raw: string): boolean {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2000) return false;
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  // IPv6 literals arrive bracketed, e.g. "[::1]" -> hostname "::1".
  const v6 = host.startsWith('[') ? host.slice(1, -1) : host;
  if (v6 === '::1' || v6 === '::') return false;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = v4.slice(1).map(Number);
    if (a === 127 || a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) {
      return false;
    }
  }
  return true;
}

function b64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob(pad);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

async function importVapidPrivateKey(privateKeyB64url: string, publicKeyB64url: string): Promise<CryptoKey> {
  // Raw private scalar, 32 bytes — the shape the web-push ecosystem stores
  // VAPID keys in. JWK is the only `crypto.subtle` import format that takes
  // a bare scalar for a P-256 key, so this reconstructs a JWK around it.
  // Some WebCrypto implementations (Node's, notably) insist on `x`/`y`
  // alongside `d` even though the public point is redundant for a
  // sign-only key — both come straight off the raw uncompressed public
  // point we already store (`0x04 || x(32) || y(32)`).
  const d = b64urlToBytes(privateKeyB64url);
  const pub = b64urlToBytes(publicKeyB64url);
  const x = pub.slice(1, 33);
  const y = pub.slice(33, 65);
  const jwk: JsonWebKey = {
    kty: 'EC', crv: 'P-256', d: bytesToB64url(d), x: bytesToB64url(x), y: bytesToB64url(y), ext: true,
  };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/** RFC 8292 — a short-lived ES256 JWT identifying this server to the push service. */
export async function signVapidJwt(env: Env, audience: string): Promise<{ jwt: string; publicKey: string } | null> {
  const priv = (env as any).VAPID_PRIVATE_KEY;
  const pub = (env as any).VAPID_PUBLIC_KEY;
  if (!priv || !pub) return null;
  const header = { typ: 'JWT', alg: 'ES256' };
  const claims = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: (env as any).VAPID_SUBJECT || 'mailto:support@axal.vc',
  };
  const enc = (o: unknown) => bytesToB64url(new TextEncoder().encode(JSON.stringify(o)));
  const signingInput = `${enc(header)}.${enc(claims)}`;
  const key = await importVapidPrivateKey(priv, pub);
  const sigBuf = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signingInput));
  // Workers' ECDSA sign already returns the raw (r||s) 64-byte IEEE-P1363
  // form JWS ES256 wants — no ASN.1 DER unwrap needed, unlike Node's crypto.
  const jwt = `${signingInput}.${bytesToB64url(new Uint8Array(sigBuf))}`;
  return { jwt, publicKey: pub };
}

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushSendResult =
  | { ok: true }
  | { ok: false; gone: boolean; status: number; error: string };

/** RFC 8291 §3 — aes128gcm payload encryption + the push service POST. */
export async function sendWebPush(
  env: Env,
  sub: PushSubscriptionRow,
  payload: Record<string, unknown>,
): Promise<PushSendResult> {
  // Review-caught: this used to run before the try block, so a malformed
  // endpoint threw uncaught instead of returning the error shape every
  // other failure in this function does. Subscriptions are validated with
  // `isAllowedPushEndpoint` at write time (`/push/subscribe`), but a stored
  // row predating that check, or a future second writer, shouldn't get a
  // different failure mode here.
  let endpointUrl: URL;
  try {
    endpointUrl = new URL(sub.endpoint);
  } catch {
    return { ok: false, gone: false, status: 0, error: 'invalid_endpoint' };
  }
  const audience = `${endpointUrl.protocol}//${endpointUrl.host}`;
  const vapid = await signVapidJwt(env, audience);
  if (!vapid) return { ok: false, gone: false, status: 0, error: 'vapid_not_configured' };

  try {
    const plaintext = new TextEncoder().encode(JSON.stringify(payload));

    const uaPublicRaw = b64urlToBytes(sub.p256dh);     // subscriber's ECDH public key
    const authSecret = b64urlToBytes(sub.auth);        // 16-byte subscriber auth secret
    const salt = crypto.getRandomValues(new Uint8Array(16));

    const uaPublicKey = await crypto.subtle.importKey(
      'raw', uaPublicRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, [],
    );
    const serverKeyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
    ) as CryptoKeyPair;
    const serverPublicRaw = new Uint8Array(
      await crypto.subtle.exportKey('raw', serverKeyPair.publicKey) as ArrayBuffer,
    );

    // The Web Crypto spec (and the actual runtime property every engine
    // reads, Workers included) names this field `public`. Workers'
    // *TypeScript* ambient types alias it to `$public` to dodge a name
    // clash with lib.dom.d.ts's own `EcdhKeyDeriveParams` — a type-only
    // workaround with no runtime counterpart, so the real call below uses
    // the spec name and casts past the type.
    const sharedSecretBits = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: uaPublicKey } as unknown as Parameters<typeof crypto.subtle.deriveBits>[0],
      serverKeyPair.privateKey, 256,
    );
    const ecdhSecret = new Uint8Array(sharedSecretBits);

    // RFC 8291 §3.3 — PRK keyed on the subscriber's auth secret, then two
    // HKDF-expand steps labelled 'key' (IKM for the content-encryption key)
    // and 'nonce', each keyed per RFC 8188 §2.1 on `salt`.
    const hkdfExtract = async (saltBytes: Uint8Array, ikm: Uint8Array, infoBytes: Uint8Array, length: number) => {
      const key = await crypto.subtle.importKey('raw', ikm, { name: 'HKDF' }, false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info: infoBytes }, key, length * 8,
      );
      return new Uint8Array(bits);
    };

    const keyInfo = concatBytes(
      new TextEncoder().encode('WebPush: info\0'), uaPublicRaw, serverPublicRaw,
    );
    const ikm = await hkdfExtract(authSecret, ecdhSecret, keyInfo, 32);

    const cekInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\0');
    const cek = await hkdfExtract(salt, ikm, cekInfo, 16);
    const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0');
    const nonce = await hkdfExtract(salt, ikm, nonceInfo, 12);

    // RFC 8188 §2 record: the delimiter octet (0x02 = "last record", no
    // padding bytes before it) appended directly after the plaintext.
    const recordPlaintext = concatBytes(plaintext, new Uint8Array([0x02]));

    const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, recordPlaintext),
    );

    // RFC 8188 §2 header: salt(16) || record-size(4, big-endian) || keyid-len(1) || keyid.
    const recordSize = ciphertext.length;
    const header = concatBytes(
      salt,
      new Uint8Array([(recordSize >>> 24) & 0xff, (recordSize >>> 16) & 0xff, (recordSize >>> 8) & 0xff, recordSize & 0xff]),
      new Uint8Array([serverPublicRaw.length]),
      serverPublicRaw,
    );
    const body = concatBytes(header, ciphertext);

    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        TTL: '86400',
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        Authorization: `vapid t=${vapid.jwt}, k=${vapid.publicKey}`,
      },
      body,
    });
    if (res.ok) return { ok: true };
    const gone = res.status === 404 || res.status === 410;
    return { ok: false, gone, status: res.status, error: `push service returned ${res.status}` };
  } catch (e: any) {
    return { ok: false, gone: false, status: 0, error: e?.message || 'send_failed' };
  }
}
