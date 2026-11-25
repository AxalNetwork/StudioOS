import type { Env } from '../types';
import { isSuppressed } from './newsletter';
import { plainStripeAmount } from '../../../frontend/src/lib/money.js';
import { sendRawEmailOutcome, type RawEmailOpts } from './email/gmail';
import { deliverWithReference, type DeliveryResult, type SendReference } from './email/deliveryContract';

// D8536 (#8536) — the delivery contract for critical flows lives in
// `email/deliveryContract.ts`; its types are re-exported here so a caller
// that already imports this file reads one place.
export type { DeliveryFlow, DeliveryResult, DeliveryState, SendReference } from './email/deliveryContract';

// A DEADLINE ON EVERY OUTBOUND CALL IN THE MAIL PATH. `/magic/start` awaits the
// send inline, so a Google endpoint that never answers holds a person's sign-in
// open until the browser gives up — which is what "The server did not respond
// within 30s" was on 2026-09-12. Ten seconds is well above a healthy send and
// well below the client's patience, and every caller here already handles a
// thrown failure by logging and reporting the send as failed.
const MAIL_FETCH_TIMEOUT_MS = 10_000;

async function getGmailAccessToken(env: Env): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    signal: AbortSignal.timeout(MAIL_FETCH_TIMEOUT_MS),
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID!,
      client_secret: env.GMAIL_CLIENT_SECRET!,
      refresh_token: env.GMAIL_REFRESH_TOKEN!,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    throw new Error(`OAuth token fetch failed: ${err?.error_description || err?.error || res.statusText}`);
  }
  const data: any = await res.json();
  if (!data.access_token) throw new Error('No access_token in OAuth response');
  return data.access_token;
}

function b64encode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary);
  return b64.match(/.{1,76}/g)!.join('\r\n');
}

// Task #14 — byte-accurate base64 for binary attachments (PDFs).
// TextEncoder().encode() is UTF-8 and would corrupt bytes >127.
function b64encodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary);
  return b64.match(/.{1,76}/g)!.join('\r\n');
}

function stripHeaderInjection(s: string): string {
  return (s || '').replace(/[\r\n]+/g, ' ').trim();
}

function buildRawEmail(to: string, subject: string, html: string, text: string, from?: string, replyTo?: string): string {
  const boundary = `boundary_${crypto.randomUUID().replace(/-/g, '')}`;
  const safeTo = stripHeaderInjection(to);
  const safeSubject = stripHeaderInjection(subject);
  const safeFrom = stripHeaderInjection(from || 'Axal VC <noreply@axal.vc>');
  // Task #5 — optional Reply-To. Sanitized (CR/LF-stripped) like every other
  // header value so a caller-supplied value can't smuggle extra headers.
  const safeReplyTo = stripHeaderInjection(replyTo || '');
  const subjectEncoded = `=?UTF-8?B?${btoa(unescape(encodeURIComponent(safeSubject)))}?=`;
  const lines = [
    `To: ${safeTo}`,
    `From: ${safeFrom}`,
    ...(safeReplyTo ? [`Reply-To: ${safeReplyTo}`] : []),
    `Subject: ${subjectEncoded}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    b64encode(text),
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    b64encode(html),
    ``,
    `--${boundary}--`,
  ];
  return lines.join('\r\n');
}

// Task #5 — compose an RFC-5322 address (`Display Name <addr>`) safely.
// CR/LF is stripped (header-injection) and a display name containing any
// "specials" is wrapped in a quoted-string so a name like `Jane <evil@x.com>`
// or `Doe, Jane` can't break the address or inject a second addr-spec into
// From/Reply-To. Returns the bare addr-spec when there's no display name.
function formatAddress(displayName: string, addrSpec: string): string {
  const name = stripHeaderInjection(displayName);
  const addr = stripHeaderInjection(addrSpec);
  if (!name) return addr;
  const quoted = /[()<>[\]:;@\\,."]/.test(name)
    ? `"${name.replace(/([\\"])/g, '\\$1')}"`
    : name;
  return `${quoted} <${addr}>`;
}

