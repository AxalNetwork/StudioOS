/**
 * D5837 (#5837): a founder pins one line of one exact ledger statement revision (D5833) to one Raise claim, as a
 * Private evidence item, and re-reviews it after a correction or withdraws it.
 *
 * THE CHOICE. The founder names the revision (`snapshot_uid`) and the line (`source_key`), and confirms the amount,
 * date, currency and basis the revision states, and the claim it backs. Nothing is collected from every line: a
 * ledger fact exists only as this choice (`raise_ledger_selections`), and only a statement's own cash, income or
 * net-income total can be chosen (D5833 `SUPPORT`). A confirmed value the revision does not state is refused, never
 * corrected for the founder.
 *
 * AUTHORITY. Only the venture's founder (the D1263 evidence gate), and only through their own active connection to
 * the provider that imported the revision: the member who authorized the source is the one who may disclose a fact
 * from it. The same rule is in the evidence source query (`raiseEvidenceSources.ts`, dataset `ledger`), so every
 * later read checks it again.
 *
 * WHAT IT WRITES, in one batch: the selection (its own copy of the fact), a `raise_evidence_items` row of kind
 * `ledger-fact` that is pinned and Private, its provenance, the founder's link to the claim (`how = 'founder'`), the
 * claim reset to be checked again, a D5833 pin on the revision, and the activity row. Sharing beyond Private is the
 * existing evidence sharing (`setSharing`), never this file.
 *
 * AFTER. A correction (a later revision) changes the item's fingerprint, so it reads "changed" and leaves every
 * shared view until the founder re-reviews it onto the new revision (`reviewLedgerFact`: a new Private item, the old
 * one unpinned and Private). Withdrawal unpins it, makes it Private and removes its claim links. A revoked connection
 * or a deleted revision drops it from every shared view; the founder still reads the fact the selection kept.
 */
import type { Env } from '../types';
import type { RaiseEvidenceContext } from './raiseEvidence';
import { logCycleWriteStatement, type CycleModules } from './cycleActivity';
import { LEDGER_EVIDENCE_KIND, LEDGER_EVIDENCE_TABLE, ledgerCandidate, ledgerMinorUnits, type EvidenceArea, type EvidenceCandidate } from './raiseEvidenceSources';
import { SUPPORT, parseAmount, type Figure } from './financialStatements/contract';
import { exponentOf } from '../../../frontend/src/lib/money.js';

const SENTENCES = {
  forbidden: 'Only this venture’s founders can pin a ledger figure to a claim.',
  not_found: 'That statement revision, line, claim or selection is not available in this venture.',
  invalid: 'The ledger evidence request is invalid. Refresh and try again.',
  source_unavailable: 'That statement is not readable through your own active connection. Reconnect it, then choose again.',
  superseded: 'A newer revision of this statement exists. Choose the figure from the latest revision.',
  mismatch: 'The amount, date, currency or basis you confirmed is not what this revision states. Look again before pinning it.',
  unsupported_line: 'Only the statement’s own cash, income or net income total can back a claim, and only when it holds an amount.',
  unsupported_amount: 'This amount cannot be recorded exactly in its currency.',
  not_changed: 'This figure’s revision has not been corrected, so there is nothing to re-review.',
  decided: 'This selection has already been withdrawn or replaced.',
  unreadable: 'The ledger evidence could not be read or saved. Nothing was saved; try again.',
} as const;
export type LedgerEvidenceCode = keyof typeof SENTENCES;
export class LedgerEvidenceError extends Error {
  readonly code: LedgerEvidenceCode;
  readonly status: 400 | 403 | 404 | 409 | 503;
  readonly sentence: string;
  constructor(code: LedgerEvidenceCode, status: LedgerEvidenceError['status']) {
    super('ledger_evidence_refused'); this.code = code; this.status = status; this.sentence = SENTENCES[code];
  }
}

