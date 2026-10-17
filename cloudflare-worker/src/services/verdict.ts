/**
 * D693 — Verdict: the venture's decisions, kept for the venture or for one
 * hypothesis, withheld below the evidence bar and never overwritten.
 *
 * THE ONE MODULE. Only this file reads or writes `validation_decisions`,
 * `validation_decision_evidence` and `validation_decision_commitments`
 * (migrations 211 and 464). Every reader of "the current decision" calls
 * `currentDecision`, so the old verdict page, the summary CSV and the new
 * module can never disagree about it. `services/records/owned.ts` may test
 * that an id is the venture's, and nothing else.
 *
 * SCOPE. A decision is For the venture (`hypothesis_id` NULL) or for one
 * hypothesis. A given decision supersedes the current given decision of its
 * own scope and nothing else: a decision on H2 never retires the venture's
 * verdict, and the venture's never retires H2's. The pointer and the
 * supersession are written in one `DB.batch`, and the pointer is chosen
 * inside it (`INSERT … SELECT`), never read before it, so two decisions
 * recorded at once leave exactly one current and a correct chain.
 *
 * THE BAR. Below `DECISION_EVIDENCE_BAR` checked pieces of evidence a
 * decision is kept as withheld: never current, superseding nothing, with its
 * own row and its own record. The bar counts what the founder checks,
 * contradicting items included.
 *
 * FAILURES THROW. A read that fails is a 503 or an unreadable card, never an
 * empty history: "no decision yet" and "the decision could not be read" are
 * different facts.
 */
import type { EvidenceCtx, EvidenceItemFull } from './validateEvidence';
import type { Env, User } from '../types';
import { logCycleWriteStatement } from './cycleActivity';
import { safeCard, PAGE_SIZE, type Card } from './cycleCards';
import { dayMonth } from './cycleFocus';
import type { Ctx, FilterSpec, RecordQuery, Records, SortSpec } from './cycleValidate';
import { ownsVenture, type ProjectRef } from '../routes/_founder_validate_helpers';

/**
 * Pieces of evidence a decision must rest on before a verdict is given.
 *
 * The Record a decision lightbox (Cycle Overview canvas, CO:335): "[2] of [5]
 * needed before a verdict is given. Below that it is withheld." Its own
 * constant: `VALIDATION_BAR` counts supporting ICP interviews behind one
 * claim, which is a different question.
 */
export const DECISION_EVIDENCE_BAR = 5;

export const DECISION_KINDS = ['proceed', 'pivot', 'stop'] as const;
export type DecisionKind = typeof DECISION_KINDS[number];
export const isDecisionKind = (v: unknown): v is DecisionKind =>
  typeof v === 'string' && (DECISION_KINDS as readonly string[]).includes(v);

export type DecisionState = 'given' | 'withheld';

/** The venture, or one hypothesis by id. */
export type Scope = 'venture' | number;

/** A decision's caps, enforced here so every caller gets the same refusal. */
export const MAX_EVIDENCE_KEYS = 50;
export const MAX_REASONING = 4000;

/**
 * One piece of the venture's evidence, as the evidence reader gives it.
 *
 * `id` names the link the item came through (#1692's `evidenceFor`:
 * `pain-<link id>-<interview id>` or `evidence-<link id>`), so it is unique
 * across the venture and an interview behind two claims is two items.
 */
export type EvidenceItem = {
  id: string;
  kind: string;
  label: string;
  strength: 'anecdote' | 'pattern' | 'measured' | null;
  direction: 'supports' | 'contradicts';
  date: string | null;
  hypothesis_id?: number | null;
};

export type EvidenceSource = (env: Env, projectId: number) => Promise<EvidenceItem[]>;

/** Adapt Validate's context reader without losing its link-based keys or metadata. */
export function adaptEvidenceReader(
  reader: (ctx: EvidenceCtx, opts?: { hypothesisId?: number }) => Promise<EvidenceItemFull[]>,
): EvidenceSource {
  return (env, projectId) => reader({ env, projectId }, {});
}

/** Defaults are wired with #1692's record registration in the closing part. */
export const evidenceFor: EvidenceSource = async () => [];

/** Hypothesis statements run inside the decision's transaction, before its INSERT. */
export type PivotStatements = (
  env: Env, input: { projectId: number; claim: string; userId: number | null },
) => D1PreparedStatement[];

/** A refusal with its own status and the sentence the caller shows. */
export class VerdictError extends Error {
  status: number;
  sentence: string;
  constructor(status: number, sentence: string) {
    super(sentence);
    this.status = status;
    this.sentence = sentence;
  }
}

export type RecordInput = {
  decision: string;
  for: Scope;
  reasoning?: unknown;
  evidence?: unknown;
  pivot_claim?: unknown;
};