// Task #14 — multipart email with a single PDF attachment.
// The body is multipart/mixed containing a multipart/alternative inner
// part (text + html) and an application/pdf attachment.
function buildRawEmailWithAttachment(
  to: string, subject: string, html: string, text: string, from: string,
  filename: string, pdfBytes: Uint8Array,
): string {
  const outerBoundary = `boundary_${crypto.randomUUID().replace(/-/g, '')}`;
  const innerBoundary = `inner_${crypto.randomUUID().replace(/-/g, '')}`;
  const safeTo = stripHeaderInjection(to);
  const safeSubject = stripHeaderInjection(subject);
  const safeFrom = stripHeaderInjection(from);
  const subjectEncoded = `=?UTF-8?B?${btoa(unescape(encodeURIComponent(safeSubject)))}?=`;
  const pdfB64 = b64encodeBytes(pdfBytes);
  const lines = [
    `To: ${safeTo}`,
    `From: ${safeFrom}`,
    `Subject: ${subjectEncoded}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${outerBoundary}"`,
    ``,
    `--${outerBoundary}`,
    `Content-Type: multipart/alternative; boundary="${innerBoundary}"`,
    ``,
    `--${innerBoundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    b64encode(text),
    ``,
    `--${innerBoundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    b64encode(html),
    ``,
    `--${innerBoundary}--`,
    ``,
    `--${outerBoundary}`,
    `Content-Type: application/pdf; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    pdfB64,
    ``,
    `--${outerBoundary}--`,
  ];
  return lines.join('\r\n');
}

function buildEmailHTML(name: string, verificationUrl: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:'Space Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 20px;">
<tr><td align="center">
<table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden;">
<tr><td style="padding:32px 32px 24px;border-bottom:1px solid #f3f4f6;">
  <table cellpadding="0" cellspacing="0">
    <tr>
      <td style="vertical-align:middle;padding-right:10px;">
        <img src="https://axal.vc/axal-mark.png" alt="Axal VC" width="36" height="36" style="display:block;border:0;object-fit:cover;border-radius:8px;" />
      </td>
      <td style="vertical-align:middle;">
        <span style="font-family:'Space Grotesk',sans-serif;font-size:18px;font-weight:700;color:#111827;letter-spacing:-0.01em;">Axal VC</span>
      </td>
    </tr>
  </table>
</td></tr>
<tr><td style="padding:32px 32px 0;">
  <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px;letter-spacing:-0.02em;">Verify Your Email</h1>
  <p style="font-size:14px;color:#6b7280;margin:0 0 24px;line-height:1.6;">
    Hi ${name}, thanks for signing up for Axal VC. Please verify your email address to continue setting up your account.
  </p>
</td></tr>
<tr><td style="padding:0 32px;">
  <table width="100%" cellpadding="0" cellspacing="0">
  <tr><td align="center" style="padding:8px 0 24px;">
    <a href="${verificationUrl}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:16px 28px;border-radius:14px;">Verify Email Address</a>
  </td></tr>
  </table>
</td></tr>
<tr><td style="padding:0 32px 32px;">
  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:14px;padding:18px 20px;">
    <p style="margin:0 0 8px;color:#6b7280;font-size:14px;">Or copy and paste this link into your browser:</p>
    <a href="${verificationUrl}" style="color:#2563eb;word-break:break-all;font-size:14px;">${verificationUrl}</a>
  </div>
  <p style="font-size:12px;color:#9ca3af;margin:24px 0 0;line-height:1.6;">This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function buildReferralInviteHTML(recipientName: string, senderName: string, link: string, code: string, personalMessage: string): string {
  const greet = recipientName ? `Hi ${recipientName.split(' ')[0]},` : 'Hi,';
  const noteBlock = personalMessage
    ? `<tr><td style="padding:0 32px 8px;"><div style="background:#faf5ff;border-left:3px solid #7c3aed;border-radius:8px;padding:14px 16px;color:#4b5563;font-size:14px;line-height:1.55;white-space:pre-wrap;">${escapeHtml(personalMessage)}</div></td></tr>`
    : '';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 20px;">
<tr><td align="center">
<table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden;">
<tr><td style="padding:32px 32px 24px;border-bottom:1px solid #f3f4f6;">
  <table cellpadding="0" cellspacing="0"><tr>
    <td style="vertical-align:middle;padding-right:10px;">
      <img src="https://axal.vc/axal-mark.png" alt="Axal VC" width="36" height="36" style="display:block;border:0;border-radius:8px;" />
    </td>
    <td style="vertical-align:middle;">
      <span style="font-size:18px;font-weight:700;color:#111827;letter-spacing:-0.01em;">Axal VC</span>
    </td>
  </tr></table>
</td></tr>
<tr><td style="padding:32px 32px 0;">
  <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px;letter-spacing:-0.02em;">${escapeHtml(senderName)} invited you to Axal StudioOS</h1>
  <p style="font-size:14px;color:#6b7280;margin:0 0 20px;line-height:1.6;">${greet}</p>
</td></tr>
${noteBlock}
<tr><td style="padding:0 32px;">
  <p style="font-size:14px;color:#374151;margin:8px 0 20px;line-height:1.6;">
    Axal StudioOS is a venture studio operating system that ships funded startups in 30 days — AI-scored deals, automated incorporation, and a real partner network.
    Use ${escapeHtml(senderName)}'s referral link to register with their code pre-filled.
  </p>
  <table width="100%" cellpadding="0" cellspacing="0">
  <tr><td align="center" style="padding:8px 0 24px;">
    <a href="${link}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:16px 28px;border-radius:14px;">Join Axal StudioOS</a>
  </td></tr>
  </table>
</td></tr>
<tr><td style="padding:0 32px 32px;">
  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:14px;padding:18px 20px;">
    <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">Referral code: <strong style="color:#7c3aed;font-family:ui-monospace,monospace;">${escapeHtml(code)}</strong></p>
    <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">Or paste this link into your browser:</p>
    <a href="${link}" style="color:#2563eb;word-break:break-all;font-size:13px;">${link}</a>
  </div>
  <p style="font-size:12px;color:#9ca3af;margin:24px 0 0;line-height:1.6;">You're receiving this because ${escapeHtml(senderName)} sent you a personal invite. If you'd rather not hear from Axal again, just ignore this email — we won't send a follow-up.</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

// Exported so `email/inviteChrome.ts` and `email/personaInviteRender.ts` escape
// through THIS implementation. Both had grown a local copy; two escapers in one
// mail pipeline is one that gets a fix the other does not.
export function escapeHtml(s: string): string {
  return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

// ---------------------------------------------------------------------------
// Agreement / Closing Binder email — sent from `deal@axal.vc` whenever an
// admin assigns an agreement to a partner via the ProfileReviewModal.
// Includes a one-click magic link to the eSignature page.
// Note: requires the configured Gmail account to have `deal@axal.vc` set up
// as a Send-As alias. Without that, Gmail rewrites the From header to the
// authenticated user's primary address (the email still sends).
// ---------------------------------------------------------------------------
export type EmailSendResult =
  | { ok: true; reason: null }
  | { ok: false; reason: 'suppressed' | 'not_configured' | 'refused' | 'failed' };

export async function sendAgreementAssignedEmail(
  env: Env,
  to: string,
  recipientName: string,
  agreementLabel: string,
  signLink: string,
  adminName: string,
): Promise<boolean> {
  return (await sendAgreementAssignedEmailResult(env, to, recipientName, agreementLabel, signLink, adminName)).ok;
}

/** The agreement (signing) email's subject, HTML and text. Pure, so a test reads exactly what is sent. */
export function agreementAssignedEmailContent(
  recipientName: string, agreementLabel: string, signLink: string, adminName: string, linkExpiryDays = 7,
): { subject: string; html: string; text: string } {
    const greet = recipientName ? `Hi ${recipientName.split(' ')[0]},` : 'Hi,';
    const safeAgreement = escapeHtml(agreementLabel);
    const safeAdmin = escapeHtml(adminName);
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 20px;"><tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden;">
<tr><td style="padding:32px 32px 20px;border-bottom:1px solid #f3f4f6;">
  <table cellpadding="0" cellspacing="0"><tr>
    <td style="vertical-align:middle;padding-right:10px;">
      <img src="https://axal.vc/axal-mark.png" alt="Axal VC" width="36" height="36" style="display:block;border:0;border-radius:8px;" />
    </td>
    <td style="vertical-align:middle;">
      <span style="font-size:18px;font-weight:700;color:#111827;letter-spacing:-0.01em;">Axal Deals</span>
      <div style="font-size:11px;color:#9ca3af;margin-top:2px;">deal@axal.vc</div>
    </td>
  </tr></table>
</td></tr>
<tr><td style="padding:28px 32px 0;">
  <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px;letter-spacing:-0.02em;">Your Closing Binder is ready</h1>
  <p style="font-size:14px;color:#6b7280;margin:0 0 18px;line-height:1.6;">${greet}</p>
  <p style="font-size:14px;color:#374151;margin:0 0 18px;line-height:1.65;">
    ${safeAdmin} has reviewed and verified your partner profile. Your assigned agreement is ready for electronic signature:
  </p>
  <div style="background:#faf5ff;border:1px solid #e9d5ff;border-left:3px solid #7c3aed;border-radius:10px;padding:16px 18px;margin:0 0 24px;">
    <div style="font-size:12px;color:#7c3aed;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px;">Closing Binder</div>
    <div style="font-size:16px;color:#111827;font-weight:600;">${safeAgreement}</div>
  </div>
</td></tr>
<tr><td style="padding:0 32px;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:0 0 24px;">
    <a href="${signLink}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:16px 32px;border-radius:14px;">Review &amp; Sign Document</a>
  </td></tr></table>
</td></tr>
<tr><td style="padding:0 32px 32px;">
  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:14px;padding:16px 18px;">
    <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">Or paste this link into your browser:</p>
    <a href="${signLink}" style="color:#2563eb;word-break:break-all;font-size:12px;">${signLink}</a>
  </div>
  <p style="font-size:11px;color:#9ca3af;margin:20px 0 0;line-height:1.6;">
    This link is unique to you and expires in ${linkExpiryDays} days. Every access is logged for compliance.
    Reply to this email if anything looks incorrect — we'll re-issue.
  </p>
</td></tr>
</table></td></tr></table></body></html>`;
    const text = `${greet}\n\n${adminName} has verified your partner profile and assigned your Closing Binder:\n\n  ${agreementLabel}\n\nReview and sign here: ${signLink}\n\nThis link expires in ${linkExpiryDays} days. Every access is logged.\n\n— Axal Deals`;
    const subject = `Your Closing Binder is ready: ${agreementLabel}`;
    return { subject, html, text };
}

export async function sendAgreementAssignedEmailResult(
  env: Env,
  to: string,
  recipientName: string,
  agreementLabel: string,
  signLink: string,
  adminName: string,
  linkExpiryDays = 7,
): Promise<EmailSendResult> {
  // D810 — the suppression list, by reason (transactional).
  if (await isSuppressed(env, to, 'transactional')) return { ok: false, reason: 'suppressed' };
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) {
    console.error('[EMAIL] Gmail credentials missing — agreement email not sent');
    return { ok: false, reason: 'not_configured' };
  }
  try {
    const accessToken = await getGmailAccessToken(env);
    const { subject, html, text } = agreementAssignedEmailContent(recipientName, agreementLabel, signLink, adminName, linkExpiryDays);
    const rawEmail = buildRawEmail(to, subject, html, text, 'Axal Deals <deal@axal.vc>');
    const raw = btoa(unescape(encodeURIComponent(rawEmail))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      signal: AbortSignal.timeout(MAIL_FETCH_TIMEOUT_MS),
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}));
      console.error('[EMAIL] Agreement email send failed:', err);
      return { ok: false, reason: 'refused' };
    }
    return { ok: true, reason: null };
  } catch (e: any) {
    console.error(`[EMAIL] Agreement email failed for ${to}: ${e?.message || 'Unknown error'}`);
    return { ok: false, reason: 'failed' };
  }
}

