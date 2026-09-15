/**
 * HQ reads every branch at once, and one branch being down says nothing about
 * the others (D108).
 *
 * THE RULE THIS FILE EXISTS FOR. Under D.2 each branch is its own Worker over
 * its own database, so every cross-branch figure on an HQ screen is N remote
 * calls, and any of them can fail or simply never answer. A fan-out that
 * awaited them together would make HQ's Home as available as its least
 * available branch — and a fan-out that summed whatever came back would print
 * a total that is quietly missing a territory. Neither is acceptable on a
 * screen whose whole job is "the whole business at a glance".
 *
 * So: `Promise.allSettled` under a deadline, a per-branch state, and totals
 * that carry their own denominator. `{ok, answered, total}` is on every
 * aggregate this returns, and the H1 precedent it follows is the disputes zone
 * (`hq_revenue_h5.test.mjs`): a zone that cannot be read says so beside the
 * ones that can, rather than rendering as empty.
 *
 * THREE STATES, NOT TWO, and the third is the one that gets forgotten:
 *   - `ok`         — it answered; `data` and its own `as_of`.
 *   - `unreadable` — it did not answer, or threw. This is NOT a claim that the
 *     branch is down: a binding can be misconfigured, a deploy can be mid-
 *     flight, the deadline can be too tight. The UI says "could not be read"
 *     and offers a retry, and the copy is careful not to promote it to an
 *     outage.
 *   - `not_deployed` — HQ has a licence and a registry row but no binding yet.
 *     Structurally different from a failure and must not share its colour.
 *
 * WHY THE BINDINGS ARE DISCOVERED AND NOT LISTED. `wrangler.toml` gains a
 * `[[services]]` entry per branch at provisioning time (D.7), so the env is
 * the registry; a second list in code would be a thing to forget to update.
 * The prefix is `BRANCH_`, which is why no other binding may use it.
 */
import type { Env } from '../types';
import { withDeadline } from '../util/deadline';
import { BRANCH_CODE_RE } from '../util/branch';

/**
 * How long one branch gets before HQ stops waiting on it.
 *
 * Calls run concurrently, so this is the ceiling for the whole fan-out rather
 * than per branch times N. Two seconds matches the KV deadline in
 * `middleware/rateLimit.ts` for the same reason given there: far above a
 * healthy round trip inside one account, far below what a person will sit
 * through, and the alternative is not a slower page but no page.
 */
export const BRANCH_DEADLINE_MS = 2_000;

/** The binding prefix. Exported so the guard test cannot drift from it. */
export const BRANCH_BINDING_PREFIX = 'BRANCH_';

export type BranchState = 'ok' | 'unreadable' | 'not_deployed';

export type BranchResult<T> = {
  code: string;
  binding: string;
  status: BranchState;
  data?: T;
  as_of?: string;
  reason?: string;
};

type BranchStub = Record<string, (...args: unknown[]) => Promise<unknown>>;

/**
 * Every `BRANCH_*` service binding on this Worker, as `{code, binding, stub}`.
 *
 * The code is the binding's suffix lower-cased: `BRANCH_FR` → `fr`, which is
 * the same code `BRANCH_CODE` carries on that branch and the same one
 * `licence_deployments` keys on. A suffix that is not a valid code is skipped
 * rather than half-used — it means someone added a binding by hand under a
 * name the generator would not have produced.
 */
