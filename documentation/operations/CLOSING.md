# Run a closing, end to end (D1220)

A closing is one deal's round brought from commitments to money received and a
cap table decided. Since #2424 (D1213, D1215–D1219) it is a record:
- **the stores:** `closings`, one line per commitment, the evidence on each line, and an append-only event log (migration 612);
- **the paper:** signed in order, with Axal's countersign last (migration 633);
- **the pages:** for the founder, the investor and the studio team.

This runbook is the order an operator follows, from opening a closing to
marking it Closed. Each step says:
- who does it;
- which page they use, and the route behind it;
- what the system refuses, and what it never does.

**The platform never moves money.** It records paper, routes and evidence, and
matches what a bank already shows. No step below sends, holds or releases a
payment. Nobody pays because a page told them to: payment details are confirmed
by phone, on a number already held (step 5).

**Never** paste an account number, an amount, an investor's name, a signing
link or a session token into an issue, a pull request, a commit or a chat. The
repository is public. A closing is named by its deal id or its uid, and nothing
else.

## Who does what

| Role | Does | Never does |
| --- | --- | --- |
| **Admin** (the studio team) | Opens the closing, adds lines, chooses routes, prepares and sends the paper, records evidence, marks Closed | Countersigns for Axal, commits or releases fund money, decides the cap table |
| **Super Admin** | Everything an Admin does, and countersigns for Axal with a fresh step-up (`closing.countersign`) | Decides the cap table |
| **Founder** of the venture | Signs first, reads every line, decides the cap-table change | Records evidence or marks Closed |
| **Investor** on a line | Signs their paper, reads payment instructions, sends the money, accepts their own Mercury match | Sees any other investor's line, name or amount |
| **Operating Partner** | Ticks the deal's closing checklist, reads the checklist, transfers and total | Records a transfer (`admin_records_transfers`) or reads the closing record |

A support session is refused every closing write (`support_session_refused`).

## The pages

| Page | Who | Address |
| --- | --- | --- |
| Contracts › Closings, the desk | Admin, Super Admin | `/admin/contracts/closings` |
| One closing | Admin, Super Admin | `/admin/contracts/closings/:dealId` |
| The founder's room | Founder | `/raise/capital-relationships/closing` |
| The room under a deal | Founder, investor, Admin, Operating Partner | `/deals/:dealId/closing` |

The desk lists every open closing, deadline first. **Waiting on** says whose
turn it is (Studio team, Investors or Founder) and why. That is the Worker's
`next_actor` (`services/closings.ts`), and the quickest way to find the next
step on any closing.

---

## 1. Open a closing (Admin)

**Where:** Contracts › Closings › **Open a closing**. Route: `POST /api/closings`.

1. Choose the deal. The dialog lists only deals with no open closing; a deal
   holds at most one (`closing_open`).
2. Optionally give a round label and a deadline (`YYYY-MM-DD`). With no
   deadline, the deal's own closing deadline is taken when it is a date.
3. Confirm. The closing opens with:
   - **one line per live commitment** (pending or confirmed) that has an amount in cents;
   - you as its owner;
   - the deal's currency, else USD.

**A commitment with no amount in cents gets no line.** It is not drawn as $0.
Fix the commitment's amount on the deal, then add its line:
- `POST /api/closings/:uid/lines` with `{ "commitment_uid": … }`;
- or, for a Raise prospect of the venture with an amount in cents,
  `{ "prospect_id": … }`.

A line that already exists answers `line_exists`. No page has an "Add a line"
control yet (§10).

## 2. Choose each line's route (Admin)

**Where:** one closing › the line › **Choose the route** (CP5). Route:
`PUT /api/closings/:uid/lines/:lineUid/route`.

| Route | Use it when | The vehicle |
| --- | --- | --- |
| `direct` | The investor pays the company | None |
| `syndicate` | An SPV collects members' money and makes one payment | `syndicate:<id>`, chosen from the venture's syndicates |
| `axal_fund` | An Axal VC fund invests | The fund |
| `third_party_fund` | Another fund invests | Its legal name, recorded in the third-party fund drawer (CP8) |

