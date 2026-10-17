/**
 * D712 (#1777) — the fund report drafts queue: the store, the state machine of
 * decisions 2 to 4, the digest and the event rows.
 *
 * Every state change commits with its event rows in one `env.DB.batch`, and
 * migration 476's triggers refuse what the state machine refuses, so a batch
 * that breaks a rule rolls back whole. A D1 batch does not roll back on an
 * UPDATE that matches no row, so each batch's FIRST statement carries every
 * precondition in its WHERE, every later statement requires the first one's
 * row in its new state, and the caller reads `meta.changes` of the first.
 *
 * The quarterly pack is one unit (decision 4): the report and its statements
 * are built, rebuilt, prepared, returned and issued together. A statement is
 * prepared and issued only through its report.
 */
import type { Env } from '../types';
import { logAdminAction } from './adminAudit';
import {
  administeredFunds, allocate, fundFigures, isAdministered, isClosed, lastClosedQuarter, packLps,
  quarterPeriod, reportFigures, statementFigures, type Line, type Period,
} from './fundReportBuild';

export const DRAFT_KINDS = ['entity_cash_monthly', 'lp_capital_statement', 'lp_quarterly_report', 'mgmt_fee_statement'] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];
export const DRAFT_STATUSES = ['draft', 'prepared', 'issued', 'superseded'] as const;
export const ENTITY_KEYS = ['holdings', 'management', 'gp', 'fund'] as const;
export const UID = /^[0-9a-f]{32}$/;

export class DraftRefusal extends Error {
  status: number; code: string; publicMessage: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; this.publicMessage = message; }
}
const refusal = {
  notFound: () => new DraftRefusal(404, 'draft_not_found', 'That draft is not in the reporting queue.'),
  contentChanged: () => new DraftRefusal(409, 'content_changed', 'The draft or its GP letter changed since you read it. Open it again before you act.'),
  state: (what: string) => new DraftRefusal(409, 'draft_state', what),
};

/** SHA-256 of the stored figures string, as lower-case hex. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const newUid = () => crypto.randomUUID().replace(/-/g, '');
const nowStamp = () => new Date().toISOString();

export type DraftRow = {
  id: number; uid: string; kind: DraftKind; audience: string; subject_key: string; entity_key: string | null;
  fund_id: number | null; limited_partner_id: number | null; report_period_id: number | null;
  period_label: string; period_start: string; period_end: string; revision: number; status: string;
  figures_json: string; figures_sha256: string; narrative_revision: string | null; corrects_draft_id: number | null;
  built_by: number | null; built_at: string; prepared_by: number | null; prepared_at: string | null;
  issued_by: number | null; issued_at: string | null;
};

/** A row as the list shows it: never its figures or its digest. */
export function publicRow(r: DraftRow) {
  return {
    uid: r.uid, kind: r.kind, audience: r.audience, subject_key: r.subject_key, entity_key: r.entity_key,
    fund_id: r.fund_id, limited_partner_id: r.limited_partner_id, report_period_id: r.report_period_id,
    period_label: r.period_label, period_start: r.period_start, period_end: r.period_end, revision: r.revision,
    status: r.status, corrects_draft_id: r.corrects_draft_id, built_by: r.built_by, built_at: r.built_at,
    prepared_by: r.prepared_by, prepared_at: r.prepared_at, issued_by: r.issued_by, issued_at: r.issued_at,
  };
}

async function byUid(env: Env, uid: string): Promise<DraftRow | null> {
  if (!UID.test(uid)) return null;
  return await env.DB.prepare('SELECT * FROM fund_report_drafts WHERE uid = ?').bind(uid).first<DraftRow>() ?? null;
}

// ── The list ─────────────────────────────────────────────────────────────────

