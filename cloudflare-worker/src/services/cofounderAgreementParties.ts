/**
 * Co-founder Agreement — the parties to a generated draft, and each party's
 * OWN position on each clause (D354, migration 309).
 *
 * THE RULE, stated so it can be tested: one party never accepts, or marks
 * "needs alignment", on another's behalf.
 *
 *   * The actor is the signed-in account, passed in by the route. Nothing in
 *     a request body chooses whose position is written; a body that NAMES a
 *     user id other than the caller's is refused (`party_mismatch`) rather
 *     than ignored, so a client that tries is told so.
 *   * A party is identified by account, and the account is resolved from the
 *     party's email when the draft is generated (the D410 rule: LOWER(email)
 *     equality). A party with no email or no account can record nothing.
 *   * The write is keyed (document, clause, caller). No statement here writes
 *     a row for any user id but the caller's.
 *   * Staff (admin/partner) and the project's owner may READ the positions of
 *     a draft on a project they can see; they may not WRITE one unless they are
 *     themselves a named party. KYC is not the gate here —
 *     `requireApprovedKyc` passes every non-investor by design (auth.ts) — the
 *     party check is, so a KYC-less account that is not a party is refused.
 *   * A caller who can see nothing about the draft gets the same 404 as a draft
 *     that does not exist, so ids cannot be enumerated.
 *
 * Pure SQL through `env.DB` so the tests run it on a real SQLite
 * (test/_d1_sqlite.mjs).
 */
import type { Env, User } from '../types';

/** The Agreement page's clause keys (cofounderAgreementViewModel's CLAUSE_SPEC). */
export const CLAUSE_KEYS = [
  'company', 'equity', 'vesting', 'ip', 'roles', 'commitment', 'departure',
  'confidentiality', 'covenants', 's83b', 'amend', 'dispute', 'exec',
] as const;
export const CLAUSE_POSITIONS = ['accepted', 'needs_alignment'] as const;
export const NOTE_MAX = 1000;

export type PartyRow = { id: number; party_index: number; name: string; email: string | null; user_id: number | null };
type DocRow = { id: number; project_id: number | null; founder_id: number | null };

export type Refusal = { status: number; code: string; message: string };
const refusal = (status: number, code: string, message: string): { refused: Refusal } => ({ refused: { status, code, message } });

const NOT_FOUND = refusal(404, 'agreement_not_found', 'That agreement draft was not found.');

/**
 * Record the parties of a freshly generated draft. Each founder's account is
 * looked up by email; a founder with no email or no account is stored with a
 * NULL user_id. One `batch`, so a draft never has half its parties.
 */
