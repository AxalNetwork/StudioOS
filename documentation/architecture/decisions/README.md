# documentation/architecture/decisions — one file per decision, from D526 on

Each decision from D526 on is its own file in this folder. `../DECISIONS.md`
keeps D1 to D525 and takes no new entries.

**Why.** `DECISIONS.md` changed in 130 of the 624 commits on `main` between
2 August and 3 October 2026. Every PR inserted its entry "in numeric position",
so two open PRs almost always collided in that one file, and each merge sent
the others back to resolve it. A file per decision gives each PR a file no other
PR touches. `D526.md` records the change.

## Adding a decision

- **Name.** The file is `D<n>.md`. From D4106 on, `<n>` is your issue's own
  number (issue #4102 records D4102), so nothing is reserved and two PRs never
  pick the same one. An issue written before that which names a lower D number
  keeps it. Never take "the next free number".
- **Heading.** The first line is `## D<n> — <title>`, the same number as the
  file name. From D4000 up it also cites the issue: `## D4102 — <title> (#4102)`.
- **The gap.** Numbers from the highest an issue handed out (D1614 when D4106
  landed) to D3999 stay unused.
- **Body.** What a `DECISIONS.md` entry holds: what was decided and why, what
  it changed, what stays not built, and how it was verified.
- **One decision per file.** Cite other decisions by number, such as D404 or
  D510, wherever they live.

## The rules, and what checks them

`node scripts/check-decision-ids.mjs` reads `DECISIONS.md` and every file
here but this README, and runs under `npm run test:drift`. It fails when:

- a number appears twice across the two places, or twice in either;
- a file's name and its heading are different numbers, or a file has no
  heading or holds more than one decision;
- a file's first line is not `## D<n> — <title>`;
- `DECISIONS.md` gains a heading above D525;
- a file here is numbered at or below D525, or is not named `D<n>.md`;
- a file numbered D4000 or above whose first line does not cite `#<n>`, its
  own issue (D4106).

Tests read an entry through `readDecision(id)` in `frontend/test/_decisions.mjs`,
which finds it in either place.

Entries in `DECISIONS.md` stay where they are. Nothing is moved or rewritten,
and citations by number keep working.

## The list of decisions (generated, D6465)

<!-- index: generated -->

Adding a decision adds its file and nothing else: never add a row here. The
list below is generated from each file's first line, its `## D<n> — <title>`
heading, by `node scripts/check-folder-docs.mjs --write`, which fills it in the
working tree for reading; `--clean` empties it again before you stage this
README. It is never committed, and `check-folder-docs.mjs` fails a commit that
carries it, or a hand-written row naming a file here (#6465). Before D6465 this
was a hand-written table that held 76 of the files and was the file most PRs
collided in.

<!-- files:begin -->
<!-- files:end -->
| `D5602.md` | Advisory PR scan scope, retained main finding fingerprints, one redacted shared incident and permission/rollback boundaries. |
| `D5666.md` | Observational session attribution and persistent PR/incident routing. |
| `D5663.md` | Verified future-clock evidence and persistent health delivery intent. |
| `D5664.md` | Independent signed metadata capture, immutable ledger and explicit source gaps. |
| `D5665.md` | Durable itemized Slack delivery, destination registry and explicit receipts. |
| `D5665-p2.md` | Preserve simultaneous head, tested, candidate, landed and deployment-target SHA roles in Slack records. |
| `D5670.md` | Cloudflare source coverage, ownership and staged acceptance. |
| `D5671.md` | Authenticated Cloudflare delivery and explicit route isolation. |
| `D5672.md` | Existing platform signals and conservative incident attribution. |
| `D5680.md` | Restricted operational security triage without public disclosure. |
| `D5664-p2.md` | Deduplicate terminal CI endpoint timestamp differences while retaining source evidence and distinct attempts/results. |
| `D5721.md` | Census public Help for every signed-in rail profile without changing routing or authorization. |
| `D5035.md` | HQ Support’s durable recent decisions, branch delivery outcomes, manual resend and regression coverage. |
| `D5495.md` | Deterministic concurrent Trust Publish replay coverage over the merged repair. |
