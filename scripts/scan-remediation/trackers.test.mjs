// Regression coverage for issue ownership, retry-safe tracking and scanner-confirmed closure.
import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTrackers } from './trackers.mjs'
import { reconcile } from './run.mjs'

const clock = Date.parse('2030-01-10T12:00:00Z')
const ctx = { owner: 'AxalNetwork', repo: 'StudioOS', defaultBranch: 'main', botLogin: 'axal-scan[bot]', now: () => clock }
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
  const pulls = []
  const writes = []
  const copy = x => structuredClone(x)
  const api = {
    async pages(path) {
      if (path === '/issues?state=all&labels=bug') return [...issues.values()].filter(i => i.labels.some(l => l.name === 'bug')).map(copy)
      if (path.endsWith('/comments')) return copy(comments.get(path) ?? [])
      if (path === '/pulls?state=open&base=main') return copy(pulls)
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
      if (method === 'GET' && path.startsWith('/pulls/')) {
        const number = Number(path.split('/').at(-1))
        return copy(pulls.find(p => p.number === number) ?? { number, state: 'open', body: url,
          base: { ref: 'main' }, head: { repo: { full_name: 'AxalNetwork/StudioOS' } } })
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
  return { api, writes, issues, claims, comments, pulls }
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

const status = (number, state = 'READY_FOR_REVIEW', extra = {}) => ({
  id: 1, user: { login: 'guillaumelauzier' }, created_at: '2030-01-10T11:00:00Z',
  body: '```text\nSTATUS\ntask: #' + number + '   slot: S21   agent: Codex\nstate: ' + state + '\n```', ...extra,
})

test('a fresh trusted STATUS posted after discovery preserves label-claimed work before every mutation', async () => {
  for (const state of ['IN_PROGRESS', 'BLOCKED', 'READY_FOR_REVIEW']) {
    const f = fixture()
    const t = await loadTrackers(f.api, ctx)
    const { issue } = await t.ensure(42)
    f.issues.get(issue.number).labels.push({ name: 'state:review' })
    f.comments.set('/issues/' + issue.number + '/comments', [status(issue.number, state)])
    f.writes.length = 0
    assert.equal((await t.ensure(42)).actionable, false, state)
    await t.markReady(issue)
    await t.linkPull(issue, 99)
    assert.equal(await t.closeFixed(confirmed), false, state)
    assert.deepEqual(f.writes, [], state)
  }
})

test('a STATUS expires exactly at 24 hours; an issue timestamp cannot extend its hold', async () => {
  const f = fixture([legacy])
  let now = clock - 1
  const t = await loadTrackers(f.api, { ...ctx, now: () => now })
  f.comments.set('/issues/123/comments', [status(123, 'IN_PROGRESS', { created_at: '2030-01-09T12:00:00Z' })])
  f.issues.get(123).updated_at = '2030-01-10T11:59:59Z'
  assert.equal((await t.ensure(42)).actionable, false)
  now = clock
  assert.equal((await t.ensure(42)).actionable, true)
  await t.markReady(legacy)
  assert.deepEqual(f.issues.get(123).labels.map(l => l.name), ['bug', 'state:ready'])
})

test('only the latest trusted STATUS for this task and S21 can hold the tracker', async () => {
  const rejected = [
    status(123, 'DONE'),
    status(123, 'IN_PROGRESS', { created_at: '2030-01-10T12:00:01Z' }),
    status(123, 'IN_PROGRESS', { created_at: 'not a date' }),
    status(123, 'IN_PROGRESS', { user: { login: 'stranger' } }),
    status(124, 'IN_PROGRESS'),
    status(123, 'IN_PROGRESS', { body: status(123).body.replace('slot: S21', 'slot: S18') }),
    status(123, 'IN_PROGRESS', { body: 'STATUS\ntask: #123 slot: S21\nstate: IN_PROGRESS' }),
    status(123, 'IN_PROGRESS', { body: 'Example report:\n' + status(123).body }),
    status(123, 'IN_PROGRESS', { body: '> ' + status(123).body.split('\n').join('\n> ') }),
  ]
  for (const comment of rejected) {
    const f = fixture([legacy])
    f.comments.set('/issues/123/comments', [comment])
    const t = await loadTrackers(f.api, ctx)
    assert.equal((await t.ensure(42)).actionable, true, comment.body)
  }
  const f = fixture([legacy])
  f.comments.set('/issues/123/comments', [
    status(123, 'DONE', { id: 2, created_at: '2030-01-10T11:30:00Z' }),
    status(123, 'IN_PROGRESS'),
  ])
  const t = await loadTrackers(f.api, ctx)
  assert.equal((await t.ensure(42)).actionable, true, 'a later DONE releases an earlier active STATUS regardless of API order')
})

test('review plus an open same-repo tracker PR holds across sweeps, and a closed PR returns unresolved work', async () => {
  const f = fixture()
  const t = await loadTrackers(f.api, ctx)
  const { issue } = await t.ensure(42)
  f.issues.get(issue.number).labels.push({ name: 'state:review' })
  f.pulls.push({ number: 99, state: 'open', body: 'Part of #' + issue.number,
    base: { ref: 'main' }, head: { repo: { full_name: 'AxalNetwork/StudioOS' } } })
  f.writes.length = 0
  assert.equal((await t.ensure(42)).actionable, false)
  await t.markReady(issue)
  assert.deepEqual(f.writes, [])
  f.pulls[0].state = 'closed'
  assert.equal((await t.ensure(42)).actionable, true)
  await t.markReady(issue)
  assert.deepEqual(f.issues.get(issue.number).labels.map(l => l.name), ['bug', 'slot:S21', 'sla:7d', 'state:ready'])
  assert.equal(f.issues.get(issue.number).state, 'open', 'PR closure alone does not close an unresolved tracker')
})

test('an unreadable handoff history never becomes permission to mark work ready', async () => {
  const f = fixture([legacy])
  const pages = f.api.pages
  f.api.pages = async path => {
    if (path.endsWith('/comments')) throw Object.assign(Error('unavailable'), { status: 503 })
    return pages(path)
  }
  const t = await loadTrackers(f.api, ctx)
  await assert.rejects(t.ensure(42), /unavailable/)
  await assert.rejects(t.markReady(legacy), /unavailable/)
  assert.deepEqual(f.writes, [])
})

test('a STATUS created while its history is being read is fresh, not a future report', async () => {
  const f = fixture([legacy])
  let now = clock
  const pages = f.api.pages
  f.api.pages = async path => {
    if (path.endsWith('/comments')) {
      now = clock + 1000
      return [status(123, 'IN_PROGRESS', { created_at: new Date(now).toISOString() })]
    }
    return pages(path)
  }
  const t = await loadTrackers(f.api, { ...ctx, now: () => now })
  assert.equal((await t.ensure(42)).actionable, false)
  await t.markReady(legacy)
  assert.deepEqual(f.writes, [])
})

test('a STATUS arriving during a traceability comment prevents subsequent label writes', async () => {
  const f = fixture([legacy])
  const request = f.api.request
  f.api.request = async (method, path, body) => {
    const result = await request(method, path, body)
    if (method === 'POST' && path.endsWith('/comments')) f.comments.get(path).push(status(123, 'IN_PROGRESS'))
    return result
  }
  const t = await loadTrackers(f.api, ctx)
  await t.linkPull(legacy, 99)
  assert.deepEqual(f.writes.map(([method, path]) => [method, path]), [['POST', '/issues/123/comments']])
})

test('a STATUS arriving between review removal and ready addition prevents a queue handback', async () => {
  const f = fixture([{ ...legacy, labels: [{ name: 'bug' }, { name: 'state:review' }] }])
  const request = f.api.request
  f.api.request = async (method, path, body) => {
    const result = await request(method, path, body)
    if (method === 'DELETE' && path.endsWith('/labels/state%3Areview')) {
      f.comments.set('/issues/123/comments', [status(123, 'IN_PROGRESS')])
    }
    return result
  }
  const t = await loadTrackers(f.api, ctx)
  await t.markReady(legacy)
  assert.deepEqual(f.writes.map(([method, path]) => [method, path]), [['DELETE', '/issues/123/labels/state%3Areview']])
  assert.equal(f.issues.get(123).labels.some(l => l.name === 'state:ready'), false)
})

test('a handoff arriving during reopen preserves review and makes the tracker non-actionable', async () => {
  const f = fixture()
  const t = await loadTrackers(f.api, ctx)
  const { issue } = await t.ensure(42)
  await t.linkPull(issue, 99)
  await t.closeFixed(confirmed)
  const request = f.api.request
  f.api.request = async (method, path, body) => {
    const result = await request(method, path, body)
    if (method === 'PATCH' && body.state === 'open') {
      f.comments.get(path + '/comments').push(status(issue.number, 'IN_PROGRESS'))
    }
    return result
  }
  f.writes.length = 0
  const reopened = await t.ensure(42)
  assert.equal(reopened.actionable, false)
  assert.deepEqual(f.writes.map(([method, path]) => [method, path]), [['PATCH', '/issues/' + issue.number]])
  assert.ok(f.issues.get(issue.number).labels.some(l => l.name === 'state:review'))
})

test('linking rechecks the exact PR and refuses a closed, retargeted, detached, fork or mismatched snapshot', async () => {
  const pull = { number: 99, state: 'open', body: url, base: { ref: 'main' }, head: { repo: { full_name: 'AxalNetwork/StudioOS' } } }
  for (const change of [
    { state: 'closed' }, { base: { ref: 'other' } }, { head: { repo: { full_name: 'fork/StudioOS' } } }, { number: 98 }, { body: '' },
  ]) {
    const f = fixture([legacy])
    const request = f.api.request
    f.api.request = async (method, path, body) => path === '/pulls/99' ? { ...pull, ...change } : request(method, path, body)
    const t = await loadTrackers(f.api, ctx)
    await t.linkPull(legacy, 99)
    assert.deepEqual(f.writes, [], JSON.stringify(change))
  }
})

test('canonical-only open PRs hold review across mutation paths until the matching PR closes', async () => {
  const f = fixture()
  const t = await loadTrackers(f.api, ctx)
  const { issue } = await t.ensure(42)
  f.issues.get(issue.number).labels.push({ name: 'state:review' })
  f.pulls.push({ number: 99, state: 'open', body: url,
    base: { ref: 'main' }, head: { repo: { full_name: 'AxalNetwork/StudioOS' } } })
  f.writes.length = 0
  assert.equal((await t.ensure(42)).actionable, false)
  await t.markReady(issue)
  assert.equal(await t.closeFixed(confirmed), false)
  assert.deepEqual(f.writes, [])
  for (const body of [url + '0', url.replace('/code-scanning/', '/dependabot/'), url.replace('AxalNetwork', 'other')]) {
    f.pulls[0].body = body
    assert.equal((await t.ensure(42)).actionable, true, 'another alert/source/repository cannot hold this tracker')
  }
  f.pulls[0].body = url
  f.pulls[0].state = 'closed'
  assert.equal((await t.ensure(42)).actionable, true)
  assert.equal(await t.closeFixed(confirmed), true)
})

test('full reconciliation retries a partial multi-PR handoff without leaving work ready or duplicating comments', async () => {
  const f = fixture()
  const t = await loadTrackers(f.api, ctx)
  const { issue } = await t.ensure(42)
  await t.markReady(issue)
  for (const number of [98, 99]) f.pulls.push({ number, state: 'open', body: 'Refs #' + issue.number,
    base: { ref: 'main' }, head: { repo: { full_name: 'AxalNetwork/StudioOS' } } })
  const alert = { number: 42, state: 'open', most_recent_instance: { ref: 'refs/heads/main', state: 'open' } }
  const pages = f.api.pages
  f.api.pages = path => path.startsWith('/code-scanning/alerts?') ?
    Promise.resolve(alert.state === 'open' ? [structuredClone(alert)] : []) : pages(path)
  const request = f.api.request
  let failReview = true
  f.api.request = async (method, path, body) => {
    if (path === '/code-scanning/alerts/42') return structuredClone(alert)
    if (method === 'POST' && path.endsWith('/labels') && body.labels.includes('state:review') && failReview) {
      failReview = false
      throw Object.assign(Error('temporary outage'), { status: 503 })
    }
    return request(method, path, body)
  }
  const run = () => reconcile(f.api, { ...ctx, runNumber: 1 })
  await assert.rejects(run(), /1 alert operations need retry/)
  assert.equal(f.issues.get(issue.number).labels.some(l => l.name === 'state:ready'), false)
  await run()
  const before = f.writes.length
  await run()
  assert.equal(f.writes.length, before, 'a completed review handoff is stable on the next sweep')
  assert.deepEqual(f.issues.get(issue.number).labels.map(l => l.name), ['bug', 'slot:S21', 'sla:7d', 'state:review'])
  assert.deepEqual(f.comments.get('/issues/' + issue.number + '/comments').map(c => c.body), [
    'Tracking pull request: https://github.com/AxalNetwork/StudioOS/pull/98',
    'Tracking pull request: https://github.com/AxalNetwork/StudioOS/pull/99',
  ])
  f.pulls[0].state = 'closed'
  await run()
  assert.equal(f.issues.get(issue.number).labels.some(l => l.name === 'state:review'), true, 'the remaining open PR keeps review')
  f.pulls[1].state = 'closed'
  await run()
  assert.deepEqual(f.issues.get(issue.number).labels.map(l => l.name), ['bug', 'slot:S21', 'sla:7d', 'state:ready'])
  assert.equal(f.issues.get(issue.number).state, 'open', 'PR closure is not scanner confirmation')
  alert.state = alert.most_recent_instance.state = 'fixed'
  await run()
  assert.equal(f.issues.get(issue.number).state, 'closed')
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
  assert.equal(f.issues.get(issue.number).labels.some(l => l.name === 'state:ready'), false)
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
