/**
 * D5352 (#5352) — the accept retry keys migration 202611101053 adds:
 * `demand_signals.source_proposal_id` and `product_feedback.theme_source_proposal_id`,
 * each with its partial unique index. A fixture that builds either table from
 * migration 440 or the baseline calls this after the table exists, so the
 * writers' inserts and updates find the column production has. Every step is
 * skipped when the world already has it, or lacks the table.
 */
import { readFileSync } from 'node:fs';

const MIGRATION = readFileSync(
  new URL('../sql/migrations/202611101053_validate_grow_accept_idempotency.sql', import.meta.url), 'utf8',
).replace(/^--.*$/gm, '');

export function applyAcceptRetryKeys(db) {
  const has = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  const cols = (t) => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name));
  for (const stmt of MIGRATION.split(';').map((s) => s.trim()).filter(Boolean)) {
    const add = stmt.match(/^ALTER TABLE (\w+) ADD COLUMN (\w+)/i);
    const idx = stmt.match(/\bON (\w+)\s*\(/i);
    const table = add?.[1] ?? idx?.[1];
    if (!table || !has(table)) continue;
    if (add && cols(table).has(add[2])) continue;
    db.exec(stmt);
  }
}
