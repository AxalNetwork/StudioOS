import { Hono } from 'hono';
import type { Env, User } from '../types';
import { schedulePush } from '../integrations/autopush';
import { getSQL } from '../db';
import { requireAuth, requireRole, generateToken } from '../auth';
import {
  canAccessProject,
  getProjectMembershipRole,
  getMemberProjectIds,
  ensureProjectMembershipSchema,
  isProjectManager,
  evaluateTeamGate,
  hashInviteToken,
  normalizeEmail,
} from '../services/projectAccess';
import { runFullScore } from '../services/scoring';
import { ensureTier, ensureTierSchema, FREE_TIER_LIMITS, userMeetsTier } from '../middleware/requireTier';
import { assembleSpinoutDeckData } from '../services/decks/spinoutDeckData';
import {
  SPINOUT_OVERRIDABLE_KEYS,
  applySpinoutOverrides,
  loadSpinoutDeckOverrides,
  sanitizeSpinoutOverrides,
  saveSpinoutDeckOverrides,
} from '../services/decks/spinoutDeckOverrides';
import { ensureMethodAllowed } from '../services/decks/branding';
import { PREMIUM_METHOD_IDS } from '../services/decks/methods';
import { normalizeUseOfFunds, formatUseOfFundsText } from '../util/useOfFunds';

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

// Task #31 — lazy bootstrap for the Product demo source columns on
// `projects` (demo video link, live demo URL, caption/description,
// screenshot image). Migration 118 is the canonical apply path; this keeps
// a cold D1 isolate (or dev SQLite) working before it runs. Additive +
// idempotent; same WeakMap pattern as the helpers above.
const _productDemoReady = new WeakMap<object, true>();
export async function ensureProjectProductDemoColumns(env: Env): Promise<void> {
  const db = env.DB as unknown as object;
  if (_productDemoReady.has(db)) return;
  for (const ddl of [
    `ALTER TABLE projects ADD COLUMN product_demo_video_url TEXT`,
    `ALTER TABLE projects ADD COLUMN product_demo_live_url TEXT`,
    `ALTER TABLE projects ADD COLUMN product_demo_caption TEXT`,
    `ALTER TABLE projects ADD COLUMN product_demo_screenshot_url TEXT`,
    `ALTER TABLE projects ADD COLUMN website TEXT`,
  ]) {
    try { await env.DB.exec(ddl); } catch (_e) { /* duplicate column on re-run is fine */ }
  }
  _productDemoReady.set(db, true);
}

// Use of Funds planning metadata (JSON) — lazy bootstrap for
// `projects.use_of_funds_meta`. Migration 158 is the canonical apply path;
// this keeps a cold D1 isolate (or dev SQLite) working before it runs.
// Additive + idempotent; same WeakMap pattern as the helpers above.
const _uofMetaReady = new WeakMap<object, true>();
export async function ensureProjectUofMetaColumn(env: Env): Promise<void> {
  const db = env.DB as unknown as object;
  if (_uofMetaReady.has(db)) return;
  try { await env.DB.exec(`ALTER TABLE projects ADD COLUMN use_of_funds_meta TEXT`); } catch (_e) { /* duplicate column on re-run is fine */ }
  _uofMetaReady.set(db, true);
}

// Validate + canonicalize the Use of Funds planning metadata blob. Accepts an
// object or a JSON string; must parse to a plain object; size-capped so it
// can't be abused as arbitrary storage. Returns { value } (canonical JSON
// string or null to clear) or { error }.
export function normalizeUofMeta(raw: unknown): { value?: string | null; error?: string } {
  if (raw === null || raw === undefined || raw === '') return { value: null };
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.length > 8000) return { error: 'use_of_funds_meta too large' };
    try { obj = JSON.parse(raw); } catch { return { error: 'use_of_funds_meta must be valid JSON' }; }
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return { error: 'use_of_funds_meta must be a JSON object' };
  }
  const out = JSON.stringify(obj);
  if (out.length > 8000) return { error: 'use_of_funds_meta too large' };
  return { value: out };
}

// Spin-Out Lab Incorporate workspace state (JSON) — lazy bootstrap for
// `projects.incorporation_meta`. Migration 159 is the canonical apply path;
// same WeakMap pattern as ensureProjectUofMetaColumn above.
const _incMetaReady = new WeakMap<object, true>();
export async function ensureProjectIncMetaColumn(env: Env): Promise<void> {
  const db = env.DB as unknown as object;
  if (_incMetaReady.has(db)) return;
  try { await env.DB.exec(`ALTER TABLE projects ADD COLUMN incorporation_meta TEXT`); } catch (_e) { /* duplicate column on re-run is fine */ }
  _incMetaReady.set(db, true);
}

// Validate + canonicalize the Incorporate workspace state blob. Same contract
// as normalizeUofMeta: object or JSON string, plain object only, size-capped.
export function normalizeIncMeta(raw: unknown): { value?: string | null; error?: string } {
  if (raw === null || raw === undefined || raw === '') return { value: null };
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.length > 8000) return { error: 'incorporation_meta too large' };
    try { obj = JSON.parse(raw); } catch { return { error: 'incorporation_meta must be valid JSON' }; }
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return { error: 'incorporation_meta must be a JSON object' };
  }
  const out = JSON.stringify(obj);
  if (out.length > 8000) return { error: 'incorporation_meta too large' };
  return { value: out };
}

