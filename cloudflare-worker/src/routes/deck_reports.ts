/**
 * D1540 (#3791, deck v2 B15) — a founder reports a bad result, and HQ reads
 * and resolves the reports.
 *
 *   POST /api/decks/proposals/:uid/report        { reason, note? }
 *        → 201 { report } ; 409 already_reported with { report } when this
 *          member already reported this result
 *   GET  /api/admin/deck-reports?status=open|resolved|all
 *        → { reports: [{ uid, proposal_uid, record_ref, rail_option, model,
 *            usage_log_id, charged_microusd, reason, note, status, outcome,
 *            resolution_note, resolved_at, created_at, proposal }] }
 *   POST /api/admin/deck-reports/:uid/resolve    { outcome: addressed|no_fault, note? }
 *        → { report } ; 409 already_resolved
 *
 * WHAT CAN BE REPORTED. A deck rail proposal (`ai_rail_proposals`, the result
 * cards of `AreaResults.jsx`) that is the caller's own, decided or not. Any
 * other uid, or another member's, answers 404 the same way, so a uid is never
 * confirmed to exist. The option, model and usage row are copied onto the
 * report (`deck_proposal_reports`, migration 733) so HQ reads what ran.
 *
 * WHAT A REPORT DOES NOT DO. It refunds nothing and changes no proposal. A
 * run that failed was never charged (D844: released on throw, timeout or
 * cancel); a refund for a result that ran is HQ's call through the token
 * ledger's own adjustment (`/api/ai-budget`), never this route.
 *
 * WHO. The report: the member whose proposal it is, never a support session
 * on their behalf. The queue: an HQ administrator (`requireHqAdmin`); every
 * read and every resolution is in the admin audit log. The founder's note is
 * shown to HQ and never logged.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, requireHqAdmin } from '../auth';
import { isSupportSession } from '../integrations/providers/mercury';
import { logAdminAction } from '../services/adminAudit';
import { refuse } from '../util/refusal';
import { NEW_DECK_RAIL } from './deck_new';
import type { RouteMount } from '../util/routeRegistry';
import decks from './decks';

/** The reasons a founder picks from, in the words the card shows. */
export const REPORT_REASONS = Object.freeze({
  wrong_figure: 'States something my records do not',
  poor_writing: 'Badly written or unusable',
  wrong_place: 'Put in the wrong place',
  bad_image: 'The picture is wrong',
  unsafe: 'Offensive or unsafe',
  other: 'Something else',
} as const);
export type ReportReason = keyof typeof REPORT_REASONS;
export const NOTE_MAX = 280;
export const RESOLUTION_NOTE_MAX = 500;
export const OUTCOMES = ['addressed', 'no_fault'] as const;

const UID = /^[A-Za-z0-9_-]{1,64}$/;

const reportView = (r: any) => ({
  uid: String(r.uid), proposal_uid: String(r.proposal_uid), record_ref: r.record_ref ?? null, rail_option: String(r.rail_option),
  model: r.model ?? null, usage_log_id: r.usage_log_id == null ? null : Number(r.usage_log_id),
  reason: String(r.reason), reason_label: REPORT_REASONS[r.reason as ReportReason] ?? null, note: r.note ?? null,
  status: String(r.status), outcome: r.outcome ?? null, resolution_note: r.resolution_note ?? null,
  resolved_at: r.resolved_at ?? null, created_at: String(r.created_at),
});

// ─────────────────────────────────────────────────────────── the founder's report

export const deckReports = new Hono<{ Bindings: Env }>();

