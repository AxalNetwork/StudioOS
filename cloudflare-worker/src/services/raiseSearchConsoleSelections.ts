/**
 * D5842 part 2 (#5842): a founder pins one Search Console aggregate (part 1's preview: the venture's selected property,
 * one whole week, clicks, impressions or weighted CTR) to one Raise claim, as a Private evidence item; re-reviews it
 * after Google corrects a day of that week; or withdraws it.
 *
 * THE CHOICE. The founder names the aggregate (property, week, metric), the snapshot hash part 1's preview showed them,
 * and the claim. The value is rebuilt here from D5840's stored rows (never taken from the request) and must still hash
 * to what the founder saw; the claim must be one organic search can back (`searchConsoleMayBack`): paying customers,
 * revenue, conversions and traction proof are refused whatever is asked. Nothing is collected: an aggregate exists as
 * evidence only as this choice (`raise_search_console_selections`).
 *
 * WHAT IT WRITES, in one batch: the selection (its own copy of the aggregate), a `raise_evidence_items` row of kind
 * `search-console-aggregate` that is pinned and Private, its provenance, the founder's link to the claim, the claim reset
 * to be checked again, and the activity row. Sharing beyond Private is the existing evidence sharing (`setSharing` in
 * `raiseEvidence.ts`), never this file. Choosing the same aggregate for the same claim again writes nothing.
 *
 * AFTER. The evidence source query (`raiseEvidenceSources.ts`, dataset `searchConsole`) re-reads the week's current
 * revisions and the property's access on every read. A correction changes the item's fingerprint, so it reads
 * "changed", leaves every shared view and cannot be confirmed in place; the founder re-reviews it onto the revised
 * week (`reviewSearchConsoleSelection`: a new Private item, the old one unpinned and Private). Revoked access, an
 * unselected property or a switched-off connection drops it from every shared view at once. Withdrawal unpins it,
 * makes it Private and removes its claim links. The founder still reads the aggregate the selection kept.
 *
 * Founders only, and 503 until `GOOGLE_SEARCH_CONSOLE_APPROVED=1`, as part 1. Never calls Google, never reads a top
 * page or a query.
 */
import type { Env } from '../types';
import type { RaiseEvidenceContext } from './raiseEvidence';
import { logCycleWriteStatement } from './cycleActivity';
import { SEARCH_CONSOLE_EVIDENCE_KIND, SEARCH_CONSOLE_SELECTION_TABLE, searchConsoleCandidate, type EvidenceCandidate } from './raiseEvidenceSources';
import {
  SEARCH_CONSOLE_EVIDENCE_AREA, SEARCH_CONSOLE_MEANING, SEARCH_CONSOLE_METRIC_UNITS, parseSearchConsoleReference, parseSearchConsoleSelection,
  previewSearchConsoleEvidence, recheckSearchConsoleEvidence, searchConsoleMayBack,
  type SearchConsoleEvidenceCandidate, type SearchConsoleEvidenceSelection, type SearchConsoleMetric,
} from './raiseSearchConsoleEvidence';

const SENTENCES = {
  forbidden: 'Only this venture’s founders can pin Search Console evidence to a claim.',
  search_console_unavailable: 'Search Console is not available yet.',
  invalid: 'The Search Console evidence request is invalid. Refresh and try again.',
  not_found: 'That claim or selection is not available in this venture.',
  not_selected: 'This property is not the one selected for this venture’s Search Console.',
  revoked: 'Access to this Search Console property was lost. Nothing from it can be pinned.',
  not_recorded: 'No finalized Search Console data is stored for this week.',
  incomplete: 'This week is not stored in full yet, so it cannot be pinned.',
  undefined: 'This figure is not defined for this week (no reported day, or no impressions for CTR).',
  missing: 'The week this evidence came from is no longer stored in full, so it cannot be re-reviewed.',
  changed: 'The Search Console figure changed since you looked. Look again before pinning it.',
  claim_refused: 'Organic search activity cannot back this claim. It never backs paying customers, revenue, conversions or traction proof.',
  already_selected: 'This week’s figure is already pinned to another claim. Link that evidence item to this claim instead.',
  not_changed: 'Google has not corrected this week since it was pinned, so there is nothing to re-review.',
  decided: 'This selection has already been withdrawn or replaced.',
  unreadable: 'The Search Console evidence could not be read or saved. Nothing was saved; try again.',
} as const;
export type SearchConsoleSelectionCode = keyof typeof SENTENCES;
export class SearchConsoleSelectionError extends Error {
  readonly code: SearchConsoleSelectionCode;
  readonly status: 400 | 403 | 404 | 409 | 503;
  readonly sentence: string;
  constructor(code: SearchConsoleSelectionCode, status: SearchConsoleSelectionError['status']) {
    super('search_console_selection_refused'); this.code = code; this.status = status; this.sentence = SENTENCES[code];
  }
}

