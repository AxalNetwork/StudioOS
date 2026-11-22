// D8074: the seven-day SLA marks a late task once, and the weekly digest renders counts only.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { breachPass, digestText, isDigestRun, openSecurityTasks, DIGEST_CRON, BREACHED_LABEL } from './sla.mjs'

const NOW = new Date('2026-11-21T12:00:00Z')
const daysAgo = d => new Date(NOW.getTime() - d * 86_400_000).toISOString()
const bot = { login: 'github-actions[bot]' }
const task = (number, title, ageDays, extra = {}) => ({ number, title, state: 'open', user: bot,
  created_at: daysAgo(ageDays), labels: [{ name: 'bug' }, { name: 'sla:7d' }], ...extra })

function fake(issues) {
  const comments = new Map()
  const writes = []
  const api = {
    async pages(path) {
      if (path === '/issues?state=open&labels=sla%3A7d') return structuredClone(issues)
      const m = path.match(/^\/issues\/(\d+)\/comments$/)
      if (m) return structuredClone(comments.get(Number(m[1])) ?? [])
      throw Error('unexpected page ' + path)
    },
    async request(method, path, body) {
      writes.push([method, path, body])
      const m = path.match(/^\/issues\/(\d+)\/(labels|comments)$/)
      const issue = issues.find(i => i.number === Number(m?.[1]))
      if (!issue) throw Error('unexpected request ' + method + ' ' + path)
      if (m[2] === 'labels') for (const name of body.labels) issue.labels.push({ name })
      else comments.set(issue.number, [...(comments.get(issue.number) ?? []), { ...body, user: bot }])
      return {}
    },
  }
  return { api, writes, comments }
}

const fixtures = () => [
  task(1, '[Code Scanning] Remediate alert #11', 2),
  task(2, '[Dependabot] Remediate alert #12', 8),
  task(3, '[Secret Scanning] Remediate alert #13', 40),
  task(4, '[Dependabot] Remediate alert #14', 9, { user: { login: 'someone-else' } }),
  task(5, 'An unrelated issue that happens to carry the label', 30),
  task(6, '[Dependabot] Remediate alert #16', 10, { pull_request: {} }),
]

test('a task past seven days gains sla:breached and one comment; a second pass adds neither', async () => {
  const issues = fixtures()
  const f = fake(issues)
  assert.equal(await breachPass(f.api, { now: NOW }), 2)
  assert.equal(await breachPass(f.api, { now: NOW }), 0)
  const late = issues.filter(i => i.labels.some(l => l.name === BREACHED_LABEL)).map(i => i.number)
  assert.deepEqual(late, [2, 3], 'only this workflow\'s own tasks, and only the late ones')
  assert.deepEqual([...f.comments].map(([n, c]) => [n, c.length]), [[2, 1], [3, 1]])
  assert.ok(f.writes.every(([, path]) => !path.startsWith('/issues/1/')), 'a 2-day task is left alone')
})

test('the SLA is seven whole days: six days is not late, exactly seven is', async () => {
  const issues = [task(7, '[Dependabot] Remediate alert #17', 6.9), task(8, '[Dependabot] Remediate alert #18', 7)]
  const f = fake(issues)
  assert.equal(await breachPass(f.api, { now: NOW }), 1)
  assert.deepEqual(issues.filter(i => i.labels.some(l => l.name === BREACHED_LABEL)).map(i => i.number), [8])
  const text = digestText(await openSecurityTasks(fake([task(9, '[Dependabot] Remediate alert #19', 7)]).api, {}, NOW), NOW)
  assert.match(text, /• Dependabot: 1 open, 1 past seven days/)
  assert.match(text, /Age: under 7 days 0 · 7 to 30 days 1 · over 30 days 0/)
})

test('a label write that failed is retried without a second comment', async () => {
  const issues = [task(2, '[Dependabot] Remediate alert #12', 8)]
  const f = fake(issues)
  const real = f.api.request
  let fail = true
  f.api.request = async (method, path, body) => {
    if (fail && path.endsWith('/labels')) { fail = false; throw Object.assign(Error('GitHub HTTP 502'), { status: 502 }) }
    return real(method, path, body)
  }
  await assert.rejects(breachPass(f.api, { now: NOW }))
  assert.equal(await breachPass(f.api, { now: NOW }), 1)
  assert.equal(f.comments.get(2).length, 1)
})

test('the digest renders counts per source and age from fixtures, and names no task, alert or rule', async () => {
  const f = fake(fixtures())
  const text = digestText(await openSecurityTasks(f.api, {}, NOW), NOW)
  assert.equal(text, [
    'Weekly security digest for 2026-11-21: 3 open security tasks.',
    '• Code Scanning: 1 open, 0 past seven days',
    '• Dependabot: 1 open, 1 past seven days',
    '• Secret Scanning: 1 open, 1 past seven days',
    'Age: under 7 days 1 · 7 to 30 days 1 · over 30 days 1',
  ].join('\n'))
  assert.ok(!/#\d|Remediate|alert #/.test(text))
  assert.equal(digestText([], NOW).split('\n')[0], 'Weekly security digest for 2026-11-21: 0 open security tasks.')
})

test('the digest runs on its own schedule or on request, and the workflow carries the same schedule', () => {
  assert.ok(isDigestRun({ SCAN_SCHEDULE: DIGEST_CRON }))
  assert.ok(isDigestRun({ SCAN_DIGEST: 'true' }))
  assert.ok(!isDigestRun({ SCAN_SCHEDULE: '23 * * * *', SCAN_DIGEST: 'false' }))
  const workflow = readFileSync(new URL('../../.github/workflows/scan-remediation.yml', import.meta.url), 'utf8')
  assert.ok(workflow.includes(`- cron: '${DIGEST_CRON}'`))
  assert.ok(workflow.includes("- cron: '23 * * * *'"), 'the sweep runs hourly, so a new alert is filed within an hour')
  for (const p of ['permission-vulnerability-alerts: read', 'permission-secret-scanning-alerts: read']) assert.ok(workflow.includes(p))
  assert.ok(workflow.includes("(inputs.digest || github.event.schedule == '" + DIGEST_CRON + "') && secrets.SLACK_GITHUB_WEBHOOK_URL || ''"),
    'only the digest run receives the webhook')
  const labels = readFileSync(new URL('../../.github/labels.yml', import.meta.url), 'utf8')
  for (const name of ['sla:7d', 'sla:breached']) assert.ok(labels.includes(`- name: "${name}"`))
})
