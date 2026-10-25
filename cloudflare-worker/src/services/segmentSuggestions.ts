/**
 * D1003 (#2818), Persona segments part 6: an Admin's suggestions, and HQ's
 * accept or decline (migration 570).
 *
 * WHO DOES WHAT. Any Admin suggests a change to a segment: who they are, a
 * need, an offer, a new segment, or something else, in up to 500 characters.
 * HQ's Super Admin decides it. Accept opens part 3's edit (D1000) with the
 * suggestion filled in, so the change itself is still HQ's write with its own
 * version and history; a decline carries one line the Admin reads.
 *
 * WHERE IT IS STORED, AND HOW IT TRAVELS (the escalation pattern, D243):
 *   - on HQ, an Admin's suggestion is HQ's row (`origin_code` 'hq');
 *   - on a subsidiary, the Admin's suggestion is written there and relayed to
 *     HQ over `BranchEntrypoint.segmentSuggestion`, which stores HQ's row with
 *     the subsidiary's code and uid. A relay that fails leaves the copy
 *     `undelivered`, with the reason, never lost;
 *   - HQ's decision goes back over `HqEntrypoint.applySegmentSuggestionAnswer`,
 *     and the subsidiary tells its Admin, whose account is on its database.
 *
 * NOTICES BOTH WAYS. A new suggestion tells HQ's Super Admins; a decision
 * tells the Admin who suggested. A notice that cannot be written never undoes
 * the suggestion or the decision: it is said in the answer instead.
 */
import type { Env } from '../types';
import { PERSONA_BY_ID } from '../personas';
import { branchOf } from '../util/branch';
import { getProfile } from './segmentProfiles';
import { branchByCode } from './branches';
import { notify } from './notify';

export const SUGGESTION_KINDS = ['who', 'need', 'offer', 'new_segment', 'other'] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];
export const SUGGESTION_STATUSES = ['open', 'accepted', 'declined'] as const;
export const TEXT_MAX = 500;
export const REASON_MAX = 200;
export const LIST_MAX = 200;
export const HQ_ORIGIN = 'hq';

export const SUGGESTIONS_LINK = '/admin/persona-segments';
export const NEW_TYPE = 'segment_suggestion_new';
export const DECIDED_TYPE = 'segment_suggestion_decided';

/** What part 3's edit opens on for each kind; a new segment opens New segment, which is not built yet. */
export const PREFILL_FIELD: Record<SuggestionKind, 'who' | 'needs' | 'offers' | null> = {
  who: 'who', need: 'needs', offer: 'offers', new_segment: null, other: null,
};

const KEY = /^[a-z0-9_]{1,64}$/;
const UID = /^[0-9a-f-]{8,64}$/i;

export class SuggestionError extends Error {
  readonly code: string;
  readonly sentence: string;
  readonly status: 400 | 403 | 404 | 409;
  constructor(code: string, sentence: string, status: 400 | 403 | 404 | 409 = 400) {
    super(sentence);
    this.code = code; this.sentence = sentence; this.status = status;
  }
}

export interface SuggestionInput { segment_key: string | null; kind: SuggestionKind; text: string }

interface Row {
  uid: string; segment_key: string | null; kind: SuggestionKind; text: string; status: string;
  decline_reason: string | null; suggested_by: number | null; suggested_by_name: string | null;
  origin_code: string; origin_ref: string | null; hq_uid: string | null; delivery: string; delivery_reason: string | null;
  decided_by_name: string | null; decided_at: string | null; push_ok: number | null; push_reason: string | null;
  created_at: string; updated_at: string;
}

const COLUMNS = `uid, segment_key, kind, text, status, decline_reason, suggested_by, suggested_by_name, origin_code, origin_ref,
  hq_uid, delivery, delivery_reason, decided_by_name, decided_at, push_ok, push_reason, created_at, updated_at`;

