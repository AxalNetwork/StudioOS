/**
 * T15 — Demand heatmap + insight feed (port of insights.py).
 * Mounted at /api/insights. Aggregates founder_needs.
 *
 * SCOPE CUT: weekly digest cron is NOT wired in this worker port. The
 * /newsletter/preview endpoint produces a digest snapshot for the calling user
 * (so the UI can preview), and /newsletter/{subscribe,unsubscribe} just toggle
 * a row in `insight_subscriptions`. Send loop must be added separately.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { isAdmin, isPartner, isInvestor, mapError, nowIso } from './_t13t14t15_helpers';

const r = new Hono<{ Bindings: Env }>();

const STAGE_BUCKETS = ['idea', 'prototype', 'mvp', 'seed', 'series_a', 'growth', 'other'];

function gate(u: User) {
  if (!(isAdmin(u) || isPartner(u) || isInvestor(u))) throw new Error('Forbidden');
}

function stageBucket(s: string | null | undefined): string {
  if (!s) return 'other';
  const lc = s.toLowerCase();
  return STAGE_BUCKETS.includes(lc) ? lc : 'other';
}

type EnrichedRow = {
  id: number; category: string; stage: string; sector: string;
  geography: string; status: string; budget_min: number | null;
  budget_max: number | null; created_at: string;
};

async function joinRows(env: Env, sinceIso: string | null): Promise<EnrichedRow[]> {
  const sql = sinceIso
    ? 'SELECT * FROM founder_needs WHERE created_at >= ?'
    : 'SELECT * FROM founder_needs';
  const needs = sinceIso
    ? ((await env.DB.prepare(sql).bind(sinceIso).all<any>()).results || [])
    : ((await env.DB.prepare(sql).all<any>()).results || []);
  if (!needs.length) return [];
  const projIds = [...new Set(needs.map((n: any) => n.project_id))];
  const ph = projIds.map(() => '?').join(',');
  const projects = ((await env.DB.prepare(
    `SELECT id, sector, stage, entity_id FROM projects WHERE id IN (${ph})`
  ).bind(...projIds).all<any>()).results || []) as any[];
  const projMap = new Map(projects.map((p) => [p.id, p]));
  const entityIds = [...new Set(projects.map((p) => p.entity_id).filter(Boolean))];
  let entityMap = new Map<number, any>();
  if (entityIds.length) {
    const eph = entityIds.map(() => '?').join(',');
    const ents = ((await env.DB.prepare(
      `SELECT id, jurisdiction FROM entities WHERE id IN (${eph})`
    ).bind(...entityIds).all<any>()).results || []) as any[];
    entityMap = new Map(ents.map((e) => [e.id, e]));
  }
  const out: EnrichedRow[] = [];
  for (const n of needs) {
    const proj = projMap.get(n.project_id);
    const ent = proj?.entity_id ? entityMap.get(proj.entity_id) : null;
    out.push({
      id: n.id, category: n.category,
      stage: stageBucket(proj?.stage),
      sector: proj?.sector || 'unspecified',
      geography: ent?.jurisdiction || 'unspecified',
      status: n.status,
      budget_min: n.budget_min, budget_max: n.budget_max,
      created_at: n.created_at,
    });
  }
  return out;
}

function pct(a: number, b: number): number { return b === 0 ? 0 : Math.round((a / b) * 100); }

function buildHeatmap(rows: EnrichedRow[]): any {
  const byCS = new Map<string, number>();
  const cats = new Set<string>();
  const sec = new Map<string, number>();
  const geo = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.category}|${r.stage}`;
    byCS.set(k, (byCS.get(k) || 0) + 1);
    cats.add(r.category);
    sec.set(r.sector, (sec.get(r.sector) || 0) + 1);
    geo.set(r.geography, (geo.get(r.geography) || 0) + 1);
  }
  const catList = [...cats].sort();
  const matrix = catList.map((c) => ({
    category: c,
    row: STAGE_BUCKETS.map((s) => ({ stage: s, count: byCS.get(`${c}|${s}`) || 0 })),
  }));
  const totalsByCat: Record<string, number> = {};
  for (const c of catList) totalsByCat[c] = STAGE_BUCKETS.reduce((a, s) => a + (byCS.get(`${c}|${s}`) || 0), 0);
  const totalsByStage: Record<string, number> = {};
  for (const s of STAGE_BUCKETS) totalsByStage[s] = catList.reduce((a, c) => a + (byCS.get(`${c}|${s}`) || 0), 0);
  const top = (m: Map<string, number>, n = 12) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ count: v, [k]: undefined }));
  return {
    categories: catList, stages: STAGE_BUCKETS, matrix,
    totals_by_category: totalsByCat, totals_by_stage: totalsByStage,
    by_sector: [...sec.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => ({ sector: k, count: v })),
    by_geography: [...geo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => ({ geography: k, count: v })),
    total_needs: rows.length,
  };
}

function buildTrend(rows: EnrichedRow[], months = 6): any[] {
  if (months < 1) months = 6;
  const today = new Date();
  today.setUTCDate(1); today.setUTCHours(0, 0, 0, 0);
  const buckets: string[] = [];
  let cur = new Date(today);
  for (let i = 0; i < months; i++) {
    buckets.push(cur.toISOString().slice(0, 7));
    cur.setUTCMonth(cur.getUTCMonth() - 1);
  }
  buckets.reverse();
  const map = new Map<string, { month: string; total: number; by_category: Record<string, number> }>();
  for (const b of buckets) map.set(b, { month: b, total: 0, by_category: {} });
  for (const r of rows) {
    const key = (r.created_at || '').slice(0, 7);
    const slot = map.get(key);
    if (slot) {
      slot.total++;
      slot.by_category[r.category] = (slot.by_category[r.category] || 0) + 1;
    }
  }
  return buckets.map((b) => map.get(b)!);
}

function buildFeed(rows: EnrichedRow[]): any[] {
  const out: any[] = [];
  if (!rows.length) return out;
  const catCounts = new Map<string, number>();
  for (const r of rows) catCounts.set(r.category, (catCounts.get(r.category) || 0) + 1);
  const sortedCats = [...catCounts.entries()].sort((a, b) => b[1] - a[1]);
  const [topCat, topN] = sortedCats[0];
  out.push({
    id: 'top_category',
    headline: `${topCat.replace(/_/g, ' ').replace(/\b\w/g, (s) => s.toUpperCase())} is the most-requested category`,
    detail: `${topN} of ${rows.length} open posts (${pct(topN, rows.length)}%) name it as the primary need.`,
    tone: 'neutral',
  });
  for (const stage of ['seed', 'mvp', 'prototype', 'series_a']) {
    const sRows = rows.filter((r) => r.stage === stage);
    if (sRows.length >= 3) {
      const sc = new Map<string, number>();
      for (const r of sRows) sc.set(r.category, (sc.get(r.category) || 0) + 1);
      const [cat, n] = [...sc.entries()].sort((a, b) => b[1] - a[1])[0];
      out.push({
        id: `stage_${stage}_top`,
        headline: `${pct(n, sRows.length)}% of ${stage.replace(/_/g, ' ')}-stage founders requested ${cat.replace(/_/g, ' ')} help`,
        detail: `${n}/${sRows.length} ${stage}-stage needs in the current window.`,
        tone: 'highlight',
      });
      break;
    }
  }
  return out;
}

r.get('/heatmap', async (c) => {
  try {
    const user = await requireAuth(c); gate(user);
    const days = Math.max(1, Math.min(720, Number(c.req.query('window_days') || 180)));
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const rows = await joinRows(c.env, since);
    return c.json({ window_days: days, ...buildHeatmap(rows) });
  } catch (e) { return mapError(c, e); }
});

r.get('/trends', async (c) => {
  try {
    const user = await requireAuth(c); gate(user);
    const months = Math.max(1, Math.min(24, Number(c.req.query('months') || 6)));
    const rows = await joinRows(c.env, null);
    return c.json({ months, series: buildTrend(rows, months) });
  } catch (e) { return mapError(c, e); }
});

r.get('/feed', async (c) => {
  try {
    const user = await requireAuth(c); gate(user);
    const days = Math.max(1, Math.min(720, Number(c.req.query('window_days') || 90)));
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const rows = await joinRows(c.env, since);
    return c.json({ window_days: days, items: buildFeed(rows) });
  } catch (e) { return mapError(c, e); }
});

r.get('/newsletter', async (c) => {
  try {
    const user = await requireAuth(c); gate(user);
    const sub = await c.env.DB.prepare(
      'SELECT is_subscribed, cadence, last_sent_at FROM insight_subscriptions WHERE user_id = ?'
    ).bind(user.id).first<any>();
    return c.json({
      is_subscribed: !!sub?.is_subscribed,
      cadence: sub?.cadence || 'weekly',
      last_sent_at: sub?.last_sent_at || null,
    });
  } catch (e) { return mapError(c, e); }
});

async function setSub(env: Env, userId: number, on: boolean) {
  await env.DB.prepare(
    `INSERT INTO insight_subscriptions (user_id, is_subscribed, cadence, created_at, updated_at)
     VALUES (?, ?, 'weekly', ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET is_subscribed = excluded.is_subscribed, updated_at = excluded.updated_at`
  ).bind(userId, on ? 1 : 0, nowIso(), nowIso()).run();
}

r.post('/newsletter/subscribe', async (c) => {
  try {
    const user = await requireAuth(c); gate(user);
    await setSub(c.env, user.id, true);
    return c.json({ ok: true, is_subscribed: true });
  } catch (e) { return mapError(c, e); }
});

r.post('/newsletter/unsubscribe', async (c) => {
  try {
    const user = await requireAuth(c); gate(user);
    await setSub(c.env, user.id, false);
    return c.json({ ok: true, is_subscribed: false });
  } catch (e) { return mapError(c, e); }
});

r.get('/newsletter/preview', async (c) => {
  try {
    const user = await requireAuth(c); gate(user);
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const rows = await joinRows(c.env, since);
    return c.json({
      window_days: 7,
      generated_at: nowIso(),
      headline: `${rows.length} new founder needs this week`,
      heatmap: buildHeatmap(rows),
      feed: buildFeed(rows),
    });
  } catch (e) { return mapError(c, e); }
});

export default r;
