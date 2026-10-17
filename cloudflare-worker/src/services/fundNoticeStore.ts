// D716 (#1781, PR 1) — the notice record and its kept files (migration 478).
//
// - `issueNotice` builds the figures again, checks the digest the issuer
//   saw, and writes one append-only `legal_notices` row. The same figures as
//   the head of the source's chain answer `already_issued` and write nothing;
//   different figures need a reason and write a row that supersedes the head.
//   A UNIQUE conflict reads the head back, so two presses write one row.
// - `issueCallNotices` issues one notice per line of a call, all or none, in
//   one `DB.batch`, only after every line's figures are built with no refusal.
// - `noticeFile` draws the paper through #1776's `renderLegalPdf(…, {
//   fallback: false })`, never pdf-lib, keeps it in R2 under
//   `fund-notices/<notice uid>/<file uid>.pdf`, and records it once per stamp.
//
// `logAdminAction` runs after a write lands, with ids, the type and the
// reference only. No row, log or response here holds a full account number.
//
// NOTE: authored to load under `node --experimental-strip-types` (the worker
// test gate) — no `enum`s, no TS parameter properties.

import type { Env } from '../types';
import { auditFundAct } from './fundAdminAccess';
import {
  NoticeRefusal, buildNoticeFigures, figuresDigest, noticePaperInput, sha256Hex,
  type NoticeFigures, type NoticeRequest,
} from './fundNotices';
import { paperModel, paperSha256 } from './legalPaper';
import { renderLegalPdf } from './legalPaperRender';
import { readPaperChoice } from './legalPaperCss';

export interface NoticeRow {
  id: number;
  uid: string;
  notice_type: string;
  source_ref: string;
  fund_id: number | null;
  limited_partner_id: number | null;
  sender_entity: string;
  payee_entity: string | null;
  purpose: string | null;
  bank_account_uid: string | null;
  account_last4: string | null;
  reference: string | null;
  amount_cents: number | null;
  page_size: 'letter' | 'a4';
  figures_json: string;
  figures_sha256: string;
  template_slug: string | null;
  template_version: number | null;
  supersedes_id: number | null;
  reason: string | null;
  issued_by: number | null;
  created_at: string;
}

const today = () => new Date().toISOString().slice(0, 10);

/** The head of a source's chain: the row nothing supersedes. */
async function headOf(env: Env, type: string, sourceRef: string): Promise<NoticeRow | null> {
  return env.DB.prepare(
    `SELECT n.* FROM legal_notices n
      WHERE n.notice_type = ? AND n.source_ref = ?
        AND NOT EXISTS (SELECT 1 FROM legal_notices s WHERE s.supersedes_id = n.id)
      ORDER BY n.id DESC LIMIT 1`,
  ).bind(type, sourceRef).first<NoticeRow>();
}

