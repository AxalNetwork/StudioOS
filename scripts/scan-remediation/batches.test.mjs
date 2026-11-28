// D7259: grouped remediation batches over one-to-one trackers: grouping, opacity, PR reconciliation and main-confirmed closure.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { alertRank, batchId, groupKey, planBatches, subsystemOf } from './batches.mjs'
import { reconcile } from './run.mjs'
import { BATCH_LABEL, BATCH_TITLE, parseBatch } from '../lib/scanBatchIssue.mjs'

const clock = Date.parse('2030-01-10T12:00:00Z')
const ctx = { owner: 'AxalNetwork', repo: 'StudioOS', defaultBranch: 'main', botLogin: 'axal-scan[bot]', now: () => clock,
  runNumber: 1, batchKey: 'test-key' }
const bot = { login: ctx.botLogin, type: 'Bot' }
const ref = 'refs/heads/main'
const alert = (number, rule, path, severity = 'high', tool = 'CodeQL') => ({
  number, state: 'open', tool: { name: tool }, rule: { id: rule, security_severity_level: severity },
  most_recent_instance: { ref, state: 'open', location: { path } },
})

function fixture(alerts) {
  const facts = new Map(alerts.map(a => [a.number, structuredClone(a)]))
  const issues = new Map()
  const comments = new Map()
  const claims = new Set()
  const pulls = []
  const writes = []
  const copy = x => structuredClone(x)
  const labelled = name => [...issues.values()].filter(i => i.labels.some(l => l.name === name)).map(copy)
  const api = {
    async pages(path) {
      if (path === '/issues?state=all&labels=bug') return labelled('bug')
      if (path === '/issues?state=all&labels=scan%3Abatch') return labelled('scan:batch')
      if (path === '/code-scanning/alerts?state=open&ref=refs%2Fheads%2Fmain') return [...facts.values()].filter(a => a.state === 'open').map(copy)
      if (path === '/pulls?state=open&base=main') return copy(pulls.filter(p => p.state === 'open'))
      if (path.endsWith('/comments')) return copy(comments.get(path) ?? [])
      throw Error('unexpected page: ' + path)
    },
    async searchIssues() { return [...issues.values()].map(copy) },
    async request(method, path, body) {
      if (method !== 'GET') writes.push([method, path, body])
      if (method === 'GET' && path.startsWith('/code-scanning/alerts/')) return copy(facts.get(Number(path.split('/').at(-1))))
      if (method === 'GET' && path.startsWith('/git/ref/heads/claim/')) {
        if (claims.has(Number(path.split('/').at(-1)))) return {}
        throw Object.assign(Error('not found'), { status: 404 })
      }
      if (method === 'GET' && path.startsWith('/pulls/')) return copy(pulls.find(p => p.number === Number(path.split('/').at(-1))))
      if (method === 'POST' && path === '/issues') {
        const number = Math.max(0, ...issues.keys()) + 1
        const issue = { ...body, labels: body.labels.map(name => ({ name })), number, user: bot, state: 'open', assignees: [] }
        issues.set(number, issue)
        return copy(issue)
      }
      const [, , id, resource, label] = path.split('/')
      const issue = issues.get(Number(id))
      if (!issue) throw Error('unexpected issue ' + path)
      if (method === 'GET' && !resource) return copy(issue)
      if (method === 'PATCH' && !resource) {
        Object.assign(issue, body, body.state === 'closed' ? { closed_by: bot } : {})
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
        comments.get(path).push({ ...body, user: bot, id: comments.get(path).length + 1, created_at: '2030-01-10T11:00:00Z' })
        return {}
      }
      throw Error('unexpected request: ' + method + ' ' + path)
    },
  }
  const run = (extra = {}) => reconcile(api, { ...ctx, ...extra })
  const batches = () => [...issues.values()].filter(i => i.labels.some(l => l.name === 'scan:batch'))
  const trackerOf = n => [...issues.values()].find(i => i.title === '[Code Scanning] Remediate alert #' + n)
  const labels = issue => issue.labels.map(l => l.name)
  const members = issue => parseBatch(issue, ctx)
  const fix = n => { facts.get(n).state = 'fixed'; facts.get(n).most_recent_instance.state = 'fixed' }
  return { api, run, issues, comments, claims, pulls, writes, facts, batches, trackerOf, labels, members, fix }
}

const pr = (number, body, extra = {}) => ({ number, state: 'open', body, base: { ref: 'main' },
  head: { ref: 'agent/claude/batch', repo: { full_name: 'AxalNetwork/StudioOS' } }, ...extra })

