/**
 * D7723 (#7723) — a competitor's price on stated terms, with its capture date,
 * its source and its history (`competitor_price_observations`, migration
 * 202611191832_7723).
 *
 * A HINT IS NEVER A PRICE. `extractPricingHints` (services/webFetch.ts) finds
 * text such as "$49/mo" on a fetched page; the analysis keeps those strings
 * on the candidate. `listProposals` hands them back as unsaved proposals with
 * the candidate's fetched pages, and parses nothing out of them: no amount,
 * unit or term is guessed or prefilled. A row exists only when a person states
 * every term and confirms the source lets them keep it.
 *
 * WHO READS AND WRITES (owner answer A). A price attached to a venture is read
 * by whoever passes `canReadBoard` for that venture (the gate that already
 * shows its competitor names on the Validate card) and written by whoever
 * passes `canWrite`. An unattached price is read and withdrawn only by the
 * person who entered it. Hints are listed only to the member who ran the
 * analysis, from that analysis's own candidates, never from the fetch cache
 * shared across members.
 *
 * APPEND-ONLY. A later capture is a new row; a correction is a new row naming
 * the row it replaces; a withdrawal clears the amount and the source link and
 * says why. Nothing here updates a recorded field or deletes a row.
 */
import type { User } from '../types';
import { canReadBoard, canWrite, type ProjectRef } from '../routes/_founder_validate_helpers';
import { hostOf, nameKey, linkCandidatesToDirectory } from './competitorDirectoryLink';
import { currencyCode } from './currencies';

export const CHARGE_TYPES = ['subscription', 'usage', 'implementation_fee', 'quote'] as const;
export const PRICING_UNITS = ['per_seat', 'per_account', 'per_use', 'flat'] as const;
export const BILLING_PERIODS = ['monthly', 'quarterly', 'annual', 'one_time', 'per_use', 'not_stated'] as const;
export const CONTRACT_TERMS = ['no_commitment', 'monthly', 'annual', 'multi_year', 'not_stated'] as const;
export const REGIONS = ['global', 'north_america', 'latin_america', 'europe', 'united_kingdom', 'middle_east_africa', 'asia_pacific'] as const;
export const SOURCE_KINDS = ['official_page', 'filing', 'permitted_quotation', 'interview'] as const;

/** A decimal as text: digits, then optionally a point and digits. Never parsed into a float. */
const DECIMAL = /^[0-9]{1,20}(\.[0-9]{1,12})?$/;
const UID = /^[0-9a-f]{32}$/;
const ANALYSIS_ID = /^[A-Za-z0-9_-]{1,64}$/;
const TEXT_MAX = 200;
const REASON_MAX = 500;

/** A refusal with our own sentence; the route turns it into a body. */
export class PriceError extends Error {
  status: 400 | 403 | 404 | 409;
  code: string;
  sentence: string;
  extra?: Record<string, unknown>;
  constructor(status: PriceError['status'], code: string, sentence: string, extra?: Record<string, unknown>) {
    super(code);
    this.status = status; this.code = code; this.sentence = sentence; this.extra = extra;
  }
}

type Row = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const oneOf = <T extends readonly string[]>(list: T, v: unknown): T[number] | null =>
  (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T[number]) : null);
const positiveId = (v: unknown): number | null => {
  const raw = typeof v === 'number' ? String(v) : str(v);
  return /^[1-9][0-9]{0,9}$/.test(raw) ? Number(raw) : null;
};

/** The key a competitor's rows group under: its site's host, else its name without case or extra spacing. */
export function competitorKey(name: unknown, domain: unknown): string | null {
  return hostOf(domain) || nameKey(name);
}

/** Today in UTC as YYYY-MM-DD. */
const todayUtc = () => new Date().toISOString().slice(0, 10);

/** A real calendar date, YYYY-MM-DD, not after today. */
export function captureDate(v: unknown, today = todayUtc()): string | null {
  const s = str(v);
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  return s <= today ? s : null;
}

