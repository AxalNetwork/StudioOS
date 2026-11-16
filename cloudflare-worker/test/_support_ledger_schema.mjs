/**
 * The support ledger's two tables, built from the real migrations rather than DDL copied into each suite (D6202).
 *
 * Migration 237 creates `portfolio_support_entries` (this helper applies only that table's section, so a fixture's
 * own users, projects and positions are left alone), 202611092215 adds the revision and the events table (D4642),
 * and 202611150140 rebuilds both for the lifecycle (D6202). A later migration that touches these tables belongs in
 * `SUPPORT_LEDGER_MIGRATIONS` here, and every suite that builds the ledger picks it up.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '../sql/migrations');
const file = (prefix) => readFileSync(resolve(MIGRATIONS, readdirSync(MIGRATIONS).find((f) => f.startsWith(`${prefix}_`))), 'utf8');

/** The migrations after 237 that change the ledger's tables, in order. */
export const SUPPORT_LEDGER_MIGRATIONS = ['202611092215', '202611150140', '202611152342'];

/** Apply the ledger's tables to `db` (node:sqlite). */
export function applySupportLedgerSchema(db) {
  const m237 = file('237');
  db.exec(m237.slice(m237.indexOf('CREATE TABLE IF NOT EXISTS portfolio_support_entries')));
  for (const prefix of SUPPORT_LEDGER_MIGRATIONS) db.exec(file(prefix));
}
