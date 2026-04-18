export interface Env {
  DB: D1Database;
  TOKENS: KVNamespace;
  RATE_LIMITS: KVNamespace;
  JWT_SECRET: string;
  TURNSTILE_SECRET_KEY?: string;
  APP_URL: string;
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
  GMAIL_REFRESH_TOKEN?: string;
  OPENAI_API_KEY?: string;
  GITHUB_ACCESS_TOKEN?: string;
  GITHUB_REPO_OWNER?: string;
  GITHUB_REPO_NAME?: string;
  PERSONA_API_KEY?: string;
  SUMSUB_API_KEY?: string;
  AI?: any;
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
  role: 'admin' | 'founder' | 'partner';
  password_hash: string | null;
  founder_id: number | null;
  partner_id: number | null;
  is_active: boolean;
  email_verified: boolean;
  verification_token: string | null;
  verification_token_expires: string | null;
  created_at: string;
}

export interface JWTPayload {
  user_id: number;
  email: string;
  role: string;
  impersonated_by?: number;
  exp: number;
  iat: number;
}
