#!/usr/bin/env python3
"""Generate the D1 `legal_templates` seed + body-fill migrations.

Two outputs:
  * migration 085 (base seed) — only (re)written when the file is ABSENT, so the
    already-deployed/applied 085 stays byte-frozen. Seeds the store from:
      A. Dev FastAPI plain-text templates (backend/app/api/routes/legal.py)
      B. Worker e-sign markdown bodies (cloudflare-worker/src/templates/legal/*.md)
      C. Stub catalog entries (is_stub=1, empty body) for catalog completeness
      D. Task #29 authored v1 bodies (FULL_BODY_V1), seeded as full bodies.
  * migration 105 (Task #29 body-fill) — ALWAYS written. A stub-gated upsert of
    the FULL_BODY_V1 bodies: `ON CONFLICT(slug) DO UPDATE ... WHERE is_stub = 1`,
    so deployed stub rows pick up the authored bodies without clobbering rows an
    admin has already edited (is_stub=0).

Re-run after changing any source:
    .venv/bin/python scripts/gen-legal-templates-seed.py

085 uses INSERT OR IGNORE (idempotent); 105 uses a stub-gated upsert.
"""
import os
import re
import json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "cloudflare-worker", "sql", "migrations", "085_seed_legal_templates.sql")
OUT_105 = os.path.join(ROOT, "cloudflare-worker", "sql", "migrations", "105_fill_legal_template_bodies.sql")
OUT_113 = os.path.join(ROOT, "cloudflare-worker", "sql", "migrations", "113_refresh_legal_template_bodies.sql")
MD_DIR = os.path.join(ROOT, "cloudflare-worker", "src", "templates", "legal")

VALID_CATEGORIES = {"gp", "fund", "portfolio", "compliance"}

# --- A. FastAPI content templates (slug == key, category == layer) ----------
# Only needed for the (now dormant) 085 base-seed path; guarded so the 105
# generation does not depend on the dev backend being importable.
try:
    from backend.app.api.routes.legal import TEMPLATES as FASTAPI_TEMPLATES  # noqa: E402
except Exception:  # pragma: no cover - dev backend not importable
    FASTAPI_TEMPLATES = {}

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
# Task #29 — the partner_* deal slugs and finders_fee_intro_agreement moved to
# FULL_BODY_V1 below (they now have authored v1 bodies), so they are removed
# from the stub catalog.
CATALOG_STUBS = []

# --- C2. Admin agreement dropdown options (AGREEMENT_OPTIONS) ---------------
# slug == the literal option value; category per the dropdown group.
# Task #29 — Venture Share (FAST), MSA + Equity-for-Services, Engagement Letter
# (Spin-Out Package) and White-Label Service Agreement moved to FULL_BODY_V1.
AGREEMENT_STUBS = []