// Spin-Out Lab Co-founder Match decision (JSON) — lazy bootstrap for
// `projects.cofounder_decision_meta`. Migration 162 is the canonical apply
// path; same WeakMap pattern as ensureProjectUofMetaColumn above.
const _cfDecisionReady = new WeakMap<object, true>();
export async function ensureProjectCofounderDecisionColumn(env: Env): Promise<void> {
  const db = env.DB as unknown as object;
  if (_cfDecisionReady.has(db)) return;
  try { await env.DB.exec(`ALTER TABLE projects ADD COLUMN cofounder_decision_meta TEXT`); } catch (_e) { /* duplicate column on re-run is fine */ }
  _cfDecisionReady.set(db, true);
}

// Validate + canonicalize the co-founder decision blob. Same contract as
// normalizeUofMeta: object or JSON string, plain object only, size-capped.
export function normalizeCofounderDecisionMeta(raw: unknown): { value?: string | null; error?: string } {
  if (raw === null || raw === undefined || raw === '') return { value: null };
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.length > 8000) return { error: 'cofounder_decision_meta too large' };
    try { obj = JSON.parse(raw); } catch { return { error: 'cofounder_decision_meta must be valid JSON' }; }
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return { error: 'cofounder_decision_meta must be a JSON object' };
  }
  const out = JSON.stringify(obj);
  if (out.length > 8000) return { error: 'cofounder_decision_meta too large' };
  return { value: out };
}

