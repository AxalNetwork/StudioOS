#!/usr/bin/env python3
"""Task #8 — Generate cloudflare-worker/sql/migrations/085_seed_legal_templates.sql

Seeds the D1 `legal_templates` store from three sources:
  A. Dev FastAPI plain-text templates (backend/app/api/routes/legal.py TEMPLATES)
     — full counsel-drafted bodies. {single_brace} placeholders are converted
     to {{double_brace}} so the worker's applyMergeFields renders them uniformly.
  B. Worker e-sign markdown bodies (cloudflare-worker/src/templates/legal/*.md)
     — already use {{double_brace}}; stored under their public doc_type slug.
  C. Stub catalog entries (is_stub=1, empty body) for every admin agreement
     option and contract doc_type that has no body content yet, so the grid
     lists the full catalog grouped by category.

Re-run after changing any source:
    .venv/bin/python scripts/gen-legal-templates-seed.py

The generated SQL is idempotent (INSERT OR IGNORE on the unique slug).
"""
import os
import re
import json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "cloudflare-worker", "sql", "migrations", "085_seed_legal_templates.sql")
MD_DIR = os.path.join(ROOT, "cloudflare-worker", "src", "templates", "legal")

VALID_CATEGORIES = {"gp", "fund", "portfolio", "compliance"}

# --- A. FastAPI content templates (slug == key, category == layer) ----------
from backend.app.api.routes.legal import TEMPLATES as FASTAPI_TEMPLATES  # noqa: E402

# --- B. Worker e-sign markdown bodies, keyed by their public doc_type slug ---
# (doc_type values mirror admin_contracts.ts TEMPLATES + DOC_TYPE_TO_TEMPLATE_KEY)
ESIGN_MD = [
    # slug,                            md file,                                 title,                                   category
    ("tos_v1",                         "tos_v1.md",                             "Terms of Service v1",                   "compliance"),
    ("privacy_v1",                     "privacy_v1.md",                         "Privacy Policy v1",                     "compliance"),
    ("founder_nda_v1",                 "founder_nda_v1.md",                     "Founder Mutual NDA v1",                 "portfolio"),
    ("investor_nda_axal",             "investor_nda_v1.md",                    "Investor NDA (Axal) v1",                "fund"),
    ("mentor_nda_axal",               "mentor_nda_v1.md",                      "Mentor NDA (Axal) v1",                  "gp"),
    ("mentor_engagement_disclaimer",  "mentor_disclaimer_v1.md",               "Mentor Engagement Disclaimer v1",       "gp"),
    ("accreditation_v1",               "accreditation_v1.md",                   "Accreditation Attestation v1",          "fund"),
    ("partner_services",               "partner_msa_v1.md",                     "Partner Services / MSA v1",             "gp"),
    ("nda_3way_founder_investor_axal", "nda_3way_founder_investor_axal_v1.md",  "3-Way NDA (Founder \u2194 Investor \u2194 Axal) v1", "portfolio"),
]

# --- C1. Contract doc_types present in the admin catalog without a body ------
CATALOG_STUBS = [
    ("partner_nda_nonsolicit",       "Partner NDA + Non-Solicit",       "gp"),
    ("partner_equity",               "Partner Equity Deal",             "gp"),
    ("partner_revshare",             "Partner Revenue-Share Deal",      "gp"),
    ("partner_capital",              "Partner Capital Deal",            "gp"),
    ("partner_custom",               "Partner Custom Deal",             "gp"),
    ("finders_fee_intro_agreement",  "Finder's Fee / Intro Agreement",  "gp"),
    ("ip_background_schedule",       "IP Background Schedule",          "portfolio"),
    ("data_access_acknowledgment_admin", "Data Access Acknowledgment (Admin)", "compliance"),
    ("investor_subscription_pro",    "Investor Subscription \u2014 Pro Tier",          "fund"),
    ("investor_subscription_inst",   "Investor Subscription \u2014 Institutional Tier", "fund"),
]

