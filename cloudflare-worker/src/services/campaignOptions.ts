/** D4487: venture-bound campaign selector metadata for Distribution's existing form-options read. */
import type { Env } from '../types';

/** Only the route's already-authorized venture; no provider call, credentials or mutation. */
export async function campaignOptions(env: Env, projectId: number) {
  const [segments, channels, pieces, drafts] = await Promise.all([
    env.DB.prepare('SELECT id, name, source FROM customer_segments WHERE project_id = ? AND archived_at IS NULL ORDER BY id').bind(projectId).all(),
    env.DB.prepare('SELECT uid, name, kind FROM growth_channels WHERE project_id = ? ORDER BY name, uid').bind(projectId).all(),
    env.DB.prepare(`SELECT i.uid, i.title, i.status, g.uid AS channel_uid, g.name AS channel_name
      FROM content_calendar_items i LEFT JOIN growth_channels g ON g.id = i.channel_id AND g.project_id = ?
      WHERE i.project_id = ? ORDER BY i.id`).bind(projectId, projectId).all(),
    env.DB.prepare("SELECT uid, body_json, status FROM publish_drafts WHERE project_id = ? AND module = 'distribution' AND status = 'draft' ORDER BY id")
      .bind(projectId).all<{ uid: string; body_json: string; status: string }>(),
  ]);
  return {
    segmentsState: 'ready', channelsState: 'ready', segments: segments.results ?? [],
    channels: (channels.results ?? []).map(row => ({ ...row, connected: null, connection_reason: 'Not recorded: no provider connection is mapped to this channel' })),
    pieces: pieces.results ?? [],
    drafts: (drafts.results ?? []).map(({ body_json, ...row }) => {
      let title: string | null = null;
      try { const body = JSON.parse(body_json); for (const value of [body?.title, body?.text]) if (typeof value === 'string' && value.trim()) { title = value.trim().slice(0, 200); break; } } catch { /* Missing/unreadable title stays null. */ }
      return { ...row, title };
    }),
  };
}
