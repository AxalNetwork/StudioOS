/**
 * Task #1 — Integrations credential helpers.
 *
 * Wraps services/columnCipher.ts so every integrations row stores a single
 * AES-GCM ciphertext blob holding all provider credentials as JSON. The
 * AAD is scoped to (table='integrations', column, rowId=uid) so an
 * attacker with raw-SQL access can't cut-and-paste one user's row onto
 * another's.
 *
 * Helpers here intentionally never log plaintext credentials. The mask
 * helpers used by the list endpoints surface only a 4-char preview.
 */
import type { Env } from '../types';
import { encryptColumn, decryptColumn } from '../services/columnCipher';

export type CredentialBlob = Record<string, unknown> & {
  api_key?: string;
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_at?: number | string | null;
};

const TABLE = 'integrations';

export async function encryptCredentials(
  env: Env,
  uid: string,
  credentials: CredentialBlob,
): Promise<string> {
  return encryptColumn(env, TABLE, 'credentials_enc', uid, JSON.stringify(credentials));
}

export async function decryptCredentials(
  env: Env,
  uid: string,
  blob: string | null | undefined,
): Promise<CredentialBlob | null> {
  const pt = await decryptColumn(env, TABLE, 'credentials_enc', uid, blob);
  if (!pt) return null;
  try { return JSON.parse(pt) as CredentialBlob; }
  catch { return null; }
}

export async function encryptWebhookSecret(env: Env, uid: string, secret: string): Promise<string> {
  return encryptColumn(env, TABLE, 'webhook_secret_enc', uid, secret);
}

export async function decryptWebhookSecret(
  env: Env,
  uid: string,
  blob: string | null | undefined,
): Promise<string | null> {
  return decryptColumn(env, TABLE, 'webhook_secret_enc', uid, blob);
}

/**
 * Build a 4-char tail preview for display next to the connection. Returns
 * null when the credential blob has no api_key field (e.g. pure OAuth flow
 * — the access_token is rotating and not user-meaningful).
 */
export function previewApiKey(credentials: CredentialBlob | null): string | null {
  if (!credentials) return null;
  const k = typeof credentials.api_key === 'string' ? credentials.api_key : '';
  if (!k) return null;
  if (k.length <= 4) return `••••${k}`;
  return `••••${k.slice(-4)}`;
}
