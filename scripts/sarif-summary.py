#!/usr/bin/env python3
"""List a scanner's SARIF findings in the GitHub Actions job summary.

WHY THIS EXISTS (D672)
======================
The repository is private, and code scanning on a private repository needs
GitHub Code Security, which is not on. Since 2026-10-10 every SARIF upload is
refused ("Code Security must be enabled for this repository to use code
scanning"), so the Security tab no longer receives CodeQL's or Semgrep's
findings. Both workflows now skip the upload and call this script instead,
so each run's summary page is where the findings are read.

What it does:
  - reads one or more SARIF files (a directory means every *.sarif in it);
  - skips any result the scanner itself marked suppressed (a non-empty
    `suppressions` array; an EMPTY array means "known not suppressed", the
    same rule scripts/strip-suppressed-sarif.py encodes);
  - writes a count by rule and level, then the first locations, as markdown
    to $GITHUB_STEP_SUMMARY (stdout when that is unset);
  - prints EVERY finding to the job log, one line each, with its message.

WHY THE LOG TOO (2026-10-17). The job summary is not readable through the
REST API, and neither is the code-scanning API for the agents that fix
findings (it answers 403 to their token). The job log is readable, so the log
is the one place an agent can read the whole list. It is uncapped, unlike the
summary's table.

Findings never fail it: a red check still means the scanner could not run.
It exits 1 only when a SARIF file is missing or unreadable, because a report
built from nothing would read as a clean scan.

Usage:  sarif-summary.py <title> <file-or-directory> [...]
"""

import json
import os
import sys
from collections import Counter

MAX_LOCATIONS = 50


def sarif_files(paths):
    files = []
    for p in paths:
        if os.path.isdir(p):
            files.extend(sorted(os.path.join(p, f) for f in os.listdir(p) if f.endswith('.sarif')))
        else:
            files.append(p)
    return files


def location(result):
    for loc in result.get('locations') or []:
        phys = loc.get('physicalLocation') or {}
        uri = (phys.get('artifactLocation') or {}).get('uri') or '?'
        line = (phys.get('region') or {}).get('startLine')
        return f'{uri}:{line}' if line else uri
    return '?'


def message(result):
    text = ((result.get('message') or {}).get('text') or '').strip()
    first = text.splitlines()[0] if text else ''
    return first[:200]


def main(argv):
    if len(argv) < 3:
        print('usage: sarif-summary.py <title> <file-or-directory> [...]', file=sys.stderr)
        return 2
    title, paths = argv[1], argv[2:]
    files = sarif_files(paths)
    if not files:
        print(f'sarif-summary: no SARIF file in {paths}', file=sys.stderr)
        return 1

    by_rule = Counter()
    by_level = Counter()
    rows = []
    suppressed = 0
    for path in files:
        try:
            with open(path, encoding='utf-8') as fh:
                doc = json.load(fh)
        except (OSError, ValueError) as exc:
            print(f'sarif-summary: cannot read {path}: {exc}', file=sys.stderr)
            return 1
        for run in doc.get('runs') or []:
            for result in run.get('results') or []:
                if result.get('suppressions'):
                    suppressed += 1
                    continue
                rule = result.get('ruleId') or '?'
                level = result.get('level') or 'warning'
                by_rule[rule] += 1
                by_level[level] += 1
                rows.append((level, rule, location(result), message(result)))

    total = sum(by_rule.values())
    out = [f'### {title}: {total} finding{"" if total == 1 else "s"}', '']
    if suppressed:
        out += [f'{suppressed} suppressed in the source are not counted.', '']
    if total:
        out += ['| Level | Count |', '| --- | --- |']
        out += [f'| {lvl} | {n} |' for lvl, n in sorted(by_level.items())]
        out += ['', '| Rule | Count |', '| --- | --- |']
        out += [f'| `{rule}` | {n} |' for rule, n in by_rule.most_common()]
        out += ['', '| Level | Rule | Where |', '| --- | --- | --- |']
        out += [f'| {lvl} | `{rule}` | `{where}` |' for lvl, rule, where, _ in rows[:MAX_LOCATIONS]]
        if len(rows) > MAX_LOCATIONS:
            out += ['', f'{len(rows) - MAX_LOCATIONS} more not listed.']
    text = '\n'.join(out) + '\n'

    target = os.environ.get('GITHUB_STEP_SUMMARY')
    if target:
        with open(target, 'a', encoding='utf-8') as fh:
            fh.write(text)
    else:
        sys.stdout.write(text)
    print(f'{title}: {total} finding(s), {suppressed} suppressed')
    for lvl, rule, where, msg in rows:
        print(f'finding\t{lvl}\t{rule}\t{where}\t{msg}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
