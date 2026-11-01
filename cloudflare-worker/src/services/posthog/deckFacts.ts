/**
 * D1601 (#3880) — what a pitch deck reads from a venture's PostHog: the
 * product facts #2409's feeds store for its linked project, never a live
 * PostHog call.
 *
 * THE LINK. A venture reads the one PostHog project linked to it on the
 * connector page (`posthog_project_links`, D1385), through a connection that
 * is active and switched on for the venture's company (`projectEnabled`). No
 * link, or a link through a connection that is off, is no PostHog at all.
 *
 * NO FEED STORES A FACT YET. `POSTHOG_FEEDS` is empty (`posthogFeeds.ts`):
 * #3731 parts 2–6 build the feeds and their fact store. Until then the facts
 * are none and the weekly series is null, so every deck slot that reads them
 * says "not recorded", never 0. When the store lands, these two functions read
 * it and nothing else changes.
 *
 * All SQL is bound; none is interpolated.
 */
import type { Env } from '../../types';
import { projectEnabled } from '../../integrations/companyScope';

/** The three figures a deck's Traction card reads from PostHog. */
export type PosthogDeckFactKey = 'activation_rate' | 'retention_w4' | 'wau';

/** One stored fact: its value, the day it was measured and the row behind it. */
export interface PosthogDeckFact { key: PosthogDeckFactKey; value: number | null; as_of: string | null; ref: string }

/** The venture's linked PostHog project, read through its connection. */
export interface PosthogDeckLink { integration_id: number; posthog_project_id: string }

/** The venture's PostHog link, or null when it has none or its connection is off for the venture's company. */
export async function posthogDeckLink(env: Env, projectId: number): Promise<PosthogDeckLink | null> {
  const row = await env.DB.prepare(
    "SELECT l.integration_id, l.posthog_project_id FROM posthog_project_links l JOIN integrations i ON i.id = l.integration_id " +
    "WHERE l.project_id = ? AND i.provider_key = 'posthog' AND i.status = 'active'",
  ).bind(projectId).first<{ integration_id: number; posthog_project_id: string }>();
  if (!row || !(await projectEnabled(env, Number(row.integration_id), projectId))) return null;
  return { integration_id: Number(row.integration_id), posthog_project_id: String(row.posthog_project_id) };
}

/** The facts the feeds stored for this link. No feed stores any yet (#3731), so none. */
export async function posthogDeckFacts(_env: Env, _link: PosthogDeckLink): Promise<PosthogDeckFact[]> {
  return [];
}

/** Weekly active users, one point per week, from the feeds' store. No feed stores it yet (#3731), so null. */
export async function posthogWauWeekly(_env: Env, _link: PosthogDeckLink): Promise<{ points: Array<{ x: string; y: number }>; as_of: string | null; ref: string } | null> {
  return null;
}
