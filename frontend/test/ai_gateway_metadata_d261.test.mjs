/**
 * D261 — the AI Gateway learns whose call it is, and every sentence that said
 * it could not now says exactly which calls carry what.
 *
 * The router half (the metadata on the option, the zero-id rule, the bypass
 * retry, onboarding left alone) is driven through `run()` in
 * cloudflare-worker/test/aiRouter.bugfix.test.ts; the topology payload and the
 * two pages that render it are held by topology_d209.test.ts and
 * topology_h14_s14.test.mjs. This file holds the four "not recorded" reasons
 * that leaned on the old fact: each still says the figure is absent, now for
 * the true reason, and none claims more calls than the router gateways.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/ai_gateway_metadata_d261.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { GATEWAY_TASKS } from '../../cloudflare-worker/src/services/aiRouter.ts';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const WORD = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];
const COUNT = WORD[GATEWAY_TASKS.length];

/** The four reasons, each with what it must still say is absent. */
const REASONS = [
  ['cloudflare-worker/src/routes/admin_hq.ts', /spend cannot be split by branch here/],
  ['cloudflare-worker/src/routes/branch_home.ts', /there is no per-branch AI cost/],
  ['frontend/src/pages/branch/BranchApprovals.jsx', /There is no per-branch AI cost figure/],
  ['frontend/src/pages/hq/HqHomePage.jsx', /nothing meters AI spend per tenant yet/],
];

test('D261: the four "not recorded" reasons name the gatewayed task classes by their true count, and still say the figure is absent', () => {
  assert.ok(COUNT, `GATEWAY_TASKS has ${GATEWAY_TASKS.length} entries; the word list does not reach it`);
  // Source text joins string concatenations the way the reader sees them.
  for (const [file, absent] of REASONS) {
    const src = raw(file).replace(/'\s*\n\s*\+\s*'/g, '');
    const count = new RegExp(`Eadwyn(?:\\\\'|’|')s ${COUNT} gatewayed task classes`);
    assert.match(src, count, `${file} does not say ${COUNT} gatewayed task classes carry the metadata`);
    assert.match(src, /\(D261\)/, `${file} does not cite D261`);
    assert.match(src, absent, `${file} no longer says the figure is absent`);
  }
});

test('D261: no source still says no call carries metadata, or that every call does', () => {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : /\.(jsx?|tsx?)$/.test(e.name) ? [join(d, e.name)] : []);
  const STALE = [
    /carry no branch metadata/,
    /gateway metadata that is\s*'\s*\+\s*'not being written|metadata that is not being written/,
    /the gateway metadata that would produce one is not wired/,
    /Needs per-branch metadata on every model call/,
    /Each call carries metadata naming who made it/,
    /Each model call carries metadata naming this branch/,
    /AI Gateway metadata per branch \(none is sent\)/,
  ];
  for (const f of [...walk(resolve(process.cwd(), 'frontend/src')), ...walk(resolve(process.cwd(), 'cloudflare-worker/src'))]) {
    const src = readFileSync(f, 'utf8');
    for (const re of STALE) assert.doesNotMatch(src, re, `${f} still says ${re}`);
  }
});
