/**
 * D264 — the Durable Object jurisdiction, applied.
 *
 * HQ's Deploy step lets an operator choose where a branch's Durable Objects
 * live (eu, us or none), the registry file records it, and until D264 nothing
 * applied it: every `idFromName` ran on the unrestricted namespace. The API
 * is `ns.jurisdiction(j)`, which returns a namespace scoped to that
 * jurisdiction. The same name gives a DIFFERENT id in each jurisdiction, so
 * the choice is write-once: objects are born on first use, in whichever
 * namespace first asks for them, and there is no API to move one.
 *
 * That is why HQ stays unrestricted. Every object HQ has was created without
 * a jurisdiction (OnboardingChat keeps each founder's last 50 messages in its
 * storage); scoping HQ now would reach new, empty objects and strand the old
 * ones. A branch is the opposite: if its FIRST deploy carries
 * `BRANCH_DO_JURISDICTION`, every object it ever has is born in the right
 * place. Wrangler has no jurisdiction key on a Durable Object binding, so the
 * var, rendered by `scripts/lib/branchConfig.mjs`, is the only channel.
 *
 * Every `idFromName`/`get` on a Durable Object namespace goes through
 * `doNamespace`, and `do_namespace_d264.test.ts` fails on one that does not.
 */
import type { Env } from '../types';

/**
 * The jurisdictions Cloudflare offers for Durable Objects that this platform
 * accepts. `scripts/lib/branchConfig.mjs`'s DO_JURISDICTIONS is the same list,
 * and a test holds them equal.
 */
export const DO_JURISDICTIONS = ['eu', 'us', 'fedramp'] as const;
export type DoJurisdiction = (typeof DO_JURISDICTIONS)[number];

/**
 * The namespace to use on this Worker: `ns` itself when
 * `BRANCH_DO_JURISDICTION` is unset (HQ, and a branch provisioned with none),
 * or `ns.jurisdiction(v)` when it names one. Any other value THROWS, the way
 * `branchOf` does: a branch that quietly fell back to unrestricted would
 * create its objects outside the jurisdiction it was licensed for, and they
 * could never be moved.
 */
export function doNamespace(
  env: Pick<Env, 'BRANCH_DO_JURISDICTION'> | undefined | null,
  ns: DurableObjectNamespace,
): DurableObjectNamespace {
  const raw = String(env?.BRANCH_DO_JURISDICTION ?? '').trim();
  if (!raw) return ns;
  if (!(DO_JURISDICTIONS as readonly string[]).includes(raw)) {
    throw new Error(
      `BRANCH_DO_JURISDICTION "${raw}" is not a Durable Object jurisdiction (expected one of ${DO_JURISDICTIONS.join(', ')})`,
    );
  }
  return ns.jurisdiction(raw as DurableObjectJurisdiction);
}