/** A suggestion as the routes return it. The Admin's account id stays on the deployment that holds it. */
export function viewOf(row: Row) {
  return {
    uid: row.uid,
    segment_key: row.segment_key,
    kind: row.kind,
    text: row.text,
    status: row.status,
    decline_reason: row.decline_reason,
    suggested_by_name: row.suggested_by_name,
    studio: row.origin_code,
    // On a subsidiary's copy: did it reach HQ, and if not, why.
    delivery: row.delivery,
    delivery_reason: row.delivery_reason,
    decided_by_name: row.decided_by_name,
    decided_at: row.decided_at,
    // On HQ's row from a subsidiary: did the decision reach it.
    pushed: row.origin_code === HQ_ORIGIN || row.status === 'open' ? null : row.push_ok == null ? null : row.push_ok === 1,
    push_reason: row.push_reason,
    created_at: row.created_at,
  };
}

const oneLine = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/** The body checked: a known kind, a segment that exists (except a new one), and text in bounds. */
export async function readInput(env: Env, body: Record<string, unknown> | null): Promise<SuggestionInput> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SuggestionError('invalid_body', 'Send the suggestion as an object.');
  const kind = String(body.kind ?? '') as SuggestionKind;
  if (!(SUGGESTION_KINDS as readonly string[]).includes(kind)) {
    throw new SuggestionError('invalid_kind', `Say what should change: one of ${SUGGESTION_KINDS.join(', ')}.`);
  }
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) throw new SuggestionError('text_required', 'Say what should change.');
  if (text.length > TEXT_MAX) throw new SuggestionError('invalid_text', `A suggestion is at most ${TEXT_MAX} characters.`);
  const raw = body.segment_key == null || body.segment_key === '' ? null : String(body.segment_key);
  if (kind !== 'new_segment' && !raw) throw new SuggestionError('segment_required', 'Name the segment the suggestion is about.');
  let segmentKey: string | null = null;
  if (raw) {
    if (!KEY.test(raw)) throw new SuggestionError('not_found', 'No segment is recorded with that key.', 404);
    // HQ's store, else the twelve in code (a subsidiary's store may lag HQ's).
    const known = (await getProfile(env, raw)) || (PERSONA_BY_ID as Record<string, unknown>)[raw];
    if (!known) throw new SuggestionError('not_found', 'No segment is recorded with that key.', 404);
    segmentKey = raw;
  }
  return { segment_key: segmentKey, kind, text };
}

async function rowByUid(env: Env, uid: string): Promise<Row | null> {
  return await env.DB.prepare(`SELECT ${COLUMNS} FROM segment_suggestions WHERE uid = ?`).bind(uid).first<Row>();
}

/** HQ's Super Admins, told of each new suggestion. */
async function superAdmins(env: Env): Promise<number[]> {
  const rows = (await env.DB.prepare(
    "SELECT u.id FROM super_admins s JOIN users u ON u.id = s.user_id WHERE u.role = 'admin' AND COALESCE(u.is_active, 1) = 1 ORDER BY u.id LIMIT 50",
  ).all<{ id: number }>()).results || [];
  return rows.map((r) => Number(r.id));
}

const segmentWords = (row: Pick<Row, 'segment_key' | 'kind'>) => (row.kind === 'new_segment' ? 'a new segment' : `the ${row.segment_key} segment`);

/** Tell HQ's Super Admins; how many were told, or why none were. */
async function noticeHq(env: Env, row: Row): Promise<{ told: number; reason?: string }> {
  let ids: number[];
  try { ids = await superAdmins(env); } catch (e) { return { told: 0, reason: `HQ's Super Admins could not be read: ${(e as Error).message}` }; }
  let told = 0;
  for (const userId of ids) {
    const id = await notify(env, {
      userId, type: NEW_TYPE,
      title: `A suggestion for ${segmentWords(row)}${row.origin_code === HQ_ORIGIN ? '' : ` from ${row.origin_code}`}`,
      body: row.text.slice(0, 300), link: SUGGESTIONS_LINK,
      payload: { suggestion_uid: row.uid, segment_key: row.segment_key, kind: row.kind },
    }).catch(() => null);
    if (id) told += 1;
  }
  return told ? { told } : { told: 0, reason: ids.length ? 'The notice could not be written to the bell.' : 'HQ has no Super Admin to tell.' };
}

