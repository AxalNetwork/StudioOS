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
- [D5675](D5675.md) — Isolated synthetic preview callback, normal promotion gate and urgent rollback handling (#5675).
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
| `D4557-p2.md` | Bounded general compute host with canonical grants; hosted activation remains owner-gated. |
| `D5720.md` | Static notification test Worker, data bindings and scanner-clean policy locals. |
| `D5035.md` | HQ Support’s durable recent decisions, branch delivery outcomes, manual resend and regression coverage. |
| `D4862-p2.md` | Focus-first Grow overview, recorded attention and one taxonomy over existing routes (#4862). |

| `D5218-p2.md` | Mount actual template and saved-version previews in New Deck and Gallery (#5218). |
| `D5039-p3.md` | Governed statement disputes and due dates, actual action history, Stream control and dated branch checkout read-back (#5039). |
| `D5512.md` | Homepage module-count contrast and keyboard focus restoration for the public Network menu. |
| `D5024-p2.md` | Immutable package offers, atomic Program Grants/legal-policy acceptance, source-bound contracts and normal branch-copy delivery. |
| `D5573.md` | Local mocked workspace validation harness: faultable fake provider, six invariant checkers and a `local_mocked`-only report; no hosted, cloud or production capacity proof (#5573). |
| `D5572.md` | Disabled outbound-only customer runner protocol: enrollment, attestation, signed fenced status, capability, egress, residency and consent decisions over D5565/D5567; unmounted. |
| `D5790.md` | Read-only HQ draft comparison against the deployed library source, with explicit refusal messages. |
| `D6093.md` | Reporting phone writers reach Reminder settings through the existing More menu, with reader gates and the Prepare bar preserved (#6093). |
| `D6135.md` | Investor onboarding profile-copy failure, retry and explicit continuation, unused-slider removal, saved-step resume and role-safe LP handoff (#6135). |
| `D6177.md` | Deal Traction single empty state, recorded last-shared/source dates and browser CSV preserving gaps and real zeroes (#6177). |
| `D6292.md` | Investor Diligence door, recorded member context links and validated Cases list state in the address (#6292). |
| [D6094](D6094.md) | #6094: frozen sent-report printing and audience-safe light PDF copy. |
| `D5620.md` | Merge Control policy source: one bundled classifier, injected `policy_version`, fail-closed compare evaluation; four live questions not recorded (#5620). |
| `D5606-p3.md` | Treat both coexisting CI summary gates as summaries so required-shard infrastructure failures remain diagnosable; independent of ruleset cutover (#5606). |
| `D6024.md` | Confirmed Build feature removal and must-have demotion, protected references, atomic audit and honest Build Plan history without stale links (#6024). |
| `D6381.md` | Bound unused-import usage blanking to the import clause/module literal so import attributes and side-effect imports cannot erase real uses (#6381). |

| `D6495.md` | Exact synthetic D5074 fixture exception, real-scanner history replay and adversarial boundary proof (#6495). |
| `D6115.md` | Remove a Grow partner, market or obligation added by mistake: a hard delete, refused for a partner with revenue or deals and a held obligation; the compliance delete runs the same writer (#6115). |
| `D6027.md` | Build Overview V2's Worker read: the canvas's next-action order, material-blocker attention and the Build Plan preview, one statement more (#6027). |

| `D6397.md` | Five recorded Fund Admin tasks in today’s shared Ask panel, with scoped navigation and no models or financial acts (#6397). |
| `D6413.md` | Share request-local event audience reads and batch saved visibility in bounded windows (#6413). |
| `D6414.md` | Validate stored event preference array shapes without rewriting historical rows (#6414). |
| `D5919.md` | Territory, Renewal window and Attention menus for loaded licence-ledger rows (#5919). |
| `D6202.md` | #6202: the support ledger's lifecycle: due dates, in progress and cancelled states, an introduction's meeting, and the totals that count them (Worker and migration). |
| `D6514.md` | Bound verbose CodeQL SARIF independently of compact event/state JSON, retaining fail-closed reporting. |
| `D6028.md` | Build Overview V2 page: `/build` drawn to BD1 and BD2 from D6027's read, one primary action, the header's Connect a tool removed on `/build` only (#6028). |
| `D4838-p2.md` | Pipeline v2 PP03: Leads, reasons before the score and structured pass (#5935). |
| `D5937.md` | Pipeline v2 PP04: Proposals as a follow-up list (#5937). |
