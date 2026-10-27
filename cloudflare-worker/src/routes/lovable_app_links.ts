/**
 * D1083 (#2948, Lovable part 3 of #2398) — the founder's Lovable app address,
 * on an experiment or on Prototype / MVP, and its founder-pressed live check.
 *
 *   PUT    /api/cycles/:cycle/lovable/app-link?project=        { record_id?, app_url }
 *   DELETE /api/cycles/:cycle/lovable/app-link?project=&record_id=
 *   POST   /api/cycles/:cycle/lovable/app-link/:uid/check?project=
 *
 * `:cycle` is `validate` (an experiment: `record_id` is its id) or `build`
 * (the project's Prototype / MVP: no `record_id`), checked against
 * `LINK_TARGETS`. Every route is a write: the venture's own or an admin's
 * (`canWrite`), never a support session's. Check now is the only thing that
 * fetches the address; there is no cron.
 *
 * The address and the fetched page are never logged, returned in an error or
 * thrown. The activity row says what happened, not where.
 *
 * Mounted at `/api/cycles` in index.ts, before Build's and Validate's routers.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, selectJwt } from '../auth';
import { canWrite, type ProjectRef } from './_founder_validate_helpers';
import { fetchPage } from '../services/webFetch';
import { logCycleWrite } from '../services/cycleActivity';
import {
  LINK_TARGETS, checkAppUrl, isLinkCycle, linkView, plainTitle, vercelProductionDomains,
  type LinkCycle, type LinkRow,
} from '../services/lovableAppLinks';

const app = new Hono<{ Bindings: Env }>();

const REFUSALS: Record<string, string> = {
  app_url_required: 'Paste the address Lovable gave you.',
  app_url_too_long: 'That address is too long.',
  app_url_invalid: 'That is not a web address.',
  app_url_not_https: 'Use the https:// address Lovable gave you.',
  app_url_not_public: 'That address is not on the public web.',
};

type Scope = { cycle: LinkCycle; project: ProjectRef & { id: number }; user: Awaited<ReturnType<typeof requireAuth>> };

async function scope(c: any): Promise<Scope | Response> {
  const user = await requireAuth(c);
  const cycle = c.req.param('cycle');
  if (!isLinkCycle(cycle)) return c.json({ detail: 'No such cycle' }, 404);
  const raw = String(c.req.query('project') ?? '');
  if (!/^[1-9][0-9]{0,9}$/.test(raw)) return c.json({ detail: 'project is required' }, 400);
  const project = await c.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL')
    .bind(Number(raw)).first() as (ProjectRef & { id: number }) | null;
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  if ((await selectJwt(c))?.payload.impersonated_by) {
    return c.json({ detail: 'A support session cannot change a venture’s app link.', code: 'support_session_refused' }, 403);
  }
  if (!canWrite(project, user)) return c.json({ detail: 'Forbidden' }, 403);
  return { cycle, project, user };
}

/** The record a link sits on, owned by this project; `null` when it is not. */
async function recordFor(c: any, s: Scope, rawId: unknown): Promise<{ recordId: number; entityId: number | null } | null> {
  if (s.cycle === 'build') return { recordId: Number(s.project.id), entityId: null };
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  const row = await c.env.DB.prepare('SELECT id, hypothesis_id FROM hypothesis_experiments WHERE id = ? AND project_id = ?')
    .bind(id, s.project.id).first() as { id: number; hypothesis_id: number } | null;
  // The experiment's activity is its claim's record (`validate.experiments`).
  return row ? { recordId: Number(row.id), entityId: Number(row.hypothesis_id) } : null;
}

const log = (env: Env, s: Scope, entityId: number | null, action: string, summary: string) =>
  s.cycle === 'build'
    ? logCycleWrite(env, { projectId: Number(s.project.id), userId: Number(s.user.id), cycle: 'build', module: 'prototype-mvp', entityId, action, summary })
    : logCycleWrite(env, { projectId: Number(s.project.id), userId: Number(s.user.id), cycle: 'validate', module: 'experiments', entityId, action, summary });

async function loadLink(env: Env, s: Scope, where: { uid: string } | { recordId: number }): Promise<(LinkRow & { id: number }) | null> {
  const target = LINK_TARGETS[s.cycle];
  const stmt = 'uid' in where
    ? env.DB.prepare(`SELECT id, uid, record_id, app_url, last_status, last_title, checked_at FROM lovable_app_links
                       WHERE project_id = ? AND module = ? AND record_table = ? AND uid = ?`)
      .bind(s.project.id, target.module, target.recordTable, where.uid)
    : env.DB.prepare(`SELECT id, uid, record_id, app_url, last_status, last_title, checked_at FROM lovable_app_links
                       WHERE project_id = ? AND module = ? AND record_table = ? AND record_id = ?`)
      .bind(s.project.id, target.module, target.recordTable, where.recordId);
  return stmt.first<LinkRow & { id: number }>();
}

