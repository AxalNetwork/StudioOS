# middleware — the gates every request passes

Cross-cutting request handling. Mounted in `cloudflare-worker/src/index.ts`
ahead of the routers, or applied per-route where the gate is specific.

| File | What it enforces |
| --- | --- |
| `requireTier.ts` | Plan entitlement. `ensureTier(user, 'growth')` and friends. |
| `requireInvestorTier.ts` | The investor-side equivalent. |
| `rateLimit.ts` | Request budgets. **Fails closed** — a bucket that cannot be read denies rather than allows. |
| `csrf.ts` | CSRF protection on state-changing requests. |
| `securityHeaders.ts` | CSP and the rest of the header set. |
| `cfAccess.ts` | Cloudflare Access for protected surfaces. |
| `miAccess.ts` | Market-intelligence access control. |
| `recoveryCoolOff.ts` | Throttles account recovery. |
| `lastActive.ts` | Touches the session's last-active stamp. |
| `observability.ts` | Request logging and tracing. |

## The rule

**Fail closed.** Every gate here denies when it cannot decide. Two of them
previously failed open — the rate limiter and the AI budget — and both were
changed after the reason for the fallback stopped being true. A gate that
allows on error is not a gate.

Row-level scoping is *not* here: that lives in
`cloudflare-worker/src/services/tenancyScope.ts`, because it composes into SQL
rather than short-circuiting a request.
