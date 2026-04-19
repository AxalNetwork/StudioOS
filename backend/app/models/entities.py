from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import UniqueConstraint
from typing import Optional, List
from datetime import datetime, date
from enum import Enum
import uuid


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
    PARTNER = "partner"


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
    is_active: bool = True
    email_verified: bool = False
    verification_token: Optional[str] = None
    verification_token_expires: Optional[datetime] = None
    admin_notes: Optional[str] = None
    last_active_at: Optional[datetime] = None
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


class Document(SQLModel, table=True):
    __tablename__ = "documents"
    id: Optional[int] = Field(default=None, primary_key=True)
    uid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    project_id: Optional[int] = Field(default=None, foreign_key="projects.id")
    title: str
    doc_type: DocumentType
    status: DocumentStatus = DocumentStatus.DRAFT
    content: Optional[str] = None
    template_name: Optional[str] = None
    signed_by: Optional[str] = None
    signed_at: Optional[datetime] = None
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
