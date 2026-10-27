/**
 * D1256 (#3279, part 3 of #2428) — who reads a venture scorecard, what they
 * see, and the writes beside it: reviews, corrections, an investor's
 * weighting and the founder's sharing (migration 626).
 *
 * THE VISIBILITY RULE (#2428 § Who sees what; owner questions 1, 2, 10 A):
 *   · Founder (the venture's founder and its accepted owners and co-founders):
 *     their own, in full, with what investors see beside it. Never logged.
 *   · Admin and Operating Partner (`partner`, the studio staff role, which
 *     reads every deal today): in full, with reviews. Every read is logged.
 *   · Advisor: read-only, only when the founder has shared with them. Logged.
 *   · Investor: through a deal only, once on it (invited or committed, the
 *     deal page's one rule) and only while the founder's switch is on. Bands
 *     and confidence until a pairwise NDA with the venture's founder is
 *     active; then values and inputs, with personal and team-only inputs
 *     as a band. An investor off the deal reads nothing. Every read is logged.
 *   · Explorer and everyone else: nothing.
 *
 * THE SWITCH. With no sharing row the investors' switch is on once the venture
 * is listed (it has a deal) and off before. The founder turns it off or on.
 *
 * A READ LOG carries the scope count, the deal, whether it was masked and the
 * reader's role: never a value, band or input. Reviews, corrections and
 * sharing changes are audited the same way, by kind and scope only.
 *
 * Scores are derived, never typed: no route here accepts a value, band,
 * confidence or grade. A review is a note or a bounded adjustment shown beside
 * the computed value, which stays. No score sets a deal or venture status.
 */
import type { Env, User } from '../../types';
import { isSuperAdmin } from '../../auth';
import { notify } from '../notify';
import { PMF_INPUT_KEYS } from '../scoring/pmf';
import { SCOPE_ORDER, VENTURE_MODEL_V1, type AnyScopeKey } from './model';
import { confidenceWord, type StoredScope } from './store';

export const REVIEW_CAP = 15;
export const REASON_MIN = 10;
export const TEXT_MAX = 2000;
export const WEIGHT_MAX = 5;
export const BATCH_MAX = 200;

export type Viewer = 'founder' | 'staff' | 'advisor';

/** Each scope's label, in D1253's one order. */
export const SCOPE_LABELS: Readonly<Record<AnyScopeKey, string>> = Object.freeze(Object.fromEntries(SCOPE_ORDER.map((k) => [
  k, k === 'pmf' ? 'Product-market fit' : VENTURE_MODEL_V1.scopes[k].label,
])) as Record<AnyScopeKey, string>);

export function isScope(v: unknown): v is AnyScopeKey {
  return typeof v === 'string' && (SCOPE_ORDER as readonly string[]).includes(v);
}

/** The input keys a scope's model names; a correction must name one of them. */
export function inputKeysOf(scope: AnyScopeKey): readonly string[] {
  return scope === 'pmf' ? PMF_INPUT_KEYS : VENTURE_MODEL_V1.scopes[scope].inputs.map((i) => i.key);
}

