from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import UniqueConstraint, event
from typing import Optional, List
from datetime import datetime, date
from enum import Enum
import re as _re
import uuid


def _slugify_name(s: str) -> str:
    s = (s or "").lower().strip()
    s = _re.sub(r"[^a-z0-9]+", "-", s)
    s = _re.sub(r"-+", "-", s).strip("-")
    return s or "partner"


class EntityType(str, Enum):
    HOLDING_COMPANY = "holding_company"
    PROJECT = "project"
    SUBSIDIARY = "subsidiary"
    VC_FUND = "vc_fund"  # DEPRECATED — funds now live in `vc_funds` table; kept for legacy rows


class ProjectStatus(str, Enum):
    INTAKE = "intake"
    SCORING = "scoring"
    TIER_1 = "tier_1"
    TIER_2 = "tier_2"
    REJECTED = "rejected"
    SPINOUT = "spinout"
    ACTIVE = "active"


class PlaybookWeek(str, Enum):
    WEEK_1 = "week_1"
    WEEK_2 = "week_2"
    WEEK_3 = "week_3"
    WEEK_4 = "week_4"
    COMPLETE = "complete"


class DocumentType(str, Enum):
    SAFE = "safe"
    BYLAWS = "bylaws"
    EQUITY_SPLIT = "equity_split"
    IP_LICENSE = "ip_license"
    PITCH_DECK = "pitch_deck"
    DEAL_MEMO = "deal_memo"
    DILIGENCE_REPORT = "diligence_report"
    FINANCIAL_MODEL = "financial_model"
    OTHER = "other"
    OPERATING_AGREEMENT = "operating_agreement"
    CARRIED_INTEREST = "carried_interest"
    IC_CHARTER = "ic_charter"
    SERVICE_AGREEMENT = "service_agreement"
    LPA = "lpa"
    PPM = "ppm"
    SUBSCRIPTION = "subscription"
    MGMT_COMPANY = "mgmt_company"
    TERM_SHEET = "term_sheet"
    SPA = "spa"
    VOTING_RIGHTS = "voting_rights"
    FORM_ADV = "form_adv"
    AML_KYC = "aml_kyc"
    SECTION_83B = "section_83b"


class DocumentStatus(str, Enum):
    DRAFT = "draft"
    GENERATED = "generated"
    SENT = "sent"
    SIGNED = "signed"
    VOID = "void"


