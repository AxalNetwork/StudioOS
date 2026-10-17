/**
 * D710 (#1775) — the guard: no code can move money through Mercury.
 *
 *  - A recording fetch drives every export of `services/mercury/client.ts`
 *    and sees only GET, only allowlisted read paths, only `redirect: 'manual'`,
 *    and a 302 is an error that is not followed.
 *  - The client's source has no method but GET and no request body, and names
 *    none of Mercury's money-movement, recipient, webhook or token paths.
 *  - Across the Worker and the SPA, only the client names Mercury's API host,
 *    and nothing names a send-money or transfer-money act.
 *  - No `admin_mercury.ts` path sends, transfers, pays or wires.
 *  - The MCP server and Eadwyn's connectors name no `mercury_` table, and only
 *    decision 11's files import `services/mercury/store.ts`.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/mercury_read_only_d710.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import * as client from '../src/services/mercury/client.ts';

const ROOT = process.cwd();
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const CLIENT = 'cloudflare-worker/src/services/mercury/client.ts';
const HOST = 'api.mercury.com';

/** Mercury's paths that move money, name recipients, or manage webhooks and tokens (D710.md). */
export const DENIED_PATHS = ['/send-money', '/request-send-money', '/transfer', '/internal-transfer', '/recipients', '/recipient',
  '/webhooks', '/webhook', '/api-tokens', '/tokens', '/categories', '/note', '/approve'];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(p);
  }
  return out;
}
const SOURCES = [...walk(resolve(ROOT, 'cloudflare-worker/src')), ...walk(resolve(ROOT, 'frontend/src'))]
  .map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, 'utf8') }));

test('every client export sends only GET, to an allowlisted path, with redirect manual; a 302 is refused, not followed', async () => {
  const calls = [];
  let status = 200;
  const fetcher = async (url, init = {}) => {
    calls.push({ url, method: String(init.method || ''), redirect: init.redirect, body: init.body });
    return status === 200 ? Response.json({ accounts: [], transactions: [] }) : new Response('', { status, headers: { Location: 'https://elsewhere.example/' } });
  };
  await client.listAccounts('fixture-not-a-token-1', fetcher);
  await client.getOrganization('fixture-not-a-token-1', fetcher);
  await client.listTransactions('fixture-not-a-token-1', 'acc-1', { start: '2026-01-01', limit: 10, offset: 0 }, fetcher);
  const exported = Object.entries(client).filter(([, v]) => typeof v === 'function' && !/^[A-Z]/.test(v.name)).map(([k]) => k).sort();
  assert.deepEqual(exported, ['getOrganization', 'isReadPath', 'listAccounts', 'listTransactions'], 'a new export must be driven here');
  assert.equal(calls.length, 3);
  for (const c of calls) {
    assert.equal(c.method, 'GET');
    assert.equal(c.redirect, 'manual');
    assert.equal(c.body, undefined);
    const u = new URL(c.url);
    assert.equal(u.host, HOST);
    assert.ok(client.isReadPath(u.pathname.replace(/^\/api\/v1/, '')), u.pathname);
  }
  status = 302;
  await assert.rejects(() => client.listAccounts('fixture-not-a-token-1', fetcher), (e) => e.code === 'redirect_refused');
  assert.equal(calls.length, 4, 'the redirect was not followed');
  await assert.rejects(() => client.listTransactions('t', '../send-money', { start: '2026-01-01', limit: 1, offset: 0 }, fetcher), (e) => e.code === 'path_not_allowed');
  for (const p of DENIED_PATHS) assert.equal(client.isReadPath(p), false, p);
});

test('the client\'s source has no method but GET, no body, and no money-movement, recipient, webhook or token path', () => {
  const code = codeOnly(read(CLIENT));
  const methods = [...code.matchAll(/method\s*:\s*([^,}\n]+)/g)].map((m) => m[1].trim());
  assert.deepEqual(methods, ["'GET'"]);
  assert.doesNotMatch(code, /\bbody\s*:/);
  assert.doesNotMatch(code, /\b(POST|PUT|PATCH|DELETE)\b/);
  for (const p of DENIED_PATHS) assert.ok(!code.includes(`'${p}`) && !code.includes(`\`${p}`), p);
  assert.ok(read('documentation/architecture/decisions/D710.md').includes('/send-money'), 'D710.md lists the denied paths');
});

test('only the client names Mercury\'s API host, and no file names a send-money or transfer-money act', () => {
  const host = SOURCES.filter((s) => s.text.includes(HOST)).map((s) => s.path);
  assert.deepEqual(host, [CLIENT]);
  const acts = /send-money|sendMoney|transfer-money|requestSendMoney|requestTransferMoney/;
  assert.deepEqual(SOURCES.filter((s) => acts.test(s.text)).map((s) => s.path), []);
});

test('no admin_mercury.ts path sends, transfers, pays, pays out or wires', () => {
  const src = read('cloudflare-worker/src/routes/admin_mercury.ts');
  const paths = [...src.matchAll(/r\.(get|post|put|patch|delete)\('([^']+)'/g)].map((m) => m[2]);
  assert.ok(paths.length >= 10, 'the routes were found');
  for (const p of paths) assert.doesNotMatch(p, /send|transfer|pay|payout|wire/i, p);
});

test('the MCP server and Eadwyn read no Mercury table, and only decision 11\'s files import the store', () => {
  const mcp = SOURCES.filter((s) => s.path.startsWith('cloudflare-worker/src/mcp/') || s.path === 'cloudflare-worker/src/services/eadwynConnectors.ts');
  assert.ok(mcp.length > 1);
  for (const s of mcp) assert.doesNotMatch(s.text, /mercury_/, s.path);
  const importers = SOURCES.filter((s) => /from\s+['"][^'"]*mercury\/store['"]|import\(['"][^'"]*mercury\/store['"]\)/.test(s.text)).map((s) => s.path).sort();
  const allowed = (p) => p === 'cloudflare-worker/src/routes/admin_mercury.ts' || p.startsWith('cloudflare-worker/src/services/mercury/') || p === 'cloudflare-worker/src/index.ts';
  assert.deepEqual(importers.filter((p) => !allowed(p)), []);
  assert.ok(importers.includes('cloudflare-worker/src/routes/admin_mercury.ts'));
});
