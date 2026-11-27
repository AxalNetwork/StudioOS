# Mercury for members: the read-only live checks (D752)

D752 lets members connect their own Mercury account with a **Read Only** token:
- investors on HQ prove capital to Axal's admins;
- founders read their spending and match investors' wires to their raise.

> **Since 2026-10-22 (D879–D883, #2551), the walk-through's way in has changed.**
> - **Members sign in.** A new connection is made only by **Sign in with Mercury**, through Mercury's MCP server (D840, D881). Where a step below says to connect a Read Only token, sign in with the test member's own Mercury instead. A token sent to `POST /connect` now answers 410 `token_connect_retired`.
> - **Axal VC's accounts are not on the connector.** Their four entity accounts are never on `/account/connectors/mercury`, for anyone. They are managed only in HQ › Fund administration › Bank accounts (`/api/admin/mercury`).
> - **What still holds.** The field-name checks and the refusals still apply, including a sign-in to an Axal entity's organization being refused (`mercury_entity_account`).

Every test in the repo stubs Mercury, so four field names and the full flow
have never met a real account. This runbook is for the people who can check
them. It changes nothing. Its only writes are the ones the flow itself makes
when a test member presses its buttons.

**Who can run what.**
- Section 1 is for **S02 or S03**. Only S01 to S03 may reach Axal's own
  Mercury account, and section 1 reads it only.
- Section 2 is for **the owner** (#1008 item 34), with two test members.

**Never** paste a token, an account number, a balance or a real name into an
issue, a pull request, a commit or a chat. The repository is public. Record
only what each step asks for: a field name, present or absent, and a yes or no.

---

## 1. Four field names, against Axal's own account (S02 or S03)

The parser that reads them is `cloudflare-worker/src/services/mercury/parse.ts`.
Each name below is marked UNVERIFIED there. Read the raw JSON of one GET
response, outside StudioOS, with a Read Only token. Never use a token that can
write. StudioOS refuses one anyway (`write_scope_refused`).

| # | Check | Read | Record |
| --- | --- | --- | --- |
| 1.1 | `availableBalance` is the field name for an account's available balance | `GET /api/v1/accounts`: one account object's keys | The exact key, and whether it is in dollars as a JSON number |
| 1.2 | `legalBusinessName` is the organization's legal name | `GET /api/v1/organization` (or wherever the organization object sits): its keys | The exact key, and whether the object sits under `organization` |
| 1.3 | A transaction carries a category | `GET /api/v1/account/{id}/transactions?limit=1`: one transaction's keys | Whether `mercuryCategory` exists; else whether `categoryData.name` exists; else "none" |
| 1.4 | Whether a Mercury Personal account can mint a Read Only token | Mercury's documentation or dashboard, read only | Yes or no |

**If a name differs from the table:**
- `availableBalance` (1.1). Every proof of funds answers 502
  `mercury_unreadable` and never makes a false statement
  (`services/capitalAttestations.ts`). Spending reads cash as Not recorded.
  File a bug naming the real key.
- `legalBusinessName` (1.2). A share answers 502 `holder_unreadable`. File a
  bug naming the real key.
- The category (1.3). Spending lists no categories, and nothing else changes.
  Record the result on #1008 item 34.
- Personal accounts (1.4). If Mercury Personal accounts cannot mint Read Only
  tokens, members connect only from a business organization. Record it on
  #1008 so the connect sheet's words can say so.

---

## 2. The walk-through (the owner)

**You need:**
- **A test investor and a test founder**, each a StudioOS account on HQ.
- **Two Read Only tokens.** Each comes from that member's own Mercury
  organization. **Never use Axal's:** StudioOS refuses a token from an Axal
  entity's organization (`mercury_entity_account`), and that refusal is
  itself step 2.1's second check.
- **An Admin account on HQ**, to read the shared statement.

Record each step as done, or as the exact refusal it showed.

### 2.1 Connect

1. As the test investor on HQ, go to Account › Connectors › Mercury. Connect
   the investor's Read Only token. The card reads in the investor's words:
   proof of funds, never a balance.
2. Try a token from Axal's own organization. It is refused, and nothing is
   stored.
3. As the test founder, connect the founder's token. The card lists revenue,
   spending and raise receipts.

### 2.2 Share a proof of funds (`POST /api/mercury/attestations`)

1. As the test investor, open a pending deal commitment, the Fund I
   application, or the Fund I commitment, and press "Show Axal you can fund this".
2. Pick the checking and savings accounts, an amount at or above $1,000, and
   tick the consent. The sheet shows the consent words before anything is read.
3. Expect a dated statement: "At least $X available at Mercury on <date>, held
   by <organization>…". No balance appears anywhere.
4. Ask for more than the accounts hold. The answer is `balance_below_amount`,
   and it carries no figure.

### 2.3 An admin reads it, audited (`GET /api/admin/capital-attestations`)

1. As the Admin on HQ, open the LP application or the deal's commitments. The
   proof row shows the investor's statement and its state.
2. Confirm that the read wrote one audit row, `capital_attestations_read`,
   with ids and counts only.
3. As the test investor, the statement's view count has gone up by one.
4. On a branch, or in a support session, the same read is refused.

### 2.4 Revoke (`POST /api/mercury/attestations/:uid/revoke`)

1. As the test investor, revoke the statement.
2. As the Admin, the row now reads "Revoked by the investor on <date>", with
   no amount, holder or account count.

### 2.5 Spending, and a save with the confirmation (`/api/revenue/projects/:id/mercury-spend`)

1. As the test founder, open Revenue › Mercury › "Spending from Mercury".
2. Check each month's operating in, financing in (not counted in burn), out
   and net burn. Then check cash now and runway, or "Not burning". A month
   with no posted line reads Not recorded.
3. Press Save without ticking the confirmation. Nothing is sent.
4. Tick it, leaving "Also save my cash on hand" unticked. One metrics row is
   saved for the last full month, badged "From Mercury". Its cash is empty.
5. Try to edit that row's figures. They are locked (`mercury_figure_locked`),
   and only delete is offered.

### 2.6 A raise match (`/api/mercury/personal/matches?target=raise`)

1. Give the test founder a committed raise prospect whose amount equals a
   credit in the founder's Mercury. Use a credit the founder has not imported
   as revenue.
2. On Raise › Capital relationships › "Investor wires", press "Match to my
   Mercury". Confirm the credit.
3. The prospect's stage reads "Committed · received <date>". The same credit
   is now refused by the revenue import as `raise_receipt`.
4. Withdraw the match with a reason of 10 characters or more. The stage goes
   back to Committed.

### 2.7 Disconnect

1. As each test member, disconnect Mercury. The stored token is deleted.
   Delete it in Mercury too.
2. What stays:
   - the investor's statements stay with Axal's admins until revoked;
   - the founder's imported rows, saved figures and matches stay.

---

## 3. Where the result goes

- Post section 1's four answers on #1008 item 34: field names and yes or no
  only.
- Post section 2's step-by-step result there too.
- A step that failed gets its own bug issue, with the refusal code it showed,
  and no figures or names.

The guard that keeps member data away from Eadwyn, MCP, cron and admin paths
is `cloudflare-worker/test/mercury_member_privacy_d752.test.mjs`. It runs on
every PR and needs none of this.
