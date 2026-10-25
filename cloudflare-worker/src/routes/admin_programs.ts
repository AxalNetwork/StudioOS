/**
 * D954 (#2787) — Admin › Programs: the registry, the playbook, the catalogue
 * read, mentor sessions and each program's activity. Mounted at
 * /api/admin/programs, before the /api/admin catch-all.
 *
 *   GET  /?weeks=4|12|52&scope=                    the catalogue read (requireAdmin), counts only
 *   POST /                                         New program: a `proposed` row and its draft (requireSuperAdmin, D955)
 *   GET  /mentor-cohorts/sessions                  sessions booked with each cycle's mentors (requireAdmin)
 *   GET  /:key                                     the registry row and the published playbook; a Super Admin also gets the draft
 *   PATCH /:key                                    purpose, who, join_method, status (requireSuperAdmin)
 *   PUT  /:key/playbook/sections/:section          edit the draft's section (requireSuperAdmin)
 *   POST /:key/playbook/publish                    the draft becomes the next version (requireSuperAdmin)
 *   GET  /:key/activity?before=&limit=             the program's activity, newest first (requireAdmin)
 *   POST /:key/export                              D1124: the page's Download (CSV), counts only, logged (requireAdmin)
 *
 * An unknown key is 404 `unknown_program` on every `/:key` route, and so is a
 * program approved for another studio only (D955, migration 561): an admin
 * reads the programs for every studio and their own studio's; a Super Admin
 * reads them all. `/proposals` is its own router, mounted before this one.
 *
 * SCOPE works as on Insights (`admin_insights.ts`): no scope, or this
 * deployment's own, reads this deployment. Another scope is HQ's: a plain
 * Admin, or anyone on a branch, gets 403 `hq_only` before any read. A Super
 * Admin on HQ gets that subsidiary's answer through the fan-out, which the
 * branch serves with `loadProgramsForBranch` over its own D1.
 *
 * Every write is refused on a branch by `requireSuperAdmin` (D106), and every
 * write calls `logAdminAction` (`services/programRegistry.ts`).
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { isSuperAdmin, requireAdmin, requireSuperAdmin } from '../auth';
import { refuse } from '../util/refusal';
import { mapError } from './_t13t14t15_helpers';
import { ownScope } from '../services/adminInsights';
import { HQ_ONLY_MESSAGE, normaliseScope } from '../services/insightsScope';
import { branchScopedPrograms, parseProgramWeeks, programCatalogue, programsParams } from '../services/programCatalogue';
import {
  ProgramError, editDraftSection, programByKey, programDetail, publishDraft, updateProgram,
} from '../services/programRegistry';
import { parseActivityQuery, programActivity } from '../services/programActivity';
import { newProgram, readerOf } from '../services/programProposals';
import { EXPORTABLE_PROGRAMS, exportCsv, programExportRows, type ExportableProgram } from '../services/programExport';
import { refusesCountsOnly } from '../services/insightsExport';
import { signDownloadToken } from '../services/analyticsReports';
import { ensureAdminAuditLogTable } from './admin';

const EXPORT_LINK_TTL = 86_400;

const r = new Hono<{ Bindings: Env }>();
type C = Context<{ Bindings: Env }>;

/**
 * A ProgramError is the refusal it names, keyed on `code` as the catalogue's
 * own 400s and 403s are (and as Insights and Community answer), so the page
 * reads one shape; anything else goes to `mapError`.
 */
function answer(c: C, e: unknown) {
  if (e instanceof ProgramError) return refuse(c, e.status, { code: e.code, message: e.sentence, extra: { code: e.code } });
  return mapError(c, e);
}

const actorOf = (u: any) => ({ id: Number(u.id), email: String(u.email || '') });

r.get('/', async (c) => {
  try {
    const user = await requireAdmin(c);
    const scope = c.req.query('scope');
    const other = scope && scope !== ownScope(c.env);
    if (other && !isSuperAdmin(user as any)) {
      return c.json({ code: 'hq_only', detail: HQ_ONLY_MESSAGE }, 403);
    }
    const weeks = parseProgramWeeks(c.req.query('weeks'));
    if (!weeks) return c.json({ code: 'bad_weeks', detail: 'weeks must be 4, 12 or 52.' }, 400);
    if (other) {
      // `isSuperAdmin` answers false on a branch (D106), so only HQ gets here.
      const code = normaliseScope(scope);
      if (!code) return c.json({ code: 'bad_scope', detail: 'scope must be hq or a subsidiary\'s code.' }, 400);
      return c.json(await branchScopedPrograms(c.env, code, programsParams(c.req.query())));
    }
    const reader = await readerOf(c.env, { id: Number(user.id), superAdmin: isSuperAdmin(user as any) });
    return c.json(await programCatalogue(c.env, { id: Number(user.id), superAdmin: reader.superAdmin, licenceUid: reader.licenceUid }, weeks));
  } catch (e) {
    return answer(c, e);
  }
});

