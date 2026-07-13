"""Task #16 — Organizations directory tests.

Verifies (a) the read API (list pagination + search + type/region filters,
facets counts, detail + 404) against an isolated in-memory SQLite DB, and
(b) the CSV import's dedupe/merge behavior against tiny temp fixtures.

Runs fully isolated — never touches the real Postgres DB or the shipped CSVs.
"""
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from backend.app.api.routes import organizations as orgs_route
from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import Organization, User

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
SQLModel.metadata.create_all(engine, tables=[User.__table__, Organization.__table__])


def _seed():
    with Session(engine) as s:
        s.add_all([
            Organization(
                uid="u-euro", name="Climentum", normalized_key="climentum",
                website="https://climentum.com/", org_type="VC Fund",
                hq_country="Denmark", fund_size="\u20ac 60m", fund_number="II",
                sector_focus_text="Climate-tech, energy",
                sector_tags_json="[]", region_focus_json="[]", stage_focus_json="[]",
                yearly_raised_json=json.dumps({"2026": "\u20ac 60m"}),
                source="euro_vc",
            ),
            Organization(
                uid="u-deep", name=".406 Ventures", normalized_key="406ventures",
                website="https://www.406ventures.com", org_type="VC",
                hq_country="USA", fund_size="$265M",
                sector_tags_json=json.dumps(["AI/ML", "Healthtech"]),
                region_focus_json=json.dumps(["USA"]),
                stage_focus_json=json.dumps(["Seed", "Series A"]),
                min_ticket="$2M", max_ticket="$5M", deep_tech_only=False,
                source="deep_tech",
            ),
            Organization(
                uid="u-both", name="Senovo", normalized_key="senovo",
                org_type="VC Fund", hq_country="Germany",
                sector_tags_json=json.dumps(["AI/ML", "Mobility"]),
                region_focus_json=json.dumps(["Europe"]),
                stage_focus_json=json.dumps(["Seed"]),
                source="both",
            ),
        ])
        s.commit()


@pytest.fixture(scope="module")
def client():
    _seed()
    app = FastAPI()
    app.include_router(orgs_route.router, prefix="/api")
    app.dependency_overrides[get_session] = lambda: (yield from _session())
    app.dependency_overrides[get_current_user] = lambda: User(id=1, email="t@t.io")
    return TestClient(app)


def _session():
    with Session(engine) as s:
        yield s


def test_list_all(client):
    r = client.get("/api/organizations")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 3
    assert len(body["items"]) == 3
    # ordered by name → ".406 Ventures" first
    assert body["items"][0]["name"] == ".406 Ventures"


def test_pagination(client):
    r = client.get("/api/organizations?page=1&page_size=2")
    b = r.json()
    assert b["total"] == 3 and len(b["items"]) == 2
    r2 = client.get("/api/organizations?page=2&page_size=2")
    assert len(r2.json()["items"]) == 1


def test_search(client):
    assert client.get("/api/organizations?q=climentum").json()["total"] == 1
    # search hits hq_country too
    assert client.get("/api/organizations?q=germany").json()["total"] == 1
    assert client.get("/api/organizations?q=nomatchxyz").json()["total"] == 0


def test_type_and_region_filter(client):
    assert client.get("/api/organizations?type=VC Fund").json()["total"] == 2
    assert client.get("/api/organizations?region=USA").json()["total"] == 1
    assert client.get("/api/organizations?region=Europe").json()["total"] == 1
    assert client.get("/api/organizations?source=both").json()["total"] == 1


def test_facets(client):
    f = client.get("/api/organizations/facets").json()
    assert f["total"] == 3
    types = {t["value"]: t["count"] for t in f["types"]}
    assert types["VC Fund"] == 2 and types["VC"] == 1
    regions = {r["value"]: r["count"] for r in f["regions"]}
    assert regions["USA"] == 1 and regions["Europe"] == 1


def test_detail_and_404(client):
    d = client.get("/api/organizations/u-deep").json()
    assert d["name"] == ".406 Ventures"
    assert d["sector_tags"] == ["AI/ML", "Healthtech"]
    assert d["min_ticket"] == "$2M"
    assert client.get("/api/organizations/does-not-exist").status_code == 404


# --- importer dedupe/merge --------------------------------------------------
def test_import_merge_across_files(tmp_path, monkeypatch):
    from backend.app.services import organizations_import as imp

    euro = tmp_path / "euro.csv"
    deep = tmp_path / "deep.csv"
    # Euro header: cols 0-10 fixed, then years. Include 2026 year column.
    euro.write_text(
        "Fund Name,Web,LI,Main HQ,#,,,Qtr,,Sector focus,Notable Known LPs,,,2026\n"
        "Senovo,https://senovo.vc/,,\U0001F1E9\U0001F1EA Germany,IV,\u20ac 88m,1 Jul 26,Q3 26,2026,B2B-software,,,,\u20ac 88m\n",
        encoding="utf-8",
    )
    # Deep header line (positional layout); one Senovo row with x-marked tags.
    deep_header = "Name,x,Website,Type,Parent,Country,DT Only?,# deals,Size,Date," \
        "PS,S,A,B,Min,Max,EU,IL,US,CA,AS,WW,OT,Aero,AIML,Elec,Rob,Ener,Mat,HT,Bio,Food,Clean,Mob,Add\n"
    deep_row = "Senovo,,https://senovo.vc/,VC,,\U0001F1E9\U0001F1EA Germany,No,12,,,,x,,,,,x,,,,,,,,x,,,,,,,,,,\n"
    deep.write_text(deep_header + deep_row, encoding="utf-8")

    monkeypatch.setattr(imp, "EURO_FILE", euro)
    monkeypatch.setattr(imp, "DEEP_FILE", deep)

    records = imp.build_records()
    assert len(records) == 1  # merged into one org
    rec = records["senovo"]
    assert rec["source"] == "both"
    assert rec["hq_country"] == "Germany"        # flag emoji stripped
    assert rec["fund_size"] == "\u20ac 88m"       # euro scalar preserved
    assert rec["org_type"] == "VC Fund"           # euro scalar wins (present first)
    assert "AI/ML" in rec["sector_tags"]          # deep-tech tag merged in
    assert rec["region_focus"] == ["Europe"]
    assert rec["yearly_raised"] == {"2026": "\u20ac 88m"}


def test_placeholder_tokens_become_none():
    from backend.app.services.organizations_import import _opt
    assert _opt("--") is None
    assert _opt("n/a") is None
    assert _opt("$5M") == "$5M"
