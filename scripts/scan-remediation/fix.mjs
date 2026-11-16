// Prepare a classic GitHub Autofix on a feature branch and recover interrupted publications.
const shaPattern = /^[a-f0-9]{40}$/
const positiveId = value => Number.isSafeInteger(value) && value > 0
const isPublisher = (login, configuredBot) => login === 'github-actions[bot]' || login === configuredBot

async function optional(get) {
  try { return await get() } catch (error) {
    if (error.status === 404) return null
    throw error
  }
}

async function branchTip(api, branch) {
  const ref = await optional(() => api.request('GET', '/git/ref/heads/' + encodeURIComponent(branch)))
  if (!ref) return null
  if (ref.ref !== 'refs/heads/' + branch || !shaPattern.test(ref.object?.sha)) throw Error('Invalid branch response')
  return ref.object.sha
}

async function compare(api, base, head) {
  return api.request('GET', '/compare/' + base + '...' + head + '?per_page=2')
}

function clean(comparison) {
  return comparison?.ahead_by === 0 && ['identical', 'behind'].includes(comparison.status)
}

function managedPatch(comparison, head, message, botLogin) {
  const commits = comparison?.commits
  if (comparison?.ahead_by !== 1 || commits?.length !== 1 || !comparison?.files?.length) return false
  const [commit] = commits
  // A caller-chosen commit message alone is forgeable. GitHub must attest the bot's commit.
  return commit.sha === head && commit.parents?.length === 1 &&
    commit.parents[0].sha === comparison.merge_base_commit?.sha &&
    commit.commit?.message === message && isPublisher(commit.author?.login, botLogin) &&
    commit.commit?.verification?.verified === true
}

async function findPull(api, ctx, branches) {
  const { owner, repo } = ctx
  const found = []
  for (const branch of branches) {
    const query = new URLSearchParams({ head: owner + ':' + branch, state: 'all', per_page: '100' })
    const pulls = await api.request('GET', '/pulls?' + query)
    for (const pr of pulls) {
      if (pr.head?.ref === branch && pr.head.repo?.full_name?.toLowerCase() === (owner + '/' + repo).toLowerCase()) found.push(pr)
    }
  }
  return found.find(pr => pr.state === 'open') ?? found[0]
}

async function pullResult(api, pr, marker, botLogin, newlyCreated = false) {
  if (!positiveId(pr.number)) throw Error('Invalid pull request response')
  if (pr.state !== 'open') return { status: 'prior_pr', prNumber: pr.number }
  if (newlyCreated || (isPublisher(pr.user?.login, botLogin) && pr.body?.split('\n').includes(marker))) {
    if (!pr.labels?.some(label => label.name === 'security-scan')) {
      await api.request('POST', '/issues/' + pr.number + '/labels', { labels: ['security-scan'] })
    }
    return { status: 'pull_request', prNumber: pr.number }
  }
  return { status: 'existing_pr', prNumber: pr.number }
}

async function proposal(api, endpoint) {
  let fix = await optional(() => api.request('GET', endpoint))
  if (!fix || fix.status === 'outdated') {
    try { fix = await api.request('POST', endpoint) } catch (error) {
      if (error.limited) throw error
      if ([400, 404, 422].includes(error.status)) return 'manual'
      throw error
    }
    if (!fix || Object.keys(fix).length === 0) return 'pending'
  }
  switch (fix?.status) {
    case 'success': return 'success'
    case 'pending':
    case 'outdated': return 'pending'
    case 'error': return 'manual'
    default: throw Error('Invalid Autofix response')
  }
}