export type Recorded = {
  id: number;
  state: DecisionState;
  supersedes_id: number | null;
  pivot_hypothesis_id: number | null;
};

const KIND_WORD: Record<DecisionKind, string> = { proceed: 'Proceed', pivot: 'Pivot', stop: 'Stop' };
const STRENGTHS = new Set(['anecdote', 'pattern', 'measured']);
const DIRECTIONS = new Set(['supports', 'contradicts']);

const textOrNull = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s : null;
};

/**
 * The checked keys, refused as a malformed body when they are not a list of
 * strings, or are more than the cap. Repeats count once.
 */
function evidenceKeys(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.some((k) => typeof k !== 'string' || !k.trim() || k.length > 200)) {
    throw new VerdictError(400, 'evidence must be a list of evidence keys');
  }
  const keys = [...new Set((raw as string[]).map((k) => k.trim()))];
  if (keys.length > MAX_EVIDENCE_KEYS) {
    throw new VerdictError(400, `A decision rests on at most ${MAX_EVIDENCE_KEYS} pieces of evidence.`);
  }
  return keys;
}

/**
 * The activity rows for a decision, as statements for the decision's batch,
 * through `services/cycleActivity.ts`'s statement form (#1690, D-e).
 *
 * Logged only under `entity_type 'validate.verdict'`, never against the
 * hypothesis, because partners read a hypothesis's activity and never a
 * decision. The summary says the decision and its scope; it never carries
 * the reasoning or a commitment's text.
 *
 * The new decision's id is not known before the batch and the table has no
 * `uid`, so it is read back inside the batch (D1 runs a batch as one
 * transaction): the recorded row names the venture's newest decision, and the
 * superseded row names that decision's `supersedes_id`, written only when it
 * is set, so a Withheld decision logs no superseded row.
 */
const verdictWrite = (user: User, projectId: number, action: string, summary: string) =>
  ({ projectId, userId: user.id ?? null, cycle: 'validate' as const, module: 'verdict' as const, action, summary });

/**
 * Record a decision. Never edits or deletes one (D693 decision 4).
 *
 * `bar` is the evidence bar. The old verdict route passes 0 until #1704
 * retires the page that calls it, which sends no evidence: its decision is a
 * given venture decision, superseding only the venture's current given one.
 */