export async function listDrafts(env: Env, q: { kind?: string; status?: string; fund_id?: string; entity_key?: string; period?: string }) {
  const kind = (DRAFT_KINDS as readonly string[]).includes(String(q.kind)) ? String(q.kind) : '';
  const status = (DRAFT_STATUSES as readonly string[]).includes(String(q.status)) ? String(q.status) : '';
  const fundId = /^[1-9][0-9]{0,9}$/.test(String(q.fund_id ?? '')) ? Number(q.fund_id) : null;
  const entity = (ENTITY_KEYS as readonly string[]).includes(String(q.entity_key)) ? String(q.entity_key) : '';
  const period = typeof q.period === 'string' ? q.period.trim().slice(0, 100) : '';
  const res = await env.DB.prepare(
    `SELECT * FROM fund_report_drafts
      WHERE (? = '' OR kind = ?) AND (? = '' OR status = ?) AND (? IS NULL OR fund_id = ?)
        AND (? = '' OR entity_key = ?) AND (? = '' OR period_label = ?)
      ORDER BY period_end DESC, kind, subject_key, revision DESC LIMIT 500`,
  ).bind(kind, kind, status, status, fundId, fundId, entity, entity, period, period).all<DraftRow>();
  const items = (res.results || []).map(publicRow);
  return fundId == null ? { items } : { items, administered: await isAdministered(env, fundId) };
}

// ── An audited read (decision 7) ─────────────────────────────────────────────

/**
 * The event row is written BEFORE any figure leaves: a failed write answers
 * 503 and nothing. The act is mirrored to HQ's governance feed.
 */
export async function readDraft(env: Env, uid: string, actor: { id: number; email?: string | null }, action: 'viewed' | 'exported') {
  const row = await byUid(env, uid);
  if (!row) throw refusal.notFound();
  try {
    const res = await env.DB.prepare(
      'INSERT INTO fund_report_draft_events (draft_id, action, actor) VALUES (?, ?, ?)',
    ).bind(row.id, action, actor.id).run();
    if (!res.success) throw new Error('event');
  } catch {
    throw new DraftRefusal(503, 'draft_unreadable', 'Unreadable: the read could not be recorded, so the draft was not shown. Try again.');
  }
  await logAdminAction(env, actor.id, actor.email ?? '', `fund_report_draft_${action}`, { uid: row.uid, kind: row.kind, period: row.period_label, fund_id: row.fund_id });
  return { draft: publicRow(row), figures: JSON.parse(row.figures_json), figures_sha256: row.figures_sha256 };
}

// ── Building a pack ──────────────────────────────────────────────────────────

type Insert = {
  uid: string; kind: DraftKind; audience: string; subject_key: string; fund_id: number; limited_partner_id: number | null;
  report_period_id: number; period: Period; revision: number; figures_json: string; figures_sha256: string;
  corrects_draft_id: number | null; built_by: number | null;
};

