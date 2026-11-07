## HQ platform capacity (D4559, #4559)

No page or canvas is implemented here. The capacity panel on HQ · Platform
(`/admin/platform`, Super Admin only) waits on a canvas (`needs-design` on
#4559, `AGENTS.md` § Missing UI), so no `frontend/src/lib/api/` method calls
this route yet. The Worker side is `routes/admin_platform.ts` and
`services/platformCapacity.ts`; the metric dictionary is
`documentation/operations/PLATFORM_OBSERVABILITY.md`.

| Route | Who | What it answers |
| --- | --- | --- |
| `GET /api/admin/platform/capacity` | Super Admin on HQ (`requireSuperAdmin`); no session is 401, anyone else 403 | `private, no-store`. `{ observed_at, scope, level, d1_limit_bytes, d1_limit_basis, d1_policy_note, metrics[], bindings[], not_read_here[] }`. Each metric carries its key, unit, source, `availability` (`measured`, `unavailable` with a reason, or `none_waiting` for an empty queue's age), `value` (`null` when not measured, never 0) and `level`. `level` overall is never `ok` while a metric is `unknown`. Names no member, company or tenant. |
