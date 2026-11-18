// Model GitHub branch and PR state across retries, concurrent writes, and an unreadable alert.
import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareFix } from './fix.mjs'

const main = 'a'.repeat(40), patch = 'b'.repeat(40), human = 'c'.repeat(40)
const ctx = { owner: 'AxalNetwork', repo: 'StudioOS', number: 42, issueNumber: 17, defaultBranch: 'main' }
const prepared = 'alert-fix-42', generated = 'alert-autofix-42'
const endpoint = '/code-scanning/alerts/42/autofix'
const fail = status => Object.assign(Error('sanitized'), { status })

function fake() {
  const api = {
    refs: { main }, pulls: [], comparisons: {}, calls: [], suggestion: 'success',
    async request(method, path, data) {
      api.calls.push({ method, path, data })
      const url = new URL('https://api.invalid' + path)
      if (url.pathname === '/pulls' && method === 'GET') {
        assert.equal(url.searchParams.get('state'), 'all')
        return api.pulls.filter(p => p.head.ref === url.searchParams.get('head').split(':')[1])
      }
      if (path.startsWith('/git/ref/heads/')) {
        const name = path.slice('/git/ref/heads/'.length)
        if (!api.refs[name]) throw fail(404)
        return { ref: 'refs/heads/' + name, object: { sha: api.refs[name] } }
      }
      if (path.startsWith('/compare/')) {
        const [base, head] = url.pathname.slice('/compare/'.length).split('...')
        assert.equal(base, main)
        return api.comparisons[head] ?? { status: 'ahead', ahead_by: 1, commits: [], files: [] }
      }
      if (path === endpoint) {
        if (api.statusError && method === 'GET') throw fail(api.statusError)
        return { status: api.suggestion, description: 'PRIVATE: sensitive finding' }
      }
      if (path === endpoint + '/commits') {
        assert.equal(data.target_ref, 'refs/heads/' + generated)
        assert.equal(api.refs[generated], main)
        api.refs[generated] = patch
        api.comparisons[patch] = { status: 'ahead', ahead_by: 1, merge_base_commit: { sha: main },
          commits: [{ sha: patch, parents: [{ sha: main }], author: { login: 'github-actions[bot]' },
            commit: { message: data.message, verification: { verified: true } } }], files: [{ filename: 'private' }] }
        if (api.emptyPatch) api.comparisons[patch].files = []
        if (api.lostResponse) { api.lostResponse = false; throw fail(503) }
        return { target_ref: data.target_ref, sha: patch }
      }
      if (path === '/git/refs') {
        const name = data.ref.slice('refs/heads/'.length)
        if (api.refs[name]) throw fail(422)
        api.refs[name] = data.sha
        return { ref: data.ref, object: { sha: data.sha } }
      }
      if (path.startsWith('/git/refs/heads/')) {
        const name = path.slice('/git/refs/heads/'.length)
        assert.equal(data.force, false)
        if (api.concurrentEdit) { api.refs[name] = human; throw fail(422) }
        api.refs[name] = data.sha
        return {}
      }
      if (path === '/pulls' && method === 'POST') {
        assert.equal(data.draft, true)
        assert.equal(api.refs[data.head], patch)
        assert.doesNotMatch(JSON.stringify(data), /PRIVATE|sensitive finding|private|closes|fixes #/i)
        assert.match(data.body, /Tracking issue #17/)
        assert.deepEqual([...data.body.matchAll(/\]\(([^)]+)\)/g)].map(([, href]) => href),
          ['https://github.com/AxalNetwork/StudioOS/security/code-scanning/42'])
        const pr = { number: 55, state: 'open', ...data, head: { ref: data.head, repo: { full_name: 'AxalNetwork/StudioOS' } },
          user: { login: 'github-actions[bot]' }, labels: [] }
        api.pulls.push(pr)
        return pr
      }
      if (path === '/issues/55/labels') {
        if (api.labelError) { api.labelError = false; throw fail(503) }
        api.pulls[0].labels = data.labels.map(name => ({ name }))
        return api.pulls[0].labels
      }
      throw Error('Unexpected request: ' + method + ' ' + path)
    },
  }
  return api
}

