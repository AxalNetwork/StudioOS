// Match public tracking issues to protected alerts using their repo, number and creator.
const titles = /^(?:\[Code Scanning\] Investigate and fix alert #|\[Code Scanning\] Remediate alert #)([1-9]\d*)$/
const validNumber = value => Number.isSafeInteger(value) && value > 0
const names = issue => issue.labels.map(label => typeof label === 'string' ? label : label.name)
const marker = number => '<!-- studioos-scan-remediation:' + number + ' -->'
const login = value => String(value || '').toLowerCase()

export async function loadTrackers(api, { owner, repo, defaultBranch, botLogin = 'github-actions[bot]' }) {
  const base = 'https://github.com/' + owner + '/' + repo
  const bots = new Set([login(botLogin), 'github-actions[bot]'])
  const trusted = issue => bots.has(login(issue.user?.login)) || (owner.toLowerCase() === 'axalnetwork' && login(issue.user?.login) === 'guillaumelauzier')
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

  const alertUrl = number => base + '/security/code-scanning/' + number
  function recognized(issue, number) {
    const body = String(issue.body || '')
    const exactLink = body.split(/\s|[()<>\[\]]/).includes(alertUrl(number))
    if (!exactLink) return false
    return issue.title === '[Code Scanning] Investigate and fix alert #' + number ||
      body.split('\n').includes(marker(number))
  }

  async function unclaimed(issue, review = false) {
    const labels = names(issue)
    if (issue.locked || issue.assignees?.length || labels.some(label =>
      label.startsWith('slot:') || label === 'needs-decision' || label === 'needs-design' ||
      (label.startsWith('state:') && label !== 'state:ready' && !(review && label === 'state:review')))) return false
    try {
      await api.request('GET', '/git/ref/heads/claim/' + issue.number)
      return false
    } catch (error) {
      if (error.status !== 404) throw error
      return true
    }
  }

  async function current(issue, number) {
    const fresh = await api.request('GET', '/issues/' + issue.number)
    if (fresh.number !== issue.number || !trusted(fresh) || !recognized(fresh, number) ||
      Number(titles.exec(fresh.title)?.[1]) !== number) return null
    remember(fresh)
    return fresh
  }

  async function ensure(number) {
    if (!validNumber(number)) throw Error('Invalid alert number')
    if (!byAlert.has(number)) {
      // Includes old trackers whose bug label was removed. An alert-specific query
      // stays bounded even when thousands of unrelated alerts have already closed.
      const hits = await api.searchIssues('is:issue in:title "Code Scanning" "alert #' + number + '"')
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
        if (names(reopened).includes('state:review')) await removeLabel(reopened, 'state:review')
        return { issue: reopened, actionable: true, created: false }
      }
      return { issue, actionable: await unclaimed(issue, true), created: false }
    }

    const issue = await api.request('POST', '/issues', {
      title: '[Code Scanning] Remediate alert #' + number,
      body: [marker(number), '', 'Track [Code Scanning alert #' + number + '](' + alertUrl(number) + ').',
        '', 'Keep finding details in Code Scanning. Close this tracker when a scan confirms the fix on ' +
          '`' + defaultBranch + '`.'].join('\n'),
      labels: ['bug'],
    })
    if (!trusted(issue) || !validNumber(issue.number) || !recognized(issue, number)) throw Error('Unexpected tracker identity')
    remember(issue)
    return { issue, actionable: true, created: true }
  }

  async function removeLabel(issue, label) {
    try { await api.request('DELETE', '/issues/' + issue.number + '/labels/' + encodeURIComponent(label)) }
    catch (error) { if (error.status !== 404) throw error }
  }

  async function active(issue, review = false) {
    const number = Number(titles.exec(issue?.title)?.[1])
    if (!validNumber(number) || byAlert.get(number)?.size !== 1 ||
      !byAlert.get(number).has(issue.number)) return null
    const fresh = await current(issue, number)
    return fresh?.state === 'open' && await unclaimed(fresh, review) ? fresh : null
  }

  async function markReady(issue) {
    const fresh = await active(issue, true)
    if (!fresh) return
    if (!names(fresh).includes('state:ready')) {
      await api.request('POST', '/issues/' + fresh.number + '/labels', { labels: ['state:ready'] })
    }
    if (names(fresh).includes('state:review')) await removeLabel(fresh, 'state:review')
  }

  async function commentOnce(path, body) {
    const comments = await api.pages(path + '/comments')
    if (!comments.some(comment => bots.has(login(comment.user?.login)) && comment.body === body)) {
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
    await commentOnce('/issues/' + fresh.number, 'A fix is ready on this branch. ' +
      '[Compare the prepared changes and open a pull request](' + link + '). ' +
      'You can also let the workflow open the draft PR on a later run once its credential can create pull requests.')
    await markReady(fresh)
  }

  async function linkPull(issue, prNumber) {
    if (!validNumber(prNumber)) throw Error('Invalid pull request number')
    const fresh = await active(issue, true)
    if (!fresh) return
    const link = 'Tracking pull request: ' + base + '/pull/' + prNumber
    const path = '/issues/' + fresh.number
    await commentOnce(path, link)
    if (!names(fresh).includes('state:review')) await api.request('POST', path + '/labels', { labels: ['state:review'] })
    if (names(fresh).includes('state:ready')) await removeLabel(fresh, 'state:ready')
  }

  async function closeFixed(alert) {
    if (alert?.state !== 'fixed' || alert.most_recent_instance?.ref !== 'refs/heads/' + defaultBranch ||
      alert.most_recent_instance.state !== 'fixed') return false
    const candidates = byAlert.get(alert.number)
    if (candidates?.size !== 1) return false
    const [candidate] = candidates.values()
    const fresh = await active(candidate, true)
    if (!fresh) return false
    const closed = await api.request('PATCH', '/issues/' + fresh.number, { state: 'closed', state_reason: 'completed' })
    remember(closed)
    return true
  }

  return {
    ensure, markReady, linkPrepared, linkPull, closeFixed,
    trackedNumbers: () => [...byAlert].filter(([, issues]) =>
      [...issues.values()].some(issue => issue.state === 'open')).map(([number]) => number),
  }
}
