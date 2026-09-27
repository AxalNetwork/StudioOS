import { Hono } from 'hono';
import type { Env, User } from '../types';
import { schedulePush } from '../integrations/autopush';
import { getSQL } from '../db';
import { investorActiveCompany } from './_investorProjectScope';
import { requireAuth, requireRole, requireAdmin, canAccessFounderResource } from '../auth';
import { buildZip } from '../util/zip';
import { isPassReason, passReasonLabel, PASS_REASON_KEYS, PASS_REASON_UNRECORDED } from '../services/dealPassTaxonomy';
import { buildPassBreakdown, buildStageFunnel, DEAL_METRIC_UNAVAILABLE } from '../services/dealAnalytics';
import { ensureDealPassSchema, recordStageEvent, stageRecordingStartedAt } from '../services/dealStageHistory';
import { newUid, nowIso } from './_t13t14t15_helpers';

const deals = new Hono<{ Bindings: Env }>();

// Task #4 — Deal Flow pipeline stages (excludes the terminal `rejected`).
const PIPELINE = ['applied', 'scored', 'active', 'funded'];

// Task #127 — every value `deals.status` accepts, mirroring the column's CHECK.
// PUT validates against this rather than letting an arbitrary string reach D1,
// where the constraint failure surfaces to the caller as an opaque 400.
const DEAL_STATUSES = [...PIPELINE, 'rejected'];
const PASSED_STATUS = 'rejected';