# --- C2. Admin agreement dropdown options (AGREEMENT_OPTIONS) ---------------
# slug == the literal option value; category per the dropdown group.
AGREEMENT_STUBS = [
    ("Subscription Booklet & LPA",              "Subscription Booklet & LPA (LP)",                 "fund"),
    ("SPV Joinder Agreement",                   "SPV Joinder Agreement (Syndicate)",               "fund"),
    ("Co-Investment Side Letter",               "Co-Investment Side Letter",                       "fund"),
    ("Strategic Side Letter / Focused SPV",     "Strategic Side Letter / Focused SPV (Sector LP)", "fund"),
    ("Founder Collaboration Agreement",         "Founder Collaboration Agreement",                 "portfolio"),
    ("Spin-Out Subsidiary SPA + IP Transfer",   "Spin-Out Subsidiary SPA (Founder)",               "portfolio"),
    ("Strategic Scale Partnership Agreement",   "Strategic Scale Partnership Agreement",           "portfolio"),
    ("Technology Integration / JV Agreement",   "Technology Integration / JV (StudioOS AI)",       "portfolio"),
    ("Referral / Agency Agreement",             "Referral / Agency Agreement (Distribution / GTM)", "portfolio"),
    ("M&A Advisory Mandate",                    "M&A Advisory Mandate",                            "portfolio"),
    ("Venture Share Agreement (FAST)",          "Venture Share Agreement / FAST (Advisor)",        "gp"),
    ("MSA + Equity-for-Services",               "MSA + Equity-for-Services (Operating Partner)",   "gp"),
    ("Engagement Letter (Spin-Out Package)",    "Engagement Letter (Legal Counsel)",               "gp"),
    ("White-Label Service Agreement",           "White-Label Service Agreement (Technical Partner)", "gp"),
    ("Secondary Purchase Agreement",            "Secondary Purchase Agreement (Liquidity)",        "portfolio"),
]

SINGLE_BRACE = re.compile(r"(?<!\{)\{([a-zA-Z_][a-zA-Z0-9_]*)\}(?!\})")
MERGE_TOKEN = re.compile(r"\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}")


def to_double_brace(text: str) -> str:
    return SINGLE_BRACE.sub(r"{{\1}}", text)


def merge_fields(body: str):
    seen = []
    for m in MERGE_TOKEN.findall(body):
        if m not in seen:
            seen.append(m)
    return sorted(seen)


def esc(s: str) -> str:
    return s.replace("'", "''")


def row_sql(slug, title, category, body, is_stub):
    assert category in VALID_CATEGORIES, f"bad category {category} for {slug}"
    mf = json.dumps(merge_fields(body))
    return (
        "INSERT OR IGNORE INTO legal_templates "
        "(slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES\n"
        f"  ('{esc(slug)}', '{esc(title)}', '{esc(category)}', '{esc(body)}', '{esc(mf)}', 1, 1, {is_stub});"
    )


def main():
    rows = []
    seen = set()

    def add(slug, title, category, body, is_stub):
        if slug in seen:
            return
        seen.add(slug)
        rows.append(row_sql(slug, title, category, body, is_stub))

    # A. FastAPI full-content templates
    for key, v in FASTAPI_TEMPLATES.items():
        body = to_double_brace(v.get("content", ""))
        add(key, v.get("title", key), v.get("layer", "gp"), body, 0)

    # B. Worker e-sign markdown bodies
    for slug, fname, title, category in ESIGN_MD:
        path = os.path.join(MD_DIR, fname)
        with open(path, "r", encoding="utf-8") as fh:
            body = fh.read()
        add(slug, title, category, body, 0)

    # C1 + C2. Stub catalog entries (empty body)
    for slug, title, category in CATALOG_STUBS + AGREEMENT_STUBS:
        add(slug, title, category, "", 1)

    header = (
        "-- Task #8 — Seed the D1 legal_templates store (generated).\n"
        "-- Source: scripts/gen-legal-templates-seed.py — DO NOT hand-edit; re-run the\n"
        "-- generator after changing backend legal.py templates or worker .md bodies.\n"
        "-- INSERT OR IGNORE keeps this idempotent and safe to re-apply.\n\n"
    )
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(header)
        fh.write("\n\n".join(rows))
        fh.write("\n")

    stubs = sum(1 for r in rows if r.rstrip().endswith("1);"))
    print(f"Wrote {len(rows)} template rows ({stubs} stubs) -> {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
