/**
 * D1169 — the storage read's tests run on the actual migrated schema: the
 * baseline, then every later migration, replayed once into a template file.
 * Each case copies that file, so the DDL is not re-run per case.
 */
import { readFileSync, readdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const ROOT = new URL('../sql/', import.meta.url);
const OPTIONS = { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true } as const;
let templatePath: string | null = null;
let workdir: string | null = null;
let count = 0;

function template(): string {
  if (templatePath) return templatePath;
  const build = new DatabaseSync(':memory:', OPTIONS);
  build.exec(readFileSync(new URL('schema_baseline.sql', ROOT), 'utf8'));
  for (const name of readdirSync(new URL('migrations/', ROOT)).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort(compareMigrations)) {
    build.exec(readFileSync(new URL('migrations/' + name, ROOT), 'utf8'));
  }
  const ddl = build.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END")
    .all().map((x: any) => String(x.sql));
  build.close();
  workdir = mkdtempSync(join(tmpdir(), 'storage-read-test-'));
  templatePath = join(workdir, 'template.sqlite');
  const db = new DatabaseSync(templatePath, OPTIONS);
  for (const sql of ddl) db.exec(sql);
  db.close();
  return templatePath;
}

/** A fresh database with every table and index production has. */
export function migratedDatabase(): DatabaseSync {
  const path = join(workdir ?? (template(), workdir!), `case-${++count}.sqlite`);
  copyFileSync(template(), path);
  return new DatabaseSync(path, OPTIONS);
}

/** The template itself, read-only, for query plans. */
export function migratedTemplate(): DatabaseSync {
  return new DatabaseSync(template(), { readOnly: true });
}

export function removeMigratedDatabases(): void {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
  workdir = null; templatePath = null;
}