// SQLite datetime('now') yields 'YYYY-MM-DD HH:MM:SS' in UTC — normalise so
// `new Date` parses it as UTC rather than local.
function normTs(s: any): number | null {
  if (!s) return null;
  const raw = String(s);
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z';
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

function daysInStage(row: any): number {
  const ref = normTs(row.stage_changed_at || row.updated_at || row.created_at);
  if (!ref) return 0;
  const d = Math.floor((Date.now() - ref) / 86_400_000);
  return d > 0 ? d : 0;
}

// Mirror FastAPI _serialize_deal: attach progress_pct + days_in_stage.
function enrichDeal(row: any): any {
  const target = row.target_raise || row.amount || 0;
  const committed = row.capital_committed || 0;
  const progress = target ? Math.round((committed / target) * 1000) / 10 : 0;
  return { ...row, progress_pct: progress, days_in_stage: daysInStage(row) };
}

const isPrivilegedRole = (role: string) =>
  role === 'admin' || role === 'partner' || role === 'investor';

deals.get('/', async (c) => {
  const user = await requireAuth(c);
  const status = c.req.query('status');
  // Investors can narrow the firm-wide funnel to "my deals". The relationship
  // predicate deliberately matches canReadDeal below so every listed card has
  // a working, authorized deal-room destination.
  const scope = c.req.query('scope');
  const sql = getSQL(c.env);
  const isPrivileged = user.role === 'admin' || user.role === 'partner' || user.role === 'investor';
  // IDOR guard: founders can only list deals on their own projects.
  let rows: any;
  // Task #16 — surface founder_user_id on the listing so investors/admins can
  // render the per-founder TrustScoreBadge inline next to FounderRiskBadge
  // without an extra round-trip per row.
  if (isPrivileged) {
    rows = status
      ? await sql`SELECT d.*, p.name as project_name, p.sector as project_sector, pr.name as partner_name, lp.name as lead_partner_name, f.id as founder_user_id FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN partners pr ON d.partner_id = pr.id LEFT JOIN users lp ON lp.id = d.lead_partner_id LEFT JOIN users f ON f.founder_id = p.founder_id WHERE d.status = ${status} AND (p.id IS NULL OR p.deleted_at IS NULL) ORDER BY d.created_at DESC`
      : await sql`SELECT d.*, p.name as project_name, p.sector as project_sector, pr.name as partner_name, lp.name as lead_partner_name, f.id as founder_user_id FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN partners pr ON d.partner_id = pr.id LEFT JOIN users lp ON lp.id = d.lead_partner_id LEFT JOIN users f ON f.founder_id = p.founder_id WHERE (p.id IS NULL OR p.deleted_at IS NULL) ORDER BY d.created_at DESC`;
    // Task #82 — annotate each deal with is_member (is this investor in the
    // dealroom?) so the SPA can render "View room" vs "Join room", and apply
    // the optional scope=mine relationship filter.
    if (user.role === 'investor') {
      await ensureInvestorPaywallSchema(c.env);
      // Company scoping, stage 6. The deal LIST above is deliberately NOT
      // narrowed — browsing open deals is a marketplace, and an investor is
      // meant to see deals they have no relationship with yet. What narrows is
      // every claim about THIS firm: whether they are in the room, and the
      // `scope=mine` filter. A dealroom joined under their other company must
      // read as "Join room" here, not as membership.
      //
      // `companyId === null` (no company selected, or a forged header) leaves
      // all three reads unnarrowed, and a relationship row with
      // `company_id IS NULL` stays visible under every company — the same
      // reading `projectInActiveCompany` uses.
      const companyId = await investorActiveCompany(c, user);
      const memberRows = companyId === null
        ? await sql`SELECT deal_id FROM investor_dealroom_members WHERE investor_user_id = ${user.id}`
        : await sql`SELECT deal_id FROM investor_dealroom_members WHERE investor_user_id = ${user.id} AND (company_id = ${companyId} OR company_id IS NULL)`;
      const memberSet = new Set<number>((memberRows as any[]).map((r) => Number(r.deal_id)));
      rows = (rows as any[]).map((d) => ({ ...d, is_member: memberSet.has(Number(d.id)) ? 1 : 0 }));
      if (scope === 'mine') {
        const invitedRows = companyId === null
          ? await sql`SELECT deal_id FROM deal_invitations WHERE investor_user_id = ${user.id}`
          : await sql`SELECT deal_id FROM deal_invitations WHERE investor_user_id = ${user.id} AND (company_id = ${companyId} OR company_id IS NULL)`;
        const committedRows = companyId === null
          ? await sql`SELECT deal_id FROM commitments WHERE investor_user_id = ${user.id}`
          : await sql`SELECT deal_id FROM commitments WHERE investor_user_id = ${user.id} AND (company_id = ${companyId} OR company_id IS NULL)`;
        const readable = new Set<number>([
          ...(invitedRows as any[]).map((r) => Number(r.deal_id)),
          ...(committedRows as any[]).map((r) => Number(r.deal_id)),
        ]);
        rows = (rows as any[]).filter((d) => readable.has(Number(d.id)));
      }
    }
  } else {
    if (!user.founder_id) { await sql.end(); return c.json([]); }
    // The founder branch is an inlined ownership query, so it carries the
    // company clause directly — the same `(p.company_id = ? OR p.company_id IS
    // NULL)` the five loaders and the project picker use. Without it a founder
    // would see deals for projects the picker had already stopped showing.
    const founderCompanyId = await investorActiveCompany(c, user);
    rows = status
      ? (founderCompanyId === null
        ? await sql`SELECT d.*, p.name as project_name, p.sector as project_sector, pr.name as partner_name, f.id as founder_user_id FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN partners pr ON d.partner_id = pr.id LEFT JOIN users f ON f.founder_id = p.founder_id WHERE d.status = ${status} AND p.founder_id = ${user.founder_id} AND p.deleted_at IS NULL ORDER BY d.created_at DESC`
        : await sql`SELECT d.*, p.name as project_name, p.sector as project_sector, pr.name as partner_name, f.id as founder_user_id FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN partners pr ON d.partner_id = pr.id LEFT JOIN users f ON f.founder_id = p.founder_id WHERE d.status = ${status} AND p.founder_id = ${user.founder_id} AND (p.company_id = ${founderCompanyId} OR p.company_id IS NULL) AND p.deleted_at IS NULL ORDER BY d.created_at DESC`)
      : (founderCompanyId === null
        ? await sql`SELECT d.*, p.name as project_name, p.sector as project_sector, pr.name as partner_name, f.id as founder_user_id FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN partners pr ON d.partner_id = pr.id LEFT JOIN users f ON f.founder_id = p.founder_id WHERE p.founder_id = ${user.founder_id} AND p.deleted_at IS NULL ORDER BY d.created_at DESC`
        : await sql`SELECT d.*, p.name as project_name, p.sector as project_sector, pr.name as partner_name, f.id as founder_user_id FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN partners pr ON d.partner_id = pr.id LEFT JOIN users f ON f.founder_id = p.founder_id WHERE p.founder_id = ${user.founder_id} AND (p.company_id = ${founderCompanyId} OR p.company_id IS NULL) AND p.deleted_at IS NULL ORDER BY d.created_at DESC`);
  }
  await sql.end();
  return c.json((rows as any[]).map(enrichDeal));
});

// ---------------------------------------------------------------------------
// Task #4 — Funnel aggregates for the Deal Flow cards (privileged roles only).
// ---------------------------------------------------------------------------
deals.get('/funnel', async (c) => {
  const user = await requireAuth(c);
  if (!isPrivilegedRole(user.role as string)) return c.json({ stages: [], total: 0 });
  const sql = getSQL(c.env);
  const rows = await sql`
    SELECT d.status AS stage,
           COUNT(*) AS count,
           COALESCE(SUM(COALESCE(d.target_raise, d.amount, 0)), 0) AS total_target,
           COALESCE(SUM(COALESCE(d.capital_committed, 0)), 0) AS total_committed,
           SUM(CASE WHEN d.created_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS added_7d
    FROM deals d
    LEFT JOIN projects p ON p.id = d.project_id
    WHERE (p.id IS NULL OR p.deleted_at IS NULL)
    GROUP BY d.status`;
  await sql.end();
  const byStage: Record<string, any> = {};
  for (const r of rows as any[]) byStage[r.stage] = r;
  const stages = [...PIPELINE, 'rejected'].map((stage) => {
    const r = byStage[stage] || {};
    return {
      stage,
      count: Number(r.count || 0),
      total_target: Number(r.total_target || 0),
      total_committed: Number(r.total_committed || 0),
      added_7d: Number(r.added_7d || 0),
    };
  });
  return c.json({ stages, total: stages.reduce((n, s) => n + s.count, 0) });
});

// ---------------------------------------------------------------------------
// Task #127 — pass + stage analytics. Registered above `/:id` so the literal
// paths are not swallowed by the id route.
// ---------------------------------------------------------------------------

/**
 * Why we passed. Pass data is the fund's memory: revisiting a valuation pass a
 * year later is the point of recording it, so this endpoint is a query surface
 * first and a chart second — `?reason=` returns the deals behind a bucket.
 */
deals.get('/pass-analytics', async (c) => {
  const user = await requireAuth(c);
  if (!isPrivilegedRole(user.role as string)) return c.json({ detail: 'Forbidden' }, 403);
  await ensureDealPassSchema(c.env);
  const sql = getSQL(c.env);

  const counts = await sql`
    SELECT d.pass_reason AS pass_reason, COUNT(*) AS count
      FROM deals d
      LEFT JOIN projects p ON p.id = d.project_id
     WHERE d.status = ${PASSED_STATUS}
       AND (p.id IS NULL OR p.deleted_at IS NULL)
     GROUP BY d.pass_reason`;
  const breakdown = buildPassBreakdown(counts as any[]);

  // A reason the caller did not ask about returns no deals rather than all of
  // them — an unfiltered dump of every pass is a different, larger disclosure.
  const reason = c.req.query('reason');
  let matches: any[] = [];
  if (reason && isPassReason(reason)) {
    matches = (await sql`
      SELECT d.id, d.uid, d.pass_reason, d.pass_note, d.passed_at,
             p.name AS project_name, p.sector AS project_sector,
             u.name AS passed_by_name
        FROM deals d
        LEFT JOIN projects p ON p.id = d.project_id
        LEFT JOIN users u ON u.id = d.passed_by_user_id
       WHERE d.status = ${PASSED_STATUS} AND d.pass_reason = ${reason}
         AND (p.id IS NULL OR p.deleted_at IS NULL)
       ORDER BY d.passed_at DESC
       LIMIT 100`) as any[];
  } else if (reason === PASS_REASON_UNRECORDED) {
    matches = (await sql`
      SELECT d.id, d.uid, d.pass_reason, d.pass_note, d.passed_at,
             p.name AS project_name, p.sector AS project_sector,
             u.name AS passed_by_name
        FROM deals d
        LEFT JOIN projects p ON p.id = d.project_id
        LEFT JOIN users u ON u.id = d.passed_by_user_id
       WHERE d.status = ${PASSED_STATUS} AND d.pass_reason IS NULL
         AND (p.id IS NULL OR p.deleted_at IS NULL)
       ORDER BY COALESCE(d.passed_at, d.updated_at) DESC
       LIMIT 100`) as any[];
  }

  await sql.end();
  return c.json({
    total: breakdown.total,
    buckets: breakdown.buckets,
    unrecorded: breakdown.unrecorded,
    // Named explicitly so the UI can say WHY a bucket has no reason rather
    // than leaving the operator to assume the data is merely missing.
    unrecorded_note: breakdown.unrecorded > 0
      ? 'These deals were passed before a reason was required. They are not backfilled — a guessed reason would corrupt the record.'
      : null,
    reason: reason || null,
    deals: matches,
  });
});

/**
 * Stage funnel over RECORDED transitions.
 *
 * `recording_started_at` is not decoration. Stage history begins at migration
 * 176; a conversion rate presented without it reads as the fund's whole
 * history when it may be a fortnight of it.
 */
deals.get('/stage-analytics', async (c) => {
  const user = await requireAuth(c);
  if (!isPrivilegedRole(user.role as string)) return c.json({ detail: 'Forbidden' }, 403);
  await ensureDealPassSchema(c.env);
  const sql = getSQL(c.env);

  const raw = c.req.query('days');
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  const days = Number.isFinite(parsed) && parsed > 0 && parsed <= 3650 ? parsed : 90;

  const started = await stageRecordingStartedAt(sql);
  const events = (await sql.unsafe(
    `SELECT deal_id, from_stage, to_stage, kind, days_in_from, created_at
       FROM deal_stage_events
      WHERE created_at >= datetime('now', ?)
      ORDER BY created_at`,
    [`-${days} days`],
  )) as any[];

  await sql.end();
  const funnel = buildStageFunnel(PIPELINE, events as any);
  return c.json({
    window_days: days,
    recording_started_at: started,
    // The window can legitimately reach back further than the data does. Say
    // so, rather than letting an empty early period read as a quiet quarter.
    covers_full_window: !!started && !!events.length
      && (Date.now() - new Date(String(started).replace(' ', 'T') + 'Z').getTime()) >= days * 86_400_000,
    unavailable: started ? null : DEAL_METRIC_UNAVAILABLE.stage_history,
    stages: funnel,
    events_counted: events.length,
    // Stated, not omitted: the design's source-quality table has no backing.
    source_quality_unavailable: DEAL_METRIC_UNAVAILABLE.source_quality,
  });
});

/**
 * Deals · Screening — canvas **ID2**, the desk behind `/deals/screening`.
 *
 * THE OPS ROW SAID THERE WAS NOTHING HERE, AND IT WAS WRONG TWICE.
 * `investorZoneActions` marked `New batch run` unbuilt because "no scoring run
 * is stored — this desk reads the deal record", and `Edit rubric` because "no
 * rubric is stored". Both claims fail against the schema:
 *
 *   `score_snapshots` IS a stored scoring run, with SIX dimensions — market,
 *   team, product, capital, fit, distribution — each carrying its sub-scores
 *   and a total beside `total_score` and `tier`. That is exactly the
 *   artboard's "Rubric · 6 dims". It also carries `anomaly_flags` and
 *   `admin_review_status`, which is a red-flag store under another name.
 *
 * WHAT IS ACTUALLY NOT BUILT, and is stated rather than drawn: the WEIGHTS are
 * fixed in `services/scoring.ts` and no store makes them editable, so `Edit
 * rubric` stays unbuilt for the accurate reason; and there are no red-flag
 * RULES a person can write — `detectAnomalies` produces flags from fixed
 * heuristics, and a rules editor over that would be a screen for a table
 * nobody has.
 *
 * A SANDBOX SCORE IS NOT A SCREENING RESULT. `score_snapshots.is_sandbox`
 * marks a practice run, and `official_week` is NULL for those so the weekly
 * unique index ignores them. Counting one as "scored" would let a rehearsal
 * change the desk's numbers, so they are excluded here and the exclusion is
 * reported rather than silent.
 *
 * ONE SNAPSHOT PER PROJECT, THE LATEST. Scoring appends; the desk reads the
 * newest official row per project. `MAX(created_at)` with a GROUP BY picks the
 * row it came from under SQLite's bare-column rule, which is what is wanted.
 */
deals.get('/screening', async (c) => {
  const user = await requireAuth(c);
  if (!isPrivilegedRole(user.role as string)) return c.json({ detail: 'Forbidden' }, 403);
  const sql = getSQL(c.env);

  /** The six the scorer writes, in the order it writes them. */
  const RUBRIC = [
    { key: 'market', label: 'Market', parts: ['size', 'urgency', 'trend'] },
    { key: 'team', label: 'Team', parts: ['expertise', 'execution', 'network'] },
    { key: 'product', label: 'Product', parts: ['mvp_time', 'complexity', 'dependency'] },
    { key: 'capital', label: 'Capital', parts: ['cost_mvp', 'time_revenue', 'burn_traction'] },
    { key: 'fit', label: 'Fit', parts: ['alignment', 'synergy'] },
    { key: 'distribution', label: 'Distribution', parts: ['channels', 'virality'] },
  ];

  let scored: unknown;
  let flags: unknown;
  try {
    const rows = await sql`
      SELECT d.id AS deal_id, d.status AS deal_status,
             p.name AS company, p.sector AS sector,
             s.total_score, s.tier, s.created_at AS scored_at,
             s.admin_review_status, s.anomaly_flags,
             s.market_total, s.team_total, s.product_total,
             s.capital_total, s.fit_total, s.distribution_total
        FROM deals d
        LEFT JOIN projects p ON p.id = d.project_id
        LEFT JOIN (
              SELECT project_id, MAX(created_at) AS created_at, total_score, tier,
                     admin_review_status, anomaly_flags,
                     market_total, team_total, product_total,
                     capital_total, fit_total, distribution_total
                FROM score_snapshots
               WHERE is_sandbox = 0
               GROUP BY project_id
             ) s ON s.project_id = d.project_id
       WHERE (p.id IS NULL OR p.deleted_at IS NULL)
       ORDER BY s.created_at DESC, d.created_at DESC
       LIMIT 200`;

    const list = (rows as any[]).map((r) => {
      // `anomaly_flags` is JSON written by detectAnomalies: [{type, severity}].
      // Malformed JSON is treated as no flags rather than taking the read down;
      // the row still reports its review status, which is the stored fact.
      let parsed: Array<{ type?: string; severity?: string }> = [];
      try { parsed = r.anomaly_flags ? JSON.parse(String(r.anomaly_flags)) : []; } catch { parsed = []; }
      return {
        deal_id: Number(r.deal_id),
        company: r.company ?? null,
        sector: r.sector ?? null,
        deal_status: r.deal_status ?? null,
        total_score: r.total_score === null || r.total_score === undefined ? null : Number(r.total_score),
        tier: r.tier ?? null,
        scored_at: r.scored_at ?? null,
        review_status: r.admin_review_status ?? null,
        flags: Array.isArray(parsed) ? parsed : [],
        // The six, in the rubric's order, so the page never re-derives it.
        dimensions: RUBRIC.map((dim) => ({
          key: dim.key,
          total: r[`${dim.key}_total`] === null || r[`${dim.key}_total`] === undefined
            ? null : Number(r[`${dim.key}_total`]),
        })),
      };
    });

    const withScore = list.filter((r) => r.total_score !== null);
    scored = {
      available: true,
      total_deals: list.length,
      scored_deals: withScore.length,
      unscored_deals: list.length - withScore.length,
      rows: list,
      // Said outright: a rehearsal must not move the desk's numbers.
      sandbox_excluded: true,
      sandbox_note: 'Sandbox snapshots are practice runs and are excluded. A rehearsal is not a screening result.',
    };

    const flagged = withScore.filter((r) => r.review_status === 'flagged');
    const bySeverity: Record<string, number> = {};
    for (const r of flagged) {
      for (const f of r.flags) {
        const key = String(f?.severity || 'unrecorded');
        bySeverity[key] = (bySeverity[key] || 0) + 1;
      }
    }
    flags = {
      available: true,
      open: flagged.length,
      by_severity: bySeverity,
      rows: flagged.map((r) => ({
        deal_id: r.deal_id, company: r.company, tier: r.tier,
        total_score: r.total_score, flags: r.flags,
      })),
    };
  } catch {
    scored = { available: false, reason: 'The score history could not be read.' };
    flags = { available: false, reason: 'The score history could not be read, so open flags cannot be counted.' };
  }
  await sql.end();

  return c.json({
    scored,
    flags,
    rubric: {
      available: true,
      dimensions: RUBRIC,
      // The dimensions are real and the WEIGHTS are not editable — two
      // different facts, and collapsing them into "no rubric is stored" is
      // what the ops row did.
      editable: false,
      editable_reason:
        'The six dimensions and their weights are fixed in services/scoring.ts. Nothing stores a per-firm '
        + 'rubric, so there is no weighting to edit — a rubric editor would write to a table that does not exist.',
    },
    // The one thing on this artboard with no store at all.
    red_flag_rules_available: false,
    red_flag_rules_reason:
      'Flags come from fixed heuristics in services/scoreIntegrity.ts — a jump in inputs, a jump against '
      + 'practice runs — and carry a type and a severity. No rule is written by a person and none can be, so '
      + 'the rules editor the artboard draws would be a screen over a table nobody has.',
    ...DEAL_METRIC_UNAVAILABLE,
  });
});

deals.post('/', async (c) => {
  const user = await requireAuth(c);
  const data = await c.req.json();
  await ensureDealPassSchema(c.env);
  const sql = getSQL(c.env);
  const p = await sql`SELECT id, founder_id FROM projects WHERE id = ${data.project_id}`;
  if (p.length === 0) { await sql.end(); return c.json({ error: 'Project not found' }, 404); }
  // IDOR guard: founders may only create deals against their own project.
  if (!canAccessFounderResource(user, (p[0] as any).founder_id)) {
    await sql.end();
    return c.json({ error: 'Forbidden' }, 403);
  }
  // D463 — where the deal came from. Free text: the source taxonomy is the
  // owner's call, and a CHECK written before it would enshrine a guess.
  const source = data.source != null ? String(data.source).trim().slice(0, 120) || null : null;
  const [deal] = await sql`INSERT INTO deals (project_id, partner_id, status, notes, amount, stage_changed_at, source) VALUES (${data.project_id}, ${data.partner_id || null}, ${data.status || 'applied'}, ${data.notes || null}, ${data.amount || null}, datetime('now'), ${source}) RETURNING *`;
  // Task #127 — the deal's arrival is its first stage entry. Without this the
  // funnel can measure conversion OUT of the first stage but never has a
  // cohort that entered it, so the first column reads 0 forever.
  await recordStageEvent(sql, {
    dealId: Number((deal as any)?.id),
    fromStage: null,
    fromStageChangedAt: null,
    toStage: String((deal as any)?.status || 'applied'),
    kind: 'set',
    actorUserId: (user as any)?.id ?? null,
  });
  await sql.end();
  return c.json(deal, 201);
});

// ---------------------------------------------------------------------------
// Task #4 — Admin-only "Draft Deal": create a fully-specified deal.
// ---------------------------------------------------------------------------
deals.post('/draft', async (c) => {
  const user = await requireAdmin(c);
  const data = await c.req.json();
  await ensureDealPassSchema(c.env);
  const sql = getSQL(c.env);
  const p = await sql`SELECT id FROM projects WHERE id = ${data.project_id}`;
  if (p.length === 0) { await sql.end(); return c.json({ error: 'Project not found' }, 404); }
  // Task #127 — a deal may not be BORN passed. Drafting straight into the
  // terminal stage was the third door into 'rejected' with no reason attached;
  // the pass route is the only one, so draft it and then pass it. The UI never
  // offered this (its select lists pipeline stages only), so nothing regresses.
  if (String(data.status) === PASSED_STATUS) {
    await sql.end();
    return c.json({
      detail: 'Draft the deal in a pipeline stage, then record the pass through POST /api/deals/:id/pass — a reason is required.',
    }, 400);
  }
  const status = PIPELINE.includes(data.status) ? data.status : 'applied';
  // D463 — the source is recorded at draft. Free text: the taxonomy is the
  // owner's call (which sources exist, and which count as the Lab).
  const source = data.source != null ? String(data.source).trim().slice(0, 120) || null : null;
  const [deal] = await sql`
    INSERT INTO deals (
      project_id, partner_id, lead_partner_id, status, notes, description, website,
      amount, target_raise, minimum_check, valuation_cap, carry_pct, management_fee_pct,
      instrument, spv_jurisdiction, closing_deadline, capital_committed, stage_changed_at, source
    ) VALUES (
      ${data.project_id}, ${data.partner_id || null}, ${data.lead_partner_id || null}, ${status},
      ${data.notes || null}, ${data.description || null}, ${data.website || null},
      ${data.amount ?? null}, ${data.target_raise ?? null}, ${data.minimum_check ?? null},
      ${data.valuation_cap ?? null}, ${data.carry_pct ?? null}, ${data.management_fee_pct ?? null},
      ${data.instrument || null}, ${data.spv_jurisdiction || null}, ${data.closing_deadline || null},
      0, datetime('now'), ${source}
    ) RETURNING *`;
  await recordStageEvent(sql, {
    dealId: Number((deal as any)?.id),
    fromStage: null,
    fromStageChangedAt: null,
    toStage: String((deal as any)?.status || 'applied'),
    kind: 'set',
    actorUserId: (user as any)?.id ?? null,
  });
  await sql.end();
  return c.json(enrichDeal(deal), 201);
});

// ---------------------------------------------------------------------------
// Task #4 — Pickers for the admin forms.
// ---------------------------------------------------------------------------
deals.get('/lead-partners', async (c) => {
  await requireRole(c, 'partner');
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id, name, email, role FROM users WHERE role IN ('admin', 'partner') AND is_active = 1 ORDER BY name`;
  await sql.end();
  return c.json(rows);
});

deals.get('/investors', async (c) => {
  await requireAdmin(c);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id, name, email FROM users WHERE role = 'investor' AND is_active = 1 ORDER BY name`;
  await sql.end();
  return c.json(rows);
});

// ---------------------------------------------------------------------------
// Task #4 — Investor's own invitation inbox. MUST precede /:id.
// ---------------------------------------------------------------------------
deals.get('/invitations/mine', async (c) => {
  await requireRole(c, 'investor');
  const user = await requireAuth(c);
  const sql = getSQL(c.env);
  const rows = await sql`
    SELECT di.id, di.uid, di.deal_id, di.status, di.message, di.created_at, di.responded_at,
           p.name AS project_name, d.status AS deal_status
    FROM deal_invitations di
    LEFT JOIN deals d ON d.id = di.deal_id
    LEFT JOIN projects p ON p.id = d.project_id
    WHERE di.investor_user_id = ${user.id}
    ORDER BY di.created_at DESC`;
  await sql.end();
  return c.json(rows);
});

// D462 — every recorded transfer this caller may read, in one list. The
// Closing zone's Wires view reads it rather than N per-deal calls. An
// investor sees the transfers on deals they were invited to or committed to
// (the same predicate as scope=mine); a partner or admin sees what was
// recorded. Registered before `/:id` so the literal is not read as an id.
deals.get('/transfers', async (c) => {
  const user = await requireAuth(c);
  if (!isPrivilegedRole(user.role as string)) return c.json({ detail: 'Forbidden' }, 403);
  const sql = getSQL(c.env);
  // The column list is written out in both branches rather than interpolated:
  // this file's `sql` tag binds every ${} as a VALUE, so a column list must
  // never travel through it.
  const rows = String(user.role) === 'investor'
    ? await sql`
      SELECT t.uid, t.deal_id, t.amount_cents, t.reference, t.phone_verified, t.note,
             t.recorded_by, t.recorded_at, u.name AS recorded_by_name, p.name AS project_name
        FROM deal_transfers t
        LEFT JOIN users u ON u.id = t.recorded_by
        LEFT JOIN deals d ON d.id = t.deal_id
        LEFT JOIN projects p ON p.id = d.project_id
       WHERE t.deal_id IN (
         SELECT deal_id FROM deal_invitations WHERE investor_user_id = ${user.id}
         UNION SELECT deal_id FROM commitments WHERE investor_user_id = ${user.id}
       )
       ORDER BY t.recorded_at DESC LIMIT 500`
    : await sql`
      SELECT t.uid, t.deal_id, t.amount_cents, t.reference, t.phone_verified, t.note,
             t.recorded_by, t.recorded_at, u.name AS recorded_by_name, p.name AS project_name
        FROM deal_transfers t
        LEFT JOIN users u ON u.id = t.recorded_by
        LEFT JOIN deals d ON d.id = t.deal_id
        LEFT JOIN projects p ON p.id = d.project_id
       ORDER BY t.recorded_at DESC LIMIT 500`;
  await sql.end();
  return c.json({ items: rows });
});

deals.get('/:id', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  const sql = getSQL(c.env);
  const rows = await sql`SELECT d.*, p.name as project_name, p.sector as project_sector, p.founder_id as project_founder_id, pr.name as partner_name, lp.name as lead_partner_name, f.id as founder_user_id FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN partners pr ON d.partner_id = pr.id LEFT JOIN users lp ON lp.id = d.lead_partner_id LEFT JOIN users f ON f.founder_id = p.founder_id WHERE d.id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Deal not found' }, 404); }
  if (!(await canReadDeal(sql, user, id, (rows[0] as any).project_founder_id))) {
    await sql.end();
    return c.json({ detail: 'Forbidden: you do not own this deal' }, 403);
  }
  await sql.end();
  return c.json(enrichDeal(rows[0]));
});

deals.put('/:id', async (c) => {
  // Task #4 — deal mutation is an operator (partner/admin) action; investors
  // are limited to commitments + invitation responses.
  const user = await requireRole(c, 'partner');
  const id = parseInt(c.req.param('id'));
  const data = await c.req.json();
  await ensureDealPassSchema(c.env);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id, status, stage_changed_at FROM deals WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Deal not found' }, 404); }

  if (data.status !== undefined) {
    if (!DEAL_STATUSES.includes(String(data.status))) {
      await sql.end();
      return c.json({ detail: `Unknown deal status '${data.status}'` }, 400);
    }
    // Task #127 — a pass may not be recorded through this route.
    //
    // This is the load-bearing half of the taxonomy. Requiring a reason on
    // POST /:id/pass achieves nothing while a plain status write still reaches
    // the same terminal state with no reason attached: the reason becomes
    // optional in practice and the aggregate silently fills with blanks. One
    // door, and it asks the question.
    if (String(data.status) === PASSED_STATUS) {
      await sql.end();
      return c.json({
        detail: 'Record a pass through POST /api/deals/:id/pass — a reason is required.',
      }, 400);
    }
  }

  // Task #4 — maintain stage_changed_at whenever the pipeline stage moves.
  if (data.status) {
    const prev = rows[0] as any;
    // Recorded BEFORE the update: the update overwrites stage_changed_at, so
    // reading it afterwards measures zero days for every transition.
    await recordStageEvent(sql, {
      dealId: id,
      fromStage: prev.status ?? null,
      fromStageChangedAt: prev.stage_changed_at ?? null,
      toStage: String(data.status),
      kind: 'set',
      actorUserId: (user as any)?.id ?? null,
    });
    await sql`UPDATE deals SET status = ${data.status}, stage_changed_at = datetime('now'), updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  }
  if (data.partner_id !== undefined) await sql`UPDATE deals SET partner_id = ${data.partner_id}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  if (data.notes !== undefined) await sql`UPDATE deals SET notes = ${data.notes}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  if (data.amount !== undefined) await sql`UPDATE deals SET amount = ${data.amount}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  // D463 — the terms are editable after the draft, by the same operator the
  // draft admitted. A deal's terms change in negotiation; a store that only
  // writes them at birth freezes the first answer as the permanent one. Each
  // field is written only when the key is present, so a partial edit cannot
  // blank a term it did not send.
  if (data.lead_partner_id !== undefined) await sql`UPDATE deals SET lead_partner_id = ${data.lead_partner_id || null}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  if (data.target_raise !== undefined) await sql`UPDATE deals SET target_raise = ${data.target_raise ?? null}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  if (data.minimum_check !== undefined) await sql`UPDATE deals SET minimum_check = ${data.minimum_check ?? null}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  if (data.valuation_cap !== undefined) await sql`UPDATE deals SET valuation_cap = ${data.valuation_cap ?? null}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  if (data.carry_pct !== undefined) await sql`UPDATE deals SET carry_pct = ${data.carry_pct ?? null}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  if (data.management_fee_pct !== undefined) await sql`UPDATE deals SET management_fee_pct = ${data.management_fee_pct ?? null}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  if (data.instrument !== undefined) await sql`UPDATE deals SET instrument = ${data.instrument ? String(data.instrument).slice(0, 120) : null}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  if (data.spv_jurisdiction !== undefined) await sql`UPDATE deals SET spv_jurisdiction = ${data.spv_jurisdiction ? String(data.spv_jurisdiction).slice(0, 120) : null}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  if (data.closing_deadline !== undefined) await sql`UPDATE deals SET closing_deadline = ${data.closing_deadline ? String(data.closing_deadline).slice(0, 40) : null}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  if (data.website !== undefined) await sql`UPDATE deals SET website = ${data.website ? String(data.website).slice(0, 300) : null}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  if (data.description !== undefined) await sql`UPDATE deals SET description = ${data.description ? String(data.description).slice(0, 20000) : null}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  // The source is free text for the same reason it is at draft: the taxonomy
  // is the owner's call.
  if (data.source !== undefined) await sql`UPDATE deals SET source = ${data.source ? String(data.source).trim().slice(0, 120) : null}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;

  const [updated] = await sql`SELECT d.*, p.name as project_name, p.sector as project_sector, pr.name as partner_name, lp.name as lead_partner_name FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN partners pr ON d.partner_id = pr.id LEFT JOIN users lp ON lp.id = d.lead_partner_id WHERE d.id = ${id}`;

  // Phase 0.2 notify — surface stage changes to the founder behind the project.
  try {
    if (data.status) {
      const own = await sql`
        SELECT f.id AS founder_user_id, p.name AS project_name
        FROM deals d
        LEFT JOIN projects p ON p.id = d.project_id
        LEFT JOIN users f ON f.founder_id = p.founder_id
        WHERE d.id = ${id}
      `;
      const founderUserId = own[0]?.founder_user_id;
      const projectName = own[0]?.project_name || 'your project';
      if (founderUserId) {
        const { notify } = await import('../services/notify');
        await notify(c.env, {
          userId: founderUserId,
          type: 'deal_stage_change',
          title: `${projectName}: deal stage → ${data.status}`,
          body: 'A partner updated the deal stage on your project.',
          link: '/deals',
          payload: { deal_id: updated.id, status: updated.status },
          channels: ['in_app', 'email', 'slack'],
          category: 'deal_stage_change',
        });
      }
    }
  } catch (e) { console.warn('[deals] notify deal_stage_change failed', e); }

  // Task #2 — best-effort HubSpot sync on stage change. Resolve the
  // founder's user_id from the deal, then hand off to `schedulePush` which
  // fires the push on executionCtx.waitUntil AND writes an
  // integration_logs row so "View logs" reflects every background push.
  if (data.status) {
    try {
      const own2 = (await sql`
        SELECT f.id AS founder_user_id
        FROM deals d
        LEFT JOIN projects p ON p.id = d.project_id
        LEFT JOIN users f ON f.founder_id = p.founder_id
        WHERE d.id = ${id}
      `) as Array<{ founder_user_id: number | null }>;
      const founderUserId = own2[0]?.founder_user_id ?? null;
      if (founderUserId) {
        const founderUser: User = { id: founderUserId } as User;
        schedulePush({
          c, user: founderUser, providerKey: 'hubspot',
          payload: { deal_id: id },
          eventType: 'auto_push:deal_stage_change',
        });
        // Task #4 — mirror to Salesforce when active. Same payload shape.
        schedulePush({
          c, user: founderUser, providerKey: 'salesforce',
          payload: { deal_id: id },
          eventType: 'auto_push:deal_stage_change',
        });
      }
    } catch (e) { console.warn('[deals] crm stage-change hook failed', e); }
  }

  await sql.end();
  return c.json(enrichDeal(updated));
});

// ---------------------------------------------------------------------------
// Task #4 — Advance a deal to the next pipeline stage (operator action).
// ---------------------------------------------------------------------------
deals.post('/:id/advance', async (c) => {
  const user = await requireRole(c, 'partner');
  const id = parseInt(c.req.param('id'));
  await ensureDealPassSchema(c.env);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT status, stage_changed_at FROM deals WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Deal not found' }, 404); }
  const cur = String((rows[0] as any).status);
  const idx = PIPELINE.indexOf(cur);
  if (idx < 0 || idx >= PIPELINE.length - 1) {
    await sql.end();
    return c.json({ detail: 'Deal cannot advance further' }, 400);
  }
  const next = PIPELINE[idx + 1];
  // Task #127 — recorded BEFORE the update, which overwrites stage_changed_at
  // and would otherwise report every stage as zero days long.
  await recordStageEvent(sql, {
    dealId: id,
    fromStage: cur,
    fromStageChangedAt: (rows[0] as any).stage_changed_at ?? null,
    toStage: next,
    kind: 'advance',
    actorUserId: (user as any)?.id ?? null,
  });
  await sql`UPDATE deals SET status = ${next}, stage_changed_at = datetime('now'), updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  const [updated] = await sql`SELECT d.*, p.name as project_name, p.sector as project_sector, lp.name as lead_partner_name FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN users lp ON lp.id = d.lead_partner_id WHERE d.id = ${id}`;

  // Notify the owning founder about the stage change.
  try {
    const own = await sql`SELECT f.id AS founder_user_id, p.name AS project_name FROM deals d LEFT JOIN projects p ON p.id = d.project_id LEFT JOIN users f ON f.founder_id = p.founder_id WHERE d.id = ${id}`;
    const founderUserId = (own[0] as any)?.founder_user_id;
    if (founderUserId) {
      const { notify } = await import('../services/notify');
      await notify(c.env, {
        userId: founderUserId,
        type: 'deal_stage_change',
        title: `${(own[0] as any)?.project_name || 'Your project'}: deal stage → ${next}`,
        body: 'A partner advanced the deal stage on your project.',
        link: `/deals/${id}`,
        payload: { deal_id: id, status: next },
        channels: ['in_app', 'email', 'slack'],
        category: 'deal_stage_change',
      });
    }
  } catch (e) { console.warn('[deals] advance notify failed', e); }

  await sql.end();
  return c.json(enrichDeal(updated));
});