const UID = /^[0-9a-f-]{36}$/i;
const OWN_UID = /^[0-9a-f]{32}$/;
const newUid = () => crypto.randomUUID().replaceAll('-', '');
/** Every write repeats the founder gate in SQL, as D1263's evidence writes do; these are its binds (user, project, company). */
const founderBinds = (ctx: RaiseEvidenceContext) => [ctx.user.id, ctx.projectId, ctx.companyId] as const;
/** The evidence area follows the claim's surface: the item is shown where the claim is. */
const AREA_FOR_SURFACE: Record<string, EvidenceArea> = {
  narrative: 'Investor narrative and Pitch deck', deck: 'Investor narrative and Pitch deck', use_of_funds: 'Use of funds',
  capital_model: 'Capital model', readiness: 'Fundraising readiness', cap_table: 'Fundraising readiness',
};
const MODULE_FOR: Record<EvidenceArea, CycleModules['raise']> = {
  'Fundraising readiness': 'fundraising-readiness', 'Investor narrative and Pitch deck': 'investor-narrative', 'Use of funds': 'use-of-funds', 'Data room': 'data-room',
  'Cap table': 'cap-table', 'Capital relationships': 'capital-relationships', Legal: 'fundraising-readiness', 'Capital model': 'fundraising-readiness',
};
const FACT_KEYS = ['snapshot_uid', 'source_key', 'amount', 'currency', 'basis', 'observed_on'] as const;

function founderOnly(ctx: RaiseEvidenceContext) { if (!ctx.founder) throw new LedgerEvidenceError('forbidden', 403); }
function body(data: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new LedgerEvidenceError('invalid', 400);
  const d = data as Record<string, unknown>;
  if (Object.keys(d).some(k => !allowed.includes(k))) throw new LedgerEvidenceError('invalid', 400);
  return d;
}

type Snap = {
  id: number; uid: string; integration_id: number; provider: string; entity_key: string; report: string; window_key: string; basis: string; currency: string;
  precision: number; revision: number; requested_start: string | null; requested_end: string | null; requested_as_of: string | null;
  returned_start: string | null; returned_end: string | null; returned_as_of: string | null; superseded_by: string | null; own_connection: number;
};
type LineRow = { source_key: string; label: string; kind: string; state: string; amount: string | null; amount_minor: string | null };

/** The period a revision reports for: what the provider returned, else what was asked. */
function periodOf(s: Snap) {
  if (s.returned_as_of || s.returned_start) return s.returned_as_of ? { as_of: s.returned_as_of } : { start: s.returned_start!, end: s.returned_end! };
  return s.requested_as_of ? { as_of: s.requested_as_of } : { start: s.requested_start!, end: s.requested_end! };
}
const dayOf = (p: { as_of: string } | { start: string; end: string }) => ('as_of' in p ? p.as_of : p.end);

/** One revision of this venture, readable through the founder's own active connection, and still the latest. */
async function latestRevision(ctx: RaiseEvidenceContext, snapshotUid: unknown): Promise<Snap> {
  if (typeof snapshotUid !== 'string' || !UID.test(snapshotUid)) throw new LedgerEvidenceError('not_found', 404);
  const snap = await ctx.env.DB.prepare(`SELECT f.id,f.uid,f.integration_id,f.provider,f.entity_key,f.report,f.window_key,f.basis,f.currency,f.precision,f.revision,
      f.requested_start,f.requested_end,f.requested_as_of,f.returned_start,f.returned_end,f.returned_as_of,
      (SELECT n.uid FROM financial_statement_snapshots n WHERE n.supersedes_id=f.id) AS superseded_by,
      EXISTS(SELECT 1 FROM integrations i JOIN users u ON u.id=i.user_id AND u.is_active=1 WHERE i.id=f.integration_id AND i.provider_key=f.provider
        AND i.status='active' AND i.user_id=?) AS own_connection
    FROM financial_statement_snapshots f WHERE f.uid=? AND f.project_id=?`).bind(ctx.user.id, snapshotUid, ctx.projectId).first<Snap>();
  if (!snap) throw new LedgerEvidenceError('not_found', 404);
  if (Number(snap.own_connection) !== 1) throw new LedgerEvidenceError('source_unavailable', 409);
  if (snap.superseded_by) throw new LedgerEvidenceError('superseded', 409);
  return snap;
}

