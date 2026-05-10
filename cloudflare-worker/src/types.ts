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
  // Task #33 — Cloudflare Access perimeter for /api/admin|monitoring|infra.
  // Both MUST be set in production for the gate to engage; either unset
  // means the middleware is a no-op (dev / preview).
  CF_ACCESS_TEAM_DOMAIN?: string;   // e.g. "axal.cloudflareaccess.com"
  CF_ACCESS_AUD?: string;           // Application AUD tag from the Access dashboard
  AI?: any;
  // R2 bucket for KYC documents and other large/private blobs.
  // Optional so unit-test envs without R2 bindings still type-check.
  FILES?: R2Bucket;
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
