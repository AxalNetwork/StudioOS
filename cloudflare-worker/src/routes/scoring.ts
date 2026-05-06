// Scoring routes — Epic 5 anti-cheat layer. Two tracks: sandbox (founder
// practice, unlimited, never LP-visible) and official (1 per 7d, HMAC-signed,
// anomaly-flagged, hidden from LPs until admin approves).
import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth, requireRole, canAccessFounderResource } from '../auth';
import { runFullScore, tierLabel } from '../services/scoring';
import { autoCreateStudioOpsForProject } from './studioops';
import {
  assertNoReservedFields,
  assertOfficialInputsComplete,
  ReservedFieldError,
  MissingOfficialInputsError,
  signScore,
  verifyScoreHash,
  detectAnomalies,
  logScoreRead,
  snapshotIsVisible,
  isAuditableRole,
  INTEGRITY_VERSION,
  ScoreSnapshotRow,
} from '../services/scoreIntegrity';

const scoring = new Hono<{ Bindings: Env }>();

// 7-day cooldown on official runs; founders keep iterating in sandbox.
const OFFICIAL_COOLDOWN_DAYS = 7;
const OFFICIAL_COOLDOWN_MS = OFFICIAL_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

// Scoring (vs metadata) inputs — names match services/scoring.ts. Snapshotted
// into inputs_json and diffed for the input-jump anomaly check.
const SCORING_INPUT_KEYS = [
  'tam', 'sam', 'market_urgency', 'market_trend',
  'team_expertise', 'team_execution', 'team_network',
  'mvp_time_days', 'product_complexity', 'product_dependencies',
  'cost_to_mvp', 'time_to_revenue_months', 'burn_risk',
  'fit_alignment', 'fit_synergy',
  'distribution_channels', 'distribution_virality',
];

function pickInputs(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of SCORING_INPUT_KEYS) {
    if (body[k] !== undefined) out[k] = body[k];
  }
  return out;
}

function pickQualitativeText(body: Record<string, unknown>): string {
  // Stable separator so duplicate-text detection catches copy-paste regardless of order.
  const parts = [
    body.problem_statement, body.solution, body.why_now,
    body.use_of_funds, body.growth_signals,
  ].filter(v => typeof v === 'string' && (v as string).trim().length > 0);
  return (parts as string[]).map(s => s.trim().toLowerCase()).join('\n---\n');
}