# --- D. Task #29 — authored v1 bodies for the 21 previously-blank templates.
# slug == the join-key literal (spaced slugs stay spaced); only the filename is
# snake_cased. These are seeded as full bodies (is_stub=0) into the base seed
# AND emitted as the stub-gated upsert migration 105 so already-deployed D1
# stub rows pick them up without clobbering admin-edited (non-stub) rows.
FULL_BODY_V1 = [
    # slug,                                   md file,                                       title,                                              category
    ("carried_interest",                      "carried_interest_v1.md",                      "Carried Interest / Partnership Agreement",         "gp"),
    ("cofounder_agreement",                   "cofounder_agreement_v1.md",                   "Co-Founder Agreement",                             "portfolio"),
    ("Engagement Letter (Spin-Out Package)",  "engagement_letter_spin_out_package_v1.md",    "Engagement Letter (Legal Counsel)",                "gp"),
    ("finders_fee_intro_agreement",           "finders_fee_intro_agreement_v1.md",           "Finder's Fee / Intro Agreement",                   "gp"),
    ("sg_first_directors_resolution",         "sg_first_directors_resolution_v1.md",         "First Directors' Resolution (Singapore)",          "gp"),
    ("ee_founding_resolution",                "ee_founding_resolution_v1.md",                "Founding Resolution (Estonia O\u00dc)",            "gp"),
    ("member_consent",                        "member_consent_v1.md",                        "Initial Member Written Consent",                   "gp"),
    ("ic_charter",                            "ic_charter_v1.md",                            "Investment Committee Charter",                     "gp"),
    ("MSA + Equity-for-Services",             "msa_equity_for_services_v1.md",               "MSA + Equity-for-Services (Operating Partner)",    "gp"),
    ("mentor_engagement_disclaimer",          "mentor_engagement_disclaimer_v1.md",          "Mentor Engagement Disclaimer v1",                  "gp"),
    ("mentor_nda_axal",                       "mentor_nda_axal_v1.md",                       "Mentor NDA (Axal) v1",                             "gp"),
    ("operating_agreement",                   "operating_agreement_v1.md",                   "Operating Agreement (LLC)",                        "gp"),
    ("partner_capital",                       "partner_capital_v1.md",                       "Partner Capital Deal",                             "gp"),
    ("partner_custom",                        "partner_custom_v1.md",                        "Partner Custom Deal",                              "gp"),
    ("partner_equity",                        "partner_equity_v1.md",                        "Partner Equity Deal",                              "gp"),
    ("partner_nda_nonsolicit",                "partner_nda_nonsolicit_v1.md",                "Partner NDA + Non-Solicit",                        "gp"),
    ("partner_revshare",                      "partner_revshare_v1.md",                      "Partner Revenue-Share Deal",                       "gp"),
    ("partner_services",                      "partner_services_v1.md",                      "Partner Services / MSA v1",                        "gp"),
    ("service_agreement",                     "service_agreement_v1.md",                     "Partner Service Agreement",                        "gp"),
    ("Venture Share Agreement (FAST)",        "venture_share_agreement_fast_v1.md",          "Venture Share Agreement / FAST (Advisor)",         "gp"),
    ("White-Label Service Agreement",         "white_label_service_agreement_v1.md",         "White-Label Service Agreement (Technical Partner)", "gp"),
]

# --- E. Legal-architecture refresh — newly authored v1 bodies for the
# previously-empty catalog/agreement stubs (clause-only bodies; the renderer
# now supplies the title, preamble, footer and signature block as static
# chrome — see cloudflare-worker/src/services/legalDocFormat.ts).
NEW_BODY_V1 = [
    # slug,                                    md file,                                       title,                                              category
    ("Subscription Booklet & LPA",            "subscription_booklet_lpa_v1.md",              "Subscription Booklet & LPA (LP)",                  "fund"),
    ("SPV Joinder Agreement",                 "spv_joinder_agreement_v1.md",                 "SPV Joinder Agreement (Syndicate)",                "fund"),
    ("Co-Investment Side Letter",             "co_investment_side_letter_v1.md",             "Co-Investment Side Letter",                        "fund"),
    ("Strategic Side Letter / Focused SPV",   "strategic_side_letter_focused_spv_v1.md",     "Strategic Side Letter / Focused SPV (Sector LP)",  "fund"),
    ("investor_subscription_pro",             "investor_subscription_pro_v1.md",             "Investor Subscription — Pro Tier",            "fund"),
    ("investor_subscription_inst",            "investor_subscription_inst_v1.md",            "Investor Subscription — Institutional Tier",  "fund"),
    ("Founder Collaboration Agreement",       "founder_collaboration_agreement_v1.md",       "Founder Collaboration Agreement",                  "portfolio"),
    ("Spin-Out Subsidiary SPA + IP Transfer", "spin_out_subsidiary_spa_v1.md",               "Spin-Out Subsidiary SPA (Founder)",                "portfolio"),
    ("Strategic Scale Partnership Agreement", "strategic_scale_partnership_agreement_v1.md", "Strategic Scale Partnership Agreement",            "portfolio"),
    ("Technology Integration / JV Agreement", "technology_integration_jv_v1.md",             "Technology Integration / JV (StudioOS AI)",        "portfolio"),
    ("Referral / Agency Agreement",           "referral_agency_agreement_v1.md",             "Referral / Agency Agreement (Distribution / GTM)", "portfolio"),
    ("M&A Advisory Mandate",                  "ma_advisory_mandate_v1.md",                   "M&A Advisory Mandate",                             "portfolio"),
    ("Secondary Purchase Agreement",          "secondary_purchase_agreement_v1.md",          "Secondary Purchase Agreement (Liquidity)",         "portfolio"),
    ("ip_background_schedule",                "ip_background_schedule_v1.md",                "IP Background Schedule",                           "portfolio"),
    ("data_access_acknowledgment_admin",      "data_access_acknowledgment_admin_v1.md",      "Data Access Acknowledgment (Admin)",               "compliance"),
]