/** Tell the Admin who suggested, on the deployment that holds their account. */
async function noticeAdmin(env: Env, row: Row): Promise<{ ok: boolean; reason?: string }> {
  const userId = Number(row.suggested_by);
  if (!Number.isInteger(userId) || userId <= 0) return { ok: false, reason: 'The suggestion does not record who made it, so nobody was told.' };
  const declined = row.status === 'declined';
  const id = await notify(env, {
    userId, type: DECIDED_TYPE,
    title: declined ? `HQ declined your suggestion for ${segmentWords(row)}` : `HQ accepted your suggestion for ${segmentWords(row)}`,
    body: declined ? row.decline_reason : 'HQ is making the change in the segment profile.',
    link: SUGGESTIONS_LINK,
    payload: { suggestion_uid: row.uid, status: row.status },
  }).catch(() => null);
  return id ? { ok: true } : { ok: false, reason: 'The notice could not be written to the bell.' };
}

type HqBinding = { segmentSuggestion?: (code: string, input: unknown) => Promise<unknown> };

/**
 * POST /suggestions — an Admin's suggestion. On HQ it is HQ's row and HQ's
 * Super Admins are told; on a subsidiary it is relayed to HQ first, and the
 * copy is written whether or not HQ answered.
 */
export async function suggest(env: Env, admin: { id: number; name?: string | null }, input: SuggestionInput) {
  const uid = crypto.randomUUID();
  const name = oneLine(admin.name).slice(0, 200) || null;
  const code = branchOf(env);
  if (!code) {
    await env.DB.prepare(
      `INSERT INTO segment_suggestions (uid, segment_key, kind, text, suggested_by, suggested_by_name, origin_code, delivery)
       VALUES (?, ?, ?, ?, ?, ?, 'hq', 'local')`,
    ).bind(uid, input.segment_key, input.kind, input.text, admin.id, name).run();
    const row = (await rowByUid(env, uid))!;
    const notice = await noticeHq(env, row);
    return { suggestion: viewOf(row), notice };
  }

  // A subsidiary: HQ first, so the copy carries HQ's uid from the start (D243).
  let hqUid: string | null = null;
  let reason: string | null = null;
  const hq = (env as unknown as { HQ?: HqBinding }).HQ;
  if (!hq || typeof hq.segmentSuggestion !== 'function') {
    reason = 'This Worker has no HQ service binding, so the suggestion is kept here and has not reached HQ.';
  } else {
    try {
      const res = await hq.segmentSuggestion(code, { uid, ...input, suggested_by_name: name }) as { uid?: unknown; refused?: unknown; reason?: unknown } | null;
      if (res && typeof res.refused === 'string') throw new SuggestionError(res.refused, String(res.reason || 'HQ refused the suggestion.'));
      hqUid = typeof res?.uid === 'string' ? res.uid : null;
      if (!hqUid) reason = 'HQ accepted the call but returned no suggestion id.';
    } catch (e) {
      if (e instanceof SuggestionError) throw e;
      reason = `HQ did not accept the suggestion: ${String((e as Error)?.message || e).slice(0, 200)}`;
    }
  }
  await env.DB.prepare(
    `INSERT INTO segment_suggestions (uid, segment_key, kind, text, suggested_by, suggested_by_name, origin_code, hq_uid, delivery, delivery_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(uid, input.segment_key, input.kind, input.text, admin.id, name, code, hqUid, hqUid ? 'delivered' : 'undelivered', reason).run();
  return { suggestion: viewOf((await rowByUid(env, uid))!), notice: null };
}

/**
 * HQ's side of a subsidiary's relay (`BranchEntrypoint.segmentSuggestion`).
 * A retry after a lost response finds the row it already stored. A refusal is
 * returned, not thrown, so the subsidiary does not store it as retryable.
 */
export async function recordFromBranch(env: Env, code: string, raw: Record<string, unknown>) {
  if (branchOf(env)) throw new Error('segmentSuggestion is only live on HQ');
  const ref = String(raw?.uid ?? '');
  if (!UID.test(ref)) return { refused: 'invalid_uid', reason: 'The suggestion has no id to store it under.' };
  let input: SuggestionInput;
  try { input = await readInput(env, raw); } catch (e) {
    if (e instanceof SuggestionError) return { refused: e.code, reason: e.sentence };
    throw e;
  }
  const uid = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO segment_suggestions (uid, segment_key, kind, text, suggested_by_name, origin_code, origin_ref, delivery)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'local')
     ON CONFLICT (origin_code, origin_ref) WHERE origin_ref IS NOT NULL DO NOTHING`,
  ).bind(uid, input.segment_key, input.kind, input.text, oneLine(raw?.suggested_by_name).slice(0, 200) || null, code, ref).run();
  const row = await env.DB.prepare(`SELECT ${COLUMNS} FROM segment_suggestions WHERE origin_code = ? AND origin_ref = ?`).bind(code, ref).first<Row>();
  if (!row) throw new Error('segmentSuggestion: the row was not stored');
  if (row.uid === uid) await noticeHq(env, row);
  return { uid: row.uid };
}

