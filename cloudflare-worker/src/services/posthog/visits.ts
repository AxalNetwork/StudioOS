/**
 * D6107 (#6107) — Grow › Distribution's Visit stage, from a tracked PostHog
 * metric the founder said measures visits (role `visits`).
 *
 * The owner lifted #2409's decision F for this one figure (Q1 = B), gave it a
 * role of its own (Q2 = A) and kept it to the venture's team (Q3 = A, as
 * decision C). So the stage is, in this order:
 *   - not the team:          Not recorded, PostHog figures are the team's;
 *   - no active connection:  Not recorded, PostHog is not connected;
 *   - no visits metric:      Not recorded, no metric is tracked as Visits;
 *   - tracked, nothing read: Not recorded, with the metric's own reason;
 *   - read:                  the latest figure, "From PostHog · <insight>", and its date;
 *   - a failed read:         Unreadable, never Not recorded and never 0.
 *
 * The figure is its own sourced value (#3731): it is never merged with the
 * waitlist's sign-ups or any other store, and it is not per channel. Nothing
 * here calls PostHog; it reads what a section sync landed. Nothing is logged
 * but the error's name.
 */
import type { Env } from '../../types';
import { DISCONNECTED, linkOf, metricReadings } from './metrics';

export const VISIT_TEAM_ONLY = 'Not recorded: PostHog figures are for the venture\'s team only';
export const VISIT_NOT_CONNECTED = 'Not recorded: PostHog is not connected for this venture';
export const VISIT_NO_METRIC = 'Not recorded: no PostHog metric is tracked as Visits';
export const VISIT_NOT_SYNCED = 'Not recorded: the Visits metric has no PostHog figure yet';
export const VISIT_UNREADABLE = 'Unreadable: PostHog figures could not be read';

export interface VisitStage {
  stage: 'Visit'; value: number | null;
  /** The figure stands apart: the page lists it with its source, never as the funnel's first bar. */
  apart?: true;
  source?: string; as_of?: string; state?: 'unreadable'; reason?: string;
}

const notRecorded = (reason: string): VisitStage => ({ stage: 'Visit', value: null, reason });

/** The Visit stage for one venture; `team` is whether the viewer is on its team (`isTeamViewer`). */
export async function visitStage(env: Env, projectId: number, team: boolean): Promise<VisitStage> {
  if (!team) return notRecorded(VISIT_TEAM_ONLY);
  try {
    const link = await linkOf(env, projectId);
    if (!link || !link.active) return notRecorded(VISIT_NOT_CONNECTED);
    const visits = (await metricReadings(env, projectId)).filter(({ metric }) => metric.role === 'visits');
    if (!visits.length) return notRecorded(VISIT_NO_METRIC);
    const top = visits.filter(({ reading }) => reading.value != null && reading.as_of)
      .sort((a, b) => String(b.reading.as_of).localeCompare(String(a.reading.as_of)))[0];
    if (!top) return notRecorded(visits.some(({ reading }) => reading.reason === DISCONNECTED) ? DISCONNECTED : VISIT_NOT_SYNCED);
    const name = top.metric.insight_name || 'PostHog metric';
    return { stage: 'Visit', value: top.reading.value, apart: true, source: `From PostHog · ${name}`, as_of: top.reading.as_of! };
  } catch (e) {
    console.error('[posthog/visits] unreadable:', (e as Error)?.name);
    return { stage: 'Visit', value: null, state: 'unreadable', reason: VISIT_UNREADABLE };
  }
}
