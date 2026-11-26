/**
 * D8529 (#8529) — what `server.ts` seeds for `account_journey_8529.spec.mjs`: for each width, two accounts that have
 * finished onboarding and own nothing yet. A creates everything the journey needs through the real routes; B is
 * signed in only when the journey reaches the sign-in page. Every person is made up.
 *
 * D8691 (#8691): finishing onboarding includes accepting the Terms and the Privacy Policy, so each account carries
 * that acceptance the way the licence step records it (`recordTermsAcceptance`). Without it the account owes the
 * acceptance the moment anything seeds its obligations: the Account page's trust strip reads `GET /api/trust/me`,
 * whose self-heal writes `tos_v1` and `privacy_v1` as pending, and from then on `/auth/me` says
 * `terms_acceptance_pending` and the app draws the terms screen in place of every page. B reaches that strip only
 * at 1440px, and only when the venture page lives long enough to read it, which is how step 5 failed some runs.
 */
import { createJWT } from '../../../cloudflare-worker/src/auth.ts';
import { recordTermsAcceptance, seedObligations } from '../../../cloudflare-worker/src/services/trust.ts';

export const JOURNEY_WIDTHS = [1440, 390] as const;
type Account = { token: string; user: Record<string, unknown> };
export type JourneyCase = { width: number; a: Account; b: Account };

export async function seedAccountJourney(db: any, env: any): Promise<JourneyCase[]> {
  const out: JourneyCase[] = [];
  let n = 0;
  for (const width of JOURNEY_WIDTHS) {
    n += 1;
    // 85500+: clear of _venturespace_seed.ts, whose twelve cases take user ids 85281..85393.
    const base = 85490 + n * 10;
    const make = async (k: 'a' | 'b', id: number, name: string) => {
      const email = `journey-${k}-${n}@example.invalid`;
      db.prepare("INSERT INTO users (id, uid, role, name, email, is_active, founder_id, subscription_tier, created_at) VALUES (?, ?, 'founder', ?, ?, 1, ?, 'studio', '2026-09-01 09:00:00')")
        .run(id, `journey-${k}-${n}`, name, email, id * 10);
      db.prepare("INSERT INTO onboarding_progress (user_id, flow, step, total_steps, completed_at) VALUES (?, 'founder', 3, 3, '2026-09-01 09:00:00')").run(id);
      await seedObligations(env, id, 'founder', { failOnError: true });
      await recordTermsAcceptance(env, id, { surface: 'onboarding_licence' });
      // No `jti`: a jti binds the token to a `user_sessions` row, which this seed has no need to write.
      return { token: await createJWT(env, id, email, 'founder'), user: { id, role: 'founder', name, email, founder_id: id * 10 } };
    };
    out.push({ width, a: await make('a', base + 1, `Ada Journey ${n}`), b: await make('b', base + 2, `Ben Journey ${n}`) });
  }
  return out;
}
