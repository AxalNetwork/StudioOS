/** D7283: public Code Scanning tracker instructions from validated coordinates; finding evidence stays in a private export or protected alert. Owned by `../scan-remediation/trackers.mjs`. */
// D7283: render actionable public trackers from coordinates without publishing finding payloads.
const ownerName = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/
const repoName = /^[A-Za-z0-9_.-]{1,100}$/
const branchName = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'"

export function trackerIssueBody({ owner, repo, defaultBranch, number }) {
  if (typeof owner !== 'string' || !ownerName.test(owner) ||
      typeof repo !== 'string' || !repoName.test(repo) || ['.', '..'].includes(repo) ||
      typeof defaultBranch !== 'string' || !branchName.test(defaultBranch) ||
      defaultBranch.includes('..') || defaultBranch.includes('//') ||
      defaultBranch.endsWith('/') || defaultBranch.endsWith('.') ||
      defaultBranch.split('/').some(part => part.startsWith('.') || part.endsWith('.lock')) ||
      !Number.isSafeInteger(number) || number <= 0) throw Error('Invalid tracker coordinates')

  const ref = 'refs/heads/' + defaultBranch
  const alertUrl = 'https://github.com/' + owner + '/' + repo + '/security/code-scanning/' + number
  const endpoint = 'repos/' + owner + '/' + repo + '/code-scanning/alerts'
  const filter = '.[] | select(.number == ' + number + ' and .state == "open" and ' +
    '.most_recent_instance.ref == ' + JSON.stringify(ref) + ' and .most_recent_instance.state == "open") | ' +
    '{alert_number: .number, state, tool: .tool.name, rule_id: .rule.id, rule_description: .rule.description, ' +
    'severity: .rule.severity, security_severity: .rule.security_severity_level, ' +
    'ref: .most_recent_instance.ref, instance_state: .most_recent_instance.state, ' +
    'commit_sha: .most_recent_instance.commit_sha, retrieved_at: (now | todateiso8601), ' +
    'location: .most_recent_instance.location, message: .most_recent_instance.message.text, ' +
    'alert_url: .html_url, updated_at}'
  const file = '"$scan_private_dir/alert-' + number + '.json"'

  return [
    '<!-- studioos-scan-remediation:' + number + ' -->',
    '', '## Objective', '',
    'Resolve [Code Scanning alert #' + number + '](' + alertUrl + ') on `' + defaultBranch + '`.',
    '', 'Default queue: `slot:S21`. Follow `AGENTS.md` and preserve an existing session\'s claim or assignment.',
    '', '## Finding evidence and access', '',
    'Open the protected alert using repository Code Scanning access. Its rule, exact file and line range, ' +
      'message, and code flow are the evidence for the fix.',
    '', 'An already-authorized GitHub CLI session can export this one open finding on `' + defaultBranch +
      '` to a private temporary file. Run this locally, outside public CI logs:',
    '', '```sh', '(', '  set -eu', '  umask 077', '  scan_private_dir="$(mktemp -d)"',
    '  gh api --hostname github.com --paginate --method GET \\',
    '    ' + quote(endpoint) + ' \\',
    '    -f ' + quote('state=open') + ' -f ' + quote('ref=' + ref) + ' -f ' + quote('per_page=100') + ' \\',
    '    --jq ' + quote(filter) + ' \\',
    '    > ' + file,
    '  test -s ' + file,
    "  printf 'Private export: %s\\n' " + file,
    ')', '```', '',
    'An empty export or failed request does not establish a fix. Check the protected alert\'s current ' +
      'state and branch before proceeding.',
    '', 'If the integration returns HTTP 403, retain `state:blocked` and request repository ' +
      '`Code scanning alerts: read` for that integration, or a private export from an authorized maintainer. ' +
      'Changing an Actions workflow permission does not grant access to another session\'s integration.',
    '', 'The private handoff must include the tracker and alert numbers, scanner, rule ID, exact file and line ' +
      'range, message, protected alert URL, branch, scan commit when available, and verification time. ' +
      'Review code-flow evidence in the protected alert when present. The assigned session must confirm it ' +
      'can read the handoff before the access blocker is cleared; creating a file for the owner is not a receipt.',
    '', 'Keep finding details in Code Scanning or the private handoff. Do not paste findings, exports, ' +
      'credentials, or private attachment links into this public issue, PR descriptions, comments, or commits.',
    '', '## Implementation', '',
    '- Verify the finding against current `' + defaultBranch + '` before editing; recorded locations may have moved.',
    '- Fix the root cause with the smallest behavior-preserving change and relevant regression coverage.',
    '- Group owned alerts that share a root cause into a coherent fix, link every tracker, and coordinate ' +
      'overlapping ownership before combining work.',
    '- Reference this tracker and the protected alert URL in the PR. Keep this tracker open through the confirming scan.',
    '', '## Acceptance and closure', '',
    '- [ ] The assigned session can read the private finding evidence and has confirmed receipt.',
    '- [ ] The root cause is verified against current `' + defaultBranch + '` and the fix is implemented.',
    '- [ ] Relevant tests, required checks, and review pass; record the PR and validation results without protected finding details.',
    '- [ ] The fix has merged and Code Scanning reports this alert and its `' + defaultBranch + '` instance as `fixed`.',
    '- [ ] The holder or coordinator reconciles the tracker after that scan confirmation, preserving other sessions\' claims.',
    '', 'A merged PR, passing tests, a missing export, or an unavailable API alone does not establish resolution. ' +
      'Automation preserves claimed work; the holder or coordinator must reconcile it when automatic closure is held.',
  ].join('\n')
}
