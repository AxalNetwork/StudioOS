# Raise evidence map — 2026-10-26

This audit reads the owner's "Raise evidence" canvas (#2430, boards VR1–VR19) against the code on `origin/main` at `3f466ec0b7`. It is a snapshot, true as of that date and **not maintained**. D1261 is the decision that acts on it.

## 1. The canvas

`design/incoming/Raise evidence · Boards.dc.html` holds the board grid. It imports `Raise Evidence Page.dc.html`.

| Boards | What they draw |
|---|---|
| VR1 | Evidence, the founder's view: claims by area, waiting for review, coverage, investor opens |
| VR2, VR3 | The claim drawer (a Mismatch) and the item drawer (a Recorded theme) |
| VR4, VR5 | Waiting for review; the Share dialog |
| VR6, VR7 | Evidence inside a module; the pitch deck editor's claim chips |
| VR8–VR10 | The investor's summary before and after the NDA, and the item drawer |
| VR11–VR19 | See as an investor, states, phone and dark |

## 2. What each board can read today

| Board | Read | Drawn by D1261 |
|---|---|---|
| VR1 header and tabs | `GET /api/cycles/raise/overview`; `cycleTabs` | The Raise shell with Evidence lit after Overview |
| VR1 claims, coverage, proposals, opens | none: no `raise_evidence_items`, `raise_claims` or candidate builder | Each area and block says Not read here yet |
| VR2, VR3 drawers | none | Addresses `/raise/evidence/claim/:id` and `/item/:id`, each waiting |
| VR6 module parts, VR7 deck chips | `narrative_checks` (three figures) | Not drawn (part 6) |
| VR8–VR10 investor | none from Raise; the data room by grant | The deal page's Evidence tab draws the block, waiting (part 4) |

## 3. #2430's broken items, re-checked

| # | Finding | On `main` at `3f466ec0b7` |
|---|---|---|
| 1 | `check_against_json` stored, never read by the check | **Open** (part 1): written and inherited by version, the check still reads deck and metrics |
| 2 | The check ignores a metric's source | **Open** (part 1) |
| 3 | Traction proof reads typed fields as measured | **Open** (part 1): `revenue_entries` is not read |
| 4 | Team ignores Build | **Open** (part 1): "`team` has no store to read" |
| 5 | Data-room readiness counts files no investor can open | **Changed on main**: the item counts "Files investors can download"; part 1 confirms |
| 6 | A refused download counted as an open | **Changed on main**: opens read `action = 'download'`; part 1 confirms |
| 7 | Committed adds soft and received money | **Open** (part 1) |
| 8 | Mercury's runway reaches neither score nor figure | **Open** (part 1) |

## 4. What waits, and on what

- Part 1 (fixes) and part 2 (stores, candidate builder, founder routes; migration 628) start now.
- Part 3 (the claim check) follows part 2. Part 4 (investor reads) follows part 2.
- The frontend parts follow their Worker parts.
- The nine owner questions take their proposed (A) answers until the owner says otherwise (D1261 §5).
