/**
 * D603 (#1286) — the Help Center's weekly guide views and yes/no answers,
 * Worker first (migration 408). Part of #1280, step 2.
 *
 * Mounted at /api/help, signed in (every role):
 *   POST /guides/:area/:guide/view       count one view: once per member per
 *                                        guide per UTC day
 *   GET  /popular?days=7&limit=4         the most-viewed guides over the last
 *                                        N days (1–30), at most 10
 *   GET  /guides/:area/:guide/feedback   the caller's own answer, or null
 *   PUT  /guides/:area/:guide/feedback   { answer: 'yes'|'no', missing? }
 *
 * And `adminHelpCenter`, mounted at /api/admin/help (`requireAdmin`):
 *   GET  /feedback                       yes/no counts per guide, and each
 *                                        "what was missing" with its date
 *
 * THE ANCHOR. A guide is `<area>/<guide>`. The guides live in the frontend's
 * manifest, which the Worker does not have, so the Worker checks the anchor's
 * SHAPE (lower-case letters, digits and hyphens, 3 to 120 characters) and
 * the page drops anchors the viewer cannot read. A bad shape is a 400 before
 * any read or write.
 *
 * NO READER IDENTITY in the counts. `help_guide_views` holds an anchor, a day
 * and a number. The per-member marks that make a view count once a day are
 * deleted after two days, on every view write. The admin read returns counts
 * and texts, never a member.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { requireAdmin, requireAuth } from '../auth';
import { refuse } from '../util/refusal';

const PART = /^[a-z0-9-]+$/;
export const MISSING_MAX = 500;
export const POPULAR_MAX_DAYS = 30;
export const POPULAR_MAX_LIMIT = 10;

/** `<area>/<guide>` from the path, or null when either part or the whole has the wrong shape. */
export function guideAnchor(area: string | undefined, guide: string | undefined): string | null {
  if (!area || !guide || !PART.test(area) || !PART.test(guide)) return null;
  const anchor = `${area}/${guide}`;
  return anchor.length >= 3 && anchor.length <= 120 ? anchor : null;
}

/** The UTC day `offset` days from `now`, as YYYY-MM-DD. */
export function utcDay(now: Date, offset = 0): string {
  return new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
}

function badAnchor(c: Context<{ Bindings: Env }>) {
  return refuse(c, 400, {
    code: 'invalid_anchor',
    message: 'A guide is addressed as <area>/<guide>: lower-case letters, digits and hyphens, 3 to 120 characters.',
  });
}

