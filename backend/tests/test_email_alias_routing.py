"""Smoke tests for per-document-type email alias routing.

We don't actually call Gmail SMTP — we verify:
1. The 5 expected aliases are whitelisted in `get_from_aliases()` after .env
2. `/api/email-aliases` returns the correct per-doc-type defaults
"""
import os
import requests
from pathlib import Path

ENV = Path("/app/frontend/.env").read_text()
BASE_URL = next((ln.split("=", 1)[1].strip().rstrip("/") for ln in ENV.splitlines() if ln.startswith("REACT_APP_BACKEND_URL=")), "")


def _login():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "admin@roofingcrm.com", "password": "admin123"},
        timeout=10,
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def test_email_aliases_endpoint_returns_per_doc_defaults():
    tok = _login()
    r = requests.get(f"{BASE_URL}/api/email-aliases", headers={"Authorization": f"Bearer {tok}"}, timeout=10)
    assert r.status_code == 200
    data = r.json()

    aliases = data["aliases"]
    for addr in [
        "finance@sealtechsolutions.co",
        "scope@sealtechsolutions.co",
        "assessments@sealtechsolutions.co",
    ]:
        assert addr in aliases, f"Missing alias: {addr}"

    d = data["defaults"]
    assert d["invoice"] == "finance@sealtechsolutions.co"
    assert d["statement"] == "finance@sealtechsolutions.co"
    assert d["po"] == "finance@sealtechsolutions.co"
    assert d["scope"] == "scope@sealtechsolutions.co"
    assert d["assessment"] == "assessments@sealtechsolutions.co"


def test_get_from_aliases_helper_returns_all_five():
    """Direct check of the helper used by send_email's whitelist validation."""
    import sys
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env", override=True)
    sys.path.insert(0, "/app/backend")
    from email_sender import get_from_aliases
    aliases = get_from_aliases()
    for addr in [
        "finance@sealtechsolutions.co",
        "scope@sealtechsolutions.co",
        "assessments@sealtechsolutions.co",
        "projects@sealtechsolutions.co",
        "darren@sealtechsolutions.co",
    ]:
        assert addr in aliases, f"{addr} not whitelisted"
