/**
 * D708 (#1773) — each Axal entity's bank accounts, encrypted at rest
 * (migration 472). The one writer and reader of `entity_bank_accounts` and
 * `entity_bank_account_reveals`; `services/payInstructions.ts` resolves a
 * payee's account through the readers here.
 *
 * THE NUMBER NEVER LEAVES THIS FILE except in two places: the ciphertext in
 * `entity_bank_accounts.account_number_enc`, and the one account returned by
 * a reveal, after its ledger row is written. Every other read is the last
 * four. No log line, activity or audit row, or error body carries it:
 * refusals are a code and our sentence, never an echo of what was typed.
 *
 * PAYMENT INSTRUCTIONS NEVER CHANGE IN PLACE (decision 3). Only the label and
 * the purposes can be edited; the triggers of migration 472 refuse the rest.
 * To change an account, retire it and add the new one.
 */
import type { Env } from '../types';
import { encryptColumn, decryptColumn } from './columnCipher';
import { AXAL_ENTITIES, type AxalEntityKey } from './legalDocFormat';
// Imported inside function bodies only, so the two modules may import each other.
import { PAYMENT_PURPOSES, isPaymentPurpose, type PaymentPurpose } from './payInstructions';

export const BANK_TABLE = 'entity_bank_accounts';
export const BANK_COLUMN = 'account_number_enc';
export const ENTITY_KEYS = ['holdings', 'management', 'gp', 'fund'] as const satisfies readonly AxalEntityKey[];
export const ACCOUNT_KINDS = ['checking', 'savings'] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export const maskAccount = (last4: string) => `••••${last4}`;

/** A refusal: its status, its code and our sentence. Never the input. */
export class BankAccountError extends Error {
  status: number;
  code: string;
  sentence: string;
  constructor(status: number, code: string, sentence: string) {
    super(code);
    this.status = status;
    this.code = code;
    this.sentence = sentence;
  }
}

const refuse = (status: number, code: string, sentence: string): never => { throw new BankAccountError(status, code, sentence); };

/** The stored row, ciphertext included. Never returned past this module's readers. */
export type BankAccountRow = {
  id: number; uid: string; entity_key: AxalEntityKey; label: string;
  bank_name: string; bank_address: string; beneficiary_name: string; beneficiary_address: string;
  account_kind: AccountKind; account_number_enc: string; account_last4: string;
  routing_number: string; routing_number_alt: string | null; swift_code: string | null; intermediary_swift_code: string | null;
  purposes_json: string; status: 'active' | 'retired'; retired_at: string | null; retired_reason: string | null;
  recorded_by: number; created_at: string; updated_at: string;
};

/** What a list, the console and a masked instruction show: the last four, never the number. */
export type MaskedAccount = {
  uid: string; entity_key: AxalEntityKey; entity_name: string; label: string;
  bank_name: string; bank_address: string; beneficiary_name: string; beneficiary_address: string;
  account_kind: AccountKind; account_last4: string; account_masked: string;
  routing_number: string; routing_number_alt: string | null; swift_code: string | null; intermediary_swift_code: string | null;
  purposes: PaymentPurpose[]; status: 'active' | 'retired'; retired_at: string | null; retired_reason: string | null;
  created_at: string; updated_at: string;
};

export function purposesOf(row: Pick<BankAccountRow, 'purposes_json'>): PaymentPurpose[] {
  try {
    const v = JSON.parse(row.purposes_json);
    return Array.isArray(v) ? v.filter(isPaymentPurpose) : [];
  } catch { return []; }
}