// ---------------------------------------------------------------------------
// D5585 part 5 (#5585) — the release sign-off email. The native e-sign service
// sends it in place of the agreement email above for an envelope of document
// type `work_graph_release` (`signingEmailFor` in routes/esign.ts): the release
// owner is asked to sign the release they own. It names the release by ids only
// (line, manifest, digest), never its content, and makes no claim beyond what
// signing does: the e-sign service records the owner's signature, or their
// decline, on this envelope. Transactional, like the agreement email: the same
// suppression check, the same link expiry and access-log lines, no unsubscribe.
// ---------------------------------------------------------------------------
export interface ReleaseSignEmailInput {
  recipientName: string;
  /** The release line's asset uid: the name the line goes by. */
  lineAssetUid: string;
  manifestUid: string;
  /** The manifest's sha256 digest, hex. */
  digest: string;
  signLink: string;
  linkExpiryDays?: number;
}

/** The release sign-off email's subject, text and HTML. Pure, so a test reads exactly what is sent. */
export function releaseSignEmailContent(i: ReleaseSignEmailInput): { subject: string; html: string; text: string } {
  const days = i.linkExpiryDays ?? 7;
  const greet = i.recipientName ? `Hi ${i.recipientName.split(' ')[0]},` : 'Hi,';
  const shortDigest = i.digest.slice(0, 12);
  const subject = `Sign release ${i.lineAssetUid} (sha256:${shortDigest})`;
  const line = escapeHtml(i.lineAssetUid);
  const manifest = escapeHtml(i.manifestUid);
  const digest = escapeHtml(i.digest);
  const link = escapeHtml(i.signLink);
  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 12px 4px 0;font-size:12px;color:#6b7280;white-space:nowrap;vertical-align:top;">${label}</td>` +
    `<td style="padding:4px 0;font-size:13px;color:#111827;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all;">${value}</td></tr>`;
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 20px;"><tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden;">
<tr><td style="padding:32px 32px 20px;border-bottom:1px solid #f3f4f6;">
  <table cellpadding="0" cellspacing="0"><tr>
    <td style="vertical-align:middle;padding-right:10px;">
      <img src="https://axal.vc/axal-mark.png" alt="Axal VC" width="36" height="36" style="display:block;border:0;border-radius:8px;" />
    </td>
    <td style="vertical-align:middle;"><span style="font-size:18px;font-weight:700;color:#111827;letter-spacing:-0.01em;">StudioOS releases</span></td>
  </tr></table>
</td></tr>
<tr><td style="padding:28px 32px 0;">
  <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px;letter-spacing:-0.02em;">Sign release ${line}</h1>
  <p style="font-size:14px;color:#6b7280;margin:0 0 18px;line-height:1.6;">${escapeHtml(greet)}</p>
  <p style="font-size:14px;color:#374151;margin:0 0 18px;line-height:1.65;">
    You own this release line, so you are asked to sign the release below. It is identified by its manifest and digest.
  </p>
  <table cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:12px 16px;margin:0 0 18px;width:100%;">
    ${row('Release line', line)}
    ${row('Manifest', manifest)}
    ${row('Digest', `sha256:${digest}`)}
  </table>
  <p style="font-size:14px;color:#374151;margin:0 0 24px;line-height:1.65;">
    Signing records your signature against this manifest digest in the e-signature record. You can decline instead.
  </p>
</td></tr>
<tr><td style="padding:0 32px;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:0 0 24px;">
    <a href="${link}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:16px 32px;border-radius:14px;">Review &amp; sign release</a>
  </td></tr></table>
</td></tr>
<tr><td style="padding:0 32px 32px;">
  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:14px;padding:16px 18px;">
    <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">Or paste this link into your browser:</p>
    <a href="${link}" style="color:#2563eb;word-break:break-all;font-size:12px;">${link}</a>
  </div>
  <p style="font-size:11px;color:#9ca3af;margin:20px 0 0;line-height:1.6;">
    This link is unique to you and expires in ${days} days. Every access is logged for compliance.
  </p>
</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    greet,
    '',
    'You own this release line, so you are asked to sign the release below. It is identified by its manifest and digest.',
    '',
    `  Release line: ${i.lineAssetUid}`,
    `  Manifest:     ${i.manifestUid}`,
    `  Digest:       sha256:${i.digest}`,
    '',
    'Signing records your signature against this manifest digest in the e-signature record. You can decline instead.',
    '',
    `Review and sign here: ${i.signLink}`,
    '',
    `This link expires in ${days} days. Every access is logged.`,
    '',
    '— StudioOS releases',
  ].join('\n');
  return { subject, html, text };
}

export async function sendReleaseSignEmailResult(env: Env, to: string, input: ReleaseSignEmailInput): Promise<EmailSendResult> {
  // D810 — the suppression list, by reason (transactional).
  if (await isSuppressed(env, to, 'transactional')) return { ok: false, reason: 'suppressed' };
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) {
    console.error('[EMAIL] Gmail credentials missing — release sign-off email not sent');
    return { ok: false, reason: 'not_configured' };
  }
  try {
    const accessToken = await getGmailAccessToken(env);
    const { subject, html, text } = releaseSignEmailContent(input);
    const rawEmail = buildRawEmail(to, subject, html, text, 'StudioOS releases <noreply@axal.vc>');
    const raw = btoa(unescape(encodeURIComponent(rawEmail))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      signal: AbortSignal.timeout(MAIL_FETCH_TIMEOUT_MS),
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}));
      console.error('[EMAIL] Release sign-off email send failed:', err);
      return { ok: false, reason: 'refused' };
    }
    return { ok: true, reason: null };
  } catch (e: any) {
    console.error(`[EMAIL] Release sign-off email failed: ${e?.message || 'Unknown error'}`);
    return { ok: false, reason: 'failed' };
  }
}

// ---------------------------------------------------------------------------
// Task #8 (X-1) — Partner invitation email. Sent from `noreply@axal.vc`
// when an admin issues a partnership invitation. The CTA opens the
// chatbot wizard at `${APP_URL}/partner-onboarding/${token}` (handled
// by the X-2 frontend). 14-day default expiry.
// ---------------------------------------------------------------------------
export async function sendPartnerInvitationEmail(
  env: Env,
  to: string,
  recipientName: string,
  adminName: string,
  link: string,
  personalMessage: string,
): Promise<boolean> {
  return (await sendPartnerInvitationEmailResult(env, to, recipientName, adminName, link, personalMessage)).ok;
}

export async function sendPartnerInvitationEmailResult(
  env: Env,
  to: string,
  recipientName: string,
  adminName: string,
  link: string,
  personalMessage: string,
): Promise<EmailSendResult> {
  // D810 — the suppression list, by reason (transactional).
  if (await isSuppressed(env, to, 'transactional')) return { ok: false, reason: 'suppressed' };
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) {
    console.error('[EMAIL] Gmail credentials missing — partner invitation not sent');
    return { ok: false, reason: 'not_configured' };
  }
  try {
    const accessToken = await getGmailAccessToken(env);
    const greet = recipientName ? `Hi ${recipientName.split(' ')[0]},` : 'Hi,';
    const noteBlock = personalMessage
      ? `<tr><td style="padding:0 32px 8px;"><div style="background:#faf5ff;border-left:3px solid #7c3aed;border-radius:8px;padding:14px 16px;color:#4b5563;font-size:14px;line-height:1.55;white-space:pre-wrap;">${escapeHtml(personalMessage)}</div></td></tr>`
      : '';
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 20px;">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden;">
<tr><td style="padding:32px 32px 20px;border-bottom:1px solid #f3f4f6;">
  <table cellpadding="0" cellspacing="0"><tr>
    <td style="vertical-align:middle;padding-right:10px;">
      <img src="https://axal.vc/axal-mark.png" alt="Axal VC" width="36" height="36" style="display:block;border:0;border-radius:8px;" />
    </td>
    <td style="vertical-align:middle;">
      <span style="font-size:18px;font-weight:700;color:#111827;letter-spacing:-0.01em;">Axal VC</span>
      <div style="font-size:11px;color:#9ca3af;margin-top:2px;">Partner Network</div>
    </td>
  </tr></table>
</td></tr>
<tr><td style="padding:28px 32px 0;">
  <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px;letter-spacing:-0.02em;">You're invited to partner with Axal VC</h1>
  <p style="font-size:14px;color:#6b7280;margin:0 0 18px;line-height:1.6;">${greet}</p>
  <p style="font-size:14px;color:#374151;margin:0 0 18px;line-height:1.65;">
    ${escapeHtml(adminName)} has invited you to join the Axal VC partner network. We work with venture partners,
    operating partners, deal scouts, and capital providers to help our portfolio ship faster. The link below
    opens a short chatbot that profiles your interests, returns 1–3 partnership structures tailored to you,
    and walks you through electronic signature.
  </p>
</td></tr>
${noteBlock}
<tr><td style="padding:0 32px;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 24px;">
    <a href="${link}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:16px 32px;border-radius:14px;">Start partner onboarding</a>
  </td></tr></table>
</td></tr>
<tr><td style="padding:0 32px 32px;">
  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:14px;padding:16px 18px;">
    <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">Or paste this link into your browser:</p>
    <a href="${link}" style="color:#2563eb;word-break:break-all;font-size:12px;">${link}</a>
  </div>
  <p style="font-size:11px;color:#9ca3af;margin:20px 0 0;line-height:1.6;">
    This link is unique to you and expires in 14 days. If you didn't expect this invitation,
    you can safely ignore the email — we won't send a follow-up.
  </p>
</td></tr>
</table></td></tr></table></body></html>`;
    const noteText = personalMessage ? `\n\n${personalMessage}\n\n` : '\n\n';
    const text = `${greet}\n\n${adminName} has invited you to join the Axal VC partner network.${noteText}Open the partner onboarding chatbot here: ${link}\n\nThis link expires in 14 days.\n\n— Axal VC`;
    const subject = `You're invited to partner with Axal VC`;
    const rawEmail = buildRawEmail(to, subject, html, text, 'Axal VC <noreply@axal.vc>');
    const raw = btoa(unescape(encodeURIComponent(rawEmail))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      signal: AbortSignal.timeout(MAIL_FETCH_TIMEOUT_MS),
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}));
      console.error('[EMAIL] Partner invitation send failed:', err);
      return { ok: false, reason: 'refused' };
    }
    return { ok: true, reason: null };
  } catch (e: any) {
    console.error(`[EMAIL] Partner invitation failed for ${to}: ${e?.message || 'Unknown error'}`);
    return { ok: false, reason: 'failed' };
  }
}