class TicketStatus(str, Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"
    CLOSED = "closed"


class TicketPriority(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"


class DealStatus(str, Enum):
    APPLIED = "applied"
    SCORED = "scored"
    ACTIVE = "active"
    FUNDED = "funded"
    REJECTED = "rejected"


class UserRole(str, Enum):
    ADMIN = "admin"
    FOUNDER = "founder"
    PARTNER = "partner"      # service providers (legal, accounting, design, recruiting, GTM, etc.)
    INVESTOR = "investor"    # capital allocators (LP / VC / Angel / Scout). Phase 0.1 split.


class User(SQLModel, table=True):
    __tablename__ = "users"
    id: Optional[int] = Field(default=None, primary_key=True)
    uid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    email: str = Field(unique=True, index=True)
    name: str
    role: UserRole = UserRole.FOUNDER
    password_hash: Optional[str] = None
    founder_id: Optional[int] = Field(default=None, foreign_key="founders.id")
    partner_id: Optional[int] = Field(default=None, foreign_key="partners.id")
    # Phase 0.1 — link to investor profile when role == 'investor'.
    investor_id: Optional[int] = Field(default=None, foreign_key="investors.id")
    is_active: bool = True
    email_verified: bool = False
    verification_token: Optional[str] = None
    verification_token_expires: Optional[datetime] = None
    admin_notes: Optional[str] = None
    last_active_at: Optional[datetime] = None
    # 'limited' = admin granted browse-only access without KYC. The user
    # can use the platform but cannot sign legal agreements (enforced in
    # the esign sign endpoint). Null = normal flow.
    access_level: Optional[str] = None
    referrer_partner_id: Optional[int] = Field(default=None, foreign_key="partners.id", index=True)
    referrer_code_used: Optional[str] = None
    referral_attributed_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Deal(SQLModel, table=True):
    __tablename__ = "deals"
    id: Optional[int] = Field(default=None, primary_key=True)
    uid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    project_id: int = Field(foreign_key="projects.id", index=True)
    partner_id: Optional[int] = Field(default=None, foreign_key="partners.id")
    status: DealStatus = DealStatus.APPLIED
    notes: Optional[str] = None
    amount: Optional[float] = None
    # Growth & Expansion Track — Task 2: 'spin_out' (default) | 'growth_sprint'
    track_type: str = Field(default="spin_out", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class ActivityLog(SQLModel, table=True):
    __tablename__ = "activity_logs"
    id: Optional[int] = Field(default=None, primary_key=True)
    uid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True)
    project_id: Optional[int] = Field(default=None, foreign_key="projects.id")
    user_id: Optional[int] = Field(default=None, foreign_key="users.id", index=True)
    action: str
    details: Optional[str] = None
    actor: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Entity(SQLModel, table=True):
    __tablename__ = "entities"
    id: Optional[int] = Field(default=None, primary_key=True)
    uid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    name: str
    entity_type: EntityType
    parent_id: Optional[int] = Field(default=None, foreign_key="entities.id")
    jurisdiction: Optional[str] = None
    incorporation_date: Optional[date] = None
    status: str = "active"
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class Founder(SQLModel, table=True):
    __tablename__ = "founders"
    id: Optional[int] = Field(default=None, primary_key=True)
    uid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    name: str
    email: str = Field(unique=True, index=True)
    linkedin_url: Optional[str] = None
    domain_expertise: Optional[str] = None
    experience_years: int = 0
    bio: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Project(SQLModel, table=True):
    __tablename__ = "projects"
    id: Optional[int] = Field(default=None, primary_key=True)
    uid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    name: str = Field(index=True)
    description: Optional[str] = None
    sector: Optional[str] = None
    stage: str = "idea"
    status: ProjectStatus = ProjectStatus.INTAKE
    playbook_week: PlaybookWeek = PlaybookWeek.WEEK_1
    founder_id: Optional[int] = Field(default=None, foreign_key="founders.id")
    entity_id: Optional[int] = Field(default=None, foreign_key="entities.id")
    problem_statement: Optional[str] = None
    solution: Optional[str] = None
    why_now: Optional[str] = None
    tam: Optional[float] = None
    sam: Optional[float] = None
    users_count: Optional[int] = None
    revenue: Optional[float] = None
    growth_signals: Optional[str] = None
    cost_to_mvp: Optional[float] = None
    funding_needed: Optional[float] = None
    use_of_funds: Optional[str] = None
    # Growth & Expansion Track — Task 2: 'spin_out' (default) | 'growth_sprint'
    track_type: str = Field(default="spin_out", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class ScoreSnapshot(SQLModel, table=True):
    __tablename__ = "score_snapshots"
    id: Optional[int] = Field(default=None, primary_key=True)
    uid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    project_id: int = Field(foreign_key="projects.id", index=True)
    total_score: float
    tier: str
    market_size: float = 0
    market_urgency: float = 0
    market_trend: float = 0
    market_total: float = 0
    team_expertise: float = 0
    team_execution: float = 0
    team_network: float = 0
    team_total: float = 0
    product_mvp_time: float = 0
    product_complexity: float = 0
    product_dependency: float = 0
    product_total: float = 0
    capital_cost_mvp: float = 0
    capital_time_revenue: float = 0
    capital_burn_traction: float = 0
    capital_total: float = 0
    fit_alignment: float = 0
    fit_synergy: float = 0
    fit_total: float = 0
    distribution_channels: float = 0
    distribution_virality: float = 0
    distribution_total: float = 0
    ai_adjustment: float = 0
    ai_notes: Optional[str] = None
    scored_by: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    # --- Epic 5: anti-cheat columns (parity with Cloudflare D1 schema) ---
    # `is_sandbox=True` means a founder Practice run: never visible to LPs/
    # partners, never counted toward the 7-day official cooldown.
    is_sandbox: bool = Field(default=False, index=True)
    # HMAC-SHA256 signature over the canonical message
    # `pid=N|score=NN.NN|ver=v1|ts=...`. Validated on every read.
    integrity_hash: Optional[str] = Field(default=None, index=True)
    integrity_version: str = Field(default="v1")
    # Raw founder/partner inputs at scoring time. Used for anomaly diffing
    # and to re-derive the canonical hash in the nightly audit job. Stored
    # as a JSON string for SQLite/Postgres portability.
    inputs_json: Optional[str] = None
    # JSON list of {type, severity, detail} produced by detectAnomalies().
    anomaly_flags: Optional[str] = None
    # 'auto_approved' (no anomalies, no tampering), 'flagged' (held back from
    # LPs pending admin review), 'approved', 'rejected'.
    admin_review_status: str = Field(default="auto_approved", index=True)
    admin_review_notes: Optional[str] = None
    admin_reviewed_by: Optional[int] = None
    admin_reviewed_at: Optional[datetime] = None
    # Until this UTC timestamp, no new official run for this project is
    # accepted (founder must use sandbox or wait). NULL = no lock.
    locked_until: Optional[datetime] = Field(default=None, index=True)


class Document(SQLModel, table=True):
    __tablename__ = "documents"
    id: Optional[int] = Field(default=None, primary_key=True)
    uid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    project_id: Optional[int] = Field(default=None, foreign_key="projects.id")
    title: str
    doc_type: DocumentType
    status: DocumentStatus = DocumentStatus.DRAFT
    # Legacy: rendered HTML/text was stored inline in `content`. Newly-created
    # documents persist to object storage instead and keep only a `file_key`
    # pointer here. `content` is migrated-on-read by the download endpoint and
    # then cleared so PII / contract bodies don't sit in the primary DB.
    content: Optional[str] = None
    file_key: Optional[str] = Field(default=None, index=True)
    file_size: Optional[int] = None
    file_sha256: Optional[str] = None
    file_content_type: Optional[str] = None
    template_name: Optional[str] = None
    # `signed_by` records the legal signer's email. We never store typed-name
    # blobs or rendered signature images — see services/signatures.py for the
    # rationale (data minimisation: only what's needed for legal proof).
    signed_by: Optional[str] = None
    signed_at: Optional[datetime] = None
    # `signed_ip` is captured purely as legal-proof evidence and is admin-only
    # — it is *never* exposed via founder/partner-facing DTOs.
    signed_ip: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class DealMemo(SQLModel, table=True):
    __tablename__ = "deal_memos"
    id: Optional[int] = Field(default=None, primary_key=True)
    uid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    project_id: int = Field(foreign_key="projects.id", index=True)
    score_snapshot_id: Optional[int] = Field(default=None, foreign_key="score_snapshots.id")
    startup_name: str
    founders: str
    sector: Optional[str] = None
    stage: Optional[str] = None
    total_score: float
    tier: str
    problem: Optional[str] = None
    solution: Optional[str] = None
    why_now: Optional[str] = None
    users: Optional[str] = None
    revenue_info: Optional[str] = None
    growth_signals: Optional[str] = None
    cost_to_mvp: Optional[str] = None
    funding_needed: Optional[str] = None
    use_of_funds: Optional[str] = None
    strategic_alignment: Optional[str] = None
    partner_synergies: Optional[str] = None
    risks: Optional[str] = None
    decision: str = "pending"
    terms_amount: Optional[str] = None
    terms_equity: Optional[str] = None
    terms_structure: Optional[str] = None
    key_insight: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Partner(SQLModel, table=True):
    __tablename__ = "partners"
    id: Optional[int] = Field(default=None, primary_key=True)
    uid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    name: str
    company: Optional[str] = None
    email: str = Field(unique=True, index=True)
    specialization: Optional[str] = None
    referral_code: Optional[str] = Field(default=None, unique=True)
    referrals_count: int = 0
    status: str = "active"
    created_at: datetime = Field(default_factory=datetime.utcnow)
    # Task #36 — Service provider marketplace (additive; migration adds columns to legacy rows).
    headline: Optional[str] = None              # e.g. "Fractional CFO for late-seed SaaS"
    bio: Optional[str] = None
    categories_json: str = "[]"                 # ["legal","accounting","design","recruiting","fractional_cfo","gtm"]
    sectors_json: str = "[]"                    # ["b2b_saas","fintech",...]
    pricing_tier: Optional[str] = None          # "$" | "$$" | "$$$"
    hourly_rate_min: Optional[float] = None
    hourly_rate_max: Optional[float] = None
    capacity_status: str = Field(default="available", index=True)  # available | limited | unavailable
    response_time_hours: Optional[int] = None   # typical first-response SLA
    kyb_status: str = Field(default="unverified", index=True)      # unverified | pending | verified | rejected
    kyb_verified_at: Optional[datetime] = None
    website: Optional[str] = None
    listed: bool = Field(default=False, index=True)  # opt-in to marketplace listing
    # Task #51 — Stripe Connect onboarding state. Populated when the
    # partner clicks "Connect Stripe" and Stripe redirects back. Without a
    # connected account, founders may still book offerings but invoicing
    # surfaces a clear "partner not yet onboarded" error.
    stripe_account_id: Optional[str] = Field(default=None, index=True)
    stripe_charges_enabled: bool = Field(default=False)
    stripe_payouts_enabled: bool = Field(default=False)
    stripe_onboarded_at: Optional[datetime] = None
    # Task #53 — Public directory + ranking.
    # `slug` is the SEO-friendly identifier used in /partners/{slug}
    # public URLs. Backfilled from `name` + uid suffix on first migration
    # to guarantee uniqueness.
    slug: Optional[str] = Field(default=None, unique=True, index=True)
    # Featured slot — when `featured=True` and `featured_until > now()`,
    # the partner is pinned to the top of public listings ahead of
    # algorithmic ranking. `featured_tier` distinguishes paid (e.g.
    # "platinum"/"gold") from purely algorithmic boosts ("editor").
    featured: bool = Field(default=False, index=True)
    featured_until: Optional[datetime] = None
    featured_tier: Optional[str] = None  # platinum | gold | editor | None


@event.listens_for(Partner, "before_insert")
def _partner_assign_slug(_mapper, _connection, target: "Partner") -> None:
    """Task #53 — guarantee every Partner is born with a slug so public
    read endpoints (`/marketplace/public/partners`) never need to mutate
    state. Uniqueness is still enforced by the DB UNIQUE constraint;
    extremely rare races resolve via the lazy collision-retry helper in
    the marketplace migration backfill."""
    if not getattr(target, "slug", None):
        base = _slugify_name(target.name)
        # `uid` has a default_factory so it is populated by the time the
        # listener fires, but guard for the legacy path that pre-sets uid.
        suffix = (target.uid or "")[:6]
        target.slug = f"{base}-{suffix}" if suffix else base


# ---------------------------------------------------------------------------
# Task #43 — Reference check workflow
# Standardise reference calls so they're recorded, transcribed, summarised,
# and tagged. Surfaced in the deal record. Admin / investor only.
# ---------------------------------------------------------------------------
class Reference(SQLModel, table=True):
    __tablename__ = "references"
    id: Optional[int] = Field(default=None, primary_key=True)
    uid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    deal_id: int = Field(foreign_key="deals.id", index=True)
    # Reference contact details
    reference_name: str
    reference_email: Optional[str] = None
    reference_role: Optional[str] = None         # e.g. "Former CTO", "Customer", "Investor"
    relationship: Optional[str] = None           # narrative — how they know the founder
    # Scheduling
    scheduled_at: Optional[datetime] = None
    # Consent — explicit, captured before any recording is uploaded.
    # `consent_text` snapshots the exact wording the reference agreed to so
    # we have an audit trail even if the policy text changes later.
    consent_given: bool = Field(default=False, index=True)
    consent_given_at: Optional[datetime] = None
    consent_text: Optional[str] = None
    consent_captured_by: Optional[int] = Field(default=None, foreign_key="users.id")
    # Recording (file-storage key, served via signed URL — never inline)
    recording_file_key: Optional[str] = None
    recording_size_bytes: Optional[int] = None
    recording_content_type: Optional[str] = None
    recording_uploaded_at: Optional[datetime] = None
    # AI artefacts
    transcript: Optional[str] = None
    transcribed_at: Optional[datetime] = None
    summary_json: Optional[str] = None           # {summary, tags[], red_flags[], strengths[], quotes[]}
    summarized_at: Optional[datetime] = None
    # Lifecycle: scheduled → recorded → transcribed → summarized | cancelled
    status: str = Field(default="scheduled", index=True)
    notes: Optional[str] = None
    created_by: Optional[int] = Field(default=None, foreign_key="users.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class PartnerReview(SQLModel, table=True):
    __tablename__ = "partner_reviews"
    id: Optional[int] = Field(default=None, primary_key=True)
    partner_id: int = Field(foreign_key="partners.id", index=True)
    reviewer_user_id: int = Field(foreign_key="users.id", index=True)
    project_id: Optional[int] = Field(default=None, foreign_key="projects.id", index=True)
    rating: int = Field(ge=1, le=5)
    comment: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class MarketplaceInquiry(SQLModel, table=True):
    __tablename__ = "marketplace_inquiries"
    id: Optional[int] = Field(default=None, primary_key=True)
    uid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    partner_id: int = Field(foreign_key="partners.id", index=True)
    requester_user_id: int = Field(foreign_key="users.id", index=True)
    project_id: Optional[int] = Field(default=None, foreign_key="projects.id", index=True)
    subject: str
    status: str = Field(default="open", index=True)  # open | closed
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class MarketplaceMessage(SQLModel, table=True):
    __tablename__ = "marketplace_messages"
    id: Optional[int] = Field(default=None, primary_key=True)
    inquiry_id: int = Field(foreign_key="marketplace_inquiries.id", index=True)
    sender_user_id: int = Field(foreign_key="users.id", index=True)
    body: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


# ---------------------------------------------------------------------------
# Task #50 — Needs board + RFP system
# ---------------------------------------------------------------------------
class FounderNeed(SQLModel, table=True):
    """Lightweight 'I need help with X' post by a founder.

    May escalate to a formal RFP (one-to-one) for detailed scope review.
    Quotes hang off the need (and optionally reference the RFP).
    """
    __tablename__ = "founder_needs"
    id: Optional[int] = Field(default=None, primary_key=True)
    uid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    project_id: int = Field(foreign_key="projects.id", index=True)
    founder_id: int = Field(foreign_key="founders.id", index=True)
    category: str = Field(index=True)  # legal | accounting | design | recruiting | fractional_cfo | gtm | engineering | marketing
    title: str
    description: str
    budget_min: Optional[float] = None
    budget_max: Optional[float] = None
    timeline: Optional[str] = None  # free-form e.g. "2 weeks", "Q3"
    status: str = Field(default="open", index=True)  # open | in_review | closed | filled
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class RFP(SQLModel, table=True):
    __tablename__ = "rfps"
    id: Optional[int] = Field(default=None, primary_key=True)
    uid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    need_id: int = Field(foreign_key="founder_needs.id", unique=True, index=True)
    scope_md: str
    deliverables_md: Optional[str] = None
    deadline_at: Optional[datetime] = None
    status: str = Field(default="open", index=True)  # open | closed
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Quote(SQLModel, table=True):
    """Partner submission against a need / RFP."""
    __tablename__ = "quotes"
    id: Optional[int] = Field(default=None, primary_key=True)
    uid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    need_id: int = Field(foreign_key="founder_needs.id", index=True)
    rfp_id: Optional[int] = Field(default=None, foreign_key="rfps.id", index=True)
    partner_id: int = Field(foreign_key="partners.id", index=True)
    submitted_by_user_id: int = Field(foreign_key="users.id", index=True)
    price: float
    timeline_weeks: Optional[int] = None
    deliverables: str
    notes: Optional[str] = None
    # pending | accepted | rejected | withdrawn
    status: str = Field(default="pending", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class InsightSubscription(SQLModel, table=True):
    """Task #52 — opt-in for the weekly demand-insights newsletter."""
    __tablename__ = "insight_subscriptions"
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id", unique=True, index=True)
    frequency: str = Field(default="weekly")  # weekly only for now
    active: bool = Field(default=True)
    subscribed_at: datetime = Field(default_factory=datetime.utcnow)
    last_sent_at: Optional[datetime] = None


class InsightDigest(SQLModel, table=True):
    """Archive of generated digests so we don't recompute on demand and
    can show subscribers their last issue."""
    __tablename__ = "insight_digests"
    id: Optional[int] = Field(default=None, primary_key=True)
    week_start: datetime = Field(unique=True, index=True)
    body_md: str
    sent_count: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Engagement(SQLModel, table=True):
    """Task #51 — Engagement lifecycle.

    Materialised when (a) a founder accepts a quote on a need, or
    (b) a founder books a partner's `ServiceOffering` directly.

    State machine (server-enforced):
        accepted → in_progress → delivered → reviewed → invoiced
                                   ↘ cancelled (terminal, allowed from any non-terminal)
    Legacy `active` rows (created before the lifecycle was added) are
    treated as `accepted`.
    """
    __tablename__ = "engagements"
    id: Optional[int] = Field(default=None, primary_key=True)
    uid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    # quote_id / need_id are nullable for offering-sourced engagements that
    # bypass the needs board. The DB unique constraints stay (NULLs are
    # distinct in Postgres) so quote-sourced rows still get one-per-quote.
    quote_id: Optional[int] = Field(default=None, foreign_key="quotes.id", unique=True, index=True)
    need_id: Optional[int] = Field(default=None, foreign_key="founder_needs.id", unique=True, index=True)
    service_offering_id: Optional[int] = Field(default=None, foreign_key="service_offerings.id", index=True)
    project_id: int = Field(foreign_key="projects.id", index=True)
    founder_id: int = Field(foreign_key="founders.id", index=True)
    partner_id: int = Field(foreign_key="partners.id", index=True)
    price: float
    currency: str = Field(default="usd")
    deliverables: str
    timeline_weeks: Optional[int] = None
    sla_days: Optional[int] = None
    status: str = Field(default="accepted", index=True)
    # Lifecycle timestamps — populated as the state machine advances.
    accepted_at: Optional[datetime] = Field(default_factory=datetime.utcnow)
    started_at: Optional[datetime] = None
    delivered_at: Optional[datetime] = None
    reviewed_at: Optional[datetime] = None
    invoiced_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    delivery_notes: Optional[str] = None
    cancel_reason: Optional[str] = None
    # Stripe Connect invoicing — populated on POST /engagements/{id}/invoice.
    stripe_invoice_id: Optional[str] = None
    stripe_invoice_url: Optional[str] = None
    stripe_payment_status: Optional[str] = None  # draft | open | paid | void | uncollectible
    amount_cents: Optional[int] = None
    invoice_simulated: bool = Field(default=False)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class ServiceOffering(SQLModel, table=True):
    """Task #51 — Productised partner offering.

    Partners list service packages (title, price, deliverables, SLA) that
    founders can engage directly without going through the needs/RFP loop.
    """
    __tablename__ = "service_offerings"
    id: Optional[int] = Field(default=None, primary_key=True)
    uid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    partner_id: int = Field(foreign_key="partners.id", index=True)
    title: str
    description: str
    deliverables: str  # markdown / newline-separated bullets
    category: str = Field(index=True)  # mirrors marketplace VALID_CATEGORIES
    price: float
    currency: str = Field(default="usd")
    sla_days: Optional[int] = None  # promised turnaround in calendar days
    listed: bool = Field(default=True, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class EngagementReview(SQLModel, table=True):
    """Task #51 — Two-sided rating, gated to post-`delivered` engagements.

    One row per (engagement, reviewer_role). Both founder and partner may
    rate each other; once both sides have rated (or one side rates and the
    other is past the auto-close window), the engagement transitions to
    `reviewed`.
    """
    __tablename__ = "engagement_reviews"
    id: Optional[int] = Field(default=None, primary_key=True)
    engagement_id: int = Field(foreign_key="engagements.id", index=True)
    reviewer_user_id: int = Field(foreign_key="users.id", index=True)
    reviewer_role: str = Field(index=True)  # founder | partner
    rating: int = Field(ge=1, le=5)
    comment: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class VCFund(SQLModel, table=True):
    """Canonical fund container. Replaces `entities` rows of type 'vc_fund'."""
    __tablename__ = "vc_funds"
    id: Optional[int] = Field(default=None, primary_key=True)
    uid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    name: str = Field(unique=True, index=True)
    vintage_year: Optional[int] = None
    total_commitment: float = 0
    deployed_capital: float = 0
    lp_count: int = 0
    status: str = "active"  # fundraising | active | closed | wound_down
    jurisdiction: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class LimitedPartner(SQLModel, table=True):
    """Canonical LP record. Replaces the legacy flat `lp_investors` table.
    Each LP is scoped to exactly one fund via `fund_id`."""
    __tablename__ = "limited_partners"
    id: Optional[int] = Field(default=None, primary_key=True)
    uid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    fund_id: int = Field(foreign_key="vc_funds.id", index=True)
    user_id: Optional[int] = Field(default=None, foreign_key="users.id", index=True)
    name: str
    email: str = Field(index=True)
    commitment_amount: float = 0
    invested_amount: float = 0  # equivalent to legacy `called_capital`
    returns: float = 0
    status: str = "active"  # committed | active | redeemed
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class Investor(SQLModel, table=True):
    """Phase 0.1 — capital allocator profile. One row per investor user.

    Replaces the conflated 'partner = service-provider OR LP/VC' role.
    The `investor` UserRole is the canonical identity; this row carries
    the funding profile (check size, sector / stage focus, accreditation).
    A single user is linked via `User.investor_id`.
    """
    __tablename__ = "investors"
    id: Optional[int] = Field(default=None, primary_key=True)
    uid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    user_id: Optional[int] = Field(default=None, foreign_key="users.id", index=True)
    # 'lp' | 'vc' | 'angel' | 'scout' | 'family_office' | 'corporate'
    investor_type: str = Field(default="angel", index=True)
    # 'unverified' | 'self_attested' | 'verified' | 'rejected'
    accreditation_status: str = Field(default="unverified", index=True)
    check_size_min: Optional[float] = None
    check_size_max: Optional[float] = None
    sector_focus: Optional[str] = None  # comma-separated tags or JSON string
    stage_focus: Optional[str] = None   # comma-separated stages
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class LPInvestor(SQLModel, table=True):
    """DEPRECATED — superseded by `LimitedPartner` + `VCFund`. Retained as a
    read-only legacy table so the consolidation migration can backfill, and so
    historical rows remain queryable. Do not write new rows here."""
    __tablename__ = "lp_investors"
    id: Optional[int] = Field(default=None, primary_key=True)
    uid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    name: str
    email: str = Field(unique=True, index=True)
    committed_capital: float = 0
    called_capital: float = 0
    fund_name: Optional[str] = None
    status: str = "active"
    created_at: datetime = Field(default_factory=datetime.utcnow)


class CapitalCall(SQLModel, table=True):
    __tablename__ = "capital_calls"
    id: Optional[int] = Field(default=None, primary_key=True)
    uid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    # Canonical FK going forward:
    limited_partner_id: Optional[int] = Field(default=None, foreign_key="limited_partners.id", index=True)
    # Legacy FK retained for backward compatibility with old rows. New code should
    # always populate `limited_partner_id`. The startup migration backfills this
    # column for any rows that still only have `lp_investor_id`.
    lp_investor_id: Optional[int] = Field(default=None, foreign_key="lp_investors.id")
    project_id: Optional[int] = Field(default=None, foreign_key="projects.id")
    amount: float
    status: str = "pending"
    due_date: Optional[date] = None
    paid_date: Optional[date] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Ticket(SQLModel, table=True):
    __tablename__ = "tickets"
    id: Optional[int] = Field(default=None, primary_key=True)
    uid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    title: str
    description: Optional[str] = None
    priority: TicketPriority = TicketPriority.MEDIUM
    status: TicketStatus = TicketStatus.OPEN
    submitted_by: Optional[str] = None
    assigned_to: Optional[str] = None
    user_id: Optional[int] = Field(default=None, foreign_key="users.id", index=True)
    project_id: Optional[int] = Field(default=None, foreign_key="projects.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class Integration(SQLModel, table=True):
    __tablename__ = "integrations"
    __table_args__ = (
        __import__("sqlalchemy").Index("ix_integration_user_provider", "user_id", "provider_name"),
    )
    id: Optional[int] = Field(default=None, primary_key=True)
    uid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    integration_type: str = Field(index=True)  # crm | legal_provider | data_feed | custom
    provider_name: str = Field(index=True)     # hubspot | salesforce | sumsub | stripe_atlas | cooley | custom
    display_name: Optional[str] = None
    api_key_encrypted: Optional[str] = None     # Fernet-encrypted
    webhook_secret_encrypted: Optional[str] = None
    config_json: Optional[str] = None           # JSON-encoded extra settings
    status: str = Field(default="active", index=True)  # active | paused | error
    last_synced_at: Optional[datetime] = None
    last_error: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class PipelineVote(SQLModel, table=True):
    """Community vote on a pipeline deal.

    One row per (deal_id, user_id). When a user re-votes we UPDATE in place
    rather than insert. Weight is computed at write time from the user's
    role + LP status so the GET tally endpoint is a single SUM query.
    """
    __tablename__ = "pipeline_votes"
    __table_args__ = (
        UniqueConstraint("deal_id", "user_id", name="uq_pipeline_vote_deal_user"),
    )
    id: Optional[int] = Field(default=None, primary_key=True)
    deal_id: int = Field(foreign_key="deals.id", index=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    vote_type: str = Field(index=True)  # Strong_Buy | Buy | Hold | Pass
    weight: int = Field(default=1)      # 3 = investor/admin, 2 = partner, 1 = founder
    comment: Optional[str] = None
    anonymous: bool = Field(default=False)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class OnboardingMessage(SQLModel, table=True):
    """Persisted transcript of the sign-up chatbot conversation.

    The live chat lives in a Cloudflare Durable Object; the worker mirrors
    each turn here so the FastAPI admin console can render it on the user
    profile modal even when the DO is offline.
    """
    __tablename__ = "onboarding_messages"
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    role: str = Field(index=True)              # "user" | "assistant" | "system"
    content: str
    extracted_persona: Optional[str] = None    # AI-extracted role guess at this turn
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class IntegrationLog(SQLModel, table=True):
    __tablename__ = "integration_logs"
    id: Optional[int] = Field(default=None, primary_key=True)
    integration_id: int = Field(foreign_key="integrations.id", index=True)
    direction: str = Field(index=True)   # inbound | outbound
    event_type: str = Field(index=True)
    status: str = Field(default="ok", index=True)  # ok | error
    payload_json: Optional[str] = None
    response_summary: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)


# ===========================================================================
# Growth & Expansion Track — Task 1: Company Profile System
# ===========================================================================
# Free-form `stage` (text, not enum) so we can add new stages without
# requiring a SQL migration on existing rows. Recommended values:
# 'Seed', 'Series A', 'Series B', 'Series C', 'Growth', 'Profitable', 'Scale'
# JSON-encoded text columns for `current_products`, `international_presence`,
# and `expansion_goals` (matches the pattern used elsewhere in this file).

class CompanyProfile(SQLModel, table=True):
    __tablename__ = "company_profiles"
    id: Optional[int] = Field(default=None, primary_key=True)
    uid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    company_name: str = Field(index=True)
    stage: Optional[str] = Field(default=None, index=True)         # 'Seed' | 'Series A' | 'Profitable' | ...
    revenue_range: Optional[str] = Field(default=None, index=True) # '$0-1M' | '$1-5M' | '$5-20M' | '$20M+'
    employee_count: Optional[int] = None
    current_products: Optional[str] = None        # JSON array or free text
    international_presence: Optional[str] = None  # JSON array of country codes (e.g. ["US","DE","JP"])
    expansion_goals: Optional[str] = None         # JSON {target_markets, products, partners}
    logo_url: Optional[str] = None                # R2 key once uploads land in Step 6
    website: Optional[str] = None
    linkedin_url: Optional[str] = None
    description: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


# ===========================================================================
# Growth & Expansion Track — Task 4: International Expansion Toolkit
# ===========================================================================
# Country-keyed reference data (ISO-3166 alpha-2 codes, e.g. "DE", "BR").
# `market_insights` is a JSON-encoded text blob: { quick_facts, growth_rate,
# key_regulations, opportunities } — kept free-text to avoid migrations.
# `file_key` on jurisdiction_templates is a future R2 object key.

class Country(SQLModel, table=True):
    __tablename__ = "countries"
    code: str = Field(primary_key=True, max_length=2)        # ISO-3166 alpha-2
    name: str = Field(index=True)
    region: Optional[str] = Field(default=None, index=True)  # e.g. "EMEA", "APAC", "LATAM"
    currency: Optional[str] = Field(default=None, max_length=3)  # ISO-4217
    market_insights: Optional[str] = None  # JSON: quick_facts, growth_rate, regulations, opportunities
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class CountryComplianceItem(SQLModel, table=True):
    __tablename__ = "country_compliance_checklists"
    id: Optional[int] = Field(default=None, primary_key=True)
    country_code: str = Field(foreign_key="countries.code", index=True, max_length=2)
    category: str = Field(index=True)   # 'legal' | 'tax' | 'employment' | 'data_protection' | ...
    item_text: str
    is_required: bool = Field(default=True)
    sort_order: int = Field(default=0)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class LocalPartner(SQLModel, table=True):
    __tablename__ = "local_partners"
    id: Optional[int] = Field(default=None, primary_key=True)
    uid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    country_code: str = Field(foreign_key="countries.code", index=True, max_length=2)
    partner_name: str = Field(index=True)
    partner_type: str = Field(index=True)  # 'distributor' | 'reseller' | 'legal_firm' | 'tech_partner' | ...
    expertise: Optional[str] = None
    contact_info: Optional[str] = None     # JSON: { email, phone, website, linkedin }
    notes: Optional[str] = None
    status: str = Field(default="active", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class JurisdictionTemplate(SQLModel, table=True):
    __tablename__ = "jurisdiction_templates"
    id: Optional[int] = Field(default=None, primary_key=True)
    uid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    country_code: str = Field(foreign_key="countries.code", index=True, max_length=2)
    template_type: str = Field(index=True)  # 'tax_setup' | 'company_formation' | 'employment_contract' | ...
    title: str
    description: Optional[str] = None
    file_key: Optional[str] = None          # R2 object key (uploaded later)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class GrowthSprint(SQLModel, table=True):
    """Growth-track sibling to the spin-out flow.

    Recommended `current_stage` values (free-text to avoid enum lock-in):
      'Market Entry' | 'Product Localization' | 'Partner Onboarding' |
      'Scaling Capital' | 'International Launch' | 'Revenue Growth Review'
    """
    __tablename__ = "growth_sprints"
    id: Optional[int] = Field(default=None, primary_key=True)
    uid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    deal_id: int = Field(foreign_key="deals.id", index=True)
    company_id: Optional[int] = Field(default=None, foreign_key="company_profiles.id", index=True)
    current_stage: Optional[str] = Field(default="Market Entry", index=True)
    current_revenue: Optional[float] = Field(default=None, index=True)   # USD
    target_revenue: Optional[float] = Field(default=None, index=True)    # USD
    expansion_markets: Optional[str] = None  # JSON array of country codes
    new_product_ideas: Optional[str] = None  # JSON
    partner_needs: Optional[str] = None      # JSON
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class Notification(SQLModel, table=True):
    """Phase 0.2 — single notification subsystem.

    Every later feature publishes via `notify(user_id, type, payload, channels)`
    in `backend/app/services/notify.py`; this row is the in-app surface, while
    `channel` records *which* channels were dispatched (in_app/email/slack).
    `payload` is JSON so each event-type can carry arbitrary structured data
    (deal id, score, capital call amount, etc.) without schema churn.
    """
    __tablename__ = "notifications_inbox"  # avoid clash with worker-side `notifications`
    id: Optional[int] = Field(default=None, primary_key=True)
    uid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    type: str = Field(index=True)               # e.g. 'capital_call_issued'
    title: str
    body: Optional[str] = None
    link: Optional[str] = None                  # in-app deep link
    payload: Optional[str] = None               # JSON blob
    channel: str = Field(default="in_app", index=True)  # csv: in_app,email,slack
    read_at: Optional[datetime] = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class UserCompanyLink(SQLModel, table=True):
    __tablename__ = "user_company_links"
    __table_args__ = (
        UniqueConstraint("user_id", "company_id", name="uq_user_company"),
    )
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    company_id: int = Field(foreign_key="company_profiles.id", index=True)
    role_in_company: str = Field(default="Member", index=True)  # 'Founder' | 'Admin' | 'Advisor' | 'Member'
    is_primary_admin: bool = Field(default=False, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class FinancialModel(SQLModel, table=True):
    __tablename__ = "financial_models"
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="projects.id", index=True, unique=True)
    assumptions_json: str = Field(default="{}")
    computed_json: str = Field(default="{}")
    sensitivity_json: str = Field(default="{}")
    capital_recompute_json: Optional[str] = None
    updated_by: Optional[int] = Field(default=None, foreign_key="users.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


# ---------------------------------------------------------------------------
# Task #28 — Customer discovery / roadmap / metrics
# Three tables that feed real signals into the scoring algo instead of
# self-report. See `backend/app/api/routes/progress.py`.
# ---------------------------------------------------------------------------
class Interview(SQLModel, table=True):
    __tablename__ = "interviews"
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="projects.id", index=True)
    interviewee_name: str
    interviewee_role: Optional[str] = None
    interview_date: date = Field(default_factory=date.today, index=True)
    notes: str = ""                      # Mom-Test interview notes
    hypotheses_json: str = "[]"          # [{hypothesis, status, evidence}]
    pains_json: str = "[]"               # ["pain text", ...]
    created_by: Optional[int] = Field(default=None, foreign_key="users.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class OKR(SQLModel, table=True):
    __tablename__ = "okrs"
    id: Optional[int] = Field(default=None, primary_key=True)
    uid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    project_id: int = Field(foreign_key="projects.id", index=True)
    objective: str
    key_results_json: str = "[]"         # [{text, target, current, unit}]
    kanban_status: str = Field(default="now", index=True)  # now | next | later | done
    quarter: Optional[str] = None        # e.g. "2026-Q2"
    sort_order: int = 0
    created_by: Optional[int] = Field(default=None, foreign_key="users.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class MetricsSnapshot(SQLModel, table=True):
    __tablename__ = "metrics_snapshots"
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="projects.id", index=True)
    snapshot_date: date = Field(default_factory=date.today, index=True)
    mrr: Optional[float] = None
    arr: Optional[float] = None
    cac: Optional[float] = None
    ltv: Optional[float] = None
    monthly_churn_pct: Optional[float] = None
    active_users: Optional[int] = None
    new_users: Optional[int] = None
    source: str = Field(default="manual", index=True)  # manual | stripe
    notes: Optional[str] = None
    created_by: Optional[int] = Field(default=None, foreign_key="users.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
