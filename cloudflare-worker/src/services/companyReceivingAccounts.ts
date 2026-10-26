/** D1217 (#3214): private company instructions. No bank request or money movement. */
import type { Env } from '../types';
import { encryptColumn, decryptColumn } from './columnCipher';
import { isAbaRoutingNumber, SWIFT_SHAPE } from './entityBankAccounts';
import { notify } from './notify';

const TABLE = 'company_receiving_accounts';
const COLUMN = 'instructions_enc';
export const COMPANY_PAY_WARNING = 'Before you pay, call the company on a phone number you already hold to confirm these details. Never use a number supplied with a change of payment instructions.';
export const COMPANY_CHANGE_WARNING = 'Call the company on a number you already hold before you pay.';
export class CompanyAccountError extends Error {
  status: 400 | 403 | 404 | 409 | 503;
  code: string;
  publicMessage: string;
  constructor(status: CompanyAccountError['status'], code: string, message: string) { super(message); this.status = status; this.code = code; this.publicMessage = message; }
}
function fail(status: CompanyAccountError['status'], code: string, message: string): never { throw new CompanyAccountError(status, code, message); }
type Scope = { company_id: number; company_name: string; role: string; owner: number };
type AccountRow = { id: number; uid: string; company_id: number; revision: number; instructions_enc: string; account_last4: string; created_at: string };
type Instructions = { payee_name: string; bank_name: string; account_number: string; routing_number: string; swift_code: string | null; currency: string; payment_reference: string | null };
export type AccountInput = Record<string, unknown>;

async function scopeFor(env: Env, userId: number, projectId: number, write = false): Promise<Scope> {
  if (!Number.isSafeInteger(projectId) || projectId <= 0) fail(404, 'company_account_not_found', 'That receiving account is not available here.');
  const row = await env.DB.prepare(
    `SELECT p.company_id, cp.company_name, u.role,
      CASE WHEN u.role = 'founder' AND u.founder_id = p.founder_id AND EXISTS
        (SELECT 1 FROM user_company_links l WHERE l.company_id = p.company_id AND l.user_id = u.id AND l.is_primary_admin = 1)
        THEN 1 ELSE 0 END AS owner
     FROM projects p JOIN company_profiles cp ON cp.id = p.company_id
     JOIN users u ON u.id = ? AND u.is_active = 1 AND u.deletion_requested_at IS NULL
     WHERE p.id = ? AND p.deleted_at IS NULL AND
       ((u.role = 'founder' AND u.founder_id = p.founder_id AND EXISTS
         (SELECT 1 FROM user_company_links l WHERE l.company_id = p.company_id AND l.user_id = u.id AND l.is_primary_admin = 1))
        OR (u.role = 'investor' AND EXISTS (SELECT 1 FROM commitments k JOIN deals d ON d.id = k.deal_id
          WHERE d.project_id = p.id AND k.investor_user_id = u.id AND k.status <> 'withdrawn')))` ,
  ).bind(userId, projectId).first<Scope>();
  if (!row) fail(404, 'company_account_not_found', 'That receiving account is not available here.');
  if (write && !row.owner) fail(403, 'company_account_owner_required', 'Only the venture founder who administers this company can change its receiving account.');
  return row;
}