/** The fact the founder confirmed, checked against the revision. Returns the selection row the evidence source reads. */
async function confirmedFact(ctx: RaiseEvidenceContext, snap: Snap, d: Record<string, unknown>) {
  if (typeof d.source_key !== 'string' || !d.source_key || d.source_key.length > 200) throw new LedgerEvidenceError('not_found', 404);
  const line = await ctx.env.DB.prepare(`SELECT source_key,label,kind,state,amount,amount_minor FROM financial_statement_lines WHERE snapshot_id=? AND source_key=?`)
    .bind(snap.id, d.source_key).first<LineRow>();
  if (!line) throw new LedgerEvidenceError('not_found', 404);
  const figure = (Object.keys(SUPPORT) as Figure[]).find(f => SUPPORT[f].report === snap.report && SUPPORT[f].kind === line.kind);
  if (!figure || (line.state !== 'value' && line.state !== 'zero') || line.amount == null || line.amount_minor == null) throw new LedgerEvidenceError('unsupported_line', 400);
  if (typeof d.amount !== 'string' || typeof d.currency !== 'string' || typeof d.basis !== 'string' || typeof d.observed_on !== 'string') throw new LedgerEvidenceError('invalid', 400);
  const confirmed = parseAmount(d.amount, Number(snap.precision));
  const period = periodOf(snap);
  if (confirmed.amount_minor !== line.amount_minor || d.currency !== snap.currency || d.basis !== snap.basis || d.observed_on !== dayOf(period)) {
    throw new LedgerEvidenceError('mismatch', 409);
  }
  if (ledgerMinorUnits(line.amount_minor, Number(snap.precision), exponentOf(snap.currency)) == null) throw new LedgerEvidenceError('unsupported_amount', 400);
  return { line, figure, period, observed_on: dayOf(period) };
}

async function claimOf(ctx: RaiseEvidenceContext, claimUid: unknown) {
  if (typeof claimUid !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(claimUid)) throw new LedgerEvidenceError('not_found', 404);
  const claim = await ctx.env.DB.prepare('SELECT id,uid,surface FROM raise_claims WHERE uid=? AND project_id=?').bind(claimUid, ctx.projectId)
    .first<{ id: number; uid: string; surface: string }>();
  if (!claim) throw new LedgerEvidenceError('not_found', 404);
  return claim;
}

type Planned = { selUid: string; itemUid: string; token: string; candidate: EvidenceCandidate; snap: Snap; fact: Awaited<ReturnType<typeof confirmedFact>>; area: EvidenceArea; claimId: number };

/** The statements that write one selection and its Private item, linked to its claim. Guarded so a refused gate writes nothing. */
async function plan(ctx: RaiseEvidenceContext, snap: Snap, fact: Planned['fact'], claim: { id: number; surface: string }) {
  const area = AREA_FOR_SURFACE[claim.surface] ?? 'Fundraising readiness';
  const selUid = newUid(), itemUid = newUid(), token = newUid();
  const row = { uid: selUid, area, figure: fact.figure, provider: snap.provider, report: snap.report, snapshot_uid: snap.uid, revision: snap.revision,
    source_key: fact.line.source_key, line_label: fact.line.label, amount: fact.line.amount, amount_minor: fact.line.amount_minor, currency: snap.currency,
    basis: snap.basis, precision: snap.precision, observed_on: fact.observed_on, superseded_by: null };
  let candidate: EvidenceCandidate;
  try { candidate = await ledgerCandidate(ctx.env, ctx.projectId, row); } catch { throw new LedgerEvidenceError('unreadable', 503); }
  return { selUid, itemUid, token, candidate, snap, fact, area, claimId: claim.id } satisfies Planned;
}