scoring.post('/score', async (c) => {
  const user = await requireAuth(c);
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  // Reserved-field rejection — server-computed values in the body → 400.
  try {
    assertNoReservedFields(body);
  } catch (e) {
    if (e instanceof ReservedFieldError) {
      return c.json({ error: e.message, field: e.field, code: 'reserved_field' }, 400);
    }
    throw e;
  }

  const isSandbox = body.is_sandbox === true || body.is_sandbox === 1 || body.is_sandbox === '1';
  const willBeOfficial = !!body.project_id && !(isSandbox && user.role === 'founder');

  // Official runs require the full rubric. Sandbox stays permissive so
  // founders can practice partial inputs without seeing 400s.
  if (willBeOfficial) {
    try {
      assertOfficialInputsComplete(body);
    } catch (e) {
      if (e instanceof MissingOfficialInputsError) {
        return c.json({ error: e.message, missing: e.missing, code: 'missing_official_inputs' }, 400);
      }
      throw e;
    }
  }

  const result = runFullScore(body as Record<string, number>);

  // Stateless preview: no project_id → just return computed score (sandbox-style).
  if (!body.project_id) {
    return c.json({ ...result, is_sandbox: true, snapshot_id: null });
  }

  const projectId = Number(body.project_id);
  const sql = getSQL(c.env);
  const projects = await sql`SELECT * FROM projects WHERE id = ${projectId}`;
  if (projects.length === 0) {
    await sql.end();
    return c.json({ error: 'Project not found' }, 404);
  }
  const project = projects[0];

  // IDOR guard: founders may only score their own project.
  if (!canAccessFounderResource(user, project.founder_id)) {
    await sql.end();
    return c.json({ error: 'Forbidden' }, 403);
  }

  // Sandbox is founder-only — partners/admins always write official runs.
  const effectiveSandbox = isSandbox && user.role === 'founder';

  // Official cooldown: 1 per 7d per project. Sandbox bypasses; admin override
  // is /scoring/score?force=1 for cases where genuine intake data changed.
  let cooldownInfo: { locked_until: string | null; previous_id: number | null } = { locked_until: null, previous_id: null };
  // Hoisted out of the `if (!effectiveSandbox)` block because the official_week
  // computation below needs it: when an admin force-overrides, we must NULL
  // out official_week on the new row so the partial UNIQUE INDEX doesn't
  // reject it (the index is the atomic guard for normal writes; force is the
  // documented escape hatch).
  const force = !effectiveSandbox && c.req.query('force') === '1' && user.role === 'admin';
  if (!effectiveSandbox) {
    if (!force) {
      const recent = await sql`
        SELECT id, created_at, locked_until FROM score_snapshots
        WHERE project_id = ${projectId} AND is_sandbox = 0
        ORDER BY id DESC LIMIT 1
      `;
      if (recent.length > 0) {
        const last = recent[0];
        const lockUntilMs = last.locked_until
          ? Date.parse(String(last.locked_until).replace(' ', 'T') + 'Z')
          : Date.parse(String(last.created_at).replace(' ', 'T') + 'Z') + OFFICIAL_COOLDOWN_MS;
        if (Number.isFinite(lockUntilMs) && Date.now() < lockUntilMs) {
          await sql.end();
          // T8 — return 409 (Conflict) to match the post-insert UNIQUE-index
          // race response below. Both paths represent "an official score for
          // this project already exists this week"; using one contract keeps
          // the client-side handler simple regardless of which guard fired.
          return c.json({
            error: `Official scoring is locked. Next official run available at ${new Date(lockUntilMs).toISOString()}. Use Practice mode to iterate in the meantime.`,
            code: 'official_cooldown',
            locked_until: new Date(lockUntilMs).toISOString(),
            previous_snapshot_id: last.id,
          }, 409);
        }
        cooldownInfo.previous_id = last.id;
      }
    }
  }

  const b = result.breakdown;
  const inputsJson = JSON.stringify(pickInputs(body));
  const qualitativeText = pickQualitativeText(body);
  const lockedUntil = effectiveSandbox
    ? null
    : new Date(Date.now() + OFFICIAL_COOLDOWN_MS).toISOString().replace('T', ' ').slice(0, 19);

  // T8 — compute `official_week` server-side using the SAME SQLite clock the
  // partial unique index `uq_score_official_week (project_id, official_week)
  // WHERE is_sandbox = 0 AND official_week IS NOT NULL` was built against.
  // Two concurrent inserts for the same (project_id, week) hit the
  // constraint atomically — the loser gets a D1 UNIQUE error which we
  // convert below to a 409 "already scored this week". Sandbox rows AND
  // admin force=1 overrides stay NULL so the partial index ignores them
  // (force is the documented escape hatch for re-running after intake fixes).
  let officialWeek: string | null = null;
  if (!effectiveSandbox && !force) {
    const wk = await sql`SELECT strftime('%Y-%W', 'now') AS w`;
    officialWeek = (wk?.[0]?.w as string) ?? null;
  }

  // CRITICAL: anomaly detection MUST run BEFORE the INSERT. detectAnomalies
  // queries `score_snapshots ORDER BY id DESC LIMIT 1` for the same project
  // — running it post-insert would self-compare against the row we just
  // wrote and silently swallow input_jump / practice_jump flags.
  const flags = await detectAnomalies(c.env, {
    projectId,
    totalScore: result.total_score,
    isSandbox: effectiveSandbox,
    inputs: pickInputs(body) as Record<string, number>,
    qualitativeText,
  });
  const reviewStatus: 'auto_approved' | 'flagged' =
    !effectiveSandbox && flags.length > 0 ? 'flagged' : 'auto_approved';
  const flagsJson = flags.length > 0 ? JSON.stringify(flags) : null;

  let snapshot: { id: number; created_at: string };
  try {
    const rows = await sql`
      INSERT INTO score_snapshots (
        project_id, total_score, tier,
        market_size, market_urgency, market_trend, market_total,
        team_expertise, team_execution, team_network, team_total,
        product_mvp_time, product_complexity, product_dependency, product_total,
        capital_cost_mvp, capital_time_revenue, capital_burn_traction, capital_total,
        fit_alignment, fit_synergy, fit_total,
        distribution_channels, distribution_virality, distribution_total,
        ai_adjustment, scored_by,
        is_sandbox, integrity_version, inputs_json, qualitative_text, locked_until,
        anomaly_flags, admin_review_status, official_week
      ) VALUES (
        ${projectId}, ${result.total_score}, ${result.tier},
        ${b.market.size}, ${b.market.urgency}, ${b.market.trend}, ${b.market.total},
        ${b.team.expertise}, ${b.team.execution}, ${b.team.network}, ${b.team.total},
        ${b.product.mvp_time}, ${b.product.complexity}, ${b.product.dependency}, ${b.product.total},
        ${b.capital.cost_mvp}, ${b.capital.time_revenue}, ${b.capital.burn_traction}, ${b.capital.total},
        ${b.fit.alignment}, ${b.fit.synergy}, ${b.fit.total},
        ${b.distribution.channels}, ${b.distribution.virality}, ${b.distribution.total},
        ${result.ai_adjustment}, ${user.role || 'system'},
        ${effectiveSandbox ? 1 : 0}, ${INTEGRITY_VERSION},
        ${inputsJson}, ${qualitativeText || null}, ${lockedUntil},
        ${flagsJson}, ${reviewStatus}, ${officialWeek}
      )
      RETURNING id, created_at
    `;
    snapshot = rows[0];
  } catch (e: any) {
    // T8 — atomic loser of a concurrent (project_id, official_week) race.
    // The partial unique index `uq_score_official_week` raises this whenever
    // a second official scoring INSERT lands in the same week. We convert
    // it into the same 409 the cooldown read-then-write check would have
    // produced so client behaviour is identical regardless of which guard
    // fires first.
    const msg = String(e?.message || '');
    if (/UNIQUE constraint failed/i.test(msg) && /official_week/i.test(msg)) {
      await sql.end();
      return c.json({
        error: 'Already scored this week.',
        code: 'official_cooldown',
        official_week: officialWeek,
      }, 409);
    }
    await sql.end();
    throw e;
  }

  // Sign + persist. Two-step because the canonical message includes the
  // row's own created_at; the read filter treats missing-hash as not-yet-
  // verified, so LPs never see the row in the microseconds between calls.
  const hash = await signScore(c.env, projectId, result.total_score, snapshot.created_at, INTEGRITY_VERSION);
  await sql`UPDATE score_snapshots SET integrity_hash = ${hash} WHERE id = ${snapshot.id}`;

  if (flags.length > 0) {
    // Surface to admin monitoring + activity log so MonitoringPage picks it up.
    try {
      await sql`
        INSERT INTO activity_logs (project_id, user_id, action, details, actor)
        VALUES (${projectId}, ${user.id}, 'score_anomaly', ${JSON.stringify({ snapshot_id: snapshot.id, flags, status: reviewStatus })}, ${user.role || 'system'})
      `;
    } catch {/* best-effort */ }
    // Page admins (in-app + email) the moment a row transitions to flagged.
    if (reviewStatus === 'flagged') {
      try {
        const { notifyAdminsOfFlaggedScore } = await import('../services/notifications');
        await notifyAdminsOfFlaggedScore(c.env, {
          snapshotId: snapshot.id,
          projectId,
          projectName: project.name ?? null,
          totalScore: result.total_score,
          flags,
          source: 'submit',
        });
      } catch (e) { console.error('[scoring] admin notify failed', e); }
    }
  }

  // Status only flips for auto-approved official runs. Flagged runs hold
  // the project at its current status until admin signs off (LP guarantee).
  let newStatus = project.status;
  if (!effectiveSandbox && reviewStatus === 'auto_approved') {
    newStatus = result.total_score >= 85 ? 'tier_1' : result.total_score >= 70 ? 'tier_2' : 'rejected';
    if (newStatus !== project.status) {
      await sql`UPDATE projects SET status = ${newStatus}, updated_at = CURRENT_TIMESTAMP WHERE id = ${projectId}`;
    }
  }

  await sql.end();

  if (!effectiveSandbox && reviewStatus === 'auto_approved' && newStatus !== project.status && (newStatus === 'tier_1' || newStatus === 'tier_2')) {
    try { await autoCreateStudioOpsForProject(c.env, projectId, newStatus, user.id); } catch {}
  }

  // Phase 0.2 notify — page the founder when an official score lands on
  // their project. Sandbox runs and self-runs are intentionally silent.
  try {
    if (!effectiveSandbox && project.founder_id) {
      const fr = await sql`SELECT user_id FROM founders WHERE id = ${project.founder_id}`;
      const founderUserId = fr[0]?.user_id;
      if (founderUserId && founderUserId !== user.id) {
        const { notify } = await import('../services/notify');
        await notify(c.env, {
          userId: founderUserId,
          type: 'score_generated',
          title: `${project.name || 'Your project'}: new score ${result.total_score}`,
          body: `Tier: ${result.tier || newStatus}.${reviewStatus === 'flagged' ? ' Pending admin review.' : ''}`,
          link: `/projects/${projectId}`,
          payload: { snapshot_id: snapshot.id, total_score: result.total_score, tier: result.tier },
          channels: ['in_app', 'email'],
        });
      }
    }
  } catch (e) { console.warn('[scoring] notify score_generated failed', e); }

  return c.json({
    ...result,
    snapshot_id: snapshot.id,
    is_sandbox: effectiveSandbox,
    integrity_hash: hash,
    integrity_version: INTEGRITY_VERSION,
    requires_admin_review: reviewStatus === 'flagged',
    anomaly_flags: flags,
    locked_until: lockedUntil,
    previous_snapshot_id: cooldownInfo.previous_id,
  });
});

