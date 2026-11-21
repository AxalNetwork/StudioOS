// D8074: Dependabot and secret-scanning alerts become one S21 task each, idempotently, closed only when GitHub confirms.
import test from 'node:test'
import assert from 'node:assert/strict'
import { githubApi } from './github.mjs'
import { reconcileSource } from './run.mjs'
import { dependabot, secretScanning, codeScanning } from './sources.mjs'

const options = { owner: 'AxalNetwork', repo: 'StudioOS', defaultBranch: 'main', runNumber: 1, botLogin: 'github-actions[bot]' }
// Invented values only. The "secret" is a fixture string GitHub would never return with hide_secret=true.
const FAKE_SECRET = 'fixture-not-a-real-credential-0000'
const FAKE_PATH = 'fixtures/never-shown.env'

/** An in-memory GitHub behind the real REST transport, so paths, pagination and encoding are exercised. */
function fakeGitHub({ dependabotAlerts = [], secretAlerts = [], forbid = [] } = {}) {
  const issues = new Map()
  const comments = new Map()
  const writes = []
  const reads = []
  const alertsBy = { dependabot: dependabotAlerts, 'secret-scanning': secretAlerts }
  const api = githubApi(options.owner, options.repo, 'test-token', async (url, request) => {
    const parsed = new URL(url)
    const path = parsed.pathname.replace('/repos/AxalNetwork/StudioOS', '')
    const method = request.method
    const body = request.body ? JSON.parse(request.body) : undefined
    if (method === 'GET') reads.push(path + parsed.search); else writes.push([method, path, body])
    const page = Number(parsed.searchParams.get('page') || 1)
    const list = rows => Response.json(page === 1 ? rows : [])
    const kind = path.match(/^\/(dependabot|secret-scanning)\/alerts(?:\/(\d+))?$/)
    if (kind) {
      if (forbid.includes(kind[1])) return new Response('detail', { status: 403 })
      if (kind[1] === 'secret-scanning') assert.equal(parsed.searchParams.get('hide_secret'), 'true', 'a secret is never fetched')
      const rows = alertsBy[kind[1]]
      if (!kind[2]) return list(rows.filter(a => a.state === parsed.searchParams.get('state')))
      const row = rows.find(a => a.number === Number(kind[2]))
      return row ? Response.json(row) : new Response(null, { status: 404 })
    }
    if (method === 'GET' && path === '/issues') return list([...issues.values()].filter(i => i.labels.some(l => l.name === 'bug')))
    if (method === 'GET' && path === '/search/issues') return Response.json({ total_count: 0, incomplete_results: false, items: [] })
    if (method === 'GET' && path.startsWith('/git/ref/heads/claim/')) return new Response(null, { status: 404 })
    if (method === 'POST' && path === '/issues') {
      const number = 900 + issues.size
      const issue = { ...body, number, state: 'open', user: { login: options.botLogin }, labels: body.labels.map(name => ({ name })), assignees: [] }
      issues.set(number, issue)
      return Response.json(issue)
    }
    const m = path.match(/^\/issues\/(\d+)(\/labels|\/comments)?(?:\/(.+))?$/)
    const issue = m && issues.get(Number(m[1]))
    if (!issue) throw Error('Unexpected request: ' + method + ' ' + path)
    if (method === 'GET' && !m[2]) return Response.json(issue)
    if (method === 'PATCH' && !m[2]) {
      // The reconciler only ever PATCHes a tracker's state and reason.
      issue.state = body.state
      if (body.state_reason) issue.state_reason = body.state_reason
      if (body.state === 'closed') issue.closed_by = { login: options.botLogin }
      return Response.json(issue)
    }
    if (m[2] === '/labels' && method === 'POST') {
      for (const name of body.labels) if (!issue.labels.some(l => l.name === name)) issue.labels.push({ name })
      return Response.json(issue.labels)
    }
    if (m[2] === '/labels' && method === 'DELETE') {
      issue.labels = issue.labels.filter(l => l.name !== decodeURIComponent(m[3]))
      return new Response(null, { status: 204 })
    }
    if (m[2] === '/comments') {
      if (!comments.has(issue.number)) comments.set(issue.number, [])
      if (method === 'GET') return list(comments.get(issue.number))
      comments.get(issue.number).push({ ...body, user: { login: options.botLogin } })
      return Response.json({})
    }
    throw Error('Unexpected request: ' + method + ' ' + path)
  })
  return { api, issues, comments, writes, reads }
}

const depAlert = (number, state = 'open') => ({ number, state, security_advisory: { ghsa_id: 'GHSA-abcd-efgh-ijkl' },
  dependency: { package: { name: 'invented-package' }, manifest_path: FAKE_PATH } })
const secretAlert = (number, state = 'open', resolution = null) => ({ number, state, resolution,
  secret_type: 'invented_provider_token', secret: FAKE_SECRET, locations_url: 'https://api.github.com/' + FAKE_PATH })

