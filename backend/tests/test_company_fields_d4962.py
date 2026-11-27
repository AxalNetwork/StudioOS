"""D4962 — the dev backend's company field contract, against the golden cases the Worker runs.

Run: python3 -m unittest backend/tests/test_company_fields_d4962.py  (or pytest). No FastAPI or database needed.
"""
import importlib.util
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("company_fields", ROOT / "backend/app/services/company_fields.py")
fields = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fields)

CASES = json.loads((ROOT / "cloudflare-worker/test/fixtures/company_field_cases.json").read_text(encoding="utf-8"))["cases"]


def _input(case):
    return str(case["input"]) * case["repeat"] if case.get("repeat") else case["input"]


def _ok(case):
    return str(case["ok"]) * case["okRepeat"] if case.get("okRepeat") else case.get("ok")


class GoldenCases(unittest.TestCase):
    def test_every_case_agrees_with_the_worker(self):
        self.assertGreater(len(CASES), 40)
        for case in CASES:
            values, err = fields.validate_company_fields({case["field"]: _input(case)})
            label = f"{case['field']} <- {str(_input(case))[:40]!r}"
            if "code" in case:
                self.assertIsNone(values, label)
                self.assertEqual((err["code"], err["field"]), (case["code"], case["field"]), label)
            else:
                self.assertIsNone(err, f"{label}: {err}")
                self.assertEqual(values[case["field"]], _ok(case), label)

    def test_unknown_fields_a_logo_link_and_a_non_object_are_refused(self):
        self.assertEqual(fields.validate_company_fields({"archived_at": "x"})[1]["code"], "unknown_field")
        self.assertEqual(fields.validate_company_fields({"logo_url": "https://evil.example/p.png"})[1]["code"], "logo_url_not_writable")
        for body in (None, [], "text", 7):
            self.assertEqual(fields.validate_company_fields(body)[1]["code"], "body_invalid")

    def test_booleans_are_not_head_counts(self):
        self.assertEqual(fields.validate_company_fields({"employee_count": True})[1]["code"], "employee_count_invalid")

    def test_the_field_lists_match_the_worker(self):
        ts = (ROOT / "cloudflare-worker/src/services/companyProfileFields.ts").read_text(encoding="utf-8")
        start = ts.index("export const GENERAL_FIELDS = [")
        listed = sorted(__import__("re").findall(r"'([a-z_]+)'", ts[start:ts.index("] as const;", start)]))
        self.assertEqual(sorted(fields.GENERAL_FIELDS), listed)
        stages = sorted(__import__("re").findall(r"'([a-z_]+)'", ts[ts.index("export const STAGES = ["):ts.index("] as const;", ts.index("export const STAGES = ["))]))
        self.assertEqual(sorted(fields.STAGES), stages)


if __name__ == "__main__":
    unittest.main()
