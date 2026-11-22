// D8074: a security task open seven days after filing gains sla:breached and one comment; a weekly digest counts them.
import { codeScanning, dependabot, secretScanning } from './sources.mjs'
import { SLA_LABEL } from './trackers.mjs'

export const BREACHED_LABEL = 'sla:breached'
/** The weekly digest's schedule. `.github/workflows/scan-remediation.yml` carries the same string. */
export const DIGEST_CRON = '41 8 * * 1'
const DAY = 86_400_000
const SLA_DAYS = 7
const SOURCES = [codeScanning, dependabot, secretScanning]
const BREACH_MARKER = '<!-- studioos-sla-breached -->'
const BREACH_COMMENT = BREACH_MARKER + '\n' +
  'This security task has been open for more than seven days, so it now carries `sla:breached`. ' +
  'Claim it, or post a STATUS that names what blocks it.'
const login = value => String(value || '').toLowerCase()
const names = issue => (issue.labels || []).map(label => typeof label === 'string' ? label : label.name)

export const isDigestRun = env => env.SCAN_DIGEST === 'true' || env.SCAN_SCHEDULE === DIGEST_CRON

/** Open security tasks this workflow filed: the source, and the age in whole days. Never a title or a finding. */
export async function openSecurityTasks(api, { botLogin = 'github-actions[bot]' } = {}, now = new Date()) {
  const bots = new Set([login(botLogin), 'github-actions[bot]'])
  const rows = await api.pages('/issues?state=open&labels=' + encodeURIComponent(SLA_LABEL))
  const tasks = []
  for (const issue of rows) {
    if (issue.pull_request || issue.state !== 'open' || !bots.has(login(issue.user?.login))) continue
    const source = SOURCES.find(s => s.titles.test(issue.title || ''))
    const created = Date.parse(issue.created_at)
    if (!source || !Number.isFinite(created)) continue
    tasks.push({ issue, source: source.name, ageDays: Math.max(0, Math.floor((now.getTime() - created) / DAY)) })
  }
  return tasks
}

/** Adds sla:breached and posts one comment on each task past seven days. Returns how many were newly marked. */
export async function breachPass(api, { botLogin = 'github-actions[bot]', now = new Date() } = {}) {
  const bots = new Set([login(botLogin), 'github-actions[bot]'])
  let marked = 0
  for (const { issue, ageDays } of await openSecurityTasks(api, { botLogin }, now)) {
    if (ageDays < SLA_DAYS || names(issue).includes(BREACHED_LABEL)) continue
    const path = '/issues/' + issue.number
    // Comment before labelling: a failed label write retries next run without a second comment.
    const comments = await api.pages(path + '/comments')
    if (!comments.some(c => bots.has(login(c.user?.login)) && String(c.body || '').startsWith(BREACH_MARKER))) {
      await api.request('POST', path + '/comments', { body: BREACH_COMMENT })
    }
    await api.request('POST', path + '/labels', { labels: [BREACHED_LABEL] })
    marked++
  }
  return marked
}

/** The weekly Slack text: counts per source and age band. It names no issue, alert, rule, file or package. */
export function digestText(tasks, now = new Date()) {
  const day = now.toISOString().slice(0, 10)
  const lines = ['Weekly security digest for ' + day + ': ' + tasks.length + ' open security task' + (tasks.length === 1 ? '' : 's') + '.']
  for (const { name } of SOURCES) {
    const mine = tasks.filter(t => t.source === name)
    const late = mine.filter(t => t.ageDays >= SLA_DAYS).length
    lines.push('• ' + name + ': ' + mine.length + ' open, ' + late + ' past seven days')
  }
  const band = (lo, hi) => tasks.filter(t => t.ageDays >= lo && t.ageDays < hi).length
  lines.push('Age: under 7 days ' + band(0, 7) + ' · 7 to 30 days ' + band(7, 30) + ' · over 30 days ' + band(30, Infinity))
  return lines.join('\n')
}
