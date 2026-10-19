/**
 * D782 (#2112) — the Prototype / MVP stores the GitHub sync writes, for a
 * fixture that builds `mvp_features` by hand or from 153 alone: the must-have
 * mark and done date (441), the release checklist (461) and the pull request
 * state (501). Each column is added only where the fixture lacks it, so a
 * fixture that already ran 441 or 461 is left as it is.
 */
import { readFileSync } from 'node:fs';

const mig = (n) => readFileSync(`cloudflare-worker/sql/migrations/${n}`, 'utf8');

export function addMvpStores(db) {
  const has = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  if (!has('mvp_features', 'is_must_have')) db.exec('ALTER TABLE mvp_features ADD COLUMN is_must_have INTEGER CHECK (is_must_have IN (0, 1))');
  if (!has('mvp_features', 'done_at')) db.exec('ALTER TABLE mvp_features ADD COLUMN done_at TEXT');
  db.exec(/CREATE TABLE IF NOT EXISTS mvp_release_checks \([\s\S]*?\n\);/.exec(mig('461_build_record_stores.sql'))[0]);
  db.exec(mig('501_github_mvp.sql'));
}