const OWN_UID = /^[0-9a-f]{32}$/;
const HASH = /^[a-f0-9]{64}$/;
const newUid = () => crypto.randomUUID().replaceAll('-', '');
const founderBinds = (ctx: RaiseEvidenceContext) => [ctx.user.id, ctx.projectId, ctx.companyId] as const;
/** The week's stored days, in date order, as the evidence source query reads them (the same SQL, so the strings agree). */
const WEEK_NOW = `SELECT
    (SELECT group_concat(x.source_revision,'.') FROM (SELECT d.source_revision FROM search_console_daily_totals d WHERE d.project_id=? AND d.site_url=?
      AND d.search_type='web' AND d.data_date BETWEEN ? AND ? ORDER BY d.data_date) x) AS revision_key,
    (SELECT group_concat(x.fingerprint,',') FROM (SELECT d.fingerprint FROM search_console_daily_totals d WHERE d.project_id=? AND d.site_url=?
      AND d.search_type='web' AND d.data_date BETWEEN ? AND ? ORDER BY d.data_date) x) AS fingerprints`;

function approved(env: Env) { if (env.GOOGLE_SEARCH_CONSOLE_APPROVED !== '1') throw new SearchConsoleSelectionError('search_console_unavailable', 503); }
function founderOnly(ctx: RaiseEvidenceContext) { if (!ctx.founder) throw new SearchConsoleSelectionError('forbidden', 403); }
function body(data: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new SearchConsoleSelectionError('invalid', 400);
  const d = data as Record<string, unknown>;
  if (Object.keys(d).some(k => !allowed.includes(k))) throw new SearchConsoleSelectionError('invalid', 400);
  return d;
}

type Claim = { id: number; uid: string; claim_kind: string };
async function claimOf(ctx: RaiseEvidenceContext, claimUid: unknown, metric: SearchConsoleMetric): Promise<Claim> {
  if (typeof claimUid !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(claimUid)) throw new SearchConsoleSelectionError('not_found', 404);
  const claim = await ctx.env.DB.prepare('SELECT id,uid,claim_kind FROM raise_claims WHERE uid=? AND project_id=?').bind(claimUid, ctx.projectId).first<Claim>();
  if (!claim) throw new SearchConsoleSelectionError('not_found', 404);
  if (!searchConsoleMayBack(metric, claim.claim_kind)) throw new SearchConsoleSelectionError('claim_refused', 409);
  return claim;
}

/** Part 1's preview of exactly this choice, which must still be selectable and still hash to what the founder saw. */
async function confirmed(ctx: RaiseEvidenceContext, sel: SearchConsoleEvidenceSelection, seenHash: unknown): Promise<SearchConsoleEvidenceCandidate> {
  if (typeof seenHash !== 'string' || !HASH.test(seenHash)) throw new SearchConsoleSelectionError('invalid', 400);
  const preview = await previewSearchConsoleEvidence(ctx, sel);
  if (preview.state !== 'selectable') throw new SearchConsoleSelectionError(preview.state, 409);
  if (!preview.candidate) throw new SearchConsoleSelectionError('unreadable', 503);
  if (preview.candidate.snapshot_hash !== seenHash) throw new SearchConsoleSelectionError('changed', 409);
  return preview.candidate;
}

type Planned = { selUid: string; itemUid: string; token: string; sc: SearchConsoleEvidenceCandidate; candidate: EvidenceCandidate; fingerprints: string; claimId: number };

