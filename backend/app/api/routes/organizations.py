"""Task #16 — Organizations directory read API (Network > Organizations).

Serves the real VC funds / deep-tech investors imported into the
`organizations` table (see services/organizations_import.py). Read-only:

  GET /organizations         → paginated + searchable/filterable list
  GET /organizations/facets  → type / region / source counts for filter chips
  GET /organizations/{uid}   → full profile detail

Any authenticated user may browse the directory.
"""
from __future__ import annotations

import json
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlmodel import Session, select

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import Organization, User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/organizations", tags=["Organizations"])

MAX_PAGE_SIZE = 100


def _loads(value: Optional[str], fallback):
    try:
        return json.loads(value) if value else fallback
    except (ValueError, TypeError):
        return fallback


def _summary(o: Organization) -> dict:
    return {
        "uid": o.uid,
        "name": o.name,
        "org_type": o.org_type,
        "hq_country": o.hq_country,
        "website": o.website,
        "source": o.source,
        "fund_size": o.fund_size,
        "sector_tags": _loads(o.sector_tags_json, []),
        "region_focus": _loads(o.region_focus_json, []),
        "stage_focus": _loads(o.stage_focus_json, []),
    }


def _detail(o: Organization) -> dict:
    return {
        **_summary(o),
        "linkedin": o.linkedin,
        "parent_company": o.parent_company,
        "sector_focus_text": o.sector_focus_text,
        "fund_number": o.fund_number,
        "latest_fund_date": o.latest_fund_date,
        "notable_lps": o.notable_lps,
        "min_ticket": o.min_ticket,
        "max_ticket": o.max_ticket,
        "deep_tech_only": o.deep_tech_only,
        "dt_deal_count": o.dt_deal_count,
        "additional_focus": o.additional_focus,
        "yearly_raised": _loads(o.yearly_raised_json, {}),
    }


@router.get("")
def list_organizations(
    q: Optional[str] = Query(default=None),
    type: Optional[str] = Query(default=None),
    region: Optional[str] = Query(default=None),
    source: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=24, ge=1, le=MAX_PAGE_SIZE),
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_user),
):
    stmt = select(Organization)
    count_stmt = select(func.count()).select_from(Organization)

    conditions = []
    if q:
        like = f"%{q.strip().lower()}%"
        conditions.append(or_(
            func.lower(Organization.name).like(like),
            func.lower(func.coalesce(Organization.hq_country, "")).like(like),
            func.lower(func.coalesce(Organization.org_type, "")).like(like),
            func.lower(func.coalesce(Organization.sector_focus_text, "")).like(like),
            func.lower(func.coalesce(Organization.sector_tags_json, "")).like(like),
        ))
    if type:
        conditions.append(Organization.org_type == type)
    if source:
        conditions.append(Organization.source == source)
    if region:
        # region_focus is stored as a JSON array of labels; match the label
        # literally inside the JSON text (labels have no JSON-special chars).
        conditions.append(func.lower(func.coalesce(Organization.region_focus_json, "")).like(
            f'%"{region.lower()}"%'
        ))

    for c in conditions:
        stmt = stmt.where(c)
        count_stmt = count_stmt.where(c)

    total = session.exec(count_stmt).one()
    stmt = stmt.order_by(Organization.name).offset((page - 1) * page_size).limit(page_size)
    items = [_summary(o) for o in session.exec(stmt).all()]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/facets")
def organization_facets(
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_user),
):
    """Distinct types + source counts, plus the fixed region label set with
    counts, so the frontend can render data-driven filter chips."""
    type_rows = session.exec(
        select(Organization.org_type, func.count())
        .where(Organization.org_type.is_not(None))
        .group_by(Organization.org_type)
        .order_by(func.count().desc())
    ).all()
    source_rows = session.exec(
        select(Organization.source, func.count()).group_by(Organization.source)
    ).all()
    total = session.exec(select(func.count()).select_from(Organization)).one()
    types = [{"value": t, "count": c} for t, c in type_rows if t]

    region_labels = ["Europe", "Israel", "USA", "Canada", "Asia", "Worldwide", "Other"]
    regions = []
    for label in region_labels:
        c = session.exec(
            select(func.count()).select_from(Organization).where(
                func.lower(func.coalesce(Organization.region_focus_json, "")).like(
                    f'%"{label.lower()}"%'
                )
            )
        ).one()
        if c:
            regions.append({"value": label, "count": c})

    return {
        "total": total,
        "types": types,
        "regions": regions,
        "sources": [{"value": s, "count": c} for s, c in source_rows],
    }


@router.get("/{uid}")
def get_organization(
    uid: str,
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_user),
):
    org = session.exec(select(Organization).where(Organization.uid == uid)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    return _detail(org)
