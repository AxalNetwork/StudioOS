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

function buildRawEmail(to: string, subject: string, html: string, text: string): string {
  const boundary = `boundary_${crypto.randomUUID().replace(/-/g, '')}`;
  const lines = [
    `To: ${to}`,
    `From: Axal VC <noreply@axal.vc>`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: quoted-printable`,
    ``,
    text,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: quoted-printable`,
    ``,
    html,
    ``,
    `--${boundary}--`,
  ];
  return lines.join('\r\n');
}

async function sendViaGmailAPI(env: Env, to: string, subject: string, html: string, text: string): Promise<void> {
  const accessToken = await getGmailAccessToken(env);
  const raw = buildRawEmail(to, subject, html, text);
  const encoded = btoa(unescape(encodeURIComponent(raw)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: encoded }),
  });

  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    throw new Error(`Gmail API error: ${err?.error?.message || res.statusText}`);
  }
}

export async function sendVerificationEmail(env: Env, toEmail: string, name: string, verificationUrl: string): Promise<boolean> {
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) {
    console.warn(`[EMAIL] Gmail credentials not configured — email to ${toEmail} not sent. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN secrets.`);
    return false;
  }

  try {
    const subject = 'Verify your email — Axal Ventures';
    const html = buildEmailHTML(name, verificationUrl);
    const text = `Hi ${name},\n\nThanks for signing up for Axal Ventures. Please verify your email by visiting this link:\n\n${verificationUrl}\n\nThis link expires in 24 hours.\n\nIf you didn't create an account, you can safely ignore this email.`;

    await sendViaGmailAPI(env, toEmail, subject, html, text);
    console.log(`[EMAIL] Verification email sent to ${toEmail} via Gmail API`);
    return true;
  } catch (e: any) {
    console.error(`[EMAIL] Gmail send failed for ${toEmail}: ${e?.message || 'Unknown error'}`);
    return false;
  }
}

export async function sendNotificationEmail(env: Env, toEmail: string, subject: string, htmlBody: string, textBody: string): Promise<boolean> {
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) {
    console.warn(`[EMAIL] Gmail credentials not configured — notification to ${toEmail} not sent.`);
    return false;
  }

  try {
    await sendViaGmailAPI(env, toEmail, subject, htmlBody, textBody);
    console.log(`[EMAIL] Notification sent to ${toEmail} via Gmail API`);
    return true;
  } catch (e: any) {
    console.error(`[EMAIL] Gmail notification failed for ${toEmail}: ${e?.message || 'Unknown error'}`);
    return false;
  }
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
        <img src="https://axal.vc/axal-logo-mark.png" alt="Axal VC" width="36" height="36" style="display:block;border:0;" />
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
    <a href="${verificationUrl}" style="display:inline-block;background:#7c3aed;color:#ffffff;font-family:'Space Grotesk',sans-serif;font-size:14px;font-weight:600;text-decoration:none;padding:13px 36px;border-radius:10px;letter-spacing:-0.01em;">
      Verify Email Address
    </a>
  </td></tr>
  </table>
</td></tr>
<tr><td style="padding:0 32px 24px;">
  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;">
    <p style="font-size:12px;color:#6b7280;margin:0 0 4px;">Or copy and paste this link into your browser:</p>
    <p style="font-size:12px;color:#7c3aed;margin:0;word-break:break-all;">${verificationUrl}</p>
  </div>
</td></tr>
<tr><td style="padding:0 32px 32px;">
  <p style="font-size:12px;color:#9ca3af;margin:0;line-height:1.5;">
    This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.
  </p>
</td></tr>
<tr><td style="padding:16px 32px;background:#f9fafb;border-top:1px solid #f3f4f6;">
  <p style="font-size:11px;color:#d1d5db;margin:0;text-align:center;">© 2026 Axal Management, LLC · <a href="https://axal.vc" style="color:#d1d5db;text-decoration:none;">axal.vc</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
