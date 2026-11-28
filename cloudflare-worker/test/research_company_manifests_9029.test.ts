/**
 * D7828 / #9029: every committed company-facts manifest in data/research-companies/ is checked in CI.
 *
 * For each manifest this runs the compiler's own --check (scripts/import-company-facts.mjs) against
 * the one committed migration that names it, and shows each company uid it cites is inserted by a
 * committed research_company_directory migration. It also refuses a compiled company-facts
 * migration whose manifest is not committed. The harness is exercised on the invented #7828 fixture
 * in a temporary folder, so it is shown to catch a stale file before a real manifest lands.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/research_company_manifests_9029.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// @ts-ignore — a plain ES module script
import { MARKER } from '../../scripts/import-company-facts.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DATA = join(ROOT, 'data/research-companies');
const MIGRATIONS = join(ROOT, 'cloudflare-worker/sql/migrations');
const SCRIPT = join(ROOT, 'scripts/import-company-facts.mjs');
const FIX = fileURLToPath(new URL('./fixtures/', import.meta.url));

const DIRECTORY_ROW = /INTO research_company_directory\s*\([^)]*\)\s*(?:VALUES\s*\(|SELECT\s+)'([^']+)'/g;
const NAMED = /^-- D7828 \(#7828\): compiled by scripts\/import-company-facts\.mjs from the reviewed manifest "([^"]+)"\.$/m;

/** Every company uid a committed directory migration inserts. */
function directoryUids(dir: string): Set<string> {
  const uids = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
    const text = readFileSync(join(dir, file), 'utf8');
    if (!text.includes('research_company_directory')) continue;
    for (const m of text.matchAll(DIRECTORY_ROW)) uids.add(m[1]);
  }
  return uids;
}

/** Compiled company-facts migrations, keyed by the manifest name in their header. */
function compiledFiles(dir: string): Map<string, string[]> {
  const byName = new Map<string, string[]>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
    const text = readFileSync(join(dir, file), 'utf8');
    if (!text.startsWith(MARKER)) continue;
    const name = text.match(NAMED)?.[1] ?? '';
    byName.set(name, [...(byName.get(name) ?? []), file]);
  }
  return byName;
}

/** The problems with one data folder against one migrations folder; an empty list passes. */
function checkManifests(dataDir: string, migrationsDir: string): string[] {
  const problems: string[] = [];
  const manifests = existsSync(dataDir) ? readdirSync(dataDir).filter((f) => f.endsWith('.json')).sort() : [];
  const compiled = compiledFiles(migrationsDir);
  const uids = directoryUids(migrationsDir);
  const names = new Set<string>();
  for (const file of manifests) {
    const manifest = JSON.parse(readFileSync(join(dataDir, file), 'utf8'));
    names.add(manifest.name);
    const out = compiled.get(manifest.name) ?? [];
    if (out.length !== 1) {
      problems.push(`${file}: ${out.length} compiled migrations name manifest ${JSON.stringify(manifest.name)}, expected 1`);
      continue;
    }
    const r = spawnSync(
      process.execPath,
      [SCRIPT, '--manifest', join(dataDir, file), '--out', join(migrationsDir, out[0]), '--ledger', migrationsDir, '--check'],
      { encoding: 'utf8' },
    );
    if (r.status !== 0) problems.push(`${file}: --check exited ${r.status}: ${(r.stderr || r.stdout).trim()}`);
    for (const uid of new Set<string>(manifest.facts.map((f: { company_uid: string }) => f.company_uid)))
      if (!uids.has(uid)) problems.push(`${file}: company uid ${uid} is in no committed directory migration`);
  }
  for (const [name, files] of compiled)
    if (!names.has(name)) problems.push(`${files.join(', ')}: compiled from manifest ${JSON.stringify(name)}, which data/research-companies/ does not hold`);
  return problems;
}