/** The aggregate as the evidence source will read it back, and the Private item it makes. */
async function plan(ctx: RaiseEvidenceContext, sc: SearchConsoleEvidenceCandidate, claim: Claim): Promise<Planned> {
  const w = sc.search_console.window;
  const now = await ctx.env.DB.prepare(WEEK_NOW).bind(ctx.projectId, sc.search_console.site_url, w.from, w.to, ctx.projectId, sc.search_console.site_url, w.from, w.to)
    .first<{ revision_key: string | null; fingerprints: string | null }>();
  // Read between the preview and here, a correction is the founder's to look at again.
  if (!now?.fingerprints || now.revision_key !== sc.search_console.revision_key) throw new SearchConsoleSelectionError('changed', 409);
  const selUid = newUid(), itemUid = newUid(), token = newUid();
  const row = { uid: selUid, area: SEARCH_CONSOLE_EVIDENCE_AREA, metric: sc.search_console.metric, week_start: w.from, week_end: w.to, unit: sc.search_console.unit,
    value: sc.value_num, revision_key: now.revision_key, fingerprints: now.fingerprints, current_revision_key: now.revision_key, current_fingerprints: now.fingerprints };
  let candidate: EvidenceCandidate;
  try { candidate = await searchConsoleCandidate(ctx.env, ctx.projectId, row); } catch { throw new SearchConsoleSelectionError('unreadable', 503); }
  return { selUid, itemUid, token, sc, candidate, fingerprints: now.fingerprints, claimId: claim.id };
}

/** `replaces` is the old selection and the token that closed it in this batch (a re-review), or null (a first pin). */
function writes(ctx: RaiseEvidenceContext, p: Planned, replaces: { id: number; token: string } | null) {
  const db = ctx.env.DB, c = p.candidate, s = p.sc.search_console;
  return [
    // Guarded: the founder still owns the venture, the property is still selected with access, and the week's revisions are the ones read.
    db.prepare(`INSERT INTO raise_search_console_selections(uid,project_id,source_ref,site_url,search_type,week_start,week_end,metric,unit,value,numerator,denominator,
        days_reported,days_not_returned,revision_key,fingerprints,snapshot_hash,area,claim_id,replaces_id,selected_by)
      SELECT ?,?,?,?,'web',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM projects p JOIN users u ON u.id=? AND u.is_active=1 WHERE p.id=? AND p.deleted_at IS NULL AND p.company_id IS ?
        AND p.founder_id=u.founder_id AND u.role<>'admin' AND (u.role='founder' OR u.spinout_lab_active=1))
        AND (? IS NULL OR EXISTS(SELECT 1 FROM raise_search_console_selections o WHERE o.id=? AND o.project_id=? AND o.status='replaced' AND o.closed_token=?))
        AND EXISTS(SELECT 1 FROM search_console_selections v WHERE v.project_id=? AND v.site_url=? AND v.access_state='ok')
        AND (SELECT group_concat(x.source_revision,'.') FROM (SELECT d.source_revision FROM search_console_daily_totals d WHERE d.project_id=? AND d.site_url=?
          AND d.search_type='web' AND d.data_date BETWEEN ? AND ? ORDER BY d.data_date) x)=?`)
      .bind(p.selUid, ctx.projectId, p.sc.source_ref, s.site_url, s.window.from, s.window.to, s.metric, s.unit, p.sc.value_num, s.numerator, s.denominator,
        s.coverage.days_reported, s.coverage.days_not_returned, s.revision_key, p.fingerprints, p.sc.snapshot_hash, SEARCH_CONSOLE_EVIDENCE_AREA, p.claimId,
        replaces?.id ?? null, ctx.user.id, ...founderBinds(ctx), replaces?.id ?? null, replaces?.id ?? null, ctx.projectId, replaces?.token ?? null,
        ctx.projectId, s.site_url, ctx.projectId, s.site_url, s.window.from, s.window.to, s.revision_key),
    // The item is Private and pinned; its values are rebuilt by code from the stored week, never taken from the request.
    db.prepare(`INSERT INTO raise_evidence_items(uid,project_id,area,kind,source_table,source_ref,provider,source_label,strength,observed_on,summary,value_num,value_unit,currency,
        snapshot_hash,state,visibility,private_reason,mutation_uid,accepted_by,updated_by)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pinned','private',NULL,?,?,? WHERE EXISTS(SELECT 1 FROM raise_search_console_selections WHERE uid=? AND project_id=?)`)
      .bind(p.itemUid, ctx.projectId, c.area, SEARCH_CONSOLE_EVIDENCE_KIND, SEARCH_CONSOLE_SELECTION_TABLE, c.source_ref, c.provider, c.source_label, c.strength, c.observed_on,
        c.summary, c.value_num, c.value_unit, c.currency, c.snapshot_hash, p.token, ctx.user.id, ctx.user.id, p.selUid, ctx.projectId),
    db.prepare('UPDATE raise_search_console_selections SET item_id=(SELECT id FROM raise_evidence_items WHERE uid=? AND project_id=?) WHERE uid=? AND project_id=?')
      .bind(p.itemUid, ctx.projectId, p.selUid, ctx.projectId),
    // NOT NULL provenance is the batch's guard: no item, no provenance row, and the whole choice rolls back.
    provenance(ctx, 'raise_evidence_items', p.itemUid, p.token, 'snapshot_hash', null, c.snapshot_hash,
      { source_ref: p.sc.source_ref, window: s.window, metric: s.metric, revision_key: s.revision_key }),
    db.prepare(`INSERT OR IGNORE INTO raise_claim_evidence(project_id,claim_id,item_id,how,created_by,mutation_uid)
      SELECT ?,?,i.id,'founder',?,? FROM raise_evidence_items i WHERE i.uid=? AND i.project_id=?`).bind(ctx.projectId, p.claimId, ctx.user.id, p.token, p.itemUid, ctx.projectId),
    db.prepare("UPDATE raise_claims SET state='not_backed',checked_at=NULL WHERE id=? AND project_id=?").bind(p.claimId, ctx.projectId),
  ];
}

