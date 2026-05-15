# Changelog

Per-task changelog for Axal StudioOS. Newest entries on top.

## 2026-05-15 — Task #17: Finalize HubSpot Private App connection

**Problem.** After Task #16 added Private-App (PAT) support to the HubSpot
provider (`cloudflare-worker/src/integrations/providers/hubspot.ts`), the
Connect modal on `/integrations` still rendered only the OAuth "Continue
with HubSpot" button. No PAT input field, no Connect submit button —
making the PAT path unreachable from the UI.

**Root cause.** `cloudflare-worker/src/integrations/registry.ts` had
`supports_pat: true` only on the Calendly entry; HubSpot was missing the
flag entirely. The frontend modal at
`frontend/src/pages/IntegrationsPage.jsx:624` gates the PAT field on
`provider.supports_pat`, which `publicDescriptor()` faithfully forwarded
as `false` for HubSpot, so the field never rendered. The Connect submit
button was further gated on `(provider.supports_pat && apiKey)`, meaning
even when the field appeared the button stayed hidden until the user
typed a token — a chicken-and-egg UX trap.

**Fix.**
- Registry: added `supports_pat: true` to the HubSpot entry with a
  comment pointing to this task and the marketplace-publication blocker.
- Modal (`IntegrationsPage.jsx`):
  - PAT field label, placeholder (`pat-na1-...`), and helper text are
    now provider-aware: HubSpot points to "Settings → Integrations →
    Private Apps → Create private app" and lists the required
    `crm.objects.deals.read/write` + `crm.objects.contacts.read` scopes;
    Calendly copy is preserved.
  - OAuth blurb now explains *why* the PAT path exists for HubSpot
    ("recommended while our public app is pending HubSpot Marketplace
    review") instead of the generic Calendly copy.
  - Connect submit button is always rendered for PAT-supporting
    providers and uses the native `disabled` attribute (rather than
    being conditionally unmounted) so users see the affordance and
    discover what they need to fill in.
- No backend logic change — `connect()` already branches on
  `input.api_key` first and persists `is_private_app: true`,
  `getActiveAccessToken()` already short-circuits the refresh path for
  Private-App rows.

**Validation.**
- `npm run test:drift` — all 9 suites pass.
- Frontend `vite build` clean.
- Worker deployed: version
  `e6ff01ce-3917-475f-bead-5cad4cca4339`.

**Operator note.** The frontend bundle must be re-deployed to Cloudflare
Pages for the modal change to reach axal.vc; the worker change alone
flips `supports_pat` in `/api/integrations/available`, but the rendered
button gating lives in the SPA bundle.
