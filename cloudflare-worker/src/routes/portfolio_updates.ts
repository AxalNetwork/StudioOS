/**
 * Portfolio-company update inbox (Support stage).
 *
 * Founders submit periodic updates (KPIs + narrative) for projects they own;
 * investors/partners/admin read the resulting feed. Portfolio Health is
 * computed — this is the missing channel for founder-submitted signal.
 *
 * Mounted at /api/portfolio-updates. Dual-audience, so it is NOT behind a
 * paywall prefix; access is enforced per-role in each handler.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, canAccessFounderResource } from '../auth';
import { isAdmin, isInvestor, isPartner, isFounder, mapError, nowIso, newUid, jload } from './_t13t14t15_helpers';
import { notify } from '../services/notify';
import { ensureFollowsSchema } from './follows';
import { investorProjectIds, investorActiveCompany } from './_investorProjectScope';
import { canAccessProject, getMemberProjectIds } from '../services/projectAccess';
import { roundCallsEnabled } from '../services/roundCallPolicy';
import {
  ASK_KINDS, ASK_MODULE, LineError, METRIC_KEYS, buildMetrics, canAskAgain, cleanAudience, cleanLines, cleanMetrics,
  draftLines, landReply, noMetrics, payloadFor, periodFacts,
  type Audience, type AskKind, type Snapshot, type ShippedItem,
} from '../services/updateShare';

import { openCallForUpdate, openCallSummary, updateAskLinks, replyToLinkedCall, RoundCallError } from '../services/roundCalls';

const r = new Hono<{ Bindings: Env }>();

// Task #66 — when a portfolio update goes live, notify everyone following
// the startup. Best-effort: never blocks or fails the submit. Excludes the
// author so founders don't get pinged about their own update.
async function notifyProjectFollowers(env: Env, projectId: number, update: UpdateRow): Promise<void> {
  try {
    await ensureFollowsSchema(env);
    const proj = await env.DB.prepare(
      'SELECT uid, name FROM projects WHERE id = ? AND deleted_at IS NULL',
    ).bind(projectId).first<{ uid: string; name: string }>();
    if (!proj) return;
    const followers = await env.DB.prepare(
      "SELECT follower_user_id AS uid FROM follows WHERE entity_type = 'project' AND entity_id = ?",
    ).bind(projectId).all<{ uid: number }>();
    for (const f of followers.results || []) {
      if (f.uid === update.author_user_id) continue;
      await notify(env, {
        userId: f.uid,
        type: 'followed_entity_news',
        title: `${proj.name} posted an update`,
        body: update.title || null,
        link: `/startups/${proj.uid}`,
        payload: { entity_type: 'project', handle: proj.uid, update_uid: update.uid },
        category: 'proactive_nudges',
      });
    }
  } catch (e) {
    console.warn('[portfolio_updates] follower fan-out failed', e);
  }
}

type UpdateRow = {
  id: number; uid: string; project_id: number; author_user_id: number;
  period: string | null; title: string; body: string | null; kpis_json: string | null;
  status: string; submitted_at: string | null; created_at: string; updated_at: string;
  metrics_json?: string | null;
};

function isInvestorSide(user: User): boolean {
  return isAdmin(user) || isInvestor(user) || isPartner(user);
}

/*
 * D889 (#2438): who reads a submitted update besides its founder and an admin.
 * Two things must hold, or it fails closed:
 *  - the relationship: an investor sees the company (`investorProjectIds`); a
 *    partner is an accepted member of the venture (`project_members`);
 *  - the founder chose them: their audience is switched on in `audience_json`
 *    as an explicit JSON `true`, or they are a recorded recipient of that
 *    audience in `update_recipients`. A missing, malformed or partial grant is
 *    no grant, so an update with no audience recorded (one made before the
 *    share sheet) stays with its founder and admins until it is shared again.
 * Each fragment takes one bound parameter: the reader's user id.
 */
const INVESTOR_GRANT = `(EXISTS (SELECT 1 FROM update_recipients ur WHERE ur.update_id = portfolio_updates.id AND ur.user_id = ? AND ur.audience = 'investor')
  OR (CASE WHEN json_valid(portfolio_updates.audience_json) THEN json_type(portfolio_updates.audience_json, '$.investors') END) = 'true')`;
const TEAM_GRANT = `(EXISTS (SELECT 1 FROM update_recipients ur WHERE ur.update_id = portfolio_updates.id AND ur.user_id = ? AND ur.audience = 'team')
  OR (CASE WHEN json_valid(portfolio_updates.audience_json) THEN json_type(portfolio_updates.audience_json, '$.team') END) = 'true')`;
// The one-row checks, written out in full (as `_investorProjectScope.ts` does) so no query text is assembled.
const INVESTOR_GRANTED = `SELECT 1 AS ok FROM portfolio_updates WHERE id = ? AND (EXISTS (SELECT 1 FROM update_recipients ur WHERE ur.update_id = portfolio_updates.id AND ur.user_id = ? AND ur.audience = 'investor')
  OR (CASE WHEN json_valid(portfolio_updates.audience_json) THEN json_type(portfolio_updates.audience_json, '$.investors') END) = 'true')`;
const TEAM_GRANTED = `SELECT 1 AS ok FROM portfolio_updates WHERE id = ? AND (EXISTS (SELECT 1 FROM update_recipients ur WHERE ur.update_id = portfolio_updates.id AND ur.user_id = ? AND ur.audience = 'team')
  OR (CASE WHEN json_valid(portfolio_updates.audience_json) THEN json_type(portfolio_updates.audience_json, '$.team') END) = 'true')`;

/** The ventures whose updates this non-admin reader may be shown, by their relationship (D889). */
async function readerProjectIds(c: any, user: User): Promise<number[]> {
  if (isInvestor(user)) return (await investorProjectIds(c.env, user, await investorActiveCompany(c, user))) || [];
  if (isPartner(user)) return getMemberProjectIds(c.env, user.id);
  return [];
}