app.put('/:cycle/lovable/app-link', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const body: any = await c.req.json().catch(() => ({}));
  const record = await recordFor(c, s, body?.record_id);
  if (!record) return c.json({ detail: 'That experiment is not on this venture.', code: 'record_not_found' }, 404);
  const checked = checkAppUrl(body?.app_url);
  if (!checked.ok) return c.json({ detail: REFUSALS[checked.error], code: checked.error }, 400);
  const target = LINK_TARGETS[s.cycle];
  const now = new Date().toISOString();
  // A new address forgets the old address's check; the same address keeps it.
  const res = await c.env.DB.prepare(
    `INSERT INTO lovable_app_links (uid, project_id, module, record_table, record_id, app_url, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (record_table, record_id) DO UPDATE SET
       last_status = CASE WHEN lovable_app_links.app_url = excluded.app_url THEN lovable_app_links.last_status ELSE NULL END,
       last_title  = CASE WHEN lovable_app_links.app_url = excluded.app_url THEN lovable_app_links.last_title ELSE NULL END,
       checked_at  = CASE WHEN lovable_app_links.app_url = excluded.app_url THEN lovable_app_links.checked_at ELSE NULL END,
       app_url = excluded.app_url, updated_at = excluded.updated_at
     WHERE lovable_app_links.project_id = excluded.project_id`,
  ).bind(crypto.randomUUID(), s.project.id, target.module, target.recordTable, record.recordId, checked.url, s.user.id, now, now).run();
  if (!res?.meta?.changes) return c.json({ detail: 'That record is not on this venture.', code: 'record_not_found' }, 404);
  await log(c.env, s, record.entityId, 'lovable_app_linked', 'Lovable app address linked');
  const row = await loadLink(c.env, s, { recordId: record.recordId });
  return c.json({ link: row ? linkView(row, await vercelProductionDomains(c.env, Number(s.project.id))) : null });
});

app.delete('/:cycle/lovable/app-link', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const record = await recordFor(c, s, c.req.query('record_id'));
  if (!record) return c.json({ detail: 'That experiment is not on this venture.', code: 'record_not_found' }, 404);
  const target = LINK_TARGETS[s.cycle];
  const res = await c.env.DB.prepare(
    'DELETE FROM lovable_app_links WHERE project_id = ? AND module = ? AND record_table = ? AND record_id = ?',
  ).bind(s.project.id, target.module, target.recordTable, record.recordId).run();
  if (!res?.meta?.changes) return c.json({ detail: 'No app is linked here. Nothing was removed.', code: 'link_not_found' }, 404);
  await log(c.env, s, record.entityId, 'lovable_app_unlinked', 'Lovable app address removed');
  return c.json({ link: null });
});

app.post('/:cycle/lovable/app-link/:uid/check', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const uid = String(c.req.param('uid') ?? '');
  const row = await loadLink(c.env, s, { uid });
  if (!row) return c.json({ detail: 'No app is linked here.', code: 'link_not_found' }, 404);
  const page = await fetchPage(c.env, row.app_url, { userId: Number(s.user.id), noCache: true });
  // Our own limit is not an answer about the app: nothing is recorded.
  if (page.error === 'rate_limited') {
    return c.json({ detail: 'Too many checks this minute. Try again shortly. Nothing was recorded.', code: 'rate_limited' }, 429);
  }
  const status = page.ok ? 'live' : 'not_reachable';
  const title = page.ok ? plainTitle(page.title) : null;
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    'UPDATE lovable_app_links SET last_status = ?, last_title = ?, checked_at = ?, updated_at = ? WHERE id = ? AND project_id = ?',
  ).bind(status, title, now, now, row.id, s.project.id).run();
  const entityId = s.cycle === 'validate' ? (await recordFor(c, s, row.record_id))?.entityId ?? null : null;
  await log(c.env, s, entityId, 'lovable_app_checked', status === 'live' ? 'Lovable app checked: Live' : 'Lovable app checked: Not reachable');
  const fresh = await loadLink(c.env, s, { uid });
  return c.json({ link: fresh ? linkView(fresh, await vercelProductionDomains(c.env, Number(s.project.id))) : null });
});

export default app;