async function current(env: Env, companyId: number): Promise<AccountRow | null> {
  return env.DB.prepare('SELECT id, uid, company_id, revision, instructions_enc, account_last4, created_at FROM company_receiving_accounts WHERE company_id = ? AND is_active = 1')
    .bind(companyId).first<AccountRow>();
}
const text = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const s = value.trim().replace(/\s+/g, ' '); return s && s.length <= max ? s : null;
};
const digits = (value: unknown): string => typeof value === 'string' ? value.replace(/[\s-]/g, '') : '';
function parse(input: AccountInput): Instructions {
  const payee = text(input.payee_name, 160), bank = text(input.bank_name, 160);
  if (!payee || !bank) fail(400, 'company_account_names_required', 'Enter the payee and bank names.');
  const number = digits(input.account_number);
  if (!/^\d{4,17}$/.test(number)) fail(400, 'account_number_invalid', 'Enter an account number of 4 to 17 digits.');
  if (digits(input.account_number_confirm) !== number) fail(400, 'account_number_mismatch', 'Type the same account number twice.');
  const routing = digits(input.routing_number);
  if (!isAbaRoutingNumber(routing) || /^0+$/.test(routing)) fail(400, 'routing_number_invalid', 'Enter a valid nine-digit ABA routing number.');
  const swift = typeof input.swift_code === 'string' ? input.swift_code.replace(/\s/g, '').toUpperCase() : '';
  if (swift && !SWIFT_SHAPE.test(swift)) fail(400, 'swift_invalid', 'Enter a valid SWIFT code or leave it empty.');
  const currency = typeof input.currency === 'string' ? input.currency.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(currency)) fail(400, 'currency_required', 'Enter the account currency as a three-letter code.');
  const reference = input.payment_reference == null || input.payment_reference === '' ? null : text(input.payment_reference, 120);
  if (input.payment_reference && !reference) fail(400, 'payment_reference_invalid', 'The payment reference must be at most 120 characters.');
  return { payee_name: payee, bank_name: bank, account_number: number, routing_number: routing, swift_code: swift || null, currency, payment_reference: reference };
}
async function plain(env: Env, row: AccountRow): Promise<Instructions> {
  const value = await decryptColumn(env, TABLE, COLUMN, row.uid, row.instructions_enc);
  if (!value) fail(503, 'company_account_unreadable', 'These instructions cannot be read. Ask the company to check its receiving account.');
  try {
    const body = JSON.parse(value);
    const parsed = parse({ ...body, account_number_confirm: body.account_number });
    if (parsed.account_number.slice(-4) !== row.account_last4) throw new Error('mismatch');
    return parsed;
  } catch { return fail(503, 'company_account_unreadable', 'These instructions cannot be read. Ask the company to check its receiving account.'); }
}
function masked(row: Pick<AccountRow, 'uid' | 'revision' | 'created_at' | 'account_last4'>, details: Instructions) {
  return { uid: row.uid, revision: row.revision, created_at: row.created_at,
    ...details, account_number: `••••${row.account_last4}`, warning: COMPANY_PAY_WARNING };
}

export async function readCompanyAccount(env: Env, userId: number, projectId: number) {
  const scope = await scopeFor(env, userId, projectId);
  const row = await current(env, scope.company_id);
  if (!row) return { recorded: false as const, reason: 'The company has not recorded a receiving account.' };
  return { recorded: true as const, account: masked(row, await plain(env, row)) };
}

