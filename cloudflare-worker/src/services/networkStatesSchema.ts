/**
 * D976 (#2762) — lazy mirror of migration 552's `network_member_states`.
 *
 * Dev and preview databases never run the migrations, and the advisor
 * directory, advisor booking and the Lab directory now read this table, so each
 * of them calls `ensureNetworkStatesSchema(env)` first. The statement is the
 * migration's own, `CREATE TABLE IF NOT EXISTS`, and it never seeds a row.
 */
import type { Env } from '../types';

const READY = new WeakMap<object, boolean>();

export const NETWORK_STATES_DDL = `CREATE TABLE IF NOT EXISTS network_member_states (
  user_id              INTEGER PRIMARY KEY REFERENCES users(id),
  paused_at            TEXT,
  paused_reason        TEXT,
  paused_by            INTEGER REFERENCES users(id),
  resumed_at           TEXT,
  resume_reason        TEXT,
  resumed_by           INTEGER REFERENCES users(id),
  directory_hidden_at  TEXT,
  directory_hidden_by  INTEGER REFERENCES users(id),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
)`;

export async function ensureNetworkStatesSchema(env: Env): Promise<void> {
  const key = env.DB as unknown as object;
  if (READY.get(key)) return;
  try {
    await env.DB.prepare(NETWORK_STATES_DDL).run();
    READY.set(key, true);
  } catch (e) {
    console.warn('[networkStatesSchema] ensure failed', (e as Error)?.message);
  }
}
