from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from backend.app.database import get_session
from backend.app.models.entities import Document, Entity, Project, DocumentType, DocumentStatus
from backend.app.schemas.scoring import DocumentCreate
from datetime import datetime

router = APIRouter(prefix="/legal", tags=["Legal & Compliance"])

TEMPLATES = {
    "safe": {
        "title": "SAFE Agreement",
        "content": """SIMPLE AGREEMENT FOR FUTURE EQUITY (SAFE)

Company: {company_name}
Investor: ____________________
Purchase Amount: $____________________

This SAFE certifies that in exchange for the payment by the Investor of the Purchase Amount
on or about the date of this SAFE, the Company hereby issues to the Investor the right to
certain shares of the Company's capital stock, subject to the terms set forth below.

1. EVENTS
(a) Equity Financing: conversion at discount or valuation cap
(b) Liquidity Event: payment of Purchase Amount or conversion
(c) Dissolution Event: payment of Purchase Amount

2. DEFINITIONS
[Standard SAFE definitions apply]

3. COMPANY REPRESENTATIONS
The Company is duly organized and validly existing.

Signed: ____________________
Date: ____________________""",
    },
    "bylaws": {
        "title": "Corporate Bylaws",
        "content": """BYLAWS OF {company_name}
A Delaware Corporation

ARTICLE I - OFFICES
ARTICLE II - STOCKHOLDERS
ARTICLE III - DIRECTORS
ARTICLE IV - OFFICERS
ARTICLE V - STOCK
ARTICLE VI - INDEMNIFICATION
ARTICLE VII - AMENDMENTS

[Full bylaws template - generated automatically]
Date: ____________________""",
    },
    "equity_split": {
        "title": "Equity Split Agreement",
        "content": """EQUITY ALLOCATION AGREEMENT

Company: {company_name}
Effective Date: ____________________

FOUNDER ALLOCATION:
- Founder 1: __% vesting over 4 years, 1-year cliff
- Founder 2: __% vesting over 4 years, 1-year cliff
- Option Pool: 10% reserved for future employees
- Axal VC Studio: __% (studio equity)

VESTING SCHEDULE: Standard 4-year vesting with 1-year cliff.

Signed: ____________________""",
    },
    "ip_license": {
        "title": "IP License Agreement",
        "content": """INTELLECTUAL PROPERTY LICENSE AGREEMENT

Licensor: Axal VC HoldCo
Licensee: {company_name}

GRANT OF LICENSE: Licensor grants Licensee a non-exclusive, worldwide license
to use, modify, and commercialize the Licensed IP for the purpose of operating
the Licensee's business.

CONSIDERATION: In exchange for this license, Licensee agrees to the equity
allocation as specified in the Equity Split Agreement.

TERM: Perpetual, subject to the terms herein.

Signed: ____________________""",
    },
}


@router.get("/templates")
def list_templates():
    return [{"key": k, "title": v["title"]} for k, v in TEMPLATES.items()]


@router.post("/documents/generate")
def generate_document(data: DocumentCreate, session: Session = Depends(get_session)):
    template = TEMPLATES.get(data.doc_type)
    content = data.content
    if template and not content:
        company_name = "NewCo"
        if data.project_id:
            project = session.get(Project, data.project_id)
            if project:
                company_name = project.name
        content = template["content"].replace("{company_name}", company_name)

    doc = Document(
        project_id=data.project_id,
        title=data.title or (template["title"] if template else "Untitled"),
        doc_type=data.doc_type,
        status=DocumentStatus.GENERATED,
        content=content,
        template_name=data.template_name,
    )
    session.add(doc)
    session.commit()
    session.refresh(doc)
    return doc


@router.get("/documents")
def list_documents(project_id: int = None, session: Session = Depends(get_session)):
    stmt = select(Document).order_by(Document.created_at.desc())
    if project_id:
        stmt = stmt.where(Document.project_id == project_id)
    return session.exec(stmt).all()


@router.get("/documents/{doc_id}")
def get_document(doc_id: int, session: Session = Depends(get_session)):
    doc = session.get(Document, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.post("/documents/{doc_id}/send")
def send_document(doc_id: int, session: Session = Depends(get_session)):
    doc = session.get(Document, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    doc.status = DocumentStatus.SENT
    doc.updated_at = datetime.utcnow()
    session.add(doc)
    session.commit()
    session.refresh(doc)
    return {"status": "sent", "document": doc}


@router.post("/documents/{doc_id}/sign")
def sign_document(doc_id: int, signed_by: str = "system", session: Session = Depends(get_session)):
    doc = session.get(Document, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    doc.status = DocumentStatus.SIGNED
    doc.signed_by = signed_by
    doc.signed_at = datetime.utcnow()
    doc.updated_at = datetime.utcnow()
    session.add(doc)
    session.commit()
    session.refresh(doc)
    return {"status": "signed", "document": doc}


@router.post("/incorporate")
def incorporate_project(project_id: int, jurisdiction: str = "Delaware", session: Session = Depends(get_session)):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    entity = Entity(
        name=f"{project.name} Inc.",
        entity_type="subsidiary",
        jurisdiction=jurisdiction,
        incorporation_date=datetime.utcnow().date(),
        status="incorporated",
    )
    session.add(entity)
    session.commit()
    session.refresh(entity)

    project.entity_id = entity.id
    project.updated_at = datetime.utcnow()
    session.add(project)
    session.commit()

    for doc_type in ["bylaws", "equity_split", "ip_license"]:
        template = TEMPLATES[doc_type]
        doc = Document(
            project_id=project.id,
            title=template["title"],
            doc_type=doc_type,
            status=DocumentStatus.GENERATED,
            content=template["content"].replace("{company_name}", entity.name),
        )
        session.add(doc)
    session.commit()

    return {
        "entity": entity,
        "message": f"Incorporated {entity.name} in {jurisdiction}. Auto-generated bylaws, equity split, and IP license.",
    }


@router.get("/entities")
def list_entities(session: Session = Depends(get_session)):
    return session.exec(select(Entity).order_by(Entity.created_at.desc())).all()


@router.post("/spinout/{project_id}")
def spinout_project(project_id: int, session: Session = Depends(get_session)):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.status not in ["tier_1", "tier_2"]:
        raise HTTPException(status_code=400, detail="Project must pass scoring before spinout")

    if not project.entity_id:
        raise HTTPException(status_code=400, detail="Project must be incorporated first")

    project.status = "spinout"
    project.updated_at = datetime.utcnow()
    session.add(project)
    session.commit()
    session.refresh(project)

    return {"message": f"Project '{project.name}' has been spun out successfully.", "project": project}
