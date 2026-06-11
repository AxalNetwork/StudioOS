# Replit Task Prompts — Legal Section Overhaul + Xodo-Sign-style Incorporation Flow

This document contains nine self-contained task prompts ready to paste into Replit.
Run them in order (1 → 9). Each prompt assumes the previous tasks are merged.

## Architecture decisions (locked)

- **Stripe**: a new Price per jurisdiction (DE C-Corp, DE LLC, UK Ltd, SG Pte, EE OÜ),
  Price IDs stored as Worker secrets. Checkout Session is created at the end of the
  incorporate wizard; `checkout.session.completed` webhook kicks off the packet pipeline.
- **Name availability check**: per-jurisdiction adapters using the `BROWSER` binding
  already in `wrangler.toml`. UK uses Companies House REST API where possible.
- **8-page PDF**: fully programmatic with `pdf-lib` (already in `cloudflare-worker/package.json`).
- **Security**: Cloudflare Access policies layered on top of existing `requireAuth` for
  KYC IDs, signed packet PDFs, and Certificates of Formation.
- **Storage**: R2 `FILES` bucket (already bound) at `esign/packets/{uid}.pdf` and
  `esign/signed/{uid}.pdf`.

## Existing infrastructure to reuse (do NOT rebuild)

- `cloudflare-worker/src/routes/esign.ts` — envelopes, recipients, audit events, signing tokens.
- `cloudflare-worker/src/services/pdf.ts` — `renderAgreementPdf` and the tamper-evident
  footer pattern.
- `cloudflare-worker/src/services/notify.ts` + Gmail OAuth — email delivery.
- `cloudflare-worker/src/routes/billing.ts` — `stripeCall()` helper.
- `frontend/src/pages/IncorporatePage.jsx` — existing 4-step wizard (we extend, not replace).
- `frontend/src/pages/KYCPage.jsx` — `id_document_base64` capture, used for page 7.
- `AGREEMENT_OPTIONS` dropdown at `frontend/src/pages/AdminPage.jsx:66-93` — the
  dropdown already exists; what's missing is *content* for each entry in the Templates grid.

---

## Task 1 — Rename "Contracts" → "Legal", add "Forms" and "Incorporation" sub-tabs

**Context**: Admin Console has a `ContractsPanel` at `frontend/src/pages/AdminPage.jsx:1710-1890`
with sub-tabs *All / Pending / Signed / Voided / Pairwise / Partner / Templates*. We're
renaming the parent tab to **Legal** and adding two sub-tabs: **Forms** (hardcoded IRS-style
forms — built in Task 3) and **Incorporation** (multi-document packets — built in Task 7).

**Files**
- `frontend/src/pages/AdminPage.jsx`
  - Line 268–271: change tab label `Contracts` → `Legal`, test-id `admin-tab-contracts`
    → `admin-tab-legal`.
  - Line 298: rename state branch `sub === 'contracts'` → `sub === 'legal'`.
  - Lines 1786–1800 sub-tab array: insert `['forms', 'Forms']` and `['incorporation',
    'Incorporation']` between `templates` and the existing tabs. Render placeholder
    components `<FormsGrid />` and `<IncorporationPacketsTable />` (real implementations land
    in later tasks; empty states acceptable).
  - Rename function `ContractsPanel` → `LegalPanel` and update its import site.
- `frontend/src/lib/api.js` — rename `adminListContracts` → `adminListLegalDocs`,
  `adminContractTemplates` → `adminLegalTemplates`. Keep URL paths unchanged.
- Update any Playwright/e2e tests under `frontend/tests/` referencing
  `admin-tab-contracts` or `contracts-sub-*`.

**Acceptance**
- `/admin?tab=legal` renders the same panel that `/admin?tab=contracts` did, labelled "Legal".
- "Forms" and "Incorporation" sub-tabs visible and selectable.
- `cd frontend && npm run test:drift` passes.

---

## Task 2 — Markdown template editor + complete template catalog

**Context**: 21 plain-text templates live at `backend/app/api/routes/legal.py:45-831` with
`{company_name}`-style placeholders. The `AGREEMENT_OPTIONS` dropdown at
`frontend/src/pages/AdminPage.jsx:66-93` lists 16 agreements but several have no backing
content. We're migrating everything to a worker-canonical D1 store with a real markdown
editor.