# All `.md`-backed slugs, de-duplicated with FULL_BODY_V1 taking precedence over
# the older ESIGN_MD mappings (e.g. mentor_nda_axal -> the fuller *_axal body).
def all_md_bodies():
    seen = set()
    out = []
    for slug, fname, title, category in FULL_BODY_V1 + NEW_BODY_V1 + ESIGN_MD:
        if slug in seen:
            continue
        seen.add(slug)
        out.append((slug, fname, title, category))
    return out

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


def upsert_sql(slug, title, category, body):
    """Stub-gated body-fill upsert for migration 105.

    Inserts the authored body as a full (is_stub=0) row; if the slug already
    exists, only updates it when the existing row is still a stub
    (`WHERE legal_templates.is_stub = 1`) so admin-edited rows are protected.
    """
    assert category in VALID_CATEGORIES, f"bad category {category} for {slug}"
    mf = json.dumps(merge_fields(body))
    return (
        "INSERT INTO legal_templates\n"
        "  (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES\n"
        f"  ('{esc(slug)}', '{esc(title)}', '{esc(category)}', '{esc(body)}', '{esc(mf)}', 1, 1, 0)\n"
        "ON CONFLICT(slug) DO UPDATE SET\n"
        "  title        = excluded.title,\n"
        "  category     = excluded.category,\n"
        "  body_md      = excluded.body_md,\n"
        "  merge_fields = excluded.merge_fields,\n"
        "  is_stub      = 0,\n"
        "  version      = legal_templates.version + 1,\n"
        "  updated_at   = CURRENT_TIMESTAMP\n"
        "WHERE legal_templates.is_stub = 1;"
    )


def force_upsert_sql(slug, title, category, body):
    """Unconditional body-refresh upsert for migration 113.

    Unlike the stub-gated 105, this overwrites the body for the slug regardless
    of is_stub — a deliberate, owner-authorized one-time refresh that aligns
    every `.md`-backed template with the clean clause-only convention the new
    renderer expects (no embedded title/preamble/signature/Markdown noise)."""
    assert category in VALID_CATEGORIES, f"bad category {category} for {slug}"
    mf = json.dumps(merge_fields(body))
    return (
        "INSERT INTO legal_templates\n"
        "  (slug, title, category, body_md, merge_fields, version, is_active, is_stub) VALUES\n"
        f"  ('{esc(slug)}', '{esc(title)}', '{esc(category)}', '{esc(body)}', '{esc(mf)}', 1, 1, 0)\n"
        "ON CONFLICT(slug) DO UPDATE SET\n"
        "  title        = excluded.title,\n"
        "  category     = excluded.category,\n"
        "  body_md      = excluded.body_md,\n"
        "  merge_fields = excluded.merge_fields,\n"
        "  is_active    = 1,\n"
        "  is_stub      = 0,\n"
        "  version      = legal_templates.version + 1,\n"
        "  updated_at   = CURRENT_TIMESTAMP;"
    )


def read_md(fname):
    with open(os.path.join(MD_DIR, fname), "r", encoding="utf-8") as fh:
        return fh.read()