/** The row is found by the token this batch wrote on it, so a guarded write that wrote nothing leaves a NULL here and fails NOT NULL. */
function provenance(ctx: RaiseEvidenceContext, table: 'raise_evidence_items' | typeof SEARCH_CONSOLE_SELECTION_TABLE, uid: string, token: string, column: string,
  before: string | null, after: string, citation: Record<string, unknown>) {
  return ctx.env.DB.prepare(`INSERT INTO fill_provenance(target_table,target_row_id,target_column,proposal_id,fill_class,proposed_value,written_value,edited,citation_json,model,task,decided_by,target_row_ref,ai_usage_log_id,ai_proposal_id)
    VALUES(?,CASE ? WHEN 'raise_evidence_items' THEN (SELECT id FROM raise_evidence_items WHERE uid=? AND project_id=? AND mutation_uid=?)
      ELSE (SELECT id FROM raise_search_console_selections WHERE uid=? AND project_id=? AND closed_token=?) END,?,NULL,'restatement',?,?,0,?,NULL,'raise:search-console-evidence',?,?,NULL,NULL)`)
    .bind(table, table, uid, ctx.projectId, token, uid, ctx.projectId, token, column, after, after,
      JSON.stringify({ source_kind: 'connector', source_label: 'connector', prior_value: before, ...citation }), ctx.user.id, uid);
}
const activity = (ctx: RaiseEvidenceContext, id: string, action: string, summary: string) =>
  logCycleWriteStatement(ctx.env, { projectId: ctx.projectId, userId: ctx.user.id, cycle: 'raise', module: 'investor-narrative', entityId: id, action, summary });

async function run(ctx: RaiseEvidenceContext, statements: ReturnType<Env['DB']['prepare']>[], explain: () => Promise<void>) {
  try { await ctx.env.DB.batch(statements); }
  catch {
    try { await explain(); } catch (e) { if (e instanceof SearchConsoleSelectionError) throw e; }
    throw new SearchConsoleSelectionError('unreadable', 503);
  }
}

type SelRow = {
  id: number; uid: string; status: string; source_ref: string; site_url: string; week_start: string; metric: SearchConsoleMetric;
  revision_key: string; snapshot_hash: string; claim_id: number | null; item_id: number | null;
};
async function selection(ctx: RaiseEvidenceContext, uid: string): Promise<SelRow> {
  if (!OWN_UID.test(uid)) throw new SearchConsoleSelectionError('not_found', 404);
  const s = await ctx.env.DB.prepare(`SELECT id,uid,status,source_ref,site_url,week_start,metric,revision_key,snapshot_hash,claim_id,item_id
    FROM raise_search_console_selections WHERE uid=? AND project_id=?`).bind(uid, ctx.projectId).first<SelRow>();
  if (!s) throw new SearchConsoleSelectionError('not_found', 404);
  return s;
}
async function current(ctx: RaiseEvidenceContext, sourceRef: string) {
  return ctx.env.DB.prepare("SELECT uid,claim_id,snapshot_hash FROM raise_search_console_selections WHERE project_id=? AND source_ref=? AND status='current'")
    .bind(ctx.projectId, sourceRef).first<{ uid: string; claim_id: number | null; snapshot_hash: string }>();
}