**Backend (Cloudflare Worker is canonical)**
- New D1 migration `cloudflare-worker/sql/0042_legal_templates.sql`:
  ```sql
  CREATE TABLE IF NOT EXISTS legal_templates (
    id INTEGER PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL,        -- investors|founders_new|founders_scale|operators|liquidity|forms|incorporation
    body_md TEXT NOT NULL,
    merge_fields TEXT NOT NULL,    -- JSON array of {key,label,required}
    version INTEGER DEFAULT 1,
    is_active INTEGER DEFAULT 1,
    updated_by INTEGER REFERENCES users(id),
    created_at TEXT,
    updated_at TEXT
  );
  CREATE INDEX idx_legal_templates_category ON legal_templates(category, is_active);
  CREATE TABLE IF NOT EXISTS legal_template_versions (
    id INTEGER PRIMARY KEY,
    template_slug TEXT NOT NULL,
    version INTEGER NOT NULL,
    body_md TEXT NOT NULL,
    saved_by INTEGER REFERENCES users(id),
    saved_at TEXT,
    note TEXT
  );
  ```
- Seed migration `cloudflare-worker/sql/0043_legal_templates_seed.sql`: copy all 21
  templates from `backend/app/api/routes/legal.py` and add stub entries for any
  `AGREEMENT_OPTIONS` slugs without content. Must include:
  Founder Collaboration Agreement, Engagement Letter — Spin-Out Legal Package,
  Strategic Scale Partnership Agreement, Technology Integration / JV (StudioOS AI),
  Referral / Agency Agreement, M&A Advisory Mandate, Venture Share Agreement (FAST),
  MSA + Equity-for-Services, White-Label Service Agreement, Secondary Purchase Agreement,
  Co-Investment Side Letter, Strategic Side Letter / Focused SPV, Spin-Out Subsidiary SPA +
  IP Transfer, Subscription Booklet & LPA, SPV Joinder Agreement.
- New route file `cloudflare-worker/src/routes/admin_templates.ts` exposing:
  - `GET /api/admin/legal/templates?category=…` — list
  - `GET /api/admin/legal/templates/:slug` — read body_md
  - `POST /api/admin/legal/templates` — create
  - `PATCH /api/admin/legal/templates/:slug` — update (bumps `version`, writes prior row to
    `legal_template_versions`)
  - `DELETE /api/admin/legal/templates/:slug` — soft-delete (`is_active=0`)
  - All routes wrapped in `requireAdmin` middleware.
- Mount the new router in `cloudflare-worker/src/index.ts`.

**Frontend**
- Extract `TemplatesGrid` into `frontend/src/components/admin/TemplatesGrid.jsx` if
  currently inline. Group templates by category, show "+ New template", edit/delete actions.
- New `frontend/src/components/admin/TemplateEditorModal.jsx`: split-pane editor — left
  `<textarea>` for markdown, right preview with `react-markdown` + `remark-gfm` (add to
  `frontend/package.json`). Top bar: title input, category dropdown, merge-fields
  list (key / label / required rows). "Save" calls `PATCH`; "Save as new version" prompts
  for a note.
- `frontend/src/lib/api.js`: add `adminLegalTemplates(category?)`,
  `adminLegalTemplateGet(slug)`, `adminLegalTemplateSave(slug, payload)`,
  `adminLegalTemplateCreate(payload)`, `adminLegalTemplateDelete(slug)`.

**Acceptance**
- All 16 `AGREEMENT_OPTIONS` entries appear under Legal → Templates grouped by their group label.
- Edit a template → save → reload → content persists.
- Version history shown but read-only.
- Existing `POST /api/legal/documents/generate` keeps working (point it at the new store).

---

## Task 3 — Hardcoded "Forms" subsection (SS-4, 8821, Statement, Confirmation)

**Context**: Four IRS-style forms must render as fixed layouts with three placeholders:
`[Full Legal Name]`, `[Company]`, `[Date]`. Admins preview/download blanks; the
incorporation pipeline (Task 7) substitutes real values.

**Files**
- `cloudflare-worker/src/services/forms/` — one TS module per form, each exporting
  `renderXyzPdf({ fullLegalName, company, date }): Promise<Uint8Array>` built with `pdf-lib`:
  - `ss4_instructions.ts` (page 2)
  - `ss4_form.ts` (page 3) — checkbox geometry to match the IRS layout
  - `statement_faxed_ein.ts` (page 4) — text + signature block, three placeholders
  - `form_8821.ts` (page 5)
  - `confirmation_of_info.ts` (page 6) — text + signature block, three placeholders
