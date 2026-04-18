import os
import time
import base64
import secrets
import hashlib
import logging
from collections import defaultdict, deque
from pathlib import Path
from datetime import datetime, timedelta
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional, List, Tuple, Dict

logger = logging.getLogger("studioos.email")

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")
GOOGLE_REDIRECT_URI = os.environ.get("GOOGLE_REDIRECT_URI", "https://developers.google.com/oauthplayground")
GOOGLE_REFRESH_TOKEN = os.environ.get("GOOGLE_REFRESH_TOKEN")
GMAIL_SENDER_EMAIL = os.environ.get("GMAIL_SENDER_EMAIL") or os.environ.get("GMAIL_EMAIL")

# Per-user sliding-window rate limit: 20 emails / 60s. Gmail's per-account
# sending cap is ~500/day for consumer accounts; this leaves headroom and
# protects us from accidental loops when a partner uploads a huge CSV.
_RATE_LIMIT_WINDOW_SEC = 60
# Gmail consumer accounts allow ~500 sends/day; we cap per-user-per-minute at
# 100 so a single bulk invite (max 100 contacts/request) goes through in one
# call without rate-limiting itself, while still preventing runaway loops.
_RATE_LIMIT_MAX = 100
_send_log: Dict[int, deque] = defaultdict(deque)


def _check_send_rate_limit(user_id: Optional[int], n: int = 1) -> Tuple[bool, int]:
    """Returns (allowed, remaining_in_window). If user_id is None, no limit."""
    if user_id is None:
        return True, _RATE_LIMIT_MAX
    now = time.time()
    q = _send_log[user_id]
    cutoff = now - _RATE_LIMIT_WINDOW_SEC
    while q and q[0] < cutoff:
        q.popleft()
    if len(q) + n > _RATE_LIMIT_MAX:
        return False, max(0, _RATE_LIMIT_MAX - len(q))
    for _ in range(n):
        q.append(now)
    return True, _RATE_LIMIT_MAX - len(q)


_TEMPLATE_DIR = Path(__file__).resolve().parents[3] / "email_templates"


def _load_template(name: str) -> str:
    path = _TEMPLATE_DIR / name
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        logger.warning("Email template missing: %s", path)
        return ""


def _unsubscribe_url(email: str) -> str:
    domain = os.environ.get("REPLIT_DEV_DOMAIN", "")
    base = f"https://{domain}" if domain else os.environ.get("APP_URL", "https://axal.vc")
    # Token-less opt-out is acceptable here: it's a documented no-op endpoint
    # the unsubscribe lands on; full preference center is a follow-up.
    from urllib.parse import quote
    return f"{base}/api/unsubscribe?email={quote(email)}"


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
    html_content = _build_email_html(name, verification_url)
    plain_text = (
        f"Hi {name},\n\n"
        f"Thanks for signing up for Axal Ventures. "
        f"Please verify your email by visiting this link:\n\n"
        f"{verification_url}\n\n"
        f"This link expires in 24 hours.\n\n"
        f"If you didn't create an account, you can safely ignore this email."
    )
    return _send_html_email(
        to_email=to_email,
        subject="Verify your email — Axal Ventures",
        html_body=html_content,
        plain_text=plain_text,
        sender_label="Axal Ventures",
    )


def _send_html_email(
    to_email: str,
    subject: str,
    html_body: str,
    plain_text: Optional[str] = None,
    sender_label: str = "Axal Ventures",
    reply_to: Optional[str] = None,
) -> bool:
    """Low-level Gmail API send. Returns True on success, False on failure
    (logged). Caller is responsible for rate-limit and activity-log."""
    if not _is_gmail_configured():
        logger.warning("Gmail not configured; would have sent to %s subject=%r", to_email, subject)
        return False
    try:
        service = _get_gmail_service()
        message = MIMEMultipart("alternative")
        message["to"] = to_email
        message["from"] = f"{sender_label} <{GMAIL_SENDER_EMAIL}>"
        message["subject"] = subject
        if reply_to:
            message["reply-to"] = reply_to
        if plain_text:
            message.attach(MIMEText(plain_text, "plain"))
        message.attach(MIMEText(html_body, "html"))
        raw = base64.urlsafe_b64encode(message.as_bytes()).decode("utf-8")
        service.users().messages().send(userId="me", body={"raw": raw}).execute()
        return True
    except Exception as e:
        logger.exception("Gmail send failed to=%s subject=%r err=%s", to_email, subject, e)
        return False


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------