/** The statements that close the old item: unpinned, Private, and out of every claim (each claim checked again). */
function closeItem(ctx: RaiseEvidenceContext, old: SelRow, token: string, status: 'replaced' | 'withdrawn') {
  const db = ctx.env.DB;
  const out = [
    db.prepare(`UPDATE raise_search_console_selections SET status=?,closed_by=?,closed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),closed_token=?
      WHERE id=? AND project_id=? AND status='current' AND EXISTS(SELECT 1 FROM projects p JOIN users u ON u.id=? AND u.is_active=1 WHERE p.id=? AND p.deleted_at IS NULL AND p.company_id IS ?
        AND p.founder_id=u.founder_id AND u.role<>'admin' AND (u.role='founder' OR u.spinout_lab_active=1))`)
      .bind(status, ctx.user.id, token, old.id, ctx.projectId, ...founderBinds(ctx)),
    provenance(ctx, SEARCH_CONSOLE_SELECTION_TABLE, old.uid, token, 'status', 'current', status, { selection_uid: old.uid }),
  ];
  if (old.item_id != null) {
    out.push(
      db.prepare(`UPDATE raise_claims SET state='not_backed',checked_at=NULL WHERE project_id=? AND id IN (SELECT claim_id FROM raise_claim_evidence WHERE item_id=? AND project_id=?) AND EXISTS(SELECT 1 FROM raise_search_console_selections WHERE id=? AND project_id=? AND status=? AND closed_token=?)`)
        .bind(ctx.projectId, old.item_id, ctx.projectId, old.id, ctx.projectId, status, token),
      db.prepare(`UPDATE raise_evidence_items SET state='unpinned',visibility='private',version=version+1,mutation_uid=?,updated_by=?,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND project_id=? AND EXISTS(SELECT 1 FROM raise_search_console_selections WHERE id=? AND project_id=? AND status=? AND closed_token=?)`)
        .bind(token, ctx.user.id, old.item_id, ctx.projectId, old.id, ctx.projectId, status, token),
      db.prepare(`DELETE FROM raise_claim_evidence WHERE item_id=? AND project_id=? AND EXISTS(SELECT 1 FROM raise_search_console_selections WHERE id=? AND project_id=? AND status=? AND closed_token=?)`)
        .bind(old.item_id, ctx.projectId, old.id, ctx.projectId, status, token),
    );
  }
  return out;
}

/**
 * Pin the aggregate the founder previewed to one claim, as a Private item. The same aggregate for the same claim again
 * returns the existing selection and writes nothing (`repeated: true`).
 */
export async function pinSearchConsoleAggregate(ctx: RaiseEvidenceContext, data: unknown) {
  approved(ctx.env); founderOnly(ctx);
  const d = body(data, ['site_url', 'week_start', 'metric', 'search_type', 'snapshot_hash', 'claim_id']);
  const sel = parseSearchConsoleSelection(d);
  const claim = await claimOf(ctx, d.claim_id, sel.metric);
  const sc = await confirmed(ctx, sel, d.snapshot_hash);
  const existing = await current(ctx, sc.source_ref);
  if (existing) {
    if (existing.claim_id === claim.id && existing.snapshot_hash === sc.snapshot_hash) return { ...(await selectionView(ctx, existing.uid)), repeated: true };
    throw new SearchConsoleSelectionError('already_selected', 409);
  }
  const p = await plan(ctx, sc, claim);
  await run(ctx, [...writes(ctx, p, null),
    activity(ctx, p.itemUid, 'search_console_evidence_pinned', `A Search Console ${sc.search_console.metric} figure for one week was pinned to a claim; Private.`)],
  async () => { if (await current(ctx, sc.source_ref)) throw new SearchConsoleSelectionError('already_selected', 409); await confirmed(ctx, sel, d.snapshot_hash); });
  return { ...(await selectionView(ctx, p.selUid)), repeated: false };
}