async function projectFounderId(env: Env, projectId: number): Promise<number | null> {
  const p = await env.DB.prepare('SELECT founder_id FROM projects WHERE id = ? AND deleted_at IS NULL').bind(projectId).first<{ founder_id: number | null }>();
  return p ? (p.founder_id ?? null) : undefined as any;
}

async function canShareUpdate(env: Env, user: User, projectId: number, founderId: number | null): Promise<boolean> {
  return isAdmin(user) || (user.role !== 'partner' && await canAccessProject(env, user, { id: projectId, founder_id: founderId }, { write: true }));
}

const shareDenied = { detail: 'You can read this venture but not share its updates.', code: 'share_not_allowed' };

/**
 * D1057 (#2927, #2427 finding 4): the figures an update carries, each with its
 * source. A Share an update row stores them in `metrics_json` (D654), keyed
 * by `METRIC_KEYS` (mrr, growth, customers, burn, runway); part 3's
 * `REPORT_FIGURES` keys report figures the same way. A row from the older KPI
 * form stores bare values in `kpis_json`, which carry no source. A figure
 * nothing recorded stays null with its reason, never 0.
 */
export function updateFigures(u: { kpis_json?: string | null; metrics_json?: string | null }): {
  figures: Array<{ key: string; label: string; value: number | null; unit: string; source: string | null; as_of: string | null; reason: string | null }>;
  kpis: Record<string, unknown>;
} {
  const stored = jload(u.kpis_json ?? null, {});
  const legacy = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored as Record<string, unknown> : {};
  // Read as stored: the save already checked each figure against the period's snapshots (`cleanMetrics`),
  // so a second pass with no verified list would relabel every source "typed".
  const raw = jload(u.metrics_json ?? null, []);
  const figures = (Array.isArray(raw) ? raw : []).flatMap((m: any) => {
    if (!m || typeof m !== 'object' || !(METRIC_KEYS as readonly string[]).includes(String(m.key))) return [];
    const value = typeof m.value === 'number' && Number.isFinite(m.value) ? m.value : null;
    const source = typeof m.source === 'string' && m.source.trim() ? m.source.trim() : null;
    // A recorded figure with no source is not one the update may show (D654's rule).
    if (value != null && !source) return [];
    return [{
      key: String(m.key), label: String(m.label ?? m.key).slice(0, 60), value,
      unit: ['usd', 'pct', 'count', 'months'].includes(String(m.unit)) ? String(m.unit) : 'count',
      source: value == null ? null : source,
      as_of: value == null ? null : (typeof m.as_of === 'string' ? m.as_of.slice(0, 10) : null),
      reason: value == null ? (typeof m.reason === 'string' && m.reason ? m.reason : 'Not recorded') : null,
    }];
  });
  // `kpis` stays the flat map the pages already read; a sourced figure fills a key the KPI form left empty.
  const kpis: Record<string, unknown> = {};
  for (const f of figures) if (f.value != null) kpis[f.key] = f.value;
  return { figures, kpis: { ...kpis, ...legacy } };
}

async function dto(env: Env, u: UpdateRow): Promise<any> {
  const proj = await env.DB.prepare('SELECT id, uid, name, sector, stage, status FROM projects WHERE id = ? AND deleted_at IS NULL').bind(u.project_id).first<any>();
  const { figures, kpis } = updateFigures(u);
  return {
    id: u.id, uid: u.uid, project_id: u.project_id, author_user_id: u.author_user_id,
    project: proj || null,
    period: u.period, title: u.title, body: u.body, kpis, figures,
    status: u.status, submitted_at: u.submitted_at,
    created_at: u.created_at, updated_at: u.updated_at,
  };
}

// GET /api/portfolio-updates — investor inbox (submitted); founders see own drafts too
r.get('/', async (c) => {
  try {
    const user = await requireAuth(c);
    const projectId = c.req.query('project_id');
    const period = c.req.query('period');
    let where = '1=1';
    const params: any[] = [];
    if (isInvestorSide(user)) {
      where += " AND status = 'submitted'";
      // D889: an admin reads every submitted update; anyone else needs the relationship and the founder's grant.
      if (!isAdmin(user)) {
        const ids = await readerProjectIds(c, user);
        if (ids.length === 0) where += ' AND 1 = 0';
        else {
          where += ` AND project_id IN (${ids.map(() => '?').join(',')})`;
          params.push(...ids);
          where += ` AND ${isInvestor(user) ? INVESTOR_GRANT : TEAM_GRANT}`;
          params.push(user.id);
        }
      }
    } else if (isFounder(user) && user.founder_id) {
      // Founders only see updates for projects they own.
      where += ' AND project_id IN (SELECT id FROM projects WHERE founder_id = ?)';
      params.push(user.founder_id);
    } else {
      return c.json({ items: [] });
    }
    if (projectId) { where += ' AND project_id = ?'; params.push(Number(projectId)); }
    if (period) { where += ' AND period = ?'; params.push(String(period)); }
    const rows = await c.env.DB.prepare(
      `SELECT * FROM portfolio_updates WHERE ${where} ORDER BY COALESCE(submitted_at, updated_at) DESC LIMIT 500`
    ).bind(...params).all<UpdateRow>();
    const items: any[] = [];
    for (const u of (rows.results || []) as UpdateRow[]) items.push(await dto(c.env, u));
    return c.json({ items });
  } catch (e) { return mapError(c, e); }
});

