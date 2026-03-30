import os
import secrets
import hashlib
from datetime import datetime, timedelta

RESEND_API_KEY = os.environ.get("RESEND_API_KEY")
FROM_EMAIL = os.environ.get("FROM_EMAIL", "noreply@axalventures.com")


def generate_verification_token():
    raw_token = secrets.token_urlsafe(48)
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    expires = datetime.utcnow() + timedelta(hours=24)
    return raw_token, token_hash, expires


def hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode()).hexdigest()


def get_verification_url(raw_token: str) -> str:
    domain = os.environ.get("REPLIT_DEV_DOMAIN", "")
    if domain:
        base_url = f"https://{domain}"
    else:
        base_url = os.environ.get("APP_URL", "http://localhost:5000")
    return f"{base_url}/verify-email?token={raw_token}"


def send_verification_email(to_email: str, name: str, verification_url: str) -> bool:
    if RESEND_API_KEY:
        return _send_via_resend(to_email, name, verification_url)
    else:
        print(f"\n{'='*60}")
        print(f"EMAIL VERIFICATION LINK (no email provider configured)")
        print(f"To: {to_email}")
        print(f"Name: {name}")
        print(f"Link: {verification_url}")
        print(f"{'='*60}\n")
        return True


def _send_via_resend(to_email: str, name: str, verification_url: str) -> bool:
    try:
        import httpx
        response = httpx.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "from": FROM_EMAIL,
                "to": [to_email],
                "subject": "Verify your email — Axal Ventures",
                "html": _build_email_html(name, verification_url),
            },
            timeout=10.0,
        )
        if response.status_code in (200, 201):
            return True
        else:
            print(f"Resend API error: {response.status_code} {response.text}")
            return False
    except Exception as e:
        print(f"Email sending failed: {e}")
        return False


def _build_email_html(name: str, verification_url: str) -> str:
    return f"""<!DOCTYPE html>
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
    Hi {name}, thanks for signing up for Axal Ventures. Please verify your email address to continue setting up your account.
  </p>
</td></tr>
<tr><td style="padding:0 32px;">
  <table width="100%" cellpadding="0" cellspacing="0">
  <tr><td align="center" style="padding:8px 0 24px;">
    <a href="{verification_url}" style="display:inline-block;background:#7c3aed;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 32px;border-radius:8px;">
      Verify Email Address
    </a>
  </td></tr>
  </table>
</td></tr>
<tr><td style="padding:0 32px 24px;">
  <div style="background:#f3f4f6;border-radius:8px;padding:16px;">
    <p style="font-size:12px;color:#6b7280;margin:0 0 4px;">Or copy and paste this link into your browser:</p>
    <p style="font-size:12px;color:#7c3aed;margin:0;word-break:break-all;">{verification_url}</p>
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
</html>"""