/**
 * GET /suggestions. HQ's Super Admin reads every suggestion HQ holds; any
 * other Admin reads their own. Newest first, at most LIST_MAX.
 */
export async function listSuggestions(env: Env, viewer: { id: number; superAdmin: boolean }, status: string | null) {
  const s = status && (SUGGESTION_STATUSES as readonly string[]).includes(status) ? status : null;
  const all = viewer.superAdmin && !branchOf(env);
  const rows = (await env.DB.prepare(
    `SELECT ${COLUMNS} FROM segment_suggestions
      WHERE (? IS NULL OR status = ?) AND (? = 1 OR suggested_by = ?)
      ORDER BY created_at DESC, id DESC LIMIT ?`,
  ).bind(s, s, all ? 1 : 0, viewer.id, LIST_MAX).all<Row>()).results || [];
  return { suggestions: rows.map(viewOf), scope: all ? 'all' : 'mine' };
}

/**
 * POST /suggestions/:uid/decide — HQ's Super Admin accepts or declines.
 * Accept answers with what part 3's edit opens on; decline needs one line.
 * The decision is guarded on `open`, so a second decision changes nothing.
 */
export async function decide(
  env: Env, admin: { id: number; name?: string | null }, uid: string, body: Record<string, unknown> | null,
) {
  if (!UID.test(uid)) throw new SuggestionError('not_found', 'No suggestion is recorded with that id.', 404);
  const decision = String(body?.decision ?? '');
  if (decision !== 'accept' && decision !== 'decline') throw new SuggestionError('invalid_decision', 'Accept or decline the suggestion.');
  const reason = oneLine(body?.reason);
  if (decision === 'decline' && !reason) throw new SuggestionError('reason_required', 'Say in one line why it is declined. The Admin reads it.');
  if (reason.length > REASON_MAX) throw new SuggestionError('invalid_reason', `The line is at most ${REASON_MAX} characters.`);
  const before = await rowByUid(env, uid);
  if (!before) throw new SuggestionError('not_found', 'No suggestion is recorded with that id.', 404);
  const status = decision === 'accept' ? 'accepted' : 'declined';
  const name = oneLine(admin.name).slice(0, 200) || null;
  const res = await env.DB.prepare(
    `UPDATE segment_suggestions SET status = ?, decline_reason = ?, decided_by = ?, decided_by_name = ?,
        decided_at = datetime('now'), updated_at = datetime('now')
      WHERE uid = ? AND status = 'open'`,
  ).bind(status, decision === 'decline' ? reason : null, admin.id, name, uid).run();
  if (!Number(res?.meta?.changes ?? 0)) throw new SuggestionError('already_decided', 'This suggestion was already decided.', 409);
  const row = (await rowByUid(env, uid))!;

  // The notice: here for HQ's own Admins, pushed to the subsidiary for theirs.
  let notice: { ok: boolean; reason?: string };
  if (row.origin_code === HQ_ORIGIN) notice = await noticeAdmin(env, row);
  else {
    notice = { ok: false, reason: `No Worker is bound for ${row.origin_code}, so the decision is recorded at HQ and was not sent.` };
    const binding = branchByCode(env, row.origin_code);
    if (binding) {
      try {
        const pushed = await (binding.stub as any).applySegmentSuggestionAnswer({
          hq_uid: row.uid, status: row.status, decline_reason: row.decline_reason,
          decided_by_name: row.decided_by_name, decided_at: row.decided_at, pushed_at: new Date().toISOString(),
        }) as { ok?: boolean; reason?: string } | null;
        notice = pushed && typeof pushed === 'object' && 'ok' in pushed ? { ok: Boolean(pushed.ok), reason: pushed.reason } : { ok: true };
      } catch (e) {
        notice = { ok: false, reason: `The subsidiary did not accept the decision: ${String((e as Error)?.message || e).slice(0, 200)}` };
      }
    }
    await env.DB.prepare('UPDATE segment_suggestions SET push_ok = ?, push_reason = ?, updated_at = datetime(\'now\') WHERE uid = ?')
      .bind(notice.ok ? 1 : 0, notice.ok ? null : notice.reason ?? null, uid).run();
  }

  // Accept opens part 3's edit, filled in. The edit is HQ's write, with its own version and history.
  let edit: Record<string, unknown> | null = null;
  if (status === 'accepted') {
    const profile = row.segment_key ? await getProfile(env, row.segment_key) : null;
    edit = row.kind === 'new_segment'
      ? { new_segment: true, segment_key: null, expected_version: null, field: null, text: row.text }
      : { new_segment: false, segment_key: row.segment_key, expected_version: profile?.version ?? null, field: PREFILL_FIELD[row.kind], text: row.text };
  }
  return { suggestion: viewOf((await rowByUid(env, uid))!), edit, notice };
}

