import type { Env } from '../types';

async function getGmailAccessToken(env: Env): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
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

function stripHeaderInjection(s: string): string {
  return (s || '').replace(/[\r\n]+/g, ' ').trim();
}

function buildRawEmail(to: string, subject: string, html: string, text: string, from?: string): string {
  const boundary = `boundary_${crypto.randomUUID().replace(/-/g, '')}`;
  const safeTo = stripHeaderInjection(to);
  const safeSubject = stripHeaderInjection(subject);
  const safeFrom = stripHeaderInjection(from || 'Axal VC <noreply@axal.vc>');
  const subjectEncoded = `=?UTF-8?B?${btoa(unescape(encodeURIComponent(safeSubject)))}?=`;
  const lines = [
    `To: ${safeTo}`,
    `From: ${safeFrom}`,
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

function escapeHtml(s: string): string {
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
export async function sendAgreementAssignedEmail(
  env: Env,
  to: string,
  recipientName: string,
  agreementLabel: string,
  signLink: string,
  adminName: string,
): Promise<boolean> {
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) {
    console.error('[EMAIL] Gmail credentials missing — agreement email not sent');
    return false;
  }
  try {
    const accessToken = await getGmailAccessToken(env);
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
    This link is unique to you and expires in 7 days. Every access is logged for compliance.
    Reply to this email if anything looks incorrect — we'll re-issue.
  </p>
</td></tr>
</table></td></tr></table></body></html>`;
    const text = `${greet}\n\n${adminName} has verified your partner profile and assigned your Closing Binder:\n\n  ${agreementLabel}\n\nReview and sign here: ${signLink}\n\nThis link expires in 7 days. Every access is logged.\n\n— Axal Deals`;
    const subject = `Your Closing Binder is ready: ${agreementLabel}`;
    const rawEmail = buildRawEmail(to, subject, html, text, 'Axal Deals <deal@axal.vc>');
    const raw = btoa(unescape(encodeURIComponent(rawEmail))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}));
      console.error('[EMAIL] Agreement email send failed:', err);
      return false;
    }
    return true;
  } catch (e: any) {
    console.error(`[EMAIL] Agreement email failed for ${to}: ${e?.message || 'Unknown error'}`);
    return false;
  }
}

export async function sendReferralInviteEmail(
  env: Env,
  to: string,
  recipientName: string,
  senderName: string,
  link: string,
  code: string,
  personalMessage: string,
): Promise<boolean> {
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) {
    console.error('[EMAIL] Gmail credentials missing — referral invite not sent');
    return false;
  }
  try {
    const accessToken = await getGmailAccessToken(env);
    const html = buildReferralInviteHTML(recipientName, senderName, link, code, personalMessage);
    const noteText = personalMessage ? `\n\n${personalMessage}\n\n` : '\n\n';
    const text = `${recipientName ? `Hi ${recipientName.split(' ')[0]},` : 'Hi,'}\n\n${senderName} invited you to Axal StudioOS — a venture studio that ships funded startups in 30 days.${noteText}Join here: ${link}\nReferral code: ${code}\n`;
    const subject = `${senderName} invited you to Axal StudioOS`;
    const rawEmail = buildRawEmail(to, subject, html, text);
    const raw = btoa(unescape(encodeURIComponent(rawEmail))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
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

// ---------------------------------------------------------------------------
// Epic 5 — Admin alerts when a score is flagged for review (anomaly, hash
// mismatch, or missing signature). Two flavours: real-time per-event, and
// daily digest of unreviewed items older than 24h. Best-effort delivery —
// notifications.ts always also writes an in-app row first.
// ---------------------------------------------------------------------------
interface FlaggedScoreEmailPayload {
  projectName: string;
  snapshotId: number;
  totalScore: number | null;
  flagSummary: string[];
  reviewUrl: string;
  source: 'submit' | 'hash_audit';
}

export async function sendFlaggedScoreEmail(
  env: Env,
  to: string,
  recipientName: string,
  payload: FlaggedScoreEmailPayload,
): Promise<boolean> {
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) return false;
  try {
    const accessToken = await getGmailAccessToken(env);
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
    const rawEmail = buildRawEmail(to, subject, html, text, 'Axal Alerts <noreply@axal.vc>');
    const raw = btoa(unescape(encodeURIComponent(rawEmail))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
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

interface DigestItem {
  snapshot_id: number;
  project_id: number;
  project_name: string;
  total_score: number | null;
  created_at: string;
  flag_summary: string[];
}

export async function sendFlaggedScoreDigestEmail(
  env: Env,
  to: string,
  recipientName: string,
  items: DigestItem[],
  queueUrl: string,
): Promise<boolean> {
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) return false;
  if (items.length === 0) return false;
  try {
    const accessToken = await getGmailAccessToken(env);
    const greet = recipientName ? `Hi ${recipientName.split(' ')[0]},` : 'Hi,';
    const rows = items.slice(0, 30).map(it => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#111827;">
          <div style="font-weight:600;">${escapeHtml(it.project_name)}</div>
          <div style="font-size:11px;color:#9ca3af;">snapshot #${it.snapshot_id} · ${escapeHtml(it.created_at)}</div>
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151;">${it.total_score ?? '?'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:12px;color:#6b7280;">${escapeHtml(it.flag_summary.join(', ') || 'integrity issue')}</td>
      </tr>`).join('');
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 20px;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden;">
<tr><td style="padding:24px 28px;border-bottom:1px solid #f3f4f6;background:#fffbeb;">
  <div style="font-size:11px;color:#92400e;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Daily digest</div>
  <div style="font-size:18px;color:#111827;font-weight:700;margin-top:4px;">${items.length} flagged score${items.length === 1 ? '' : 's'} still awaiting review</div>
</td></tr>
<tr><td style="padding:20px 28px;">
  <p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.6;">${greet}</p>
  <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.6;">
    The items below have been sitting in the review queue for more than 24 hours.
    None are visible to LPs or partners until you approve or reject them.
  </p>
  <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:10px;border-collapse:separate;">
    <thead><tr style="background:#f9fafb;">
      <th align="left" style="padding:10px 12px;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;">Project</th>
      <th align="left" style="padding:10px 12px;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;">Score</th>
      <th align="left" style="padding:10px 12px;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;">Flags</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:18px 0 4px;">
    <a href="${queueUrl}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:12px;">Open review queue</a>
  </td></tr></table>
</td></tr>
</table></td></tr></table></body></html>`;
    const text = `${greet}\n\n${items.length} flagged scores still awaiting review (>24h):\n\n` +
      items.slice(0, 30).map(it =>
        `• ${it.project_name} — snapshot #${it.snapshot_id}, score ${it.total_score ?? '?'} (${it.flag_summary.join(', ') || 'integrity issue'})`
      ).join('\n') + `\n\nReview queue: ${queueUrl}\n`;
    const subject = `[Axal] ${items.length} flagged score${items.length === 1 ? '' : 's'} awaiting review`;
    const rawEmail = buildRawEmail(to, subject, html, text, 'Axal Alerts <noreply@axal.vc>');
    const raw = btoa(unescape(encodeURIComponent(rawEmail))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}));
      console.error('[EMAIL] flagged-score digest failed:', err);
      return false;
    }
    return true;
  } catch (e: any) {
    console.error(`[EMAIL] flagged-score digest failed for ${to}: ${e?.message || 'Unknown'}`);
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
): Promise<boolean> {
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) {
    return false;
  }
  try {
    const accessToken = await getGmailAccessToken(env);
    const safeBody = escapeHtml(body || subject);
    const html = `<p style="font-family:'Space Grotesk',sans-serif;font-size:14px;color:#111;">${safeBody}</p>`;
    const rawEmail = buildRawEmail(to, subject, html, body || subject);
    const raw = btoa(unescape(encodeURIComponent(rawEmail))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    return res.ok;
  } catch (e: any) {
    console.error(`[EMAIL] notification send failed for ${to}: ${e?.message || 'unknown'}`);
    return false;
  }
}

export async function sendVerificationEmail(env: Env, to: string, name: string, verificationUrl: string): Promise<boolean> {
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