const insertStatement = (env: Env, r: Insert) => env.DB.prepare(
  `INSERT INTO fund_report_drafts (uid, kind, audience, subject_key, fund_id, limited_partner_id, report_period_id,
     period_label, period_start, period_end, revision, status, figures_json, figures_sha256, corrects_draft_id, built_by)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
).bind(r.uid, r.kind, r.audience, r.subject_key, r.fund_id, r.limited_partner_id, r.report_period_id,
  r.period.label, r.period.start, r.period.end, r.revision, r.figures_json, r.figures_sha256, r.corrects_draft_id, r.built_by);

const builtEvent = (env: Env, uid: string, actor: number | null) => env.DB.prepare(
  "INSERT INTO fund_report_draft_events (draft_id, action, actor) SELECT id, 'built', ? FROM fund_report_drafts WHERE uid = ?",
).bind(actor, uid);

/** The quarter's period row: the one that exists, or a new draft with an empty narrative. */
async function ensurePeriodRow(env: Env, fundId: number, p: Period): Promise<{ id: number; status: string }> {
  const notes = JSON.stringify({ letter: [], developments: [], outlook: [], subsequent: [], _receipt: { write_uid: crypto.randomUUID(), corrects_period_id: null } });
  await env.DB.prepare(
    `INSERT OR IGNORE INTO fund_report_periods (fund_id, period, period_start, period_end, notes, status)
     VALUES (?, ?, ?, ?, ?, 'draft')`,
  ).bind(fundId, p.label, p.start, p.end, notes).run();
  const row = await env.DB.prepare('SELECT id, status FROM fund_report_periods WHERE fund_id = ? AND period = ?')
    .bind(fundId, p.label).first<{ id: number; status: string }>();
  if (!row) throw new Error('Reporting period unreadable');
  return row;
}

/** The pack's rows, computed but not written: statements first, so the report holds their digests. */
async function composePack(
  env: Env, fund: any, p: Period, periodRowId: number, actor: number | null, revision: number,
  corrects: Map<string, number> = new Map(),
): Promise<Insert[] | null> {
  const lps = await packLps(env, fund.id, p.end);
  if (!lps.length) return null;
  const figures = await fundFigures(env, fund, p);
  const allocs = {
    expenses: allocate(figures.expenses, lps), management_fee: allocate(figures.management_fee, lps),
    investment_value: allocate(figures.investment_value, lps), cash: allocate(figures.cash, lps),
    liabilities: allocate(figures.liabilities, lps),
  };
  const total = lps.reduce((s, lp) => s + Math.round(Number(lp.commitment_amount) * 100), 0);
  const rows: Insert[] = [];
  const totals = { commitments: 0, called_to_date: 0, called_in_quarter: 0, contributed_in_quarter: 0, receipts_to_date: 0, distributions_in_quarter: 0, distributions_to_date: 0 };
  for (const lp of lps) {
    const share = (m: Map<number, Line>) => m.get(lp.id)!;
    const f = await statementFigures(env, fund, p, lp, total, {
      expenses: share(allocs.expenses), management_fee: share(allocs.management_fee), investment_value: share(allocs.investment_value),
      cash: share(allocs.cash), liabilities: share(allocs.liabilities),
    });
    totals.commitments += f.commitment.cents; totals.called_to_date += f.called_to_date.cents;
    totals.called_in_quarter += f.called_in_quarter.cents; totals.contributed_in_quarter += f.contributed_in_quarter.cents;
    totals.receipts_to_date += f.ties.receipts_cents; totals.distributions_in_quarter += f.distributions_in_quarter.cents;
    totals.distributions_to_date += f.distributions_to_date.cents;
    const json = JSON.stringify(f);
    const subject = `lp:${lp.id}`;
    rows.push({ uid: newUid(), kind: 'lp_capital_statement', audience: 'lp', subject_key: subject, fund_id: fund.id, limited_partner_id: lp.id,
      report_period_id: periodRowId, period: p, revision, figures_json: json, figures_sha256: await sha256Hex(json),
      corrects_draft_id: corrects.get(subject) ?? null, built_by: actor });
  }
  const report = reportFigures(fund, p, lps.length, totals, figures, rows.map((r) => ({ uid: r.uid, figures_sha256: r.figures_sha256 })));
  const json = JSON.stringify(report);
  const subject = `fund:${fund.id}`;
  rows.push({ uid: newUid(), kind: 'lp_quarterly_report', audience: 'fund_lps', subject_key: subject, fund_id: fund.id, limited_partner_id: null,
    report_period_id: periodRowId, period: p, revision, figures_json: json, figures_sha256: await sha256Hex(json),
    corrects_draft_id: corrects.get(subject) ?? null, built_by: actor });
  return rows;
}

export type BuildOutcome = { fund_id: number; period: string; result: 'built' | 'exists' | 'issued_outside_queue' | 'no_lps'; uids?: string[] };

/** Build one fund's pack for a closed quarter, when no pack of any status exists for it. */
export async function buildPack(env: Env, fundId: number, p: Period, actor: number | null): Promise<BuildOutcome> {
  const exists = await env.DB.prepare(
    "SELECT 1 FROM fund_report_drafts WHERE kind = 'lp_quarterly_report' AND subject_key = ? AND period_label = ? LIMIT 1",
  ).bind(`fund:${fundId}`, p.label).first();
  if (exists) return { fund_id: fundId, period: p.label, result: 'exists' };
  const existing = await env.DB.prepare('SELECT id, status FROM fund_report_periods WHERE fund_id = ? AND period = ?')
    .bind(fundId, p.label).first<{ id: number; status: string }>();
  if (existing?.status === 'issued') return { fund_id: fundId, period: p.label, result: 'issued_outside_queue' };
  const fund = await env.DB.prepare('SELECT * FROM vc_funds WHERE id = ?').bind(fundId).first<any>();
  if (!fund) throw refusal.notFound();
  if (!(await packLps(env, fundId, p.end)).length) return { fund_id: fundId, period: p.label, result: 'no_lps' };
  const period = existing ?? await ensurePeriodRow(env, fundId, p);
  const rows = await composePack(env, fund, p, period.id, actor, 1);
  if (!rows) return { fund_id: fundId, period: p.label, result: 'no_lps' };
  try {
    await env.DB.batch([...rows.map((r) => insertStatement(env, r)), ...rows.map((r) => builtEvent(env, r.uid, actor))]);
  } catch (e) {
    // A concurrent build took the live slot first: the pack exists.
    if (/UNIQUE/i.test(String((e as Error)?.message))) return { fund_id: fundId, period: p.label, result: 'exists' };
    throw e;
  }
  return { fund_id: fundId, period: p.label, result: 'built', uids: rows.map((r) => r.uid) };
}

/** POST /build: the missing packs of one closed quarter, for one fund or every administered fund. */
export async function buildPeriod(env: Env, input: { kind: unknown; period_label: unknown; fund_id?: unknown }, actor: number, today: string) {
  const kind = String(input.kind ?? '');
  if (kind === 'entity_cash_monthly' || kind === 'mgmt_fee_statement') {
    throw new DraftRefusal(409, 'builder_not_available', 'This kind of draft is built once the bank data and fee statements it reads are on record.');
  }
  if (kind !== 'lp_quarterly_report' && kind !== 'lp_capital_statement') throw new DraftRefusal(400, 'kind', 'Name a kind of draft to build.');
  const p = quarterPeriod(input.period_label);
  if (!p) throw new DraftRefusal(400, 'period', 'Name a quarter as Q3 2026.');
  if (!isClosed(p, today)) throw new DraftRefusal(409, 'period_open', 'Only a closed quarter can be built.');
  let funds: Array<{ id: number }>;
  if (input.fund_id !== undefined && input.fund_id !== null && input.fund_id !== '') {
    const id = Number(input.fund_id);
    if (!Number.isSafeInteger(id) || id <= 0 || !await env.DB.prepare('SELECT 1 FROM vc_funds WHERE id = ?').bind(id).first()) throw refusal.notFound();
    if (!await isAdministered(env, id)) throw new DraftRefusal(409, 'not_administered', "The fund's GP of record reports this fund.");
    funds = [{ id }];
  } else {
    funds = await administeredFunds(env);
  }
  const results: BuildOutcome[] = [];
  for (const f of funds) results.push(await buildPack(env, f.id, p, actor));
  return { period: p.label, results };
}

/** The live rows of one pack: its report and its statements. */
async function livePack(env: Env, fundId: number, label: string): Promise<DraftRow[]> {
  const res = await env.DB.prepare(
    `SELECT * FROM fund_report_drafts WHERE fund_id = ? AND period_label = ?
        AND kind IN ('lp_quarterly_report', 'lp_capital_statement') AND status IN ('draft', 'prepared') ORDER BY id`,
  ).bind(fundId, label).all<DraftRow>();
  return res.results || [];
}

/**
 * A rebuild never edits figures: it supersedes the pack's live rows and writes
 * the next revision as drafts, in one batch, the UPDATE first.
 */
export async function rebuildDraft(env: Env, uid: string, actor: number) {
  const row = await byUid(env, uid);
  if (!row) throw refusal.notFound();
  if (row.status !== 'draft' && row.status !== 'prepared') throw refusal.state('Only a draft or a prepared draft can be rebuilt.');
  if (row.kind !== 'lp_quarterly_report' && row.kind !== 'lp_capital_statement') throw new DraftRefusal(409, 'builder_not_available', 'This kind of draft is rebuilt once its builder is on record.');
  const p = quarterPeriod(row.period_label)!;
  const old = await livePack(env, row.fund_id!, row.period_label);
  const report = old.find((r) => r.kind === 'lp_quarterly_report');
  if (!report || report.report_period_id == null) throw refusal.state('This pack has no live report to rebuild.');
  const fund = await env.DB.prepare('SELECT * FROM vc_funds WHERE id = ?').bind(row.fund_id).first<any>();
  const revision = Math.max(...old.map((r) => r.revision)) + 1;
  const corrects = new Map(old.filter((r) => r.corrects_draft_id != null).map((r) => [r.subject_key, r.corrects_draft_id!]));
  const rows = await composePack(env, fund, p, report.report_period_id, actor, revision, corrects);
  if (!rows) throw refusal.state('The fund has no LP to report to for this quarter.');
  const oldUids = JSON.stringify(old.map((r) => r.uid));
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE fund_report_drafts SET status = 'superseded'
        WHERE uid IN (SELECT value FROM json_each(?)) AND status IN ('draft', 'prepared')`,
    ).bind(oldUids),
    ...rows.map((r) => insertStatement(env, r)),
    env.DB.prepare(
      "INSERT INTO fund_report_draft_events (draft_id, action, actor) SELECT id, 'superseded', ? FROM fund_report_drafts WHERE uid IN (SELECT value FROM json_each(?))",
    ).bind(actor, oldUids),
    ...rows.map((r) => builtEvent(env, r.uid, actor)),
  ]);
  if (Number(results[0].meta?.changes ?? 0) !== old.length) throw refusal.contentChanged();
  return { superseded: old.map((r) => r.uid), built: rows.map((r) => r.uid) };
}