// POST /api/portfolio-updates — founder (own project) or admin creates an update
r.post('/', async (c) => {
  try {
    const user = await requireAuth(c);
    const body = await c.req.json().catch(() => ({} as any));
    const projectId = Number(body.project_id);
    const title = body.title ? String(body.title).slice(0, 300) : null;
    if (!Number.isFinite(projectId) || !title) return c.json({ detail: 'project_id and title required' }, 400);
    const founderId = await projectFounderId(c.env, projectId);
    if (founderId === undefined) return c.json({ detail: 'Project not found' }, 404);
    // Only the owning founder (or admin) may post an update for a project.
    if (!(await canShareUpdate(c.env, user, projectId, founderId))) return c.json(shareDenied, 403);
    const submit = body.status === 'submitted';
    const uid = newUid();
    const ins = await c.env.DB.prepare(
      `INSERT INTO portfolio_updates (uid, project_id, author_user_id, period, title, body, kpis_json, status, submitted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      uid, projectId, user.id,
      body.period ? String(body.period).slice(0, 32) : null,
      title,
      body.body ? String(body.body).slice(0, 20000) : null,
      body.kpis != null ? JSON.stringify(body.kpis) : null,
      submit ? 'submitted' : 'draft',
      submit ? nowIso() : null,
      nowIso(), nowIso(),
    ).run();
    const u = await c.env.DB.prepare('SELECT * FROM portfolio_updates WHERE id = ?').bind((ins as any).meta?.last_row_id).first<UpdateRow>();
    if (submit && u) {
      c.executionCtx.waitUntil(notifyProjectFollowers(c.env, projectId, u));
    }
    return c.json(await dto(c.env, u!), 201);
  } catch (e) { return mapError(c, e); }
});

async function loadOwned(c: any, user: User): Promise<UpdateRow | null | { _forbidden: true } | { _notfound: true }> {
  const u = await c.env.DB.prepare('SELECT * FROM portfolio_updates WHERE uid = ?').bind(c.req.param('uid')).first() as UpdateRow | null;
  if (!u) return { _notfound: true };
  if (isInvestorSide(user)) {
    if (isAdmin(user)) return u;
    // Investor side may only read submitted updates, of a venture they are tied to, that its founder chose them for (D889).
    if (u.status !== 'submitted') return { _forbidden: true };
    if (!(await readerProjectIds(c, user)).includes(Number(u.project_id))) return { _forbidden: true };
    const granted = await c.env.DB.prepare(isInvestor(user) ? INVESTOR_GRANTED : TEAM_GRANTED).bind(u.id, user.id).first();
    if (!granted) return { _forbidden: true };
    return u;
  }
  // Founder: must own the project.
  const founderId = await projectFounderId(c.env, u.project_id);
  if (!(isFounder(user) && canAccessFounderResource(user, founderId ?? null))) return { _forbidden: true };
  return u;
}

// GET /api/portfolio-updates/:uid — detail
r.get('/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    const u = await loadOwned(c, user);
    if ((u as any)?._notfound) return c.json({ detail: 'Not found' }, 404);
    if ((u as any)?._forbidden) return c.json({ detail: 'Forbidden' }, 403);
    return c.json(await dto(c.env, u as UpdateRow));
  } catch (e) { return mapError(c, e); }
});

// PUT /api/portfolio-updates/:uid — author edits own draft (or admin)
r.put('/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    const u = await c.env.DB.prepare('SELECT * FROM portfolio_updates WHERE uid = ?').bind(c.req.param('uid')).first<UpdateRow>();
    if (!u) return c.json({ detail: 'Not found' }, 404);
    if (u.author_user_id !== user.id && !isAdmin(user)) return c.json({ detail: 'Forbidden' }, 403);
    const body = await c.req.json().catch(() => ({} as any));
    await c.env.DB.prepare(
      `UPDATE portfolio_updates SET period=?, title=?, body=?, kpis_json=?, updated_at=? WHERE id=?`
    ).bind(
      body.period !== undefined ? (body.period ? String(body.period).slice(0, 32) : null) : u.period,
      body.title !== undefined ? (body.title ? String(body.title).slice(0, 300) : u.title) : u.title,
      body.body !== undefined ? (body.body ? String(body.body).slice(0, 20000) : null) : u.body,
      body.kpis !== undefined ? (body.kpis != null ? JSON.stringify(body.kpis) : null) : u.kpis_json,
      nowIso(), u.id,
    ).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM portfolio_updates WHERE id = ?').bind(u.id).first<UpdateRow>();
    return c.json(await dto(c.env, fresh!));
  } catch (e) { return mapError(c, e); }
});

// POST /api/portfolio-updates/:uid/submit — author submits the update
r.post('/:uid/submit', async (c) => {
  try {
    const user = await requireAuth(c);
    const u = await c.env.DB.prepare('SELECT * FROM portfolio_updates WHERE uid = ?').bind(c.req.param('uid')).first<UpdateRow>();
    if (!u) return c.json({ detail: 'Not found' }, 404);
    if (u.author_user_id !== user.id && !isAdmin(user)) return c.json({ detail: 'Forbidden' }, 403);
    const wasSubmitted = u.status === 'submitted';
    await c.env.DB.prepare("UPDATE portfolio_updates SET status='submitted', submitted_at=?, updated_at=? WHERE id=?")
      .bind(nowIso(), nowIso(), u.id).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM portfolio_updates WHERE id = ?').bind(u.id).first<UpdateRow>();
    if (!wasSubmitted && fresh) {
      c.executionCtx.waitUntil(notifyProjectFollowers(c.env, fresh.project_id, fresh));
    }
    return c.json(await dto(c.env, fresh!));
  } catch (e) { return mapError(c, e); }
});

// ── D654 (#1466): Grow › Share an update ────────────────────────────────────
// The same `portfolio_updates` row, with the period, metrics, highlights,
// asks and audience the "Share an update" sheet records (migration 437).
// Every request value is bound; the founder must own the project.

const DAY = /^\d{4}-\d{2}-\d{2}$/;

async function ownedProject(c: any, user: User, projectId: number): Promise<number | null> {
  if (!Number.isInteger(projectId)) return null;
  const founderId = await projectFounderId(c.env, projectId);
  if (founderId === undefined) return null;
  if (!(await canShareUpdate(c.env, user, projectId, founderId))) return null;
  return projectId;
}

/** The period's snapshots from Revenue and traction, and the ones before it. */
async function periodSnapshots(env: Env, projectId: number, start: string, end: string) {
  try {
    const [year, month] = start.slice(0, 7).split('-').map(Number);
    const previousMonth = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10);
    const [inPeriod, before] = await Promise.all([
      env.DB.prepare(`SELECT snapshot_date, source, mrr, paying_accounts, net_burn, cash_balance FROM project_metrics WHERE project_id = ? AND snapshot_date >= ? AND snapshot_date <= ? ORDER BY snapshot_date`)
        .bind(projectId, start, end).all<Snapshot>(),
      env.DB.prepare(`SELECT snapshot_date, source, mrr, paying_accounts, net_burn, cash_balance FROM project_metrics WHERE project_id = ? AND snapshot_date >= ? AND snapshot_date < ? ORDER BY snapshot_date`)
        .bind(projectId, previousMonth, start).all<Snapshot>(),
    ]);
    return { inPeriod: inPeriod.results || [], before: before.results || [] };
  } catch {
    // No metrics store on this database yet: no figure is recorded.
    return { inPeriod: [], before: [] };
  }
}

async function openRoles(env: Env, projectId: number) {
  try {
    const r = await env.DB.prepare(
      `SELECT id, title, created_at FROM job_postings WHERE project_id = ? AND status IN ('open', 'published') ORDER BY id DESC LIMIT 20`,
    ).bind(projectId).all<{ id: number; title: string; created_at: string | null }>();
    return r.results || [];
  } catch { return []; }
}

/** Stored roadmap transitions and feedback shipped during this update's period. */
export async function shippedItems(env: Env, projectId: number, start: string, end: string): Promise<ShippedItem[]> {
  const out: ShippedItem[] = [];
  const emitted = new Set<string>();
  try {
    const moves = await env.DB.prepare(`SELECT m.okr_id, o.objective, MAX(m.moved_at) AS shipped_at FROM okr_column_moves m
      JOIN roadmap_okrs o ON o.id = m.okr_id AND o.project_id = m.project_id
      WHERE m.project_id = ? AND m.to_status = 'done' AND o.kanban_status = 'done'
        AND substr(m.moved_at, 1, 10) BETWEEN ? AND ? GROUP BY m.okr_id ORDER BY shipped_at`)
      .bind(projectId, start, end).all<{okr_id: number; objective: string; shipped_at: string}>();
    for (const m of moves.results || []) {
      emitted.add(String(m.okr_id));
      out.push({ kind: 'roadmap', label: m.objective, shipped_on: m.shipped_at.slice(0, 10) });
    }
  } catch { /* roadmap store unavailable */ }
  try {
    const feedback = await env.DB.prepare(`SELECT roadmap_item_ref, roadmap_item_label, theme,
      COALESCE(shipped_on, substr(updated_at, 1, 10)) AS shipped_on FROM product_feedback
      WHERE project_id = ? AND status = 'shipped' AND COALESCE(shipped_on, substr(updated_at, 1, 10)) BETWEEN ? AND ?`)
      .bind(projectId, start, end).all<{roadmap_item_ref: string|null;roadmap_item_label:string|null;theme:string|null;shipped_on:string}>();
    const groups = new Map<string, {label: string; shipped_on: string; customers: number}>();
    for (const f of feedback.results || []) {
      if (f.roadmap_item_ref && emitted.has(f.roadmap_item_ref)) continue;
      const label = f.roadmap_item_label || f.theme;
      if (!label) continue;
      const group = groups.get(label);
      if (group) { group.customers += 1; if (f.shipped_on > group.shipped_on) group.shipped_on = f.shipped_on; }
      else groups.set(label, { label, shipped_on: f.shipped_on, customers: 1 });
    }
    for (const g of groups.values()) out.push({ kind: 'feedback', ...g });
  } catch { /* feedback store unavailable */ }
  return out;
}

/** The company's markets (D664, migration 443); none on a database without them. */
async function projectMarkets(env: Env, projectId: number) {
  try {
    const r = await env.DB.prepare('SELECT id, name FROM markets WHERE project_id = ? ORDER BY name COLLATE NOCASE').bind(projectId).all<{ id: number; name: string }>();
    return r.results || [];
  } catch { return []; }
}

/** Who each audience is: investors from the Raise pipeline, the team, the project's followers. */
async function audienceMembers(env: Env, projectId: number, authorId: number) {
  const investors: Array<{ user_id: number | null; email: string; label: string }> = [];
  try {
    const r = await env.DB.prepare(
      `SELECT p.name, LOWER(p.email) AS email, u.id AS user_id
         FROM raise_prospects p LEFT JOIN users u ON LOWER(u.email) = LOWER(p.email)
        WHERE p.project_id = ? AND TRIM(COALESCE(p.email, '')) <> '' AND COALESCE(p.stage, '') <> 'passed'`,
    ).bind(projectId).all<{ name: string | null; email: string; user_id: number | null }>();
    for (const x of r.results || []) investors.push({ user_id: x.user_id, email: x.email, label: x.name || x.email });
  } catch { /* no pipeline yet: no investor */ }
  const team: number[] = [];
  try {
    const r = await env.DB.prepare(
      `SELECT user_id FROM project_members WHERE project_id = ? AND status = 'accepted' AND user_id <> ?`,
    ).bind(projectId, authorId).all<{ user_id: number }>();
    for (const x of r.results || []) team.push(x.user_id);
  } catch { /* no members table */ }
  try {
    const owner = await env.DB.prepare('SELECT u.id FROM projects p JOIN users u ON u.founder_id = p.founder_id WHERE p.id = ? AND p.founder_id IS NOT NULL ORDER BY u.id LIMIT 1')
      .bind(projectId).first<{id:number}>();
    if (owner && owner.id !== authorId && !team.includes(owner.id)) team.push(owner.id);
  } catch { /* no owner account */ }
  const network: number[] = [];
  try {
    await ensureFollowsSchema(env);
    const r = await env.DB.prepare(
      `SELECT follower_user_id AS user_id FROM follows WHERE entity_type = 'project' AND entity_id = ? AND follower_user_id <> ?`,
    ).bind(projectId, authorId).all<{ user_id: number }>();
    for (const x of r.results || []) network.push(x.user_id);
  } catch { /* no follows table */ }
  return { investors, team, network };
}

type ShareRow = UpdateRow & {
  period_start: string | null; period_end: string | null; metrics_json: string | null;
  highlights_json: string | null; lowlights_json: string | null; audience_json: string | null;
  network_includes_metrics: number; sent_at: string | null;
};

async function asksOf(env: Env, updateId: number) {
  const asks = await env.DB.prepare(`SELECT * FROM update_asks WHERE update_id = ? ORDER BY id`).bind(updateId).all<any>();
  return asks.results || [];
}

function shareShape(u: ShareRow, asks: any[]) {
  return {
    title: u.title, period_start: u.period_start, period_end: u.period_end,
    metrics: jload(u.metrics_json, []), highlights: jload(u.highlights_json, []), lowlights: jload(u.lowlights_json, []),
    asks: asks.map((a) => ({ uid: a.uid, kind: a.kind, text: a.text, module: ASK_MODULE[a.kind as AskKind]?.label ?? null, link_ref: a.link_ref, link_reason: a.link_reason })),
    network_includes_metrics: !!u.network_includes_metrics,
  };
}

// GET /api/portfolio-updates/share/context?project_id&period_start&period_end
// The sheet's metrics step and audience counts, from stored data only.
r.get('/share/context', async (c) => {
  try {
    const user = await requireAuth(c);
    const pid = await ownedProject(c, user, Number(c.req.query('project_id')));
    if (pid == null) return c.json(shareDenied, 403);
    const start = String(c.req.query('period_start') || '');
    const end = String(c.req.query('period_end') || '');
    if (!DAY.test(start) || !DAY.test(end) || start > end) return c.json({ detail: 'period_start and period_end are YYYY-MM-DD, start first', field: 'period' }, 400);
    const snaps = await periodSnapshots(c.env, pid, start, end);
    const metrics = buildMetrics(snaps.inPeriod, snaps.before, start);
    const members = await audienceMembers(c.env, pid, user.id);
    const project = await c.env.DB.prepare('SELECT id, name FROM projects WHERE id = ? AND deleted_at IS NULL').bind(pid).first<{id:number;name:string}>();
    const openCall = await openCallSummary(c.env, pid);
    return c.json({
      project, open_call: openCall,
      open_call_reason: openCall ? null : roundCallsEnabled(c.env) ? 'No open Call for Capital' : 'Coming soon. Round calls are not enabled.',
      metrics, no_metrics: noMetrics(metrics),
      open_roles: (await openRoles(c.env, pid)).map((x) => ({ id: x.id, title: x.title })),
      markets: await projectMarkets(c.env, pid),
      audience: { investors: members.investors.length, team: members.team.length, network: members.network.length },
      ask_kinds: ASK_KINDS.map((k) => ({ kind: k, module: ASK_MODULE[k].label, lands: !!ASK_MODULE[k].lands, reason: ASK_MODULE[k].reason })),
    });
  } catch (e) { return mapError(c, e); }
});

// POST /api/portfolio-updates/share/draft-lines — Eadwyn drafts the highlights
// and lowlights from the period's stored data; every line cites its source.
r.post('/share/draft-lines', async (c) => {
  try {
    const user = await requireAuth(c);
    const body = await c.req.json().catch(() => ({} as any));
    const pid = await ownedProject(c, user, Number(body.project_id));
    if (pid == null) return c.json(shareDenied, 403);
    const start = String(body.period_start || ''); const end = String(body.period_end || '');
    if (!DAY.test(start) || !DAY.test(end) || start > end) return c.json({ detail: 'period_start and period_end are YYYY-MM-DD, start first', field: 'period' }, 400);
    const snaps = await periodSnapshots(c.env, pid, start, end);
    const metrics = buildMetrics(snaps.inPeriod, snaps.before, start);
    const roles = (await openRoles(c.env, pid)).map((x) => ({ title: x.title, opened: x.created_at ? x.created_at.slice(0, 10) : null }));
    let contacts: number | null = null;
    try {
      const row = await c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM contacts WHERE project_id = ? AND audience = 'customer' AND substr(created_at, 1, 10) BETWEEN ? AND ?`,
      ).bind(pid, start, end).first<{ n: number }>();
      contacts = Number(row?.n ?? 0);
    } catch { contacts = null; }
    return c.json(await draftLines(c.env, user.id, periodFacts(metrics, roles, contacts, end, await shippedItems(c.env, pid, start, end))));
  } catch (e) { return mapError(c, e); }
});