/** `replaces` is the old selection and the token that closed it in this batch (a re-review), or null (a first pin). */
function writes(ctx: RaiseEvidenceContext, p: Planned, replaces: { id: number; token: string } | null) {
  const db = ctx.env.DB, c = p.candidate, period = p.fact.period as Record<string, string | undefined>;
  return [
    db.prepare(`INSERT INTO raise_ledger_selections(uid,project_id,snapshot_id,snapshot_uid,provider,report,revision,basis,currency,precision,period_start,period_end,as_of,
        observed_on,source_key,line_label,figure,amount,amount_minor,area,claim_id,replaces_id,selected_by)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM projects p JOIN users u ON u.id=? AND u.is_active=1 WHERE p.id=?
          AND p.deleted_at IS NULL AND p.company_id IS ? AND p.founder_id=u.founder_id AND u.role<>'admin' AND (u.role='founder' OR u.spinout_lab_active=1))
        AND (? IS NULL OR EXISTS(SELECT 1 FROM raise_ledger_selections o WHERE o.id=? AND o.project_id=? AND o.status='replaced' AND o.closed_token=?))
        AND NOT EXISTS(SELECT 1 FROM financial_statement_snapshots n WHERE n.supersedes_id=?)
        AND EXISTS(SELECT 1 FROM integrations i WHERE i.id=? AND i.status='active' AND i.user_id=?)`)
      .bind(p.selUid, ctx.projectId, p.snap.id, p.snap.uid, p.snap.provider, p.snap.report, p.snap.revision, p.snap.basis, p.snap.currency, p.snap.precision,
        period.start ?? null, period.end ?? null, period.as_of ?? null, p.fact.observed_on, p.fact.line.source_key, p.fact.line.label, p.fact.figure,
        p.fact.line.amount, p.fact.line.amount_minor, p.area, p.claimId, replaces?.id ?? null, ctx.user.id, ...founderBinds(ctx),
        replaces?.id ?? null, replaces?.id ?? null, ctx.projectId, replaces?.token ?? null, p.snap.id, p.snap.integration_id, ctx.user.id),
    // The initial item is Private and pinned; its values are rebuilt by code from the revision, never taken from the request.
    db.prepare(`INSERT INTO raise_evidence_items(uid,project_id,area,kind,source_table,source_ref,provider,source_label,strength,observed_on,summary,value_num,value_unit,currency,
        snapshot_hash,state,visibility,private_reason,mutation_uid,accepted_by,updated_by)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pinned','private',NULL,?,?,? WHERE EXISTS(SELECT 1 FROM raise_ledger_selections WHERE uid=? AND project_id=?)`)
      .bind(p.itemUid, ctx.projectId, c.area, LEDGER_EVIDENCE_KIND, LEDGER_EVIDENCE_TABLE, c.source_ref, c.provider, c.source_label, c.strength, c.observed_on, c.summary,
        c.value_num, c.value_unit, c.currency, c.snapshot_hash, p.token, ctx.user.id, ctx.user.id, p.selUid, ctx.projectId),
    db.prepare('UPDATE raise_ledger_selections SET item_id=(SELECT id FROM raise_evidence_items WHERE uid=? AND project_id=?) WHERE uid=? AND project_id=?')
      .bind(p.itemUid, ctx.projectId, p.selUid, ctx.projectId),
    // NOT NULL provenance is the batch's guard: no item, no provenance row, and the whole choice rolls back.
    provenance(ctx, 'raise_evidence_items', p.itemUid, p.token, 'snapshot_hash', null, c.snapshot_hash,
      { source_ref: c.source_ref, snapshot_uid: p.snap.uid, revision: p.snap.revision, line: p.fact.line.source_key }),
    db.prepare(`INSERT OR IGNORE INTO raise_claim_evidence(project_id,claim_id,item_id,how,created_by,mutation_uid)
      SELECT ?,?,i.id,'founder',?,? FROM raise_evidence_items i WHERE i.uid=? AND i.project_id=?`).bind(ctx.projectId, p.claimId, ctx.user.id, p.token, p.itemUid, ctx.projectId),
    db.prepare("UPDATE raise_claims SET state='not_backed',checked_at=NULL WHERE id=? AND project_id=?").bind(p.claimId, ctx.projectId),
    db.prepare(`INSERT INTO financial_statement_pins(uid,project_id,snapshot_id,purpose,pinned_by) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM raise_ledger_selections WHERE uid=?)
      ON CONFLICT(snapshot_id,purpose) DO NOTHING`).bind(crypto.randomUUID(), ctx.projectId, p.snap.id, `Raise claim evidence ${p.selUid}`, ctx.user.id, p.selUid),
  ];
}