/**
 * D954 §9 — sessions booked with a mentor (PG5's "How we measure it", PG18b).
 *
 * For each of the twelve newest cycles (R7's, `admin_cohort.ts`), the bookings
 * with that cycle's assigned mentors (any assignment to it, active or ended)
 * whose slot starts inside the cycle's window. A slot belongs to the mentor's
 * `advisors` row, not their user id (`routes/advisors.ts`). A booking counts
 * unless it is cancelled, as `telegramAggregator.ts` counts sessions booked,
 * on a slot that is not cancelled. It counts by mentor and window, not by the
 * founder's cohort, because a cohort's founders wait on O-FND. Counts only.
 */
r.get('/mentor-cohorts/sessions', async (c) => {
  try {
    await requireAdmin(c);
    const res = await c.env.DB.prepare(
      `SELECT c.id AS cycle_id, c.year, c.month, c.start_at, c.end_at, c.status,
              (SELECT COUNT(DISTINCT a.advisor_user_id) FROM advisor_cohort_assignments a WHERE a.cohort_cycle_id = c.id) AS mentors,
              (SELECT COUNT(*) FROM advisor_bookings b
                 JOIN advisor_office_hour_slots s ON s.id = b.slot_id
                 JOIN advisors ad ON ad.id = s.advisor_id
                WHERE ad.user_id IN (SELECT a.advisor_user_id FROM advisor_cohort_assignments a WHERE a.cohort_cycle_id = c.id)
                  AND s.is_cancelled = 0 AND b.status != 'cancelled'
                  AND datetime(s.starts_at) >= datetime(c.start_at) AND datetime(s.starts_at) < datetime(c.end_at)) AS sessions
         FROM cohort_cycles c ORDER BY c.year DESC, c.month DESC LIMIT 12`,
    ).all<{ cycle_id: number; year: number; month: number; start_at: string; end_at: string; status: string; mentors: number; sessions: number }>();
    return c.json({
      cycles: (res.results || []).map((x) => ({
        cycle_id: Number(x.cycle_id), year: Number(x.year), month: Number(x.month),
        start_at: x.start_at, end_at: x.end_at, status: x.status,
        mentors: Number(x.mentors) || 0, sessions: Number(x.sessions) || 0,
      })),
      rule: 'Bookings not cancelled, on slots not cancelled, with any mentor assigned to the cycle, whose slot starts inside the cycle\'s window. Counted by mentor and window, not by the founder\'s cohort.',
    });
  } catch (e) {
    return answer(c, e);
  }
});

/** D955 — New program (PG2's header, dc:469): Basics and How it runs. */
r.post('/', async (c) => {
  try {
    const user = await requireSuperAdmin(c);
    const body = await c.req.json().catch(() => ({}));
    const key = await newProgram(c.env, body, actorOf(user));
    return c.json(await programDetail(c.env, key, true), 201);
  } catch (e) {
    return answer(c, e);
  }
});

r.get('/:key', async (c) => {
  try {
    const user = await requireAdmin(c);
    const reader = await readerOf(c.env, { id: Number(user.id), superAdmin: isSuperAdmin(user as any) });
    return c.json(await programDetail(c.env, c.req.param('key'), reader.superAdmin, reader));
  } catch (e) {
    return answer(c, e);
  }
});

r.patch('/:key', async (c) => {
  try {
    const user = await requireSuperAdmin(c);
    const body = await c.req.json().catch(() => ({}));
    return c.json({ program: await updateProgram(c.env, c.req.param('key'), body, actorOf(user)) });
  } catch (e) {
    return answer(c, e);
  }
});

r.put('/:key/playbook/sections/:section', async (c) => {
  try {
    const user = await requireSuperAdmin(c);
    const body = await c.req.json().catch(() => ({}));
    return c.json(await editDraftSection(c.env, c.req.param('key'), c.req.param('section'), body, actorOf(user)));
  } catch (e) {
    return answer(c, e);
  }
});