export function masked(row: BankAccountRow): MaskedAccount {
  return {
    uid: row.uid, entity_key: row.entity_key, entity_name: AXAL_ENTITIES[row.entity_key]?.name ?? row.entity_key, label: row.label,
    bank_name: row.bank_name, bank_address: row.bank_address,
    beneficiary_name: row.beneficiary_name, beneficiary_address: row.beneficiary_address,
    account_kind: row.account_kind, account_last4: row.account_last4, account_masked: maskAccount(row.account_last4),
    routing_number: row.routing_number, routing_number_alt: row.routing_number_alt,
    swift_code: row.swift_code, intermediary_swift_code: row.intermediary_swift_code,
    purposes: purposesOf(row), status: row.status, retired_at: row.retired_at, retired_reason: row.retired_reason,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

// ---------------------------------------------------------------- validation

/** An ABA routing number: nine digits whose weighted sum (3, 7, 1) is a multiple of ten. */
export function isAbaRoutingNumber(v: string): boolean {
  if (!/^\d{9}$/.test(v)) return false;
  const d = v.split('').map(Number);
  return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 === 0;
}

export const SWIFT_SHAPE = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;
const ACCOUNT_NUMBER_SHAPE = /^\d{4,17}$/;

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/\s+/g, ' ');
  return s && s.length <= max ? s : null;
};
const digits = (v: unknown): string => (typeof v === 'string' ? v.replace(/[\s-]/g, '') : '');
const upper = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s/g, '').toUpperCase() : '');

export type NewAccountInput = {
  entity_key?: unknown; label?: unknown; bank_name?: unknown; bank_address?: unknown;
  beneficiary_name?: unknown; beneficiary_address?: unknown; account_kind?: unknown;
  account_number?: unknown; account_number_confirm?: unknown;
  routing_number?: unknown; routing_number_alt?: unknown; swift_code?: unknown; intermediary_swift_code?: unknown;
  purposes?: unknown;
};

function parsePurposes(raw: unknown): PaymentPurpose[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > Object.keys(PAYMENT_PURPOSES).length) {
    refuse(400, 'purposes_invalid', 'Purposes must be a list of the payment purposes this console offers.');
  }
  const list = raw as unknown[];
  if (list.some((p) => !isPaymentPurpose(p))) refuse(400, 'purpose_unknown', 'One of the purposes is not a payment this console knows.');
  return [...new Set(list as PaymentPurpose[])];
}

/**
 * Decision 4's rules for one account's purposes: none on savings, each one
 * paid to this account's entity, and none another active account of the same
 * entity already carries.
 */
async function checkPurposes(env: Env, entityKey: AxalEntityKey, kind: AccountKind, purposes: PaymentPurpose[], exceptUid: string | null) {
  if (!purposes.length) return;
  if (kind === 'savings') refuse(409, 'purpose_on_savings', 'A savings account takes no payments. Give the purpose to a checking account.');
  for (const p of purposes) {
    if (PAYMENT_PURPOSES[p].payee !== entityKey) {
      refuse(409, 'purpose_wrong_entity', `${PAYMENT_PURPOSES[p].label} is paid to ${AXAL_ENTITIES[PAYMENT_PURPOSES[p].payee].name}, not to ${AXAL_ENTITIES[entityKey].name}.`);
    }
  }
  const taken = await env.DB.prepare(
    `SELECT a.uid, a.purposes_json FROM entity_bank_accounts a
      WHERE a.entity_key = ? AND a.status = 'active' AND a.uid IS NOT ?`,
  ).bind(entityKey, exceptUid).all<{ uid: string; purposes_json: string }>();
  for (const row of taken.results || []) {
    const clash = purposesOf(row).find((p) => purposes.includes(p));
    if (clash) refuse(409, 'purpose_taken', `Another active account of ${AXAL_ENTITIES[entityKey].name} already takes ${PAYMENT_PURPOSES[clash].label.toLowerCase()}. Remove it there first.`);
  }
}

// ---------------------------------------------------------------- writes

const ROW_BY_UID = 'SELECT * FROM entity_bank_accounts WHERE uid = ?';

async function rowByUid(env: Env, uid: unknown): Promise<BankAccountRow> {
  if (typeof uid !== 'string' || !/^[a-f0-9-]{8,64}$/i.test(uid)) refuse(404, 'account_not_found', 'No such account.');
  const row = await env.DB.prepare(ROW_BY_UID).bind(uid).first<BankAccountRow>();
  if (!row) refuse(404, 'account_not_found', 'No such account.');
  return row as BankAccountRow;
}