// ---------------------------------------------------------------------------
// Task #127 — Pass. The only route that writes the terminal stage.
// ---------------------------------------------------------------------------
deals.post('/:id/pass', async (c) => {
  const user = await requireRole(c, 'partner');
  const id = parseInt(c.req.param('id'));
  const body = await c.req.json().catch(() => ({} as any));
  const reason = (body as any)?.reason;

  // Validated before the row is read, and before anything is written. A pass
  // is not a state the platform should be able to reach while the operator is
  // still deciding why — that is how the "why" ends up empty.
  if (!isPassReason(reason)) {
    return c.json({
      detail: 'A pass requires a reason from the taxonomy.',
      allowed: [...PASS_REASON_KEYS],
    }, 400);
  }
  const note = typeof (body as any)?.note === 'string' ? (body as any).note.trim() : '';

  await ensureDealPassSchema(c.env);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT status, stage_changed_at FROM deals WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Deal not found' }, 404); }
  const cur = String((rows[0] as any).status);
  if (cur === PASSED_STATUS) {
    await sql.end();
    // Not an error worth a 500 and not silently idempotent either: passing a
    // passed deal a second time would overwrite the first reason, which is the
    // record this whole route exists to protect.
    return c.json({ detail: 'This deal has already been passed.' }, 409);
  }

  // Recorded BEFORE the update — stage_changed_at is about to be overwritten.
  await recordStageEvent(sql, {
    dealId: id,
    fromStage: cur,
    fromStageChangedAt: (rows[0] as any).stage_changed_at ?? null,
    toStage: PASSED_STATUS,
    kind: 'pass',
    actorUserId: (user as any)?.id ?? null,
  });

  await sql`
    UPDATE deals
       SET status = ${PASSED_STATUS},
           pass_reason = ${reason},
           pass_note = ${note || null},
           passed_at = datetime('now'),
           passed_by_user_id = ${(user as any)?.id ?? null},
           stage_changed_at = datetime('now'),
           updated_at = CURRENT_TIMESTAMP
     WHERE id = ${id}`;

  const [updated] = await sql`SELECT d.*, p.name as project_name, p.sector as project_sector, lp.name as lead_partner_name FROM deals d LEFT JOIN projects p ON d.project_id = p.id LEFT JOIN users lp ON lp.id = d.lead_partner_id WHERE d.id = ${id}`;

  // The founder is told the outcome, never the internal reason. The taxonomy
  // is the fund's own shorthand — "Team" delivered as a notification is a
  // judgement the operator did not choose to send, and the note is written for
  // an investment committee, not for the company.
  try {
    const own = await sql`SELECT f.id AS founder_user_id, p.name AS project_name FROM deals d LEFT JOIN projects p ON p.id = d.project_id LEFT JOIN users f ON f.founder_id = p.founder_id WHERE d.id = ${id}`;
    const founderUserId = (own[0] as any)?.founder_user_id;
    if (founderUserId) {
      const { notify } = await import('../services/notify');
      await notify(c.env, {
        userId: founderUserId,
        type: 'deal_stage_change',
        title: `${(own[0] as any)?.project_name || 'Your project'}: the fund has passed`,
        body: 'A partner closed this deal. Your partner contact can talk you through it.',
        link: `/deals/${id}`,
        payload: { deal_id: id, status: PASSED_STATUS },
        channels: ['in_app', 'email'],
        category: 'deal_stage_change',
      });
    }
  } catch (e) { console.warn('[deals] pass notify failed', e); }

  await sql.end();
  return c.json({ ...enrichDeal(updated), pass_reason_label: passReasonLabel(reason) });
});