scoring.post('/score/:projectId/deal-memo', async (c) => {
  // Memo creation is partner/admin only — founders can never generate one.
  const user = await requireRole(c, 'partner', 'investor');
  const projectId = parseInt(c.req.param('projectId'));
  const sql = getSQL(c.env);

  const projects = await sql`SELECT * FROM projects WHERE id = ${projectId}`;
  if (projects.length === 0) { await sql.end(); return c.json({ error: 'Project not found' }, 404); }
  const project = projects[0];

  // Memos may only be built from APPROVED, OFFICIAL, VERIFIED snapshots —
  // anything else risks bringing tampered numbers in front of an LP.
  const snapshots = await sql`
    SELECT * FROM score_snapshots
    WHERE project_id = ${projectId}
      AND is_sandbox = 0
      AND admin_review_status IN ('auto_approved', 'approved')
    ORDER BY created_at DESC LIMIT 1
  `;
  if (snapshots.length === 0) {
    await sql.end();
    return c.json({ error: 'No approved official score found. Run scoring first or have admin approve a flagged snapshot.' }, 404);
  }
  const snapshot = snapshots[0];

  const verified = await verifyScoreHash(c.env, snapshot as ScoreSnapshotRow);
  // Audit the partner read of this snapshot regardless of verification outcome
  // so disputes can be replayed end-to-end (verified=false reads are exactly
  // the ones LPs would later complain about).
  if (isAuditableRole(user.role)) {
    await logScoreRead(c.env, {
      snapshotId: snapshot.id,
      projectId,
      userId: user.id ?? null,
      role: user.role,
      integrityHash: snapshot.integrity_hash,
      integrityValid: verified.valid,
    });
  }
  if (!verified.valid) {
    await sql.end();
    return c.json({ error: 'Score integrity check failed; admin must re-verify before memo generation.', reason: verified.reason }, 409);
  }

  let founderName = 'Unknown';
  if (project.founder_id) {
    const founders = await sql`SELECT name FROM founders WHERE id = ${project.founder_id}`;
    if (founders.length > 0) founderName = founders[0].name;
  }

  const decision = snapshot.tier === 'TIER_1' ? 'INVEST / SPINOUT' : snapshot.tier === 'TIER_2' ? 'CONDITIONAL' : 'PASS';

  const [memo] = await sql`INSERT INTO deal_memos (project_id, score_snapshot_id, startup_name, founders, sector, stage, total_score, tier, problem, solution, why_now, users, revenue_info, growth_signals, cost_to_mvp, funding_needed, use_of_funds, decision) VALUES (${project.id}, ${snapshot.id}, ${project.name}, ${founderName}, ${project.sector}, ${project.stage}, ${snapshot.total_score}, ${snapshot.tier}, ${project.problem_statement}, ${project.solution}, ${project.why_now}, ${project.users_count?.toString() || null}, ${project.revenue?.toString() || null}, ${project.growth_signals}, ${project.cost_to_mvp?.toString() || null}, ${project.funding_needed?.toString() || null}, ${project.use_of_funds}, ${decision}) RETURNING *`;
  await sql.end();

  return c.json({
    id: memo.id, startup_name: memo.startup_name, founders: memo.founders,
    sector: memo.sector, stage: memo.stage, score: memo.total_score,
    tier: memo.tier, tier_label: tierLabel(memo.tier),
    problem: memo.problem, solution: memo.solution, why_now: memo.why_now,
    traction: { users: memo.users, revenue: memo.revenue_info, growth_signals: memo.growth_signals },
    economics: { cost_to_mvp: memo.cost_to_mvp, funding_needed: memo.funding_needed, use_of_funds: memo.use_of_funds },
    axal_fit: { strategic_alignment: memo.strategic_alignment, partner_synergies: memo.partner_synergies },
    risks: memo.risks, decision: memo.decision,
    terms: { amount: memo.terms_amount, equity: memo.terms_equity, structure: memo.terms_structure },
    integrity_hash: snapshot.integrity_hash,
  });
});