// ── Prepare and return ───────────────────────────────────────────────────────

// A period row's narrative revision is `shapeFundPeriod`'s: `_receipt.write_uid`,
// or `legacy:<id>:<updated_at>` for a row saved before receipts.

export async function prepareDraft(env: Env, uid: string, actor: number, body: { figures_sha256?: unknown; note?: unknown }) {
  const row = await byUid(env, uid);
  if (!row) throw refusal.notFound();
  if (row.kind === 'lp_capital_statement') throw new DraftRefusal(409, 'pack_member', "A statement is prepared with its quarter's report.");
  if (typeof body?.figures_sha256 !== 'string') throw refusal.contentChanged();
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;
  if (note && note.length > 500) throw new DraftRefusal(400, 'note_too_long', 'A note is at most 500 characters.');
  if (row.status !== 'draft') throw refusal.state('Only a draft can be prepared.');
  const at = nowStamp();
  const first = row.kind === 'lp_quarterly_report'
    ? env.DB.prepare(
      `UPDATE fund_report_drafts SET status = 'prepared', prepared_by = ?, prepared_at = ?,
         narrative_revision = (SELECT COALESCE(json_extract(p.notes, '$._receipt.write_uid'), 'legacy:' || p.id || ':' || p.updated_at)
                                 FROM fund_report_periods p WHERE p.id = fund_report_drafts.report_period_id)
       WHERE uid = ? AND status = 'draft' AND figures_sha256 = ?`,
    ).bind(actor, at, uid, body.figures_sha256)
    : env.DB.prepare(
      `UPDATE fund_report_drafts SET status = 'prepared', prepared_by = ?, prepared_at = ?
       WHERE uid = ? AND status = 'draft' AND figures_sha256 = ?`,
    ).bind(actor, at, uid, body.figures_sha256);
  const stmts = [first];
  if (row.kind === 'lp_quarterly_report') {
    stmts.push(env.DB.prepare(
      `UPDATE fund_report_drafts SET status = 'prepared', prepared_by = ?, prepared_at = ?
        WHERE kind = 'lp_capital_statement' AND fund_id = ? AND period_label = ? AND status = 'draft'
          AND EXISTS (SELECT 1 FROM fund_report_drafts r WHERE r.uid = ? AND r.status = 'prepared' AND r.prepared_by = ? AND r.prepared_at = ?)`,
    ).bind(actor, at, row.fund_id, row.period_label, uid, actor, at));
  }
  stmts.push(env.DB.prepare(
    `INSERT INTO fund_report_draft_events (draft_id, action, actor, note)
     SELECT id, 'prepared', ?, CASE WHEN uid = ? THEN ? END FROM fund_report_drafts
      WHERE prepared_by = ? AND prepared_at = ? AND status = 'prepared' AND (uid = ? OR (fund_id = ? AND period_label = ?))`,
  ).bind(actor, uid, note, actor, at, uid, row.fund_id, row.period_label));
  const results = await env.DB.batch(stmts);
  if (Number(results[0].meta?.changes ?? 0) !== 1) throw refusal.contentChanged();
  return { prepared: uid, prepared_at: at };
}

