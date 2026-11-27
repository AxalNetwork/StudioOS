/**
 * D4663 (#4663) — has this founder graduated from the Spin-Out Lab? One read
 * of the one rule, for every caller that asks about one founder.
 *
 * The rule itself is D4659's: the view `spinout_lab_graduates` (migration
 * 202611071800) holds every founder with every required step of weeks 1 to 4
 * recorded (`by_rule = 1`), and every holder of an issued credential
 * (`by_rule = 0` when that is all they have). `isLabGraduate` in
 * `spinoutLabCatalog.ts` is the same rule over a set of keys. Before this
 * module, `/state` and the credential trigger in `labProgress.ts` each wrote
 * their own SELECT on the view; they now ask `graduationOf`.
 *
 *   graduated   the founder is a graduate: the workspace, the certificate
 *               page and the public lists all say so (`/state`'s `graduated`).
 *   by_rule     the founder meets the rule from recorded steps, which is what
 *               issues a credential and pays the graduation bonus. A holder
 *               whose credential predates the rule is `graduated` without it.
 *
 * A read that fails throws: the caller decides what an unreadable answer is
 * (`/state` says `venture_unreadable`; the trigger leaves the credential to
 * the backfill and the reconciler). It is never "not graduated".
 */
import type { Env } from '../types';

export type Graduation = { graduated: boolean; by_rule: boolean; graduated_at: string | null };

export async function graduationOf(env: Env, userId: number): Promise<Graduation> {
  const row = await env.DB.prepare(
    'SELECT graduated_at, by_rule FROM spinout_lab_graduates WHERE user_id = ?',
  ).bind(userId).first<{ graduated_at: string | null; by_rule: number | null }>();
  if (!row) return { graduated: false, by_rule: false, graduated_at: null };
  return { graduated: true, by_rule: Number(row.by_rule) === 1, graduated_at: row.graduated_at ?? null };
}
