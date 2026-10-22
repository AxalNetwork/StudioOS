/**
 * D886 (#2582) — the notetaker's Zoom join token: an OBF ("on behalf of")
 * token minted for the founder whose Zoom connection it is, only while they
 * are in the call. All Zoom I/O is a stub; ids are invented and no token
 * here is real.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/zoom_obf_d886.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { CONNECTOR_METADATA, getDescriptor } from '../src/integrations/registry.ts';
import { hasScopeOverreach } from '../src/integrations/connectorRules.ts';
import { MEETING_ERRORS, MeetingProviderError } from '../src/services/channels/meetings.ts';
import { mintObfToken, zoomConnection } from '../src/services/channels/zoom.ts';

const BASELINE = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const MEETING = '85746065432';
const OBF = ['obf', 'fixture', 'not', 'a', 'token'].join('-');
const ACCESS = ['zoom', 'fixture', 'access'].join('-');

async function world() {
  const db = new DatabaseSync(':memory:');
  db.exec(tableFromBaseline(BASELINE, 'integrations'));
  const env: any = { DB: d1Over(db), KEK_PII: 'k'.repeat(48), ZOOM_CLIENT_ID: 'zoom-fixture-client', ZOOM_CLIENT_SECRET: 'zoom-fixture-secret' };
  const enc = await encryptCredentials(env, 'zoom-1', { access_token: ACCESS, refresh_token: 'zoom-fixture-refresh', token_type: 'bearer', expires_at: Date.now() + 3600_000 } as any);
  db.prepare(`INSERT INTO integrations (uid, user_id, provider_key, status, auth_type, credentials_enc) VALUES ('zoom-1', 2, 'zoom', 'active', 'oauth2', ?)`).run(enc);
  const conn = (await zoomConnection(env, 2))!;
  const before = JSON.stringify(db.prepare('SELECT * FROM integrations').all());
  return { db, env, conn, before };
}

/** One stubbed Zoom answer; every request is recorded, every console line is captured. */
function zoomAnswers(t: any, answer: (url: URL, init: any) => Response) {
  const calls: Array<{ url: URL; auth: string | null }> = [];
  const lines: string[] = [];
  const old = { fetch: globalThis.fetch, log: console.log, warn: console.warn, error: console.error };
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    calls.push({ url, auth: new Headers(init.headers).get('authorization') });
    return answer(url, init);
  }) as typeof fetch;
  for (const k of ['log', 'warn', 'error'] as const) (console as any)[k] = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  t.after(() => { globalThis.fetch = old.fetch; console.log = old.log; console.warn = old.warn; console.error = old.error; });
  return { calls, lines };
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
async function refusal(p: Promise<unknown>): Promise<MeetingProviderError> {
  try { await p; } catch (e) { if (e instanceof MeetingProviderError) return e; throw e; }
  throw new Error('expected a refusal');
}

test('the founder in the call: one OBF token for that meeting, from their own grant, and nothing stored or logged', async (t) => {
  // Mutations checked: the token stored on the row; the token logged; another meeting's id sent; type other than onbehalf.
  const w = await world();
  const z = zoomAnswers(t, () => json({ token: OBF }));
  assert.equal(await mintObfToken(w.env, w.conn, MEETING), OBF);
  assert.equal(z.calls.length, 1);
  const { url, auth } = z.calls[0];
  assert.equal(`${url.origin}${url.pathname}`, 'https://api.zoom.us/v2/users/me/token');
  assert.equal(url.searchParams.get('type'), 'onbehalf');
  assert.equal(url.searchParams.get('meeting_id'), MEETING);
  assert.equal(auth, `Bearer ${ACCESS}`, 'the founder\'s own grant');
  assert.equal(JSON.stringify(w.db.prepare('SELECT * FROM integrations').all()), w.before, 'nothing written');
  assert.ok(!z.lines.some((l) => l.includes(OBF)), 'never logged');
});

test('the founder not yet in the call: the notetaker waits, retryably, with the words the UI shows', async (t) => {
  // Mutations checked: a not-in-meeting answer read as a reconnect; the wait made final; the sentence changed.
  const w = await world();
  zoomAnswers(t, () => json({ code: 3001, message: 'fixture refusal' }, 400));
  const e = await refusal(mintObfToken(w.env, w.conn, MEETING));
  assert.equal(e.code, 'zoom_waiting_for_host');
  assert.equal(e.retryable, true);
  assert.equal(MEETING_ERRORS.zoom_waiting_for_host, 'Join the call first; the notetaker follows.');
  assert.ok(!e.message.includes(OBF));
});

test('a grant from before the scope asks to reconnect; a rejected grant reconnects; Zoom down retries; a bad id calls nobody', async (t) => {
  // Mutations checked: 403 read as waiting; 401 read as unreachable; 5xx made final; an empty token returned; an id unchecked.
  const w = await world();
  let status = 403;
  const z = zoomAnswers(t, () => (status === 200 ? json({ token: '  ' }) : json({ code: 4711 }, status)));
  const scope = await refusal(mintObfToken(w.env, w.conn, MEETING));
  assert.deepEqual([scope.code, scope.retryable], ['zoom_obf_scope_missing', false]);
  assert.match(MEETING_ERRORS.zoom_obf_scope_missing, /Reconnect Zoom/);
  status = 401;
  assert.deepEqual([(await refusal(mintObfToken(w.env, w.conn, MEETING))).code], ['zoom_reconnect']);
  status = 503;
  const down = await refusal(mintObfToken(w.env, w.conn, MEETING));
  assert.deepEqual([down.code, down.retryable], ['zoom_unreachable', true]);
  status = 200;
  assert.equal((await refusal(mintObfToken(w.env, w.conn, MEETING))).code, 'zoom_unreachable', 'a blank token is no token');
  const n = z.calls.length;
  for (const bad of ['', '123', '8574606543a', `${MEETING}&type=zak`]) {
    assert.equal((await refusal(mintObfToken(w.env, w.conn, bad))).code, 'zoom_meeting_invalid', bad);
  }
  assert.equal(z.calls.length, n, 'a bad id reaches no Zoom endpoint');
});

test('the registry lists user:read:token with one plain sentence, so a grant carrying it connects and one without it still does', () => {
  // Mutations checked: the scope left out (its grant refused as overreach); the sentence dropped; the page's tool missing.
  const desc = getDescriptor('zoom')!;
  assert.ok(desc.oauth_scopes!.includes('user:read:token'));
  const before = desc.oauth_scopes!.filter((s) => s !== 'user:read:token');
  assert.equal(hasScopeOverreach(desc, [...before, 'user:read:token']), false, 'the new grant is accepted');
  assert.equal(hasScopeOverreach(desc, before), false, 'an older grant still connects');
  assert.equal(CONNECTOR_METADATA.zoom.permissions.length, desc.oauth_scopes!.length);
  assert.ok(CONNECTOR_METADATA.zoom.permissions.some((p) => /notetaker join a call on your behalf, only while you are in it/.test(p)));
  const page = readFileSync('cloudflare-worker/src/integrations/connectorPages.ts', 'utf8');
  assert.match(page, /tool\('notetaker_join_token'/);
});
