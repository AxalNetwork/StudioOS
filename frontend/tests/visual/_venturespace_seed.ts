/**
 * D8527 (#8527) — what `server.ts` seeds for `venturespace_stale_access_8527.spec.mjs`: for each scenario, its own
 * copy of three accounts, so one scenario's revocation, archive or move never reaches another's:
 *
 *   A  owns Northwind and Southwind (primary admin of both) and the venture, which sits in Northwind;
 *   B  is a Member of Northwind and holds a co-founder seat on the venture; one data-room file is shared with it;
 *   C  has no access to any of it.
 *
 * Each account finished onboarding, so the app's wizard gate lets it in. Sessions are minted by the Worker's own
 * `createJWT`, without a `jti`, so no `user_sessions` row is needed. Every person, company and file is made up.
 */
import { createJWT } from '../../../cloudflare-worker/src/auth.ts';

export const VENTURESPACE_SCENARIOS = ['revoke', 'late', 'archive', 'move', 'switch', 'back'] as const;
export const VENTURESPACE_WIDTHS = [1440, 390] as const;

type Account = { token: string; user: Record<string, unknown> };
export type VentureSpaceCase = {
  scenario: string; width: number; projectId: number; projectName: string; fileUid: string; projectUid: string;
  north: { id: number; uid: string; name: string }; south: { id: number; uid: string; name: string };
  a: Account; b: Account; c: Account;
};

export async function seedVentureSpace(db: any, env: any): Promise<VentureSpaceCase[]> {
  const out: VentureSpaceCase[] = [];
  let n = 0;
  for (const scenario of VENTURESPACE_SCENARIOS) {
    for (const width of VENTURESPACE_WIDTHS) {
      n += 1;
      const base = 85270 + n * 10; // user ids base+1..3, companies base+1..2, venture base
      const ids = { a: base + 1, b: base + 2, c: base + 3 };
      const founderIds = { a: base * 10 + 1, b: base * 10 + 2, c: base * 10 + 3 };
      const names = { a: `Ada Made-up ${n}`, b: `Ben Made-up ${n}`, c: `Cy Made-up ${n}` };
      const email = (k: string) => `venturespace-${k}-${n}@example.invalid`;
      for (const k of ['a', 'b', 'c'] as const) {
        db.prepare("INSERT INTO users (id, uid, role, name, email, is_active, founder_id, subscription_tier, created_at) VALUES (?, ?, 'founder', ?, ?, 1, ?, 'studio', '2026-09-01 09:00:00')")
          .run(ids[k], `vs-${k}-${n}`, names[k], email(k), founderIds[k]);
        db.prepare("INSERT INTO onboarding_progress (user_id, flow, step, total_steps, completed_at) VALUES (?, 'founder', 3, 3, '2026-09-01 09:00:00')").run(ids[k]);
      }
      const north = { id: base + 1, uid: `vs-north-${n}`, name: `Northwind Made-up ${n}` };
      const south = { id: base + 2, uid: `vs-south-${n}`, name: `Southwind Made-up ${n}` };
      for (const co of [north, south]) {
        db.prepare("INSERT INTO company_profiles (id, uid, company_name, created_at, updated_at) VALUES (?, ?, ?, '2026-09-01 09:00:00', '2026-09-01 09:00:00')").run(co.id, co.uid, co.name);
        db.prepare("INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin, created_at) VALUES (?, ?, ?, 'Owner', 1, '2026-09-01 09:00:00')")
          .run(`vs-l-${co.uid}-a`, co.id, ids.a);
      }
      db.prepare("INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin, created_at) VALUES (?, ?, ?, 'Member', 0, '2026-09-02 09:00:00')")
        .run(`vs-l-${north.uid}-b`, north.id, ids.b);
      const projectId = base;
      const projectUid = `vs-venture-${n}`;
      const projectName = `Made-up Venture ${n}`;
      db.prepare("INSERT INTO projects (id, uid, name, founder_id, company_id, stage, created_at) VALUES (?, ?, ?, ?, ?, 'seed', '2026-09-01 09:00:00')")
        .run(projectId, projectUid, projectName, founderIds.a, north.id);
      db.prepare("INSERT INTO project_members (project_id, user_id, role, status, accepted_at) VALUES (?, ?, 'owner', 'accepted', '2026-09-01 09:00:00')").run(projectId, ids.a);
      db.prepare("INSERT INTO project_members (project_id, user_id, role, status, accepted_at) VALUES (?, ?, 'cofounder', 'accepted', '2026-09-02 09:00:00')").run(projectId, ids.b);
      const fileUid = `vs-file-${n}`;
      db.prepare("INSERT INTO data_room_files (uid, project_id, name, r2_key, visibility) VALUES (?, ?, 'Made-up plan.pdf', ?, 'open')")
        .run(fileUid, projectId, `data-room/${projectUid}/plan.pdf`);
      const account = async (k: 'a' | 'b' | 'c'): Promise<Account> => ({
        // No `jti`: a jti binds the token to a `user_sessions` row, which this seed has no need to write.
        token: await createJWT(env, ids[k], email(k), 'founder'),
        user: { id: ids[k], role: 'founder', name: names[k], email: email(k), founder_id: founderIds[k] },
      });
      out.push({ scenario, width, projectId, projectName, projectUid, fileUid, north, south, a: await account('a'), b: await account('b'), c: await account('c') });
    }
  }
  return out;
}