export async function returnDraft(env: Env, uid: string, actor: number, body: { reason?: unknown }) {
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 10 || reason.length > 500) throw new DraftRefusal(400, 'reason', 'Give a reason of 10 to 500 characters.');
  const row = await byUid(env, uid);
  if (!row) throw refusal.notFound();
  if (row.kind === 'lp_capital_statement') throw new DraftRefusal(409, 'pack_member', "A statement is returned with its quarter's report.");
  if (row.status !== 'prepared') throw refusal.state('Only a prepared draft can be returned.');
  const members = row.kind === 'lp_quarterly_report'
    ? (await livePack(env, row.fund_id!, row.period_label)).filter((r) => r.status === 'prepared').map((r) => r.uid)
    : [uid];
  const list = JSON.stringify(members);
  const results = await env.DB.batch([
    env.DB.prepare(
      "UPDATE fund_report_drafts SET status = 'draft', prepared_by = NULL, prepared_at = NULL WHERE uid = ? AND status = 'prepared'",
    ).bind(uid),
    env.DB.prepare(
      `UPDATE fund_report_drafts SET status = 'draft', prepared_by = NULL, prepared_at = NULL
        WHERE uid IN (SELECT value FROM json_each(?)) AND uid <> ? AND status = 'prepared'
          AND EXISTS (SELECT 1 FROM fund_report_drafts r WHERE r.uid = ? AND r.status = 'draft')`,
    ).bind(list, uid, uid),
    env.DB.prepare(
      `INSERT INTO fund_report_draft_events (draft_id, action, actor, note)
       SELECT id, 'returned', ?, ? FROM fund_report_drafts WHERE uid IN (SELECT value FROM json_each(?)) AND status = 'draft'`,
    ).bind(actor, reason, list),
  ]);
  if (Number(results[0].meta?.changes ?? 0) !== 1) throw refusal.state('The draft changed since you read it.');
  return { returned: members };
}