- Use the PDFs already in `attached_assets/` (and the user-attached SS-4, 8821, Statement,
  Confirmation PDFs) as the visual reference for field positions.
- `cloudflare-worker/src/routes/admin_forms.ts`:
  - `GET /api/admin/legal/forms` — static catalog (id, title, description)
  - `GET /api/admin/legal/forms/:slug/preview?sample=1` — rendered PDF, blank or sample
- `frontend/src/components/admin/FormsGrid.jsx`: 4-card grid; click → Lightbox with PDF
  iframe + Download button.
- Unit tests at `cloudflare-worker/tests/forms/*.test.ts` for each form module
  (golden-byte check on small canonical input).

**Acceptance**
- All four forms visible under Legal → Forms.
- Each previews correctly with placeholder values.
- Module tests green.

---

## Task 4 — Company-name availability check via Cloudflare Browser binding

**Context**: On the Confirm step of `IncorporatePage`, the company-name input must live-check
against the relevant jurisdiction's official register. The `BROWSER` binding is already in
`wrangler.toml:317-318`. UK has a free REST API at Companies House; prefer that.

**Files**
- `cloudflare-worker/src/services/name_check/` — one adapter per jurisdiction, each
  implementing `check(name, env) → { available, conflicts, checkedAt, source }`:
  - `de_sos.ts` — Delaware Division of Corporations entity-name search (BROWSER binding)
  - `uk_ch.ts` — Companies House REST API (key in secret `UK_CH_API_KEY`); fallback to
    BROWSER if key missing
  - `sg_acra.ts` — ACRA BizFile name search (BROWSER)
  - `ee_eer.ts` — Estonian e-Business Register (BROWSER)
- `cloudflare-worker/src/routes/legal.ts`: add `POST /api/legal/name-check`
  `{ jurisdiction_id, name }` → dispatches by jurisdiction → caches result in KV `TOKENS`
  under `namecheck:{jurisdiction}:{sha256(name)}` with 1h TTL.
- `frontend/src/pages/IncorporatePage.jsx`: in `ConfirmStep` (lines 233–315), debounce
  the company-name input by 500ms; call `api.legalNameCheck(...)`; show green check or
  red conflict pill below input; disable "Submit" while check in flight or when
  `available === false`. Add a "Skip check, I'll verify manually" link for resilience.
- `frontend/src/lib/api.js`: add `legalNameCheck({ jurisdiction_id, name })`.

**Acceptance**
- "Stripe Inc." against DE returns red within ~3s.
- Nonsense string returns green.
- KV cache hit returns in <100ms on repeat.
- When `BROWSER` binding is unavailable (preview env), endpoint returns
  `{ available: null, source: 'unavailable' }`; UI degrades gracefully.

---

## Task 5 — Stripe Checkout per jurisdiction, wired into the wizard

**Context**: Today the wizard submits directly and (for DE C-Corp only) deep-links to Stripe
Atlas. We replace that with native Stripe Checkout, one Price per jurisdiction.

**Manual prerequisite (Stripe dashboard)**: create five Prices and store IDs as Worker
secrets:
```
wrangler secret put STRIPE_PRICE_INC_DE_CCORP
wrangler secret put STRIPE_PRICE_INC_DE_LLC
wrangler secret put STRIPE_PRICE_INC_UK_LTD
wrangler secret put STRIPE_PRICE_INC_SG_PTE
wrangler secret put STRIPE_PRICE_INC_EE_OY
```

**Backend**
- `cloudflare-worker/src/routes/billing.ts`: add `POST /api/billing/incorporation/checkout`
  `{ jurisdiction_id, company_name, project_id }`. Creates a `payment`-mode Checkout
  Session via `stripeCall()` with `metadata = { kind: 'incorporation', user_id,
  jurisdiction_id, company_name, project_id }`. `success_url =
  https://axal.vc/incorporate/success?session={CHECKOUT_SESSION_ID}`,
  `cancel_url = https://axal.vc/incorporate`. Returns `{ url }`.
- Extend the existing `checkout.session.completed` handler with a branch on
  `metadata.kind === 'incorporation'`: insert row in `incorporations`, enqueue
  `{ kind: 'incorporation.start', incorporation_uid }` on `JOB_QUEUE`.
