/** D7259: group open Code Scanning trackers by scanner, rule and subsystem into opaque batches that S21 claims as one unit. */
// The grouping key never leaves this process: the public batch carries an opaque id, tracker numbers and alert links (Q1 A).
// A member tracker stays the one-to-one audit record and closes only when main's scan reports its alert fixed.
import { createHmac, randomBytes } from 'node:crypto'
import { BATCH_LABEL, batchTitle, parseBatch, renderBatchBody } from '../lib/scanBatchIssue.mjs'
import { statusHolds, trackerPulls, trustedAuthor } from './trackers.mjs'

/** New batches a sweep may file, highest priority first; the rest wait for the next hourly run. */
export const BATCHES_PER_RUN = 5
/**
 * Shared root causes that span rules: `{ cause, rules: [rule ids], scanner?, acrossSubsystems? }`. Alerts whose rule
 * is listed group under `cause` instead of their rule. This list is public, so it names rules, never an alert or a path.
 */
export const ROOT_CAUSE_OVERRIDES = Object.freeze([])

const routingSlot = 'slot:S21'
const validNumber = value => Number.isSafeInteger(value) && value > 0
const names = issue => (issue?.labels || []).map(label => typeof label === 'string' ? label : label.name)
const SECURITY_SEVERITY = { critical: 4, high: 3, medium: 2, low: 1 }
const RULE_SEVERITY = { error: 3, warning: 2, note: 1 }
// Folders whose second level is the owning subsystem (src, test, app, ...); anything else is owned by its first folder.
const NESTED_ROOTS = new Set(['backend', 'cloudflare-worker', 'frontend', 'meeting-bot'])

/** The owning subsystem of a repository path: `cloudflare-worker/src`, `scripts`, or `(root)` for a top-level file. */
export function subsystemOf(path) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.split('/').some(part => !part || part === '..')) return null
  const parts = path.split('/')
  if (parts.length === 1) return '(root)'
  return NESTED_ROOTS.has(parts[0]) && parts.length > 2 ? parts[0] + '/' + parts[1] : parts[0]
}

/** Isolated test code ranks after production code of the same severity. */
export function isTestPath(path) {
  return /(?:^|\/)(?:test|tests|__tests__|e2e|fixtures)\//.test(path) ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path) || /(?:^|\/)test_[^/]*\.py$/.test(path)
}

/** The private grouping key of an open alert, or null when the alert does not say enough to group it. */
export function groupKey(alert, overrides = ROOT_CAUSE_OVERRIDES) {
  const scanner = typeof alert?.tool?.name === 'string' ? alert.tool.name.trim().toLowerCase() : ''
  const rule = typeof alert?.rule?.id === 'string' ? alert.rule.id.trim() : ''
  const subsystem = subsystemOf(alert?.most_recent_instance?.location?.path)
  if (!scanner || !rule || !subsystem) return null
  const shared = overrides.find(o => o.rules.includes(rule) && (!o.scanner || o.scanner.toLowerCase() === scanner))
  if (shared) return JSON.stringify(['cause', shared.cause, shared.acrossSubsystems ? '*' : subsystem])
  return JSON.stringify([scanner, rule, subsystem])
}

/** Severity first (Critical > High > Medium > Low > not recorded), then production ahead of tests. Lower sorts first. */
export function alertRank(alert) {
  const severity = SECURITY_SEVERITY[String(alert?.rule?.security_severity_level || '').toLowerCase()] ??
    RULE_SEVERITY[String(alert?.rule?.severity || '').toLowerCase()] ?? 0
  const path = alert?.most_recent_instance?.location?.path
  const production = typeof path === 'string' && !isTestPath(path)
  return [-severity, production ? 0 : 1]
}
const compareRank = (a, b) => a[0] - b[0] || a[1] - b[1]

/** An opaque id: a keyed hash of the private grouping key. Without a configured key each run keys it at random. */
export function batchId(key, secret, attempt = 0) {
  return createHmac('sha256', secret).update(key + (attempt ? '\n' + attempt : '')).digest('hex').slice(0, 8)
}

/** Every batch issue this workflow filed, open or closed, with its parsed members. */
export async function loadBatches(api, { owner, repo, botLogin = 'github-actions[bot]' }) {
  const bots = new Set([String(botLogin).toLowerCase(), 'github-actions[bot]'])
  const batches = []
  for (const issue of await api.pages('/issues?state=all&labels=' + encodeURIComponent(BATCH_LABEL))) {
    if (issue.pull_request || !validNumber(issue.number) || !bots.has(String(issue.user?.login || '').toLowerCase())) continue
    const parsed = parseBatch(issue, { owner, repo })
    if (parsed) batches.push({ issue, ...parsed })
  }
  return batches.sort((a, b) => a.issue.number - b.issue.number)
}

