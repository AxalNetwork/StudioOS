# Country catalogue: reconcile the figures with their history

D7714 (#7714). Use this to check that every country market figure HQ holds
agrees with its observation history, to repair the one value known to have no
history row, and to import the missing figures through the supported route
without duplicating history. The tables are the licence-pricing catalogue's
(`country_market_profiles`, `country_market_observations`; D5014, D5016).

The owner runs every step, as the signed-in Super Admin on HQ (a branch
deployment is refused). The repair and the import are an owner step on #5013;
report there.

## Rules

- **Never write the production database by hand.** No SQL against
  `studioos-db`, no console edit. Every change goes through the routes below,
  which write the profile and its history row in one batch and record the
  actor and the reason.
- **History cannot be changed or deleted.** `country_market_observations` is
  append-only by trigger. A wrong figure is corrected by recording the right
  one, which adds a row.
- **Snapshots and pricing decisions are never touched.** A repaired or newly
  recorded figure changes the next recommendation only (D5016 decision 7).
- **Keep the source file, the saved reads and the import body outside the
  repository.** They hold production figures; none is committed, pasted into
  an issue or sent to a chat. Report kinds, countries and fields, not values.
- **Never resend a body.** A partial answer (`207`) means the named countries
  changed since the read: read again and rebuild.

## Which step a screen sends today

| Step | Route | Gate | Screen |
| --- | --- | --- | --- |
| Which figures are missing | `GET /api/admin/licence-pricing/catalogue?incomplete=1` | `requireSuperAdmin` | HQ › Licences › Pricing (`/admin/licences/pricing`) |
| A country's figures and history | `GET /api/admin/licence-pricing/catalogue/:code` | `requireSuperAdmin` | HQ › Licences › Pricing › country |
| The consistency read | `GET /api/admin/licence-pricing/consistency` | `requireSuperAdmin` | none |
| The profiles with their figures and revisions | `GET /api/admin/licence-pricing/countries` | `requireSuperAdmin` | none |
| Record one figure | `POST /api/admin/licence-pricing/countries/:code/observations` | `requireSuperAdminWriteBar` | none |
| Mark a field provisional or not recorded | `PUT /api/admin/licence-pricing/countries/:code/fields/:field/status` | `requireSuperAdminWriteBar` | none |
| Import figures | `POST /api/admin/licence-pricing/countries/import` | `requireSuperAdminWriteBar` | none |

No screen sends a write today: #5020 closed with the read screens only
(D5020-p2 §3), and #7715 draws the write screens. Until it lands, the owner
sends these requests from their own signed-in session. This runbook does not
describe how a session is carried.

## 1. Read first

1. Send `GET /api/admin/licence-pricing/consistency` and save the answer
   outside the repository.
2. Check `checked.countries` and `checked.fields` (49 and 196 today). An empty
   `findings` list with `checked.countries` of 0 means nothing was read, not
   that nothing is wrong.
3. Compare `findings` with what the audit of 2026-11-19 found: exactly one
   finding, of kind `value_without_history`, on `ppp_gdp_per_capita`.
   **If the read shows anything more, stop and report on #5013**: each
   finding's kind, country and field, and its `snapshots.count` and
   `snapshots.decisions`. Do not repair or import until the owner decides.
4. Note the finding's `snapshots`: the frozen snapshots that hold that value
   and the pricing decisions made from them. They stay as they are.

## 2. Repair the one value

The owner's question on #7714 is open; until it is answered this follows **B**.

**B (recommended): record the checked figure again.** One write, through
either route:

- `POST /api/admin/licence-pricing/countries/:code/observations` with
  `field`, `value`, `status`, `source`, `source_ref`, `as_of`, the
  `expected_revision` from a fresh read, and a `reason` that says the figure is
  recorded again because its history row was missing (D7714); or
- the import in step 3, built with the saved consistency read, which keeps
  the reported field in the body even when it equals the profile.

The value, source, reference and as-of date come from the reviewed source,
checked again, not copied from the profile.

**A: clear, then record.** `PUT …/fields/ppp_gdp_per_capita/status` with
`status: not_recorded` and a reason, then record the figure as in B. Two
writes; between them the market has no PPP figure and cannot be priced.

Then read again (step 1): the finding is gone.

## 3. Build and send the import

1. Save `GET /api/admin/licence-pricing/countries` (not the priced
   `/catalogue` list, which holds no figures) and a fresh consistency read,
   both outside the repository.
2. Build the body:

   ```sh
   node scripts/build-country-import.mjs \
     --source <reviewed source file> --catalogue <countries read> \
     --consistency <consistency read> --reason "<why>" --out <body outside the repository>
   ```

   The source file names, per row, the country, field, value, status, source,
   reference and as-of date. The builder never rounds a value and never
   supplies a status, source or date: a row missing one is refused by its
   number, as is a non-integer value, a country not in the read, a
   provisional rank and more than 500 rows to send. It leaves out a row that
   equals the profile, unless the consistency read reports that field or
   `--again CODE:field` names it. With nothing to import it writes no file and
   says so. It calls no API.
3. Read the body before sending it: the rows, the countries in
   `expected_revisions`, the reason.
4. Send it as the body of `POST /api/admin/licence-pricing/countries/import`.
   - `200`: every country applied (`applied` counts rows per country).
   - `207`: the countries in `conflicts` changed since the read and applied
     nothing; the others applied. Go back to 3.1, read again and rebuild. Never
     resend the same body.
   - `400`: a row is invalid and nothing was imported; the answer names the
     row. Fix the source file and rebuild.

## 4. Read again

1. `GET /api/admin/licence-pricing/consistency`: `findings` is empty, and
   `checked` still counts every country.
2. `GET /api/admin/licence-pricing/catalogue?incomplete=1`: what is still
   missing.
3. Rebuilding from the re-read catalogue writes no file: everything sent is
   held.
4. Report on #5013: the counts before and after, by kind and field, and which
   answer (B or A) was used. No figures.