test('compatible alerts share one opaque batch; singletons keep the individual flow; reruns write nothing', async () => {
  const f = fixture([
    alert(1, 'js/sql-injection', 'cloudflare-worker/src/routes/a.ts'),
    alert(2, 'js/sql-injection', 'cloudflare-worker/src/routes/b.ts'),
    alert(3, 'js/sql-injection', 'frontend/src/x.js'),
    alert(4, 'js/xss', 'cloudflare-worker/src/c.ts', 'medium'),
  ])
  await f.run()
  const [batch] = f.batches()
  assert.equal(f.batches().length, 1)
  assert.match(batch.title, BATCH_TITLE)
  assert.deepEqual(f.labels(batch), ['scan:batch', 'slot:S21', 'state:ready'])
  assert.deepEqual(f.members(batch).members, [1, 2].map(n => ({ tracker: f.trackerOf(n).number, alert: n })))
  for (const text of [batch.title, batch.body]) {
    assert.doesNotMatch(text, /sql|injection|xss|cloudflare|routes|frontend|js\/|high|medium|codeql/i, 'no rule, path, severity or scanner')
  }
  await f.run()
  for (const n of [1, 2]) assert.deepEqual(f.labels(f.trackerOf(n)), ['bug', 'slot:S21', 'sla:7d'], 'a member is claimed through its batch')
  for (const n of [3, 4]) assert.deepEqual(f.labels(f.trackerOf(n)), ['bug', 'slot:S21', 'sla:7d', 'state:ready'], 'a singleton is unchanged')
  const before = f.writes.length
  await f.run()
  await f.run({ runNumber: 2 })
  assert.equal(f.writes.length, before, 'duplicate sweeps converge without issue, label, body or comment writes')
})

test('a new compatible alert joins the open batch, ordered by severity with production ahead of tests', async () => {
  const f = fixture([alert(1, 'js/a', 'cloudflare-worker/src/a.ts', 'medium'), alert(2, 'js/a', 'cloudflare-worker/src/b.ts', 'low')])
  await f.run()
  f.facts.set(5, alert(5, 'js/a', 'cloudflare-worker/src/routes/x.test.ts', 'high'))
  f.facts.set(6, alert(6, 'js/a', 'cloudflare-worker/src/routes/x.ts', 'high'))
  f.facts.set(7, alert(7, 'js/a', 'cloudflare-worker/src/y.ts', 'critical'))
  await f.run()
  assert.equal(f.batches().length, 1, 'no second batch for the same root cause')
  assert.deepEqual(f.members(f.batches()[0]).members.map(m => m.alert), [7, 6, 5, 1, 2])
})

test('one PR reconciles several members; main closes only the fixed ones and the rest return to the queue', async () => {
  const f = fixture([1, 2, 3].map(n => alert(n, 'js/a', 'scripts/lib/m' + n + '.mjs')))
  await f.run()
  const batch = f.batches()[0]
  const [t1, t2, t3] = [1, 2, 3].map(n => f.trackerOf(n).number)
  f.pulls.push(pr(77, `Part of #${batch.number}\nRefs #${t1}, #${t2}`))
  // Stale and foreign branches never take the batch out of the queue.
  f.pulls.push(pr(78, `Part of #${batch.number}`, { head: { ref: 'x', repo: { full_name: 'fork/StudioOS' } } }))
  f.pulls.push(pr(79, `Part of #${batch.number}`, { state: 'closed' }))
  f.pulls.push(pr(80, `Part of #${batch.number}`, { base: { ref: 'release' } }))
  await f.run()
  assert.deepEqual(f.labels(f.issues.get(batch.number)), ['scan:batch', 'slot:S21', 'state:review'])
  assert.deepEqual(f.comments.get('/issues/' + batch.number + '/comments').map(c => c.body),
    ['Tracking pull request: https://github.com/AxalNetwork/StudioOS/pull/77'])
  for (const t of [t1, t2]) assert.ok(f.labels(f.issues.get(t)).includes('state:review'))
  assert.ok(!f.labels(f.issues.get(t3)).includes('state:review'))
  const before = f.writes.length
  await f.run()
  assert.equal(f.writes.length, before, 'the review handoff is stable')

  // The PR merges. CI alone closes nothing: only alerts main's scan reports fixed close their trackers.
  f.pulls[0].state = 'closed'
  f.fix(1); f.fix(2)
  await f.run()
  assert.deepEqual([t1, t2, t3].map(t => f.issues.get(t).state), ['closed', 'closed', 'open'])
  const after = f.issues.get(batch.number)
  assert.equal(after.state, 'open')
  assert.deepEqual(f.members(after), { id: f.members(batch).id, members: [{ tracker: t3, alert: 3 }],
    resolved: [{ tracker: t1, alert: 1 }, { tracker: t2, alert: 2 }] })
  assert.deepEqual(f.labels(after), ['scan:batch', 'slot:S21', 'state:ready'], 'the unresolved member returns to the queue')

  f.fix(3)
  await f.run()
  assert.equal(f.issues.get(t3).state, 'closed')
  assert.equal(f.issues.get(batch.number).state, 'closed')
  assert.equal(f.issues.get(batch.number).state_reason, 'completed')
  assert.equal(f.batches().length, 1)
})

