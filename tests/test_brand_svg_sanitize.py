"""Task #33 — parity coverage for the FastAPI logo-SVG sanitizer (_sanitize_svg).

Mirror of cloudflare-worker/test/brand_svg_sanitize.test.ts. Founder-supplied
`logo_svg` is rendered raw into the public landing page (a stored-XSS sink), so
backend/app/api/routes/brand.py::_sanitize_svg strips the dangerous constructs
at the write boundary. This locks the dev-side guarantee so the two
implementations (Worker + FastAPI) can't silently drift apart.

"Neutralized" = the sanitizer either strips the dangerous token OR drops the
whole SVG (returns None/empty). Both outcomes are safe, so every assertion
accepts either — mirroring the sanitizer's own strip-then-drop logic.

Auto-discovered by pytest (the backend suite has no explicit gate list).
"""
from __future__ import annotations

from backend.app.api.routes.brand import _sanitize_svg


def _neutralized(result, *tokens):
    for t in tokens:
        assert result is None or t.lower() not in result.lower(), (
            f"expected {t!r} to be neutralized, got: {result!r}"
        )


def test_strips_script_tags():
    r = _sanitize_svg(
        '<svg xmlns="http://www.w3.org/2000/svg">'
        "<script>alert('xss')</script>"
        '<path d="M0 0"/></svg>'
    )
    _neutralized(r, "<script", "script", "alert('xss')")
    assert r and "<path" in r


def test_strips_event_handler_attributes():
    r = _sanitize_svg(
        '<svg onload="alert(1)"><rect onclick="steal()"/>'
        '<path onmouseover="x=1" d="M0 0"/></svg>'
    )
    _neutralized(r, "onload", "onclick", "onmouseover", "alert(1)", "steal()")


def test_strips_javascript_urls():
    r = _sanitize_svg(
        '<svg><a href="javascript:alert(document.cookie)">'
        '<path d="M0 0"/></a></svg>'
    )
    _neutralized(r, "javascript:", "alert(document.cookie)")


def test_strips_foreign_object():
    r = _sanitize_svg(
        '<svg><foreignObject><body xmlns="http://www.w3.org/1999/xhtml">'
        "<script>alert(1)</script>"
        '</body></foreignObject><path d="M0 0"/></svg>'
    )
    _neutralized(r, "foreignObject", "<script", "alert(1)")


def test_strips_external_references():
    r1 = _sanitize_svg('<svg><a href="https://evil.example/steal"><path d="M0 0"/></a></svg>')
    _neutralized(r1, "href", "https://evil.example")
    r2 = _sanitize_svg('<svg><path xlink:href="http://evil.example/x" d="M0 0"/></svg>')
    _neutralized(r2, "xlink:href", "href", "http://evil.example")


def test_neutralizes_obfuscated_nested_payloads():
    r = _sanitize_svg('<svg><scr<script>ipt>alert(1)</script><path d="M0 0"/></svg>')
    _neutralized(r, "<script", "javascript:", "onload", "onerror")


def test_returns_empty_or_none_for_non_svg_or_empty():
    assert _sanitize_svg("<div>hi</div>") is None
    assert _sanitize_svg("<img src=x onerror=alert(1)>") is None
    assert _sanitize_svg("just text") is None
    assert not _sanitize_svg("")          # '' passes through as falsy (empty)
    assert _sanitize_svg(None) is None


def test_preserves_benign_svg_unchanged():
    benign = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" '
        'width="200" height="200">'
        '<circle cx="50" cy="50" r="46" fill="#7c3aed"/>'
        '<path d="M10 10 H 90 V 90 H 10 Z" fill="#fff"/></svg>'
    )
    assert _sanitize_svg(benign) == benign
