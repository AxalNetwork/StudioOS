#!/usr/bin/env node
/** D5608 — deterministic commit-level dependency and timing artifacts. */
import { globSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LISTS = ['reads', 'directories', 'modules', 'sqlite', 'children'];
const EXPECTED = [
  'frontend/test/*.test.mjs',
  'cloudflare-worker/test/*.test.{ts,mjs}',
  'meeting-bot/test/*.test.ts',
  'scripts/lib/*.test.mjs',
];

function unique(items) {
  return [...new Set(items)].sort();
}

export function mergeTraces(records, expected, { sha, node }) {
  const byTest = new Map();
  for (const record of records) {
    if (!byTest.has(record.test)) byTest.set(record.test, []);
    byTest.get(record.test).push(record);
  }

  const deps = [];
  const timings = [];
  const rooted = new Set();
  for (const test of [...byTest.keys()].sort()) {
    const group = byTest.get(test);
    const roots = group.filter((row) => row.isTest);
    if (roots.length) rooted.add(test);
    deps.push([test, {
      ...Object.fromEntries(LISTS.map((key) => [key, unique(group.flatMap((row) => row[key]))])),
      probes: {
        hits: unique(group.flatMap((row) => row.probes.hits)),
        misses: unique(group.flatMap((row) => row.probes.misses)),
      },
      opaque: !roots.length || group.some((row) => row.opaque),
    }]);
    if (roots.length) {
      timings.push([test, {
        wallMs: Math.max(...roots.map((row) => row.wallMs)),
        exitCode: Math.max(...roots.map((row) => row.exitCode)),
      }]);
    }
  }
  const untraced = unique(expected.filter((path) => !rooted.has(path)));
  return {
    dependencies: { sha, node, tests: Object.fromEntries(deps) },
    timings: { sha, node, tests: Object.fromEntries(timings), untraced },
  };
}

function valid(row) {
  return row && typeof row.test === 'string' && typeof row.isTest === 'boolean' &&
    Number.isFinite(row.wallMs) && Number.isInteger(row.exitCode) &&
    [...LISTS.map((key) => row[key]), row.probes?.hits, row.probes?.misses]
      .every((list) => Array.isArray(list) && list.every((item) => typeof item === 'string'));
}

function main(args) {
  const [input, output, sha, ...rest] = args;
  if (!input || !output || !/^[a-f0-9]{40}$/.test(sha ?? '') || rest.length) {
    throw new Error('Usage: node scripts/ci/merge-test-deps.mjs <trace-directory> <output-directory> <sha>');
  }
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const records = [];
  let invalid = 0;
  for (const entry of readdirSync(input, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.trace.json')) continue;
    try {
      const row = JSON.parse(readFileSync(join(entry.parentPath, entry.name), 'utf8'));
      if (!valid(row)) throw new Error('Invalid trace.');
      records.push(row);
    } catch { invalid += 1; }
  }
  const expected = globSync(EXPECTED, { cwd: root });
  const { dependencies, timings } = mergeTraces(records, expected, { sha, node: process.version });
  mkdirSync(output, { recursive: true });
  for (const [name, data] of [['test-deps.json', dependencies], ['test-timings.json', timings]]) {
    writeFileSync(join(output, name), `${JSON.stringify(data, null, 2)}\n`);
  }
  const opaque = Object.values(dependencies.tests).filter((row) => row.opaque).length;
  console.log(`Trace: ${Object.keys(timings.tests).length} tests recorded, ${opaque} opaque, ${timings.untraced.length} untraced, ${invalid} invalid process records.`);
  if (timings.untraced.length) console.log(`Untraced tests:\n${timings.untraced.join('\n')}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    console.error(`merge-test-deps: ${error.message}`);
    process.exitCode = 1;
  }
}
