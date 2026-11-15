/**
 * D6199 (#6199) — the investor's own part of a closing read: what waits on
 * them, a count of the rest, and after Closed their own summary and the
 * reporting duties on their own lines.
 *
 * `readClosing` (closings.ts) calls this only when the caller reaches the
 * closing through a line of their own (`reach: 'own'`), and passes only those
 * lines. Every query below is narrowed again to the caller: the paper by the
 * caller's own commitments on this deal, the signed copy by the caller's own
 * signing stage, the duties by `holder_user_id` and the caller's own line ids.
 * Of the rest of the round the caller gets one number: how many other lines
 * are not yet received or withdrawn. Never a name, an amount, a route or a uid.
 *
 * NOT COUNTED. The deal's closing checklist (`deal_closing_checklist_items`)
 * and IC conditions (`ic_conditions`) are the studio team's and counsel's: no
 * row, label or count of either reaches an investor.
 *
 * Every value from the request is bound; the id lists go through `json_each`.
 */
import type { Env, User } from '../types';
import { KIND_WORDS, type Kind } from './reportingDuties';

export type OwnLine = {
  id: number; uid: string; commitment_id: number | null; route: string | null;
  amount_cents: number | null; currency: string | null; status: string;
};
export type OwnEvidence = { side: string | null; withdrawn_at: string | null; created_at: string | null };
type ClosingRef = { id: number; deal_id: number; project_id: number; status: string };

/** A step that waits on the investor now: signing their stage, or sending the payment once the paper is signed. */
export type WaitingStep = { line_uid: string; step: 'sign' | 'send_payment' };

type StageRow = {
  staged_id: number; commitment_id: number; voided_at: string | null; position: number; role: string; user_id: number | null;
  envelope_uuid: string | null; signed_at: string | null; esign_id: number | null; esign_status: string | null;
  signed_r2_key: string | null; declined: number | null;
};

const parse = (raw: unknown): any[] => { try { const v = JSON.parse(String(raw ?? '[]')); return Array.isArray(v) ? v : []; } catch { return []; } };

/** The newest staged envelope on each commitment that is not void, with its stages in order. */
function livePapers(rows: StageRow[]): Map<number, StageRow[]> {
  const out = new Map<number, StageRow[]>();
  const chosen = new Map<number, number>();
  for (const r of rows) {
    if (r.voided_at) continue;
    const cid = Number(r.commitment_id);
    if (!chosen.has(cid)) chosen.set(cid, Number(r.staged_id));
    if (chosen.get(cid) !== Number(r.staged_id)) continue;
    const list = out.get(cid) || [];
    list.push(r);
    out.set(cid, list);
  }
  for (const list of out.values()) list.sort((a, b) => Number(a.position) - Number(b.position));
  return out;
}

const stageDead = (s: StageRow) => s.esign_status === 'void' || Number(s.declined ?? 0) > 0;

/**
 * The caller's part of the closing. `lines` are the caller's own lines (every
 * status); `evidence` is theirs by line id; `captable` the proposal's state.
 */