/**
 * Task #121 — a company invitation, which until now did not exist.
 *
 * `POST /company/:uid/members` resolved an address to an existing account and
 * 404'd otherwise, so nobody was ever emailed and nobody was ever asked. This
 * is the message that makes the settings page's "Invite" true.
 *
 * IT RETURNS FALSE RATHER THAN THROWING, like every sender in this file, and
 * the caller stores the answer: `company_invitations.email_sent`. An
 * invitation nobody was told about is a real state — no Gmail credentials in
 * this environment is the ordinary cause — and the settings page draws it
 * differently from one that is merely unanswered, offering the link instead.
 *
 * Every interpolated value is escaped. `companyName` and `inviterName` are
 * typed by a user, and this is HTML going to a third party's inbox.
 *
 * D8536: the subject, text and HTML are built here, pure, so a test reads
 * exactly what is sent. The company settings page sends it under the delivery
 * contract (`sendCompanyInvitationEmailBound` below); the HQ move invitation
 * (`rpc/branchOps.ts`) still uses the unreferenced sender.
 */
export function companyInvitationEmailContent(
  companyName: string, inviterName: string, link: string,
): { subject: string; html: string; text: string } {
  const co = escapeHtml(companyName);
  const who = escapeHtml(inviterName);
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 20px;">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden;">
<tr><td style="padding:32px 32px 20px;border-bottom:1px solid #f3f4f6;">
  <table cellpadding="0" cellspacing="0"><tr>
    <td style="vertical-align:middle;padding-right:10px;">
      <img src="https://axal.vc/axal-mark.png" alt="Axal VC" width="36" height="36" style="display:block;border:0;border-radius:8px;" />
    </td>
    <td style="vertical-align:middle;">
      <span style="font-size:18px;font-weight:700;color:#111827;letter-spacing:-0.01em;">Axal VC</span>
      <div style="font-size:11px;color:#9ca3af;margin-top:2px;">StudioOS</div>
    </td>
  </tr></table>
</td></tr>
<tr><td style="padding:28px 32px 0;">
  <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px;letter-spacing:-0.02em;">${who} invited you to ${co}</h1>
  <p style="font-size:14px;color:#374151;margin:0 0 18px;line-height:1.65;">
    Accepting adds you to ${co} on Axal VC StudioOS, where you will be able to see and work on
    what the team keeps there. If you do not have an account yet, the link will help you make one first.
  </p>
</td></tr>
<tr><td style="padding:0 32px;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 24px;">
    <a href="${link}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:16px 32px;border-radius:14px;">Join ${co}</a>
  </td></tr></table>
</td></tr>
<tr><td style="padding:0 32px 32px;">
  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:14px;padding:16px 18px;">
    <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">Or paste this link into your browser:</p>
    <a href="${link}" style="color:#2563eb;word-break:break-all;font-size:12px;">${link}</a>
  </div>
  <p style="font-size:11px;color:#9ca3af;margin:20px 0 0;line-height:1.6;">
    This invitation expires in 14 days, and works only for this email address.
    If you were not expecting it, you can ignore it — nothing happens until you accept.
  </p>
</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${inviterName} invited you to join ${companyName} on Axal VC StudioOS.\n\n`
    + `Accept here: ${link}\n\nThis invitation expires in 14 days and works only for this email `
    + `address. If you were not expecting it, you can ignore it — nothing happens until you accept.\n\n— Axal VC`;
  return { subject: `${inviterName} invited you to ${companyName}`, html, text };
}

export async function sendCompanyInvitationEmail(
  env: Env,
  to: string,
  companyName: string,
  inviterName: string,
  link: string,
): Promise<boolean> {
  // D810 — the suppression list, by reason (transactional).
  if (await isSuppressed(env, to, 'transactional')) return false;
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) {
    console.error('[EMAIL] Gmail credentials missing — company invitation not sent');
    return false;
  }
  try {
    const accessToken = await getGmailAccessToken(env);
    const { subject, html, text } = companyInvitationEmailContent(companyName, inviterName, link);
    const rawEmail = buildRawEmail(to, subject, html, text, 'Axal VC <noreply@axal.vc>');
    const raw = btoa(unescape(encodeURIComponent(rawEmail))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      signal: AbortSignal.timeout(MAIL_FETCH_TIMEOUT_MS),
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}));
      console.error('[EMAIL] Company invitation send failed:', err);
      return false;
    }
    return true;
  } catch (e: any) {
    console.error(`[EMAIL] Company invitation failed for ${to}: ${e?.message || 'Unknown error'}`);
    return false;
  }
}

/**
 * D8536 (#8536) — the company invitation under the delivery contract. The
 * address is the one the invitation row names (`ref.subject`), the answer is
 * the contract state, and a retry of the same reference never mails twice.
 * A refused send is tried once more in the same call, since nothing left.
 */
export async function sendCompanyInvitationEmailBound(
  env: Env,
  ref: SendReference,
  content: { companyName: string; inviterName: string; link: string },
): Promise<DeliveryResult> {
  const { subject, html, text } = companyInvitationEmailContent(content.companyName, content.inviterName, content.link);
  return deliverWithReference(env, ref, (to) => sendRawEmailOutcome(env, {
    to, subject, html, text, from: 'Axal VC <noreply@axal.vc>', mailClass: 'transactional',
  }), { tries: 2 });
}

// ---------------------------------------------------------------------------
// D8536 part 2 (#8536) — signatures, billing and operational alerts under the
// delivery contract. Each sender takes a send reference instead of an address:
// the recipient is read from the reference's subject record, the answer is the
// contract state, and a retry of the same reference never mails twice. The
// content functions above are the ones the unreferenced senders use, so the
// message a person receives is unchanged. A refused send is tried once more in
// the same call, since nothing left, except a signing email (SIGNING_TRIES).
// ---------------------------------------------------------------------------
async function deliverBound(
  env: Env, ref: SendReference, message: (to: string) => Omit<RawEmailOpts, 'to'>, tries = 2,
): Promise<DeliveryResult> {
  return deliverWithReference(env, ref, (to) => sendRawEmailOutcome(env, { ...message(to), to }), { tries });
}

// A signing email is tried once per call. Its link can be replaced by a
// concurrent resend while the first send is out (D924), and a second try in
// the same call would mail the superseded link. Every caller already answers a
// refused send (restoring the earlier link, or a 502 the person retries), and
// that retry carries the same reference.
const SIGNING_TRIES = 1;

/** A contract answer as the older `EmailSendResult` (`ok` only for `accepted`), for callers that read `.ok`. */
export function asEmailSendResult(r: DeliveryResult): EmailSendResult {
  if (r.state === 'accepted') return { ok: true, reason: null };
  if (r.reason === 'suppressed') return { ok: false, reason: 'suppressed' };
  if (r.reason === 'not_configured') return { ok: false, reason: 'not_configured' };
  return { ok: false, reason: r.state === 'timed_out' ? 'failed' : 'refused' };
}

/**
 * D8536 part 2 (#8536) — the send reference of one signing email. The subject
 * is the `esign_recipients` row, which names the address while it waits to
 * sign. The attempt is which issuance of its signing token this is (the first
 * 16 hex of the token's SHA-256, so a replaced link is a new attempt) and the
 * occasion: `send` for the first email of a token, `remind-YYYYMMDD` for the
 * sender's reminder (at most one a day, D411), `resend-YYYYMMDDHH` for a
 * re-send of the same link (a signer's own, at most one an hour, D6197; an
 * admin's). A retry within one occasion carries the same reference, so a send
 * that was accepted, or that left without an answer, is not mailed again.
 */
export type SigningOccasion = 'send' | 'renew' | 'remind' | 'resend';
export async function signingRef(recipientId: number, token: string, occasion: SigningOccasion, now = new Date()): Promise<SendReference> {
  const iso = now.toISOString();
  const day = iso.slice(0, 10).replace(/-/g, '');
  const when = occasion === 'remind' ? `-${day}` : occasion === 'resend' ? `-${day}${iso.slice(11, 13)}` : '';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const issuance = Array.from(new Uint8Array(digest)).slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
  return { flow: 'signature', subject: { kind: 'esign_recipient', id: recipientId }, attempt: `${issuance}.${occasion}${when}` };
}

/** The agreement signing email, to the e-sign recipient `ref` names (subject `esign_recipient`). */
export async function sendAgreementAssignedEmailBound(
  env: Env,
  ref: SendReference,
  c: { recipientName: string; agreementLabel: string; signLink: string; adminName: string; linkExpiryDays?: number },
): Promise<DeliveryResult> {
  const { subject, html, text } = agreementAssignedEmailContent(c.recipientName, c.agreementLabel, c.signLink, c.adminName, c.linkExpiryDays ?? 7);
  return deliverBound(env, ref, () => ({ subject, html, text, from: 'Axal Deals <deal@axal.vc>', mailClass: 'transactional' }), SIGNING_TRIES);
}

/** The release sign-off email, to the e-sign recipient `ref` names (subject `esign_recipient`). */
export async function sendReleaseSignEmailBound(env: Env, ref: SendReference, input: ReleaseSignEmailInput): Promise<DeliveryResult> {
  const { subject, html, text } = releaseSignEmailContent(input);
  return deliverBound(env, ref, () => ({ subject, html, text, from: 'StudioOS releases <noreply@axal.vc>', mailClass: 'transactional' }), SIGNING_TRIES);
}

/** A signed PDF forwarded to the address its forward log row names (subject `esign_forward`). */
export async function sendSignedPdfForwardedEmailBound(
  env: Env,
  ref: SendReference,
  c: { documentTitle: string; senderName: string; pdfBytes: Uint8Array; message?: string; from?: string },
): Promise<DeliveryResult> {
  return deliverBound(env, ref, (to) => {
    const { subject, html, text, filename } = signedPdfForwardedEmailContent(to, c.documentTitle, c.senderName, { message: c.message });
    return {
      subject, html, text, from: c.from || 'Axal VC Legal <legal@axal.vc>', mailClass: 'transactional',
      attachments: [{ filename, contentType: 'application/pdf', content: '', bytes: c.pdfBytes }],
    };
  });
}

/** A branded receipt, to the address its subject record names (`invoice_receipt` or `order_receipt`). */
export async function sendBrandedInvoiceEmailBound(
  env: Env, ref: SendReference, opts: Omit<BrandedInvoiceOpts, 'to'>,
): Promise<DeliveryResult> {
  return deliverBound(env, ref, (to) => {
    const { subject, html, text } = brandedInvoiceContent({ ...opts, to });
    return {
      subject, html, text, from: 'Axal VC <billing@axal.vc>', mailClass: 'transactional',
      attachments: opts.pdfBytes && opts.pdfBytes.length
        ? [{ filename: `${(opts.invoiceNumber || 'receipt').replace(/[^a-zA-Z0-9 _-]/g, '')}.pdf`, contentType: 'application/pdf', content: '', bytes: opts.pdfBytes }]
        : undefined,
    };
  });
}

/** The flagged-score alert, to the admin its `notifications` row names (subject `admin_alert`). */
export async function sendFlaggedScoreEmailBound(
  env: Env, ref: SendReference, recipientName: string, payload: FlaggedScoreEmailPayload,
): Promise<DeliveryResult> {
  const { subject, html, text } = flaggedScoreEmailContent(recipientName, payload);
  return deliverBound(env, ref, () => ({ subject, html, text, from: 'Axal Alerts <noreply@axal.vc>', mailClass: 'transactional' }));
}

/**
 * Task #5 — build the raw MIME for a network/referral invite.
 *
 * The From address stays on Axal's authenticated domain (noreply@axal.vc) so
 * DKIM/SPF/DMARC alignment holds; the inviting user's identity rides in the
 * From *display name* (`{sender} via Axal StudioOS`) and — crucially — in a
 * Reply-To header so a recipient who hits "Reply" reaches the sender directly
 * instead of the unmonitored noreply mailbox. All sender-controlled values are
 * CR/LF-stripped (and display names quoted) via formatAddress so they can't
 * smuggle extra headers or spoof a second From address.
 *
 * Exported for unit testing (see test/referral_invite_replyto.test.ts).
 */
export function buildReferralInviteRaw(
  to: string,
  recipientName: string,
  senderName: string,
  senderEmail: string,
  link: string,
  code: string,
  personalMessage: string,
): string {
  const html = buildReferralInviteHTML(recipientName, senderName, link, code, personalMessage);
  const noteText = personalMessage ? `\n\n${personalMessage}\n\n` : '\n\n';
  const text = `${recipientName ? `Hi ${recipientName.split(' ')[0]},` : 'Hi,'}\n\n${senderName} invited you to Axal StudioOS — a venture studio that ships funded startups in 30 days.${noteText}Join here: ${link}\nReferral code: ${code}\n`;
  const subject = `${senderName} invited you to Axal StudioOS`;
  const safeSenderName = stripHeaderInjection(senderName);
  const from = formatAddress(
    safeSenderName ? `${safeSenderName} via Axal StudioOS` : 'Axal VC',
    'noreply@axal.vc',
  );
  const safeSenderEmail = stripHeaderInjection(senderEmail);
  // Reply-To carries the sender's registered email so replies route to them.
  // Omitted entirely when no sender email is available.
  const replyTo = safeSenderEmail ? formatAddress(senderName, safeSenderEmail) : undefined;
  return buildRawEmail(to, subject, html, text, from, replyTo);
}

export async function sendReferralInviteEmail(
  env: Env,
  to: string,
  recipientName: string,
  senderName: string,
  senderEmail: string,
  link: string,
  code: string,
  personalMessage: string,
): Promise<boolean> {
  // D810 — the suppression list, by reason (transactional).
  if (await isSuppressed(env, to, 'transactional')) return false;
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) {
    console.error('[EMAIL] Gmail credentials missing — referral invite not sent');
    return false;
  }
  try {
    const accessToken = await getGmailAccessToken(env);
    const rawEmail = buildReferralInviteRaw(to, recipientName, senderName, senderEmail, link, code, personalMessage);
    const raw = btoa(unescape(encodeURIComponent(rawEmail))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      signal: AbortSignal.timeout(MAIL_FETCH_TIMEOUT_MS),
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}));
      console.error('[EMAIL] Referral invite send failed:', err);
      return false;
    }
    return true;
  } catch (e: any) {
    console.error(`[EMAIL] Referral invite failed for ${to}: ${e?.message || 'Unknown error'}`);
    return false;
  }
}

/**
 * Build the raw MIME for a founder-initiated Contacts invite.
 *
 * The From address stays on Axal's authenticated domain (noreply@axal.vc) so
 * DKIM/SPF/DMARC alignment holds; the founder's identity rides in the From
 * *display name* (`{founder} via Axal StudioOS`) and a Reply-To header so a
 * recipient who hits "Reply" reaches the founder directly. All sender-controlled
 * values are CR/LF-stripped (and display names quoted) via formatAddress so they
 * can't smuggle extra headers or spoof a second address.
 *
 * Exported for unit testing (see test/contact_invite_replyto.test.ts).
 */
export function buildContactInviteRaw(
  to: string,
  recipientName: string,
  senderName: string,
  senderEmail: string,
  projectName: string,
  link: string,
  personalMessage: string,
): string {
  const who = senderName || 'A founder at Axal StudioOS';
  const project = projectName || 'their venture';
  const greet = recipientName ? `Hi ${recipientName.split(' ')[0]},` : 'Hi,';
  const noteBlock = personalMessage
    ? `<tr><td style="padding:0 32px 8px;"><div style="background:#faf5ff;border-left:3px solid #7c3aed;border-radius:8px;padding:14px 16px;color:#4b5563;font-size:14px;line-height:1.55;white-space:pre-wrap;">${escapeHtml(personalMessage)}</div></td></tr>`
    : '';
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 20px;">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden;">
<tr><td style="padding:32px 32px 20px;border-bottom:1px solid #f3f4f6;">
  <table cellpadding="0" cellspacing="0"><tr>
    <td style="vertical-align:middle;padding-right:10px;">
      <img src="https://axal.vc/axal-mark.png" alt="Axal VC" width="36" height="36" style="display:block;border:0;border-radius:8px;" />
    </td>
    <td style="vertical-align:middle;">
      <span style="font-size:18px;font-weight:700;color:#111827;letter-spacing:-0.01em;">Axal StudioOS</span>
      <div style="font-size:11px;color:#9ca3af;margin-top:2px;">Venture Studio</div>
    </td>
  </tr></table>
</td></tr>
<tr><td style="padding:28px 32px 0;">
  <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px;letter-spacing:-0.02em;">${escapeHtml(who)} would like to connect</h1>
  <p style="font-size:14px;color:#6b7280;margin:0 0 18px;line-height:1.6;">${escapeHtml(greet)}</p>
  <p style="font-size:14px;color:#374151;margin:0 0 18px;line-height:1.65;">
    ${escapeHtml(who)} invited you to connect about <strong>${escapeHtml(project)}</strong> on Axal StudioOS.
    You can reply straight to this email to reach them directly, or use the link below to learn more.
  </p>
</td></tr>
${noteBlock}
<tr><td style="padding:0 32px;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 24px;">
    <a href="${link}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:16px 32px;border-radius:14px;">Learn more</a>
  </td></tr></table>
</td></tr>
<tr><td style="padding:0 32px 32px;">
  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:14px;padding:16px 18px;">
    <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">Or paste this link into your browser:</p>
    <a href="${link}" style="color:#2563eb;word-break:break-all;font-size:12px;">${link}</a>
  </div>
  <p style="font-size:11px;color:#9ca3af;margin:20px 0 0;line-height:1.6;">
    You're receiving this because ${escapeHtml(who)} added you as a contact on Axal StudioOS.
    If you didn't expect this, you can safely ignore it — we won't send a follow-up.
  </p>
</td></tr>
</table></td></tr></table></body></html>`;
  const noteText = personalMessage ? `\n\n${personalMessage}\n\n` : '\n\n';
  const text = `${greet}\n\n${who} invited you to connect about ${project} on Axal StudioOS.${noteText}Learn more: ${link}\n\nJust reply to this email to reach ${who} directly.\n\n— Axal StudioOS`;
  const subject = `${who} would like to connect with you`;
  const from = formatAddress(`${who} via Axal StudioOS`, 'noreply@axal.vc');
  const safeSenderEmail = stripHeaderInjection(senderEmail);
  const replyTo = safeSenderEmail ? formatAddress(who, safeSenderEmail) : undefined;
  return buildRawEmail(to, subject, html, text, from, replyTo);
}

