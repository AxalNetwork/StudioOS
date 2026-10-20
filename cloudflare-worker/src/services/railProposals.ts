/**
 * `ai_rail_proposals` (migration 506): what a rail option's run leaves for the
 * member to decide, and the member's decision (D780, #2105; D720 §7 and §9).
 *
 * "EADWYN DRAFTS; YOU SEND." A run never writes its output into a record. It
 * calls `proposeRail`, and the row waits. The member's press calls
 * `decideRail`: accept keeps it as Eadwyn wrote it, edit keeps the member's
 * version beside the original, discard throws it away. Writing the kept value
 * into a record is the record's own route, called by the member's Save, never
 * this file.
 *
 * WHO CALLS IT. Every rail option outside Validate (`validate_proposals`) and
 * the zone drafts (`research_zone_drafts`): D780's own two (the Super Admin's
 * `draft:publication-summary` and `draft:legal/notes`), and the other option
 * tasks (D778, D779) as they land.
 *
 * WHAT IT REFUSES.
 *   · A proposal for a field Eadwyn never fills (D777's registry): a payload
 *     that names its `field` is checked before it is stored.
 *   · Another member's row: every read and every decision binds `user_id`.
 *   · A second decision: a row is decided once, atomically
 *     (`WHERE status = 'proposed'`), so two presses cannot both keep it.
 */
import type { Env } from '../types';
import { railOptionKey, railPageKey, railRecordKey } from './aiRouter';
import { neverFillReason } from './fills/neverFill';

export type RailProposalKind = 'draft' | 'proposal' | 'note';
export type RailProposalStatus = 'proposed' | 'accepted' | 'edited' | 'discarded' | 'withdrawn';
export const RAIL_PROPOSAL_KINDS: readonly RailProposalKind[] = ['draft', 'proposal', 'note'];
export type RailDecision = 'accept' | 'edit' | 'discard';

/** The longest payload stored, as JSON. A wall of text is not a proposal. */
export const MAX_PAYLOAD_CHARS = 16000;

export interface RailProposal {
  uid: string;
  rail_page: string;
  rail_option: string;
  record_ref: string | null;
  kind: RailProposalKind;
  payload: Record<string, unknown>;
  model: string | null;
  usage_log_id: number | null;
  status: RailProposalStatus;
  decided_payload: Record<string, unknown> | null;
  decided_at: string | null;
  created_at: string;
}

type Row = {
  uid: string; rail_page: string; rail_option: string; record_ref: string | null;
  kind: RailProposalKind; payload_json: string; model: string | null; usage_log_id: number | null;
  status: RailProposalStatus; decided_payload_json: string | null; decided_at: string | null; created_at: string;
};

const parse = (s: string | null): Record<string, unknown> | null => {
  if (!s) return null;
  try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : null; } catch { return null; }
};

function toProposal(r: Row): RailProposal {
  return {
    uid: r.uid, rail_page: r.rail_page, rail_option: r.rail_option, record_ref: r.record_ref,
    kind: r.kind, payload: parse(r.payload_json) || {}, model: r.model, usage_log_id: r.usage_log_id,
    status: r.status, decided_payload: parse(r.decided_payload_json), decided_at: r.decided_at, created_at: r.created_at,
  };
}

export interface ProposeInput {
  userId: number;
  page: string;
  option: string;
  record?: string | null;
  kind: RailProposalKind;
  payload: Record<string, unknown>;
  model?: string | null;
  usageLogId?: number | null;
}

/**
 * Why a proposal may not be stored, or null when it may. A reason rather than a
 * boolean, so a caller can say what was refused.
 */
export function proposeRefusal(input: ProposeInput): string | null {
  if (!Number.isSafeInteger(input.userId) || input.userId <= 0) return 'no member';
  if (!railPageKey(input.page)) return 'not a rail page';
  if (!railOptionKey(input.option)) return 'not a rail option';
  if (input.record != null && !railRecordKey(input.record)) return 'not a record';
  if (!RAIL_PROPOSAL_KINDS.includes(input.kind)) return 'not a kind';
  if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) return 'no payload';
  if (JSON.stringify(input.payload).length > MAX_PAYLOAD_CHARS) return 'payload too long';
  const field = input.payload.field;
  if (typeof field === 'string' && neverFillReason(field)) return 'a field Eadwyn never fills';
  return null;
}