test('every committed company-facts manifest compiles to its committed migration and cites directory uids', () => {
  assert.deepEqual(checkManifests(DATA, MIGRATIONS), []);
});

test('the data folder explains itself and cites the passage cap by name', () => {
  const readme = readFileSync(join(DATA, 'README.md'), 'utf8');
  assert.match(readme, /FACT_PASSAGE_MAX/);
  assert.match(readFileSync(join(ROOT, 'data/README.md'), 'utf8'), /`research-companies\/`/);
});

// The harness on the invented #7828 fixture, in a temporary repository layout.
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'company-manifests-9029-'));
  const data = join(dir, 'data');
  const migrations = join(dir, 'migrations');
  mkdirSync(data);
  mkdirSync(migrations);
  copyFileSync(join(FIX, 'company_facts_7828_manifest.json'), join(data, 'fixture.json'));
  copyFileSync(join(FIX, 'company_facts_7828_compiled.sql'), join(migrations, '202611270000_9029_fixture.sql'));
  const uids = new Set<string>(
    JSON.parse(readFileSync(join(data, 'fixture.json'), 'utf8')).facts.map((f: { company_uid: string }) => f.company_uid),
  );
  // Both row forms the committed directory migrations use: VALUES (228, 403) and SELECT (405).
  writeFileSync(
    join(migrations, '001_directory.sql'),
    [...uids]
      .map((uid, i) =>
        i === 0
          ? `INSERT OR IGNORE INTO research_company_directory (uid, name, website, source_url, as_of) SELECT '${uid}', 'n', '', 'https://a.example', '2026-10-01' WHERE 1;`
          : `INSERT OR IGNORE INTO research_company_directory (uid,name,website,source_url,as_of) VALUES ('${uid}','n','https://a.example','https://a.example','2026-10-01');`,
      )
      .join('\n'),
  );
  return { dir, data, migrations };
}

test('harness: the fixture passes when its migration and directory rows are committed', () => {
  const s = sandbox();
  try {
    assert.deepEqual(checkManifests(s.data, s.migrations), []);
  } finally {
    rmSync(s.dir, { recursive: true, force: true });
  }
});

test('harness: a hand-edited compiled file fails the compiler check', () => {
  const s = sandbox();
  try {
    const path = join(s.migrations, '202611270000_9029_fixture.sql');
    writeFileSync(path, readFileSync(path, 'utf8').replace('Route planning', 'Route-planning'));
    const problems = checkManifests(s.data, s.migrations);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /^fixture\.json: --check exited 1: .*is not what .* compiles to/);
  } finally {
    rmSync(s.dir, { recursive: true, force: true });
  }
});

test('harness: a uid no directory migration inserts is named', () => {
  const s = sandbox();
  try {
    writeFileSync(join(s.migrations, '001_directory.sql'), '');
    const problems = checkManifests(s.data, s.migrations);
    assert.ok(problems.includes('fixture.json: company uid synthetic-7828-brindlemoor is in no committed directory migration'), problems.join('\n'));
  } finally {
    rmSync(s.dir, { recursive: true, force: true });
  }
});

test('harness: a manifest with no compiled migration, and a migration with no manifest, both fail', () => {
  const s = sandbox();
  try {
    rmSync(join(s.migrations, '202611270000_9029_fixture.sql'));
    assert.deepEqual(checkManifests(s.data, s.migrations), [
      'fixture.json: 0 compiled migrations name manifest "fixture-7828", expected 1',
    ]);
    const t = sandbox();
    try {
      rmSync(join(t.data, 'fixture.json'));
      assert.deepEqual(checkManifests(t.data, t.migrations), [
        '202611270000_9029_fixture.sql: compiled from manifest "fixture-7828", which data/research-companies/ does not hold',
      ]);
    } finally {
      rmSync(t.dir, { recursive: true, force: true });
    }
  } finally {
    rmSync(s.dir, { recursive: true, force: true });
  }
});