/** Tracker numbers that open batches hold: the sweep leaves their queue state to the batch. */
export function batchedTrackers(batches) {
  return new Set(batches.filter(b => b.issue.state === 'open').flatMap(b => b.members.map(m => m.tracker)))
}

const reopenable = batch => batch.issue.state === 'open' || batch.issue.state_reason === 'completed'

/**
 * The pure plan: which existing batch each tracker belongs to, which new batches to file, and each batch's members in
 * priority order. Membership is stable: a listed tracker never moves, and only unbatched S21 trackers join.
 */
export function planBatches({ alerts, trackerFor, batches, overrides = ROOT_CAUSE_OVERRIDES, secret, limit = BATCHES_PER_RUN }) {
  const facts = new Map(alerts.filter(a => validNumber(a?.number)).map(a => [a.number, a]))
  // The lowest-numbered batch listing a tracker owns it. A batch a person closed as not planned keeps its trackers
  // out of batching, so they return to individual work.
  const owner = new Map()
  for (const batch of batches) {
    for (const member of [...batch.members, ...batch.resolved]) {
      if (!owner.has(member.tracker)) owner.set(member.tracker, batch.issue.number)
    }
  }
  const memberRank = member => {
    const alert = facts.get(member.alert)
    return alert ? alertRank(alert) : [1, 2]
  }
  const order = (a, b) => compareRank(memberRank(a), memberRank(b)) || a.alert - b.alert
  const entries = []
  const byKey = new Map()
  for (const batch of batches) {
    if (!reopenable(batch)) continue
    const members = [], resolved = []
    for (const member of [...batch.members, ...batch.resolved]) {
      if (owner.get(member.tracker) !== batch.issue.number) continue
      const issue = trackerFor(member.alert)
      // A tracker that cannot be read as this member's stays where it was listed.
      const open = issue?.number === member.tracker ? issue.state === 'open' : batch.members.includes(member)
      ;(open ? members : resolved).push(member)
    }
    const votes = new Map()
    for (const member of members) {
      const key = facts.has(member.alert) ? groupKey(facts.get(member.alert), overrides) : null
      if (key) votes.set(key, (votes.get(key) ?? 0) + 1)
    }
    const key = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    const entry = { batch, id: batch.id, key, members, resolved }
    entries.push(entry)
    if (key && batch.issue.state === 'open' && !byKey.has(key)) byKey.set(key, entry)
  }
  const fresh = new Map()
  for (const alert of facts.values()) {
    const issue = trackerFor(alert.number)
    if (!issue || issue.state !== 'open' || owner.has(issue.number)) continue
    const labels = names(issue)
    if (issue.locked || issue.assignees?.length || !labels.includes(routingSlot) || labels.some(label =>
      (label.startsWith('slot:') && label !== routingSlot) || label === 'needs-decision' || label === 'needs-design' ||
      (label.startsWith('state:') && label !== 'state:ready' && label !== 'state:review'))) continue
    const key = groupKey(alert, overrides)
    if (!key) continue
    const member = { tracker: issue.number, alert: alert.number }
    if (byKey.has(key)) byKey.get(key).members.push(member)
    else {
      if (!fresh.has(key)) fresh.set(key, [])
      fresh.get(key).push(member)
    }
  }
  const taken = new Set(batches.map(b => b.id))
  const created = []
  for (const [key, members] of fresh) {
    // One tracker alone keeps the individual flow; a second compatible alert files the batch.
    if (members.length < 2) continue
    created.push({ batch: null, key, members, resolved: [] })
  }
  for (const entry of [...entries, ...created]) {
    entry.members.sort(order)
    entry.resolved.sort((a, b) => a.tracker - b.tracker)
    entry.rank = entry.members.length ? memberRank(entry.members[0]) : [1, 2]
  }
  created.sort((a, b) => compareRank(a.rank, b.rank) || a.members[0].alert - b.members[0].alert)
  const filed = created.slice(0, limit)
  for (const entry of filed) {
    let attempt = 0
    do entry.id = batchId(entry.key, secret, attempt++)
    while (taken.has(entry.id))
    taken.add(entry.id)
  }
  return [...entries, ...filed].sort((a, b) => compareRank(a.rank, b.rank) ||
    (a.batch?.issue.number ?? Infinity) - (b.batch?.issue.number ?? Infinity))
}

/**
 * Files and updates batches, moves each between `state:ready` and `state:review` from its PRs, and closes a batch only
 * once every member tracker is closed. It never closes or dismisses a tracker or an alert.
 */
