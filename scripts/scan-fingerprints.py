#!/usr/bin/env python3
"""D5602: emit opaque Semgrep fingerprints using the scanner's existing Python runtime."""
import hashlib
import json
import os
import re
import sys
from pathlib import Path


def snapshot(sarif):
    runs = sarif.get('runs') if isinstance(sarif, dict) else None
    if not isinstance(runs, list) or not runs:
        raise ValueError('invalid runs')
    found = {}
    for run in runs:
        results = run.get('results') if isinstance(run, dict) else None
        if not isinstance(results, list):
            raise ValueError('invalid results')
        for result in results:
            if not isinstance(result, dict):
                raise ValueError('invalid result')
            if isinstance(result.get('suppressions'), list) and result['suppressions']:
                continue
            rule = result.get('ruleId')
            try:
                uri = result['locations'][0]['physicalLocation']['artifactLocation']['uri']
            except (KeyError, IndexError, TypeError):
                raise ValueError('missing identity') from None
            if not isinstance(rule, str) or not re.fullmatch(r'[\w@./:+-]{1,240}', rule, re.ASCII):
                raise ValueError('invalid rule')
            if not isinstance(uri, str) or not uri or len(uri.encode('utf-16-le')) // 2 > 4096:
                raise ValueError('invalid location')
            fingerprint = hashlib.sha256((rule + '\0' + uri).encode('utf-8')).hexdigest()
            found[fingerprint] = {'fingerprint': fingerprint, 'rule': rule}
    return [found[key] for key in sorted(found)]


def main():
    source, output = map(Path, sys.argv[1:])
    repository, run = os.environ.get('GITHUB_REPOSITORY', ''), os.environ.get('GITHUB_RUN_ID', '')
    if not re.fullmatch(r'[\w.-]+/[\w.-]+', repository, re.ASCII) or not re.fullmatch(r'[1-9]\d*', run, re.ASCII) or int(run) > 9007199254740991:
        raise ValueError('invalid run')
    if source.is_symlink() or source.stat().st_size > 8 * 1024 * 1024 or output.is_symlink():
        raise ValueError('invalid input')
    current = snapshot(json.loads(source.read_text(encoding='utf-8')))
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({'version': 1, 'scanner': 'semgrep', 'repository': repository, 'run_id': int(run), 'current': current}), encoding='utf-8')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, TypeError, OSError, UnicodeError):
        print('SARIF fingerprint generation failed; no baseline published.', file=sys.stderr)
        sys.exit(1)