- **Every route but Direct names its vehicle.** The dialog refuses one without
  it before anything is sent.
- **A withdrawn line keeps its route** (`line_withdrawn`).
- **The route's other needs read "Not read here yet":** the receiving account,
  identity and business checks, joinders, the fund's cash. Check those outside
  this page.

## 3. Prepare and send the paper (Admin)

**Where:** one closing › the line › **Prepare paper** (CP3). Routes under
`/api/legal/esign/staged` (D1216).

1. **Choose the paper:**
   - Portfolio: SAFE, Term Sheet, Stock Purchase Agreement;
   - Fund: Subscription Agreement, SPV Joinder, Co-Investment Side Letter,
     Strategic Side Letter / Focused SPV.
2. **Preview** (`POST /staged/preview`), fill the fields the text leaves open,
   then preview again.
   - **Three facts are sourced:** the company (from the deal), the investor
     (from the line) and the purchase amount (from the line's cents).
   - **Every other field is typed.** Editing a sourced field marks it Typed.
   - **Eadwyn never fills money** (amount, price, cap, valuation, discount,
     fee, carry).
3. **Send for signature**, and confirm in the same dialog (`POST /staged`).
   - The signers are, in this order: the company, through the deal's
     `founder_user_id`; then the line's investor; then Axal's countersign, by
     default.
   - The order is the database's, and cannot be changed.

**Refusals you will meet:**

| Code | Means | Do |
| --- | --- | --- |
| `counsel_draft_only` | No counsel text is on file for this paper. It previews as a draft, never sends. | Get counsel's text published in the template store. A SAFE stays a draft until D578's text is on file. |
| `fields_unfilled` | A field is still open. The list comes with it. | Fill each field named. |
| `signer_unknown` | A signer has no account: often the venture's founder account is not linked. | Link the founder's account to the venture. The drawer names who is missing. |
| `investor_not_on_line` | The investor named is not this line's. | Send the line's own investor. |
| `line_not_in_closing` | The commitment is not a line of this closing. | Add the line (step 1). |

**How each stage is sent:** each one goes to its signer by email, as an ordinary
envelope.
- The company signs first. The investor's stage is sent only after that.
- Axal's stage then reads **awaiting release**. It is never sent on its own.

No page returns a founder's or an investor's signing link. The paper drawer
shows the order: Signed (with the day), Your turn, Waiting, Declined, and
Waiting for the Super Admin.

## 4. Countersign for Axal (Super Admin)

**Where:** one closing › **Countersign for Axal**. The button shows on each
envelope whose Axal stage reads `awaiting_release`. Route:
`POST /api/legal/esign/staged/:uid/countersign` (`closing.countersign`).

1. Press it and confirm the dialog.
2. If your session is stale, the authenticator prompt opens
   (`step_up_required`). Enter the code, and the call retries. Nothing is sent
   until the step-up passes.
3. The signing link is drawn for you alone. Sign on the e-sign page. The
   envelope is then complete.

**An Admin never sees this act enabled.** They read the act's sentence in its
place.

**Its other refusals:**
- `not_your_turn`: a stage ahead has not signed;
- `no_countersign`: the envelope was sent without Axal's stage.

## 5. Share the payment instructions (founder, then the investor)

**Today this step happens outside StudioOS's pages.** The company's receiving
instructions (D1217, migration 613) are mounted at
`/api/closings/company-receiving-accounts` (#3214): the founder saves the
account, every read is masked, and an investor with a signed line (D1215's line
on an open closing, its own envelope completed and signed by them) reveals it,
logged without the number. No page calls these routes yet, so:
- The founder's room reads "Your company's receiving account: Not read here yet".
- The investor's **See payment instructions** drawer opens with CP9's warning,
  then says the instructions are not read here, naming #3214. It shows no
  account number and no mask.

**The rule, before and after the mount.** The investor calls the company on a
phone number they already hold, and confirms the details before paying. They
never use a number supplied with a change of payment instructions.

**Once #3214 mounts `/api/closings/company-receiving-accounts`:**
- The founder saves the account there (`PUT /:projectId`).
- An investor with a signed line reveals it (`POST /:projectId/reveal`). That
  writes the reveal to its ledger before decrypting, and answers no-store, for
  30 seconds of display.
- Replacing the account notifies every investor with a pending commitment
  across the company's projects.

Update this step when that happens.

## 6. The investor sends the money; record the evidence (Admin)

The investor pays outside StudioOS. A line's money status is worked out from
its evidence, never typed:

| Status | Means |
| --- | --- |
| Waiting for money (`open`) | No evidence yet |
| Sent, not yet confirmed (`sent`) | Only sending-side evidence: the investor's own Mercury |
| Received (`received`) | Receiving-side evidence that is not withdrawn |
| Withdrawn | The line was withdrawn |

**Only receiving-side evidence makes a line Received:**

| Kind | Side | Source it names |
| --- | --- | --- |
| `company_mercury` | receiving | `mercury:<id>`: the company's Mercury transaction |
| `axal_mercury` | receiving | `mercury:<id>`: an Axal entity's Mercury transaction |
| `phone_verified_record` | receiving | `deal_transfer:<uid>`: a transfer recorded on this deal with Phone-verified ticked |
| `bank_confirmation` | receiving | `file:<key>`: a bank confirmation file already stored |
| `investor_mercury` | sending | `mercury:<id>`: the investor's own Mercury |

**The sender's side.** In their room, the investor accepts their own Mercury
match ("Accept this match?", `POST /api/mercury/investor/proposals/:uid/accept`).
That records Sent, not yet confirmed. It never records Received.

**The receiving side, a phone-verified transfer:**
1. Call the investor on a number already held, and confirm the payment.
2. Record it on the deal's page: Commitments › **Record a wire**, or the deal
   room's Transfers tab. Use the amount in integer cents, and tick
   **Phone-verified** (`POST /api/deals/:id/transfers`, `closing.evidence`).
   - Open IC conditions on the deal block a transfer
     (`open_conditions_block_transfer`). Clear them first.
   - An Operating Partner is refused (`admin_records_transfers`).
3. Link it to the line as evidence:
   `POST /api/closings/:uid/lines/:lineUid/evidence` with
   `{ "kind": "phone_verified_record", "source_ref": "deal_transfer:<uid>" }`.
   **No page has this control yet (§10).**

**Mercury and bank-file evidence** go through the same route, naming the stored
record by its id:
- **Free text is refused.** A memo, an account number or a name gets
  `source_ref_invalid`, and the refusal echoes nothing back.
- **The status is recomputed in the same batch as the evidence.**

**Wrong evidence is withdrawn, never deleted.** Use
`POST /api/closings/:uid/evidence/:evidenceUid/withdraw` with a reason of 10 to
200 characters. The line's status is recomputed. The evidence and its event
stay on record.

**A line that will not close in this round:** one closing › the line ›
**Withdraw**. It then counts in no total. Its evidence and history stay.

**A syndicate line.** The SPV panel (CP6) shows the members and what each
committed. The SPV's one payment to the company is the line's status.

**An Axal VC fund line.** Its commitment and release are Super Admin acts with
no route yet. Issue the capital call in Fund admin › Capital calls.

## 7. The cap-table decision (founder)

**When the proposal appears.** Once every line is received or withdrawn, with at
least one received, the proposal reads **proposed**. The desk then shows
**Waiting on: Founder**.

**Where:** the founder's room › **Needs you** › the cap-table change (CP11).
Routes: `POST /api/closings/:uid/captable/accept` or `…/dismiss`. **Not now**
writes nothing.

**What the decision does:**
- **Accepting records the decision only.** Raise › Cap table writes the holder (#2432).
- **Only the founder decides.** An Admin or an investor is refused with "The
  founder decides the cap-table change." (`founder_decides`).
- **A decision is made once** (`captable_decided`).

**When the founder has not decided:** remind them. Do not decide for them. The
closing cannot close until they do.

## 8. Mark Closed (Admin)

**Where:** one closing › **Mark Closed**. Route: `POST /api/closings/:uid/complete`.

**When it is offered:** only once every line is settled and the founder has
decided. Otherwise the page says why:
- `lines_not_settled`: every line must be received or withdrawn, with one received;
- `captable_undecided`: the founder has not decided the cap-table proposal.

**After Closed, nothing on the closing changes.** Every write answers
`closing_not_open`.

**Reporting duties start** (D1058):
- The reply carries `reporting_duties`, the number created.
- If creating them fails, the close still stands. The daily step creates any
  duty a closing missed.
- The founder's room then shows the duties for this closing's lines.

## 9. Read the history

**Where:** one closing › **Activity** (CP15). It shows `closing_events`, newest
first, filtered by step and exportable as CSV.
- **The log can't be changed.** Triggers refuse an update or a delete.
- **It holds no amount, name or account number.** An actor is "Account #n".
- **An evidence event's source** is `closing_evidence:<uid>`, never the bank's
  reference.

## 10. What no page does yet

These are recorded on the Worker but have no control on any page.

| Act | Route | Until a control exists |
| --- | --- | --- |
| Add a line for a commitment or a prospect | `POST /api/closings/:uid/lines` | An engineer sends it as an Admin, from the Admin's own signed-in session |
| Record evidence on a line | `POST /api/closings/:uid/lines/:lineUid/evidence` | The same |
| Withdraw evidence | `POST /api/closings/:uid/evidence/:evidenceUid/withdraw` | The same |
| Commit or release fund money (`fund_investment.commit`, `.release`) | none | Not recordable. The page says "No route records this yet". |
| Show the receiving account, and reveal it (CP1, CP9) | `GET`, `PUT` and `POST /reveal` on `/api/closings/company-receiving-accounts/:projectId` (#3214) | Step 5; no page calls them yet |

A call made by hand is still the Admin's act: it is checked and logged the same
way. Never paste the session token anywhere.

## Troubleshooting

| You see | Means | Do |
| --- | --- | --- |
| "This deal already has an open closing." (`closing_open`) | A deal holds one open closing | Open the existing one from the desk |
| "This commitment has no amount recorded in cents…" (`amount_not_recorded`) | The commitment's amount is missing or not a whole number of cents | Fix the amount on the deal, then add the line |
| "This closing could not be read. That is not the same as there being nothing to close." | The read failed | Try again. Never read it as empty. |
| "Unreadable" on a desk tile | That tile's read failed; the others stand | Try again |
| A line stuck on "Sent, not yet confirmed" | Only the investor's side is recorded | Record receiving-side evidence (step 6) |
| Paper and Sign read "Not read here" | That line's paper read failed | Reload. That cell alone is affected. |
| "Waiting for the Super Admin" | Axal's stage is awaiting release | A Super Admin countersigns (step 4) |

## Where it lives

- **Worker:**
  - `cloudflare-worker/src/routes/closings.ts` and `cloudflare-worker/src/services/closings.ts`;
  - `cloudflare-worker/src/services/stagedSigning.ts`;
  - `cloudflare-worker/src/services/reportingDuties.ts`;
  - `cloudflare-worker/src/routes/company_receiving_accounts.ts`, mounted at `/api/closings/company-receiving-accounts` (#3214).
- **Pages:** `frontend/src/pages/closing/`.
- **Decisions:**
  - D1213: the pages;
  - D1215: the record, the acts and the money gates;
  - D1216: the staged paper;
  - D1217: receiving instructions;
  - D1218: the room;
  - D1219: the desk;
  - D1220: this runbook.
- **The map at its date:** `documentation/audits/CLOSING_MAP_2026-10-26.md`.
