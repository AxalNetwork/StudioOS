// D8074: the alert sources the reconciler tracks. Each names its public tracker and when main confirms it.
import { trackerIssueBody } from '../lib/scanTrackerIssueBody.mjs'

const ownerName = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/
const repoName = /^[A-Za-z0-9_.-]{1,100}$/
// A rule is an identifier GitHub publishes (a GHSA id, a secret type). Anything else is not written down.
const ruleShape = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/
const safeRule = value => typeof value === 'string' && ruleShape.test(value) ? value : null

/** Code Scanning: unchanged since D7283. A tracker closes once the alert and its main instance are fixed. */
export const codeScanning = {
  key: 'code-scanning',
  name: 'Code Scanning',
  urlPart: 'code-scanning',
  titles: /^(?:\[Code Scanning\] Investigate and fix alert #|\[Code Scanning\] Remediate alert #)([1-9]\d*)$/,
  title: number => '[Code Scanning] Remediate alert #' + number,
  legacyTitle: number => '[Code Scanning] Investigate and fix alert #' + number,
  marker: number => '<!-- studioos-scan-remediation:' + number + ' -->',
  search: number => 'is:issue in:title "Code Scanning" "alert #' + number + '"',
  body: ({ owner, repo, defaultBranch, number }) => trackerIssueBody({ owner, repo, defaultBranch, number }),
  resolved: (alert, defaultBranch) => alert?.state === 'fixed' &&
    alert.most_recent_instance?.ref === 'refs/heads/' + defaultBranch && alert.most_recent_instance.state === 'fixed',
}

function newSource({ key, name, urlPart, list, get, open, resolved, rule, handling, closure }) {
  const prefix = '[' + name + '] Remediate alert #'
  return {
    key, name, urlPart, list, get, open, resolved, rule,
    titles: new RegExp('^' + prefix.replace(/[[\]]/g, '\\$&') + '([1-9]\\d*)$'),
    title: number => prefix + number,
    marker: number => '<!-- studioos-scan-remediation:' + key + ':' + number + ' -->',
    search: number => 'is:issue in:title "' + name + '" "alert #' + number + '"',
    body({ owner, repo, defaultBranch, number, rule: ruleId }) {
      if (typeof owner !== 'string' || !ownerName.test(owner) || typeof repo !== 'string' || !repoName.test(repo) ||
          ['.', '..'].includes(repo) || !Number.isSafeInteger(number) || number <= 0) throw Error('Invalid tracker coordinates')
      const url = 'https://github.com/' + owner + '/' + repo + '/security/' + urlPart + '/' + number
      const shown = safeRule(ruleId)
      return [
        '<!-- studioos-scan-remediation:' + key + ':' + number + ' -->',
        '', '## Objective', '',
        'Resolve [' + name + ' alert #' + number + '](' + url + ') on `' + defaultBranch + '`.',
        '', 'Rule: ' + (shown ? '`' + shown + '`' : 'not recorded here; read it in the protected alert.'),
        '', 'Default queue: `slot:S21`. Follow `AGENTS.md` and preserve an existing session\'s claim or assignment.',
        '', '## Handling', '', ...handling,
        '', 'Keep finding details in the protected Security tab. Do not paste the finding, a credential, a file ' +
          'location, an export or a screenshot into this public issue, a PR description, a comment or a commit.',
        '', '## Done when', '', closure,
        'A merged PR alone does not close this issue: the reconciler closes it once GitHub reports that.',
        '', 'This issue carries `sla:7d`. If it is still open seven days after filing it gains `sla:breached`.',
      ].join('\n')
    },
  }
}

/** Dependabot: a tracker closes once GitHub marks the alert fixed, which it does from main's dependency graph. */
export const dependabot = newSource({
  key: 'dependabot',
  name: 'Dependabot',
  urlPart: 'dependabot',
  list: '/dependabot/alerts?state=open',
  get: number => '/dependabot/alerts/' + number,
  open: alert => alert?.state === 'open',
  resolved: alert => alert?.state === 'fixed',
  rule: alert => alert?.security_advisory?.ghsa_id,
  handling: [
    '- Read the advisory and the affected manifest in the protected alert.',
    '- Update the dependency on a branch, or take Dependabot\'s own security-update PR, and run the tests it touches.',
    '- Dismissing the alert is the owner\'s decision; a dismissed alert leaves this issue open for a person to close.',
  ],
  closure: 'GitHub marks the alert `fixed` from `main`\'s dependency graph.',
})

/** Secret scanning: read with hide_secret, so the value is never fetched. Only a revoked secret closes a tracker. */
export const secretScanning = newSource({
  key: 'secret-scanning',
  name: 'Secret Scanning',
  urlPart: 'secret-scanning',
  list: '/secret-scanning/alerts?state=open&hide_secret=true',
  get: number => '/secret-scanning/alerts/' + number + '?hide_secret=true',
  open: alert => alert?.state === 'open',
  resolved: alert => alert?.state === 'resolved' && alert.resolution === 'revoked',
  rule: alert => alert?.secret_type,
  handling: [
    '- Revoke or rotate the credential at its provider first. Deleting it from the code does not remediate it.',
    '- Read the location only in the protected alert. It is never written in this issue.',
    '- Then remove the value from the code and resolve the alert as revoked.',
  ],
  closure: 'The alert is resolved as `revoked`. Any other resolution leaves this issue open for a person to close.',
})

export const ALERT_SOURCES = [dependabot, secretScanning]