test('creates one draft, requests scanning, and repeated runs leave it alone', async () => {
  const api = fake()
  assert.deepEqual(await prepareFix(api, ctx), { status: 'pull_request', prNumber: 55 })
  await prepareFix(api, ctx)
  assert.equal(api.pulls[0].head.ref, generated)
  assert.equal(api.pulls.length, 1)
  assert.deepEqual(api.pulls[0].labels, [{ name: 'security-scan' }])
  assert.equal(api.calls.filter(c => c.path.endsWith('/commits')).length, 1)
  assert.equal(api.calls.filter(c => c.path.endsWith('/labels')).length, 1)
})

test('recovers a successful commit whose response was lost without committing twice', async () => {
  const api = fake()
  api.refs[prepared] = main
  api.lostResponse = true
  await assert.rejects(prepareFix(api, ctx), { status: 503 })
  assert.equal(api.refs[prepared], main)
  assert.deepEqual(await prepareFix(api, ctx), { status: 'pull_request', prNumber: 55 })
  assert.equal(api.pulls[0].head.ref, prepared)
  assert.equal(api.calls.filter(c => c.path === endpoint + '/commits').length, 1)
})

test('retries only a missing scan label after PR creation', async () => {
  const api = fake()
  api.labelError = true
  await assert.rejects(prepareFix(api, ctx), { status: 503 })
  assert.deepEqual(await prepareFix(api, ctx), { status: 'pull_request', prNumber: 55 })
  assert.equal(api.pulls.length, 1)
  assert.equal(api.pulls[0].labels[0].name, 'security-scan')
})

test('preserves operator work and declined PRs; a fork cannot impersonate either', async () => {
  for (const branch of [prepared, generated]) {
    const api = fake()
    api.refs[branch] = human
    assert.deepEqual(await prepareFix(api, ctx), { status: 'existing_work' })
    assert.deepEqual(api.calls.filter(c => c.method !== 'GET'), [])
  }
  const api = fake()
  api.pulls.push({ number: 7, state: 'closed', head: { ref: prepared, repo: { full_name: 'AxalNetwork/StudioOS' } } })
  assert.deepEqual(await prepareFix(api, ctx), { status: 'prior_pr', prNumber: 7 })
  api.pulls[0].state = 'open'
  assert.deepEqual(await prepareFix(api, ctx), { status: 'existing_pr', prNumber: 7 })
  api.pulls[0].head.repo.full_name = 'outside/StudioOS'
  assert.deepEqual(await prepareFix(api, ctx), { status: 'pull_request', prNumber: 55 })
})

test('a concurrent push wins over the non-forced prepared branch update', async () => {
  const api = fake()
  api.refs[prepared] = main
  api.concurrentEdit = true
  await assert.rejects(prepareFix(api, ctx), { status: 422 })
  assert.equal(api.refs[prepared], human)
  assert.equal(api.pulls.length, 0)
  assert.deepEqual(await prepareFix(api, ctx), { status: 'existing_work' })
})

test('a forged recovery commit is left untouched', async () => {
  for (const change of [c => { c.commit.verification.verified = false }, c => { c.author.login = 'human' },
    c => { c.commit.message = 'other work' }, c => { c.parents.push({ sha: human }) }]) {
    const api = fake()
    api.lostResponse = true
    await assert.rejects(prepareFix(api, ctx))
    change(api.comparisons[patch].commits[0])
    assert.deepEqual(await prepareFix(api, ctx), { status: 'existing_work' })
    assert.equal(api.pulls.length, 0)
  }
})

