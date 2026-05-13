export interface Env {
  DB: D1Database;
  TOKENS: KVNamespace;
  RATE_LIMITS: KVNamespace;
  JWT_SECRET: string;
  // Dedicated HMAC key for Epic 5 score signing. REQUIRED in production
  // (T9): boot fails fast if missing or <32 bytes. In dev/preview it MAY
  // be omitted, in which case the worker falls back to JWT_SECRET and
  // logs a one-shot startup warning. See `assertScoringHmacSecret` in
  // `auth.ts` for enforcement.
  SCORING_HMAC_SECRET?: string;
  STUDIOOS_ENV?: string;
  // Set by wrangler.toml in production deploys (`ENVIRONMENT = "production"`).
  // Used by the boot guards in auth.ts to decide whether to throw on missing
  // secrets vs warn-and-fallback.
  ENVIRONMENT?: string;
  // Audit #4: edge proxy → FastAPI origin (e.g. https://api.axal.vc).
  // Required by `index.ts` proxy handler. The worker returns 503 if missing.
  FASTAPI_ORIGIN?: string;
  TURNSTILE_SECRET_KEY?: string;
  APP_URL: string;
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
  GMAIL_REFRESH_TOKEN?: string;
  // Calendar OAuth — Google + Microsoft 365. Optional; absent providers
  // are treated as unavailable at runtime. MICROSOFT_TENANT_ID defaults
  // to "common" when unset.
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_CALENDAR_REDIRECT_URI?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  MICROSOFT_TENANT_ID?: string;
  MICROSOFT_CALENDAR_REDIRECT_URI?: string;
  OPENAI_API_KEY?: string;
  // Task #5 — Anthropic API key powers the Dashboard personal assistant
  // (cloudflare-worker/src/routes/assistant.ts). When unset the route
  // returns 503 instead of streaming, so the UI can degrade gracefully.
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_EXPLAIN_MODEL?: string;
  // Task #16 — chooses the provider for the Personal Advisor /explain
  // SSE endpoint. Values:
  //   'workers-ai' (default) — Cloudflare Workers AI primary; Anthropic
  //                            narrow fallback only when WAI hops fail.
  //   'anthropic'            — Anthropic primary; WAI llamas as fallback.
  //   'auto'                 — alias of 'workers-ai'.
  // Removes the legacy hard 503 when ANTHROPIC_API_KEY is unset since
  // Workers AI is always reachable via the `AI` binding.
  ADVISOR_EXPLAIN_PROVIDER?: 'workers-ai' | 'anthropic' | 'auto' | string;
  // Task #4 (CG) — Personal Advisor AI Gateway slug. Routes every
  // advisor LLM call (advisor_explain today, advisor_turn from CB
  // onwards) through a dedicated Cloudflare AI Gateway so spend,
  // latency, rate limits and cache analytics for the advisor surface
  // are tracked independently of the onboarding chatbot. The gateway
  // itself must be created by the operator in the Cloudflare dashboard
  // (Workers AI → AI Gateway → New gateway, slug `advisor-ongoing`,
  // cache TTL 5m for explainers / 0 for turns, rate limit 60/min/user
  // and 200/min/account). When unset, advisor calls fall through to
  // the default `env.AI` binding without gateway routing — analytics
  // simply mix in with the onboarding traffic, but no functionality
  // breaks. Default: `advisor-ongoing` once wrangler.toml is deployed.
  CF_AI_GATEWAY_SLUG_ADVISOR?: string;
  // Task #4 (CG) — per-user daily advisor turn cap. Counts /api/advisor
  // turns (chat completions, not /explain) in KV bucket
  // `ai_spend:advisor:{user_id}:{yyyy-mm-dd}` and hard-blocks at this
  // number, surfacing a friendly throttle message. Soft-warn fires at
  // 80% so the UI can show a "approaching daily cap" hint. Default
  // 100 turns/day per spec. The "USD_DAY" suffix is a misnomer in the
  // spec — the value is a TURN count, not a dollar amount — but we
  // keep the spec name verbatim and accept the legacy
  // `WORKERS_AI_ADVISOR_BUDGET_PER_DAY` alias for back-compat.
  WORKERS_AI_ADVISOR_BUDGET_USD_DAY?: string;
  WORKERS_AI_ADVISOR_BUDGET_PER_DAY?: string;
  // Task #4 (AW) — global advisor kill switch. When set to "1" or "true"
  // every /api/advisor/{start,answer,explain} short-circuits with the
  // canonical REFUSAL.disabled message. Per-user kill is users.advisor_locked.
  ADVISOR_DISABLED?: string;
  // Task #5 — Personal Advisor V2 rollout gate. ADVISOR_V2_DISABLED is the
  // instant kill switch (alias of ADVISOR_DISABLED — either name flips both).
  // ADVISOR_V2_ALLOWLIST is a CSV of user ids granted V2 in Phase 1 (admins
  // are implicitly included). ADVISOR_V2_ROLLOUT_PCT is an integer 0..100
  // controlling the deterministic-hash rollout for Phase 2 (10) → Phase 3 (100).
  ADVISOR_V2_DISABLED?: string;
  ADVISOR_V2_ALLOWLIST?: string;
  ADVISOR_V2_ROLLOUT_PCT?: string;
  GITHUB_ACCESS_TOKEN?: string;
  GITHUB_REPO_OWNER?: string;
  GITHUB_REPO_NAME?: string;
  PERSONA_API_KEY?: string;
  SUMSUB_API_KEY?: string;
  // LinkedIn — used by routes/linkedin.ts (Refer & Earn → "Sign in with
  // LinkedIn" + Connections-CSV import wizard). Set via `wrangler secret put`.
  // When any of the three is unset, /api/linkedin/oauth/start returns 503
  // and the UI hides the OAuth tab while still allowing the CSV-export
  // walkthrough to function.
  LINKEDIN_CLIENT_ID?: string;
  LINKEDIN_CLIENT_SECRET?: string;
  LINKEDIN_REDIRECT_URI?: string;
  // Stripe — used by routes/billing.ts and routes/funds.ts. Set via
  // `wrangler secret put STRIPE_SECRET_KEY` etc. When unset, billing
  // falls back to a dev /dev-upgrade flow and Atlas calls are stubbed.
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_ATLAS_API_KEY?: string;
  // Task #6 — founder subscription tier price ids (Stripe).
  STRIPE_PRICE_GROWTH?: string;
  STRIPE_PRICE_STUDIO?: string;
  // Task #6 (W-1) — investor paywall price ids. Institutional supports
  // invoice billing so callers can also flip status via admin tooling
  // when no card is on file.
  STRIPE_PRICE_INVESTOR_PRO_MONTHLY?: string;
  STRIPE_PRICE_INVESTOR_PRO_YEARLY?: string;
  STRIPE_PRICE_INVESTOR_INST_MONTHLY?: string;
  STRIPE_PRICE_INVESTOR_INST_YEARLY?: string;
  // Task #33 — Master keys for column-level cipher (PII / financial / cap-table)
  // and for one-time signed R2 download URLs. Both MUST be ≥32 bytes in
  // production. Generate via `openssl rand -hex 32`. Provision per env via
  //   `npx wrangler secret put KEK_PII --env=production`
  //   `npx wrangler secret put KEK_R2  --env=production`
  // Dev/preview workers fall back to JWT_SECRET (with one-shot warning).
  KEK_PII?: string;
  KEK_R2?: string;
  // Symmetric secret used by `services/cryptoBox.ts` for wellbeing data.
  // Kept distinct from KEK_PII so a key rotation on PII columns never
  // invalidates wellbeing rows.
  AXAL_ENCRYPTION_SECRET?: string;
  // Task #3 (Y-1) — email of the Axal counter-signer that receives
  // the third leg of the 3-way Founder/Investor/Axal NDA. Defaults to
  // 'legal@axal.vc' when unset (see services/trustEnvelope.ts).
  AXAL_COUNTERSIGNER_EMAIL?: string;
  // Task #33 — Cloudflare Access perimeter for /api/admin|monitoring|infra.
  // Both MUST be set in production for the gate to engage; either unset
  // means the middleware is a no-op (dev / preview).
  CF_ACCESS_TEAM_DOMAIN?: string;   // e.g. "axal.cloudflareaccess.com"
  CF_ACCESS_AUD?: string;           // Application AUD tag from the Access dashboard
  // Task #6 — Google Cloud Identity Platform / Firebase Phone Auth.
  // GCIP_API_KEY is the Web API key for the Identity Platform project;
  // when unset, the SMS 2FA endpoints return 503 and the SettingsPage /
  // LoginPage hide their SMS surfaces. SMS_COUNTRY_ALLOWLIST is a CSV
  // of ISO-3166 alpha-2 country codes (default: see services/authSms.ts).
  // GCIP_RECAPTCHA_TOKEN_FALLBACK is a dev/smoke-test escape hatch so
  // start-enrollment can succeed without a browser-minted reCAPTCHA.
  GCIP_API_KEY?: string;
  GCIP_RECAPTCHA_TOKEN_FALLBACK?: string;
  // Task #6 — GCIP admin credentials for the disable flow. The Identity
  // Toolkit Admin REST endpoint requires a service-account OAuth2 bearer;
  // operators provision it as a secret. Project id is the GCP project that
  // owns the Identity Platform tenant. When either is absent the disable
  // path still wipes local state but logs a "skipped upstream delete"
  // warning so it's visible in observability.
  GCIP_PROJECT_ID?: string;
  GCIP_ADMIN_BEARER_TOKEN?: string;
  SMS_COUNTRY_ALLOWLIST?: string;
  AI?: any;
  // Task #1 (AX) — Multi-model AI router. Optional dedicated KV namespace
  // for spend buckets, cache, and the org-wide kill switch. When absent the
  // router falls back to the existing TOKENS namespace with `ai_spend:` /
  // `ai_cache:` / `ai_killswitch:` prefixes so it's deployable today.
  AI_SPEND?: KVNamespace;
  // Per-user / org-wide spend caps for the AI router. Numeric strings;
  // defaults: 5 / 50 / 5000 USD respectively (see services/aiRouter.ts).
  WORKERS_AI_BUDGET_USD_DAY?: string;
  WORKERS_AI_BUDGET_USD_MONTH?: string;
  WORKERS_AI_BUDGET_USD_ORG_MONTH?: string;
  // R2 bucket for KYC documents and other large/private blobs.
  // Optional so unit-test envs without R2 bindings still type-check.
  FILES?: R2Bucket;
  // Task #2 (AU) — R2 bucket for admin-composed publication artifacts
  // (PDF/CSV/PNG). Public access is OFF; downloads are gated through the
  // Worker via 24h HMAC-signed URLs. Falls back to FILES on dev envs
  // where the dedicated bucket isn't bound.
  PUBLICATIONS?: R2Bucket;
  // Task #2 (AU) / Task #13 — Cloudflare Browser Rendering binding used
  // by both the analytics export PDF path and admin publication renders.
  // When undefined the publication render falls back to inline HTML.
  BROWSER?: { fetch: (input: string, init?: RequestInit) => Promise<Response> };
  // Native Cloudflare Queues binding. Optional so unit-test envs and
  // older deploys that haven't been re-deployed against the updated
  // wrangler.toml don't crash on absence — the producer falls back to
  // the legacy D1 `queue_jobs` table when this is undefined.
  JOB_QUEUE?: Queue<JobMessage>;
  // Feature flag — string "true" enables the native CF Queue path.
  USE_CF_QUEUE?: string;
  // Durable Objects for real-time WebSocket fan-out. Optional so unit-test
  // envs without DO bindings don't crash; the realtime route returns 503
  // when these are undefined.
  PIPELINE_ROOM?: DurableObjectNamespace;
  ONBOARDING_CHAT?: DurableObjectNamespace;
  // Vectorize index `axal-search` (768-dim, cosine) for semantic search.
  // Optional so unit-test envs without the binding still type-check; the
  // search service no-ops gracefully when undefined.
  VECTORIZE?: VectorizeIndex;
  // Task #13 — Workers Analytics Engine binding (`studioos_requests` dataset).
  // observability middleware writes one data point per HTTP request so the
  // Admin Analytics → Technical sub-tab can serve true edge-level traffic
  // and latency. Reads via Cloudflare's GraphQL/SQL API are gated by the
  // CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AE_API_TOKEN secrets — when either
  // is missing, `loadTechnical` falls back to D1 `system_metrics`. The
  // binding is optional so unit-test envs and older deploys don't crash.
  ANALYTICS?: AnalyticsEngineDataset;
  // Task #13 — service token used to query Workers Analytics Engine via
  // the Cloudflare GraphQL/SQL API. CLOUDFLARE_AE_API_TOKEN must scope
  // `Account · Account Analytics · Read`. CLOUDFLARE_ACCOUNT_ID is the
  // 32-hex account UUID. Both unset → `loadTechnical` reads from D1.
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_AE_API_TOKEN?: string;
  // Task #2 — HubSpot OAuth app credentials. When unset, /oauth/start for
  // hubspot returns 503 and the connect modal surfaces the error inline.
  // Provision via `wrangler secret put HUBSPOT_CLIENT_ID --env=production`.
  HUBSPOT_CLIENT_ID?: string;
  HUBSPOT_CLIENT_SECRET?: string;

  // -------------------------------------------------------------------------
  // Task #9 (AO) — full secret surface declared for type safety. All optional
  // so unit-test envs and partially-configured preview deploys still
  // type-check; production guarded by per-route ensureCreds() calls and
  // boot-time `assert*` helpers in auth.ts. Provision via
  // `wrangler secret put NAME --env production`.
  // -------------------------------------------------------------------------

  // Stripe — additional price ids. The four investor + two founder tiers
  // declared above plus these two MI-Pro standalone prices = 8.
  STRIPE_PRICE_MI_PRO_MONTHLY?: string;
  STRIPE_PRICE_MI_PRO_YEARLY?: string;

  // Email transport
  EMAIL_FROM?: string;

  // KEK aliases (PII_KEK_HEX / R2_KEK_HEX) — newer naming used in
  // .env.example. Existing code reads KEK_PII / KEK_R2; keeping both
  // declared so a wrangler secret put under either name type-checks.
  PII_KEK_HEX?: string;
  R2_KEK_HEX?: string;

  // Sumsub (alternative KYC vendor to Persona)
  SUMSUB_SECRET?: string;
  SUMSUB_APP_TOKEN?: string;

  // Salesforce OAuth
  SF_CLIENT_ID?: string;
  SF_CLIENT_SECRET?: string;
  SALESFORCE_CLIENT_ID?: string;
  SALESFORCE_CLIENT_SECRET?: string;

  // Carta OAuth
  CARTA_CLIENT_ID?: string;
  CARTA_CLIENT_SECRET?: string;

  // Calendly OAuth
  CALENDLY_CLIENT_ID?: string;
  CALENDLY_CLIENT_SECRET?: string;

  // Crunchbase API
  CRUNCHBASE_API_KEY?: string;

  // Slack OAuth (one-way notifications)
  SLACK_CLIENT_ID?: string;
  SLACK_CLIENT_SECRET?: string;

  // DocuSign — Integration Key + RSA private key for JWT grant
  DOCUSIGN_INTEGRATION_KEY?: string;
  DOCUSIGN_SECRET?: string;
  DOCUSIGN_RSA_PRIVATE_KEY?: string;

  // GCP Identity Toolkit / SMS auth (alias surface — see GCIP_* above for
  // the legacy names the existing code reads).
  GCP_IDENTITY_API_KEY?: string;
  GCP_PROJECT_ID?: string;
  GCP_SERVICE_ACCOUNT_JSON?: string;

  // Tail worker forwarding bucket — declared for type safety in case the
  // main worker ever needs to read from the same bucket directly. The
  // tail consumer worker (cloudflare-worker-tail/) writes the events.
  LOGS?: R2Bucket;

  // Wide allowlist for preview/dev CORS, see middleware/cors guard.
  EXTRA_DEV_ORIGINS?: string;
}

// Cloudflare Queues message envelope (matches the body shape the producer sends).
// `idempotency_key` is set by the producer and used by the consumer to dedupe
// at-least-once redeliveries via a KV-backed seen-set.
export interface JobMessage {
  job_type: string;
  payload: any;
  idempotency_key: string;
}

export interface User {
  id: number;
  uid: string;
  email: string;
  name: string;
  role: 'admin' | 'founder' | 'partner' | 'investor';
  investor_id?: number | null;
  password_hash: string | null;
  founder_id: number | null;
  partner_id: number | null;
  is_active: boolean;
  email_verified: boolean;
  verification_token: string | null;
  verification_token_expires: string | null;
  kyc_status: string | null;
  created_at: string;
  jwt_min_iat?: number | null;
}

export interface JWTPayload {
  user_id: number;
  email: string;
  role: string;
  impersonated_by?: number;
  exp: number;
  iat: number;
  jti?: string;
}

export interface UserSessionRow {
  id: number;
  jti: string;
  user_agent: string | null;
  ip: string | null;
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
}
