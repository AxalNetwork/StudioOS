/**
 * D5859 (#5859, part 2a of #2399) — the two reads of a linked Facebook Page: its follower count and its daily
 * insights. THE ONLY FILE THAT READS PAGE FIGURES (`facebook_grow_5859.test.ts` holds the tree to that). The calls
 * go through the provider's bounded Graph call (`facebookGraph`, one Graph version, `redirect: 'error'`, the
 * app-secret proof, errors as codes), with the Page access token the sync read from `/me/accounts` a moment before.
 *
 *   GET /{page-id}?fields=followers_count
 *   GET /{page-id}/insights?metric=page_media_view,page_total_media_view_unique,page_post_engagements&period=day&since=&until=
 *
 * An answer is read field by field into typed rows. A count Facebook did not give is absent, never 0; a 0 it gave
 * is 0. Nothing here logs.
 *
 * UNVERIFIED (D5859 §5): the follower field, the three metric names, the `period=day` shape, the 93-day window and
 * the reading of `end_time` are #2399's reading of Meta's pages. This session could not reach developers.facebook.com
 * (2026-11-15). Every name is in the constants below, and nowhere else.
 */
import { facebookGraph, type FacebookGrant } from '../../integrations/providers/facebook';

export const FOLLOWER_FIELD = 'followers_count';
/** Each stored kind and the insights metric it is read from (UNVERIFIED names). */
export const INSIGHT_METRICS = Object.freeze({
  views: 'page_media_view',
  viewers: 'page_total_media_view_unique',
  engagements: 'page_post_engagements',
} as const);
export type InsightKind = keyof typeof INSIGHT_METRICS;
/** Days per insights request; Meta caps a `period=day` range at 93 days (UNVERIFIED). */
export const WINDOW_DAYS = 90;

export interface InsightRow { kind: InsightKind; day: string; value: number }
export interface FacebookReads {
  followers(): Promise<number | null>;
  /** Daily figures for the days `since` to `until`, both included (YYYY-MM-DD). */
  insights(since: string, until: string): Promise<InsightRow[]>;
}

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
/** A count: a safe non-negative integer, else null. */
export const count = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const KIND_OF: Record<string, InsightKind> = Object.fromEntries(Object.entries(INSIGHT_METRICS).map(([k, m]) => [m, k as InsightKind]));

/**
 * Meta's insights answer: `data: [{ name, period, values: [{ value, end_time }] }]`. A daily value's `end_time` is
 * the end of its day, the next midnight in the Page's time zone (UNVERIFIED), so the day it counts is the day before
 * that date. A metric not asked for, a non-daily series, an unreadable time or a value that is not a count is dropped.
 */
export function parseInsights(data: Record<string, unknown>): InsightRow[] {
  const out: InsightRow[] = [];
  for (const raw of Array.isArray(data.data) ? data.data : []) {
    const m = obj(raw);
    const kind = typeof m?.name === 'string' ? KIND_OF[m.name] : undefined;
    if (!m || !kind || m.period !== 'day') continue;
    for (const rawValue of Array.isArray(m.values) ? m.values : []) {
      const v = obj(rawValue);
      const value = count(v?.value);
      const end = typeof v?.end_time === 'string' ? v.end_time.slice(0, 10) : '';
      if (value === null || !DAY.test(end) || Number.isNaN(Date.parse(`${end}T00:00:00Z`))) continue;
      out.push({ kind, day: addDays(end, -1), value });
    }
  }
  return out;
}

/** The reads for one Page, with its Page grant. */
export function facebookReads(pageId: string, grant: FacebookGrant): FacebookReads {
  return {
    async followers() {
      const data = await facebookGraph(`/${pageId}?fields=${FOLLOWER_FIELD}`, grant);
      return count(obj(data)?.[FOLLOWER_FIELD]);
    },
    async insights(since, until) {
      const q = new URLSearchParams({ metric: Object.values(INSIGHT_METRICS).join(','), period: 'day', since, until: addDays(until, 1) });
      const data = await facebookGraph(`/${pageId}/insights?${q}`, grant);
      return parseInsights(obj(data) ?? {}).filter((r) => r.day >= since && r.day <= until);
    },
  };
}