// Task #1 — lazy bootstrap for the founder's editable company / affiliation,
// surfaced on the Spin-Out Demo Day's merged Team & network slide. Additive
// + idempotent; same WeakMap pattern as above. The `founders` table is not
// at D1's ALTER-rewrite limit, so a plain ADD COLUMN is fine here.
const _founderCompanyReady = new WeakMap<object, true>();
export async function ensureFounderCompanyColumn(env: Env): Promise<void> {
  const db = env.DB as unknown as object;
  if (_founderCompanyReady.has(db)) return;
  try { await env.DB.exec(`ALTER TABLE founders ADD COLUMN company TEXT`); }
  catch (_e) { /* duplicate column on re-run is fine */ }
  _founderCompanyReady.set(db, true);
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
    // Task #1 — founders see their OWN projects + any they're an accepted
    // member of (co-founder / advisor). Union founder_id ownership with the
    // membership project-id set.
    const memberIds = await getMemberProjectIds(c.env, user.id);
    const ownsFounder = !!user.founder_id;
    if (!ownsFounder && memberIds.length === 0) { await sql.end(); return c.json([]); }
    const conds: string[] = [];
    const params: any[] = [];
    if (ownsFounder) { conds.push('founder_id = ?'); params.push(user.founder_id); }
    if (memberIds.length) {
      conds.push(`id IN (${memberIds.map(() => '?').join(',')})`);
      params.push(...memberIds);
    }
    let where = `(${conds.join(' OR ')}) AND deleted_at IS NULL`;
    if (status) { where = `status = ? AND ${where}`; params.unshift(status); }
    rows = await sql.unsafe(`SELECT * FROM projects WHERE ${where} ORDER BY created_at DESC`, params);
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
  await ensureProjectProductDemoColumns(c.env);
  await ensureFounderCompanyColumn(c.env);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM projects WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Project not found' }, 404); }
  const project = rows[0];
  // IDOR guard: a founder can only read their own project; admins/partners read
  // all. Investors are intentionally allowed PAST this gate so they reach the
  // maskFounderForInvestor branch below — that mask is fail-closed and NDA-gated,
  // so an un-NDA'd investor still only ever sees the public-key subset. This is
  // the ONE route with a masked investor fallback; canAccessFounderResource
  // denies investors on every other founder-resource route (audit M2).
  // Task #1 — owner, accepted member (co-founder/advisor), or privileged may
  // read. Investors are deliberately let PAST to the fail-closed masked branch
  // below (NDA-gated); they never receive membership access.
  if (user.role !== 'investor') {
    const allowed = await canAccessProject(c.env, user, project, { write: false });
    if (!allowed) {
      await sql.end();
      return c.json({ detail: 'Forbidden: you do not own this project' }, 403);
    }
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
      // `COUNT(*)`, not `COUNT(*)::int`. `::` is Postgres cast syntax and D1 is
      // SQLite, which rejects it outright with `unrecognized token: ":"`. This
      // threw for every free founder who already had a `founders` row —
      // anyone creating a second project, or a first one after onboarding had
      // registered them — so the core founder action returned a 500 instead of
      // either the project or the clean 402 the cap is supposed to raise.
      const existing = await sql`SELECT COUNT(*) AS n FROM projects WHERE founder_id = ${fid}`;
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

  // Task #2 — validate + canonicalize the structured Use-of-Funds allocation
  // before any DB writes (defense in depth; the intake UI also enforces this).
  const uof = normalizeUseOfFunds(data.use_of_funds);
  if (uof.error) return c.json({ error: uof.error, code: 'invalid_use_of_funds' }, 400);
  const useOfFunds = uof.value;

  const sql = getSQL(c.env);

  const existingFounders = await sql`SELECT id FROM founders WHERE email = ${data.founder_email}`;
  let founderId: number;
  if (existingFounders.length > 0) {
    founderId = existingFounders[0].id;
  } else {
    const [f] = await sql`INSERT INTO founders (name, email) VALUES (${data.founder_name}, ${data.founder_email}) RETURNING id`;
    founderId = f.id;
  }

  const [project] = await sql`INSERT INTO projects (name, description, sector, stage, founder_id, problem_statement, solution, why_now, tam, sam, cost_to_mvp, funding_needed, use_of_funds) VALUES (${data.name}, ${data.description || null}, ${data.sector || null}, 'idea', ${founderId}, ${data.problem_statement || null}, ${data.solution || null}, ${data.why_now || null}, ${data.tam || null}, ${data.sam || null}, ${data.cost_to_mvp || null}, ${data.funding_needed || null}, ${useOfFunds}) RETURNING *`;

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
  const qualText = [data.problem_statement, data.solution, data.why_now, formatUseOfFundsText(useOfFunds), data.growth_signals]
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

  // RBAC: admins/partners can edit any project; founders can only edit their own.
  // Investors are NOT editors (audit M2) — their project access is the read-only,
  // NDA-masked view in GET '/:id'. Letting an investor through here is a
  // write-IDOR (they could mutate any founder's project, incl. the
  // admin/partner-only stage/status/playbook_week fields below).
  const project = rows[0];
  const isPrivileged = user.role === 'admin' || user.role === 'partner';
  const isOwner = !!user.founder_id && project.founder_id === user.founder_id;
  // Task #1 — accepted co-founders may also edit project DATA. Advisors are
  // read-only (membership role 'advisor' is NOT granted write), and investors
  // are never editors. privilegedFields (stage/status/playbook_week) stay
  // admin/partner-only via the `isPrivileged` gate further below.
  let isCofounderEditor = false;
  if (!isPrivileged && !isOwner && user.role !== 'investor') {
    const memberRole = await getProjectMembershipRole(c.env, id, user.id);
    isCofounderEditor = memberRole === 'cofounder' || memberRole === 'owner';
  }
  if (!isPrivileged && !isOwner && !isCofounderEditor) {
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
  await ensureProjectProductDemoColumns(c.env);
  await ensureFounderCompanyColumn(c.env);
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
  // Task #8 — validate + canonicalize the structured Use-of-Funds allocation
  // on update, mirroring the /submit intake path. Founders revise THE ASK
  // allocation from the deck-side editor; an invalid total is rejected and an
  // all-zero / empty allocation clears the field (stored NULL).
  if (data.use_of_funds !== undefined) {
    const uof = normalizeUseOfFunds(data.use_of_funds);
    if (uof.error) { await sql.end(); return c.json({ error: uof.error, code: 'invalid_use_of_funds' }, 400); }
    data.use_of_funds = uof.value;
  }
  // Use of Funds planning metadata (alert threshold, milestone costs, sync
  // timestamps) — owner-editable JSON blob next to the canonical allocation.
  if (data.use_of_funds_meta !== undefined) {
    await ensureProjectUofMetaColumn(c.env);
    const meta = normalizeUofMeta(data.use_of_funds_meta);
    if (meta.error) { await sql.end(); return c.json({ error: meta.error, code: 'invalid_use_of_funds_meta' }, 400); }
    data.use_of_funds_meta = meta.value;
  }
  // Spin-Out Lab Incorporate workspace state — owner-editable JSON blob
  // (entity decision/override, payment, docs, filing, uni-IP checklist).
  if (data.incorporation_meta !== undefined) {
    await ensureProjectIncMetaColumn(c.env);
    const meta = normalizeIncMeta(data.incorporation_meta);
    if (meta.error) { await sql.end(); return c.json({ error: meta.error, code: 'invalid_incorporation_meta' }, 400); }
    data.incorporation_meta = meta.value;
  }
  // Spin-Out Lab Co-founder Match decision — owner-editable JSON blob
  // (outcome advance/searching/solo, optional candidate uid, note, followups).
  if (data.cofounder_decision_meta !== undefined) {
    await ensureProjectCofounderDecisionColumn(c.env);
    const meta = normalizeCofounderDecisionMeta(data.cofounder_decision_meta);
    if (meta.error) { await sql.end(); return c.json({ error: meta.error, code: 'invalid_cofounder_decision_meta' }, 400); }
    data.cofounder_decision_meta = meta.value;
  }
  // Task #31 — Product demo source columns are owner-editable (founders
  // manage their own demo media on the project detail page). Trim URLs/text;
  // explicit '' / null clears the column.
  for (const k of ['product_demo_video_url', 'product_demo_live_url', 'product_demo_caption', 'product_demo_screenshot_url']) {
    if (data[k] !== undefined && data[k] !== null) {
      const s = String(data[k]).trim();
      data[k] = s || null;
    }
  }
  // Market-sizing invariants (mirrored in the dev FastAPI): TAM/SAM/SOM
  // non-negative when supplied; funnel nests (SAM ≤ TAM, SOM ≤ SAM) judged
  // against effective (incoming or stored) values. `som` exists since
  // migration 069 (deck autofill) and is founder-editable like tam/sam.
  for (const k of ['tam', 'sam', 'som']) {
    if (data[k] !== undefined && data[k] !== null && (!Number.isFinite(Number(data[k])) || Number(data[k]) < 0)) {
      await sql.end();
      return c.json({ error: 'invalid_market_sizing', detail: `${k} must be a non-negative number` }, 400);
    }
  }
  if (['tam', 'sam', 'som'].some((k) => data[k] !== undefined)) {
    const eff = (k: string) => (data[k] !== undefined ? data[k] : (project as any)[k]);
    const [tamV, samV, somV] = [eff('tam'), eff('sam'), eff('som')];
    if (tamV != null && samV != null && Number(samV) > Number(tamV)) {
      await sql.end();
      return c.json({ error: 'invalid_market_sizing', detail: 'SAM cannot exceed TAM' }, 400);
    }
    if (samV != null && somV != null && Number(somV) > Number(samV)) {
      await sql.end();
      return c.json({ error: 'invalid_market_sizing', detail: 'SOM cannot exceed SAM' }, 400);
    }
  }
  const baseFields = ['name', 'description', 'sector', 'problem_statement', 'solution', 'why_now', 'tam', 'sam', 'som', 'users_count', 'revenue', 'growth_signals', 'cost_to_mvp', 'funding_needed', 'use_of_funds', 'use_of_funds_meta', 'incorporation_meta', 'cofounder_decision_meta', 'data_room_url', 'data_room_nda_required', 'mrr', 'paying_customers', 'first_payment_date', 'paid_pilot_status', 'product_demo_video_url', 'product_demo_live_url', 'product_demo_caption', 'product_demo_screenshot_url', 'website'];
  // Normalise: coerce boolean → 0/1 for the NDA flag, trim URL, allow
  // explicit null to clear either field.
  if (data.data_room_nda_required !== undefined) {
    data.data_room_nda_required = data.data_room_nda_required ? 1 : 0;
  }
  // Task #66 — startup website URL: trim, allow null to clear, require
  // an http(s) scheme when present (mirrors the personal-website guard).
  if (data.website !== undefined && data.website !== null) {
    const w = String(data.website || '').trim();
    if (w && !/^https?:\/\//i.test(w)) {
      return c.json({ error: 'invalid_website', detail: 'website must start with http:// or https://' }, 400);
    }
    data.website = w || null;
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
  // Task #1 — the editable founder company / affiliation lives on the
  // linked `founders` row (not `projects`). Owner + privileged editors may
  // set it; explicit '' clears it. Skipped silently when the project has
  // no linked founder.
  if (data.founder_company !== undefined && project.founder_id) {
    const company = data.founder_company == null
      ? null
      : String(data.founder_company).trim().slice(0, 200) || null;
    await sql.unsafe(`UPDATE founders SET company = ? WHERE id = ?`, [company, project.founder_id]);
  }
  const [updated] = await sql`SELECT * FROM projects WHERE id = ${id}`;
  let updatedFounder = null;
  if (updated?.founder_id) {
    const fr = await sql`SELECT * FROM founders WHERE id = ${updated.founder_id}`;
    if (fr.length > 0) updatedFounder = fr[0];
  }
  await sql.end();
  try { const { Jobs } = await import('../models/jobs'); await Jobs.enqueue(c.env, 'embed_entity', { type: 'project', id }); } catch {}
  return c.json({ ...updated, founder: updatedFounder });
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

// Task #41 — assemble the NEW 10-slide Spin-Out Demo Day deck. Prod is a
// Worker on D1, but the .pptx generator (frontend/src/decks/spinout/buildDeck.js)
// runs in the BROWSER (it needs pptxgenjs). So this endpoint returns the
// assembled DATA + NOTES + gaps[] as JSON and the browser renders/downloads
// the file via buildDeck(data, { notes, draft }). Gated by the SAME premium
// check as POST /api/decks/apply-method — a founder who can apply the
// axal_spinout_demoday template can always generate its deck — then the same
// owner RBAC as PUT /:id below.
// Paywall + RBAC + data-source resolution for every Spin-Out deck surface
// (generate, and the manual-override read/write below). Shared so the override
// routes cannot drift into a laxer rule than the generator they edit: an
// override IS deck content, and anyone who can rewrite the thesis on a deck can
// read the deck.
//
// Returns either the userId whose Lab data the deck sources from, or the exact
// error Response to send. Callers do `if ('error' in access) return access.error`.
async function resolveSpinoutDeckAccess(
  c: any,
  projectId: number,
  user: any,
): Promise<{ sourceUserId: number } | { error: any }> {
  // Premium gate — mirrors /api/decks/apply-method's 402 upgrade payload.
  try {
    ensureMethodAllowed(user, 'axal_spinout_demoday', PREMIUM_METHOD_IDS);
  } catch (_e) {
    return { error: c.json({
      error: 'paywall', code: 'PAYWALL_PREMIUM_METHOD',
      method_id: 'axal_spinout_demoday', required_tier: 'growth',
      message: 'The Spin-Out deck is part of the Growth plan. Upgrade to unlock.',
    }, 402) };
  }

  // Ownership + data-source resolution. The deck is sourced from the PROJECT
  // OWNER's Lab data: fillAxalSpinoutDemoDay() reads user-scoped rows (founder
  // profile, spinout_lab_milestones, advisor_answers, the project-null
  // cap-table fallback, and the team graph) keyed by userId. We MUST pass the
  // owner's user id, never the viewer's — otherwise a staff member generating
  // on behalf would bleed their own Lab data into a founder's deck.
  //   - Founder owns their project (founder_id match) → source = themselves.
  //   - Studio staff (admin/partner) may generate on a founder's behalf →
  //     source = the founder's user account, resolved from projects.founder_id
  //     (same pattern as GET /:id).
  //   - Investors and advisors are deliberately EXCLUDED here (tighter than the
  //     generic canAccessFounderResource bypass): investor project views are
  //     masked via maskFounderForInvestor, and a full demo-day deck would leak
  //     unmasked founder data.
  const sql = getSQL(c.env);
  let project: any;
  let ownerUserId: number | null = null;
  try {
    const rows = await sql`SELECT id, founder_id FROM projects WHERE id = ${projectId}`;
    if (rows.length === 0) return { error: c.json({ error: 'Project not found' }, 404) };
    project = rows[0];
    if (project.founder_id != null) {
      const owners = await sql`SELECT id FROM users WHERE founder_id = ${project.founder_id} ORDER BY id ASC LIMIT 1`;
      if (owners.length) ownerUserId = Number(owners[0].id);
    }
  } finally {
    await sql.end();
  }
  const isStaff = user.role === 'admin' || user.role === 'partner';
  const isOwner = !!user.founder_id && project.founder_id === user.founder_id;
  // Task #1 — accepted co-founders may also generate the deck (advisors are
  // read-only on data; investors/advisors stay excluded). The deck is ALWAYS
  // sourced from the OWNER's Lab data, never the co-founder's.
  let isCofounderMember = false;
  if (!isStaff && !isOwner && user.role !== 'investor') {
    const memberRole = await getProjectMembershipRole(c.env, projectId, user.id);
    isCofounderMember = memberRole === 'cofounder' || memberRole === 'owner';
  }
  if (!isStaff && !isOwner && !isCofounderMember) {
    return { error: c.json({ detail: "Forbidden: you cannot generate this project's deck" }, 403) };
  }
  // Founder generating their own deck sources from themselves (the verified
  // happy path); staff / co-founder generate sources from the resolved owner.
  const sourceUserId = isOwner ? Number(user.id) : ownerUserId;
  if (sourceUserId == null) {
    return { error: c.json({ error: 'This project has no founder account to source deck data from' }, 409) };
  }
  return { sourceUserId };
}

projects.post('/:projectId/spinout-deck', async (c) => {
  const user = await requireAuth(c);
  const projectId = parseInt(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ error: 'Invalid project id' }, 400);

  const access = await resolveSpinoutDeckAccess(c, projectId, user);
  if ('error' in access) return access.error;

  // Manual overrides sit ON TOP of the live assembly — precedence is
  // override > canonical module data > derived placeholder — so a deck edit
  // never has to rewrite the founder's Solution/Problem module to change a
  // sentence. With no stored overrides this is an identity transform.
  const base = await assembleSpinoutDeckData(c.env, access.sourceUserId, projectId);
  const stored = await loadSpinoutDeckOverrides(c.env, projectId);
  const bundle = applySpinoutOverrides(base, stored);
  // Pre-flight preview (?preview=1): the deck page shows the live gaps
  // checklist + draft/ready status BEFORE the founder exports, so missing
  // sections (interviews, market sizing, cap table, …) can be filled in
  // first. Same assembler/gaps as the export — we just skip shipping the
  // heavy DATA + NOTES payload back over the wire.
  if (c.req.query('preview') === '1') {
    return c.json({
      gaps: bundle.gaps,
      gap_sections: bundle.gapSections,
      draft: bundle.draft,
      program_day: bundle.programDay,
      overridden_keys: bundle.overriddenKeys,
    });
  }
  return c.json({
    data: bundle.data,
    notes: bundle.notes,
    gaps: bundle.gaps,
    // Which SLIDE each gap belongs to. The Pitch Deck Builder derives per-slide
    // readiness from this, not from counting entries in `fields` — `fields`
    // omits empty scalars, so a slide rendering template fallback content is
    // indistinguishable there from one the founder actually filled in.
    gap_sections: bundle.gapSections,
    draft: bundle.draft,
    program_day: bundle.programDay,
    fields: bundle.fields,
    overrides: bundle.overrides,
    overridden_keys: bundle.overriddenKeys,
  });
});

// Manual deck overrides — read.
//
// Returns the stored overrides plus the allowlist, so the editor can render a
// "Manual"/"Auto" state per field without hard-coding which fields are
// overridable in the frontend.
projects.get('/:projectId/spinout-deck/overrides', async (c) => {
  const user = await requireAuth(c);
  const projectId = parseInt(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ error: 'Invalid project id' }, 400);

  const access = await resolveSpinoutDeckAccess(c, projectId, user);
  if ('error' in access) return access.error;

  const overrides = await loadSpinoutDeckOverrides(c.env, projectId);
  return c.json({ overrides, overridable_keys: SPINOUT_OVERRIDABLE_KEYS });
});

// Manual deck overrides — write.
//
// Body: { overrides: { 'cover.thesis': '…' } }. A key sent with an empty string
// (or listed in `remove`) is DELETED — that is the "revert to my module data"
// path, and it is why the editor's revert button does not need a second route.
// Unknown keys are rejected with a 400 naming them rather than being dropped
// silently: a typo'd field would otherwise look like a save that did nothing.
projects.put('/:projectId/spinout-deck/overrides', async (c) => {
  const user = await requireAuth(c);
  const projectId = parseInt(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ error: 'Invalid project id' }, 400);

  const access = await resolveSpinoutDeckAccess(c, projectId, user);
  if ('error' in access) return access.error;

  let body: any = {};
  try { body = await c.req.json(); } catch { body = {}; }
  const raw = body?.overrides ?? body ?? {};
  const remove = Array.isArray(body?.remove) ? body.remove.map((k: unknown) => String(k)) : [];

  const { rejected } = sanitizeSpinoutOverrides(raw);
  if (rejected.length) {
    return c.json({
      error: 'Unknown or non-overridable deck fields',
      rejected,
      overridable_keys: SPINOUT_OVERRIDABLE_KEYS,
    }, 400);
  }

  const overrides = await saveSpinoutDeckOverrides(c.env, projectId, Number(user.id), raw, remove);
  return c.json({ overrides, overridable_keys: SPINOUT_OVERRIDABLE_KEYS });
});

// ===========================================================================
// Task #1 — Spin-Out Teams Collaboration: member + invitation management.
//
// All routes here are mounted under /api/projects. Roster MANAGEMENT
// (add/invite/remove/revoke) is owner + admin/partner only; new founders are
// stage-gated (evaluateTeamGate). Accepted co-founders edit project DATA;
// advisors are read-only. Investors are never granted membership.
// ===========================================================================

const MEMBER_ROLES = new Set(['cofounder', 'advisor']);
function sanitizeMemberRole(raw: any): 'cofounder' | 'advisor' {
  const r = String(raw || '').trim().toLowerCase();
  return MEMBER_ROLES.has(r) ? (r as 'cofounder' | 'advisor') : 'cofounder';
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function resolveOwnerUserId(env: Env, project: { id: number; founder_id: number | null }): Promise<number | null> {
  if (project.founder_id == null) return null;
  const sql = getSQL(env);
  try {
    const rows = await sql`SELECT id FROM users WHERE founder_id = ${project.founder_id} ORDER BY id ASC LIMIT 1`;
    return rows.length ? Number(rows[0].id) : null;
  } finally {
    await sql.end();
  }
}

// Mirror the founder_id owner as an `owner` member row so the roster is
// complete. Idempotent — re-runs just re-assert role='owner'.
async function seedOwnerMember(env: Env, project: { id: number; founder_id: number | null }): Promise<number | null> {
  const ownerId = await resolveOwnerUserId(env, project);
  if (ownerId == null) return null;
  await ensureProjectMembershipSchema(env);
  const sql = getSQL(env);
  try {
    await sql`INSERT INTO project_members (project_id, user_id, role, status, source, accepted_at)
      VALUES (${project.id}, ${ownerId}, 'owner', 'accepted', 'owner_seed', datetime('now'))
      ON CONFLICT(project_id, user_id) DO UPDATE SET role='owner', status='accepted', removed_at=NULL, updated_at=datetime('now')`;
  } finally {
    await sql.end();
  }
  return ownerId;
}

// GET /api/projects/:id/members — roster + (managers only) pending invitations
// + the stage gate. Accepted members may view; only managers get can_manage.
projects.get('/:id/members', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid project id' }, 400);
  await ensureProjectMembershipSchema(c.env);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id, founder_id FROM projects WHERE id = ${id} AND deleted_at IS NULL`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Project not found' }, 404); }
  const project = rows[0];
  await sql.end();

  const manager = isProjectManager(user, project);
  let canView = manager;
  if (!canView && user.role !== 'investor') {
    canView = await canAccessProject(c.env, user, project, { write: false });
  }
  if (!canView) return c.json({ detail: 'Forbidden: you do not have access to this project' }, 403);

  await seedOwnerMember(c.env, project);

  const sql2 = getSQL(c.env);
  try {
    const members = await sql2`SELECT pm.id, pm.user_id, pm.role, pm.source, pm.accepted_at, pm.created_at,
        u.uid, u.name, u.email, u.role AS account_role
      FROM project_members pm JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = ${id} AND pm.status = 'accepted'
      ORDER BY CASE pm.role WHEN 'owner' THEN 0 WHEN 'cofounder' THEN 1 ELSE 2 END, pm.created_at ASC`;
    let invitations: any[] = [];
    if (manager) {
      invitations = await sql2`SELECT id, role, status, source, invitee_email, invitee_user_id, expires_at, created_at
        FROM project_member_invitations
        WHERE project_id = ${id} AND status = 'pending'
        ORDER BY created_at DESC`;
    }
    const gate = evaluateTeamGate(user as any);
    // Caller's effective edit rights, so the UI can show "Edit Project" to
    // co-founders/owner/managers and hide it from advisors/investors.
    const myRole = await getProjectMembershipRole(c.env, id, user.id);
    const canEdit = manager || myRole === 'owner' || myRole === 'cofounder';
    return c.json({
      members,
      invitations,
      can_manage: manager,
      can_edit: canEdit,
      my_role: myRole,
      locked: manager ? gate.locked : false,
      gate_reason: manager ? gate.reason : null,
      unlock_week: gate.unlock_week,
    });
  } finally {
    await sql2.end();
  }
});

// Shared manager + stage-gate guard for mutation routes. Returns the project
// row (id, founder_id) on success, or a Response to short-circuit.
async function requireRosterManager(c: any, user: any, projectId: number): Promise<{ project: any } | { res: Response }> {
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id, founder_id FROM projects WHERE id = ${projectId} AND deleted_at IS NULL`;
  await sql.end();
  if (rows.length === 0) return { res: c.json({ error: 'Project not found' }, 404) };
  const project = rows[0];
  if (!isProjectManager(user, project)) {
    return { res: c.json({ detail: 'Forbidden: only the project owner can manage the team' }, 403) };
  }
  const gate = evaluateTeamGate(user as any);
  if (gate.locked) {
    return { res: c.json({ detail: gate.reason, code: 'team_locked', unlock_week: gate.unlock_week }, 403) };
  }
  return { project };
}

// POST /api/projects/:id/members — direct add (mode: user_id | cofounder_match).
projects.post('/:id/members', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid project id' }, 400);
  await ensureProjectMembershipSchema(c.env);
  const guard = await requireRosterManager(c, user, id);
  if ('res' in guard) return guard.res;
  const project = guard.project;

  const body = await c.req.json().catch(() => ({}));
  const mode = String(body.mode || 'user_id').trim();
  const role = sanitizeMemberRole(body.role);

  const sql = getSQL(c.env);
  try {
    let targetUserId: number | null = null;
    let connectionId: number | null = null;

    if (mode === 'cofounder_match') {
      const ownerUserId = await resolveOwnerUserId(c.env, project);
      if (ownerUserId == null) return c.json({ detail: 'Project has no founder account' }, 409);
      const connUid = String(body.connection_uid || '').trim();
      if (!connUid) return c.json({ detail: 'connection_uid is required' }, 400);
      const conns = await sql`SELECT id, user_a_id, user_b_id, status FROM cofounder_connections WHERE uid = ${connUid} LIMIT 1`;
      if (conns.length === 0) return c.json({ detail: 'Connection not found' }, 404);
      const conn = conns[0];
      if (conn.status !== 'active') return c.json({ detail: 'Connection must be active (NDA signed by both sides)' }, 400);
      if (conn.user_a_id !== ownerUserId && conn.user_b_id !== ownerUserId) {
        return c.json({ detail: 'This connection does not belong to the project owner' }, 403);
      }
      targetUserId = conn.user_a_id === ownerUserId ? Number(conn.user_b_id) : Number(conn.user_a_id);
      connectionId = Number(conn.id);
    } else {
      // mode user_id — accept numeric id or public uid.
      if (body.user_id != null && Number.isFinite(Number(body.user_id))) {
        const r = await sql`SELECT id FROM users WHERE id = ${Number(body.user_id)} LIMIT 1`;
        if (r.length) targetUserId = Number(r[0].id);
      } else if (body.user_uid) {
        const r = await sql`SELECT id FROM users WHERE uid = ${String(body.user_uid)} LIMIT 1`;
        if (r.length) targetUserId = Number(r[0].id);
      } else {
        return c.json({ detail: 'user_id or user_uid is required' }, 400);
      }
    }

    if (targetUserId == null) return c.json({ detail: 'User not found' }, 404);

    const trows = await sql`SELECT id, role, is_active, founder_id FROM users WHERE id = ${targetUserId} LIMIT 1`;
    if (trows.length === 0 || !trows[0].is_active) return c.json({ detail: 'User not found' }, 404);
    const target = trows[0];
    if (target.role === 'investor') return c.json({ detail: 'Investors cannot be added as project members' }, 400);
    // Already the owner? Nothing to add.
    if (project.founder_id != null && Number(target.founder_id) === Number(project.founder_id)) {
      return c.json({ detail: 'This user already owns the project' }, 409);
    }

    // Audit invitation row (accepted immediately for direct add).
    const [inv] = await sql`INSERT INTO project_member_invitations
        (project_id, role, status, source, invitee_user_id, cofounder_connection_id, invited_by_user_id, accepted_by_user_id, accepted_at)
      VALUES (${id}, ${role}, 'accepted', ${mode}, ${targetUserId}, ${connectionId}, ${user.id}, ${targetUserId}, datetime('now'))
      RETURNING id`;

    await sql`INSERT INTO project_members
        (project_id, user_id, role, status, source, invitation_id, cofounder_connection_id, added_by_user_id, accepted_at)
      VALUES (${id}, ${targetUserId}, ${role}, 'accepted', ${mode}, ${inv.id}, ${connectionId}, ${user.id}, datetime('now'))
      ON CONFLICT(project_id, user_id) DO UPDATE SET
        role=excluded.role, status='accepted', source=excluded.source,
        invitation_id=excluded.invitation_id, cofounder_connection_id=excluded.cofounder_connection_id,
        accepted_at=datetime('now'), removed_at=NULL, updated_at=datetime('now')`;

    return c.json({ ok: true, user_id: targetUserId, role });
  } finally {
    await sql.end();
  }
});

// POST /api/projects/:id/invitations — tokenized invite (mode: email | link).
projects.post('/:id/invitations', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid project id' }, 400);
  await ensureProjectMembershipSchema(c.env);
  const guard = await requireRosterManager(c, user, id);
  if ('res' in guard) return guard.res;

  const body = await c.req.json().catch(() => ({}));
  const mode = String(body.mode || 'link').trim();
  const role = sanitizeMemberRole(body.role);
  let inviteeEmail: string | null = null;
  if (mode === 'email') {
    inviteeEmail = normalizeEmail(body.email);
    if (!inviteeEmail || !isValidEmail(inviteeEmail)) return c.json({ detail: 'A valid email is required' }, 400);
  }

  const token = generateToken();
  const tokenHash = await hashInviteToken(token);
  const sql = getSQL(c.env);
  try {
    const [inv] = await sql`INSERT INTO project_member_invitations
        (project_id, role, status, source, invitee_email, token_hash, invited_by_user_id, expires_at)
      VALUES (${id}, ${role}, 'pending', ${mode}, ${inviteeEmail}, ${tokenHash}, ${user.id}, datetime('now','+14 days'))
      RETURNING id, role, status, source, invitee_email, expires_at, created_at`;
    return c.json({
      invitation: inv,
      token, // returned ONCE — only the hash is persisted.
      accept_path: `/projects/invitations/accept?token=${token}`,
    });
  } finally {
    await sql.end();
  }
});

