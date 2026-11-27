### Fund admin Funds tab and one fund (D1161, #3068)

`/admin/fund-admin/funds` (FND3) reads `GET /api/funds` and splits it by the
overview's administered funds; the rest sit under "Run by an outside GP".
`?new=1` opens New fund (`POST /api/funds`, both rates required).
`/admin/fund-admin/funds/:id` (FND4) reads `GET /api/funds/:id`; `?edit=facts`
opens Edit fund facts. Economics' Change sends `PATCH /api/funds/:id` with an
optional `reason` (10 to 500 characters, else 400 `reason_invalid` before the
act gate), kept on the `fund_admin.<act>` audit row and the `fund_updated`
activity row. The LPA card uses `GET /api/funds/:id/lpa/download` and
`POST /api/funds/:id/regenerate-lpa`. No new route or migration. See
`decisions/D1161.md`.