export async function recordDecision(
  env: Env,
  user: User,
  project: { id: number },
  input: RecordInput,
  { bar = DECISION_EVIDENCE_BAR, evidenceSource = evidenceFor, pivotStatements }: {
    bar?: number; evidenceSource?: EvidenceSource; pivotStatements?: PivotStatements;
  } = {},
): Promise<Recorded> {
  const projectId = project.id;
  if (!isDecisionKind(input.decision)) throw new VerdictError(400, 'decision must be proceed, pivot or stop');
  const decision = input.decision;
  const scope = input.for;
  if (scope !== 'venture' && !(Number.isInteger(scope) && (scope as number) > 0)) {
    throw new VerdictError(400, 'for must be the venture or one hypothesis');
  }
  if (input.reasoning !== undefined && input.reasoning !== null && typeof input.reasoning !== 'string') {
    throw new VerdictError(400, 'reasoning must be text');
  }
  const reasoning = textOrNull(input.reasoning);
  if (reasoning && reasoning.length > MAX_REASONING) {
    throw new VerdictError(400, `Reasoning must be ${MAX_REASONING.toLocaleString('en-US')} characters or fewer.`);
  }
  const keys = evidenceKeys(input.evidence);
  const pivotClaim = textOrNull(input.pivot_claim);
  if (input.pivot_claim !== undefined && input.pivot_claim !== null && decision !== 'pivot') {
    throw new VerdictError(400, 'Only a Pivot starts a new hypothesis.');
  }

  // The scope, bound to the venture: another venture's hypothesis is not found.
  let hypothesisId: number | null = null;
  let scopeWord = 'the venture';
  if (scope !== 'venture') {
    const h = await env.DB.prepare('SELECT id, code FROM hypotheses WHERE id = ? AND project_id = ?')
      .bind(scope, projectId).first<{ id: number; code: string }>();
    if (!h) throw new VerdictError(404, 'Hypothesis not found.');
    hypothesisId = Number(h.id);
    scopeWord = h.code;
  }

  // Only keys the evidence reader gives for THIS venture are accepted.
  let items: EvidenceItem[] = [];
  if (keys.length) {
    const byId = new Map((await evidenceSource(env, projectId)).map((it) => [it.id, it]));
    for (const k of keys) {
      const it = byId.get(k);
      if (!it) throw new VerdictError(404, 'Evidence not found.');
      items.push(it);
    }
  }

  // Keep the refusal until a builder is wired; never write a decision that
  // silently discards the founder's new claim.
  if (pivotClaim && !pivotStatements) throw new VerdictError(400, 'A Pivot cannot start a hypothesis yet.');

  const state: DecisionState = items.length >= bar ? 'given' : 'withheld';
  const word = KIND_WORD[decision];
  const recordedSummary = state === 'given'
    ? `Recorded ${word} for ${scopeWord}`
    : `Recorded ${word} for ${scopeWord}, withheld`;

  const stmts = pivotClaim && pivotStatements
    ? pivotStatements(env, { projectId, claim: pivotClaim, userId: user.id ?? null })
    : [];
  const decisionIndex = stmts.length;
  const hasPivot = pivotClaim ? 1 : 0;
  if (state === 'given') {
    // The pointer is the newest current given decision of the same scope,
    // chosen inside the batch.
    stmts.push(env.DB.prepare(
      `INSERT INTO validation_decisions (project_id, hypothesis_id, decision, reasoning, decided_by, state, supersedes_id, pivot_hypothesis_id)
       SELECT ?, ?, ?, ?, ?, 'given',
              (SELECT id FROM validation_decisions
                WHERE project_id = ? AND hypothesis_id IS ? AND state = 'given' AND superseded_at IS NULL
                ORDER BY decided_at DESC, id DESC LIMIT 1),
              CASE WHEN ? = 1 THEN (SELECT MAX(id) FROM hypotheses WHERE project_id = ?) ELSE NULL END
       RETURNING id, supersedes_id, pivot_hypothesis_id`,
    ).bind(projectId, hypothesisId, decision, reasoning, user.id ?? null, projectId, hypothesisId, hasPivot, projectId));
    // Every earlier current given decision of the scope is superseded: a
    // venture may hold two from the old unbatched route, and after this
    // decision it holds exactly one.
    stmts.push(env.DB.prepare(
      `UPDATE validation_decisions SET superseded_at = datetime('now')
        WHERE project_id = ? AND hypothesis_id IS ? AND state = 'given' AND superseded_at IS NULL
          AND id <> (SELECT MAX(id) FROM validation_decisions WHERE project_id = ?)`,
    ).bind(projectId, hypothesisId, projectId));
  } else {
    stmts.push(env.DB.prepare(
      `INSERT INTO validation_decisions (project_id, hypothesis_id, decision, reasoning, decided_by, state, supersedes_id, pivot_hypothesis_id)
       VALUES (?, ?, ?, ?, ?, 'withheld', NULL,
               CASE WHEN ? = 1 THEN (SELECT MAX(id) FROM hypotheses WHERE project_id = ?) ELSE NULL END)
       RETURNING id, supersedes_id, pivot_hypothesis_id`,
    ).bind(projectId, hypothesisId, decision, reasoning, user.id ?? null, hasPivot, projectId));
  }
  // Each item as it reads now, so the record does not change when the
  // evidence is edited later.
  for (const it of items) {
    stmts.push(env.DB.prepare(
      `INSERT INTO validation_decision_evidence (uid, decision_id, kind, ref_id, label, strength, direction, on_date)
       VALUES (?, (SELECT MAX(id) FROM validation_decisions WHERE project_id = ?), ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), projectId, String(it.kind || 'evidence'), it.id, String(it.label || it.id),
      it.strength && STRENGTHS.has(it.strength) ? it.strength : null,
      DIRECTIONS.has(it.direction) ? it.direction : 'supports',
      it.date ?? null,
    ));
  }
  stmts.push(logCycleWriteStatement(env, {
    ...verdictWrite(user, projectId, 'validation_decision_recorded', recordedSummary),
    readback: { table: 'validation_decisions', by: 'max' },
  }));
  if (state === 'given') {
    stmts.push(logCycleWriteStatement(env, {
      ...verdictWrite(user, projectId, 'validation_decision_superseded', `Superseded by ${word}`),
      readback: { table: 'validation_decisions', by: 'supersedes' },
    }));
  }

  const out = await env.DB.batch(stmts);
  const row = ((out[decisionIndex] as any)?.results?.[0] ?? null) as { id: number; supersedes_id: number | null; pivot_hypothesis_id: number | null } | null;
  if (!row) throw new Error('The decision was not written');
  return {
    id: Number(row.id),
    state,
    supersedes_id: row.supersedes_id == null ? null : Number(row.supersedes_id),
    pivot_hypothesis_id: row.pivot_hypothesis_id == null ? null : Number(row.pivot_hypothesis_id),
  };
}

// ---------------------------------------------------------------------------
// Reads. Each binds the venture, throws on a failure, and never returns an
// empty list for one.
// ---------------------------------------------------------------------------

export type DecisionRow = {
  id: number;
  decision: DecisionKind;
  state: DecisionState;
  hypothesis_id: number | null;
  hypothesis_code: string | null;
  reasoning: string | null;
  decided_at: string;
  decided_by: number | null;
  decided_by_name: string | null;
  superseded_at: string | null;
  supersedes_id: number | null;
  pivot_hypothesis_id: number | null;
  evidence_count: number;
};

// Each read below spells its columns out rather than splicing a shared list,
// so no `${…}` lands in a query (scripts/check-sql-prepare.mjs).
const scopeBind = (scope: Scope): number | null => (scope === 'venture' ? null : scope);

/**
 * The current given decision of one scope, or null when there is none.
 *
 * The newest row wins: a venture may hold two current rows from the old
 * route's unbatched write, and no index forbids it (migration 464).
 */
export async function currentDecision(env: Env, projectId: number, scope: Scope): Promise<DecisionRow | null> {
  return env.DB.prepare(
    `SELECT d.id, d.decision, d.state, d.hypothesis_id, h.code AS hypothesis_code, d.reasoning,
            d.decided_at, d.decided_by, u.name AS decided_by_name, d.superseded_at, d.supersedes_id,
            d.pivot_hypothesis_id,
            (SELECT COUNT(*) FROM validation_decision_evidence e WHERE e.decision_id = d.id) AS evidence_count
       FROM validation_decisions d
       LEFT JOIN hypotheses h ON h.id = d.hypothesis_id
       LEFT JOIN users u ON u.id = d.decided_by
      WHERE d.project_id = ? AND d.hypothesis_id IS ? AND d.state = 'given' AND d.superseded_at IS NULL
      ORDER BY d.decided_at DESC, d.id DESC LIMIT 1`,
  ).bind(projectId, scopeBind(scope)).first<DecisionRow>();
}

export const DECISION_FILTERS = ['proceed', 'pivot', 'stop', 'withheld'] as const;
export type DecisionFilter = typeof DECISION_FILTERS[number];
export const DECISIONS_PAGE_SIZE = 20;

/**
 * The venture's decisions, newest first unless asked otherwise. `scope`
 * narrows to the venture or one hypothesis; `filter` to one kind of given
 * decision or to the withheld ones, so a withheld Proceed is under Withheld
 * and not under Proceed (#1704: the table reads it as "Withheld"). `q`
 * searches the reasoning and the claim the decision is For, bound, with `%`
 * and `_` matched as themselves.
 */
export async function decisionsFor(
  env: Env,
  projectId: number,
  { scope, filter, q = '', sort = 'newest', page = 1, pageSize = DECISIONS_PAGE_SIZE }:
    { scope?: Scope; filter?: DecisionFilter | null; q?: string; sort?: 'newest' | 'oldest'; page?: number; pageSize?: number } = {},
): Promise<{ rows: DecisionRow[]; total: number; page: number; page_size: number }> {
  const size = Math.max(1, Math.min(200, Math.floor(pageSize)));
  const p = Math.max(1, Math.floor(page) || 1);
  const scoped = scope === undefined ? 0 : 1;
  const hyp = scope === undefined ? null : scopeBind(scope);
  const kind = filter && filter !== 'withheld' ? filter : null;
  const withheld = filter === 'withheld' ? 1 : 0;
  const term = String(q || '').trim().toLowerCase().slice(0, 120);
  const like = term ? `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : '';
  const where = [projectId, scoped, hyp, kind, kind, withheld, like, like, like] as const;

  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM validation_decisions d
       LEFT JOIN hypotheses h ON h.id = d.hypothesis_id
      WHERE d.project_id = ? AND (? = 0 OR d.hypothesis_id IS ?) AND (? IS NULL OR (d.decision = ? AND d.state = 'given'))
        AND (? = 0 OR d.state = 'withheld')
        AND (? = '' OR lower(COALESCE(d.reasoning, '')) LIKE ? ESCAPE '\\' OR lower(COALESCE(h.claim, '')) LIKE ? ESCAPE '\\')`,
  ).bind(...where).first<{ n: number }>();
  const list = sort === 'oldest'
    ? env.DB.prepare(
      `SELECT d.id, d.decision, d.state, d.hypothesis_id, h.code AS hypothesis_code, d.reasoning,
              d.decided_at, d.decided_by, u.name AS decided_by_name, d.superseded_at, d.supersedes_id,
              d.pivot_hypothesis_id,
              (SELECT COUNT(*) FROM validation_decision_evidence e WHERE e.decision_id = d.id) AS evidence_count
         FROM validation_decisions d
         LEFT JOIN hypotheses h ON h.id = d.hypothesis_id
         LEFT JOIN users u ON u.id = d.decided_by
        WHERE d.project_id = ? AND (? = 0 OR d.hypothesis_id IS ?) AND (? IS NULL OR (d.decision = ? AND d.state = 'given'))
          AND (? = 0 OR d.state = 'withheld')
          AND (? = '' OR lower(COALESCE(d.reasoning, '')) LIKE ? ESCAPE '\\' OR lower(COALESCE(h.claim, '')) LIKE ? ESCAPE '\\')
        ORDER BY d.decided_at ASC, d.id ASC LIMIT ? OFFSET ?`,
    )
    : env.DB.prepare(
      `SELECT d.id, d.decision, d.state, d.hypothesis_id, h.code AS hypothesis_code, d.reasoning,
              d.decided_at, d.decided_by, u.name AS decided_by_name, d.superseded_at, d.supersedes_id,
              d.pivot_hypothesis_id,
              (SELECT COUNT(*) FROM validation_decision_evidence e WHERE e.decision_id = d.id) AS evidence_count
         FROM validation_decisions d
         LEFT JOIN hypotheses h ON h.id = d.hypothesis_id
         LEFT JOIN users u ON u.id = d.decided_by
        WHERE d.project_id = ? AND (? = 0 OR d.hypothesis_id IS ?) AND (? IS NULL OR (d.decision = ? AND d.state = 'given'))
          AND (? = 0 OR d.state = 'withheld')
          AND (? = '' OR lower(COALESCE(d.reasoning, '')) LIKE ? ESCAPE '\\' OR lower(COALESCE(h.claim, '')) LIKE ? ESCAPE '\\')
        ORDER BY d.decided_at DESC, d.id DESC LIMIT ? OFFSET ?`,
    );
  const res = await list.bind(...where, size, (p - 1) * size).all<DecisionRow>();
  return { rows: res.results || [], total: Number(total?.n ?? 0), page: p, page_size: size };
}

export type DecisionEvidenceRow = {
  id: number; uid: string; kind: string; ref_id: string; label: string;
  strength: string | null; direction: 'supports' | 'contradicts'; on_date: string | null;
};
export type DecisionCommitmentRow = {
  id: number; uid: string; text: string; owner_user_id: number | null; owner_name: string | null;
  created_by: number | null; due_date: string | null; done_at: string | null; created_at: string;
};

/**
 * One decision of this venture, with the evidence it rests on and the
 * commitments it created, or null when the id is not this venture's.
 */
export async function decisionById(
  env: Env, projectId: number, id: number,
): Promise<(DecisionRow & { evidence: DecisionEvidenceRow[]; commitments: DecisionCommitmentRow[] }) | null> {
  const row = await env.DB.prepare(
    `SELECT d.id, d.decision, d.state, d.hypothesis_id, h.code AS hypothesis_code, d.reasoning,
            d.decided_at, d.decided_by, u.name AS decided_by_name, d.superseded_at, d.supersedes_id,
            d.pivot_hypothesis_id,
            (SELECT COUNT(*) FROM validation_decision_evidence e WHERE e.decision_id = d.id) AS evidence_count
       FROM validation_decisions d
       LEFT JOIN hypotheses h ON h.id = d.hypothesis_id
       LEFT JOIN users u ON u.id = d.decided_by
      WHERE d.project_id = ? AND d.id = ?`,
  ).bind(projectId, id).first<DecisionRow>();
  if (!row) return null;
  const [ev, cm] = await Promise.all([
    env.DB.prepare(
      `SELECT id, uid, kind, ref_id, label, strength, direction, on_date
         FROM validation_decision_evidence WHERE decision_id = ? ORDER BY id`,
    ).bind(row.id).all<DecisionEvidenceRow>(),
    env.DB.prepare(
      `SELECT c.id, c.uid, c.text, c.owner_user_id, u.name AS owner_name, c.created_by, c.due_date, c.done_at, c.created_at
         FROM validation_decision_commitments c
         LEFT JOIN users u ON u.id = c.owner_user_id
        WHERE c.decision_id = ? AND c.project_id = ? ORDER BY c.id`,
    ).bind(row.id, projectId).all<DecisionCommitmentRow>(),
  ]);
  return { ...row, evidence: ev.results || [], commitments: cm.results || [] };
}

/**
 * Why a given decision has no evidence rows (D693 decision 5). Only the old
 * verdict route ever wrote one, since every other given decision rests on
 * at least the bar.
 */
export const NO_EVIDENCE_REASON = 'Recorded on the earlier verdict page, which kept no evidence.';

/**
 * Whether a given decision of the same scope was recorded before this one,
 * for the record's Supersedes fact (D693 decision 10): with none, "Nothing,
 * the first for <scope>"; with one and no pointer, the old route never kept
 * it, and the fact is Not recorded.
 */
export async function earlierGivenInScope(env: Env, projectId: number, decision: { id: number; hypothesis_id: number | null }): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS found FROM validation_decisions
      WHERE project_id = ? AND hypothesis_id IS ? AND state = 'given' AND id < ? LIMIT 1`,
  ).bind(projectId, decision.hypothesis_id, decision.id).first<{ found: number }>();
  return !!row;
}

// ---------------------------------------------------------------------------
// Commitments (D693 decision 8). Added and closed through the record's action
// route; there is no commitments route of its own. A commitment's owner must
// own the venture, so no other user's name is written.
// ---------------------------------------------------------------------------

export const MAX_COMMITMENT = 500;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export type CommitmentInput = { text?: unknown; owner_user_id?: unknown; due_date?: unknown };

async function ventureOwner(env: Env, project: ProjectRef, raw: unknown): Promise<number> {
  const id = typeof raw === 'number' ? raw : typeof raw === 'string' && /^[1-9][0-9]{0,9}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(id) || id < 1) throw new VerdictError(400, 'The owner must own this venture.');
  const owner = await env.DB.prepare('SELECT id, role, founder_id, spinout_lab_active FROM users WHERE id = ? AND is_active = 1')
    .bind(id).first<User>();
  if (!owner || !ownsVenture(project, owner)) throw new VerdictError(400, 'The owner must own this venture.');
  return id;
}

/**
 * Add a commitment to one of the venture's decisions. The owner defaults to
 * the caller when the caller owns the venture; an admin's commitment has no
 * owner unless one is named. Logged on the decision, without its text.
 */
export async function addCommitment(
  env: Env, user: User, project: ProjectRef, decisionId: number, input: CommitmentInput,
): Promise<{ id: number }> {
  const text = typeof input.text === 'string' ? input.text.replace(/\s+/g, ' ').trim() : '';
  if (!text) throw new VerdictError(400, 'A commitment needs its text.');
  if (text.length > MAX_COMMITMENT) throw new VerdictError(400, `A commitment must be ${MAX_COMMITMENT} characters or fewer.`);
  const due = input.due_date === undefined || input.due_date === null || input.due_date === '' ? null : input.due_date;
  if (due !== null && !(typeof due === 'string' && DATE_ONLY.test(due) && !Number.isNaN(Date.parse(`${due}T00:00:00Z`)))) {
    throw new VerdictError(400, 'due_date must be a date (YYYY-MM-DD).');
  }
  const named = input.owner_user_id !== undefined && input.owner_user_id !== null && input.owner_user_id !== '';
  const owner = named ? await ventureOwner(env, project, input.owner_user_id) : (ownsVenture(project, user) ? Number(user.id) : null);
  const found = await env.DB.prepare('SELECT id FROM validation_decisions WHERE id = ? AND project_id = ?')
    .bind(decisionId, project.id).first<{ id: number }>();
  if (!found) throw new VerdictError(404, 'Record not found.');
  const out = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO validation_decision_commitments (uid, decision_id, project_id, text, owner_user_id, created_by, due_date)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    ).bind(crypto.randomUUID(), decisionId, project.id, text, owner, user.id ?? null, due),
    logCycleWriteStatement(env, { ...verdictWrite(user, project.id, 'validation_commitment_added', 'Added a commitment'), entityId: decisionId }),
  ]);
  return { id: Number((out[0] as any)?.results?.[0]?.id) };
}

