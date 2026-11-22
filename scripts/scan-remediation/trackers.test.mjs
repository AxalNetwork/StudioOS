// Regression coverage for issue ownership, retry-safe tracking and scanner-confirmed closure.
import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTrackers } from './trackers.mjs'

const ctx = { owner: 'AxalNetwork', repo: 'StudioOS', defaultBranch: 'main', botLogin: 'axal-scan[bot]' }
const bot = { login: ctx.botLogin }
const url = 'https://github.com/AxalNetwork/StudioOS/security/code-scanning/42'
const legacy = {
  number: 123, title: '[Code Scanning] Investigate and fix alert #42', body: '- Alert: ' + url,
  user: { login: 'guillaumelauzier' }, state: 'open', labels: [{ name: 'bug' }], assignees: [],
}

function fixture(input = []) {
  const issues = new Map(input.map(i => [i.number, structuredClone(i)]))
  const comments = new Map()
  const claims = new Set()
  const writes = []
  const copy = x => structuredClone(x)
  const api = {
    async pages(path) {
      if (path === '/issues?state=all&labels=bug') return [...issues.values()].filter(i => i.labels.some(l => l.name === 'bug')).map(copy)
      if (path.endsWith('/comments')) return copy(comments.get(path) ?? [])
      throw Error('unexpected page: ' + path)
    },
    async searchIssues(q) {
      assert.match(q, /^is:issue in:title "Code Scanning" "alert #\d+"$/)
      return [...issues.values()].map(copy)
    },
    async request(method, path, body) {
      if (method !== 'GET') writes.push([method, path, body])
      if (method === 'GET' && path.startsWith('/git/ref/heads/claim/')) {
        if (claims.has(Number(path.split('/').at(-1)))) return {}
        throw Object.assign(Error('not found'), { status: 404 })
      }
      if (method === 'POST' && path === '/issues') {
        const number = Math.max(0, ...issues.keys()) + 1
        const issue = { ...body, labels: body.labels.map(name => ({ name })), number, user: bot, state: 'open', assignees: [] }
        issues.set(number, issue)
        return copy(issue)
      }
      const [, , id, resource, label] = path.split('/')
      const issue = issues.get(Number(id))
      if (!issue) throw Error('unexpected issue')
      if (method === 'GET' && !resource) return copy(issue)
      if (method === 'PATCH' && !resource) {
        Object.assign(issue, body, { closed_by: body.state === 'closed' ? bot : null })
        return copy(issue)
      }
      if (resource === 'labels' && method === 'POST') {
        for (const name of body.labels) if (!issue.labels.some(l => l.name === name)) issue.labels.push({ name })
        return copy(issue.labels)
      }
      if (resource === 'labels' && method === 'DELETE') {
        issue.labels = issue.labels.filter(x => x.name !== decodeURIComponent(label))
        return null
      }
      if (resource === 'comments' && method === 'POST') {
        if (!comments.has(path)) comments.set(path, [])
        comments.get(path).push({ ...body, user: bot })
        return {}
      }
      throw Error('unexpected request: ' + method + ' ' + path)
    },
  }
  return { api, writes, issues, claims, comments }
}

const confirmed = { number: 42, state: 'fixed', most_recent_instance: { ref: 'refs/heads/main', state: 'fixed' } }

