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

| File | Purpose |
| --- | --- |
| `D1151.md` | Deal Team, Market and Traction read contracts and verification. |
| `D1364.md` | Time-based deployed asset retention, capacity limits and verification. |
| `D4447.md` | #4447, Part A of #3722: Grow campaign plans and their routes; carries the spec's D1481. |
| `D4450.md` | #4450: event Explain reuses the deck quote expiry/binding and ledger retry key, while preserving successful text on receipt-read failure. |
| `D4421.md` | Answered Team questions and the shared General counsel disclaimer. |
| `D4422.md` | #4422: inherited Team model and MCP read-tool allow-lists, enforced on the Worker and edited in TM8a. |
| `D4459.md` | No-call run charges and live Work-item mutation responses. |
| `D4472.md` | One account, several licences: ordered access union, additional grants and atomic appointment retention. |
| `D4488.md` | Distribution Ask drafts, scoped proposals and safe acceptance (#4488). |
| `D4484.md` | Distribution static tabs, existing Overview content, module-specific campaign primary and shared Ask presentation. |
| `D4494.md` | Distribution Inbox source scope, personal unread receipts, honest missing bodies/counts and the explicit Send boundary. |
| `D4486.md` | #4486: Distribution Channels, compatible kinds and read-only connection cards. |
| `D4496.md` | Distribution cross-tab states and responsive layouts (#4496). |
| `D4576.md` | Adds 32 specialist agent skills and synthetic golden cases through the existing library contract. |
| `D4707.md` | Licence navigation in the URL with filter reconciliation, accessible tabs and reason dialogs, and attributable paginated history (#4707). |
