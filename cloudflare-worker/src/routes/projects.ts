import { Hono } from 'hono';
import type { Env, User } from '../types';
import { schedulePush } from '../integrations/autopush';
import { getSQL } from '../db';
import { requireAuth, requireRole, canAccessFounderResource } from '../auth';
import { runFullScore } from '../services/scoring';
import { ensureTier, ensureTierSchema, FREE_TIER_LIMITS, userMeetsTier } from '../middleware/requireTier';

const projects = new Hono<{ Bindings: Env }>();

// Task #2 — lazy bootstrap for the `data_room_url` + `data_room_nda_required`
// columns on `projects`. Mirrors the pattern used by Task #14's
// `ensureDiscoveryValidationRatingColumns()` — migration 076 is the canonical
// apply path, but on a cold D1 isolate where the migration hasn't been
// applied yet (or on dev SQLite) we add the columns ourselves via ALTER and
// swallow the duplicate-column error so subsequent reads/writes succeed.
// Keyed per-DB via a WeakMap so reload-during-dev re-runs cleanly.
const _dataRoomReady = new WeakMap<object, true>();
export async function ensureProjectDataRoomColumns(env: Env): Promise<void> {
  const db = env.DB as unknown as object;
  if (_dataRoomReady.has(db)) return;
  try {
    await env.DB.exec(`ALTER TABLE projects ADD COLUMN data_room_url TEXT`);
  } catch (_e) { /* duplicate column on re-run is fine */ }
  try {
    await env.DB.exec(`ALTER TABLE projects ADD COLUMN data_room_nda_required INTEGER NOT NULL DEFAULT 0`);
  } catch (_e) { /* duplicate column on re-run is fine */ }
  _dataRoomReady.set(db, true);
}

// Task #2 — lazy bootstrap for the structured revenue-proof columns
// surfaced on the Spin-Out Demo Day's Validation slide. Additive +
// idempotent (duplicate-column errors swallowed). Same WeakMap pattern
// as ensureProjectDataRoomColumns above so reload-during-dev re-runs
// cleanly without spamming PRAGMA.
const _revenueProofReady = new WeakMap<object, true>();
export async function ensureProjectRevenueProofColumns(env: Env): Promise<void> {
  const db = env.DB as unknown as object;
  if (_revenueProofReady.has(db)) return;
  for (const ddl of [
    `ALTER TABLE projects ADD COLUMN mrr REAL`,
    `ALTER TABLE projects ADD COLUMN paying_customers INTEGER`,
    `ALTER TABLE projects ADD COLUMN first_payment_date TEXT`,
    `ALTER TABLE projects ADD COLUMN paid_pilot_status TEXT`,
  ]) {
    try { await env.DB.exec(ddl); } catch (_e) { /* duplicate column on re-run is fine */ }
  }
  _revenueProofReady.set(db, true);
}

async function listProjectsHandler(c: any) {
  const user = await requireAuth(c);
  const status = c.req.query('status');
  const sql = getSQL(c.env);
  const isPrivileged = user.role === 'admin' || user.role === 'partner' || user.role === 'investor';
  // IDOR guard: founders can only see their OWN projects.
  // Task #3 (Y-1) — investor list rows JOIN to users so we can per-row
  // mask via maskFounderForInvestor (no active pairwise NDA → public
  // fields only). Other roles keep the legacy SELECT shape.
  // Task #7 (AM) — soft-deleted projects (deleted_at IS NOT NULL) are
  // hidden from every list view. They reappear only in the Admin > Trash
  // page, which uses the dedicated /api/admin/projects/trash route.
  let rows: any;
  if (isPrivileged) {
    if (user.role === 'investor') {
      rows = status
        ? await sql`SELECT p.*, u.id AS founder_user_id FROM projects p LEFT JOIN users u ON u.founder_id = p.founder_id WHERE p.status = ${status} AND p.deleted_at IS NULL ORDER BY p.created_at DESC`
        : await sql`SELECT p.*, u.id AS founder_user_id FROM projects p LEFT JOIN users u ON u.founder_id = p.founder_id WHERE p.deleted_at IS NULL ORDER BY p.created_at DESC`;
    } else {
      rows = status
        ? await sql`SELECT * FROM projects WHERE status = ${status} AND deleted_at IS NULL ORDER BY created_at DESC`
        : await sql`SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY created_at DESC`;
    }
  } else {
    if (!user.founder_id) { await sql.end(); return c.json([]); }
    rows = status
      ? await sql`SELECT * FROM projects WHERE status = ${status} AND founder_id = ${user.founder_id} AND deleted_at IS NULL ORDER BY created_at DESC`
      : await sql`SELECT * FROM projects WHERE founder_id = ${user.founder_id} AND deleted_at IS NULL ORDER BY created_at DESC`;
  }
  await sql.end();
  if (user.role === 'investor') {
    const { maskFounderForInvestor } = await import('../services/trust');
    const masked = await Promise.all(
      (rows as any[]).map((p) => maskFounderForInvestor(c.env, p, { viewerRole: 'investor', viewerUserId: user.id })),
    );
    return c.json(masked);
  }
  return c.json(rows);
}