// ---------------------------------------------------------------------------
// Task #4 — Deal Room: documents, data-room zip, commitments, activity.
// ---------------------------------------------------------------------------
type ReadCtx =
  | { error: Response; user?: undefined; sql?: undefined; deal?: undefined }
  | { error?: undefined; user: User; sql: ReturnType<typeof getSQL>; deal: any };

// Deal-room read authorization, kept in lockstep with the FastAPI
// `_ensure_deal_read_access` helper:
// - admin/partner: full access (studio-wide staff)
// - founder: only their own project (canAccessFounderResource)
// - investor: relationship-gated — invited to this deal OR holds a commitment.
//   Deal rooms carry UNMASKED founder data, so investors get NO blanket access
//   (2026-06-25 audit). NOTE: the predicate is intentionally invited-OR-committed
//   and does NOT include investor_dealroom_members, because Postgres (the dev
//   backend) has no such table — the two backends must decide identically.
async function investorHasDealRelationship(sql: any, userId: number, dealId: number): Promise<boolean> {
  const inv = await sql`SELECT 1 AS x FROM deal_invitations WHERE deal_id = ${dealId} AND investor_user_id = ${userId} LIMIT 1`;
  if (inv.length) return true;
  const com = await sql`SELECT 1 AS x FROM commitments WHERE deal_id = ${dealId} AND investor_user_id = ${userId} LIMIT 1`;
  return com.length > 0;
}