scoring.get('/scores/:projectId', async (c) => {
  const user = await requireAuth(c);
  const projectId = parseInt(c.req.param('projectId'));
  const sql = getSQL(c.env);

  const owners = await sql`SELECT founder_id FROM projects WHERE id = ${projectId}`;
  if (owners.length === 0) { await sql.end(); return c.json({ error: 'Project not found' }, 404); }
  const ownerFounderId = owners[0].founder_id;

  // IDOR guard: founders only see their own project; partner/admin all.
  if (!canAccessFounderResource(user, ownerFounderId)) {
    await sql.end();
    return c.json({ detail: 'Forbidden: you do not own this project' }, 403);
  }

  // Founders see their own sandbox runs; LPs/partners never do. Admin sees
  // everything — including flagged + tampered rows — so they can audit.
  const wantSandbox = c.req.query('include_sandbox') === '1';
  const showSandbox = (user.role === 'admin') || (user.role === 'founder' && wantSandbox);

  const rows = (showSandbox
    ? await sql`SELECT * FROM score_snapshots WHERE project_id = ${projectId} ORDER BY created_at DESC`
    : await sql`SELECT * FROM score_snapshots WHERE project_id = ${projectId} AND is_sandbox = 0 ORDER BY created_at DESC`) as unknown as (ScoreSnapshotRow & Record<string, unknown>)[];

  // Verify each non-sandbox row's hash and apply visibility rules.
  // We ALWAYS call verifyScoreHash for non-sandbox rows — even when
  // integrity_hash is missing — so that snapshotIsVisible's
  // `hashValid !== true` rule hides unsigned official rows from
  // non-admins. (verifyScoreHash returns {valid:false, reason:'missing_hash'}
  // for the unsigned case.)
  const verified: Record<string, unknown>[] = [];
  for (const row of rows) {
    let hashValid: boolean | null = null;
    if (!row.is_sandbox) {
      const v = await verifyScoreHash(c.env, row);
      hashValid = v.valid;
    }
    const visible = snapshotIsVisible(row, hashValid, {
      role: user.role,
      founderId: user.founder_id ?? null,
      ownerFounderId,
    });
    if (!visible) continue;

    if (user.role !== 'admin') {
      const { admin_review_notes, admin_reviewed_by, admin_reviewed_at, inputs_json, ...safe } = row;
      verified.push({ ...safe, integrity_valid: hashValid });
    } else {
      verified.push({ ...row, integrity_valid: hashValid });
    }

    // Audit every LP/partner/admin read so disputes can be replayed.
    if (isAuditableRole(user.role)) {
      await logScoreRead(c.env, {
        snapshotId: row.id,
        projectId,
        userId: user.id ?? null,
        role: user.role,
        integrityHash: row.integrity_hash,
        integrityValid: hashValid,
      });
    }
  }

  await sql.end();
  return c.json(verified);
});