- New migration `cloudflare-worker/sql/0044_incorporations.sql`:
  ```sql
  CREATE TABLE IF NOT EXISTS incorporations (
    id INTEGER PRIMARY KEY,
    uid TEXT UNIQUE NOT NULL,
    user_id INTEGER REFERENCES users(id),
    project_id INTEGER REFERENCES projects(id),
    jurisdiction_id TEXT NOT NULL,
    company_name TEXT NOT NULL,
    stripe_session_id TEXT,
    status TEXT NOT NULL,           -- paid|packet_sent|signed|filed|complete|failed
    envelope_uid TEXT,
    paid_at TEXT,
    signed_at TEXT,
    created_at TEXT,
    updated_at TEXT
  );
  CREATE INDEX idx_incorporations_user ON incorporations(user_id, status);
  ```
- `cloudflare-worker/src/queue.ts`: register `incorporation.start` handler — calls
  `buildIncorporationPacket` from Task 6.

**Frontend**
- `frontend/src/pages/IncorporatePage.jsx`: replace step-4 submit with
  `await api.billingIncorporationCheckout({ jurisdiction_id, company_name, project_id })`
  then `window.location.href = url`.
- New page `frontend/src/pages/IncorporateSuccessPage.jsx` at route `/incorporate/success`:
  polls `GET /api/legal/incorporations/by-session/{session_id}` every 2s until
  `status === 'packet_sent'`; shows "Your Axal VC signing link has been emailed".
- Add route in `App.jsx`.
- `frontend/src/lib/api.js`: add `billingIncorporationCheckout`, `legalIncorporationStatus`.

**Acceptance**
- Submitting the wizard redirects to Stripe; test card `4242 4242 4242 4242` completes.
- Webhook fires; `incorporations` row created with `status='paid'`.
- Queue picks up the job; Task 6's packet is generated.

---

## Task 6 — Axal VC signing link with pre-filled fields (Xodo-Sign-style)

**Context**: After payment, the founder receives one email with one Axal VC link opening
the 8-document packet, all fields pre-filled, ready to sign.

**Backend**
- Extend `cloudflare-worker/src/routes/esign.ts`:
  - New helper `buildIncorporationPacket(incorporation_uid, env)`:
    1. Load `incorporations` row + `users` row (signer) + `users.kyc_data` blob + project metadata.
    2. Call `renderIncorporationPacket(...)` from Task 7 → 8-page PDF.
    3. Upload to `r2://FILES/esign/packets/{envelope_uid}.pdf`.
    4. Create one `esign_envelopes` row with `kind='incorporation_packet'`, one
       `esign_recipients` row for the founder, generate a 32-byte signing token (existing
       7-day TTL).
    5. Update `incorporations.envelope_uid` and `status='packet_sent'`.
    6. Return `{ envelope_uid, signing_url: 'https://axal.vc/sign/' + token }`.
  - Wire the `incorporation.start` queue handler from Task 5 to call this helper, then
    send the email (next step).
- Extend the signing handlers `GET/POST /api/legal/esign/sign/:token` to handle
  `kind='incorporation_packet'`: GET returns the packet PDF; POST captures the canvas
  signature, stamps it onto every signature page (Cert, SS-4, Statement, 8821,
  Confirmation), seals the PDF with the tamper-evident footer hash, stores at
  `esign/signed/{envelope_uid}.pdf`.
- Email step uses existing `cloudflare-worker/src/services/notify.ts` + Gmail OAuth:
  new template `incorporation_packet_ready.html` with a single CTA to the signing URL.

**Frontend**
- Reuse the existing `/sign/{token}` UI. Verify the canvas signature stamp shows on each
  required signature page after submit.
- On signed: redirect to `/legal?tab=signed&envelope={uid}` and open the new Lightbox
  (Task 8).

**Acceptance**
- Test card → email arrives within 60s → signing link opens packet with founder's
  name/company/date pre-filled → drawing a signature stamps all five signature pages →
  confirmation email with the 8-page signed PDF attached.
- `esign_audit_events` shows `pending → signing → signed` transitions.

---

## Task 7 — 8-page combined PDF assembler

**Context**: Single function that produces the full packet PDF in the order the user
specified.