// ── Issue (decisions 2 to 4) ─────────────────────────────────────────────────

/**
 * Issue. The acknowledgement is checked against the stored figures before the
 * batch, so a refusal writes nothing. For a report, the batch's first
 * statement issues it with every precondition in its WHERE; the statements,
 * the period row, the event rows and the activity row each require it.
 */
export async function issueDraft(env: Env, uid: string, actor: number, body: { figures_sha256?: unknown; acknowledgement?: unknown }) {
  const row = await byUid(env, uid);
  if (!row) throw refusal.notFound();
  if (row.kind === 'lp_capital_statement') throw new DraftRefusal(409, 'pack_member', "A statement is issued with its quarter's report.");
  if (typeof body?.figures_sha256 !== 'string') throw refusal.contentChanged();
  const unmatched = Number(JSON.parse(row.figures_json)?.unmatched_count ?? 0);
  let note: string | null = null;
  if (unmatched > 0) {
    const ack = typeof body.acknowledgement === 'string' ? body.acknowledgement.trim() : '';
    if (!ack) throw new DraftRefusal(409, 'acknowledgement_required', `This draft has ${unmatched} unmatched transactions. Type what you checked before you issue it.`);
    if (ack.length > 500) throw new DraftRefusal(400, 'acknowledgement_too_long', 'The acknowledgement is at most 500 characters.');
    note = ack;
  }
  if (row.status !== 'prepared') throw refusal.state('Only a prepared draft can be issued.');
  if (row.prepared_by === actor) throw new DraftRefusal(409, 'same_preparer', 'The account that prepared this draft cannot issue it.');
  const at = nowStamp();
  const count = unmatched > 0 ? unmatched : null;
  if (row.kind !== 'lp_quarterly_report') {
    const results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE fund_report_drafts SET status = 'issued', issued_by = ?, issued_at = ?
          WHERE uid = ? AND status = 'prepared' AND figures_sha256 = ? AND prepared_by IS NOT NULL AND prepared_by <> ?`,
      ).bind(actor, at, uid, body.figures_sha256, actor),
      env.DB.prepare(
        `INSERT INTO fund_report_draft_events (draft_id, action, actor, note, unmatched_count)
         SELECT id, 'issued', ?, ?, ? FROM fund_report_drafts WHERE uid = ? AND status = 'issued' AND issued_by = ? AND issued_at = ?`,
      ).bind(actor, note, count, uid, actor, at),
    ]);
    if (Number(results[0].meta?.changes ?? 0) !== 1) throw await whyNotIssued(env, uid, body.figures_sha256);
    return { issued: [uid], issued_at: at };
  }
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE fund_report_drafts SET status = 'issued', issued_by = ?, issued_at = ?
        WHERE uid = ? AND kind = 'lp_quarterly_report' AND status = 'prepared' AND figures_sha256 = ?
          AND prepared_by IS NOT NULL AND prepared_by <> ?
          AND NOT EXISTS (SELECT 1 FROM fund_report_drafts s WHERE s.kind = 'lp_capital_statement'
                            AND s.fund_id = fund_report_drafts.fund_id AND s.period_label = fund_report_drafts.period_label AND s.status = 'draft')
          AND EXISTS (SELECT 1 FROM fund_report_periods p WHERE p.id = fund_report_drafts.report_period_id AND p.status = 'draft'
                        AND json_array_length(COALESCE(json_extract(p.notes, '$.letter'), '[]')) > 0
                        AND COALESCE(json_extract(p.notes, '$._receipt.write_uid'), 'legacy:' || p.id || ':' || p.updated_at) = fund_report_drafts.narrative_revision)`,
    ).bind(actor, at, uid, body.figures_sha256, actor),
    env.DB.prepare(
      `UPDATE fund_report_drafts SET status = 'issued', issued_by = ?, issued_at = ?
        WHERE kind = 'lp_capital_statement' AND fund_id = ? AND period_label = ? AND status = 'prepared'
          AND EXISTS (SELECT 1 FROM fund_report_drafts r WHERE r.uid = ? AND r.status = 'issued' AND r.issued_by = ? AND r.issued_at = ?)`,
    ).bind(actor, at, row.fund_id, row.period_label, uid, actor, at),
    env.DB.prepare(
      `UPDATE fund_report_periods SET status = 'issued', issued_at = ?, issued_by = ?, updated_at = datetime('now'),
         snapshot_json = (SELECT figures_json FROM fund_report_drafts WHERE uid = ?)
        WHERE id = ? AND status = 'draft'
          AND EXISTS (SELECT 1 FROM fund_report_drafts r WHERE r.uid = ? AND r.status = 'issued' AND r.issued_by = ? AND r.issued_at = ?)`,
    ).bind(at, actor, uid, row.report_period_id, uid, actor, at),
    env.DB.prepare(
      `INSERT INTO fund_report_draft_events (draft_id, action, actor, note, unmatched_count)
       SELECT id, 'issued', ?, CASE WHEN uid = ? THEN ? END, CASE WHEN uid = ? THEN ? END FROM fund_report_drafts
        WHERE fund_id = ? AND period_label = ? AND status = 'issued' AND issued_by = ? AND issued_at = ?`,
    ).bind(actor, uid, note, uid, count, row.fund_id, row.period_label, actor, at),
    env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id)
       SELECT 'fund_report_period_issued', ?, ?, ? WHERE EXISTS (SELECT 1 FROM fund_report_drafts r WHERE r.uid = ? AND r.status = 'issued' AND r.issued_by = ? AND r.issued_at = ?)`,
    ).bind(JSON.stringify({ fund_id: row.fund_id, period: row.period_label, report_uid: uid, via: 'reporting_queue' }), String(actor), actor, uid, actor, at),
  ]);
  if (Number(results[0].meta?.changes ?? 0) !== 1) throw await whyNotIssued(env, uid, body.figures_sha256);
  const members = await env.DB.prepare(
    "SELECT uid FROM fund_report_drafts WHERE fund_id = ? AND period_label = ? AND status = 'issued' AND issued_at = ? AND issued_by = ?",
  ).bind(row.fund_id, row.period_label, at, actor).all<{ uid: string }>();
  return { issued: (members.results || []).map((m) => m.uid), issued_at: at };
}

/** The first precondition an issue failed, read after the batch changed nothing. */
async function whyNotIssued(env: Env, uid: string, digest: unknown): Promise<DraftRefusal> {
  const row = await byUid(env, uid);
  if (!row || row.status !== 'prepared') return refusal.state('The draft changed since you read it.');
  if (row.figures_sha256 !== digest) return refusal.contentChanged();
  if (row.kind === 'lp_quarterly_report') {
    const open = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM fund_report_drafts WHERE kind = 'lp_capital_statement' AND fund_id = ? AND period_label = ? AND status = 'draft'",
    ).bind(row.fund_id, row.period_label).first<{ n: number }>();
    if (Number(open?.n ?? 0) > 0) return refusal.state('Every statement in the pack must be prepared before it is issued.');
    const period = await env.DB.prepare(
      `SELECT p.status, json_array_length(COALESCE(json_extract(p.notes, '$.letter'), '[]')) AS letter,
              COALESCE(json_extract(p.notes, '$._receipt.write_uid'), 'legacy:' || p.id || ':' || p.updated_at) AS revision
         FROM fund_report_periods p WHERE p.id = ?`,
    ).bind(row.report_period_id).first<{ status: string; letter: number; revision: string }>();
    if (!period || period.status !== 'draft') return refusal.state('This reporting period is already issued.');
    if (!Number(period.letter)) return new DraftRefusal(409, 'letter_required', 'Write the GP letter for this period before it is issued.');
    if (period.revision !== row.narrative_revision) return refusal.contentChanged();
  }
  return refusal.state('The draft changed since you read it.');
}

// ── Correction ──────────────────────────────────────────────────────────────

/**
 * A correction leaves the issued original as it is and builds a correcting
 * pack that names it, with a correcting period row labelled
 * `Q3 2026 · correction 1`. A statement is corrected with its pack.
 */
export async function correctDraft(env: Env, uid: string, actor: number) {
  const row = await byUid(env, uid);
  if (!row) throw refusal.notFound();
  if (row.status !== 'issued') throw refusal.state('Only an issued draft can be corrected.');
  if (row.kind !== 'lp_quarterly_report' && row.kind !== 'lp_capital_statement') throw new DraftRefusal(409, 'builder_not_available', 'This kind of draft is corrected once its builder is on record.');
  const issuedPack = await env.DB.prepare(
    `SELECT * FROM fund_report_drafts WHERE fund_id = ? AND period_label = ? AND status = 'issued' AND issued_at = ?
       AND kind IN ('lp_quarterly_report', 'lp_capital_statement')`,
  ).bind(row.fund_id, row.period_label, row.issued_at).all<DraftRow>();
  const original = (issuedPack.results || []);
  const report = original.find((r) => r.kind === 'lp_quarterly_report');
  if (!report || report.report_period_id == null) throw refusal.state('This statement has no issued report to correct.');
  if ((await livePack(env, row.fund_id!, row.period_label)).length) throw refusal.state('A correction of this quarter is already open.');
  const p = quarterPeriod(row.period_label)!;
  const fund = await env.DB.prepare('SELECT * FROM vc_funds WHERE id = ?').bind(row.fund_id).first<any>();
  const prior = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM fund_report_periods WHERE fund_id = ? AND json_extract(notes, '$._receipt.corrects_period_id') = ?",
  ).bind(row.fund_id, report.report_period_id).first<{ n: number }>();
  const label = `${p.label} · correction ${Number(prior?.n ?? 0) + 1}`;
  const notes = JSON.stringify({ letter: [], developments: [], outlook: [], subsequent: [], _receipt: { write_uid: crypto.randomUUID(), corrects_period_id: report.report_period_id } });
  const ins = await env.DB.prepare(
    "INSERT INTO fund_report_periods (fund_id, period, period_start, period_end, notes, status) VALUES (?, ?, ?, ?, ?, 'draft')",
  ).bind(row.fund_id, label, p.start, p.end, notes).run();
  const periodId = Number(ins.meta?.last_row_id);
  const latest = await env.DB.prepare(
    'SELECT MAX(revision) AS n FROM fund_report_drafts WHERE fund_id = ? AND period_label = ?',
  ).bind(row.fund_id, row.period_label).first<{ n: number }>();
  const corrects = new Map(original.map((r) => [r.subject_key, r.id]));
  const rows = await composePack(env, fund, p, periodId, actor, Number(latest?.n ?? 1) + 1, corrects);
  if (!rows) throw refusal.state('The fund has no LP to report to for this quarter.');
  await env.DB.batch([...rows.map((r) => insertStatement(env, r)), ...rows.map((r) => builtEvent(env, r.uid, actor))]);
  return { corrects: report.uid, period: label, built: rows.map((r) => r.uid) };
}

// ── The schedule (decision 12) ───────────────────────────────────────────────

/**
 * Builds every due and missing pack for the last closed quarter, due from the
 * 5th day after it ends. A second run builds nothing; an issued period is never
 * rebuilt. The monthly cash summary joins with #1775's data (PR 2).
 */
export async function runReportingSchedule(env: Env, now: Date) {
  const today = now.toISOString().slice(0, 10);
  const q = lastClosedQuarter(today);
  const due = new Date(Date.parse(`${q.end}T00:00:00Z`) + 5 * 86_400_000).toISOString().slice(0, 10);
  if (today < due) return { quarter: q.label, due: false, results: [] as BuildOutcome[] };
  const results: BuildOutcome[] = [];
  for (const f of await administeredFunds(env)) results.push(await buildPack(env, f.id, q, null));
  return { quarter: q.label, due: true, results };
}