export async function investorRoom(env: Env, user: User, closing: ClosingRef, lines: OwnLine[], evidence: Map<number, OwnEvidence[]>, captable: string) {
  const me = Number(user.id);
  const live = lines.filter((l) => l.status !== 'withdrawn');
  const commitments = live.map((l) => l.commitment_id).filter((x): x is number => x != null).map(Number);

  const project = await env.DB.prepare('SELECT uid FROM projects WHERE id = ? AND deleted_at IS NULL').bind(closing.project_id).first<{ uid: string }>();

  // The paper on the caller's own commitments of this deal only.
  const stageRows = commitments.length ? ((await env.DB.prepare(
    `SELECT s.id AS staged_id, s.commitment_id, s.voided_at, g.position, g.role, g.user_id, g.envelope_uuid, g.signed_at,
            e.id AS esign_id, e.status AS esign_status, e.signed_r2_key,
            (SELECT COUNT(*) FROM esign_recipients r WHERE r.envelope_id = e.id AND r.status = 'rejected') AS declined
       FROM esign_staged_envelopes s
       JOIN esign_staged_signers g ON g.staged_id = s.id
       LEFT JOIN esign_envelopes e ON e.envelope_uuid = g.envelope_uuid
      WHERE s.deal_id = ? AND s.commitment_id IN (SELECT value FROM json_each(?))
      ORDER BY s.id DESC, g.position`,
  ).bind(closing.deal_id, JSON.stringify(commitments)).all<StageRow>()).results || []) : [];
  const papers = livePapers(stageRows);

  const waiting: WaitingStep[] = [];
  let yourLines = 0;
  const summary = [];
  for (const l of live) {
    const stages = l.commitment_id == null ? null : (papers.get(Number(l.commitment_id)) || []);
    const complete = stages != null && stages.length > 0 && stages.every((s) => !!s.signed_at);
    // The five steps on a commitment line (three on a prospect line, which has no paper here).
    if (!l.route) yourLines += 1;
    if (stages != null) {
      if (!stages.length) yourLines += 2; // the paper and its signing
      else if (!complete) {
        const next = stages.find((s) => !s.signed_at)!;
        const mine = next.role === 'investor' && Number(next.user_id) === me && !!next.envelope_uuid && !stageDead(next);
        if (mine) waiting.push({ line_uid: l.uid, step: 'sign' });
        else yourLines += 1;
      }
    }
    if (l.status === 'open') {
      if (stages == null || complete) waiting.push({ line_uid: l.uid, step: 'send_payment' });
      else yourLines += 1;
    }
    if (l.status !== 'received') yourLines += 1; // the receiving side's confirmation

    const receiving = (evidence.get(Number(l.id)) || [])
      .filter((e) => e.side === 'receiving' && !e.withdrawn_at && e.created_at)
      .map((e) => String(e.created_at)).sort();
    const own = stages?.find((s) => s.role === 'investor' && Number(s.user_id) === me && s.signed_at
      && s.esign_id != null && s.esign_status === 'completed' && !!s.signed_r2_key) || null;
    summary.push({
      line_uid: l.uid,
      amount_cents: l.amount_cents == null ? null : Number(l.amount_cents),
      currency: l.currency || null,
      signed_at: complete ? stages!.map((s) => String(s.signed_at)).sort().at(-1) ?? null : null,
      received_at: l.status === 'received' ? (receiving[0] ?? null) : null,
      signed_copy: own ? { envelope_id: Number(own.esign_id) } : null,
    });
  }

  // Of the rest of the round: a count, nothing else.
  const others = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM closing_lines
      WHERE closing_id = ? AND status NOT IN ('received', 'withdrawn') AND (investor_user_id IS NULL OR investor_user_id <> ?)`,
  ).bind(closing.id, me).first<{ n: number }>();
  const open = closing.status === 'open';
  const round = open ? (captable === 'proposed' ? 1 : 0) + 1 : 0; // the founder's decision, then Mark Closed
  const rest = { your_lines: open ? yourLines : 0, other_lines: open ? Number(others?.n ?? 0) : 0, round };

  let reporting: { state: 'not_closed' | 'ok' | 'unreadable'; duties: any[] } = { state: 'not_closed', duties: [] };
  if (closing.status === 'closed') {
    try {
      const ids = lines.map((l) => Number(l.id));
      const rows = ids.length ? ((await env.DB.prepare(
        `SELECT d.uid, d.closing_line_uid, d.kind, d.cadence, d.due_rule, d.due_days, d.source_document, d.source_clause,
                d.source_kind, d.defaulted_json, d.starts_on, d.status
           FROM reporting_duties d
          WHERE d.closing_id = ? AND d.holder_user_id = ? AND d.closing_line_id IN (SELECT value FROM json_each(?))
          ORDER BY d.id`,
      ).bind(closing.id, me, JSON.stringify(ids)).all<any>()).results || []) : [];
      reporting = {
        state: 'ok',
        duties: rows.map((d: any) => ({
          uid: d.uid, line_uid: d.closing_line_uid, kind: d.kind, title: KIND_WORDS[d.kind as Kind] || null, cadence: d.cadence,
          due_rule: d.due_rule, due_days: d.due_days == null ? null : Number(d.due_days),
          source: { document: d.source_document, clause: d.source_clause, signed: d.source_kind === 'signed_envelope' },
          defaulted: parse(d.defaulted_json), starts_on: d.starts_on, status: d.status,
        })),
      };
    } catch {
      console.warn('[closings] the investor’s reporting duties could not be read');
      reporting = { state: 'unreadable', duties: [] };
    }
  }

  return {
    project_uid: project?.uid ?? null,
    conditions: open
      ? { waiting_on_you: waiting, rest, rest_count: rest.your_lines + rest.other_lines + rest.round }
      : { waiting_on_you: [], rest, rest_count: 0 },
    summary,
    reporting,
  };
}