/** Validate, encrypt, then insert one account. The uid is minted first, so the ciphertext is bound to its row. */
export async function createAccount(env: Env, input: NewAccountInput, actorId: number): Promise<MaskedAccount> {
  const entityKey = (ENTITY_KEYS as readonly string[]).includes(String(input.entity_key)) ? (input.entity_key as AxalEntityKey) : null;
  if (!entityKey) return refuse(400, 'entity_invalid', 'Choose one of the four Axal entities.');
  const label = text(input.label, 60) ?? refuse(400, 'label_invalid', 'The label is 1 to 60 characters.');
  const bankName = text(input.bank_name, 120) ?? refuse(400, 'bank_name_invalid', "The bank's name is required.");
  const bankAddress = text(input.bank_address, 200) ?? refuse(400, 'bank_address_invalid', "The bank's address is required.");
  const beneficiaryName = text(input.beneficiary_name, 120) ?? refuse(400, 'beneficiary_invalid', "The beneficiary's name is required.");
  const beneficiaryAddress = text(input.beneficiary_address, 200) ?? refuse(400, 'beneficiary_address_invalid', "The beneficiary's address is required.");
  if (beneficiaryName !== AXAL_ENTITIES[entityKey].name) {
    refuse(400, 'beneficiary_not_entity', `The beneficiary must be the entity itself, ${AXAL_ENTITIES[entityKey].name}, exactly as its legal name reads.`);
  }
  const kind = (ACCOUNT_KINDS as readonly string[]).includes(String(input.account_kind)) ? (input.account_kind as AccountKind) : null;
  if (!kind) return refuse(400, 'account_kind_invalid', 'The account is checking or savings.');
  const number = digits(input.account_number);
  if (!ACCOUNT_NUMBER_SHAPE.test(number)) refuse(400, 'account_number_invalid', 'The account number is 4 to 17 digits.');
  if (digits(input.account_number_confirm) !== number) refuse(400, 'account_number_mismatch', 'The two copies of the account number differ. Type it again.');
  const routing = digits(input.routing_number);
  if (!isAbaRoutingNumber(routing)) refuse(400, 'routing_number_invalid', 'The routing number is nine digits with a valid ABA checksum.');
  const routingAlt = digits(input.routing_number_alt) || null;
  if (routingAlt && !isAbaRoutingNumber(routingAlt)) refuse(400, 'routing_number_alt_invalid', 'The alternate routing number is nine digits with a valid ABA checksum.');
  const swift = upper(input.swift_code) || null;
  if (swift && !SWIFT_SHAPE.test(swift)) refuse(400, 'swift_invalid', 'The SWIFT code is 8 or 11 letters and digits.');
  const intermediary = upper(input.intermediary_swift_code) || null;
  if (intermediary && !SWIFT_SHAPE.test(intermediary)) refuse(400, 'intermediary_swift_invalid', "The intermediary bank's SWIFT code is 8 or 11 letters and digits.");
  const purposes = parsePurposes(input.purposes);
  await checkPurposes(env, entityKey, kind, purposes, null);

  const uid = crypto.randomUUID();
  let enc: string;
  try {
    enc = await encryptColumn(env, BANK_TABLE, BANK_COLUMN, uid, number);
  } catch {
    // No key in production, or one under 32 bytes. Nothing is stored, and the cipher's own text is not echoed.
    return refuse(503, 'cipher_key_missing', 'Payment instructions cannot be stored: the encryption key is not configured.');
  }
  await env.DB.prepare(
    `INSERT INTO entity_bank_accounts
       (uid, entity_key, label, bank_name, bank_address, beneficiary_name, beneficiary_address, account_kind,
        account_number_enc, account_last4, routing_number, routing_number_alt, swift_code, intermediary_swift_code,
        purposes_json, recorded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    uid, entityKey, label, bankName, bankAddress, beneficiaryName, beneficiaryAddress, kind,
    enc, number.slice(-4), routing, routingAlt, swift, intermediary, JSON.stringify(purposes), actorId,
  ).run();
  return masked(await rowByUid(env, uid));
}

/** Every account, masked, active first, then newest. */
export async function listAccounts(env: Env): Promise<MaskedAccount[]> {
  const res = await env.DB.prepare(
    `SELECT * FROM entity_bank_accounts ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, entity_key, id DESC`,
  ).all<BankAccountRow>();
  return (res.results || []).map(masked);
}

/** The label and the purposes, the only two things that change (decision 3). Any other field is refused. */
export async function updateAccount(env: Env, uid: unknown, body: Record<string, unknown>): Promise<MaskedAccount> {
  const extra = Object.keys(body).filter((k) => k !== 'label' && k !== 'purposes');
  if (extra.length) refuse(409, 'instructions_immutable', 'Retire this account and add the new one.');
  const row = await rowByUid(env, uid);
  if (row.status !== 'active') refuse(409, 'account_retired', 'A retired account is never changed. Add a new account instead.');
  const label = body.label === undefined ? row.label : (text(body.label, 60) ?? refuse(400, 'label_invalid', 'The label is 1 to 60 characters.'));
  const purposes = body.purposes === undefined ? purposesOf(row) : parsePurposes(body.purposes);
  if (body.purposes !== undefined) await checkPurposes(env, row.entity_key, row.account_kind, purposes, row.uid);
  await env.DB.prepare(
    `UPDATE entity_bank_accounts SET label = ?, purposes_json = ?, updated_at = datetime('now')
      WHERE uid = ? AND status = 'active'`,
  ).bind(label, JSON.stringify(purposes), row.uid).run();
  return masked(await rowByUid(env, row.uid));
}

/** Retire an account, with a reason of up to 200 characters. It is never deleted. */
export async function retireAccount(env: Env, uid: unknown, reason: unknown): Promise<MaskedAccount> {
  const why = text(reason, 200) ?? refuse(400, 'reason_required', 'Say in up to 200 characters why this account is retired.');
  const row = await rowByUid(env, uid);
  if (row.status !== 'active') refuse(409, 'account_retired', 'This account is already retired.');
  await env.DB.prepare(
    `UPDATE entity_bank_accounts SET status = 'retired', retired_at = datetime('now'), retired_reason = ?,
            updated_at = datetime('now')
      WHERE uid = ? AND status = 'active'`,
  ).bind(why, row.uid).run();
  return masked(await rowByUid(env, row.uid));
}

// ---------------------------------------------------------------- reveals

export type RevealContext = 'admin_reveal' | 'capital_call_line';

/**
 * Record that one account's full number is about to be shown (decision 6).
 * Written BEFORE the decrypt: when this write fails, the caller refuses and
 * shows no number.
 */
export async function recordReveal(env: Env, accountId: number, actorUserId: number, context: RevealContext, contextRef: string | null): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO entity_bank_account_reveals (uid, account_id, actor_user_id, context, context_ref)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), accountId, actorUserId, context, contextRef).run();
}

/** The full number of one stored row, or null when it does not decrypt (a changed key). */
export async function accountNumberOf(env: Env, row: Pick<BankAccountRow, 'uid' | 'account_number_enc'>): Promise<string | null> {
  return decryptColumn(env, BANK_TABLE, BANK_COLUMN, row.uid, row.account_number_enc);
}

/** A full account: the masked fields and the number. Only the two reveal routes ever send one. */
export type RevealedAccount = MaskedAccount & { account_number: string };

/** The Super Admin's reveal of one account: the ledger row, then the number. */
export async function revealAccount(env: Env, uid: unknown, actorUserId: number, reason: unknown): Promise<RevealedAccount> {
  const why = text(reason, 200) ?? refuse(400, 'reason_required', 'Say in up to 200 characters why you are revealing this number.');
  const row = await rowByUid(env, uid);
  try {
    await recordReveal(env, row.id, actorUserId, 'admin_reveal', why);
  } catch {
    return refuse(503, 'reveal_unrecorded', 'The reveal could not be recorded, so the number is not shown.');
  }
  const number = await accountNumberOf(env, row);
  if (!number) return refuse(409, 'account_unreadable', 'This account cannot be read, perhaps after a key change. Retire it and add it again.');
  return { ...masked(row), account_number: number };
}

/** Active rows of one entity, for the resolver. Ciphertext included; never returned by a route. */
export async function activeRowsCarrying(env: Env, purpose: PaymentPurpose): Promise<BankAccountRow[]> {
  const res = await env.DB.prepare(
    `SELECT a.* FROM entity_bank_accounts a
      WHERE a.status = 'active' AND EXISTS (SELECT 1 FROM json_each(a.purposes_json) p WHERE p.value = ?)
      ORDER BY a.id`,
  ).bind(purpose).all<BankAccountRow>();
  return res.results || [];
}