/** The row is found by the token this batch wrote on it, so a guarded write that wrote nothing leaves a NULL here and fails NOT NULL. */
function provenance(ctx: RaiseEvidenceContext, table: 'raise_evidence_items' | typeof LEDGER_EVIDENCE_TABLE, uid: string, token: string, column: string,
  before: string | null, after: string, citation: Record<string, unknown>) {
  return ctx.env.DB.prepare(`INSERT INTO fill_provenance(target_table,target_row_id,target_column,proposal_id,fill_class,proposed_value,written_value,edited,citation_json,model,task,decided_by,target_row_ref,ai_usage_log_id,ai_proposal_id)
    VALUES(?,CASE ? WHEN 'raise_evidence_items' THEN (SELECT id FROM raise_evidence_items WHERE uid=? AND project_id=? AND mutation_uid=?)
      ELSE (SELECT id FROM raise_ledger_selections WHERE uid=? AND project_id=? AND closed_token=?) END,?,NULL,'restatement',?,?,0,?,NULL,'raise:ledger-evidence',?,?,NULL,NULL)`)
    .bind(table, table, uid, ctx.projectId, token, uid, ctx.projectId, token, column, after, after,
      JSON.stringify({ source_kind: 'connector', source_label: 'connector', prior_value: before, ...citation }), ctx.user.id, uid);
}
const activity = (ctx: RaiseEvidenceContext, area: EvidenceArea, id: string, action: string, summary: string) =>
  logCycleWriteStatement(ctx.env, { projectId: ctx.projectId, userId: ctx.user.id, cycle: 'raise', module: MODULE_FOR[area], entityId: id, action, summary });

/** One batch. On failure, `explain` names the refusal that caused it (a new revision, a decided selection), else it is unreadable. */
async function run(ctx: RaiseEvidenceContext, statements: ReturnType<Env['DB']['prepare']>[], explain: () => Promise<void>) {
  try { await ctx.env.DB.batch(statements); }
  catch {
    try { await explain(); } catch (e) { if (e instanceof LedgerEvidenceError) throw e; }
    throw new LedgerEvidenceError('unreadable', 503);
  }
}

/** Pin one confirmed line of the latest revision to one claim, as a Private item. */
export async function pinLedgerFact(ctx: RaiseEvidenceContext, data: unknown) {
  founderOnly(ctx);
  const d = body(data, [...FACT_KEYS, 'claim_id']);
  const snap = await latestRevision(ctx, d.snapshot_uid);
  const fact = await confirmedFact(ctx, snap, d);
  const claim = await claimOf(ctx, d.claim_id);
  const p = await plan(ctx, snap, fact, claim);
  await run(ctx, [...writes(ctx, p, null),
    activity(ctx, p.area, p.itemUid, 'ledger_evidence_pinned', `A ledger figure (revision ${snap.revision}) was pinned to a claim; Private.`)],
  async () => { await latestRevision(ctx, snap.uid); });
  return selectionView(ctx, p.selUid);
}