projects.get('/', listProjectsHandler);
projects.get('', listProjectsHandler);

projects.get('/:id', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  // Task #2 — make sure the columns exist before SELECT * so older D1s
  // don't omit them from the projection.
  await ensureProjectDataRoomColumns(c.env);
  await ensureProjectRevenueProofColumns(c.env);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM projects WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Project not found' }, 404); }
  const project = rows[0];
  // IDOR guard: a founder can only read their own project; admins/partners read all.
  if (!canAccessFounderResource(user, project.founder_id)) {
    await sql.end();
    return c.json({ detail: 'Forbidden: you do not own this project' }, 403);
  }
  let founder = null;
  let founderUserId: number | null = null;
  if (project.founder_id) {
    const f = await sql`SELECT * FROM founders WHERE id = ${project.founder_id}`;
    if (f.length > 0) founder = f[0];
    const u = await sql`SELECT id FROM users WHERE founder_id = ${project.founder_id} LIMIT 1`;
    if (u.length > 0) founderUserId = u[0].id;
  }
  await sql.end();
  // Task #3 (Y-1) — investor view gets masked unless an active pairwise
  // NDA exists between this investor and the project's founder. Admins,
  // partners, and the founder themselves bypass the mask. ALWAYS run
  // for the investor role (even when founder_user_id is unresolved) —
  // maskFounderForInvestor is fail-closed and will mask the row when
  // no founder linkage exists, preventing leakage on legacy projects
  // with a missing users.founder_id mapping.
  if (user.role === 'investor') {
    const { maskFounderForInvestor } = await import('../services/trust');
    const masked = await maskFounderForInvestor(
      c.env,
      { ...project, founder, founder_user_id: founderUserId },
      { viewerRole: 'investor', viewerUserId: user.id },
    );
    return c.json(masked);
  }
  return c.json({ ...project, founder });
});

/**
 * Resolve which founder row a NEW project should be attached to.
 *
 *  - Founders are forced onto their OWN founder_id (form values ignored). If
 *    they don't have one yet, we auto-create the row from their account name +
 *    email and link it via users.founder_id.
 *  - Admin / partner / investor look the founder up by the form's
 *    founder_email (creating a new row if needed). If no email is supplied
 *    the project ships unattached, matching legacy behaviour.
 */