for (const [source, make] of [[dependabot, depAlert], [secretScanning, secretAlert]]) {
  test(`${source.name}: one alert files exactly one S21 task, and a re-run files none`, async () => {
    const gh = fakeGitHub({ [source === dependabot ? 'dependabotAlerts' : 'secretAlerts']: [make(7)] })
    assert.equal(await reconcileSource(gh.api, source, options), 1)
    assert.equal(await reconcileSource(gh.api, source, options), 1)
    const filed = gh.writes.filter(([method, path]) => method === 'POST' && path === '/issues')
    assert.equal(filed.length, 1, 'exactly one task across two runs')
    const [issue] = gh.issues.values()
    assert.equal(issue.title, `[${source.name}] Remediate alert #7`)
    assert.deepEqual(issue.labels.map(l => l.name), ['bug', 'slot:S21', 'sla:7d', 'state:ready'])
    assert.ok(issue.body.split('\n').includes(source.marker(7)), 'the dedup marker names the source and the alert')
    assert.ok(issue.body.includes(`https://github.com/AxalNetwork/StudioOS/security/${source.urlPart}/7`))
    assert.ok(!issue.body.includes(FAKE_SECRET) && !issue.body.includes(FAKE_PATH) && !issue.body.includes('invented-package'),
      'no secret, location or package in the public body')
  })
}

test('the rule shown is the alert\'s published identifier, and nothing that is not one', async () => {
  const gh = fakeGitHub({ secretAlerts: [secretAlert(3)] })
  await reconcileSource(gh.api, secretScanning, options)
  assert.match([...gh.issues.values()][0].body, /^Rule: `invented_provider_token`$/m)
  const odd = secretAlert(4); odd.secret_type = 'has spaces <b>and markup</b>'
  const gh2 = fakeGitHub({ secretAlerts: [odd] })
  await reconcileSource(gh2.api, secretScanning, options)
  const body = [...gh2.issues.values()][0].body
  assert.ok(!body.includes('markup'))
  assert.match(body, /^Rule: not recorded here/m)
})

test('secret scanning is always listed with hide_secret, and its alert reads ask for the same', async () => {
  const gh = fakeGitHub({ secretAlerts: [secretAlert(5)] })
  await reconcileSource(gh.api, secretScanning, options)
  const alertReads = gh.reads.filter(r => r.startsWith('/secret-scanning/'))
  assert.ok(alertReads.length >= 2 && alertReads.every(r => r.includes('hide_secret=true')))
})

test('Dependabot: a fixed alert closes its task; a dismissed one leaves it for a person', async () => {
  const alerts = [depAlert(1), depAlert(2)]
  const gh = fakeGitHub({ dependabotAlerts: alerts })
  await reconcileSource(gh.api, dependabot, options)
  alerts[0].state = 'fixed'
  alerts[1].state = 'dismissed'
  await reconcileSource(gh.api, dependabot, options)
  const byAlert = n => [...gh.issues.values()].find(i => i.title.endsWith('#' + n))
  assert.equal(byAlert(1).state, 'closed')
  assert.equal(byAlert(1).state_reason, 'completed')
  assert.equal(byAlert(2).state, 'open')
})

test('secret scanning: only a revoked secret closes its task', async () => {
  const alerts = [secretAlert(1), secretAlert(2), secretAlert(3)]
  const gh = fakeGitHub({ secretAlerts: alerts })
  await reconcileSource(gh.api, secretScanning, options)
  Object.assign(alerts[0], { state: 'resolved', resolution: 'revoked' })
  Object.assign(alerts[1], { state: 'resolved', resolution: 'false_positive' })
  Object.assign(alerts[2], { state: 'resolved', resolution: 'wont_fix' })
  await reconcileSource(gh.api, secretScanning, options)
  const states = [1, 2, 3].map(n => [...gh.issues.values()].find(i => i.title.endsWith('#' + n)).state)
  assert.deepEqual(states, ['closed', 'open', 'open'])
})

test('a reopened alert reopens its task instead of filing a second one', async () => {
  const alerts = [depAlert(9)]
  const gh = fakeGitHub({ dependabotAlerts: alerts })
  await reconcileSource(gh.api, dependabot, options)
  alerts[0].state = 'fixed'
  await reconcileSource(gh.api, dependabot, options)
  alerts[0].state = 'open'
  await reconcileSource(gh.api, dependabot, options)
  assert.equal(gh.issues.size, 1)
  assert.equal([...gh.issues.values()][0].state, 'open')
})

test('a task a session has claimed is never marked ready again', async () => {
  const gh = fakeGitHub({ dependabotAlerts: [depAlert(6)] })
  await reconcileSource(gh.api, dependabot, options)
  const [issue] = gh.issues.values()
  issue.labels = [{ name: 'bug' }, { name: 'slot:S15' }, { name: 'sla:7d' }, { name: 'state:in-progress' }]
  const before = gh.writes.length
  await reconcileSource(gh.api, dependabot, options)
  assert.deepEqual(gh.writes.slice(before), [], 'no label, comment or state write on claimed work')
})

test('a source this credential cannot read is skipped, not failed, and writes nothing', async () => {
  const gh = fakeGitHub({ forbid: ['dependabot'] })
  assert.equal(await reconcileSource(gh.api, dependabot, options), null)
  assert.equal(gh.writes.length, 0)
})

test('the three sources never share a title or a marker', () => {
  const sources = [codeScanning, dependabot, secretScanning]
  assert.equal(new Set(sources.map(s => s.title(1))).size, 3)
  assert.equal(new Set(sources.map(s => s.marker(1))).size, 3)
  for (const s of sources) for (const other of sources) {
    assert.equal(s.titles.test(other.title(1)), s === other, `${s.name} does not claim ${other.name}'s tasks`)
  }
  for (const s of sources) {
    assert.equal(Number(s.titles.exec(s.title(4321))?.[1]), 4321, `${s.name}'s pattern reads its own title`)
    assert.equal(s.titles.test(s.title(4321) + ' (copy)'), false)
  }
})
