"""Gmail SMTP helper for sending transactional emails with PDF attachments.

Uses an App Password (not OAuth) — much simpler for single-account transactional
sending. Configure via env vars:

    GMAIL_USERNAME     = real Google login (e.g. darren@yourdomain.com)
    GMAIL_APP_PASSWORD = 16-char Google App Password
    GMAIL_FROM_EMAIL   = address to show in From: (can be a verified alias)
    GMAIL_FROM_NAME    = display name (optional)
"""
import os
import ssl
import smtplib
from email.message import EmailMessage
from email.utils import make_msgid, formataddr, formatdate
from typing import List, Optional


SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587  # STARTTLS


class EmailNotConfigured(RuntimeError):
    """Raised when required Gmail env vars are missing."""


def _config():
    username = os.environ.get("GMAIL_USERNAME", "").strip()
    password = os.environ.get("GMAIL_APP_PASSWORD", "").strip()
    if not username or not password:
        raise EmailNotConfigured("GMAIL_USERNAME and GMAIL_APP_PASSWORD must be set in backend/.env")
    from_email = os.environ.get("GMAIL_FROM_EMAIL", "").strip() or username
    from_name = os.environ.get("GMAIL_FROM_NAME", "").strip()
    return username, password, from_email, from_name


def get_from_aliases() -> list:
    """Return the list of allowed FROM addresses for this Gmail account.
    Always includes the auth username + default FROM at minimum, then any extras
    from `GMAIL_FROM_ALIASES` (comma-separated)."""
    username = os.environ.get("GMAIL_USERNAME", "").strip()
    default_from = os.environ.get("GMAIL_FROM_EMAIL", "").strip() or username
    extras = os.environ.get("GMAIL_FROM_ALIASES", "")
    out = []
    for v in [default_from, username, *[x.strip() for x in extras.split(",")]]:
        v = v.strip()
        if v and v not in out:
            out.append(v)
    return out


def send_email(
    to: str,
    subject: str,
    body_text: str,
    body_html: Optional[str] = None,
    cc: Optional[str] = None,
    attachments: Optional[List[dict]] = None,
    reply_to: Optional[str] = None,
    from_email: Optional[str] = None,
) -> dict:
    """Send an email via Gmail SMTP.

    attachments: list of dicts like {"filename": "invoice.pdf", "data": bytes, "mime": "application/pdf"}
    from_email: optional override; must be an allowed alias from `GMAIL_FROM_ALIASES`.
    Returns: {"ok": True, "to": ..., "cc": ..., "message_id": ...}
    """
    username, password, default_from, from_name = _config()
    # Apply alias override if provided and whitelisted
    if from_email:
        allowed = get_from_aliases()
        if from_email.strip() not in allowed:
            raise ValueError(f"FROM address '{from_email}' is not in GMAIL_FROM_ALIASES whitelist")
        from_email = from_email.strip()
    else:
        from_email = default_from

    if not to or not to.strip():
        raise ValueError("Recipient email is required")

    msg = EmailMessage()
    msg["From"] = formataddr((from_name, from_email)) if from_name else from_email
    msg["To"] = to.strip()
    if cc and cc.strip():
        msg["Cc"] = cc.strip()
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain=from_email.split("@")[-1] if "@" in from_email else "sealtech.local")
    if reply_to:
        msg["Reply-To"] = reply_to

    msg.set_content(body_text or " ")
    if body_html:
        msg.add_alternative(body_html, subtype="html")

    for att in attachments or []:
        data = att.get("data")
        if not data:
            continue
        filename = att.get("filename", "attachment.bin")
        mime = att.get("mime", "application/octet-stream")
        maintype, _, subtype = mime.partition("/")
        if not subtype:
            maintype, subtype = "application", "octet-stream"
        msg.add_attachment(data, maintype=maintype, subtype=subtype, filename=filename)

    # Build recipient list (To + Cc) for the actual SMTP envelope
    rcpts = [to.strip()]
    if cc and cc.strip():
        rcpts.append(cc.strip())

    ctx = ssl.create_default_context()
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as server:
        server.ehlo()
        server.starttls(context=ctx)
        server.ehlo()
        server.login(username, password)
        server.send_message(msg, from_addr=from_email, to_addrs=rcpts)

    return {
        "ok": True,
        "to": to.strip(),
        "cc": cc.strip() if cc else "",
        "message_id": msg["Message-ID"],
    }