// PUT /api/portfolio-updates/:uid/share — the author saves the sheet's steps on a draft.
r.put('/:uid/share', async (c) => {
  try {
    const user = await requireAuth(c);
    const u = await c.env.DB.prepare('SELECT * FROM portfolio_updates WHERE uid = ?').bind(c.req.param('uid')).first<ShareRow>();
    if (!u) return c.json({ detail: 'Not found' }, 404);
    if (u.author_user_id !== user.id && !isAdmin(user)) return c.json({ detail: 'Forbidden' }, 403);
    if (u.sent_at) return c.json({ detail: 'This update was sent and is read-only' }, 409);
    const body = await c.req.json().catch(() => ({} as any));
    const start = body.period_start == null ? u.period_start : String(body.period_start);
    const end = body.period_end == null ? u.period_end : String(body.period_end);
    if ((start && !DAY.test(start)) || (end && !DAY.test(end)) || (start && end && start > end)) {
      return c.json({ detail: 'period_start and period_end are YYYY-MM-DD, start first', field: 'period' }, 400);
    }
    let highlights; let lowlights;
    try {
      highlights = body.highlights === undefined ? jload(u.highlights_json, []) : cleanLines(body.highlights, 'Highlight');
      lowlights = body.lowlights === undefined ? jload(u.lowlights_json, []) : cleanLines(body.lowlights, 'Lowlight');
    } catch (e) {
      if (e instanceof LineError) return c.json({ detail: e.sentence, field: 'lines' }, 400);
      throw e;
    }
    const proofSnapshots = start && end ? await periodSnapshots(c.env, u.project_id, start, end) : { inPeriod: [], before: [] };
    const verifiedMetrics = start ? buildMetrics(proofSnapshots.inPeriod, proofSnapshots.before, start) : [];
    const metrics = cleanMetrics(body.metrics === undefined ? jload(u.metrics_json, []) : body.metrics, verifiedMetrics);
    const audience = body.audience === undefined ? jload(u.audience_json, cleanAudience({})) : cleanAudience(body.audience);
    const incl = body.network_includes_metrics === undefined ? u.network_includes_metrics : (body.network_includes_metrics === true ? 1 : 0);
    if (body.asks !== undefined) {
      if (!Array.isArray(body.asks)) return c.json({ detail: 'asks must be a list', field: 'asks' }, 400);
      const roles = new Set((await openRoles(c.env, u.project_id)).map((x) => String(x.id)));
      const markets = new Set((await projectMarkets(c.env, u.project_id)).map((x) => String(x.id)));
      const asks: Array<{ kind: AskKind; text: string; link_ref: string | null }> = [];
      for (const a of body.asks.slice(0, 10)) {
        const kind = String(a?.kind) as AskKind;
        const text = typeof a?.text === 'string' ? a.text.trim().slice(0, 300) : '';
        if (!ASK_KINDS.includes(kind)) return c.json({ detail: `An ask's kind is one of ${ASK_KINDS.join(', ')}`, field: 'asks' }, 400);
        if (!text) return c.json({ detail: 'Every ask says what it asks for', field: 'asks' }, 400);
        const link = a?.link_ref == null ? null : String(a.link_ref);
        // A hire links to one of this company's open roles, or to none.
        if (kind === 'hire' && link != null && !roles.has(link)) return c.json({ detail: 'A hire links to one of your open roles', field: 'asks' }, 400);
        // A market contact links to one of this company's markets (D664), or to none.
        if (kind === 'market' && link != null && !markets.has(link)) return c.json({ detail: 'A market ask links to one of your markets', field: 'asks' }, 400);
        const callUid=kind==='capital'?await openCallForUpdate(c.env,u.project_id):null;
        asks.push({ kind, text, link_ref: kind === 'hire' || kind === 'market' ? link : callUid });
      }
      await c.env.DB.prepare('DELETE FROM update_asks WHERE update_id = ?').bind(u.id).run();
      for (const a of asks) {
        await c.env.DB.prepare(
          'INSERT INTO update_asks (uid, update_id, kind, text, link_module, link_ref) VALUES (?, ?, ?, ?, ?, ?)',
        ).bind(newUid(), u.id, a.kind, a.text, ASK_MODULE[a.kind].module, a.link_ref).run();
      }
    }
    await c.env.DB.prepare(
      `UPDATE portfolio_updates SET period_start = ?, period_end = ?, period = ?, metrics_json = ?, highlights_json = ?,
         lowlights_json = ?, audience_json = ?, network_includes_metrics = ?, updated_at = ? WHERE id = ?`,
    ).bind(start, end, start ? start.slice(0, 7) : u.period, JSON.stringify(metrics), JSON.stringify(highlights),
      JSON.stringify(lowlights), JSON.stringify(audience), incl, nowIso(), u.id).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM portfolio_updates WHERE id = ?').bind(u.id).first<ShareRow>();
    return c.json({ uid: fresh!.uid, ...shareShape(fresh!, await asksOf(c.env, u.id)), audience_choice: audience });
  } catch (e) { return mapError(c, e); }
});