/** Part 1's recheck of what this selection recorded: current, corrected (original beside revised), missing or revoked. */
async function recheckOf(ctx: RaiseEvidenceContext, s: Pick<SelRow, 'source_ref' | 'snapshot_hash' | 'revision_key'>) {
  return recheckSearchConsoleEvidence(ctx, parseSearchConsoleReference({ source_ref: s.source_ref, snapshot_hash: s.snapshot_hash, revision_key: s.revision_key }));
}

/**
 * Re-review after Google corrected a day of the week: the same aggregate, the revised value confirmed by the hash the
 * founder previewed, as a new Private item for the same claim (or another organic-search claim). The old item is
 * unpinned and Private, and the founder's own links on it follow the new one, which the founder shares again.
 */
export async function reviewSearchConsoleSelection(ctx: RaiseEvidenceContext, uid: string, data: unknown) {
  approved(ctx.env); founderOnly(ctx);
  const d = body(data, ['snapshot_hash', 'claim_id']);
  const old = await selection(ctx, uid);
  if (old.status !== 'current') throw new SearchConsoleSelectionError('decided', 409);
  const re = await recheckOf(ctx, old);
  if (re.state === 'current') throw new SearchConsoleSelectionError('not_changed', 409);
  if (re.state !== 'corrected') throw new SearchConsoleSelectionError(re.state, 409);
  const sel: SearchConsoleEvidenceSelection = { site_url: old.site_url, week_start: old.week_start, search_type: 'web', metric: old.metric };
  const claimUid = d.claim_id ?? (old.claim_id == null ? null : (await ctx.env.DB.prepare('SELECT uid FROM raise_claims WHERE id=? AND project_id=?').bind(old.claim_id, ctx.projectId).first<{ uid: string }>())?.uid);
  const claim = await claimOf(ctx, claimUid, old.metric);
  const sc = await confirmed(ctx, sel, d.snapshot_hash);
  const p = await plan(ctx, sc, claim);
  const token = newUid();
  const carried = old.item_id == null ? [] : ((await ctx.env.DB.prepare(`SELECT DISTINCT l.claim_id, c.claim_kind FROM raise_claim_evidence l JOIN raise_claims c ON c.id=l.claim_id AND c.project_id=l.project_id
      WHERE l.item_id=? AND l.project_id=? AND l.how IN ('founder','eadwyn_accepted')`).bind(old.item_id, ctx.projectId).all<{ claim_id: number; claim_kind: string }>()).results ?? [])
    .filter(r => Number(r.claim_id) !== p.claimId && searchConsoleMayBack(old.metric, r.claim_kind)).map(r => Number(r.claim_id));
  const statements = [...closeItem(ctx, old, token, 'replaced'), ...writes(ctx, p, { id: old.id, token })];
  for (const claimId of carried) statements.push(ctx.env.DB.prepare(`INSERT OR IGNORE INTO raise_claim_evidence(project_id,claim_id,item_id,how,created_by,mutation_uid)
      SELECT ?,?,i.id,'founder',?,? FROM raise_evidence_items i WHERE i.uid=? AND i.project_id=?`).bind(ctx.projectId, claimId, ctx.user.id, p.token, p.itemUid, ctx.projectId),
    ctx.env.DB.prepare("UPDATE raise_claims SET state='not_backed',checked_at=NULL WHERE id=? AND project_id=?").bind(claimId, ctx.projectId));
  statements.push(activity(ctx, p.itemUid, 'search_console_evidence_reviewed', `A corrected Search Console ${old.metric} figure was re-reviewed; Private.`));
  await run(ctx, statements, async () => {
    if ((await selection(ctx, uid)).status !== 'current') throw new SearchConsoleSelectionError('decided', 409);
    await confirmed(ctx, sel, d.snapshot_hash);
  });
  return { ...(await selectionView(ctx, p.selUid)), replaced: uid };
}

