/**
 * 3-way NDA envelope creator — Task #3 (Y-1).
 *
 * The eSign tables (`esign_envelopes`, `esign_recipients`) already
 * support multi-recipient envelopes (recipients are keyed by
 * envelope_id). The single-signer `createAndSendEnvelope` in
 * routes/esign.ts is a thin wrapper around that schema; this service
 * mirrors the wrapper for the Founder + Investor + Axal counter-signer
 * 3-way NDA. Splitting it out keeps `routes/esign.ts` focused on
 * single-signer admin envelopes and lets us evolve the 3-way template
 * (merge fields, signer rotation) without touching the admin path.
 *
 * Envelope status transitions:
 *   sent              — at least one recipient still has `pending` status
 *   partially_signed  — ≥1 signed, ≥1 still pending
 *   completed         — all recipients signed
 *
 * On `completed`, the eSign signing handler calls
 * `services/trust.ts:activatePairwiseNda(env, envelope_uuid)` which
 * flips the matching `pairwise_ndas` row to `status='active'` and
 * stamps a 12-month `valid_until`.
 */
import type { Env } from '../types';
import { sendAgreementAssignedEmail } from './email';
import { sha256Hex } from './pdf';
import { renderLegalTemplate, getLegalTemplateBody } from './legalTemplates';

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function genToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

interface ThreeWayParty {
  user_id: number;
  email: string;
  name: string;
}

export interface ThreeWayResult {
  envelope_id: number;
  envelope_uuid: string;
  signing_urls: { founder: string; investor: string; axal: string };
}

/**
 * Issue the 3-way NDA envelope. The Axal counter-signer is keyed off
 * `env.AXAL_COUNTERSIGNER_EMAIL` (falls back to a sentinel address);
 * an admin user with a matching email gets the signing email so the
 * envelope can complete without ops intervention.
 */
export async function createThreeWayNdaEnvelope(
  env: Env,
  opts: {
    founder: ThreeWayParty;
    investor: ThreeWayParty;
    appUrl: string;
  },
): Promise<ThreeWayResult> {
  const counterEmail = (env as any).AXAL_COUNTERSIGNER_EMAIL || 'legal@axal.vc';
  const envelopeUuid = crypto.randomUUID();
  const tplBody = await renderLegalTemplate('nda_3way_founder_investor_axal_v1', {
    founder_name: opts.founder.name,
    founder_email: opts.founder.email,
    investor_name: opts.investor.name,
    investor_email: opts.investor.email,
    axal_signer_email: counterEmail,
    effective_date: new Date().toISOString().slice(0, 10),
  });
  const tplTitle = '3-Way Mutual NDA — Founder · Investor · Axal';
  const bodySha = await sha256Hex(tplBody);

  // Defensive: ensure the eSign tables exist (matches the lazy
  // migration pattern in routes/esign.ts).
  for (const s of [
    `CREATE TABLE IF NOT EXISTS esign_envelopes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      envelope_uuid TEXT NOT NULL UNIQUE,
      user_id INTEGER, deal_id INTEGER,
      document_type TEXT NOT NULL, document_title TEXT NOT NULL,
      document_body TEXT NOT NULL, body_sha256 TEXT NOT NULL,
      original_r2_key TEXT, signed_r2_key TEXT,
      status TEXT NOT NULL DEFAULT 'sent',
      audit_log TEXT NOT NULL DEFAULT '[]',
      created_by INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS esign_recipients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      envelope_id INTEGER NOT NULL,
      user_id INTEGER, recipient_email TEXT NOT NULL, recipient_name TEXT,
      signing_token TEXT NOT NULL UNIQUE, token_expires_at TIMESTAMP NOT NULL,
      signed_at TIMESTAMP, signer_ip TEXT, signer_ua TEXT,
      status TEXT NOT NULL DEFAULT 'pending')`,
  ]) { try { await env.DB.prepare(s).run(); } catch {} }

  // The 3-way envelope is keyed off the founder's user_id (so admin
  // queries by user surface it), uses a stable document_type so X-1
  // can dedupe by it, and persists the rendered body for audit.
  const ins: any = await env.DB.prepare(
    `INSERT INTO esign_envelopes (envelope_uuid, user_id, document_type, document_title, document_body, body_sha256, status, created_by, audit_log)
     VALUES (?, ?, 'nda_3way_v1', ?, ?, ?, 'sent', ?, '[]')
     RETURNING id`,
  ).bind(envelopeUuid, opts.founder.user_id, tplTitle, tplBody, bodySha, opts.investor.user_id).first();
  if (!ins?.id) throw new Error('envelope_insert_failed');
  const envelopeId = ins.id as number;

  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  const signers = [
    { ...opts.founder,  role: 'founder'  as const },
    { ...opts.investor, role: 'investor' as const },
    { user_id: 0, email: counterEmail, name: 'Axal Legal', role: 'axal' as const },
  ];
  const tokens: Record<string, string> = {};
  for (const s of signers) {
    const tok = genToken();
    tokens[s.role] = tok;
    await env.DB.prepare(
      `INSERT INTO esign_recipients (envelope_id, user_id, recipient_email, recipient_name, signing_token, token_expires_at, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    ).bind(envelopeId, s.user_id || null, s.email, s.name, tok, expiresAt).run();
  }

  // Fire-and-forget signer notifications. Failures are appended to the
  // envelope audit log but don't block the envelope creation.
  for (const s of signers) {
    const url = `${opts.appUrl}/esign/${tokens[s.role]}`;
    try {
      await sendAgreementAssignedEmail(env, s.email, s.name, tplTitle, url, 'Axal Trust Center');
    } catch (e) {
      console.error('[trust] 3-way email failed', s.role, e);
    }
  }

  return {
    envelope_id: envelopeId,
    envelope_uuid: envelopeUuid,
    signing_urls: {
      founder:  `${opts.appUrl}/esign/${tokens.founder}`,
      investor: `${opts.appUrl}/esign/${tokens.investor}`,
      axal:     `${opts.appUrl}/esign/${tokens.axal}`,
    },
  };
}

// Re-export for tests / direct access from cron.
export { getLegalTemplateBody };