async function canReadDeal(sql: any, user: User, dealId: number, projectFounderId: any): Promise<boolean> {
  if (canAccessFounderResource(user as any, projectFounderId)) return true;
  const role = String((user as any).role || '').toLowerCase();
  if (role === 'investor') return investorHasDealRelationship(sql, (user as any).id, dealId);
  return false;
}

async function loadDealForRead(c: any, id: number): Promise<ReadCtx> {
  const user = await requireAuth(c);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT d.*, p.name AS project_name, p.founder_id AS project_founder_id FROM deals d LEFT JOIN projects p ON d.project_id = p.id WHERE d.id = ${id}`;
  if (rows.length === 0) { await sql.end(); return { error: c.json({ error: 'Deal not found' }, 404) }; }
  if (!(await canReadDeal(sql, user, id, (rows[0] as any).project_founder_id))) {
    await sql.end();
    return { error: c.json({ detail: 'Forbidden: you do not own this deal' }, 403) };
  }
  return { user, sql, deal: rows[0] as any };
}

deals.get('/:id/documents', async (c) => {
  const id = parseInt(c.req.param('id'));
  const ctx = await loadDealForRead(c, id);
  if (ctx.error) return ctx.error;
  const { sql, deal } = ctx;
  if (!deal.project_id) { await sql.end(); return c.json([]); }
  const docs = await sql`SELECT id, uid, title, doc_type, status, created_at FROM documents WHERE project_id = ${deal.project_id} ORDER BY created_at DESC`;
  await sql.end();
  return c.json(docs);
});

deals.get('/:id/data-room', async (c) => {
  const id = parseInt(c.req.param('id'));
  const ctx = await loadDealForRead(c, id);
  if (ctx.error) return ctx.error;
  const { sql, deal } = ctx;
  const docs = deal.project_id
    ? await sql`SELECT id, title, content FROM documents WHERE project_id = ${deal.project_id} ORDER BY created_at DESC`
    : [];
  await sql.end();
  const entries = [{
    name: 'README.txt',
    content: [
      `Data Room — ${deal.project_name || 'Deal #' + id}`,
      `Stage: ${deal.status}`,
      `Documents: ${docs.length}`,
      `Exported: ${new Date().toISOString()}`,
    ].join('\n'),
  }];
  const seen = new Set<string>();
  for (const d of docs as any[]) {
    const base = String(d.title || `document_${d.id}`).replace(/[^a-zA-Z0-9 \-_.]/g, '_');
    let name = `${base}.txt`;
    let i = 1;
    while (seen.has(name)) { name = `${base}_${i++}.txt`; }
    seen.add(name);
    entries.push({ name, content: d.content || '(document stored externally — no inline content)' });
  }
  const zip = buildZip(entries);
  return new Response(zip, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="data-room-deal-${id}.zip"`,
    },
  });
});