export async function recordParties(
  env: Env,
  documentId: number,
  founders: ReadonlyArray<{ name: string; email?: string | null }>,
): Promise<PartyRow[]> {
  const rows: Array<{ index: number; name: string; email: string | null; userId: number | null }> = [];
  for (let i = 0; i < founders.length; i += 1) {
    const f = founders[i];
    const email = typeof f.email === 'string' && f.email.trim() ? f.email.trim() : null;
    let userId: number | null = null;
    if (email) {
      const u = await env.DB.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1').bind(email).first<{ id: number }>();
      userId = u?.id ?? null;
    }
    rows.push({ index: i, name: String(f.name || '').trim() || `Founder ${i + 1}`, email, userId });
  }
  if (rows.length) {
    await env.DB.batch(rows.map((r) => env.DB.prepare(
      `INSERT INTO cofounder_agreement_parties (document_id, party_index, name, email, user_id)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(documentId, r.index, r.name, r.email, r.userId)));
  }
  return loadParties(env, documentId);
}

async function loadParties(env: Env, documentId: number): Promise<PartyRow[]> {
  const res = await env.DB.prepare(
    `SELECT id, party_index, name, email, user_id FROM cofounder_agreement_parties
      WHERE document_id = ? ORDER BY party_index`,
  ).bind(documentId).all<PartyRow>();
  return res.results || [];
}

/**
 * Who may do what with one draft. `canRead` is a party, staff, or the
 * project's owning founder; everyone else is told the draft does not exist.
 */
export async function agreementAccess(env: Env, documentId: number, user: User) {
  if (!Number.isInteger(documentId) || documentId <= 0) return NOT_FOUND;
  const doc = await env.DB.prepare(
    `SELECT d.id, d.project_id, p.founder_id
       FROM documents d LEFT JOIN projects p ON p.id = d.project_id
      WHERE d.id = ? AND d.template_name = 'cofounder_agreement'`,
  ).bind(documentId).first<DocRow>();
  if (!doc) return NOT_FOUND;
  const parties = await loadParties(env, documentId);
  const mine = parties.filter((p) => p.user_id != null && Number(p.user_id) === Number(user.id));
  const isStaff = user.role === 'admin' || user.role === 'partner';
  const isOwner = doc.founder_id != null && (user as any).founder_id != null
    && Number((user as any).founder_id) === Number(doc.founder_id);
  if (!mine.length && !isStaff && !isOwner) return NOT_FOUND;
  return { doc, parties, mine, isParty: mine.length > 0 };
}

/** The read the page draws: parties (no emails, no ids) and every position. */
export async function listPositions(env: Env, documentId: number, user: User) {
  const access = await agreementAccess(env, documentId, user);
  if ('refused' in access) return access;
  const res = await env.DB.prepare(
    `SELECT clause_key, user_id, position, note, updated_at
       FROM cofounder_clause_positions WHERE document_id = ?`,
  ).bind(documentId).all<{ clause_key: string; user_id: number; position: string; note: string | null; updated_at: string }>();
  const partyIndexByUser = new Map<number, number[]>();
  for (const p of access.parties) {
    if (p.user_id == null) continue;
    const list = partyIndexByUser.get(Number(p.user_id)) || [];
    list.push(p.party_index);
    partyIndexByUser.set(Number(p.user_id), list);
  }
  const positions = (res.results || []).flatMap((r) => (partyIndexByUser.get(Number(r.user_id)) || []).map((idx) => ({
    clause_key: r.clause_key, party_index: idx, position: r.position, note: r.note, updated_at: r.updated_at,
  })));
  return {
    document_id: documentId,
    parties: access.parties.map((p) => ({
      party_index: p.party_index,
      name: p.name,
      has_account: p.user_id != null,
      is_you: p.user_id != null && Number(p.user_id) === Number(user.id),
    })),
    positions,
    can_record: access.isParty,
  };
}

/**
 * Record the CALLER's position on one clause. `claimedUserId` is whatever the
 * request body said about whose position this is; anything but absent or the
 * caller's own id is refused.
 */
export async function recordPosition(
  env: Env,
  args: { documentId: number; user: User; clauseKey: string; position: unknown; note: unknown; claimedUserId: unknown },
) {
  const { documentId, user, clauseKey } = args;
  if (args.claimedUserId !== undefined && args.claimedUserId !== null && Number(args.claimedUserId) !== Number(user.id)) {
    return refusal(400, 'party_mismatch', 'A position is recorded for the signed-in account only. Nobody records one for another party.');
  }
  if (!(CLAUSE_KEYS as readonly string[]).includes(clauseKey)) {
    return refusal(400, 'invalid_clause', 'That clause is not part of the co-founder agreement.');
  }
  if (!(CLAUSE_POSITIONS as readonly unknown[]).includes(args.position)) {
    return refusal(400, 'invalid_position', 'A position is either "accepted" or "needs alignment".');
  }
  const access = await agreementAccess(env, documentId, user);
  if ('refused' in access) return access;
  if (!access.isParty) {
    return refusal(403, 'not_a_party', 'Only a founder named on this draft can record a position on it, and only their own.');
  }
  const note = typeof args.note === 'string' && args.note.trim() ? args.note.trim().slice(0, NOTE_MAX) : null;
  await env.DB.prepare(
    `INSERT INTO cofounder_clause_positions (document_id, clause_key, user_id, position, note)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (document_id, clause_key, user_id)
     DO UPDATE SET position = excluded.position, note = excluded.note, updated_at = datetime('now')`,
  ).bind(documentId, clauseKey, user.id, args.position, note).run();
  return listPositions(env, documentId, user);
}
