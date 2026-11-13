#!/usr/bin/env python3
"""Run the pinned Python requirements audit with bounded PyPI lookup retries."""

import os
import re
import subprocess
import sys
import time
from pathlib import Path

COMMAND = ["pip-audit", "--strict", "--ignore-vuln", "PYSEC-2022-42969", "-r", "requirements.txt"]
ATTEMPT_SECONDS = 120
DELAYS_SECONDS = (5, 10)
ATTEMPTS = len(DELAYS_SECONDS) + 1

# pip-audit surfaces these requests exceptions from its PyPI advisory service.
# A normal vulnerability report exits nonzero too, without a transport traceback.
PYPI_TRANSPORT = re.compile(
    r"^requests\.exceptions\.(?:ReadTimeout|ConnectTimeout|ConnectionError):"
    r"[^\n]*host=['\"]pypi\.org['\"]"
    r"|^ConnectionError: Could not connect to PyPI's vulnerability feed\s*$"
    r"|^requests\.exceptions\.HTTPError: (?:429|500|502|503|504) "
    r"[^\n]*https://pypi\.org/",
    re.MULTILINE,
)


def audit(run=subprocess.run, sleep=time.sleep, report=print):
    for attempt in range(1, ATTEMPTS + 1):
        try:
            result = run(COMMAND, capture_output=True, text=True, timeout=ATTEMPT_SECONDS)
        except subprocess.TimeoutExpired:
            reason = f"scan exceeded {ATTEMPT_SECONDS}s"
        else:
            if result.stdout:
                print(result.stdout, end="")
            if result.stderr:
                print(result.stderr, end="", file=sys.stderr)
            if result.returncode == 0:
                report(f"Attempt {attempt}/{ATTEMPTS}: strict scan passed.")
                return 0
            if not PYPI_TRANSPORT.search(result.stderr):
                report(f"Attempt {attempt}/{ATTEMPTS}: audit failed. See the pip-audit output.")
                return result.returncode
            reason = "transient PyPI advisory lookup failure"

        if attempt == ATTEMPTS:
            report(f"Attempt {attempt}/{ATTEMPTS}: audit incomplete ({reason}).")
            return 1
        delay = DELAYS_SECONDS[attempt - 1]
        report(f"Attempt {attempt}/{ATTEMPTS}: {reason}; retrying in {delay}s.")
        sleep(delay)


def main():
    if not Path("requirements.txt").is_file():
        print("no requirements.txt found, skipping")
        return 0
    summary = os.environ.get("GITHUB_STEP_SUMMARY")

    def report(message):
        print(message, flush=True)
        if summary:
            with open(summary, "a", encoding="utf-8") as output:
                output.write(f"- {message}\n")

    return audit(report=report)


if __name__ == "__main__":
    sys.exit(main())
