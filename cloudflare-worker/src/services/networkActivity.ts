/** D6557: recorded network activity belonging to the caller, with explicit per-source readability and no contact or note contents. */
import type { Env } from '../types';

export type ActivityEvent = { kind: string; at: string; label_parts: { action: string; count?: number } };
type Source = 'follow_ups' | 'introductions' | 'imports' | 'duplicate_reviews';
export async function networkActivity(env: Env, owner: number, limit: number) {
  const queries: Record<Source, string> = {
    follow_ups: `SELECT 'follow_up_completed' AS kind, t.done_at AS at FROM network_contact_tasks t
      JOIN network_connections n ON n.id = t.contact_id AND n.user_id = t.owner_user_id
      WHERE t.owner_user_id = ? AND t.done_at IS NOT NULL ORDER BY t.done_at DESC, t.id DESC LIMIT ?`,
    introductions: `SELECT kind, created_at AS at FROM relationship_interactions
      WHERE (requester_user_id = ? OR teammate_user_id = ?)
        AND kind IN ('intro_requested', 'intro_accepted', 'intro_made', 'intro_declined')
      ORDER BY created_at DESC, id DESC LIMIT ?`,
    imports: `SELECT 'contacts_imported' AS kind, finished_at AS at, rows_created AS count FROM contact_import_jobs
      WHERE owner_user_id = ? AND source IN ('linkedin_csv','linkedin_api','linkedin_dma')
        AND status = 'done' AND finished_at IS NOT NULL ORDER BY finished_at DESC, id DESC LIMIT ?`,
    duplicate_reviews: `SELECT 'duplicate_' || status AS kind, decided_at AS at FROM contact_match_reviews
      WHERE owner_user_id = ? AND status IN ('merged','kept_both','dismissed') AND decided_at IS NOT NULL
      ORDER BY decided_at DESC, id DESC LIMIT ?`,
  };
  const actions: Record<string, string> = {
    follow_up_completed: 'Follow-up completed', intro_requested: 'Introduction requested', intro_accepted: 'Introduction accepted',
    intro_made: 'Introduction made', intro_declined: 'Introduction declined', contacts_imported: 'Contacts imported',
    duplicate_merged: 'Duplicate merged', duplicate_kept_both: 'Duplicate review: kept both', duplicate_dismissed: 'Duplicate review dismissed',
  };
  const sources = {} as Record<Source, { state: 'readable' | 'unreadable'; reason: string | null }>;
  const events: ActivityEvent[] = [];
  await Promise.all((Object.entries(queries) as [Source, string][]).map(async ([source, sql]) => {
    try {
      const result = await env.DB.prepare(sql).bind(...(source === 'introductions' ? [owner, owner, limit] : [owner, limit])).all<{ kind: string; at: string; count?: number }>();
      if (!result.success) throw new Error('source_read_failed');
      for (const row of result.results || []) {
        // Fail this source rather than manufacture a date or an event from malformed storage.
        if (!actions[row.kind] || !Number.isFinite(Date.parse(row.at))) throw new Error('source_record_invalid');
      }
      events.push(...(result.results || []).map(row => ({ kind: row.kind, at: row.at,
        label_parts: { action: actions[row.kind], ...(row.kind === 'contacts_imported' ? { count: row.count } : {}) } })));
      sources[source] = { state: 'readable', reason: null };
    } catch {
      sources[source] = { state: 'unreadable', reason: 'Recorded activity from this source could not be read.' };
    }
  }));
  events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.kind.localeCompare(b.kind));
  return { events: events.slice(0, limit), sources, complete: Object.values(sources).every(s => s.state === 'readable') };
}