export async function resolveFounderIdForCreate(
  user: { id: number; role: string; email: string; name?: string | null; founder_id?: number | null },
  data: { founder_email?: string; founder_name?: string },
  sql: any,
): Promise<number | null> {
  if (user.role === 'founder') {
    if (user.founder_id) return user.founder_id;
    const existing = await sql`SELECT id FROM founders WHERE email = ${user.email}`;
    let founderId: number;
    if (existing.length > 0) {
      founderId = existing[0].id;
    } else {
      // founders.email is UNIQUE — guard against the rare race where two
      // concurrent first-project creates from the same founder both pass the
      // SELECT above. The losing INSERT will throw; fall back to a re-SELECT.
      try {
        const [f] = await sql`INSERT INTO founders (name, email) VALUES (${user.name || 'Unknown'}, ${user.email}) RETURNING id`;
        founderId = f.id;
      } catch (e: any) {
        if (!/UNIQUE|constraint/i.test(e?.message || '')) throw e;
        const retry = await sql`SELECT id FROM founders WHERE email = ${user.email}`;
        if (retry.length === 0) throw e;
        founderId = retry[0].id;
      }
    }
    await sql`UPDATE users SET founder_id = ${founderId} WHERE id = ${user.id}`;
    return founderId;
  }
  if (!data.founder_email) return null;
  const existing = await sql`SELECT id FROM founders WHERE email = ${data.founder_email}`;
  if (existing.length > 0) return existing[0].id;
  const [f] = await sql`INSERT INTO founders (name, email) VALUES (${data.founder_name || 'Unknown'}, ${data.founder_email}) RETURNING id`;
  return f.id;
}

async function createProjectHandler(c: any) {
  const user = await requireAuth(c);
  const data = await c.req.json();
  // Task #17 — name is required. Without this an empty form silently
  // creates a blank "" project that founders then can't filter / find.
  const name = typeof data?.name === 'string' ? data.name.trim() : '';
  if (!name) return c.json({ error: 'Project name is required' }, 400);
  const sql = getSQL(c.env);

  // Task #6 — free-tier project cap (1). Counts ALL projects owned by the
  // founder regardless of status. Bypass roles never hit the cap.
  //
  // We check BEFORE resolving founder_id: a founder whose users.founder_id is
  // still NULL may already own a `founders` row (e.g. created by an admin or
  // by a prior project flow that crashed). Counting only via user.founder_id
  // would let them bypass the cap on their first call. Resolve via email
  // first, then fall back to the linked column.
  if (user.role === 'founder' && !userMeetsTier(user, 'growth')) {
    await ensureTierSchema(c.env);
    let founderRow: Array<{ id: number }> = [];
    if (user.founder_id) {
      founderRow = [{ id: user.founder_id }];
    } else if (user.email) {
      founderRow = await sql`SELECT id FROM founders WHERE email = ${user.email}`;
    }
    if (founderRow.length > 0) {
      const fid = founderRow[0].id;
      const existing = await sql`SELECT COUNT(*)::int AS n FROM projects WHERE founder_id = ${fid}`;
      const count = Number(existing?.[0]?.n ?? 0);
      if (count >= FREE_TIER_LIMITS.projects) {
        await sql.end();
        ensureTier(user, 'growth'); // throws 402 → frontend opens PaywallModal
      }
    }
  }

  const founderId = await resolveFounderIdForCreate(user as any, data, sql);

  const [project] = await sql`INSERT INTO projects (name, description, sector, stage, founder_id, problem_statement, solution, why_now, tam, sam, cost_to_mvp, funding_needed, use_of_funds) VALUES (${name}, ${data.description || null}, ${data.sector || null}, ${data.stage || 'idea'}, ${founderId}, ${data.problem_statement || null}, ${data.solution || null}, ${data.why_now || null}, ${data.tam || null}, ${data.sam || null}, ${data.cost_to_mvp || null}, ${data.funding_needed || null}, ${data.use_of_funds || null}) RETURNING *`;

  await sql`INSERT INTO deals (project_id, status) VALUES (${project.id}, 'applied')`;
  await sql`INSERT INTO activity_logs (project_id, action, details) VALUES (${project.id}, 'project_created', ${`Project '${project.name}' submitted`})`;
  await sql.end();
  // Re-index for semantic search. Best-effort — failure is non-fatal.
  try { const { Jobs } = await import('../models/jobs'); await Jobs.enqueue(c.env, 'embed_entity', { type: 'project', id: project.id }); } catch {}

  // Task #2 — best-effort HubSpot company create. Resolve the founder's
  // user_id from `projects.founder_id` (NOT the acting user), so when an
  // admin or partner creates a project on behalf of a founder, the push
  // runs against the founder's HubSpot integration row, not the actor's.
  try {
    const ownerRow = await c.env.DB.prepare(
      'SELECT user_id FROM founders WHERE id = ?',
    ).bind(founderId).first();
    const owner = ownerRow as { user_id: number | null } | null;
    const ownerUserId = owner?.user_id ?? null;
    if (ownerUserId) {
      schedulePush({
        c, user: { id: ownerUserId } as User, providerKey: 'hubspot',
        payload: { project_id: project.id },
        eventType: 'auto_push:project_created',
      });
      // Task #4 — mirror to Salesforce when active.
      schedulePush({
        c, user: { id: ownerUserId } as User, providerKey: 'salesforce',
        payload: { project_id: project.id },
        eventType: 'auto_push:project_created',
      });
    }
  } catch (e) { console.warn('[projects] crm project-create hook failed', e); }

  return c.json(project, 201);
}