const STATEMENTS = {
  project: 'SELECT id, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL',
  member: `SELECT role FROM project_members WHERE project_id = ? AND user_id = ? AND status = 'accepted' AND removed_at IS NULL LIMIT 1`,
  advisorShare: `SELECT enabled FROM venture_score_sharing WHERE project_id = ? AND audience = 'advisor' AND user_id = ?`,
  investorSwitch: `SELECT enabled FROM venture_score_sharing WHERE project_id = ? AND audience = 'investors' AND user_id = 0`,
  listed: 'SELECT COUNT(*) AS n FROM deals WHERE project_id = ?',
  dealProject: 'SELECT project_id FROM deals WHERE id = ?',
  onDeal: `SELECT (EXISTS (SELECT 1 FROM deal_invitations i WHERE i.deal_id = ? AND i.investor_user_id = ?)
              OR EXISTS (SELECT 1 FROM commitments k WHERE k.deal_id = ? AND k.investor_user_id = ?)) AS on_deal`,
  nda: `SELECT 1 AS present FROM pairwise_ndas n
          JOIN users f ON f.founder_id IS NOT NULL
          JOIN projects p ON p.founder_id = f.founder_id AND p.id = ?
         WHERE n.status = 'active' AND (n.valid_until IS NULL OR datetime(n.valid_until) > datetime('now'))
           AND ((n.party_a_user_id = f.id AND n.party_b_user_id = ?) OR (n.party_b_user_id = f.id AND n.party_a_user_id = ?))
         LIMIT 1`,
  founders: `SELECT u.id FROM projects p JOIN users u ON u.founder_id = p.founder_id
              WHERE p.id = ? AND p.founder_id IS NOT NULL AND u.is_active = 1
             UNION
             SELECT pm.user_id FROM project_members pm
              WHERE pm.project_id = ? AND pm.status = 'accepted' AND pm.removed_at IS NULL AND pm.role IN ('owner', 'cofounder')`,
  log: `INSERT INTO activity_logs (project_id, user_id, entity_type, entity_id, action, details, actor)
        VALUES (?, ?, 'venture.scorecard', ?, ?, ?, ?)`,
  reviews: `SELECT r.uid, r.scope, r.scorecard_uid, r.model_version, r.computed_value, r.adjustment, r.reason, r.note, r.reviewer_role, r.created_at
              FROM venture_score_reviews r
             WHERE r.project_id = ? AND r.id = (SELECT MAX(x.id) FROM venture_score_reviews x WHERE x.project_id = r.project_id AND x.scope = r.scope)`,
  insertReview: `INSERT INTO venture_score_reviews
      (uid, project_id, scope, scorecard_uid, model_version, computed_value, adjustment, reason, note, reviewer_user_id, reviewer_role)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  corrections: `SELECT uid, scope, input_key, message, state, created_at, decided_at, decision_note
                  FROM venture_score_corrections WHERE project_id = ? ORDER BY id DESC LIMIT 50`,
  insertCorrection: `INSERT INTO venture_score_corrections (uid, project_id, scope, input_key, message, requested_by) VALUES (?, ?, ?, ?, ?, ?)`,
  openCorrection: `SELECT uid FROM venture_score_corrections WHERE project_id = ? AND scope = ? AND input_key = ? AND state = 'open' LIMIT 1`,
  weights: 'SELECT weights_json, updated_at FROM investor_scope_weights WHERE user_id = ?',
  putWeights: `INSERT INTO investor_scope_weights (user_id, weights_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET weights_json = excluded.weights_json, updated_at = excluded.updated_at`,
  dropWeights: 'DELETE FROM investor_scope_weights WHERE user_id = ?',
  sharing: `SELECT s.audience, s.user_id, s.enabled, s.updated_at, u.name AS advisor_name
              FROM venture_score_sharing s LEFT JOIN users u ON u.id = s.user_id AND s.audience = 'advisor'
             WHERE s.project_id = ?`,
  putSharing: `INSERT INTO venture_score_sharing (project_id, audience, user_id, enabled, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, audience, user_id) DO UPDATE SET enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  advisors: `SELECT COUNT(*) AS n FROM users WHERE role = 'advisor' AND is_active = 1 AND id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`,
  // D1258: the venture's own advisors (accepted on its roster, an active advisor account), whom its founder may share with.
  candidates: `SELECT u.id AS user_id, u.name AS advisor_name FROM project_members pm JOIN users u ON u.id = pm.user_id
                WHERE pm.project_id = ? AND pm.role = 'advisor' AND pm.status = 'accepted' AND pm.removed_at IS NULL
                  AND u.role = 'advisor' AND u.is_active = 1
                ORDER BY u.id LIMIT 50`,
  // D1258: every stored row, oldest first, for the trajectory (SC12). No inputs, never a signature.
  trajectory: `SELECT scope, value, band, confidence, state, model_version, computed_at
                 FROM venture_scorecards WHERE project_id = ? ORDER BY id LIMIT 2000`,
} as const;
export { STATEMENTS as ACCESS_STATEMENTS };

const role = (u: User) => String(u.role || '').toLowerCase();
export const isStaff = (u: User) => role(u) === 'admin' || role(u) === 'partner';

/** The venture, or null when it does not exist or is deleted. */
export async function ventureRow(env: Env, projectId: number): Promise<{ id: number; founder_id: number | null } | null> {
  if (!Number.isSafeInteger(projectId) || projectId < 1) return null;
  return env.DB.prepare(STATEMENTS.project).bind(projectId).first<{ id: number; founder_id: number | null }>();
}

/** True for the venture's founder and its accepted owners and co-founders. Advisors on the roster are not founders. */
export async function isFounderOf(env: Env, user: User, project: { id: number; founder_id: number | null }): Promise<boolean> {
  if (role(user) === 'founder' && user.founder_id != null && project.founder_id === user.founder_id) return true;
  if (role(user) === 'investor' || role(user) === 'exploring') return false;
  const m = await env.DB.prepare(STATEMENTS.member).bind(project.id, user.id).first<{ role: string }>();
  return m?.role === 'owner' || m?.role === 'cofounder';
}

/** How this person reads a venture's scorecard by its id: never an investor, who reads through a deal. */
export async function viewerOf(env: Env, user: User, project: { id: number; founder_id: number | null }): Promise<Viewer | null> {
  if (isStaff(user)) return 'staff';
  if (await isFounderOf(env, user, project)) return 'founder';
  if (role(user) === 'advisor') {
    const share = await env.DB.prepare(STATEMENTS.advisorShare).bind(project.id, user.id).first<{ enabled: number }>();
    if (Number(share?.enabled) === 1) return 'advisor';
  }
  return null;
}

/** The investors' switch: the founder's row, or on once the venture is listed. */
export async function investorsMaySee(env: Env, projectId: number): Promise<{ on: boolean; set: boolean }> {
  const row = await env.DB.prepare(STATEMENTS.investorSwitch).bind(projectId).first<{ enabled: number }>();
  if (row) return { on: Number(row.enabled) === 1, set: true };
  const listed = await env.DB.prepare(STATEMENTS.listed).bind(projectId).first<{ n: number }>();
  return { on: Number(listed?.n ?? 0) > 0, set: false };
}

/** An investor is on a deal when invited to it or committed on it (the deal page's one rule). */
export async function investorOnDeal(env: Env, userId: number, dealId: number): Promise<boolean> {
  const row = await env.DB.prepare(STATEMENTS.onDeal).bind(dealId, userId, dealId, userId).first<{ on_deal: number }>();
  return Number(row?.on_deal) === 1;
}

export async function dealProject(env: Env, dealId: number): Promise<number | null> {
  if (!Number.isSafeInteger(dealId) || dealId < 1) return null;
  const row = await env.DB.prepare(STATEMENTS.dealProject).bind(dealId).first<{ project_id: number | null }>();
  return row?.project_id == null ? null : Number(row.project_id);
}

/** An active pairwise NDA between the investor and a founder of the venture. */
export async function hasNda(env: Env, projectId: number, investorId: number): Promise<boolean> {
  return !!await env.DB.prepare(STATEMENTS.nda).bind(projectId, investorId, investorId).first();
}

/** One audit row: the action, and counts and kinds only. Best-effort: a failed log never fails the read. */
export async function logScorecard(env: Env, args: {
  projectId: number; userId: number | null; action: string; scope?: string | null; details: Record<string, string | number | boolean | null>; role: string;
}): Promise<void> {
  try {
    await env.DB.prepare(STATEMENTS.log).bind(args.projectId, args.userId, args.scope ?? null, args.action,
      JSON.stringify(args.details), args.role).run();
  } catch {
    console.warn(`[ventureScores] audit write failed action=${args.action}`);
  }
}

// ── What a reader is shown ──────────────────────────────────────────────────

const BAND_OF = (v: number | null | undefined): 'Strong' | 'Fair' | 'Weak' | null => {
  if (v == null || !Number.isFinite(Number(v))) return null;
  for (const [cut, band] of VENTURE_MODEL_V1.bands) if (Number(v) >= cut) return band;
  return 'Weak';
};

type AnyInput = { key: string; label?: string; state?: string; value?: number | null; personal?: boolean; grade?: string;
  as_of?: string | null; words?: string; reason?: string | null; weight?: number; contribution?: number | null; stale?: boolean };

/**
 * An input as an investor with an NDA sees it. A personal or team-only input
 * is a band, "Counted, not shown": never its figure or words.
 */
export function investorInput(i: AnyInput) {
  if (i.personal) {
    return { key: i.key, label: i.label ?? i.key, personal: true, shown: false, state: i.state ?? null,
      band: i.state === 'recorded' ? BAND_OF(i.value) : null, note: 'Counted, not shown' };
  }
  return { key: i.key, label: i.label ?? i.key, personal: false, shown: true, state: i.state ?? null, value: i.value ?? null,
    grade: i.grade ?? null, as_of: i.as_of ?? null, words: i.words ?? null, reason: i.reason ?? null, weight: i.weight ?? null,
    contribution: i.contribution ?? null, stale: Boolean(i.stale) };
}

export type ReviewView = { scope: string; adjustment: number; reason: string | null; note: string | null; reviewer: string;
  computed_value: number | null; reviewed_value: number | null; current: boolean; created_at: string; scorecard_uid: string };

/** The latest review per scope, shown beside the computed value, which stays. A review made against an older row is marked not current. */
export async function latestReviews(env: Env, projectId: number, scopes: readonly StoredScope[]): Promise<Record<string, ReviewView>> {
  const rows = await env.DB.prepare(STATEMENTS.reviews).bind(projectId).all<{
    uid: string; scope: string; scorecard_uid: string; model_version: string; computed_value: number | null; adjustment: number;
    reason: string | null; note: string | null; reviewer_role: string; created_at: string;
  }>();
  const latestUid = new Map(scopes.map((s) => [s.scope, s.uid ?? null]));
  const out: Record<string, ReviewView> = {};
  for (const r of rows.results || []) {
    const adj = Number(r.adjustment) || 0;
    const computed = r.computed_value == null ? null : Number(r.computed_value);
    out[r.scope] = {
      scope: r.scope, adjustment: adj, reason: r.reason, note: r.note,
      reviewer: r.reviewer_role === 'partner' ? 'Operating Partner' : 'Admin',
      computed_value: computed,
      reviewed_value: adj && computed != null ? Math.max(0, Math.min(100, computed + adj)) : null,
      current: latestUid.get(r.scope as AnyScopeKey) === r.scorecard_uid,
      created_at: r.created_at, scorecard_uid: r.scorecard_uid,
    };
  }
  return out;
}

/**
 * The investor's view of a stored scorecard. Before the NDA: each scope's
 * state, band and confidence word, nothing else. After it: value, coverage
 * and inputs too, personal inputs as bands.
 */
export function investorView(scopes: readonly StoredScope[], reviews: Record<string, ReviewView>, nda: boolean) {
  return scopes.map((s) => {
    const base = { scope: s.scope, label: SCOPE_LABELS[s.scope], state: s.state, band: s.band ?? null, confidence_word: s.confidence_word ?? null };
    const review = reviews[s.scope];
    const shownReview = review && review.current ? { adjustment: review.adjustment, reason: review.reason, reviewer: review.reviewer } : null;
    if (!nda) return { ...base, masked: true, review: shownReview };
    return { ...base, masked: false, value: s.value ?? null, confidence: s.confidence ?? null, coverage: s.coverage ?? null,
      model: s.model ?? null, computed_at: s.computed_at ?? null, review: shownReview,
      inputs: (s.inputs as AnyInput[] | undefined ?? []).map(investorInput) };
  });
}

/** The deal list's strip: state, band and confidence word per scope, never a number. */
export function stripView(scopes: readonly StoredScope[]) {
  return scopes.map((s) => ({ scope: s.scope, state: s.state, band: s.band ?? null, confidence_word: s.confidence_word ?? null }));
}

// ── Reviews ─────────────────────────────────────────────────────────────────

export class ScoreError extends Error {
  code: string; status: number;
  constructor(code: string, message: string, status = 400) { super(message); this.code = code; this.status = status; }
}

const text = (v: unknown, max = TEXT_MAX) => (typeof v === 'string' ? v.trim().slice(0, max + 1) : '');

/** Validates a review body. An adjustment over the cap is refused, never clamped. */
export function parseReview(body: any): { adjustment: number; reason: string | null; note: string | null } {
  const raw = body?.adjustment ?? 0;
  const adjustment = Number(raw);
  if (!Number.isInteger(adjustment)) throw new ScoreError('bad_adjustment', 'An adjustment is a whole number of points.');
  if (Math.abs(adjustment) > REVIEW_CAP) {
    throw new ScoreError('adjustment_too_large', `A review may adjust a scope by up to ${REVIEW_CAP} points. Nothing was saved.`);
  }
  const reason = text(body?.reason);
  const note = text(body?.note);
  if (reason.length > TEXT_MAX || note.length > TEXT_MAX) throw new ScoreError('too_long', `Keep the reason and the note under ${TEXT_MAX} characters.`);
  if (adjustment !== 0 && reason.length < REASON_MIN) {
    throw new ScoreError('reason_required', `An adjustment needs a reason of at least ${REASON_MIN} characters. The founder sees it.`);
  }
  if (adjustment === 0 && !note) throw new ScoreError('note_required', 'Write the note, or give an adjustment with a reason.');
  return { adjustment, reason: reason || null, note: note || null };
}

/** Saves a review against the scope's latest stored row and tells the founders. */
export async function saveReview(env: Env, user: User, projectId: number, scope: AnyScopeKey, stored: StoredScope,
  review: { adjustment: number; reason: string | null; note: string | null }) {
  if (stored.state === 'not_read' || !stored.uid) throw new ScoreError('scope_not_scored', 'This scope has no stored score to review yet.', 409);
  if (review.adjustment !== 0 && (stored.state !== 'scored' || stored.value == null)) {
    throw new ScoreError('scope_not_scored', 'Only a scored scope can be adjusted. A note can still be added.', 409);
  }
  const uid = crypto.randomUUID();
  const reviewerRole = role(user) === 'partner' ? 'partner' : 'admin';
  await env.DB.prepare(STATEMENTS.insertReview).bind(uid, projectId, scope, stored.uid, stored.model ?? VENTURE_MODEL_V1.version,
    stored.value ?? null, review.adjustment, review.reason, review.note, user.id, reviewerRole).run();
  await logScorecard(env, { projectId, userId: user.id, scope, action: 'venture_score_reviewed',
    details: { scope, kind: review.adjustment ? 'adjustment' : 'note' }, role: reviewerRole });
  // Owner question 9 A: the founder is told. A notice that fails never undoes the review.
  const who = reviewerRole === 'partner' ? 'An Operating Partner' : 'An Admin';
  const what = review.adjustment
    ? `${who} adjusted ${SCOPE_LABELS[scope]} by ${review.adjustment > 0 ? '+' : ''}${review.adjustment} points. Reason: ${review.reason}`
    : `${who} added a note to ${SCOPE_LABELS[scope]}: ${review.note}`;
  const founders = await env.DB.prepare(STATEMENTS.founders).bind(projectId, projectId).all<{ id: number }>();
  for (const f of founders.results || []) {
    try {
      await notify(env, { userId: Number(f.id), type: 'venture_score_reviewed', title: 'Your scorecard was reviewed',
        body: `${what} The computed score stays beside it, and you can ask to correct any input.`, link: '/raise/scorecard',
        payload: { project_id: projectId, scope }, channels: ['in_app'] });
    } catch { console.warn('[ventureScores] review notice failed'); }
  }
  return { uid, scope, adjustment: review.adjustment, reason: review.reason, note: review.note, reviewer: who.replace(/^An /, ''),
    computed_value: stored.value ?? null,
    reviewed_value: review.adjustment && stored.value != null ? Math.max(0, Math.min(100, Number(stored.value) + review.adjustment)) : null };
}

// ── Corrections ─────────────────────────────────────────────────────────────

export async function listCorrections(env: Env, projectId: number) {
  return (await env.DB.prepare(STATEMENTS.corrections).bind(projectId).all()).results || [];
}

export async function askCorrection(env: Env, user: User, projectId: number, body: any) {
  const scope = body?.scope;
  if (!isScope(scope)) throw new ScoreError('bad_scope', 'Choose one of the eleven scopes.');
  const inputKey = typeof body?.input_key === 'string' ? body.input_key : '';
  if (!inputKeysOf(scope).includes(inputKey)) throw new ScoreError('bad_input', `Choose an input of ${SCOPE_LABELS[scope]}.`);
  const message = text(body?.message);
  if (message.length < REASON_MIN || message.length > TEXT_MAX) {
    throw new ScoreError('message_required', `Say what is wrong in ${REASON_MIN} to ${TEXT_MAX} characters.`);
  }
  const open = await env.DB.prepare(STATEMENTS.openCorrection).bind(projectId, scope, inputKey).first<{ uid: string }>();
  if (open) throw new ScoreError('already_open', 'A correction of this input is already open. It is answered before another is asked.', 409);
  const uid = crypto.randomUUID();
  await env.DB.prepare(STATEMENTS.insertCorrection).bind(uid, projectId, scope, inputKey, message, user.id).run();
  await logScorecard(env, { projectId, userId: user.id, scope, action: 'venture_score_correction_asked',
    details: { scope, input_key: inputKey }, role: 'founder' });
  return { uid, scope, input_key: inputKey, message, state: 'open' };
}

// ── Weighting ───────────────────────────────────────────────────────────────

/** Eleven whole numbers 0–5 by scope key, or null for equal weighting. */
export function parseWeights(body: any): Record<AnyScopeKey, number> | null {
  if (body?.weights === null) return null;
  const w = body?.weights;
  if (!w || typeof w !== 'object' || Array.isArray(w)) throw new ScoreError('bad_weights', 'Send a weight for each of the eleven scopes, or none to reset to equal.');
  const keys = Object.keys(w);
  if (keys.length !== SCOPE_ORDER.length || !SCOPE_ORDER.every((k) => keys.includes(k))) {
    throw new ScoreError('bad_weights', 'Send a weight for each of the eleven scopes, and no other key.');
  }
  const out = {} as Record<AnyScopeKey, number>;
  for (const k of SCOPE_ORDER) {
    const n = Number(w[k]);
    if (!Number.isInteger(n) || n < 0 || n > WEIGHT_MAX) throw new ScoreError('bad_weights', `Each weight is a whole number from 0 to ${WEIGHT_MAX}.`);
    out[k] = n;
  }
  return out;
}

export async function readWeights(env: Env, userId: number) {
  const row = await env.DB.prepare(STATEMENTS.weights).bind(userId).first<{ weights_json: string; updated_at: string }>();
  if (!row) return { weights: null, equal: true, updated_at: null };
  return { weights: JSON.parse(row.weights_json), equal: false, updated_at: row.updated_at };
}

export async function writeWeights(env: Env, userId: number, weights: Record<AnyScopeKey, number> | null) {
  if (weights === null) await env.DB.prepare(STATEMENTS.dropWeights).bind(userId).run();
  else await env.DB.prepare(STATEMENTS.putWeights).bind(userId, JSON.stringify(weights), new Date().toISOString()).run();
  return readWeights(env, userId);
}

// ── Sharing ─────────────────────────────────────────────────────────────────

export async function readSharing(env: Env, projectId: number) {
  const rows = (await env.DB.prepare(STATEMENTS.sharing).bind(projectId).all<{
    audience: string; user_id: number; enabled: number; updated_at: string; advisor_name: string | null;
  }>()).results || [];
  const sw = await investorsMaySee(env, projectId);
  // D1258: the advisors the founder may choose from. A failed read says so; it never reads as none.
  let candidates: { readable: boolean; items: Array<{ user_id: number; name: string | null }> };
  try {
    const found = (await env.DB.prepare(STATEMENTS.candidates).bind(projectId).all<{ user_id: number; advisor_name: string | null }>()).results || [];
    candidates = { readable: true, items: found.map((r) => ({ user_id: Number(r.user_id), name: r.advisor_name ?? null })) };
  } catch {
    candidates = { readable: false, items: [] };
  }
  return {
    investors: { on: sw.on, set: sw.set, default_rule: 'On once the venture is listed, until you turn it off.' },
    advisors: rows.filter((r) => r.audience === 'advisor' && Number(r.enabled) === 1)
      .map((r) => ({ user_id: Number(r.user_id), name: r.advisor_name ?? null, since: r.updated_at })),
    candidates,
  };
}

/**
 * D1258 — the trajectory (SC12): each scope's stored rows, oldest first, with
 * the model version each was computed under. A row with no value is a gap,
 * never a zero. Rows are only ever written on a change (D1255), so a point is
 * a change, not a day.
 */
export async function readTrajectory(env: Env, projectId: number) {
  const rows = (await env.DB.prepare(STATEMENTS.trajectory).bind(projectId).all<{
    scope: string; value: number | null; band: string | null; confidence: number; state: string | null; model_version: string; computed_at: string;
  }>()).results || [];
  const scopes = SCOPE_ORDER.map((k) => ({
    scope: k, label: SCOPE_LABELS[k],
    points: rows.filter((r) => r.scope === k).map((r) => ({
      at: r.computed_at, model: r.model_version,
      state: r.state ?? (r.value == null ? 'not_enough' : 'scored'),
      value: r.value == null ? null : Number(r.value), band: r.band ?? null, confidence_word: confidenceWord(r.confidence),
    })),
  }));
  const models: Array<{ version: string; first_at: string }> = [];
  for (const r of rows) if (!models.some((m) => m.version === r.model_version)) models.push({ version: r.model_version, first_at: r.computed_at });
  return { scopes, models, rows: rows.length };
}

/** The founder turns investors' reading on or off, and names the advisors who may read. Every change is audited. */
export async function writeSharing(env: Env, user: User, projectId: number, body: any) {
  const at = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  const changes: string[] = [];
  const added: number[] = [];
  if (body?.investors !== undefined) {
    if (typeof body.investors !== 'boolean') throw new ScoreError('bad_sharing', 'Investors is on or off.');
    stmts.push(env.DB.prepare(STATEMENTS.putSharing).bind(projectId, 'investors', 0, body.investors ? 1 : 0, user.id, at));
    changes.push(body.investors ? 'investors_on' : 'investors_off');
  }
  if (body?.advisors !== undefined) {
    const ids = Array.isArray(body.advisors) ? [...new Set(body.advisors.map(Number))] : null;
    if (!ids || ids.length > 50 || ids.some((n) => !Number.isSafeInteger(n) || (n as number) < 1)) {
      throw new ScoreError('bad_sharing', 'Name up to 50 advisors by their account.');
    }
    const found = await env.DB.prepare(STATEMENTS.advisors).bind(JSON.stringify(ids)).first<{ n: number }>();
    if (Number(found?.n ?? 0) !== ids.length) throw new ScoreError('not_advisor', 'Only an active advisor account can be shared with.');
    const current = (await readSharing(env, projectId)).advisors.map((a) => a.user_id);
    for (const id of current) if (!ids.includes(id)) stmts.push(env.DB.prepare(STATEMENTS.putSharing).bind(projectId, 'advisor', id, 0, user.id, at));
    for (const id of ids) if (!current.includes(id as number)) {
      stmts.push(env.DB.prepare(STATEMENTS.putSharing).bind(projectId, 'advisor', id, 1, user.id, at));
      added.push(id as number);
    }
    changes.push(`advisors_${ids.length}`);
  }
  if (!changes.length) throw new ScoreError('nothing_to_change', 'Send investors, advisors or both.');
  if (stmts.length) await env.DB.batch(stmts);
  // D1258: an advisor newly shared with is told, with the read-only page (SC21). A notice that fails never undoes the share.
  for (const id of added) {
    try {
      await notify(env, { userId: id, type: 'venture_score_shared', title: 'A founder shared their scorecard with you',
        body: 'You can read it, read only. Inputs stay hidden. The founder can stop sharing at any time.',
        link: `/practice/scorecards/${projectId}`, payload: { project_id: projectId }, channels: ['in_app'] });
    } catch { console.warn('[ventureScores] share notice failed'); }
  }
  await logScorecard(env, { projectId, userId: user.id, action: 'venture_score_sharing_changed', details: { changes: changes.join(',') }, role: 'founder' });
  return readSharing(env, projectId);
}

export { isSuperAdmin };
