### Connectors Worker contract (D650, #1462)

`/api/connectors` and the temporary `/api/integrations` alias mount the same
`integrations.ts` router. `GET /available` returns the registry's category,
verified status, pulls, sends, feeds and permissions; Google Calendar and
Microsoft 365 read their existing calendar connections. `GET /` lists the
caller's connections with their enabled company IDs. `PUT /:uid/companies`
changes those links; `GET /:key` reports a teammate's connection by name only.
Credentials and personal Calendly, Carta and calendar records remain owned by
their connecting user; company links control writes into project-backed data.
D753: each `GET /available` item also carries `tagline`, `made_by`, `service`, `sign_in`,
`added`, `verified` (a recorded check, D753 decision 7), `verified_on`, `read_only`,
`page_key` and `page_href`. The answer carries `category_order` and `first_party`
(LinkedIn's card). `GET /directory/:key` answers one connector's page, descriptive
only: no connection, no `calls`. It answers 404 `unknown_provider` like `/:key`, and
needs no active company.
`GET /suggestions` reads empty module stores, `POST /requests` records a tool
request, and Super Admin `GET /requests` lists them. `GET /:uid/logs` searches
and pages activity. Every company ID supplied by a request is checked against
`user_company_links` before use. D751 (#1880): every OAuth connector with an
implementation also carries `configured` — `true` when Axal holds its client,
`false` when it does not, `null` when the key store could not be read — and no
other row carries the field.
Mercury (D710, #1775; D713, #1778; D752, #1886; D879–D883, #2551): the member
connector is a member's **own** Mercury, for a founder's Grow and Raise. Axal
VC's own entity accounts are never a connector: they live only in HQ › Fund
administration › Bank accounts, over `/api/admin/mercury`, and
`scripts/check-mercury-member-surfaces.mjs` (D883) fails the build if a member
surface names them again. An admin on HQ gets a read-only preview of the
founder's page (D879: no connect, no connection read), and `POST /connect`
answers them 403 `purpose_not_allowed`. A founder or partner, on either host,
and an investor on HQ get their own row, in their role's words, and connect by
Sign in with Mercury (D840, D881): a token sent to `POST /connect` answers 410
`token_connect_retired`, and a token row kept from before D881 keeps reading
until the member signs in or disconnects.
An investor on a branch gets no row, and `POST /connect` answers 403
`purpose_not_allowed` ("Mercury is offered to your profile on HQ only.").
Everyone else, and an admin on a branch, is answered as before: `GET
/available` omits it and `POST /connect`, `GET /:key` and the waitlist and
notify-me routes answer 404 as if the key did not exist.
D752 (#1887): `GET/POST /api/mercury/personal/matches` take `target=raise|commitment` for a founder (`raise_receipts`): their own committed raise prospects and pending deal commitments. Confirming sets the prospect's `commit_status` to `wired`, or the commitment to `confirmed`.
`GET /api/revenue/projects/:projectId/mercury-credits` items carry `fits_raise_target`, and a confirmed raise receipt's line is refused `raise_receipt`.
D752 (#1889): `GET /api/revenue/projects/:projectId/mercury-spend?months=` (the project's own founder; built per request) and `POST …/mercury-spend/snapshot` `{ include_cash, confirm_visible: true }`, which upserts one `source = 'mercury'` `project_metrics` row.
`POST /api/progress/metrics/:projectId` refuses a `source` of `stripe` or `mercury` (400 `source_reserved`), and `PUT /api/progress/metrics/snapshot/:id` refuses a `mercury` row's date or figures (409 `mercury_figure_locked`).
D752 (#1888): `/api/mercury/attestations`, an investor's proof of capital (`routes/mercury_attestations.ts`, migration 491). No route returns a balance.
- `GET /` (the caller's own statements, every state, with admin views) and `POST /:uid/revoke` refuse a support session and a branch, but not a role. Another member's uid is 404 `attestation_not_found`, as a missing one is; a second revoke is 409 `already_revoked`.
- `GET /targets` (their open deal commitments, Fund I application and Fund I LP commitment, each with its cap and reason, the minimum and the consent words; no bank read), `GET /accounts` (checking and savings: id, name, kind, last four, and the holder) and `POST /` `{ purpose, target_id, account_ids, amount_cents?, consent, consent_version }` run the `capital_attestation` policy: 403 `support_session_refused`, `purpose_not_allowed` or `hq_only`.
- `POST /` refuses before any bank read with `consent_required`, `consent_outdated`, `invalid_purpose`, `invalid_target_id`, `invalid_accounts`, `target_not_found` (404, the same body for another member's target), `target_not_attestable`, `invalid_amount` or `amount_above_target`; after its two GETs with `account_not_found`, 502 `mercury_unreadable`, 502 `holder_unreadable` or 409 `balance_below_amount` (no figure). 201 stores the statement only, superseding the target's active one.
D752 (#1890): `GET /api/admin/capital-attestations` with `?purpose&target_id`, `?deal_id` or `?fund_id`; an Admin on HQ (`requireMercuryReader`); audited first (`capital_attestations_read`) or 503 `audit_unavailable`; reads `capital_attestations` and `users` only; each read counts a view on the statements whose amount it carries; a revoked statement carries no amount and no holder. `GET /api/admin/lp-applications` rows carry `proof_of_funds` as a state only.
D749 (#1838): `POST /api/admin/mercury/transactions/:uid/not-ours` `{ reason, note }` marks a posted credit Not ours (201), and `POST /api/admin/mercury/not-ours/:uid/withdraw` `{ reason }` withdraws the mark. Both are an Admin's on HQ, under the `mercury.reconcile` act.
`GET /api/admin/mercury/transactions?match=none` leaves out a line with an active mark (and `direction=credit|debit`, D717 #1856, keeps only credits or debits), `match=not_ours` lists the marked lines, and each item carries `not_ours`. The monthly cash summary and the quarterly report's `unmatched_count` leave active marks out.

