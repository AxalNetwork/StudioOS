import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlmodel import Session
from backend.app.database import engine, init_db
from backend.app.models.entities import (
    Entity, Founder, Project, Partner, LimitedPartner, VCFund, Ticket,
)

def seed():
    init_db()

    with Session(engine) as session:
        holdco = Entity(name="Axal VC HoldCo", entity_type="holding_company", jurisdiction="Delaware", status="active")
        session.add(holdco)

        # Funds now live in the canonical `vc_funds` table (not `entities`).
        fund = VCFund(name="Axal Fund I", jurisdiction="Delaware", status="active")
        session.add(fund)
        session.commit()
        session.refresh(fund)

        f1 = Founder(name="Sarah Chen", email="sarah@nexusai.io", domain_expertise="AI/ML Infrastructure", experience_years=8, bio="Ex-Google ML engineer, 2x founder")
        f2 = Founder(name="Marcus Johnson", email="marcus@chainflow.xyz", domain_expertise="Blockchain/DeFi", experience_years=6, bio="Former Coinbase engineer, built DeFi protocols")
        f3 = Founder(name="Priya Patel", email="priya@datacortex.ai", domain_expertise="Data Analytics/Enterprise", experience_years=10, bio="Ex-Snowflake PM, data infrastructure expert")
        session.add_all([f1, f2, f3])
        session.commit()
        session.refresh(f1)
        session.refresh(f2)
        session.refresh(f3)

        p1 = Project(
            name="NexusAI", description="AI-powered middleware for enterprise API orchestration",
            sector="AI/Infrastructure", stage="mvp", status="intake", playbook_week="week_1",
            founder_id=f1.id, problem_statement="Enterprises waste 40% of dev time on API integrations",
            solution="AI middleware that auto-generates and maintains API connectors",
            why_now="LLMs now capable of understanding API schemas at scale",
            tam=2_000_000_000, sam=400_000_000, cost_to_mvp=35000, funding_needed=500000,
            use_of_funds="Engineering (60%), Sales (25%), Ops (15%)",
        )
        p2 = Project(
            name="ChainFlow", description="Decentralized treasury management for DAOs",
            sector="Blockchain/DeFi", stage="idea", status="intake", playbook_week="week_1",
            founder_id=f2.id, problem_statement="DAOs lose millions to poor treasury management",
            solution="Automated treasury allocation using smart contracts and AI risk models",
            why_now="DAO treasuries now hold $25B+ with minimal tooling",
            tam=800_000_000, sam=150_000_000, cost_to_mvp=60000, funding_needed=750000,
            use_of_funds="Engineering (70%), Security Audits (20%), Marketing (10%)",
        )
        p3 = Project(
            name="DataCortex", description="Real-time data observability for AI pipelines",
            sector="Data/Analytics", stage="prototype", status="intake", playbook_week="week_2",
            founder_id=f3.id, problem_statement="ML teams can't debug data quality issues in production",
            solution="Observability platform that monitors data drift, schema changes, and pipeline health",
            why_now="AI adoption is exploding but data quality tooling hasn't kept pace",
            tam=5_000_000_000, sam=1_000_000_000, users_count=12, revenue=2400,
            growth_signals="3 design partners, 12 beta users, 40% WoW growth",
            cost_to_mvp=25000, funding_needed=1_000_000,
            use_of_funds="Engineering (55%), GTM (30%), Infrastructure (15%)",
        )
        session.add_all([p1, p2, p3])

        partners = [
            Partner(name="TechStars Ventures", company="TechStars", email="deals@techstars.com", specialization="AI/SaaS", referral_code="AXAL-TS2026"),
            Partner(name="a16z Crypto", company="Andreessen Horowitz", email="crypto@a16z.com", specialization="Blockchain/Web3", referral_code="AXAL-A16Z"),
            Partner(name="Sequoia Scout", company="Sequoia Capital", email="scout@sequoia.com", specialization="Enterprise/Data", referral_code="AXAL-SEQ01"),
        ]
        session.add_all(partners)

        investors = [
            LimitedPartner(fund_id=fund.id, name="Horizon Capital", email="invest@horizoncap.com", commitment_amount=5_000_000),
            LimitedPartner(fund_id=fund.id, name="Pacific Ventures", email="lp@pacificvc.com", commitment_amount=2_500_000),
        ]
        session.add_all(investors)

        tickets_list = [
            Ticket(title="API rate limit issue", description="Scoring API times out on large batch requests", priority="high", submitted_by="sarah@nexusai.io", status="open"),
            Ticket(title="Document template update", description="SAFE template needs updated valuation cap language", priority="medium", submitted_by="system", status="in_progress"),
        ]
        session.add_all(tickets_list)

        session.commit()
        print("Seed data inserted successfully!")
        print(f"  - 2 Entities (HoldCo + Fund)")
        print(f"  - 3 Founders")
        print(f"  - 3 Projects (NexusAI, ChainFlow, DataCortex)")
        print(f"  - 3 Partners")
        print(f"  - 2 LP Investors")
        print(f"  - 2 Support Tickets")

if __name__ == "__main__":
    seed()
