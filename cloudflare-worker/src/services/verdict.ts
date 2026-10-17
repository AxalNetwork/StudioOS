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
import type { Env, User } from '../types';

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

/**
 * THE SEAM, STUBBED. `services/validateEvidence.ts`'s `evidenceFor` (#1692)
 * is not on `main` yet, so the venture has no evidence items here and every
 * decision recorded through the new route is withheld. #1703 points this at
 * the real reader. Tests pass their own source through `recordDecision`'s
 * options, so the bar and the scopes are tested now.
 */
export const evidenceFor: EvidenceSource = async () => [];

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
 * The activity row for a decision, as a statement for the decision's batch.
 *
 * A LOCAL HELPER, replaced in #1703 by `services/cycleActivity.ts`'s
 * `logCycleWrite` statement form (#1690), which writes the same columns.
 * Logged only under `entity_type 'validate.verdict'`, never against the
 * hypothesis, because partners read a hypothesis's activity and never a
 * decision. The summary says the decision and its scope; it never carries
 * the reasoning or a commitment's text.
 *
 * The new decision's id is not known before the batch and the table has no
 * `uid`, so it is read back as `MAX(id)` for the venture inside the batch
 * (D1 runs a batch as one transaction).
 */
function logRecorded(env: Env, user: User, projectId: number, summary: string) {
  return env.DB.prepare(
    `INSERT INTO activity_logs (project_id, user_id, action, details, actor, entity_type, entity_id)
     VALUES (?, ?, 'validation_decision_recorded', ?, ?, 'validate.verdict',
             (SELECT CAST(MAX(id) AS TEXT) FROM validation_decisions WHERE project_id = ?))`,
  ).bind(projectId, user.id ?? null, summary, `user:${user.id}`, projectId);
}

/** The row on the decision the new one superseded, written only when it did. */
function logSuperseded(env: Env, user: User, projectId: number, summary: string) {
  return env.DB.prepare(
    `INSERT INTO activity_logs (project_id, user_id, action, details, actor, entity_type, entity_id)
     SELECT ?, ?, 'validation_decision_superseded', ?, ?, 'validate.verdict', CAST(d.supersedes_id AS TEXT)
       FROM validation_decisions d
      WHERE d.id = (SELECT MAX(id) FROM validation_decisions WHERE project_id = ?)
        AND d.supersedes_id IS NOT NULL`,
  ).bind(projectId, user.id ?? null, summary, `user:${user.id}`, projectId);
}

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
  { bar = DECISION_EVIDENCE_BAR, evidenceSource = evidenceFor }: { bar?: number; evidenceSource?: EvidenceSource } = {},
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

  // #1703 replaces this with the Pivot's new hypothesis, written in this batch.
  if (pivotClaim) throw new VerdictError(400, 'A Pivot cannot start a hypothesis yet.');

  const state: DecisionState = items.length >= bar ? 'given' : 'withheld';
  const word = KIND_WORD[decision];
  const recordedSummary = state === 'given'
    ? `Recorded ${word} for ${scopeWord}`
    : `Recorded ${word} for ${scopeWord}, withheld`;

  const stmts = [];
  if (state === 'given') {
    // The pointer is the newest current given decision of the same scope,
    // chosen inside the batch.
    stmts.push(env.DB.prepare(
      `INSERT INTO validation_decisions (project_id, hypothesis_id, decision, reasoning, decided_by, state, supersedes_id)
       SELECT ?, ?, ?, ?, ?, 'given',
              (SELECT id FROM validation_decisions
                WHERE project_id = ? AND hypothesis_id IS ? AND state = 'given' AND superseded_at IS NULL
                ORDER BY decided_at DESC, id DESC LIMIT 1)
       RETURNING id, supersedes_id`,
    ).bind(projectId, hypothesisId, decision, reasoning, user.id ?? null, projectId, hypothesisId));
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
      `INSERT INTO validation_decisions (project_id, hypothesis_id, decision, reasoning, decided_by, state, supersedes_id)
       VALUES (?, ?, ?, ?, ?, 'withheld', NULL)
       RETURNING id, supersedes_id`,
    ).bind(projectId, hypothesisId, decision, reasoning, user.id ?? null));
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
  stmts.push(logRecorded(env, user, projectId, recordedSummary));
  if (state === 'given') stmts.push(logSuperseded(env, user, projectId, `Superseded by ${word}`));

  const out = await env.DB.batch(stmts);
  const row = ((out[0] as any)?.results?.[0] ?? null) as { id: number; supersedes_id: number | null } | null;
  if (!row) throw new Error('The decision was not written');
  return {
    id: Number(row.id),
    state,
    supersedes_id: row.supersedes_id == null ? null : Number(row.supersedes_id),
    pivot_hypothesis_id: null,
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
 * narrows to the venture or one hypothesis; `filter` to one kind or to the
 * withheld ones.
 */
export async function decisionsFor(
  env: Env,
  projectId: number,
  { scope, filter, sort = 'newest', page = 1, pageSize = DECISIONS_PAGE_SIZE }:
    { scope?: Scope; filter?: DecisionFilter | null; sort?: 'newest' | 'oldest'; page?: number; pageSize?: number } = {},
): Promise<{ rows: DecisionRow[]; total: number; page: number; page_size: number }> {
  const size = Math.max(1, Math.min(200, Math.floor(pageSize)));
  const p = Math.max(1, Math.floor(page) || 1);
  const scoped = scope === undefined ? 0 : 1;
  const hyp = scope === undefined ? null : scopeBind(scope);
  const kind = filter && filter !== 'withheld' ? filter : null;
  const withheld = filter === 'withheld' ? 1 : 0;
  const where = [projectId, scoped, hyp, kind, kind, withheld] as const;

  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM validation_decisions d
      WHERE d.project_id = ? AND (? = 0 OR d.hypothesis_id IS ?) AND (? IS NULL OR d.decision = ?)
        AND (? = 0 OR d.state = 'withheld')`,
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
        WHERE d.project_id = ? AND (? = 0 OR d.hypothesis_id IS ?) AND (? IS NULL OR d.decision = ?)
          AND (? = 0 OR d.state = 'withheld')
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
        WHERE d.project_id = ? AND (? = 0 OR d.hypothesis_id IS ?) AND (? IS NULL OR d.decision = ?)
          AND (? = 0 OR d.state = 'withheld')
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