/**
 * Deliver a founder-initiated Contacts invite via Gmail. Returns whether Gmail
 * accepted the message so the caller can surface delivery success/failure to the
 * founder (never swallowed). Missing Gmail creds → logged + returns false.
 */
export async function sendContactInviteEmail(
  env: Env,
  to: string,
  recipientName: string,
  senderName: string,
  senderEmail: string,
  projectName: string,
  link: string,
  personalMessage: string,
): Promise<boolean> {
  // D810 — the suppression list, by reason (transactional).
  if (await isSuppressed(env, to, 'transactional')) return false;
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) {
    console.error('[EMAIL] Gmail credentials missing — contact invite not sent');
    return false;
  }
  try {
    const accessToken = await getGmailAccessToken(env);
    const rawEmail = buildContactInviteRaw(to, recipientName, senderName, senderEmail, projectName, link, personalMessage);
    const raw = btoa(unescape(encodeURIComponent(rawEmail))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      signal: AbortSignal.timeout(MAIL_FETCH_TIMEOUT_MS),
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}));
      console.error('[EMAIL] Contact invite send failed:', err);
      return false;
    }
    return true;
  } catch (e: any) {
    console.error(`[EMAIL] Contact invite failed for ${to}: ${e?.message || 'Unknown error'}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Epic 5 — Admin alerts when a score is flagged for review (anomaly, hash
// mismatch, or missing signature), sent once per event. The daily digest of
// unreviewed items older than 24h was retired by D671. Best-effort delivery —
// notifications.ts always also writes an in-app row first.
// ---------------------------------------------------------------------------
export interface FlaggedScoreEmailPayload {
  projectName: string;
  snapshotId: number;
  totalScore: number | null;
  flagSummary: string[];
  reviewUrl: string;
  source: 'submit' | 'hash_audit';
}

/** The flagged-score alert's subject, HTML and text. Pure, so a test reads exactly what is sent. */
export function flaggedScoreEmailContent(recipientName: string, payload: FlaggedScoreEmailPayload): { subject: string; html: string; text: string } {
    const greet = recipientName ? `Hi ${recipientName.split(' ')[0]},` : 'Hi,';
    const safeProject = escapeHtml(payload.projectName);
    const safeFlags = payload.flagSummary.length
      ? payload.flagSummary.map(f => `<li>${escapeHtml(f)}</li>`).join('')
      : '<li>integrity issue</li>';
    const sourceLabel = payload.source === 'hash_audit' ? 'Nightly HMAC audit' : 'Live anomaly detection';
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 20px;"><tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden;">
<tr><td style="padding:24px 28px;border-bottom:1px solid #f3f4f6;background:#fef2f2;">
  <div style="font-size:11px;color:#b91c1c;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Score integrity alert</div>
  <div style="font-size:18px;color:#111827;font-weight:700;margin-top:4px;">A score is awaiting your review</div>
</td></tr>
<tr><td style="padding:24px 28px;">
  <p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.6;">${greet}</p>
  <p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.6;">
    A score for <strong>${safeProject}</strong> was flagged by ${escapeHtml(sourceLabel)} and is hidden from LPs/partners until you sign off.
  </p>
  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin:12px 0 18px;font-size:13px;color:#374151;">
    <div><strong>Snapshot:</strong> #${payload.snapshotId}</div>
    <div><strong>Score:</strong> ${payload.totalScore ?? 'unknown'}</div>
    <div style="margin-top:6px;"><strong>Flags:</strong></div>
    <ul style="margin:4px 0 0 18px;padding:0;">${safeFlags}</ul>
  </div>
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 4px;">
    <a href="${payload.reviewUrl}" style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:12px;">Open review queue</a>
  </td></tr></table>
  <p style="margin:18px 0 0;font-size:11px;color:#9ca3af;line-height:1.6;">
    You're receiving this because you have admin access to Axal StudioOS. Adjust your notification preferences in Settings.
  </p>
</td></tr>
</table></td></tr></table></body></html>`;
    const text = `${greet}\n\nA score for ${payload.projectName} was flagged by ${sourceLabel}.\n` +
      `Snapshot #${payload.snapshotId} (score ${payload.totalScore ?? 'unknown'})\n` +
      `Flags: ${payload.flagSummary.join(', ') || 'integrity issue'}\n\n` +
      `Review here: ${payload.reviewUrl}\n`;
    const subject = `[Axal] Score flagged for review — ${payload.projectName}`;
    return { subject, html, text };
}

export async function sendFlaggedScoreEmail(
  env: Env,
  to: string,
  recipientName: string,
  payload: FlaggedScoreEmailPayload,
): Promise<boolean> {
  // D810 — the suppression list, by reason (transactional).
  if (await isSuppressed(env, to, 'transactional')) return false;
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) return false;
  try {
    const accessToken = await getGmailAccessToken(env);
    const { subject, html, text } = flaggedScoreEmailContent(recipientName, payload);
    const rawEmail = buildRawEmail(to, subject, html, text, 'Axal Alerts <noreply@axal.vc>');
    const raw = btoa(unescape(encodeURIComponent(rawEmail))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      signal: AbortSignal.timeout(MAIL_FETCH_TIMEOUT_MS),
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}));
      console.error('[EMAIL] flagged-score alert failed:', err);
      return false;
    }
    return true;
  } catch (e: any) {
    console.error(`[EMAIL] flagged-score alert failed for ${to}: ${e?.message || 'Unknown'}`);
    return false;
  }
}