projects.post('/', createProjectHandler);
projects.post('', createProjectHandler);

projects.post('/submit', async (c) => {
  await requireAuth(c);
  const data = await c.req.json();

  // Epic 5: reject any client-supplied score / tier / breakdown BEFORE any
  // DB writes. The /submit path is wide-open intake; a malicious founder
  // could otherwise send a pre-built TIER_1 payload AND have a project row
  // created as a side effect even when the request is rejected.
  const { assertNoReservedFields, signScore, detectAnomalies, INTEGRITY_VERSION } =
    await import('../services/scoreIntegrity');
  try {
    assertNoReservedFields(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Reserved field rejected';
    return c.json({ error: message, code: 'reserved_field' }, 400);
  }

  const sql = getSQL(c.env);

  const existingFounders = await sql`SELECT id FROM founders WHERE email = ${data.founder_email}`;
  let founderId: number;
  if (existingFounders.length > 0) {
    founderId = existingFounders[0].id;
  } else {
    const [f] = await sql`INSERT INTO founders (name, email) VALUES (${data.founder_name}, ${data.founder_email}) RETURNING id`;
    founderId = f.id;
  }

  const [project] = await sql`INSERT INTO projects (name, description, sector, stage, founder_id, problem_statement, solution, why_now, tam, sam, cost_to_mvp, funding_needed, use_of_funds) VALUES (${data.name}, ${data.description || null}, ${data.sector || null}, 'idea', ${founderId}, ${data.problem_statement || null}, ${data.solution || null}, ${data.why_now || null}, ${data.tam || null}, ${data.sam || null}, ${data.cost_to_mvp || null}, ${data.funding_needed || null}, ${data.use_of_funds || null}) RETURNING *`;

  const result = runFullScore(data);
  const b = result.breakdown;

  // Snapshot the scoring inputs so the nightly audit + admin queue can
  // reproduce the math, and so anomaly detection can compare to history.
  // Keys MUST match `REQUIRED_OFFICIAL_INPUTS` in scoreIntegrity.ts so that
  // input_jump anomaly detection compares like-for-like fields across the
  // /submit and /scoring/score paths.
  const inputsSnapshot: Record<string, unknown> = {};
  for (const k of ['tam','sam','market_urgency','market_trend','team_expertise','team_execution','team_network','mvp_time_days','product_complexity','product_dependencies','cost_to_mvp','time_to_revenue_months','burn_risk','fit_alignment','fit_synergy','distribution_channels','distribution_virality']) {
    if (data[k] !== undefined) inputsSnapshot[k] = data[k];
  }
  const qualText = [data.problem_statement, data.solution, data.why_now, data.use_of_funds, data.growth_signals]
    .filter(v => typeof v === 'string' && v.trim()).map(v => (v as string).trim().toLowerCase()).join('\n---\n') || null;
  const lockedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

  // Anomaly detection MUST run BEFORE the INSERT (same reason as
  // /scoring/score: detectAnomalies' "previous snapshot" lookup would
  // otherwise self-compare against the row we just wrote, swallowing
  // duplicate-text and input-jump signals on intake).
  const intakeFlags = await detectAnomalies(c.env, {
    projectId: project.id, totalScore: result.total_score, isSandbox: false,
    inputs: inputsSnapshot as Record<string, number>, qualitativeText: qualText || '',
  });
  const intakeReview: 'auto_approved' | 'flagged' =
    intakeFlags.length > 0 ? 'flagged' : 'auto_approved';
  const intakeFlagsJson = intakeFlags.length > 0 ? JSON.stringify(intakeFlags) : null;

  const [snapshot] = await sql`
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
      anomaly_flags, admin_review_status
    ) VALUES (
      ${project.id}, ${result.total_score}, ${result.tier},
      ${b.market.size}, ${b.market.urgency}, ${b.market.trend}, ${b.market.total},
      ${b.team.expertise}, ${b.team.execution}, ${b.team.network}, ${b.team.total},
      ${b.product.mvp_time}, ${b.product.complexity}, ${b.product.dependency}, ${b.product.total},
      ${b.capital.cost_mvp}, ${b.capital.time_revenue}, ${b.capital.burn_traction}, ${b.capital.total},
      ${b.fit.alignment}, ${b.fit.synergy}, ${b.fit.total},
      ${b.distribution.channels}, ${b.distribution.virality}, ${b.distribution.total},
      0, 'auto',
      0, ${INTEGRITY_VERSION}, ${JSON.stringify(inputsSnapshot)}, ${qualText}, ${lockedUntil},
      ${intakeFlagsJson}, ${intakeReview}
    )
    RETURNING *
  `;
  const intakeHash = await signScore(c.env, project.id, result.total_score, snapshot.created_at, INTEGRITY_VERSION);
  await sql`UPDATE score_snapshots SET integrity_hash = ${intakeHash} WHERE id = ${snapshot.id}`;

  let newStatus = 'rejected', dealStatus = 'rejected', newStage = project.stage;
  if (intakeReview === 'flagged') {
    // Flagged intake holds the project in review until admin signs off, so
    // an LP or partner viewing the pipeline never sees an unverified TIER_1.
    newStatus = 'scoring';
    dealStatus = 'applied';
  } else if (result.total_score >= 85) { newStatus = 'tier_1'; newStage = 'build'; dealStatus = 'active'; }
  else if (result.total_score >= 70) { newStatus = 'tier_2'; dealStatus = 'scored'; }

  await sql`UPDATE projects SET status = ${newStatus}, stage = ${newStage}, updated_at = CURRENT_TIMESTAMP WHERE id = ${project.id}`;
  try { const { Jobs } = await import('../models/jobs'); await Jobs.enqueue(c.env, 'embed_entity', { type: 'project', id: project.id }); } catch {}
  await sql`INSERT INTO deals (project_id, status) VALUES (${project.id}, ${dealStatus})`;
  await sql`INSERT INTO activity_logs (project_id, action, details, actor) VALUES (${project.id}, 'auto_scored', ${`Score: ${result.total_score}, Tier: ${result.tier}, Status: ${newStatus}, Review: ${intakeReview}`}, 'system')`;
  await sql.end();
  // Only auto-create StudioOps for clean, approved tier_1/tier_2. A flagged
  // intake holds at 'scoring' until admin signs off — Epic 5 LP guarantee.
  if (intakeReview === 'auto_approved' && (newStatus === 'tier_1' || newStatus === 'tier_2')) {
    const { autoCreateStudioOpsForProject } = await import('./studioops');
    await autoCreateStudioOpsForProject(c.env, project.id, newStatus, founderId || 1);
  }

  return c.json({
    project: { ...project, status: newStatus, stage: newStage },
    score: { ...result, integrity_hash: intakeHash, integrity_version: INTEGRITY_VERSION, requires_admin_review: intakeReview === 'flagged', anomaly_flags: intakeFlags },
    auto_decision: { status: newStatus, stage: newStage, tier: result.tier, tier_label: result.tier_label, requires_admin_review: intakeReview === 'flagged' },
  });
});

projects.put('/:id', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  const data = await c.req.json();
  const sql = getSQL(c.env);

  const rows = await sql`SELECT * FROM projects WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Project not found' }, 404); }

  // RBAC: admins/partners/investors can edit any project; founders can only edit their own.
  const project = rows[0];
  const isPrivileged = user.role === 'admin' || user.role === 'partner' || user.role === 'investor';
  const isOwner = !!user.founder_id && project.founder_id === user.founder_id;
  if (!isPrivileged && !isOwner) {
    await sql.end();
    return c.json({ detail: 'Forbidden: you do not own this project' }, 403);
  }

  // Task #17 — parity with create: reject blank `name` on update so the
  // direct-API path can't whitewash an existing project's title.
  if (data.name !== undefined) {
    const nameTrimmed = typeof data.name === 'string' ? data.name.trim() : '';
    if (!nameTrimmed) { await sql.end(); return c.json({ error: 'Project name is required' }, 400); }
    data.name = nameTrimmed;
  }

  // Only admin/partner may change status, stage, or playbook week.
  // Task #2 — data_room_url + data_room_nda_required are owner-editable
  // (founders manage their own deal-room link). Both are written by the
  // editor on Project detail AND by the Spin-Out deck's "Review the deal"
  // slide save-path so the project stays the single source of truth.
  await ensureProjectDataRoomColumns(c.env);
  await ensureProjectRevenueProofColumns(c.env);
  // Task #2 — coerce structured revenue-proof fields: numbers must be
  // finite (or null to clear); paid_pilot_status is a closed enum; the
  // first_payment_date is stored as an ISO date string and trimmed.
  if (data.revenue !== undefined && data.revenue !== null && data.revenue !== '') {
    const n = Number(data.revenue);
    data.revenue = isFinite(n) && n >= 0 ? n : null;
  } else if (data.revenue === '' || data.revenue === null) {
    data.revenue = null;
  }
  if (data.mrr !== undefined && data.mrr !== null && data.mrr !== '') {
    const n = Number(data.mrr);
    data.mrr = isFinite(n) && n >= 0 ? n : null;
  } else if (data.mrr === '' || data.mrr === null) {
    data.mrr = null;
  }
  if (data.paying_customers !== undefined && data.paying_customers !== null && data.paying_customers !== '') {
    const n = Number(data.paying_customers);
    data.paying_customers = isFinite(n) && n >= 0 ? Math.floor(n) : null;
  } else if (data.paying_customers === '' || data.paying_customers === null) {
    data.paying_customers = null;
  }
  if (data.first_payment_date !== undefined) {
    const s = data.first_payment_date == null ? '' : String(data.first_payment_date).trim();
    data.first_payment_date = s || null;
  }
  if (data.paid_pilot_status !== undefined) {
    const s = (data.paid_pilot_status == null ? '' : String(data.paid_pilot_status).trim().toLowerCase());
    const allowed = new Set(['paid', 'pilot_paid', 'pilot_signed', 'pre_revenue']);
    data.paid_pilot_status = allowed.has(s) ? s : null;
  }
  const baseFields = ['name', 'description', 'sector', 'problem_statement', 'solution', 'why_now', 'tam', 'sam', 'users_count', 'revenue', 'growth_signals', 'cost_to_mvp', 'funding_needed', 'use_of_funds', 'data_room_url', 'data_room_nda_required', 'mrr', 'paying_customers', 'first_payment_date', 'paid_pilot_status'];
  // Normalise: coerce boolean → 0/1 for the NDA flag, trim URL, allow
  // explicit null to clear either field.
  if (data.data_room_nda_required !== undefined) {
    data.data_room_nda_required = data.data_room_nda_required ? 1 : 0;
  }
  if (data.data_room_url !== undefined && data.data_room_url !== null) {
    const u = String(data.data_room_url || '').trim();
    data.data_room_url = u || null;
  }
  const privilegedFields = ['stage', 'status', 'playbook_week'];
  const fields = isPrivileged ? [...baseFields, ...privilegedFields] : baseFields;
  const updates: string[] = [];
  const values: any[] = [];

  for (const f of fields) {
    if (data[f] !== undefined) { updates.push(`${f} = ?`); values.push(data[f]); }
  }
  if (updates.length > 0) {
    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    await sql.unsafe(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`, [...values, id]);
  }
  const [updated] = await sql`SELECT * FROM projects WHERE id = ${id}`;
  await sql.end();
  try { const { Jobs } = await import('../models/jobs'); await Jobs.enqueue(c.env, 'embed_entity', { type: 'project', id }); } catch {}
  return c.json(updated);
});