**File**: `cloudflare-worker/src/services/pdf/incorporation_packet.ts` exporting
`renderIncorporationPacket({ founder, company, jurisdiction, kycDoc, auditEvents }):
Promise<Uint8Array>`.

**Page order**
1. **Certificate of Formation** — dynamically rendered from a jurisdiction-specific
   template. Delaware uses `cert_of_formation_de.ts` populated with company name,
   registered agent, incorporator block.
2. **Form SS-4 Instructions** — `services/forms/ss4_instructions.ts` (Task 3).
3. **Form SS-4** — `services/forms/ss4_form.ts`, pre-filled with company name,
   responsible-party founder, address from KYC, principal activity from project metadata.
4. **Statement and Acknowledgement of Faxed EIN Filing for Third Party Designees** —
   `services/forms/statement_faxed_ein.ts` with `[Full Legal Name]`, `[Company]`, `[Date]`
   substituted.
5. **Form 8821** — `services/forms/form_8821.ts` filled with taxpayer name,
   designee (Axal VC GP LLC), date.
6. **Confirmation of Information Provided** — `services/forms/confirmation_of_info.ts`
   with the three placeholders substituted.
7. **KYC ID page** — embed the founder's `id_document_base64` from KYC. Image → draw on
   a single-page canvas with caption ("Identification document provided during KYC on
   {date}"). PDF → merge with `PDFDocument.copyPages`.
8. **Audit Trail** — table of every row in `esign_audit_events` for this envelope
   (timestamp, signer email, action, IP, user-agent), followed by the tamper-evident
   hash footer (envelope UUID + SHA-256 of body + completion timestamp), re-using the
   pattern from `cloudflare-worker/src/services/pdf.ts:renderAgreementPdf`.

**Implementation notes**
- Build each page, concatenate via `PDFDocument.copyPages`.
- Cache static pages (SS-4 instructions, blank 8821 layout) as `Uint8Array` module
  constants generated once at load time — keeps invocation fast.
- Target <5 MB to fit comfortably as an email attachment; downsample the KYC image to
  JPEG quality 60 if it's a photo.

**Acceptance**
- Unit test in `cloudflare-worker/tests/pdf/incorporation_packet.test.ts` asserts:
  exactly 8 pages, expected text on each page, audit-trail hash matches body.

---

## Task 8 — Signed Lightbox with "Forward to legal partner" email

**Context**: Each signed document in Legal → Signed should open in a Lightbox with the
PDF and a "Forward by email" action that delivers the signed PDF to one or more legal
partners.

**Files**
- New `frontend/src/components/admin/SignedDocLightbox.jsx`: full-screen modal —
  embedded PDF preview (`<iframe>` against the signed download URL from
  `cloudflare-worker/src/routes/esign.ts`), metadata sidebar (signer, signed-at, audit
  summary), and a "Forward" button.
- "Forward" opens a sub-modal: multi-email recipient input, optional message, checkbox
  "Include audit trail page". Submits `POST /api/legal/documents/:envelope_uid/forward`
  `{ recipients: string[], message?: string, include_audit: boolean }`.
- `cloudflare-worker/src/routes/legal.ts`: add the forward endpoint:
  - Auth: admin OR the document's signer.
  - Re-materialize the signed PDF from R2 using existing `materializeSignedPdf` in
    `esign.ts`.
  - If `include_audit=false`, strip page 8 with `PDFDocument.removePage(7)`.
  - Send via existing email service with the PDF as attachment.
  - Log each forward in new D1 table `legal_doc_forwards (envelope_uid, recipient,
    sent_by, sent_at, message)`. Migration `cloudflare-worker/sql/0045_legal_doc_forwards.sql`.
  - Surface the log in the Lightbox under a "Forwarded to" tab.
- `frontend/src/pages/AdminPage.jsx`: wrap each row in the Signed sub-tab to open the
  new Lightbox on click.

**Acceptance**
- Click signed contract → Lightbox shows PDF + metadata.
- Enter `partner@firm.com` → submit → recipient receives PDF attachment within ~60s →
  "Forwarded to" tab shows the new entry.

---

## Task 9 — Cloudflare Access policies on sensitive R2 read endpoints

**Context**: Layer Cloudflare Access in front of the routes that serve KYC IDs, signed
packet PDFs, and Certificates of Formation. Existing `requireAuth` stays — Access is
additive.

**Endpoints to gate**
- `GET /api/legal/document/:envelope_uid/download` — signed packet
- `GET /api/kyc/document/:uid` — raw KYC image
- `GET /api/legal/incorporations/:uid/certificate` — Certificate of Formation only

**Cloudflare dashboard setup (manual; can be scripted via Terraform later)**
- Access Application: "Sensitive Legal Docs", hostname `axal.vc`, path patterns
  matching the three endpoints.
- Identity provider: Google Workspace (already used elsewhere).
- Policy: Allow if user email is in `studioos-admins` Access Group OR the requesting
  user is the document's signer (use a worker-issued Service Auth token with email
  claim).