/**
 * Generic transactional sender for the Phase 0.2 notification center.
 * Used by services/notify.ts when a notification's resolved channels
 * include 'email'. Returns false on any failure so callers can swallow.
 */
export async function sendNotificationEmail(
  env: Env,
  to: string,
  subject: string,
  body: string,
  opts?: { html?: string; from?: string },
): Promise<boolean> {
  // D810 — the suppression list, by reason (transactional).
  if (await isSuppressed(env, to, 'transactional')) return false;
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) {
    return false;
  }
  try {
    const accessToken = await getGmailAccessToken(env);
    // Task #33 — callers can supply a pre-rendered HTML body (the
    // Market-Intel digest did, until D670 retired it); the plain-text `body`
    // becomes the multipart/alternative fallback. Without an explicit
    // html opt we keep the legacy single-<p> wrapper so existing
    // notification flows render unchanged.
    const html = opts?.html
      ? opts.html
      : `<p style="font-family:'Space Grotesk',sans-serif;font-size:14px;color:#111;">${escapeHtml(body || subject)}</p>`;
    const rawEmail = buildRawEmail(to, subject, html, body || subject, opts?.from);
    const raw = btoa(unescape(encodeURIComponent(rawEmail))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      signal: AbortSignal.timeout(MAIL_FETCH_TIMEOUT_MS),
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    return res.ok;
  } catch (e: any) {
    console.error('[EMAIL] notification send failed');
    return false;
  }
}

