"""Task #8 — invoice PDF generation for cart orders.

Uses reportlab when available; otherwise emits a minimal but valid PDF by hand
(single page, Helvetica text lines). Both paths return raw PDF bytes suitable
for `application/pdf` download.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List

logger = logging.getLogger("studioos.invoice_pdf")


def _fmt_money(cents: int, currency: str) -> str:
    return f"{currency.upper()} {cents / 100:,.2f}"


def _invoice_lines(order: Dict[str, Any]) -> List[str]:
    currency = order.get("currency", "usd")
    lines: List[str] = []
    lines.append("AXAL VENTURES — INVOICE")
    lines.append("")
    lines.append(f"Invoice: {order.get('invoice_number') or order.get('order_ref')}")
    lines.append(f"Order Ref: {order.get('order_ref')}")
    lines.append(f"Status: {order.get('status')}")
    lines.append(f"Date: {order.get('created_at')}")
    if order.get("paid_at"):
        lines.append(f"Paid: {order.get('paid_at')}")
    lines.append("")
    lines.append("Items")
    lines.append("-" * 60)
    for it in order.get("items", []):
        name = it.get("name") or it.get("product_id") or it.get("price_id")
        qty = it.get("quantity", 1)
        unit = _fmt_money(it.get("unit_amount", 0), currency)
        line_total = _fmt_money(it.get("line_total", 0), currency)
        lines.append(f"{name}  x{qty}  @ {unit}   = {line_total}")
    lines.append("-" * 60)
    lines.append(f"Subtotal:  {_fmt_money(order.get('subtotal', 0), currency)}")
    if order.get("promo_code"):
        lines.append(f"Promo ({order['promo_code']}): -{_fmt_money(order.get('discount_cents', 0), currency)}")
    lines.append(f"VAT:       {_fmt_money(order.get('vat_cents', 0), currency)}")
    lines.append(f"TOTAL:     {_fmt_money(order.get('total', 0), currency)}")
    lines.append("")
    lines.append("Thank you for your purchase.")
    return lines


def _reportlab_pdf(order: Dict[str, Any]) -> bytes:
    from io import BytesIO
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    width, height = A4
    y = height - 60
    for i, line in enumerate(_invoice_lines(order)):
        if i == 0:
            c.setFont("Helvetica-Bold", 16)
        else:
            c.setFont("Helvetica", 10)
        c.drawString(50, y, line)
        y -= 18
        if y < 60:
            c.showPage()
            y = height - 60
            c.setFont("Helvetica", 10)
    c.showPage()
    c.save()
    return buf.getvalue()


def _escape_pdf_text(s: str) -> str:
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _manual_pdf(order: Dict[str, Any]) -> bytes:
    """Hand-rolled minimal single-page PDF with Helvetica text."""
    lines = _invoice_lines(order)
    # Build the content stream: BT ... ET with text-line moves.
    content_parts = ["BT", "/F1 11 Tf", "14 TL", "50 780 Td"]
    for i, line in enumerate(lines):
        txt = _escape_pdf_text(line)
        if i == 0:
            content_parts.append("/F2 15 Tf")
            content_parts.append(f"({txt}) Tj")
            content_parts.append("/F1 11 Tf")
        else:
            content_parts.append(f"({txt}) Tj")
        content_parts.append("T*")
    content_parts.append("ET")
    content = "\n".join(content_parts).encode("latin-1", "replace")

    objects: List[bytes] = []
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objects.append(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
    objects.append(
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        b"/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>"
    )
    objects.append(
        b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"\nendstream"
    )
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")

    out = bytearray()
    out += b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"
    offsets = [0]
    for i, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref_pos = len(out)
    n = len(objects) + 1
    out += f"xref\n0 {n}\n".encode()
    out += b"0000000000 65535 f \n"
    for off in offsets[1:]:
        out += f"{off:010d} 00000 n \n".encode()
    out += b"trailer\n"
    out += f"<< /Size {n} /Root 1 0 R >>\n".encode()
    out += b"startxref\n"
    out += f"{xref_pos}\n".encode()
    out += b"%%EOF"
    return bytes(out)


def generate_invoice_pdf(order: Dict[str, Any]) -> bytes:
    try:
        import reportlab  # noqa: F401
        return _reportlab_pdf(order)
    except Exception as exc:  # noqa: BLE001
        logger.debug("invoice_pdf: reportlab unavailable, using manual PDF: %s", exc)
        return _manual_pdf(order)
