/**
 * D1103 (#2983) — migration 594 for a test database: a grant's folder scope
 * (`data_room_grant_folders`) and its flag (`data_room_grants.folders_scoped`).
 * Every investor read now passes its grant's scope to `tierAdmits`, and a
 * scope that cannot be read opens nothing, so a fixture with data-room grants
 * applies this after it has made `data_room_grants`.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripForeignKeys, addColumnsFrom } from './_baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const MIG594 = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/migrations/594_data_room_grant_folders.sql'), 'utf8');

export function withGrantFolders(db) {
  const sql = stripForeignKeys(MIG594);
  db.exec(sql.split('\n').filter((l) => !l.startsWith('ALTER TABLE')).join('\n'));
  addColumnsFrom(db, sql, 'data_room_grants');
}
