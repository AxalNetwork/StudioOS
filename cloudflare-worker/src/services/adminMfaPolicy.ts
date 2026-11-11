/**
 * D5249 (#5249): the "Require MFA for admins" setting, and the one predicate
 * for "this admin has MFA". The setting is one `platform_settings` row; while
 * it reads on, `requireAdmin` sends an admin without MFA to enrol (option B,
 * enrol-first). No migration: an absent row is the default, off.
 *
 * ONE PREDICATE FOR "HAS MFA". The Security Overview's finding (D4800) counts an
 * admin as covered when `tfa_methods IS NOT NULL AND tfa_methods <> '[]'`. The
 * gate uses the same rule, so an admin the finding names is exactly an admin
 * the gate refuses, and no admin passes the finding while the gate turns them
 * away.
 *
 * AN UNREADABLE SETTING READS AS OFF, and says so. Enforcement is a claim a
 * Super Admin made; inferring it from a failed read would refuse every admin
 * without MFA during an outage of one table, the same reasoning D135 gives for
 * the compliance freeze. The setting's own read route reports `readable:
 * false` rather than "off", so the screen never says enforcement is off when it
 * could not tell.
 */
import type { Env } from '../types';

/** The `platform_settings` key. Value `'1'` is on; anything else, or no row, is off. */
export const REQUIRE_ADMIN_MFA_KEY = 'require_admin_mfa';

/** Whether this user row has MFA enrolled — the Overview's rule (D4800), not a second one. */
export function hasMfaEnrolled(user: { tfa_methods?: unknown } | null | undefined): boolean {
  const v = (user as { tfa_methods?: unknown } | null | undefined)?.tfa_methods;
  if (v === null || v === undefined) return false;
  return String(v) !== '[]';
}

export interface AdminMfaPolicy {
  /** Whether enforcement is on. False when the row is absent, off, or could not be read. */
  on: boolean;
  /** False when the store could not be read; `on` is then false and must be shown as Unreadable. */
  readable: boolean;
  updated_at: string | null;
  updated_by: string | null;
}

/** Read the setting. Never throws. */
export async function readAdminMfaPolicy(env: Env): Promise<AdminMfaPolicy> {
  try {
    const row = await env.DB.prepare(
      'SELECT value, updated_at, updated_by FROM platform_settings WHERE key = ?',
    ).bind(REQUIRE_ADMIN_MFA_KEY).first<{ value: string | null; updated_at: string | null; updated_by: string | null }>();
    return {
      on: !!row && String(row.value ?? '') === '1',
      readable: true,
      updated_at: row?.updated_at ?? null,
      updated_by: row?.updated_by ?? null,
    };
  } catch (e) {
    console.warn('[adminMfaPolicy] platform_settings unreadable; reading require_admin_mfa as off', (e as Error).message);
    return { on: false, readable: false, updated_at: null, updated_by: null };
  }
}