**Worker changes**
- New middleware `cloudflare-worker/src/middleware/access.ts`: validates
  `CF-Access-Jwt-Assertion` header against the Access app certs; cache certs in KV
  `TOKENS:cf_access_certs` for 1h. Missing header in production → 403.
- Apply after `requireAuth` on the three endpoints above.
- Bypass when `env.ENV !== 'production'`.

**Acceptance**
- Unauthenticated request to a signed-packet URL in prod redirects to the Cloudflare
  Access login.
- Authorized admin reaches the PDF after Google sign-in.
- Non-admin, non-signer is denied.

---

## End-to-end verification (run after all tasks merged)

1. Apply migrations: `wrangler d1 execute studioos-db --file=cloudflare-worker/sql/0042_legal_templates.sql`
   (and 0043, 0044, 0045).
2. `cd cloudflare-worker && npm test` — new test files green (forms, packet assembler).
3. `cd frontend && npm run test:drift` — no API drift.
4. `npm run dev` in both `frontend/` and `cloudflare-worker/`.
5. `/admin?tab=legal` shows the renamed tab and the two new sub-tabs.
6. Edit a template → save → reload — content persists.
7. As a non-admin user, complete KYC with a test ID image.
8. Walk through the Incorporate wizard, type "Stripe Inc." against DE — name-check
   shows red.
9. Type a unique name; complete checkout with Stripe test card `4242 4242 4242 4242`.
10. Confirmation email arrives → click signing link → packet loads with all fields
    pre-filled → draw signature → submit.
11. Confirmation email with 8-page signed PDF attached arrives within 60s.
12. Admin opens Legal → Signed, clicks the new row, sees Lightbox with PDF + audit
    trail. Forwards to `legal@example.com` and verifies receipt.
13. Production smoke (post-deploy): hit a signed-doc URL without Access cookie → see
    Cloudflare Access login screen.

---

## Critical files modified (summary)

| Task | Files |
| ---- | ----- |
| 1 | `frontend/src/pages/AdminPage.jsx`, `frontend/src/lib/api.js`, e2e tests |
| 2 | `cloudflare-worker/sql/0042_legal_templates.sql`, `0043_legal_templates_seed.sql`, `cloudflare-worker/src/routes/admin_templates.ts`, `frontend/src/components/admin/TemplatesGrid.jsx`, `TemplateEditorModal.jsx` |
| 3 | `cloudflare-worker/src/services/forms/*.ts`, `cloudflare-worker/src/routes/admin_forms.ts`, `frontend/src/components/admin/FormsGrid.jsx` |
| 4 | `cloudflare-worker/src/services/name_check/*.ts`, `cloudflare-worker/src/routes/legal.ts`, `frontend/src/pages/IncorporatePage.jsx` |
| 5 | `cloudflare-worker/src/routes/billing.ts`, `cloudflare-worker/sql/0044_incorporations.sql`, `cloudflare-worker/src/queue.ts`, `frontend/src/pages/IncorporatePage.jsx`, `IncorporateSuccessPage.jsx`, `App.jsx` |
| 6 | `cloudflare-worker/src/routes/esign.ts`, `cloudflare-worker/src/services/notify.ts`, new email template |
| 7 | `cloudflare-worker/src/services/pdf/incorporation_packet.ts`, `cloudflare-worker/tests/pdf/incorporation_packet.test.ts` |
| 8 | `frontend/src/components/admin/SignedDocLightbox.jsx`, `cloudflare-worker/src/routes/legal.ts`, `cloudflare-worker/sql/0045_legal_doc_forwards.sql` |
| 9 | `cloudflare-worker/src/middleware/access.ts`, Cloudflare dashboard Access app config |
