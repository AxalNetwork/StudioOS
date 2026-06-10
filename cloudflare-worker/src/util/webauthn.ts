/**
 * BLOCK-AUTH-02 — WebAuthn relying-party config.
 *
 * rpID is the registrable domain the passkey is scoped to. Per the WebAuthn
 * spec a credential created for rpID `axal.vc` is usable on `axal.vc` AND any
 * subdomain (`app.axal.vc`), which is exactly the apex/app split this worker
 * serves. The browser still verifies the ceremony ORIGIN against the list we
 * return, so both hosts are listed explicitly.
 *
 * Overridable via env (`WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGINS` as a comma list)
 * so a future host change needs no code edit. Localhost origins are added
 * outside production for `wrangler dev` testing.
 */
import type { Env } from '../types';
import { stripTrailingSlashes } from './url';

const DEFAULT_RP_ID = 'axal.vc';

export function rpID(env: Env): string {
  const override = String((env as any).WEBAUTHN_RP_ID || '').trim();
  if (override) return override;
  // Derive from PUBLIC_BASE_URL/APP_URL host, stripping any leading `app.`
  // so the credential is scoped to the registrable apex (works on both hosts).
  try {
    const base = (env as any).PUBLIC_BASE_URL || (env as any).APP_URL;
    if (base) {
      const host = new URL(base).hostname;
      return host.replace(/^app\./, '') || DEFAULT_RP_ID;
    }
  } catch {}
  return DEFAULT_RP_ID;
}

export function rpName(_env: Env): string {
  return 'Axal StudioOS';
}

export function expectedOrigins(env: Env): string[] {
  const out = new Set<string>();
  const add = (u?: string) => {
    if (!u) return;
    try { out.add(new URL(stripTrailingSlashes(u)).origin); } catch {}
  };
  add((env as any).PUBLIC_BASE_URL);
  add((env as any).APP_URL);
  add((env as any).OAUTH_CALLBACK_BASE_URL);
  // Always include the canonical pair so a partial env config never locks
  // out one of the two hosts the SPA can be served from.
  out.add('https://axal.vc');
  out.add('https://app.axal.vc');
  for (const o of String((env as any).WEBAUTHN_ORIGINS || '').split(',')) {
    const t = o.trim();
    if (t) add(t);
  }
  if (String((env as any).STAGE || '').toLowerCase() !== 'production') {
    out.add('http://localhost:5173');
    out.add('http://localhost:8787');
  }
  return Array.from(out);
}