projects.delete('/:id', async (c) => {
  // Task #7 (AM) — DEFAULT path = SOFT-DELETE.
  //   * Founders may soft-delete their own project.
  //   * Admins may soft-delete any project, OR pass `?hard=true` to
  //     skip the trash and physically purge the row immediately. The
  //     hard path also lives at /api/admin/projects/:id/hard-delete
  //     (see routes/admin.ts) for a clearer audit trail.
  // Soft-deleted rows are invisible to every list endpoint (filter
  // `deleted_at IS NULL`) and are physically removed by the 30-day
  // sweep cron (see services/projectTrash.ts).
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  const hard = c.req.query('hard') === 'true' || c.req.query('hard') === '1';
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id, founder_id, deleted_at FROM projects WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Project not found' }, 404); }
  const project = rows[0];
  const isAdmin = user.role === 'admin';
  const isPartner = user.role === 'partner';
  const isOwner = !!user.founder_id && project.founder_id === user.founder_id;
  // Task #7 (AM) — admins + partners may soft-delete any project (partners
  // routinely manage portfolio hygiene); founders may only delete their own.
  if (!isAdmin && !isPartner && !isOwner) {
    await sql.end();
    return c.json({ detail: 'Forbidden: you do not own this project' }, 403);
  }
  if (hard && !isAdmin) {
    // Hard-delete is irreversible → admin-only, even partners can't bypass.
    await sql.end();
    return c.json({ detail: 'Forbidden: hard delete is admin-only' }, 403);
  }

  if (hard) {
    // Migration 039 added ON DELETE CASCADE to every project FK we ship,
    // so a single DELETE is enough on a migrated DB. The legacy manual
    // cascade (kept for stale installs that haven't applied 039 yet) lives
    // in services/projectTrash.ts:hardDeleteProject.
    const { hardDeleteProject } = await import('../services/projectTrash');
    try {
      await hardDeleteProject(c.env, id);
    } catch (e) {
      await sql.end();
      console.error('[projects:delete:hard] cascade failed for', id, (e as Error).message);
      return c.json({ error: 'Could not hard-delete project', detail: (e as Error).message }, 409);
    }
    try { const { Jobs } = await import('../models/jobs'); await Jobs.enqueue(c.env, 'embed_delete', { type: 'project', id }); } catch {}
    await sql.end();
    return c.json({ ok: true, hard: true });
  }

  // Soft-delete (idempotent). Re-deleting an already-trashed project is
  // a no-op so retried requests don't 404 the user.
  if (project.deleted_at) {
    await sql.end();
    return c.json({ ok: true, soft: true, already_trashed: true });
  }
  await sql`UPDATE projects SET deleted_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  await sql.end();
  return c.json({ ok: true, soft: true });
});

projects.post('/:id/advance-week', async (c) => {
  await requireRole(c, 'partner', 'investor');
  const id = parseInt(c.req.param('id'));
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM projects WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Project not found' }, 404); }

  const order = ['week_1', 'week_2', 'week_3', 'week_4', 'complete'];
  const idx = order.indexOf(rows[0].playbook_week);
  if (idx >= 0 && idx < order.length - 1) {
    await sql`UPDATE projects SET playbook_week = ${order[idx + 1]}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  }
  const [updated] = await sql`SELECT * FROM projects WHERE id = ${id}`;
  await sql.end();
  return c.json(updated);
});

export default projects;