export async function sendVerificationEmail(env: Env, to: string, name: string, verificationUrl: string): Promise<boolean> {
  // D810 — the suppression list, by reason (security).
  if (await isSuppressed(env, to, 'security')) return false;
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) {
    console.error('[EMAIL] Gmail credentials missing');
    return false;
  }
  try {
    const accessToken = await getGmailAccessToken(env);
    const html = buildEmailHTML(name, verificationUrl);
    const text = `Verify your email: ${verificationUrl}`;
    const rawEmail = buildRawEmail(to, 'Verify your email — Axal VC', html, text);
    const raw = btoa(unescape(encodeURIComponent(rawEmail))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      signal: AbortSignal.timeout(MAIL_FETCH_TIMEOUT_MS),
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}));
      console.error('[EMAIL] Gmail send failed:', err);
      return false;
    }
    return true;
  } catch (e: any) {
    console.error(`[EMAIL] Gmail notification failed for ${to}: ${e?.message || 'Unknown error'}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Task #14 — Forward signed PDF to legal partner(s).
// Sends a Gmail multipart email with the signed PDF as an attachment.
// Returns { ok, error } so the caller can log per-recipient status.
// ---------------------------------------------------------------------------
/** The signed-PDF forward's subject, HTML and text for one recipient. Pure, so a test reads exactly what is sent. */
export function signedPdfForwardedEmailContent(
  to: string, documentTitle: string, senderName: string, opts?: { message?: string },
): { subject: string; html: string; text: string; filename: string } {
    const greet = to.split('@')[0];
    const safeTitle = escapeHtml(documentTitle || 'Signed Document');
    const safeSender = escapeHtml(senderName || 'Axal StudioOS');
    const noteBlock = opts?.message
      ? `<tr><td style="padding:0 32px 8px;"><div style="background:#faf5ff;border-left:3px solid #7c3aed;border-radius:8px;padding:14px 16px;color:#4b5563;font-size:14px;line-height:1.55;white-space:pre-wrap;">${escapeHtml(opts.message)}</div></td></tr>`
      : '';
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 20px;">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden;">
<tr><td style="padding:32px 32px 20px;border-bottom:1px solid #f3f4f6;">
  <table cellpadding="0" cellspacing="0"><tr>
    <td style="vertical-align:middle;padding-right:10px;">
      <img src="https://axal.vc/axal-mark.png" alt="Axal VC" width="36" height="36" style="display:block;border:0;border-radius:8px;" />
    </td>
    <td style="vertical-align:middle;">
      <span style="font-size:18px;font-weight:700;color:#111827;letter-spacing:-0.01em;">Axal VC</span>
      <div style="font-size:11px;color:#9ca3af;margin-top:2px;">Legal Forward</div>
    </td>
  </tr></table>
</td></tr>
<tr><td style="padding:28px 32px 0;">
  <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px;letter-spacing:-0.02em;">Signed document forwarded to you</h1>
  <p style="font-size:14px;color:#6b7280;margin:0 0 18px;line-height:1.6;">Hi ${escapeHtml(greet)},</p>
  <p style="font-size:14px;color:#374151;margin:0 0 18px;line-height:1.65;">
    ${safeSender} has forwarded a signed document from the Axal StudioOS legal vault.
    The executed PDF is attached below.
  </p>
</td></tr>
${noteBlock}
<tr><td style="padding:0 32px;">
  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:14px;padding:16px 18px;margin:16px 0;">
    <p style="margin:0 0 4px;color:#6b7280;font-size:13px;">Document:</p>
    <p style="margin:0;color:#111827;font-size:14px;font-weight:600;">${safeTitle}</p>
  </div>
</td></tr>
<tr><td style="padding:0 32px 32px;">
  <p style="font-size:11px;color:#9ca3af;margin:20px 0 0;line-height:1.6;">
    This email was generated from Axal StudioOS — Legal → Signed Documents.
  </p>
</td></tr>
</table></td></tr></table></body></html>`;
    const text = `Hi ${greet},\n\n${safeSender} has forwarded a signed document from Axal StudioOS.\n\nDocument: ${safeTitle}\n${opts?.message ? `\nNote: ${opts.message}\n` : ''}\nThe executed PDF is attached.`;
    return { subject: `Signed document: ${documentTitle}`, html, text, filename: `${safeTitle.replace(/[^a-zA-Z0-9 _-]/g, '')}.pdf` };
}

export async function sendSignedPdfForwardedEmail(
  env: Env,
  to: string,
  documentTitle: string,
  senderName: string,
  pdfBytes: Uint8Array,
  opts?: { message?: string; from?: string },
): Promise<{ ok: boolean; error?: string }> {
  // D810 — the suppression list, by reason (transactional).
  if (await isSuppressed(env, to, 'transactional')) return { ok: false, error: 'suppressed' };
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_REFRESH_TOKEN) {
    return { ok: false, error: 'Gmail not configured on this environment' };
  }
  try {
    const accessToken = await getGmailAccessToken(env);
    const { html, text } = signedPdfForwardedEmailContent(to, documentTitle, senderName, opts);
    const safeTitle = escapeHtml(documentTitle || 'Signed Document');
    const rawEmail = buildRawEmailWithAttachment(
      to,
      `Signed document: ${documentTitle}`,
      html, text,
      opts?.from || 'Axal VC Legal <legal@axal.vc>',
      `${safeTitle.replace(/[^a-zA-Z0-9 _-]/g, '')}.pdf`,
      pdfBytes,
    );
    const raw = btoa(unescape(encodeURIComponent(rawEmail))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      signal: AbortSignal.timeout(MAIL_FETCH_TIMEOUT_MS),
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}));
      return { ok: false, error: err?.error?.message || err?.error || 'Gmail send failed' };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Unknown error' };
  }
}

