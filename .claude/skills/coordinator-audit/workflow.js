export const meta = {
  name: 'coordinator-audit',
  description: 'Read-only StudioOS audit: triage open issues against main, verify every finding with a second agent, audit pages, dedupe proposed tasks',
  phases: [
    { title: 'Triage', detail: 'each open issue against main: verdict, note, label change' },
    { title: 'Verify', detail: 'a second agent re-checks every finding, close and label change' },
    { title: 'Pages', detail: 'optional: what each page lacks, proposed tasks' },
    { title: 'Dedupe', detail: 'every proposed task against open issues and main' },
  ],
}

// args: { out, mainSha, runId, repo, chunks: [[n,...],...], sections: [{key, who, pages:[...]}] (optional) }
// `repo` is a checkout at mainSha that agents read (required: SKILL.md step 2).
// The script only reads. scripts/coordinator.mjs plan|apply|file does every write.
const { out: OUT, mainSha: SHA, runId: RUN, repo: REPO, chunks = [], sections = [] } = args
if (!REPO) throw new Error('coordinator-audit: args.repo is required, the path of a checkout at mainSha (SKILL.md step 2)')

const RULES = `
HARD RULES (read-only):
- Repo checkout: ${REPO} at main ${SHA}. Read it; never edit, commit, branch, install, build or create worktrees. Write nothing except your one notes file under ${OUT}.
- GitHub is READ ONLY: never post, edit, label, close or create anything. Read with curl -sS "https://api.github.com/repos/AxalNetwork/StudioOS/issues/N", ".../issues/N/comments?per_page=100", ".../issues/N/timeline?per_page=100".
- ${OUT}/snapshot.json holds every open issue (number, title, labels, body, updated_at) and open PR.
- Labels and their meaning are in AGENTS.md (§ Task protocol, § STATUS, § Missing UI). A PR saying "Part of #N" leaves #N open on purpose.
- Never state something you did not check: write "not checked". Audit documents are snapshots; re-check the code.
- Security: an exploitable flaw goes ONLY in private_notes, never in notes or findings.
- Plain words. The AI is called Eadwyn.`

const LABEL_CHANGE = {
  type: 'object',
  description: 'only when the labels are wrong today; omit when they are right',
  properties: {
    state: { type: 'string', enum: ['state:ready', 'state:in-progress', 'state:blocked', 'state:review'] },
    add: { type: 'array', items: { type: 'string', enum: ['needs-decision', 'needs-design'] } },
    remove: { type: 'array', items: { type: 'string' } },
    slot: { type: 'string', description: 'S02 to S37, never S18 or S32; S01 only for a tracker, design brief or owner action. Never move an issue that is in progress with activity in the last 3 days. Omit to keep the slot.' },
  },
}

const TRIAGE_SCHEMA = {
  type: 'object',
  properties: {
    issues: { type: 'array', items: { type: 'object', properties: {
      number: { type: 'number' }, title: { type: 'string' },
      kind: { type: 'string', enum: ['task', 'tracker', 'design-brief', 'owner-action', 'other'] },
      verdict: { type: 'string', enum: ['close_done', 'close_superseded', 'release_to_ready', 'keep_blocked_on_owner', 'keep_blocked_on_dependency', 'keep_blocked_on_design', 'keep_as_is', 'needs_status_fix', 'split_or_rescope'] },
      blocked_on: { type: 'string' }, blocker_resolved: { type: 'boolean' },
      evidence: { type: 'string', description: 'merged PR numbers, files on main, comment dates' },
      remaining_work: { type: 'string' },
      owner_question: { type: 'string', description: 'lettered options A/B/C and your pick, only when an owner call is the blocker' },
      recommended_action: { type: 'string' },
      label_change: LABEL_CHANGE,
      child_tasks: { type: 'array', description: 'only for split_or_rescope: unbuilt pieces no open issue covers', items: { type: 'object', properties: {
        title: { type: 'string' }, type: { type: 'string', enum: ['design-brief', 'frontend', 'worker', 'full-stack', 'data', 'docs', 'owner-decision'] },
        body: { type: 'string', description: '## Objective, ## Scope (verified paths), ## Acceptance criteria, ## Dependencies' },
        depends_on: { type: 'string' }, size: { type: 'string', enum: ['S', 'M', 'L'] }, ready_now: { type: 'boolean' },
      }, required: ['title', 'type', 'body', 'ready_now'] } },
    }, required: ['number', 'title', 'verdict', 'evidence', 'recommended_action'] } },
    private_notes: { type: 'string' },
  },
  required: ['issues'],
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: { checks: { type: 'array', items: { type: 'object', properties: {
    number: { type: 'number' },
    note_supported: { type: 'boolean', description: 'false if the finding states something you could not confirm and could not correct' },
    corrected: { type: 'object', description: 'replacement text for any field that was wrong: evidence, remaining_work, blocked_on, recommended_action, owner_question', properties: {
      evidence: { type: 'string' }, remaining_work: { type: 'string' }, blocked_on: { type: 'string' }, recommended_action: { type: 'string' }, owner_question: { type: 'string' } } },
    label_change_ok: { type: 'boolean', description: 'false if the proposed label change is wrong or breaks AGENTS.md' },
    safe_to_close: { type: 'boolean', description: 'only for close verdicts; default false when unsure' },
    unfinished: { type: 'string' },
    reason: { type: 'string' },
  }, required: ['number', 'note_supported', 'label_change_ok', 'reason'] } } },
  required: ['checks'],
}