function int(raw: string | undefined, fallback: number, min: number, max: number): number | null {
  if (raw == null || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
}

const help = new Hono<{ Bindings: Env }>();

help.post('/guides/:area/:guide/view', async (c) => {
  const user = await requireAuth(c);
  const anchor = guideAnchor(c.req.param('area'), c.req.param('guide'));
  if (!anchor) return badAnchor(c);
  const now = new Date();
  const today = utcDay(now);
  try {
    // One batch: drop marks older than two days, mark this view, and count it
    // only when the mark is new (`changes()` reads the INSERT OR IGNORE).
    const out = await c.env.DB.batch([
      c.env.DB.prepare(`DELETE FROM help_guide_view_marks WHERE day < ?`).bind(utcDay(now, -1)),
      c.env.DB.prepare(`INSERT OR IGNORE INTO help_guide_view_marks (user_id, anchor, day) VALUES (?, ?, ?)`)
        .bind(user.id, anchor, today),
      c.env.DB.prepare(
        `INSERT INTO help_guide_views (anchor, day, views)
         SELECT ?, ?, 1 WHERE changes() = 1
         ON CONFLICT (anchor, day) DO UPDATE SET views = views + 1`,
      ).bind(anchor, today),
    ]);
    const counted = Number((out[2] as { meta?: { changes?: number } })?.meta?.changes ?? 0) > 0;
    return c.json({ anchor, day: today, counted });
  } catch (e) {
    return refuse(c, 503, { code: 'guide_view_not_counted', message: 'This view could not be counted. Nothing else is affected.', raw: e });
  }
});

help.get('/popular', async (c) => {
  await requireAuth(c);
  const days = int(c.req.query('days'), 7, 1, POPULAR_MAX_DAYS);
  const limit = int(c.req.query('limit'), 4, 1, POPULAR_MAX_LIMIT);
  if (days == null) return refuse(c, 400, { code: 'invalid_days', message: `days is a whole number from 1 to ${POPULAR_MAX_DAYS}.` });
  if (limit == null) return refuse(c, 400, { code: 'invalid_limit', message: `limit is a whole number from 1 to ${POPULAR_MAX_LIMIT}.` });
  try {
    const r = await c.env.DB.prepare(
      `SELECT anchor, SUM(views) AS views FROM help_guide_views
        WHERE day >= ? GROUP BY anchor HAVING SUM(views) > 0
        ORDER BY views DESC, anchor ASC LIMIT ?`,
    ).bind(utcDay(new Date(), -(days - 1)), limit).all<{ anchor: string; views: number }>();
    return c.json({
      window_days: days,
      guides: (r.results || []).map((g) => ({ anchor: g.anchor, views: Number(g.views) })),
    });
  } catch (e) {
    return refuse(c, 503, { code: 'popular_guides_unreadable', message: 'The most-read guides could not be read. This is not a sign nobody reads them.', raw: e });
  }
});

help.get('/guides/:area/:guide/feedback', async (c) => {
  const user = await requireAuth(c);
  const anchor = guideAnchor(c.req.param('area'), c.req.param('guide'));
  if (!anchor) return badAnchor(c);
  try {
    const row = await c.env.DB.prepare(
      `SELECT answer, missing, updated_at FROM help_guide_feedback WHERE anchor = ? AND user_id = ?`,
    ).bind(anchor, user.id).first<{ answer: 'yes' | 'no'; missing: string | null; updated_at: string }>();
    return c.json({ anchor, feedback: row ?? null });
  } catch (e) {
    return refuse(c, 503, { code: 'guide_feedback_unreadable', message: 'Your answer could not be read. Try again in a moment.', raw: e });
  }
});

help.put('/guides/:area/:guide/feedback', async (c) => {
  const user = await requireAuth(c);
  const anchor = guideAnchor(c.req.param('area'), c.req.param('guide'));
  if (!anchor) return badAnchor(c);
  const body = await c.req.json().catch(() => null) as { answer?: unknown; missing?: unknown } | null;
  const answer = body?.answer;
  if (answer !== 'yes' && answer !== 'no') {
    return refuse(c, 400, { code: 'invalid_answer', message: '`answer` is "yes" or "no".' });
  }
  if (body?.missing != null && typeof body.missing !== 'string') {
    return refuse(c, 400, { code: 'invalid_missing', message: '`missing` is text.' });
  }
  const missing = typeof body?.missing === 'string' ? body.missing.trim() || null : null;
  if (missing && answer === 'yes') {
    return refuse(c, 400, { code: 'missing_with_yes', message: 'What was missing is asked only with a "no".' });
  }
  if (missing && missing.length > MISSING_MAX) {
    return refuse(c, 400, { code: 'missing_too_long', message: `What was missing is at most ${MISSING_MAX} characters.` });
  }
  try {
    await c.env.DB.prepare(
      `INSERT INTO help_guide_feedback (anchor, user_id, answer, missing) VALUES (?, ?, ?, ?)
       ON CONFLICT (anchor, user_id) DO UPDATE SET
         answer = excluded.answer, missing = excluded.missing, updated_at = datetime('now')`,
    ).bind(anchor, user.id, answer, missing).run();
    return c.json({ anchor, feedback: { answer, missing } });
  } catch (e) {
    return refuse(c, 503, { code: 'guide_feedback_not_saved', message: 'Your answer was not saved. Try again in a moment.', raw: e });
  }
});

export default help;

/** Mounted at /api/admin/help. Counts and texts only: no member identity. */
export const adminHelpCenter = new Hono<{ Bindings: Env }>();

adminHelpCenter.get('/feedback', async (c) => {
  await requireAdmin(c);
  try {
    const [counts, texts] = await Promise.all([
      c.env.DB.prepare(
        `SELECT anchor,
                SUM(CASE WHEN answer = 'yes' THEN 1 ELSE 0 END) AS yes,
                SUM(CASE WHEN answer = 'no' THEN 1 ELSE 0 END) AS no
           FROM help_guide_feedback GROUP BY anchor ORDER BY no DESC, anchor ASC`,
      ).all<{ anchor: string; yes: number; no: number }>(),
      c.env.DB.prepare(
        `SELECT anchor, missing, updated_at FROM help_guide_feedback
          WHERE missing IS NOT NULL ORDER BY updated_at DESC, id DESC LIMIT 500`,
      ).all<{ anchor: string; missing: string; updated_at: string }>(),
    ]);
    return c.json({
      guides: (counts.results || []).map((g) => ({ anchor: g.anchor, yes: Number(g.yes), no: Number(g.no) })),
      missing: (texts.results || []).map((t) => ({ anchor: t.anchor, text: t.missing, at: t.updated_at })),
    });
  } catch (e) {
    return refuse(c, 503, { code: 'guide_feedback_unreadable', message: 'The guide answers could not be read. Try again in a moment.', raw: e });
  }
});