test('new issues contain only the opaque alert link; repeat runs converge through review and confirmed closure', async () => {
  const { api, issues, writes } = fixture()
  let trackers = await loadTrackers(api, ctx)
  const { issue, created, actionable } = await trackers.ensure(42)
  assert.ok(created && actionable)
  assert.deepEqual(issue.labels, [{ name: 'bug' }, { name: 'slot:S21' }, { name: 'sla:7d' }])
  assert.deepEqual([...issue.body.matchAll(/\]\(([^)]+)\)/g)].map(([, href]) => href), [url])
  assert.match(issue.body, /## Finding evidence and access/)
  assert.match(issue.body, /HTTP 403, retain `state:blocked`/)
  assert.match(issue.body, /alert and its `main` instance as `fixed`/)
  await trackers.markReady(issue)
  assert.deepEqual(issues.get(issue.number).labels.map(label => label.name), ['bug', 'slot:S21', 'sla:7d', 'state:ready'])
  await trackers.linkPull(issue, 99)
  await trackers.linkPull(issue, 99)
  assert.deepEqual(issues.get(issue.number).labels, [{ name: 'bug' }, { name: 'slot:S21' }, { name: 'sla:7d' }, { name: 'state:review' }])
  assert.equal(writes.filter(([, path]) => path.endsWith('/comments')).length, 1)
  trackers = await loadTrackers(api, ctx)
  assert.deepEqual(trackers.trackedNumbers(), [42])
  assert.equal((await trackers.ensure(42)).issue.number, issue.number)
  assert.equal(await trackers.closeFixed({ ...confirmed, most_recent_instance: { ref: 'refs/heads/else', state: 'fixed' } }), false)
  assert.equal(await trackers.closeFixed({ ...confirmed, state: 'dismissed' }), false)
  assert.equal(await trackers.closeFixed({ ...confirmed, most_recent_instance: { ref: 'refs/heads/main', state: 'open' } }), false)
  assert.equal(await trackers.closeFixed(confirmed), true)
  assert.deepEqual(trackers.trackedNumbers(), [])
  const reopened = await trackers.ensure(42)
  assert.equal(reopened.issue.number, issue.number)
  assert.ok(reopened.actionable)
  assert.deepEqual(issues.get(issue.number).labels, [{ name: 'bug' }, { name: 'slot:S21' }, { name: 'sla:7d' }])
})

test('adopts a legacy owner tracker found without its original bug label and preserves a manual closure', async () => {
  const { api, issues, writes } = fixture([{ ...legacy, labels: [] }])
  const trackers = await loadTrackers(api, ctx)
  assert.ok((await trackers.ensure(42)).actionable)
  Object.assign(issues.get(123), { state: 'closed', state_reason: 'completed', closed_by: { login: 'guillaumelauzier' } })
  const result = await trackers.ensure(42)
  assert.equal(result.issue.number, 123)
  assert.equal(result.actionable, false)
  assert.deepEqual(writes, [])
})

test('holds multiple real trackers or a mismatched private link without mutating either', async () => {
  for (const rows of [[legacy, { ...legacy, number: 124 }], [{ ...legacy, body: url + '9' }]]) {
    const f = fixture(rows)
    const t = await loadTrackers(f.api, ctx)
    assert.equal((await t.ensure(42)).actionable, false)
    assert.equal(await t.closeFixed(confirmed), false)
    assert.deepEqual(f.writes, [])
  }
})

test('untrusted replica does not become a writable tracker or own the alert', async () => {
  const { api, writes } = fixture([{ ...legacy, user: { login: 'stranger' } }])
  const t = await loadTrackers(api, ctx)
  const r = await t.ensure(42)
  assert.ok(r.created)
  assert.notEqual(r.issue.number, legacy.number)
  assert.equal(await t.closeFixed(confirmed), true)
  assert.equal(writes.some(([, path]) => path.includes('/123')), false)
})

test('claims, assignees and human workflow labels protect existing work even when added after discovery', async () => {
  for (const change of ['claim', 'assignee', 'slot:S18', 'slot:S21', 'state:in-progress', 'state:blocked', 'needs-decision']) {
    const f = fixture([legacy])
    const t = await loadTrackers(f.api, ctx)
    const { issue } = await t.ensure(42)
    if (change === 'claim') f.claims.add(123)
    else if (change === 'assignee') f.issues.get(123).assignees = [{ login: 'tester' }]
    else f.issues.get(123).labels.push({ name: change })
    assert.equal((await t.ensure(42)).actionable, false)
    await t.markReady(issue)
    await t.linkPull(issue, 99)
    assert.equal(await t.closeFixed(confirmed), false)
    assert.deepEqual(f.writes, [])
  }
})

