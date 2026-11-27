/**
 * D1465 § Notifications (#4022, RR08; #3713 Q3 B): the founder is told, in the
 * app, each time an admin reads with a reason. No email.
 *
 * Four reads call `notifyReasonedRead`, each AFTER its own record is written,
 * in the same request:
 *   - the narrative grant (`giveReason`, `services/narrative/adminRead.ts`);
 *   - the cap table support read (`POST /api/captable/access/:projectId/support`);
 *   - the data room support read (`POST /api/data-room/:projectUid/support-read`);
 *   - the capital relationships support read (`POST /api/cycles/raise/capital-relationships/support-read`).
 *
 * Fail closed: a read that cannot be recorded never reaches here, so nothing
 * is sent. A notification that fails leaves the read standing; the failure is
 * logged by code only. The reason's words go to the founder's own notification
 * and nowhere else: not to a log line, not to an activity row. A missing admin
 * name reads "Not recorded", never an invented one. Who may read what does not
 * change here.
 */
import type { Env } from '../types';
import { notify } from './notify';
import { hydrateSuperAdmin, isSuperAdmin } from '../auth';

export type ReadSurface = 'narrative' | 'cap_table' | 'data_room' | 'capital_relationships';
export const NOT_RECORDED = 'Not recorded';
export const REASONED_READ_TYPE = 'reasoned_read';

const OPENED: Record<ReadSurface, string> = {
  narrative: 'opened your Investor narrative',
  cap_table: 'opened your Cap table for support',
  data_room: 'opened your Data room for support',
  capital_relationships: 'read your Capital relationships',
};
/** How long the read stays open: a narrative grant runs 8 hours; a support read is one opening. */
const SPAN: Record<ReadSurface, string> = { narrative: '8 h', cap_table: 'one open', data_room: 'one open', capital_relationships: 'one open' };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "1 Nov 2026, 18:54 UTC". */
export function whenOf(at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}, ${p(at.getUTCHours())}:${p(at.getUTCMinutes())} UTC`;
}

/** The notification's words. */
export function noticeOf(n: { surface: ReadSurface; adminName: string | null; hq: boolean; reason: string; at: Date }): { title: string; body: string } {
  const name = n.adminName?.trim() || NOT_RECORDED;
  return {
    title: `${name} · ${n.hq ? 'HQ' : 'Studio admin'} ${OPENED[n.surface]}`,
    body: `${n.reason} · ${whenOf(n.at)} · ${SPAN[n.surface]}`,
  };
}

export interface ReasonedRead {
  surface: ReadSurface;
  projectId: number;
  /** The venture's `founder_id`, when the caller has it; else it is read from `projects`. Its active founder users are told. */
  founderId?: number | null;
  admin: { id: number; role?: string | null };
  reason: string;
  link: string;
  at?: Date;
}

/**
 * One in-app notification to each active founder user of the venture, never
 * to the admin who read. Never throws: a failure is logged by code, and the
 * read the caller already recorded stands. Returns how many were sent.
 */
export async function notifyReasonedRead(env: Env, r: ReasonedRead): Promise<number> {
  try {
    const founderId = r.founderId !== undefined ? r.founderId
      : (await env.DB.prepare('SELECT founder_id FROM projects WHERE id = ?').bind(r.projectId).first<{ founder_id: number | null }>())?.founder_id ?? null;
    if (founderId == null) return 0;
    const admin = await env.DB.prepare('SELECT id, name, role FROM users WHERE id = ?').bind(r.admin.id).first<{ id: number; name: string | null; role: string | null }>();
    let hq = false;
    try { hq = isSuperAdmin(await hydrateSuperAdmin(env, { ...(admin ?? {}), id: r.admin.id, role: admin?.role ?? r.admin.role } as any)); } catch { hq = false; }
    const { title, body } = noticeOf({ surface: r.surface, adminName: admin?.name ?? null, hq, reason: r.reason, at: r.at ?? new Date() });
    const founders = (await env.DB.prepare(
      "SELECT id FROM users WHERE founder_id = ? AND role = 'founder' AND is_active = 1 AND id != ? ORDER BY id",
    ).bind(founderId, r.admin.id).all<{ id: number }>()).results || [];
    let sent = 0;
    for (const f of founders) {
      const id = await notify(env, {
        userId: Number(f.id), type: REASONED_READ_TYPE, title, body, link: r.link,
        payload: { project_id: r.projectId, surface: r.surface }, channels: ['in_app'], category: 'security',
      });
      if (id != null) sent += 1;
    }
    return sent;
  } catch (e) {
    console.error('[reasoned-read] notify_failed', r.surface, (e as Error)?.name || 'error');
    return 0;
  }
}
