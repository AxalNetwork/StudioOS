/**
 * D588 (#1215) — share a Spin-Out Lab scoring report with one named account.
 *
 * The founder (the project's owner) mints the link. Only that named account,
 * signed in, can open it. An unknown, expired, used-up, revoked, or
 * wrong-account token answers the same 404. The raw token is returned once,
 * at mint, and stored only as a SHA-256 hash.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import type { User } from '../types';
import { activeCompanyFor } from '../middleware/activeCompany';
import { projectInActiveCompany } from '../services/tenancyScope';
import { refuse } from '../util/refusal';
import { mintShareToken, sha256Hex } from '../services/shareLink';
import { verifyScoreHash } from '../services/scoreIntegrity';
import {
  LAB_REPORT_KIND,
  LAB_SHARE_SCOPE,
  freezeOfficialScore,
  isLabShareAudience,
  redactLabReport,
  type LabReportSnapshot,
  type LabShareAudience,
} from '../services/labReportShare';

const r = new Hono<{ Bindings: Env }>();

const UNAVAILABLE = {
  code: 'lab_report_share_unavailable',
  message: 'This link is not available.',
};

const DAY_SECONDS = 86_400;

/** `mintShareToken` returns an ISO instant. SQLite `datetime()` reads `YYYY-MM-DD HH:MM:SS`. */
function sqliteUtc(iso: string): string {
  return iso.slice(0, 19).replace('T', ' ');
}
const MIN_DAYS = 1;
const MAX_DAYS = 90;
const MIN_OPENS = 1;
const MAX_OPENS = 500;

function unavailable(c: Parameters<typeof refuse>[0]) {
  return refuse(c, 404, UNAVAILABLE);
}

function wholeIn(v: unknown, lo: number, hi: number): number | null {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) return null;
  return v;
}

async function projectOwner(env: Env, projectId: number): Promise<{ id: number; founder_id: number | null; company_id: number | null } | null> {
  return env.DB.prepare('SELECT id, founder_id, company_id FROM projects WHERE id = ?')
    .bind(projectId)
    .first<{ id: number; founder_id: number | null; company_id: number | null }>();
}

async function hiddenByCompany(c: Parameters<typeof activeCompanyFor>[0], user: User, project: { founder_id: number | null; company_id?: number | null }): Promise<boolean> {
  if (user.role !== 'founder' || user.founder_id !== project.founder_id) return false;
  return !projectInActiveCompany(await activeCompanyFor(c, user), project);
}

function ownsProject(user: User, project: { founder_id: number | null }): boolean {
  return (user.role === 'founder' || user.role === 'exploring')
    && user.founder_id != null
    && user.founder_id === project.founder_id;
}

async function logShare(env: Env, action: string, details: string, userId: number, projectId: number) {
  await env.DB.prepare(
    `INSERT INTO activity_logs (action, details, actor, user_id, project_id) VALUES (?, ?, ?, ?, ?)`,
  ).bind(action, details, String(userId), userId, projectId).run();
}

