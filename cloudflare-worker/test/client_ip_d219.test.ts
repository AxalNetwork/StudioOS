/**
 * D219 — one definition of the client address.
 *
 * Cloudflare appends to an incoming X-Forwarded-For, so its first hop is
 * whatever the client sent. CF-Connecting-IP is set by Cloudflare. The
 * cofounder NDA path used to prefer the first, and stored it as signature
 * evidence.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/client_ip_d219.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { clientIp } from '../src/util/clientIp.ts';

const SRC = resolve(fileURLToPath(new URL('../src', import.meta.url)));

function req(headers: Record<string, string>): Request {
  return new Request('https://axal.vc/', { headers });
}

/** Drop // and block comments so a comment that names the old function does not count. */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const a = src[i];
    const b = src[i + 1];
    if (a === '/' && b === '/') {
      i += 2;
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (a === '/' && b === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i = Math.min(src.length, i + 2);
      continue;
    }
    out += a;
    i += 1;
  }
  return out;
}

const FUNCTION_DECL = /\bfunction\s+clientIp\s*\(/;
const ARROW_DECL = /\bclientIp\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>/;

function tsFiles(dir: string, acc: string[] = []): string[] {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) tsFiles(p, acc);
    else if (ent.name.endsWith('.ts')) acc.push(p);
  }
  return acc;
}

test('cf-connecting-ip wins over a client-supplied x-forwarded-for', () => {
  const ip = clientIp(req({
    'cf-connecting-ip': '1.2.3.4',
    'x-forwarded-for': '6.6.6.6',
  }));
  assert.equal(ip, '1.2.3.4');
});

test('with no CF header, the first XFF hop is trimmed', () => {
  assert.equal(clientIp(req({ 'x-forwarded-for': ' 9.9.9.9 , 10.0.0.1' })), '9.9.9.9');
});

test('neither header, or a whitespace-only XFF, is unknown', () => {
  assert.equal(clientIp(req({})), 'unknown');
  assert.equal(clientIp(req({ 'x-forwarded-for': '   ' })), 'unknown');
  assert.equal(clientIp(req({ 'x-forwarded-for': '  , 10.0.0.1' })), 'unknown');
});

test('a 100-character header value comes back 64 characters long', () => {
  const value = 'a'.repeat(100);
  const ip = clientIp(req({ 'cf-connecting-ip': value }));
  assert.equal(ip.length, 64);
  assert.equal(ip, value.slice(0, 64));
});

test('clientIp is declared in util/clientIp.ts and nowhere else', () => {
  const offenders: string[] = [];
  let helperDeclares = false;
  for (const file of tsFiles(SRC)) {
    const rel = relative(SRC, file).split('\\').join('/');
    const raw = readFileSync(file, 'utf8');
    const stripped = stripComments(raw);
    const declares = FUNCTION_DECL.test(stripped) || ARROW_DECL.test(stripped);
    if (rel === 'util/clientIp.ts') {
      helperDeclares = declares;
      continue;
    }
    if (declares) offenders.push(rel);
  }
  assert.equal(helperDeclares, true, 'util/clientIp.ts must declare function clientIp');
  assert.deepEqual(offenders, []);

  // The cofounder file still NAMES the old declaration, inside a comment.
  // A guard that forgot to strip comments would report it as a second definition.
  const cofounder = readFileSync(join(SRC, 'routes/cofounder.ts'), 'utf8');
  assert.match(cofounder, /function clientIp\s*\(/);
  assert.equal(FUNCTION_DECL.test(stripComments(cofounder)), false);
});
