### Influencer payout readiness (D4294, #4294, D4289 P5)

- **Worker, `routes/influencer_payouts.ts`** (self-mounting at `/api/influencer` and `/api/admin/influencers`):
  - `GET /api/influencer/me/payout-readiness` → `{ influencer, ready, currency, minimum_cents, items: [identity, tax_form, terms, payout_method, minimum, monthly] }`, each item `{ ready, blocks, code, line, … }`;
  - `GET /api/influencer/me/tax-form` → `{ status: missing | submitted | accepted | rejected, form_type, submitted_at, decided_at, reason }`;
  - `POST /api/influencer/me/tax-form` `{ form_type: w9 | w8ben, file }` (a PDF, JPEG or PNG data URI, at most 5 MB) → 201;
  - `POST /api/influencer/me/terms/accept` `{ version }` → 409 `terms_version_not_current` unless it is the current version;
  - `POST /api/admin/influencers/:uid/tax-form/decision` `{ decision: accept | reject, reason }`, the Super Admin only (403 `super_admin_only`);
  - `GET /api/admin/influencers/:uid/tax-form/file`, the Super Admin only: the file, `no-store`, as an attachment.
  - Anyone who is not an admitted influencer gets 404 `not_an_influencer` on the member routes.
- **Gate on `POST /api/network/payout/request`** (`routes/network.ts`), for an influencer only, in order: 403 `kyc_required`, `tax_form_required`, `terms_acceptance_required`; 400 `below_payout_minimum` (the payable balance, then the request); 403 `payout_already_requested_this_month`; 400 `payout_currency_not_terms`.
- **Tables:** `influencer_tax_forms` and `influencer_terms_acceptances` (migration `202611031530_influencer_payout_readiness.sql`). The file is in the private `FILES` bucket under `taxforms/`.
- **Client:** none yet. P7 (#4296) draws IN4 from the readiness read.