r.post('/:key/playbook/publish', async (c) => {
  try {
    const user = await requireSuperAdmin(c);
    return c.json(await publishDraft(c.env, c.req.param('key'), actorOf(user)));
  } catch (e) {
    return answer(c, e);
  }
});

/**
 * D1124 (#3004) — POST /:key/export: the program page's Download (CSV), from
 * the catalogue read this admin is shown (D954), counts only (D953 S-CSV).
 * Logged: one `admin_audit_log` row (`program_export`, the program and the
 * weeks, never a figure). If the row cannot be written, the stored file is
 * deleted and no link is handed out (503 `export_not_logged`). Delivered as
 * the Insights export is: R2 behind the signed 24-hour link, or inline in
 * local development.
 */
r.post('/:key/export', async (c) => {
  try {
    const user = await requireAdmin(c);
    const key = c.req.param('key');
    const reader = await readerOf(c.env, { id: Number(user.id), superAdmin: isSuperAdmin(user as any) });
    // An unknown program, or one this admin cannot read, is 404 as on every /:key route.
    await programByKey(c.env, key, reader);
    if (!(EXPORTABLE_PROGRAMS as readonly string[]).includes(key)) {
      return refuse(c, 409, { code: 'nothing_to_export', message: 'This program has no figures to export yet.', extra: { code: 'nothing_to_export' } });
    }
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const weeks = parseProgramWeeks(body?.weeks == null ? '12' : String(body.weeks));
    if (!weeks) return c.json({ code: 'bad_weeks', detail: 'weeks must be 4, 12 or 52.' }, 400);
    const catalogue = await programCatalogue(c.env, { id: Number(user.id), superAdmin: reader.superAdmin, licenceUid: reader.licenceUid }, weeks);
    const rows = await programExportRows(c.env, key as ExportableProgram, catalogue);
    if (!rows) return refuse(c, 503, { code: 'export_unreadable', message: 'The program\'s figures could not be read, so nothing was exported. Try again.', extra: { code: 'export_unreadable' } });
    const csv = exportCsv(rows, { program: key, weeks, asOf: String(catalogue.as_of), scope: String(catalogue.scope?.label ?? '') });
    if (refusesCountsOnly(csv)) {
      return refuse(c, 500, { code: 'export_not_counts_only', message: 'This export was stopped: it would have carried more than counts.', extra: { code: 'export_not_counts_only' } });
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rand = [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, '0')).join('');
    const storageKey = `program-exports/${user.id}/${stamp}-${key}-${rand}.csv`;
    const r2 = c.env.FILES;
    let downloadUrl: string;
    if (r2) {
      await r2.put(storageKey, csv, { httpMetadata: { contentType: 'text/csv; charset=utf-8' } });
      downloadUrl = `${new URL(c.req.url).origin}/api/monitoring/analytics/download/${await signDownloadToken(c.env, storageKey, EXPORT_LINK_TTL)}`;
    } else {
      downloadUrl = `data:text/csv;charset=utf-8;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(csv)))}`;
    }
    try {
      await ensureAdminAuditLogTable(c.env);
      await c.env.DB.prepare(
        `INSERT INTO admin_audit_log (admin_user_id, action, report_type, format, filters_json, storage_key, download_url)
         VALUES (?, 'program_export', ?, 'csv', ?, ?, ?)`,
      ).bind(user.id, key, JSON.stringify({ weeks }), r2 ? storageKey : null, r2 ? downloadUrl : null).run();
    } catch {
      console.warn('[program export] audit write failed');
      if (r2) await r2.delete(storageKey).catch(() => {});
      return refuse(c, 503, { code: 'export_not_logged', message: 'The export could not be logged, so it was not made. Try again.', extra: { code: 'export_not_logged' } });
    }
    return c.json({ download_url: downloadUrl, expires_in_seconds: r2 ? EXPORT_LINK_TTL : null, format: 'csv', program: key, weeks, rows: rows.length });
  } catch (e) {
    return answer(c, e);
  }
});

r.get('/:key/activity', async (c) => {
  try {
    const user = await requireAdmin(c);
    const p = await programByKey(c.env, c.req.param('key'), await readerOf(c.env, { id: Number(user.id), superAdmin: isSuperAdmin(user as any) }));
    const q = parseActivityQuery((k) => c.req.query(k));
    if (!q.ok) return c.json({ code: q.code, detail: q.detail }, 400);
    return c.json(await programActivity(c.env, p.key, { id: Number(user.id), superAdmin: isSuperAdmin(user as any) }, q));
  } catch (e) {
    return answer(c, e);
  }
});

export default r;
