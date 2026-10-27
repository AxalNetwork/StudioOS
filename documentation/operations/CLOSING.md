# Run a closing, end to end

A **closing** is the step from "the terms are agreed" to "the money is in the
company's account and the cap table says so". This runbook takes one closing
from open to Closed, through the pages built for it: D1213, D1215–D1219 and
D1058. It is the operator's order of work. Each decision file has the full
rules.

**The platform never moves money.** It records paper, routes, evidence and
decisions. Every money figure is integer cents with a currency. Every act
appends one row to `closing_events`, and that row holds no amount, name or
account number. Nothing in this runbook asks for a secret, a bank login or a
token. None belongs in a runbook, an issue or a log.

## Who does what

| Who | Where | What they do |
|---|---|---|
| An Admin | **Contracts › Closings**: `/admin/contracts/closings`, then `/admin/contracts/closings/:dealId` | Opens the closing, prepares and sends the paper, chooses each line's route, withdraws a line, marks Closed |
| The Super Admin | the same closing page | Countersigns for Axal, with a fresh authenticator code |
| The founder | **Raise › Capital relationships › Closing**: `/raise/capital-relationships/closing` | Signs first, then decides the cap-table change |
| An investor | **Deals › [company] › Closing**: `/deals/:dealId/closing` | Signs their line's paper, sends the money, accepts a match from their Mercury |
| An Operating Partner | the deal's closing room | Reads the checklist, transfers and total, marked "Read only". Records no transfer (D1215 §4) |

**A support session is refused every closing write.** Sign in as yourself.

## Before you start

