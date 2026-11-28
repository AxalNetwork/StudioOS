/**
 * #9056 — the release rehearsal and the path-triggered `*-contracts.yml` workflows cache npm.
 *
 *   · every job in those workflows that runs `npm ci` sets up Node with `cache: npm`, keyed only on
 *     lockfiles that job installs (root `package-lock.json` for a bare `npm ci`,
 *     `<dir>/package-lock.json` for `--prefix <dir>`);
 *   · in the three workflows #9056 edits (EXACT), the key names every lockfile the job installs, so an
 *     install the key does not cover fails. The older siblings key on the Worker lockfile alone, which
 *     still restores the shared npm store; #9056 does not widen them.
 *
 * Other workflows are out of scope: several (deploys, images, drills) install without a cache on purpose.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/workflow_npm_cache_9056.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parse } from 'yaml';

const DIR = new URL('../../.github/workflows/', import.meta.url);
const SCOPE = readdirSync(DIR).filter((f) => /-contracts\.ya?ml$/.test(f) || f === 'release-rehearsal.yml').sort();
const SRC = Object.fromEntries(SCOPE.map((f) => [f, readFileSync(new URL(f, DIR), 'utf8')]));
/** The workflows whose cache key must name every lockfile their jobs install. */
export const EXACT = new Set(['release-rehearsal.yml', 'form-lightbox-contracts.yml', 'record-page-contracts.yml']);

/** The lockfiles a job's `npm ci` commands install, sorted. */
export function installedLockfiles(job) {
  const out = new Set();
  for (const step of job.steps ?? []) {
    for (const m of String(step.run ?? '').matchAll(/\bnpm ci\b([^\n&;|]*)/g)) {
      const prefix = /--prefix[ =](\S+)/.exec(m[1]);
      out.add(prefix ? `${prefix[1].replace(/\/$/, '')}/package-lock.json` : 'package-lock.json');
    }
  }
  return [...out].sort();
}

export function problems(src) {
  const out = [];
  for (const [file, text] of Object.entries(src)) {
    for (const [id, job] of Object.entries(parse(text).jobs ?? {})) {
      const want = installedLockfiles(job);
      if (!want.length) continue;
      const nodes = (job.steps ?? []).filter((s) => /^actions\/setup-node@/.test(s.uses ?? ''));
      if (!nodes.length) out.push(`${file}: job ${id} runs npm ci with no setup-node step`);
      for (const node of nodes) {
        if (node.with?.cache !== 'npm') { out.push(`${file}: job ${id} sets up Node without cache: npm`); continue; }
        const have = String(node.with['cache-dependency-path'] ?? '').split('\n').map((s) => s.trim()).filter(Boolean).sort();
        const stray = have.filter((l) => !want.includes(l));
        const missing = EXACT.has(file) ? want.filter((l) => !have.includes(l)) : [];
        if (!have.length || stray.length || missing.length) {
          out.push(`${file}: job ${id} caches [${have.join(', ')}] but installs [${want.join(', ')}]`);
        }
      }
    }
  }
  return out;
}

test('#9056: the release rehearsal and every *-contracts workflow cache npm on the lockfiles they install', () => {
  for (const f of ['release-rehearsal.yml', 'form-lightbox-contracts.yml', 'record-page-contracts.yml', 'channel-worker-contracts.yml']) {
    assert.ok(SRC[f], `${f} is in scope`);
  }
  assert.deepEqual(problems(SRC), []);
});

test('#9056: the reader finds each install the issue names', () => {
  const jobs = (f) => parse(SRC[f]).jobs;
  assert.deepEqual(installedLockfiles(jobs('release-rehearsal.yml').rehearse), ['cloudflare-worker/package-lock.json', 'frontend/package-lock.json']);
  assert.deepEqual(installedLockfiles(jobs('release-rehearsal.yml')['release-window']), ['cloudflare-worker/package-lock.json']);
  for (const f of ['form-lightbox-contracts.yml', 'record-page-contracts.yml']) {
    assert.deepEqual(installedLockfiles(jobs(f).contracts), ['cloudflare-worker/package-lock.json', 'frontend/package-lock.json', 'package-lock.json'], f);
  }
});

test('#9056: the guard refuses each way back to an uncached or mis-keyed install', () => {
  const mutate = (file, from, to) => {
    assert.ok(SRC[file].includes(from), `${file} no longer holds: ${from}`);
    return { ...SRC, [file]: SRC[file].replace(from, to) };
  };
  const refused = (src, pattern) => assert.ok(problems(src).some((p) => pattern.test(p)), `not refused: ${pattern}`);
  refused(mutate('release-rehearsal.yml', '          cache: npm\n', ''), /release-rehearsal\.yml: job rehearse sets up Node without cache: npm/);
  refused(mutate('release-rehearsal.yml', '            frontend/package-lock.json\n', ''), /release-rehearsal\.yml: job rehearse caches \[cloudflare-worker\/package-lock\.json\] but installs/);
  refused(mutate('form-lightbox-contracts.yml', '            package-lock.json\n', ''), /form-lightbox-contracts\.yml: job contracts caches .* but installs/);
  refused(mutate('record-page-contracts.yml', '          npm ci --no-audit --no-fund\n', '          npm ci --no-audit --no-fund\n          npm ci --prefix meeting-bot --no-audit --no-fund\n'), /record-page-contracts\.yml: job contracts caches .* but installs \[.*meeting-bot\/package-lock\.json/);
  refused(mutate('record-page-contracts.yml', '      - uses: actions/setup-node@', '      - uses: actions/setup-python@'), /record-page-contracts\.yml: job contracts runs npm ci with no setup-node step/);
  // A sibling keyed on a lockfile it never installs; a sibling with no cache at all.
  refused(mutate('channel-worker-contracts.yml', '          cache-dependency-path: cloudflare-worker/package-lock.json\n', '          cache-dependency-path: meeting-bot/package-lock.json\n'), /channel-worker-contracts\.yml: job contracts caches \[meeting-bot\/package-lock\.json\]/);
  refused(mutate('channel-worker-contracts.yml', '          cache: npm\n', ''), /channel-worker-contracts\.yml: job contracts sets up Node without cache: npm/);
});