/** Store what a run proposed. Throws with the refusal's reason; returns the new row. */
export async function proposeRail(env: Env, input: ProposeInput): Promise<RailProposal> {
  const why = proposeRefusal(input);
  if (why) throw new Error(`ai_rail_proposals: ${why}`);
  const uid = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO ai_rail_proposals
       (uid, user_id, rail_page, rail_option, record_ref, kind, payload_json, model, usage_log_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    uid, input.userId, railPageKey(input.page), railOptionKey(input.option),
    input.record != null ? railRecordKey(input.record) : null, input.kind,
    JSON.stringify(input.payload), input.model ?? null, input.usageLogId ?? null,
  ).run();
  const row = await getRail(env, input.userId, uid);
  if (!row) throw new Error('ai_rail_proposals: the row could not be read back');
  return row;
}

/** One of the member's own proposals, by uid, or null. */
export async function getRail(env: Env, userId: number, uid: string): Promise<RailProposal | null> {
  // Literal SQL throughout this file, so the schema guards can read every statement.
  const row = await env.DB.prepare(
    `SELECT uid, rail_page, rail_option, record_ref, kind, payload_json, model, usage_log_id,
            status, decided_payload_json, decided_at, created_at
       FROM ai_rail_proposals WHERE uid = ? AND user_id = ?`,
  ).bind(uid, userId).first<Row>();
  return row ? toProposal(row) : null;
}

/** The member's own proposals for one option, newest first; `record` and `status` narrow them. */
export async function listRail(env: Env, userId: number, q: { option: string; record?: string | null; status?: RailProposalStatus | null }): Promise<RailProposal[]> {
  const option = railOptionKey(q.option);
  if (!option) return [];
  const record = q.record != null ? railRecordKey(q.record) : null;
  if (q.record != null && !record) return [];
  // A null filter matches every row: `? IS NULL OR column = ?`, bound twice.
  const r = await env.DB.prepare(
    `SELECT uid, rail_page, rail_option, record_ref, kind, payload_json, model, usage_log_id,
            status, decided_payload_json, decided_at, created_at
       FROM ai_rail_proposals
      WHERE user_id = ? AND rail_option = ?
        AND (? IS NULL OR record_ref = ?)
        AND (? IS NULL OR status = ?)
      ORDER BY id DESC LIMIT 50`,
  ).bind(userId, option, record, record, q.status || null, q.status || null).all<Row>();
  return (r.results || []).map(toProposal);
}

/**
 * The member's press on one of their own proposals. Returns the decided row,
 * or null when there is no such proposal of theirs or it was already decided.
 * `edit` needs the member's version, and records it beside Eadwyn's.
 */
export async function decideRail(env: Env, userId: number, uid: string, decision: RailDecision, edited?: Record<string, unknown> | null): Promise<RailProposal | null> {
  const status: RailProposalStatus | null = decision === 'accept' ? 'accepted' : decision === 'edit' ? 'edited' : decision === 'discard' ? 'discarded' : null;
  if (!status) return null;
  if (status === 'edited' && (!edited || typeof edited !== 'object' || JSON.stringify(edited).length > MAX_PAYLOAD_CHARS)) return null;
  const res = await env.DB.prepare(
    `UPDATE ai_rail_proposals
        SET status = ?, decided_payload_json = ?, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE uid = ? AND user_id = ? AND status = 'proposed'`,
  ).bind(status, status === 'edited' ? JSON.stringify(edited) : null, uid, userId).run();
  if (!res.meta?.changes) return null;
  return getRail(env, userId, uid);
}

/** The platform takes back a member's open proposals on a record that moved on. Returns how many. */
export async function withdrawRail(env: Env, userId: number, option: string, record: string): Promise<number> {
  const o = railOptionKey(option);
  const r = railRecordKey(record);
  if (!o || !r) return 0;
  const res = await env.DB.prepare(
    `UPDATE ai_rail_proposals SET status = 'withdrawn', updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND rail_option = ? AND record_ref = ? AND status = 'proposed'`,
  ).bind(userId, o, r).run();
  return Number(res.meta?.changes || 0);
}
