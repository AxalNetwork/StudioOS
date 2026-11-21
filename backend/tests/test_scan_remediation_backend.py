"""Code Scanning remediation, dev FastAPI (log injection, path injection, partial SSRF, ReDoS, XSS, stack traces)."""
import os
import time

import pytest

from backend.app.services.log_safe import log_safe


def test_log_safe_keeps_one_line():
    assert log_safe("a\r\nINFO forged") == "aINFO forged"
    assert len(log_safe("x" * 900)) == 500
    assert log_safe(None) == "None"


def test_a_storage_key_cannot_leave_its_bucket():
    from backend.app.services.file_storage import R2Storage
    store = R2Storage.__new__(R2Storage)
    for key in ["../other-bucket/x", "a/../../b", "a//b", "", "./a", "a/."]:
        with pytest.raises(ValueError):
            store._sign("GET", key, b"")


def test_a_headshot_name_stays_in_its_folder():
    from backend.app.api.routes.settings import _HEADSHOT_DIR, _headshot_path
    assert os.path.dirname(str(_headshot_path("7_abc.png"))) == os.path.realpath(_HEADSHOT_DIR)
    for bad in ["../7.png", "a/b.png", "/etc/passwd"]:
        with pytest.raises(ValueError):
            _headshot_path(bad)


def test_strip_html_is_linear_on_a_run_of_angle_brackets():
    from backend.app.services.email_service import _strip_html
    assert _strip_html("<p>Hello <b>there</b></p>") == "Hello there"
    t = time.perf_counter()
    _strip_html("<" * 50000)
    assert time.perf_counter() - t < 1.0