const triage = await pipeline(
  chunks,
  (nums, _o, i) => agent(`Triage these open StudioOS issues for the coordinator: ${nums.map(n => '#' + n).join(', ')}.

For EACH: read the body, every comment (the latest STATUS and any owner answer matter most) and the timeline (linked PRs, merged or open). Check the claim against main: do the files, routes, migrations and decision files it asks for exist? Choose a verdict:
- close_done: every acceptance criterion is on main (name the merged PRs); a tracker only when every child is closed or its objective is met. "Part of" PRs do not finish an issue.
- close_superseded: another issue or decision replaced it (name it).
- release_to_ready: labelled blocked or stale, but nothing blocks it now.
- keep_blocked_on_owner: only an owner decision or action blocks it; write owner_question with lettered options and your pick.
- keep_blocked_on_dependency: a named open issue or PR blocks it.
- keep_blocked_on_design: it waits for a canvas that is not in design/incoming (if the canvas landed, it is release_to_ready).
- needs_status_fix: labels contradict the facts. split_or_rescope: partly done; list the unfilled pieces in child_tasks. keep_as_is: correct and moving.
Give label_change only when today's labels are wrong. Follow AGENTS.md: one state label; needs-decision and needs-design only with state:blocked (moving to any other state removes them); state:review only with an open PR; standard slots only. The rules are in .claude/skills/coordinator-audit/RULES.md.
Write notes to ${OUT}/triage-${i}.md. Return the structured result.
${RULES}`, { label: `triage:${nums[0]}-${nums[nums.length - 1]}`, phase: 'Triage', schema: TRIAGE_SCHEMA }),
  async (raw, nums, i) => {
    if (!raw) return null
    // Keep only findings for the issues this chunk was given, one per issue.
    const seen = new Set()
    const issues = raw.issues.filter(f => nums.includes(f.number) && !seen.has(f.number) && seen.add(f.number))
    if (issues.length !== raw.issues.length) log(`chunk ${i}: dropped ${raw.issues.length - issues.length} finding(s) for issues outside the chunk or repeated`)
    const res = { ...raw, issues }
    const v = await agent(`A first auditor wrote these findings about StudioOS issues. Each one becomes a public status note, and some change labels or close the issue. Try to REFUTE every claim: re-read each issue and its comments, check every PR number, file path, date and "not built" claim against main and GitHub. For each issue:
- note_supported: false if a claim is wrong and you cannot correct it; put corrected text in corrected.
- label_change_ok: false if the proposed label change is wrong or breaks AGENTS.md.
- For close_done and close_superseded: list every acceptance criterion, part and child; safe_to_close is true only if every one is on main and nothing open still belongs to it. Default false when unsure; name what is unfinished.

Findings:
${JSON.stringify(res.issues)}
${RULES}`, { label: `verify:${nums[0]}-${nums[nums.length - 1]}`, phase: 'Verify', schema: VERIFY_SCHEMA })
    const byN = new Map((v ? v.checks : []).map(c => [c.number, c]))
    // A finding nobody verified is never applied: no note, no labels, no close.
    const findings = res.issues.map(f => ({ ...f, verification: byN.get(f.number) || { note_supported: false, label_change_ok: false, reason: 'not verified' } }))
    return { findings, privateNotes: res.private_notes ? [{ issues: nums, note: res.private_notes }] : [] }
  },
)

const SECTION_SCHEMA = {
  type: 'object',
  properties: {
    pages: { type: 'array', items: { type: 'object', properties: {
      route: { type: 'string' }, name: { type: 'string' }, what_exists: { type: 'string' },
      missing_features: { type: 'array', items: { type: 'string' } }, broken_or_dead: { type: 'array', items: { type: 'string' } },
      canvas: { type: 'string' }, canvas_built: { type: 'string', enum: ['fully', 'partly', 'not_built', 'no_canvas'] },
      needs_redesign: { type: 'boolean' }, covering_issues: { type: 'string' }, uncovered_gaps: { type: 'array', items: { type: 'string' } },
    }, required: ['route', 'name', 'what_exists', 'missing_features', 'canvas_built', 'needs_redesign', 'uncovered_gaps'] } },
    proposed_issues: TRIAGE_SCHEMA.properties.issues.items.properties.child_tasks,
    private_notes: { type: 'string' },
  },
  required: ['pages', 'proposed_issues'],
}