// POST /api/projects/:id/invitations/:invId/revoke
projects.post('/:id/invitations/:invId/revoke', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  const invId = parseInt(c.req.param('invId'));
  if (!Number.isFinite(id) || !Number.isFinite(invId)) return c.json({ error: 'Invalid id' }, 400);
  await ensureProjectMembershipSchema(c.env);
  const guard = await requireRosterManager(c, user, id);
  if ('res' in guard) return guard.res;
  const sql = getSQL(c.env);
  try {
    await sql`UPDATE project_member_invitations SET status='revoked', updated_at=datetime('now')
      WHERE id = ${invId} AND project_id = ${id} AND status='pending'`;
    return c.json({ ok: true });
  } finally {
    await sql.end();
  }
});

// DELETE /api/projects/:id/members/:userId — remove a member (never the owner).
projects.delete('/:id/members/:userId', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  const memberUserId = parseInt(c.req.param('userId'));
  if (!Number.isFinite(id) || !Number.isFinite(memberUserId)) return c.json({ error: 'Invalid id' }, 400);
  await ensureProjectMembershipSchema(c.env);
  const guard = await requireRosterManager(c, user, id);
  if ('res' in guard) return guard.res;
  const project = guard.project;
  const sql = getSQL(c.env);
  try {
    const ownerUserId = await resolveOwnerUserId(c.env, project);
    if (ownerUserId != null && memberUserId === ownerUserId) {
      return c.json({ detail: 'The project owner cannot be removed' }, 400);
    }
    await sql`UPDATE project_members SET status='removed', removed_at=datetime('now'), updated_at=datetime('now')
      WHERE project_id = ${id} AND user_id = ${memberUserId} AND role <> 'owner'`;
    // Cancel any still-pending invitations for that user.
    await sql`UPDATE project_member_invitations SET status='revoked', updated_at=datetime('now')
      WHERE project_id = ${id} AND invitee_user_id = ${memberUserId} AND status='pending'`;
    return c.json({ ok: true });
  } finally {
    await sql.end();
  }
});