type SelRow = { id: number; uid: string; status: string; snapshot_id: number | null; claim_id: number | null; item_id: number | null; area: EvidenceArea; figure: string; provider: string; report: string };
async function selection(ctx: RaiseEvidenceContext, uid: string): Promise<SelRow> {
  if (!OWN_UID.test(uid)) throw new LedgerEvidenceError('not_found', 404);
  const s = await ctx.env.DB.prepare('SELECT id,uid,status,snapshot_id,claim_id,item_id,area,figure,provider,report FROM raise_ledger_selections WHERE uid=? AND project_id=?')
    .bind(uid, ctx.projectId).first<SelRow>();
  if (!s) throw new LedgerEvidenceError('not_found', 404);
  return s;
}
/** The statements that close the old item: unpinned, Private, and out of every claim (each claim checked again). */
function closeItem(ctx: RaiseEvidenceContext, old: SelRow, token: string, status: 'replaced' | 'withdrawn') {
  const db = ctx.env.DB;
  const out = [
    db.prepare(`UPDATE raise_ledger_selections SET status=?,closed_by=?,closed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),closed_token=?
      WHERE id=? AND project_id=? AND status='current' AND EXISTS(SELECT 1 FROM projects p JOIN users u ON u.id=? AND u.is_active=1 WHERE p.id=?
        AND p.deleted_at IS NULL AND p.company_id IS ? AND p.founder_id=u.founder_id AND u.role<>'admin' AND (u.role='founder' OR u.spinout_lab_active=1))`)
      .bind(status, ctx.user.id, token, old.id, ctx.projectId, ...founderBinds(ctx)),
    provenance(ctx, LEDGER_EVIDENCE_TABLE, old.uid, token, 'status', 'current', status, { selection_uid: old.uid }),
  ];
  if (old.item_id != null) {
    out.push(
      db.prepare(`UPDATE raise_claims SET state='not_backed',checked_at=NULL WHERE project_id=? AND id IN (SELECT claim_id FROM raise_claim_evidence WHERE item_id=? AND project_id=?)
        AND EXISTS(SELECT 1 FROM raise_ledger_selections WHERE id=? AND project_id=? AND status=? AND closed_token=?)`)
        .bind(ctx.projectId, old.item_id, ctx.projectId, old.id, ctx.projectId, status, token),
      db.prepare(`UPDATE raise_evidence_items SET state='unpinned',visibility='private',version=version+1,mutation_uid=?,updated_by=?,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND project_id=? AND EXISTS(SELECT 1 FROM raise_ledger_selections WHERE id=? AND project_id=? AND status=? AND closed_token=?)`)
        .bind(token, ctx.user.id, old.item_id, ctx.projectId, old.id, ctx.projectId, status, token),
      db.prepare(`DELETE FROM raise_claim_evidence WHERE item_id=? AND project_id=?
        AND EXISTS(SELECT 1 FROM raise_ledger_selections WHERE id=? AND project_id=? AND status=? AND closed_token=?)`)
        .bind(old.item_id, ctx.projectId, old.id, ctx.projectId, status, token),
    );
  }
  return out;
}

/** Re-review after a correction: the same claim, the figure re-confirmed on the latest revision, as a new Private item. */
export async function reviewLedgerFact(ctx: RaiseEvidenceContext, uid: string, data: unknown) {
  founderOnly(ctx);
  const d = body(data, [...FACT_KEYS, 'claim_id']);
  const old = await selection(ctx, uid);
  if (old.status !== 'current') throw new LedgerEvidenceError('decided', 409);
  const before = old.snapshot_id == null ? null : await ctx.env.DB.prepare(`SELECT f.provider,f.entity_key,f.report,f.window_key,
      (SELECT n.uid FROM financial_statement_snapshots n WHERE n.supersedes_id=f.id) AS superseded_by FROM financial_statement_snapshots f WHERE f.id=? AND f.project_id=?`)
    .bind(old.snapshot_id, ctx.projectId).first<{ provider: string; entity_key: string; report: string; window_key: string; superseded_by: string | null }>();
  if (before && !before.superseded_by) throw new LedgerEvidenceError('not_changed', 409);
  const snap = await latestRevision(ctx, d.snapshot_uid);
  // The same statement, corrected: provider, entity, report and window stay; a deleted revision keeps only provider and report to compare.
  if (snap.provider !== old.provider || snap.report !== old.report || (before && (snap.entity_key !== before.entity_key || snap.window_key !== before.window_key))) {
    throw new LedgerEvidenceError('mismatch', 409);
  }
  const fact = await confirmedFact(ctx, snap, d);
  if (fact.figure !== old.figure) throw new LedgerEvidenceError('mismatch', 409);
  const claimUid = d.claim_id ?? (old.claim_id == null ? null : (await ctx.env.DB.prepare('SELECT uid FROM raise_claims WHERE id=? AND project_id=?').bind(old.claim_id, ctx.projectId).first<{ uid: string }>())?.uid);
  const claim = await claimOf(ctx, claimUid);
  const p = await plan(ctx, snap, fact, claim);
  const token = newUid();
  // The founder's own links on the old item follow it to the new one, as Private evidence the founder must share again.
  const carried = old.item_id == null ? [] : ((await ctx.env.DB.prepare(`SELECT DISTINCT claim_id FROM raise_claim_evidence WHERE item_id=? AND project_id=? AND how IN ('founder','eadwyn_accepted')`)
    .bind(old.item_id, ctx.projectId).all<{ claim_id: number }>()).results ?? []).map(r => Number(r.claim_id)).filter(id => id !== p.claimId);
  const statements = [...closeItem(ctx, old, token, 'replaced'), ...writes(ctx, p, { id: old.id, token })];
  for (const claimId of carried) statements.push(ctx.env.DB.prepare(`INSERT OR IGNORE INTO raise_claim_evidence(project_id,claim_id,item_id,how,created_by,mutation_uid)
      SELECT ?,?,i.id,'founder',?,? FROM raise_evidence_items i WHERE i.uid=? AND i.project_id=?`).bind(ctx.projectId, claimId, ctx.user.id, p.token, p.itemUid, ctx.projectId),
    ctx.env.DB.prepare("UPDATE raise_claims SET state='not_backed',checked_at=NULL WHERE id=? AND project_id=?").bind(claimId, ctx.projectId));
  statements.push(activity(ctx, p.area, p.itemUid, 'ledger_evidence_reviewed', `A corrected ledger figure (revision ${snap.revision}) was re-reviewed; Private.`));
  await run(ctx, statements, async () => {
    if ((await selection(ctx, uid)).status !== 'current') throw new LedgerEvidenceError('decided', 409);
    await latestRevision(ctx, snap.uid);
  });
  return selectionView(ctx, p.selUid);
}

