---
name: task-lifecycle
description: Take a StudioOS slot task from state:ready to DONE the way AGENTS.md says. Use when a building session (any slot but S01) picks up, claims, reports on, blocks, hands back or finishes an issue, when claim.mjs exits 3 or 4, when a claim needs renewing or releasing, or when checking for the owner's answer on a blocked issue.
---

# Task lifecycle

AGENTS.md § Task protocol, § STATUS and § Owner answers, end to end, for a
building slot. Session 1 (`S01`) writes tasks and does not use this skill; its
pass is `coordinator-audit`.

Two things go wrong most: the `claim.mjs` exit 4 fallback gets worked out
again each time, and claims expire without being released, so the hourly
reaper (`.github/workflows/claims-reaper.yml`) comments on each. This skill
makes both routine: exit 4 is a normal path, and every claim is renewed while
work goes on and released when it stops.

`scripts/task-lifecycle.mjs` does the reading. It sends GET requests only and
never claims, labels, comments, pushes or merges; you do those.

## Your identity

Every claim command and STATUS uses the same three values. Write them down at
the start and keep them for the whole task.

- **slot**: the `slot:SNN` label on the issue, e.g. `S07`. The standard
  slots are `S01` to `S37`; an explicitly assigned later slot such as `s39`
  is kept (D5617) and the script accepts it. `claim.mjs` stores the slot
  exactly as you type it and compares it exactly, so type it the same way
  in every claim command.
- **agent**: `Claude Code`.
- **session**: your session id, the `session_…` at the end of the
  `Claude-Session:` URL in your commit attribution.

`claim.mjs` also reads them from `AGENT_SLOT`, `AGENT_NAME` and
`AGENT_SESSION` when the flags are left out.

## Steps

1. **Check answers first.** Each time you look at your queue (AGENTS.md
   § Owner answers):
   `node scripts/task-lifecycle.mjs answers --slot SNN`.
   It lists, for your open `needs-decision` and `state:blocked` issues, the
   owner-account comments since the issue's last BLOCKED STATUS (so a later
   STATUS from any slot does not hide an answer) that do not start with `S1:`
   and carry no STATUS block, plus Session 1's `S1:` relays. Agents post as
   the same account, often with no footer and sometimes with a STATUS that is
   not a block (`STATUS S31: Draft …`), so **every candidate may be an
   agent's note**; the script marks the obvious ones `looks like an agent
   note`, but only a comment that answers your lettered options counts. A
   real answer settles the question: remove `needs-decision`, set
   `state:in-progress`, post a STATUS that says what the owner chose, and
   finish that task before pulling a new one.
2. **Check your claims.**
   `node scripts/task-lifecycle.mjs claims --slot SNN --agent "Claude Code" --session <session>`
   lists the slot's claim refs. It prints a command only for a ref whose
   stored slot, agent and session all match your flags: `RENEW` (under 6
   hours left), `EXPIRED` (release, then claim again if the work goes on:
   `renew` refuses an expired claim) or `RELEASE` (the issue is closed).
   Without `--agent` and `--session` it lists the refs for information and
   prints no command. Another session's claim is never yours, expired or
   not: it stays held until its holder releases it or the owner hands it
   back (AGENTS.md § Task protocol step 2).
3. **Pull.** `node scripts/task-lifecycle.mjs next --slot SNN` lists the
   oldest open `slot:SNN` + `state:ready` issues (AGENTS.md step 1) and who
   holds each one's `claim/<issue>` ref, going down the whole queue until it
   finds one with none. Take that one. One task
   at a time. Read the whole issue and its comments; the issue names the
   files it owns (§ File ownership), and you never edit files another open
   issue or PR owns.
4. **Claim.**
   `node scripts/claim.mjs claim <issue> --slot SNN --agent "Claude Code" --session <session>`

   | Exit | Meaning | Do |
   |---|---|---|
   | 0 | You hold `claim/<issue>` for 24 hours | Go on |
   | 3 | A ref exists, even an expired one; it prints the holder | Leave the issue alone and pull the next one |
   | 4 | GitHub returned 403 on one of its calls: usually the ref write, but it can be the first read of the ref (a rate limit), so the ref may be held | Run `node scripts/claim.mjs show <issue>` first. Only if it prints `null`, claim by label and write it in STATUS `blockers:`: `Claimed by label: the claim/<issue> ref write returned 403 (claim.mjs exit 4).` If it prints a holder, treat it as exit 3; if `show` fails too, wait and retry |
   | 1 | Bad option or network error; it prints the message | Fix the command and run it again |

   `node scripts/claim.mjs show <issue>` prints the current holder, or `null`.
   With exit 4 you hold no ref, so there is nothing to renew or release later.
5. **Mark it started.** Swap `state:ready` for `state:in-progress` and post
   the STATUS together (§ STATUS: "you change both at the same time").
   `node scripts/task-lifecycle.mjs status --issue <N> --slot SNN --agent "Claude Code" --branch <branch> --state IN_PROGRESS`
   prints the block inside its `text` fence and the label change. Optional
   fields: `--files`, `--blockers`, `--questions`, `--tests`, `--pr`; add
   `--offline` to skip reading the issue's current labels. Post the block
   exactly as printed, with `gh issue comment <N> --body-file <file>` or the
   GitHub tools, and change labels with
   `gh issue edit <N> --add-label … --remove-label …`.
6. **Branch.** `git fetch origin main`, then
   `git checkout -b agent/claude/<issue>-<slug> origin/main`. If your
   environment allows only its designated branch, restart that branch from
   `origin/main` for each task (AGENTS.md step 3), and only once its previous
   PR has merged or closed: never reuse a branch that has an open PR.
7. **Build.** CLAUDE.md § Rules for new work and AGENTS.md § House rules. A
   decision is its own file, `documentation/architecture/decisions/D<issue>.md`,
   headed `## D<issue> — <title> (#<issue>)`; part `k` of a multi-part issue
   writes `D<issue>-p<k>.md`, headed `## D<issue> part <k> — <title> (#<issue>)`
   (D4106, D5615). Run `node scripts/check-decision-ids.mjs`. A migration is
   `cloudflare-worker/sql/migrations/YYYYMMDDHHMM_<issue>_<slug>.sql` (D5398).
   Never edit `CHANGELOG.md`: it is Session 1's, and the `CHANGELOG gate`
   workflow (`changelog-gate.yml`) fails a PR that touches it. Tests:
   `npm run test:drift > drift.log 2>&1; echo EXIT=$?` after `npm run build`,
   or the same checks in parts with the `verify-before-push` skill when one
   run would outlast the session.