r.post('/', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    return refuse(c, 400, { code: 'invalid_body', message: 'The share could not be read.' });
  }
  if (body.consent !== true) {
    return refuse(c, 400, {
      code: 'consent_required',
      message: 'Say that you agree to share this report before the link is created.',
    });
  }
  if (body.report_kind !== undefined && body.report_kind !== LAB_REPORT_KIND) {
    return refuse(c, 400, {
      code: 'report_kind_unsupported',
      message: 'Only a scoring report can be shared.',
    });
  }
  if (!isLabShareAudience(body.audience)) {
    return refuse(c, 400, {
      code: 'audience_invalid',
      message: 'Choose summary or dimensions.',
    });
  }
  const audience = body.audience as LabShareAudience;
  const days = wholeIn(body.expires_in_days, MIN_DAYS, MAX_DAYS);
  const openLimit = wholeIn(body.open_limit, MIN_OPENS, MAX_OPENS);
  if (days === null || openLimit === null) {
    return refuse(c, 400, {
      code: 'limit_invalid',
      message: 'Expiry is 1 to 90 days, and the open limit is 1 to 500.',
    });
  }
  const projectId = wholeIn(body.project_id, 1, Number.MAX_SAFE_INTEGER);
  if (projectId === null) {
    return refuse(c, 400, { code: 'project_invalid', message: 'Name the project this report belongs to.' });
  }
  const email = typeof body.grantee_email === 'string' ? body.grantee_email.trim().toLowerCase() : '';
  if (!email.includes('@')) {
    return refuse(c, 400, { code: 'grantee_email_invalid', message: 'Name the account by its email.' });
  }

  const project = await projectOwner(c.env, projectId);
  if (!project || await hiddenByCompany(c, user, project)) {
    return refuse(c, 404, { code: 'project_not_found', message: 'That project is not on this account.' });
  }
  if (!ownsProject(user, project)) {
    return refuse(c, 403, { code: 'not_report_owner', message: 'Only the person who owns this report can share it.' });
  }

  const grantee = await c.env.DB.prepare('SELECT id FROM users WHERE LOWER(email) = ? AND is_active = 1')
    .bind(email)
    .first<{ id: number }>();
  if (!grantee) {
    return refuse(c, 404, { code: 'grantee_not_found', message: 'No active account has that email.' });
  }

  const score = await c.env.DB.prepare(
    `SELECT id, project_id, total_score, tier, created_at,
            market_size, market_urgency, market_trend, market_total,
            team_expertise, team_execution, team_network, team_total,
            product_mvp_time, product_complexity, product_dependency, product_total,
            capital_cost_mvp, capital_time_revenue, capital_burn_traction, capital_total,
            fit_alignment, fit_synergy, fit_total,
            distribution_channels, distribution_virality, distribution_total,
            is_sandbox, integrity_hash, integrity_version
       FROM score_snapshots
      WHERE project_id = ? AND is_sandbox = 0
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT 1`,
  ).bind(projectId).first<Record<string, unknown>>();
  if (!score) {
    return refuse(c, 409, {
      code: 'no_official_score',
      message: 'There is no official scoring run to share. A practice run is not shared.',
    });
  }
  const verified = await verifyScoreHash(c.env, {
    project_id: Number(score.project_id),
    total_score: Number(score.total_score),
    integrity_hash: score.integrity_hash == null ? null : String(score.integrity_hash),
    integrity_version: score.integrity_version == null ? null : String(score.integrity_version),
    created_at: String(score.created_at),
  });
  if (!verified.valid) {
    return refuse(c, 409, {
      code: 'score_not_shareable',
      message: 'The latest official scoring run cannot be shared until its record checks out.',
    });
  }

  const snapshot = freezeOfficialScore(score);
  const minted = await mintShareToken(
    c.env,
    `lab-report:${LAB_REPORT_KIND}:${projectId}:${audience}:${grantee.id}:${crypto.randomUUID()}`,
    days * DAY_SECONDS,
    String(user.id),
  );
  const tokenHash = await sha256Hex(minted.token);
  await c.env.DB.prepare(
    `INSERT INTO lab_report_shares (
       owner_user_id, report_kind, project_id, audience, grantee_user_id,
       token_hash, expires_at, open_limit, consented_at, snapshot_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
  ).bind(
    user.id, LAB_REPORT_KIND, projectId, audience, grantee.id,
    tokenHash, sqliteUtc(minted.expires_at), openLimit, JSON.stringify(snapshot),
  ).run();
  const created = await c.env.DB.prepare(
    'SELECT id FROM lab_report_shares WHERE token_hash = ?',
  ).bind(tokenHash).first<{ id: number }>();
  const id = created?.id;
  if (!id) {
    return refuse(c, 500, { code: 'share_not_recorded', message: 'The link was not recorded.' });
  }
  await logShare(
    c.env,
    'lab_report_share_created',
    `audience=${audience} share_id=${id}`,
    user.id,
    projectId,
  );
  const scope = LAB_SHARE_SCOPE[audience];
  return c.json({
    id,
    token: minted.token,
    share_path: `/share/lab-report/${minted.token}`,
    audience,
    shows: scope.shows,
    hides: scope.hides,
    expires_at: sqliteUtc(minted.expires_at),
    open_limit: openLimit,
    grantee_user_id: grantee.id,
  }, 201);
});

r.get('/', async (c) => {
  const user = await requireAuth(c);
  const projectId = wholeIn(Number(c.req.query('project_id')), 1, Number.MAX_SAFE_INTEGER);
  if (projectId === null) {
    return refuse(c, 400, { code: 'project_invalid', message: 'Name the project whose links you want.' });
  }
  const project = await projectOwner(c.env, projectId);
  if (!project || await hiddenByCompany(c, user, project)) {
    return refuse(c, 404, { code: 'project_not_found', message: 'That project is not on this account.' });
  }
  if (!ownsProject(user, project)) {
    return refuse(c, 403, { code: 'not_report_owner', message: 'Only the person who owns this report can see its links.' });
  }
  const rows = await c.env.DB.prepare(
    `SELECT s.id, s.report_kind, s.project_id, s.audience, s.grantee_user_id,
            u.email AS grantee_email, s.expires_at, s.open_limit, s.opens,
            s.revoked_at, s.created_at
       FROM lab_report_shares s
       JOIN users u ON u.id = s.grantee_user_id
      WHERE s.owner_user_id = ? AND s.project_id = ?
      ORDER BY s.id DESC`,
  ).bind(user.id, projectId).all<Record<string, unknown>>();
  return c.json({ items: rows.results || [] });
});

r.post('/:id/revoke', async (c) => {
  const user = await requireAuth(c);
  const id = wholeIn(Number(c.req.param('id')), 1, Number.MAX_SAFE_INTEGER);
  if (id === null) return unavailable(c);
  const row = await c.env.DB.prepare(
    'SELECT id, owner_user_id, project_id, revoked_at FROM lab_report_shares WHERE id = ?',
  ).bind(id).first<{ id: number; owner_user_id: number; project_id: number; revoked_at: string | null }>();
  if (!row || row.owner_user_id !== user.id) return unavailable(c);
  if (!row.revoked_at) {
    await c.env.DB.prepare(
      `UPDATE lab_report_shares SET revoked_at = datetime('now') WHERE id = ? AND owner_user_id = ? AND revoked_at IS NULL`,
    ).bind(id, user.id).run();
    await logShare(c.env, 'lab_report_share_revoked', `share_id=${id}`, user.id, row.project_id);
  }
  return c.json({ id, revoked: true });
});

r.get('/open/:token', async (c) => {
  const user = await requireAuth(c);
  const token = c.req.param('token');
  const tokenHash = await sha256Hex(token);
  const claimed = await c.env.DB.prepare(
    `UPDATE lab_report_shares
        SET opens = opens + 1
      WHERE token_hash = ?
        AND grantee_user_id = ?
        AND revoked_at IS NULL
        AND opens < open_limit
        AND datetime(expires_at) > datetime('now')`,
  ).bind(tokenHash, user.id).run();
  if (Number((claimed as { meta?: { changes?: number } }).meta?.changes) !== 1) return unavailable(c);
  const row = await c.env.DB.prepare(
    'SELECT audience, snapshot_json FROM lab_report_shares WHERE token_hash = ? AND grantee_user_id = ?',
  ).bind(tokenHash, user.id).first<{ audience: string; snapshot_json: string }>();
  if (!row || !isLabShareAudience(row.audience)) return unavailable(c);
  let snapshot: LabReportSnapshot;
  try {
    snapshot = JSON.parse(row.snapshot_json) as LabReportSnapshot;
  } catch {
    return unavailable(c);
  }
  return c.json(redactLabReport(snapshot, row.audience));
});

export default r;
