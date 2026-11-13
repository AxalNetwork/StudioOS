"""Exercise the advisory audit without network calls or real delays."""

import contextlib
import io
import subprocess
import unittest

from pip_audit_gate import audit

READ_TIMEOUT = (
    "Traceback (most recent call last):\n"
    "requests.exceptions.ReadTimeout: HTTPSConnectionPool(host='pypi.org', port=443): "
    "Read timed out. (read timeout=15)\n"
)
FINDING = "Name Version ID Fix Versions\nexample 1.0 PYSEC-2026-123 1.1\n"


class AuditTest(unittest.TestCase):
    def run_audit(self, responses):
        calls, delays, messages = [], [], []
        stdout, stderr = io.StringIO(), io.StringIO()

        def run(command, **kwargs):
            calls.append((command, kwargs))
            result = responses[len(calls) - 1]
            if isinstance(result, Exception):
                raise result
            code, out, err = result
            return subprocess.CompletedProcess(command, code, out, err)

        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = audit(run=run, sleep=delays.append, report=messages.append)
        return code, calls, delays, messages, stdout.getvalue(), stderr.getvalue()

    def test_timeout_then_healthy_scan(self):
        code, calls, delays, messages, _, _ = self.run_audit([
            (1, "", READ_TIMEOUT), (0, "", "No known vulnerabilities found\n"),
        ])
        self.assertEqual(code, 0)
        self.assertEqual(delays, [5])
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0], calls[1])
        self.assertEqual(calls[0][0], [
            "pip-audit", "--strict", "--ignore-vuln", "PYSEC-2022-42969", "-r", "requirements.txt",
        ])
        self.assertEqual(calls[0][1]["timeout"], 120)
        self.assertIn("Attempt 1/3", messages[0])
        self.assertIn("strict scan passed", messages[1])

    def test_persistent_upstream_error_stays_incomplete(self):
        service_error = (
            "requests.exceptions.HTTPError: 503 Server Error: Service Unavailable "
            "for url: https://pypi.org/pypi/example/1.0/json\n"
            "pip_audit._service.interface.ServiceError\n"
        )
        code, calls, delays, messages, _, _ = self.run_audit([(1, "", service_error)] * 3)
        self.assertEqual(code, 1)
        self.assertEqual(len(calls), 3)
        self.assertEqual(delays, [5, 10])
        self.assertIn("audit incomplete", messages[-1])

    def test_a_finding_after_recovery_is_preserved(self):
        code, calls, delays, _, stdout, stderr = self.run_audit([
            (1, "", READ_TIMEOUT), (1, FINDING, "Found 1 known vulnerability\n"),
        ])
        self.assertEqual(code, 1)
        self.assertEqual(len(calls), 2)
        self.assertEqual(delays, [5])
        self.assertIn("PYSEC-2026-123", stdout)
        self.assertIn("Found 1 known vulnerability", stderr)

    def test_permanent_error_is_not_retried(self):
        code, calls, delays, _, _, stderr = self.run_audit([
            (1, "", "requests.exceptions.HTTPError: 403 Client Error for url: https://pypi.org/pypi/example/1.0/json\n"),
        ])
        self.assertEqual(code, 1)
        self.assertEqual(len(calls), 1)
        self.assertEqual(delays, [])
        self.assertIn("403 Client Error", stderr)

    def test_a_hung_scan_is_bounded(self):
        code, calls, delays, messages, _, _ = self.run_audit([
            subprocess.TimeoutExpired("pip-audit", 120), (0, "", ""),
        ])
        self.assertEqual(code, 0)
        self.assertEqual(len(calls), 2)
        self.assertEqual(delays, [5])
        self.assertIn("scan exceeded 120s", messages[0])


if __name__ == "__main__":
    unittest.main()
