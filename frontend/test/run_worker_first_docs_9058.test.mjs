/**
 * #9058: the docs stop quoting a stale `run_worker_first` list.
 *
 * The list decides which responses get `frontend/public/_headers` and which
 * get the Worker's own headers. Five live documents described it as the four
 * patterns `/api/*`, `/landing/*`, `/p/*`, `/assets/*` long after
 * `wrangler.toml` grew it past twenty. The list is read from `wrangler.toml`
 * here, never copied: near each mention of `run_worker_first`, a document may
 * name a few patterns as examples (and then must point at `wrangler.toml`),
 * or quote the whole list, but not enumerate most of it, which is what a
 * closed list that has gone stale looks like.
 *
 * GOTCHAS.md (#9060) and CODEBASE_MAP.md belong to their own tasks; add them
 * to DOCS once those land.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.cwd());
const at = (p) => readFileSync(join(root, p), 'utf8');

const DOCS = [
  'documentation/architecture/PRODUCTION.md',
  'replit.md',
  'documentation/architecture/UNRESOLVED_ITEMS.md',
  'frontend/public/_headers',
  'scripts/check-spa-live.mjs',
];

/** Each `run_worker_first = [...]` array in wrangler.toml, in file order. */
function wranglerLists() {
  return [...at('wrangler.toml').matchAll(/^run_worker_first\s*=\s*\[([^\]]*)\]/gm)].map((m) =>
    [...m[1].matchAll(/"([^"]+)"/g)].map((p) => p[1]),
  );
}

/** The text around each mention, with comment markers and line breaks folded away. */
function windows(text) {
  const flat = text.replace(/^[ \t]*(?:#|\*|\/\/)[ \t]?/gm, '').replace(/\s+/g, ' ');
  return [...flat.matchAll(/run_worker_first/g)].map((m) => flat.slice(Math.max(0, m.index - 250), m.index + 350));
}

test('wrangler.toml declares one run_worker_first list, mirrored for production', () => {
  const lists = wranglerLists();
  assert.equal(lists.length, 2, 'expected [assets] and [env.production.assets] to each carry run_worker_first');
  assert.deepEqual(lists[1], lists[0], '[env.production.assets] run_worker_first must mirror [assets]');
  assert.ok(lists[0].length > 4, 'the list is longer than the four patterns the docs used to quote');
});

test('no doc enumerates most of run_worker_first as if it were the whole list', () => {
  const list = wranglerLists()[0];
  const offenders = [];
  for (const doc of DOCS) {
    for (const w of windows(at(doc))) {
      const named = list.filter((p) => w.includes(`\`${p}\``) || w.includes(`"${p}"`));
      if (named.length === list.length) continue; // quotes the whole list
      if (named.length >= 4) offenders.push(`${doc}: names ${named.length} of ${list.length} (${named.join(', ')})`);
      else if (named.length >= 2 && !w.includes('wrangler.toml')) {
        offenders.push(`${doc}: names ${named.join(', ')} without pointing at wrangler.toml`);
      }
    }
  }
  assert.deepEqual(offenders, [], `partial run_worker_first lists:\n  ${offenders.join('\n  ')}`);
});

test('each doc in scope still mentions run_worker_first, so the scan is not vacuous', () => {
  for (const doc of DOCS) assert.ok(windows(at(doc)).length > 0, `${doc} no longer mentions run_worker_first`);
});
