/**
 * D579 (#1206) — a startup's EIN, encrypted at rest and owner-scoped (the
 * owner's answers 1A: store it; 2A: the founder, company editors and admins
 * read it).
 *
 * THE NUMBER NEVER LEAVES THIS FILE except in two places: the ciphertext in
 * `company_eins.ein_enc` (migration 397), and the full value returned to a
 * founder or company editor who asks for their own edit field. Every other
 * read is the last four digits. No log line, activity row, audit row or error
 * body carries it: refusals are codes, and the admin audit records only the
 * project.
 *
 * WHO. A founder of the startup is its owning founder or an accepted owner or
 * co-founder member (`canAccessProject` with `write`, so not an advisor). They
 * read and write it. An admin reads the last four and writes it. Anyone else,
 * a partner and an investor included, is told the startup does not exist.
 */
import type { Env, User } from '../types';
import { encryptColumn, decryptColumn } from './columnCipher';
import { canAccessProject } from './projectAccess';

export const EIN_TABLE = 'company_eins';
export const EIN_COLUMN = 'ein_enc';

/** The IRS's printed shape: two digits, a hyphen, seven digits. */
export const EIN_SHAPE = /^\d{2}-\d{7}$/;

export const maskEin = (last4: string) => `••-•••${last4}`;

const PROJECT_BY_ID = 'SELECT id, name, founder_id FROM projects WHERE id = ?';
const EIN_ROW = 'SELECT ein_enc, ein_last4, updated_at FROM company_eins WHERE project_id = ?';
const EIN_UPSERT =
  'INSERT INTO company_eins (project_id, ein_enc, ein_last4, recorded_by) VALUES (?, ?, ?, ?) '
  + 'ON CONFLICT (project_id) DO UPDATE SET ein_enc = excluded.ein_enc, ein_last4 = excluded.ein_last4, '
  + "recorded_by = excluded.recorded_by, updated_at = datetime('now')";

export type EinProject = { id: number; name: string; founder_id: number | null };
export type EinAccess = 'founder' | 'admin' | null;

export async function einProject(env: Env, projectId: number): Promise<EinProject | null> {
  if (!Number.isInteger(projectId) || projectId <= 0) return null;
  return (await env.DB.prepare(PROJECT_BY_ID).bind(projectId).first<EinProject>()) || null;
}

/** 'founder' (owner or company editor), 'admin', or null for everyone else. */
export async function einAccess(
  env: Env, user: Pick<User, 'id' | 'role' | 'founder_id'>, project: EinProject,
): Promise<EinAccess> {
  if (user.role === 'admin') return 'admin';
  if (user.role === 'partner' || user.role === 'investor') return null;
  return (await canAccessProject(env, user, project, { write: true })) ? 'founder' : null;
}

export type EinRead = {
  recorded: boolean;
  last4: string | null;
  masked: string | null;
  recorded_at: string | null;
  /** Only for a founder's own edit field. */
  ein?: string | null;
};

/**
 * The stored EIN for this project, masked. With `full`, the decrypted number
 * too; the route asks for it only for a founder. A ciphertext that does not
 * decrypt gives `ein: null` and the masked digits still stand.
 */
export async function readEin(env: Env, projectId: number, full = false): Promise<EinRead> {
  const row = await env.DB.prepare(EIN_ROW).bind(projectId)
    .first<{ ein_enc: string; ein_last4: string; updated_at: string }>();
  if (!row) return { recorded: false, last4: null, masked: null, recorded_at: null, ...(full ? { ein: null } : {}) };
  const out: EinRead = { recorded: true, last4: row.ein_last4, masked: maskEin(row.ein_last4), recorded_at: row.updated_at };
  if (full) out.ein = await decryptColumn(env, EIN_TABLE, EIN_COLUMN, projectId, row.ein_enc);
  return out;
}

/** Store `ein` for the project. Refuses anything but the NN-NNNNNNN shape, with a code only. */
export async function writeEin(
  env: Env, projectId: number, ein: unknown, userId: number,
): Promise<{ ok: true; last4: string } | { ok: false; error: 'ein_invalid' }> {
  if (typeof ein !== 'string') return { ok: false, error: 'ein_invalid' };
  const value = ein.trim();
  if (!EIN_SHAPE.test(value)) return { ok: false, error: 'ein_invalid' };
  const last4 = value.slice(-4);
  const enc = await encryptColumn(env, EIN_TABLE, EIN_COLUMN, projectId, value);
  await env.DB.prepare(EIN_UPSERT).bind(projectId, enc, last4, userId).run();
  return { ok: true, last4 };
}
