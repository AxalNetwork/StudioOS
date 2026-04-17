async function getGmailAccessToken(env) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`OAuth failed: ${data.error_description || data.error}`);
  if (!data.access_token) throw new Error('No access_token returned');
  return data.access_token;
}

function buildRawEmail(to, from, subject, html, text) {
  const boundary = `boundary_${Math.random().toString(36).slice(2)}`;
  const lines = [
    `To: ${to}`,
    `From: ${from}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    text,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    ``,
    html,
    ``,
    `--${boundary}--`,
  ];
  return lines.join('\r\n');
}

async function sendGmailEmail(env, to, subject, html, text) {
  const accessToken = await getGmailAccessToken(env);
  const raw = buildRawEmail(
    to,
    `Axal VC <noreply@axal.vc>`,
    subject,
    html,
    text
  );
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
    const err = await res.json().catch(() => ({}));
    throw new Error(`Gmail API error: ${err?.error?.message || res.statusText}`);
  }
}

async function sendVerificationEmail(env, toEmail, name, verificationUrl) {
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) {
    console.warn('[EMAIL] Gmail credentials not configured');
    return false;
  }
  const subject = 'Verify your email — Axal VC';
  const text = `Hi ${name},\n\nPlease verify your email:\n\n${verificationUrl}\n\nThis link expires in 24 hours.`;
  const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f9fafb;padding:40px 20px;">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;border:1px solid #e5e7eb;padding:32px;">
  <div style="font-size:20px;font-weight:700;color:#7c3aed;margin-bottom:16px;">⚡ AXAL Ventures</div>
  <h1 style="font-size:22px;color:#111827;margin:0 0 8px;">Verify Your Email</h1>
  <p style="color:#6b7280;margin:0 0 24px;">Hi ${name}, please verify your email address to continue.</p>
  <a href="${verificationUrl}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">Verify Email Address</a>
  <p style="color:#9ca3af;font-size:12px;margin-top:24px;">This link expires in 24 hours. If you didn't sign up, you can ignore this email.</p>
  <p style="color:#9ca3af;font-size:12px;word-break:break-all;">${verificationUrl}</p>
</div>
</body></html>`;
  try {
    await sendGmailEmail(env, toEmail, subject, html, text);
    console.log(`[EMAIL] Sent verification to ${toEmail}`);
    return true;
  } catch (e) {
    console.error(`[EMAIL] Failed for ${toEmail}: ${e?.message}`);
    return false;
  }
}

export default {
  async email(message, env, ctx) {
    console.log(`From: ${message.from}`);
    console.log(`To: ${message.to}`);
    console.log(`Subject: ${message.headers.get('subject') || ''}`);
    const body = await message.text();
    console.log(body);
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/register') {
      try {
        const { email, name, verificationUrl } = await request.json();
        if (!email || !name || !verificationUrl) {
          return Response.json({ error: 'email, name, and verificationUrl are required' }, { status: 400 });
        }
        const sent = await sendVerificationEmail(env, email, name, verificationUrl);
        return Response.json({ success: true, email_sent: sent });
      } catch (e) {
        return Response.json({ error: e?.message || 'Unknown error' }, { status: 500 });
      }
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({
        status: 'ok',
        gmail: !!(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN),
      });
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  },
};
