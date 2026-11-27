---
name: coordinator-audit
description: Session 1's audit of the StudioOS backlog. Use when asked to triage open issues, resolve state:blocked or state:review, close finished issues and trackers, move work between slots, add missing details to issues, file missing tasks, or run the weekly coordinator pass. Reads issues against main, verifies every finding with a second agent, then posts notes, fixes labels, closes and files tasks through scripts/coordinator.mjs.
---

# Coordinator audit

Session 1 (slot `S01`) runs this. It turns the open backlog into an accurate
one: every issue checked against `main`, every label true, every missing piece
filed with a slot, a state and a parent. It never merges, approves, pushes
code or edits `main`.

Read `AGENTS.md` first (§ Slots, § Task protocol, § STATUS, § Missing UI,
§ Owner answers). `RULES.md` beside this file holds the verdicts, the label
rules and the slot rule this skill applies.

## Two modes

| Mode | When | Reads |
|---|---|---|
| **Weekly delta** (default) | Every week, or when asked for a quick pass | New issues, linked merged PRs, named dependencies that closed and activity after the last audit note |
| **Lifecycle report** | Scheduled, issue and PR events, or `node scripts/coordinator.mjs report --out DIR` | Bounded suggestions and unknowns. Read-only output for triage. |
| **Full** | When asked for a full audit, or more than a month after the last full one | Every open issue, plus page audits if asked |

## Steps

Pick a run id: the date plus a letter, e.g. `2026-11-21a`. Work in a
scratchpad folder, `DIR`. Every command below is run from the repository root.

1. **Snapshot.**
   - Delta: `node scripts/coordinator.mjs delta --out DIR`. It writes `DIR/snapshot.json` and `DIR/delta.json`. `--since` defaults to the newest audit note posted in the last 30 days; with none, pass `--since <ISO time>` or run a full audit.
   - Full: `node scripts/coordinator.mjs snapshot --out DIR`.
2. **Check out the snapshot's main.** The agents read code at `snapshot.mainSha`: `git -C <repo> fetch origin main && git -C <repo> checkout --detach <mainSha>` on a clean checkout (or `git worktree add <path> <mainSha>`), and pass that path as `repo`.
3. **Chunk and capture evidence.** Split the issue numbers into groups of eight. Run `node scripts/coordinator.mjs evidence --dir DIR --issues 12,34` before verification for each chunk. Add `--related-issues` and `--related-pulls` as comma-separated numbers for any children, replacements, dependencies or stack PRs that the automatic linkage did not find. Capture additions before the verifier reviews the item. `evidence.json` records read failures and claims, including held expired claims. For a legacy label claim, the verifier must confirm an explicit handback and its author. Capture that comment ID with `--handback-comment` for the single issue. A live or expired ref still holds the task.
4. **Run the workflow.** Call the Workflow tool with `scriptPath: .claude/skills/coordinator-audit/workflow.js` and
   `args: { out: DIR, mainSha: <snapshot.mainSha>, runId, repo, chunks, sections }`.
   `sections` is optional: a list of `{ key, who, pages: [routes] }` for a page audit (the founder and investor groups are in `RULES.md`). It reads only. If the container restarts, re-run it with `resumeFromRunId`; finished agents replay from cache.
5. **Save and plan.** Write the workflow's result to `DIR/result.json`, then
   `node scripts/coordinator.mjs plan --in DIR/result.json --out DIR`.
   A finding the verifier did not support gets no note; a label change it did not accept is dropped; a close happens only where it said `safe_to_close` and its note is supported. If the plan prints `PRIVATE`, the run found a security flaw: send `DIR/private-notes.json` to the owner privately (a draft security advisory) and never post it on an issue.
6. **Dry run, then apply.**
   `node scripts/coordinator.mjs apply --dir DIR --run <runId>` prints every change (the run id must be the one the workflow was given). Read it. Then add `--go`.
   Before changing each issue it rechecks main, issue fields, comments, relevant PRs, dependencies and claim evidence. Any mismatch skips the item and its pending note. Triage `DIR/stale-<runId>.json` again with a new run id. A second check after the note prevents overwriting an edit made between the note and the state change. GitHub issue comments and state changes are separate requests.
7. **File new tasks.** `node scripts/coordinator.mjs file --dir DIR --run <runId>` prints them; `--go` files them. Briefs and owner decisions go to S01; build tasks go to the least-loaded slot among S02 to S37, never S18 or S32. Each parent gets one comment listing its children. A proposal whose parent is not an open issue is filed without one. A proposal the dedupe check said an open issue already owns is added there as a comment instead.
8. **Report.** Publish one page for the owner (the Artifact tool): what changed, what is waiting on the owner (lettered questions), what each audited page lacks, and coherence findings. Say plainly what was skipped as stale and what was not verified.

Both `apply` and `file` are safe to re-run after a restart: every write carries
`<!-- coordinator-audit:v1 run=<runId> … -->`, and a write whose marker is
already on GitHub is not repeated, even if the local ledger is lost.

## Before you run `--go`

- An open `[alert] main is red`, `[alert] the Actions queue is backed up` or `[alert] merge queue stalled` (AGENTS.md § Red main) does not block issue edits, but do not dispatch workflows.
- An open `[alert] future-clock tests failing` is a main repair due before the break date on it (D7124). Check that a slot task exists for each failing test and file one if not: open the run linked on the alert (its `Latest failing run` line), read the names, files, parts and reproduce command from the run summary of the `future clock (report)` job, and put them in the task, not on the alert (D5663 keeps names off it). Due before the break date.
- More than 50 closes or 200 new issues in one run: show the owner the dry run first.
- Never post a security finding on a public issue. A flaw goes to the owner privately (draft security advisory).

## What this skill does not do

It does not decide product questions: it asks them, with lettered options and
a pick. It does not land canvases (`land-canvas`) or write design prompts
(`design-brief`). It does not write `CHANGELOG.md`.
