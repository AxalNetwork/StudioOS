/**
 * Task #1 (DB) — Public FOUNDER_ID / PARTNER_ID generators.
 *
 * Format: `AXF-XXXXXXXX` (founders) and `AXP-XXXXXXXX` (partners),
 * where the suffix is a Crockford-base32 encoding of an opaque
 * monotonic counter. IDs are stable, never recycled, and safe to
 * surface in legal contracts via the `{{counterparty.founder_id}}` /
 * `{{counterparty.partner_id}}` merge fields.
 *
 * Storage: `users.founder_public_id` / `users.partner_public_id`
 * (migration 049). Both columns are TEXT, UNIQUE, and NULL until
 * the user first transitions into the founder/partner role.
 */
import type { Env } from '../types';

// Crockford alphabet — no I/L/O/U so IDs are unambiguous when copy-pasted.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeBase32(n: number): string {
  if (n <= 0) return '0';
  let out = '';
  let v = n;
  while (v > 0) {
    out = ALPHABET[v & 31] + out;
    v = Math.floor(v / 32);
  }
  // Pad to 6 chars minimum so AXF-1 doesn't look like a typo.
  while (out.length < 6) out = '0' + out;
  return out;
}

/**
 * Pick the next sequence number for the given prefix by counting
 * existing rows + a small random salt to avoid collisions under
 * write contention. The UNIQUE index on the column is the final
 * line of defence; the loop retries up to 5 times on collision.
 */
async function nextId(env: Env, prefix: 'AXF' | 'AXP', column: 'founder_public_id' | 'partner_public_id'): Promise<string> {
  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM users WHERE ${column} IS NOT NULL`,
  ).first<{ c: number }>();
  const base = (countRow?.c ?? 0) + 1;
  for (let attempt = 0; attempt < 5; attempt++) {
    const seq = base + attempt + Math.floor(Math.random() * 16);
    const candidate = `${prefix}-${encodeBase32(seq)}`;
    const clash = await env.DB.prepare(
      `SELECT 1 FROM users WHERE ${column} = ? LIMIT 1`,
    ).bind(candidate).first();
    if (!clash) return candidate;
  }
  // Last resort — append a UUID slice. Will never collide.
  return `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

/**
 * Idempotently assign a FOUNDER_ID / PARTNER_ID to a user. Returns
 * the existing id if one is already set; otherwise generates and
 * persists a fresh one. Safe to call from any code path that grants
 * the founder/partner role.
 *
 * Concurrency model: the inner write goes through a retry loop that
 * survives both (a) two concurrent assigners for the SAME user (the
 * second writer's `WHERE founder_public_id IS NULL` no-ops and the
 * re-read returns the winner's value), and (b) two concurrent
 * assigners for DIFFERENT users that pick the same candidate id
 * (the UNIQUE index throws, we re-roll a fresh candidate via
 * nextId() and try again, up to MAX_ATTEMPTS).
 */
const MAX_ATTEMPTS = 8;

async function assignPublicId(
  env: Env,
  userId: number,
  prefix: 'AXF' | 'AXP',
  column: 'founder_public_id' | 'partner_public_id',
): Promise<string | null> {
  if (!Number.isFinite(userId)) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT ${column} AS pid FROM users WHERE id = ?`,
    ).bind(userId).first<{ pid: string | null }>();
    if (!row) return null;
    if (row.pid) return row.pid;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const candidate = await nextId(env, prefix, column);
      try {
        await env.DB.prepare(
          `UPDATE users SET ${column} = ? WHERE id = ? AND ${column} IS NULL`,
        ).bind(candidate, userId).run();
      } catch (e) {
        // UNIQUE conflict — another row claimed the same candidate.
        // Re-roll and retry. Other (non-UNIQUE) errors fall through
        // to the re-read below, which returns null on persistent failure.
        if (!/UNIQUE|constraint/i.test((e as Error).message || '')) {
          console.error('[publicIds] write failed', column, (e as Error).message);
        }
        continue;
      }
      const fresh = await env.DB.prepare(
        `SELECT ${column} AS pid FROM users WHERE id = ?`,
      ).bind(userId).first<{ pid: string | null }>();
      if (fresh?.pid) return fresh.pid;
    }
    console.error('[publicIds] exhausted retries', column, userId);
    return null;
  } catch (e) {
    console.error('[publicIds] assign failed', column, userId, (e as Error).message);
    return null;
  }
}

export function assignFounderPublicId(env: Env, userId: number): Promise<string | null> {
  return assignPublicId(env, userId, 'AXF', 'founder_public_id');
}

export function assignPartnerPublicId(env: Env, userId: number): Promise<string | null> {
  return assignPublicId(env, userId, 'AXP', 'partner_public_id');
}

/**
 * Lazy schema bootstrap — adds the two TEXT columns + indexes if
 * missing. Mirrors the pattern used by ensureProfileColumns() in
 * routes/admin.ts for environments where migration 049 has not yet
 * been applied (dev D1 or pre-merge preview).
 */
let publicIdSchemaReady = false;
export async function ensurePublicIdColumns(env: Env): Promise<void> {
  if (publicIdSchemaReady) return;
  const stmts = [
    `ALTER TABLE users ADD COLUMN founder_public_id TEXT`,
    `ALTER TABLE users ADD COLUMN partner_public_id TEXT`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_founder_public_id ON users(founder_public_id) WHERE founder_public_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_partner_public_id ON users(partner_public_id) WHERE partner_public_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(last_active_at)`,
  ];
  for (const s of stmts) {
    try { await env.DB.prepare(s).run(); } catch {}
  }
  publicIdSchemaReady = true;
}