export function branchBindings(env: Env): Array<{ code: string; binding: string; stub: BranchStub }> {
  const bag = env as unknown as Record<string, unknown>;
  const out: Array<{ code: string; binding: string; stub: BranchStub }> = [];
  for (const key of Object.keys(bag)) {
    if (!key.startsWith(BRANCH_BINDING_PREFIX)) continue;
    // `BRANCH_CODE`, `BRANCH_NAME` and `BRANCH_TERRITORY` share the prefix and
    // are plain vars on a BRANCH, never bindings on HQ. Excluded by name
    // rather than by type so the reason is visible: they are the reserved
    // three, and a fourth reserved var would be added here.
    if (key === 'BRANCH_CODE' || key === 'BRANCH_NAME' || key === 'BRANCH_TERRITORY') continue;
    const value = bag[key];
    if (!value || typeof value !== 'object') continue;
    const code = key.slice(BRANCH_BINDING_PREFIX.length).toLowerCase().replace(/_/g, '-');
    if (!BRANCH_CODE_RE.test(code)) continue;
    out.push({ code, binding: key, stub: value as BranchStub });
  }
  return out.sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Call one method on every branch, concurrently, under one deadline.
 *
 * `Promise.allSettled`, never `Promise.all`: the whole point is that a
 * rejection is a per-branch state and not an outcome for the call.
 */
export async function fanOut<T>(
  env: Env,
  method: string,
  args: unknown[] = [],
  deadlineMs = BRANCH_DEADLINE_MS,
): Promise<BranchResult<T>[]> {
  const targets = branchBindings(env);
  if (!targets.length) return [];

  const settled = await Promise.allSettled(
    targets.map(async (t) => {
      const fn = t.stub?.[method];
      if (typeof fn !== 'function') {
        // The binding exists and does not expose the method: an older branch
        // deploy. A different failure from "did not answer", and one a deploy
        // fixes rather than a retry.
        throw new Error(`${t.binding} does not expose ${method}() — the branch may be on an older deploy`);
      }
      return withDeadline(
        Promise.resolve(fn.call(t.stub, ...args)) as Promise<T>,
        deadlineMs,
        `${t.binding}.${method}`,
      );
    }),
  );

  return targets.map((t, i) => {
    const r = settled[i];
    if (r.status === 'fulfilled') {
      const data = r.value as T & { as_of?: string };
      return {
        code: t.code,
        binding: t.binding,
        status: 'ok' as const,
        data,
        as_of: data && typeof data === 'object' ? data.as_of : undefined,
      };
    }
    return {
      code: t.code,
      binding: t.binding,
      status: 'unreadable' as const,
      // The message, never the stack, and bounded: this reaches a screen.
      reason: String((r.reason as Error)?.message || r.reason || 'unknown').slice(0, 300),
    };
  });
}

/**
 * The denominator every cross-branch aggregate must carry.
 *
 * "Of N branches, M answered" is the sentence H1 has to be able to say. A
 * total without it is a number that silently shrinks when a branch is
 * unreachable, which is the failure mode this whole module is shaped around.
 */
export function coverage<T>(results: BranchResult<T>[]): {
  total: number; answered: number; complete: boolean; unreadable: string[];
} {
  const unreadable = results.filter((r) => r.status !== 'ok').map((r) => r.code);
  return {
    total: results.length,
    answered: results.filter((r) => r.status === 'ok').length,
    complete: unreadable.length === 0,
    unreadable,
  };
}

/**
 * Merge the deployment rows HQ holds with what the bindings actually answered.
 *
 * A licence can be deployed in the registry and have no binding yet — HQ
 * redeploys to gain one (D.7, and the accepted cost in F.11). That row is
 * `not_deployed` from this Worker's point of view, and saying so is more
 * useful than omitting it: the Platform screen's job is to show exactly that
 * gap.
 */
export function withRegistry<T>(
  results: BranchResult<T>[],
  registry: Array<{ code: string; hostname?: string | null; status?: string | null }>,
): BranchResult<T>[] {
  const seen = new Map(results.map((r) => [r.code, r]));
  for (const row of registry || []) {
    const code = String(row?.code || '').toLowerCase();
    if (!code || seen.has(code)) continue;
    seen.set(code, {
      code,
      binding: `${BRANCH_BINDING_PREFIX}${code.toUpperCase().replace(/-/g, '_')}`,
      status: 'not_deployed',
      reason:
        'HQ holds a deployment row for this branch but this Worker has no service binding to it yet. '
        + 'The binding is committed to wrangler.toml at provisioning and arrives with HQ\'s next deploy.',
    });
  }
  return [...seen.values()].sort((a, b) => a.code.localeCompare(b.code));
}