- **The deal has its commitments.** A closing opens with one line per live commitment on the deal. A Raise prospect can be added as a line afterwards.
- **There is no open closing on the deal.** A deal holds at most one open closing (migration 612's partial unique index). The desk lists every open one.
- **The paper has counsel's text.** A document type with no counsel text on file previews as a counsel draft and is never sent (`counsel_draft_only`, D1216 §5). Today that includes the SAFE, until D578's text is on file. Check this before you promise a date.
- **Everyone who signs has an account.** The founder's account comes from the deal, and the investor's from their line. A missing account is named on the paper drawer, and the paper cannot be sent.

## 1. Open the closing

1. Go to **Contracts › Closings** and press **Open a closing**.
2. Choose the deal. Optionally give the round label and the deadline. Then confirm.
3. You land on the closing's page. Its tiles read Lines, Committed, Received and the deadline.

The call is `POST /api/closings`. With no deal chosen, the dialog refuses and writes nothing. A deal that already has an open closing is refused.

**Check:** the desk row shows the closing, its lines, and **Waiting on: Studio team**.

## 2. Prepare and send the paper (CP3)

For each commitment line, press **Prepare paper**:

1. **Choose the paper.** It is one of seven closing papers.
2. **Preview.** The drawer shows the exact text every signer will sign (`POST /api/legal/esign/staged/preview`).
3. **Fill the open fields, then preview again.**
   - Three facts are sourced and say where they came from: the company (the deal), the investor (the line) and the purchase amount (the line's cents).
   - Every other field is typed. Editing a sourced field marks it Typed.
   - **Eadwyn never fills money.** Amount, price, cap, valuation, discount, fee and carry are typed by a person from the deal, the commitment or the cap table (AUTOFILL #2431).
4. **Send for signature,** then confirm in the same dialog (`POST /api/legal/esign/staged`).

**The signing order is fixed by the database.** It is the company first, then the investor, then Axal last. You cannot reorder it. Each stage is emailed to its signer when the stage ahead has signed. The founder and the investor sign on the e-sign page from that email. The rooms show who has signed and whose turn it is, but carry no signing link.

**A Raise prospect line** has no commitment, so it has no paper here.

## 3. Countersign for Axal (CP4)

When every stage ahead has signed, the envelope's Axal stage reads **awaiting release**.

- **The Super Admin** presses **Countersign for Axal** on that line and confirms. The authenticator prompt opens if the session's step-up has lapsed. Then the signing link is shown to the Super Admin alone. It is never logged.
- **An Admin** sees the act's sentence instead of a button.

The call is `POST /api/legal/esign/staged/:uid/countersign`. Its refusals:
- `step_up_required`: sign in again with your authenticator code. Nothing was sent.
- `not_your_turn`: a stage ahead has not signed.
- `no_countersign`: this envelope has no Axal stage.

**Check:** the line's paper reads Signed in every room. The founder's step strip moves past **Sign**.

## 4. Choose each line's route (CP5–CP8)

Press **Choose the route** on each line. Each route needs:

| Route | What it needs | Notes |
|---|---|---|
| Direct | nothing more | The investor pays the company |
| Syndicate | the venture's syndicate, chosen from its list | Stored as `syndicate:<id>`. Its lead and members read the SPV card (CP6) |
| Axal VC fund | the fund | Commit fund money and Record the release have no route yet (D1215 §3). Capital calls are issued in Fund admin |
| Third-party fund | the fund's legal name | StudioOS does not run that fund's calls or hold its money |

- A route with no vehicle (every route but Direct) is refused before anything is sent.
- The call is `PUT /api/closings/:uid/lines/:lineUid/route`.
- **Withdraw** takes a line out of the closing. A withdrawn line stays in the record and the activity.

## 5. Share the payment instructions (CP9)

**Not available through the platform yet.** D1217's receiving-account routes (`/api/closings/company-receiving-accounts`) are built but not mounted on `main`. #3214 is still open for that remainder.

Until they are mounted:
- The investor's **See payment instructions** drawer shows the warning first: call the company on a number you already hold. It then says the instructions are not read here, and that nothing on the page tells anyone where to pay. No account number, mask or reveal is drawn.
- **Never send account details through the platform's comments, notes or issues.** The company gives its instructions to each investor directly, and the investor confirms them by phone on a number they already hold.

## 6. The investor sends the money

The investor pays from their own bank. The platform does not initiate or hold any payment.

- **With Mercury connected,** the investor's room shows their own closing matches (`GET /api/mercury/investor/proposals?kind=closing`). They press **Accept this match?** to record **Sent, not yet confirmed** (D1217). That is the sending side: it never makes a line Received.
- **Without Mercury,** "I have sent it" says the investor's word is recorded only through a match. Ask the investor to tell you directly, and wait for receiving-side evidence (step 7).

## 7. Record the receipt

**A line reads Received only on receiving-side evidence** that has not been withdrawn (D1215 §2, #2424 owner question 4). The evidence kinds are:

| Kind | Side | Source it names |
|---|---|---|
| `company_mercury` | receiving | `mercury:<id>`: the company's Mercury transaction |
| `axal_mercury` | receiving | `mercury:<id>`: an Axal entity's Mercury transaction |
| `phone_verified_record` | receiving | `deal_transfer:<uid>`: an Admin's phone-verified transfer on this deal |
| `bank_confirmation` | receiving | `file:<key>`: an uploaded bank confirmation |
| `investor_mercury` | sending | `mercury:<id>`: reads Sent, never Received |

- A source names a stored record by its id. Free text (a memo, an account number, a name) is refused, and the refusal echoes nothing back.
- **A phone-verified transfer** is recorded by an Admin on the deal (`POST /api/deals/:id/transfers`, the `closing.evidence` act). An Operating Partner is refused: "An Admin records transfers."
- **The evidence route** is `POST /api/closings/:uid/lines/:lineUid/evidence`, the `closing.evidence` act.
  - **No page calls it yet.** The receipt drawer (CP10) lists a line's evidence and its side, but has no "record" control.
  - Until a page records evidence, a line cannot reach Received from the UI. Raise it with S1 on #2424 rather than writing to D1 by hand.
- **To take evidence back,** use `POST /api/closings/:uid/evidence/:evidenceUid/withdraw` with a reason of 10 to 200 characters. The line's status is recomputed in the same batch.

**Check:** Received counts received lines only. A Sent line is not money in the account.

## 8. The founder decides the cap-table change (CP11)

- The proposal is `not_ready` until every line is Received or Withdrawn, with at least one Received. It is then `proposed`.
- **Only the venture's founder decides,** in their closing room: **Add to cap table** or **Dismiss the proposal**. **Not now** writes nothing. An Admin or an investor is told "The founder decides the cap-table change."
- Accepting records the decision only. The holder is written by Raise › Cap table's own path (#2432). Nothing about the cap table is guessed.

## 9. Mark Closed (CP12)

1. On the closing's page, press **Mark Closed**. It is offered only once every line is settled and the founder has decided. Otherwise the page says why, in D1215's words.
2. Confirm. The dialog says nothing changes afterwards, and that reporting duties start.

- The call is `POST /api/closings/:uid/complete`.
- After it, every write on the closing is refused with 409 `closing_not_open`.
- Completing creates the round's reporting duties (`createReportingDuties`, D1058). The founder's room lists the duties on this closing's lines. A term the paper left blank reads "Default, not in the paper".

## Reading the activity (CP15)

The closing's **Activity** drawer lists every event, newest first, with its step: Paper, Route, Receipt, Cap table, Reporting. Filter by step, and export the rows drawn as CSV. Actors read "Account #n", because the log holds no names.

## When something is refused

Every refusal carries a code and a sentence, and says whether anything changed. The common ones:

| Code | Meaning | What to do |
|---|---|---|
| `support_session_refused` | A support session tried to write | Sign in as yourself |
| `closing_open` | The deal already has an open closing | Work on that one: the desk lists it |
| `closing_not_open` | The closing is Closed or cancelled | Nothing changes after Closed |
| `counsel_draft_only` | The paper has no counsel text on file | Wait for counsel's text; do not send a draft |
| `fields_unfilled` | The paper has open fields | Fill them, preview again, then send |
| `step_up_required` | The countersign needs a fresh code | Enter your authenticator code |
| `admin_records_transfers` | An Operating Partner tried to record a transfer | An Admin records it |
| `closings_unreadable` | A read or save failed | Try again. It is not proof that nothing is there |

## What stays unverified until the owner's live check

- A closing run end to end on production, with real paper, a real countersign and a real receipt.
- Migration 612's backfill and triggers, and migration 633's signing-order triggers, on production D1.
- The receiving-account routes (D1217) once they are mounted, with their 30-second reveal and change notice.
- A page that records receiving-side evidence (step 7): until one exists, Received is reached only through the API.