deals.get('/:id/commitments', async (c) => {
  const id = parseInt(c.req.param('id'));
  const ctx = await loadDealForRead(c, id);
  if (ctx.error) return ctx.error;
  const { sql } = ctx;
  const rows = await sql`SELECT c.id, c.uid, c.deal_id, c.investor_user_id, c.amount, c.status, c.notes, c.created_at, u.name AS investor_name FROM commitments c LEFT JOIN users u ON u.id = c.investor_user_id WHERE c.deal_id = ${id} ORDER BY c.created_at DESC`;
  await sql.end();
  return c.json(rows);
});

deals.post('/:id/commitments', async (c) => {
  const user = await requireRole(c, 'investor');
  const id = parseInt(c.req.param('id'));
  const data = await c.req.json();
  const amount = Number(data.amount);
  if (!Number.isFinite(amount) || amount <= 0) return c.json({ detail: 'Commitment amount must be positive' }, 400);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id FROM deals WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Deal not found' }, 404); }
  // An investor must be invited to a deal before committing capital. This also
  // prevents self-granting deal-room read access by committing to any deal id.
  const invited = await sql`SELECT 1 AS x FROM deal_invitations WHERE deal_id = ${id} AND investor_user_id = ${user.id} LIMIT 1`;
  if (!invited.length) { await sql.end(); return c.json({ detail: 'You must be invited to this deal before committing capital' }, 403); }
  const [inserted] = await sql`INSERT INTO commitments (deal_id, investor_user_id, amount, status, notes) VALUES (${id}, ${user.id}, ${amount}, 'pending', ${data.notes || null}) RETURNING uid`;
  await sql`UPDATE deals SET capital_committed = COALESCE(capital_committed, 0) + ${amount}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  const [after] = await sql`SELECT capital_committed FROM deals WHERE id = ${id}`;

  // Notify the founder that capital was committed.
  try {
    const own = await sql`SELECT f.id AS founder_user_id FROM deals d LEFT JOIN projects p ON p.id = d.project_id LEFT JOIN users f ON f.founder_id = p.founder_id WHERE d.id = ${id}`;
    const founderUserId = (own[0] as any)?.founder_user_id;
    if (founderUserId) {
      const { notify } = await import('../services/notify');
      await notify(c.env, {
        userId: founderUserId,
        type: 'deal_commitment',
        title: 'New capital commitment',
        body: `${user.name} committed ${Math.round(amount).toLocaleString()} to your deal`,
        link: `/deals/${id}`,
        payload: { deal_id: id, amount },
        channels: ['in_app', 'email'],
        category: 'deals',
      });
    }
  } catch (e) { console.warn('[deals] commitment notify failed', e); }

  await sql.end();
  return c.json({ ok: true, uid: (inserted as any)?.uid, capital_committed: (after as any)?.capital_committed });
});

deals.get('/:id/activity', async (c) => {
  const id = parseInt(c.req.param('id'));
  const ctx = await loadDealForRead(c, id);
  if (ctx.error) return ctx.error;
  const { sql, deal } = ctx;
  const events: any[] = [];
  events.push({ type: 'created', label: 'Deal created', at: deal.created_at });
  if (deal.stage_changed_at) events.push({ type: 'stage', label: `Moved to ${deal.status}`, at: deal.stage_changed_at });
  const commits = await sql`SELECT c.amount, c.created_at, u.name AS investor_name FROM commitments c LEFT JOIN users u ON u.id = c.investor_user_id WHERE c.deal_id = ${id} ORDER BY c.created_at DESC`;
  for (const r of commits as any[]) {
    events.push({ type: 'commitment', label: `${r.investor_name || 'An investor'} committed ${Math.round(r.amount || 0).toLocaleString()}`, at: r.created_at });
  }
  const invites = await sql`SELECT di.status, di.created_at, di.responded_at, u.name AS investor_name FROM deal_invitations di LEFT JOIN users u ON u.id = di.investor_user_id WHERE di.deal_id = ${id} ORDER BY di.created_at DESC`;
  for (const r of invites as any[]) {
    events.push({
      type: 'invitation',
      label: `${r.investor_name || 'An investor'} invited${r.status !== 'invited' ? ` — ${r.status}` : ''}`,
      at: r.responded_at || r.created_at,
    });
  }
  await sql.end();
  events.sort((a, b) => (normTs(b.at) || 0) - (normTs(a.at) || 0));
  return c.json(events);
});

// ---------------------------------------------------------------------------
// D462 — the Closing stage's money and paper (migration 335).
//
// TRANSFERS. A transfer OUT to a company, recorded — the platform records the
// movement of money and does not move it. Money is integer cents. An OPEN IC
// condition on the deal (migration 334) refuses the write: that refusal is
// the whole reason the conditions store exists, and lifting it is marking the
// condition met or waived in the commit room, never an override here.
//
// THE CLOSING CHECKLIST. One per deal, applied from a `legal_templates` row
// (the SAFE, stock-purchase and subscription agreements are the closing
// paper). THE DEFAULT ITEM SET IS THE OWNER'S CALL: applying a template
// creates the checklist and items are added by hand until the owner names
// the defaults — the zone says so on screen rather than seeding a list
// nobody signed off.
// ---------------------------------------------------------------------------

/** The open-condition count on a deal — the wire's gate. */
async function openConditionsForDeal(env: any, dealId: number): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM ic_conditions cond
       JOIN ic_decisions d ON d.id = cond.ic_decision_id
      WHERE d.deal_id = ? AND cond.status = 'open'`
  ).bind(dealId).first().catch(() => null);
  return Number(row?.n) || 0;
}

