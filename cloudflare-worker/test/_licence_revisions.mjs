/**
 * D4694 — the revision columns, read from their migration instead of copied
 * into each fixture, so a column renamed there breaks the suites that use it.
 *
 *   db.exec(licenceRevisionAlters('territory_licences', 'licence_terms'));
 *
 * returns only the ALTER statements for the named tables, because a fixture
 * builds only the tables it needs.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const file = readdirSync(dir).find((f) => /^\d{12}_licence_revisions\.sql$/.test(f));
if (!file) throw new Error('the licence revisions migration (YYYYMMDDHHMM_licence_revisions.sql) is missing');
export const REVISION_MIGRATION = readFileSync(resolve(dir, file), 'utf8');

export function licenceRevisionAlters(...tables) {
  return REVISION_MIGRATION.split('\n')
    .filter((l) => /^ALTER TABLE /.test(l) && tables.some((t) => l.startsWith(`ALTER TABLE ${t} `)))
    .join('\n');
}