deckReports.post('/proposals/:uid/report', async (c) => {
  const user = await requireAuth(c);
  const uid = c.req.param('uid');
  if (!UID.test(uid)) return refuse(c, 404, { code: 'not_found', message: 'That result is not one of yours.' });
  if (await isSupportSession(c)) return refuse(c, 403, { code: 'support_session_refused', message: 'A support session cannot report a result for this member.' });
  const body = await c.req.json().catch(() => null) as { reason?: unknown; note?: unknown } | null;
  const reason = body?.reason;
  if (typeof reason !== 'string' || !Object.prototype.hasOwnProperty.call(REPORT_REASONS, reason)) {
    return refuse(c, 400, { code: 'invalid_reason', message: `Pick a reason: ${Object.keys(REPORT_REASONS).join(', ')}.` });
  }
  const raw = body?.note;
  if (raw != null && typeof raw !== 'string') return refuse(c, 400, { code: 'invalid_note', message: 'The note must be text.' });
  const note = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  if (note && note.length > NOTE_MAX) return refuse(c, 400, { code: 'note_too_long', message: `The note is at most ${NOTE_MAX} characters.` });

  const userId = Number(user.id) || 0;
  const proposal = await c.env.DB.prepare(
    'SELECT uid, record_ref, rail_option, model, usage_log_id FROM ai_rail_proposals WHERE uid = ? AND user_id = ? AND rail_page = ?',
  ).bind(uid, userId, NEW_DECK_RAIL.page).first<any>();
  if (!proposal) return refuse(c, 404, { code: 'not_found', message: 'That result is not one of yours.' });

  const existing = await c.env.DB.prepare('SELECT * FROM deck_proposal_reports WHERE proposal_uid = ? AND user_id = ?').bind(uid, userId).first<any>();
  if (existing) {
    return refuse(c, 409, { code: 'already_reported', message: 'You already reported this result. HQ will look at it.', extra: { report: reportView(existing) } });
  }
  const reportUid = `dr_${crypto.randomUUID().replace(/-/g, '')}`;
  await c.env.DB.prepare(
    `INSERT INTO deck_proposal_reports (uid, proposal_uid, user_id, record_ref, rail_option, model, usage_log_id, reason, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(reportUid, uid, userId, proposal.record_ref ?? null, String(proposal.rail_option), proposal.model ?? null,
    proposal.usage_log_id ?? null, reason, note).run();
  const row = await c.env.DB.prepare('SELECT * FROM deck_proposal_reports WHERE uid = ?').bind(reportUid).first<any>();
  return c.json({ report: reportView(row) }, 201);
});

// ─────────────────────────────────────────────────────────── HQ's queue

export const hqDeckReports = new Hono<{ Bindings: Env }>();

hqDeckReports.get('/', async (c) => {
  const actor = await requireHqAdmin(c);
  const status = c.req.query('status') ?? 'open';
  if (!['open', 'resolved', 'all'].includes(status)) return refuse(c, 400, { code: 'invalid_status', message: 'status is open, resolved or all.' });
  const { results } = await c.env.DB.prepare(
    `SELECT r.*, l.charged_microusd AS charged_microusd, p.payload_json AS payload_json, p.status AS proposal_status
       FROM deck_proposal_reports r
       LEFT JOIN ai_usage_logs l ON l.id = r.usage_log_id
       LEFT JOIN ai_rail_proposals p ON p.uid = r.proposal_uid AND p.user_id = r.user_id
      WHERE (? = 'all' OR r.status = ?)
      ORDER BY r.id DESC LIMIT 200`,
  ).bind(status, status).all<any>();
  await logAdminAction(c.env, Number(actor.id), (actor as any).email ?? '', 'deck_reports_read', { status, count: (results ?? []).length });
  return c.json({
    reports: (results ?? []).map((r: any) => {
      let payload: unknown = null;
      try { payload = r.payload_json ? JSON.parse(r.payload_json) : null; } catch { payload = null; }
      return {
        ...reportView(r),
        // A charge that is not recorded reads null ("Not recorded"), never 0.
        charged_microusd: r.charged_microusd == null ? null : Number(r.charged_microusd),
        proposal: r.proposal_status == null ? null : { status: String(r.proposal_status), payload },
      };
    }),
  });
});

hqDeckReports.post('/:uid/resolve', async (c) => {
  const actor = await requireHqAdmin(c);
  const uid = c.req.param('uid');
  const body = await c.req.json().catch(() => null) as { outcome?: unknown; note?: unknown } | null;
  const outcome = body?.outcome;
  if (typeof outcome !== 'string' || !(OUTCOMES as readonly string[]).includes(outcome)) {
    return refuse(c, 400, { code: 'invalid_outcome', message: 'outcome is addressed or no_fault.' });
  }
  const raw = body?.note;
  if (raw != null && typeof raw !== 'string') return refuse(c, 400, { code: 'invalid_note', message: 'The note must be text.' });
  const note = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  if (note && note.length > RESOLUTION_NOTE_MAX) return refuse(c, 400, { code: 'note_too_long', message: `The note is at most ${RESOLUTION_NOTE_MAX} characters.` });
  const row = await c.env.DB.prepare(
    `UPDATE deck_proposal_reports SET status = 'resolved', outcome = ?, resolution_note = ?, resolved_by = ?, resolved_at = datetime('now')
      WHERE uid = ? AND status = 'open' RETURNING *`,
  ).bind(outcome, note, Number(actor.id), uid).first<any>();
  if (!row) {
    const known = await c.env.DB.prepare('SELECT status FROM deck_proposal_reports WHERE uid = ?').bind(uid).first<any>();
    return known
      ? refuse(c, 409, { code: 'already_resolved', message: 'This report is already resolved.' })
      : refuse(c, 404, { code: 'not_found', message: 'No report has that id.' });
  }
  await logAdminAction(c.env, Number(actor.id), (actor as any).email ?? '', 'deck_report_resolved', { report_uid: uid, outcome });
  return c.json({ report: reportView(row) });
});

/**
 * #4105: both routers mount themselves, ahead of `decks` (whose `/:id` routes
 * would otherwise answer `/proposals/:uid/report`), where index.ts mounted
 * them by hand: the founder's report under /api/decks, then HQ's queue.
 */
export const mount: RouteMount[] = [
  { path: '/api/decks', router: deckReports, before: [decks] },
  { path: '/api/admin/deck-reports', router: hqDeckReports, before: [decks] },
];
