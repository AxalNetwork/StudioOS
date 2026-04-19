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

function buildRawEmail(to: string, subject: string, html: string, text: string): string {
  const boundary = `boundary_${crypto.randomUUID().replace(/-/g, '')}`;
  const safeTo = stripHeaderInjection(to);
  const safeSubject = stripHeaderInjection(subject);
  const subjectEncoded = `=?UTF-8?B?${btoa(unescape(encodeURIComponent(safeSubject)))}?=`;
  const lines = [
    `To: ${safeTo}`,
    `From: Axal VC <noreply@axal.vc>`,
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