export async function reconcileBatches(api, options, { alerts, trackers, pulls, batches, overrides, secret, limit } = {}) {
  const { owner, repo, defaultBranch } = options
  const base = 'https://github.com/' + owner + '/' + repo
  const trusted = trustedAuthor(options)
  const now = options.now ?? Date.now
  const plan = planBatches({ alerts, trackerFor: n => trackers.trackerFor(n), batches, overrides,
    secret: secret ?? options.batchKey ?? randomBytes(32), limit })
  const references = trackerPulls(pulls, { owner, repo, defaultBranch })
  let failed = 0
  for (const entry of plan) {
    try {
      const body = renderBatchBody({ owner, repo, id: entry.id, members: entry.members, resolved: entry.resolved })
      let issue = entry.batch?.issue
      if (!issue) {
        issue = await api.request('POST', '/issues', {
          title: batchTitle(entry.id), body, labels: [BATCH_LABEL, routingSlot, 'state:ready'],
        })
        if (!validNumber(issue?.number) || !trusted(issue) || parseBatch(issue, { owner, repo })?.id !== entry.id) {
          throw Error('Unexpected batch identity')
        }
      } else {
        const patch = {}
        if (issue.body !== body) patch.body = body
        if (issue.state === 'closed' && entry.members.length) patch.state = 'open'
        // main's scan closed every member tracker: only then is the batch complete.
        if (issue.state === 'open' && !entry.members.length && entry.resolved.length) {
          Object.assign(patch, { state: 'closed', state_reason: 'completed' })
        }
        if (Object.keys(patch).length) issue = await api.request('PATCH', '/issues/' + issue.number, patch)
      }
      if (issue.state !== 'open' || !entry.members.length) continue
      await queueState(issue, entry)
      for (const member of entry.members) {
        const tracker = trackers.trackerFor(member.alert)
        if (tracker?.number === member.tracker && names(tracker).includes('state:ready')) await trackers.unready(tracker)
      }
    } catch (error) {
      // Neither the grouping key nor an API response body is logged: the Actions log is public.
      console.error(`Remediation batch${entry.batch ? ' #' + entry.batch.issue.number : ''}: reconciliation failed${Number.isInteger(error.status) ? ` (HTTP ${error.status})` : ''}.`)
      if (error.limited || [401, 403, 429].includes(error.status)) throw error
      failed++
    }
  }
  if (failed) throw new Error(`${failed} remediation batch operations need retry`)
  return plan.length

  async function held(issue) {
    const labels = names(issue)
    if (issue.locked || issue.assignees?.length || labels.some(label =>
      (label.startsWith('slot:') && label !== routingSlot) || label === 'needs-decision' || label === 'needs-design' ||
      (label.startsWith('state:') && label !== 'state:ready' && label !== 'state:review'))) return true
    try {
      await api.request('GET', '/git/ref/heads/claim/' + issue.number)
      return true
    } catch (error) {
      if (error.status !== 404) throw error
    }
    return statusHolds(await api.pages('/issues/' + issue.number + '/comments'), issue.number, now, trusted)
  }

  async function queueState(issue, entry) {
    const linked = new Set()
    for (const number of [issue.number, ...entry.members.map(m => m.tracker)]) {
      for (const pr of references.get(number)?.keys() ?? []) linked.add(pr)
    }
    const want = linked.size ? 'state:review' : 'state:ready'
    const other = linked.size ? 'state:ready' : 'state:review'
    const labels = names(issue)
    const commented = []
    if (linked.size) {
      const comments = await api.pages('/issues/' + issue.number + '/comments')
      for (const pr of [...linked].sort((a, b) => a - b)) {
        const text = 'Tracking pull request: ' + base + '/pull/' + pr
        if (!comments.some(c => trusted(c) && c.body === text)) commented.push(text)
      }
    }
    if (!commented.length && labels.includes(want) && !labels.includes(other)) return
    // Re-read before every write: a claim, an assignee or a STATUS posted since discovery wins.
    let fresh = await api.request('GET', '/issues/' + issue.number)
    if (fresh.number !== issue.number || fresh.state !== 'open' || await held(fresh)) return
    for (const text of commented) await api.request('POST', '/issues/' + issue.number + '/comments', { body: text })
    if (names(fresh).includes(other)) {
      try { await api.request('DELETE', '/issues/' + issue.number + '/labels/' + encodeURIComponent(other)) }
      catch (error) { if (error.status !== 404) throw error }
      fresh = await api.request('GET', '/issues/' + issue.number)
      if (await held(fresh)) return
    }
    if (!names(fresh).includes(want)) await api.request('POST', '/issues/' + issue.number + '/labels', { labels: [want] })
  }
}