scoring.get('/deal-memos/:projectId', async (c) => {
  await requireRole(c, 'partner', 'investor');
  const projectId = parseInt(c.req.param('projectId'));
  const sql = getSQL(c.env);
  const memos = await sql`SELECT * FROM deal_memos WHERE project_id = ${projectId} ORDER BY created_at DESC`;
  await sql.end();
  return c.json(memos);
});

scoring.get('/queue', async (c) => {
  await requireRole(c, 'partner', 'investor');
  const sql = getSQL(c.env);
  const projects = await sql`SELECT * FROM projects WHERE status IN ('intake', 'scoring') ORDER BY created_at DESC`;
  await sql.end();
  return c.json(projects);
});

scoring.post('/generateMemo', async (c) => {
  await requireRole(c, 'partner', 'investor');
  const data = await c.req.json();
  return c.json({
    startup_name: data.startup_name, ai_generated: false,
    memo: {
      problem_analysis: `${data.startup_name || 'Unknown'} is addressing: ${data.problem || 'N/A'}. The ${data.sector || 'technology'} sector presents a market opportunity.`,
      solution_assessment: `Proposed solution: ${data.solution || 'N/A'}. Requires further technical diligence.`,
      traction_summary: data.traction || 'Early stage — pre-traction.',
      risk_assessment: ['Market timing and competitive dynamics need validation', 'Team execution capability requires further assessment', 'Capital efficiency needs detailed burn analysis'],
      decision: 'CONDITIONAL — requires deeper diligence on team and market validation',
      key_insight: `The ${data.sector || 'technology'} opportunity warrants exploration given current market dynamics.`,
    },
  });
});

export default scoring;
