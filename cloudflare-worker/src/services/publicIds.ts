/**
 * Task #1 (DB) — Public FOUNDER_ID / PARTNER_ID generators.
 *
 * Format: `AXF-XXXXXX` (founders) and `AXP-XXXXXX` (partners), where
 * the suffix is a Crockford-base32 encoding of a stable monotonic
 * sequence kept in the `id_sequences` table (migration 049). IDs are
 * never recycled and safe to surface in legal contracts via the
 * `{{counterparty.founder_id}}` / `{{counterparty.partner_id}}`
 * merge fields.
 *
 * Storage:
 *   * users.founder_public_id  — TEXT, UNIQUE-indexed where NOT NULL
 *   * users.partner_public_id  — TEXT, UNIQUE-indexed where NOT NULL
 *   * id_sequences             — atomic source of monotonic counters
 *
 * Concurrency: the `UPDATE id_sequences SET next_value = next_value + 1
 * WHERE name = ? RETURNING next_value` form is a single SQLite
 * statement, which D1 executes atomically. Two concurrent assigners
 * therefore observe two distinct sequence values and never collide
 * on the candidate id. The UNIQUE index on `users.{founder,partner}_public_id`
 * is the second line of defence against any out-of-band insert.
 */
import type { Env } from '../types';

// Crockford alphabet — no I/L/O/U so IDs are unambiguous when copy-pasted.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PAD = 6;

function encodeBase32(n: number): string {
  if (n <= 0) return '0'.padStart(PAD, '0');
  let out = '';
  let v = n;
  while (v > 0) {
    out = ALPHABET[v & 31] + out;
    v = Math.floor(v / 32);
  }
  while (out.length < PAD) out = '0' + out;
  return out;
}

async function ensureSequenceTable(env: Env): Promise<void> {
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS id_sequences (name TEXT PRIMARY KEY, next_value INTEGER NOT NULL DEFAULT 1)`,
    ).run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO id_sequences (name, next_value) VALUES ('axf', 1)`,
    ).run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO id_sequences (name, next_value) VALUES ('axp', 1)`,
    ).run();
  } catch {}
}

async function nextSeq(env: Env, name: 'axf' | 'axp'): Promise<number> {
  // Atomic counter increment via UPDATE...RETURNING. D1 executes the
  // statement under SQLite's implicit per-statement transaction so two
  // concurrent callers observe distinct values.
  const row = await env.DB.prepare(
    `UPDATE id_sequences SET next_value = next_value + 1 WHERE name = ? RETURNING next_value`,
  ).bind(name).first<{ next_value: number }>();
  if (!row) {
    // Table was missing — bootstrap and retry exactly once.
    await ensureSequenceTable(env);
    const retry = await env.DB.prepare(
      `UPDATE id_sequences SET next_value = next_value + 1 WHERE name = ? RETURNING next_value`,
    ).bind(name).first<{ next_value: number }>();
    if (!retry) throw new Error('id_sequences UPDATE returned no row');
    return retry.next_value - 1;
  }
  // The new row.next_value is the SUCCESSOR; the current sequence
  // value (the one we just claimed) is one less.
  return row.next_value - 1;
}

/**
 * Idempotently assign a FOUNDER_ID / PARTNER_ID to a user. Returns
 * the existing id if one is already set; otherwise allocates a fresh
 * monotonic value via id_sequences and persists it. Safe to call from
 * any code path that grants the founder/partner role.
 */
async function assignPublicId(
  env: Env,
  userId: number,
  prefix: 'AXF' | 'AXP',
  seqName: 'axf' | 'axp',
  column: 'founder_public_id' | 'partner_public_id',
): Promise<string | null> {
  if (!Number.isFinite(userId)) return null;
  // Self-heal partial / un-migrated environments: ensure the new
  // columns + id_sequences table exist BEFORE we read or update them.
  // No-op once-per-isolate after the first call (sentinel below).
  await ensurePublicIdColumns(env);
  try {
    const row = await env.DB.prepare(
      `SELECT ${column} AS pid FROM users WHERE id = ?`,
    ).bind(userId).first<{ pid: string | null }>();
    if (!row) return null;
    if (row.pid) return row.pid;

    // Up to 4 attempts. Real collisions are essentially impossible
    // given the atomic counter, but the loop guards against the
    // ensureSequenceTable retry path and any out-of-band inserts.
    for (let attempt = 0; attempt < 4; attempt++) {
      const seq = await nextSeq(env, seqName);
      const candidate = `${prefix}-${encodeBase32(seq)}`;
      try {
        const upd = await env.DB.prepare(
          `UPDATE users SET ${column} = ? WHERE id = ? AND ${column} IS NULL`,
        ).bind(candidate, userId).run();
        if ((upd.meta?.changes || 0) > 0) return candidate;
      } catch (e) {
        if (!/UNIQUE|constraint/i.test((e as Error).message || '')) {
          console.error('[publicIds] write failed', column, (e as Error).message);
        }
        continue;
      }
      // changes=0 → another caller already set the value for this
      // user. Re-read and return their winner.
      const winner = await env.DB.prepare(
        `SELECT ${column} AS pid FROM users WHERE id = ?`,
      ).bind(userId).first<{ pid: string | null }>();
      if (winner?.pid) return winner.pid;
    }
    console.error('[publicIds] exhausted retries', column, userId);
    return null;
  } catch (e) {
    console.error('[publicIds] assign failed', column, userId, (e as Error).message);
    return null;
  }
}

export function assignFounderPublicId(env: Env, userId: number): Promise<string | null> {
  return assignPublicId(env, userId, 'AXF', 'axf', 'founder_public_id');
}

export function assignPartnerPublicId(env: Env, userId: number): Promise<string | null> {
  return assignPublicId(env, userId, 'AXP', 'axp', 'partner_public_id');
}

/**
 * Lazy schema bootstrap — adds the columns + indexes + sequence /
 * audit tables if missing. Mirrors ensureProfileColumns() in
 * routes/admin.ts so any environment where migration 049 has not yet
 * been applied (dev D1 / pre-merge preview / partial prod apply)
 * still serves /api/admin/users/:id/profile correctly.
 */
let publicIdSchemaReady = false;
export async function ensurePublicIdColumns(env: Env): Promise<void> {
  if (publicIdSchemaReady) return;
  const stmts = [
    `ALTER TABLE users ADD COLUMN founder_public_id TEXT`,
    `ALTER TABLE users ADD COLUMN partner_public_id TEXT`,
    `ALTER TABLE users ADD COLUMN last_active_at TIMESTAMP`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_founder_public_id ON users(founder_public_id) WHERE founder_public_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_partner_public_id ON users(partner_public_id) WHERE partner_public_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(last_active_at)`,
    `CREATE TABLE IF NOT EXISTS id_sequences (name TEXT PRIMARY KEY, next_value INTEGER NOT NULL DEFAULT 1)`,
    `INSERT OR IGNORE INTO id_sequences (name, next_value) VALUES ('axf', 1)`,
    `INSERT OR IGNORE INTO id_sequences (name, next_value) VALUES ('axp', 1)`,
    `CREATE TABLE IF NOT EXISTS admin_profile_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_user_id INTEGER NOT NULL, viewed_user_id INTEGER NOT NULL, conversation_id INTEGER, action TEXT NOT NULL, viewed_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE INDEX IF NOT EXISTS idx_admin_profile_audit_viewed ON admin_profile_audit(viewed_user_id, viewed_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_admin_profile_audit_admin ON admin_profile_audit(admin_user_id, viewed_at DESC)`,
  ];
  for (const s of stmts) {
    try { await env.DB.prepare(s).run(); } catch {}
  }
  publicIdSchemaReady = true;
}