8. **Renew** while you work. Before 24 hours pass (`claims` says `RENEW`):
   `node scripts/claim.mjs renew <issue> --slot SNN --agent "Claude Code" --session <session>`.
   Exit 3 has two causes; read what it printed. `expired; release and acquire
   again`: release, then claim again. `holder identity does not match`: run
   `node scripts/claim.mjs show <issue>`; if it is your claim and a flag was
   wrong (slot spelled differently, session), fix the flag and renew; if it
   is someone else's, it is not yours: never release it.
9. **Open the PR.** One draft PR, its body filled from
   `.github/pull_request_template.md`, every section filled or "None":
   `gh pr create --draft --base main --title "…" --body-file <file>`.
   The body says `Closes #<issue>`, or `Part of #<issue>` when part of the
   task waits. Then set `state:review` and post a STATUS with
   `--state READY_FOR_REVIEW --pr <link>`.
10. **Blocked.** Post `--state BLOCKED` (add `--needs-decision` when the call
    is the owner's, which also adds that label). Put the question in
    `questions:` as lettered options, A, B, C, and say which one you would
    pick, so one letter answers it. Build what does not wait, in a PR that
    says `Part of #<issue>`. Then take another task; keep the claim while
    you expect to come back, and release it if you hand the task back.
    A screen with no canvas is § Missing UI: `needs-design` plus a STATUS
    whose `questions:` describe the screen.
11. **Fix until green.** CI failures and review findings: see the
    `red-ci-triage` skill and AGENTS.md § Red main (D5398). An inherited
    failure from a red `main` goes in `blockers:` once, as
    `inherited main failure, <alert issue>`. Landing is AGENTS.md step 5; this
    skill stops at `state:review` and resumes once the PR merges.
12. **DONE, once, after the merge.** Post `--state DONE` with the merged PR's
    link (DONE changes no label: the issue closes when the PR merges). Then
    release the claim:
    `node scripts/claim.mjs release <issue> --slot SNN --agent "Claude Code" --session <session>`.
    Exit 3 on release means you hold no ref (the exit 4 path) or the identity
    differs; never delete a ref by hand. If you moved on before the merge,
    release when you hand back; Session 1 posts DONE when it confirms the
    deploy.

## Hand-back

When you stop without finishing (out of time, task taken over, wrong slot):
post a STATUS that says where the work is and what is left (`--state
BLOCKED` with the reason in `blockers:`), and release your claim. Never set
`state:ready`: only Session 1 makes a task ready (AGENTS.md § Task protocol),
so re-readying is its call. If the label must change, it is `state:blocked`.
An unreleased claim makes every other session's `claim` exit 3 until the
owner steps in.

## What this skill does not do

It does not write tasks, move issues between slots, or close issues; that is
Session 1 (`coordinator-audit`). It does not merge, approve, queue, push to
`main` or another slot's branch, or use `--admin` (AGENTS.md step 5, #5569).
It never deletes another holder's claim ref, and the reaper never does either.
It does not touch `bounty:` or `feature:` labels (§ Support-ticket triage).