/** Withdraw: the item is unpinned, Private and out of every claim. The selection keeps its fact for the founder. */
export async function withdrawLedgerFact(ctx: RaiseEvidenceContext, uid: string) {
  founderOnly(ctx);
  const old = await selection(ctx, uid);
  if (old.status !== 'current') throw new LedgerEvidenceError('decided', 409);
  const statements = closeItem(ctx, old, newUid(), 'withdrawn');
  statements.push(activity(ctx, old.area, old.uid, 'ledger_evidence_withdrawn', 'A pinned ledger figure was withdrawn; Private.'));
  await run(ctx, statements, async () => { if ((await selection(ctx, uid)).status !== 'current') throw new LedgerEvidenceError('decided', 409); });
  return selectionView(ctx, uid);
}

type ViewRow = Record<string, any>;
const VIEW_SQL = `SELECT s.uid,s.status,s.figure,s.provider,s.report,s.revision,s.snapshot_uid,s.basis,s.currency,s.precision,s.period_start,s.period_end,s.as_of,s.observed_on,
    s.source_key,s.line_label,s.amount,s.area,s.selected_at,s.closed_at,f.id AS kept,f.provider AS f_provider,f.entity_key,f.window_key,f.report AS f_report,f.basis AS f_basis,f.currency AS f_currency,
    (SELECT n.uid FROM financial_statement_snapshots n WHERE n.supersedes_id=f.id) AS superseded_by,
    EXISTS(SELECT 1 FROM integrations x JOIN users u ON u.id=x.user_id AND u.is_active=1 WHERE x.id=f.integration_id AND x.provider_key=f.provider
      AND x.status='active' AND x.user_id=s.selected_by) AS access,
    i.uid AS item_uid,i.state AS item_state,i.visibility,i.version AS item_version,c.uid AS claim_uid,c.surface AS claim_surface,c.claim_kind,c.state AS claim_state,
    r.uid AS replaces_uid
  FROM raise_ledger_selections s LEFT JOIN financial_statement_snapshots f ON f.id=s.snapshot_id AND f.project_id=s.project_id
  LEFT JOIN raise_evidence_items i ON i.id=s.item_id AND i.project_id=s.project_id LEFT JOIN raise_claims c ON c.id=s.claim_id AND c.project_id=s.project_id
  LEFT JOIN raise_ledger_selections r ON r.id=s.replaces_id AND r.project_id=s.project_id
  WHERE s.project_id=?`;