/**
 * A subsidiary's side of HQ's push (`HqEntrypoint.applySegmentSuggestionAnswer`):
 * the copy takes HQ's decision and its Admin is told. No row is invented for
 * an HQ uid this subsidiary never sent.
 */
export async function applyAnswer(env: Env, a: Record<string, unknown>): Promise<{ ok: boolean; reason?: string }> {
  if (!branchOf(env)) throw new Error('applySegmentSuggestionAnswer is only live on a subsidiary');
  const hqUid = String(a?.hq_uid ?? '').trim();
  if (!UID.test(hqUid)) throw new Error('applySegmentSuggestionAnswer: hq_uid is required');
  const status = a?.status === 'declined' ? 'declined' : a?.status === 'accepted' ? 'accepted' : null;
  if (!status) return { ok: false, reason: 'The decision is neither accepted nor declined.' };
  const reason = status === 'declined' ? oneLine(a?.decline_reason).slice(0, REASON_MAX) || 'HQ gave no reason.' : null;
  const res = await env.DB.prepare(
    `UPDATE segment_suggestions SET status = ?, decline_reason = ?, decided_by_name = ?, decided_at = ?, updated_at = datetime('now')
      WHERE hq_uid = ? AND status = 'open'`,
  ).bind(status, reason, oneLine(a?.decided_by_name).slice(0, 200) || null, String(a?.decided_at ?? '') || null, hqUid).run();
  if (!Number(res?.meta?.changes ?? 0)) {
    const known = await env.DB.prepare('SELECT 1 AS x FROM segment_suggestions WHERE hq_uid = ?').bind(hqUid).first();
    return known ? { ok: true } : { ok: false, reason: `This subsidiary sent no suggestion with HQ uid ${hqUid}, so there is nothing to answer.` };
  }
  const row = await env.DB.prepare(`SELECT ${COLUMNS} FROM segment_suggestions WHERE hq_uid = ?`).bind(hqUid).first<Row>();
  const told = row ? await noticeAdmin(env, row) : { ok: false };
  return { ok: true, ...(told.ok ? {} : { reason: `Recorded; the Admin was not told: ${told.reason}` }) };
}
