// D4106 — every listing of the migrations folder sorts in apply order.
//
// A stamped migration (`YYYYMMDDHHMM_<slug>.sql`) sorts after every numbered
// file by number (`compareMigrations`), but before them as a string ('2…' <
// '7…'). A fixture or guard that lists the folder with a plain `.sort()` runs
// a stamped migration before the tables it alters, and fails with "no such
// table". This file fails on any `readdirSync(…)` chain over `.sql` files
// whose `.sort()` names no comparator, and on `compareMigrations` itself
// putting a stamped name first.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/migration_apply_order_d4106.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const DIRS = ['cloudflare-worker/test', 'frontend/test', 'scripts'];

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'node_modules') out.push(...files(p)); }
    else if (/\.(mjs|ts|js)$/.test(name)) out.push(p);
  }
  return out;
}

test('compareMigrations puts a stamped migration after every numbered one', () => {
  // Mutation checked: compareMigrations replaced by a string compare → this fails.
  const names = ['202611021724_x.sql', '712_team_agents.sql', '011_a.sql', '763_z.sql'];
  assert.deepEqual([...names].sort(compareMigrations), ['011_a.sql', '712_team_agents.sql', '763_z.sql', '202611021724_x.sql']);
  assert.notDeepEqual([...names].sort(), [...names].sort(compareMigrations), 'a plain sort really is the wrong order');
});

test('no test or guard lists the migrations folder with a plain .sort()', () => {
  // Mutation checked: one fixture's `.sort(compareMigrations)` put back to `.sort()` → this names that file.
  const bad: string[] = [];
  for (const p of DIRS.flatMap((d) => files(resolve(ROOT, d)))) {
    const lines = readFileSync(p, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!line.includes('readdirSync')) return;
      const chain = [line, ...lines.slice(i + 1, i + 4).filter((l) => l.trimStart().startsWith('.'))].join(' ');
      if (chain.includes('.sql') && /\.sort\(\s*\)/.test(chain)) bad.push(`${relative(ROOT, p)}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, [], `sort these with compareMigrations (scripts/lib/migrationPlan.mjs):\n${bad.join('\n')}`);
});
