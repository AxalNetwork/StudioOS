### Fund admin layouts (D1165, #3072)

Fees uses the existing terms, period, admission and statement reads. Reports
has Packs at `/admin/fund-admin/reports`, Report periods at `/reports/periods`
and issued Notices at `/reports/notices`, preserving `?fund=`. Report-period
editing reuses `/funds/:fundId/reporting/:periodId`. Banking keeps Accounts,
Reconciliation and Books at their D1157 addresses; Books now reads
`GET /api/fund-ledger` only when mounted there, with selected-period detail
through `GET /api/fund-ledger/:id`. No new Worker route or migration.
Nested drawers and the authenticator become phone sheets in Fund admin.
See `decisions/D1165.md` for data boundaries and live checks still UNVERIFIED.

