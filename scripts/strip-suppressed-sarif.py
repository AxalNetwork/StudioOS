#!/usr/bin/env python3
"""Drop nosemgrep-suppressed results from a Semgrep SARIF file before upload.

WHY THIS EXISTS
===============
Semgrep's console output and its SARIF output disagree about inline
suppressions, and only the console one matches what a reader expects:

    $ semgrep scan --config ... backend/app/models/migrations.py
    Ran 517 rules on 1656 files: 44 findings.        <- suppressed ones dropped

    $ semgrep scan --config ... --sarif --output x.sarif
    $ jq '[.runs[0].results[] | select(.suppressions)] | length' x.sarif
    119                                              <- suppressed ones KEPT

A `# nosemgrep: <rule-id>` finding still ships in the SARIF, carrying
`"suppressions": [{"kind": "inSource"}]`. GitHub code scanning ingests that
payload and opens an alert for it anyway, so every line the repo has
deliberately reviewed and annotated came back as an open "Error" alert —
e.g. alert #4581 on backend/app/models/migrations.py:2793, whose source line
visibly ends in the very nosemgrep comment meant to silence it.

The suppression itself is not broken. Verified against the real file with
semgrep 1.172.0: 147 findings, exactly the count of `text(` calls with no
annotation, and zero on any of the 53 annotated lines. The comments work;
the SARIF just reports what it chose to ignore.

So this filter makes the uploaded SARIF agree with the exit code semgrep
already computed. Genuine findings are untouched — only results the scanner
itself marked as suppressed are removed, and removing them lets code
scanning auto-close the alerts it should never have opened.

Not a way to hide findings: the only thing that suppresses a result is a
`nosemgrep` comment a human wrote next to a written justification, and those
comments are reviewable in the diff like any other code.

Usage:  strip-suppressed-sarif.py <file.sarif>     (rewritten in place)
"""

import json
import os
import sys


def is_suppressed(result):
    """True when the scanner marked this result as suppressed in-source.

    SARIF 2.1.0 §3.27.23: an empty `suppressions` array means "known NOT to be
    suppressed", and the property being absent means "no information". Only a
    non-empty array is an actual suppression, so the emptiness check matters.
    """
    suppressions = result.get("suppressions")
    return isinstance(suppressions, list) and len(suppressions) > 0


def main(argv):
    if len(argv) != 2:
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        return 2

    path = argv[1]
    if not os.path.exists(path):
        # semgrep crashed before writing anything. Say so and get out of the
        # way — the upload step will surface the real failure.
        print(f"[strip-suppressed-sarif] {path} not found; nothing to filter")
        return 0

    with open(path, encoding="utf-8") as fh:
        sarif = json.load(fh)

    removed = 0
    kept = 0
    for run in sarif.get("runs", []):
        results = run.get("results")
        if not isinstance(results, list):
            continue
        keep = [r for r in results if not is_suppressed(r)]
        removed += len(results) - len(keep)
        kept += len(keep)
        run["results"] = keep

    with open(path, "w", encoding="utf-8") as fh:
        json.dump(sarif, fh)

    print(
        f"[strip-suppressed-sarif] removed {removed} nosemgrep-suppressed "
        f"result(s); {kept} finding(s) uploaded"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