deals.get('/:id/transfers', async (c) => {
  const id = parseInt(c.req.param('id'));
  const ctx = await loadDealForRead(c, id);
  if (ctx.error) return ctx.error;
  const { sql } = ctx;
  const rows = await sql`
    SELECT t.uid, t.deal_id, t.amount_cents, t.reference, t.phone_verified, t.note,
           t.recorded_by, t.recorded_at, u.name AS recorded_by_name
      FROM deal_transfers t LEFT JOIN users u ON u.id = t.recorded_by
     WHERE t.deal_id = ${id} ORDER BY t.recorded_at DESC`;
  await sql.end();
  return c.json({ items: rows });
});

deals.post('/:id/transfers', async (c) => {
  // Recording a transfer is an operator's act (partner/admin), like every
  // other deal mutation; the deal's investors read it.
  const user = await requireRole(c, 'partner');
  const id = parseInt(c.req.param('id'));
  const data = await c.req.json().catch(() => ({} as any));
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id FROM deals WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Deal not found' }, 404); }

  // THE GATE. An open condition refuses the transfer — a condition that lived
  // only in the minutes is a condition nobody enforces, and this is where it
  // is enforced.
  const open = await openConditionsForDeal(c.env, id);
  if (open > 0) {
    await sql.end();
    return c.json({
      error: 'open_conditions_block_transfer',
      message: `${open} open IC condition${open === 1 ? '' : 's'} on this deal. Resolve ${open === 1 ? 'it' : 'them'} in the commit room before recording a transfer.`,
      open_conditions: open,
    }, 409);
  }

  const amountCents = typeof data?.amount_cents === 'number' ? data.amount_cents : Number.NaN;
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    await sql.end();
    return c.json({
      error: 'transfer_amount_invalid',
      message: 'Record the amount in integer cents — the platform stores money as cents, never a float.',
    }, 400);
  }
  const reference = data?.reference != null ? String(data.reference).trim().slice(0, 200) || null : null;
  const note = data?.note != null ? String(data.note).trim().slice(0, 2000) || null : null;
  const phoneVerified = data?.phone_verified === true ? 1 : 0;
  const uid = newUid();
  const ins = await c.env.DB.prepare(
    `INSERT INTO deal_transfers (uid, deal_id, amount_cents, reference, phone_verified, note, recorded_by, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(uid, id, amountCents, reference, phoneVerified, note, user.id, nowIso()).run();
  await sql.end();
  const row = await c.env.DB.prepare(
    `SELECT t.*, u.name AS recorded_by_name FROM deal_transfers t LEFT JOIN users u ON u.id = t.recorded_by WHERE t.id = ?`
  ).bind((ins as any).meta?.last_row_id).first<any>();
  return c.json({ item: row }, 201);
});

/** The checklist a deal's closing runs on, with its items — or null. */
async function closingChecklistForDeal(env: any, dealId: number): Promise<any> {
  const list = await env.DB.prepare(
    'SELECT * FROM deal_closing_checklists WHERE deal_id = ?'
  ).bind(dealId).first();
  if (!list) return null;
  const items = await env.DB.prepare(
    `SELECT i.uid, i.label, i.state, i.note, i.sort, i.done_at, i.done_by, u.name AS done_by_name
       FROM deal_closing_checklist_items i LEFT JOIN users u ON u.id = i.done_by
      WHERE i.checklist_id = ? ORDER BY i.sort ASC, i.id ASC`
  ).bind(list.id).all();
  return { ...list, items: items.results || [] };
}

deals.get('/:id/closing-checklist', async (c) => {
  const id = parseInt(c.req.param('id'));
  const ctx = await loadDealForRead(c, id);
  if (ctx.error) return ctx.error;
  const { sql } = ctx;
  const list = await closingChecklistForDeal(c.env, id);
  await sql.end();
  // Absent is a state with a name, not a 404: the zone renders the
  // apply-template action over it.
  return c.json({ checklist: list });
});

// The closing paper the canvas names. Validated against legal_templates at
// apply time, so a retired template stops applying rather than erroring.
const CLOSING_TEMPLATE_SLUGS = new Set(['safe', 'spa', 'subscription']);

deals.post('/:id/closing-checklist/apply', async (c) => {
  const user = await requireRole(c, 'partner');
  const id = parseInt(c.req.param('id'));
  const data = await c.req.json().catch(() => ({} as any));
  const slug = String(data?.template_slug || '');
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id FROM deals WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Deal not found' }, 404); }
  if (!CLOSING_TEMPLATE_SLUGS.has(slug)) {
    await sql.end();
    return c.json({
      error: 'closing_template_unknown',
      message: 'A closing checklist applies one of the closing templates: the SAFE, the stock purchase agreement, or the subscription agreement.',
    }, 400);
  }
  const template = await c.env.DB.prepare(
    'SELECT slug, title, is_active FROM legal_templates WHERE slug = ?'
  ).bind(slug).first<any>();
  if (!template || !template.is_active) {
    await sql.end();
    return c.json({
      error: 'closing_template_inactive',
      message: 'That template is not active in the legal library.',
    }, 400);
  }
  const existing = await c.env.DB.prepare(
    'SELECT uid FROM deal_closing_checklists WHERE deal_id = ?'
  ).bind(id).first<any>();
  if (existing) {
    await sql.end();
    return c.json({
      error: 'closing_checklist_exists',
      message: 'This deal already has a closing checklist. Add items to it rather than applying a second template.',
    }, 409);
  }
  // No default items are seeded: the default set is the owner's call, and the
  // zone says so beside the empty checklist rather than inventing one.
  await c.env.DB.prepare(
    'INSERT INTO deal_closing_checklists (uid, deal_id, template_slug, applied_by, applied_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(newUid(), id, slug, user.id, nowIso()).run();
  await sql.end();
  return c.json({ checklist: await closingChecklistForDeal(c.env, id) }, 201);
});

deals.post('/:id/closing-checklist/items', async (c) => {
  await requireRole(c, 'partner');
  const id = parseInt(c.req.param('id'));
  const data = await c.req.json().catch(() => ({} as any));
  const label = data?.label != null ? String(data.label).trim().slice(0, 300) : '';
  if (!label) {
    return c.json({
      error: 'checklist_item_label_required',
      message: 'A checklist item is the thing counsel checks — name it.',
    }, 400);
  }
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id FROM deals WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Deal not found' }, 404); }
  const list = await c.env.DB.prepare('SELECT id FROM deal_closing_checklists WHERE deal_id = ?').bind(id).first<any>();
  if (!list) {
    await sql.end();
    return c.json({
      error: 'closing_checklist_missing',
      message: 'Apply a closing template first — the checklist it creates is what items attach to.',
    }, 400);
  }
  const sort = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(sort), 0) + 1 AS next FROM deal_closing_checklist_items WHERE checklist_id = ?'
  ).bind(list.id).first<{ next: number }>();
  await c.env.DB.prepare(
    'INSERT INTO deal_closing_checklist_items (uid, checklist_id, label, state, sort, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(newUid(), list.id, label, 'pending', sort?.next || 1, nowIso()).run();
  await sql.end();
  return c.json({ checklist: await closingChecklistForDeal(c.env, id) }, 201);
});

deals.patch('/:id/closing-checklist/items/:itemUid', async (c) => {
  const user = await requireRole(c, 'partner');
  const id = parseInt(c.req.param('id'));
  const itemUid = c.req.param('itemUid');
  const data = await c.req.json().catch(() => ({} as any));
  const state = String(data?.state || '');
  if (!['pending', 'done', 'blocked', 'skipped'].includes(state)) {
    return c.json({
      error: 'checklist_item_state_invalid',
      message: 'A checklist item is pending, done, blocked or skipped.',
    }, 400);
  }
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id FROM deals WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Deal not found' }, 404); }
  const item = await c.env.DB.prepare(
    `SELECT i.id, i.checklist_id FROM deal_closing_checklist_items i
       JOIN deal_closing_checklists l ON l.id = i.checklist_id
      WHERE i.uid = ? AND l.deal_id = ?`
  ).bind(itemUid, id).first<any>();
  if (!item) { await sql.end(); return c.json({ error: 'Item not found' }, 404); }
  const note = data?.note !== undefined ? (data.note != null ? String(data.note).slice(0, 2000) : null) : undefined;
  const done = state === 'done';
  // Two static statements rather than a conditional fragment: every value is
  // bound, and the query text never carries an interpolation.
  if (note !== undefined) {
    await c.env.DB.prepare(
      'UPDATE deal_closing_checklist_items SET state = ?, done_by = ?, done_at = ?, note = ? WHERE id = ?'
    ).bind(state, done ? user.id : null, done ? nowIso() : null, note, item.id).run();
  } else {
    await c.env.DB.prepare(
      'UPDATE deal_closing_checklist_items SET state = ?, done_by = ?, done_at = ? WHERE id = ?'
    ).bind(state, done ? user.id : null, done ? nowIso() : null, item.id).run();
  }
  await sql.end();
  return c.json({ checklist: await closingChecklistForDeal(c.env, id) });
});

// ---------------------------------------------------------------------------
// Task #4 — Invitations (admin issue/list, investor respond).
// ---------------------------------------------------------------------------
deals.get('/:id/invitations', async (c) => {
  await requireAdmin(c);
  const id = parseInt(c.req.param('id'));
  const sql = getSQL(c.env);
  const rows = await sql`SELECT di.id, di.uid, di.deal_id, di.investor_user_id, di.status, di.message, di.email_opt_in, di.created_at, di.responded_at, u.name AS investor_name, u.email AS investor_email FROM deal_invitations di LEFT JOIN users u ON u.id = di.investor_user_id WHERE di.deal_id = ${id} ORDER BY di.created_at DESC`;
  await sql.end();
  return c.json(rows);
});

deals.post('/:id/invitations', async (c) => {
  const admin = await requireAdmin(c);
  const id = parseInt(c.req.param('id'));
  const data = await c.req.json();
  const sql = getSQL(c.env);
  const rows = await sql`SELECT d.status, p.name AS project_name FROM deals d LEFT JOIN projects p ON p.id = d.project_id WHERE d.id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Deal not found' }, 404); }
  const status = String((rows[0] as any).status);
  if (status !== 'active' && status !== 'scored') {
    await sql.end();
    return c.json({ detail: 'Investors can only be invited to Active or Scored deals' }, 400);
  }
  const company = (rows[0] as any).project_name || `Deal #${id}`;
  const ids: number[] = Array.isArray(data.investor_user_ids) ? data.investor_user_ids : [];
  const sendEmail = !!data.send_email;
  let created = 0;
  for (const iid of ids) {
    const u = await sql`SELECT id, role FROM users WHERE id = ${iid}`;
    if (u.length === 0 || String((u[0] as any).role) !== 'investor') continue;
    let inserted: any[] = [];
    try {
      inserted = await sql`INSERT INTO deal_invitations (deal_id, investor_user_id, invited_by_user_id, message, email_opt_in, status) VALUES (${id}, ${iid}, ${admin.id}, ${data.message || null}, ${sendEmail ? 1 : 0}, 'invited') ON CONFLICT (deal_id, investor_user_id) DO NOTHING RETURNING id`;
    } catch { continue; }
    // Duplicate invite (ON CONFLICT no-op) — don't double-count or re-notify.
    if (!inserted.length) continue;
    created++;
    try {
      const { notify } = await import('../services/notify');
      await notify(c.env, {
        userId: iid,
        type: 'deal_invitation',
        title: `You're invited to review ${company}`,
        body: data.message || `${admin.name} invited you to review a deal.`,
        link: `/deals/${id}`,
        payload: { deal_id: id },
        channels: sendEmail ? ['in_app', 'email'] : ['in_app'],
        category: 'deals',
      });
    } catch (e) { console.warn('[deals] invitation notify failed', e); }
  }
  await sql.end();
  return c.json({ ok: true, invited: created });
});