// POST /api/projects/invitations/accept — bind a tokenized invite to the
// authed user. Static path; registered after the parametric routes above but
// Hono matches the literal segment first.
projects.post('/invitations/accept', async (c) => {
  const user = await requireAuth(c);
  if (user.role === 'investor') return c.json({ detail: 'Investors cannot join projects as members' }, 403);
  const body = await c.req.json().catch(() => ({}));
  const token = String(body.token || '').trim();
  if (!token) return c.json({ detail: 'token is required' }, 400);
  await ensureProjectMembershipSchema(c.env);
  const tokenHash = await hashInviteToken(token);
  const sql = getSQL(c.env);
  try {
    const invs = await sql`SELECT * FROM project_member_invitations WHERE token_hash = ${tokenHash} LIMIT 1`;
    if (invs.length === 0) return c.json({ detail: 'Invitation not found' }, 404);
    const inv = invs[0];
    if (inv.status !== 'pending') return c.json({ detail: 'This invitation is no longer valid', code: inv.status }, 410);
    // Expiry check (datetime() string comparison — both sides same format).
    const exp = await sql`SELECT CASE WHEN ${inv.expires_at} IS NOT NULL AND ${inv.expires_at} < datetime('now') THEN 1 ELSE 0 END AS expired`;
    if (exp.length && Number(exp[0].expired) === 1) {
      await sql`UPDATE project_member_invitations SET status='expired', updated_at=datetime('now') WHERE id = ${inv.id}`;
      return c.json({ detail: 'This invitation has expired', code: 'expired' }, 410);
    }
    // Binding: a user-scoped invite must match the authed user; an email
    // invite must match the authed user's email; a bare link binds to anyone.
    if (inv.invitee_user_id != null && Number(inv.invitee_user_id) !== Number(user.id)) {
      return c.json({ detail: 'This invitation was issued to a different account' }, 403);
    }
    if (inv.invitee_email != null && normalizeEmail(user.email) !== normalizeEmail(inv.invitee_email)) {
      return c.json({ detail: 'This invitation was issued to a different email address' }, 403);
    }

    const prows = await sql`SELECT id, founder_id FROM projects WHERE id = ${inv.project_id} AND deleted_at IS NULL`;
    if (prows.length === 0) return c.json({ detail: 'Project no longer exists' }, 404);
    const project = prows[0];
    // Owner accepting their own invite is a no-op (they already own it).
    if (project.founder_id != null && !!user.founder_id && Number(user.founder_id) === Number(project.founder_id)) {
      await sql`UPDATE project_member_invitations SET status='accepted', accepted_by_user_id=${user.id}, accepted_at=datetime('now'), updated_at=datetime('now') WHERE id = ${inv.id}`;
      return c.json({ ok: true, project_id: project.id, role: 'owner', already_owner: true });
    }

    await seedOwnerMember(c.env, project);
    const role = sanitizeMemberRole(inv.role);
    await sql`INSERT INTO project_members
        (project_id, user_id, role, status, source, invitation_id, cofounder_connection_id, added_by_user_id, accepted_at)
      VALUES (${project.id}, ${user.id}, ${role}, 'accepted', ${inv.source}, ${inv.id}, ${inv.cofounder_connection_id}, ${inv.invited_by_user_id}, datetime('now'))
      ON CONFLICT(project_id, user_id) DO UPDATE SET
        role=excluded.role, status='accepted', source=excluded.source,
        invitation_id=excluded.invitation_id, accepted_at=datetime('now'), removed_at=NULL, updated_at=datetime('now')`;
    await sql`UPDATE project_member_invitations SET status='accepted', invitee_user_id=COALESCE(invitee_user_id, ${user.id}), accepted_by_user_id=${user.id}, accepted_at=datetime('now'), updated_at=datetime('now') WHERE id = ${inv.id}`;
    return c.json({ ok: true, project_id: project.id, role });
  } finally {
    await sql.end();
  }
});

export default projects;