// POST /api/portfolio-updates/:uid/send — the author sends it, once, through
// the notification path (which mails people by their preferences). A pipeline
// investor with no Axal account is recorded as not delivered, never as sent.
r.post('/:uid/send', async (c) => {
  try {
    const user = await requireAuth(c);
    const u = await c.env.DB.prepare('SELECT * FROM portfolio_updates WHERE uid = ?').bind(c.req.param('uid')).first<ShareRow>();
    if (!u) return c.json({ detail: 'Not found' }, 404);
    if (u.author_user_id !== user.id && !isAdmin(user)) return c.json({ detail: 'Forbidden' }, 403);
    if (u.sent_at) return c.json({ detail: 'This update was already sent' }, 409);
    const choice = cleanAudience(jload(u.audience_json, {}));
    if (!choice.investors && !choice.team && !choice.network) return c.json({ detail: 'Choose who receives this update', field: 'audience' }, 400);
    const members = await audienceMembers(c.env, u.project_id, u.author_user_id);
    const proj = await c.env.DB.prepare('SELECT uid, name FROM projects WHERE id = ?').bind(u.project_id).first<{ uid: string; name: string }>();
    const seen = new Set<number>();
    const rows: Array<{ audience: Audience; user_id: number | null; email: string | null; label: string | null }> = [];
    if (choice.investors) for (const i of members.investors) {
      if (i.user_id != null) { if (seen.has(i.user_id)) continue; seen.add(i.user_id); }
      rows.push({ audience: 'investor', user_id: i.user_id, email: i.email, label: i.label });
    }
    if (choice.team) for (const id of members.team) { if (!seen.has(id)) { seen.add(id); rows.push({ audience: 'team', user_id: id, email: null, label: null }); } }
    if (choice.network) for (const id of members.network) { if (!seen.has(id)) { seen.add(id); rows.push({ audience: 'network', user_id: id, email: null, label: null }); } }
    if (rows.length === 0) return c.json({ detail: 'Nobody is in the audience you chose yet', field: 'audience' }, 400);
    const recorded = await c.env.DB.prepare('SELECT user_id, email, delivered_via FROM update_recipients WHERE update_id = ?').bind(u.id)
      .all<{user_id:number|null;email:string|null;delivered_via:string|null}>();
    const identity = (id: number|null, email: string|null) => id == null ? `email:${(email || '').toLowerCase()}` : `user:${id}`;
    const already = new Set((recorded.results || []).map((x) => identity(x.user_id, x.email)));
    const sentAt = nowIso();
    let delivered = (recorded.results || []).filter((x) => x.delivered_via != null).length;
    for (const rcp of rows) {
      const key = identity(rcp.user_id, rcp.email);
      if (already.has(key)) continue;
      let via: string | null = null; let reason: string | null = null;
      if (rcp.user_id != null) {
        const id = await notify(c.env, {
          userId: rcp.user_id, type: 'followed_entity_news',
          title: `${proj?.name ?? 'A company'} shared an update`,
          body: rcp.audience === 'network' ? 'Asks for the Axal network' : (u.title || null),
          link: `/updates/${u.uid}`,
          payload: { update_uid: u.uid, audience: rcp.audience },
          category: 'proactive_nudges',
        });
        if (id != null) { via = 'notification'; delivered += 1; }
        else reason = 'Not delivered: their notification settings or the inbox refused it';
      } else {
        reason = 'No Axal account for this email, so it was not sent';
      }
      await c.env.DB.prepare(
        `INSERT INTO update_recipients (update_id, audience, user_id, email, label, delivered_via, not_delivered_reason) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(u.id, rcp.audience, rcp.user_id, rcp.email, rcp.label, via, reason).run();
      already.add(key);
    }
    await c.env.DB.prepare(
      `UPDATE portfolio_updates SET status = 'submitted', submitted_at = COALESCE(submitted_at, ?), sent_at = ?, updated_at = ? WHERE id = ?`,
    ).bind(sentAt, sentAt, sentAt, u.id).run();
    return c.json({ uid: u.uid, sent_at: sentAt, recipients: already.size, delivered, not_delivered: already.size - delivered });
  } catch (e) { return mapError(c, e); }
});

async function recipientOf(env: Env, updateId: number, userId: number) {
  return env.DB.prepare('SELECT * FROM update_recipients WHERE update_id = ? AND user_id = ? ORDER BY id LIMIT 1')
    .bind(updateId, userId).first<any>();
}

// GET /api/portfolio-updates/:uid/page — the sent update. The author sees the
// replies to each ask and who opened it; a recipient sees what their audience
// may read, and opening it records the open.
r.get('/:uid/page', async (c) => {
  try {
    const user = await requireAuth(c);
    const u = await c.env.DB.prepare('SELECT * FROM portfolio_updates WHERE uid = ?').bind(c.req.param('uid')).first<ShareRow>();
    if (!u || !u.sent_at) return c.json({ detail: 'Not found' }, 404);
    const asks = await asksOf(c.env, u.id);
    const shape = shareShape(u, await updateAskLinks(c.env,asks,user,u.author_user_id===user.id));
    const isAuthor = u.author_user_id === user.id || isAdmin(user);
    if (!isAuthor) {
      const rcp = await recipientOf(c.env, u.id, user.id);
      if (!rcp) return c.json({ detail: 'Forbidden' }, 403);
      if (!rcp.opened_at) await c.env.DB.prepare('UPDATE update_recipients SET opened_at = ? WHERE id = ?').bind(nowIso(), rcp.id).run();
      return c.json({ uid: u.uid, sent_at: u.sent_at, ...payloadFor(rcp.audience as Audience, {...shape,asks:await updateAskLinks(c.env,shape.asks,user,false,rcp.audience)}) });
    }
    const replies = await c.env.DB.prepare(
      `SELECT r.*, a.uid AS ask_uid FROM update_ask_replies r JOIN update_asks a ON a.id = r.ask_id WHERE a.update_id = ? ORDER BY r.id DESC`,
    ).bind(u.id).all<any>();
    const recipients = await c.env.DB.prepare(
      `SELECT ur.audience, ur.user_id, ur.delivered_via, ur.not_delivered_reason, ur.opened_at,
        COALESCE(ur.label, usr.name) AS label,
        CASE WHEN ur.user_id IS NULL THEN 0 ELSE EXISTS(SELECT 1 FROM update_ask_replies rp
          JOIN update_asks a ON a.id = rp.ask_id WHERE a.update_id = ur.update_id AND rp.replier_user_id = ur.user_id) END AS replied
       FROM update_recipients ur LEFT JOIN users usr ON usr.id = ur.user_id
       WHERE ur.update_id = ? AND ur.audience <> 'network' ORDER BY ur.id`,
    ).bind(u.id).all<any>();
    const network = await c.env.DB.prepare(`SELECT COUNT(*) AS sent, COUNT(opened_at) AS opened,
      SUM(CASE WHEN user_id IS NOT NULL AND EXISTS(SELECT 1 FROM update_ask_replies rp JOIN update_asks a ON a.id = rp.ask_id
        WHERE a.update_id = update_recipients.update_id AND rp.replier_user_id = update_recipients.user_id) THEN 1 ELSE 0 END) AS replied
      FROM update_recipients WHERE update_id = ? AND audience = 'network'`).bind(u.id).first<{sent:number;opened:number;replied:number}>();
    const byAsk = new Map<string, any[]>();
    for (const x of replies.results || []) byAsk.set(x.ask_uid, [...(byAsk.get(x.ask_uid) || []), x]);
    const count = (a: Audience) => (recipients.results || []).filter((x: any) => x.audience === a).length;
    return c.json({
      uid: u.uid, project_id: u.project_id, audience: cleanAudience(jload(u.audience_json, {})), sent_at: u.sent_at, ...shape,
      highlights: shape.highlights, lowlights: shape.lowlights,
      asks: shape.asks.map((a) => {
        const rs = byAsk.get(a.uid) || [];
        const raw = asks.find((x) => x.uid === a.uid);
        return {
          ...a,
          replies: rs.map((x) => ({ uid: x.uid, name: x.name, message: x.message, created_at: x.created_at,
            landed_module: x.landed_module, landed_reason: x.landed_reason })),
          can_ask_again: canAskAgain(u.sent_at, rs.length, raw?.asked_again_at ?? null),
        };
      }),
      recipients: (recipients.results || []).map((x) => ({ ...x, replied: !!x.replied })),
      network: { sent: network?.sent ?? 0, opened: network?.opened ?? 0, replied: network?.replied ?? 0 },
      sent_to: { investors: count('investor'), team: count('team'), network: network?.sent ?? 0 },
    });
  } catch (e) { return mapError(c, e); }
});

// POST /api/portfolio-updates/asks/:askUid/replies — a recipient answers an
// ask; the reply becomes an item in the module that asked.
r.post('/asks/:askUid/replies', async (c) => {
  try {
    const user = await requireAuth(c);
    const ask = await c.env.DB.prepare(
      `SELECT a.*, u.uid AS update_uid, u.project_id, u.sent_at, u.author_user_id FROM update_asks a JOIN portfolio_updates u ON u.id = a.update_id WHERE a.uid = ?`,
    ).bind(c.req.param('askUid')).first<any>();
    if (!ask || !ask.sent_at) return c.json({ detail: 'Not found' }, 404);
    if (!(await recipientOf(c.env, ask.update_id, user.id))) return c.json({ detail: 'Forbidden' }, 403);
    const body = await c.req.json().catch(() => ({} as any));
    const message = typeof body.message === 'string' ? body.message.trim().slice(0, 4000) : '';
    if (!message) return c.json({ detail: 'A reply says something', field: 'message' }, 400);
    const email = typeof body.email === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email.trim()) ? body.email.trim() : (user.email || null);
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 200) : (user.name || null);
    const uid = newUid();
    const callReply=await replyToLinkedCall(c.env,ask,user,message,uid);
    const landed=callReply?{module:'round_call',ref:ask.link_ref,reason:null}:await landReply(c.env,ask.project_id,{kind:ask.kind,link_ref:ask.link_ref,text:ask.text},{name,email,message,userId:user.id});
    if(!callReply)await c.env.DB.prepare(
      `INSERT INTO update_ask_replies (uid, ask_id, replier_user_id, name, email, message, landed_module, landed_ref, landed_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(uid, ask.id, user.id, name, email, message, landed.module, landed.ref, landed.reason).run();
    c.executionCtx.waitUntil(notify(c.env, {
      userId: ask.author_user_id, type: 'followed_entity_news', title: 'A reply to your update',
      body: ask.text, link: `/updates/${ask.update_uid}`, payload: { ask_uid: ask.uid }, category: 'proactive_nudges',
    }).then(() => undefined).catch(() => undefined));
    return c.json({ uid, landed_module: landed.module, landed_reason: landed.reason }, 201);
  } catch (e) { if(e instanceof RoundCallError)return c.json({error:e.code,code:e.code},e.status); return mapError(c, e); }
});

// POST /api/portfolio-updates/asks/:askUid/ask-again — the author re-asks an ask
// that had no reply after ASK_AGAIN_DAYS.
r.post('/asks/:askUid/ask-again', async (c) => {
  try {
    const user = await requireAuth(c);
    const ask = await c.env.DB.prepare(
      `SELECT a.*, u.uid AS update_uid, u.sent_at, u.author_user_id FROM update_asks a JOIN portfolio_updates u ON u.id = a.update_id WHERE a.uid = ?`,
    ).bind(c.req.param('askUid')).first<any>();
    if (!ask || !ask.sent_at) return c.json({ detail: 'Not found' }, 404);
    if (ask.author_user_id !== user.id && !isAdmin(user)) return c.json({ detail: 'Forbidden' }, 403);
    const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM update_ask_replies WHERE ask_id = ?').bind(ask.id).first<{ n: number }>();
    if (!canAskAgain(ask.sent_at, Number(n?.n ?? 0), ask.asked_again_at)) {
      return c.json({ detail: 'An ask can be asked again once it has had no reply for 14 days' }, 409);
    }
    const rcps = await c.env.DB.prepare('SELECT user_id FROM update_recipients WHERE update_id = ? AND user_id IS NOT NULL').bind(ask.update_id).all<{ user_id: number }>();
    for (const x of rcps.results || []) {
      await notify(c.env, { userId: x.user_id, type: 'followed_entity_news', title: 'Asked again', body: ask.text,
        link: `/updates/${ask.update_uid}`, payload: { ask_uid: ask.uid }, category: 'proactive_nudges' });
    }
    await c.env.DB.prepare('UPDATE update_asks SET asked_again_at = ? WHERE id = ?').bind(nowIso(), ask.id).run();
    return c.json({ uid: ask.uid, asked_again: (rcps.results || []).length });
  } catch (e) { return mapError(c, e); }
});

export default r;