test('a batch closed by a merge keyword reopens while members are open; a reopened alert reopens its batch', async () => {
  const f = fixture([1, 2].map(n => alert(n, 'js/a', 'scripts/m' + n + '.mjs')))
  await f.run()
  const batch = f.issues.get(f.batches()[0].number)
  Object.assign(batch, { state: 'closed', state_reason: 'completed', closed_by: { login: 'maintainer' } })
  await f.run()
  assert.equal(batch.state, 'open', 'a merged PR closing the batch is not main-scan confirmation')

  f.fix(1); f.fix(2)
  await f.run()
  assert.equal(batch.state, 'closed')
  const alertBack = f.facts.get(1)
  alertBack.state = 'open'; alertBack.most_recent_instance.state = 'open'
  await f.run()
  assert.equal(f.trackerOf(1).state, 'open')
  assert.equal(batch.state, 'open')
  assert.deepEqual(f.members(batch).members, [{ tracker: f.trackerOf(1).number, alert: 1 }])
  assert.deepEqual(f.members(batch).resolved, [{ tracker: f.trackerOf(2).number, alert: 2 }])
  assert.equal(f.batches().length, 1, 'the reopened alert does not spawn a duplicate batch')
})

test('a batch a person closed as not planned returns its trackers to individual work', async () => {
  const f = fixture([1, 2].map(n => alert(n, 'js/a', 'scripts/m' + n + '.mjs')))
  await f.run()
  const batch = f.issues.get(f.batches()[0].number)
  Object.assign(batch, { state: 'closed', state_reason: 'not_planned', closed_by: { login: 'guillaumelauzier' } })
  await f.run()
  await f.run()
  assert.equal(batch.state, 'closed')
  assert.equal(f.batches().length, 1)
  for (const n of [1, 2]) assert.ok(f.labels(f.trackerOf(n)).includes('state:ready'))
})

test('a claimed batch or a fresh STATUS on it is never relabelled or commented by the sweep', async () => {
  for (const hold of ['claim', 'status', 'state']) {
    const f = fixture([1, 2].map(n => alert(n, 'js/a', 'scripts/m' + n + '.mjs')))
    await f.run()
    const batch = f.issues.get(f.batches()[0].number)
    if (hold === 'claim') f.claims.add(batch.number)
    if (hold === 'status') f.comments.set('/issues/' + batch.number + '/comments', [{ id: 1, user: { login: 'guillaumelauzier' },
      created_at: '2030-01-10T11:00:00Z', body: '```text\nSTATUS\ntask: #' + batch.number + '   slot: S21   agent: Codex\nstate: IN_PROGRESS\n```' }])
    if (hold === 'state') batch.labels = batch.labels.filter(l => l.name !== 'state:ready').concat({ name: 'state:in-progress' })
    const labels = f.labels(batch)
    f.pulls.push(pr(77, 'Part of #' + batch.number))
    const before = f.writes.length
    await f.run()
    await f.run()
    assert.deepEqual(f.writes.slice(before).filter(([, path]) => path.startsWith('/issues/' + batch.number)), [], hold)
    assert.deepEqual(f.labels(batch), labels, hold)
  }
})

test('a tracker listed by two batches stays with the lower one; an untrusted look-alike batch is ignored', async () => {
  const f = fixture([1, 2].map(n => alert(n, 'js/a', 'scripts/m' + n + '.mjs')))
  await f.run()
  const first = f.issues.get(f.batches()[0].number)
  const copy = { ...structuredClone(first), number: 50, user: { login: 'axal-scan[bot]' } }
  copy.title = copy.title.replace(/[0-9a-f]{8}$/, 'ffffffff')
  copy.body = copy.body.replace(/batch:[0-9a-f]{8}/, 'batch:ffffffff')
  f.issues.set(50, copy)
  const forged = { ...structuredClone(first), number: 51, user: { login: 'someone' }, body: first.body }
  f.issues.set(51, forged)
  await f.run()
  assert.deepEqual(f.members(f.issues.get(first.number)).members.length, 2)
  assert.deepEqual(f.members(f.issues.get(50)).members, [], 'the duplicate listing converges to the lower-numbered batch')
  assert.equal(f.issues.get(51).body, first.body, 'a batch not filed by the bot is never written')
})

