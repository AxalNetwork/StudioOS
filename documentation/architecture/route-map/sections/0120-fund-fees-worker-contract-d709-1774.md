### Fund fees Worker contract (D709, #1774)

`/api/fund-fees/:fundId` (`fund_fees.ts`). Every route opens with `requireFundGp` (the GP of record or an admin; 401, 402 or 404 otherwise). Every write then asserts its D714 act (`assertFundAct`): confirm (`fee_terms.confirm`) and issue (`fee_period.issue`) are Super Admin acts, `super_admin_required` (403) to a plain Admin first, then `requireSuperAdminWriteBar`; every other write is `fee.write`. A support session gets `support_session_refused` (403) on every write.
- `GET /`: terms versions and their defaults, billable LPs with admission dates (a missing one flagged), net invested records, offsets, periods.
- `POST /terms` writes a `draft` version; `POST /terms/:termsUid/confirm` makes it `confirmed`, the only state that bills.
- `PUT /lps/:lpId/admission`, `POST /net-invested`, `POST /offsets`.
- `POST /periods/:quarter/preview` saves the quarter's draft and answers its `digest`; a refusal saves nothing.
- `POST /periods/:quarter/issue` with `{ digest, funding_call_uid? }`: a digest that no longer matches is 409; issuing an issued quarter with its digest answers `already_issued: true` and writes nothing.
- `POST /periods/:quarter/funding-call` with `{ call_uid }` links issued lines to their LPs' lines in that call.
- `GET /periods/:quarter` (period, lines, `collected`: the posted date and last four of a confirmed Mercury match, else null, D710; and `remittance`) and `GET /periods/:quarter/statements/:lpId` (its `pay_to` is never due, plus the same `remittance`). On Fund I the remittance is #1773's `payInstructionsFor('gp', 'management_fee')`, masked with its warning, or its refusal; on any other fund it is `not_an_axal_fund` and the registry is not read.

`:quarter` is `YYYYQn`. An LP, terms version or call of another fund is 404. Issuing records amounts and the `AXAL-MF-<quarter>-L<lp>` and `-F<fund>` references; nothing moves money, and no route has a frontend method yet (#1779's `fundFeesApi`).

