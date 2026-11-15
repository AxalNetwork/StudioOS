/**
 * D6068 (#6068, under #4863) — Home's "Claims backed" tile and Story's
 * Mismatch dot, read from D1264's claim store (`raise_claims`, `surface =
 * 'narrative'`) for one narrative version. It reads the states the last check
 * stored and runs no check: the Claims tab and the check route are where a
 * check runs (D912).
 *
 *   ok           `backed` of `total` claims stored for the version, when they
 *                were last checked, and the sections holding a Mismatch
 *                (`sectionOfField`, the mapping the Claims tab uses). A noted
 *                Mismatch stays a Mismatch (D900 §10). `total` 0 is a real
 *                "nothing checked yet", never a count of unknown claims.
 *   unreadable   the store could not be read; the page shows a dash and says
 *                so, never 0.
 *
 * `raiseCycle.ts` reads this for Home's part, and the route hands it
 * `sectionOfField` (`sectionOf`). This file imports nothing of `claims.ts`:
 * `claims.ts` imports `raiseCycle.ts` at load (a static import closes that
 * cycle), and through `store.ts` reaches the deck routes, which the fund
 * modules' import guards (D707, D714) must never reach from `raiseCycle.ts`.
 *
 * All SQL is bound; no figure is read or logged.
 */
import type { Env } from '../../types';

export type ClaimTally =
  | { state: 'ok'; version: number; backed: number; total: number; checked_at: string | null; mismatch_sections: string[] }
  | { state: 'unreadable'; version: number; reason: string };

/** A claim field's section, as `claims.ts`'s `sectionOfField` maps it. */
export type SectionOf = (field: string) => { key: string } | null;

export const CLAIMS_UNREADABLE_REASON = 'The claims could not be read';

export async function claimTally(env: Env, projectId: number, version: number, sectionOf: SectionOf): Promise<ClaimTally> {
  try {
    const rows = (await env.DB.prepare(
      `SELECT field_key, state, checked_at FROM raise_claims WHERE project_id = ? AND surface = 'narrative' AND surface_version = ? ORDER BY id`,
    ).bind(projectId, `v${version}`).all<{ field_key: string; state: string; checked_at: string | null }>()).results || [];
    const sections = new Set<string>();
    for (const r of rows) {
      if (r.state !== 'mismatch') continue;
      const s = sectionOf(String(r.field_key).split('#')[0]);
      if (s) sections.add(s.key);
    }
    return {
      state: 'ok', version, total: rows.length,
      backed: rows.filter((r) => r.state === 'backed').length,
      checked_at: rows.map((r) => r.checked_at).filter(Boolean).sort().at(-1) ?? null,
      mismatch_sections: [...sections],
    };
  } catch (e) {
    console.warn('[narrative] claim tally unreadable:', (e as Error)?.message);
    return { state: 'unreadable', version, reason: CLAIMS_UNREADABLE_REASON };
  }
}
