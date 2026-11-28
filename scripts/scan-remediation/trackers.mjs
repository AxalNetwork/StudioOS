// Match public tracking issues to protected alerts using their repo, number and creator.
// D8074: one tracker engine serves every alert source; Code Scanning is the default source.
import { codeScanning } from './sources.mjs'

const validNumber = value => Number.isSafeInteger(value) && value > 0
const names = issue => issue.labels.map(label => typeof label === 'string' ? label : label.name)
const login = value => String(value || '').toLowerCase()
const routingSlot = 'slot:S21'
export const SLA_LABEL = 'sla:7d'
const STATUS_TTL_MS = 24 * 60 * 60 * 1000

/**
 * D7259 (Q2 C): whether the latest trusted, leading AGENTS-format S21 STATUS for this issue holds it. IN_PROGRESS,
 * BLOCKED and READY_FOR_REVIEW hold for 24 hours from the comment's creation; a later DONE releases the hold.
 */
export function statusHolds(comments, issueNumber, now, trusted) {
  const at = Number(now())
  if (!Number.isFinite(at)) throw Error('Invalid reconciliation clock')
  let latest
  for (const comment of comments) {
    if (!trusted(comment)) continue
    const block = String(comment.body || '').trim().match(/^(?:```(?:text)?[ \t]*\r?\n)?STATUS[ \t]*\r?\n([\s\S]*)/)?.[1]?.split('\n```')[0]
    const task = block?.match(/^task:\s*#([1-9]\d*)\s+slot:\s*(S\d{2})\s+agent:\s*\S/m)
    const state = block?.match(/^state:\s*(IN_PROGRESS|BLOCKED|READY_FOR_REVIEW|DONE)\s*$/m)?.[1]
    const created = Date.parse(comment.created_at)
    if (Number(task?.[1]) !== issueNumber || task?.[2] !== 'S21' || !state ||
        !Number.isFinite(created) || created > at) continue
    if (!latest || created > latest.created || (created === latest.created && comment.id > latest.id)) {
      latest = { created, state, id: comment.id }
    }
  }
  return Boolean(latest && latest.state !== 'DONE' && at - latest.created < STATUS_TTL_MS)
}

/** The authors whose issues and STATUS comments the reconciler trusts: its bot, Actions, and this repository's owner. */
export function trustedAuthor({ owner, botLogin = 'github-actions[bot]' }) {
  const bots = new Set([login(botLogin), 'github-actions[bot]'])
  return item => bots.has(login(item?.user?.login)) ||
    (String(owner).toLowerCase() === 'axalnetwork' && login(item?.user?.login) === 'guillaumelauzier')
}

export function referenceText(body) {
  let fence
  return String(body || '').replace(/<!--[\s\S]*?-->/g, ' ').split('\n').filter(line => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1]
    if (fence) {
      if (marker?.[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = null
      return false
    }
    if (marker) { fence = marker; return false }
    return !/^(?: {4}|\t| {0,3}>)/.test(line)
  }).join('\n').replace(/(`+).*?\1/g, ' ')
}

function sameRepositoryPull(pull, { owner, repo, defaultBranch }) {
  const fullName = `${owner}/${repo}`.toLowerCase()
  if (pull.state !== 'open' || !validNumber(pull.number) || pull.base?.ref !== defaultBranch ||
      login(pull.head?.repo?.full_name) !== fullName) return false
  return true
}

// D7259: an issue reference is enough to associate existing work; no protected alert access is required.
export function trackerPulls(pulls, { owner, repo, defaultBranch }) {
  const fullName = `${owner}/${repo}`.toLowerCase()
  const result = new Map()
  for (const pull of pulls) {
    if (!sameRepositoryPull(pull, { owner, repo, defaultBranch })) continue
    const add = number => {
      if (!validNumber(number)) return
      if (!result.has(number)) result.set(number, new Map())
      result.get(number).set(pull.number, pull)
    }
    // Examples and URL fragments must not be mistaken for tracker references.
    let body = referenceText(pull.body)
    for (const [, repository, number] of body.matchAll(/https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/([1-9]\d*)(?=$|[\s)>\]#?.,])/gi)) {
      if (repository.toLowerCase() === fullName) add(Number(number))
    }
    body = body.replace(/https?:\/\/[^\s<>]+/gi, ' ')
    body = body.replace(/(?<![\w/.-])([\w.-]+\/[\w.-]+)#([1-9]\d*)(?![\w/-])/g, (_, repository, number) => {
      if (repository.toLowerCase() === fullName) add(Number(number))
      return ' '
    })
    let alertNumbers = false
    for (const line of body.split('\n')) {
      if (!line.trim()) alertNumbers = false
      for (const match of line.matchAll(/\b(alerts?|findings?|issues?|trackers?|refs?|references?|closes?|closed|fix(?:es|ed)?|resolve[sd]?|part\s+of)\b|(?<![\w/#])#([1-9]\d*)(?![\w/-])/gi)) {
        if (match[1]) alertNumbers = /^(?:alerts?|findings?)$/i.test(match[1])
        else if (!alertNumbers) add(Number(match[2]))
      }
    }
  }
  return result
}

export function matchingPulls(pulls, options, issueNumber, alertNumber, source = codeScanning) {
  const fullName = `${options.owner}/${options.repo}`.toLowerCase()
  const result = new Map(trackerPulls(pulls, options).get(issueNumber) ?? [])
  for (const pull of pulls) {
    if (!sameRepositoryPull(pull, options)) continue
    for (const [, repository, kind, number] of referenceText(pull.body).matchAll(/https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/security\/(code-scanning|dependabot|secret-scanning)\/([1-9]\d*)(?=$|[\s)>\]#?.,])/gi)) {
      if (repository.toLowerCase() === fullName && kind.toLowerCase() === source.urlPart && Number(number) === alertNumber) {
        result.set(pull.number, pull)
      }
    }
  }
  return result
}

export async function loadTrackers(api, { owner, repo, defaultBranch, botLogin = 'github-actions[bot]', source = codeScanning, now = Date.now }) {
  const titles = source.titles
  const marker = source.marker
  const base = 'https://github.com/' + owner + '/' + repo
  const bots = new Set([login(botLogin), 'github-actions[bot]'])
  const trusted = trustedAuthor({ owner, botLogin })
  const byAlert = new Map()
  function remember(issue) {
    if (issue.pull_request || !validNumber(issue.number) || !trusted(issue)) return
    const number = Number(titles.exec(issue.title)?.[1])
    if (!validNumber(number)) return
    if (!byAlert.has(number)) byAlert.set(number, new Map())
    byAlert.get(number).set(issue.number, issue)
  }

  // The REST inventory includes recently opened issues before the search index does.
  // Pagination also avoids GitHub Search's 1,000-result ceiling for bug history.
  for (const issue of await api.pages('/issues?state=all&labels=bug')) remember(issue)

  const alertUrl = number => base + '/security/' + source.urlPart + '/' + number
  function recognized(issue, number) {
    const body = String(issue.body || '')
    const exactLink = body.split(/\s|[()<>\[\]]/).includes(alertUrl(number))
    if (!exactLink) return false
    return (source.legacyTitle && issue.title === source.legacyTitle(number)) ||
      body.split('\n').includes(marker(number))
  }

  async function handedOff(issue, allowedPulls = new Set()) {
    const comments = await api.pages('/issues/' + issue.number + '/comments')
    if (statusHolds(comments, issue.number, now, trusted)) return true
    if (!names(issue).includes('state:review')) return false
    const pulls = await api.pages('/pulls?state=open&base=' + encodeURIComponent(defaultBranch))
    const number = Number(titles.exec(issue.title)?.[1])
    const matches = matchingPulls(pulls, { owner, repo, defaultBranch }, issue.number, number, source)
    return [...matches.keys()].some(number => !allowedPulls.has(number))
  }

  async function unclaimed(issue, review = false, allowedPulls) {
    const labels = names(issue)
    const number = Number(titles.exec(issue.title)?.[1])
    // S21 routing permits reconciliation until a session claims the automatic tracker.
    const automaticallyRouted = bots.has(login(issue.user?.login)) &&
      issue.title === source.title(number) &&
      String(issue.body || '').split('\n').includes(marker(number))
    if (issue.locked || issue.assignees?.length || labels.some(label =>
      (label.startsWith('slot:') && !(automaticallyRouted && label === routingSlot)) ||
      label === 'needs-decision' || label === 'needs-design' ||
      (label.startsWith('state:') && label !== 'state:ready' && !(review && label === 'state:review')))) return false
    try {
      await api.request('GET', '/git/ref/heads/claim/' + issue.number)
      return false
    } catch (error) {
      if (error.status !== 404) throw error
    }
    // Re-read handoffs before each mutation, including one posted after initial discovery.
    return !await handedOff(issue, allowedPulls)
  }

  async function current(issue, number) {
    const fresh = await api.request('GET', '/issues/' + issue.number)
    if (fresh.number !== issue.number || !trusted(fresh) || !recognized(fresh, number) ||
      Number(titles.exec(fresh.title)?.[1]) !== number) return null
    remember(fresh)
    return fresh
  }

  // A new tracker's rule comes from the alert the caller just read; sources.mjs writes it only if it is a published identifier.
  const alertFacts = new Map()
  async function ensure(number, alert) {
    if (!validNumber(number)) throw Error('Invalid alert number')
    if (alert) alertFacts.set(number, alert)
    if (!byAlert.has(number)) {
      // Includes old trackers whose bug label was removed. An alert-specific query
      // stays bounded even when thousands of unrelated alerts have already closed.
      const hits = await api.searchIssues(source.search(number))
      for (const issue of hits) remember(issue)
    }
    const matches = [...(byAlert.get(number)?.values() || [])]
    const hold = issue => ({ issue, actionable: false, created: false })
    if (matches.length > 1) return hold(null)
    if (matches.length === 1) {
      const issue = await current(matches[0], number)
      if (!issue) return hold(null)
      if (issue.state === 'closed') {
        if (!bots.has(login(issue.closed_by?.login)) || !issue.body.split('\n').includes(marker(number)) ||
          issue.state_reason !== 'completed' || !await unclaimed(issue, true)) return hold(issue)
        const reopened = await api.request('PATCH', '/issues/' + issue.number, { state: 'open' })
        remember(reopened)
        // A fresh main-branch occurrence must be re-evaluated even if the last PR was reviewed.
        const fresh = await active(reopened, true)
        if (fresh && names(fresh).includes('state:review')) await removeLabel(fresh, 'state:review')
        return { issue: fresh ?? reopened, actionable: Boolean(fresh), created: false }
      }
      return { issue, actionable: await unclaimed(issue, true), created: false }
    }

    const issue = await api.request('POST', '/issues', {
      title: source.title(number),
      body: source.body({ owner, repo, defaultBranch, number, rule: source.rule?.(alertFacts.get(number)) }),
      labels: ['bug', routingSlot, SLA_LABEL],
    })
    if (!trusted(issue) || !validNumber(issue.number) || !recognized(issue, number)) throw Error('Unexpected tracker identity')
    remember(issue)
    return { issue, actionable: true, created: true }
  }

  async function removeLabel(issue, label) {
    try { await api.request('DELETE', '/issues/' + issue.number + '/labels/' + encodeURIComponent(label)) }
    catch (error) { if (error.status !== 404) throw error }
  }

  async function active(issue, review = false, allowedPulls) {
    const number = Number(titles.exec(issue?.title)?.[1])
    if (!validNumber(number) || byAlert.get(number)?.size !== 1 ||
      !byAlert.get(number).has(issue.number)) return null
    const fresh = await current(issue, number)
    if (allowedPulls) for (const prNumber of allowedPulls) {
      let pull
      try { pull = await api.request('GET', '/pulls/' + prNumber) }
      catch (error) { if (error.status === 404) return null; throw error }
      if (!matchingPulls([pull], { owner, repo, defaultBranch }, issue.number, number, source).has(prNumber)) return null
    }
    return fresh?.state === 'open' && await unclaimed(fresh, review, allowedPulls) ? fresh : null
  }

  async function markReady(issue) {
    let fresh = await active(issue, true)
    if (!fresh) return
    if (names(fresh).includes('state:review')) {
      await removeLabel(fresh, 'state:review')
      fresh = await active(issue, true)
    }
    if (fresh && !names(fresh).includes('state:ready')) {
      await api.request('POST', '/issues/' + fresh.number + '/labels', { labels: ['state:ready'] })
    }
  }

  async function commentOnce(issue, body, allowedPulls) {
    const path = '/issues/' + issue.number
    const comments = await api.pages(path + '/comments')
    if (!comments.some(comment => bots.has(login(comment.user?.login)) && comment.body === body) &&
        await active(issue, true, allowedPulls)) {
      await api.request('POST', path + '/comments', { body })
    }
  }

  async function linkPrepared(issue, branch) {
    const number = Number(titles.exec(issue?.title)?.[1])
    if (!validNumber(number) || !['alert-fix-' + number, 'alert-autofix-' + number].includes(branch)) {
      throw Error('Invalid prepared branch for tracker')
    }
    const fresh = await active(issue, true)
    if (!fresh) return
    const link = base + '/compare/' + encodeURIComponent(defaultBranch) + '...' + branch
    await commentOnce(fresh, 'A fix is ready on this branch. ' +
      '[Compare the prepared changes and open a pull request](' + link + '). ' +
      'You can also let the workflow open the draft PR on a later run once its credential can create pull requests.')
    await markReady(fresh)
  }

  async function linkPull(issue, prNumber) {
    await linkPulls(issue, [prNumber])
  }

  async function linkPulls(issue, prNumbers) {
    if (!Array.isArray(prNumbers) || !prNumbers.length || !prNumbers.every(validNumber)) throw Error('Invalid pull request number')
    // This transition may finish its own review label change, but cannot bypass a session STATUS,
    // an atomic claim, or another PR handed off while it was writing the traceability comments.
    const allowedPulls = new Set(prNumbers)
    let fresh = await active(issue, true, allowedPulls)
    if (!fresh) return
    for (const number of allowedPulls) await commentOnce(fresh, 'Tracking pull request: ' + base + '/pull/' + number, allowedPulls)
    fresh = await active(issue, true, allowedPulls)
    if (!fresh) return
    const path = '/issues/' + fresh.number
    if (names(fresh).includes('state:ready')) {
      await removeLabel(fresh, 'state:ready')
      fresh = await active(issue, true, allowedPulls)
    }
    if (fresh && !names(fresh).includes('state:review')) await api.request('POST', path + '/labels', { labels: ['state:review'] })
  }

  async function closeFixed(alert) {
    if (!source.resolved(alert, defaultBranch)) return false
    const candidates = byAlert.get(alert.number)
    if (candidates?.size !== 1) return false
    const [candidate] = candidates.values()
    const fresh = await active(candidate, true)
    if (!fresh) return false
    const closed = await api.request('PATCH', '/issues/' + fresh.number, { state: 'closed', state_reason: 'completed' })
    remember(closed)
    return true
  }

  // D7259: a batched member is claimed through its batch, so it leaves the ready queue; nothing else changes.
  async function unready(issue) {
    const fresh = await active(issue, true)
    if (fresh && names(fresh).includes('state:ready')) await removeLabel(fresh, 'state:ready')
  }

  return {
    ensure, markReady, linkPrepared, linkPull, linkPulls, closeFixed, unready,
    // D7259: the one tracker an alert has, as last read, or null when it has none or several.
    trackerFor: number => byAlert.get(number)?.size === 1 ? [...byAlert.get(number).values()][0] : null,
    trackedNumbers: () => [...byAlert].filter(([, issues]) =>
      [...issues.values()].some(issue => issue.state === 'open')).map(([number]) => number),
  }
}
