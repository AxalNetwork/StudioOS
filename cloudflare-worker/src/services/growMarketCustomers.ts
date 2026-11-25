/**
 * D8253 (#8253): a market's own prospects and customers, counted by the country they were tagged with
 * (`contacts.country`, audience 'customer'). Tagged rows only: an untagged row is in no country, and a market whose
 * country has no tagged rows is Not recorded, never 0.
 */
import type { Env } from '../types';

export type CustomerEvidence = { state: 'ok' | 'not_recorded' | 'unreadable'; tagged: number | null; reason: string | null };

/** Tagged prospects and customers per country code for one venture; null when the read failed. */
export async function taggedByCountry(env: Env, projectId: number): Promise<Map<string, number> | null> {
  try {
    const res = await env.DB.prepare(
      `SELECT country, COUNT(*) AS n FROM contacts WHERE project_id = ? AND audience = 'customer' AND country IS NOT NULL AND country <> '' GROUP BY country`,
    ).bind(projectId).all<{ country: string; n: number }>();
    return new Map((res.results || []).map((r) => [String(r.country).toUpperCase(), Number(r.n)]));
  } catch { return null; }
}

export function customerEvidence(counts: Map<string, number> | null, geographyRef: unknown): CustomerEvidence {
  if (counts == null) return { state: 'unreadable', tagged: null, reason: 'The prospects and customers could not be read.' };
  const code = typeof geographyRef === 'string' ? geographyRef.toUpperCase() : '';
  if (!code) return { state: 'not_recorded', tagged: null, reason: 'No country is attached to this market.' };
  const n = counts.get(code);
  return n ? { state: 'ok', tagged: n, reason: null } : { state: 'not_recorded', tagged: null, reason: 'No prospect or customer is tagged with this country.' };
}
