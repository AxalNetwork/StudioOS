/**
 * D1169 — the storage read's tests run on the actual migrated schema: the
 * baseline, then every later migration, replayed once into a template file.
 * Each case copies that file, so the DDL is not re-run per case.
 *
 * From cloudflare-worker/test/README.md (moved by #6472): #4567 (D4567): `_d1_bench.ts` is the D1
 * contention benchmark's harness. It meters every statement the Worker's own services issue over
 * `_storage_schema.ts`'s migrated template, seeded with #4566's synthetic fixtures and with
 * inference stubbed. It drives mixes A–E, closed loop or ramp, and checks the invariants
 * afterwards. `d1_benchmark_4567.test.ts` is its tiny, deterministic CI case; `npm run bench:d1`
 * runs it at scale.
 *
 * From cloudflare-worker/test/README.md (moved by #6472): D1169: `usage_storage_d1169.test.ts`
 * holds the grown storage read: thirteen member stores, company files counted to the company
 * owner, kinds, companies, the ten largest files, the allowance and its state, and that fund,
 * legal, identity, 83(b) and HQ stores are never read. It and `usage_storage_d642.test.ts` run on
 * `_storage_schema.ts`, which replays the baseline and every later migration once into a template
 * database and copies it for each case. Rows are synthetic.
 */
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadSchema } from './_schema_once.mjs';

const OPTIONS = { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true } as const;
let templatePath: string | null = null;
let workdir: string | null = null;
let count = 0;

function template(): string {
  if (templatePath) return templatePath;
  const build = new DatabaseSync(':memory:', OPTIONS);
  loadSchema(build);
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