/** The decision's commitments that are still open, for its done form. */
export async function openCommitments(env: Env, projectId: number, decisionId: number): Promise<DecisionCommitmentRow[]> {
  const res = await env.DB.prepare(
    `SELECT c.id, c.uid, c.text, c.owner_user_id, u.name AS owner_name, c.created_by, c.due_date, c.done_at, c.created_at
       FROM validation_decision_commitments c LEFT JOIN users u ON u.id = c.owner_user_id
      WHERE c.decision_id = ? AND c.project_id = ? AND c.done_at IS NULL ORDER BY c.id`,
  ).bind(decisionId, projectId).all<DecisionCommitmentRow>();
  return res.results || [];
}

/** Mark one of this decision's open commitments done. Another decision's answers 404. */
export async function completeCommitment(
  env: Env, user: User, project: ProjectRef, decisionId: number, rawId: unknown,
): Promise<void> {
  const id = typeof rawId === 'number' ? rawId : typeof rawId === 'string' && /^[1-9][0-9]{0,9}$/.test(rawId) ? Number(rawId) : NaN;
  if (!Number.isSafeInteger(id) || id < 1) throw new VerdictError(404, 'Commitment not found.');
  const open = await env.DB.prepare(
    'SELECT id FROM validation_decision_commitments WHERE id = ? AND decision_id = ? AND project_id = ? AND done_at IS NULL',
  ).bind(id, decisionId, project.id).first<{ id: number }>();
  if (!open) throw new VerdictError(404, 'Commitment not found.');
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE validation_decision_commitments SET done_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ? AND decision_id = ? AND project_id = ? AND done_at IS NULL`,
    ).bind(id, decisionId, project.id),
    logCycleWriteStatement(env, { ...verdictWrite(user, project.id, 'validation_commitment_done', 'Marked a commitment done'), entityId: decisionId }),
  ]);
}

// ---------------------------------------------------------------------------
// The Verdict module (#1704): its card and its Decisions table. Not yet in
// `cycleValidate.ts`'s `MODULES`, `CARD_FOR` or `RECORDS_FOR`: the Worker's
// list and the page's land together with `/validate/verdict`'s swap.
// ---------------------------------------------------------------------------

/** The card's timeline holds the venture's six newest decisions, then Next. */
export const TIMELINE_CAP = 6;

const day = (raw: string | null | undefined) => {
  const d = String(raw ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
};

/**
 * Whether a given decision rests on no evidence row, which only the old
 * verdict page ever wrote (D693 decision 5). Its count is not shown.
 */
const isOldRoute = (d: Pick<DecisionRow, 'state' | 'evidence_count'>) => d.state === 'given' && Number(d.evidence_count) === 0;

/**
 * D693 decision 9 — the card is the venture's verdict (CO:542, CO:584).
 *
 * - `empty`: the venture has no decision in any scope.
 * - `too_little`: decisions exist, but none is a current given decision for
 *   the venture.
 * - `ok`: the timeline (the venture's own decisions, the six newest, oldest
 *   first; Withheld ones carried with their state) and the current verdict.
 * - `unreadable`: `safeCard`'s, when a read throws.
 *
 * - Next (CO:542's open step): the earliest deadline, today or later, of the
 *   venture's open hypotheses (migration 460's `hypotheses.deadline`). The
 *   card's `next` records the decision for that hypothesis. Both are null
 *   when no deadline is ahead.
 */
export async function verdictCard(ctx: Ctx): Promise<Card> {
  return safeCard({ slug: 'verdict', name: 'Verdict', range: 'All time', caption: 'Every decision, oldest to newest, never overwritten.', source: 'Decisions' }, async () => {
    const add = { text: 'Record a decision', href: `/validate/verdict/new?project=${ctx.projectId}` };
    const [any, current] = await Promise.all([
      decisionsFor(ctx.env, ctx.projectId, { pageSize: 1 }),
      currentDecision(ctx.env, ctx.projectId, 'venture'),
    ]);
    if (any.total === 0) {
      return { state: 'empty', series: null, next: add, reason: 'No decision yet. Decisions appear here once evidence is in.' };
    }
    if (!current) {
      return {
        state: 'too_little', series: null, next: add,
        reason: 'No verdict for the venture yet. Withheld decisions and decisions on one hypothesis are in the table.',
      };
    }
    const [recent, sprint] = await Promise.all([
      decisionsFor(ctx.env, ctx.projectId, { scope: 'venture', sort: 'newest', pageSize: TIMELINE_CAP }),
      nextSprint(ctx),
    ]);
    return {
      state: 'ok',
      series: {
        decisions: [...recent.rows].reverse().map((d) => ({ decision: d.decision, state: d.state, date: day(d.decided_at) })),
        current: {
          decision: current.decision, date: day(current.decided_at),
          evidence: isOldRoute(current) ? null : Number(current.evidence_count),
        },
        next: sprint ? { date: sprint.deadline } : null,
      },
      next: sprint
        ? {
          text: `Record the decision for the sprint ending ${dayMonth(sprint.deadline)}.`,
          href: `/validate/verdict/new?project=${ctx.projectId}&for=h-${sprint.id}`,
        }
        : null,
      reason: null,
    };
  });
}

/**
 * The sprint the card's Next names: the venture's open hypothesis with the
 * earliest deadline on or after today, or null when none is ahead.
 */
async function nextSprint(ctx: Ctx): Promise<{ id: number; deadline: string } | null> {
  const row = await ctx.env.DB.prepare(
    `SELECT id, substr(deadline, 1, 10) AS deadline FROM hypotheses
      WHERE project_id = ? AND retired_at IS NULL AND deadline IS NOT NULL AND substr(deadline, 1, 10) >= ?
      ORDER BY substr(deadline, 1, 10), id LIMIT 1`,
  ).bind(ctx.projectId, ctx.today).first<{ id: number; deadline: string }>();
  return row && day(row.deadline) ? { id: Number(row.id), deadline: String(row.deadline) } : null;
}

const DECISION_WORD: Record<DecisionFilter, string> = { proceed: 'Proceed', pivot: 'Pivot', stop: 'Stop', withheld: 'Withheld' };

/** The Decisions table's columns and sorts (CO:610), default sort first. */
export const DECISION_COLUMNS = ['Decision', 'For', 'Reasoning', 'Evidence', 'Date · by'];
export const DECISION_SORTS: SortSpec[] = [{ key: 'newest', label: 'Newest' }, { key: 'oldest', label: 'Oldest' }];

type ClaimRow = { id: number; code: string; claim: string };
const claimWord = (h: ClaimRow | undefined, id: number) => (h ? `${h.code} · ${h.claim}` : `H${id}`);

/**
 * The Decisions table (CO:610): Decision / For / Reasoning / Evidence /
 * Date · by, filtered by Decision and For, newest first or oldest, searched
 * over the reasoning and the claim, paged in SQL. Each row's id is the
 * decision's.
 *
 * - A Withheld row's Reasoning is "<n> of 5 pieces of evidence".
 * - A Pivot that started a hypothesis reads "Starts <code> · <claim>".
 * - Any other row reads the first line of its reasoning, or null.
 * - Evidence is the count of items it rests on, null for an old-route row.
 */
export async function decisionRecords(ctx: Ctx, rq: RecordQuery): Promise<Records> {
  const f = rq.filter;
  const filter = (DECISION_FILTERS as readonly string[]).includes(f.decision) ? (f.decision as DecisionFilter) : null;
  const forId = /^h-([1-9][0-9]{0,9})$/.exec(String(f.for ?? ''));
  const scope: Scope | undefined = f.for === 'venture' ? 'venture' : forId ? Number(forId[1]) : undefined;
  const page = await decisionsFor(ctx.env, ctx.projectId, {
    scope, filter, q: rq.q, sort: rq.sort === 'oldest' ? 'oldest' : 'newest', page: rq.page, pageSize: PAGE_SIZE,
  });
  // The claims the page names, the scope's and the Pivot's, in one bound read.
  const ids = [...new Set(page.rows.flatMap((d) => [d.hypothesis_id, d.pivot_hypothesis_id]).filter((x): x is number => x != null))];
  const claims = new Map<number, ClaimRow>();
  if (ids.length) {
    const res = await ctx.env.DB.prepare(
      'SELECT id, code, claim FROM hypotheses WHERE project_id = ? AND id IN (SELECT value FROM json_each(?))',
    ).bind(ctx.projectId, JSON.stringify(ids)).all<ClaimRow>();
    for (const h of res.results || []) claims.set(Number(h.id), h);
  }
  // For lists the venture and each hypothesis that has a decision.
  const scoped = await ctx.env.DB.prepare(
    `SELECT DISTINCT h.id, h.code, h.claim, h.sort_order
       FROM validation_decisions d JOIN hypotheses h ON h.id = d.hypothesis_id AND h.project_id = d.project_id
      WHERE d.project_id = ? ORDER BY h.sort_order, h.id`,
  ).bind(ctx.projectId).all<ClaimRow & { sort_order: number }>();
  const filters: FilterSpec[] = [
    { key: 'decision', label: 'Decision', options: DECISION_FILTERS.map((k) => ({ value: k, label: DECISION_WORD[k] })) },
    { key: 'for', label: 'For', options: [
      { value: 'venture', label: 'The venture' },
      ...(scoped.results || []).map((h) => ({ value: `h-${Number(h.id)}`, label: `${h.code} · ${h.claim}` })),
    ] },
  ];
  const reasoningOf = (d: DecisionRow): string | null => {
    if (d.state === 'withheld') return `${Number(d.evidence_count)} of ${DECISION_EVIDENCE_BAR} pieces of evidence`;
    if (d.decision === 'pivot' && d.pivot_hypothesis_id != null) return `Starts ${claimWord(claims.get(Number(d.pivot_hypothesis_id)), Number(d.pivot_hypothesis_id))}`;
    const first = String(d.reasoning ?? '').split(/\r?\n/).map((l) => l.trim()).find(Boolean);
    return first ?? null;
  };
  return {
    cols: DECISION_COLUMNS,
    rows: page.rows.map((d) => ({
      id: Number(d.id),
      decision: d.decision,
      state: d.state,
      hypothesis_id: d.hypothesis_id == null ? null : Number(d.hypothesis_id),
      for: d.hypothesis_id == null ? 'The venture' : claimWord(claims.get(Number(d.hypothesis_id)), Number(d.hypothesis_id)),
      reasoning: reasoningOf(d),
      evidence: isOldRoute(d) ? null : Number(d.evidence_count),
      date: day(d.decided_at),
      by: d.decided_by_name ?? null,
    })),
    total: page.total, page: page.page, page_size: page.page_size,
    filters, sorts: DECISION_SORTS,
  };
}
