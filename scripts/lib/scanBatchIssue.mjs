/** D7259: the opaque public Code Scanning remediation batch: its title, body and member list; no rule, path or finding. Owned by `../scan-remediation/batches.mjs`; `../claim.mjs` reads it. */
// Q1 A (owner, 2026-11-20): a public batch shows an opaque id, member tracker numbers and protected alert links only.
const ownerName = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/
const repoName = /^[A-Za-z0-9_.-]{1,100}$/
const validNumber = value => Number.isSafeInteger(value) && value > 0
const batchId = /^[0-9a-f]{8}$/

export const BATCH_LABEL = 'scan:batch'
export const BATCH_TITLE = /^\[Code Scanning\] Remediation batch ([0-9a-f]{8})$/
export const batchTitle = id => {
  if (!batchId.test(String(id))) throw Error('Invalid batch id')
  return '[Code Scanning] Remediation batch ' + id
}
export const batchMarker = id => '<!-- studioos-scan-remediation-batch:' + id + ' -->'

function checkCoordinates(owner, repo) {
  if (typeof owner !== 'string' || !ownerName.test(owner) || typeof repo !== 'string' || !repoName.test(repo) ||
      ['.', '..'].includes(repo)) throw Error('Invalid batch coordinates')
}

const memberLine = (owner, repo, { tracker, alert }) => {
  if (!validNumber(tracker) || !validNumber(alert)) throw Error('Invalid batch member')
  return '- #' + tracker + ' · [alert #' + alert + '](https://github.com/' + owner + '/' + repo +
    '/security/code-scanning/' + alert + ')'
}

/** `members` are the open member trackers in the workflow's recommended order; `resolved` stay listed for the audit trail. */
export function renderBatchBody({ owner, repo, id, members, resolved = [] }) {
  checkCoordinates(owner, repo)
  batchTitle(id)
  if (!Array.isArray(members) || !Array.isArray(resolved)) throw Error('Invalid batch members')
  const seen = new Set()
  for (const { tracker } of [...members, ...resolved]) {
    if (seen.has(tracker)) throw Error('Duplicate batch member')
    seen.add(tracker)
  }
  return [
    batchMarker(id),
    '', '## Objective', '',
    'Fix the Code Scanning alerts of the member trackers below in one branch and one pull request. ' +
      'The workflow grouped them because they share one root cause; their protected alerts name it.',
    '', '## Members', '',
    ...(members.length ? members.map(m => memberLine(owner, repo, m)) : ['None open.']),
    '', '## Resolved members', '',
    ...(resolved.length ? resolved.map(m => memberLine(owner, repo, m)) : ['None yet.']),
    '', '## How to work this batch', '',
    '- Claim this issue with `node scripts/claim.mjs claim <this issue> --slot S21 --agent <AGENT> --session <SESSION>`. ' +
      'The claim also holds every open member tracker; a member another session already holds stays with that session.',
    '- In the pull request body write `Part of #<this issue>` and `Refs #<tracker>` for each member it fixes. ' +
      'Do not write `Closes`: this batch and its trackers close only when `main`\'s Code Scanning reports each alert fixed.',
    '- Keep finding details in the protected Security tab. Do not paste a rule, file, line, message, export or ' +
      'screenshot into this public issue, a PR description, a comment or a commit.',
    '', '## Done when', '',
    'The reconciler closes each member tracker once `main`\'s scan reports its alert and `main` instance `fixed`, ' +
      'and closes this batch when no member remains open. A merged PR or green CI alone closes nothing. ' +
      'Members still open after a merge stay here, and the batch returns to `state:ready`.',
  ].join('\n')
}

/** The batch a trusted issue body describes, or null. Only exact member lines for this repository count. */
export function parseBatch(issue, { owner, repo }) {
  checkCoordinates(owner, repo)
  const id = BATCH_TITLE.exec(String(issue?.title || ''))?.[1]
  const lines = String(issue?.body || '').split('\n')
  if (!id || lines[0] !== batchMarker(id)) return null
  const members = [], resolved = []
  let section = null
  const seen = new Set()
  for (const line of lines) {
    if (line.startsWith('## ')) { section = line === '## Members' ? members : line === '## Resolved members' ? resolved : null; continue }
    if (!section || !line.startsWith('- #')) continue
    const match = /^- #([1-9]\d*) · \[alert #([1-9]\d*)\]\(https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/security\/code-scanning\/([1-9]\d*)\)$/.exec(line)
    if (!match || match[3] !== owner || match[4] !== repo || match[2] !== match[5]) continue
    const tracker = Number(match[1])
    if (seen.has(tracker)) continue
    seen.add(tracker)
    section.push({ tracker, alert: Number(match[2]) })
  }
  return { id, members, resolved }
}
