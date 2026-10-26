# Deal page map — 2026-10-25

The owner's Investor Deal Page canvas (#2421, boards DL1–DL24), read against the code on `origin/main` at `a265fb2561`. This snapshot is true as of that date and is **not maintained**. The decision that acts on it is D1148.

## 1. The canvas

`design/incoming/Deal page · Boards.dc.html` holds the board grid, which imports `Investor Deal Page.dc.html`.

| Boards | What they draw |
|---|---|
| DL1 | Overview for an investor at desktop: header, key strip, stage track at Diligence, the eleven tabs, Eadwyn's rail, the scorecard slot |
| DL2 | The stage track's states: Invited, Reviewing, Diligence, IC, Terms, Committed, Signed, Funded, You passed, Passed by the studio |
| DL3–DL6 | Evidence, Team, Market, Traction |
| DL7–DL13 | Diligence (DL7n no case), Documents and data room (DL8a–c access states), the access and NDA dialogs, Terms, Commitment and closing, Commit and Withdraw, the syndicate lightbox |
| DL14 | Notes and activity |
| DL15 | Who sees what: twelve kinds of information against seven viewers |
| DL16–DL17 | The founder's view; the admin's and the Operating Partner's |
| DL18–DL23 | Empty, loading, error and partial, phone, no permission, dark |
| DL24 | The slots from sibling canvases: Scorecard, Evidence, Terms, Commitment |

## 2. #2421's broken items, re-checked

| # | Finding | On `main` today |
|---|---|---|
| 1 | The studio's notes leak | **Fixed** by #2647: `serializeDeal` strips `notes`, `pass_reason`, `pass_note` and `passed_by_user_id` for non-staff |
| 2 | The zip ignores the data room and the NDA | **Fixed** by #2647: `GET /:id/data-room` is 410; Documents lists titles and types only |
| 3 | Every investor sees every commitment and note | **Fixed** by #2647: an investor reads their own rows only; others a total |
| 4 | Any investor edits another firm's reference call | **Fixed** by #2437: edit and delete are the author's (`references.ts`) |
| 5 | Syndicate members' emails are public | **Fixed** by #2647: emails go to admins only (`networkfx.ts`) |
| 6 | Two rules for "in this deal" | **Open**: diligence still needs a joined room (`dd.ts`) |
| 7 | A commitment cannot be withdrawn; the total only grows | **Fixed**: `POST /:id/commitments/:uid/withdraw`, and `capital_committed` is recomputed from confirmed rows |
| 8 | The commit write skips its rules | **Fixed**: status, minimum and invitation checks, one live commitment per firm, `company_id`, and an audit row |
| 9 | Zeros for missing values | **Open**: `progress_pct` and `days_in_stage` are 0 when their input is missing |
| 10 | USD only | **Open**: no `deals.currency` |
| 11 | A founder's back button bounces | **Open**: "Back to Deal Flow" goes to `/deals` |
| 12 | Investors are refused Transfers | Open, and DL15 decides it (part 7) |
| 13 | A Free-plan investor gets a refusal for the whole page | **Open** (`INVESTOR_PRO_PREFIXES`) |

## 3. What each tab can read today

| Tab | Read | Drawn by D1148 |
|---|---|---|
| Overview | `GET /api/deals/:id`, syndicates | As today, at `/deals/:id` |
| Scorecard | none (SCORING #2428 has no per-deal read yet) | Not read here yet |
| Evidence | none (PIPE-RAISE #2430) | Not read here yet |
| Team, Market, Traction | none | Not read here yet |
| Diligence | reference calls; DD cases exist but are not read per deal | Reference calls under a Not-yet line for the case |
| Documents | `GET /:id/documents` | As today |
| Terms | none per deal (IC and e-sign exist, not wired to the deal) | Not read here yet |
| Commitment | `GET /:id/commitments` | As today |
| Notes | none (no notes store) | Not read here yet, with the activity under it |
| Activity, Invitations, Transfers | as today | As today |

## 4. What waits, and on what

- **Fixes** (part 1, #3054, migration 599): the one rule, no zeros, currency, the back link, the Free-plan card.
- **Stage, what's new and notes** (part 2, #3055, migration 600).
- **Team, Market, Traction reads** (part 3, #3056) wait on PIPE-RAISE and SCORING.
- **The frontend** (parts 4–7, #3057–#3060) follows.

## 5. Status (added by D1155, 2026-10-26)

This map has been acted on in full. The snapshot above is unchanged; this note says where each part landed.

| Part | Decision | State |
|---|---|---|
| 1 Fixes | D1149 | Merged |
| 2 Worker: stage, what's new, notes | D1150 | Merged |
| 3 Worker: Team, Market, Traction | D1151 | Merged |
| 4 Frontend: frame, header, Overview, Notes, states | D1152 | Merged |
| 5 Frontend: Diligence, Documents, Terms, Commitment | D1153 | Merged |
| 6 Frontend: Scorecard, Evidence, Team, Market, Traction, slots | D1154 | Merged |
| 7 The founder's, admin's and Operating Partner's views; who sees what | D1155 | This part |

**§2 item 12** ("Investors are refused Transfers") is decided by DL15 and D1213: an investor never reads the recorded transfers, which stay with an Admin and an Operating Partner. The refusal stands.

