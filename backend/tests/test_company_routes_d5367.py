"""D5367 — exercise the Replit-dev company router through FastAPI TestClient.

The Cloudflare Worker remains production. These tests keep the optional dev
router honest about D4960/D4962 at its HTTP and SQLite boundaries.

Run: python3 -m unittest backend/tests/test_company_routes_d5367.py
"""
import os
import pathlib
import tempfile
import unittest

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("JWT_SECRET", "ci-company-route-test-secret-0123456789abcdef")

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine

from backend.app.api.routes import company
from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import ActivityLog, CompanyProfile, User, UserCompanyLink, UserRole


class CompanyRouteContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix="studioos-company-")
        db_path = pathlib.Path(cls.tmp.name) / "company.db"
        cls.engine = create_engine(
            f"sqlite:///{db_path}", connect_args={"check_same_thread": False},
        )
        cls.app = FastAPI()
        cls.app.include_router(company.router, prefix="/api")

        def session_override():
            with Session(cls.engine) as session:
                yield session

        def user_override(request: Request):
            user_id = int(request.headers["x-test-user"])
            with Session(cls.engine) as session:
                return session.get(User, user_id)

        cls.app.dependency_overrides[get_session] = session_override
        cls.app.dependency_overrides[get_current_user] = user_override
        cls.client = TestClient(cls.app)

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        cls.engine.dispose()
        cls.tmp.cleanup()

    def setUp(self):
        tables = [User.__table__, CompanyProfile.__table__, UserCompanyLink.__table__, ActivityLog.__table__]
        SQLModel.metadata.drop_all(self.engine, tables=tables)
        SQLModel.metadata.create_all(self.engine, tables=tables)
        with Session(self.engine) as session:
            session.add_all([
                User(id=1, email="member@example.test", name="Member", role=UserRole.FOUNDER),
                User(id=2, email="stranger@example.test", name="Stranger", role=UserRole.FOUNDER),
                User(id=3, email="hq@example.test", name="HQ", role=UserRole.ADMIN),
                User(id=4, email="hq-seat@example.test", name="HQ Seat", role=UserRole.ADMIN),
                User(id=5, email="editor@example.test", name="Editor", role=UserRole.FOUNDER),
            ])
            session.add(CompanyProfile(id=1, uid="co-north", company_name="Northwind", description="Before"))
            session.add_all([
                UserCompanyLink(user_id=1, company_id=1, role_in_company="Member"),
                UserCompanyLink(user_id=4, company_id=1, role_in_company="Admin"),
                UserCompanyLink(user_id=5, company_id=1, role_in_company="Founder"),
            ])
            session.commit()

    def request(self, method, path, user_id, **kwargs):
        return self.client.request(method, path, headers={"x-test-user": str(user_id)}, **kwargs)

    def stored_description(self):
        with Session(self.engine) as session:
            return session.get(CompanyProfile, 1).description

    def test_member_non_member_and_platform_admin_reads(self):
        member = self.request("GET", "/api/company/co-north", 1)
        self.assertEqual(member.status_code, 200)
        self.assertEqual(member.json()["viewer"], {
            "member": True, "can_edit": False, "read_only": True, "read_only_reason": "not_an_editor",
        })
        self.assertEqual(self.request("GET", "/api/company/co-north", 2).status_code, 404)
        hq = self.request("GET", "/api/company/co-north", 3)
        self.assertEqual(hq.status_code, 200)
        self.assertEqual(hq.json()["viewer"]["read_only_reason"], "hq_access")

    def test_platform_admin_without_a_seat_is_read_only_but_admin_with_a_seat_writes(self):
        refused = self.request("PATCH", "/api/company/co-north", 3, json={"description": "HQ wrote"})
        self.assertEqual((refused.status_code, refused.json()["code"], refused.json()["reason"]), (403, "company_read_only", "hq_access"))
        self.assertEqual(self.stored_description(), "Before")

        written = self.request("PATCH", "/api/company/co-north", 4, json={"description": "Admin seat wrote"})
        self.assertEqual(written.status_code, 200)
        self.assertEqual(self.stored_description(), "Admin seat wrote")

    def test_company_editor_writes(self):
        response = self.request("PATCH", "/api/company/co-north", 5, json={"stage": "seed", "employee_count": "8"})
        self.assertEqual(response.status_code, 200)
        with Session(self.engine) as session:
            row = session.get(CompanyProfile, 1)
            self.assertEqual((row.stage, row.employee_count), ("seed", 8))

    def test_malformed_unknown_and_logo_url_patch_are_refused_without_writing(self):
        for body in (None, [], "text", 7):
            response = self.request("PATCH", "/api/company/co-north", 5, json=body)
            self.assertEqual((response.status_code, response.json()["code"]), (400, "body_invalid"), body)

        malformed = self.request("PATCH", "/api/company/co-north", 5, json={"stage": "hypergrowth"})
        self.assertEqual(
            (malformed.status_code, malformed.json()["code"], malformed.json()["field"]),
            (400, "stage_invalid", "stage"),
        )
        unknown = self.request("PATCH", "/api/company/co-north", 5, json={"archived_at": "2026-01-01"})
        self.assertEqual((unknown.status_code, unknown.json()["code"], unknown.json()["field"]), (400, "unknown_field", "archived_at"))
        logo = self.request("PATCH", "/api/company/co-north", 5, json={"logo_url": "https://example.test/logo.png"})
        self.assertEqual((logo.status_code, logo.json()["code"], logo.json()["field"]), (400, "logo_url_not_writable", "logo_url"))
        self.assertEqual(self.stored_description(), "Before")


if __name__ == "__main__":
    unittest.main()