deals.post('/:id/invitations/respond', async (c) => {
  const user = await requireRole(c, 'investor');
  const id = parseInt(c.req.param('id'));
  const data = await c.req.json();
  const resp = data.response;
  if (resp !== 'interested' && resp !== 'passed') return c.json({ detail: "response must be 'interested' or 'passed'" }, 400);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id, invited_by_user_id FROM deal_invitations WHERE deal_id = ${id} AND investor_user_id = ${user.id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'No invitation found for this deal' }, 404); }
  await sql`UPDATE deal_invitations SET status = ${resp}, responded_at = datetime('now') WHERE deal_id = ${id} AND investor_user_id = ${user.id}`;

  try {
    const inviter = (rows[0] as any).invited_by_user_id;
    if (inviter) {
      const { notify } = await import('../services/notify');
      await notify(c.env, {
        userId: inviter,
        type: 'deal_invitation_response',
        title: `${user.name} is ${resp} in a deal`,
        body: `${user.name} responded '${resp}' to your invitation.`,
        link: `/deals/${id}`,
        payload: { deal_id: id, response: resp },
        channels: ['in_app'],
        category: 'deals',
      });
    }
  } catch (e) { console.warn('[deals] invitation response notify failed', e); }

  await sql.end();
  return c.json({ ok: true, status: resp });
});

// ---------------------------------------------------------------------------
// Task #6 (W-1) — Investor dealroom membership with per-tier cap.
// Free      — 1 dealroom
// Professional — 5 dealrooms
// Institutional — unlimited (1_000_000 sentinel)
// On overflow returns 402 with code:'quota_dealrooms_exhausted' so the
// frontend can show the upgrade modal.
// ---------------------------------------------------------------------------
import {
  ensureInvestorPaywallSchema,
  effectiveInvestorTier,
  INVESTOR_QUOTAS,
  type InvestorUser,
} from '../middleware/requireInvestorTier';

// Bypass roles can join any number of dealrooms — they're acting in an
// admin/partner/advisor capacity and never count against an investor cap.
const DEALROOM_BYPASS_ROLES = new Set<string>(['admin', 'partner', 'advisor']);

deals.post('/:id/dealroom/join', async (c) => {
  const user = (await requireAuth(c)) as InvestorUser;
  await ensureInvestorPaywallSchema(c.env);
  const isBypass = DEALROOM_BYPASS_ROLES.has(String(user.role));
  if (user.role !== 'investor' && !isBypass) {
    return c.json({ error: 'investor_only' }, 403);
  }
  const dealId = Number(c.req.param('id'));
  if (!Number.isFinite(dealId)) return c.json({ error: 'bad_id' }, 400);

  // Idempotent join — if already a member, just return ok.
  const existing = await c.env.DB.prepare(
    `SELECT 1 AS x FROM investor_dealroom_members
     WHERE investor_user_id = ? AND deal_id = ?`
  ).bind(user.id, dealId).first<{ x: number }>();
  if (existing) return c.json({ ok: true, already_member: true });

  const tier = effectiveInvestorTier(user);
  // Task #24 — cap is sourced from `users.investor_dealroom_max` (the
  // canonical column written by the Stripe webhook + dev-upgrade
  // helpers + admin-grant codepaths). The billing webhook bumps that
  // column to 1_000_000 when a user becomes Institutional, so reading
  // the column directly guarantees Institutional users are never
  // gated even if the tier-derived default in INVESTOR_QUOTAS drifts
  // out of sync. Falls back to the tier default when the column is
  // null (e.g. legacy rows that pre-date 027_investor_paywall.sql and
  // somehow escaped the schema-bootstrap default of 5).
  const colCap = (user as { investor_dealroom_max?: number | null }).investor_dealroom_max;
  const tierCap = INVESTOR_QUOTAS[tier].dealroom_max;
  const cap = isBypass
    ? Number.POSITIVE_INFINITY
    : (Number.isFinite(colCap as number) && (colCap as number) > 0 ? Number(colCap) : tierCap);
  const cnt = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM investor_dealroom_members WHERE investor_user_id = ?`
  ).bind(user.id).first<{ n: number }>();
  const used = Number(cnt?.n ?? 0);
  if (used >= cap) {
    return c.json(
      {
        error: 'quota_exceeded',
        code: 'quota_dealrooms_exhausted',
        message: `You have joined the maximum of ${cap} dealroom${cap === 1 ? '' : 's'} on the ${tier} plan.`,
        used,
        cap,
        tier,
        upgrade_to: tier === 'free' ? 'professional' : 'institutional',
        checkout_path: '/api/billing/investor/checkout',
      },
      402,
    );
  }
  try {
    await c.env.DB.prepare(
      `INSERT INTO investor_dealroom_members (investor_user_id, deal_id) VALUES (?, ?)`
    ).bind(user.id, dealId).run();
  } catch (e) {
    if (/UNIQUE/i.test((e as Error).message || '')) {
      return c.json({ ok: true, already_member: true });
    }
    throw e;
  }
  return c.json({ ok: true, used: used + 1, cap, tier });
});

deals.delete('/:id/dealroom/leave', async (c) => {
  const user = await requireAuth(c);
  // Mirror the bypass list from the join endpoint — admin/partner/advisor
  // who joined a dealroom must also be able to leave it.
  if (user.role !== 'investor' && !DEALROOM_BYPASS_ROLES.has(String(user.role))) {
    return c.json({ error: 'investor_only' }, 403);
  }
  const dealId = Number(c.req.param('id'));
  if (!Number.isFinite(dealId)) return c.json({ error: 'bad_id' }, 400);
  await c.env.DB.prepare(
    `DELETE FROM investor_dealroom_members WHERE investor_user_id = ? AND deal_id = ?`
  ).bind(user.id, dealId).run();
  return c.json({ ok: true });
});

export default deals;