export async function prepareFix(api, ctx) {
  const { number, issueNumber, owner, repo, defaultBranch, existingWork, botLogin = 'github-actions[bot]' } = ctx
  if (!positiveId(number) || !positiveId(issueNumber) || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo) || defaultBranch !== 'main') {
    throw Error('Invalid StudioOS alert coordinates')
  }
  const prepared = 'alert-fix-' + number
  const generation = 'alert-autofix-' + number
  const branches = [prepared, generation]
  const marker = '<!-- studioos-scan-pr:' + number + ' -->'
  const message = 'Apply GitHub Autofix for code scanning alert #' + number
  const prior = await findPull(api, ctx, branches)
  if (prior) return pullResult(api, prior, marker, botLogin)
  if (existingWork) return { status: 'existing_work' }

  const base = await branchTip(api, defaultBranch)
  if (!base) throw Error('Default branch unavailable')
  const preparedTip = await branchTip(api, prepared)
  const generatedTip = await branchTip(api, generation)
  let patch = null
  if (generatedTip && generatedTip !== base) {
    const diff = await compare(api, base, generatedTip)
    if (managedPatch(diff, generatedTip, message, botLogin)) patch = generatedTip
    else if (!clean(diff)) return { status: 'existing_work' }
  }
  if (preparedTip && preparedTip !== base && preparedTip !== patch) {
    if (!clean(await compare(api, base, preparedTip))) return { status: 'existing_work' }
  }

  if (!patch) {
    const endpoint = '/code-scanning/alerts/' + number + '/autofix'
    const status = await proposal(api, endpoint)
    if (status !== 'success') return { status }
    // GitHub's Autofix commit endpoint does not accept an expected head SHA. Generate
    // on a dedicated branch. Publish to an existing prepared branch only by fast-forward.
    if (!generatedTip) {
      await api.request('POST', '/git/refs', { ref: 'refs/heads/' + generation, sha: base })
    } else if (generatedTip !== base) {
      await api.request('PATCH', '/git/refs/heads/' + generation, { sha: base, force: false })
    }
    if (await branchTip(api, generation) !== base) return { status: 'existing_work' }
    const target = 'refs/heads/' + generation
    let result
    try { result = await api.request('POST', endpoint + '/commits', { target_ref: target, message }) } catch (error) {
      if (error.limited) throw error
      if ([400, 422].includes(error.status)) return { status: 'manual' }
      throw error
    }
    if (!shaPattern.test(result?.sha) || result.target_ref !== target) throw Error('Invalid Autofix commit response')
    patch = result.sha
    // A refused/malformed/empty change cannot produce a PR. A concurrent human commit
    // must never be pulled into a machine-prepared change.
    const diff = await compare(api, base, patch)
    if (diff.ahead_by !== 1 || diff.commits?.length !== 1 || diff.commits[0].sha !== patch ||
      diff.commits[0].parents?.length !== 1 || diff.commits[0].parents[0].sha !== base ||
      !diff.files?.length) return { status: 'existing_work' }
  }

  const head = preparedTip ? prepared : generation
  if (await branchTip(api, generation) !== patch) return { status: 'existing_work' }
  if (preparedTip && preparedTip !== patch) {
    // Never force an update, including after a simultaneous human push.
    await api.request('PATCH', '/git/refs/heads/' + prepared, { sha: patch, force: false })
  }
  if (await branchTip(api, head) !== patch) return { status: 'existing_work' }
  const alertUrl = 'https://github.com/' + owner + '/' + repo + '/security/code-scanning/' + number
  const body = [
    marker, '## Objective', 'Review the suggested fix for [code scanning alert ' + number + '](' + alertUrl + ').',
    'Tracking issue #' + issueNumber + '. The next default-branch scan verifies resolution.',
    '## Implementation', 'GitHub generated a classic Autofix suggestion.',
    '## Files changed', 'Review the generated patch in the Files changed tab.',
    '## Testing', 'The security-scan label requests the repository scanners. Confirm the results and run the relevant tests.',
    '## Risks', 'Review behavior and regression coverage before merging. The suggested patch can be edited on this branch.',
    '## Dependencies', 'The tracking issue stays open through the confirming scan on main.',
    '## Agent', 'StudioOS Code Scanning remediation using GitHub Autofix.',
    '## Help impact', 'Assess user-facing impact while reviewing the generated patch.',
    '## Review requested', 'The code owners of the affected files.',
  ].join('\n\n')
  let pr
  try {
    pr = await api.request('POST', '/pulls', { base: defaultBranch, head, draft: true,
      title: 'Review fix for code scanning alert #' + number, body })
  } catch (error) {
    if (error.limited) throw error
    if (error.status === 403 && error.prCreationDisabled === true) return { status: 'pr_permission', branch: head }
    if (error.status !== 422) throw error
    const raced = await findPull(api, ctx, branches)
    if (!raced) throw error
    return pullResult(api, raced, marker, botLogin)
  }
  return pullResult(api, pr, marker, botLogin, true)
}
