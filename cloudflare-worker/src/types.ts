export interface Env {
  DB: D1Database;
  TOKENS: KVNamespace;
  RATE_LIMITS: KVNamespace;
  JWT_SECRET: string;
  RESEND_API_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  APP_URL: string;
  OPENAI_API_KEY?: string;
  GITHUB_ACCESS_TOKEN?: string;
  GITHUB_REPO_OWNER?: string;
  GITHUB_REPO_NAME?: string;
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