def gen_085():
    """Base seed (sources A–D). Only written when 085 is absent — the applied
    085 is frozen in prod, so re-running the generator must not mutate it."""
    if os.path.exists(OUT):
        print(f"Skip {os.path.relpath(OUT, ROOT)} (exists; frozen — not regenerated)")
        return

    rows = []
    seen = set()

    def add(slug, title, category, body, is_stub):
        if slug in seen:
            return
        seen.add(slug)
        rows.append(row_sql(slug, title, category, body, is_stub))

    # D. Authored v1 bodies (full bodies, take precedence over stubs)
    for slug, fname, title, category in FULL_BODY_V1 + NEW_BODY_V1:
        add(slug, title, category, read_md(fname), 0)

    # A. FastAPI full-content templates
    for key, v in FASTAPI_TEMPLATES.items():
        body = to_double_brace(v.get("content", ""))
        add(key, v.get("title", key), v.get("layer", "gp"), body, 0)

    # B. Worker e-sign markdown bodies
    for slug, fname, title, category in ESIGN_MD:
        add(slug, title, category, read_md(fname), 0)

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


def gen_105():
    """Task #29 — stub-gated body-fill for the 21 authored v1 templates.

    Frozen once applied: like 085, this historical migration is byte-frozen so
    re-running the generator never mutates an already-applied migration. The
    clean-architecture refresh now lives in 113 (gen_refresh)."""
    if os.path.exists(OUT_105):
        print(f"Skip {os.path.relpath(OUT_105, ROOT)} (exists; frozen — not regenerated)")
        return
    rows = [upsert_sql(slug, title, category, read_md(fname))
            for slug, fname, title, category in FULL_BODY_V1]

    header = (
        "-- Task #29 — Fill the 21 previously-blank legal_templates with authored v1 bodies.\n"
        "-- Source: scripts/gen-legal-templates-seed.py (FULL_BODY_V1) — DO NOT hand-edit.\n"
        "-- Stub-gated upsert: existing rows are only overwritten when still a stub\n"
        "-- (is_stub = 1), so admin-edited (is_stub = 0) rows are never clobbered.\n"
        "-- Bodies are v1 drafts pending legal review.\n\n"
    )
    with open(OUT_105, "w", encoding="utf-8") as fh:
        fh.write(header)
        fh.write("\n\n".join(rows))
        fh.write("\n")

    print(f"Wrote {len(rows)} body-fill upserts -> {os.path.relpath(OUT_105, ROOT)}")


def gen_refresh():
    """Migration 113 — clean-architecture body refresh.

    Force-upserts the clean clause-only body for every `.md`-backed template so
    deployed D1 rows (which carry a mix of older plain-text and raw-Markdown
    bodies, plus inline title/preamble/signature) are realigned with the
    static-chrome renderer. ALWAYS regenerated from the `.md` sources."""
    rows = [force_upsert_sql(slug, title, category, read_md(fname))
            for slug, fname, title, category in all_md_bodies()]

    header = (
        "-- Legal-architecture refresh — realign every .md-backed legal_template with\n"
        "-- the clean clause-only convention (title/preamble/footer/signature are now\n"
        "-- supplied by the renderer, not the body; Markdown is normalized at render).\n"
        "-- Source: scripts/gen-legal-templates-seed.py (all_md_bodies) — DO NOT hand-edit.\n"
        "-- Unconditional upsert (NOT stub-gated): a deliberate one-time content refresh.\n"
        "-- Bodies are v1 drafts pending legal review.\n\n"
    )
    with open(OUT_113, "w", encoding="utf-8") as fh:
        fh.write(header)
        fh.write("\n\n".join(rows))
        fh.write("\n")

    print(f"Wrote {len(rows)} body-refresh upserts -> {os.path.relpath(OUT_113, ROOT)}")


def main():
    gen_085()
    gen_105()
    gen_refresh()


if __name__ == "__main__":
    main()