test('unsupported, pending, unauthorised and empty fixes never produce an empty PR', async () => {
  for (const [suggestion, expected] of [['pending', 'pending'], ['error', 'manual']]) {
    const api = fake()
    api.suggestion = suggestion
    assert.deepEqual(await prepareFix(api, ctx), { status: expected })
    assert.deepEqual(api.refs, { main })
  }
  const unavailable = fake()
  unavailable.statusError = 403
  await assert.rejects(prepareFix(unavailable, ctx), { status: 403 })
  const empty = fake()
  empty.emptyPatch = true
  assert.deepEqual(await prepareFix(empty, ctx), { status: 'existing_work' })
  assert.equal(empty.pulls.length, 0)
  const fresh = fake()
  fresh.statusError = 404
  await prepareFix(fresh, ctx)
  assert.ok(fresh.calls.find(c => c.method === 'POST' && c.path === endpoint))
})

test('an accepted generation with an empty response waits for the next scan; an API limit propagates', async () => {
  for (const limited of [false, true]) {
    const api = fake()
    const original = api.request.bind(api)
    api.request = async (method, path, data) => {
      if (path === endpoint) {
        if (method === 'GET') throw fail(404)
        if (limited) throw Object.assign(fail(422), { limited: true })
        return {}
      }
      return original(method, path, data)
    }
    if (limited) await assert.rejects(prepareFix(api, ctx), { status: 422, limited: true })
    else assert.deepEqual(await prepareFix(api, ctx), { status: 'pending' })
    assert.deepEqual(api.refs, { main })
    assert.equal(api.pulls.length, 0)
  }
})

test('only a confirmed PR creation policy refusal hands back the prepared branch', async () => {
  for (const [route, policy, limited] of [
    ['/pulls', true, false], ['/pulls', false, false], ['/pulls', 'true', false],
    ['/pulls', true, true], ['/issues/55/labels', true, false],
  ]) {
    const api = fake()
    api.refs[prepared] = main
    const original = api.request.bind(api)
    api.request = async (method, path, body) => {
      if (method === 'POST' && path === route) throw Object.assign(fail(403), { prCreationDisabled: policy, limited })
      return original(method, path, body)
    }
    if (route === '/pulls' && policy === true && !limited) {
      assert.deepEqual(await prepareFix(api, ctx), { status: 'pr_permission', branch: prepared })
      assert.equal(api.pulls.length, 0)
      assert.equal(api.refs[prepared], patch)
      api.request = original
      assert.deepEqual(await prepareFix(api, ctx), { status: 'pull_request', prNumber: 55 })
      assert.equal(api.calls.filter(c => c.path === endpoint + '/commits').length, 1)
    } else {
      await assert.rejects(prepareFix(api, ctx), { status: 403 })
    }
  }
})

test('switching from the workflow token to the App completes a signed pending fix and repairs the scan label', async () => {
  const app = { ...ctx, botLogin: 'studioos-remediation[bot]' }
  for (const branch of [generated, prepared]) {
    const api = fake()
    if (branch === prepared) api.refs[prepared] = main
    const original = api.request.bind(api)
    api.request = async (method, path, data) => {
      if (method === 'POST' && path === '/pulls') throw Object.assign(fail(403), { prCreationDisabled: true })
      return original(method, path, data)
    }
    assert.deepEqual(await prepareFix(api, ctx), { status: 'pr_permission', branch })
    assert.equal(api.refs[branch], patch)
    api.request = original
    assert.deepEqual(await prepareFix(api, app), { status: 'pull_request', prNumber: 55 })
    assert.equal(api.pulls[0].head.ref, branch)
    assert.equal(api.calls.filter(c => c.path.endsWith('/commits')).length, 1)
  }
  const api = fake()
  api.labelError = true
  await assert.rejects(prepareFix(api, ctx), { status: 503 })
  const [pr] = api.pulls
  assert.deepEqual(await prepareFix(api, app), { status: 'pull_request', prNumber: 55 })
  assert.deepEqual(pr.labels, [{ name: 'security-scan' }])
  pr.labels = []
  pr.user.login = 'another-app[bot]'
  assert.deepEqual(await prepareFix(api, app), { status: 'existing_pr', prNumber: 55 })
  assert.deepEqual(pr.labels, [])
  pr.user.login = app.botLogin
  pr.body = 'quoted ' + pr.body
  assert.deepEqual(await prepareFix(api, app), { status: 'existing_pr', prNumber: 55 })
  assert.deepEqual(pr.labels, [])
})