/** A conditional version change and its actor record commit together. */
export async function setCompanyAccount(env: Env, userId: number, projectId: number, input: AccountInput) {
  const scope = await scopeFor(env, userId, projectId, true);
  const revision = input.expected_revision;
  if (!Number.isSafeInteger(revision) || Number(revision) < 0) fail(400, 'account_revision_required', 'Read the current account version before saving.');
  const before = await current(env, scope.company_id);
  if (Number(revision) !== (before?.revision ?? 0)) fail(409, 'company_account_changed', 'The account changed. Read the current details before saving.');
  const details = parse(input);
  if (before) {
    try {
      if (JSON.stringify(await plain(env, before)) === JSON.stringify(details)) return { recorded: true, changed: false, account: masked(before, details) };
    } catch (e) {
      // An owner can replace instructions made unreadable by a key rotation.
      if (!(e instanceof CompanyAccountError) || e.code !== 'company_account_unreadable') throw e;
    }
  }
  const uid = crypto.randomUUID(), next = Number(revision) + 1;
  const at = new Date().toISOString();
  let encrypted: string;
  try { encrypted = await encryptColumn(env, TABLE, COLUMN, uid, JSON.stringify(details)); }
  catch { return fail(503, 'company_account_encryption_unavailable', 'The receiving account could not be encrypted, so it was not saved.'); }
  // Re-check the current owner within the write, including a concurrent ownership transfer.
  const ownerArgs = [userId, projectId, scope.company_id];
  const saved = await env.DB.batch([
    env.DB.prepare(`UPDATE company_receiving_accounts SET is_active = 0 WHERE company_id = ? AND revision = ? AND is_active = 1 AND EXISTS (SELECT 1 FROM projects p JOIN users u ON u.id = ? AND u.role = 'founder' AND u.founder_id = p.founder_id
    JOIN user_company_links l ON l.company_id = p.company_id AND l.user_id = u.id AND l.is_primary_admin = 1
    WHERE p.id = ? AND p.company_id = ? AND p.deleted_at IS NULL AND u.is_active = 1 AND u.deletion_requested_at IS NULL)`)
      .bind(scope.company_id, revision, ...ownerArgs),
    env.DB.prepare(`INSERT INTO company_receiving_accounts(uid, company_id, revision, instructions_enc, account_last4, created_by_user_id, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM projects p JOIN users u ON u.id = ? AND u.role = 'founder' AND u.founder_id = p.founder_id
    JOIN user_company_links l ON l.company_id = p.company_id AND l.user_id = u.id AND l.is_primary_admin = 1
    WHERE p.id = ? AND p.company_id = ? AND p.deleted_at IS NULL AND u.is_active = 1 AND u.deletion_requested_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM company_receiving_accounts WHERE company_id = ? AND is_active = 1)
       AND ((? = 0 AND NOT EXISTS (SELECT 1 FROM company_receiving_accounts WHERE company_id = ?)) OR
         EXISTS (SELECT 1 FROM company_receiving_accounts WHERE uid = ? AND company_id = ? AND revision = ? AND is_active = 0))`)
      .bind(uid, scope.company_id, next, encrypted, details.account_number.slice(-4), userId, at, ...ownerArgs,
        scope.company_id, revision, scope.company_id, before?.uid ?? '', scope.company_id, revision),
    env.DB.prepare(`INSERT INTO activity_logs(uid, project_id, user_id, action, details)
      SELECT ?, ?, ?, 'company_receiving_account_set', ? WHERE EXISTS (SELECT 1 FROM company_receiving_accounts WHERE uid = ? AND is_active = 1)`)
      .bind(crypto.randomUUID(), projectId, userId, JSON.stringify({ revision: next }), uid),
    env.DB.prepare(`SELECT DISTINCT k.investor_user_id AS user_id, MIN(d.id) AS deal_id
      FROM commitments k JOIN deals d ON d.id = k.deal_id JOIN projects p ON p.id = d.project_id
      JOIN users u ON u.id = k.investor_user_id AND u.role = 'investor' AND u.is_active = 1 AND u.deletion_requested_at IS NULL
      WHERE p.company_id = ? AND p.deleted_at IS NULL AND k.status = 'pending' AND ? = 1
        AND EXISTS (SELECT 1 FROM company_receiving_accounts WHERE uid = ? AND is_active = 1)
      GROUP BY k.investor_user_id`).bind(scope.company_id, before ? 1 : 0, uid),
  ]);
  if (Number(saved[1]?.meta?.changes) !== 1) fail(409, 'company_account_changed', 'The account or its owner changed. Read the current details before saving.');
  const row = { uid, revision: next, created_at: at, account_last4: details.account_number.slice(-4) };
  const recipients = saved[3]?.results as Array<{ user_id: number; deal_id: number }> | undefined;
  if (!Array.isArray(recipients)) fail(503, 'saved_notice_recipients_unreadable', 'The account was saved, but its notice recipients could not be read. Read the current account before trying again.');
  for (const person of recipients) {
    try {
      await notify(env, { userId: Number(person.user_id), type: 'company_receiving_account_changed',
        title: 'The company changed its receiving account',
        body: `${scope.company_name} changed its receiving account on ${row.created_at.slice(0, 10)}. ${COMPANY_CHANGE_WARNING}`,
        link: `/deals/${person.deal_id}/closing`, channels: ['in_app', 'email'], payload: { revision: next } });
    } catch { console.warn('[company-account] change notice unavailable'); }
  }
  return { recorded: true, changed: true, account: masked(row, details) };
}

