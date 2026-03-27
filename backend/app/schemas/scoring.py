from pydantic import BaseModel, Field
from typing import Optional


class ScoreRequest(BaseModel):
    project_id: Optional[int] = None
    startup_name: Optional[str] = None
    tam: float = Field(0, description="Total Addressable Market in USD")
    market_urgency: float = Field(0, ge=0, le=10)
    market_trend: float = Field(0, ge=0, le=5)
    team_expertise: float = Field(0, ge=0, le=8)
    team_execution: float = Field(0, ge=0, le=8)
    team_network: float = Field(0, ge=0, le=4)
    mvp_time_days: float = Field(90, ge=1)
    product_complexity: float = Field(3, ge=0, le=5)
    product_dependencies: float = Field(2, ge=0, le=3)
    cost_to_mvp: float = Field(100000, ge=0)
    time_to_revenue_months: float = Field(12, ge=0)
    burn_risk: float = Field(2, ge=0, le=3)
    fit_alignment: float = Field(0, ge=0, le=10)
    fit_synergy: float = Field(0, ge=0, le=5)
    distribution_channels: float = Field(0, ge=0, le=5)
    distribution_virality: float = Field(0, ge=0, le=5)
    ai_adjustment: float = Field(0, ge=-5, le=5)


class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = None
    sector: Optional[str] = None
    stage: str = "idea"
    founder_name: Optional[str] = None
    founder_email: Optional[str] = None
    problem_statement: Optional[str] = None
    solution: Optional[str] = None
    why_now: Optional[str] = None
    tam: Optional[float] = None
    sam: Optional[float] = None
    cost_to_mvp: Optional[float] = None
    funding_needed: Optional[float] = None
    use_of_funds: Optional[str] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    sector: Optional[str] = None
    stage: Optional[str] = None
    status: Optional[str] = None
    playbook_week: Optional[str] = None
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


class FounderCreate(BaseModel):
    name: str
    email: str
    linkedin_url: Optional[str] = None
    domain_expertise: Optional[str] = None
    experience_years: int = 0
    bio: Optional[str] = None


class PartnerCreate(BaseModel):
    name: str
    company: Optional[str] = None
    email: str
    specialization: Optional[str] = None


class LPInvestorCreate(BaseModel):
    name: str
    email: str
    committed_capital: float = 0
    fund_name: Optional[str] = None


class CapitalCallCreate(BaseModel):
    lp_investor_id: int
    project_id: Optional[int] = None
    amount: float
    due_date: Optional[str] = None


class DocumentCreate(BaseModel):
    project_id: Optional[int] = None
    title: str
    doc_type: str = "other"
    content: Optional[str] = None
    template_name: Optional[str] = None


class TicketCreate(BaseModel):
    title: str
    description: Optional[str] = None
    priority: str = "medium"
    submitted_by: Optional[str] = None
    project_id: Optional[int] = None


class UserCreate(BaseModel):
    email: str
    name: str
    role: str = Field("founder", pattern="^(admin|founder|partner)$")
    password: Optional[str] = None
    founder_id: Optional[int] = None
    partner_id: Optional[int] = None


class DealCreate(BaseModel):
    project_id: int
    partner_id: Optional[int] = None
    status: str = Field("applied", pattern="^(applied|scored|active|funded|rejected)$")
    notes: Optional[str] = None
    amount: Optional[float] = None


class DealUpdate(BaseModel):
    status: Optional[str] = None
    partner_id: Optional[int] = None
    notes: Optional[str] = None
    amount: Optional[float] = None


class MatchPartnersRequest(BaseModel):
    sector: Optional[str] = None
    capital_needed: Optional[float] = None
    expertise_needed: Optional[str] = None
    startup_id: Optional[int] = None


class GenerateMemoRequest(BaseModel):
    startup_name: str
    problem: Optional[str] = None
    solution: Optional[str] = None
    traction: Optional[str] = None
    sector: Optional[str] = None
    tam: Optional[float] = None
    team_info: Optional[str] = None
    funding_needed: Optional[float] = None
    use_of_funds: Optional[str] = None
    risks: Optional[str] = None


class CapitalCallRequest(BaseModel):
    startup_id: int
    amount: float = Field(gt=0, description="Amount must be positive")


class FounderSubmitRequest(BaseModel):
    name: str
    description: Optional[str] = None
    sector: Optional[str] = None
    founder_name: str
    founder_email: str
    problem_statement: Optional[str] = None
    solution: Optional[str] = None
    why_now: Optional[str] = None
    tam: Optional[float] = None
    sam: Optional[float] = None
    cost_to_mvp: Optional[float] = None
    funding_needed: Optional[float] = None
    use_of_funds: Optional[str] = None
    market_urgency: float = 5
    market_trend: float = 3
    team_expertise: float = 5
    team_execution: float = 5
    team_network: float = 2
    mvp_time_days: float = 60
    product_complexity: float = 3
    product_dependencies: float = 2
    time_to_revenue_months: float = 12
    burn_risk: float = 2
    fit_alignment: float = 5
    fit_synergy: float = 3
    distribution_channels: float = 3
    distribution_virality: float = 3
