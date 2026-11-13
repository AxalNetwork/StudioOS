### Fund notices and booklets Worker contract (D716, #1781)

The Subscription Booklet's store is mounted at `/api/fund-booklets` (`routes/fund_booklets.ts`, `services/subscriptionBooklet.ts`, migration 478).
- **The applicant** (an approved Fund I `lp_applications` row; anyone else gets 404):
  - `POST /mine` opens the booklet, or returns the live one.
  - `GET /mine` answers the parts, the fields with their ticks and `group` (the nearest counsel heading above each, for the screen only, never in the digest; #1866), `missing_parts` and the digest.
  - `PUT /mine/answers { answers: [{ field_id, checked }] }`: 400 `field_unknown`, 409 `booklet_not_open`.
  - `POST /mine/submit { digest }`: 409 `booklet_part_missing` (naming the parts) or `content_changed`.
  - `GET /mine/paper` answers `{ html, digest, page_size }`: the booklet on #1776's paper, screen HTML with the faces inline, `no-store`. `?part=2..9` draws that one part alone, with no cover and no contents, and the whole booklet's digest; any other value is 400 `part_invalid` (#1866). A submitted booklet prints its frozen text (D759).
  - `GET /mine` and the Admin's `GET /:uid` carry `edition` (v[N]) and `signing: { state, signed_at, accepted_at }` (`not_sent`, `sent`, `awaiting_gp`, `accepted`, `void`); the Admin's read also `gp_sent` (D759).
  - `POST /mine/sign` (D759) sends the submitted booklet for the applicant's signature (Parts 3 to 8) and answers 201 `{ uid, stage: 'applicant', envelope_uuid, token }`, `no-store`; the token goes to the caller, its recipient, alone. Refusals in order: 404 `booklet_not_found`, 403 `support_session_refused`, 403 `hq_only`, 409 `booklet_not_submitted`, 409 `booklet_already_sent` (`state`), 409 `booklet_part_missing` (`parts`), 409 `booklet_text_changed`, 503 `booklet_send_failed`.
  - A support session cannot write.
- **An Admin on HQ** (`hq_only` on a branch; support session refused; D714 acts):
  - `GET /` lists the booklets, with no ticks (`fund_booklet.read`).
  - `GET /:uid` answers one booklet with its ticks, audited (`fund_booklet.read`).
  - `GET /:uid/pdf` draws its PDF on request through Browser Run (never pdf-lib), keeps nothing, and is audited (`fund_booklet.read`); 503 `booklet_render_unavailable` when the print fails.
  - `POST /:uid/withdraw { reason }` takes a reason of 10–200 characters (`fund_booklet.withdraw`); it voids the booklet's pending envelopes, and an accepted booklet is 409 `booklet_accepted` (D759).
  - `POST /:uid/acceptance` (D759, `fund_booklet.accept`, Super Admin) sends the General Partner's stage again and answers 201 `{ uid, stage: 'gp', envelope_uuid }`, no token; 404 `booklet_not_found`, 409 `booklet_not_signed`, `booklet_already_sent`, `fund_signer_missing` or `booklet_text_changed`.
- **The e-sign signer routes, for a booklet envelope** (`document_type = 'subscription_booklet'`, D759): `GET /api/legal/esign/sign/:token` adds `booklet: { stage, edition }`; `GET …/paper` prints the frozen parts with the other stage's lines as signed; `POST …` draws the signed copy with this signer's image on their own lines, refuses 409 `booklet_text_changed` before the claim, and on the applicant's completion sends the General Partner's stage. Every other envelope answers as before.

Fund notices are mounted at `/api/fund-notices` (`routes/fund_notices.ts`, `services/fundNotices.ts`, `services/fundNoticeStore.ts`, migration 478). See `decisions/D716.md`.
- **An Admin on HQ** (`hq_only` on a branch; support session refused):
  - `GET /types`.
  - `POST /preview { type, source, inputs, page_size }` answers `{ html, paper_sha256, figures, figures_sha256, refusal }`, with fonts omitted, Draft and `no-store` (`fund_notice.preview`).
  - `POST /calls/:callUid/preview` gives each line's figures and one digest (`fund_notice.preview`).
  - `GET /` and `GET /:uid` read the notices; `GET /:uid/pdf` serves the kept PDF.
- **The Super Admin** (`fund_notice.issue`, `super_admin_required` before any TOTP or step-up):
  - `POST /issue { type, source, inputs, page_size, figures_sha256, reason? }`;
  - `POST /calls/:callUid/issue { page_size, digest }`.
- **The LP** (only notices addressed to their own LP row; anyone else gets 404):
  - `GET /mine` (with `superseded`, `instructions_changed`, and `call_number` and `due_date` computed on read, #1860);
  - `GET /mine/:uid` (the same, and the frozen figures);
  - `GET /mine/:uid/pdf`.
- **A PDF** is drawn once per stamp through Browser Run (never pdf-lib), kept in R2, and answered `private, no-store`.

