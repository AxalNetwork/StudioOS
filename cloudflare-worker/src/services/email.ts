import { Resend } from 'resend';
import type { Env } from '../types';

export async function sendVerificationEmail(env: Env, toEmail: string, name: string, verificationUrl: string): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    console.log(`[EMAIL] Verification link for ${toEmail}: ${verificationUrl}`);
    return true;
  }

  try {
    const resend = new Resend(env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'Axal Ventures <noreply@axal.vc>',
      to: [toEmail],
      subject: 'Verify your email — Axal Ventures',
      html: buildEmailHTML(name, verificationUrl),
      text: `Hi ${name},\n\nThanks for signing up for Axal Ventures. Please verify your email by visiting this link:\n\n${verificationUrl}\n\nThis link expires in 24 hours.\n\nIf you didn't create an account, you can safely ignore this email.`,
    });
    return true;
  } catch (e) {
    console.error('Resend email error:', e);
    return false;
  }
}

function buildEmailHTML(name: string, verificationUrl: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 20px;">
<tr><td align="center">
<table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden;">
<tr><td style="padding:32px 32px 0;">
  <div style="font-size:20px;font-weight:700;color:#7c3aed;margin-bottom:24px;">&#9889; AXAL Ventures</div>
  <div style="width:100%;height:3px;background:linear-gradient(90deg,#7c3aed 50%,#e5e7eb 50%);border-radius:2px;margin-bottom:24px;"></div>
  <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px;">Verify Your Email</h1>
  <p style="font-size:14px;color:#6b7280;margin:0 0 24px;line-height:1.6;">
    Hi ${name}, thanks for signing up for Axal Ventures. Please verify your email address to continue setting up your account.
  </p>
</td></tr>
<tr><td style="padding:0 32px;">
  <table width="100%" cellpadding="0" cellspacing="0">
  <tr><td align="center" style="padding:8px 0 24px;">
    <a href="${verificationUrl}" style="display:inline-block;background:#7c3aed;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 32px;border-radius:8px;">
      Verify Email Address
    </a>
  </td></tr>
  </table>
</td></tr>
<tr><td style="padding:0 32px 24px;">
  <div style="background:#f3f4f6;border-radius:8px;padding:16px;">
    <p style="font-size:12px;color:#6b7280;margin:0 0 4px;">Or copy and paste this link into your browser:</p>
    <p style="font-size:12px;color:#7c3aed;margin:0;word-break:break-all;">${verificationUrl}</p>
  </div>
</td></tr>
<tr><td style="padding:0 32px 32px;">
  <p style="font-size:12px;color:#9ca3af;margin:0;line-height:1.5;">
    This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.
  </p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
