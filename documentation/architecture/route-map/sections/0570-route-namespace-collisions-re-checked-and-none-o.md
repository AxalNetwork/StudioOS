## Route-namespace collisions — re-checked, and none of them are collisions

This table previously listed six collisions "to resolve before mounting
anything". Re-verified against `main` and against the installed router, none of
the six is a route collision. Corrected in full, because the original framing
would have bought a redesign nobody needed.

**The load-bearing error: React Router does not match in registration order.**
`react-router-dom` 7.18.2 with `<Routes>` ranks by specificity — a static
segment outranks a dynamic one wherever each is registered. Verified directly
with `matchRoutes`:

```
routes registered as: /deals, /deals/:dealId, /deals/pipeline, /deals/screening,
                     /deals/commit, /deals/closing
  /deals/pipeline   -> /deals/pipeline      (NOT /deals/:dealId)
  /deals/screening  -> /deals/screening
  /deals/commit     -> /deals/commit
  /deals/closing    -> /deals/closing
  /deals/42         -> /deals/:dealId
```

Registration order *does* decide matching in Hono, which is why the worker's
`/api/deals/pass-analytics` had to be mounted above `/api/deals/:id` in #329.
The two systems are not the same and the earlier note conflated them.

| Canvas proposes | Was recorded as | Actually |
| --- | --- | --- |
| `/deals/{pipeline,screening,commit,closing}` | swallowed by `/deals/:dealId` | **Not a collision.** The literals outrank the param. Mount them in any order. |
| `/pipeline/{leads,proposals,…}` (partner) | collides with investor `/pipeline/*` | **Not a collision.** The BD Console canvas's pipeline tabs are `all` / `mine` / `floor` / `retainer` — client-side filters inside one page, not sibling routes, and none share a name with `screening`/`commit`/`transactions`. |
| `/grow/*` | collides with `/founder/growth/*` | **Moot.** #326 withdrew the Growth section; zero `/founder/growth` routes remain. |
| `/research/*` | collides with `/advisor/research/*` | **Not a collision — a duplicate surface.** Distinct paths that render the same material. D8 already settled the market tab (`/advisor/research/market` (retired D2319) → `/market-intel` (retired D2319)); the rest is the same call, not a routing one. |
| `/fund/*` | collides with `/funds/*` | **Not a collision.** Singular and plural are distinct namespaces. It is a *legibility* hazard — two prefixes one letter apart — and the fix is to not introduce `/fund/*`, not to re-route `/funds/*`. |
| `/practice/*` | collides with `/advisor/advisory/*` | **Not a collision — a duplicate surface.** Same class as `/research/*`. |

So the real question under four of these is D7's, not a routing one: **two URLs
serve the same material — which one survives?** The answer D8 set is the
precedent: keep the surface with the live backend, redirect the other.

Phase 2 is therefore not blocked on a namespace redesign. What it is blocked on
is the duplicate-surface calls above, each of which is a small, independent
decision, and D4 (**resolved: persona roots stay prohibited** — see
`DECISIONS.md`, enforced by `frontend/test/route_namespace_policy.test.mjs`).

