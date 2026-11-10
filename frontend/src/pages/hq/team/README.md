# pages/hq/team — HQ Team's parts (D5044; #5044)

The parts of HQ › Team at `/admin/hq-team`. `../HqTeamTable.jsx` composes the
administrator table and the branch search from them and re-exports the names
other files and tests import from it (`MoveHit`, `branchHitStates`,
`supportNoticeOutcome`, `SupportNoticeOutcome`). `../AccountsPage.jsx` hosts the
page and holds its invalidation keys. `../SuperAdminHolders.jsx` and
`../AccountMoveRecovery.jsx` (D5043) sit beside this folder and use its action
model.

| File | What it is |
| --- | --- |
| `useHqTeamRoster.js` | The page's one supervision read, `GET /api/admin/hq/admins` (`api.hqAdmins`): the roster and each branch's answer, with D5042's debounce and generation guard. Nothing else on the page makes this read. |
| `HqAdminRoster.jsx` | The HQ-held administrator table (`rosterRows` narrows the complete list and sorts it worst first) and its rows: licence, compliance rung, state, last active, and Sign out. |
| `BranchAccountSearch.jsx` | Each branch's group (its state, its silence or refusal, its hits for the query asked now) and `MoveHit`, a hit with its Support, Move and Unbind, one panel open at a time; once a move answers, the hit shows its outcome instead. |
| `SignOutAccountAction.jsx` | Sign an HQ-held administrator out of every session (D165): reason and acknowledgement. |
| `SupportSessionAction.jsx` | Open a support session on a branch account (D259) and say what the branch reported about its notice (D530). |
| `MoveAccountAction.jsx` | Move a branch account to another branch (D121). |
| `UnbindAdminAction.jsx` | Unbind a branch's administrator (D262). |
| `governedAction.js` | The one state model every destructive action here shares: idle, open, submitting, confirmed, refused, unknown. A thrown request is refused or unknown by Security v2's rule (`../security/accessModel.js`, `resultOfError`); no answer within the timeout is unknown. |
| `actionFocus.js` | Where keyboard focus goes around an action (D5045): its form takes focus on its first field when it opens, Escape closes it unless it is submitting, Cancel or Escape returns focus to the button that opened it, and a finished act moves focus to the line that says what happened. |
| `ActionNotice.jsx` | What an action's form says when it was refused (the server's sentence) or its outcome is unknown. |
| `teamInvalidation.js` | Which of the page's reads (the roster, the directory) each act invalidates, and the hook that bumps exactly those keys. No act reloads the page. |

## Rules

- **One supervision read.** `api.hqAdmins` is called from `useHqTeamRoster.js`
  and nowhere else on the Team page; the holder console reads its transfer
  candidates from `GET /api/admin/super-admins/candidates`.
- **A new destructive action uses `useGovernedAction`** and draws
  `ActionNotice`, so it is never shown as done without the server's answer and
  never as refused when no answer came.
- **A new action form takes `actionFocus.js`**: focus on its first field, Escape to close (never while
  submitting), focus back to its opener, and to its outcome line when it finishes.
- **A new act names what it invalidates** in `INVALIDATES`; the page re-reads
  those reads in place.
- Authorization and write bars are the routes'. Nothing here decides who may
  act.

Tested by rendering it: `frontend/test/hq_team_behaviour_5045.test.mjs` drives every action
(review, cancel, Escape, confirm, refusal, unknown, focus), `hq_team_split_5044` the reads and the
state model, `hq_team_search_race_5042` the search, `hq_team_branch_truth_5041` the branch states,
`hq_team_move_recovery_5043` the move and its retry, and `super_admin_handover_5040` the transfer.
The source-reading tests that remain read this folder through `frontend/test/_hqTeamSource.mjs`, and
only for what a render cannot show: where a call lives and which route literal it names.