function insertStatement(env: Env, f: NoticeFigures, digest: string, pageSize: string, uid: string, supersedesId: number | null, reason: string | null, actor: number): D1PreparedStatement {
  const pay = f.payment && !('refusal' in f.payment) ? f.payment : null;
  return env.DB.prepare(
    `INSERT INTO legal_notices
       (uid, notice_type, source_ref, fund_id, limited_partner_id, sender_entity, payee_entity, purpose,
        bank_account_uid, account_last4, reference, amount_cents, page_size, figures_json, figures_sha256,
        template_slug, template_version, supersedes_id, reason, issued_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    uid, f.type, f.source_ref, f.fund_id, f.limited_partner_id, f.sender, f.payee, f.purpose,
    pay?.account_uid ?? null, pay?.account_last4 ?? null, f.reference, f.amount_cents, pageSize, JSON.stringify(f), digest,
    f.prose?.slug ?? null, f.prose?.version ?? null, supersedesId, reason, actor,
  );
}

const isUniqueConflict = (e: unknown) => /UNIQUE constraint failed/i.test(String((e as Error)?.message ?? e));

export interface IssueInput extends NoticeRequest {
  page_size?: unknown;
  figures_sha256?: unknown;
  reason?: unknown;
}

function readReason(v: unknown): string | null {
  if (v == null) return null;
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < 1 || s.length > 200) throw new NoticeRefusal(400, 'reason_invalid', 'Give a reason of 1 to 200 characters.');
  return s;
}

function readPageSize(v: unknown): 'letter' | 'a4' {
  const p = readPaperChoice(v, null);
  if (!p.ok) throw new NoticeRefusal(400, p.code, 'page_size must be letter or a4.');
  return p.pageSize;
}

/** Issue one notice. Answers the row and whether it already existed. */
export async function issueNotice(env: Env, user: any, input: IssueInput, day = today()):
  Promise<{ notice: NoticeRow; already_issued: boolean }> {
  const pageSize = readPageSize(input.page_size);
  const reason = readReason(input.reason);
  if (input.type === 'management_fee_statement') {
    throw new NoticeRefusal(409, 'statement_not_issued_here', 'A fee statement reaches an LP through the reporting queue, not here.');
  }
  const built = await buildNoticeFigures(env, input, day);
  if (built.figures.source_ref.startsWith('proposed:')) {
    throw new NoticeRefusal(409, 'proposed_call_not_issued', 'A proposed call previews only; issue the call, then its notices.');
  }
  if (built.refusal) throw new NoticeRefusal(409, built.refusal.code, built.refusal.message, built.refusal.extra);
  const digest = await figuresDigest(built.figures);
  if (input.figures_sha256 !== digest) {
    throw new NoticeRefusal(409, 'content_changed', 'The figures changed since the preview. Preview again, then issue.');
  }
  const head = await headOf(env, built.figures.type, built.figures.source_ref);
  if (head && head.figures_sha256 === digest) return { notice: head, already_issued: true };
  if (head && !reason) {
    throw new NoticeRefusal(409, 'reason_required', 'This source already has a notice with other figures. Give a reason to issue a superseding one.');
  }
  const uid = crypto.randomUUID();
  try {
    await insertStatement(env, built.figures, digest, pageSize, uid, head ? head.id : null, head ? reason : null, Number(user.id)).run();
  } catch (e) {
    if (!isUniqueConflict(e)) throw e;
    const now = await headOf(env, built.figures.type, built.figures.source_ref);
    if (now && now.figures_sha256 === digest) return { notice: now, already_issued: true };
    throw new NoticeRefusal(409, 'content_changed', 'Another notice for this source was issued at the same moment. Preview again.');
  }
  const notice = (await env.DB.prepare('SELECT * FROM legal_notices WHERE uid = ?').bind(uid).first<NoticeRow>())!;
  await auditFundAct(env, user, 'fund_notice.issue', {
    notice_uid: uid, notice_type: notice.notice_type, reference: notice.reference, fund_id: notice.fund_id,
    limited_partner_id: notice.limited_partner_id, supersedes: head ? head.uid : null,
  });
  return { notice, already_issued: false };
}

/** A call's lines, in order, with the call header. */
async function callLines(env: Env, callUid: string) {
  const call = await env.DB.prepare('SELECT id, fund_id, call_number FROM fund_capital_calls WHERE uid = ?')
    .bind(callUid).first<{ id: number; fund_id: number; call_number: number }>();
  if (!call) throw new NoticeRefusal(404, 'source_not_found', 'No capital call here.');
  const lines = (await env.DB.prepare('SELECT id FROM capital_calls WHERE fund_call_id = ? ORDER BY id').bind(call.id).all<{ id: number }>()).results || [];
  return { call, lines };
}

/** Each line's figures, and one digest over them. Refuses on the first line that cannot issue. */
export async function previewCallNotices(env: Env, callUid: string, day = today()) {
  const { call, lines } = await callLines(env, callUid);
  const built = [];
  for (const l of lines) {
    try {
      const b = await buildNoticeFigures(env, { type: 'capital_call_notice', source: { line_id: l.id } }, day);
      built.push({ line_id: l.id, figures: b.figures, figures_sha256: await figuresDigest(b.figures), refusal: b.refusal });
    } catch (e) {
      if (e instanceof NoticeRefusal) built.push({ line_id: l.id, figures: null, figures_sha256: null, refusal: { code: e.code, message: e.publicMessage } });
      else throw e;
    }
  }
  const digest = await sha256Hex(built.map((b) => `${b.line_id}:${b.figures_sha256 ?? 'refused'}`).join('\n'));
  return { call: { uid: callUid, call_number: call.call_number, fund_id: call.fund_id }, lines: built, digest };
}

/** Issue every line's notice of a call, all or none. */
export async function issueCallNotices(env: Env, user: any, callUid: string, input: { page_size?: unknown; digest?: unknown }, day = today()) {
  const pageSize = readPageSize(input.page_size);
  const preview = await previewCallNotices(env, callUid, day);
  const refused = preview.lines.find((l) => l.refusal);
  if (refused) {
    throw new NoticeRefusal(409, refused.refusal!.code, refused.refusal!.message, { line_id: refused.line_id });
  }
  if (input.digest !== preview.digest) {
    throw new NoticeRefusal(409, 'content_changed', 'The figures changed since the preview. Preview again, then issue.');
  }
  const writes: D1PreparedStatement[] = [];
  const uids: string[] = [];
  for (const l of preview.lines) {
    const head = await headOf(env, 'capital_call_notice', l.figures!.source_ref);
    if (head && head.figures_sha256 === l.figures_sha256) continue;
    if (head) {
      throw new NoticeRefusal(409, 'content_changed', 'A line already has a notice with other figures. Issue that line on its own, with a reason.', { line_id: l.line_id });
    }
    const uid = crypto.randomUUID();
    uids.push(uid);
    writes.push(insertStatement(env, l.figures!, l.figures_sha256!, pageSize, uid, null, null, Number(user.id)));
  }
  if (!writes.length) return { already_issued: true, notices: await noticesBySource(env, preview.lines.map((l) => l.figures!.source_ref)) };
  try {
    await env.DB.batch(writes);
  } catch (e) {
    if (!isUniqueConflict(e)) throw e;
    throw new NoticeRefusal(409, 'content_changed', 'Another issue for this call landed at the same moment. Preview again.');
  }
  for (const uid of uids) {
    await auditFundAct(env, user, 'fund_notice.issue', { notice_uid: uid, notice_type: 'capital_call_notice', call_uid: callUid });
  }
  return { already_issued: false, notices: await noticesBySource(env, preview.lines.map((l) => l.figures!.source_ref)) };
}

async function noticesBySource(env: Env, refs: string[]): Promise<NoticeRow[]> {
  const out: NoticeRow[] = [];
  for (const ref of refs) {
    const head = await headOf(env, 'capital_call_notice', ref);
    if (head) out.push(head);
  }
  return out;
}

// ---------------------------------------------------------------- reads

export function noticeSummary(n: NoticeRow & { superseded?: number }) {
  return {
    uid: n.uid, type: n.notice_type, reference: n.reference, amount_cents: n.amount_cents, fund_id: n.fund_id,
    limited_partner_id: n.limited_partner_id, notice_date: (JSON.parse(n.figures_json) as NoticeFigures).notice_date,
    title: (JSON.parse(n.figures_json) as NoticeFigures).title, superseded: !!n.superseded, created_at: n.created_at,
  };
}

export async function listNotices(env: Env, filter: { fund_id?: number | null; lp_id?: number | null } = {}) {
  const rows = await env.DB.prepare(
    `SELECT n.*, EXISTS (SELECT 1 FROM legal_notices s WHERE s.supersedes_id = n.id) AS superseded
       FROM legal_notices n
      WHERE (? IS NULL OR n.fund_id = ?) AND (? IS NULL OR n.limited_partner_id = ?)
      ORDER BY n.id DESC LIMIT 500`,
  ).bind(filter.fund_id ?? null, filter.fund_id ?? null, filter.lp_id ?? null, filter.lp_id ?? null).all<NoticeRow & { superseded: number }>();
  return (rows.results || []).map(noticeSummary);
}

export async function readNotice(env: Env, uid: string): Promise<(NoticeRow & { superseded: number }) | null> {
  return env.DB.prepare(
    `SELECT n.*, EXISTS (SELECT 1 FROM legal_notices s WHERE s.supersedes_id = n.id) AS superseded
       FROM legal_notices n WHERE n.uid = ?`,
  ).bind(uid).first<NoticeRow & { superseded: number }>();
}

/** The LP's own notices: addressed to a `limited_partners` row whose user is the caller. */
export async function myNotices(env: Env, userId: number) {
  const rows = await env.DB.prepare(
    `SELECT n.*, EXISTS (SELECT 1 FROM legal_notices s WHERE s.supersedes_id = n.id) AS superseded
       FROM legal_notices n JOIN limited_partners lp ON lp.id = n.limited_partner_id
      WHERE lp.user_id = ? ORDER BY n.id DESC LIMIT 500`,
  ).bind(userId).all<NoticeRow & { superseded: number }>();
  return rows.results || [];
}

export async function myNotice(env: Env, userId: number, uid: string) {
  return env.DB.prepare(
    `SELECT n.*, EXISTS (SELECT 1 FROM legal_notices s WHERE s.supersedes_id = n.id) AS superseded
       FROM legal_notices n JOIN limited_partners lp ON lp.id = n.limited_partner_id
      WHERE lp.user_id = ? AND n.uid = ?`,
  ).bind(userId, uid).first<NoticeRow & { superseded: number }>();
}

// ---------------------------------------------------------------- the file

/** The notice's kept PDF for its current stamp, drawn and kept on the first download. */
export async function noticeFile(env: Env, notice: NoticeRow & { superseded: number }): Promise<{ bytes: Uint8Array; filename: string }> {
  const stamp: 'issued' | 'superseded' = notice.superseded ? 'superseded' : 'issued';
  const filename = `${notice.notice_type}-${notice.uid}${stamp === 'superseded' ? '-superseded' : ''}.pdf`.replace(/[^A-Za-z0-9_.-]/g, '-');
  if (!env.FILES) throw new NoticeRefusal(503, 'notice_render_unavailable', 'The notice PDF cannot be kept right now. Try again.');
  const kept = async () => {
    const row = await env.DB.prepare('SELECT r2_key FROM legal_notice_files WHERE notice_id = ? AND stamp = ?')
      .bind(notice.id, stamp).first<{ r2_key: string }>();
    if (!row) return null;
    const obj = await env.FILES!.get(row.r2_key);
    return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
  };
  const existing = await kept();
  if (existing) return { bytes: existing, filename };

  const figures = JSON.parse(notice.figures_json) as NoticeFigures;
  const model = paperModel(noticePaperInput(figures, { issued: { uid: notice.uid, stamp, figures_sha256: notice.figures_sha256 } }));
  const rendered = await renderLegalPdf(env, model, { pageSize: notice.page_size, cover: 'light', fallback: false });
  if (!rendered.ok) {
    throw new NoticeRefusal(503, 'notice_render_unavailable', 'The notice PDF could not be drawn right now. Try again in a moment.');
  }
  const fileUid = crypto.randomUUID();
  const key = `fund-notices/${notice.uid}/${fileUid}.pdf`;
  await env.FILES.put(key, rendered.bytes, {
    httpMetadata: { contentType: 'application/pdf' },
    customMetadata: { notice_uid: notice.uid, notice_type: notice.notice_type, figures_sha256: notice.figures_sha256 },
  });
  const res = await env.DB.prepare(
    `INSERT INTO legal_notice_files (uid, notice_id, stamp, file_sha256, file_bytes, page_size, renderer, paper_sha256, r2_key)
     VALUES (?, ?, ?, ?, ?, ?, 'browser_run', ?, ?)
     ON CONFLICT (notice_id, stamp) DO NOTHING`,
  ).bind(fileUid, notice.id, stamp, await sha256Bytes(rendered.bytes), rendered.bytes.length, notice.page_size, await paperSha256(), key).run();
  if (!(res.meta?.changes && res.meta.changes > 0)) {
    // Another download kept its file first: drop ours and serve the winner's.
    try { await env.FILES.delete(key); } catch { /* the object is orphaned, never served */ }
    const winner = await kept();
    if (winner) return { bytes: winner, filename };
  }
  return { bytes: rendered.bytes, filename };
}

async function sha256Bytes(b: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', b);
  return Array.from(new Uint8Array(buf)).map((x) => x.toString(16).padStart(2, '0')).join('');
}
