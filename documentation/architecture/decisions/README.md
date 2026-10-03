# documentation/architecture/decisions — one file per decision, from D526 on

Each decision from D526 on is its own file in this folder. `../DECISIONS.md`
keeps D1 to D525 and takes no new entries.

**Why.** `DECISIONS.md` changed in 130 of the 624 commits on `main` between
2 August and 3 October 2026. Every PR inserted its entry "in numeric position",
so two open PRs almost always collided in that one file, and each merge sent
the others back to resolve it. A file per decision gives each PR a file no other
PR touches. `D526.md` records the change.

## Adding a decision

- **Name.** The file is `D<n>.md`, where `<n>` is the number your issue gives.
  Never pick a number yourself; ask on the issue if it gives none.
- **Heading.** The first line is `## D<n> — <title>`, the same number as the
  file name.
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
- a file here is numbered at or below D525, or is not named `D<n>.md`.

Tests read an entry through `readDecision(id)` in `frontend/test/_decisions.mjs`,
which finds it in either place.

Entries in `DECISIONS.md` stay where they are. Nothing is moved or rewritten,
and citations by number keep working.