test('S21 routing preserves ownership barriers on automatic trackers', async () => {
  for (const change of ['claim', 'assignee', 'locked', 'slot:S18', 'state:in-progress', 'state:blocked', 'needs-decision', 'needs-design']) {
    const f = fixture()
    const t = await loadTrackers(f.api, ctx)
    const { issue } = await t.ensure(42)
    await t.markReady(issue)
    f.writes.length = 0
    if (change === 'claim') f.claims.add(issue.number)
    else if (change === 'assignee') f.issues.get(issue.number).assignees = [{ login: 'tester' }]
    else if (change === 'locked') f.issues.get(issue.number).locked = true
    else f.issues.get(issue.number).labels.push({ name: change })
    assert.equal((await t.ensure(42)).actionable, false, change)
    await t.markReady(issue)
    await t.linkPrepared(issue, 'alert-fix-42')
    await t.linkPull(issue, 99)
    assert.equal(await t.closeFixed(confirmed), false, change)
    assert.deepEqual(f.writes, [], change)
  }
})

test('S21 stays a human assignment on owner-created or legacy trackers', async () => {
  for (const issue of [
    { ...legacy, user: bot },
    { ...legacy, title: '[Code Scanning] Remediate alert #42', body: '<!-- studioos-scan-remediation:42 -->\n' + url },
  ]) {
    const f = fixture([{ ...issue, labels: [{ name: 'bug' }, { name: 'slot:S21' }, { name: 'state:ready' }] }])
    const t = await loadTrackers(f.api, ctx)
    assert.equal((await t.ensure(42)).actionable, false)
    await t.markReady(issue)
    await t.linkPull(issue, 99)
    assert.equal(await t.closeFixed(confirmed), false)
    assert.deepEqual(f.writes, [])
  }
})

test('a closed fix PR returns an unclaimed review issue to ready and recovers after a partial label update', async () => {
  const f = fixture([{ ...legacy, labels: [{ name: 'bug' }, { name: 'state:review' }, { name: 'priority:high' }] }])
  const t = await loadTrackers(f.api, ctx)
  const { issue } = await t.ensure(42)
  const request = f.api.request.bind(f.api)
  let interrupted = true
  f.api.request = async (method, ...args) => {
    if (method === 'DELETE' && interrupted) {
      interrupted = false
      throw Object.assign(Error('temporary outage'), { status: 503 })
    }
    return request(method, ...args)
  }
  await assert.rejects(t.markReady(issue), /temporary outage/)
  assert.ok(f.issues.get(issue.number).labels.some(l => l.name === 'state:ready'))
  await t.markReady(issue)
  assert.deepEqual(f.issues.get(issue.number).labels.map(l => l.name), ['bug', 'priority:high', 'state:ready'])
  assert.equal(f.writes.filter(([method, , body]) => method === 'POST' && body.labels.includes('state:ready')).length, 1)
})

test('a prepared branch receives one safe comparison link and becomes ready when PR creation is restricted', async () => {
  for (const branch of ['alert-fix-42', 'alert-autofix-42']) {
    const f = fixture([legacy])
    const t = await loadTrackers(f.api, ctx)
    const { issue } = await t.ensure(42)
    for (const invalid of ['alert-fix-420', 'main', 'malicious](https://example.org)']) {
      await assert.rejects(t.linkPrepared(issue, invalid), /Invalid prepared branch/)
    }
    f.claims.add(123)
    await t.linkPrepared(issue, branch)
    assert.deepEqual(f.writes, [])
    f.claims.clear()
    await t.linkPrepared(issue, branch)
    await t.linkPrepared(issue, branch)
    const comments = f.comments.get('/issues/123/comments')
    assert.equal(comments.length, 1)
    assert.ok(comments[0].body.includes('https://github.com/AxalNetwork/StudioOS/compare/main...' + branch + ')'))
    assert.ok(comments[0].body.includes('later run'))
    assert.deepEqual(f.issues.get(123).labels.map(label => label.name), ['bug', 'state:ready'])
    assert.equal(f.issues.get(123).state, 'open')
  }
})