const pages = await parallel(sections.map(s => () => agent(`Audit these ${s.who} pages of StudioOS one by one: ${s.pages.join('; ')}.
For each: find the route, page component and everything it renders, the API methods and the Worker routes behind them, and read them. Say what a member can do today and whether the data is stored, derived or a placeholder; name dead controls. Find its canvas in design/incoming and say which boards are built. List the missing elements, options and features against the canvas, the route map, the open UX issues for the section, and what the job needs end to end (inputs, evidence, Eadwyn help, the data states, phone layout, handoff, export, history). Name the open issues that cover each gap. Propose issues only for gaps no open issue covers, one session and one PR each; where no canvas draws a screen, propose a design-brief issue and make the build depend on it.
Write notes to ${OUT}/pages-${s.key}.md.
${RULES}`, { label: `pages:${s.key}`, phase: 'Pages', schema: SECTION_SCHEMA }).then(r => r ? { key: s.key, ...r } : null)))

// Every proposal, from a split or a page audit, gets a stable key and one refutation pass.
const proposals = []
const findings = triage.filter(Boolean).flatMap(t => t.findings)
const privateNotes = [...triage.filter(Boolean).flatMap(t => t.privateNotes), ...pages.filter(Boolean).filter(s => s.private_notes).map(s => ({ pages: s.key, note: s.private_notes }))]
for (const f of findings) (f.child_tasks || []).forEach((p, k) => proposals.push({ ...p, parent: f.number, key: `split:${f.number}:${k}` }))
for (const s of pages.filter(Boolean)) s.proposed_issues.forEach((p, k) => proposals.push({ ...p, parent: 0, key: `pages:${s.key}:${k}` }))

const DEDUPE_SCHEMA = { type: 'object', properties: { checks: { type: 'array', items: { type: 'object', properties: {
  key: { type: 'string' },
  verdict: { type: 'string', enum: ['file', 'drop_duplicate_of_open_issue', 'drop_already_built', 'add_as_comment_to_existing_issue', 'merge_with_other_proposal'] },
  existing_issue: { type: 'integer', description: 'the issue that covers it, or the tracker it belongs under; 0 if none' },
  corrections: { type: 'string' }, reason: { type: 'string' },
}, required: ['key', 'verdict', 'existing_issue', 'reason', 'corrections'] } } }, required: ['checks'] }

const groups = []
for (let i = 0; i < proposals.length; i += 12) groups.push(proposals.slice(i, i + 12))
const deduped = await parallel(groups.map((g, i) => () => agent(`Proposed NEW StudioOS issues follow. Filing a duplicate or something already built wastes a session, so try to REFUTE each. Search ${OUT}/snapshot.json and the newest open issues (curl -sS "https://api.github.com/repos/AxalNetwork/StudioOS/issues?state=open&sort=created&direction=desc&per_page=60") and read any likely match. A broad tracker that only mentions the area does not make a concrete task a duplicate: then the verdict is "file" with existing_issue set to that tracker. Check main for whether it is built. Check every path, route and board id the body names, and put fixes in corrections.
${JSON.stringify(g.map(p => ({ key: p.key, title: p.title, type: p.type, depends_on: p.depends_on, body: p.body })))}
${RULES}`, { label: `dedupe:${i}`, phase: 'Dedupe', schema: DEDUPE_SCHEMA })))

const verdicts = new Map(deduped.filter(Boolean).flatMap(d => d.checks).map(c => [c.key, c]))
const kept = proposals.flatMap(p => {
  const c = verdicts.get(p.key)
  if (!c || c.verdict !== 'file') return []
  return [{ ...p, parent: p.parent || c.existing_issue || 0, body: c.corrections ? `${p.body}\n\n## Checked before filing\n${c.corrections}` : p.body }]
})
const unfiled = proposals.filter(p => !kept.some(k => k.key === p.key)).map(p => ({ key: p.key, title: p.title, body: p.body, check: verdicts.get(p.key) || null }))
if (unfiled.some(u => !u.check)) log(`${unfiled.filter(u => !u.check).length} proposals had no dedupe verdict and are not filed`)

if (privateNotes.length) log(`${privateNotes.length} private security note(s): send them to the owner privately, never on an issue`)
return { runId: RUN, findings, privateNotes, proposals: kept, unfiled, pages: pages.filter(Boolean).map(({ private_notes, ...p }) => p) }