/**
 * Created_at-ordered backfill — assigns AXF-/AXP- ids to every
 * existing user that already has the corresponding role / FK but no
 * public id yet. Walks rows in `created_at ASC, id ASC` order so the
 * sequence numbers reflect signup order. Idempotent: rows that
 * already have an id are skipped, so it is safe to re-run from a
 * one-shot admin endpoint.
 *
 * Returns counts for visibility. Caps total assignments per call to
 * `limit` (default 1000) so a fresh prod D1 can never time out a
 * single worker request; the caller can re-invoke until counts
 * stabilise at zero.
 */
export async function backfillPublicIds(
  env: Env,
  limit: number = 1000,
): Promise<{ founders_assigned: number; partners_assigned: number; cursor_ms: number }> {
  await ensurePublicIdColumns(env);
  const start = Date.now();
  let foundersAssigned = 0;
  let partnersAssigned = 0;

  const founders: any = await env.DB.prepare(
    `SELECT id FROM users
      WHERE founder_public_id IS NULL
        AND (role = 'founder' OR founder_id IS NOT NULL)
      ORDER BY datetime(COALESCE(created_at, '2000-01-01')) ASC, id ASC
      LIMIT ?`,
  ).bind(limit).all();
  for (const r of (founders?.results || []) as Array<{ id: number }>) {
    const id = await assignFounderPublicId(env, r.id);
    if (id) foundersAssigned++;
  }

  const remaining = Math.max(0, limit - foundersAssigned);
  if (remaining > 0) {
    const partners: any = await env.DB.prepare(
      `SELECT id FROM users
        WHERE partner_public_id IS NULL
          AND (role = 'partner' OR partner_id IS NOT NULL)
        ORDER BY datetime(COALESCE(created_at, '2000-01-01')) ASC, id ASC
        LIMIT ?`,
    ).bind(remaining).all();
    for (const r of (partners?.results || []) as Array<{ id: number }>) {
      const id = await assignPartnerPublicId(env, r.id);
      if (id) partnersAssigned++;
    }
  }

  return { founders_assigned: foundersAssigned, partners_assigned: partnersAssigned, cursor_ms: Date.now() - start };
}
