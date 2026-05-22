/**
 * Task #3 — PII linter for Telegram (and LinkedIn — Task #4 LF) drafts.
 *
 * Two-layer check:
 *   1) Regex scan: email / phone / SSN-ish tax id / IBAN / 13–19-digit
 *      card-like sequences.
 *   2) Promotion-consent scan: any user found by email OR full-legal name
 *      in `users` who has NOT opted in via `user_promotion_consent`
 *      becomes a `consent_missing` finding.
 *   3) Public-channel guard: when `audience === 'public'`, ANY user
 *      mention (regardless of consent) becomes a `private_in_public`
 *      finding — public channel is for aggregate/anonymized content
 *      only.
 *
 * The linter NEVER blocks on its own — it returns findings + an `ok`
 * boolean. The route enforces the gate (block send unless `ok === true`
 * OR an `override_reason` is supplied + logged to admin_audit_log).
 */
import type { Env } from '../types';

export type FindingSeverity = 'high' | 'medium' | 'low';

export interface RedactFinding {
  kind: string;                 // 'email' | 'phone' | 'tax_id' | 'bank_iban' | 'card_like' | 'consent_missing' | 'private_in_public'
  severity: FindingSeverity;
  match: string;                // the offending substring (masked for tax/card)
  context?: string;             // ~40 chars surrounding the hit
  user_id?: number;             // populated for consent_missing / private_in_public
}

export interface RedactResult {
  ok: boolean;                  // true when NO blocking findings
  findings: RedactFinding[];
}

const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
// E.164-ish, North-American, or international with spaces / dashes (>=8 digits)
const PHONE_RE = /(?:(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]?\d{2,4}[\s.-]?\d{2,4}(?:[\s.-]?\d{2,4})?)/g;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
// IBAN — 2 letters country, 2 check, 11-30 alphanumeric.
const IBAN_RE = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;
// Bare 13–19-digit sequences (with optional spaces/dashes) → card-like.
const CARD_RE = /\b(?:\d[\s-]?){13,19}\b/g;

function around(text: string, idx: number, len: number): string {
  const start = Math.max(0, idx - 20);
  const end = Math.min(text.length, idx + len + 20);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

function maskTail(s: string, visible = 4): string {
  if (s.length <= visible) return s;
  return '*'.repeat(s.length - visible) + s.slice(-visible);
}

function looksLikePhone(s: string): boolean {
  // Strip non-digits, require 8–15 digits (E.164 range).
  const digits = s.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15;
}

function scanRegexes(body: string, findings: RedactFinding[]): void {
  for (const m of body.matchAll(EMAIL_RE)) {
    findings.push({
      kind: 'email',
      severity: 'high',
      match: m[0],
      context: around(body, m.index ?? 0, m[0].length),
    });
  }
  for (const m of body.matchAll(PHONE_RE)) {
    if (!looksLikePhone(m[0])) continue;
    findings.push({
      kind: 'phone',
      severity: 'high',
      match: m[0].trim(),
      context: around(body, m.index ?? 0, m[0].length),
    });
  }
  for (const m of body.matchAll(SSN_RE)) {
    findings.push({
      kind: 'tax_id',
      severity: 'high',
      match: maskTail(m[0]),
      context: around(body, m.index ?? 0, m[0].length),
    });
  }
  for (const m of body.matchAll(IBAN_RE)) {
    findings.push({
      kind: 'bank_iban',
      severity: 'high',
      match: maskTail(m[0]),
      context: around(body, m.index ?? 0, m[0].length),
    });
  }
  for (const m of body.matchAll(CARD_RE)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19) continue;
    findings.push({
      kind: 'card_like',
      severity: 'medium',
      match: maskTail(digits),
      context: around(body, m.index ?? 0, m[0].length),
    });
  }
}

/** Surfaces every user mentioned in `body` by email OR full legal name. */
async function scanUserMentions(
  env: Env,
  body: string,
): Promise<Array<{ user_id: number; matched: string; via: 'email' | 'name'; consented: boolean }>> {
  const out: Array<{ user_id: number; matched: string; via: 'email' | 'name'; consented: boolean }> = [];
  const bodyLower = body.toLowerCase();

  // Collect distinct emails from the body and look them up.
  const emails = new Set<string>();
  for (const m of body.matchAll(EMAIL_RE)) emails.add(m[0].toLowerCase());
  if (emails.size > 0) {
    const placeholders = Array.from(emails).map(() => '?').join(',');
    try {
      const rows = await env.DB.prepare(
        `SELECT u.id, u.email,
                COALESCE(c.consented, 0) AS consented
           FROM users u
           LEFT JOIN user_promotion_consent c ON c.user_id = u.id
          WHERE LOWER(u.email) IN (${placeholders})`,
      )
        .bind(...Array.from(emails))
        .all<{ id: number; email: string; consented: number }>();
      for (const r of rows.results || []) {
        out.push({ user_id: r.id, matched: r.email, via: 'email', consented: !!r.consented });
      }
    } catch {
      /* tolerate missing column on cold worker */
    }
  }

  // Name scan: cheap O(N_users) substring match against the body. We bound
  // this to the ~few thousand users on Axal — acceptable on the admin
  // request path. Skip very short names (<6 chars) to avoid false hits
  // on common substrings.
  try {
    const userRows = await env.DB.prepare(
      `SELECT u.id, u.full_name, u.email,
              COALESCE(c.consented, 0) AS consented
         FROM users u
         LEFT JOIN user_promotion_consent c ON c.user_id = u.id
        WHERE u.full_name IS NOT NULL AND length(u.full_name) >= 6`,
    ).all<{ id: number; full_name: string; email: string; consented: number }>();
    for (const r of userRows.results || []) {
      const name = (r.full_name || '').trim();
      if (!name) continue;
      const parts = name.split(/\s+/);
      if (parts.length < 2) continue; // require first + last to count as "full legal name"
      if (bodyLower.includes(name.toLowerCase())) {
        // Skip dupes already added via email scan.
        if (out.some((o) => o.user_id === r.id)) continue;
        out.push({ user_id: r.id, matched: name, via: 'name', consented: !!r.consented });
      }
    }
  } catch {
    /* full_name column / consent table absent — ignore */
  }

  return out;
}

export async function lintForSend(
  env: Env,
  body: string,
  audience: string,
): Promise<RedactResult> {
  const findings: RedactFinding[] = [];
  scanRegexes(body, findings);
  const mentions = await scanUserMentions(env, body);

  for (const m of mentions) {
    if (audience === 'public') {
      findings.push({
        kind: 'private_in_public',
        severity: 'high',
        match: m.matched,
        user_id: m.user_id,
        context: `Public channel cannot mention specific users (${m.via}).`,
      });
    } else if (!m.consented) {
      findings.push({
        kind: 'consent_missing',
        severity: 'high',
        match: m.matched,
        user_id: m.user_id,
        context: `User has not opted in via user_promotion_consent (matched via ${m.via}).`,
      });
    }
  }

  // Email regex hits in a public channel are always blocking even if the
  // address isn't tied to a known user — covers third-party PII.
  // (Already pushed as 'email' findings above; nothing extra needed.)

  const ok = findings.length === 0;
  return { ok, findings };
}
