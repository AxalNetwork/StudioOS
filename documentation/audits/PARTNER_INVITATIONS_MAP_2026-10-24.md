# Partner invitations — what the code serves, board by board (2026-10-24)

**A snapshot, not a spec.** S1 made this map for #2370 on 2026-10-24 to integrate the owner's "Partner
invitations" canvas (PI1–PI12, D923) and to split the rest into slot tasks. The readers worked from the code on
`claude/spinout-lab-workspace-wuyyqd`, at `0b85c2b` and then `fbbb4c8`. Each section names its own commit, and none
of the partner files changed between the two. The map was not checked against production, and nothing here is
maintained afterwards. Re-read the code before you act on a line.

Path short forms: Worker paths are under `cloudflare-worker/src/` and frontend paths under `frontend/src/` unless a
path says otherwise. `dc:` is `design/incoming/Partner Invitations Page.dc.html`. `grid:` and `Boards:` are
`design/incoming/Partner Invitations · Boards.dc.html`.

**Two part numberings.** "P1…P8" below are the parts #2370's body suggested. D923 §6 regroups the work into its
own nine parts (D924–D929 and D950–D952), so cite D923's numbers in a task.

**Settled since.** D923 settles the open conflicts listed in Parts C and E. These are the crumb and the sidebar
row, the Firm links tab, the redirect, the record addresses, the lapse rule, the step-date words and the
agreement-ready rule. Where this map and D923 differ, D923 wins.

The five parts are:
- **A:** the board-by-board gap tables.
- **B:** the Worker reads and writes.
- **C:** the admin page and the shell around it.
- **D:** #2370's defects, re-checked.
- **E:** the completeness critique.

## Part A — the boards against the code

### PI1, PI12 and PI9a–PI9f: what each block draws and what can feed it today

**Tree.** The branch is `claude/spinout-lab-workspace-wuyyqd`. The work order named `0b85c2b`, but the branch is now at `99466ce`: one D894 commit (`0296848`), then the D915 Events desk. `git diff --name-only 0b85c2b HEAD` lists no partner file, Worker file or migration. `fe/App.jsx` gained four lines after `:2835` (the Events routes). So every `App.jsx` cite above `:2835` reads the same at both commits. The one below it, `fe/App.jsx:2852`, was `:2848` at `0b85c2b`. `D915.md` also changed, at `:3` and `:121-126`. Its cites below (`:56-60`, `:70`) are the same at both commits; `:171` was `:165`. I only read: nothing was written, staged or checked out.

**Prefixes.** `wk/` = `cloudflare-worker/src/`, `fe/` = `frontend/src/`, `mig/` = `cloudflare-worker/sql/migrations/`, `dc:` = `design/incoming/Partner Invitations Page.dc.html`, `Boards:` = `design/incoming/Partner Invitations · Boards.dc.html`, `base:` = `cloudflare-worker/sql/schema_baseline.sql`. Bracketed canvas values are samples. I never read them as data.

**Notation.** **E** = exists, **P** = partly, **N** = does not exist, **W** = would give a wrong figure today.

**How the boards are built.**
- PI1 and PI12 are the same board: `if (B === 'PI1' || B === 'PI12') { page('Overview'); cols = overCols(); }` (`dc:463`). PI12 only switches the colours (`dark = B === 'PI12'`, `dc:213`; dark palette `dc:216`).
- The Overview layout is `overCols` (`dc:456`): tiles T1, tiles T2, Needs you, then C1–C4 in a 2×2 grid.
- PI9a–PI9f are cropped frames with no shell (`dc:214`, `:469`, `:476-481`).
- Board captions: `Boards:45` (PI1), `Boards:53` (PI9), `Boards:56` (PI12).
- The production tables match migration 028: `base:3221-3241` (`partner_deals`) and `base:3262-3282` (`partner_invitations`) carry the same columns as `mig/028_partner_deals.sql:9-29`, `:55-75`. No later migration alters either table. I grepped `mig/` for both names, and `wk/` and `mig/` for `ALTER TABLE partner_`.

#### Two rules every row below relies on

**Guard L (cut lists).** Every partner read here fails truthfully. There is no try/catch, so a D1 error is a 5xx. The DD and template reads use try/finally or an explicit 503 (`wk/routes/dd.ts:131-151`; `wk/routes/esign.ts:975`). `getSQL` throws too (`wk/db.ts:14-29`). But every list is cut short, with no total and no offset:
- invitations: newest 200 (`wk/routes/admin_partners.ts:114`, response `:122`)
- deals: 200 per status (`:306`). `status=all` matches nothing, because the value is bound literally (`:295`, `:305`).
- top deals: at most 50 (`:217`)
- redemptions per deal: 500 (`:261`, count `:288`)
- firm accounts and firms: 500 each (`:541`, `:551`)
- DD cases: 200 (`wk/routes/dd.ts:146`)

There is no client paging: the invitations and deals routes take no offset (`admin_partners.ts:99-104`, `:295`).

- **Every cut is newest-first.** Invitations and deals sort by `created_at DESC` (`:114`, `:306`), redemptions by `redeemed_at DESC` (`:261`), DD cases by `created_at DESC` (`dd.ts:146`). So the oldest rows are dropped first. The figures built on old rows go wrong first: "oldest sent", Lapsed, all-time Signed, the median, and rev-share windows near day 365.
- **A per-status call lifts the invitations cap to 200 per status** (`admin_partners.ts:103`). That is the same move as the deals lists. Lapsed cannot be filtered on the server, because `is_expired` is computed after the query (`:120`).
- **The rule: a figure is exact only while its list returned fewer rows than its cap.** At the cap it reads "Counted over the newest 200 only", never a total.
- **Nothing measures how far below the cap production is today.** The last counts are zero invitations on 2026-09-21 (`mig/275_partner_profiles_columns.sql:17`, `:49`, `:54-55`) and 26 partner accounts on 2026-09-07 (`admin_partners.ts:513-514`). The page tests the cap on every read; it does not rely on these dates.

**Guard F (fan-out, the Guard-G-like rule).**
- No aggregate redemptions read exists. Any figure summed over `GET /deals/:id/redemptions` is one call per deal. If any call fails, the figure is "Could not be read", never a partial sum.
- Codes are redeemable only while a deal is `active` (`wk/services/partnerDeals.ts:489`). A deal past its term is flipped to `expired` on the attempt (`:494-502`). So only `active`, `terminated` and `expired` deals can hold redemptions.
- **Which deals to fan out over:** the ones whose `redemptions_count > 0`. That count is an uncapped `COUNT(*)` (`admin_partners.ts:302`, also `:225`).
  - `GET /deals/top?status=all&limit=50` ranks every deal in every state by that count, in one call (`:215-232`, `all` handled at `:219-220`, order `:229`).
  - While it returns fewer than 50 rows, or its 50th row has 0, it is the complete set of deals with redemptions, and Σ `redemptions_count` over it is exact. The three status lists are the fallback.
- **The 500 cut is newest-first** (`:261`).
  - A windowed count (90 days, 12 weeks) stays exact while a deal's 500th row is older than the window. Compare `items.length` to that deal's uncapped `redemptions_count` to tell.
  - "Rev-share windows closing within 30 days" is the opposite case. Those are redemptions 335–364 days old, the last rows of the list, so they are the first cut. A deal at 500 rows makes that figure "Not counted past the newest 500".
- The precedent is D915's Guard G (`documentation/architecture/decisions/D915.md:56-60`). The difference: here the Worker hides nothing; the page's own catches do.
  - Today's page swallows the top-deals failure (`fe/pages/admin/PartnerInvitations.jsx:80`).
  - Its list failures become "No invitations yet." (`:69-71`, `:209-210`) and "No {status} deals." (`:84-86`, `:345-346`).
  - The redeemers modal turns a failure into "No redemptions yet." (`:882`, `:917-918`).

**Stage words.** Canvas words map to `partner_invitations.status` (`mig/028_partner_deals.sql:18`): Sent=`sent`, Opened=`viewed`, Profile done=`profiled`, Offers shown=`proposed`, Offer chosen=`selected`, Agreement out=`finalized`, Signed=`signed`, Revoked=`revoked`.
- **Lapsed** = `is_expired` (`admin_partners.ts:120`) and the status is neither `signed` nor `revoked`, or the status is `expired`.
  - Only activation writes `expired` (`partnerDeals.ts:229-231`), when an agreement is signed after the link lapsed. So an `expired` row reached Agreement out and was signed late.
- **Resend resets any open stage to `sent`** (`admin_partners.ts:137-139`). It leaves `viewed_at` and the deal row untouched.
  - After a resend, a deal row overrides the stage: `awaiting_signature` means Agreement out, `proposed` means at least Offer chosen.
- **The last send is derivable.** Create and resend both set `expires_at` to now + 14 days (`INVITE_TTL_DAYS`, `:34`; `:67`, `:136`), so the last send is `expires_at − 14 days`. A row was resent when that is later than `created_at` by more than a few seconds.
  - This is a second definition tied to one constant in the same file. Any change to `:34` must change it too. It is enough to **flag** resent rows instead of drawing them wrong.

---

#### PI1 · Overview (desktop 1440)

| Block (dc line) | What it draws | Worker source today | Owner / dependency | Now / placeholder |
|---|---|---|---|---|
| Crumb (`dc:460`) | "Community › Partner invitations", linked to `/admin/community` | — (shell). `/admin/community` is not a route. The Community landing is `/admin/held/community` (`fe/App.jsx:2726`; sidebar `fe/sidebarConfig.js:230`). No `path="/admin/community"` exists in App.jsx (grep). | Placement: Community vs Approvals is #2390's call, with #2375's placement map | **NOW**, linking `/admin/held/community` as D915 did (`fe/pages/admin/events/eventsDeskModel.js:43-44`; `fe/pages/admin/AdminEventsPage.jsx:81`). The canvas href is a dead link. |
| h1 + line (`dc:460`) | "Partner invitations"; "Bring operating partners in, see where each invitee stands, and keep their deals healthy." | — | — | **NOW**. It replaces today's "Partner Invitations" and its line (`PartnerInvitations.jsx:126-131`). |
| New invitation button (`dc:462`) | Violet, desktop only | **E** `POST /invitations` (`admin_partners.ts:48-95`) | PI4 integration | **NOW** |
| Tab bar (`dc:461`) | Overview / Invitations / Deals / Referrals, linked to `/admin/partner-invitations{,/invitations,/deals,/referrals}` | — None of these routes exists. A grep of `fe/` and `wk/` for `partner-invitations` finds only the rail note. The page is at `/admin/partners` (`fe/App.jsx:2701`). | #2375 (moved-notice pattern, placement, rail rows); redirect counted for #2319 | **NOW** as an integration task: routes, redirect, rail key `fe/lib/railPages.js:290`, rail row S31 `fe/lib/railOptions/admin.js:73`. |
| Tab count · Overview "[10]" amber (`dc:461`, amber via `w`, `:511`) | Count of Needs you rows | **P** Same as the Needs you total below | #2370 split 1 (delivery) and split 4 (agreement-ready signal); not filed, and the issue has 0 comments | **NOW with a caveat**: a floor, never a total, while the Not-delivered and Agreement-blocked kinds cannot be counted. Say so on hover. |
| Tab count · Invitations "[42]" (`dc:461`) | Every invitation | **P** `GET /invitations` length (`admin_partners.ts:114`); no total (`:122`) | #2370 split 2 (server paging) | **NOW** under Guard L. At 200 it reads "200+". |
| Tab count · Deals "[19]" (`dc:461`) | Deals in all six states (the Deals board counts voided too, `dc:443`; C3 foot `dc:370`) | **P** Six `GET /deals?status=` calls (`:295`, `:305`), because `all` returns nothing. Alternative: `GET /api/admin/contracts/partner-deals` reads every deal with no cap and returns `total` (`wk/routes/admin_contracts.ts:1187-1220`). It is truthful (503 at `:1211`), but under recovery cool-off (`wk/index.ts:655`). | #2370 split 2 | **NOW** as the sum of the six lists, under Guard L. **W** if it uses only the active list, as today's tab does (`PartnerInvitations.jsx:145`). |
| Tab count · Referrals "[64]" (`dc:461`) | All-time redemptions | **E/P** Σ `redemptions_count` (uncapped per deal, `admin_partners.ts:302`) over deal lists that are themselves capped at 200 per status (`:306`). Better: Σ over `GET /deals/top?status=all&limit=50` (`:215-232`), exact while fewer than 50 deals have a redemption. | — | **NOW under Guard L** (or the top-deals test in Guard F). Not uncapped. |
| Sidebar "Community" lit (`dc:489-490`) | Shell row | — The homes disagree today. The sidebar's Approvals row `match` holds `/admin/partners` (`fe/sidebarConfig.js:226-227`), and the placement map calls it an Approvals lane (`fe/lib/adminPlacement.js:84`; lane 13 at `fe/pages/admin/HeldApprovals.jsx:95`). The rail map already files it under Community (`fe/lib/railPages.js:290`; `fe/lib/railOptions/admin.js:73`). Community's `match` holds only events, jobs and circles (`fe/sidebarConfig.js:230`). The canvas's sidebar hrefs are `/admin/` + label (`dc:490`), not the real rows. | #2390 / owner decision | Waits for the owner's choice of row. The canvas and the rail map already agree on Community. |
| Top bar: badge "HQ-held · axal.vc" (`dc:502`), search, bell (`dc:500-503`) | Shell | — The shell already draws the badge (`fe/App.jsx:1322-1329`), the notification bell (`:1355`) and the command palette (`:1448`) | — | **NOW** (nothing to build) |
| Eadwyn spine (`dc:516`) | Rail note | — The frame's note matches word for word (`PartnerInvitations.jsx:971`) | Rail row S31 (#1874) follows the route | **NOW** |
| T1 · Open invitations "[9]" · "oldest sent [12 Oct]" (`dc:353`) | Count still open; oldest send date | **E** `GET /invitations`: status in sent, viewed, profiled, proposed, selected or finalized, and `!is_expired` (`admin_partners.ts:107-110`, `:120`); min `created_at` | — | **NOW with a caveat**: under Guard L. "Oldest sent" is exactly the figure the newest-first cut drops. "Sent" is the first send: resend never moves `created_at`, only `expires_at` (`:136-139`). |
| T1 · Lapsed, not closed "[3]" · "link expired before signing" · "! Needs you" (`dc:353`) | Lapsed and still open | **E** `is_expired`, status not signed or revoked, or status `expired` (`:120`; `partnerDeals.ts:229-231`) | Owner: the canvas defines Lapsed two ways (see C1 closed) | **NOW** (Guard L; lapsed rows are old, so they are cut first). The Worker agrees with this tile: a lapsed invitation is not closed. Resend reopens it (`admin_partners.ts:132-139`), and its envelope stays signable until activation voids it (`partnerDeals.ts:226-238`). |
| T1 · Signed, last 90 days "[4]" (`dc:353`) | Signed count | **E** `signed_at` in the list (`admin_partners.ts:108`), written at activation (`partnerDeals.ts:340-345`) | — | **NOW** (Guard L). `signed_at` is zone-less `CURRENT_TIMESTAMP`: parse it as UTC. |
| T1 · Days from sent to signed, median, "over the last [7] signed" (`dc:353`) | Median of `signed_at − created_at` | **E** Both are in the list (`admin_partners.ts:108`); both are zone-less UTC (`mig/028_partner_deals.sql:28`; `partnerDeals.ts:342`) | — | **NOW with a caveat**: Guard L (old signed rows are cut first). Measured from the first send. With no signed rows it reads "None signed yet", never 0. |
| T2 · Active deals "[11]" · "[2] end within 30 days" (`dc:354`) | Active count; those ending within 30 days | **E** `GET /deals?status=active` with `expires_at` (`admin_partners.ts:299-300`); uncapped alternative under cool-off (`admin_contracts.ts:1187-1220`) | — | **NOW with a caveat**: Guard L (200 active). A deal past `expires_at` stays `active` until the 04:40 UTC sweep (`wk/index.ts:2319-2323`; query `partnerDeals.ts:565-571`). Read it as "Term over, not yet closed", never as negative days. A "month" is 30 days (`partnerDeals.ts:304-305`). |
| T2 · Awaiting signature "[2]" (`dc:354`) | Agreements out | **E** `GET /deals?status=awaiting_signature` | #2370 split 1 (lapse sweep) | **NOW with a caveat**: subtract or flag deals whose invitation has lapsed, by joining `invitation_id` (`admin_partners.ts:297`) to the invitations list. A signature on those is voided at activation (`partnerDeals.ts:226-238`), and nothing else voids them: the only void writes are `admin_partners.ts:177` and `partnerDeals.ts:220`, `:233`. A deal whose invitation is not among the loaded 200 reads "Invitation not in this read". **W** without the join. |
| T2 · Referral redemptions, 90 days "[27]" (`dc:354`) | Redemptions in the last 90 days | **P** Fan out `GET /deals/:id/redemptions` → `redeemed_at` (`admin_partners.ts:254-261`). There is no aggregate. | #2370 split 4 (cross-deal redemptions read) | **NOW under Guard F**, or wait for split 4. Exact per deal while its 500th row is older than 90 days. |
| T2 · Emails not delivered "[1]" · "NEW · last 30 days" (`dc:354`) | Undelivered invitation emails | **N** on the invitation: no column (`mig/028_partner_deals.sql:9-29`). `email_sent` is in the create and resend responses (`admin_partners.ts:91-94`, `:150`). It is also written, best-effort, into `activity_logs` and `admin_audit_log` (`:86-89`, `:147-149`; `wk/services/adminAudit.ts:95-113`). The only generic reader of those rows, HQ's governance feed, reads `reason` and nothing else (`wk/routes/admin_security.ts:497-503`, `:548-554`, 60 rows `:425`). A grep of `wk/` and `fe/` for each action name finds only its writer. **The canvas word claims more than any store can hold:** `email_sent` is true when Gmail's send endpoint answered 2xx (`wk/services/email.ts:426-437`), and false when the address is suppressed or mail is not set up (`:366-370`). No bounce is tied to an invitation. | #2370 split 1 (store the send result) | **Not recorded**: "Delivery is not stored on the invitation yet." Never 0. After split 1 the honest words are "Sent / Not sent", as PI4n's own copy says ("The email was not sent", `dc:410`), not "Delivered / Not delivered". |
| Needs you · header "[10]" and footer "Showing 7 of [10] · Show all" (`dc:357`, `:364`) | Total of admin-owed rows | **P** The sum of the kinds below | — | **NOW with a caveat**: a floor, with a foot line "Undelivered emails and blocked agreements are not checked here yet." **W** if shown as complete. |
| Needs you · Lapsed → Resend (`dc:358`) | "…lapsed on [14 Oct] at Offer chosen." | **E** The lapsed rule; the date is `expires_at`; the stage is `status` | #2370 split 1 (resend keeps the stage) | Row **NOW with a caveat**: "at <stage>" is the stage since the last resend. Flag a resent row (last send from `expires_at − 14 days`). An `expired` row reached Agreement out. **The Resend action is W** against PI8a's promise "Her progress stays at Offer chosen" (`dc:411`), because the Worker resets the stage (`admin_partners.ts:138`). Do not draw that sentence until split 1 lands. |
| Needs you · Agreement blocked → Open in Contracts (`dc:359`) | "…chose an offer, but the agreement could not be sent: the Partner Services agreement is not ready." | **N per invitation.** Invitation `selected` plus deal `proposed` cannot tell "refused" from "not yet clicked" (`wk/routes/partner_onboarding.ts:297-299`). Only the unfilled-fields refusal writes a row (`partner_envelope_refused`, `:363-365`), and nothing reads it (grep of the action name). The no-body or unreadable refusal writes nothing (`:367-368`). | #2370 split 4 (agreement-ready signal) or split 3 (invitation detail read); the template is Contracts' | **Do not draw the past-tense causal sentence** until the Worker records the refusal. A true weaker row is buildable now from the list plus `GET /deals?status=proposed` (needed after a resend): "…chose an offer; the agreement has not gone out." Once 9e's probe answers "not ready", a present-tense cause is also true for every such row: "…cannot go out until the Partner Services agreement is completed." The link target exists: `/admin/contracts?tab=templates` (`fe/App.jsx:2772`; `fe/pages/admin/contracts/ContractsDesk.jsx:18`, `:24`). |
| Needs you · Not delivered → Copy link (`dc:360`) | "The invitation to … was not delivered." NEW | **N** Same as the T2 tile | #2370 split 1 | **Not recorded**: leave the kind out until split 1 lands (the foot line covers it). Its wording becomes "was not sent". |
| Needs you · Term ending → Open deal (`dc:361`) | "The Services partnership with [firm] ends on [14 Nov]." | **E** for the deal and its date (`GET /deals?status=active`). **P** for the firm name. The deal joins only `users.name`/`email` (`admin_partners.ts:301`, `:304`). `GET /links` has `firm_name` (`:535-536`, 500 cap), but lists only `role = 'partner'` accounts (`:539`). A member who signs keeps their own role (`partnerDeals.ts:256-258`), so they are not in `/links`. | #2370 split 4 (deal detail read) | **NOW** with the partner's own name; the firm name is a caveat. "Open deal" opens PI6 from the loaded list. The only single-deal read is the summary in `GET /deals/:id/redemptions` (`admin_partners.ts:244-251`, `:280-286`): no `activated_at`, `term_months`, `termination_reason` or `invitation_id`. |
| Needs you · Due diligence → Open in Due diligence (`dc:362`) | "…signed on [2 Oct]. Due diligence is open, with KYB waiting." | **P** Case: `GET /api/dd/cases?subject_type=partner` (`wk/routes/dd.ts:124-152`), matched on `subject_id = deal.user_id` (activation insert `partnerDeals.ts:368-371`). It is truthful (try/finally, no catch, `dd.ts:131-151`), but has no `subject_id` filter and stops at 200 (`:146`). KYB needs one `GET /dd/cases/:uid` per case (`dd.ts:244`; section `kyb_entity`, `wk/services/dueDiligence.ts:51`). For an admin that returns the full case with decrypted findings and PII (`dd.ts:249-250`), for one pill. All of `/api/dd` is under cool-off (`wk/index.ts:660`). | #2385 (DD page); link `/admin/due-diligence/:uid` exists (`fe/App.jsx:2852`) | **NOW with a caveat** for "Due diligence is open" (`status IN ('open','in_review')`, `base:1244`). "with KYB waiting" needs one full-case read per open case: skip it from the overview ("Not read here yet"), as D915 skipped the roster read (`D915.md:61-63`). A cool-off refusal reads "Could not be read". A signed partner with no case may be a failed insert (`partnerDeals.ts:389`): say "No case found", not "Cleared". |
| Needs you · Firms → Open in Advisors & Partners (`dc:363`) | "[18] partner accounts are not attached to a firm." | **E** `GET /links` `unattached` (`admin_partners.ts:558`), over at most 500 role-`partner` accounts (`:539-541`) | **#2369** (Advisors & Partners; no canvas in `design/incoming/`) | Count **NOW** (Guard L). **The row overstates what needs the admin.** Today's page says most unattached accounts attach themselves on their next sign-in, and only one that belongs to a firm under another address needs a hand join (`PartnerInvitations.jsx:469-474`, `:549-554`). Word it as a count, not a task. The target **waits for #2369**; until then, link the retained Firm links view (owner decision). `/admin?tab=network-profiles` has no firm tool (`fe/pages/admin/AdminNetworkProfiles.jsx`: no `firm` or `partner_id`). |
| Needs you · Rev-share → Open Referrals (`dc:364`) | "[3] rev-share windows close within 30 days." | **P** Fan out over `deal_sourcing_revshare` deals → `revshare_window_remaining_days` in 1..30 (`admin_partners.ts:264-276`) | Owner decision on termination; #2370 split 4. The window is computed whatever the deal's state (`:264-276`). The 30/7/1-day warning cron also ignores the deal's state (`partnerDeals.ts:766-772`), so today's code consistently keeps a window open after termination. | **NOW under Guard F**, once the owner decides. These are a deal's oldest redemptions, so a deal at 500 rows makes the figure "Not counted past the newest 500". The target tab address does not exist yet (tab bar row). |
| C1 · Where open invitations stand: one bar per stage, "[n] · oldest [d] days" (`dc:365-366`) | Open count per stage | **E/P** Counts per `status` from the list. Time in stage is **partly** stored: <br>• Opened: `viewed_at` is written with the move to `viewed` (`partner_onboarding.ts:106-109`). <br>• Offer chosen: the deal's `created_at` is written when the offer is first chosen (`:287-294`; `mig/028_partner_deals.sql:74`), and returned by `GET /deals` (`admin_partners.ts:300`). <br>• Sent since the last send: `expires_at − 14 days` (derived). <br>• Profile done, Offers shown: nothing (`partner_onboarding.ts:204-206`, `:226-228`). <br>• Agreement out: only on the envelope (`base:1821`), with no read here. | #2370 split 1 (stage dates; resend keeps the stage) | **NOW with a caveat**: label every bar "oldest sent [d] days ago" (one meaning across bars), and apply the deal-overrides-stage rule. Flag resent rows rather than leave them **W**: without a deal, they read Sent/Opened after reaching Profile done or Offers shown. Guard L. Production's resend history is not measured: the zero-invitation count dates from 2026-09-21. |
| C1 · "Closed: Signed [7] · Lapsed [3] · Revoked [2]" and caption (`dc:366`) | Closed counts | **E** From the list | Owner: the canvas files Lapsed under "Closed" here but calls it "not closed" in T1 (`dc:353`) | **NOW** under Guard L (all-time Signed is cut first). The caption "How far a lapsed or revoked one got is not recorded" is only partly true. <br>• Revoked: the status is overwritten (`admin_partners.ts:159-161`), but `viewed_at`, `envelope_id` and the voided deal survive (`:107-109`; void `:177`). Opened, Offer chosen and Agreement out are recoverable; Profile done and Offers shown are not. <br>• Lapsed: the row keeps its stage unless resent; an `expired` row reached Agreement out. <br>Say "How far it got is partly recorded." Draw Lapsed as its own group, matching T1 and the Worker. |
| C1 · bar opens Invitations at that stage (`dc:366`) | Link | **P** The server has one exact `status` filter (`admin_partners.ts:103`). But a stage is not a status: lapsed rows share the status, and the deal can override it. | — | **NOW** (needs the `/invitations` tab address). Filter the loaded list in the browser with the same stage rule as the bar, or the bar's count and the rows will differ. |
| C2 · Invitations per week, Sent vs Signed, 12 weeks, current week hatched (`dc:367`, weeks `dc:341`, grouped bars `dc:346`) | Weekly counts | **E** `created_at` and `signed_at` bucketed in the browser, as UTC | — | **NOW with a caveat**: Sent is complete when the oldest loaded `created_at` is before the window. Signed is complete only below the cap. Below the cap, a week with nothing is a true 0. Chart part: `Columns` stacks via `parts` (`fe/pages/admin/insights/InsightsCharts.jsx:111`, `:149-160`) but does not group, and its hatch is violet only (`:147-148`). Grouped columns need a variant with one hatch per series. |
| C3 · Deals by type and state, stacked bars + legend counts (`dc:368-370`) | Count per type × {Active, Awaiting signature, Offer chosen not sent, Ended = term over, terminated, voided} | **E/P** Six `GET /deals?status=` lists (`proposed`, `awaiting_signature`, `active`, `terminated`, `expired`, `voided`). Uncapped alternative for the counts: `GET /api/admin/contracts/partner-deals?status=&deal_type=&limit=1` → `total` (`admin_contracts.ts:1213-1220`), under cool-off and with no `invitation_id`. | #2370 split 1 (lapse sweep) | **NOW with a caveat**: Guard L per status. **W** for "Offer chosen, not sent" and "Awaiting signature" without the lapsed-invitation join: a lapsed invitation's `proposed` deal stays `proposed` forever (void writes only at `admin_partners.ts:177`, `partnerDeals.ts:220`, `:233`). An `active` deal past its term before the sweep counts as "Term over" (Ended), not Active. There is no horizontal stacked part: `Bar100` is percentage only (`InsightsCharts.jsx:236`). |
| C3 · segment opens Deals with that type and state (`dc:370` foot) | Link | — | — | **NOW** once the Deals tab address and its type and state filters exist (filters drawn at `dc:443`) |
| C4 · Referral redemptions per week, "NEW AGGREGATE", two lines (`dc:371`) | Weekly redemptions by `attribution_kind` | **P** Fan out; `redeemed_at` and `attribution_kind` (`admin_partners.ts:255-256`; the kind follows the deal type, `partnerDeals.ts:530`) | #2370 split 4 | **NOW under Guard F**. `WeekLine` draws one violet series plus a dotted `previous` (`InsightsCharts.jsx:178`, `:217`). It marks the current week with a dashed last segment (`:177`, `:221`), which clashes with the canvas's dashed rev-share series. A two-series part must keep the dash for series identity and use only the hollow point for the current week. |
| "View as table" toggles (`dc:366-371`; `TOGV` `dc:325`) | Table view per chart | — | — | **NOW** (`ChartTable`, `InsightsCharts.jsx:307`) |

#### PI12 · Overview, dark (desktop 1440)

PI12 needs no data beyond PI1: every PI1 row holds, with the same caveats (`dc:463`).