/** Conservative legacy bridge, prepared pending S01's signature-contract answer.
 * The conditional audit INSERT is the authorization point, so a revoked
 * signature, membership or current account cannot produce an unaudited reveal.
 */
async function recordSignedReveal(env: Env, userId: number, projectId: number, commitmentUid: string, accountUid: string) {
  let logged: D1Result<{ commitment_id: number }>;
  try {
    logged = await env.DB.prepare(
      `INSERT INTO company_receiving_account_reveals(uid, account_id, actor_user_id, commitment_id)
       SELECT ?, a.id, u.id, k.id FROM company_receiving_accounts a
       JOIN projects p ON p.company_id = a.company_id AND p.deleted_at IS NULL
       JOIN deals d ON d.project_id = p.id JOIN commitments k ON k.deal_id = d.id
       JOIN users u ON u.id = k.investor_user_id AND u.role = 'investor' AND u.is_active = 1 AND u.deletion_requested_at IS NULL
       WHERE a.uid = ? AND a.is_active = 1 AND p.id = ? AND k.uid = ? AND u.id = ? AND k.status <> 'withdrawn'
         AND EXISTS (SELECT 1 FROM safe_issuances s JOIN esign_envelopes e ON e.id = s.envelope_id AND e.status = 'completed'
           JOIN esign_recipients r ON r.envelope_id = e.id AND r.user_id = u.id AND r.status = 'signed' AND r.signed_at IS NOT NULL
           WHERE s.project_id = p.id AND s.amount_cents = CAST(ROUND(k.amount * 100) AS INTEGER)
             AND UPPER(s.currency) = d.currency AND e.document_type = 'safe' AND e.deal_id = d.id)
       RETURNING commitment_id`,
    ).bind(crypto.randomUUID(), accountUid, projectId, commitmentUid, userId).all<{ commitment_id: number }>();
  } catch { return fail(503, 'company_reveal_unrecorded', 'The reveal could not be recorded, so the instructions are not shown.'); }
  if (!logged.results || logged.results.length !== 1) fail(403, 'signed_line_required', 'A signed investment line is required to reveal these instructions.');
  return logged.results[0].commitment_id;
}

/** No decrypt occurs before the reveal's durable, number-free audit row. */
export async function revealCompanyAccount(env: Env, userId: number, projectId: number, commitmentUid: unknown) {
  const scope = await scopeFor(env, userId, projectId);
  if (scope.role !== 'investor') fail(403, 'signed_line_required', 'A signed investment line is required to reveal these instructions.');
  if (typeof commitmentUid !== 'string' || !commitmentUid || commitmentUid.length > 100) fail(400, 'commitment_required', 'Choose your signed investment line.');
  const row = await current(env, scope.company_id);
  if (!row) fail(404, 'company_account_not_recorded', 'The company has not recorded a receiving account.');
  const commitmentId = await recordSignedReveal(env, userId, projectId, commitmentUid, row.uid);
  const line = await env.DB.prepare('SELECT d.currency FROM commitments k JOIN deals d ON d.id = k.deal_id WHERE k.id = ?')
    .bind(commitmentId).first<{ currency: string }>();
  if (!line) fail(503, 'company_account_unreadable', 'These instructions cannot be checked against the investment line.');
  const details = await plain(env, row);
  if (details.currency !== line.currency) fail(409, 'company_account_currency_mismatch', 'The recorded account currency differs from this investment line. Confirm the correct instructions with the company.');
  return { account: { ...masked(row, details), account_number: details.account_number }, expires_in_seconds: 30 };
}