test('the batch label is declared, so labels-sync creates it', () => {
  const labels = readFileSync(new URL('../../.github/labels.yml', import.meta.url), 'utf8')
  assert.ok(labels.includes(`- name: "${BATCH_LABEL}"`))
})

test('grouping keys: scanner, rule and owning subsystem, with shared root-cause overrides', () => {
  assert.deepEqual(['cloudflare-worker/src/routes/a.ts', 'cloudflare-worker/test/a.mjs', 'scripts/lib/x.mjs', 'README.md',
    'frontend/vite.config.js', '../etc', '/abs', ''].map(subsystemOf),
  ['cloudflare-worker/src', 'cloudflare-worker/test', 'scripts', '(root)', 'frontend', null, null, null])
  const a = alert(1, 'js/a', 'scripts/a.mjs')
  assert.equal(groupKey(a), groupKey(alert(2, 'js/a', 'scripts/lib/b.mjs')))
  assert.notEqual(groupKey(a), groupKey(alert(3, 'js/a', 'scripts/a.mjs', 'high', 'Semgrep')))
  assert.notEqual(groupKey(a), groupKey(alert(4, 'js/b', 'scripts/a.mjs')))
  assert.equal(groupKey({ ...a, rule: {} }), null)
  assert.equal(groupKey({ ...a, most_recent_instance: { ref } }), null)
  const overrides = [{ cause: 'escaping', rules: ['js/a', 'js/b'] }, { cause: 'everywhere', rules: ['js/c'], acrossSubsystems: true }]
  assert.equal(groupKey(a, overrides), groupKey(alert(4, 'js/b', 'scripts/a.mjs'), overrides))
  assert.notEqual(groupKey(a, overrides), groupKey(alert(5, 'js/b', 'backend/app/a.py'), overrides))
  assert.equal(groupKey(alert(6, 'js/c', 'scripts/a.mjs'), overrides), groupKey(alert(7, 'js/c', 'frontend/src/a.js'), overrides))
  assert.deepEqual([alertRank(alert(1, 'r', 'a/b.js', 'critical')), alertRank(alert(1, 'r', 'a/b.test.js', 'low')),
    alertRank({ rule: { severity: 'warning' }, most_recent_instance: { location: { path: 'tests/x.py' } } }), alertRank({})],
  [[-4, 0], [-1, 1], [-2, 1], [-0, 1]])
})

test('new batches are filed highest priority first within the per-run limit, with keyed opaque ids', () => {
  const tracker = new Map()
  const alerts = [
    alert(1, 'r/low', 'scripts/a.mjs', 'low'), alert(2, 'r/low', 'scripts/b.mjs', 'low'),
    alert(3, 'r/test', 'scripts/a.test.mjs', 'critical'), alert(4, 'r/test', 'scripts/b.test.mjs', 'critical'),
    alert(5, 'r/prod', 'scripts/c.mjs', 'critical'), alert(6, 'r/prod', 'scripts/d.test.mjs', 'critical'),
    alert(7, 'r/alone', 'scripts/e.mjs', 'critical'),
  ]
  for (const a of alerts) tracker.set(a.number, { number: 100 + a.number, state: 'open', labels: [{ name: 'slot:S21' }], assignees: [] })
  const plan = secret => planBatches({ alerts, trackerFor: n => tracker.get(n), batches: [], secret, limit: 2 })
  const filed = plan('k')
  assert.deepEqual(filed.map(e => e.members.map(m => m.alert)), [[5, 6], [3, 4]], 'production before test-only, low waits')
  assert.deepEqual(filed.map(e => e.id), filed.map(e => batchId(e.key, 'k')))
  assert.deepEqual(plan('k').map(e => e.id), filed.map(e => e.id), 'a configured key gives stable ids')
  assert.notDeepEqual(plan('other').map(e => e.id), filed.map(e => e.id))
  assert.ok(filed.every(e => /^[0-9a-f]{8}$/.test(e.id)))
  tracker.get(3).labels.push({ name: 'state:in-progress' })
  tracker.get(5).assignees = [{ login: 'maintainer' }]
  assert.deepEqual(plan('k').map(e => e.members.map(m => m.alert)), [[1, 2]], 'claimed or assigned trackers never join')
})