| Block (dc line) | What it draws | Source | Owner | Now / placeholder |
|---|---|---|---|---|
| Ground, cards, text, hairlines (`dc:216`) | Dark tokens: #0b1220 page, #111827 card, #374151 hairline | — `scripts/check-dark-mode.mjs` scans literal `className` under `pages/` and `components/` (`:29-35`) | — | **NOW**: literal `dark:` pairs |
| Chart series (`dc:219`, `c.vi` = #a78bfa in dark) | Violet becomes #a78bfa; sky, amber, emerald and muted stay the same | — `InsightsCharts.jsx:18-35` already pairs violet with `dark:fill-[#a78bfa]` and `dark:stroke-[#a78bfa]` | D915: reuse D893's parts, and move shared ones to `fe/ui/` in their own commit (`D915.md:171`) | **NOW** |
| Amber flags and tab pill (`dc:216`, `:511`) | Amber text #fcd34d on rgba fill | — | — | **NOW** |
| Every data block | Same as PI1 | Same as PI1 | Same as PI1 | Same as PI1 |

#### PI9 · States

| Block (dc line) | What it draws | Worker source today | Owner / dependency | Now / placeholder |
|---|---|---|---|---|
| 9a · Tiles in loading (`dc:476`) | Both tile rows, each value a skeleton bar with "Reading…" | — | — | **NOW**, one loading state per block, so a slow deal read does not hold the invitation tiles. **Except "Emails not delivered"**: nothing is read for it, so it shows Not recorded at once, never "Reading…". |
| 9a · Skeleton cards (`dc:476`; `sk`, `dc:274-275`) | Two cards titled "Reading…" with 5 and 4 bars | — | — | **NOW** |
| 9b · First use (`dc:477`; `CENTER`, `dc:276`) | "No partner invitations yet." · "Invite an operating partner to start. They answer a short profile, choose an offer, and sign." · New invitation | **E** `GET /invitations` → `items: []` is truthful, because a failure is a 5xx (`admin_partners.ts:106-122`) | — | **NOW**, only when the read **succeeded**, with no filter set, and returned 0 rows. Production had zero invitations at the last count, on 2026-09-21 (`mig/275:17`, `:49`), so this is likely what admins see first. |
| 9c · T1 tiles beside a failed list (`dc:478`) | T1 still drawn; foot "The tiles and charts still draw." | **W as drawn**: all four T1 tiles come from the same invitations read | #2370 split 3 (overview read with its own `available`) | **Could not be read**. When the invitations read fails, these say so too: T1, C1, C2, the Lapsed rows and the weaker Agreement-blocked row. Also these, which need the invitations join: T2 Awaiting signature, and C3's Awaiting and Offer-chosen segments. They draw their counts with "Lapsed invitations could not be checked". What still draws untouched: T2 Active and Referrals 90 days, C3's Active and Ended, C4, and the Term-ending, DD, Firms and Rev-share rows. |
| 9c · Invitations block "Unreadable. The invitations could not be read." · Try again; foot "A failed list never says No invitations yet." (`dc:478`) | Failed block | **E** a truthful 5xx | — | **NOW** with `Unreadable({what, claim, onRetry})` (`fe/ui/Honesty.jsx:62`, exported at `fe/ui/index.js:87`). It replaces today's toast and false empty table (`PartnerInvitations.jsx:69-71`, `:209-210`). |
| 9d · Progress: Sent, Opened dates (`dc:479`; `STEPD`, `dc:384-385`) | Dates for two steps | **E** `created_at`, `viewed_at` (`admin_partners.ts:108`) | #2370 split 1 | **NOW with a caveat**. Sent is the first send; flag a resend (`expires_at − 14 days`). Opened is the latest open. Resend sets `sent` without clearing `viewed_at` (`:138`), and the next open overwrites it (`partner_onboarding.ts:106-109`). So a resent, not-yet-reopened row has an Opened date while its stage reads Sent: show "Opened [d], before the resend". |
| 9d · Profile done, Offers shown, Offer chosen: "Date not recorded" + NEW (`dc:384-385`) | Three steps with no date | **N on the invitation**: these writes change only its status (`partner_onboarding.ts:204-206`, `:226-228`, `:297-299`). Best-effort `activity_logs` rows (`:91-98`) have no reader. But two dates are stored elsewhere: <br>• **Offer chosen: E.** The deal's `created_at` is set when the offer is first chosen (`:287-294`; `base:3240`) and is in `GET /deals` (`admin_partners.ts:300`, joined on `invitation_id` `:297`). A re-choice updates that row without moving it (`partner_onboarding.ts:276-285`). <br>• **Profile done: P.** The profile's `updated_at` is its latest save (`:196`; `base:3313`), reachable only through the logged per-email read (row "Their answers"). <br>• **Offers shown: N.** | #2370 split 1 (stage dates) | **Offer chosen NOW**, from the loaded deals: "first chosen [d]". Profile done is **Not read here yet**. Offers shown is **Not recorded**, with the reason "Stage dates are not stored on the invitation yet." Do not read the audit rows: a re-save or re-choice writes them again. |
| 9d · Agreement out, Signed: "Not reached" (`dc:384-385`) | Steps after the current one | **E** from `status` | — | **NOW**. Once reached: Agreement out has no date on the invitation (`partner_onboarding.ts:376-378`). The envelope's `created_at` holds it (`base:1821`; envelope id on both rows, `:374-378`), and no partner read returns it, so it reads "Not read here yet". Signed has `signed_at`. |
| 9d · "Link valid until [28 Oct]" (`dc:385`) | Expiry | **E** `expires_at` (`admin_partners.ts:108`) | — | **NOW** |
| 9d · Email · older rows: "Not recorded" ×2, one "Not delivered" pill (`dc:479`) | Delivery column | **N** There is no delivery column (`mig/028_partner_deals.sql:9-29`), so today **every** row is "Not recorded", Ivo Mock's included. Even after split 1, the store can only hold "sent / not sent" (`email.ts:426-437`). | #2370 split 1 | **Not recorded**: "Invitations sent before delivery was recorded say Not recorded." The pill waits for split 1, and reads "Not sent". |
| 9d · Their answers · "No answers yet." NEW READ (`dc:479`) | The answer card, empty | **P** `GET /api/profiling/admin/:email` (`wk/routes/profiling.ts:498-521`). It is keyed by **email**. It writes a `partner_profile_access` row on every read that finds a profile (`:516`); a 404 "Profile not found" returns before the write (`:509`). A found row must be checked to carry this `invitation_id`, because the email row may hold an earlier, unrelated profile (`partner_onboarding.ts:168-176`). Deriving the state from `status ∈ {sent, viewed}` is **W** after a resend. | #2380 (profiles); #2370 split 3 (invitation detail read) | Waits for split 3. Until then, **Not read here yet**. Do not call the logged read from a list view. |
| 9e · Agreement-not-ready banner on Overview + Open in Contracts (`dc:480`; `BAN`, `dc:458`) | "The Partner Services agreement is not ready. Invitees who choose an offer cannot sign until it is completed in Contracts." | **P** Probe `GET /api/legal/esign/templates/partner_services` (`wk/routes/esign.ts:963-999`); admins may read it (`wk/services/esignOriginators.ts:115-127`). <br>• It marks `filled_by:'sender'` for every key outside `AUTO_MERGE_KEYS` (`esign.ts:989`; set `:261-262`). <br>• Finalize also fills `partner_name`, `partner_email`, `deal_type` and `term_months` (`partner_onboarding.ts:351-357`; `effective_date` is already auto). It then refuses on any token left (`esign.ts:519-522`). <br>• The probe and finalize share one body lookup (`esign.ts:237-249`). <br>So "not ready" means: a 409 `template_has_no_body` (`:979-984`), **or** a sender key outside finalize's set. The probe's own 503 `template_unreadable` (`:975`) means "Could not be read", not "not ready". `/api/legal/esign` is under cool-off (`wk/index.ts:654`). | #2370 split 4 (agreement-ready signal) | **Waits for split 4**. **NOW with a caveat** only if the page copies finalize's key list, a second definition that will drift. The banner also needs `role="status"`: the canvas's `BAN` is a plain row (`dc:458`). The link `/admin/contracts?tab=templates` exists. T1 below it is as PI1. |
| 9f · Moved notice + Dismiss (`dc:481`; `MOVED`, `dc:272`) | "Partner invitations has a new address. Update your bookmark." | — client-side. Pattern: `HeldInsightsRedirect` keeps the query and hash and adds `?moved=` (`fe/pages/admin/insights/HeldInsightsRedirect.jsx:12-17`; `insightsModel.js:23-25`), counted in `wk/services/redirectRoutes.ts:137` | #2375 (pattern); #2319 (retirement) | **NOW**. Mark the redirect `keep` (`redirectRoutes.ts:22`, `:28`). The daily rev-share digest emails admins "Admin panel: /admin/partners" (`partnerDeals.ts:876`). |
| 9f · Invitations search "zz" → "No invitation matches ‘zz’." · Clear the search (`dc:481`; `EMPTYROW`, `dc:459`) | No match | **P** The server matches email substring only, with an unescaped LIKE (`admin_partners.ts:104`); name is client-side | #2370 split 2 | **NOW with a caveat**: search the loaded list in the browser (name and email), and only after a successful read. At the cap it says "None of the newest 200 match". |
| 9f · "Deals · Active · ends within 30 days" → "No active deals ending within 30 days." · Clear filters (`dc:481`) | No deals in a filter | **E** `GET /deals?status=active`, filtered on `expires_at` in the browser | — | **NOW**, only after a successful read and below the 200 cap |

---

#### Figures that would be wrong today

1. **Resend resets the stage** (`admin_partners.ts:137-139`). This falsifies three things for any resent invitation without a deal: the C1 per-stage counts, the "at Offer chosen" part of the Lapsed row, and PI8a's "Her progress stays at Offer chosen" (`dc:411`). 9d's "No answers yet", if derived from the status, is false too. Resent rows are detectable (`expires_at − 14 days`, `:34`, `:67`, `:136`), so flag them.
2. **"Offer chosen, not sent" (C3) and "Awaiting signature" (T2, C3) include dead deals.** A lapsed invitation's `proposed` or `awaiting_signature` deal is voided only when someone signs (`partnerDeals.ts:226-238`). The only void writes are `admin_partners.ts:177` and `partnerDeals.ts:220`, `:233`. Join each deal to its invitation, and flag "Invitation lapsed".
3. **9c's "The tiles and charts still draw"** is false for T1, C1 and C2, and unqualified for T2 Awaiting signature and C3's pre-signing segments. All of these need the failed invitations read.
4. **Deals tab "[19]" from the active list alone** (today's `Deals (${deals.length})`, `PartnerInvitations.jsx:145`). `status=all` on `/deals` returns nothing (`admin_partners.ts:295`, `:305`).
5. **Needs you "[10]" and the Overview tab count, presented as totals.** They cannot include undelivered emails or blocked agreements.
6. **"Emails not delivered" as a number** (0 or otherwise): nothing on the invitation stores the send result (`mig/028_partner_deals.sql:9-29`). **"Delivered" as a word, ever**: the strongest store possible is "Gmail accepted it" (`email.ts:426-437`).
7. **"Agreement blocked" in the past tense for one named invitee**: a `selected` invitation cannot be told apart from one not yet finalized (`partner_onboarding.ts:297-299`, `:363-368`).
8. **C1 "oldest [d] days" read as time in stage on every bar**: only Opened (`viewed_at`) and Offer chosen (deal `created_at`) have a stage date. Draw "oldest sent" throughout.
9. **T2 "end within 30 days" and days left**: a "month" is 30 days (`partnerDeals.ts:304-305`), and a deal past its end stays `active` until the 04:40 UTC sweep (`wk/index.ts:2319-2323`).
10. **Any figure from a list that returned exactly its cap** (Guard L). The cap drops the oldest rows first. Also **any fan-out sum with one failed call** (Guard F).
11. **Lapsed as both "not closed" (T1, `dc:353`) and "Closed" (C1, `dc:366`)**. The Worker treats it as open: Resend reopens it, and its envelope stays signable until activation voids it.
12. **9d's "Date not recorded" for Offer chosen** is a false placeholder: the date is stored and already read (`admin_partners.ts:300`).
13. **"[18] partner accounts are not attached" as a Needs-you task**: most attach themselves on the next sign-in (`PartnerInvitations.jsx:469-474`).
14. **9d's Opened date after a resend** reads as an open of the new send. It is the earlier open until the invitee opens again (`admin_partners.ts:138`; `partner_onboarding.ts:106-109`).
15. **C1's caption "How far a revoked one got is not recorded"**: `viewed_at`, `envelope_id` and the voided deal survive a revoke (`admin_partners.ts:107-109`, `:159-161`, `:177`).

#### Buildable NOW with no Worker change

All of these come from reads that fail truthfully. Each obeys Guard L: it is exact while its list is below the cap, and it tests that on every read.
- **Frame and states:**
  - header, tabs as addresses, redirect and moved notice
  - PI12 dark styling
  - 9a (with the Emails tile as Not recorded), 9b, 9f
- **9c:** Unreadable for the invitations block and every block derived from it. Blocks that need only the join say "Lapsed invitations could not be checked".
- **T1:** all four tiles, from `GET /invitations`.
- **T2:** Active deals and "ends within 30 days"; Awaiting signature, with the lapsed join.
- **Tab counts:**
  - Invitations
  - Deals (six status calls, or the uncapped Contracts read where cool-off allows)
  - Referrals (Σ over `GET /deals/top?status=all&limit=50`, or over the three lists)
- **Needs you:**
  - Lapsed, without PI8a's stage promise and with resent rows flagged
  - Term ending
  - Firms, as a count, not a task
  - Due diligence "open", with the cool-off caveat; the KYB part is skipped
  - the weaker Agreement-blocked row
- **Charts:** C1 (as "oldest sent", with the deal-overrides rule and client-side stage links), C2, and C3 (with the lapsed join).
- **9d:** Sent (first send, resend flagged), Opened (with the resend caveat), Offer chosen (deal `created_at`), Signed, and "Link valid until".
- **Fan-out, under Guard F:** "Referral redemptions, 90 days", C4 and the Rev-share row. They are cheap while deals with redemptions are few; `/deals/top` lists exactly those deals. Replace them with #2370 split 4's cross-deal read when it lands.
- **Chart parts that exist:**
  - `HBars` (C1, `InsightsCharts.jsx:66`)
  - `Columns`, stacked (`:111`, `:149-160`)
  - `ChartTable` (`:307`)
- **Chart parts still needed:**
  - grouped columns with one hatch per series (C2)
  - an absolute stacked horizontal bar (C3)
  - a two-series line that does not use the dash for "current week" (C4)
  
  Per D915's rule (`D915.md:171`), a part shared outside `insights/` moves to `fe/ui/` in its own commit.

#### Honest placeholders

**Not recorded** (`Unrecorded`, `fe/ui/Honesty.jsx:37`; `NOT_RECORDED` from `fe/ui/index.js:93`):
- The "Emails not delivered" tile, the Email column on every row, and the Not-delivered Needs-you kind. Reason: "Delivery is not stored on the invitation yet."
- 9d's Offers shown date. Reason: "Stage dates are not stored on the invitation yet."
- C1 time in stage: draw "oldest sent" instead, with the caption "Time in each stage is not recorded."

**Not read here yet** (stored, but no read on this page; D915's wording, `D915.md:70`):
- Their answers, and the Profile done date (the profile's `updated_at`, `base:3313`), until the invitation detail read (#2370 split 3, with #2380).
- The Agreement out date (the envelope's `created_at`, `base:1821`).
- The per-invitation agreement refusal, until split 4. The unfilled-fields refusal is in `activity_logs` (`partner_onboarding.ts:364`) with no reader; the no-body refusal is not stored at all.
- Needs you's "with KYB waiting": the per-case read returns the whole case with PII (`dd.ts:249-250`), so the overview skips it.

**Could not be read** (`Unreadable`, `fe/ui/Honesty.jsx:62`, always with Try again):
- Any failed invitations, deals, links, DD, template or Contracts read, and every block derived from it (9c).
- Any fan-out aggregate with one failed call (Guard F).
- A DD, template or Contracts read refused by recovery cool-off (`wk/index.ts:654`, `:655`, `:660`). `/api/admin/partners` itself is not under cool-off (the list `wk/index.ts:649-684` does not name it; mount `:848`).
- Never "No invitations yet", "No {status} deals", "No redemptions yet" or 0 after a failure. Today's page does exactly that (`PartnerInvitations.jsx:69-71`, `:80`, `:84-86`, `:209-210`, `:345-346`, `:882`, `:917-918`).

**Searches behind the "does not exist" claims:**
- Each partner audit action name across `wk/` and `fe/`: every hit is its own writer. The generic `admin_audit_log` reader (`admin_security.ts:548-554`) surfaces only `reason` (`:497-503`).
- `FROM partner_invitations` in `wk/`: only the two partner routes, `activationFunnel.ts:195` and `onboardingChecklist.ts:395`. Neither is an admin aggregate. Activation joins it at `partnerDeals.ts:204`.
- `UPDATE partner_deals` in `wk/`: status writes only at `admin_partners.ts:177`, `:334`; `partnerDeals.ts:220`, `:233`, `:334`, `:498`, `:577`; `partner_onboarding.ts:374`.
- `UPDATE partner_invitations` in `wk/`: `admin_partners.ts:138`, `:159`; `partner_onboarding.ts:108`, `:205`, `:227`, `:298`, `:377`; `partnerDeals.ts:230`, `:341`.
- `ALTER TABLE partner_invitations|partner_deals|partner_referral` in `wk/` and `mig/`: none.
- `path="/admin/community` and `path="/admin/advisors` in App.jsx: none. `partner-invitations` in `fe/` and `wk/`: only the rail note at `PartnerInvitations.jsx:971`.
- `bounce` in `wk/`: no hit ties a bounce to a partner invitation.
- `firm` and `partner_id` in `fe/pages/admin/AdminNetworkProfiles.jsx`: none.
- #2370 via the REST API: 0 comments, so its slot tasks are not filed yet. The "split N" references are the issue's own "Suggested split" (1 behaviour fixes, 2 paging, 3 overview and detail reads, 4 deal detail, redemptions and agreement-ready reads).

#### Corrections

1. **Tree:** "every cite below is the same at both commits" was wrong for `fe/App.jsx:2852`, which was `:2848` at `0b85c2b`. `D915.md` also changed between the commits, but not at the lines cited.
2. **Guard L:** "today every list is far below its cap" overreached. The only counts are 33 days old (invitations, 2026-09-21) and 47 days old (26 partner accounts, 2026-09-07), and nothing counts DD cases. Added: every cut is newest-first, so the oldest-row figures fail first. Per-status calls lift the invitations cap.
3. **Guard F:**
   - Wrong line: "redeemable only while active" is `partnerDeals.ts:489`, not `:495-502` (that is the expiry flip).
   - Guard G is `D915.md:56-60`, not `:56-62`.
   - Added the 500 cut's direction: windowed counts stay exact, but rev-share windows are cut first.
   - Added `/deals/top?status=all&limit=50` as the exact one-call deal set.
   - Added the redeemers modal's false "No redemptions yet." (`:882`, `:917-918`).
4. **Capped NOWs with no Guard L:** the Referrals tab count (marked E/NOW "uncapped" over 200-capped lists), T2 Active deals, the T1 median and the C1 closed counts.
5. **Blocks marked N where a store exists:**
   - Offer chosen date (the deal's `created_at`, already in `GET /deals`).
   - Agreement out date (the envelope's `created_at`).
   - Profile done (the profile's `updated_at`, through the logged read).
   - Time in stage for Opened and Offer chosen.
   - The last-send time (`expires_at − 14 days`), which makes resends detectable.
   - `email_sent` in the audit trail.
   - How far a revoked invitation got (`viewed_at`, `envelope_id`, the voided deal).
6. **Figures the canvas defines differently than the store:**
   - "Delivered / Not delivered": the store can only mean Gmail accepted the message.
   - Lapsed: "not closed" in T1, "Closed" in C1.
   - "[18] not attached" as a Needs-you task, when most attach themselves.
   - The C1 bar link: a stage is not a status filter.
   - The 9d Opened date after a resend.
7. **9c's "still draw" list** contradicted the section's own lapsed-join rule for T2 Awaiting signature and C3's pre-signing segments.
8. **Skipped blocks:**
   - the top-bar search and bell (exist, `fe/App.jsx:1355`, `:1448`)
   - the canvas's sidebar hrefs (`dc:490`)
   - C3's segment link (`dc:370`)
   - T1's "link expired before signing" sub-line
   - 9a's "Reading…" on a tile with no read
   - the WeekLine dash clash with C4's dashed series
   - the rail map already filing the page under Community (`fe/lib/railPages.js:290`) against the placement map's Approvals lane (`fe/lib/adminPlacement.js:84`)
9. **Smaller fixes:**
   - The profile read logs only when it finds a row (`profiling.ts:509` before `:516`).
   - The template probe's 503 is `esign.ts:975`, and its sender marking is `:989`. `:312-324` is the send side.
   - The 04:40 UTC schedule is `wk/index.ts:2319-2323`.
   - `/links` counts only `role = 'partner'` accounts (`admin_partners.ts:539`), so a member who keeps their role on signing has no firm name there.
   - There is a single-deal summary in the redemptions route (`:244-251`, `:280-286`).
   - The KYB lookup reads the whole case with PII (`dd.ts:249-250`).
   - The rev-share warning cron also ignores deal state (`partnerDeals.ts:766-772`).
   - "Production has never had a resend" is known only as of 2026-09-21.

### #2370 Partner invitations: gap table for PI2, PI3, PI4, PI4d, PI4n, PI8a and PI8b

**Tree.** The work order named `0b85c2b`. The branch is now at `99466ce` (`git log 0b85c2b..HEAD` lists `0296848` D894 and `99466ce` D915). `git diff 0b85c2b HEAD` touches two of the files cited here:
- `frontend/src/App.jsx` gains 4 lines at 2838–2841. Every App.jsx line cited below comes before them.
- `documentation/architecture/decisions/D915.md` changes its status line and adds 6 lines after line 118. The lines cited here (28–30, 70, 109) read the same at both commits (`git show 0b85c2b:…/D915.md`).

So every `path:line` is the same at both commits. I only read files: no edits, no scratch files. Issue #2370's body was read through `gh api repos/AxalNetwork/StudioOS/issues/2370`.

**Prefixes.** `wk/` = `cloudflare-worker/src/`. `fe/` = `frontend/src/`. `mig/` = `cloudflare-worker/sql/migrations/`. `base:` = `cloudflare-worker/sql/schema_baseline.sql`. `dc:` = `design/incoming/Partner Invitations Page.dc.html`. `grid:` = `design/incoming/Partner Invitations · Boards.dc.html`. Bracketed values on the canvas are samples and were never read as data.

**Where the boards are drawn.** PI2 is at `dc:464` and PI3 at `dc:465`. PI4, PI4d, PI4n, PI8a and PI8b are at `dc:470-474`. Their captions are `grid:46,47,48,52`.

#### 0. Key

##### 0.1 Reads and writes these boards use
| Id | Route | Shape and limits | How it fails |
|---|---|---|---|
| **R1** | `GET /api/admin/partners/invitations` (`wk/routes/admin_partners.ts:97-123`). Client: `adminPartners.listInvitations` (`fe/lib/api.js:1224-1230`). | **Row fields:** `id, token, recipient_email, recipient_name, allowed_deal_types[], status, expires_at, created_at, viewed_at, signed_at, resulting_user_id, resulting_deal_id, envelope_id, revoked_at, invited_by_name` (`:107-110`), plus `link` and `is_expired` (`:119-120`).<br>**Not included:** `personal_message`, `invited_by_user_id`, or any delivery field.<br>**Filters,** applied before the cap: one exact stored `status`, and an email `LIKE` with `%` and `_` unescaped (`:103-104`).<br>**Cap:** the newest 200 **by first send** (`created_at`), with no total and no offset (`:114,122`). Resend writes no date (`:137-139`), so an old invitation that was resent can fall outside the 200 while it is still open.<br>Every row carries its bearer token (`:107,119`). | Truthful. There is no try/catch, so a D1 error is a 5xx (`wk/index.ts:1466-1486`).<br>One quiet case: an `allowed_deal_types` value that does not parse comes back as `[]` (`:118,613-616`). Create refuses zero types (`:62-64`), so an empty list reads "Could not be read", never "nothing offered". |
| **R2** | `GET /api/admin/partners/deals?status=` (`:293-312`). Client: `listDeals` (`api.js:1237-1238`). | One status per call, newest 200 (`:305-306`).<br>Carries `invitation_id`, the stored `proposal`, and the deal's `created_at` (`:297,300,308-310`). `created_at` is the date of the **first** choice: the row is inserted at the first select and updated in place on a later one (`wk/routes/partner_onboarding.ts:272-295`). | Truthful, except that a `proposal_json` that does not parse comes back as `{}` (`:309,617-620`). Draw "Could not be read", not a blank offer. |
| **R3** | `GET /api/profiling/admin/:email` (`wk/routes/profiling.ts:498-520`). Client: `adminGetProfile` (`api.js:2389`). | The whole `partner_profiles` row, with the EIN masked (`:520`).<br>**Keyed by email** (`base:3298`), not by invitation.<br>**Each call writes** a `partner_profile_access` row to `activity_logs` (`:517`). The Super Admin governance feed lists that action (`wk/routes/admin_security.ts:451`). | 404 `Profile not found` (`:509`). Otherwise a 5xx. |
| **R4** | `GET /api/legal/esign/:id` (`wk/routes/esign.ts:1044-1077`). Client: `esignDetail` (`api.js:2400`). | The envelope's `status, created_at, completed_at`, its recipients and its audit events. | 404.<br>It sits under recovery cool-off (`wk/index.ts:654`), which answers **423 `recovery_cool_off_active` to GETs too** (`wk/middleware/recoveryCoolOff.ts:40-46`). |
| **R5** | `GET /api/legal/esign/templates/partner_services` (`esign.ts:963-999`). Client: `esignTemplate` (`api.js:2150`). An admin may read every originator type (`wk/services/esignOriginators.ts:98,115-127`). | Returns `fields[{key, filled_by}]` (`:983-991`).<br>**`counterparty.*` keys are marked `filled_by:'send'`** (`:262,989`), but this flow leaves them empty:<br>• finalize sends with `recipientUserId: null` (`partner_onboarding.ts:339`), so they stay null (`esign.ts:449-452`);<br>• a null value leaves the token in the body (`wk/services/mergeFields.ts:44`);<br>• a token left in the body is refused (`esign.ts:519-521`).<br>For this flow, count them as unfilled. | 409 `template_has_no_body` or 503 `template_unreadable` (`:972-982`). Under cool-off. |
| **R6** | `GET /api/admin/users?q=` (`wk/routes/admin.ts:50-140`). Client: `adminListUsers` (`api.js:1928-1936`). | Rows carry `email` and `role`. LIKE over name and email (`:96`), newest 100 by default (`:59`). | 400 `query_too_short` below 2 characters (`:80-82`). A failed lookup reads "Could not check", never "not a member". |
| **W-create** | `POST /invitations` (`admin_partners.ts:48-95`). Client: `createInvitation` (`api.js:1231-1232`). | Returns 201 `{id, token, link, expires_at, email_sent, allowed_deal_types}` (`:91-94`). The row is inserted before the email is tried (`:69-84`). | 400 (`:59-64`).<br>A frozen HQ admin who is not a Super Admin gets 423 `admin_frozen` on any POST (`wk/auth.ts:523-528,568-590`; `wk/index.ts:1473`). |
| **W-resend** | `:125-151`. Client: `resendInvitation` (`api.js:1233-1234`). | Returns `{ok, email_sent, link, expires_at}` (`:150`).<br>**Writes `status='sent'`** and a new `expires_at`, and nothing else (`:137-139`).<br>The email goes out under the **resending** admin's name (`:142-145`). The row keeps the original inviter (`:110`). | 404 or 409 (`:131-133`). 423 when frozen. |
| **W-revoke** | `:153-207`. Client: `revokeInvitation` (`api.js:1235-1236`). | Returns `{ok, voided_deals, voided_envelopes}` (`:206`). The cascade swallows its own failures (`:186,197-200`). | 409 (`:163-165`). 423 when frozen. |

**Not a read for this page, but it exists.** The Super Admin governance feed:
- **Route:** `GET /api/admin/security/governance` (`wk/index.ts:1089`; `wk/routes/admin_security.ts:613-614`).
- **What it reads:** the newest 60 rows of **every** action in `admin_audit_log` (`:425,548-554,664-687`). So `partner_invitation_created`, `_resent` and `_revoked` show up there, with the admin, the time and any `reason`. The reason is lifted out at `:496-502,670,682`.
- **Its limits:** it is Super Admin only, it is not filtered per invitation, and it never returns `email_sent`.

So "nothing reads these rows" is wrong. "No read returns them per invitation" is right.

##### 0.2 Guard I: a client rule that makes R1 safe to draw without a Worker change
1. **Failure.** R1 and R2 are truthful.
   - A failed request shows "Could not be read" with Try again. It never shows an empty table, which is what today's page does (`fe/pages/admin/PartnerInvitations.jsx:69-71,209-210`).
   - After a failed refresh, the old rows may stay, but only under a "Could not refresh" line.
   - If an R2 call fails, rule 3's repair is not applied. Every stage that repair could lift carries "Stage may lag: the deals could not be read".
2. **The 200 cap.**
   - If R1 returns fewer than 200 rows, the list is complete for its server filter, because `status` and `email` are applied in SQL before `LIMIT 200` (`admin_partners.ts:103-114`).
   - At exactly 200 rows, every count, pager line and client-side filter says "within the newest 200 by first send". A resent old invitation can be outside that set (§0.1, R1).
3. **The stage word.** Map the stored status (vocabulary at `mig/028_partner_deals.sql:18`):

   | Stored | Canvas word |
   |---|---|
   | `sent` | Sent |
   | `viewed` | Opened |
   | `profiled` | Profile done |
   | `proposed` | Offers shown |
   | `selected` | Offer chosen |
   | `finalized` | Agreement out |
   | `signed` | Signed |
   | `revoked` | Revoked |

   - **Lapsed:** either the stored status is `expired`, or `is_expired` is set and the status is not `signed` or `revoked`.
     - **Time lapse.** The dots show the stage the invitation had reached, under the repair below. The canvas draws Mara at step 5 (`dc:418,422`).
     - **A stored `expired` means something else.** Activation writes it only when an envelope is completed after the link lapsed, and it voids the deal (`wk/services/partnerDeals.ts:226-237`). That invitee **signed**. Its tooltip says "Signed after the link lapsed. The deal was voided." It never uses the canvas's "link expired before signing" (`dc:353`).
   - **After a resend**, repair the stage that resend pushed back:
     - **Agreement out** is proved by R1 itself, with no cap. `envelope_id` is written only at finalize (`partner_onboarding.ts:376-378`), comes back in R1 (`admin_partners.ts:109`), and resend does not clear it (`:137-139`). A row with an `envelope_id` that is not Signed, Revoked or stored `expired` is at least Agreement out.
     - **Offer chosen** needs a deal row in R2 `proposed`, matched on `invitation_id`. If R2 `proposed` returns 200 rows, or fails, say "the stage may lag for older invitations".
     - A resend after Profile done or Offers shown cannot be repaired without P1.
4. **Requests.** Send one debounced request per filter change, with a guard that drops stale responses. Invitation filters must not reload deals. Today one effect reloads both (`PartnerInvitations.jsx:62-92`).
5. **Dates.**
   - `created_at`, `viewed_at`, `signed_at` and `revoked_at` are written as zoneless `CURRENT_TIMESTAMP`, so parse them as UTC. The writes are at `mig/028_partner_deals.sql:28`, `partner_onboarding.ts:108`, `partnerDeals.ts:342` and `admin_partners.ts:160`.
   - `expires_at` is ISO with a Z (`admin_partners.ts:67,136`).

##### 0.3 Owner and dependency codes
| Code | Meaning |
|---|---|
| **P1–P8** | #2370's "Suggested split into slot tasks", items 1–8:<br>**P1** Worker: invitation behaviour fixes (resend, delivery, lapse sweep, stage dates).<br>**P2** Worker: search, filters, sort and pages; the create lookup; the three-type cap.<br>**P3** Worker: overview read, invitation detail read, offer preview read.<br>**P4** Worker: deal detail read, terminate preview, cross-deal redemptions, agreement-ready signal.<br>**P5** Frontend with #2375: route, tabs, redirect, placement, sidebar, rail rows, tests.<br>**P6** Frontend: Overview, Invitations, the invitation lightbox and the create dialog.<br>**P7** Frontend: Deals, the deal lightbox, Referrals **and the confirm dialogs**, so PI8a and PI8b are P7's.<br>**P8** With #2369: move Firm links, then remove the tab.<br>CSV export is in the issue's Backend list but in no split item. |
| **O-CAP** | Cap allowed types at three, or show every allowed type. The issue's Backend list says "Needs a decision". The canvas answers "Pick up to three" (`dc:406`). |
| **O-OFFER** | Whose offer text is canonical: the canvas's (`dc:380`) or `buildProposals` (`wk/services/partnerDeals.ts:75-166`). Changing the Worker text changes what invitees see and sign. |
| **O-TERMS** | Per-invitation terms, decided with #2371 |
| **O-DUP** | Warn or refuse when an open invitation to the same address already exists |
| **O-ID** | Whether an invitation gets an address (`/invitations/:id`) or stays a lightbox with none |
| **#2375** | The shell and the moved notice |
| **#2390** | Approvals. It decides where the sidebar lights this page (issue, "Session coordination"). |
| **#2377** | Accounts: "Member record" |
| **#2380** | Partner profiles |
| **New** | A Worker defect outside #2370's split |

---

#### 1. Gap table

Notation: **E** exists, **P** partly, **N** does not exist, **W** would give a wrong figure today.

##### PI2 Invitations, desktop (PI11b is the phone version)
| Block (dc line) | What it draws | Worker source today | Owner/dependency | Now / placeholder |
|---|---|---|---|---|
| Header (`dc:460,462`; sidebar `dc:490`) | Crumb "Community › Partner invitations" linking to `/admin/community`; h1; one line; "New invitation"; the Community row lit | **Frontend only.**<br>• `/admin/community` is not a route. The Community row lands on `/admin/held/community` (`fe/App.jsx:2726`; `fe/sidebarConfig.js:230`).<br>• **The page sits under Approvals today.** The sidebar lights Approvals for `/admin/partners` (`fe/sidebarConfig.js:226-227`). The placement map calls it an Approvals lane (`fe/lib/adminPlacement.js:84`). Approvals lane 13 is its door (`fe/pages/admin/HeldApprovals.jsx:95`).<br>• The Community landing has no door to it: five links, none this page (`fe/pages/admin/HeldCommunity.jsx:11-12`).<br>• Only the rail files it under Community (`fe/lib/railPages.js:290`). | #2375, #2390, P5 | **NOW** for the h1, the line and the button.<br>Make the crumb follow the lit row: "Approvals › Partner invitations", linking to `/admin/held/approvals` (`fe/App.jsx:2724`), until P5 and #2390 move the row and add a Community door.<br>D915's "Community ›" crumb (`D915.md:28-30`) does not carry over: Events is lit under Community (`fe/sidebarConfig.js:230`), and this page is not. |
| Tabs and counts (`dc:461`) | Overview [10], Invitations [42], Deals [19], Referrals [64], each at its own `/admin/partner-invitations/…` address | **P.**<br>• None of the four addresses is a route. The page is `/admin/partners` (`fe/App.jsx:2701`), with in-page tabs Invitations, Deals and Firm links (`PartnerInvitations.jsx:142-162`).<br>• Firm links is not drawn on the canvas. It stays until #2369 takes it.<br>• The Invitations count is R1's length, with no total (`admin_partners.ts:114,122`). Today's tab counts the loaded rows (`PartnerInvitations.jsx:144`).<br>• The other counts belong to PI1, PI5 and PI7. | P2, P5, P8 | **NOW with a caveat**, as in-page tabs. Invitations shows "[n]" below the cap and "200+" at it.<br>The Overview count waits for PI1's Needs you.<br>Firm links stays as a fourth tab until P8.<br>The addresses and the moved notice wait for P5 (D894's pattern). |
| Search "name or email" (`dc:424`) | One box | **P.** Email is a server-side substring, applied before the cap, with `%` and `_` unescaped (`:103-104`). The server does not search names at all. One box cannot use the server's email filter without dropping rows that match only by name. | P2 | **NOW with a caveat**: search the loaded, unfiltered R1 rows on the client, by name and by email. Complete below 200 rows; "within the newest 200" at the cap. |
| Stage: All ▾ | Filter by the canvas stages and Lapsed | **P.**<br>• The server takes one exact stored status (`:103`).<br>• Lapsed is computed (`:120`).<br>• Resend rewrites the stage word (`:137-139`). | P1, P2 | **NOW**, client-side with Guard I.<br>Use the server's `status=` only for `signed` and `revoked`, which no write overwrites. Every `UPDATE partner_invitations` is at `admin_partners.ts:138,159`, `wk/routes/partner_onboarding.ts:108,205,227,298,377` and `partnerDeals.ts:230,341`. |
| Deal type offered ▾ | Filter | **E**: `allowed_deal_types` (`:118`) | — | **NOW**, client-side, on the first three types (what the invitee is offered) |
| Sent by ▾ | Filter | **P**: name only.<br>• R1 has `invited_by_name` but no `invited_by_user_id` (`:107-110`), so two admins with the same name merge.<br>• It is always the original inviter. A resend by another admin goes out in that admin's name (`:142-145`), and the row does not record it. | P2 | **NOW**, by name, labelled "Invited by" |
| Sent within: 90 days ▾; Sort: Newest sent ▾ | Filter and sort | **P**: `created_at` is the first send (`:108,114`). Resend writes no date (`:137-139`). | P1 (a resend date) | **NOW**, labelled "first sent" |
| Export CSV · NEW | A file | **N** on the Worker | Backend list only; nearest is P2 | **NOW**, as a client Blob of the loaded rows.<br>Leave out `token` and `link`, which are bearer credentials (`:107,119`). Mark the file when the cap was hit. |
| Invitee: name, email (`dc:425`) | Bold name with the email under it, or "No name given" | **E**: `recipient_name`, `recipient_email` (`:107`). The name is optional (`:52`). | — | **NOW** |
| Offered (`dc:426`) | Type names | **E**, but **W** for 4–5 types: the invitee is offered only the first three (`partnerDeals.ts:84`). Today's dialog allows five (`PartnerInvitations.jsx:706-719`). | O-CAP, P2 | **NOW**: the first three, in stored order. Any others read "Not offered to the invitee". |
| Stage pill, 7 dots, tooltip (`dc:427`; map `dc:333-335,422`) | The stage, plus progress such as "Step 5 of 7" | **P**: the stored status (`:108`).<br>**W after a resend** (`:137-139`).<br>**W for a stored `expired`**: that invitee signed (`partnerDeals.ts:226-237`). | P1 | **NOW with Guard I**, using the `envelope_id` and deal-row repairs.<br>A time-lapsed row keeps its dots at the stage reached (`dc:422`).<br>A stored `expired` row gets the "Signed after the link lapsed" tooltip.<br>Revoked draws no dots. That is truthful, because revoke overwrites the stage (`:159-161`). |
| "Agreement blocked" under the stage (`dc:417,427`) | Amber subline | **N** per row.<br>• The attempt is logged only as `partner_envelope_refused` (`partner_onboarding.ts:364`). No read returns it per invitation.<br>• A refusal for a missing or unreadable body writes no row at all (`:367-368`).<br>• R5 says only whether the template would be refused **now**. | P3, P4 | **Placeholder**: on rows at Offer chosen, show "Agreement not ready" while R5 refuses, or lists a key that finalize leaves unfilled: a sender key outside `partner_onboarding.ts:351-357`, or a `counterparty.*` key (§0.1, R5).<br>Never write "blocked", which claims an attempt.<br>If R5 fails, show nothing either way. |
| Sent by (`dc:428`) | Admin name | **E**: `invited_by_name`, the original inviter. It is a LEFT JOIN, so it can be null (`:110-112`). | — | **NOW**. A null reads "Not recorded". |
| Sent (`dc:428`) | Date | **P**: `created_at`, the first send | P1 | **NOW**, labelled as the first send |
| Opened / "Not opened" (`dc:428`) | Date | **P**. `viewed_at` is written on an open only while the status is `sent` (`partner_onboarding.ts:106-109`).<br>• So it is the **first** open after whichever send came before it, not the latest open.<br>• Resend does not clear it. With no resend date stored, the page cannot tell whether it predates the latest resend. | P1 | **NOW**, as "Opened [date]", never "since the last send" |
| Expires / "Lapsed [date]" / '—' (`dc:429`) | Date | **E**: `expires_at`, `is_expired` (`:108,120`). After a resend this is the renewed date (`:136`).<br>**At Agreement out the date matters more:** a signature that arrives after it voids the deal (`partnerDeals.ts:226-237`). | — | **NOW**.<br>A lapsed row with an `envelope_id` adds "A signature now would be voided. Resend renews the link."<br>Closed rows say "Closed", not a bare '—' (`fe/ui/Honesty.jsx:21-23`). |
| Email · NEW: Delivered / Not delivered / Not recorded (`dc:430`) | Pill | **N**: there is no column (`mig/028_partner_deals.sql:9-29`; `base:3262-3282`).<br>• The result is kept only in audit JSON (`admin_partners.ts:86-89,147-149`; `wk/services/adminAudit.ts:95-114`). The governance feed does not return `email_sent` (§0.1).<br>• **"Delivered" is W**: `email_sent` means the Gmail API accepted the message (`wk/services/email.ts:426-437`). | P1 (store it, and backfill from the audit rows) | **Not read here yet**. Once stored, the words are "Sent" and "Not sent". |
| Result: Deal [#52], "Member record" (`dc:431`) | Links to the deal and to the member | **E**: `resulting_deal_id`, `resulting_user_id` (`:109`), set at signing (`partnerDeals.ts:340-345`).<br>**No member page for every admin:**<br>• `/admin/accounts` is HQ-only (`fe/App.jsx:2773`).<br>• The Users console opens its member drawer from its own list, not from an address (`fe/pages/admin/consoles/UsersConsole.jsx:427,867-869`). | #2377 | **NOW**: the deal number opens the deal once PI6 exists (P7).<br>"Member record" is plain text until #2377.<br>With no deal, the cell says "No deal", not '—'. |
| Row menu ⋯ (`dc:423,432`) | Copy link, Resend, Revoke; "Open" only when Signed or Revoked | **E**: `link` (`:119`), W-resend, W-revoke. The Signed/Revoked menu matches the 409s (`:132-133,163-165`).<br>On a lapsed row, "Copy link" copies a link that answers 410 (`partner_onboarding.ts:63`). | — | **NOW**.<br>Copy needs a failure message in place. Today's toast says "long-press the link", but the row shows no link (`PartnerInvitations.jsx:118,241-248`).<br>On a lapsed row, Copy link reads "Link lapsed. Resend to renew it."<br>Keep Resend at Agreement out (PI8a). |
| Row opens the invitation (`dc:432`; `grid:46`) | Opens PI3 | There is no single-invitation read | O-ID | **NOW**, drawn from the loaded row |
| Pager "1–25 of [42]" (`dc:432`; template `dc:191-193`) | Pages and rows per page | **P**: no total, no offset (`:114,122`) | P2 | **NOW**, as client paging. "of [n]" below the cap, "of the newest 200" at it. |
| Rail spine (`dc:205,516`) | Eadwyn, with the note "Eadwyn reads the invitations listed here…" | **E**: today's frame carries the same note (`PartnerInvitations.jsx:968-975`) | — | **NOW** |
| Loading and failure (PI9a/PI9c) | — | R1 is truthful | — | **NOW**: `Unreadable` with Try again |

##### PI3 Invitation lightbox (PI11c is the phone page)
| Block (dc line) | What it draws | Worker source today | Owner/dependency | Now / placeholder |
|---|---|---|---|---|
| Frame (`dc:391,465`; `grid:47`) | Centred lightbox, 940 wide, two columns, "Esc to close" | Frontend: `Lightbox` (`fe/ui/Lightbox.jsx:69-70`, default width 560) | O-ID | **NOW** |
| Header (`dc:392`) | Name, email, stage pill, "Sent by [Admin A] on [14 Oct]" | **E**: the R1 row (`admin_partners.ts:107-110`) | — | **NOW**, with the stage by Guard I and "Sent" meaning the first send |
| Progress · Sent, Opened, Signed (`dc:384-385`) | Dates | **E**: `created_at` (first send) and `signed_at` (`:108`).<br>**P**: `viewed_at`, with the meaning given in PI2's Opened row. | — | **NOW** |
| Progress · Profile done, Offers shown (NEW, "Date not recorded") | Dates | **N** read.<br>• Each step **is** recorded as an `activity_logs` row, with `invitation_id` in its details (`partner_onboarding.ts:91-98,208,229`; `created_at` at `base:50`).<br>• Those rows carry a hashed actor and no `user_id` (`:93-96`), so no per-user read finds them either (`wk/routes/activity.ts:21-30`; `wk/routes/admin.ts:198-204`).<br>• The profile row is not a stand-in: it is per address, and its `updated_at` moves on every save (`:182-196`). | P1 or P3 | **Not read here yet**. "Date not recorded" would be false while those rows exist. |
| Progress · Offer chosen (NEW) | Date | **P**: R2's `created_at` on the deal row is the first choice (`admin_partners.ts:300`; inserted at `partner_onboarding.ts:287-295`). A later choice updates the row without a date (`:276-285`). | P1 or P3 for later choices | **NOW**: "First chosen [date]".<br>• The deal is in R2 `proposed`, `awaiting_signature` or `active`, matched on `invitation_id` or `resulting_deal_id`.<br>• "Not in this read" when that R2 list is at 200 and the deal is missing.<br>• "Could not be read" when R2 fails. |
| Progress · Agreement out | Date, or "Not reached" | **P**: the envelope's `created_at` through R4, using the row's `envelope_id` (`admin_partners.ts:109`; written at finalize, `partner_onboarding.ts:376-378`) | — | **NOW with a caveat**: this block gets its own "Could not be read" (cool-off). "Not reached" when there is no `envelope_id`. |
| Foot "Link valid until [28 Oct]" | Date | **E**: `expires_at` | — | **NOW**.<br>"Lapsed on [date]" when `is_expired`, plus PI2's warning at Agreement out.<br>"Closed" for Signed and Revoked. |
| What we offered (`dc:383`; copy `dc:380,382`) | One card per type: summary, terms, tiers, term | **N**.<br>• Offers are computed per request (`partner_onboarding.ts:225,251`), and only the chosen one is stored (`:283,292`). No admin route runs `buildProposals` (grep: only `partner_onboarding.ts:225,251` call it).<br>• Many outputs depend on the profile: equity hours (`partnerDeals.ts:92,100`), the capital commitment (`:141,149`), the capital tier (`:135,146`), and the custom description and excerpt (`:156,161`).<br>• The canvas copy is **W** (§2, item 6). | P3, O-OFFER | **NOW**: type names only, the first three. Terms read "Not read here yet". |
| Their answers (NEW READ, `dc:386-387`) | Ten facts; "Not answered" | **P**: R3, with the columns at `mig/275_partner_profiles_columns.sql:59-71`.<br>• The row is per address.<br>• The upsert moves `invitation_id` to whichever invitation saved last (`partner_onboarding.ts:182-183`). | — | **NOW**: fetch when the lightbox opens, never per row, because each read writes an audit row.<br>• Draw the facts only when `invitation_id` equals this invitation. Otherwise: "No answers for this invitation".<br>• A 404 reads "No answers yet". A null field reads "Not answered". |
| Profile check · Waiting; "Open in Partner profiles" (`dc:387`) | Pill and link | **E**: `admin_status`, one of pending, verified or rejected (`base:3309`; `profiling.ts:556`) | #2380 (no route yet) | **NOW**: link to today's tab, `/admin?tab=profiles` (`fe/pages/AdminPage.jsx:46`) |
| Chosen offer (`dc:388`) | Type and summary | **P**: the deal's stored `proposal` (`admin_partners.ts:297,308-310`).<br>• Found by `invitation_id` in R2 `proposed` or `awaiting_signature`.<br>• For Signed rows, found by `resulting_deal_id` in R2 `active`.<br>• Each list is one status, newest 200. | — | **NOW**: draw `proposal.label` and `summary`. They are the Worker's words, which are what the invitee chose.<br>Missing at the cap: "Not in this read". R2 failed: "Could not be read". |
| Agreement · Not sent (`dc:388`) | Pill | **E** as a state. With no `envelope_id`, nothing was sent: finalize writes the envelope and the deal only after the envelope is created (`partner_onboarding.ts:371-378`). | — | **NOW**. Once sent, show the envelope's status from R4. |
| Amber note "…not ready, so it could not be sent. Nothing was sent. The chosen offer is kept." and "Open in Contracts" (`dc:388`) | Note and link | **P/W**.<br>• R5 can say whether a send would be refused **now**: a refusal (`esign.ts:972-982`); a `filled_by:'sender'` key outside what finalize fills (`partner_onboarding.ts:351-357`; automatic keys at `esign.ts:261-262`); or a `counterparty.*` key, which this flow leaves unfilled (§0.1, R5).<br>• It cannot say this invitee tried: no read returns the attempt row per invitation.<br>• **Contracts does take a tab from the address**: `/admin/contracts` (`fe/App.jsx:2772`) renders `ContractsDesk` (`fe/pages/hq/ContractsPage.jsx:3`), which reads `?tab=`, `templates` included (`fe/pages/admin/contracts/ContractsDesk.jsx:18,23-24,53`). The desktop template list reads no parameters (`fe/pages/admin/AdminTemplates.jsx`, grep). | P3, P4 | **NOW, reworded**: "…not ready, so it cannot be sent yet. Nothing has been sent. The chosen offer is kept."<br>"Could not be sent" waits for P3.<br>The link goes to `/admin/contracts?tab=templates`. There is no deep link to the one template on desktop. |
| Your message (`dc:389`) | Message text | **N** in any admin read.<br>• `personal_message` is stored (`mig/028_partner_deals.sql:17`), but R1 does not select it (`admin_partners.ts:107-110`).<br>• The token GET returns it (`partner_onboarding.ts:128`), but it **flips Sent to Opened and logs a view** (`:106-110`), so the page must never call it. | P3 (or add the column to R1) | **Not read here yet** |
| History (NEW, `dc:390`) | "Sent by [Admin A] · Delivered · [14 Oct]" | **N** per invitation.<br>• **Admin rows:** `partner_invitation_created`, `_resent` and `_revoked`, written to `admin_audit_log` and `activity_logs` (`admin_partners.ts:86,147,202`; `adminAudit.ts:95-114`), with `invitation_id` only inside the JSON. The Super Admin governance feed lists them among its newest 60, without the invitation and without `email_sent` (§0.1).<br>• **The invitee's steps** (`partner_onboarding.ts:110,208,229,300,364,379`): nothing reads them. | P3 | **NOW, one line**: "Sent by [name] · [date]" from the row, as D915 did (`documentation/architecture/decisions/D915.md:109`).<br>Everything else reads "Not read here yet". "Delivered" is not drawn. |
| Footer: Copy link, Resend, Revoke (`dc:465`) | Buttons | **E** | — | **NOW**, hidden for Signed and Revoked. Resend opens PI8a and Revoke opens PI8b. On a lapsed row, Copy link reads as in PI2. |

##### PI4 New invitation: the form
| Block (dc line) | What it draws | Worker source today | Owner/dependency | Now / placeholder |
|---|---|---|---|---|
| Title, "The invitee gets a private link by email.", "Esc to close" (`dc:404,265`) | Static | — | — | **NOW** |
| EMAIL · REQUIRED (`dc:405`) | Field | **E**: lower-cased and checked against `^[^\s@]+@[^\s@]+\.[^\s@]{2,}$`. Otherwise 400 (`admin_partners.ts:51,59-61`). | — | **NOW**, with the 400 shown inline |
| "An open invitation to this address exists, sent [20 Oct]. Open it instead?" (NEW) | Warning and "Open it" | **P**: R1 `?email=` is a substring match (`:104`). The client checks the exact match (lower-cased) and the open state; "sent" is `created_at`.<br>**The Worker accepts a second invitation** (`:66-78`; the email index is not unique, `mig/028_partner_deals.sql:30`).<br>The two invitations then share one profile row (`partner_onboarding.ts:182-183`), and the older one gets 412 on propose and select (`:220-223,247-250`). | P2, O-DUP | **NOW**, as a warning. "Open it" opens that row's lightbox from the R1 result.<br>A failed lookup reads "Could not check for an open invitation", never nothing. |
| "This address belongs to a member (Founder). Signing keeps their role and adds the partner deal." (NEW) | Note | **P**: R6, exact email match on the client, `role`. A failed lookup reads "Could not check".<br>"Keeps their role" is true (`partnerDeals.ts:256-258`).<br>**"Adds the partner deal" is W for a paying member:**<br>• activation overwrites `subscription_tier` and `investor_tier` with the grant, unconditionally (`:307-330`);<br>• a later termination drops a `partner_grant` plan to free (`admin_partners.ts:344-369`). | New (an activation guard) | **NOW, the role sentence only**. The plan sentence waits for the guard. |
| NAME (`dc:405`) | Field | **E**: `recipient_name`, trimmed, with no length cap (`:52`) | — | **NOW**, with a client maxLength of 200, the profile's own cap (`partner_onboarding.ts:150`) |
| WHAT TO OFFER: "Pick up to three…", five cards, two disabled with "Three are picked; clear one to choose this." (`dc:406,403`) | Checklist | **P**: the Worker accepts all five and does not remove duplicates (`admin_partners.ts:54-57`). The invitee gets the first three (`partnerDeals.ts:84`). | O-CAP, P2 | **NOW**: cap at three in the client. A cap that only restricts is safe before P2. |
| Card name (`dc:403`) | Type | **E**: five types (`partnerDeals.ts:29-35`) | — | **NOW** |
| Card summary, terms, tiers, term (`dc:403`, text from `dc:380`) | Offer copy | **W**: the canvas text disagrees with `buildProposals` (§2, item 6). The Worker's own two texts also disagree:<br>• equity is "Axal StudioOS" in the summary (`partnerDeals.ts:89`) and "Axal VC Management LLC" in the excerpt (`:99`);<br>• deal-sourcing is "5% of Axal fees" in the terms (`:124`) and "5% of Axal management fees" in the excerpt (`:132`).<br>No route returns offer text. | O-OFFER, P3 (offer preview) | **Do not draw until P3**. Show the name only, with "Terms not read here yet". |
| Capital: "Needs KYC and accreditation after signing." (`dc:403`) | Line | **E**: capital deals seed KYC and accreditation as required (`partnerDeals.ts:363-364,405-410`). Every type also needs KYB (`:408`). | — | **NOW** |
| ADJUST TERMS ▾ · NEW (`dc:407`) | Four fields | **N**: there is no column (`mig/028_partner_deals.sql:9-29`), and `buildProposals` is fixed text (`partnerDeals.ts:75-166`) | O-TERMS (#2371) | **Omit** |
| MESSAGE TO THE INVITEE, "[62] / 2,000", "Shown in the email and at the start of the onboarding chat." (`dc:408`) | Field, counter, help | **E**. The Worker silently cuts it to 2,000 characters (`admin_partners.ts:53`).<br>It goes in the email (`email.ts:374-376,421-422`), opens the chat (`fe/pages/PartnerOnboardPage.jsx:191-192`), and is sent again on every resend (`admin_partners.ts:142-145`). | — | **NOW**, with maxLength 2000 so nothing is cut silently |
| Foot "The link is valid for 14 days. Resending gives a new 14 days." (`dc:408`) | Line | **E** (`:34,67,135-139`) | — | **NOW** |
| Cancel, Send invitation | Buttons | **E**: W-create | — | **NOW**. Show the 400 and the 423 inline. |

##### PI4d and PI4n: the result, in the same dialog
| Block (dc line) | What it draws | Worker source today | Owner/dependency | Now / placeholder |
|---|---|---|---|---|
| "Invitation sent to lio@example.com." (`dc:410`) | Success note | **E**: `email_sent: true` (`admin_partners.ts:82-84,91-94`). It means the Gmail API accepted the message (`email.ts:426-437`).<br>Today's page says "Invitation sent" whatever `email_sent` was: the handler ignores the response (`PartnerInvitations.jsx:403-405,636-638`). | — | **NOW**, drawn only when `email_sent` is true. Keep "sent"; never "delivered". |
| "The email was not sent: the address is on the do-not-email list, or studio mail is not set up. Copy the link and send it yourself." (`dc:410`) | Amber note | **P/W**: `email_sent:false` has **four** causes:<br>1. the address is suppressed (`email.ts:366`);<br>2. there are no credentials (`:367-370`);<br>3. Gmail refused (`:432-436`);<br>4. a throw or a timeout (`:438-441`).<br>Only a boolean comes back. A bounce or complaint on other mail, recorded by the mail-link webhook, also suppresses the address (`wk/services/mailLinkEvents.ts:15,54-57`). No admin route reads `email_suppressions` (grep of `wk/routes`). | P1 (a reason code) | **NOW, reworded**: "The email was not sent. Copy the link and send it yourself." The invitation exists either way (`admin_partners.ts:69-84`). |
| PRIVATE LINK · VALID 14 DAYS and the link (`dc:409`) | Read-only field | **E**: `link` (`:81`), which resolves at `/partners/onboard` (`fe/App.jsx:2476`). The canvas path `/partner/invite/[…]` is not a route. | — | **NOW**: draw the Worker's link exactly as given |
| Copy link, with "Copied" or "Copy failed. Select the link and copy it." (`dc:409-410`) | Button and feedback | Frontend only. Today there is no failure path (`PartnerInvitations.jsx:677`). | — | **NOW** |
| Open invitation, Done (`dc:410`) | Buttons | The 201 carries `id` (`:92`). There is no single-invitation read, so reload R1 with `?email=` set to the new address, so that no filter hides the new row, and open the row whose `id` matches. | — | **NOW**, and the dialog closes only on Done.<br>Today it closes on a 1.5 s timer (`:637-638`), and the result is a toast (`:405`) that disappears after 4 s (`fe/components/useToast.js:10,24-27`). |

##### PI8a Resend (P7 builds the dialog)
| Block (dc line) | What it draws | Worker source today | Owner/dependency | Now / placeholder |
|---|---|---|---|---|
| "Resend the invitation to Mara Example?" (`dc:411`) | Title | **E**: `recipient_name`, or the email when there is no name | P7 | **NOW** |
| "The link gets a new 14 days, until [7 Nov]." | Date | **E**: the server sets now + 14 days (`admin_partners.ts:136`) and returns it as `expires_at` (`:150`). Before the call, the client estimates the date by the same rule. | P7 | **NOW** |
| "Her progress stays at Offer chosen." with NEW "Keeping the stage on resend is new." | Promise | **P.** Resend writes `status='sent'` and the new expiry, and nothing else (`:137-139`).<br>**For the invitee, progress is kept.** The profile and the deal row stay, and the onboarding page resumes from them (`fe/pages/PartnerOnboardPage.jsx:159-165`).<br>**At Agreement out the invitee is not stranded.** The page shows "Review & sign" again. Its "Send for e-signature" returns the existing signing link (`PartnerOnboardPage.jsx:473-497`; `partner_onboarding.ts:319-329`). Only "Back to proposals" meets the 409 (`:218-219`).<br>**What is lost is the stored stage word.** Guard I shows Offer chosen and Agreement out again, but not Profile done or Offers shown. | P1 (stored stage), P7 | **NOW, by stage, using the name, not a pronoun:**<br>• **Offer chosen:** "Mara Example's chosen offer is kept."<br>• **Agreement out:** "The agreement already sent stays valid. A signature within the new 14 days still activates the deal."<br>• **Profile done / Offers shown:** "Their answers are kept. The stage shown here goes back to Sent until they continue."<br>The NEW line waits for P1.<br>**Offer Resend at Agreement out.** A signature that arrives after the link lapses voids the deal (`partnerDeals.ts:226-237`), and resend is the only way to renew the link (`admin_partners.ts:136-139`). That reverses the earlier "no Resend at Agreement out (S1's call)", which S1 should decide again. |
| AFTER RESENDING: "Sent." / "If the email fails: Not delivered. Copy the link instead." | Result | **E**: `email_sent` and `link` (`:150`). The result is not stored, so the row cannot show it once the dialog closes. | P1 | **NOW** in the dialog, with the words "Sent" and "Not sent" |
| Cancel, Resend | Buttons | **E**: W-resend. 404 and 409 (`:131-133`); 423 when frozen. | — | **NOW** |

##### PI8b Revoke (P7 builds the dialog)
| Block (dc line) | What it draws | Worker source today | Owner/dependency | Now / placeholder |
|---|---|---|---|---|
| "Revoke Teo Sample's invitation?" (`dc:412`) | Title | **E** | P7 | **NOW** |
| "The link stops working." | Line | **E**: 410 on the token routes (`partner_onboarding.ts:61,396`) | — | **NOW** |
| "The chosen offer, and any agreement out for signature, are voided." | Line | **P**.<br>• The cascade voids `proposed` and `awaiting_signature` deals and open envelopes (`admin_partners.ts:176-197`).<br>• It swallows failure and still answers `ok`, with zero counts (`:186,197-200,206`).<br>• Activation re-checks revocation, so the deal cannot go live either way (`partnerDeals.ts:217-225`). | — | **NOW**. Show `voided_deals` and `voided_envelopes` only when above 0, as today's modal does (`PartnerInvitations.jsx:765-768`). Never turn a 0 into "nothing was voided". |
| "This cannot be undone." | Line | **E**: no write returns a revoked invitation to another stage (the same UPDATE list as PI2's Stage row), and resend refuses revoked (`:133`). | — | **NOW** |
| "FOR AN INVITATION STILL AT SENT: The link stops working. This cannot be undone." | Variant | **P**. The right variant depends on whether a deal row exists. A deal row is created only at select (`partner_onboarding.ts:271-296`).<br>So the short variant fits every invitation without one: Opened, Profile done and Offers shown, as well as Sent.<br>After a resend, the stage word can say Sent while a deal row exists. | — | **NOW**: choose the variant by `envelope_id` or deal row, under Guard I. If R2 is at its cap or failed and no deal row was found, use the long variant. |
| REASON · OPTIONAL · KEPT IN THE AUDIT LOG | Field | **E**: cut to 500 characters (`admin_partners.ts:157`) and kept in `partner_invitation_revoked` (`:202-205`).<br>The Super Admin governance feed shows it, clipped to 160 characters, among the newest 60 audit rows (`admin_security.ts:425,670,682`). No read returns it per invitation. | P3 (History) | **NOW**, with maxLength 500 |
| Cancel, Revoke | Buttons | **E**. 409 "Cannot revoke (already signed, already revoked, or not found)" (`:163-165`); 423 when frozen. | — | **NOW** |

---

#### 2. Figures that would be wrong today: do not draw until fixed
| # | Figure (board) | Why it is wrong | Fixed by |
|---|---|---|---|
| 1 | Stage pill and dots after a resend (PI2, PI3) | Resend writes `sent` (`admin_partners.ts:137-139`) | P1. Guard I repairs Agreement out (from `envelope_id`) and Offer chosen (from the deal row). |
| 2 | "Offered" with 4–5 types (PI2) | The invitee sees the first three (`partnerDeals.ts:84`) | The client cap now; P2 for the Worker cap |
| 3 | "Delivered" (PI2 Email, PI3 History) | `email_sent` means the Gmail API accepted the message; there is no receipt (`email.ts:426-437`) | Say "Sent" |
| 4 | PI4n's cause sentence | It names 2 of the 4 causes (`email.ts:366-441`) | Reword now; P1 adds a reason code |
| 5 | "Her progress stays at Offer chosen" (PI8a) | True for the invitee, whose profile and deal are kept (`PartnerOnboardPage.jsx:159-165`). False for the stored stage (`admin_partners.ts:137-139`). | The by-stage wording now; P1 for the stored stage |
| 6 | Offer copy (PI3 What we offered, PI4 cards) | The text at `dc:380` is not what `buildProposals` sends:<br>• **Equity:** "in portfolio companies" and "up to [1]%" against 0.5%–2.0% in Axal StudioOS or Axal VC Management LLC (`partnerDeals.ts:89,91,99`).<br>• **Deal-sourcing:** "of first-year revenue" against 5% of fees and 10% of management fees (`:124-125`).<br>• **Capital:** "Investor Professional · 12 months", "[$25,000] a year" against Founder Pro plus Professional or Institutional, for 24 months, with at least $250k (`:135-147`).<br>• **Services:** "quarterly check-in" is not in the terms (`:107-111`).<br>• **Custom:** "Set in Adjust terms" refers to a field that does not exist. | O-OFFER, P3 |
| 7 | "Agreement blocked" / "could not be sent" (PI2, PI3) | R5 shows only that the template would be refused now, not that this invitee tried. One refusal branch writes no row (`partner_onboarding.ts:367-368`). | Reword now ("cannot be sent yet"); P3, P4 |
| 8 | "Signing … adds the partner deal" for a paying member (PI4) | Activation overwrites the paid plan (`partnerDeals.ts:307-330`) | New (activation guard) |
| 9 | "1–25 of [42]" and the tab count (PI2) | Counts of at most 200 loaded rows, with no total (`admin_partners.ts:114`) | Guard I wording; P2 for a total |
| 10 | "Sent [date]", "Sent within", "Newest sent" (PI2, PI3) | `created_at` is the first send; resends are not dated | Label "first sent"; P1 |
| 11 | Revoke result "0 voided" as fact (PI8b) | The cascade swallows failure (`:186,197-200`) | Draw only counts above 0 |
| 12 | The canvas link `/partner/invite/[…]` (PI4d/n) | Not a route | Draw the Worker's `link` |
| 13 | "Date not recorded" for the step dates (PI3), and "Not recorded" for email on older rows (PI2) | The data exists in `activity_logs`, the deal row and the audit JSON. It is unread, not unrecorded. | "Not read here yet", or "First chosen [date]"; P1/P3 |
| 14 | "Lapsed" for a stored `expired` (PI2, PI3) | That invitee signed after the link lapsed, and the deal was voided (`partnerDeals.ts:226-237`). It does not mean "link expired before signing" (`dc:353`). | The Guard I tooltip now |
| 15 | "Opened [date]" after a resend (PI2, PI3) | It is the first open after an earlier send, not the latest open (`partner_onboarding.ts:106-109`) | The "Opened" label now; P1 for stage dates |
| 16 | "Sent by" after a resend by another admin (PI2, PI3) | The row keeps the original inviter, while the email went out in the resender's name (`admin_partners.ts:110,142-145`) | "Invited by" now; P1/P3 for History |
| 17 | A lapsed invitation at Agreement out drawn as closed (PI2, PI3) | Its envelope can still be signed, and that signature voids the deal (`partnerDeals.ts:226-237`) | The warning and Resend now; P1's lapse sweep |
| 18 | "Agreement ready" judged from `filled_by:'sender'` alone (PI2, PI3) | `counterparty.*` keys are marked `send` (`esign.ts:262`), but finalize leaves them unfilled and is refused (`partner_onboarding.ts:339`; `mergeFields.ts:44`; `esign.ts:519-521`) | Count them as unfilled now; P4's agreement-ready signal |

#### 3. Buildable NOW with no Worker change
R1 and R2 are truthful, so the only rule needed is Guard I (§0.2):
- failures shown as failures, R2's included;
- the 200-row cap stated, by first send;
- the stage word repaired from `envelope_id` and the deal row;
- stale replies dropped.

Two parses fail quietly (§0.1): an empty `allowed_deal_types` and an empty `proposal`. Both read "Could not be read".

Production held zero invitations when last measured (`mig/275_partner_profiles_columns.sql:17,49,54-55`). In practice the list is complete, and the first-use state (PI9b) is the common case.

- **PI2.** The whole table from R1:
  - Columns: Invitee; Offered (the first three, with extras marked); Stage, with Guard I; Invited by; Sent (first send); Opened; Expires/Lapsed, with the Agreement-out warning; Result (the deal number; the member record as text).
  - Search: name and email on the client, over the loaded rows.
  - Every filter and sort on the client, labelled as above. Paging on the client. CSV as a Blob without the token or the link.
  - The Email column reads "Not read here yet".
  - The crumb follows the lit Approvals row until P5.
- **PI3.**
  - From the row: header, Sent, Opened, Signed and the link expiry.
  - Offer chosen as "First chosen [date]" from R2. Agreement out from R4.
  - Their answers and Profile check from R3: fetched on open, checked against `invitation_id`, linked to `/admin?tab=profiles`.
  - Chosen offer from the R2 `proposal`. The agreement state from `envelope_id` and the deal.
  - The readiness note from R5, counting `counterparty.*` keys as unfilled, with the reworded sentence and a link to `/admin/contracts?tab=templates`.
  - Footer actions.
  - What we offered: type names only. Your message: "Not read here yet". History: one line.
- **PI4.**
  - Every field except Adjust terms and the offer copy.
  - A cap of three in the client.
  - The duplicate warning through R1 `?email=`, and the member note through R6 (the role sentence only). Each lookup has its own "Could not check".
  - Message maxLength 2000. The 400 and the 423 inline.
- **PI4d/PI4n.** Complete:
  - the success note only when `email_sent` is true;
  - the reworded not-sent sentence;
  - a Copy failure path;
  - Open invitation by an `?email=` reload;
  - Done, and no timer.
- **PI8a.** With the by-stage sentence, and Resend offered at Agreement out (P7 builds it).
- **PI8b.** Complete:
  - the variant chosen by `envelope_id` or deal row, with the long variant when unsure;
  - reason maxLength 500;
  - counts drawn only above 0.

#### 4. Honest placeholders
The labels follow D915 (`decisions/D915.md:70`):
- **Not recorded** (`Unrecorded`): no store holds it.
- **Not read here yet**: it is stored, but no read returns it.
- **Could not be read** (`Unreadable` with `what` and `claim`): a read failed.

| Block | Label | Waits for |
|---|---|---|
| PI2 Email column; PI3 History "Delivered" | Not read here yet (it is in the audit JSON) | P1, which stores and backfills it. Rows with no audit row then read "Not recorded". |
| PI3 Profile done and Offers shown dates; Offer chosen after a second choice | Not read here yet (in `activity_logs`) | P1 or P3 |
| PI3 Offer chosen when the deal is past R2's cap | Not in this read | P3 |
| PI3 What we offered (terms); PI4 card terms | Not read here yet | P3 offer preview, O-OFFER |
| PI3 Your message | Not read here yet | P3, or the column added to R1 |
| PI3 History beyond "Sent by · date" | Not read here yet | P3 |
| PI3 or PI2 "Agreement blocked" as an attempt | Not read here yet. Show "Agreement not ready" from R5 instead. | P3, P4 |
| PI2 "Member record" link; PI3 "Open in Partner profiles" target | Plain text, or today's address | #2377, #2380 |
| PI4 Adjust terms | Omit | O-TERMS (#2371) |
| PI4 cause of a failed send | Not recorded (only a boolean is returned) | P1 |
| PI2 Sent by null | Not recorded | — |
| PI3 Their answers when the profile row belongs to another invitation | "No answers for this invitation" | — |
| PI4 duplicate or member lookup failing | Could not check | — |
| R1, R2, R3, R4, R5 or R6 failing, including R4/R5's 423 `recovery_cool_off_active` | Could not be read, one per block, never an empty state. An R2 failure also marks the repaired stages "may lag". | — |

**How the absences were found.** Every search was a grep or ripgrep across `cloudflare-worker/src` and `frontend/src` at HEAD:
- **Audit-action readers.** Each onboarding and invitation action name returned only its own writer.
  - **Generic readers exist.** The Super Admin governance feed reads every `admin_audit_log` row (`admin_security.ts:548-554`). The per-user activity reads key on `user_id` or a plain email actor (`activity.ts:21-30`; `admin.ts:198-204`), which the hashed onboarding rows do not match.
  - None of them filters by invitation.
- **Writes to the stage column.** `UPDATE partner_invitations` returned 9 statements, listed above.
- **Bounce or delivery tracking.** `bounce` does match: the mail-link webhook turns bounces and complaints into suppressions (`wk/services/mailLinkEvents.ts:15,54-57`). Nothing tracks delivery of the Gmail-sent invitation.
- **Suppression list.** The `email_suppressions` table is named only in services. `routes/newsletter.ts:209` calls `isSuppressed` for its own sign-up.
- **Contracts deep link.** `fe/pages/hq/ContractsPage.jsx` is a 3-line re-export. The page it re-exports, `fe/pages/admin/contracts/ContractsDesk.jsx`, reads `?tab=` (`:23-24`). `fe/pages/admin/AdminTemplates.jsx` reads no parameters.
- **Admin member pages.** `App.jsx` has no admin member route except the HQ-only `/admin/accounts` (`fe/App.jsx:2773`).
- **Columns.** `mig/028` and `base:3262-3282` show no delivery, resend or stage-date column.
- **Issue #2370.** Read through the REST API, including its split items 1–8.

---

**Corrections**
1. **Contracts deep link.** The earlier search read `fe/pages/hq/ContractsPage.jsx`, which only re-exports `ContractsDesk`. That page reads `?tab=`, so `/admin/contracts?tab=templates` works (`fe/pages/admin/contracts/ContractsDesk.jsx:18,23-24,53`).
2. **"Nothing reads" the audit rows was wrong.** The Super Admin governance feed lists every `admin_audit_log` row and shows the revoke `reason` (`admin_security.ts:425,548-554,670,682`). It is not per invitation and never returns `email_sent`. This changes the PI3 History row and the PI8b Reason row ("Nothing reads it back" was false).
3. **PI8a was wrong twice.**
   - Resend does not strand the invitee at Agreement out: "Send for e-signature" returns the existing signing link (`PartnerOnboardPage.jsx:473-497`; `partner_onboarding.ts:319-329`).
   - "Do not offer Resend at Agreement out" removes the only way to keep a late signature from voiding the deal (`partnerDeals.ts:226-237`).
   - "The stage goes back to Sent" also contradicted Guard I's own repair at Offer chosen.
4. **Guard I misses a store it already reads.** R1's `envelope_id` proves Agreement out with no cap (`admin_partners.ts:109`; `partner_onboarding.ts:376-378`). An R2 failure must mark repaired stages "may lag", not leave them silently unrepaired.
5. **The Offer chosen date was marked N, but a store exists.** R2's deal `created_at` is the first choice (`admin_partners.ts:300`; `partner_onboarding.ts:287-295`).
6. **The readiness check missed the `counterparty.*` keys.** They are marked `send`, but finalize, with `recipientUserId: null`, leaves them unfilled and is refused (`esign.ts:262,449-452,519-521`; `mergeFields.ts:44`; `partner_onboarding.ts:339`).
7. **A stored `expired` means signed after the lapse, with the deal voided** (`partnerDeals.ts:226-237`). It does not mean "expired before signing". A lapsed Agreement-out row is still signable, and that signature is voided. The Lapsed dots (`dc:422`) were also skipped.
8. **"Opened" is the first open after an earlier send, not the latest open** (`partner_onboarding.ts:106-109`). "Sent by" is the original inviter, while a resend mails in the resender's name (`admin_partners.ts:142-145`).
9. **The PI2 search plan dropped name matches.** Sending the box's text as `email=` filters out rows that match only by name. Search the loaded rows on the client instead.
10. **The Header row skipped the shell.** The sidebar lights Approvals for `/admin/partners` (`fe/sidebarConfig.js:226-227`), and the Community landing has no door to it (`HeldCommunity.jsx:11-12`). So a "Community ›" crumb disagrees with the page. The Tabs row also skipped the canvas addresses and today's Firm links tab (`PartnerInvitations.jsx:147`). The rail spine (`dc:516`) was not listed.
11. **PI4d skipped that today's page toasts "Invitation sent" whatever `email_sent` was** (`PartnerInvitations.jsx:403-405,636-638`). PI4n skipped that a mail-link bounce also suppresses the address (`mailLinkEvents.ts:54-57`).
12. **Failures and caps that were hidden.**
    - The R1 and R2 JSON parse fallbacks (`admin_partners.ts:613-620`).
    - The R6 limit of 100 (`admin.ts:59`).
    - Lookup failures in PI4.
    - Chosen offer and PI8b's variant when the deal is past R2's cap.
13. **Codes.**
    - PI8a and PI8b belong to P7. The table omitted P7 and P8.
    - CSV export is in no split item.
    - #2390 owns the sidebar placement.
14. **Lines and lists.**
    - R6's 400 is at `admin.ts:80-82`, not `:79-81`.
    - The Tree note missed that `D915.md` changed; its cited lines did not move.
    - "Three" profile-dependent offer outputs are more: `partnerDeals.ts:92,100,135,141,146,149,156,161`.
    - The Worker's own offer texts disagree (`:89` and `:99`; `:124` and `:132`).
    - The PI8b short variant applies to every stage before Offer chosen, not only Sent.

### Partner invitations (#2370): gap table for PI5, PI6, PI7, PI8c, PI10 and PI11

**Which tree I read.** The work order named HEAD `0b85c2b`. The branch has since moved twice: to `99466ce` (D915 Events desk) and then to `fbbb4c8` (D906 review fixes). `fbbb4c8` touches none of the files cited here. `git diff --stat 0b85c2b fbbb4c8` changes no `wk/` file, no migration and neither canvas file. It does change three of the files cited here:
- `fe/App.jsx` gains four lines at 2838–2841. App.jsx cites below 2838 are the same at both commits. Those above it (`:2851-2852`, `:3789`, `:3794`) are 4 higher than at `0b85c2b`.
- `fe/pages/admin/events/eventsDeskModel.js` is new in `99466ce`. The `parseStamp` precedent does not exist at `0b85c2b` (`git cat-file -e` fails).
- `documentation/architecture/decisions/D915.md` gains six lines after line 120. `D915.md:171` was `:165` at `0b85c2b`; lines 23 and 28 are unchanged.

Every cite below is a line at `fbbb4c8`. I wrote nothing. Besides git and file reads, I made read-only `gh api` REST calls for the issue bodies.

**Path prefixes.**
- `wk/` = `cloudflare-worker/src/`
- `fe/` = `frontend/src/`
- `mig/` = `cloudflare-worker/sql/migrations/`
- `base:` = `cloudflare-worker/sql/schema_baseline.sql`
- `dc:` = `design/incoming/Partner Invitations Page.dc.html`
- `grid:` = `design/incoming/Partner Invitations · Boards.dc.html`

Bracketed canvas values are samples and were never read as data.

**Notation** (at the start of each Worker cell):
- **E** exists today.
- **P** partly: a different route, a client-side join, one call per row, a cap, or a store with no reader.
- **N** there is no store at all.
- **W** a figure drawn from today's data would be wrong.

**Board captions:** PI5 `grid:49`, PI6 `grid:50`, PI7 `grid:51`, PI8 `grid:52`, PI10 `grid:54`, PI11 `grid:55`.

---

#### PI5 · Deals · desktop (`dc:466`, `dealCols` `dc:457`)

| Block (dc) | What it draws | Worker source today | Owner / dependency | Now / placeholder |
|---|---|---|---|---|
| Shell (`dc:15-34`, `:204-206`) | Admin sidebar with **Community** lit (`dc:490`); "HQ-held · axal.vc" (`dc:502`); Eadwyn spine and its tip (`dc:516`) | — (frontend). The frame is `fe/pages/admin/PartnerInvitations.jsx:968-975` and the badge `fe/App.jsx:1323-1328`. The sidebar lights **Approvals**, whose `match` holds `/admin/partners` (`fe/sidebarConfig.js:226-227`). Community's `match` does not (`:230`). | #2375 (addresses, `match` lists); #2390 (which row lights) | **NOW with a caveat:** Approvals stays lit until a `match` list moves. |
| Header (`dc:460`, `:462`) | Crumb "Community › Partner invitations" → `/admin/community`; h1; one line; violet "New invitation" | **E** for the button: `POST /invitations` `wk/routes/admin_partners.ts:48-95`. `/admin/community` is not a route; the landing is `/admin/held/community` (`fe/App.jsx:2726`). | D915 precedent (`documentation/architecture/decisions/D915.md:28`) | **NOW**: the crumb links `/admin/held/community`. |
| Tab strip (`dc:461`, markup `dc:63-66`) | Overview [10] (amber), Invitations [42], Deals [19], Referrals [64], as links to four new addresses | **P**. Exact totals exist for two tabs, but under cool-off:<br>• **Deals:** `GET /api/admin/contracts/partner-deals` reads every `partner_deals` row with no LIMIT (`wk/routes/admin_contracts.ts:1198-1208`) and returns the full `total` (`:1220`). It is under recovery cool-off (`wk/index.ts:655`). The fallback is Σ of six `GET /deals` lists, 200 each (`admin_partners.ts:306`).<br>• **Referrals:** Σ `redemption_count` over that same uncapped read (`admin_contracts.ts:1203-1204`), at most 500 rows a page (`wk/services/contractListQuery.ts:18`). The fallback is Σ `redemptions_count` over the six lists (`admin_partners.ts:302`).<br>• **Invitations:** the length of `GET /invitations`, newest 200 (`admin_partners.ts:114`). No other count of the table exists. The only other reads are by id or token (`:129`; `partner_onboarding.ts:50`).<br>• **Overview:** the Needs-you count, **N** in part (see PI11a). | #2375 (routes) | **NOW**:<br>• Deals and Referrals come from the contracts read. On its 423 or 5xx, use the six lists under Guard L.<br>• Invitations under Guard L (a list at its cap reads "200+").<br>• Overview counts only the rows that exist. |
| C5 Terms ending (`dc:372-377`) | One bar per active deal from start to end over −20…+120 days; a today line; amber at 30 days or less; "Showing 8 of [11] active deals"; Chart / table toggle | **E**: `GET /deals?status=active` gives `activated_at` and `expires_at` (`admin_partners.ts:293-312`, `:299-300`). The "[11]" is that list's length (Guard L), or the contracts read's `total` with `status=active` (`admin_contracts.ts:1214`, `:1220`). | No timeline chart part exists; D915's rule applies (`D915.md:171`) | **NOW with caveats:**<br>• `activated_at` is a zone-less D1 stamp (`wk/services/partnerDeals.ts:335`); `expires_at` is ISO with Z (`:305`). Parse both as UTC (precedent `fe/pages/admin/events/eventsDeskModel.js:130-136`).<br>• An active deal past `expires_at` but before the 04:40 UTC sweep (`wk/index.ts:2323`; `partnerDeals.ts:565-571`) reads "Term ended, not yet closed", never negative days. |
| Top deals by redemptions · All states (`dc:378-379`) | Five rows: partner, code, deal-type pill, state pill, count | **E**: `GET /deals/top?status=all&limit=5` (`admin_partners.ts:215-233`). The partner is null before signing (`:224`, `:227`). Zero-redemption deals rank in when fewer than five deals have any (`:229`). | — | **NOW.**<br>• A failure reads Unreadable. Today the page swallows it (`fe/pages/admin/PartnerInvitations.jsx:80`).<br>• Keep the `> 0` filter (`:83`). |
| Toolbar (`dc:443`) | Search partner, email or code; six state chips (multi-select); Deal type; Ends within; Has redemptions; Sort: Ends soonest. The foot says "Active is on by default" (`dc:443`). | **P**:<br>• `GET /deals` filters one exact status (`admin_partners.ts:295`, `:305`), and `status=all` matches nothing. It has no search, sort or offset.<br>• The contracts read does search partner name and email, and filters deal type and one status (`admin_contracts.ts:1213-1215`), with offset paging (`contractListQuery.ts:16-18`). Its rows lack the code, the dates and the invitation (`:1199-1204`), so the table still needs the `/deals` rows. | #2370 body: server-side search, filters, sort and pages | **NOW**, client-side over the six lists, with Active on by default |
| Column: Partner, name + email (`dc:434-443`) | Person or firm name, email | **E** after signing: `partner_name`, `partner_email` (`:301`, joined on `pd.user_id` `:304`).<br>**P** before signing: `user_id` is NULL until signed (`mig/028_partner_deals.sql:58`). Join `invitation_id` (`:297`) to the `GET /invitations` `recipient_name/email` (`:107`).<br>**W** for firm names: `users.name` is whatever activation wrote, usually a person (`partnerDeals.ts:260-263`). Two firm sources exist:<br>• The DD case's `subject_label` is the profile's organization at activation (`partnerDeals.ts:368-371`), returned by the DD list (`wk/routes/dd.ts:144`).<br>• `firm_name` from `GET /links` (`admin_partners.ts:534-541`, 500 rows). It lists only accounts whose role is `partner` (`:539`), and an existing member keeps their role on signing (`partnerDeals.ts:256-258`). | #2369 owns firm links | **NOW** with the join. An invitation outside the newest 200 reads "Not in this read". The firm comes from `/links`, else `subject_label`, labelled "at signing". |
| Deal type | Word from `DT` (`dc:338`) | **E** `deal_type` (`:297`) | — | **NOW** |
| Tiers granted | "Founder Pro · Investor Professional" | **W.**<br>• `granted_tier_founder` is always `founder_pro` (`partnerDeals.ts:95`, `:112`, `:128`, `:145`, `:157`).<br>• That is not a founder plan. The ladder is `free / growth / studio` (`wk/middleware/requireTier.ts:28-30`), and an unknown tier ranks as free (`:61-65`). Migration 028's comment shows the names were never the ladder's (`mig/028_partner_deals.sql:62`).<br>• The investor tiers are real (`wk/middleware/requireInvestorTier.ts:24`). But the investor gate applies only to accounts whose role is `investor` (`:102`), and partners bypass it (`:32`, `:96`).<br>• The canvas's tiers per type are not the store's. Capital partnership draws "Investor Professional" and 12 months (`dc:380`). The store grants `founder_pro` plus `professional` or `institutional` (by capital ≥ $1M) and 24 months (`partnerDeals.ts:135`, `:145-147`). | **Owner decision:** which founder plan a partner deal grants (a Worker fix in `partnerDeals.ts`) | **Do not draw "Founder Pro" as a plan** until it maps to a tier. Draw the stored investor tier, never the canvas's per-type text. |
| Term | "12 months · [start]–[end]"; "starts on signing" | **E**: `term_months`, `activated_at`, `expires_at` (`admin_partners.ts:298-300`). **W** if the end is computed: a month is 30 days (`partnerDeals.ts:304-305`). | Owner: calendar months or 30-day months | **NOW**: draw the stored dates |
| Days left (amber at 30 or less) | Days to `expires_at` | **E** | — | **NOW.**<br>• Unsigned: "Starts on signing", not "—" (`fe/ui/Honesty.jsx:21-23`).<br>• Ended: "Ended [date]" from `terminated_at`/`expires_at` (`:300`). |
| Referral code + Copy | `PART-…`; "Issued on signing" | **E** `referral_code` (`:299`), set at activation (`partnerDeals.ts:278-299`) | — | **NOW**; Copy needs a failure path |
| Redemptions (opens PI6) | Count | **E** `redemptions_count`, an uncapped subquery (`admin_partners.ts:302`) | — | **NOW.** Unsigned: "Code not issued", not "—". |
| State pill (vocabulary `dc:336`) | Offer chosen, not sent · Awaiting signature · Active · Term over · Terminated · Voided | **E** `status` (vocabulary `:322-326`), with two **W** cases:<br>• **Awaiting signature after a signature.** The steps before and including the deal flip at activation are outside any try (`partnerDeals.ts:240-264`, `:333-337`). The e-sign hook swallows the throw (`wk/routes/esign.ts:1590-1593`) and runs only for the request that completed the envelope (`:1554-1560`). A signed envelope can therefore leave the deal at `awaiting_signature` for good.<br>• **Offer chosen on a lapsed invitation.** A `proposed` deal is not voided when the link lapses, and finalize is refused (`wk/routes/partner_onboarding.ts:59-64`). This holds until an admin resends, which allows any status but signed and revoked and renews `expires_at` (`admin_partners.ts:132-139`). | — | **NOW with two cross-checks:**<br>1. Invitation `is_expired` (`admin_partners.ts:120`) → "Lapsed before signing · Resend to continue".<br>2. The envelope from `esignList({deal_id})` (`fe/lib/api.js:2396`; `wk/routes/esign.ts:1001-1027`), matched on `id === deal.envelope_id`, because `deal_id` is shared with other document types (`esign.ts:791`). A completed envelope gives "Signed, deal not activated". |
| Due diligence · NEW (Open / Cleared / Not opened) | One pill per deal | **P**: `GET /api/dd/cases?subject_type=partner` (`wk/routes/dd.ts:124-152`).<br>• Newest 200 (`:147`). It filters subject type and status server-side (`:134-135`) but not the subject, so match client-side on `subject_id = deal.user_id`.<br>• One case is opened per activation, with no deal id (`partnerDeals.ts:368-371`). A member with two deals has two cases, and neither is tied to a deal.<br>• The read is under recovery cool-off (`wk/index.ts:660`).<br>**W** for "Cleared": `completed` (`base:1244`) says nothing of `risk_band` (`base:1246`). `archived` (`base:1244`) has no canvas word. | #2385 (DD desk) defines "Cleared" | **NOW** for "Open" (`open`/`in_review`) and "Not opened" (unsigned: true).<br>• Signed with no case: "No case on record" only while the DD list is under 200 (the open is best-effort, `partnerDeals.ts:389`). At the cap it reads "Not in this read".<br>• `archived`: draw the word "Archived".<br>• A 423 or 5xx: "Could not be read", never "Not opened".<br>• **Do not draw "Cleared"** until #2385 sets the rule. |
| Row menu: Open, Terminate (active only) | | **E** `POST /deals/:id/terminate` (`admin_partners.ts:314-421`) | — | **NOW** |
| Pager "1–19 of [19]" + foot (`dc:443`, markup `dc:191-194`) | Total and pages | **P**:<br>• The exact total is the contracts read's `total` (`admin_contracts.ts:1220`), under cool-off (`wk/index.ts:655`).<br>• Σ of the six lists is exact while each list is under 200. | #2370 (paging) | **NOW**, client-side pages. The total comes from the contracts read, else Guard L. |

#### PI6 · Deal lightbox over Deals (`dc:467`; `LBX` `dc:391`; blocks `dc:395-402`)

| Block (dc) | What it draws | Worker source today | Owner / dependency | Now / placeholder |
|---|---|---|---|---|
| Frame + head (`dc:391`, `:393`) | 940-wide centred lightbox, "Esc to close", name, "Deal [#41] · email", type and state pills | **E** from the `GET /deals` row.<br>**P** by id: `GET /deals/:id/redemptions` returns the head's fields for one deal: id, type, state, partner name and email, code, tiers, `expires_at` (`admin_partners.ts:244-251`, `:280-286`). It lacks `activated_at`, `term_months`, `proposal`, `invitation_id`, `envelope_id` and termination.<br>The contracts detail resolves `partner_deal:<id>` (`admin_contracts.ts:1101-1112`), but returns a contracts projection (`:1381-1406`) and turns a D1 failure into a 404 "Contract not found" (`:1111`, `:1326-1327`). Do not use it. | #2370 "deal detail read"; Lightbox part (`fe/ui/index.js:35`) | **NOW** when opened from a loaded list. When opened by address, the head comes from the redemptions read, and the other blocks read "Not in this read" until the list loads. |
| Terms (`dc:396`) | Offer summary and terms; Tiers granted; Term; Started; Ends; days-used bar "[340] used · [25] left" | **E**: `proposal`, the stored copy of the chosen offer (`:308-310`), plus the dates. It is written at select, on insert or on a re-choice (`partner_onboarding.ts:272-294`).<br>**W**: the canvas text comes from `OFFERS` (`dc:380`), not `buildProposals` (`partnerDeals.ts:75-166`). Terms, tiers and terms in months differ by type.<br>**W**: the tier name, as on PI5.<br>12 months is 360 days, not 365 (`partnerDeals.ts:305`).<br>An unparsable stored proposal comes back as `{}` (`admin_partners.ts:309`, `:617-620`). | Owner (tier) | **NOW**: from `proposal.summary`/`terms` and the stored dates. The bar's length is `expires_at − activated_at`. An empty `proposal` reads "Not recorded". |
| Referral code (`dc:397`) | Code + Copy; "Redemptions [12]"; last 10 redeemers (name, date · tier, days left); "See all in Referrals" | **E**:<br>• The count comes from the row (`:302`).<br>• The list comes from `GET /deals/:id/redemptions` (`:240-291`): newest first, at most 500 (`:261`). That response's own `redemptions_count` is the capped `items.length` (`:288`).<br>• Days left exist only for rev-share deals (`:264-276`). | #2375 (Referrals route) | **NOW.**<br>• A referral deal shows "Granted until [date]" instead of days left.<br>• A list shorter than the row's count: "First 500". Never take the count from the redemptions response.<br>• A failure reads Unreadable. Today the modal refetches in a loop and then says "No redemptions yet." (`:918`). The loop: its effect depends on `onError` (`fe/pages/admin/PartnerInvitations.jsx:878-884`), which is a new arrow on every render (`:430`). |
| Agreement (`dc:398`) | "Signed [date]"; "Open in Contracts" | **P**: `activated_at`, or the envelope's `completed_at` from the e-sign list (`esign.ts:1018-1020`), which is under cool-off (`wk/index.ts:654`).<br>• Contracts has no record address: the selection is local state (`fe/pages/admin/contracts/ContractsDesk.jsx:24-26`). Link to `/admin/contracts?tab=partner-deals` (`:18`, `:52`). That tab's search is local state too (`fe/pages/admin/contracts/RelatedLists.jsx:9`), so the link cannot land filtered.<br>• **W** on arrival, in Contracts' Agreements list:<br>&nbsp;&nbsp;– terminated, voided and proposed deals map to "sent", and expired to "void" (`admin_contracts.ts:646-652`);<br>&nbsp;&nbsp;– the signed date is always null (`:700`);<br>&nbsp;&nbsp;– a failed read becomes no rows (`:682-685`). | — | **NOW with a caveat:**<br>• Signed: "Signed [activated_at]".<br>• Awaiting signature: "Out for signature since [envelope created_at]".<br>• Proposed: "Not sent". |
| Due diligence · NEW JOIN (`dc:399`) | Case: Open; KYB section: Waiting; "Open in Due diligence" | **P**:<br>• The case comes from the DD list (as PI5).<br>• KYB comes only from `GET /api/dd/cases/:uid` (`dd.ts:244-344`), section `kyb_entity` (`wk/services/dueDiligence.ts:51`). Its status is one of pending, assigned, in_review, completed or blocked (`base:1358`).<br>• That read decrypts findings and notes (`dd.ts:271-330`) and is under cool-off.<br>• The link `/admin/due-diligence/:uid` exists (`fe/App.jsx:2852`). | #2385 (words); #2384 (KYB) | **NOW**, with one detail call when the lightbox opens, never one per table row |
| Obligations · NEW JOIN (`dc:400`) | Partner agreement Satisfied; KYB Pending; KYC and Accreditation "Not needed for this deal type" | **P/W**: no admin read returns the rows.<br>• `GET /api/trust/score/:userId` (`wk/routes/trust.ts:173-203`) **writes first**: it seeds the target's obligations (`:184-189`) before it reads (`:190-192`).<br>• The batch read does not write (`:232-272`). It returns `missing` and `required_total` to an admin (`:267-269`).<br>• Only `required` rows are counted (`:194`), and the waived ones are `required = 0` (`partnerDeals.ts:406-418`), so "Not needed" cannot be read.<br>• "Satisfied", read as absence from `missing`, is wrong if the best-effort seed failed (`partnerDeals.ts:401-437`).<br>• Obligations belong to the member, not the deal. | #2370 deal detail read; #2384 | **Do not draw per-key states** until a read returns the rows.<br>**NOW** only: "Outstanding: [keys]" via `trustScoreBatch([user_id])` (`fe/lib/api.js:3957`). With `required_total` 0 it reads "No obligations recorded", never "None outstanding". |
| Invitation (`dc:401`) | "Sent by [Admin] on [date] · signed [date]"; "Open invitation" | **E** via `invitation_id` → the `GET /invitations` row: `invited_by_name`, `created_at`, `signed_at` (`admin_partners.ts:107-110`). For a signed deal outside the newest 200, `GET /invitations?email=<partner_email>` finds it (`:100`, `:104`). Activation matched the account to the invitation by that address (`partnerDeals.ts:242-245`). | — | **NOW.**<br>• Signed and outside the newest 200: a targeted `?email=` read, matched on `id === deal.invitation_id`.<br>• Unsigned and outside it: "Not in this read".<br>• "Sent on" is the first send. A resend changes only `expires_at` and the stage (`:137-139`). |
| History · NEW (`dc:402`) | "Activated on signing [date]". The #2370 body adds "terminated with reason and by whom". | **P**:<br>• `activated_at`, `terminated_at` and `termination_reason` are on the row (`:299-300`).<br>• `terminated_by_user_id` is stored (`mig/028_partner_deals.sql:72`) but not selected (`:297-300`).<br>• Audit rows exist (`partnerDeals.ts:455-464`; `admin_partners.ts:410-415`). Only HQ's governance feed reads `admin_audit_log`: Super Admin only, unfiltered, newest 60 across every action (`wk/routes/admin_security.ts:425`, `:548-554`, `:613-614`, `:665-666`). Its `activity_logs` arm is a fixed action list that leaves partner actions out (`:448-455`). | #2370 deal detail read | **NOW** for activated, terminated and reason. "By: Not read here yet". |
| Footer: Terminate, active deals only (`dc:467`) | | **E** | — | **NOW** |

#### PI7 · Referrals (`dc:468`)

| Block (dc) | What it draws | Worker source today | Owner / dependency | Now / placeholder |
|---|---|---|---|---|
| Tiles (`dc:455`) | All time [64]; last 90 days [27]; rev-share windows open [9]; closing within 30 days [3] | **P**:<br>• All time: Σ `redemption_count` over the uncapped contracts read (`admin_contracts.ts:1203-1204`), under cool-off. The fallback is Σ `redemptions_count` over the six lists (`admin_partners.ts:302`).<br>• The other three need a **fan-out**: one `GET /deals/:id/redemptions` (`:240-291`) per deal with redemptions.<br>**W** for "windows open": a window keeps counting on terminated and expired deals. The read ignores the deal's state (`:264-276`), and so does the cron (`partnerDeals.ts:762-772`). | #2370 "cross-deal redemptions read"; **owner**: does a window survive termination? | **NOW**: All time exact from the contracts read; the rest under Guard F. Until the owner decides, count windows on active deals only, or label "incl. ended deals". |
| C4 Referral redemptions per week · NEW AGGREGATE (`dc:371`) | Two lines over 12 weeks: Referral solid, Deal-sourcing rev-share dashed; hollow current week | **P**: from the fan-out. Bucket `redeemed_at`; the series is `attribution_kind` (`mig/028_partner_deals.sql:89`; set at `partnerDeals.ts:530`). | Chart part: two series. Extend under `D915.md:171`. | **NOW under Guard F** |
| C6 Rev-share windows closing (`dc:453-454`) | One bar per open window, days left of 365, amber at 30 or less, label "member · partner" | **P**: fan-out over deal-sourcing deals, using `revshare_window_remaining_days > 0`, `redeemer_name` and `deal.partner_name` (`:255-257`, `:280-286`) | Owner (as for the tiles) | **NOW under Guard F** |
| Every redemption · NEW READ (`dc:444-452`) | Search member, partner or code; Attribution, Partner, Window, Date range, Sort; columns Member (name, role), Partner and deal, Code, Registered, Tiers given, Granted until, Attribution, Window; "1–25 of [64]"; foot "Payouts on closed deals are handled in Contracts." | **P** from the fan-out: name, email, `redeemed_at`, tiers, `granted_until`, `attribution_kind`, window (`:255-277`).<br>**P** member role: the redemptions read does not select it (`:255-257`). It can be had only as a second fan-out:<br>• `GET /api/admin/users/:user_id/profile`, one call per member, which also returns 100 activity rows (`wk/routes/admin.ts:155-172`, `:197-205`);<br>• or `GET /api/admin/users`, paged 200 at a time (`:59-60`, `:89`), or with `q` of at least 2 characters (`:80-82`).<br>**W** "Granted until" after termination or expiry: the grant was revoked earlier (`admin_partners.ts:383-406`), and `granted_until` is the deal's end as of the redemption (`partnerDeals.ts:505`).<br>**W** "Tiers given: Founder Pro" (as PI5).<br>**Payouts:** settlements are HQ only (`wk/routes/partner_settlements.ts:16-19`). Creating, editing and issuing one require an **active** deal (`:33-35`, `:57-69`, `:87-90`, `:120-121`). | #2370 cross-deal read; owner (payouts after a deal ends) | **NOW:**<br>• Role: "Not read here yet" (a second fan-out is not worth it).<br>• Granted until, on an ended deal: "Ended with the deal [date]".<br>• Window on a plain referral: "No window" (not "—").<br>• Payout link: `/admin/contracts?tab=partner-deals`, with its Settlements button (`fe/pages/admin/contracts/RelatedLists.jsx:22`, `:26`). Leave it out on a branch, and do not promise a payout for a window whose deal has ended. |

#### PI8c · Terminate (`dc:475`, `termDlg` `dc:413`)

| Block (dc) | What it draws | Worker source today | Owner / dependency | Now / placeholder |
|---|---|---|---|---|
| Title + "Esc to close" (`dc:413`, `:265`) | "Terminate the Services partnership with Lio Testwell?" | **E** `deal_type` + `partner_name`; fall back to `partner_email`, since an existing user's name may be null | — | **NOW** |
| Sentence 1 | "His Founder Pro grant ends now unless he pays for a plan." | **W**:<br>• `founder_pro` is not a plan (PI5).<br>• A `partner` account bypasses the founder and investor gates anyway (`requireTier.ts:32`, `:70`; `requireInvestorTier.ts:32`, `:94-102`).<br>• Terminate reverts only a tier that still matches and is still `partner_grant` (`admin_partners.ts:344-369`).<br>• Activation overwrote any paid plan with no guard (`partnerDeals.ts:307-313`, `:324-328`). A paying founder keeps the founder role (`:256-258`), and `founder_pro` ranks as free (`requireTier.ts:61-65`). So signing drops them below their paid plan at every founder gate. Only `growth` and `studio` count as paid (`wk/services/planAllowance.ts:191`). | Owner + a Worker fix | **Do not draw** as written. NOW: "The tiers this deal granted him end now, where they are still the deal's grant." |
| Sentence 2 | "[12] members who registered with his code lose the tiers it gave them, unless they pay." | **P**:<br>• [12] = `redemptions_count` (`:302`), one row per member (`UNIQUE`, `mig/028_partner_deals.sql:91`).<br>• Who will actually lose is **N**: the revoke is guarded on `partner_referral` (`:389-391`, `:401-403`).<br>• `founder_pro` gave founder redeemers nothing to lose. The investor tier gates only `investor` accounts (`requireInvestorTier.ts:102`). | #2370 "terminate impact preview" | **NOW:** "[12] members registered with his code. Those still on the grant it gave lose it." No "will lose" number. |
| "This cannot be undone." | | **E**: the only write that sets a deal `active` is activation (`partnerDeals.ts:335`). Its only caller is the e-sign hook (`esign.ts:1590-1593`), which runs once per envelope (`:1554-1560`). | — | **NOW** |
| Reason · REQUIRED + "turns on once a reason is typed" | Textarea; disabled button | **E**: 400 without a reason (`admin_partners.ts:318-319`); silently cut at 500 characters (`:318`). Today's client gate: `fe/pages/admin/PartnerInvitations.jsx:858`. | — | **NOW**, with a "/ 500" counter |
| Buttons and result | Cancel / Terminate deal | **E** write. Its reply misleads:<br>• `redemptions_revoked` counts tier rows, not members (`:393`, `:405`). It is 0 if the redeemer read fails (`:379-382`), and a partial count if an update throws mid-loop (`:383-408`).<br>• The partner's own two revokes swallow their failures and are not reported (`:355`, `:368`).<br>• `tiers_revoked` only means the deal granted a tier (`:418`). Every draft sets `granted_tier_founder` (`partnerDeals.ts:95`, `:112`, `:128`, `:145`, `:157`), so it is always true.<br>• Refusals: 409 (`:331`); 423 when frozen (`wk/index.ts:1473`). | — | **NOW**: the result shows inline as "Deal terminated." Do not turn the two fields into member counts; today's toast does (`PartnerInvitations.jsx:822-825`). |

#### PI10 · No permission and refusals (`dc:482-483`)

| Block (dc) | What it draws | Worker source today | Owner / dependency | Now / placeholder |
|---|---|---|---|---|
| PI10a left (`dc:482`) | "This page is for studio admins." + "Go to your home" | The Worker's 403 `Admin required` exists (`wk/auth.ts:525`), but the route redirects first: `RoleGuard` → `<Navigate>` (`fe/App.jsx:1819-1834`, `:1831`; `guard` `:2219-2225`). | Recorded as in `D915.md:23` | **Cannot be drawn.** Record it; do not build it. |
| PI10a right (`dc:482`) | "HQ has paused this studio's admin access … No studio data is shown while access is paused." + Contact HQ | **W**, because neither mechanism hides data:<br>• **The HQ freeze** is per admin, applies to writes only, and does nothing on a branch (`wk/auth.ts:568-590`). Reads pass, and the code says why (`:543-546`, `:569-570`). It refuses with 423 `admin_frozen` (`wk/index.ts:1473`), explained by the shell's `AdminFrozenBar` (`fe/App.jsx:3789`).<br>• **Branch suspension** (`wk/auth.ts:752-795`) is never called by `admin_partners.ts`, `partner_onboarding.ts` or `partnerDeals.ts` (0 matches each). Events, for one, calls it (`wk/routes/admin_events.ts:214`, `:297`). | Owner: should partner writes respect suspension? (a Worker fix) | **Do not draw "No studio data is shown".** NOW: rely on the shell bars (`fe/App.jsx:3789`, `:3794`). On a 423, say inline that changes are refused and reading still works. |
| PI10b Capital locked (`dc:483`, eye "NEW, NEEDS HQ PROGRAM GRANTS") | "HQ has not granted Capital partnership to this studio." | **N**: no grant record by licence and deal type exists. Create accepts any of the five types (`admin_partners.ts:54-57`). | #2376 (Program grants) | **Do not draw** until #2376 stores grants and the Worker refuses an ungranted type. |
| PI10b refused terminate | "This deal is no longer active, so it cannot be terminated." | **E**: 409 `Deal is not active or not found` (`admin_partners.ts:331`). Caveat: two racing terminates both pass. The check (`:327-331`) is followed by an UPDATE whose `changes` is never read (`:333-338`). | — | **NOW** |
| PI10b refused revoke | "This invitation is already signed or revoked." | **E**: 409 (`:163-165`) | — | **NOW** |

#### PI11 · Phone 390 wide (`dc:484-488`)

| Block (dc) | What it draws | Worker source today | Owner / dependency | Now / placeholder |
|---|---|---|---|---|
| Phone frame (`dc:35-41`, `:492`, `:512`, `:516`) | Top bar; tabs scroll sideways; no sidebar or spine | — | — | **NOW** |
| PI11a "New invitation", full width (`dc:485`) | | **E** `POST /invitations` | — | **NOW** |
| PI11a tiles T1 (`dc:353`) | Open invitations · oldest sent; Lapsed, not closed (! Needs you); Signed, 90 days; Days sent→signed (median) | **P** from `GET /invitations` (200 rows, `admin_partners.ts:114`).<br>• Open = not signed, revoked or expired, and `!is_expired` (`:120`).<br>• "Oldest sent" is the first send (`:137-139`).<br>• Lapsed = `is_expired` and not closed, or `expired`, which only activation writes (`partnerDeals.ts:229-231`).<br>• Signed and the median come from `signed_at − created_at`. | — | **NOW under Guard L** |
| PI11a tiles T2 (`dc:354`) | Active · [2] end within 30 days; Awaiting signature; Redemptions, 90 days; Emails not delivered (NEW) | **E** active.<br>**E/W** awaiting: the PI5 state caveats apply.<br>**P** redemptions: fan-out (Guard F).<br>**P** delivery: the invitation has no column (`mig/028_partner_deals.sql:9-29`). `email_sent` is stored in the audit details at create and resend (`admin_partners.ts:86-89`, `:147-149`), in both audit stores (`wk/services/adminAudit.ts:98`, `:110`). No route a studio admin can call reads it. It records whether Gmail accepted the send (`wk/services/email.ts:366-370`, `:426-437`), not delivery. | #2370 (store delivery) | Last tile: **Not read here yet**. When a read exists, word it "not sent", never "not delivered". |
| PI11a Needs you · 3 of [10] (`dc:357-360`, `:364`) | Lapsed → Resend; Agreement blocked → Open in Contracts; Not delivered → Copy link (NEW) | **P** Lapsed: from the list. Resend today resets the stage to `sent` (`admin_partners.ts:137-139`).<br>**P/N** Agreement blocked: `selected` + `proposed` cannot tell a refusal from "not tried yet". Only the unfilled-fields refusal leaves a row, an `activity_logs` row nothing reads (`partner_onboarding.ts:363-364`). The no-body refusal leaves none (`:367-368`).<br>**P** Not delivered: as T2. | #2390 (lanes); #2370 "agreement ready" signal | Count only the rows that exist.<br>• Not delivered: **Not read here yet**.<br>• Agreement blocked: **wait for** the signal. Or use the page-wide probe `GET /api/legal/esign/templates/partner_services` (`esign.ts:963-998`, under cool-off). A no-body refusal there (`:977-982`) means not ready. Otherwise every `fields[].key` (`:983-991`) must be one of the five that finalize fills (`partner_onboarding.ts:351-357`) or an automatic key (`esign.ts:261`). |
| PI11a C1 (`dc:365-366`) | Stage bars "[n] · oldest [d] days"; "Closed: Signed · Lapsed · Revoked"; foot | **P**: counts per stored `status` (vocabulary `mig/028_partner_deals.sql:18`).<br>**W** for a resent invitation: resend resets any stage to `sent` (`admin_partners.ts:138`), so it counts at Sent or Opened. Restore the stage from its deal row (`proposed` → Offer chosen, `awaiting_signature` → Agreement out).<br>**P** time in stage: the invitation has no stage columns (`mig/028_partner_deals.sql:9-29`). The onboarding steps are `activity_logs` rows with the invitation id and `created_at` (`partner_onboarding.ts:91-98`, `:110`, `:208`, `:229`, `:300`, `:379-381`; `base:50`), and no route reads them.<br>**W** foot: a lapsed invitation **keeps** its stage, since only activation overwrites it (`partnerDeals.ts:229-231`). A revoked one loses it (`admin_partners.ts:158-162`). | — | **NOW**: label it "days since sent" and reword the foot |
| PI11b toolbar (`dc:486`) | Search name or email; Filters · [1] (bottom sheet); Sort | **P**: the server's email LIKE is unescaped (`admin_partners.ts:104`); name search is client-side only | — | **NOW** client-side; the sheet is `PhoneSheet` (`fe/ui/phone/PhoneSheet.jsx:19`) |
| PI11b cards (`dc:486`, rows `dc:414-421`) | Name, stage pill, "Sent [date]", "[n] offered" | **E** `recipient_name`, `status` + `is_expired`, `created_at`, `allowed_deal_types` (`:107-120`). The stage pill carries C1's resend caveat.<br>**W** "[n] offered" above three, or with duplicates. The invitee sees only the first three (`partnerDeals.ts:84`), and duplicates are kept (`admin_partners.ts:54-57`).<br>An unparsable stored list comes back as `[]` (`:118`, `:613-616`). | #2370 (cap at three) | **NOW**: n = the first three distinct types, and an empty list reads "Not recorded". A null name reads "No name given" (`dc:420`). |
| PI11c head (`dc:487`) | "‹ Invitations" → `/admin/partner-invitations/invitations`; name; stage pill; "email · sent by … on …" | **E** from the invitation row. **P** by address: `GET /invitations` has no id filter and stops at 200 (`admin_partners.ts:99-114`). | #2375 (the address) | **NOW** once the route exists. An invitation outside the newest 200 reads "Not in this read". |
| PI11c Progress (`dc:384-385`) | Sent and Opened dates; three NEW "Date not recorded"; Agreement out and Signed "Not reached"; "Link valid until" | **E**:<br>• `created_at`;<br>• `viewed_at`, which a re-open after a resend overwrites (`partner_onboarding.ts:106-109`);<br>• `signed_at`; `expires_at`.<br>**E** Offer chosen: the deal row's `created_at` from `GET /deals` (`admin_partners.ts:300`). It is the first choice: a re-choice updates the same row (`partner_onboarding.ts:272-294`).<br>**P** Agreement out: the envelope's `created_at` (`esign.ts:1018-1019`, under cool-off).<br>**P** Profile done and Offers shown: `activity_logs` rows (`partner_onboarding.ts:208`, `:229`), with no reader. | #2370 (stage dates, or derive them from those rows, as its body says) | **NOW** for Offer chosen and Agreement out. Profile done and Offers shown: **Not read here yet**, not "Not recorded". |
| PI11c Chosen offer and agreement (`dc:388`) | Offer; Agreement: Not sent; amber "not ready" note; Open in Contracts | **P**: the deal by `invitation_id` from the `proposed` list, plus `proposal`. "Not ready" cannot be told apart, as in Needs you. | #2370 signal | **NOW** for the offer and "Not sent". The "not ready" note **waits for** the signal or the probe. Link `/admin/contracts?tab=templates`. |
| PI11c Their answers · NEW READ (`dc:386-387`) | 10 facts; Profile check: Waiting; "Open in Partner profiles" | **P**: `GET /api/profiling/admin/:email` (`wk/routes/profiling.ts:498-521`) returns the whole `partner_profiles` row, the ten facts and `admin_status` included (`:504-509`).<br>• Keyed by email. Onboarding folds into any earlier profile for that address (`partner_onboarding.ts:168-176`), so check `invitation_id` before drawing.<br>• It is a **logged** read (`profiling.ts:516`). | #2380 (no route yet); owner: is a logged read on open acceptable? | Owner decision. Otherwise: "Not read here yet". |
| PI11c action bar (`dc:487`, markup `dc:202`) | Copy link / Resend / Revoke | **E**: link (`admin_partners.ts:119`), resend (`:125-151`), revoke (`:153-207`) | — | **NOW.** Until the Worker fix, the resend copy must say the stage goes back to Sent. |
| PI11d toolbar + cards (`dc:488`) | Search partner or code; Filters · [1]; Sort: Ends soonest; cards with name, state, deal type, "[n] days" | As PI5 | — | **NOW** |
| PI11d filter sheet (`dc:488`) | STATE: Active, Awaiting, Offer chosen, Ended; DEAL TYPE (`dc:338`); ENDS WITHIN 30/60/90; Clear / "Show [2] deals" | Client-side. "Ended" = expired + terminated + voided (`dc:370`). | **Owner**: desktop draws six state chips (`dc:443`), the phone four | **NOW.** "Show [n]" is exact only under Guard L. |

---

#### Figures that would be wrong today

1. **"Founder Pro" as a tier (PI5, PI6, PI7, PI8c).**
   - `founder_pro` is not in the founder ladder (`wk/middleware/requireTier.ts:28-30`), and an unknown tier ranks as free (`:61-65`).
   - The partner role bypasses both gates (`requireTier.ts:32`, `:70`; `requireInvestorTier.ts:32`, `:94-102`). The investor tier gates only `investor` accounts (`requireInvestorTier.ts:102`).
   - So "lose the tiers it gave them" is false for founder redeemers, and for the investor tier it holds only for investor redeemers.
2. **"Unless he pays for a plan" (PI8c).** Activation overwrote any paid plan with no guard (`partnerDeals.ts:307-313`, `:324-328`). A paying founder keeps the founder role (`:256-258`), so on signing they rank as free (`requireTier.ts:61-65`).
3. **Terminate's numbers (PI8c).**
   - "[12] members … lose" over-claims: the revoke is guarded (`admin_partners.ts:389-391`, `:401-403`).
   - `redemptions_revoked` counts tier rows (`:393`, `:405`). It is 0 after a failed read (`:379-382`) and partial after a failed update (`:383-408`).
   - `tiers_revoked` only means the deal granted a tier, which every deal does (`:418`; `partnerDeals.ts:95`).
4. **Term arithmetic.**
   - A month is 30 days (`partnerDeals.ts:304-305`), so 12 months is 360 days, not 365.
   - Any end date computed from `term_months` is wrong.
   - Before the 04:40 sweep, days left go negative (`wk/index.ts:2323`).
5. **"Awaiting signature".**
   - After a signed envelope whose activation threw (`partnerDeals.ts:240-264`, `:333-337`; `esign.ts:1590-1593`).
   - On a lapsed invitation, where signing voids the deal (`partnerDeals.ts:226-238`; the signing link lasts 7 days, `esign.ts:63`) unless an admin resends first (`admin_partners.ts:132-139`).
6. **"Offer chosen, not sent" on a lapsed invitation.** It cannot proceed until an admin resends (`partner_onboarding.ts:59-64`; `admin_partners.ts:132-139`).
7. **"Voided" with no reason.** One word covers three paths:
   - admin revoke, audited by invitation (`admin_partners.ts:176-181`, `:202-205`);
   - a revoked invitation at activation, a `console.warn` only (`partnerDeals.ts:217-225`);
   - a link that lapsed before signing, a `console.warn` only (`:226-238`).
8. **"Granted until" and the rev-share window on ended deals** (`partnerDeals.ts:505`; `admin_partners.ts:264-276`, `:383-406`; cron `partnerDeals.ts:762-772`).
9. **DD "Cleared" from `status` alone** (`base:1244`, `:1246`). Matching DD to a deal fails when the member has two cases (`partnerDeals.ts:368-371`).
10. **Obligations "Satisfied" / "Not needed" inferred from `missing[]`** (`wk/routes/trust.ts:194-199`; seeding is best-effort, `partnerDeals.ts:401-437`). "None outstanding" on an unseeded member (`required_total` 0).
11. **Contracts views.**
    - "Open in Contracts": the Agreements union shows terminated, voided and proposed partner deals as "sent" and expired ones as "void". The signed date is always null, and a failed read shows no rows (`admin_contracts.ts:646-652`, `:700`, `:682-685`).
    - Payouts: a settlement can be drafted, edited or issued only while the partner deal is active (`partner_settlements.ts:33-35`, `:57-69`, `:120-121`). A rev-share window that outlives its deal has no payout path.
12. **`GET /deals?status=all` returns nothing** (`admin_partners.ts:295`, `:305`). The per-deal redeemer list stops at 500 (`:261`), and its own `redemptions_count` is that capped length (`:288`). The row's count is uncapped (`:302`).
13. **PI10a "No studio data is shown while access is paused".** Reads are served by design (`wk/auth.ts:543-546`), and branch suspension is never checked on these routes.
14. **Phone.**
    - "[n] offered" above three (`partnerDeals.ts:84`).
    - C1's stage counts and the card pills after a resend (`admin_partners.ts:138`).
    - C1's "oldest [d] days" read as time in a stage.
    - C1's foot about lapsed invitations.
15. **Firm names in the Partner column.** `users.name` is what activation wrote, usually a person (`partnerDeals.ts:260-263`).
16. **The canvas's offers are not the store's** (`dc:380` vs `partnerDeals.ts:85-163`). For example, Capital partnership: the canvas draws Investor Professional for 12 months; the store grants `founder_pro` plus professional or institutional for 24 months (`:135`, `:145-147`). Draw `proposal`, never `OFFERS`.

#### Buildable NOW with no Worker change

Every API client already exists:
- `adminPartners.listInvitations`, `listDeals`, `listTopDeals`, `dealRedemptions`, `terminateDeal`, `listFirmLinks` (`fe/lib/api.js:1224`, `:1237-1254`)
- `adminListPartnerDeals` (`:2070`), the uncapped contracts read
- `esignList` (`:2396`)
- `trustScoreBatch` (`:3957`)
- `dd.listCases` / `getCase` (`:5181`, `:5186`)
- `adminGetProfile` (`:2389`), only if the owner accepts the logged read

So no drift-test change is needed.

**Admin GETs fail truthfully, with two exceptions to avoid.**
- `/api/admin/partners` reads, the DD list and the e-sign list have no catch, so a D1 error is a 5xx (`admin_partners.ts:215-312`; `dd.ts:124-152`; `esign.ts:1001-1027`).
- The contracts list returns a coded 503 (`admin_contracts.ts:1209-1212`).
- The exceptions:
  - the contracts detail for `partner_deal:<id>` turns a failure into a 404 (`:1111`, `:1326-1327`);
  - the Agreements union turns one into no rows (`:682-685`).
- Otherwise the hiding is on the client, so these rules are enough.

**Guard L (lists that stop silently).** A list that returns exactly its cap is incomplete, and every figure derived from it reads "First 200", never a total. The caps:
- each `GET /deals?status=X`: 200
- `GET /invitations`: 200
- per-deal redeemers: 500
- `GET /links`: 500
- DD cases: 200
- envelopes: 200
- `GET /api/admin/users`: 200 a page

The contracts partner-deals read has no cap: its `total` is exact, at 500 rows a page (`admin_contracts.ts:1220`; `contractListQuery.ts:18`). It gives the Deals and Referrals totals, C5's "of [n]", and the pager, whenever no cool-off holds.

When a list is under its cap, client-side search, filters, sort, pages and counts are exact. That covers:
- PI5 and PI11d: six status calls build the table, chips, pager, C5, cards and filter sheet.
- PI5 Top deals: one call.

**Guard F (fan-out, the Guard-G-like rule for PI7, PI11a's redemption tile and PI6's redeemers).**
- Fan out `GET /deals/:id/redemptions` only for deals with redemptions. Take that set from the contracts read (`redemption_count > 0`, uncapped), else from the six lists.
- A figure is exact only when all three hold:
  - the deal set is complete: the contracts read succeeded, or all six lists are under 200;
  - every per-deal read succeeded;
  - each read's `items.length` equals that deal's uncapped count (`admin_partners.ts:302`; `admin_contracts.ts:1203-1204`).
- If any read failed: "Could not be read for [k] of [m] deals". Never a smaller number.
- If the third check fails: "First 500 for this deal".
- That gives PI7's tiles, C4, C6 and "Every redemption" (role left out) with no new route. The cost is one call per deal that has redemptions.

**Joins safe on the client:**
- deal → invitation (`invitation_id`), for unsigned names, "Sent by" and lapse. Use `?email=` for a signed deal outside the newest 200.
- deal → envelope (`envelope_id === id`, never `deal_id` alone).
- deal → DD case (`subject_id = user_id`), for "Open" and "Not opened" only; `subject_label` is the firm at signing.
- user → firm (`GET /links`, partner-role accounts only).
- PI6 KYB: one detail call when the lightbox opens.

Each joined row missing from its capped list reads "Not in this read".

**Writes:**
- PI8c with a 500-character counter and an honest inline result.
- PI10b's two 409s, worded as on the canvas.
- PI11c's action bar, with copy that matches today's resend.

**Timestamps:** parse D1's zone-less stamps as UTC. The precedent is `parseStamp` (`fe/pages/admin/events/eventsDeskModel.js:130-136`). Move it to `fe/ui/` in its own commit. That follows `D915.md:171`'s rule, which is written for chart parts.

#### Honest placeholders

**Not recorded** (nothing stores it):
- Why a deal was voided on the two activation paths: only a `console.warn` (`partnerDeals.ts:223`, `:236`). Admin revoke is audited (`admin_partners.ts:202-205`).
- Whether an email was delivered, as opposed to accepted by Gmail (`email.ts:426-437`).
- A per-licence deal-type grant (PI10b).
- Whether an "Agreement blocked" invitation was refused by the no-body path (no row, `partner_onboarding.ts:367-368`).

**Not read here yet** (stored, but no route a studio admin can call returns it):
- Who terminated: `mig/028_partner_deals.sql:72`, not selected at `admin_partners.ts:297-300`. The audit row is visible only on HQ's governance feed (`admin_security.ts:613-614`).
- Whether an invitation email was sent: `email_sent` in the audit details (`admin_partners.ts:86-89`, `:147-149`). This is PI11a's tile and Needs-you row.
- The Profile done and Offers shown dates (PI11c, C1's time in stage): `activity_logs` rows (`partner_onboarding.ts:208`, `:229`).
- The unfilled-fields refusal behind "Agreement blocked" (`partner_onboarding.ts:364`).
- Deal and invitation history beyond the deal's own dates.
- A redeemer's role.
- Obligation rows per key.
- The KYB section in the Deals table: it is read only when the lightbox opens.
- Their answers on PI11c, if the owner declines a logged read on open (`profiling.ts:516`).

**Could not be read:**
- Any 5xx from the reads above, including `partner_deals_unreadable` (`admin_contracts.ts:1211`).
- A recovery cool-off 423 (`recovery_cool_off_active`, `wk/middleware/recoveryCoolOff.ts:25-37`) on `/api/dd`, `/api/legal/esign` and `/api/admin/contracts` (`wk/index.ts:654-660`). These blocks must say so, never "Not opened" or "Not sent":
  - PI5's DD column and the exact Deals and Referrals totals (fall back to Guard L);
  - PI6's Agreement and Due-diligence blocks;
  - PI11c's Agreement out date and readiness note.

#### How the absences were established

All with `grep`/`rg` over the HEAD tree.
- **`founder_pro`:** with word boundaries over `wk/` and `fe/`, it appears only in `partnerDeals.ts:95-157`. The only founder-tier "paid" tests elsewhere use `growth` and `studio` (`wk/services/planAllowance.ts:191`; `wk/services/planSubscription.ts:116`).
- **Deal-type grants:** `capital_partnership|deal_sourcing_revshare` appears only in `partnerDeals.ts`, `admin_partners.ts`, `partner_portal.ts` and an `index.ts` comment (`:2338`). `licenceTerms.ts` and `licencePush.ts` never mention partners. "program grant" appears nowhere in `wk/`, `fe/` or the decisions.
- **Branch suspension:** `requireBranchNotSuspended|branchOf` gives 0 matches in each of the three partner files.
- **Who reads obligations for another user:** only the two trust-score routes (`trust.ts:190-192`, `:246-250`). The other `legal_obligations` reads are self-reads or sweeps (`trust.ts:58`, `:655`; `wk/services/trust.ts:486`, `:535`, `:1190`).
- **Single-deal reads:**
  - `GET /deals/:id/redemptions` returns a subset by id (`admin_partners.ts:244-251`).
  - The contracts detail resolves `partner_deal:<id>` but hides failures (`admin_contracts.ts:1101-1112`).
  - Contracts has no record address (`ContractsDesk.jsx:18-26`).
- **Uncapped partner-deal read:** `GET /api/admin/contracts/partner-deals` has no LIMIT (`admin_contracts.ts:1198-1208`).
- **Readers of `partner_referral_redemptions`:** besides the two partner files, only `partner_portal.ts:57`, `:63` (the partner's own) and `admin_contracts.ts:1203`. There is no cross-deal admin list.
- **Readers of `partner_invitations`:** `admin_partners.ts:111`, `:129` and `partner_onboarding.ts:50`, plus two existence checks (`wk/services/activationFunnel.ts:195`; `wk/services/onboardingChecklist.ts:395`).
- **Audit readers:** `admin_audit_log` is read unfiltered only by the Super Admin governance feed, newest 60 (`admin_security.ts:425`, `:548-554`, `:613-614`). Its `activity_logs` arm reads a fixed list without partner actions (`:448-455`).
- **Every `partner_deals` status write:**
  - proposed: inserted at `partner_onboarding.ts:288-290`;
  - voided: `admin_partners.ts:177`, `partnerDeals.ts:220`, `:233`;
  - awaiting: `partner_onboarding.ts:374`;
  - active: `partnerDeals.ts:335`;
  - expired: `:498`, `:577`;
  - terminated: `admin_partners.ts:334`.
- **Issues:** #2369, #2375, #2376, #2380, #2384, #2385 and #2390 were read through the GitHub REST API (titles). #2370 was read for its body too. Its body already names the audit-only delivery result and the `activity_logs` stage rows.

---

#### Corrections

1. **Tree paragraph.** HEAD is now `fbbb4c8`, which touches no cited file. "The only `fe/` file cited here that it touches is App.jsx" was wrong: `eventsDeskModel.js` (the `parseStamp` precedent) does not exist at `0b85c2b`, and `D915.md:171` was `:165` there. `App.jsx:3497` was listed but is cited nowhere; I dropped it.
2. **"No totals anywhere" (tab strip, pager, C5, PI7 All time) was wrong.** `GET /api/admin/contracts/partner-deals` reads every deal with no LIMIT, with an exact `total` and an uncapped redemption count per deal (`admin_contracts.ts:1198-1208`, `:1203-1204`, `:1220`). It is under cool-off. Guard F's deal set can come from it too.
3. **"Emails not delivered" was marked N, "Not recorded".** `email_sent` is stored at create and resend in both audit stores (`admin_partners.ts:86-89`, `:147-149`; `adminAudit.ts:98`, `:110`), and the #2370 body says so. It is "Not read here yet". What it records is sent or not sent, not delivery.
4. **PI11c's step dates were marked N, "Not recorded".**
   - Offer chosen is the deal row's `created_at`, readable now (`admin_partners.ts:300`).
   - Agreement out is the envelope's `created_at`.
   - Profile done and Offers shown are `activity_logs` rows with no reader (`partner_onboarding.ts:208`, `:229`).
5. **"Audit rows … nothing reads them" was wrong.** HQ's governance feed reads `admin_audit_log`: Super Admin only, unfiltered, newest 60 (`admin_security.ts:425`, `:548-554`, `:613-614`).
6. **"Why a deal was voided: only a `console.warn`."** True for the two activation paths only. Admin revoke is audited (`admin_partners.ts:202-205`).
7. **"Offer chosen on a lapsed invitation … can never proceed" was wrong.** A Resend renews the link (`admin_partners.ts:132-139`), and the same applies to Awaiting signature.
8. **PI6 head by address was marked N, "Not in this read".** `GET /deals/:id/redemptions` returns the head's fields by id (`:244-251`, `:280-286`). The contracts detail by `partner_deal:<id>` exists but hides failures as a 404; flagged.
9. **PI6 Invitation outside the newest 200.** For a signed deal, a targeted `GET /invitations?email=` read recovers it (`:100`, `:104`; `partnerDeals.ts:242-245`).
10. **Firm names.** The DD case's `subject_label` carries the organization at signing (`partnerDeals.ts:368-371`; `dd.ts:144`). `GET /links` lists only partner-role accounts (`admin_partners.ts:539`), and an existing member keeps their role.
11. **Terminate's reply.**
    - `redemptions_revoked` is 0 after a failed read and partial after a failed update, not "0 after a swallowed failure".
    - The partner's own revoke failures go unreported.
    - `tiers_revoked` is always true today.
12. **Sharper W.** Activation drops a paying founder to free at every founder gate (`partnerDeals.ts:256-258`, `:307-313`; `requireTier.ts:61-65`).
13. **The investor tier gates only `investor` accounts** (`requireInvestorTier.ts:102`). "Lose the tiers" holds for the investor tier only for investor redeemers.
14. **A figure the canvas defines differently.** The canvas's per-type offers (`dc:380`) are not `buildProposals`, for example Capital partnership's tiers and term (`partnerDeals.ts:135`, `:145-147`). Added to PI5, PI6 and Figures 16.
15. **C1 counts and the PI11b stage pills.** Resend resets the stored stage to `sent` (`admin_partners.ts:138`); restore it from the deal row.
16. **Wrong lines.**
    - Trust: the route is `trust.ts:173-203`, not `172-201`; the seed is `:184-189`, not `186-188`; the required filter is `:194`, not `:193`; the batch is `:232-272`, not `232-283`; the reads are `:190-192` and `:246-250`, not `189-191` and `251-256`.
    - `buildProposals` is `partnerDeals.ts:75-166`.
    - The proposal is also written on insert (`partner_onboarding.ts:287-294`).
    - The contracts route is `:1187-1224`.
17. **DD.** "No case on record" holds only while the DD list is under 200. `archived` had no mapping.
18. **Obligations.** "Outstanding" on an unseeded member must read "No obligations recorded" (`required_total` 0).
19. **Member role was marked N.** It is P: a per-member `GET /api/admin/users/:user_id/profile` (`admin.ts:155-172`) or the paged list (`:59-60`, `:89`), not only `?q=`.
20. **PI11c opened by address** is capped: `GET /invitations` has no id filter and stops at 200.
21. **Agreements union on arrival.** It maps proposed to "sent" and expired to "void", and shows no rows on a failed read (`admin_contracts.ts:648-651`, `:682-685`).
22. **The agreement-ready probe** now has a concrete rule (`esign.ts:977-991`, `:261`; `partner_onboarding.ts:351-357`).
23. **The status-write list** missed the `proposed` INSERT (`partner_onboarding.ts:288-290`).
24. **Skipped blocks and failure modes, now covered.**
    - The Deals default "Active is on by default" (`dc:443`).
    - The deal-state vocabulary (`dc:336`).
    - An unparsable stored list or proposal comes back as `[]` or `{}` (`admin_partners.ts:118`, `:309`).
    - The redemptions response's own `redemptions_count` is capped (`:288`).
    - The redeemer modal's loop source (`PartnerInvitations.jsx:430`).
25. **"Payouts on closed deals".** In the rev-share terms, "closed deals" are the deals the share pays on (`partnerDeals.ts:124`), not ended partner deals. The real gap is that settlements need an active partner deal (`partner_settlements.ts:33-35`).

## Part B — the Worker reads and writes

### Partner invitations — the Worker reads and writes

**A snapshot, not a spec.** Read-only pass on `claude/spinout-lab-workspace-wuyyqd` at HEAD `0b85c2b` (origin/main `b0422fe` plus S1's commits), 2026-10-24, for #2370 and the owner's canvas PI1–PI12. I checked it against the code only, not against production. No file was written, staged or changed.

**Path prefixes:**
- `wk/` = `cloudflare-worker/src/`
- `fe/` = `frontend/src/`
- `mig/` = `cloudflare-worker/sql/migrations/`
- `base:` = `cloudflare-worker/sql/schema_baseline.sql` (one extra prefix, because the production table shapes live there)
- `dc:` = `design/incoming/Partner Invitations Page.dc.html`
- `boards:` = `design/incoming/Partner Invitations · Boards.dc.html`

Bracketed canvas values are samples. They are never read as data.

**Notation in §11:**
- **E**: exists today.
- **P**: partly. Either it is in a different route, or it needs client-side joining, or one call per deal, or it hits a cap.
- **N**: no read or column at all.
- **W**: a figure drawn from today's data would be wrong.

---

#### 0. Mounts

| Prefix | Router | Mount |
|---|---|---|
| `/api/admin/partners` | `wk/routes/admin_partners.ts` | `wk/index.ts:848` (comment `:845-847`) |
| `/api/partner-onboard` (public, token-gated) | `wk/routes/partner_onboarding.ts` | `wk/index.ts:850` |
| `/api/legal/esign` (envelopes; activation hook) | `wk/routes/esign.ts` | `wk/index.ts:1222` |
| `/api/dd` (due-diligence cases) | `wk/routes/dd.ts` | `wk/index.ts:1109` |
| `/api/trust` (obligation scores) | `wk/routes/trust.ts` | `wk/index.ts:1217` |
| `/api/admin/contracts` (partner deals as contracts; template readiness) | `wk/routes/admin_contracts.ts` | `wk/index.ts:910` |
| `/api/profiling` (partner profile admin read) | `wk/routes/profiling.ts` | `wk/index.ts:1227` |
| `/api/admin/partner-settlements` (payouts, HQ only) | `wk/routes/partner_settlements.ts` | `wk/index.ts:982` |
| Daily crons 04:40 and 04:45 UTC | `wk/services/partnerDeals.ts` | `wk/index.ts:2323-2336`, `:2343-2354` |

**Frontend clients:**
- `api.adminPartners` (`fe/lib/api.js:1223-1263`)
- `api.partnerOnboard` (`:1265-1276`)
- the directory switches (`:1816-1818`)
- `dd.listCases` (`:5181`)

---

#### 1. Guards (every `admin_partners.ts` route)

- **`requireAdmin` on all twelve routes:** `:49, :98, :126, :154, :216, :241, :294, :315, :434, :462, :530, :563`.
  - `requireAdmin` = `requireAuth` + `role === 'admin'` + `refuseWhileFrozen` (`wk/auth.ts:523-528`).
  - No route wraps it, so its throws reach `app.onError` (`wk/index.ts:1466-1488`):
    - **401** `{detail:'Unauthorized'}`
    - **403** `{detail:'Admin required'}` (`wk/util/authErrors.ts:81-83`; `wk/index.ts:1484-1485`)
- **The admin freeze (D135)** is `refuseWhileFrozen` (`wk/auth.ts:568-590`).
  - It acts **only on non-GET** requests (`:569-570`), **only on HQ** (it returns early on a branch, `:571`), and **never on the Super Admin** (`:572`).
  - It freezes when the admin has an `admin_notices` row that is `overdue` or `rejected` (`:575-581`; `FREEZING_STATUSES` at `wk/util/authErrors.ts:79`). An unreadable table does not freeze (`:582-585`).
  - **Here it surfaces correctly** as **423** `{detail, code:'admin_frozen', notice}` (`wk/index.ts:1473`; `wk/util/authErrors.ts:146-155`), because nothing catches it. This is unlike the Events desk's 403 quirk.
  - The SPA dispatches `studioos:admin_frozen` on that body (`fe/lib/api.js:737-742`).
  - A frozen admin can still **read** every GET here, by design (`wk/auth.ts:543-546`).
- **Licence suspension (D107): none.**
  - `requireBranchNotSuspended` (`wk/auth.ts:752-795`) is called by **no** route in `admin_partners.ts`, `partner_onboarding.ts` or `partnerDeals.ts`. A grep for `requireBranchNotSuspended|branchOf|HQ_ONLY|requireHqAdmin|requireSuperAdmin` returns 0 in all three files.
  - On a suspended branch, create, resend, revoke, terminate, links and directory writes all succeed. The invitee flow and activation also keep granting tiers.
  - The 423 `branch_suspended` that the shell keys on (`fe/lib/api.js:751-756`) can never come from these routes.
- **Recovery cool-off: not applied.**
  - `/api/admin/partners` is in neither `COOL_OFF_PREFIXES` (`wk/index.ts:649-689`) nor `COOL_OFF_ROUTES` (`:733-756`).
  - The neighbours a lightbox would read are in it, and are refused for a freshly-recovered admin, GETs included: `/api/dd`, `/api/legal/esign` and `/api/admin/contracts` (`:653-660`).
- **No HQ/branch split.** A branch admin has the same twelve routes as HQ.
- **`:id` validation:**
  - Only `/deals/:id/redemptions` checks `Number.isFinite` (`:243`, 400 `Invalid id`), and only `POST /:id/directory` checks `> 0` (`:465`).
  - Resend, revoke and terminate use a bare `parseInt` (`:127`, `:155`, `:316`) and bind whatever results. I did not check what D1 does with a `NaN` binding.

---

#### 2. `wk/routes/admin_partners.ts` (622 lines): every route

`INVITE_TTL_DAYS = 14` (`:34`). Tokens are 32 random bytes as hex (`:36-40`). The link is `${APP_URL || 'https://axal.vc'}/partners/onboard?token=<token>` (`:42-44`, `:81`). The SPA serves both `/partners/onboard` and `/partner-onboarding/:token` (`fe/App.jsx:2475-2476`). The canvas's sample link `https://axal.vc/partner/invite/[…]` (`dc:409`) is not a route: draw the Worker's `link` as given.

##### 2.1 Invitations

| Route | Lines | Request | Writes | Audit (`logAdminAction`) | Response / failures |
|---|---|---|---|---|---|
| `POST /invitations` | 48-95 | Body (JSON fields): `recipient_email` (lower-cased, regex `:59`; otherwise 400 `Valid recipient_email required`), `recipient_name` (trimmed, **no length cap** `:52`), `personal_message` (≤2000 chars `:53`), `allowed_deal_types[]` (lower-cased, filtered to the five types `:54-57`; empty gives 400 with `valid: ALL_PARTNER_DEAL_TYPES` `:62-64`). **No cap of three and no de-duplication** of the type list. **No check for an existing open invitation or an existing member.** | `INSERT INTO partner_invitations (token, recipient_email, recipient_name, invited_by_user_id, allowed_deal_types, personal_message, expires_at)` (`:69-78`). Status defaults to `sent` (`mig/028_partner_deals.sql:19`). | `partner_invitation_created` `{invitation_id, recipient_email, allowed_deal_types, email_sent}` (`:86-89`) | **201** `{id, token, link, expires_at, email_sent, allowed_deal_types}` (`:91-94`). The row is created whether or not the email went. A failed insert throws, giving 500 `{detail:'Internal server error'}`. |
| `GET /invitations` | 97-123 | Query (URL): `status` (any string, exact match `:103`); `email` (`LOWER(recipient_email) LIKE %q%`, no ESCAPE, so `_` and `%` act as wildcards `:104`). No name search, no `sent_by`, no date window, no offset. | — | — | `{items}`. Each item has `id, token, recipient_email, recipient_name, allowed_deal_types[] (parsed), status, expires_at, created_at, viewed_at, signed_at, resulting_user_id, resulting_deal_id, envelope_id, revoked_at, invited_by_name, link, is_expired` (`:107-121`). It does **not** carry `personal_message`, `revoked_by_user_id` or any delivery field. **`ORDER BY created_at DESC LIMIT 200`, with no total** (`:114`). No try/catch, so a D1 error is a truthful 5xx. **Every row carries its bearer `token`.** |
| `POST /invitations/:id/resend` | 125-151 | none | `UPDATE … SET expires_at = now+14d, status = 'sent'` (`:136-139`). **This resets the stage from any non-terminal status**, `finalized` included. | `partner_invitation_resent` `{invitation_id, email_sent}` (`:147-149`) | `{ok, email_sent, link, expires_at}` (`:150`). 404 `Invitation not found`; 409 `Already signed`; 409 `Invitation has been revoked` (`:131-133`). `expired` and lapsed invitations **can** be resent. |
| `POST /invitations/:id/revoke` | 153-207 | Body (JSON): `reason` (optional, ≤500 chars `:157`) | 1. `UPDATE … SET status='revoked', revoked_at, revoked_by_user_id WHERE status NOT IN ('signed','revoked')` (`:158-162`). 2. Cascade: `partner_deals → 'voided'` where status is `proposed` or `awaiting_signature` (`:176-181`); each `esign_envelopes` row → `'voided'` unless completed or voided (`:189-193`); its `esign_recipients` → `'declined'` unless signed or declined (`:194-197`). | `partner_invitation_revoked` `{invitation_id, reason, voided_deals, voided_envelopes}` (`:202-205`) | `{ok:true, voided_deals, voided_envelopes}` (`:206`). 409 `Cannot revoke (already signed, already revoked, or not found)` (`:163-165`). **Hides failure:** the envelope lookup `.catch`es to `[]` (`:186`) and the whole cascade is one try/catch that only warns (`:175-200`), so a failed cascade still answers **200 with zeros**. The invitation itself is already revoked by then. Activation re-checks the status as a backstop (`wk/services/partnerDeals.ts:217-225`). |

##### 2.2 Deals

| Route | Lines | Request | Writes | Audit | Response / failures |
|---|---|---|---|---|---|
| `GET /deals/top` | 215-233 | Query: `limit` via `clampLimit(raw, 10, 50)` (`:217`; ≤0 or junk falls back to 10, `wk/util/pagination.ts:5-13`); `status` (default `active`; `all` drops the WHERE `:218-220`) | — | — | `{items, status, limit}`. Item columns: `id, deal_type, referral_code, granted_tier_founder, granted_tier_investor, status, expires_at, activated_at, created_at, partner_email, partner_name, redemptions_count` (`:222-225`). `ORDER BY redemptions_count DESC, created_at DESC LIMIT ?` (`:229-230`). Truthful 5xx. `partner_*` is null until activation, because it joins `users` on `pd.user_id` (`:227`). |
| `GET /deals/:id/redemptions` | 240-291 | none | — | — | `{deal:{id, deal_type, referral_code, expires_at, status, granted_tier_*, partner_email, partner_name}, items, redemptions_count, revshare_attribution_days}`. Item columns: `id, redeemed_at, granted_tier_founder, granted_tier_investor, granted_until, attribution_kind, user_id, redeemer_name, redeemer_email, revshare_window_remaining_days` (`:255-257`, `:267-277`). `revshare_window_remaining_days` = ceil(days left of 365 from `redeemed_at`), floored at 0, and set only for `deal_sourcing_revshare` deals (`:264-276`). `ORDER BY redeemed_at DESC LIMIT 500` (`:261`). **`redemptions_count` is `items.length`** (`:288`), so it is capped at 500. Errors: 404 `Deal not found`; 400 `Invalid id`. **The redeemer's role is not returned.** |
| `GET /deals` | 293-312 | Query: `status` (default `active`; **one exact status only; `all` matches nothing** `:295`, `:305`) | — | — | `{items}`. Item columns: `id, invitation_id, user_id, deal_type, proposal (parsed object), granted_tier_*, term_months, referral_code, envelope_id, status, activated_at, expires_at, terminated_at, termination_reason, created_at, partner_email, partner_name, redemptions_count` (`:297-310`). **`ORDER BY created_at DESC LIMIT 200` per status, with no total.** Truthful 5xx. There is no recipient name or email before activation; join `invitation_id` to `GET /invitations` for those. |
| `POST /deals/:id/terminate` | 314-421 | Body (JSON): `reason` (**required**, ≤500 chars; otherwise 400 `reason is required` `:317-319`) | 1. `partner_deals → terminated`, with `terminated_at`, `terminated_by_user_id`, `termination_reason` (`:333-338`). 2. The partner's tiers go to `free` / `partner_revoked`, **only while** their status is still `partner_grant` and the tier matches (`:344-369`; the dealroom cap comes from `INVESTOR_QUOTAS.free` `:367`). 3. The same for every redeemer whose status is still `partner_referral` (`:377-408`). | `partner_deal_terminated` `{deal_id, reason, revoked_tier_founder, revoked_tier_investor, redemptions_revoked}` (`:410-415`) | `{ok, tiers_revoked, redemptions_revoked}` (`:416-420`). 409 `Deal is not active or not found` (`:331`). **`tiers_revoked` means "the deal granted a tier"** (`:418`), not "a revoke happened". **`redemptions_revoked` counts updated user-tier rows, not members**: a redeemer with both tiers counts 2 (`:393`, `:405`). The redeemer cascade `.catch`es to `[]` and the block only warns (`:382`, `:378-408`), so **a failed cascade answers 200 with 0**. |

Status vocabulary for `partner_deals`: `proposed | awaiting_signature | active | terminated | expired | voided` (`:322-326`). The migration comment omits `voided` (`mig/028_partner_deals.sql:67`), and there is no CHECK.

##### 2.3 Directory switches (Directory tab; the canvas says do not draw them)

| Route | Lines | Request / behaviour | Response |
|---|---|---|---|
| `GET /directory` | 433-459 | Runs `ensurePartnerDirectoryColumns` first: PRAGMA, then `ALTER TABLE partners ADD COLUMN …` on first use (`wk/services/partnerDirectorySchema.ts:15-35`). Query `q` is escaped LIKE over name, company and email, min 1 char (`:440-445`). | `{partners, total}` where `total = rows.length` (`:458`). `ORDER BY directory_featured DESC, directory_listed DESC, referrals_count DESC, name ASC LIMIT 500` (`:453-455`). |
| `POST /:id/directory` | 461-506 | Body (JSON): `{listed?:bool, featured?:bool}`. Featured implies listed (`:479-483`). 400 `invalid partner id`; 404 `partner not found`. | Writes `partners.directory_*` (`:485-492`). Audit `partner_directory_toggled` (`:494-498`). Returns `{ok, partner:{id, listed, featured}}`. |

##### 2.4 Firm links (the canvas moves these to Advisors & Partners)

| Route | Lines | Behaviour | Response |
|---|---|---|---|
| `GET /links` | 529-560 | Accounts are `users WHERE lower(role)='partner'`, unattached first, then by email, `LIMIT 500` (`:534-542`). Firms are `partners` by name, `LIMIT 500`, each with an `accounts` count (`:546-552`). | `{accounts, firms, attached, unattached}`. **The counts are taken over the at most 500 rows read** (`:557-558`). |
| `POST /links` | 562-611 | Body (JSON): `{user_id, partner_id|null}`, where `null` detaches (`:572-576`). 400 for a bad id; 404 when the user or firm is not found; 400 when the user is not a partner account (`:582-586`). | Writes `users.partner_id` (`:595-596`). Audit `partner_firm_link_set` with `target_user_id` (`:603-608`). Returns `{ok, user_id, partner_id, firm_name}`. |

---

#### 3. `wk/routes/partner_onboarding.ts` (432 lines): the invitee flow

**Authentication and the gate:**
- No JWT. The token in the path is the only credential (`:2-7`).
- `loadInvitation` reads `partner_invitations` by token, `LIMIT 1` (`:45-53`).
- `gateInvitation` (`:59-65`) refuses:
  - 404 `Invitation not found`
  - 410 `…revoked`
  - 409 `…already signed`
  - 410 `…expired` when `expires_at < now`
- `rejectIfDealStarted` (`:73-80`) gives 409 once a deal is `awaiting_signature` or `active`. It blocks profile, propose and select.
- **No branch, suspension or rate-limit gate exists on this router.** A grep for `partner` in the rate-limit middleware found nothing.

**Audit:** `audit()` writes `activity_logs (action, details, actor)` (`:91-98`):
- `details` = `{invitation_id, …}` as JSON
- `actor` = SHA-256 of the **recipient's** email
- `user_id` is left null
- It is best-effort: a failure only warns.

| Step | Route | Lines | Reads | Writes | `activity_logs.action` | Response |
|---|---|---|---|---|---|---|
| Open | `GET /:token` | 102-137 | Inviting admin's `users.name` (`:113-115`); the invitee's profile row (`:116-118`); latest `partner_deals` (`:119-122`) | When status is `sent`: `status='viewed', viewed_at=now` (`:106-109`) | `partner_invitation_viewed` (`:110`) | `{invitation:{id, recipient_email, recipient_name, personal_message, allowed_deal_types, status, expires_at}, admin_name, profile, deal:{…, proposal}}` (`:123-136`) |
| Profile | `POST /:token/profile` | 141-210 | — | Upsert into `partner_profiles` **`ON CONFLICT(email)`**, setting `invitation_id` and the 13 answer columns (`:177-202`). Caps: `full_name`, `organization`, `role_title` 200; `expertise`, `sectors` 1000; `geography` 200; `capacity_per_month` 100; `capital_capacity_usd` an integer from 0 to 1e9; `motivation`, `prior_deals` 4000; `linkedin_url` 500; `raw_chat_json` ≤64,000 chars (`:149-166`). Then `status='profiled'`, only from `sent` or `viewed` (`:204-206`). | `partner_profile_saved` `{has_capital}` (`:208`) | `{ok:true}` |
| Offers | `POST /:token/propose` | 214-231 | Profile by `invitation_id` (412 `Submit profile first` `:220-223`) | `status='proposed'`, only from `viewed` or `profiled` (`:226-228`). **The proposals are not stored.** | `partner_proposals_generated` `{count}` (`:229`) | `{proposals}`, from `buildProposals(allowed, profile)` (`:225`, `:230`) |
| Choose | `POST /:token/select` | 235-302 | Profile again (412); proposals recomputed on the server (`:247-251`) | Body (JSON) is `proposal_id` (1-based) or `deal_type` (`:253-268`); 400 when out of range, not offered, or missing. Reuses the latest `proposed` deal row or inserts one with `status='proposed'`, storing `proposal_json`, `granted_tier_*` and `term_months` (`:271-296`). Then `status='selected'` **unconditionally** (`:297-299`). | `partner_proposal_selected` `{deal_id, deal_type}` (`:300`) | `{deal_id, proposal}` |
| Agreement out | `POST /:token/finalize` | 310-386 | Latest deal (412 `Select a proposal before finalizing` `:314-318`). If an envelope already exists: the first recipient's `signing_token`, returned as `{envelope_id, signing_url, already_started:true}` (`:319-329`). | `createAndSendEnvelope` (`documentType:'partner_services'`, `dealId: deal.id`, `refuseUnfilled:true`; merge fields `partner_name`, `partner_email`, `effective_date`, `deal_type`, `term_months`) (`:336-358`). On success: deal → `awaiting_signature` with `envelope_id` (`:373-375`); invitation → `finalized` with `envelope_id` (`:376-378`). | `partner_envelope_started` `{deal_id, envelope_id, email_sent}` (`:379-381`); or `partner_envelope_refused` `{code:'template_fields_unfilled', fields}` (`:364`) | `{envelope_id, envelope_uuid, signing_url, email_sent}` (`:382-385`) |
| Poll | `GET /:token/status` | 390-417 | Invitation (410 if revoked; 410 if expired and not signed `:396-399`); latest deal `id, status, envelope_id, activated_at, referral_code`; `esign_envelopes.status` | — | — | `{invitation_status, is_expired, deal, envelope_status}` |

**The "agreement not ready" refusal:**
- The sentence is `AGREEMENT_NOT_READY` (`:308`).
- On `UnfilledFieldsError` (`wk/routes/esign.ts:269-275`, thrown at `:519-522`), the route writes the audit row, then returns **409** `{error:'template_fields_unfilled', message, detail}` (`:363-366`; body shape at `wk/util/refusal.ts:69-87`).
- On a missing or unreadable body (`TemplateBodyError`, `esign.ts:298-306`), it returns `templateBodyRefusal(e,'member')`: 409 `template_has_no_body` or 503 `template_unreadable` (`:367-368`; `esign.ts:312-324`). **No audit row is written for this branch.**
- Any other throw gives a 500 (`:369`). A null send gives 500 `{error:'Could not start envelope'}` (`:371`).
- **In every refusal, the deal and the invitation are left as they were:** status `proposed` and `selected`.

**Where things are stored:**
- **Answers:** `partner_profiles`, keyed on `email` (`base:3297-3314` plus `mig/275_partner_profiles_columns.sql:59-79`). There is no `id` column (`mig/275:34-37`).
- **Proposals:** nowhere. Only the chosen one is kept, in `partner_deals.proposal_json`.
- **Envelope:** `esign_envelopes`. Its `deal_id` is `partner_deals.id` (`esign.ts:579`) and its `document_type` is `partner_services`.
- **Stage times:** only `viewed_at` and `signed_at` are columns. Profile, offers, choice and envelope exist **only as `activity_logs` rows with a `created_at`**. Nothing reads those rows (§6).

---

#### 4. `wk/services/partnerDeals.ts` (891 lines)

##### 4.1 `buildProposals` (`:75-166`)

- Keeps only the five valid types (`:79`) and **only the first three** (`valid.slice(0, 3)`, `:84`). A fourth or fifth allowed type is silently never offered. A duplicate type gives a duplicate offer.
- Selecting a dropped type by `deal_type` returns 400 `No matching proposal could be generated` (`partner_onboarding.ts:265`, `:269`).

What each type offers in the Worker today:

| Type | Founder tier | Investor tier | Term | Terms | Lines |
|---|---|---|---|---|---|
| `equity_partnership` | `founder_pro` | `professional` | 24 | `equity_pct` "0.5%–2.0% (vested 4yr, 1yr cliff)" **in Axal VC Management LLC**; `time_commitment` (from `capacity_per_month`, or "5–10 hrs/month"); `board_observer` | `:85-101` |
| `services_partnership` | `founder_pro` | null | 12 | Rate negotiated per SOW; equity-for-services 0.1%–0.5%; minimum 2 engagements a year | `:102-117` |
| `deal_sourcing_revshare` | `founder_pro` | `professional` | 12 | 5% of Axal fees on deals closed within 12 months of the intro; 10% of management fees on LP capital; `attribution_window_days: 365` | `:118-133` |
| `capital_partnership` | `founder_pro` | `institutional` if capital ≥ $1M, else `professional` | 24 | Commitment = `capital_capacity_usd`, or "TBD (≥ $250k)"; pro-rata on SPVs ≥ $500k; 50% management-fee offset | `:134-150` |
| `custom` | `founder_pro` | null | 12 | `description` = the profile's `motivation` | `:151-163` |

- Each offer also carries `label`, `summary` and `contract_excerpt`.
- **The canvas's offer text disagrees with this table** (`dc:380`):
  - Equity: the canvas says "Takes equity in portfolio companies… Up to [1]%". The Worker says equity in Axal.
  - Deal-sourcing: the canvas says "[10]% of first-year revenue". The Worker says 5% of fees and 10% of management fees.
  - Capital: the canvas says "Minimum [$25,000] a year · Investor Professional · 12 months". The Worker says ≥ $250k, Founder Pro plus Professional or Institutional, 24 months.
  - Services adds "quarterly check-in", which the Worker does not have.
  - Drawing the canvas copy would be **W**. No route exposes `buildProposals` to an admin.

##### 4.2 Activation on signature (`:195-467`)

The hook runs from the e-sign completion branch, once (`if (allSigned)` `wk/routes/esign.ts:1548`; `if (wonRace)` `:1560`; the call at `:1585-1593`), before `satisfyObligationFromEnvelope` (`:1600-1604`).

The order of steps:
1. **Load.** Deal + invitation + profile by `envelope_id` (`:199-207`). Already `active` is a no-op (`:209-211`).
2. **Refuse after revocation or expiry.**
   - A **revoked** invitation sets the deal to `voided` (`:217-225`).
   - An **expired** invitation (`expires_at <= now`) sets the invitation to `expired` and the deal to `voided` (`:226-238`).
   - Only a `console.warn` records either. The envelope has already completed and nobody is told.
   - The signing token lives 7 days (`esign.ts:63`) and the invitation 14 days, so an agreement sent on day 10 and signed on day 15 is voided on signing.
3. **User.** Matched by lower-cased email.
   - An existing user's role is set to `partner` only if it was empty or already `partner` (`:256-258`).
   - Otherwise a new `users` row is inserted with `role='partner'` (`:260-263`).
   - Then `assignPartnerPublicId` runs (`:269-272`).
4. **Referral code.** `PART-` + 8 hex characters (`:173-178`), with up to 5 tries against the UNIQUE constraint (`:278-299`).
5. **Tiers.**
   - `subscription_tier = granted, subscription_status = 'partner_grant', renews_at = expires` (`:307-313`).
   - Investor: `investor_tier, investor_subscription_status = 'partner_grant'`, and the dealroom cap from `INVESTOR_QUOTAS` (`:314-330`).
   - **Both UPDATEs are unconditional.** See §10, finding 1.
6. **Term.** `expires_at = now + term_months × 30 days` (`:304-305`). "12 months" is 360 days, not a calendar year.
7. **Deal.** `status='active', user_id, activated_at, expires_at` (`:333-337`).
8. **Invitation.** `status='signed', signed_at, resulting_user_id, resulting_deal_id` (`:340-345`).
9. **Profile.** `partner_profiles.user_id` is set (`:348-352`).
10. **DD case** (`:360-389`).
    - `INSERT dd_cases (uid, subject_type='partner', subject_id = userId, subject_label = organization || full_name || email, owner_user_id = invited_by_user_id)`.
    - Then one `dd_sections` row per `sectionsFor('partner')`: `compliance_aml, reputation_press, cyber_posture, kyb_entity, kyc_individual, accreditation` (`wk/services/dueDiligence.ts:44-56`).
    - For non-capital deals, `kyc_individual` and `accreditation` are inserted as `completed` / `n_a`.
    - **No `dd_checklist_items` rows and no `dd_audit_log` row are written**, unlike `POST /api/dd/cases` (`wk/routes/dd.ts:229-239`).
11. **Obligations** (`:401-437`).
    - `seedObligations(user,'partner')` adds `tos_v1` and `privacy_v1` (`wk/services/trust.ts:87-91`).
    - Then four rows are upserted into `legal_obligations`:
      - `partner_msa_v1`: required, `satisfied`, with `evidence_envelope_uuid`
      - `kyb_v1`: required, `pending`
      - `kyc_v1`: required and `pending` for capital deals, otherwise `required=0` / `waived`
      - `accreditation_v1`: same rule as `kyc_v1`
    - The conflict rule never un-satisfies a row (`:426-433`).
12. **Notify.** `notify(type 'partner_deal_activated', channels ['in_app','email'], link '/studio')` (`:440-452`).
13. **Audit.** `activity_logs` `partner_deal_activated` `{deal_id, deal_type, term_months, referral_code}`, with `user_id` set (`:455-464`).

Every step after the deal flip is best-effort: it only warns on failure.

##### 4.3 Redemptions (`:477-543`)

- Called only from registration (`wk/routes/auth.ts:454-470`), which also writes `activity_logs` `partner_referral_redeemed` (`:466-467`).
- It refuses when:
  - the code is not `PART-`
  - the deal is not `active`
  - the term is past; the deal is then flipped to `expired` (`:495-502`)
  - the code is the partner's own (`:503`)
- It grants the deal's tiers with status `partner_referral` until `deal.expires_at` (`:505-528`).
- Then it inserts the `partner_referral_redemptions` row (`ON CONFLICT DO NOTHING`), with `attribution_kind` = `deal_sourcing_revshare` or `referral` (`:530-540`).
- The tiers are granted **before** the row is inserted. If the insert fails, the grant has no row, so terminate and the sweep cannot revoke it.

##### 4.4 Daily sweeps

- **04:40 UTC, `expirePartnerDeals`** (`:552-648`; cron `wk/index.ts:2323-2336`).
  - Selects `active` deals past `expires_at` (`:565-571`; `.catch` to `[]`).
  - Flips each to `expired` (`:576-580`).
  - Revokes the partner's own grant while it is still `partner_grant`, setting `partner_expired` (`:584-606`).
  - Does the same for every redeemer still on `partner_referral` (`:610-638`).
  - Returns counts for logging only.
- **04:45 UTC, `notifyExpiringRevshareWindows`** (`:737-891`; cron `wk/index.ts:2343-2354`).
  - Thresholds are 30, 7 and 1 days of a 365-day window (`:672-673`).
  - The dedupe table `partner_revshare_window_notifications` (`mig/033_partner_revshare_window_notifications.sql:24-30`) is also created at runtime (`:688-710`).
  - Partners get a notice with link `/referrals` (`:830-853`).
  - Every active admin gets a digest email whose body says **"Admin panel: /admin/partners"** (`:858-888`, `:876`).
- **Invitations never lapse by sweep.** `expired` is written only by activation (`:230`). A lapsed invitation keeps its stage word and is lapsed only through `is_expired` (`admin_partners.ts:120`).

---

#### 5. Email delivery

`sendPartnerInvitationEmail` (`wk/services/email.ts:357-442`):
- From `Axal VC <noreply@axal.vc>`, subject "You're invited to partner with Axal VC" (`:423-424`).
- The HTML escapes the message (`:374-376`). The text copy promises "1–3 partnership structures" (`:400`) and "expires in 14 days" (`:416`, `:422`).
- It returns **`false` for four different causes**:
  - the address is on the suppression list (`:366`)
  - the Gmail credentials are missing (`:367-370`)
  - the Gmail API refused the send (`:432-436`)
  - any thrown error, including the 10 s timeout (`:438-441`; `:10`)
- The canvas's PI4n sentence names only the first two causes (`dc:410`).
- The header comment's path `/partner-onboarding/${token}` (`:352-355`) is not the link the route sends (`admin_partners.ts:81`). Both addresses resolve.

**Where `email_sent` is kept:** there is **no column** on `partner_invitations` (`mig/028_partner_deals.sql:9-29`). The value lives only in:
- the create and resend responses (`admin_partners.ts:91-94`, `:150`)
- `admin_audit_log.filters_json` and `activity_logs.details` for `partner_invitation_created` and `partner_invitation_resent` (`:86-89`, `:147-149`)
- the envelope's `email_sent`, inside `partner_envelope_started` (`partner_onboarding.ts:379-381`)

**No route reads any of these back.**

---

#### 6. Audit rows

`logAdminAction` (`wk/services/adminAudit.ts:86-115`) writes two rows, each in its own try:
- `activity_logs (action, details, actor = sha256(admin email), user_id = admin)` (`:95-105`)
- `admin_audit_log (admin_user_id, action, viewed_user_id = details.target_user_id, filters_json)` (`:107-114`; target at `:71-75`). The timestamp column is `exported_at` (`base:63-72`).

| Action | Writer | Keys in the JSON | Has a target |
|---|---|---|---|
| `partner_invitation_created` | `admin_partners.ts:86` | `invitation_id, recipient_email, allowed_deal_types, email_sent` | no |
| `partner_invitation_resent` | `:147` | `invitation_id, email_sent` | no |
| `partner_invitation_revoked` | `:202` | `invitation_id, reason, voided_deals, voided_envelopes` | no |
| `partner_deal_terminated` | `:410` | `deal_id, reason, revoked_tier_*, redemptions_revoked` | no |
| `partner_directory_toggled` | `:494` | `partner_id, partner_name, listed{from,to}, featured{from,to}` | no |
| `partner_firm_link_set` | `:603` | `target_user_id, from, to, firm_name` | yes |
| `partner_invitation_viewed`, `partner_profile_saved`, `partner_proposals_generated`, `partner_proposal_selected`, `partner_envelope_started`, `partner_envelope_refused` | `partner_onboarding.ts:110, 208, 229, 300, 379, 364` (`activity_logs` only, recipient-hashed actor) | `invitation_id`, and the rest per §3 | — |
| `partner_deal_activated` | `partnerDeals.ts:457-463` (`activity_logs`) | `deal_id, deal_type, term_months, referral_code` | user_id set |
| `partner_referral_redeemed` | `wk/routes/auth.ts:467` | `partner_deal_id, code` | user_id = redeemer |

**Readers:**
- **No reader is keyed on any of these actions, or on `invitation_id` or `deal_id`.** I grepped every action name across `wk/`; each hit is its own writer.
- The only reader of the `admin_audit_log` rows is HQ's governance feed. It is **Super Admin only** (`wk/routes/admin_security.ts:613-614`), reads the table unfiltered and newest first, and stops at `FEED_LIMIT = 60` (`:425`, `:548-554`).
- Its `activity_logs` arm reads a fixed list of actions (`:566-571`), so the onboarding and activation rows never reach it.
- So the canvas's "History" cards (PI3, PI6) and the step dates (PI3 Progress, PI9d) are **recorded but not read**. The one exception: the no-body refusal at finalize writes no row at all (§3).

---

#### 7. Neighbouring reads a lightbox would use

| Need | Route | Guard and shape | Limits / failure |
|---|---|---|---|
| **DD case per partner** | `GET /api/dd/cases?subject_type=partner[&status=]` (`wk/routes/dd.ts:124-152`) | `requireDdReader`: any signed-in admin, partner, investor or advisor; founders refused (`:52-65`). An admin sees every case. Items: `id, uid, subject_type, subject_id (= users.id), subject_label, status (open, in_review, completed, archived; base:1244), risk_score, risk_band, owner_user_id, created_at, updated_at, report_generated_at`. | `ORDER BY created_at DESC LIMIT 200`; **no `subject_id` filter**; truthful 5xx. Under cool-off. |
| **KYB section state** | `GET /api/dd/cases/:uid` (`dd.ts:244-`) | Full case: every section (`dd_sections.status`: pending, assigned, in_review, completed, blocked; `verdict`; `base:1352-1367`), plus decrypted findings, reviewers, checklist and requests (`:271-299`) | One call per case; heavy for a status pill |
| **Obligations** | `GET /api/trust/score/:userId` (`wk/routes/trust.ts:172-202`) and `POST /api/trust/score/batch` (≤200 ids, `:232-283`) | Gives an admin `{score, missing[], required_total}` only. **Not the status of each obligation**: waived and satisfied rows are not listed. The single-user GET **writes**, via `seedObligations` (`:186-188`). | No admin route returns `legal_obligations` rows for another user (grep of `FROM legal_obligations` in `wk/routes`) |
| **Envelope state and dates** | `GET /api/legal/esign?deal_id=<partner_deals.id>` (`wk/routes/esign.ts:1000-1027`) | `requireAuth` plus scope; an admin's scope is `1=1`. Gives `status, created_at, completed_at, recipient_count, signed_count`. A voided partner envelope is recognised by `isVoided` (`:1209-1214`). | `LIMIT 200`; truthful 5xx; under cool-off |
| **Agreement readiness** | `GET /api/legal/esign/templates/partner_services` (`esign.ts:963-998`). Admins may read every originator type (`wk/services/esignOriginators.ts:96-103`, `:115-127`). | Gives the body that would be sent, its `source`, and `fields[{key, filled_by:'send'|'sender'}]`. 409 `template_has_no_body` or 503 `template_unreadable`. **"Not ready" = a refusal, or any `filled_by:'sender'` key outside finalize's merge set** (`partner_name, partner_email, deal_type, term_months`; `partner_onboarding.ts:351-357`). The page would have to hold that set. | Under cool-off. `GET /api/admin/contracts/templates/store/partner_services/fields` (`wk/routes/admin_contracts.ts:944-962`) reads **only the store row**: it gives 404 for a stub even when finalize would fall back to the bundled body (comment at `partner_onboarding.ts:342-343`). |
| **All partner deals, with a total** | `GET /api/admin/contracts/partner-deals?status&deal_type&q&limit≤500&offset` (`admin_contracts.ts:1187-1223`; paging at `wk/services/contractListQuery.ts:5-19`) | `requireAdmin`. Item columns: `id, partner_user_id, deal_type, term_months, granted_tier_*, granted_tiers, status, created_at, expires_at, partner_email, partner_name, redemption_count`, plus `total`. **No `referral_code`, `activated_at`, `invitation_id` or `proposal`.** `q` searches partner name and email only. | Every row is read, then paged in memory, `ORDER BY u.name, d.id`. 503 `partner_deals_unreadable`. Under cool-off. |
| **"Open in Contracts" target** | Contracts union uid `partner_deal:<id>` (`admin_contracts.ts:1101-1111`) | `mapPartnerDealStatus` maps `terminated` and `voided` to the default **`sent`** (`:646-652`). `signed_at` reads `r.updated_at`, which the query does not select, so it is always null (`:671-680`, `:698-702`). | **W** on the Contracts side |
| **Their answers** | `GET /api/profiling/admin/:email` (`wk/routes/profiling.ts:498-521`) | `requireAdmin`. The full `partner_profiles` row (EIN masked, `wk/services/sensitiveFields.ts:78-93`), including `invitation_id` and all of 275's answer columns. **A logged read**: `activity_logs` `partner_profile_access` (`:516`). | Keyed by email: check `invitation_id` matches before drawing |
| **Member lookup on create** | `GET /api/admin/users?q=` (`wk/routes/admin.ts:50-`) | LIKE over name and email, ≥2 chars (400 `query_too_short`); gives `role` | Substring match; exact matching is client-side |
| **Payouts** | `GET /api/admin/partner-settlements?deal=&partner=&state=` (`wk/routes/partner_settlements.ts:36-55`) | **HQ only** (`:15-19`) | No limit |
| Ending agreements (branch home) | `agreementsExpiring` (`wk/services/branchHome.ts:295-350`) | Counts `active` deals ending within **60** days (the canvas uses 30) | Branch home only |

---

#### 8. Tables and columns

- **`partner_invitations`** (`mig/028_partner_deals.sql:9-29`; `base:3262-3282`)
  - Columns: `id, token UNIQUE, recipient_email, recipient_name, invited_by_user_id, allowed_deal_types (JSON), personal_message, status, expires_at, viewed_at, signed_at, resulting_user_id, resulting_deal_id, envelope_id, revoked_at, revoked_by_user_id, created_at`.
  - Status comment: `sent | viewed | profiled | proposed | selected | finalized | signed | expired | revoked` (`:18`).
  - **No columns for:** delivery, `resent_at`, `profiled_at`, `proposed_at`, `selected_at`, `finalized_at`, or per-invitation terms.
  - No UNIQUE on `recipient_email`.
  - Production held **zero** invitations when measured on 2026-09-21 (`mig/275_partner_profiles_columns.sql:17`, `:49`, `:54-55`).
- **`partner_profiles`**, production shape (`base:3297-3314`)
  - Columns: `email PRIMARY KEY, user_id, persona, legal_entity_name, entity_type, ein, signatory_name, signatory_title, company_established, chat_history, extracted_data, admin_status DEFAULT 'pending', agreement_type, admin_notes, created_at, updated_at`, plus six profiling columns.
  - **Migration 275 adds:** `invitation_id, full_name, organization, role_title, expertise, sectors, geography, capacity_per_month, capital_capacity_usd, motivation, prior_deals, linkedin_url, raw_chat_json`, the four advisor columns, and `uq_partner_profiles_invitation` (`mig/275:59-84`).
  - The 028 shape (`mig/028:34-52`) never landed in production (`mig/275:4-29`).
- **`partner_deals`** (`mig/028:55-75`; `base:3221-3241`)
  - Columns: `id, invitation_id, user_id (NULL until signed), deal_type, proposal_json, granted_tier_founder, granted_tier_investor, term_months DEFAULT 12, referral_code UNIQUE, envelope_id, status, activated_at, expires_at, terminated_at, terminated_by_user_id, termination_reason, created_at`.
  - No `updated_at`.
- **`partner_referral_redemptions`** (`mig/028:82-92`): `id, partner_deal_id, redeemed_by_user_id, granted_tier_*, granted_until, attribution_kind ('referral' | 'deal_sourcing_revshare'), redeemed_at`, `UNIQUE(partner_deal_id, redeemed_by_user_id)`.
- **`partner_revshare_window_notifications`** (`mig/033:24-30`): `redemption_id, threshold_days, notified_at`.
- **`dd_cases`** (`base:1235-1253`), **`dd_sections`** (`base:1352-1367`), **`legal_obligations`** (`base:2684-2696`): `user_id, obligation_key, required, status, expires_at, evidence_envelope_uuid, evidence_meta`, `UNIQUE(user_id, obligation_key)`.
- **`activity_logs`** (`base:42-51`); **`admin_audit_log`** (`base:63-72`).
- **`users`** columns written: `role`, `subscription_tier/status/renews_at`, `investor_tier/subscription_status/renews_at/dealroom_max`, `partner_id`.
- **`partners`** columns written: `directory_*`.

---

#### 9. Rules for drawing these reads truthfully

**Guard L (lists that truncate without saying so).**
- Every admin GET here fails truthfully: there is no try/catch, so a D1 error is a 5xx. This is unlike Events' analytics read, so "Unreadable" is always available.
- But every list is cut silently, with no total and no offset:

  | List | Cap |
  |---|---|
  | invitations | 200 |
  | deals | 200 per status |
  | top deals | ≤50 |
  | redemptions per deal | 500 |
  | links, firms, directory | 500 each |
  | DD cases | 200 |
  | envelopes | 200 |

- So:
  1. A list that returns exactly its cap is **incomplete**. Every figure derived from it reads "First 200 only", never a total.
  2. Tab counts and "1–25 of [N]" are exact only below the cap.
  3. "All deals" needs six calls, one per status (`proposed, awaiting_signature, active, terminated, expired, voided`), each under its own cap. Or use the contracts read in §7, which has a total but no codes or dates.
- **Writes that answer 200 after a failure.** Revoke's `voided_*` and terminate's `redemptions_revoked` and `tiers_revoked` can be 0 or true after a failed cascade (§2.1, §2.2). A dialog must not turn them into "nobody lost a tier" or "nothing was voided".
- **Stage words.** The canvas words map to stored values as follows (`dc:333-337`):

  | Canvas | Stored |
  |---|---|
  | Sent | `sent` |
  | Opened | `viewed` |
  | Profile done | `profiled` |
  | Offers shown | `proposed` |
  | Offer chosen | `selected` |
  | Agreement out | `finalized` |
  | Signed | `signed` |
  | Revoked | `revoked` |
  | Lapsed | `is_expired` and the status is not `signed`/`revoked`, or the status is `expired` |
  | Deal: Offer chosen, not sent | `proposed` |
  | Deal: Awaiting signature | `awaiting_signature` |
  | Deal: Active | `active` |
  | Deal: Term over | `expired` |
  | Deal: Terminated | `terminated` |
  | Deal: Voided | `voided` |

  After a resend, the stored stage reads `sent` and then `viewed`, even when a deal is `awaiting_signature`. That happens because finalize's idempotent branch never restores `finalized` (`partner_onboarding.ts:319-329`). So **a deal row overrides the invitation's stage word**.
- **Never call `GET /api/partner-onboard/:token` from the admin page.** It flips `sent` to `viewed`, stamps `viewed_at` and writes `partner_invitation_viewed` (`partner_onboarding.ts:106-111`). That is a false "Opened".

---

#### 10. Findings beyond #2370's list (confirmed in code at `0b85c2b`)

1. **Activation overwrites a paying member's subscription.**
   - The tier UPDATEs have no guard on the current tier or status (`partnerDeals.ts:310`, `:324-327`).
   - A member who pays for Founder Elite becomes `founder_pro` / `partner_grant`. Terminate (`admin_partners.ts:348-353`) and expiry (`partnerDeals.ts:586-591`) then drop them to `free`, because their status is now `partner_grant`.
   - So PI4's "Signing keeps their role" (`dc:405`) is true of the role but not of the plan. PI8c's "unless he pays for a plan" (`dc:413`) is wrong for someone already paying.
2. **Two invitations to one address share one profile row.**
   - The upsert moves `invitation_id` to the later invitation (`partner_onboarding.ts:182-183`).
   - The earlier invitation's propose, select and finalize then answer 412 `Submit profile first` (`:223`, `:250`). Its activation join finds no profile (`partnerDeals.ts:205`).
   - So PI4's duplicate warning is protecting real state, not just tidiness.
3. **A signed agreement is silently voided if the invitation lapsed first.** See §4.2 step 2 (`partnerDeals.ts:226-238`). Nothing records it beyond a `console.warn`, so no "Needs you" row can show it.
4. **Partner writes ignore licence suspension and recovery cool-off** (§1).
5. **The revoke and terminate cascades answer 200 with zeros on failure** (§2.1, §2.2).
6. **Attribution counts are capped.** `redemptions_count` in the per-deal read is `items.length`, capped at 500 (`admin_partners.ts:261`, `:288`).
7. **The rev-share digest email links `/admin/partners`** (`partnerDeals.ts:876`). A redirect from the old address must stay, or the text must change.
8. **Contracts maps terminated and voided partner deals to "sent"** and never has a signed date (§7).

---

#### 11. Board by board: which reads exist

##### PI1 Overview (PI12 is the same data in dark, PI11a on phone)

| Block | Status | Source and caveats |
|---|---|---|
| Tabs and counts (`dc:461`) | P | Overview "[10]" = Needs you, which has no read. Invitations [42] and Deals [19] are list lengths under Guard L. Referrals [64] is Σ`redemptions_count` across all deals. |
| Open invitations · oldest sent (`dc:353`) | P | `GET /invitations` with status not signed, revoked or expired, `!is_expired`; min `created_at`. Capped at 200. |
| Lapsed, not closed | P | `is_expired` and not signed or revoked (`admin_partners.ts:120`). The stored `expired` almost never occurs. |
| Signed, last 90 days | P | `signed_at` (cap) |
| Days from sent to signed (median) | P | `signed_at − created_at` (cap) |
| Active deals · end within 30 days (`dc:354`) | E | `GET /deals?status=active` with `expires_at` |
| Awaiting signature | E | `GET /deals?status=awaiting_signature` |
| Referral redemptions, 90 days | P | Fan out `GET /deals/:id/redemptions` over every deal (`redeemed_at`). There is no aggregate. |
| Emails not delivered (NEW) | N | No column; recorded only in audit JSON, with no reader (§5) |
| Needs you · Lapsed → Resend (`dc:358`) | P | From the list. "At Offer chosen" is the stored stage, unless the invitation was resent. |
| Needs you · Agreement blocked (`dc:359`) | P/N | Invitation `selected` plus deal `proposed` cannot tell "refused" from "not yet sent". The refusal row has no reader, and the no-body refusal writes none. The readiness probe in §7 is partial. |
| Needs you · Not delivered (NEW) | N | §5 |
| Needs you · Term ending | E | Active deals `expires_at` |
| Needs you · Due diligence | P | `GET /api/dd/cases?subject_type=partner&status=open` matched on `subject_id = deal.user_id`. KYB needs one detail call per case. Cool-off applies. |
| Needs you · Firms | E | `GET /links` `unattached` (counted over ≤500 accounts) |
| Needs you · Rev-share closing | P | Fan out per revshare deal, `revshare_window_remaining_days ≤ 30`. The cron's own computation is not exposed. |
| C1 Where open invitations stand · oldest (`dc:365-366`) | P | Counts per stage from the list. "Oldest" can only be the age since sent: time in stage is recorded only in `activity_logs`. "Closed: Signed · Lapsed · Revoked" also from the list. |
| C2 Invitations per week (`dc:367`) | P | `created_at` and `signed_at` bucketed client-side (cap) |
| C3 Deals by type and state (`dc:368-370`) | P | Six `GET /deals` calls, or contracts `partner-deals` (has a total) |
| C4 Redemptions per week (NEW AGGREGATE, `dc:371`) | P | Fan out per deal; `attribution_kind` gives the series |

##### PI2 Invitations (PI11b on phone)

| Block | Status | Source and caveats |
|---|---|---|
| Invitee, email, Offered, Sent by, Sent, Opened, Expires/Lapsed, Result (Deal #, Member record) | E | All in `GET /invitations` (`admin_partners.ts:107-121`) |
| Stage pill and dots (`dc:427`) | P | Stored status, with the deal-overrides-stage rule (§9) |
| Email (NEW) column | N | §5 |
| Search by name or email | P | `email` is substring on the server; name is client-side only |
| Filters Stage, Deal type offered, Sent by, Sent within; sort | P | Client-side over at most 200 rows. The server filters one exact status. |
| Pager "1–25 of [42]" | P | No total (Guard L) |
| Export CSV (NEW) | N on the Worker | Client-side only |
| Row menu Copy link, Resend, Revoke | E | `link` per row; §2.1 writes |

##### PI3 Invitation lightbox (PI11c on phone)

| Block | Status | Source and caveats |
|---|---|---|
| Header: name, email, stage, sent by and date | E | List row |
| Progress: Sent, Opened, Signed dates | E | `created_at`, `viewed_at`, `signed_at` |
| Progress: Profile done, Offers shown, Offer chosen, Agreement out dates | N read | Recorded as `activity_logs` rows (§3, §6), which nothing reads. Partial stand-ins: `partner_profiles.created_at` and `updated_at`, `partner_deals.created_at`, the envelope's `created_at`. |
| "Link valid until" | E | `expires_at` |
| What we offered (`dc:383`) | N | Offers are computed per request and not stored. No admin route runs `buildProposals`. The canvas text is W (§4.1). |
| Their answers (NEW READ, `dc:386-387`) | P | `GET /api/profiling/admin/:email`, a logged read; check `invitation_id`. "Profile check: Waiting" = `admin_status` on the same row. |
| Chosen offer and agreement (`dc:388`) | P | Deal by `invitation_id` from `GET /deals?status=…` (proposal and status). Envelope state and dates from `GET /api/legal/esign?deal_id=`. "Not ready" as in PI1. |
| Your message (`dc:389`) | N | `personal_message` is not in the admin list (`admin_partners.ts:107-110`). The only route returning it is the token GET, which must not be used (§9). |
| History (NEW, `dc:390`) | N read | `admin_audit_log` and `activity_logs` rows exist; no reader |
| Footer Copy link, Resend, Revoke | E | — |

##### PI4 New invitation (PI4 form, PI4d delivered, PI4n not delivered)

| Block | Status | Source and caveats |
|---|---|---|
| Email, name | E | `POST /invitations`. The name has no cap on the Worker. |
| "Open invitation exists" (NEW) | P | `GET /invitations?email=` (substring), exact match and open state client-side. The Worker does not refuse a second invitation, and finding 2 makes that harmful. |
| "Belongs to a member (Founder)" (NEW) | P | `GET /api/admin/users?q=` → `role`. The sentence about keeping the role holds, but finding 1 applies to the plan. |
| Deal-type cards with summary, terms, tiers, term (`dc:403`, `:406`) | N route / W text | The five types are only in code, and in the 400's `valid` list (`admin_partners.ts:63`). Tiers and terms differ from the canvas (§4.1). The Capital line "Needs KYC and accreditation" is true (`partnerDeals.ts:363-364`, `:409-410`). |
| "Pick up to three" | N on the Worker | The Worker accepts five and slices to three later (`partnerDeals.ts:84`) |
| Adjust terms (NEW, `dc:407`) | N | No column; `buildProposals` is fixed text |
| Message counter "/ 2,000" | E | `admin_partners.ts:53` |
| "Shown in the email and at the start of the onboarding chat" | E | `email.ts:374-376`; `partner_onboarding.ts:128` |
| 14-day line; "Resending gives a new 14 days" | E | `:34`, `:135-139` |
| PI4d / PI4n result, link, Copy | E | `email_sent` and `link` in the 201 response. The not-delivered sentence must cover four causes (§5). |

##### PI5 Deals (PI11d on phone)

| Block | Status | Source and caveats |
|---|---|---|
| C5 Terms ending, 120 days (`dc:373-377`) | E | Active deals `activated_at`, `expires_at`. Terms are 30-day "months" (§4.2). |
| Top deals by redemptions, all states (`dc:378-379`) | E | `GET /deals/top?status=all&limit=5`. The partner name is null before signing. |
| Table: deal type, tiers, term, days left, code, redemptions, state | E per status | `GET /deals` |
| Table: partner name and email for unsigned deals | P | Join `invitation_id` to the invitation list |
| Due diligence column (NEW JOIN) | P | DD list matched on `subject_id = user_id`. "Not opened" = no case, which is always true before signing. "Cleared" needs a rule over `dd_cases.status` (open, in_review, completed, archived). |
| State chips (several at once) | P | One call per status, or contracts `partner-deals` |
| Search partner, email, code; deal type; ends within; has redemptions; sort | P | Client-side (Guard L) |
| Pager "1–19 of [19]" | P | No total, except via the contracts read |
| Terminate on active only | E | — |

##### PI6 Deal lightbox

| Block | Status | Source and caveats |
|---|---|---|
| Terms: summary, terms, tiers, term, started, ends, days-used bar (`dc:396`) | E | `proposal` (the stored snapshot) plus `activated_at` and `expires_at` from `GET /deals` |
| Referral code and last redeemers with days left (`dc:397`) | E | `GET /deals/:id/redemptions`. Tiers given = `granted_tier_*`. |
| Agreement "Signed [date]" (`dc:398`) | P | `activated_at`, or the envelope's `completed_at` via the esign list by `deal_id` |
| Due diligence case and KYB section (NEW JOIN, `dc:399`) | P | DD list plus one detail call (section `kyb_entity`). Cool-off applies. |
| Obligations (NEW JOIN, `dc:400`) | P/N | Trust score gives only `missing[]` and `required_total`. Satisfied, Pending and "Not needed" (waived) per key are not readable by an admin. |
| Invitation link | E | `invitation_id` |
| History (NEW, `dc:402`) | N read | `partner_deal_activated` and `partner_deal_terminated` rows exist; `terminated_at`, `termination_reason` and `terminated_by_user_id` are on the deal row (only the first two are returned, `admin_partners.ts:300`) |

##### PI7 Referrals

| Block | Status | Source and caveats |
|---|---|---|
| Tiles: all time, 90 days, windows open, closing ≤30 (`dc:455`) | P | Fan out per deal. "All time" can also be Σ`redemptions_count`, under Guard L. |
| C4 again | P | As PI1 |
| C6 Rev-share windows closing (`dc:453-454`) | P | Fan out over revshare deals, `revshare_window_remaining_days > 0` |
| Every redemption (NEW READ, `dc:444-452`) | P | Fan out. Columns: member name, code, registered (`redeemed_at`), tiers given, granted until, attribution, window. **The member's role is N** in this read; `users.role` comes only through the admin users search. No server search, sort or total. |
| "Payouts are handled in Contracts" | — | Settlements are HQ only (§7) |

##### PI8 Confirm dialogs

| Dialog | Status | Source and caveats |
|---|---|---|
| a. Resend: new 14 days and the new date (`dc:411`) | E | `expires_at` in the response |
| a. "Her progress stays at Offer chosen" (NEW) | N / W today | The stage resets to `sent` (`admin_partners.ts:138`) |
| a. "Sent" or "Not delivered" result | E | `email_sent` |
| b. Revoke (`dc:412`) | E | Optional reason ≤500, kept in the audit log. "Chosen offer and agreement voided" is true (`:176-199`). "Cannot be undone" is true: no route reverses it. Do not report the zero counts as fact (§9). |
| c. Terminate (`dc:413`) | E | Reason required, ≤500. "[12] members" = `redemptions_count`. "Unless they pay" holds for redeemers. For the partner, finding 1 applies. Do not draw `redemptions_revoked` as members. |

##### PI9 States

| State | Status | Source and caveats |
|---|---|---|
| 9a Loading | — | No data |
| 9b First use | E | `GET /invitations` → `items: []` is truthful, because failure is a 5xx. Production had zero invitations as of 2026-09-21. |
| 9c One block unreadable (`dc:478`) | E for the list | The 5xx is real. **But the T1 tiles drawn beside it come from the same invitations read**, so they cannot "still draw" without a separate overview read. |
| 9d Not recorded: step dates, older email rows, no answers (`dc:479`) | N | §5, §6. "No answers yet" = no profile row for the invitation. |
| 9e Agreement-not-ready banner (`dc:480`) | P | Readiness probe in §7 |
| 9f Moved notice, no match, no deals | — | Client-side. The redirect from `/admin/partners` joins `REDIRECT_ROUTES` (`wk/services/redirectRoutes.ts:30`) and should be `keep` because of finding 8. |

##### PI10 No permission and refusals

| Board | Status | Source and caveats |
|---|---|---|
| 10a "Not an admin" | E | 403 `{detail:'Admin required'}` |
| 10a "HQ has paused this studio's admin access" | W | A frozen HQ admin gets 423 `admin_frozen` on **writes only**, and reads are served by design (D135). A suspended branch gets no refusal from these routes at all (§1). "No studio data is shown while access is paused" is not something these routes can produce. |
| 10b Deal type not granted to a subsidiary studio (NEW) | N | No licence-grant read or check in any partner route |
| 10b Refused terminate | E | 409 `Deal is not active or not found` (`admin_partners.ts:331`) |
| 10b Refused revoke | E | 409 `Cannot revoke (already signed, already revoked, or not found)` (`:164`) |

##### PI11 Phone and PI12 Dark

The same reads as PI1, PI2, PI3 and PI5. Nothing new is needed from the Worker.

---

#### 12. #2370's cites re-checked at HEAD

| Cite in the issue (`537f646a3f`) | At HEAD `0b85c2b` | Note |
|---|---|---|
| `wk/index.ts:838` | `wk/index.ts:848` | The public flow is at `:850` |
| `fe/App.jsx:2697` | `fe/App.jsx:2701` | Lazy import still at `:129` |
| `fe/App.jsx:2472` | `fe/App.jsx:2476` | Also `:2475` for `/partner-onboarding/:token` |
| `fe/lib/api.js:1217-1257` | `fe/lib/api.js:1223-1263` | `dd.listCases` moved from `:5174-5177` to `:5181` |
| `admin_partners.ts` routes and requireAdmin lines | Unchanged | The issue's guard list leaves out the directory routes at `:434` and `:462` |
| `partner_onboarding.ts`, `partnerDeals.ts`, `email.ts:366-370 / :374-376 / :400 / :421`, `mig/028` and `mig/275` ranges, `dd.ts:124-152`, `wk/services/approvalSources.ts:272`, `wk/services/ai/railMatrix.json:3541`, `wk/services/redirectRoutes.ts:30` | Unchanged | — |
| `partnerDeals.ts:545-552` for the sweep | The doc comment and signature only | The body is `:552-648` |
| "refused while HQ has the branch frozen (`wk/auth.ts:523-528`)" | **Wrong** | The freeze is per admin (`admin_notices`), applies to writes only, and does nothing on a branch (`wk/auth.ts:568-590`). Branch suspension is `requireBranchNotSuspended`, which these routes never call. |

---

#### 13. How the absences were established

All searches were grep or ripgrep across `cloudflare-worker/src`. Each finding below is one search and what it returned.

- **Action-name readers:** each audit action name, on its own. Every hit was its own writer.
- **Readers of `partner_invitations`:** only four routes or services read the table: the funnel `wk/services/activationFunnel.ts:195`, the checklist `wk/services/onboardingChecklist.ts:395`, and the two partner routes.
- **Branch and suspension gates:** `requireBranchNotSuspended|branchOf|HQ_ONLY|requireHqAdmin|requireSuperAdmin` returned 0 in the three partner files.
- **Cool-off:** `/api/admin/partners` is absent from both cool-off lists.
- **Obligations:** `FROM legal_obligations` turns up no admin per-row read.
- **DD:** there is no subject-id filter on `GET /api/dd/cases`.
- **Delivery columns:** no `email_sent` or delivery column exists in `mig/028`, `base:3262-3282` or any migration that touches the partner tables (`028`, `033`, `042`, `208`, `275`, `276`, `462`, `477`).
- **Licence grants:** no licence-grant identifiers appear in any partner route.

## Part C — the page today and the admin shell

### Partner invitations (#2370): the page today and the admin shell around it

Tree: branch `claude/spinout-lab-workspace-wuyyqd`. The work order named HEAD `0b85c2b`. The branch has since moved to `0296848`, which adds one D894 commit touching only `frontend/src/pages/raise/pitch/*`, `frontend/test/pitch_studio_d894.test.mjs` and `D894.md` (`git show --stat 0296848`). Every cite below is the same at both commits, except the D894.md lines, which I read at `0296848`.

Path short forms: `wk/` = `cloudflare-worker/src/`, `fe/` = `frontend/src/`, `mig/` = `cloudflare-worker/sql/migrations/`, `dc:` = `design/incoming/Partner Invitations Page.dc.html`, and `Boards:` = `design/incoming/Partner Invitations · Boards.dc.html`. Test paths are written in full. Bracketed canvas values are samples, not data.

I only read files. The single exception was two read-only `node -e` probes, which wrote nothing: one ran `codeOnly` over App.jsx, the other called `pageKeyFor` for both addresses.

---

#### 1. `fe/pages/admin/PartnerInvitations.jsx` (975 lines; last changed `76d21b5`, 2026-10-23)

##### 1.1 Route, guard and frame
| Item | Fact | Cite |
|---|---|---|
| Lazy import | `const AdminPartnerInvitations = lazy(() => import('./pages/admin/PartnerInvitations'));` | `fe/App.jsx:129` |
| Route | `<Route path="/admin/partners" element={guard(['admin'], <AdminPartnerInvitations />)} />`. There is no `hqOnly`. | `fe/App.jsx:2701` |
| `guard` | `RequireAuth` around `RoleGuard allowedRoles={roles}` | `fe/App.jsx:2219-2225` |
| RoleGuard | Sends a role it does not allow to `<Navigate to={defaultPath} replace />`. So PI10a's "This page is for studio admins." card can never be drawn. | `fe/App.jsx:1819-1834` (Navigate at `:1830-1831`) |
| `hqOnly` | Not used here | `fe/App.jsx:2304-2306` |
| Default export | `export default function PartnerInvitations() { return (<AdminBoardFrame workspace="Partner invitations" note="Eadwyn reads the invitations listed here. An invitation goes out only when you send it." data-testid="admin-board-partner-invitations"><PartnerInvitationsBody /></AdminBoardFrame>); }`. The comment above it reads "D774 (#2100): S31 drew no rail." | `PartnerInvitations.jsx:968-975` |
| AdminBoardFrame | `({ workspace, note, children, 'data-testid' })`. A Super Admin gets `WorkerRail role="super_admin" data-testid="hq-board-rail"`, `role==='admin'` gets `role="admin" data-testid="admin-board-rail"`, and anyone else gets no rail. The whole thing is wrapped in `<RailFrame rail={rail}>`. | `fe/pages/admin/AdminBoardFrame.jsx:25-34` |
| Rail row | S31: `{ section: 'Community', module: 'Partner invitations', route: '/admin/partners', files: ['pages/admin/PartnerInvitations.jsx'], rail: FRAME }` | `fe/lib/railOptions/admin.js:73` |
| Rail page key | `own('/admin/partners', key(AD, 'Community', 'Partner invitations'))`. For a Super Admin there is no SUPER entry: `pageKeyFor('/admin/partners','super_admin')` returns `null` (node probe), so the HQ rail on this page has no key. No test covers that. | `fe/lib/railPages.js:290` |
| Canvas agreement | The canvas spine note matches the frame's note word for word (`dc:516`). The canvas board name matches `canvas.json` (`design/incoming/airail-every-page-data/canvas.json:196`). | — |
| Mount | `app.route('/api/admin/partners', adminPartners)`, imported at `:44`. Every handler calls `requireAdmin` directly with no wrapper, so a frozen HQ admin's POST reaches `app.onError` and gets **423** `adminFrozenBody` (`wk/index.ts:1473`). GETs skip the freeze (`wk/auth.ts:569-570`). | `wk/index.ts:846-848`; `wk/auth.ts:523-528` |

##### 1.2 Every read and write it calls
The client is `api.adminPartners`, inline in `fe/lib/api.js:1222-1263`, not a `lib/api/` module.

| Page call | Client method | Worker route | Shape / limits | How it fails |
|---|---|---|---|---|
| `loadInvitations` `:64-67` | `listInvitations({status,email})` `api.js:1224-1230` | `GET /invitations` `admin_partners.ts:97-123` | Returns `{items}`. Filters are one `status` and an email `LIKE` (`:103-104`). Newest 200 (`:114`), no total. Each row also carries `invited_by_name, viewed_at, signed_at, resulting_user_id, resulting_deal_id, envelope_id, revoked_at` (`:107-110`), plus `link` and `is_expired` (`:119-120`). | Truthful: there is no try, so a D1 error is a 500 |
| `loadDeals` `:77` | `listDeals(status)` `api.js:1237-1238` | `GET /deals` `:293-312` | One status, newest 200 (`:305-306`). Includes `activated_at, expires_at, terminated_at, termination_reason, redemptions_count, proposal` (`:297-302,:308-310`). | Truthful (500) |
| `loadDeals` `:80` | `listTopDeals({limit:5,status:'all'})` `api.js:1242-1248` | `GET /deals/top` `:215-233` | Limit clamped to 1–50 (`:217`) | Truthful, but **the page swallows the failure** (`:80`) |
| Resend `:105` | `resendInvitation(id)` `api.js:1233-1234` | `POST /invitations/:id/resend` `:125-151` | 409 when signed or revoked (`:132-133`). **Sets `status='sent'` whatever the stage** (`:137-139`). Returns `{email_sent, link, expires_at}` (`:150`). | — |
| Revoke `:764` | `revokeInvitation(id, reason)` `api.js:1235-1236` | `POST /invitations/:id/revoke` `:153-207` | Reason cut to 500 characters (`:157`). 409 when signed, revoked or missing (`:163-165`). The cascade voids deals and envelopes (`:173-200`). | The cascade's failures are swallowed (`:186,:197,:198,:200`), so `voided_*` can undercount without saying so |
| Terminate `:821` | `terminateDeal(id, reason)` `api.js:1239-1240` | `POST /deals/:id/terminate` `:314-421` | Reason required, 400 without one (`:318-319`). 409 unless active (`:327-331`). | `tiers_revoked` is `!!(granted tiers)` (`:418`), not whether the guarded UPDATEs (`:344-370`) changed anything. The redeemer cascade swallows its failures (`:382,:408`). |
| Redemptions `:880` | `dealRedemptions(id)` `api.js:1249-1250` | `GET /deals/:id/redemptions` `:240-291` | At most 500 rows (`:261`). `redemptions_count: items.length` (`:288`) is therefore capped at 500. The 365-day window is at `:265`. | 404 or 400 |
| Create `:630` | `createInvitation(data)` `api.js:1231-1232` | `POST /invitations` `:48-95` | Returns `{id, token, link, expires_at, email_sent, allowed_deal_types}` with 201 (`:91-94`). `email_sent` is false when the address is suppressed or Gmail is not set up (`wk/services/email.ts:366-370`). | 400 for a bad email or no valid deal type (`:59-64`) |
| Firm links `:490` | `listFirmLinks()` `api.js:1254` | `GET /links` `:529-560` | Returns `{accounts, firms, attached, unattached}`. Each list stops at 500 rows (`:541,:551`), so the counts are counts of those rows (`:557-558`). | Truthful |
| Firm links `:506` | `setFirmLink(userId, id\|null)` `api.js:1258-1262` | `POST /links` `:562-611` | Partner accounts only (`:582-586`). Audited as `partner_firm_link_set` (`:603-608`). | 400 / 404 |
| — not called by this page | `adminListDirectoryPartners`, `adminSetPartnerDirectory` `api.js:1815-1822` (called from `consoles/DirectoryConsole.jsx:28,:44`) | `GET /directory`, `POST /:id/directory` `:433-506` | | |

The header comment of `admin_partners.ts:7-15` lists 8 endpoints. The file serves 12.

##### 1.3 The UI parts (line ranges)
- **State (`:46-60`).** One `tab` in local state, so no tab has an address. The page uses no router hook: the file imports none (`:1-9`).
- **Header (`:124-140`).** h1 "Partner Invitations" in `text-2xl font-semibold`, with a violet `Handshake` icon (`:126-128`). One line under it (`:129-131`). Violet "New Invitation" button (`:133-139`). Wrapper `px-6 py-6 max-w-7xl mx-auto` (`:123`). There is no crumb, scope chip or count.
- **Tabs (`:142-162`).** Plain `<button>`s labelled `Invitations (${invitations.length})`, `Deals (${deals.length})` and `Firm links`.
- **Invitations (`:164-279`).** Email search, a status `<select>` of the nine raw keys (`:177-184`), Refresh. The table runs `:194-277`. Copy, Resend and Revoke are icon buttons with `title` only (`:241-269`).
- **Top deals card (`:281-306`).** Drawn only when `topDeals.length > 0`, which comes from the redemptions filter at `:83`.
- **Deals table (`:308-398`).** One-status select (`:311-319`). Terminate only when active (`:382-390`).
- **Dialogs.** All are hand-rolled `fixed inset-0 z-[70]` overlays (`:646,:775,:832,:890`), with no `role="dialog"` and no focus trap. Escape goes through `useEscapeClose` (`:620,:760,:816,:877`).
- **Toast.** Fixed bottom-right (`:449-455`). It disappears after 4 s (`fe/components/useToast.js:10,:24-27`).
- **FirmLinks (`:460-610`).** Comment `:460-481`. Loading `:519-521`. Error card with Try again `:522-532`, which is honest. Counts `:538-542`. Each select saves on change (`:588-592`).
- **Doors.** A `codeOnly` scan finds **0 navigation targets** in the file, so the page links nowhere.
- **Accessibility.** The file has **no** `role=` or `aria-` attribute (grep count 0).

##### 1.4 Honesty defects (each confirmed by reading HEAD)
1. **A failed list read shows an empty state.**
   - Invitations: the catch toasts (`:69-71`), `invitations` stays `[]`, the table says "No invitations yet." (`:209-210`) and the tab says "Invitations (0)" (`:144`).
   - Deals: same (`:84-86`), with "No {status} deals." (`:345-346`) and "Deals (0)" (`:145`).
   - After 4 s the toast is gone and only the false empty state remains (`useToast.js:24-27`).
2. **A failed refresh is silent.** Refresh calls `loadInvitations` directly (`:187`). On failure the old rows stay, unlabelled.
3. **The top-deals failure is swallowed** (`:80`): the card simply disappears (`:281`).
4. **New finding: one effect reloads both tabs on any filter change.**
   - The effect depends on both callbacks (`:89-92`).
   - So one keystroke in the email box (`:171-172`) sends three requests (invitations, deals, top deals) and spins both tables (`:207-208,:343-344`).
   - Nothing cancels a stale request, so an earlier, slower response can overwrite a later one (`:62-87`).
5. **New finding: the redeemers modal refetches in a loop on failure.**
   - `onError` is an inline arrow (`:430`) and sits in the effect's dependencies (`:878-884`).
   - A failure calls `showToast`, which re-renders the parent, which passes a new `onError`, which re-runs the fetch.
   - The modal also says "No redemptions yet." after a failure (`:882,:917-918`), and it refetches whenever the parent re-renders, for example when the toast expires.
6. **"Invitation sent" even when no email went** (`:405`). Create ignores `email_sent`. Resend checks it, but its fallback text is "Saved (email delivery skipped)" (`:106`).
7. **The created link closes on a 1.5 s timer.**
   - `setTimeout(() => onCreated(r), 1500)` (`:637-638`) is never cleared.
   - `submitting` is never reset on success, so Close and Escape do nothing for those 1.5 s (`:619,:655`).
   - The Copy button has no failure path: `navigator.clipboard.writeText` rejects unhandled (`:677`).
8. **New finding: the copy-failure toast says "Copy failed — long-press the link" (`:118`), but the row shows no link** (`:241-248`, icon only).
9. **Resend is offered on every stage but Signed and Revoked** (`:212`), and the Worker then resets the stage to "sent" (`admin_partners.ts:137-139`).
10. **Revoke copy is the same for every stage.** It always says it "will void any in-flight deal and signing envelope", even for a Sent invitation (`:784-787`).
11. **Terminate copy gives no count.** It says "cascade to every prior referral redemption" (`:841-844`) although the row carries `redemptions_count` (`admin_partners.ts:302`). Its result toast claims "partner tier revoked" whenever the deal granted a tier (`:823`; Worker `:418`).
12. **Raw words.**
    - Status keys appear in the select and the pill (`:183,:231`).
    - Deal status keys such as `awaiting_signature` appear in the select and the pill (`:316-318,:378`).
    - Deal types are lower-cased with spaces (`:224,:301,:353`).
    - Tier keys `founder_pro` and `professional` are drawn raw (`:356-357,:938-939`; values from `wk/services/partnerDeals.ts:95-96`).
    - `fmtDate` uses the locale's `toLocaleDateString()` (`:42`).
13. **Bare dashes for unknown values.** `'—'` is used at `:41,:217,:300,:350-351,:360-361,:940,:953`, and "Unknown partner" at `:295`. Both break `fe/ui/Honesty.jsx:21-23`.
14. **A lapsed invitation is shown only by a triangle icon with no text** (`:232-234`). Its status stays "sent".
15. **Hidden caps.** The lists stop at 200 rows (`admin_partners.ts:114,:306`) and the tab counts are counts of loaded rows (`:144-145`). Nothing says so.
16. **Off the design system.** Blue, indigo and fuchsia pills (`:19-38`), and a 600-weight title (`:126`).

##### 1.5 Tests that pin the page itself
Only the frame shape is pinned (§3). A grep of `frontend/test` and `cloudflare-worker/test` for `PartnerInvitations`, `listFirmLinks`, `setFirmLink`, `adminPartners`, `admin-board-partner` and `partner-invitations` finds only `cloudflare-worker/test/admin_partner_firm_link.test.ts:39,:54`, which tests the Worker's `/links`. The e2e spec `tests/e2e/partner-onboarding.spec.ts` drives the page (§3, item M).

---

#### 2. Every place that names `/admin/partners` or `/admin/partner-invitations`

Search: `git grep -n "admin/partners\b…\|admin/partner-invitations"` excluding `docs/`, then `git grep -i "partner invitations\|PartnerInvitations"` over `fe/`, `wk/`, `scripts/` and the architecture docs. **`/admin/partner-invitations` appears only in the canvas and in `design/incoming/README.md:177`.**

| Place | Today | What the new address needs |
|---|---|---|
| `fe/App.jsx:2701` | The route | Add `/admin/partner-invitations` and `/invitations`, `/deals`, `/referrals` (optionally `/invitations/:id` and `/deals/:id`), each `guard(['admin'], <AdminPartnerInvitations />)`, in **App.jsx at 6-space indent**. `held_admin_shell_d286` reads App.jsx only (`frontend/test/held_admin_shell_d286.test.mjs:47,:67`), and the reachability parser splits on `'\n      <Route'` (`frontend/test/admin_route_reachability.test.mjs:81`). `/admin/partners` becomes the redirect. |
| `fe/App.jsx:2990-3008` | The prose comment on the retired `/partners` page, which calls `/admin/partners` "the invitation flow" (`:2996`) | Reword it to name the new address. See §3 B for what the reachability pin really reads. |
| `fe/sidebarConfig.js:226-227` | The Approvals row's `match` includes `'/admin/partners'`. Community's match is `['/admin/events','/admin/jobs','/admin/circles']` (`:230`). | Matching is exact-or-subtree (`fe/ui/SidebarNav.jsx:211-213`; `fe/lib/mobileTabs.js:101-104`). `/admin/partner-invitations` does **not** fall under `/admin/partners/`. Put the new address in the match of the row that should light. The canvas lights Community (`dc:490`). No test pins either list by value. D506 pins only spinout-moderation (`frontend/test/held_approvals_moderation_door_d506.test.mjs:88-89`). Every match entry must be a registered App.jsx route (`held_admin_shell_d286.test.mjs:94`). |
| `fe/lib/adminPlacement.js:84` | `row('Partner Invitations', '/admin/partners', admin('Approvals','lane'), false, { how: 'A lane.' })`. `row()` sets `key: route` (`:46`). | The **key must stay `/admin/partners`**, because the legacy set is pinned (`admin_placement_h35.test.mjs:52,:154-162`). The route can change only through an explicit object, as the X row does (`:81`): `{ key:'/admin/partners', kind:'row', label, route:'/admin/partner-invitations', hqOnly:false, ... }`. If the row moves to Community, copy Events, Jobs and Circles: `admin('Community','card link')` with `also:[admin('Approvals','lane')]` (`:66-71`). The palette indexes `e.route` (`fe/lib/paletteIndex.js:63-66`) on both admin shells (`:18`). |
| `fe/pages/admin/HeldApprovals.jsx:95` (and its comment `:15`) | Lane 13 is `<Link to="/admin/partners">/admin/partners</Link>` with `noQueue="Partner invitations"`. It is the **only literal door to the page** (doors scan: 15 on HeldApprovals, 5 on HeldCommunity, none to this page elsewhere). | Change the target **and** the shown text together (`held_admin_shell_d286.test.mjs:209-211`). The door count stays 15 (`:131`). |
| `fe/pages/admin/HeldCommunity.jsx:73-94` | Five literal doors; Partner invitations is not one | A Community door is optional and needs test edits (§3 C). The file's comment says "FIVE LITERAL LINKS" (`:11`). |
| `fe/pages/admin/adminStudioOverview.js:385` | `NO_QUEUE_CONSOLES['Partner invitations'] = '/admin/partners'`, used at `:442` | Change it with lane 13 (§3 E). |
| `wk/services/approvalSources.ts:272` | `NOT_LANED` names the **label** "Partner invitations", not a route | **No change for the move.** The issue lists it as following the slug; it does not. Its label is pinned (`cloudflare-worker/test/branch_approvals_s16_d215.test.ts:118-128`). |
| `fe/lib/railPages.js:290` | `own('/admin/partners', …Community…Partner invitations)` | Change it to `own('/admin/partner-invitations', …)`. The key is unchanged, and the prefix covers the tabs and `:id` (`:12-13`). Drop `/admin/partners`, because a redirect does not draw a rail (§3 F). |
| `fe/lib/railOptions/admin.js:73` | S31 `route: '/admin/partners'` | Change `route`. Keep `files` to files that hold the frame (§3 H). |
| `wk/services/ai/railMatrix.json:3541` | `"pageKey": "Admin · Community · Partner invitations"`, `kind: write` | **No change.** It is keyed by page key, not address (the issue says it must follow the slug). |
| `wk/services/redirectRoutes.ts:30-138` | No entry. The precedent is `{ path: '/admin/held/insights' }` (`:137`). | Add `{ path: '/admin/partners' }` (§3 I). |
| `wk/services/partnerDeals.ts:876` | **New finding:** the daily rev-share digest emails every admin `Admin panel: /admin/partners` | Point it at the new Referrals tab. Old emails carry the old address (see conflicts). |
| `fe/pages/partner/kit.jsx:200-201` | **New finding:** member-facing copy reads "An admin can attach it under Partners → Firm links." | Rename it when Firm links moves (§4). Not pinned: grep for "Firm links" and "Partners →" in tests finds nothing on it. |
| `fe/lib/api.js:1229-1259`, `:1816-1818`; `wk/index.ts:846-848`; `wk/routes/admin_partners.ts:4` | `/api/admin/partners/*` | **API paths do not move.** The drift test ties api.js to the Worker routes. |
| `fe/pages/docs/sections/*.js` | **Nothing.** Grep for "partner invit", "partner-invit" and "admin/partners" under `fe/pages/docs` returns 0. | — |
| `documentation/architecture/ROUTE_MAP.md` | **No row** names it. The only partner rows are `:938-939` (Partner Operator Canvas, PartnerRail). | Add a row (§3 J) |
| `design/incoming/README.md:167-181` | The "Landed 2026-10-24" note: "S1's integration lands next and records its grade here" | Record the grade |
| Historical, leave as is | `documentation/architecture/DECISIONS.md:28881`, `decisions/D556.md:219`; frozen canvases `design/canvases/integrated/Admin · Subsidiary.dc.html:2215` and `Admin · Super.dc.html:2309`; `CHANGELOG.md:8381-8383` (API paths) | — |
| Test prose only (no assertion) | `frontend/test/projects_partners_retired.test.mjs:5,:41`; `frontend/test/admin_route_reachability.test.mjs:23-27` | Reword as needed |

**Where the page sits.**
- **HQ shell:** none of its 13 rows (`fe/sidebarConfig.js:109-147`).
- **Branch shell:** no door and no match (`fe/sidebarConfig.js:174-188`; grep of `fe/pages/branch/` for `admin/partners` and "Partner invitations" returns 0).

---

#### 3. Tests that pin those places, and what the new address must satisfy

| Test | What it pins today |
|---|---|
| `frontend/test/rail_options_admin_d774.test.mjs:63-72` | Board IDs and names match canvas.json (S31 = Community · Partner invitations) |
| same, `:74-91` | Every `files` entry exists, and the `rail` file mounts a self-closing `<WorkerRail …/>` |
| same, `:105-115` | The framed list is exactly `['S3','S4','S8','S9','S10','S11','S15','S16','S17','S18','S23','S31','S39']` (`:107`). Every S31 file has exactly one `<AdminBoardFrame workspace="Partner invitations"`, and the default export matches `export default function \w+\(\) \{\s*return \(\s*<AdminBoardFrame\b` (`:112`). |
| same, `:209-226`, `:228-235` | Any `type="file"`, `.draft(` or `dd.generateReport(` in board files must be listed; `ADMIN_OPTIONS` stays `[]` |
| `frontend/test/held_admin_shell_d286.test.mjs:88-96` | Each row's `match` entry is a registered App.jsx route |
| same, `:128-143` | Literal door counts `{ Accounts:4, Approvals:15, Programs:4, Community:5 }` (`:131`); no `.map(` into `<Link` |
| same, `:181-199`, `:216-232` | Lane 13 is exactly `[13,'Absorbed','Partner invitations','/admin/partners','<LaneState glance={glance} noQueue="Partner invitations" />']` (`:195`). Every lane route must be a placement **route** on Admin · Approvals (`:221-231`). |
| same, `:238-244` | Community doors are exactly `['/admin/events','/admin/jobs','/admin/circles','/admin?tab=network-profiles','/admin?tab=wellbeing']` |
| same, `:297-306` | `/admin/partners` is in the orphans list (`:298`) and must have a literal door on the shell |
| `frontend/test/admin_placement_h35.test.mjs:45-78` | `/admin/partners` is a LEGACY_ROW (`:52`); there are 34 rows (`:124`) |
| same, `:154-171`, `:173-188`, `:190-201` | Nothing outside the legacy keys is placed; placed **routes** are registered; `hqOnly` is derived from App.jsx |
| `frontend/test/hq_studio_figures_d555.test.mjs:82-85` | Every `NO_QUEUE_CONSOLES` value appears as `to="…"` on HeldApprovals |
| `frontend/test/admin_route_reachability.test.mjs:425-436` | Every `/admin` route that is not a redirect is reachable |
| same, `:454-459` | No dangling or ambiguous `/admin` link |
| same, `:461-490` | `REDIRECTS` equals `['/admin/held/insights','/admin/news']` (`:464`). `COMPONENT_TARGETS = { HeldInsightsRedirect: '/admin/insights' }` (`:468`), and its check reads **`insightsModel.js`** for every component (`:473-474`). |
| same, `:565-587` | `codeOnly(APP).includes('/admin/partners')` (`:575`) and the scanner reads no door from prose (`:579`). **Verified: the prose comment does not survive `codeOnly`.** The only surviving line is the route at `App.jsx:2701`, so the pin holds because the route is code. The header claim at `:23-27` and the comment at `:571-574` are already false. |
| same, `:599-616`, `:618-635` | SECOND_MOUNTS parity; every COMPOSED file is imported by its host |
| `frontend/test/rail_pages_d768.test.mjs:58-74` | Every rail-drawing route (`frontend/test/_railRoutes.mjs:79-96`) has a key for each role its guard admits |
| same, `:76-91` | One owner per key; an alias says why (more than 10 characters) |
| `frontend/test/airail_render_admin_d781.test.mjs` + `frontend/test/_airailRender.mjs` | Every RAIL_PAGES route (`:82-87`) renders as Admin with exactly one rail keyed `pageKeyFor(landed)` (`:389`), in the 503 or `{}` state (`:408`). `/admin/partners` is not in `RENDER_NOT_YET` (`:170-177`), so it must pass. |
| `frontend/test/redirect_hits_2301.test.mjs:38-52` | `REDIRECT_ROUTES` equals App.jsx's redirect-only routes (`Navigate` or `*Redirect` only, `:24-36`) |
| `cloudflare-worker/test/redirect_hits_2301.test.ts:37-47` | The list is well formed, and the `keep` list is pinned by value (`:45-46`) |
| `frontend/test/profile_routing_fresh.test.mjs:20-27`, `:37-108` | Generated docs are fresh; `recs.length === 149` (`:103`) |
| `cloudflare-worker/test/branch_approvals_s16_d215.test.ts:118-128` | NOT_LANED labels include "Partner invitations"; there are 11 lanes |
| `tests/e2e/partner-onboarding.spec.ts:137-165`, `:239-265`, `:395-419` | Heading `/Partner Invitations/i`, button `/New Invitation/i`, heading `/New Partner Invitation/i`, button `/Send Invitation/i`, the readonly link input before "the modal auto-closes (1.5s)" (`:163-167`), button `/^Deals/i` (`:396`), deal `tr` rows (`:399`), `/^Terminate Deal$/i` (`:419`). It is skipped without E2E env (`:120-126`). |

**What `/admin/partner-invitations` with `/invitations`, `/deals`, `/referrals` (+ optional `/:id`) and the `/admin/partners` redirect need:**

- **A. Routes.** App.jsx at 6-space indent, `guard(['admin'])`, no `hqOnly` (§2 row 1). Static paths outrank `:id` in React Router (`frontend/test/route_namespace_policy.test.mjs:14-21`).
- **B. Reachability.**
  1. Give each tab a literal door: `to="/admin/partner-invitations/invitations"` and so on (patterns `admin_route_reachability.test.mjs:153-167`).
     - Put them **in the routed file**. Otherwise add a COMPOSED entry (`:269-282`) and import each file as `from './…'` (`:618-635`); D800 did this (`decisions/D800.md:147`).
  2. A `/:id` door through `` to={`/admin/partner-invitations/invitations/${id}`} `` resolves to one candidate (`toRoute` `:194-222`), so it is not ambiguous.
  3. The landing door is lane 13 (and Community, if adopted).
  4. `REDIRECTS` (`:464`) becomes `['/admin/partners','/admin/held/insights','/admin/news']`, which is source order (`App.jsx:2701 < :2730 < :2826`).
     - With an inline `<Navigate to="/admin/partner-invitations?moved=partners" replace />` that is the only edit, because the target is read from the body (`:469`).
     - With a `*Redirect` component (D893 style), `:468-474` must be generalised, because they read only `insightsModel.js`. The component must also be lazy-imported so `FILE_OF` maps it (`:410-422`).
  5. Keep the `path="/admin/partners"` route; otherwise the `:575` pin fails.
  6. Link no `/admin` route that does not exist (§7).
  7. Import no routed page (`:599-616`).
- **C. held_admin_shell_d286.**
  - Edit `:195` (lane 13 route) and `:298` (orphans) to the new address.
  - The placement **route** must be the new address and placed on Approvals, as tier or `also` (`:221-231`).
  - A Community door needs `:131` (5 → 6) and `:240` (add the address).
- **D. admin_placement_h35.** Use the explicit object with key `/admin/partners` (§2). That needs no test edit.
- **E. hq_studio_figures_d555.** Change `NO_QUEUE_CONSOLES` and lane 13 in the same commit (`:82-85`).
- **F. D768.**
  - Re-point `railPages.js:290`. The redirect is `rail:false` in the census (`_railRoutes.mjs:85-93`) **only if** its element does not reach WorkerRail. A redirect exported from the page file would be counted as rail-drawing with no member role, and fail with "(no member role)" (`rail_pages_d768.test.mjs:66`).
  - Optional tab aliases, Licences style (`railPages.js:296-299`), let D781 render each tab. Do not alias `:id`.
- **G. D781.** `/admin/partner-invitations` must draw exactly one rail with the key under 503 **and** `{}` (`_airailRender.mjs:408`). A body that throws on `{}` loses the rail. Today's page already handles `{}` (`r.items || []` `:68,:82`; `Array.isArray` `:499-500`).
- **H. D774.**
  - Change S31 `route` (`railOptions/admin.js:73`).
  - Keep `rail: FRAME`, and list only files that hold the frame. Licences lists only the frame file (`:81`).
  - The alternative is Insights style: its own `RailFrame` + `WorkerRail`, with `rail:` the page file (`:80`). Then S31 must come out of `:107`, and `frontend/test/rail_frame_d556.test.mjs:104-116` requires `<RailFrame … rail=` in the same file.
- **I. Redirect counts.**
  - Add `{ path: '/admin/partners' }` to `wk/services/redirectRoutes.ts` (`frontend/test/redirect_hits_2301.test.mjs:42-43`).
  - With `keep: true`, also edit `cloudflare-worker/test/redirect_hits_2301.test.ts:46`.
- **J. Profile routing.**
  - Add a ROUTE_MAP row after `:888`, with `/admin/partner-invitations` first, in backticks, in the live cell. `navFor` walks live routes, then `match` (`scripts/build-profile-routing.mjs:216-240,:281-291`).
  - Run `node scripts/build-profile-routing.mjs`, then set `recs.length` from 149 to the next number with a dated comment (`profile_routing_fresh.test.mjs:100-103`). D915 (`decisions/D915.md:3`) and the Programs map share that counter.
- **K. Folder docs.**
  - A new `pages/admin/<sub>/` must be named in `fe/pages/admin/README.md`, as Insights is at `:76-78` (`scripts/check-folder-docs.mjs:206-211`).
  - Every backticked file it cites must exist (`:213-258`).
  - 8 or more files means a `DOCUMENTED` entry (`:123,:183-193`).
- **L. Dark mode.**
  - Literal `className` only is scanned (`scripts/check-dark-mode.mjs:29-35`), with the pairings in `scripts/codemod-dark-mode.mjs`. The opt-out is `dark-mode-exempt` (`check-dark-mode.mjs:39-55`).
  - Use declared `axal-*` tokens only (`frontend/test/ui_design_tokens.test.mjs:93`).
- **M. e2e.** Update the selectors listed above, or keep the dialog title and Deals tab labels.

---

#### 4. The Advisors & Partners page and Firm links

**Today.**
- **Where it is.** `/admin?tab=network-profiles` (`fe/pages/AdminPage.jsx:60` label "Advisors & Partners"; mounted `:234-236`), and a standalone `/admin/network-profiles` (`fe/App.jsx:2811`) that is exempt as "same-component-elsewhere" (`admin_route_reachability.test.mjs:366`).
- **The component.** `fe/pages/admin/AdminNetworkProfiles.jsx` (494 lines) is the **Demo Day deck roster**: "Admin-only roster that feeds the … Demo Day deck's Team & Network slide" (`:1-9`). Its h1 is "Mentor & partner network" (`:371-372`). The default kind is `'mentor'` (`:26-30`). Archive uses `window.confirm` (`:323-326`).
- **What it reads.** Only `adminNetworkProfiles` (`:16`). It reads **no partner account or firm**: grep of the file for `listFirmLinks` and `partner_id` returns 0.
- **Doors and rail.** HeldCommunity door (`fe/pages/admin/HeldCommunity.jsx:83-86`); HQ Content strip (`fe/App.jsx:1111`); branch "Network profiles" → `/admin/network-profiles` (`fe/pages/branch/BranchCommunity.jsx:97-99`). Rail: S29 (`railOptions/admin.js:71`), H23 (`railOptions/superAdmin.js:63`), key `Admin · Community · Advisors and partners` (`railPages.js:288`).

**Firm links today.**
- The tab on this page is the **only UI that writes `users.partner_id`**: `setFirmLink` has one caller (`PartnerInvitations.jsx:506`; grep of `fe/`).
- The Worker routes are `GET|POST /api/admin/partners/links` (`admin_partners.ts:529-611`), pinned by `cloudflare-worker/test/admin_partner_firm_link.test.ts`.
- Partner workspaces send unattached accounts here by name (`fe/pages/partner/kit.jsx:200-201`).

**Where they would move (#2369, read through the GitHub API, issue body).**
- `/admin/advisors-partners/firms`: AP5's top strip "Partner accounts with no firm: [18]" with "Attach to firm", the AP10 attach dialog ("You choose both. Nothing is matched for you."), the AP9d Detach confirm, and AP6's firm drawer.
- #2369 records the agreement: "this page's Firms tab owns the firm-link queue; Partner invitations keeps one 'Needs you' row that links here". Its wiring reuses `adminPartners.listFirmLinks` and `setFirmLink`.
- **#2369 has no canvas yet.** It is labelled `needs-design`, and `ls design/incoming` shows no Advisors file. `/admin/advisors-partners` is not a route (0 `path=` matches in App.jsx).

**What this canvas does with them.**
- No Firm links tab: the canvas's tabs are Overview, Invitations, Deals, Referrals (`dc:461`).
- The prompt's DO NOT DRAW list moves firm attachment to Advisors & Partners.
- PI1 keeps the row "[18] partner accounts are not attached to a firm." with "Open in Advisors & Partners" (`dc:363`). Its count would come from `GET /links` `unattached` (`admin_partners.ts:558`).

---

#### 5. Conventions to copy

- **Header** (Insights, `fe/pages/admin/insights/AdminInsights.jsx:330-337`).
  - h1 `text-[24px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100`.
  - Canvas copy: h1 "Partner invitations", line "Bring operating partners in, see where each invitee stands, and keep their deals healthy." (`dc:460`). The violet "New invitation" button is desktop only (`dc:462`); on a phone it sits in the body (`dc:485`).
  - The crumb "Community › Partner invitations" links to `/admin/community` (`dc:460`), which is not a route. Link `/admin/held/community` (`fe/App.jsx:2726`), as `decisions/D915.md:28` did.
- **Scope chip.**
  - Insights' chip reuses `SCOPE_LABEL` and `SCOPE_TITLE` (`insights/insightsModel.js:26-27`, chip `AdminInsights.jsx:332`), and D915 copies it (`D915.md:34`).
  - **This canvas draws none:** `scope = false` at `dc:460`, and no board sets it.
  - The shell already draws `HQ-held · axal.vc` (`fe/App.jsx:1323-1327`; pinned `held_admin_shell_d286.test.mjs:334-345`), and so does the canvas (`dc:502`).
- **Tabs as addresses** (Licences, D800).
  - One `guard(['admin'], <MyLicencePage />)` per sub-path (`fe/App.jsx:2713-2719`).
  - The tab comes from the path (`fe/lib/licencePage.js:24-39`; `MyLicencePage.jsx:433`).
  - The strip is `NavLink to=… end`, **written out literally** (`fe/pages/subsidiary/LicenceFrame.jsx:50-64,:75-88`), and scrolls sideways on a phone (`:76-77`).
  - The canvas marks it `role="tablist"` with `<a role="tab" aria-selected>` (`dc:64-65`), a count pill per tab, amber on Overview (`dc:461,:511`), and 44 px tabs on a phone (`dc:511`).
- **Lightbox.**
  - Signature `fe/ui/Lightbox.jsx:69-71`: dialog role, focus trap, inert background, full screen on a phone (`:5-21`).
  - `width` defaults to 560; the canvas's PI3 and PI6 are 940 wide in two columns (`dc:391`).
  - Footer classes are `actionPrimary`, `actionGhost` and `actionDanger` (`fe/ui/index.js:41`; `ActionSheet.jsx:29-31`).
  - The record crumb uses `useRecordCrumb(title, type, id)` (`fe/pages/admin/useRecordCrumb.js:11-17`); the rail's trail logic is at `fe/ui/WorkerRail.jsx:492-494`.
  - The phone record PI11c is a page with "‹ Invitations" back to `/admin/partner-invitations/invitations` (`dc:487`). Lightbox page mode is `pageBelow` (`Lightbox.jsx:28-29`).
- **Phone sheets.** `PhoneSheet({label,title,onClose,opener})` (`fe/ui/phone/PhoneSheet.jsx:19`); Insights uses it at `AdminInsights.jsx:408-414`. `usePhoneWidth()` (`fe/ui/phone/usePhoneWidth.js:10`). The rail column is hidden below 1024 px, never unmounted (`rail_frame_d556.test.mjs:249-256`).
- **Charts.**
  - Use `InsightsCharts.jsx`'s one palette (`:18-35`): violet (`dark:` #a78bfa), sky, amber, emerald, muted. Its exports: `HBars :66`, `Columns :111` (stack too, `:342`), `WeekLine :178` (one series plus `previous`), `Bar100 :236`, `Donut :255`, `Legend :284`, `ChartTable :307`, `Chart :339`.
  - Existing parts cover C1 and C6 (HBars) and C2 (Columns).
  - **There is no** two-series line part for C4 (consider `fe/components/WeeklyLineChart.jsx:35`), no absolute stacked horizontal bar for C3, and no timeline (Gantt) for C5.
  - D915's rule applies: reuse D893's parts, and move any part needed outside `insights/` to `fe/ui/` in its own commit (`D915.md:165`).
- **Honesty.**
  - `Unrecorded({children,reason})` (`fe/ui/Honesty.jsx:37`) and `Unreadable({what,claim,onRetry})` (`:62`), from `fe/ui/index.js:87`. `NOT_RECORDED` and `text` from `fe/ui/index.js:93` (single definition: `frontend/test/absence_helpers_single_definition.test.mjs`).
  - Never `?? 0` or `'—'` for an unknown value (`Honesty.jsx:21-23`).
- **Moved notice and redirect.**
  - D893: `HeldInsightsRedirect` keeps the query and hash and adds `?moved=` (`fe/pages/admin/insights/HeldInsightsRedirect.jsx:12-16`; `insightsModel.js:23-25`). It is lazy-imported (`App.jsx:146`) and unguarded (`:2730`). The page shows a `role="status"` notice with Dismiss (`AdminInsights.jsx:270,:333-337`), counted at `redirectRoutes.ts:137`, and the move is pinned at `frontend/test/admin_insights_d893.test.mjs:377-380,:410-422`.
  - D894: `?moved=pitch-workspace` (`D894.md:22-23`).
  - Canvas copy: "Partner invitations has a new address. Update your bookmark." with Dismiss (`dc:481`, MOVED `:272`).
  - The old page read no query (it imports no router hook), so an inline `Navigate` loses nothing.

---

#### 6. Issue cites against HEAD (only the page and shell cites I re-read)
| Issue (`537f646a3f`) | HEAD |
|---|---|
| `fe/App.jsx:2697` | `:2701` |
| `fe/App.jsx:2472` (`/partners/onboard`) | `:2476` |
| `fe/App.jsx:2976-2994` (prose) | `:2990-3008` |
| `wk/index.ts:838` | `:848` |
| `fe/lib/api.js:1217-1257` | `:1222-1263` |
| `api.js:1218-1224` / `:1225-1226` / `:1227-1234` | `:1224-1230` / `:1231-1232` / `:1233-1240` |
| `api.js:1231-1242` / `:1243-1244` / `:1248` | `:1237-1248` / `:1249-1250` / `:1254` |
| `api.js:5174-5177` (`dd.listCases`) | `:5181-5184` |
| `held_admin_shell_d286.test.mjs:189`, `:288` | `:195`, `:298` |
| `admin_route_reachability.test.mjs:559-567` | `:571-580` |
| `fe/sidebarConfig.js:109-148` | `:109-147` (13 rows) |

Unchanged: every `PartnerInvitations.jsx`, `admin_partners.ts`, `adminPlacement.js:84`, `sidebarConfig.js:226-227`, `HeldApprovals.jsx:15,:95`, `railPages.js:290`, `railOptions/admin.js:73`, `approvalSources.ts:272`, `adminStudioOverview.js:385`, `railMatrix.json:3541`, `admin_placement_h35.test.mjs:52`, `projects_partners_retired.test.mjs:5,:41`, `redirectRoutes.ts:30`, `auth.ts:523-528`, `email.ts:366-370`, `LegacyContractsRedirect.jsx:4,:8-12`, `dd.ts:124` cite.

Corrections to the issue:
- `railMatrix.json` and `approvalSources.ts` do not follow the slug.
- The reachability prose pin is satisfied by the route line, not by the prose.

---

#### Checklist for passing first time
1. **Routes in App.jsx** at 6-space indent: `guard(['admin'], <AdminPartnerInvitations />)` for the four addresses (+ `:id`), and no `hqOnly`.
2. **Redirect:** `<Route path="/admin/partners" element={<Navigate to="/admin/partner-invitations?moved=partners" replace />} />`.
   - Keep the path string, which the `:575` pin needs.
   - Add `{ path: '/admin/partners' }` to `redirectRoutes.ts`.
   - Update `REDIRECTS` at `admin_route_reachability.test.mjs:464` to `['/admin/partners','/admin/held/insights','/admin/news']`.
   - If you use a `*Redirect` file instead, generalise `:468-474` and lazy-import it, in its own file that does not reach WorkerRail.
3. **Doors:** literal `NavLink to="…"` tabs in the routed file, or COMPOSED + import parity. Template `to={`…/${id}`}` for records.
4. **Lane 13 and the overview, in one commit:** `HeldApprovals.jsx:95` (target and text), `adminStudioOverview.js:385`, `held_admin_shell_d286.test.mjs:195` and `:298`.
5. **Placement:** an explicit object with `key:'/admin/partners'`, `route:'/admin/partner-invitations'` (`adminPlacement.js:84`), placed on Admin · Approvals as tier or `also`.
6. **Sidebar:** add the new address to one row's `match`, a registered route (`held_admin_shell_d286.test.mjs:94`). If that row is Community and you add a Community door, edit `:131` and `:240`.
7. **Rail:** `railPages.js:290` → `own('/admin/partner-invitations', …)`. `railOptions/admin.js:73` route updated. The frame stays the outermost element of the default export, which takes no props, with `workspace="Partner invitations"` once per listed file. `ADMIN_OPTIONS` stays `[]`, and add no file input or `.draft(`.
8. **D781:** the new route draws one rail keyed `Admin · Community · Partner invitations` under 503 and `{}`, and never throws on `{}`.
9. **Honesty:** `Unreadable` with Try again per block. Never "No invitations yet" after a failure, no `'—'` or `?? 0`, no corner toast for results (show them inline), no timer that closes a dialog, a failure path for every clipboard write, and no inline function in an effect's dependencies.
10. **No dangling `/admin` links:** do not link `/admin/community`, `/admin/advisors-partners`, `/admin/partner-profiles` or `/admin/kyc` (none is registered).
11. **Dark mode:** literal pairs, and declared `axal-*` tokens only.
12. **Folder docs** for any new subfolder.
13. **ROUTE_MAP row + regenerate + count bump**, after whichever of D915 and Programs lands first.
14. **Copy:** App.jsx prose `:2990-3008`, `partnerDeals.ts:876`, `kit.jsx:200-201` (when Firm links moves), the e2e selectors, the `design/incoming/README.md:167-181` grade, and the decision file (`node scripts/check-decision-ids.mjs`).

#### Open conflicts to settle
1. **The canvas crumb is a dead link.** It points at `/admin/community`; the landing is `/admin/held/community` (`App.jsx:2726`).
2. **Which row owns the page.**
   - The canvas lights Community (`dc:490`), and the rail key is already Community (`railPages.js:290`).
   - The sidebar match and the placement say Approvals (`sidebarConfig.js:227`; `adminPlacement.js:84`), and the only door is Approvals lane 13.
   - Moving it to Community means a sixth Community door (two test edits) and a card-link placement. Keeping Approvals means recording the difference, as D915 did for Events.
3. **Firm links has no new home yet.**
   - The canvas drops the tab, but #2369's Firms tab has no canvas or route.
   - This tab is the only UI that writes `users.partner_id`, and member copy points at it (`kit.jsx:200-201`).
   - Either keep an off-canvas tab (for example `/admin/partner-invitations/firm-links`) until #2369 ships, or decide otherwise.
4. **The redirect.**
   - Target: Overview (canvas) or Invitations (what the old page opened on).
   - Form: inline `Navigate` (one test edit) or a `*Redirect` component (generalise the reachability test).
   - Retirement: the Worker's admin digest has emailed `/admin/partners` (`partnerDeals.ts:876`), so decide between `keep: true` and the 90-day retirement (#2319).
5. **`/:id` addresses.** The canvas draws lightboxes with no address, and a full page with a back link on a phone. The Worker has no single-invitation or single-deal read. A record opened by id can only be found inside a loaded list of 200 or fewer rows (`admin_partners.ts:114,:306`).
6. **Link targets that do not exist yet:** "Open in Advisors & Partners" (#2369), "Open in Partner profiles" (#2380), "Open member record" (#2377). Use today's addresses (`/admin?tab=network-profiles`, `/admin?tab=profiles`) or leave the buttons out.
7. **Tab semantics.** The canvas uses link tabs in a `role="tablist"` with arrow keys (`dc:64-65`). Licences uses `nav` + `NavLink` (`LicenceFrame.jsx:75-88`).
8. **Scope chip.** The canvas has none; D915 added one on Events.
9. **PI10.** PI10a "not an admin" cannot be drawn (`App.jsx:1830-1831`). PI10a "No data drawn" while frozen does not match the Worker, which still serves GETs while frozen (`auth.ts:569-570`) and refuses POSTs with 423.
10. **Lane 13 vs "Needs you".** Lane 13 still says "No queue" (`approvalSources.ts:272`, pinned in `branch_approvals_s16_d215.test.ts:118-128`), while the canvas's Needs you rows show work an admin owes. Whether that becomes a lane is #2390's call.
11. **Tab counts.** The canvas's counts ([42], [19], [64]) need totals the Worker does not send. Today's counts are of loaded rows (`PartnerInvitations.jsx:144-145`), and there is no cross-deal redemptions read for Referrals.
12. **The profile-routing counter is shared:** 149 today (`profile_routing_fresh.test.mjs:103`), with Events and Programs in flight.

## Part D — the defects, re-checked

### #2370's defects re-checked at HEAD

**What HEAD means here.** The working tree is on `claude/spinout-lab-workspace-wuyyqd` at `0296848`. The task names `0b85c2b`. I ran `git diff --stat 0b85c2b HEAD`: none of the files cited below changed between those two commits. The diff touches only the Events desk, the pitch files, `design/incoming/README.md`, and four added lines in `App.jsx` at about line 2838, after every `App.jsx` line cited here. So each `path:line` below is the same at both commits.

**The issue's own line cites cannot be checked.** The issue cites `537f646a3f`, and that commit is not in this clone: `git cat-file -t 537f646a3f` says "Not a valid object name", and the clone is shallow (70 commits). Each defect was therefore re-checked against its description, not its old line numbers. The issue's facts hold at HEAD:
- The page is `fe/pages/admin/PartnerInvitations.jsx`, routed at `/admin/partners` (`fe/App.jsx:129,2701`).
- The Worker is mounted at `wk/index.ts:848` (`/api/admin/partners`) and `:850` (`/api/partner-onboard`).
- The tables are in `mig/028_partner_deals.sql:9-94`, with `mig/275_partner_profiles_columns.sql:59-84`.
- The email is `wk/services/email.ts:357-443`.

Prefixes: `wk/` = `cloudflare-worker/src/`, `fe/` = `frontend/src/`, `mig/` = `cloudflare-worker/sql/migrations/`, `dc:` = `design/incoming/Partner Invitations Page.dc.html`, `grid:` = `design/incoming/Partner Invitations · Boards.dc.html`. Values in [brackets] on the canvas are samples and were never read as data.

#### Summary

| # | Defect | Verdict at HEAD |
|---|---|---|
| 1 | A failed read looks like nothing is there (incl. redeemers modal, top deals swallowed) | **PRESENT**, and the redeemers modal also refetches in a loop when it fails (N1) |
| 2 | "Invitation sent" even when no email went | **PRESENT** |
| 3 | The new link disappears after 1.5 s; Copy has no failure path | **PRESENT**; the admin also cannot close the dialog during those 1.5 s |
| 4 | Delivery is not stored | **PRESENT** |
| 5 | Resend wipes progress | **PRESENT**, wider than stated |
| 6 | "Expired" almost never appears | **PRESENT** |
| 7 | The invitee sees at most three offers but the dialog allows five | **PRESENT** |
| 8 | The admin cannot see what is offered | **PRESENT** |
| 9 | "Notes" is really a message to the invitee | **PRESENT**; it also goes in the email |
| 10 | No duplicate or member check on create | **PRESENT**, made worse by one profile per address (N12) |
| 11 | A stuck agreement is invisible | **PRESENT**; one of the three refusals leaves an audit row, the others leave nothing |
| 12 | Stage dates are not stored | **PRESENT** |
| 13 | Terminate does not say how many members it hits | **PRESENT**, and the count shown afterwards is inflated (N3) |
| 14 | Firm links save on change with no confirm | **PRESENT**; the canvas moves the tool to a page that does not have it (N16) |
| 15 | Accessibility | **PRESENT**: the file has no `aria-` and no `role=` |
| 16 | The flow has never run in production | **PRESENT** as last measured; I could not re-measure offline |
| 17 | Two homes (Approvals vs Community) | **PRESENT**: three placements disagree; the canvas picks Community and a new address |

Nothing is FIXED. Nothing in the code is CHANGED. For #14 and #17 the canvas gives a new answer, and the code does not follow it yet.

---

#### The 17 defects

##### 1. A failed read looks like nothing is there: PRESENT
- **Invitations.** The list starts as `[]` (`fe/pages/admin/PartnerInvitations.jsx:47`). If the read fails, the catch only shows a toast (`:69-71`), and the table then says "No invitations yet." (`:209-210`).
- **A failed re-read keeps the old rows.** `setInvitations` is never reached (`:68`), so the previous filter's rows stay on screen under the new filter.
- **Deals.** Same pattern: toast only (`:84-86`), then "No {dealsStatus} deals." (`:345-346`).
- **Top deals.** The failure is swallowed into an empty list: `.catch(() => ({ items: [] }))` (`:80`). The card is then simply not drawn (`:281`).
- **Redeemers modal.** The catch sets `loading` false and shows a toast (`:882`). `items` falls back to `[]` (`:887`), and the modal says "No redemptions yet." (`:917-918`).
- **The Worker side tells the truth.** None of `GET /invitations` (`wk/routes/admin_partners.ts:97-123`), `/deals` (`:293-312`), `/deals/top` (`:215-233`) or `/deals/:id/redemptions` (`:240-291`) has a try/catch, so a D1 error comes back as a 5xx. All the hiding is in the page, so a client-side rule like D915's Guard G is enough.
- **The exception.** Firm links has a real error state with "Try again" (`fe/pages/admin/PartnerInvitations.jsx:487-495,522-532`).
- **The canvas.** PI9c: "A failed list never says No invitations yet." (`dc:478`).

##### 2. "Invitation sent" even when no email went: PRESENT
- The page always shows `showToast({ kind: 'success', msg: 'Invitation sent' })` (`fe/pages/admin/PartnerInvitations.jsx:403-407`).
- The modal reads only `r.link` (`:636`) and ignores `r.email_sent`, which the Worker does return (`wk/routes/admin_partners.ts:82-84,91-94`).
- Resend does read `email_sent`, but its copy for a failure is "Saved (email delivery skipped)" (`fe/pages/admin/PartnerInvitations.jsx:106`). The send can fail for four reasons (see N19); "skipped" fits none of them.
- The canvas draws the delivered and not-delivered results inside the same dialog (`dc:410`; PI4d and PI4n at `dc:471-472`).

##### 3. The new link vanishes after 1.5 s, and Copy has no failure path: PRESENT
- `setCreatedLink(r.link); setTimeout(() => onCreated(r), 1500);` (`fe/pages/admin/PartnerInvitations.jsx:636-638`), and `onCreated` closes the modal (`:404`).
- **The admin cannot close it either.** `setSubmitting(false)` runs only in the catch (`:641`), so on success `close` does nothing (`:619`), the X stays disabled (`:655`), and clicking the backdrop or pressing Esc does nothing (`:646,620`).
- **Copy.** The dialog's Copy is `onClick={() => navigator.clipboard.writeText(createdLink)}` (`:677`): not awaited, no catch, no confirmation. The row-level copy does have a failure path (`:113-120`).
- The canvas keeps the result in the dialog, with "Copied" or "Copy failed. Select the link and copy it." (`dc:409-410`).

##### 4. Delivery is not stored: PRESENT
- `partner_invitations` has no delivery column (`mig/028_partner_deals.sql:9-29`). The baseline, which is a dump of production, has none either (`cloudflare-worker/sql/schema_baseline.sql:3262-3282`).
- **How I searched.** A grep of `cloudflare-worker/sql` for `partner_invitations` finds only migration 028, comments in migration 275, and the baseline. No migration alters the table.
- `email_sent` survives only inside the `admin_audit_log` details (`wk/routes/admin_partners.ts:86-89,147-149`). The list read does not select it (`:107-110`).
- The canvas marks the column "Email · NEW" and shows "Not recorded" for older rows (`dc:424,430,479`; `grid:46`).

##### 5. Resend wipes progress: PRESENT, and wider than stated
- `UPDATE partner_invitations SET expires_at = ?, status = 'sent' WHERE id = ?` (`wk/routes/admin_partners.ts:137-139`). The only guards are signed and revoked (`:132-133`). The page offers Resend at every other stage (`fe/pages/admin/PartnerInvitations.jsx:212`).
- **It loses the Opened date.** The next open flips `sent` to `viewed` and overwrites `viewed_at` (`wk/routes/partner_onboarding.ts:106-109`).
- **At "agreement out" it strands the invitee.** The invitation is `finalized` and the deal is `awaiting_signature`. After a resend:
  - the onboarding page no longer jumps to the signing panel, because that check is `status === 'finalized'` (`fe/pages/PartnerOnboardPage.jsx:166`);
  - every profile, propose and select call is refused with 409, because the deal has started (`wk/routes/partner_onboarding.ts:145-146,218-219,239-240`).
- The canvas states the fix: "The link gets a new 14 days… Her progress stays at Offer chosen" (`dc:411`; `grid:52`).

##### 6. "Expired" almost never appears: PRESENT
- **The one write.** `status = 'expired'` is written in exactly one place: inside deal activation, when the invitation has already lapsed (`wk/services/partnerDeals.ts:229-231`).
- **How I searched.** A grep of `wk/` for `status = 'expired'` finds that line plus two `partner_deals` writes (`:498,577`).
- **Everywhere else, expiry is computed:** `is_expired` on the list (`wk/routes/admin_partners.ts:120`) and the onboarding gate (`wk/routes/partner_onboarding.ts:55-64`).
- **The page.** The status filter offers `expired` (`fe/pages/admin/PartnerInvitations.jsx:28,183`), but it filters on the stored status (`wk/routes/admin_partners.ts:103`), so it returns almost nothing. A lapsed row shows its stage pill plus an unlabelled 10 px triangle (`fe/pages/admin/PartnerInvitations.jsx:232-234`).
- **The canvas computes "Lapsed" and keeps the stage.** It shows "Lapsed [14 Oct]" (`dc:418`), maps `Lapsed: 4` (`dc:422`) and writes "lapsed… at Offer chosen" (`dc:358`). So the integration must not store "expired", and `partnerDeals.ts:230` overwrites the stage.

##### 7. The invitee sees at most three offers; the dialog allows five: PRESENT
- `for (const t of valid.slice(0, 3))` (`wk/services/partnerDeals.ts:84`), and the route comment says "server returns 1-3 proposals" (`wk/routes/partner_onboarding.ts:12`).
- The dialog has five checkboxes and no cap (`fe/pages/admin/PartnerInvitations.jsx:11-17,622-623,706-719`). The Worker has no cap either (`wk/routes/admin_partners.ts:54-57`).
- **The 4th and 5th types are refused, not just hidden.** Selecting one by `deal_type` passes the allow-list check, finds no proposal, and returns 400 "No matching proposal could be generated" (`wk/routes/partner_onboarding.ts:260-269`).
- The email itself promises "1–3 partnership structures" (`wk/services/email.ts:400`).
- The canvas: "Pick up to three", with the remaining two drawn disabled (`dc:406`; `grid:48`).

##### 8. The admin cannot see what is offered: PRESENT
- **The list.** Rows show deal-type chips only (`fe/pages/admin/PartnerInvitations.jsx:220-228`). `GET /invitations` does not select `personal_message` or any deal or offer (`wk/routes/admin_partners.ts:107-110`).
- **Where the terms are.** Offer terms exist only as code in `buildProposals` (`wk/services/partnerDeals.ts:75-166`). They are computed for the invitee on request (`wk/routes/partner_onboarding.ts:225,251`), and no admin route returns them.
- **The deals list.** `GET /deals` returns `proposal` (`wk/routes/admin_partners.ts:308-310`), but the page never renders it. There is no `proposal` anywhere in the page file.
- **The canvas.** PI3 "What we offered" (`dc:383`) and PI4 "ADJUST TERMS · NEW" (`dc:407`). There is nowhere to store term overrides (`mig/028_partner_deals.sql:9-29`). The canvas copy also disagrees with `buildProposals` (N8).

##### 9. "Notes" is really a message to the invitee: PRESENT, and it also goes in the email
- **The field.** Labelled "Notes (optional)" (`fe/pages/admin/PartnerInvitations.jsx:725`). The placeholder is written to the invitee (`:730`). The help text says only "Shown to the partner inside the onboarding wizard." (`:733`).
- **Where it actually appears:**
  - in the email body (`wk/services/email.ts:374-376,421`);
  - in place of the chatbot's greeting (`fe/pages/PartnerOnboardPage.jsx:191-192`);
  - again on every resend (`wk/routes/admin_partners.ts:142-145`).
- The admin cannot read it back (`:107-110`).
- The canvas: "MESSAGE TO THE INVITEE… Shown in the email and at the start of the onboarding chat." (`dc:408`).

##### 10. No duplicate or member check on create: PRESENT
- `POST /invitations` validates the address and the types, then inserts (`wk/routes/admin_partners.ts:59-78`). There is no read of `partner_invitations` or `users` first. The email index is not unique (`mig/028_partner_deals.sql:30`).
- **It gets worse.** Two open invitations to one address share one profile row (N12).
- The canvas adds two NEW notes: an open invitation to this address already exists, and the address belongs to a member (`dc:405`).

##### 11. A stuck agreement is invisible: PRESENT
Finalize can be refused in three ways, and each leaves the invitation at `selected` (`wk/routes/partner_onboarding.ts:297-299`) and the deal at `proposed` (`:287-290`):
- **Unfilled template fields.** Writes an `activity_logs` row `partner_envelope_refused` (`:363-364`) and returns 409 with the message from the issue (`:308,365`).
- **No template body, or an unreadable one.** Refused with no audit row (`:367-368`).
- **Envelope did not start.** 500 "Could not start envelope", also with no audit (`:371`).

On the admin page this shows only as the pill "selected" (`fe/pages/admin/PartnerInvitations.jsx:230-231`).

**How I searched.** A grep of `wk/` and `fe/` for `partner_envelope_refused`, `partner_envelope_started` and `partner_invitation_viewed` finds no reader outside the route that writes them.

The canvas draws "Agreement blocked" (`dc:359`), a banner (PI9e, `dc:480`) and the card on the invitation (`dc:388`).

##### 12. Stage dates are not stored: PRESENT
- The row has `expires_at`, `viewed_at`, `signed_at`, `revoked_at` and `created_at` (`mig/028_partner_deals.sql:20-28`). There is nothing for profiled, proposed, selected or finalized.
- Those four transitions write only the status (`wk/routes/partner_onboarding.ts:204-206,226-228,297-299,376-378`).
- **None of the stand-ins is reliable:**
  - **Profile dates.** `partner_profiles.created_at` and `updated_at` (`cloudflare-worker/sql/schema_baseline.sql:3312-3313`) belong to the row for that email address. That row may be older than the invitation (`wk/routes/partner_onboarding.ts:172-176`), and `updated_at` moves on every save (`:196`).
  - **Deal creation date.** `partner_deals.created_at` dates the first choice only, because choosing again updates the same row (`:272-285`).
  - **Audit rows.** Every stage writes an `activity_logs` row with `invitation_id` in its details (`:96,110,208,229,300,379`), and that table has `created_at` (`cloudflare-worker/sql/schema_baseline.sql:50`). But the write is best effort (`wk/routes/partner_onboarding.ts:92-97`), and regenerate or re-save writes the row again.
- The canvas: the three NEW step dates read "Date not recorded" (`dc:384-385`; `grid:47`).

##### 13. Terminate does not say how many members it hits: PRESENT
- The dialog copy has no count (`fe/pages/admin/PartnerInvitations.jsx:841-844`). The row's `redemptions_count` is right there (`wk/routes/admin_partners.ts:302`; `fe/pages/admin/PartnerInvitations.jsx:363-370`) but is not used.
- The count shown afterwards is inflated (N3).
- The canvas: "[12] members who registered with his code lose the tiers it gave them" (`dc:413`).

##### 14. Firm links save on change with no confirm: PRESENT
- `onChange={(e) => attach(a.id, e.target.value)}` (`fe/pages/admin/PartnerInvitations.jsx:592`) posts straight away (`:503-517`). Detaching is the "— no firm —" option in the same select (`:594`).
- The Worker writes without conditions (`wk/routes/admin_partners.ts:595-596`), with an audit row (`:603-608`).
- The canvas draws no Firm links tab (`dc:461`) and sends "Firms" to Advisors & Partners (`dc:363`). See N16.

##### 15. Accessibility: PRESENT
- **Icon buttons named only by `title`:** Copy link, Resend, Revoke (`fe/pages/admin/PartnerInvitations.jsx:241-269`).
- **Close (X) buttons with no label** (`:655-657,781,838,910-912`).
- **Tabs** are plain buttons, with no tablist, tab or selected state (`:142-162`).
- **Modals** are plain divs: no `role="dialog"`, no `aria-modal`, no label, no focus trap (`:646-650,775-776,832-833,890-893`).
- **The toast** has no live region (`:449-455`).
- **Lapsed** is shown only by an icon (`:232-234`).
- **Unlabelled controls:** the filter selects (`:177-184,311-319`), the search box, which has only a placeholder (`:169-175`), and the firm select (`:588-593`).
- A grep of the file for `aria-` and `role=` finds nothing.
- The canvas uses `role="tablist"` and `role="tab"` (`dc:64-65`), `role="alert"` (`dc:72`), `role="dialog"` (`dc:143`) and labelled chart images (`dc:119`).

##### 16. The flow has never run in production: PRESENT as last measured
- Migration 275 says production held zero `partner_invitations` on 2026-09-21 (`mig/275_partner_profiles_columns.sql:47-55`). This is repeated at `wk/services/advisor/writeRouter.ts:223-224` and `documentation/architecture/DECISIONS.md:16642`.
- **How I searched.** I found no later measurement under `documentation/`, and I cannot re-measure from a read-only, offline clone.
- The whole chain therefore has no production run on record: create → onboarding → finalize → e-sign hook (`wk/routes/esign.ts:1585-1593`) → activation (`wk/services/partnerDeals.ts:195-467`).

##### 17. Two homes: PRESENT
Three placements disagree:
- **Sidebar: Approvals.** The Approvals row's `match` includes `/admin/partners` (`fe/sidebarConfig.js:226-227`); the Community row's does not (`:230`).
- **Rail: Community.** `fe/lib/railPages.js:290`, `fe/lib/railOptions/admin.js:73`, `wk/services/ai/railMatrix.json:3541`.
- **Placement: an Approvals lane.** `fe/lib/adminPlacement.js:84`, and lane 13 "No queue" (`fe/pages/admin/HeldApprovals.jsx:95`).

The Community page's five literal links do not include it (`fe/pages/admin/HeldCommunity.jsx:11-16`).

**The canvas.** It lights Community (`dc:490`), with the breadcrumb "Community › Partner invitations" (`dc:460`; `grid:16`). It also moves the page to a new address, `/admin/partner-invitations/{,invitations,deals,referrals}` (`dc:461`), with a moved notice (`dc:481`). That is the D894 pattern.

**Tests that pin the current placement:** `frontend/test/held_admin_shell_d286.test.mjs:195,298`, `frontend/test/admin_placement_h35.test.mjs:52`, `frontend/test/admin_route_reachability.test.mjs:571-579`.

---

#### New defects a redesigned page would draw wrongly

| Id | Defect | Evidence at HEAD | What the canvas would draw |
|---|---|---|---|
| N1 | **When the redeemers read fails, it refetches in a loop.** `onError` is a new inline function on every render (`fe/pages/admin/PartnerInvitations.jsx:430`) and is in the effect's dependencies (`:884`). Each failure shows a toast, the toast re-renders the parent, and the effect fetches again, until the modal closes. `showToast` itself is stable (`fe/components/useToast.js:21-28`). | `fe/pages/admin/PartnerInvitations.jsx:878-884` | PI6's redeemer list |
| N2 | **Tab counts are list lengths, not totals.** `Invitations (${invitations.length})` and `Deals (${deals.length})` (`fe/pages/admin/PartnerInvitations.jsx:144-145`) count the current filter, and each read is capped at 200 (`wk/routes/admin_partners.ts:114,306`). Neither read returns a total (`:122,311`). | as cited | Tab counts [42], [19], [64] and "1–25 of [42]" (`dc:461,432`) |
| N3 | **Terminate counts tier rows, not members.** `redemptions_revoked` is incremented once per tier (`wk/routes/admin_partners.ts:393,405`), so a member who got two tiers counts twice. That happens on equity, deal-sourcing and capital deals (`wk/services/partnerDeals.ts:95-96,128-129,145-146`). The toast then says "N downstream redemption(s) revoked" (`fe/pages/admin/PartnerInvitations.jsx:824`). | `wk/routes/admin_partners.ts:383-406` | "[12] members… lose the tiers" (`dc:413`) |
| N4 | **"partner tier revoked" can be false.** `tiers_revoked` is true whenever the deal granted any tier. It ignores whether the guarded UPDATE changed a row, and the UPDATE matches nothing if the partner now pays (`wk/routes/admin_partners.ts:344-369,418`; toast at `fe/pages/admin/PartnerInvitations.jsx:823`). | as cited | PI8c's result |
| N5 | **Terminate's write is unguarded.** It checks the state, then updates without checking `meta.changes`. Two terminates of the same deal both run the cascade and both write an audit row. | `wk/routes/admin_partners.ts:327-338` | PI10b, "no longer active" |
| N6 | **Revoke reports success when its cleanup fails.** The deal and envelope voiding is inside one try/catch that only logs (`wk/routes/admin_partners.ts:175-200`), and the reply is still `ok:true` (`:206`). The page then says "Invitation revoked" (`fe/pages/admin/PartnerInvitations.jsx:765-768`). Activation re-checks the invitation, so the deal still cannot go live (`wk/services/partnerDeals.ts:217-225`). | as cited | "…are voided" (`dc:412`) |
| N7 | **A "month" is 30 days.** `expires_at = now + term_months × 30 days` (`wk/services/partnerDeals.ts:304-305`). So "12 months" is 360 days and "24 months" is 720. | as cited | "12 months · [18 Nov 2025]–[18 Nov]" and "[340] days used · [25] left", i.e. 365 in all (`dc:436,396`) |
| N8 | **The canvas offer copy disagrees with what the invitee is shown.** These values are not bracketed: (a) Capital partnership is drawn as Investor Professional for 12 months, but the code grants `founder_pro` plus professional or institutional for 24 months (`wk/services/partnerDeals.ts:135,145-147`); (b) Equity is drawn as "equity in portfolio companies", but the code offers equity in the operating company (`:89,99`); (c) Services adds a "quarterly check-in" that is not in the terms (`:107-111`); (d) Deal-sourcing is drawn as a share "of first-year revenue", but the code pays a share of fees (`:124-125`); (e) the canvas's own Deal-sourcing tiers disagree with each other (`dc:436` vs `dc:440`). | `dc:380` vs `wk/services/partnerDeals.ts:85-163` | PI3, PI4 and PI6 offer cards |
| N9 | **The link path differs.** The canvas has `https://axal.vc/partner/invite/[…]`; the live link is `/partners/onboard?token=` (`wk/routes/admin_partners.ts:81,119,141`), and emails already sent carry that one. | `dc:409` | PI4 result |
| N10 | **Text is cut silently.** The message is cut to 2000 characters (`wk/routes/admin_partners.ts:53`), and revoke and terminate reasons to 500 (`:157,318`). The name has no cap (`:52`). None of the inputs has a limit or a counter (`fe/pages/admin/PartnerInvitations.jsx:726-732,788-794,845-852`). | as cited | "[62] / 2,000" (`dc:408`) |
| N11 | **Deal types are not de-duplicated.** Repeating a type yields repeated proposals, which use up the three slots. | `wk/routes/admin_partners.ts:55-57`; `wk/services/partnerDeals.ts:79,84` | PI4 |
| N12 | **One profile per address.** `partner_profiles` is keyed by email (`cloudflare-worker/sql/schema_baseline.sql:3298`), and the upsert moves `invitation_id` to whichever invitation saved last (`wk/routes/partner_onboarding.ts:182-183`). The older invitation then gets 412 "Submit profile first" on propose and select (`:220-223,247-250`), and activation joins the profile by invitation (`wk/services/partnerDeals.ts:205`). | as cited | PI3 "Their answers" would show empty for the older invitation |
| N13 | **A signature after the 14 days is voided without a word.** If the invitation lapses before the envelope completes, activation voids the deal and marks the invitation `expired`, which loses its stage (`wk/services/partnerDeals.ts:226-237`). The e-sign hook swallows errors (`wk/routes/esign.ts:1590-1593`), and the only trace is a `console.warn` (`wk/services/partnerDeals.ts:236`). Finalize stays allowed until expiry (`wk/routes/partner_onboarding.ts:311-313`). On the page the deal reads "voided", the same word an admin revoke uses (`wk/routes/admin_partners.ts:177-179`). | as cited | A "Voided" chip with no reason (`dc:443`) |
| N14 | **The page never shows a name or email on unsigned deals.** `/deals` and `/deals/top` join `users` on `pd.user_id` (`wk/routes/admin_partners.ts:224,227,304`), which is NULL until signing (`mig/028_partner_deals.sql:58`). The page shows "—" (`fe/pages/admin/PartnerInvitations.jsx:350-351`). | as cited | Named "Awaiting signature" and "Offer chosen, not sent" rows (`dc:440-441`) |
| N15 | **Rev-share windows count down whatever the deal's state.** The window is computed for terminated and expired deals too (`wk/routes/admin_partners.ts:264-276`), and the daily warning ignores `pd.status` (`wk/services/partnerDeals.ts:762-772`). I found nowhere that says whether a window survives termination. | as cited | "Rev-share windows open [9]" (`dc:453-454`) |
| N16 | **Firm links has one door, and its counts come from capped rows.** The only callers of `listFirmLinks` and `setFirmLink` are this page (`fe/pages/admin/PartnerInvitations.jsx:490,506`). Advisors & Partners (`fe/pages/admin/HeldCommunity.jsx:83-85`) has no such tool. The attached and unattached counts are computed from at most 500 rows (`wk/routes/admin_partners.ts:541,551,557-558`). | as cited | Tab dropped, "Firms" sent to Advisors & Partners (`dc:363,461`) |
| N17 | **The Approvals lane's "No queue" reason would become false.** It says "An open invitation waits on the invitee, not an admin." | `wk/services/approvalSources.ts:272`; `fe/pages/admin/HeldApprovals.jsx:95` | "Needs you [10]" (`dc:357-364`) |
| N18 | **The email filter queries on every keystroke, with no cancellation.** It also reloads deals and top deals each time (`fe/pages/admin/PartnerInvitations.jsx:62-92`), so a late reply can overwrite a newer one. Its LIKE pattern is not escaped (`wk/routes/admin_partners.ts:104`); the directory search does escape (`:442-443`). | as cited | PI2 search |
| N19 | **A false `email_sent` does not say why.** It can mean: the address is suppressed (`wk/services/email.ts:366`), mail is not configured (`:367-370`), Gmail rejected it (`:433-436`), or the send threw (`:439-442`). | as cited | PI4n names only the first two (`dc:410`) |
| N20 | **Resends are not recorded.** No last-sent date or count is stored; only `expires_at` changes (`wk/routes/admin_partners.ts:136-139`). "Sent" shows `created_at` (`fe/pages/admin/PartnerInvitations.jsx:237`), so after a resend Sent and Expires are no longer 14 days apart. | as cited | History "Sent by… Delivered" and "oldest sent" (`dc:390,353`) |
| N21 | **Two date formats are mixed.** `created_at`, `viewed_at` and `signed_at` are stored with no time zone (`mig/028_partner_deals.sql:28`; `wk/routes/partner_onboarding.ts:108`; `wk/services/partnerDeals.ts:342`). `expires_at` is ISO with a Z (`wk/routes/admin_partners.ts:67,136`). `fmtDate` hands both to `new Date` (`fe/pages/admin/PartnerInvitations.jsx:40-43`): the zone-less dates are read as local time, and its catch never fires because `new Date` does not throw. | as cited | Days-left and median figures computed in the browser |
| N22 | **`GET /deals?status=all` returns nothing.** `/deals` binds the status literally (`wk/routes/admin_partners.ts:295,305`); only `/deals/top` treats `all` as a special case (`:218-220`). | as cited | Multi-state chips (`dc:443`) |
| N23 | **The modal's count is capped and can disagree with the row.** It counts at most 500 rows (`wk/routes/admin_partners.ts:261,288`), while the row's count is uncapped (`:302`). | as cited | PI6 "Redemptions [12]" |

## Part E — the completeness critique

### Completeness critique: Partner invitations code map (#2370)

**Tree.** The work order named `0b85c2b`. The branch has since moved three times: `0296848` (D894), `99466ce` (D915) and `fbbb4c8` (D906 fixes). Every cite below is at `fbbb4c8`. The partner files, Worker files and both canvas files are the same at both commits. I only read: git, file reads, and read-only `gh api` calls for #2370 and the issues it names.

**How I checked.** I read both canvases in full (`dc:1-529`, `Boards:1-62`). I matched every board and lettered variant against g1, g2 and g3. Then I re-read the code behind each disputed claim. Prefixes: `wk/`, `fe/`, `mig/`, `dc:` as given; `base:` = `cloudflare-worker/sql/schema_baseline.sql`; `Boards:` = `design/incoming/Partner Invitations · Boards.dc.html`.

**Board coverage.** Every board and variant has rows:
- g1: PI1, PI12, PI9a–f
- g2: PI2, PI3, PI4, PI4d, PI4n, PI8a, PI8b
- g3: PI5, PI6, PI7, PI8c, PI10a, PI10b, PI11a–d

No board is missing. The gaps are blocks, defects, stores and decisions.

---

#### Missing

**A. Defects no row accounts for**

1. **The signing link dies after 7 days, and Resend does not renew it.**
   - The signing token lives 7 days (`wk/routes/esign.ts:63`); the invitation lives 14.
   - Finalize's repeat-call path hands back the stored signing URL without checking its expiry (`wk/routes/partner_onboarding.ts:319-329`). That URL answers 410 "This signing link has expired" (`esign.ts:1247-1249`).
   - Only `POST /api/legal/esign/:id/remind` issues a fresh link (`esign.ts:1913-1919`, `:1955-1962`). It runs only for the envelope's `created_by` (`esign.ts:1839-1844`), which is the **original inviter** (`partner_onboarding.ts:337`; `esign.ts:578-579`).
   - So g2's PI8a line "A signature within the new 14 days still activates the deal" is false once the envelope is more than 7 days old. No board or row offers a way to renew.
   - **Fix:**
     - PI2, PI3 and PI8a get a row "Signing link expired [date]", read from R4's recipient `token_expires_at` (`esign.ts:1057`).
     - Link to the envelope page `/legal/send?envelope=<id>`, where the inviter has Remind (`fe/pages/legal/SendForSignaturePage.jsx:25-30`, `:602-606`; client `fe/lib/api.js:2155`).
     - Add a Worker item: Resend at Agreement out also renews the signing token.

2. **The inviter is told "Signed and executed" when activation has voided the deal.**
   - The completion hook runs activation (`esign.ts:1590-1593`), which voids the deal when the link had lapsed (`wk/services/partnerDeals.ts:226-238`).
   - The hook then notifies the sender anyway (`esign.ts:1631-1652`).
   - Bugs N13 and g3's figure 7 say only a `console.warn` records it. The real record is a false success notice.
   - **Fix:** add it to g3's "Voided with no reason" row and to P1: activation stores why it voided and changes the sender's notice.

3. **#2370's P1 "daily sweep marks lapsed invitations expired" would erase the stage the canvas keeps.**
   - The canvas keeps the stage on a lapsed row: "lapsed … at Offer chosen" (`dc:358`), the Lapsed sample row (`dc:418`), and `Lapsed: 4` in the stage-dot map (`dc:422`).
   - A stored `expired` today means "signed after the link lapsed" (`partnerDeals.ts:229-231`).
   - g1 names "split 1 (lapse sweep)" as the fix for T2 and C3 without saying what the sweep writes.
   - **Fix:** the decision says the sweep writes a separate marker and voids the lapsed invitation's open deals with a reason, and never sets `status = 'expired'`.

4. **The retained Firm links tab has no row.**
   - #2370's Session coordination says the tab stays until #2369 ships.
   - Bugs #14 is still live: the select saves on change (`fe/pages/admin/PartnerInvitations.jsx:588-594`). The issue's small fixes include "firm-link changes ask before saving".
   - The counts are taken over at most 500 rows (`admin_partners.ts:541`, `:551`, `:557-558`).
   - **Fix:** add an off-canvas row covering:
     - an address (e.g. `/admin/partner-invitations/firm-links`), or a door from the Firms "Needs you" row only;
     - a literal door, a `fe/lib/railPages.js` alias, and a COMPOSED entry if it lives in a sibling file;
     - a confirm step before `setFirmLink`;
     - the existing Unreadable state (`PartnerInvitations.jsx:522-532`);
     - "of the first 500" wording.

**B. Routes or stores a gap row should have used**

1. **`/legal/send?envelope=<id>`** (`fe/App.jsx:2461`; `SendForSignaturePage.jsx:713-714`).
   - Any admin can read the envelope: an admin's scope is `1=1` (`esign.ts:1049-1051`). The inviter also gets Remind there.
   - g3 (PI6 Agreement, PI11c) links `/admin/contracts?tab=partner-deals`, which cannot land on one record (`fe/pages/admin/contracts/ContractsDesk.jsx:24-26`).
   - Use the envelope page for PI3 "Agreement", PI6 "Agreement" and the Awaiting-signature rows.
2. **R4, `GET /api/legal/esign/:id`** (`esign.ts:1044-1077`).
   - g1 9d says no read returns the Agreement-out date. R4 does.
   - R4's audit events should also feed g2's PI3 History for the agreement steps (sent, reminder, signed). g2 marks History beyond one line as "Not read here yet".
3. **`esign_recipients.token_expires_at`** through R4 (`esign.ts:1057`). No row uses it; item A1 needs it.

**C. Decisions the canvas or #2370 implies that no section names**

1. **HQ's view.**
   - `Boards:18` says "HQ opens the same page with the same controls"; #2370 says "Super Admin … Same page, same controls".
   - A Super Admin gets `role="super_admin"` on the rail (`fe/pages/admin/AdminBoardFrame.jsx:28-29`). But only the Admin table keys this page (`railPages.js:290`); the Super Admin table has no entry (`:315-363`). The HQ sidebar has no row for it (`fe/sidebarConfig.js:109-147`).
   - **Fix:** decide HQ's door. Add a Super Admin key or alias plus a rail-matrix entry, or record that HQ's rail on this page has no key.
2. **Subsidiary studios.**
   - PI10b is labelled "SUBSIDIARY STUDIO" (`dc:483`), and the prompt says the admin may later be a subsidiary studio.
   - The branch shell has no door (`fe/sidebarConfig.js:174-188`). On a branch the freeze returns early (`wk/auth.ts:571`) and suspension is never checked.
   - **Fix:** decide whether the page ships on branch Workers, and from which row (`/branch/community`).
3. **#2371: which page owns the referral programme and which owns the deal mechanics.** #2370 asks for this agreement. O-TERMS names #2371 only for per-invitation terms. Make it its own decision; it shapes PI7 and the Custom and Deal-sourcing deals.
4. **#2369's deal links target PI6** (#2370 Session coordination). O-ID must therefore cover `/deals/:id` as well as `/invitations/:id`. g2's O-ID covers invitations only.
5. **Three dependencies from #2370 that no section names.**
   - #2297's Keep list names `/admin/partners`; the move must be noted there.
   - #2367 (Community) may show this page's figures.
   - #2366 (Insights) may reuse the overview read.
6. **The "ending soon" window.** The canvas uses 30 days (`dc:354`, `:377`, `:481`); the branch home counts ending agreements over 60 (`wk/services/branchHome.ts:295`). Pick one, or record both.

**D. Blocks drawn with no row**

1. **"Showing 7 of [10] · Show all"** (`dc:364`). No row says whether Show all expands in place or goes to an address.
2. **Links that carry a filter**, which no section defines:
   - a C1 bar opens Invitations at that stage (`dc:366`);
   - a C3 segment opens Deals at that type and state (`dc:370`);
   - "Open Referrals" (`dc:364`);
   - PI6 "See all in Referrals" for one deal (`dc:397`).

   **Fix:** P5 defines the query keys each tab reads (stage; type and state; deal). The reachability walk resolves on the path only (`frontend/test/admin_route_reachability.test.mjs:194-222`).
3. **C6 "Rev-share windows closing"** (`dc:453-454`) names no chart part. `HBars` (`fe/pages/admin/insights/InsightsCharts.jsx:66`) fits, with one amber fill per bar.
4. **The prompt's accessibility rules** (#2370 ACCESSIBILITY): spoken row-menu labels (`dc:423` "Actions for …"), Enter on a row opens it, and focus returns to the row. Only the tablist is discussed (shell conflict 7). `Lightbox` already returns focus (`fe/ui/Lightbox.jsx:70`, `:87`, `:102`); the row-level rules need a row.
5. **PI10a "Contact HQ"** (`dc:482`). No row gives its target.

---

#### Inconsistent

1. **The crumb.**
   - g1, g3 and the shell report link "Community › Partner invitations" to `/admin/held/community` (`fe/App.jsx:2726`).
   - g2 says it should read "Approvals ›" and link `/admin/held/approvals` (`:2724`).
   - **Fix:** one answer in the decision, matched to the sidebar row P5 lights (item 2).
2. **g3's "Approvals stays lit until a match list moves" is wrong after the move.**
   - Matching is exact or subtree (`fe/ui/SidebarNav.jsx:211-213`).
   - `/admin/partner-invitations` is not under `/admin/partners/` (`fe/sidebarConfig.js:226-227`), and Community's list does not include it (`:230`). So after the move the page lights no row at all.
   - **Fix:** P5 adds the new address to exactly one row's `match` in the same commit, a registered route (`held_admin_shell_d286.test.mjs:94`).
3. **The label for delivery.** g1 says "Not recorded" (T2 tile, Email column, Not-delivered row). g2 and g3 say "Not read here yet", because `email_sent` sits in the audit JSON (`admin_partners.ts:86-89`, `:147-149`).
   - **Fix:** use "Not read here yet", per D915's labels (`documentation/architecture/decisions/D915.md:70`).
4. **The labels for the step dates.**
   - g1 calls Offers shown "Not recorded" and treats the profile's `updated_at` as a stand-in for Profile done.
   - g2 says the profile row is not a stand-in (`partner_onboarding.ts:182-196`) and that both steps are "Not read here yet", because they sit in `activity_logs` (`:208`, `:229`).
   - **Fix:** adopt g2.
5. **The Agreement-out date.** g1 says "Not read here yet". g2 and g3 read it now from R4 or from the e-sign list (`esign.ts:1018-1019`). **Fix:** g1 follows them.
6. **"Their answers"** (the read is logged, `wk/routes/profiling.ts:516`). g1 waits for split 3; g2 fetches when the lightbox opens; g3 calls it an owner decision. **Fix:** one owner decision, recorded once.
7. **The agreement-ready rule.**
   - g1 counts only `filled_by:'sender'` keys that finalize does not fill.
   - g3's "or an automatic key (`esign.ts:261`)" is ambiguous, because `counterparty.*` counts as automatic (`:262`, `:989`).
   - g2 is right: in this flow the `counterparty.*` keys stay empty (`partner_onboarding.ts:339`) and are refused (`esign.ts:519-521`).
   - **Fix:** one rule, g2's.
8. **Resend at Agreement out.**
   - Bugs #5 says Resend strands the invitee. g2 says it does not. Both are partly right:
     - "Send for e-signature" shows again and returns the stored link (`fe/pages/PartnerOnboardPage.jsx:473-495`; `partner_onboarding.ts:319-329`);
     - polling no longer starts (`PartnerOnboardPage.jsx:166`);
     - the stored link may be dead (item A1).
   - g3's PI11c copy ("the stage goes back to Sent") also differs from g2's wording, which varies by stage.
   - **Fix:** one set of PI8a sentences, including the expired-link case.
9. **Detecting a resend.** g1 derives the last send as `expires_at − 14 days` (`admin_partners.ts:34`, `:67`, `:136`). g2's PI2 Opened row says the page "cannot tell". **Fix:** g2 adopts g1's flag for resent rows.
10. **Totals and guard names.**
    - The Referrals total is Σ over `/deals/top?status=all&limit=50` in g1, and Σ over the uncapped Contracts read in g3. That read is under recovery cool-off (`wk/index.ts:655`).
    - The guards are named "L/F" in g1 and g3, "I" in g2, and "G" in D915.
    - **Fix:** one guard set in the decision, with a source order: the Contracts read first, then `/deals/top`.
11. **Firm links and their link target.**
    - The shell report lists keeping the tab as an open conflict. #2370 and g2 already settle it: the tab stays until #2369.
    - For "Open in Advisors & Partners", the shell report suggests `/admin?tab=network-profiles`. g1 shows that page has no firm tool (`fe/pages/admin/AdminNetworkProfiles.jsx`) and links the retained tab instead.
    - **Fix:** record both as settled.
12. **The lapse sweep and stored `expired`.** Bugs #6 says the integration must not store `expired`; #2370's P1 asks for a sweep that writes it; g1 relies on that sweep. Same fix as A3.
13. **Tiers.**
    - The worker report's §4.1 and g2's PI4 note treat `founder_pro` as a plan.
    - g3 shows it is not on the founder ladder (`wk/middleware/requireTier.ts:28-30`), and an unknown tier ranks as free (`:61-65`). So "adds the partner deal" (g2 PI4) gives a founder nothing on any founder plan gate.
    - **Fix:** g2 follows g3's rule.
14. **DD matching.** g1's Needs-you DD row matches cases on `subject_id = user_id`. g3 notes that a member with two deals has two cases tied to no deal (`partnerDeals.ts:368-371`). **Fix:** g1 counts members, not deals.
15. **Worker report §11 is stale against g2 and g3.**
    - It marks PI10a "Not an admin" as **E** (a 403). The route redirects first (`fe/App.jsx:1819-1834`), so that card can never be drawn.
    - It marks the Offer-chosen and Agreement-out dates "N read". The Offer-chosen date is readable now (`admin_partners.ts:300`), and so is the Agreement-out date (R4).
16. **The shell report's test cites are stale at `fbbb4c8`.**
    - The `REDIRECTS` check is now `admin_route_reachability.test.mjs:472` (was `:464`).
    - The `/admin/partners` pin is now `:583` (was `:575`).
    - D915 added an Events entry to the COMPOSED map (`:283-288`).
    - The route-map count is already 150 (`profile_routing_fresh.test.mjs:104`), not 149, so this page's row makes it 151.