/** The founder's view of one selection: the fact it kept, where its source stands now, and the correction to re-review. */
async function shape(ctx: RaiseEvidenceContext, r: ViewRow) {
  const source = r.kept == null ? 'deleted' : Number(r.access) !== 1 ? 'access_revoked' : r.superseded_by ? 'corrected' : 'current';
  let correction: unknown = null;
  if (source === 'corrected') {
    const latest = await ctx.env.DB.prepare(`SELECT f.id,f.uid,f.revision FROM financial_statement_snapshots f WHERE f.project_id=? AND f.provider=? AND f.entity_key=? AND f.report=?
        AND f.window_key=? AND f.basis=? AND f.currency=? ORDER BY f.revision DESC LIMIT 1`)
      .bind(ctx.projectId, r.f_provider, r.entity_key, r.f_report, r.window_key, r.f_basis, r.f_currency).first<{ id: number; uid: string; revision: number }>();
    const line = latest ? await ctx.env.DB.prepare('SELECT source_key,label,state,amount FROM financial_statement_lines WHERE snapshot_id=? AND source_key=?')
      .bind(latest.id, r.source_key).first<Record<string, unknown>>() : null;
    correction = latest ? { snapshot_uid: latest.uid, revision: latest.revision, line: line ?? null } : null;
  }
  return {
    uid: r.uid, status: r.status, selected_at: r.selected_at, closed_at: r.closed_at, replaces: r.replaces_uid ?? null,
    fact: { figure: r.figure, provider: r.provider, report: r.report, revision: r.revision, snapshot_uid: r.snapshot_uid, line: { source_key: r.source_key, label: r.line_label },
      amount: r.amount, currency: r.currency, basis: r.basis, observed_on: r.observed_on,
      period: r.as_of ? { as_of: r.as_of } : { start: r.period_start, end: r.period_end } },
    source, correction,
    item: r.item_uid ? { uid: r.item_uid, state: r.item_state, visibility: r.visibility, version: r.item_version, area: r.area } : null,
    claim: r.claim_uid ? { uid: r.claim_uid, surface: r.claim_surface, claim_kind: r.claim_kind, state: r.claim_state } : null,
  };
}
async function selectionView(ctx: RaiseEvidenceContext, uid: string) {
  const r = await ctx.env.DB.prepare(VIEW_SQL + ' AND s.uid=?').bind(ctx.projectId, uid).first<ViewRow>();
  if (!r) throw new LedgerEvidenceError('not_found', 404);
  return { selection: await shape(ctx, r) };
}

/**
 * The founder's ledger evidence: every selection with its kept fact and source state (current, corrected, access
 * revoked, deleted), and the lines that may be chosen now, from the latest revisions their own connection imported.
 */
export async function readLedgerEvidence(ctx: RaiseEvidenceContext) {
  founderOnly(ctx);
  try {
    const rows = (await ctx.env.DB.prepare(VIEW_SQL + ' ORDER BY s.id DESC LIMIT 200').bind(ctx.projectId).all<ViewRow>()).results ?? [];
    const selections = [];
    for (const r of rows) selections.push(await shape(ctx, r));
    const lines = (await ctx.env.DB.prepare(`SELECT f.uid AS snapshot_uid,f.provider,f.report,f.revision,f.basis,f.currency,f.precision,f.imported_at,
        f.requested_start,f.requested_end,f.requested_as_of,f.returned_start,f.returned_end,f.returned_as_of,l.source_key,l.label,l.kind,l.state,l.amount
      FROM financial_statement_snapshots f JOIN financial_statement_lines l ON l.snapshot_id=f.id
      JOIN integrations i ON i.id=f.integration_id AND i.provider_key=f.provider AND i.status='active' AND i.user_id=?
      WHERE f.project_id=? AND NOT EXISTS(SELECT 1 FROM financial_statement_snapshots n WHERE n.supersedes_id=f.id)
        AND ((f.report='balance_sheet' AND l.kind='cash_total') OR (f.report='profit_and_loss' AND l.kind IN ('revenue_total','net_income')))
      ORDER BY f.report,f.id DESC,l.position LIMIT 200`).bind(ctx.user.id, ctx.projectId).all<any>()).results ?? [];
    const options = lines.map(l => {
      const period = periodOf(l as Snap);
      const figure = (Object.keys(SUPPORT) as Figure[]).find(f => SUPPORT[f].report === l.report && SUPPORT[f].kind === l.kind)!;
      return { snapshot_uid: l.snapshot_uid, provider: l.provider, report: l.report, revision: l.revision, imported_at: l.imported_at, figure,
        line: { source_key: l.source_key, label: l.label }, state: l.state, amount: l.amount, currency: l.currency, basis: l.basis, observed_on: dayOf(period), period,
        pinnable: l.state === 'value' || l.state === 'zero' };
    });
    return { selections, options };
  } catch { throw new LedgerEvidenceError('unreadable', 503); }
}
