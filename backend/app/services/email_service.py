import os
import base64
import secrets
import hashlib
from datetime import datetime, timedelta
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")
GOOGLE_REDIRECT_URI = os.environ.get("GOOGLE_REDIRECT_URI", "https://developers.google.com/oauthplayground")
GOOGLE_REFRESH_TOKEN = os.environ.get("GOOGLE_REFRESH_TOKEN")
GMAIL_SENDER_EMAIL = os.environ.get("GMAIL_SENDER_EMAIL")


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


def _is_gmail_configured() -> bool:
    return all([GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GMAIL_SENDER_EMAIL])


def _get_gmail_service():
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    creds = Credentials(
        token=None,
        refresh_token=GOOGLE_REFRESH_TOKEN,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        scopes=["https://www.googleapis.com/auth/gmail.send"],
    )

    service = build("gmail", "v1", credentials=creds)
    return service


def send_verification_email(to_email: str, name: str, verification_url: str) -> bool:
    if _is_gmail_configured():
        return _send_via_gmail(to_email, name, verification_url)
    else:
        print(f"\n{'='*60}")
        print(f"EMAIL VERIFICATION LINK (no email provider configured)")
        print(f"To: {to_email}")
        print(f"Name: {name}")
        print(f"Link: {verification_url}")
        print(f"{'='*60}\n")
        return False


def _send_via_gmail(to_email: str, name: str, verification_url: str) -> bool:
    try:
        service = _get_gmail_service()

        message = MIMEMultipart("alternative")
        message["to"] = to_email
        message["from"] = f"Axal Ventures <{GMAIL_SENDER_EMAIL}>"
        message["subject"] = "Verify your email — Axal Ventures"

        plain_text = (
            f"Hi {name},\n\n"
            f"Thanks for signing up for Axal Ventures. "
            f"Please verify your email by visiting this link:\n\n"
            f"{verification_url}\n\n"
            f"This link expires in 24 hours.\n\n"
            f"If you didn't create an account, you can safely ignore this email."
        )
        html_content = _build_email_html(name, verification_url)

        message.attach(MIMEText(plain_text, "plain"))
        message.attach(MIMEText(html_content, "html"))

        raw_message = base64.urlsafe_b64encode(message.as_bytes()).decode("utf-8")

        service.users().messages().send(
            userId="me",
            body={"raw": raw_message}
        ).execute()

        return True
    except Exception as e:
        print(f"Gmail API error: {e}")
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