def send_deal_email(
    to_list: List[str],
    subject: str,
    html_body: str,
    plain_body: Optional[str] = None,
    sender_label: str = "Axal Deals",
    actor_user_id: Optional[int] = None,
    cta_url: Optional[str] = None,
    cta_label: str = "View deal",
) -> Dict:
    """Send a branded deal notification to one or many recipients. Returns
    {sent, failed:[{email,error}], rate_limited:bool}. Each recipient counts
    toward the per-user rate limit."""
    recipients = [e.strip() for e in to_list if e and "@" in e]
    if not recipients:
        return {"sent": 0, "failed": [], "rate_limited": False, "reason": "no_valid_recipients"}

    allowed, remaining = _check_send_rate_limit(actor_user_id, n=len(recipients))
    if not allowed:
        return {
            "sent": 0, "failed": [], "rate_limited": True,
            "reason": f"rate_limit: max {_RATE_LIMIT_MAX}/min, {remaining} remaining in window",
        }

    template = _load_template("deal_notification.html")
    if cta_url:
        cta_block = (
            '<tr><td style="padding:8px 32px 24px;">'
            '<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 16px;">'
            f'<a href="{cta_url}" style="display:inline-block;background:#7c3aed;color:#ffffff;font-size:14px;'
            f'font-weight:600;text-decoration:none;padding:12px 32px;border-radius:8px;">{cta_label}</a>'
            '</td></tr></table></td></tr>'
        )
    else:
        cta_block = ""

    sent = 0
    failed: List[Dict[str, str]] = []
    for to_email in recipients:
        rendered = (template
                    .replace("{{subject}}", subject)
                    .replace("{{body}}", html_body)
                    .replace("{{cta_block}}", cta_block)
                    .replace("{{unsubscribe_url}}", _unsubscribe_url(to_email)))
        ok = _send_html_email(
            to_email=to_email,
            subject=subject,
            html_body=rendered or html_body,
            plain_text=plain_body or _strip_html(html_body),
            sender_label=sender_label,
        )
        if ok:
            sent += 1
        else:
            failed.append({"email": to_email, "error": "send_failed"})
    return {"sent": sent, "failed": failed, "rate_limited": False}


def send_referral_invite(
    to_email: str,
    to_name: Optional[str],
    referrer_name: str,
    referral_code: str,
    referral_link: str,
    custom_message: Optional[str] = None,
    sender_label: str = "Axal Network",
    actor_user_id: Optional[int] = None,
    reply_to: Optional[str] = None,
) -> bool:
    """Send a single branded referral invite. Returns True on success.
    Caller is responsible for batching + activity logging."""
    if not to_email or "@" not in to_email:
        return False
    allowed, _ = _check_send_rate_limit(actor_user_id, n=1)
    if not allowed:
        return False

    template = _load_template("referral_invite.html")
    msg = (custom_message or
           f"I've been working with the Axal team and thought you'd find it interesting. "
           f"Sign up with my code and we both benefit when you hit milestones.")
    rendered = (template
                .replace("{{referrer_name}}", referrer_name or "A friend")
                .replace("{{referral_link}}", referral_link)
                .replace("{{referral_code}}", referral_code)
                .replace("{{custom_message}}", _escape_html(msg))
                .replace("{{unsubscribe_url}}", _unsubscribe_url(to_email)))
    plain = (
        f"Hi{(' ' + to_name) if to_name else ''},\n\n"
        f"{msg}\n\n"
        f"Join here: {referral_link}\n"
        f"Referral code: {referral_code}\n\n"
        f"— {referrer_name}\n"
        f"(Sent via Axal Network — opt out: {_unsubscribe_url(to_email)})"
    )
    subject = f"{referrer_name} invited you to Axal"
    return _send_html_email(
        to_email=to_email,
        subject=subject,
        html_body=rendered or plain.replace("\n", "<br>"),
        plain_text=plain,
        sender_label=sender_label,
        reply_to=reply_to,
    )


def _escape_html(s: str) -> str:
    return (s.replace("&", "&amp;")
             .replace("<", "&lt;")
             .replace(">", "&gt;")
             .replace("\n", "<br>"))


def _strip_html(s: str) -> str:
    import re
    return re.sub(r"<[^>]+>", "", s or "").strip()


def is_email_configured() -> bool:
    """Public accessor so routes can return a useful 'not configured' error."""
    return _is_gmail_configured()


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