// ---------------------------------------------------------------------------
// Task #10 — Branded receipt / invoice email.
// Sends an Axal-branded receipt for any successful payment, delivered through
// the existing Gmail sender. For invoice-backed payments the Stripe invoice
// PDF is attached; for non-invoice one-time charges (no PDF exists) we link to
// the Stripe receipt instead. Stripe's own customer emails are disabled (ops
// step) so the buyer only ever sees Axal branding.
// ---------------------------------------------------------------------------
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function formatMoney(amountCents: number, currency: string): string {
  // D5373: Stripe's amount at its currency's own decimals.
  const cur = (currency || 'usd').toUpperCase();
  const amt = plainStripeAmount(Number(amountCents) || 0, cur);
  if (cur === 'USD') return `$${amt}`;
  return `${amt} ${cur}`;
}

export interface BrandedInvoiceOpts {
  to: string;
  name?: string | null;
  amountCents: number;
  currency: string;
  description?: string | null;
  invoiceNumber?: string | null;
  hostedInvoiceUrl?: string | null;
  pdfBytes?: Uint8Array | null;
  paidAt?: Date | null;
  /** D755 (#1914): the legal seller, named in the footer when given. Without it the receipt is unchanged. */
  seller?: string | null;
  /** D755 (#1914) §17: a token-pack order; says when the tokens land and links to Usage › Top-ups. */
  topUp?: { usageUrl: string } | null;
}

export const TOKEN_PACK_EMAIL_NOTE = 'The tokens are added to your top-up balance once Stripe confirms the payment. You will see them in Usage › Top-ups.';

/** The receipt's subject, HTML and text, pure (no Gmail), so a test can read them. */
export function brandedInvoiceContent(opts: BrandedInvoiceOpts): { subject: string; html: string; text: string } {
  const greet = (opts.name && opts.name.trim()) ? opts.name.trim() : (opts.to.split('@')[0] || 'there');
  const safeGreet = escapeHtml(greet);
  const safeAmount = escapeHtml(formatMoney(opts.amountCents, opts.currency));
  const safeDesc = escapeHtml((opts.description && opts.description.trim()) || 'Axal StudioOS');
  const d = opts.paidAt || new Date();
  const dateStr = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  const numberRow = opts.invoiceNumber
    ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Receipt</td><td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;text-align:right;">${escapeHtml(opts.invoiceNumber)}</td></tr>`
    : '';
  const hostedBtn = opts.hostedInvoiceUrl
    ? `<tr><td style="padding:8px 32px 4px;"><a href="${escapeHtml(opts.hostedInvoiceUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 20px;border-radius:10px;">View invoice online</a></td></tr>`
    : '';
  const pdfNote = opts.pdfBytes
    ? `<p style="font-size:13px;color:#6b7280;margin:14px 0 0;line-height:1.6;">Your invoice PDF is attached to this email.</p>`
    : '';
  const seller = opts.seller && opts.seller.trim() ? opts.seller.trim() : null;
  const sellerNote = seller ? `Sold by ${escapeHtml(seller)}. ` : '';
  const topUpNote = opts.topUp
    ? `<p style="font-size:13px;color:#374151;margin:14px 0 0;line-height:1.6;">${escapeHtml(TOKEN_PACK_EMAIL_NOTE)} <a href="${escapeHtml(opts.topUp.usageUrl)}" style="color:#6d28d9;">Open Usage › Top-ups</a></p>`
    : '';
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 20px;">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden;">
<tr><td style="padding:32px 32px 20px;border-bottom:1px solid #f3f4f6;">
  <table cellpadding="0" cellspacing="0"><tr>
    <td style="vertical-align:middle;padding-right:10px;">
      <img src="https://axal.vc/axal-mark.png" alt="Axal VC" width="36" height="36" style="display:block;border:0;border-radius:8px;" />
    </td>
    <td style="vertical-align:middle;">
      <span style="font-size:18px;font-weight:700;color:#111827;letter-spacing:-0.01em;">Axal VC</span>
      <div style="font-size:11px;color:#9ca3af;margin-top:2px;">Receipt</div>
    </td>
  </tr></table>
</td></tr>
<tr><td style="padding:28px 32px 0;">
  <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px;letter-spacing:-0.02em;">Thanks for your payment</h1>
  <p style="font-size:14px;color:#6b7280;margin:0 0 18px;line-height:1.6;">Hi ${safeGreet},</p>
  <p style="font-size:14px;color:#374151;margin:0 0 4px;line-height:1.65;">
    We've received your payment. Here's your receipt for your records.
  </p>
</td></tr>
<tr><td style="padding:0 32px;">
  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:14px;padding:16px 18px;margin:18px 0 4px;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Description</td><td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;text-align:right;">${safeDesc}</td></tr>
      ${numberRow}
      <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Date</td><td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;text-align:right;">${escapeHtml(dateStr)}</td></tr>
      <tr><td style="padding:10px 0 0;color:#111827;font-size:15px;font-weight:700;border-top:1px solid #e5e7eb;">Amount paid</td><td style="padding:10px 0 0;color:#111827;font-size:15px;font-weight:700;text-align:right;border-top:1px solid #e5e7eb;">${safeAmount}</td></tr>
    </table>
  </div>
  ${pdfNote}${topUpNote}
</td></tr>
${hostedBtn}
<tr><td style="padding:8px 32px 32px;">
  <p style="font-size:11px;color:#9ca3af;margin:20px 0 0;line-height:1.6;">
    ${sellerNote}This receipt was sent by Axal StudioOS. If you have any questions about this charge, just reply to this email.
  </p>
</td></tr>
</table></td></tr></table></body></html>`;
  const textLines = [
    `Hi ${greet},`,
    '',
    `We've received your payment. Here's your receipt for your records.`,
    '',
    `Description: ${(opts.description && opts.description.trim()) || 'Axal StudioOS'}`,
    opts.invoiceNumber ? `Receipt: ${opts.invoiceNumber}` : '',
    `Date: ${dateStr}`,
    `Amount paid: ${formatMoney(opts.amountCents, opts.currency)}`,
    '',
    opts.hostedInvoiceUrl ? `View invoice online: ${opts.hostedInvoiceUrl}` : '',
    opts.pdfBytes ? `Your invoice PDF is attached.` : '',
    opts.topUp ? `${TOKEN_PACK_EMAIL_NOTE} ${opts.topUp.usageUrl}` : '',
    seller ? `Sold by ${seller}.` : '',
  ].filter(Boolean);
  const text = textLines.join('\n');
  const subject = `Your Axal receipt${opts.invoiceNumber ? ` — ${opts.invoiceNumber}` : ''}`;
  return { subject, html, text };
}

export async function sendBrandedInvoiceEmail(
  env: Env,
  opts: BrandedInvoiceOpts,
): Promise<{ ok: boolean; error?: string }> {
  // D810 — the suppression list, by reason (transactional).
  if (await isSuppressed(env, opts.to, 'transactional')) return { ok: false, error: 'suppressed' };
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_REFRESH_TOKEN) {
    return { ok: false, error: 'Gmail not configured on this environment' };
  }
  try {
    const accessToken = await getGmailAccessToken(env);
    const { subject, html, text } = brandedInvoiceContent(opts);
    const from = 'Axal VC <billing@axal.vc>';
    const rawEmail = opts.pdfBytes
      ? buildRawEmailWithAttachment(
          opts.to, subject, html, text, from,
          `${(opts.invoiceNumber || 'receipt').replace(/[^a-zA-Z0-9 _-]/g, '')}.pdf`,
          opts.pdfBytes,
        )
      : buildRawEmail(opts.to, subject, html, text, from);
    const raw = btoa(unescape(encodeURIComponent(rawEmail))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      signal: AbortSignal.timeout(MAIL_FETCH_TIMEOUT_MS),
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}));
      return { ok: false, error: err?.error?.message || err?.error || 'Gmail send failed' };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Unknown error' };
  }
}
