/**
 * D4295 (#4295, D4289 P6) — the influencer analytics read.
 *
 *   GET /api/influencer/me/analytics?from&to&channel&grain=week
 *       → every figure IN1, IN2, IN4 and IN5 draw (services/influencer/analytics.ts),
 *         plus `line`, IN1's Eadwyn line restating them with their date
 *   GET /api/admin/influencers/:uid/analytics?from&to&channel&grain=week
 *       → the same figures for HQ. Money is the Super Admin's: any other admin
 *         gets each money figure as { available: false, reason: 'hq_reads' }
 *         (O-MONEY A).
 *
 * WHO. The member's read is an admitted influencer's own (`isInfluencer`);
 * anyone else gets 404 `not_an_influencer`. HQ's needs an admin.
 *
 * Totals only: no reply names, or carries the id or email of, a referred
 * member. A malformed range is 400 `invalid_range`; a grain other than a week
 * is 400 `unsupported_grain`. Nothing is logged but the read failing.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, requireAdmin, isSuperAdmin } from '../auth';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import { isInfluencer } from '../services/influencer/membership';
import { influencerAnalytics, rangeOf, summaryLine } from '../services/influencer/analytics';

const me = new Hono<{ Bindings: Env }>();
const admin = new Hono<{ Bindings: Env }>();

const CHANNEL = /^[a-z0-9_]{1,24}$/;

async function read(c: any, userId: number, money: boolean) {
  const grain = c.req.query('grain') || 'week';
  if (grain !== 'week') return refuse(c, 400, { code: 'unsupported_grain', message: 'The figures are grouped by week.' });
  const channel = c.req.query('channel') || null;
  if (channel && !CHANNEL.test(channel)) return refuse(c, 400, { code: 'invalid_channel', message: 'A channel is the sub-link name, such as yt or newsletter.' });
  const now = new Date();
  const range = rangeOf(c.req.query('from') || undefined, c.req.query('to') || undefined, now);
  if (!range) return refuse(c, 400, { code: 'invalid_range', message: 'Give from and to as dates (YYYY-MM-DD), from first, at most a year apart.' });
  const figures = await influencerAnalytics(c.env, userId, range, { channel, money, now });
  return c.json({ ...figures, line: summaryLine(figures) });
}

me.get('/me/analytics', async (c) => {
  const user = await requireAuth(c);
  if (!(await isInfluencer(c.env, user.id))) {
    return refuse(c, 404, { code: 'not_an_influencer', message: 'This is for admitted Axal influencers.' });
  }
  return read(c, user.id, true);
});

admin.get('/:uid/analytics', async (c) => {
  const user = await requireAdmin(c);
  const target = await c.env.DB.prepare(`SELECT id FROM users WHERE uid = ?`).bind(c.req.param('uid')).first<{ id: number }>();
  if (!target || !(await isInfluencer(c.env, target.id))) return refuse(c, 404, { code: 'not_an_influencer', message: 'No influencer has that id.' });
  return read(c, target.id, isSuperAdmin(user as any));
});

export const mount: RouteMount[] = [
  { path: '/api/influencer', router: me },
  { path: '/api/admin/influencers', router: admin },
];

export default me;