/** Withdraw: the item is unpinned, Private and out of every claim, so every shared view drops it. The selection keeps its aggregate. */
export async function withdrawSearchConsoleSelection(ctx: RaiseEvidenceContext, uid: string) {
  approved(ctx.env); founderOnly(ctx);
  const old = await selection(ctx, uid);
  if (old.status !== 'current') throw new SearchConsoleSelectionError('decided', 409);
  const statements = closeItem(ctx, old, newUid(), 'withdrawn');
  statements.push(activity(ctx, old.uid, 'search_console_evidence_withdrawn', 'A pinned Search Console figure was withdrawn; Private.'));
  await run(ctx, statements, async () => { if ((await selection(ctx, uid)).status !== 'current') throw new SearchConsoleSelectionError('decided', 409); });
  return selectionView(ctx, uid);
}

type ViewRow = Record<string, any>;
const VIEW_SQL = `SELECT s.uid,s.status,s.source_ref,s.site_url,s.search_type,s.week_start,s.week_end,s.metric,s.unit,s.value,s.numerator,s.denominator,s.days_reported,
    s.days_not_returned,s.revision_key,s.snapshot_hash,s.area,s.selected_at,s.closed_at,
    i.uid AS item_uid,i.state AS item_state,i.visibility,i.version AS item_version,c.uid AS claim_uid,c.surface AS claim_surface,c.claim_kind,c.state AS claim_state,r.uid AS replaces_uid
  FROM raise_search_console_selections s
  LEFT JOIN raise_evidence_items i ON i.id=s.item_id AND i.project_id=s.project_id LEFT JOIN raise_claims c ON c.id=s.claim_id AND c.project_id=s.project_id
  LEFT JOIN raise_search_console_selections r ON r.id=s.replaces_id AND r.project_id=s.project_id
  WHERE s.project_id=?`;

/** The founder's view of one selection: the aggregate it kept, and where its source stands now (part 1's recheck). */
async function shape(ctx: RaiseEvidenceContext, r: ViewRow) {
  const re = r.status === 'current' ? await recheckOf(ctx, r as SelRow) : null;
  const metric = r.metric as SearchConsoleMetric;
  return {
    uid: r.uid, status: r.status, selected_at: r.selected_at, closed_at: r.closed_at, replaces: r.replaces_uid ?? null,
    aggregate: {
      site_url: r.site_url, search_type: r.search_type, data_state: 'final', aggregation_type: 'byProperty', window: { from: r.week_start, to: r.week_end },
      metric, label: SEARCH_CONSOLE_METRIC_UNITS[metric]?.label ?? null, unit: r.unit, value: Number(r.value),
      numerator: r.numerator == null ? null : Number(r.numerator), denominator: r.denominator == null ? null : Number(r.denominator),
      coverage: { days: 7, days_reported: Number(r.days_reported), days_not_returned: Number(r.days_not_returned) },
      revision_key: r.revision_key, meaning: SEARCH_CONSOLE_MEANING,
    },
    // `withdrawn` or `replaced` once closed; otherwise current, corrected (original beside revised: re-review), missing or revoked.
    source: re ? { state: re.state, reason: re.reason, requires_review: re.requires_review, stale: re.stale, original: re.original, revised: re.revised, corrected_days: re.corrected_days }
      : { state: r.status, reason: null, requires_review: false, stale: null, original: null, revised: null, corrected_days: [] },
    item: r.item_uid ? { uid: r.item_uid, state: r.item_state, visibility: r.visibility, version: r.item_version, area: r.area } : null,
    claim: r.claim_uid ? { uid: r.claim_uid, surface: r.claim_surface, claim_kind: r.claim_kind, state: r.claim_state } : null,
  };
}
async function selectionView(ctx: RaiseEvidenceContext, uid: string) {
  const r = await ctx.env.DB.prepare(VIEW_SQL + ' AND s.uid=?').bind(ctx.projectId, uid).first<ViewRow>();
  if (!r) throw new SearchConsoleSelectionError('not_found', 404);
  return { selection: await shape(ctx, r) };
}

/** The founder's Search Console evidence: every selection, newest first, with the aggregate it kept and its source now. */
export async function readSearchConsoleSelections(ctx: RaiseEvidenceContext) {
  approved(ctx.env); founderOnly(ctx);
  const rows = (await ctx.env.DB.prepare(VIEW_SQL + ' ORDER BY s.id DESC LIMIT 200').bind(ctx.projectId).all<ViewRow>()).results ?? [];
  const selections = [];
  for (const r of rows) selections.push(await shape(ctx, r));
  return { selections };
}
