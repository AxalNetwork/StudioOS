from sqlmodel import SQLModel, Field, Relationship
from typing import Optional, List
from datetime import datetime, date
from enum import Enum
import uuid


class EntityType(str, Enum):
    HOLDING_COMPANY = "holding_company"
    PROJECT = "project"
    SUBSIDIARY = "subsidiary"
    VC_FUND = "vc_fund"


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


class DocumentStatus(str, Enum):
    DRAFT = "draft"
    GENERATED = "generated"
    SENT = "sent"
    SIGNED = "signed"


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
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class ActivityLog(SQLModel, table=True):
    __tablename__ = "activity_logs"
    id: Optional[int] = Field(default=None, primary_key=True)
    uid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True)
    project_id: Optional[int] = Field(default=None, foreign_key="projects.id")
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


class LPInvestor(SQLModel, table=True):
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
    lp_investor_id: int = Field(foreign_key="lp_investors.id")
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
    project_id: Optional[int] = Field(default=None, foreign_key="projects.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
