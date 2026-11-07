/**
 * #4572 follow-up — the URL guards that read only the host's name now also
 * resolve it, and every server-side fetch of a member-given URL follows
 * redirects by hand, checking each hop. A public name that points at a
 * private, loopback, link-local or metadata address is refused, and nothing is
 * fetched or connected. Synthetic hosts and addresses only.
 *
 *   publicHostRefusal  the name rules (`isSafePublicUrl`, now without the
 *                      root's trailing dot), then EVERY resolved address public
 *   publicFetch        each hop checked; the runtime never follows a redirect
 *   fetchPage          competitor pages and app links, through publicFetch
 *   imageFetch         copying an image in from a link, each hop resolved
 *   IMAP and SMTP      the host resolved before any socket opens
 *   watermark          resolved at save (Browser Rendering fetches it later)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { __setPublicResolverForTest, fetchPage, isSafePublicUrl, publicFetch, publicHostRefusal } from '../src/services/webFetch.ts';
import { fetchExternalImage } from '../src/services/decks/imageFetch.ts';
import { imapAdapter, socketDeps } from '../src/services/mail/adapters/imap.ts';
import { setStudioWatermark } from '../src/services/decks/branding.ts';
import { d1Over } from './_d1_sqlite.mjs';

const DNS: Record<string, string[]> = {
  'www.example.com': ['93.184.216.34'],
  'inside.example.com': ['10.0.0.7'],
  'meta.example.com': ['169.254.169.254'],
  'mixed.example.com': ['93.184.216.34', '127.0.0.1'],
  'v6.example.com': ['::ffff:192.168.1.1'],
  'mail.example.com': ['93.184.216.34'],
  'mail-inside.example.com': ['192.168.0.10'],
};
const resolve = async (h: string) => { if (!(h in DNS)) throw new Error('nxdomain'); return DNS[h]; };
__setPublicResolverForTest(resolve);

test('the name rules drop the root dot; then every resolved address must be public', async () => {
  // Mutation checked: publicHostRefusal returning null after the name rules (no DNS).
  assert.equal(isSafePublicUrl('https://localhost./x'), false, 'the trailing root dot is the same name');
  assert.equal(isSafePublicUrl('https://box.internal./x'), false);
  assert.equal(await publicHostRefusal('https://www.example.com/a'), null);
  for (const h of ['inside', 'meta', 'mixed', 'v6']) assert.equal(await publicHostRefusal(`https://${h}.example.com/a`), 'host_refused', h);
  assert.equal(await publicHostRefusal('https://nowhere.example.com/a'), 'host_refused', 'a name that does not resolve is refused');
  assert.equal(await publicHostRefusal('https://localhost/a'), 'unsafe_url', 'refused by name, before any lookup');
  assert.equal(await publicHostRefusal('https://93.184.216.34/a'), null, 'a public literal needs no lookup');
});

test('publicFetch follows redirects by hand and checks every hop; a private hop is never fetched', async () => {
  // Mutation checked: publicFetch passing the caller's redirect mode through (the runtime follows into the private hop).
  const asked: Array<{ url: string; redirect: unknown }> = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    asked.push({ url, redirect: init.redirect });
    if (url === 'https://www.example.com/hop') return new Response(null, { status: 302, headers: { location: 'https://inside.example.com/admin' } });
    if (url === 'https://www.example.com/loop') return new Response(null, { status: 301, headers: { location: '/loop' } });
    return new Response('<html><title>ok</title></html>', { headers: { 'content-type': 'text/html' } });
  }) as any;
  const ok = await publicFetch('https://www.example.com/a', { redirect: 'follow' }, resolve, fetcher);
  assert.equal(ok.ok, true);
  assert.equal(asked[0].redirect, 'manual', 'the runtime never follows a redirect, whatever the caller asked');
  asked.length = 0;
  assert.deepEqual(await publicFetch('https://www.example.com/hop', {}, resolve, fetcher), { ok: false, code: 'host_refused' });
  assert.deepEqual(asked.map((a) => a.url), ['https://www.example.com/hop'], 'the private hop is never fetched');
  assert.deepEqual(await publicFetch('https://www.example.com/loop', {}, resolve, fetcher), { ok: false, code: 'too_many_redirects' });
});

test('fetchPage (competitor pages, app links) refuses a public name pointing inside, and a redirect inside', async () => {
  // Mutation checked: fetchPage back on fetch(url, { redirect: "follow" }).
  const real = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = (async (url: string) => {
    asked.push(String(url));
    if (String(url) === 'https://www.example.com/moved') return new Response(null, { status: 302, headers: { location: 'https://meta.example.com/latest/meta-data' } });
    return new Response('<html><head><title>Public</title></head><body>hi</body></html>', { headers: { 'content-type': 'text/html' } });
  }) as any;
  const env: any = { DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }), run: async () => ({}) }) }) } };
  try {
    const good = await fetchPage(env, 'https://www.example.com/', { userId: 1, noCache: true });
    assert.equal(good.ok, true, JSON.stringify(good));
    const inside = await fetchPage(env, 'https://inside.example.com/', { userId: 1, noCache: true });
    assert.deepEqual([inside.ok, inside.error], [false, 'blocked_or_invalid_url']);
    const moved = await fetchPage(env, 'https://www.example.com/moved', { userId: 1, noCache: true });
    assert.deepEqual([moved.ok, moved.error], [false, 'blocked_or_invalid_url']);
    assert.ok(!asked.some((u) => u.includes('inside.example.com') || u.includes('meta.example.com')), 'neither private host was fetched');
  } finally { globalThis.fetch = real; }
});

test('copying an image in from a link resolves every hop', async () => {
  // Mutation checked: the resolver check removed from decks/imageFetch.
  const asked: string[] = [];
  const fetcher = (async (url: string) => {
    asked.push(url);
    if (url === 'https://www.example.com/hop.png') return new Response(null, { status: 302, headers: { location: 'https://mixed.example.com/x.png' } });
    return new Response(new Uint8Array(4));
  }) as any;
  assert.equal((await fetchExternalImage('https://www.example.com/a.png', 100, fetcher, 2000, resolve)).ok, true);
  assert.deepEqual(await fetchExternalImage('https://inside.example.com/a.png', 100, fetcher, 2000, resolve), { ok: false, code: 'unsafe_url' });
  assert.deepEqual(await fetchExternalImage('https://www.example.com/hop.png', 100, fetcher, 2000, resolve), { ok: false, code: 'unsafe_url' });
  assert.ok(!asked.some((u) => u.includes('inside.') || u.includes('mixed.')), 'no private host fetched');
});

test('a mailbox whose host resolves inside is refused before any socket opens', async () => {
  // Mutation checked: publicMailHost removed from the SMTP path.
  let opened = 0;
  socketDeps.connect = (() => { opened += 1; throw new Error('no socket in this test'); }) as any;
  socketDeps.timeoutMs = 500;
  const creds = (smtp: string, imap: string) => ({
    kind: 'imap', username: 'synthetic', password: 'synthetic-app-password',
    smtp_host: smtp, smtp_port: 465, smtp_tls: 'tls', imap_host: imap, imap_port: 993, imap_tls: 'tls',
  }) as any;
  try {
    // The sending host is checked first, on both entry points; the reading host goes through the same
    // publicMailHost before its own socket (a fake mail server would be needed to reach it here).
    const inside = creds('mail-inside.example.com', 'mail.example.com');
    await assert.rejects(imapAdapter.verify({} as any, inside), (e: any) => e.code === 'refused' && /public internet/.test(e.message));
    await assert.rejects(imapAdapter.send({} as any, inside, { from: 'a@example.invalid', to: 'b@example.invalid', subject: 's', text: 't' } as any),
      (e: any) => e.code === 'refused');
    assert.equal(opened, 0, 'nothing connected');
    await assert.rejects(imapAdapter.verify({} as any, creds('unknown.example.com', 'mail.example.com')), (e: any) => e.code === 'unreachable');
    assert.equal(opened, 0, 'an unresolvable host opens nothing either');
  } finally { socketDeps.connect = null; }
});

test('a watermark on a public name pointing inside is refused at save, and nothing is stored', async () => {
  // Mutation checked: the resolver check removed from setStudioWatermark.
  const db = new DatabaseSync(':memory:');
  const env: any = { DB: d1Over(db) };
  const user: any = { id: 9, subscription_tier: 'studio', role: 'founder' };
  try {
    await assert.rejects(setStudioWatermark(env, user, 'https://meta.example.com/mark.png'), /WATERMARK_HOST_NOT_PUBLIC/);
    await setStudioWatermark(env, user, 'https://www.example.com/mark.png');
    const rows = db.prepare('SELECT watermark_url FROM deck_brand_watermarks').all() as any[];
    assert.deepEqual(rows.map((r) => r.watermark_url), ['https://www.example.com/mark.png']);
  } finally { db.close(); }
});