/** An http or https link, or null. */
export function sourceLink(v: unknown): string | null {
  const s = str(v);
  if (!s || s.length > 2000) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export async function loadProject(db: D1Database, id: number): Promise<ProjectRef | null> {
  return (await db.prepare('SELECT id, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL')
    .bind(id).first<ProjectRef>()) ?? null;
}

// ---------------------------------------------------------------------------
// Proposals: the hints one analysis holds. Nothing is written or parsed.
// ---------------------------------------------------------------------------

export type Proposal = {
  candidate_id: string;
  competitor_name: string;
  competitor_domain: string | null;
  hints: Array<{ hint_text: string }>;
  pages: Array<{ url: string; kind: string | null; title: string | null; fetched_at: string | null }>;
};

const safeParse = (v: unknown): Record<string, unknown> => {
  try { const o = JSON.parse(String(v ?? '{}')); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
};
const hintsOf = (details: unknown): string[] => {
  const p = safeParse(details).pricing;
  return Array.isArray(p) ? p.filter((h): h is string => typeof h === 'string' && h.trim() !== '') : [];
};

export async function listProposals(db: D1Database, userId: number, analysisIdRaw: unknown): Promise<{ analysis_id: string; project_id: number | null; proposals: Proposal[] }> {
  const analysisId = str(analysisIdRaw);
  if (!ANALYSIS_ID.test(analysisId)) throw new PriceError(400, 'analysis_required', 'Choose one of your analyses.');
  // Only the member who ran the analysis: the same rule every analysis read applies.
  const analysis = await db.prepare('SELECT id, project_id FROM competitor_analyses WHERE id = ? AND user_id = ?')
    .bind(analysisId, userId).first<{ id: string; project_id: number | null }>();
  if (!analysis) throw new PriceError(404, 'analysis_not_found', 'That analysis was not found among yours.');
  const candidates = (await db.prepare('SELECT id, name, domain, url, details_json FROM competitor_candidates WHERE analysis_id = ? ORDER BY position ASC, id ASC')
    .bind(analysisId).all<Row>()).results || [];
  const sources = (await db.prepare('SELECT candidate_id, url, kind, title, status, fetched_at FROM competitor_sources WHERE analysis_id = ? ORDER BY created_at ASC, id ASC')
    .bind(analysisId).all<Row>()).results || [];
  const proposals: Proposal[] = [];
  for (const c of candidates) {
    const hints = hintsOf(c.details_json);
    if (!hints.length) continue;
    const pages = sources
      .filter((s) => s.candidate_id === c.id && Number(s.status) >= 200 && Number(s.status) < 300 && sourceLink(s.url))
      .map((s) => ({ url: String(s.url), kind: (s.kind as string) ?? null, title: (s.title as string) ?? null, fetched_at: (s.fetched_at as string) ?? null }));
    proposals.push({
      candidate_id: String(c.id),
      competitor_name: String(c.name),
      competitor_domain: hostOf(c.domain) || hostOf(c.url),
      hints: hints.map((hint_text) => ({ hint_text })),
      pages,
    });
  }
  return { analysis_id: analysisId, project_id: analysis.project_id ?? null, proposals };
}

// ---------------------------------------------------------------------------
// Save: a confirmed hint or a price added by hand, one body.
// ---------------------------------------------------------------------------

type Terms = {
  product: string; plan: string; charge_type: (typeof CHARGE_TYPES)[number]; amount: string | null; currency: string;
  pricing_unit: (typeof PRICING_UNITS)[number]; unit_quantity: string | null; unit_label: string | null;
  billing_period: (typeof BILLING_PERIODS)[number]; contract_term: (typeof CONTRACT_TERMS)[number];
  region: (typeof REGIONS)[number]; captured_on: string; source_kind: (typeof SOURCE_KINDS)[number];
  source_url: string | null; source_share_confirmed: boolean;
};

/**
 * Every stated term, checked. A missing term is listed in `missing`; a term
 * outside its closed set is refused by name. Exported for the tests.
 */
export function readTerms(b: Row, today = todayUtc()): Terms {
  const missing: string[] = [];
  const need = (key: string, ok: boolean) => { if (!ok) missing.push(key); };
  const product = str(b.product);
  const plan = str(b.plan);
  need('product', !!product);
  need('plan', !!plan);
  need('charge_type', b.charge_type != null && b.charge_type !== '');
  const charge = oneOf(CHARGE_TYPES, b.charge_type);
  const amountGiven = b.amount != null && b.amount !== '';
  need('amount', amountGiven || charge === 'quote');
  need('currency', !!str(b.currency));
  need('pricing_unit', !!str(b.pricing_unit));
  need('billing_period', !!str(b.billing_period));
  need('contract_term', !!str(b.contract_term));
  need('region', !!str(b.region));
  need('captured_on', !!str(b.captured_on));
  need('source_kind', !!str(b.source_kind));
  const kind = oneOf(SOURCE_KINDS, b.source_kind);
  if (kind === 'official_page' || kind === 'filing') need('source_url', !!str(b.source_url));
  if (charge === 'usage') { need('unit_quantity', b.unit_quantity != null && b.unit_quantity !== ''); need('unit_label', !!str(b.unit_label)); }
  if (missing.length) {
    throw new PriceError(400, 'terms_missing', 'State every term before saving: the price is not kept on partial terms.', { missing });
  }
  const bad = (field: string, sentence: string): never => { throw new PriceError(400, 'invalid_term', sentence, { field }); };
  if (product.length > TEXT_MAX) bad('product', 'The product name is too long.');
  if (plan.length > TEXT_MAX) bad('plan', 'The plan name is too long.');
  if (!charge) bad('charge_type', 'The charge must be a subscription, usage, an implementation fee or a quote.');
  let amount: string | null = null;
  if (amountGiven) {
    if (typeof b.amount !== 'string' || !DECIMAL.test(b.amount.trim())) bad('amount', 'Write the amount as the source states it, in digits with at most one decimal point, such as 49 or 0.0004.');
    amount = (b.amount as string).trim();
  }
  const currency = currencyCode(str(b.currency).toUpperCase());
  if (!currency) bad('currency', 'Choose a currency by its three-letter ISO 4217 code, such as USD, EUR or GBP.');
  const unit = oneOf(PRICING_UNITS, b.pricing_unit);
  if (!unit) bad('pricing_unit', 'The pricing unit must be per seat, per account, per use or flat.');
  let unitQuantity: string | null = null;
  let unitLabel: string | null = null;
  if (charge === 'usage') {
    if (typeof b.unit_quantity !== 'string' || !DECIMAL.test(b.unit_quantity.trim()) || !/[1-9]/.test(b.unit_quantity)) {
      bad('unit_quantity', 'Write how many units the usage price covers, in digits, such as 1000.');
    }
    unitQuantity = (b.unit_quantity as string).trim();
    unitLabel = str(b.unit_label);
    if (unitLabel.length > TEXT_MAX) bad('unit_label', 'The unit label is too long.');
  } else if ((b.unit_quantity != null && b.unit_quantity !== '') || str(b.unit_label)) {
    bad('unit_quantity', 'A unit quantity and label belong only to a usage price.');
  }
  const period = oneOf(BILLING_PERIODS, b.billing_period);
  if (!period) bad('billing_period', 'The billing period must be monthly, quarterly, annual, one-time or per use.');
  if (period === 'not_stated' && charge !== 'quote') bad('billing_period', 'Only a quote may leave its billing period not stated.');
  const term = oneOf(CONTRACT_TERMS, b.contract_term);
  if (!term) bad('contract_term', 'The contract term must be no commitment, monthly, annual, multi-year or not stated.');
  const region = oneOf(REGIONS, b.region);
  if (!region) bad('region', 'Choose the region the price is for.');
  const captured = captureDate(b.captured_on, today);
  if (!captured) bad('captured_on', 'The capture date must be a real date, written YYYY-MM-DD, and not in the future.');
  if (!kind) bad('source_kind', 'The source must be an official page, a filing, a permitted quotation or an interview.');
  let url: string | null = null;
  if (str(b.source_url)) {
    if (kind === 'interview') bad('source_url', 'An interview is linked by its id, never by a link.');
    url = sourceLink(b.source_url);
    if (!url) bad('source_url', 'The source link must start with http:// or https://.');
  }
  return {
    product, plan, charge_type: charge!, amount, currency: currency!, pricing_unit: unit!, unit_quantity: unitQuantity,
    unit_label: unitLabel, billing_period: period!, contract_term: term!, region: region!, captured_on: captured!,
    source_kind: kind!, source_url: url, source_share_confirmed: b.source_share_confirmed === true,
  };
}

/** True only for an explicit `true`: a truthy string is not a confirmation. */
const confirmed = (v: unknown) => v === true;

export type SaveContext = { db: D1Database; user: User };

/**
 * One save. The order is the refusal order: terms, then the source-use
 * confirmation, then where the price came from and who may write there.
 */
export async function saveObservation(ctx: SaveContext, b: Row): Promise<Row> {
  const { db, user } = ctx;
  const terms = readTerms(b);
  if (!confirmed(b.source_use_confirmed)) {
    throw new PriceError(400, 'source_use_unconfirmed', 'Confirm that the source’s terms allow you to keep this price. Nothing was saved.');
  }
  if (terms.source_kind === 'permitted_quotation' && !terms.source_share_confirmed) {
    throw new PriceError(400, 'quotation_share_unconfirmed', 'Confirm that the quotation may be shared before saving it. Nothing was saved.');
  }

  let name: string;
  let domain: string | null;
  let analysisId: string | null = null;
  let candidateId: string | null = null;
  let hintText: string | null = null;
  let projectId: number | null = null;
  const bodyProject = b.project_id == null || b.project_id === '' ? null : positiveId(b.project_id);
  if (b.project_id != null && b.project_id !== '' && bodyProject == null) {
    throw new PriceError(400, 'invalid_term', 'Choose a venture by its id.', { field: 'project_id' });
  }

  if (b.analysis_id != null || b.candidate_id != null) {
    const aid = str(b.analysis_id);
    const cid = str(b.candidate_id);
    if (!ANALYSIS_ID.test(aid) || !ANALYSIS_ID.test(cid)) {
      throw new PriceError(400, 'invalid_term', 'A price from an analysis names the analysis and its competitor.', { field: 'candidate_id' });
    }
    const analysis = await db.prepare('SELECT id, project_id FROM competitor_analyses WHERE id = ? AND user_id = ?')
      .bind(aid, user.id).first<{ id: string; project_id: number | null }>();
    if (!analysis) throw new PriceError(404, 'analysis_not_found', 'That analysis was not found among yours.');
    const cand = await db.prepare('SELECT id, name, domain, url, details_json FROM competitor_candidates WHERE id = ? AND analysis_id = ?')
      .bind(cid, aid).first<Row>();
    if (!cand) throw new PriceError(404, 'candidate_not_found', 'That competitor is not in this analysis.');
    if (b.hint_text != null && b.hint_text !== '') {
      const hint = typeof b.hint_text === 'string' ? b.hint_text : '';
      if (!hintsOf(cand.details_json).includes(hint)) {
        throw new PriceError(400, 'hint_not_in_analysis', 'That hint is not one this analysis found for this competitor.');
      }
      hintText = hint;
    }
    name = String(cand.name);
    domain = hostOf(cand.domain) || hostOf(cand.url);
    analysisId = aid;
    candidateId = cid;
    // The venture is the analysis's own, never the body's.
    const fromAnalysis = analysis.project_id == null ? null : Number(analysis.project_id);
    if (bodyProject != null && bodyProject !== fromAnalysis) {
      throw new PriceError(400, 'project_mismatch', 'A price from an analysis belongs to the analysis’s venture.');
    }
    projectId = fromAnalysis;
  } else {
    if (b.hint_text != null && b.hint_text !== '') {
      throw new PriceError(400, 'hint_not_in_analysis', 'A hint is saved only from the analysis that found it.');
    }
    name = str(b.competitor_name);
    if (!name) throw new PriceError(400, 'terms_missing', 'Name the competitor.', { missing: ['competitor_name'] });
    if (name.length > TEXT_MAX) throw new PriceError(400, 'invalid_term', 'The competitor name is too long.', { field: 'competitor_name' });
    domain = null;
    if (str(b.competitor_domain)) {
      domain = hostOf(b.competitor_domain);
      if (!domain) throw new PriceError(400, 'invalid_term', 'The competitor’s domain could not be read.', { field: 'competitor_domain' });
    }
    projectId = bodyProject;
  }

  if (projectId != null) {
    const project = await loadProject(db, projectId);
    if (!project) throw new PriceError(404, 'project_not_found', 'That venture was not found.');
    if (!canWrite(project, user)) throw new PriceError(403, 'forbidden', 'Only the venture’s own team can record its prices.');
  }

  let interviewId: number | null = null;
  if (terms.source_kind === 'interview') {
    if (projectId == null) throw new PriceError(400, 'interview_needs_venture', 'A price heard in an interview belongs to the venture that held it.');
    interviewId = positiveId(b.interview_id);
    if (interviewId == null) throw new PriceError(400, 'terms_missing', 'Choose the interview the price came from.', { missing: ['interview_id'] });
    const interview = await db.prepare('SELECT id FROM discovery_interviews WHERE id = ? AND project_id = ?').bind(interviewId, projectId).first();
    if (!interview) throw new PriceError(404, 'interview_not_found', 'That interview is not one of this venture’s.');
  } else if (b.interview_id != null && b.interview_id !== '') {
    throw new PriceError(400, 'invalid_term', 'Only an interview-sourced price links an interview.', { field: 'interview_id' });
  }

  let correctsUid: string | null = null;
  if (b.corrects != null && b.corrects !== '') {
    const target = str(b.corrects);
    if (!UID.test(target)) throw new PriceError(400, 'invalid_term', 'Name the price this corrects by its id.', { field: 'corrects' });
    const old = await db.prepare(
      `SELECT uid, project_id, entered_by FROM competitor_price_observations WHERE uid = ?
         AND ((project_id IS NULL AND ? IS NULL AND entered_by = ?) OR project_id = ?)`,
    ).bind(target, projectId, user.id, projectId).first<Row>();
    if (!old) throw new PriceError(404, 'price_not_found', 'The price this corrects was not found where you can write.');
    const taken = await db.prepare('SELECT uid FROM competitor_price_observations WHERE corrects_uid = ?').bind(target).first();
    if (taken) throw new PriceError(409, 'already_corrected', 'That price has already been corrected; correct the newer one.');
    correctsUid = target;
  }

  const key = competitorKey(name, domain)!;
  const link = await linkCandidatesToDirectory(db, [{ id: 'c', name, domain }]);
  const directoryUid = link.byId.get('c') ?? null;

  let row: Row | null;
  try {
    row = await db.prepare(
      `INSERT INTO competitor_price_observations (competitor_name, competitor_domain, competitor_key, directory_uid,
         analysis_id, candidate_id, project_id, product, plan, hint_text, charge_type, amount, currency, pricing_unit,
         unit_quantity, unit_label, billing_period, contract_term, region, captured_on, source_kind, source_url,
         interview_id, source_use_confirmed, source_share_confirmed, entered_by, corrects_uid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
       RETURNING *`,
    ).bind(name, domain, key, directoryUid, analysisId, candidateId, projectId, terms.product, terms.plan, hintText,
      terms.charge_type, terms.amount, terms.currency, terms.pricing_unit, terms.unit_quantity, terms.unit_label,
      terms.billing_period, terms.contract_term, terms.region, terms.captured_on, terms.source_kind, terms.source_url,
      interviewId, terms.source_share_confirmed ? 1 : 0, user.id, correctsUid).first<Row>();
  } catch (e) {
    if (/UNIQUE/i.test(String((e as Error)?.message ?? '')) && correctsUid) {
      throw new PriceError(409, 'already_corrected', 'That price has already been corrected; correct the newer one.');
    }
    throw e;
  }
  return present(row!, new Map(), new Set());
}

// ---------------------------------------------------------------------------
// Withdraw: the one change the trigger allows.
// ---------------------------------------------------------------------------

/** The row when the caller may write it; null when it is not theirs to see. */
async function writableRow(db: D1Database, user: User, uid: string): Promise<Row | null> {
  const row = await db.prepare('SELECT * FROM competitor_price_observations WHERE uid = ?').bind(uid).first<Row>();
  if (!row) return null;
  if (row.project_id == null) return Number(row.entered_by) === Number(user.id) ? row : null;
  const project = await loadProject(db, Number(row.project_id));
  if (!project) return null;
  if (canWrite(project, user)) return row;
  if (canReadBoard(project, user)) throw new PriceError(403, 'forbidden', 'Only the venture’s own team can withdraw its prices.');
  return null;
}

export async function withdrawObservation(ctx: SaveContext, uidRaw: unknown, reasonRaw: unknown): Promise<Row> {
  const { db, user } = ctx;
  const uid = str(uidRaw);
  if (!UID.test(uid)) throw new PriceError(404, 'price_not_found', 'That price was not found.');
  const reason = str(reasonRaw);
  if (!reason) throw new PriceError(400, 'terms_missing', 'Say why the price is withdrawn.', { missing: ['reason'] });
  if (reason.length > REASON_MAX) throw new PriceError(400, 'invalid_term', 'The reason is too long.', { field: 'reason' });
  const row = await writableRow(db, user, uid);
  if (!row) throw new PriceError(404, 'price_not_found', 'That price was not found.');
  if (row.withdrawn_at != null) throw new PriceError(409, 'already_withdrawn', 'That price was already withdrawn.');
  const res = await db.prepare(
    `UPDATE competitor_price_observations
        SET withdrawn_at = datetime('now'), withdrawn_by = ?, withdrawn_reason = ?, amount = NULL, source_url = NULL
      WHERE uid = ? AND withdrawn_at IS NULL`,
  ).bind(user.id, reason, uid).run();
  if (!res.meta?.changes) throw new PriceError(409, 'already_withdrawn', 'That price was already withdrawn.');
  const after = await db.prepare('SELECT * FROM competitor_price_observations WHERE uid = ?').bind(uid).first<Row>();
  return present(after!, new Map(), new Set());
}

// ---------------------------------------------------------------------------
// Reads: current prices for a competitor, and the dated series of one plan.
// ---------------------------------------------------------------------------

export type ReadScope = { projectId: number | null };

/** The scope a read covers, refused when the caller may not read it. */
export async function readScope(db: D1Database, user: User, projectRaw: unknown): Promise<ReadScope> {
  if (projectRaw == null || projectRaw === '') return { projectId: null };
  const projectId = positiveId(projectRaw);
  if (projectId == null) throw new PriceError(400, 'invalid_term', 'Choose a venture by its id.', { field: 'project' });
  const project = await loadProject(db, projectId);
  if (!project) throw new PriceError(404, 'project_not_found', 'That venture was not found.');
  if (!canReadBoard(project, user)) throw new PriceError(403, 'forbidden', 'This venture’s prices are read by its own team.');
  return { projectId };
}

/** Every row for one competitor in the scope: the venture's, or the caller's own unattached rows. */
async function rowsFor(db: D1Database, user: User, scope: ReadScope, competitorRaw: unknown): Promise<Row[]> {
  const competitor = str(competitorRaw);
  if (!competitor) throw new PriceError(400, 'terms_missing', 'Name the competitor.', { missing: ['competitor'] });
  const host = hostOf(competitor);
  const name = nameKey(competitor);
  const sql = scope.projectId != null
    ? `SELECT * FROM competitor_price_observations WHERE project_id = ?
         AND (competitor_key = ? OR competitor_key = ? OR lower(trim(competitor_name)) = ?) ORDER BY captured_on ASC, id ASC`
    : `SELECT * FROM competitor_price_observations WHERE project_id IS NULL AND entered_by = ?
         AND (competitor_key = ? OR competitor_key = ? OR lower(trim(competitor_name)) = ?) ORDER BY captured_on ASC, id ASC`;
  const owner = scope.projectId != null ? scope.projectId : user.id;
  return (await db.prepare(sql).bind(owner, host, name, name).all<Row>()).results || [];
}

const lowerKey = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const seriesKey = (r: Row) => `${lowerKey(r.product)}|${lowerKey(r.plan)}|${r.charge_type}|${r.region}`;

/** uid → the uid of the row that replaced it. */
function replacements(rows: Row[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) if (r.corrects_uid) out.set(String(r.corrects_uid), String(r.uid));
  return out;
}

/**
 * The current rows: for each product, plan, charge type and region, the latest
 * capture that no correction replaced and that is not withdrawn.
 */
function currentUids(rows: Row[], replaced: Map<string, string>): Set<string> {
  const best = new Map<string, Row>();
  for (const r of rows) {
    if (replaced.has(String(r.uid)) || r.withdrawn_at != null) continue;
    const k = seriesKey(r);
    const prev = best.get(k);
    if (!prev || String(r.captured_on) > String(prev.captured_on)
      || (String(r.captured_on) === String(prev.captured_on) && Number(r.id) > Number(prev.id))) best.set(k, r);
  }
  return new Set([...best.values()].map((r) => String(r.uid)));
}

/** A row as the routes return it. A withdrawn row carries no amount and no link. */
function present(r: Row, replaced: Map<string, string>, current: Set<string>): Row {
  const withdrawn = r.withdrawn_at != null;
  return {
    uid: r.uid,
    competitor_name: r.competitor_name,
    competitor_domain: r.competitor_domain ?? null,
    directory_uid: r.directory_uid ?? null,
    analysis_id: r.analysis_id ?? null,
    candidate_id: r.candidate_id ?? null,
    project_id: r.project_id ?? null,
    product: r.product,
    plan: r.plan,
    hint_text: r.hint_text ?? null,
    charge_type: r.charge_type,
    amount: withdrawn ? null : (r.amount ?? null),
    currency: r.currency,
    pricing_unit: r.pricing_unit,
    unit_quantity: r.unit_quantity ?? null,
    unit_label: r.unit_label ?? null,
    billing_period: r.billing_period,
    contract_term: r.contract_term,
    region: r.region,
    captured_on: r.captured_on,
    source_kind: r.source_kind,
    source_url: withdrawn ? null : (r.source_url ?? null),
    interview_id: r.interview_id ?? null,
    source_use_confirmed: Number(r.source_use_confirmed) === 1,
    source_share_confirmed: Number(r.source_share_confirmed) === 1,
    entered_by: r.entered_by ?? null,
    entered_at: r.entered_at,
    corrects: r.corrects_uid ?? null,
    replaced_by: replaced.get(String(r.uid)) ?? null,
    current: current.has(String(r.uid)),
    withdrawn: withdrawn ? { at: r.withdrawn_at, by: r.withdrawn_by ?? null, reason: r.withdrawn_reason } : null,
  };
}

export async function readCurrent(db: D1Database, user: User, scope: ReadScope, competitor: unknown): Promise<Row[]> {
  const rows = await rowsFor(db, user, scope, competitor);
  const replaced = replacements(rows);
  const current = currentUids(rows, replaced);
  return rows.filter((r) => current.has(String(r.uid))).map((r) => present(r, replaced, current));
}

export async function readSeries(db: D1Database, user: User, scope: ReadScope, competitor: unknown, productRaw: unknown, planRaw: unknown): Promise<Row[]> {
  const product = lowerKey(productRaw);
  const plan = lowerKey(planRaw);
  const missing = [!product && 'product', !plan && 'plan'].filter(Boolean) as string[];
  if (missing.length) throw new PriceError(400, 'terms_missing', 'Name the product and the plan.', { missing });
  const rows = await rowsFor(db, user, scope, competitor);
  const replaced = replacements(rows);
  const current = currentUids(rows, replaced);
  return rows
    .filter((r) => lowerKey(r.product) === product && lowerKey(r.plan) === plan)
    .map((r) => present(r, replaced, current));
}
