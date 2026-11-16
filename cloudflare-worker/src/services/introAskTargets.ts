/**
 * D6260 (#6260) — the name an investor's own introduction ask shows for its
 * target, and only a name the investor could already see.
 *
 * `GET /api/introductions` used to return ids alone, so the Asked view printed
 * "Founder #12". This joins the name, and it does so through D702's two
 * existing visibility rules, called here and never restated:
 *
 *   - a founder: the person's effective profile visibility
 *     (`effectiveVisibilityFor` + `visibleToViewer`, services/userSettings.ts),
 *     the rule the public profile read serves people by; the account must be
 *     active and a founder (`role = 'founder'` or a founder record), so an id
 *     that names another investor, or anyone else, is not a founder target;
 *   - a project: not deleted, and not in `hiddenFromInvestor`
 *     (services/investorFindable.ts), the rule every investor read that lists
 *     or opens a venture applies.
 *
 * A target that fails its rule reads `available: false` and carries no name,
 * which the page says as "Not available". A lookup that fails reads as
 * unreadable for the whole list (`unreadable: true`), never as "not available"
 * and never as a guessed name.
 */
import type { Env, User } from '../types';
import { effectiveVisibilityFor, visibleToViewer } from './userSettings';
import { hiddenFromInvestor } from './investorFindable';

export type AskRow = {
  founder_user_id?: number | null;
  founder_id?: number | null;
  project_id?: number | null;
};
export type AskTarget = { kind: 'founder' | 'project' | null; name: string | null; available: boolean };

const idOf = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/** The target each ask names, in the order given, or `unreadable` when a lookup failed. */
export async function askTargets(
  env: Env, viewer: Pick<User, 'id' | 'role'>, rows: AskRow[],
): Promise<{ unreadable: false; targets: AskTarget[] } | { unreadable: true; targets: null }> {
  try {
    const founderRecordIds = [...new Set(rows.filter((r) => !idOf(r.founder_user_id) && !idOf(r.project_id))
      .map((r) => idOf(r.founder_id)).filter((n): n is number => n !== null))];
    // A founder record names its person the way D702 resolves it: the lowest user id on that record.
    const byRecord = new Map<number, number>();
    if (founderRecordIds.length) {
      const res = await env.DB.prepare(
        `SELECT founder_id, MIN(id) AS user_id FROM users
          WHERE founder_id IN (SELECT value FROM json_each(?)) GROUP BY founder_id`,
      ).bind(JSON.stringify(founderRecordIds)).all<{ founder_id: number; user_id: number }>();
      for (const r of res.results || []) byRecord.set(Number(r.founder_id), Number(r.user_id));
    }
    const personOf = (r: AskRow): number | null => idOf(r.founder_user_id)
      ?? (idOf(r.project_id) ? null : byRecord.get(idOf(r.founder_id) ?? 0) ?? null);

    const personIds = [...new Set(rows.map(personOf).filter((n): n is number => n !== null))];
    const people = new Map<number, string | null>();
    if (personIds.length) {
      const res = await env.DB.prepare(
        `SELECT id, COALESCE(display_name, name) AS name FROM users
          WHERE id IN (SELECT value FROM json_each(?)) AND is_active = 1
            AND (role = 'founder' OR founder_id IS NOT NULL)`,
      ).bind(JSON.stringify(personIds)).all<{ id: number; name: string | null }>();
      const found = res.results || [];
      const vis = await effectiveVisibilityFor(env, found.map((u) => Number(u.id)));
      for (const u of found) {
        if (visibleToViewer(vis.get(Number(u.id)) ?? 'public', Number(u.id), viewer.id)) people.set(Number(u.id), u.name ?? null);
      }
    }

    const projectIds = [...new Set(rows.filter((r) => !idOf(r.founder_user_id)).map((r) => idOf(r.project_id))
      .filter((n): n is number => n !== null))];
    const projects = new Map<number, string | null>();
    if (projectIds.length) {
      const res = await env.DB.prepare(
        `SELECT id, name FROM projects WHERE id IN (SELECT value FROM json_each(?)) AND deleted_at IS NULL`,
      ).bind(JSON.stringify(projectIds)).all<{ id: number; name: string | null }>();
      const found = res.results || [];
      const hidden = await hiddenFromInvestor(env, viewer, found.map((p) => Number(p.id)));
      for (const p of found) if (!hidden.has(Number(p.id))) projects.set(Number(p.id), p.name ?? null);
    }

    const targets = rows.map((r): AskTarget => {
      // The same precedence as the page's ask key: a founder account, then a project, then a founder record.
      if (idOf(r.founder_user_id) || (!idOf(r.project_id) && idOf(r.founder_id))) {
        const person = personOf(r);
        return person !== null && people.has(person)
          ? { kind: 'founder', name: people.get(person) ?? null, available: true }
          : { kind: 'founder', name: null, available: false };
      }
      const project = idOf(r.project_id);
      if (project !== null) {
        return projects.has(project)
          ? { kind: 'project', name: projects.get(project) ?? null, available: true }
          : { kind: 'project', name: null, available: false };
      }
      return { kind: null, name: null, available: false };
    });
    return { unreadable: false, targets };
  } catch (e) {
    console.error('[introductions] ask target names unreadable', (e as Error).message);
    return { unreadable: true, targets: null };
  }
}
