# Events Console — what the code serves, board by board (2026-10-24)

**A snapshot, not a spec.** S1 made this map for #2368 on 2026-10-24 by reading the code on
`claude/spinout-lab-workspace-wuyyqd` at `4d79754` (on `origin/main` at `724902c`), to integrate the owner's
"Events Console" canvas (EV1–EV17, D915) and split the rest into slot tasks. It was not checked against
production, and nothing here is maintained afterwards: re-read the code before acting on a line.

Path short forms: Worker paths are under `cloudflare-worker/src/` and frontend paths under `frontend/src/` unless a
path says otherwise. `dc:` is `design/incoming/Events Console Page.dc.html`.

**Two part numberings.** "P1…P8" below are the parts #2368's body suggested. D915 §6 regroups the work into its
own seven parts (D916–D922), so cite D915's numbers in a task.

The four sections are: A, the board-by-board gap table; B, the Worker reads and writes; C, the admin page and the
shell around it; D, #2368's defects re-checked.

## Part A — the boards against the code

### #2368 Events Console: board-by-board gap table (canvas against HEAD `4d79754`)

Path prefixes: `wk/` = `cloudflare-worker/src/`, `fe/` = `frontend/src/`, `mig/` = `cloudflare-worker/sql/migrations/`, `dc:` = `design/incoming/Events Console Page.dc.html`. All lines are on HEAD `4d79754` of `claude/spinout-lab-workspace-wuyyqd`.

#### 0. Key

##### 0.1 Reads that exist today
| Id | Read | Shape and limits | How it fails |
|---|---|---|---|
| **R1** | `GET /api/admin/events?status&limit&offset` (`wk/routes/admin_events.ts:95-109`), client `adminEvents.list` (`fe/lib/api.js:5660-5666`, **unused**) | `{events: shapeEvent(r,{includePrivate:true})[]}` (`wk/services/eventsCommon.ts:70-104`). Gives every column: `type, visibility, location_kind, location_text, starts_at, ends_at, timezone, capacity, waitlist_enabled, approval_required, price_cents, currency, featured, admin_published, audience_rules, host_user_id, project_id, created_at, updated_at`. One `status` filter only (`:103`), `limit ≤200` (`:99`), `ORDER BY created_at DESC` (`:106`), **no total**. | **Truthful.** There is no try/catch (`:104-108`), so a D1 error comes back as a 5xx. |
| **R2** | `GET /api/admin/events/analytics` (`:114-194`), `adminEvents.analytics` (`api.js:5676`) | `summary{total_events,published,pending_review,draft,cancelled,total_registrations,total_attended,total_waitlisted}`, all-time, with **no rejected bucket** (`:126-132`). `events[]{id,slug,title,status,starts_at,featured,capacity,registrations,attended,waitlisted,cancelled,capacity_util,conversion}` for **the 200 events that start latest** (`:166-167`). No `ends_at`, type, visibility, format, price or host. | **Hides failure.** A failed summary returns zeros (`:120-123,151-153`) and a failed rows query returns `[]` (`:155,189-191`), both with status 200 (`:193`). |
| **R3** | `GET /api/admin/events/:id` (`:197-205`), `adminEvents.get` (`api.js:5667`, unused) | `{event}`, the full shapeEvent | 404 `{error:'not_found'}` |
| **R4** | `GET /api/events/:id/roster` (`wk/routes/events.ts:586-642`), `events.roster` (`api.js:5615`). An admin passes `canManage` (`:75-77`). | `registrations[]{id,user_id,email,name,status,source,comp,waitlist_position,payment_status,amount_cents,checkin_code,checked_in_at,registered_at,role,decision_*}` (`:610-628`), `invitations[]{…,source,comp,status,…}` (`:604-607`), `counts{seats_taken,capacity,waitlisted,confirmed,attended}` (`:634-640`). **It carries names and emails.** The issue says to prefer the new summary read. | Truthful |
| **R5** | `GET /api/events/:id/agenda` (`events.ts:953-966`), `events.agenda` (`api.js:5623`) | `{agenda[]}` (`eventsCommon.ts:106-123`) | Truthful |
| **R6** | `GET /api/admin/studio/glance` → events lane (`wk/services/approvalSources.ts:217-227,453-469`), `loadStudioGlance` (`fe/pages/admin/adminStudioOverview.js:357`) | `{key:'events',count:number\|null,oldest_at}`. `oldest_at` is **`MIN(created_at)`** (`:221`). | `count:null` means it could not be read |
| **R7** | File links: `events.exportUrl` (`api.js:5621` → `events.ts:924-950`, names and emails) and `events.icsUrl` (`api.js:5620` → `events.ts:906-921`) | | |

##### 0.2 Writes
| Write | Route | Response or note |
|---|---|---|
| **W-approve** | `admin_events.ts:208-249` | `{event}`. The minted count is not returned. |
| **W-reject** | `:252-273` | `{reason}` is optional and cut to 1000 characters |
| **W-unpub** | `:276-288` | Silent: no notification |
| **W-feat** | `:291-309` | A missing body means `featured=0` (`:302-303`) |
| **W-cancel** | `:312-335` | Takes no body |
| **W-cap** | `:341-388` | `{event, promoted}`. 400 `invalid_capacity`. |

No write checks the event's current status (Map 3 §8).

##### 0.3 Guard G: a client-side rule that makes R2 safe to draw without a Worker change
Both summary queries sit in one try and are replaced together (`:124-153`). The rows block is a single query (`:156-191`). R1 is truthful. So:
1. **R2 is complete exactly when R1's paged total is 200 or fewer.** The page fetches R1 at `limit=200` and steps `offset` until a short page comes back.
2. If R1 has at least one event and `summary.total_events === 0`, **the summary could not be read**.
3. If R1 has at least one event and `events.length === 0`, **the per-event counts could not be read**.
4. An R1 id that is missing from R2 (possible only when the total is over 200) gets "Not in this read" for its counts, never 0.

##### 0.4 Issue parts (#2368 "Suggested split")
| Part | Scope |
|---|---|
| **P1** | Member-side fixes: types, `in_person`, audience rules on create |
| **P2** | Schema (`submitted_at`, `approved_at`, `review_note`, `changed_after_approval_at`) and the write fixes (409 unless waiting; reason required; unpublish tells the host with a note; cancel takes a note and returns the paid count) |
| **P3** | New reads: `GET /overview?weeks=`, the paged list (filters, sorts, total, per-row counts, host name, role and venture), `GET /:id/summary`, `GET /:id/history`, `GET /:id/comp-preview`, clashes "computed in the list and overview reads" |
| **P4** | Chart tokens |
| **P5–P7** | Frontend |
| **P8** | Docs |

##### 0.5 Owner decisions
| Code | Decision |
|---|---|
| **O-REF** | Refunds on cancel |
| **O-STU** | Studio-hosted events, published in one step |
| **O-CAA** | What happens when a host changes an event after approval |
| **O-RSN** | Whether a reject reason is required |
| **O-ADV** | Advisors as an audience |
| **O-NAME** | The stored name for the rejected status (`rejected` vs `draft`) |

---

#### 1. Gap table

**Notation.** E = exists, P = partly, N = does not exist, W = would give a wrong figure today.

##### EV1 Overview, desktop light (EV2 dark, EV17a phone)
| Block (dc line) | What it draws | Worker source today | Owner | Now / placeholder |
|---|---|---|---|---|
| Crumb (`dc:405`) | "Community › Events" linking to `/admin/community` | Frontend only. `/admin/community` is not a route; the landing is `/admin/held/community` (`fe/App.jsx:2726`). | — | Fix the link |
| Title, line, scope chip (`dc:405`, `:59`) | Static text | `SCOPE_LABEL`/`SCOPE_TITLE` (`fe/pages/admin/insights/insightsModel.js:26-28`) | — | **NOW** |
| "New studio event" (`dc:406`) | Button | `/events/new` exists (`App.jsx:3178`). But the host is always the creator (`events.ts:233`), and a public event still goes through the queue (`:498-501`). | **O-STU** | NOW only as a plain link with honest wording ("New event"). "Studio" waits for O-STU. |
| Updated / refresh | Clock and refresh icon | Client only | — | NOW |
| Tabs + "Review [3]" (`dc:449`) | 4 tabs and an amber count | **E**: R1 `status=pending_review` (page on if 200 come back) or R6 `count` | — | NOW |
| Period 4/12/52 (`dc:473`) | Segmented control | **N** `overview?weeks=` (P3) | — | It can drive only the blocks computed client-side by event start date (below); otherwise omit it |
| T1 Waiting for review: count | [3] | **E** R1/R6 | — | NOW |
| T1 "oldest [3 days]" + "Overdue" | Age and flag | **W**: R6 `oldest_at` and R1 `created_at` are draft-creation times (`approvalSources.ts:221`), not submission. The canvas threshold of 2 days also differs from `SLA_PAST_HOURS = 72` (`approvalSources.ts:305`), which #2390 shares. | — | Needs P2 `submitted_at`. Until then: Unrecorded "Waiting time counts from submission, which is not recorded yet", and no flag. |
| T1 Next 30 days, "[214] seats · [2] full" | Count and sub-line | **P**: R2 `registrations`/`capacity` plus R1 `status`/`starts_at`, under Guard G. Which statuses count is not defined. | — | NOW, with G |
| T1 Registrations [640], "+12%" | This period vs last | **N**. `summary.total_registrations` is **all-time over every event, cancelled ones included** (`admin_events.ts:134-140`), so it is **W** if labelled "this period". `registered_at` is stored (`mig/109_events_core.sql:134`) but not aggregated. | — | Waits for P3 `weekly` |
| T1 Show-up rate [61]%, "[9] ended" | Rate | **P**: Σattended ÷ Σregistrations over R2 rows that have ended (`ends_at` from R1; a rule is needed when `ends_at` is null) and are not cancelled. **Never** R2 `conversion` (`:186`, which gives 0 for upcoming events) and never `summary.total_*`, which is all-time. Caveat: `attended` is set only by a check-in scan (`events.ts:894-896`), so an event that never scanned shows 0. | — | NOW, with G and the ended rule. P3 `show_up` replaces it. |
| T2 On waitlists [37] | People on waitlists of upcoming events | **P**: Σ R2 `waitlisted` over upcoming rows. That counts registrations, not distinct people. `summary.total_waitlisted` includes past events → **W**. | — | NOW, with G |
| T2 Paid tickets [$2,480] · paid · pending | Money | **N**: there is no aggregate; R4 has it per event, which means N calls and names/emails in the payload. **No SPA screen can set a price**: the editor payload has no `price_cents`/`currency` (`fe/pages/events/EventEditorPage.jsx:108-125`), the manage page has none, and create defaults to 0 (`events.ts:251`). | — | Waits for P3 `paid`/`payment_pending`. Not "Not recorded": the data is recorded. |
| T2 Free seats given [52] | Count | **N** aggregate. `comp` is per registration in R4. | — | Waits for P3 `free_seats` |
| T2 Cancelled [2] · "[1] had paid tickets" | Count and sub-line | Count **P**: R1 `status='cancelled'` by `starts_at` in the period. There is no `cancelled_at`; the audit row `event_cancelled` is never read. Sub-line **N**. | O-REF | Count NOW, labelled "starting in this period". Sub-line waits for P3 `cancelled_with_paid`. |
| Weekly line + summary sentence (`dc:290-294`) | Registrations and check-ins per week | **N**. The raw stamps exist (`registered_at`; `event_checkins.checked_in_at`, `mig/109:154`). | — | Waits for P3 `weekly` (see also EV12) |
| Needs attention · Overdue | Row | **W** today (created_at) | — | Waits for P2 |
| · Full | Row + Change capacity | **E**: R2 `registrations ≥ capacity`, `waitlisted`. Action is W-cap. | — | NOW, with G |
| · Low sign-ups | Row | **P**: data in R2. **No threshold is defined anywhere.** | — | Needs a definition. P3 `needs_attention`. |
| · Clash | Row + See calendar | **P**: `starts_at`/`ends_at` in R1. There is no clash read (P3). A rule is needed for null `ends_at`. | — | NOW client-side once the rule is set |
| · Changed after approval | Row | **N**: no column. Only a switch to public re-queues an event (`events.ts:459-466`). | **O-CAA** | Waits for P2 `changed_after_approval_at` |
| · Paid tickets (host cancelled) | Row | **N**: no host-cancel route (#2387) and no paid aggregate | **O-REF** | Waits for P3 (and #2387) |
| · "[9] items · See all" | Total | Only partly computable | — | Show the count of the rows actually drawn |
| Next up (`dc:304-310`) | 5 rows: date block, fill bar, waitlist, status | **P**: R2 counts + R1 `type`/`location_kind`/`status`. "Sign-ups open once approved" is true (`events.ts:800-804`). The type pill is **W** for 4 types and the format word is **W** for in-person events (P1). | — | NOW, without the type and format words until P1 |
| Events by type (`dc:311-312`) | 12 bars | Data in R1 `type`, but **W**: LP Briefing, Networking, Roundtable and Fireside are stored as `meetup` (`events.ts:216`; edit ignores them at `:437`). The 12-type list is `fe/lib/eventTypes.js:28-41`. | — | **Do not draw** until P1 (then client-side, or P3 `by_type`) |
| Show-up by event (`dc:313-314`) | Last 8 ended, with a reference line | **P**: R2 `attended`/`registrations` + R1 `ends_at`, under Guard G | — | NOW |
| Who comes · by profile | 100% stacked bar | **N** aggregate. R4 `role` is per event. | — | Waits for P3 `by_role` |
| Who comes · how they got a seat | 100% stacked bar | **N** aggregate. "Added by an admin" has **no write path**: the only sources written are `self` (`events.ts:827`), `public` (`events_public.ts:173`) and `invite` (`:249`). | — | Waits for P3 `by_source`. "Added by an admin" stays **Not recorded** unless a write is added. |
| Every event by status (`dc:316`) | 5 chips | **E**: count R1's full paging by `status`, which includes `rejected`. R2 summary has no rejected bucket (`:126-132`) → **W** for "Sent back". | **O-NAME** | NOW from R1 |
| Page views (`dc:320`) | Not-recorded card | Correctly **not recorded**: `events` has no view column (`mig/109:41-69`); the funnel allowlist has no event view (`wk/routes/track.ts:29-51`) | — | NOW, `Unrecorded` |
| Feedback (`dc:320`) | Not-recorded card | Correctly **not recorded**: grep for `event_feedback`/`events_feedback` under `cloudflare-worker/sql` and `src`, and for "feedback" in `events.ts`, `events_public.ts` and `admin_events.ts`, found nothing | — | NOW, `Unrecorded` |
| EV2 dark palette | Violet #a78bfa | No data. The palette is reusable from `fe/pages/admin/insights/InsightsCharts.jsx:18-35`; tokens are P4. | — | NOW |

##### EV3 Review tab (EV17b queue, EV17c event)
| Block | What it draws | Worker source | Owner | Now / placeholder |
|---|---|---|---|---|
| Queue header "· [3]" | Count | **E** R1 `status=pending_review` | — | NOW |
| Search: title | | **E** client-side over R1 | — | NOW |
| Search: host, venture | | **N**. No event read carries a host name or venture (grep for `host_name`/`hosted_by`/`venture`/`project_name` in `events*.ts`, `admin_events.ts` and `eventsCommon.ts` found nothing; only `host_user_id` and `project_id`). | — | Waits for P3 paged list. Say "Searches titles". |
| Filter Type | | **W** until P1 | — | Omit until P1 |
| Filter Host role | | **N** (P3) | — | Omit |
| Filter Free or Paid | | **E** `price_cents`. Every SPA event is 0 today. | — | NOW |
| Filter Starts | | **E** `starts_at` | — | NOW |
| Sort: Waiting longest | | **W**: created_at order | — | Omit until P2 |
| Sort: Starts soonest | | **E** client | — | NOW |
| Sort: Newest | | R1's native `created_at DESC` | — | NOW, labelled "Newest created" |
| Row: title, when | | **E** `title`, `starts_at`+`timezone` (see the timezone caveat in §5) | — | NOW |
| Row: type pill | | **W** for 4 types (P1) | — | After P1 |
| Row: "[Name] · Founder · [Venture]" | | **N** (P3) | — | Unrecorded "Host not in this read" |
| Row: "waiting [3 days]", amber dot | | **W** (created_at; also the 2-day vs 72 h threshold) | — | Waits for P2 |
| Flag Paid [$40] | | **E** `price_cents`/`currency` | — | NOW |
| Flag Free seats | | **E** `audience_rules` comp_* keys (`wk/services/eventAudience.ts:24-30,46-53`). These are the rules approve will act on, although create drops what the host ticked (Map 3 C). | — | NOW |
| Flag Clash | | **P**, client-side from R1 | — | NOW once the rule is set |
| Flag Sent back once | | **N**: no history reader, no `review_note` | — | Waits for P2/P3 |
| Preview card | Cover, date, title, type, format and place, summary, "Hosted by" | **E** `cover_url`, `title`, `summary`, `location_text`. Type and format **W** until P1. Host **N**. | — | NOW without the host. Type and format after P1. |
| Facts · Visibility, Capacity + waitlist, Registration, Price | | **E** `visibility`, `capacity`/`waitlist_enabled`, `approval_required`, `price_cents` | — | NOW |
| Facts · Starts and ends, "Your time" | | **E** `starts_at`, `ends_at`, `timezone` (timezone caveat, §5) | — | NOW |
| Facts · Who may register | | **E** `audience_rules.mode/roles/personas` (`wk/services/eventOrganiser.ts:7-21`). `advisor` cannot be chosen (`:5`). | **O-ADV** | NOW |
| Facts · Free seats for | | **E** comp_* keys | — | NOW |
| Facts · Agenda "[4] items · [3] speakers" | | **E** R5: count and distinct speakers | — | NOW |
| Facts · Venture | | **N**: only `project_id` | — | Waits for P3 |
| Facts · Created | | **E** `created_at` | — | NOW |
| Facts · Submitted | | **N**: no `submitted_at`. The audit row `event_submitted` (`events.ts:507`) is never read. | — | Waits for P2 |
| Description | Collapsed text | **E** `description` | — | NOW |
| What approving does · line 1 "on the public calendar" | | **E**: approve sets `admin_published=1` (`admin_events.ts:219-221`); the feed predicate is `visibility='public' AND status='published' AND admin_published=1` (`events_public.ts:30`) | — | NOW |
| · line 2 "Tells the host" | | **E**: `notify` to the host (`:224-229`), **in-app only** (`wk/services/notify.ts:286`) | — | NOW |
| · line 3 "Emails [12]: [8] partners, [4] LPs" | | **N** count. `evaluateCompEligibility` exists (`eventAudience.ts:80`) but no route exposes a dry run. Only the **partner and LP** flags mint invitations at approve (`:212`). The investor, founder and host-contact flags give a free seat at sign-up and send no invitation (`:12-17`). Delivery: inbox, plus email only when Gmail is set up and an address exists (`wk/services/eventMessaging.ts:77-104`). | — | Count waits for P3 `comp-preview`. NOW, without counts: "Sends free-seat invitations to official partners / invested LPs not yet invited", or "Sends no invitations". |
| Clashes card | | **P**, client-side R1 | — | NOW once the rule is set |
| History card | | **N** (P3 history, P2 `review_note`). "First time in review" cannot be known either. | — | Unrecorded "Review history is not read yet" |
| Action bar | Send back, Approve, Open as host | **E** W-reject, W-approve, `/events/:id/manage` (`App.jsx:3180`). There is no state check (P2 409). | — | NOW |

##### EV4 Approve dialog and EV4b after
| Block | Source | Owner | Now |
|---|---|---|---|
| Three lines | As in EV3 | — | Lines 1 and 2 NOW. Line 3 without counts until P3. |
| "Also feature it" | **E**: W-feat **after** W-approve. Two calls, not atomic; send `{featured:true}` explicitly (`:302-303`). Both are suspension-gated (`:214`, `:297`). | — | NOW |
| After: row leaves, one line, "Open event" | **E**: client-side on a 200. `/admin/events/:id` is a new frontend route. | — | NOW |

##### EV5 Send back
| Block | Source | Owner | Now |
|---|---|---|---|
| Quick reasons, counter "/ 1000" | Client only. The Worker cuts the reason at 1000 (`:259-260`), so the counter matches. | — | NOW |
| "Required"; button disabled until filled | The Worker accepts no reason (`:259-260`) | **O-RSN** | The client can enforce it NOW. The Worker rule waits for P2. |
| Copy | True: the host sees the reason in-app (`:265-271`); the host can edit and resubmit (submit-review has no status check, `events.ts:498-506`); the event stays off the calendar (`:261-263`) | **O-NAME** | NOW |

##### EV6 All events (EV17d phone)
| Block | Source | Owner | Now / placeholder |
|---|---|---|---|
| Rows, pager "1–25 of [N]" | **P**: R1 fully paged, so N is exact; R2 joined by `id` under Guard G. There is no server total or paging (P3). | — | NOW, client-side |
| Event title, ★ Featured | **E** R1 | — | NOW |
| Host line, "Studio team" | **N** (P3) | **O-STU** | Omit, or Unrecorded |
| Type column | **W** until P1 | — | After P1 |
| Starts + timezone | **E** (timezone caveat, §5) | — | NOW |
| Status | **E**. Show `rejected` as "Sent back". | **O-NAME** | NOW |
| Visibility | **E** | — | NOW |
| Format column | **W** until P1 | — | After P1 |
| Capacity, Taken, Waitlisted, Fill | **E**: `capacity`; R2 `registrations`, `waitlisted`, `capacity_util` (`:185`, correct) | — | NOW, with G |
| Attended, Show-up | **P**: R2 `attended`, and the ratio only once the event has ended (R1 `ends_at`). R2 `conversion` is **W**. | — | NOW. "Not held yet" as words, not "—". |
| Price | **E** | — | NOW |
| ⋯ menu | **E** W-feat, W-cap, W-unpub, W-cancel; host link. Limits such as "Published only" and "not already cancelled" are enforced by the page only. | — | NOW |
| Search | Title **E**; host and venture **N** | — | Titles only |
| Filters: Status (several), Visibility, When, Price, Featured | **E** client-side | — | NOW |
| Filters: Type, Format | **W** until P1 | — | After P1 |
| Filter: Host | **N** | **O-STU** | Omit |
| Views: This week, Full | **E** | — | NOW |
| View: Needs attention | **P**: only the drawable reasons | — | Partial |
| View: Cancelled with paid tickets | **N** (P3) | **O-REF** | Omit |
| Sorts: Starts, Created, Seats taken, Fill, Show-up | **E** (with G) | — | NOW |
| Sort: Waiting time | **W** | — | Waits for P2 |
| CSV, counts only | **N** on the Worker: `/export` has names and emails (`events.ts:924-950`). A client-side Blob of the rows on screen needs no Worker change and hits no D774 pattern (`type="file"`, `.draft(`, `dd.generateReport(`). | — | NOW, client-side |

##### EV7 One event (and EV7g)
| Block | Source | Owner | Now / placeholder |
|---|---|---|---|
| Title, pills status/visibility/featured | **E** R3 | — | NOW |
| Type pill | **W** until P1 | — | After P1 |
| "Hosted by [Name] · Founder · [Venture]" | **N**: R3 has only `host_user_id`/`project_id` | **O-STU** for "Hosted by the studio team" | Unrecorded until P3. The issue names host fields only for the paged list; add them to `/:id` or `/summary` too. |
| Time line, place | **E** `starts_at`/`ends_at`/`timezone`, `location_text` (timezone caveat). Format word **W** until P1. | — | NOW |
| Buttons: capacity, feature, unpublish, cancel | **E** W-cap, W-feat, W-unpub, W-cancel | — | NOW |
| ⋯ Open as host | `/events/:id/manage` (`App.jsx:3180`) | — | NOW |
| ⋯ Download roster (CSV) | R7 `exportUrl`. The file holds names and emails; it is not drawn on the page. | — | NOW |
| ⋯ Open public page | `/events/:slug` (`App.jsx:3576`), only when the feed predicate holds (`events_public.ts:30`) | — | NOW |
| ⋯ Add to calendar | R7 `icsUrl` | — | NOW |
| Publish gate, three states (EV7g) | **E** `visibility`, `status`, `admin_published`. "Private and unlisted events publish without review" is true (`events.ts:502-505`). | — | NOW |
| Tile Capacity | **E** R3 | — | NOW |
| Tiles Seats taken, On the waitlist | **E** R4 `counts.seats_taken`/`waitlisted`. "Oldest first" is true (`wk/services/eventCapacity.ts:142-145`). | — | NOW |
| Tiles Attended, Show-up | **E** R4 `counts.attended`, shown once ended | — | NOW. "Not held yet" as words. |
| Tile Paid tickets | **E**: R4 rows with `payment_status==='paid'`, count and Σ`amount_cents`. Filter on paid: `amount_cents` is also set on pending rows (`events.ts:1131`). Paid rows can be cancelled or declined (`wk/services/eventTickets.ts:114-130`). | — | NOW |
| Tile Free seats | **E** R4 `comp` on seated rows. The sub-line must say "audience rules or free invitations" (`events.ts:822`). | — | NOW |
| Tile Invitations "sent · accepted" | **E** R4 `invitations[].status` | — | NOW |
| *All R4 tiles* | They pull names and emails into the browser (`events.ts:613-614`, `:605`). | — | NOW if S1 accepts that, otherwise wait for P3 `/:id/summary` |
| Roster line, "Open roster as host" | `/events/:id/manage/registrations` (`App.jsx:3181`) | — | NOW |
| Chart A Seats over time | **P**: `registered_at` of the people who hold a seat now. Cancel and promotion dates are not stored, and the row's `updated_at` changes on any edit. P3's "seats taken by day" has the same source. | — | NOW, labelled "by the date each current seat holder registered" |
| Chart B funnel | **E** from R4 statuses. **"Confirmed" must be `confirmed + attended`**: `counts.confirmed` (`:638`) leaves out attended rows and is **W** as a funnel step once check-ins start. | — | NOW |
| Who registered · by profile | **E** R4 `role` (`users.role`, `:596,600,624`). `user_id` null → Guest; `partner` → "Operating Partner" (`fe/lib/plansPricing.js:23`); `exploring` → Explorer. `admin` has no bucket. | — | NOW |
| Who registered · how they got a seat | **P**: `self`/`public` → Signed up. `invite` → Invitation, which **undercounts**: in-app registrants with an invitation are `source='self'` with `invitation_id`, and R4 does not expose `invitation_id` (`:610-628`). `comp` overlaps the other buckets. "Added by an admin" → Not recorded. | — | Needs a precedence rule. "Added by an admin" stays Unrecorded. |
| Invitations card · by status | **E** pending/accepted/declined/revoked | — | NOW |
| Invitations card · by source | `manual` → "Sent by the host **or an admin**" (`events.ts:548`); `auto_partner`, `auto_lp`. **The Investors, Founders and Host's contacts rows can never fill**: those sources are never minted as invitations (`eventAudience.ts:12-17,212`). | — | Drop those three rows |
| Payments · Price, Paid, Payment pending | **E** R3 + R4 | — | NOW |
| Payments · Refunds "Not recorded" | Correct: nothing writes `refunded` (Map 3 §7). The link target `/admin/revenue` is `hqOnly` (`App.jsx:2784`). The refund route is super-admin only (`wk/routes/admin_billing.ts:201-202`) and needs a `payment_intent_id` that no read exposes. | **O-REF** | NOW |
| Reminders | **P**: due times can be worked out from `starts_at` (windows at `wk/services/eventReminders.ts:5-8`; published events only, `:158`). Sent status and "sent to [40]" are **N**: `event_notifications` is only ever written (`:201`), never read. | — | "Due [t]" while that time is still ahead. After it: "Sent status not read yet", until P3 summary. |
| Agenda | **E** R5. "Edit as host" → `/events/:id/manage/agenda` (`App.jsx:3182`). | — | NOW |
| History | **N** (P3 history; the audit rows are written at `admin_events.ts:64-83` and `events.ts:482,507` but never read). The amber row needs P2. | **O-CAA** | Only "Created · [created_at]" now. The rest: Unrecorded. |

##### EV8 Calendar month (EV8w week, EV17e list)
| Block | Source | Owner | Now |
|---|---|---|---|
| Chips with time, title, status style | **E** R1 `starts_at`/`ends_at`/`status`. "Draft or Sent back" includes `rejected`. | **O-NAME** | NOW |
| Popover seats "[12]/[20]" | R2 (G) | — | NOW |
| Popover type and format | **W** until P1 | — | After P1 |
| Overlap "[2] overlap", week side by side | **P**, client-side from R1. Rule needed for null `ends_at` and cancelled events (P3 clashes). | — | NOW once the rule is set |
| Filters | Same as EV6: Type and Format after P1; Host omitted | **O-STU** | Partial |

##### EV9a/b/c Change capacity
| Block | Source | Now |
|---|---|---|
| "Now: seats · taken · waiting" | **E** R4 `counts` or the R2 row | NOW |
| Raising: "[6] move off, oldest first" | **E** client-side as `min(new−taken, waitlisted)`; order is `waitlist_position ASC` (`eventCapacity.ts:142-145`). After saving, `promoted` comes back (`:384-387`). | NOW |
| Raising: "Each gets an email" | **False.** `notify` sends no channels, so in-app only (`admin_events.ts:370-378`, `notify.ts:286`). Email-only waitlisters are skipped (`:370`). With `approval_required`, non-comp rows land as `registered` (`eventCapacity.ts:150-151`). | Reword |
| Lowering: "No one loses a seat" | True | NOW |
| Lowering: "New sign-ups join the waitlist" | True only when `waitlist_enabled`; otherwise the event is full (`eventCapacity.ts:77-80`) | Branch the line on `waitlist_enabled` |
| EV9c error | **E** 400 `invalid_capacity` (`:349-357`) | NOW |
| "No cap" | **E** `null` | NOW |

##### EV10 Cancel event
| Block | Source | Owner | Now |
|---|---|---|---|
| "This cannot be undone" | **False in the Worker**: approve revives a cancelled event (`:217-221`), and submit-review re-queues any status (`events.ts:498-506`). P2 fixes approve only. | — | Reword |
| "It leaves every calendar" | **P**: it leaves the public feed and the .ics feed (`events_public.ts:30,85`). Calendar files already downloaded or emailed (`METHOD:REQUEST` with `STATUS:CONFIRMED`, `eventsCommon.ts:198-209`) are not updated. | — | "It leaves the public calendar…" |
| "[48] registered and [6] waitlisted get a notice" | Use **R4** rows with `user_id` not null and status in registered/confirmed/attended/waitlisted (`:324-333`). R2 counts include email-only registrants, who get nothing → **W**. The notice is in-app only. | — | NOW, from R4 |
| Paid box "[5] ([$200])" | **E** R4 | **O-REF** | NOW |
| "HQ refunds them in Revenue › Billing" | Super admin only; no read exposes the payment id | **O-REF** | Keep, with the exact facts |
| Checkbox | Client only | — | NOW |
| Note to registrants | **N**: cancel reads no body (P2) | — | Omit until P2 |

##### EV11a Unpublish, EV11b Feature
| Block | Source | Now |
|---|---|---|
| Unpublish: "back to the host as a draft", "Registrations stay" | True (`:283-285`) | NOW |
| Unpublish: "The host is told, with your note" | **False**: no `notify` and no note (`:276-288`) | P2. Until then: "The host is not told automatically." Omit the note field. |
| Feature copy | True (`events.ts:303`; the public feed orders by start only, `events_public.ts:75-77`) | NOW |

##### EV12 Chart as table
| Block | Source | Now |
|---|---|---|
| Week / Registrations / Check-ins table | **N** (P3 `weekly`) | Waits for P3 |
| "—" for a week with no check-ins | Conflicts with `fe/ui/Honesty.jsx:21-23`. A week with no scans is a real 0 when the block read succeeded. Use Unrecorded only when the block itself says so. | Resolve before building |

##### EV13a No events, EV13b nothing waiting
| Block | Source | Now |
|---|---|---|
| EV13a "No events yet" + real zeros | **E, truthful**: R1 `?limit=1` returns `[]`, and R1 errors are 5xx | NOW |
| EV13a "Show-up rate —" | Use words: "No event has ended yet" | NOW |
| EV13a buttons | `/events/new` (`App.jsx:3178`), `/events` (`:3575`) | NOW |
| EV13a chart lines "No registrations in this period" | True whenever there are no events | NOW |
| EV13b | **E** R1 `status=pending_review` returns `[]`. The copy is true (`events.ts:498-501`). | NOW |

##### EV14 Loading
Client only. NOW.

##### EV15 Error and refused
| Variant | Source | Now |
|---|---|---|
| EV15a: Payments tile and card fail alone | **P**. With R4 it is all or nothing: one request feeds every R4 block. Per-block failure needs the P3 summary block shape (`available:false`). | NOW per read: R3, R4 and R5 blocks fail separately |
| EV15b: whole read failed | **P**: R1/R2/R3 transport errors and 5xx, plus Guard G for D1 failures inside R2. Anything else waits for the P3 overview. | NOW |
| EV15c: licence suspended | **E**: 423 `{detail:'Branch suspended by HQ',code:'branch_suspended',since,reason}`, on approve and feature only (`:214,:297`; `wk/index.ts:1474`). It cannot happen on HQ (`wk/auth.ts:753`). | NOW |
| EV15c: "changed while you were reading" | **N**: no version or state check. P2's 409 covers approve and reject only. | Waits for P2 |
| Not drawn on the canvas, but must be handled | 403 `{error:'admin_frozen'}` on any POST while frozen (`:31-38`; `auth.ts:568-589`); 404 `not_found` | NOW |

##### EV16 No permission
No Worker involvement. It cannot be reached today: `RoleGuard` redirects a non-admin (`App.jsx:1819-1834`). This is a frontend decision, not one of the owner list.

##### EV17a–f Phone
Same data as the desktop boards above. EV17f is EV9a as a bottom sheet.

---

#### 2. Figures that would be wrong today: do not draw until fixed
| # | Figure | Why it is wrong | Fixed by |
|---|---|---|---|
| 1 | Any R2 number drawn without Guard G | A failure returns zeros or `[]` with status 200 | G now, or P3 |
| 2 | R2 `conversion` as show-up | 0 for every upcoming event (`:186`) | Compute only for ended events |
| 3 | `summary.total_registrations` / `total_attended` / `total_waitlisted` as "this period" or "upcoming" | All-time, across every event | P3, or the client-side sums in §3 |
| 4 | R2 summary status buckets | No `rejected` bucket; the four buckets do not add up to `total_events` | Use R1 counts |
| 5 | Waiting age, "oldest", Overdue, sort "Waiting longest", R6 `oldest_at` | Draft creation time, not submission | P2 |
| 6 | Pending queue built from R2 rows | 200 cap, ordered by start (Map 3 §2) | Use R1 |
| 7 | Type pills, Type filter, Events by type | 4 of 12 types stored as `meetup` | P1 |
| 8 | Format word, Format filter, "In person" | The editor's `in_person` is saved as `virtual` | P1 |
| 9 | R4 `counts.confirmed` as the "Confirmed" funnel step | Leaves out attended rows | Compute `confirmed + attended` |
| 10 | R4 "Invitation" seat source | Undercounts; `invitation_id` is not exposed | P3, or add `invitation_id` |
| 11 | Cancel-notice count from R2 | Includes email-only registrants, who get no notice | Use R4 |
| 12 | "Each gets an email" (EV9), "The host is told, with your note" (EV11a), "cannot be undone" and "leaves every calendar" (EV10) | False as written | Reword now, or P2 |

#### 3. Buildable NOW with no Worker change
- **Shell:** tabs, routes and Loading (EV14), with Lightbox dialogs. The crumb must point to `/admin/held/community`.
- **EV1:** Review count; Next 30 days; On waitlists; Show-up rate tile; Show-up by event; Cancelled count (labelled by start); Needs attention rows Full, Clash and Low sign-ups (once the rule and threshold are set); Next up without type or format; the status strip from R1; Page views and Feedback as `Unrecorded`.
- **EV3/EV17b/EV17c:** queue from R1, searched by title and sorted by start or creation; Paid and Free-seats flags; preview without the host; every Fact except host, venture and Submitted; description; approve lines 1–2, and line 3 without counts; the action bar.
- **EV4/EV4b/EV5/EV11b:** complete. The "reason required" rule can be enforced in the client.
- **EV6:** client-side table over R1 plus R2 under Guard G, with the filters, sorts, pager and Blob CSV marked NOW in its table.
- **EV7/EV7g:** header, gate, every tile, Chart B, by-profile, invitations by status (and by source for `manual`/`auto_partner`/`auto_lp`), Payments, Refunds as `Unrecorded`, Agenda, roster line, the menu. All of this rests on R4 in transport (S1 to accept that, or wait for P3 summary).
- **EV8/EV8w/EV17e:** chips and seat counts; overlaps once the rule is set.
- **EV9, EV10, EV11a:** with corrected copy. No note fields.
- **EV13a/b:** truthful through R1. **EV15b** through transport errors and Guard G. **EV15c** suspended state, plus the 403 frozen and 404 cases.

#### 4. Honest placeholders for what cannot be built yet
Use three labels and keep them apart:
- **Not recorded** (`Unrecorded`): no store exists at all.
- **Not read here yet**: the data is stored but no read sums it. Use `Unrecorded` with its text overridden.
- **Could not be read** (`Unreadable` with `what` and `claim`): a read failed.

| Block | Label | Waits for |
|---|---|---|
| Page views, Feedback, Refunds, "Added by an admin" seat source | Not recorded | No store exists (refunds: O-REF) |
| Waiting age, Overdue, Submitted, "Sent back once", history card, "Changed after approval" | Not recorded yet | P2 columns. Then P3 history. |
| Registrations (period and delta), weekly chart and EV12, Paid tickets total, Free seats given, Who comes (both bars), "had paid tickets", Paid-tickets attention row, "Cancelled with paid tickets" view | Not read here yet | P3 overview |
| Host name, role and venture (rows, facts, header); host search and filter | Not read here yet | P3 list (and the single-event read) |
| Free-seat invitation counts in the approve dialog | Not read here yet | P3 comp-preview |
| Reminder sent status and count | Not read here yet | P3 summary |
| Events by type; type and format everywhere | Omit | P1 |
| Note fields (cancel, unpublish); "changed while reading" refusal | Omit | P2 |
| Any block whose read failed, including a Guard G hit | Could not be read | — |

#### 5. New findings not in Maps 1–3
1. **Event times are stored in the host's browser timezone, not the event's.** `localInputToIso` runs `new Date(datetime-local).toISOString()` in the browser's own zone (`EventEditorPage.jsx:39-43`). `timezone` is sent as a separate label (`:113-115`). So "18:30 Lisbon time" is right only when the host's browser was set to the zone they picked. This affects EV3, EV7, EV6 and EV8. Member side, P1 territory.
2. **No SPA screen can set a ticket price** (`EventEditorPage.jsx:108-125`; `EventManagePage.jsx` has no price field). Every money block will truthfully read Free or 0 for SPA-created events.
3. **Three of the free-seat flags never create invitation rows** (`eventAudience.ts:12-17,212`). That empties three EV7 invitation-source rows and makes the approve line 3 count cover partners and LPs only.
4. **R2's per-event counts are exactly complete when R1's total is 200 or fewer.** Together with Guard G, this makes the analytics read safe to draw today without a Worker change.

## Part B — the Worker reads and writes

#### Events Console: Worker reads and writes available today (issue #2368)

HEAD `4d7975422` on `claude/spinout-lab-workspace-wuyyqd`. All paths are repo-relative to `/home/user/StudioOS`.

##### 0. Mounts
| Prefix | Router | Mount |
|---|---|---|
| `/api/admin/events` | `cloudflare-worker/src/routes/admin_events.ts` | `cloudflare-worker/src/index.ts:999`, mounted before the `/api/admin` catch-all (`:997-998`) |
| `/api/events` | `routes/events.ts` | `index.ts:1237` |
| `/api/public` (events feed) | `routes/events_public.ts` | `index.ts:1349` |
| `/api/admin/studio` (glance) | `routes/admin_studio_glance.ts` | `index.ts:1093` |
| `/api/branch` (approvals board) | `routes/branch_approvals.ts` | `index.ts:1041` |
| `/api/admin/billing` | `routes/admin_billing.ts` | `index.ts:972` |

---

##### 1. `routes/admin_events.ts` (all 390 lines)

###### Guards
- Every route first runs `ensureEventsSchema` middleware (`:26-29`). In production it does nothing (`services/eventsSchema.ts:153-156`).
- `admin(c)` wraps `requireAdmin` in a try/catch (`:31-38`). Whatever `requireAdmin` throws comes back as `{ error: <message> }`:
  - **401** when the message is `'Unauthorized'`.
  - **403** for anything else.
  - `requireAdmin` is `requireAuth` + `role==='admin'` + `refuseWhileFrozen` (`auth.ts:523-528`).
  - **Quirk:** a frozen HQ admin on a POST (`auth.ts:568-589` throws `'admin_frozen'`; GET/HEAD/OPTIONS skip it at `:570`; branches skip at `:571`; the super admin skips at `:572`) is caught by the wrapper. It returns **403 `{error:'admin_frozen'}`**, not the 423 `adminFrozenBody` that `index.ts:1470` would send.
- Licence suspension uses `requireBranchNotSuspended(c)` (`auth.ts:752-795`). It applies **only on `approve` (`:214`) and `feature` (`:297`)**, and runs after the admin check.
  - On HQ it does nothing (`auth.ts:753`). If `branch_licence` cannot be read, it passes (`:759-762`).
  - Its throw is not inside a try, so it reaches `app.onError`, which returns **423** `{detail:'Branch suspended by HQ', code:'branch_suspended', since:string|null, reason:string|null}` (`index.ts:1474`, `util/authErrors.ts:178-190`, `util/branch.ts:67`).
  - `reject`, `unpublish`, `cancel` and `capacity` are **not** suspension-gated.
- `:id` goes through `intParam` (`:89-92`): it must be a positive integer, otherwise **404 `{error:'not_found'}`**. A missing row also gives 404 (`loadEvent` `:85-87`, `SELECT * FROM events WHERE id = ?`).

###### Audit writer `writeAudit` (`:64-83`)
`INSERT INTO admin_audit_log (admin_user_id, action, report_type, filters_json[, actor]) VALUES (?, ?, 'events', ?, ?)`
- `filters_json` = `JSON.stringify({ event_id, ...extra })` (`:69`).
- `actor` = SHA-256 of the lower-cased email, written only if a PRAGMA finds that column (`:43-52`, `:54-62`).
- Best-effort: a failure is only `console.warn` (`:80-82`).
- It does **not** write `activity_logs`, unlike `logAdminAction` (`services/adminAudit.ts:86-115`).
- The table's timestamp column is `exported_at` (`routes/admin.ts:485`).
- **No route reads these rows back per event.** Grep found no reader keyed on `report_type='events'` or `event_id` (the readers of `admin_audit_log` are `admin_billing.ts:399`, `admin_publications.ts:255`, `monitoring_analytics.ts`, `admin_security.ts`, and all are generic).

###### Routes
| Route | Lines | Body | SQL write | Audit `action` (+extra) | Side effects | Response |
|---|---|---|---|---|---|---|
| `GET /` | 95-109 | query `status` (any string, no validation), `limit` (default 50, `Math.min(..,200)`), `offset` (≥0) | `SELECT * FROM events [WHERE status = ?] ORDER BY created_at DESC LIMIT ? OFFSET ?` | — | — | `{ events: AdminEvent[] }`. No total, no counts, newest first |
| `GET /analytics` | 114-194 | — | see below | — | — | `{ summary, events }` |
| `GET /:id` | 197-205 | — | read only | — | — | `{ event: AdminEvent }` |
| `POST /:id/approve` | 208-249 | none read | `UPDATE events SET status='published', admin_published=1, updated_at=datetime('now') WHERE id=?` (`:219-221`) | `event_approved` | `notify(host)` type `event_approved`, title `Your event is live: <title>` (`:224-229`). **Comp-on-publish** (`:234-247`): if `audience_rules_json` has keys → `mintCompInvitations(env,id,rules,host_user_id,a.id)` → for each newly created invite `deliverEventInvite(..., comp:true)` (inbox + Gmail email with .ics, `services/eventMessaging.ts:77-104`). Failures are swallowed | `{ event }`. The minted count is **not** returned |
| `POST /:id/reject` | 252-273 | `{ reason?: string }`, cut to 1000 chars (`:259-260`) | `UPDATE events SET status='rejected', admin_published=0 …` (`:261-263`) | `event_rejected` `{reason}` | `notify(host)` type `event_rejected`, title `Event needs changes: <title>`, `body: reason` (`:265-271`) | `{ event }` |
| `POST /:id/unpublish` | 276-288 | — | `UPDATE events SET admin_published=0, status='draft' …` (`:283-285`) | `event_unpublished` | none | `{ event }` |
| `POST /:id/feature` | 291-309 | `{ featured }`, truthy → 1, **missing body → 0** (`:302-303`) | `UPDATE events SET featured=? …` | `event_featured` `{featured:boolean}` | none | `{ event }` |
| `POST /:id/cancel` | 312-335 | none read (no note field) | `UPDATE events SET status='cancelled', admin_published=0 …` (`:319-321`). **Registrations are untouched** | `event_cancelled` | `SELECT DISTINCT user_id FROM event_registrations WHERE event_id=? AND user_id IS NOT NULL AND status IN ('registered','confirmed','attended','waitlisted')` → `notify` type `event_cancelled`, title `Event cancelled: <title>` (`:324-333`) | `{ event }` |
| `POST /:id/capacity` | 341-388 | `{ capacity: int≥0 \| null }`. `null`/`undefined`/`''` → null (unlimited); otherwise must be an integer ≥ 0 or **400 `{error:'invalid_capacity'}`** (`:349-357`) | `UPDATE events SET capacity=? …` (`:359-361`) | `event_capacity_override` `{capacity}` | `promoteWaitlist(env, fresh)` (`services/eventCapacity.ts:132-`) → `notify` type **`event_waitlist_promoted`** (`routes/events.ts` uses `event_promoted` for the same thing) (`:367-382`). Lowering below seats taken is not checked and demotes nobody | `{ event, promoted: number }` (`:384-387`) |

**State checks:** no action looks at the current status.
- You can approve a draft, rejected or cancelled event (any visibility).
- You can cancel twice; the second cancel notifies again.

**Notifications:** all `notify()` calls pass no `channels`, so they default to `['in_app']` (`services/notify.ts:283-286`), and user preferences still apply. The only email path in this file is the comp invites on approve. Email-only registrants (`user_id IS NULL`) are never notified on cancel.

###### `GET /analytics` in detail
```sql
-- summary (:125-140), two queries in ONE try
SELECT COUNT(*) total_events, COUNT(CASE WHEN status='published' …) published,
       … 'pending_review' …, … 'draft' …, … 'cancelled' … FROM events;
SELECT COUNT(CASE WHEN status IN ('registered','confirmed','attended') THEN 1 END) registrations,
       COUNT(CASE WHEN status='attended' …) attended, COUNT(CASE WHEN status='waitlisted' …) waitlisted
  FROM event_registrations;            -- all events, including cancelled ones
-- per event (:157-168)
SELECT e.id,e.slug,e.title,e.status,e.starts_at,e.capacity,e.featured,
       COUNT(CASE WHEN r.status IN ('registered','confirmed','attended') …) registrations,
       … 'attended' …, … 'waitlisted' …, … 'cancelled' … cancelled
  FROM events e LEFT JOIN event_registrations r ON r.event_id=e.id
 GROUP BY e.id ORDER BY e.starts_at DESC LIMIT 200
```
- **Failures become zeros:** `summary` starts as an all-zero object (`:120-123`) and is replaced only if *both* queries succeed (`:141-150`). Any throw keeps the zeros, with only `console.warn` (`:151-153`). There is no `available` flag, so a failed read looks exactly like real zeros.
- The rows block failing gives `events: []` (`:155`, `:189-191`).
- `rejected` is not counted in the summary buckets, so `total_events` ≠ the sum of the four.
- `declined` registrations are counted nowhere.
- `capacity_util = capacity && capacity>0 ? round2(registrations/capacity) : null` (`:185`)
- `conversion = registrations>0 ? round2(attended/registrations) : null` (`:186`). `round2` is defined at `:118`.
- "registrations" uses the same predicate as `seatsTaken` (`eventCapacity.ts:37-43`).

```json
{ "summary": { "total_events": 0, "published": 0, "pending_review": 0, "draft": 0, "cancelled": 0,
               "total_registrations": 0, "total_attended": 0, "total_waitlisted": 0 },
  "events": [ { "id": 12, "slug": "x", "title": "x", "status": "published", "starts_at": "<TEXT>",
                "featured": false, "capacity": 60, "registrations": 42, "attended": 0, "waitlisted": 6,
                "cancelled": 3, "capacity_util": 0.7, "conversion": 0 } ] }
```
Analytics rows carry **no** type, visibility, location, price, host or created_at. To get those, join client-side with `GET /` by `id`.

---

##### 2. Member-side event routes an admin can use (`routes/events.ts`)

- `canManage(event,user) = user.role==='admin' || host_user_id===user.id` (`:75-77`). Admins pass every host gate.
- `canViewEvent` lets managers through immediately (`:85-98`).
- `canReadJoinLink` is true for managers (`:102-108`).
- Auth failure gives 401 `{error:'Unauthorized'}` (`:67-73`). Host gate failure gives 403 `{error:'forbidden'}`.

| Route | Lines | Gate | Shape |
|---|---|---|---|
| `GET /api/events/:id` | 398-416 | canViewEvent | `{ registration: {id,status,payment_status,waitlist_position,decision_reason,decided_at}\|null` (the **caller's own** row), `event` (private fields when managing), `agenda[] }` |
| `GET /:id/agenda` | 953-966 | canViewEvent | `{ agenda: [{id,event_id,slug,title,description,starts_at,ends_at,speaker_user_id,speaker_name,speaker_title,location_text,location_url,display_order}] }` (`eventsCommon.ts:106-123`). `location_url` is non-null for admins |
| `GET /:id/roster` | 586-642 | canManage | see below. **Carries names and emails** |
| `GET /:id/export` | 924-950 | canManage | `text/csv`, `attachment; filename="<slug>-roster.csv"`, header `name,email,status,comp,waitlist_position,payment_status,registered_at` (comp → `yes`/`no`), ordered `registered_at ASC`. Has names and emails; **no** amount_cents, source, checked_in_at or decision fields |
| `GET /:id/ics` | 906-921 | canViewEvent | `text/calendar`, `attachment; filename="<slug>.ics"`, `METHOD:PUBLISH` (`eventsCommon.ts:216-228`). A cancelled event still exports normally (no `STATUS:CANCELLED`) |
| also usable | | | `PATCH /:id` (419-484), `POST /:id/submit-review` (489-509), `POST /:id/invitations` (512-583), `POST /:id/registrations/:rid/{approve,decline,promote}` (649-762; return `{registration: SELECT *}`, which includes `payment_intent_id`), `POST /:id/checkin/:code` (864-903; 402 `payment_pending`), `GET /:id/invite-suggestions` (330-395), agenda CRUD (968-1060) |

**Roster response** (`:595-641`):
```json
{ "event": "AdminEvent",
  "registrations": [{ "id":1, "user_id":7, "email":"…", "name":"…", "status":"confirmed", "source":"self",
     "comp":false, "waitlist_position":null, "payment_status":"paid", "amount_cents":4000,
     "checkin_code":"…", "checked_in_at":null, "registered_at":"…", "role":"founder",
     "decision_reason":null, "decided_by_name":null, "decided_at":null }],
  "invitations": [{ "id":1, "invited_user_id":7, "invited_email":"…", "invited_name":"…",
     "source":"manual", "comp":false, "status":"pending", "created_at":"…", "responded_at":null }],
  "counts": { "seats_taken":42, "capacity":60, "waitlisted":6, "confirmed":30, "attended":0 } }
```
- The roster does **not** expose `payment_intent_id` (explicit map at `:610-628`).
- Rows are ordered with waitlisted last, then `waitlist_position`, then `registered_at` (`:602`).

**Event shape** (`shapeEvent(row, {includePrivate:true})`, `services/eventsCommon.ts:70-104`). Every admin route returns this:
```json
{ "id":12, "slug":"…", "host_user_id":7|null, "project_id":null, "type":"meetup", "title":"…",
  "summary":null, "description":null, "cover_url":null, "starts_at":"<TEXT>", "ends_at":null,
  "timezone":"UTC", "location_kind":"virtual", "location_text":null, "location_url":null,
  "capacity":60|null, "waitlist_enabled":true, "approval_required":false, "visibility":"public",
  "status":"pending_review", "featured":false, "price_cents":0, "currency":"usd",
  "created_at":"YYYY-MM-DD HH:MM:SS", "updated_at":"…",
  "admin_published":false, "audience_rules":{} }
```
- **`visibility`:** `public | unlisted | private` (`eventsCommon.ts:18`).
- **`location_kind`:**
  - Writes allow `virtual | physical | hybrid` (`:19`).
  - `isInPersonEvent` also accepts the legacy `in_person` (`:61-63`), and the migration comment says `virtual | in_person | hybrid` (`109_events_core.sql:54`).
  - `location_url` is always returned with `includePrivate` (`:87`).
- **`price_cents`:** `Number(...||0)`. `currency` defaults to `'usd'` (`:94-95`).
- **`audience_rules`:** `parseAudienceRules` returns the raw JSON object as-is (`services/eventAudience.ts:46-53`).
  - Comp keys: `comp_official_partners | comp_invested_lps | comp_investors | comp_host_connections | comp_project_founders` (`:24-30`).
  - A PATCH also stores `mode: 'everyone'|'selected'|'invite_only'`, `roles[]` and `personas[]` (`services/eventOrganiser.ts:7-21`).
- **`featured` / `admin_published`:** INTEGERs coerced with `TRUTHY` (`:52`, `:93`, `:100`).
- **Event `status` values actually written:**
  - `draft`: `events.ts:230`, `admin_events.ts:284`
  - `pending_review`: `events.ts:500`, `:463`
  - `published`: `admin_events.ts:220`, `events.ts:504`
  - `rejected`: `admin_events.ts:262`
  - `cancelled`: `admin_events.ts:320`
  - The migration comment omits `rejected` (`109:61`), and there is no CHECK constraint.
- **Event `type`:** creation and PATCH validate against `EVENT_TYPES` (8 types, `eventsCommon.ts:7-16`). The 12-type list `EVENT_TYPE_IDS` (`services/eventTypes.ts:12-25`, which includes `lp_briefing`, `networking`, `roundtable`, `fireside`) is imported by nothing in the Worker (only a comment at `events.ts:127`). An unknown type falls back to `meetup` (`:216`).
- **Two lifecycle facts the desk depends on:**
  - `submit-review` has no status check (`:498-506`), so a cancelled or rejected event can re-enter `pending_review`.
  - A host PATCH on an approved event (date, venue and so on) keeps it `published`. Only a switch to `visibility='public'` while `admin_published != 1` re-queues it (`:459-466`). The change shows up only in `updated_at` and in `logAdminAction('event_updated', {event_id, fields})` (`:482`).

---

##### 3. Approvals lane: events and "waiting since"

- **Lane definition** (`services/approvalSources.ts:217-227`):
  - `countSql`: `SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM events WHERE status = 'pending_review'`
  - `rowsSql`: `who = COALESCE(NULLIF(u.name,''), u.email, 'account '||e.host_user_id, 'no host')`, `what = 'Event · '||e.title`, `created_at = e.created_at`, oldest first, `LIMIT ?`.
- **"Waiting since" is `events.created_at`, meaning when the draft was created, not when it was submitted.** No submitted timestamp exists (§4). A draft created a month ago and submitted today shows as a month old.
- **Age and band:**
  - `ageHours` appends `Z` to SQL stamps (`:328-335`).
  - `slaFor`: `<24h ok`, `≥24h due_soon`, `≥72h past`, `unknown` when null (`:307-312`; `SLA_DUE_SOON_HOURS = 24` at `services/slaWindow.ts:18`; `SLA_PAST_HOURS = 72` at `:305`).
- **`laneCounts`** (`:453-469`) returns `{key:'events', label:'Events', count:number|null, oldest_at:string|null}`. `null` means unreadable, never zero.
- **`queuePressure`** (`services/branchHome.ts:360-376`) returns `{key, label, count, oldest_age_hours (1 dp), sla}`, sorted unreadable first, then oldest (`:109-114`).
- **`GET /api/admin/studio/glance`** (`routes/admin_studio_glance.ts:30-37`, `requireAdmin`, errors through `mapError`):
  - **HQ:** `approvals = {recorded:true, label, lanes:[…+reason if unreadable], pending_total:number|null, unreadable:string[], no_queue, not_applicable}` (`services/studioGlance.ts:199-211`, `:308`).
  - **Branch:** `approvals = {recorded:true, lanes: queue_pressure}` (`:374`).
  - **This gives counts and ages only, no rows.**
- **Rows on a branch only:** `GET /api/branch/approvals` (`routes/branch_approvals.ts:51-98`; `requireAdmin` + `requireBranchTier`; per-lane `limit` 1..200, default 100).
  - Items: `{lane:'events', lane_label:'Events', id, who, what, created_at, age_hours, sla, assignee?}` (`approvalSources.ts:283-294`, `:361-416`).
  - Payload also carries `decides:false`.
  - **On HQ the only list of pending events is `GET /api/admin/events?status=pending_review`, which sorts newest first** (`admin_events.ts:106`). The canvas's "Sort: Waiting longest" (`Events Console Page.dc.html:328`) has to be sorted client-side.
- **Frontend:**
  - `HeldApprovals.jsx:39-51` (`LaneState`) and `:93` (events row).
  - `adminStudioOverview.js:63-68` (`ageText`: ≥48h → days, otherwise hours) and `:376` (`events: '/admin/events'`).

---

##### 4. Tables (`cloudflare-worker/sql/migrations`)

- **`events`** (`109_events_core.sql:41-69`): `id, slug UNIQUE, host_user_id, project_id, type, title, summary, description, cover_url, starts_at, ends_at, timezone, location_kind, location_text, location_url, capacity, waitlist_enabled, approval_required, visibility, status, admin_published, featured, audience_rules_json, price_cents, currency, created_at, updated_at`. No later ALTER.
- **`event_invitations`** (`109:88-102`): `id, event_id, token UNIQUE, invited_user_id, invited_email, invited_name, source ('manual'|auto_*), comp, status (pending|accepted|declined|revoked), personal_message, invited_by, created_at, responded_at`.
- **`event_registrations`** (`109:119-138`, plus `392_event_organiser.sql:2-4`):
  - Columns: `id, event_id, user_id, email, name, status, source, comp, invitation_id, waitlist_position, payment_status, payment_intent_id, amount_cents, answers_json, registered_at, updated_at`, then **392 adds** `decision_reason, decided_by_user_id, decided_at`. Uniques: `(event_id,user_id)` and `(event_id,email)`.
  - `status` per comment: `registered|waitlisted|confirmed|attended|cancelled|declined` (`:125`).
  - `source` values actually written: `self` (`events.ts:827`), `public` (`events_public.ts:173`), `invite` (`events_public.ts:249`). The comment's `comp`/`admin` are never written.
  - `payment_status` per comment: `none|pending|paid|refunded` (`:130`). Only `none` and `pending` (`events.ts:1130`) and `paid` (`eventTickets.ts:122`) are ever written. **`refunded` is never written anywhere** (grep returned nothing).
  - `amount_cents` is set to the price for **pending** rows too (`events.ts:1131`), so a "paid total" must filter on `payment_status='paid'`.
- **`event_checkins`** (`109:149-158`): `id, event_id, registration_id, code UNIQUE, checked_in_at, checked_in_by, created_at`.
- **`event_agenda_items`** (`109:169-184` + `392:5-6` `location_text, location_url`).
- **`event_notifications`** (`111_event_notifications.sql:18-25`): `id, event_id, principal_key, kind, created_at`. This is the reminder ledger.
- **Notes:**
  - `services/eventsSchema.ts:16-147` mirrors these, including the 392 columns (`:90-92`, `:125-126`).
  - `sql/schema_baseline.sql` (extracted 2026-09-08, `:1`) has these tables at `:1852-1954` **without** the 392 columns.

| Column | Exists? |
|---|---|
| `submitted_at` | **No**, on any event table (grep of migrations and the event route/service files found 0) |
| `approved_at` | **No** |
| `review_note` | **No**. The reject reason lives only in `admin_audit_log.filters_json` and the notification body |
| `changed_after_approval_at` | **No**. Not in any migration |
| `payment_status`, `amount_cents`, `payment_intent_id` | Yes, `event_registrations` (`109:130-132`) |
| `source`, `comp` | Yes, on both `event_registrations` (`:126-127`) and `event_invitations` (`:95-96`) |
| `checked_in_at` | Yes, `event_checkins` only (`109:154`) |
| `registered_at` | Yes, `event_registrations` (`109:134`) |

The only reconstructible stand-ins: the submit time is `admin_audit_log` action `event_submitted` (`events.ts:507`, timestamp in `exported_at`), and edits are action `event_updated` with `fields` (`:482`). No route reads either.

---

##### 5. Tickets and refunds: what a cancel dialog must say

- **Paying for a ticket** (`services/eventTickets.ts`):
  - `createEventTicketPaymentIntent(env, event, registration, payer)` (`:43-85`) creates a platform PaymentIntent with `metadata[kind]=event_ticket` plus `event_id`, `registration_id`, `user_id` (`:64-67`) and idempotency key `pi:event_ticket:<regId>` (`:72`).
  - It stores `payment_intent_id` on the row (`:75-77`).
  - The webhook calls `fulfillEventTicket` (`billing.ts:1912-1916`). That sets `payment_status='paid'`, sets `status` to confirmed only if the seat is still held, and keeps a cancelled or declined row paid (`:114-130`).
- **Cancel touches nothing on the money side.** `admin_events.ts:319-321` updates only `events`. No refund is made and no `payment_status` changes.
  - The Stripe `charge.refunded` webhook only feeds `aiCreditReversals.reverseRefund` (`billing.ts:2003-2007`).
  - Event registrations are never marked refunded. This matches the canvas line "A refunded ticket is not marked here" (`Events Console Page.dc.html:373`).
- **Refund route:** `POST /api/admin/billing/refund` (`routes/admin_billing.ts:201-380`).
  - **Guard:** `requireSuperAdminWriteBar` = `requireFactor('totp')` + `requireStepUp` + `requireSuperAdmin` (`auth.ts:1054-1058`). That means **super admin only, HQ only** (`'HQ only'` on a branch, `auth.ts:694`). A plain admin cannot refund.
  - **Body:**
    - exactly one of `payment_intent` / `charge` (otherwise 400 `invalid_target`, `:214-216`)
    - `reason` ≥ 12 characters (otherwise 400 `reason_required`; `REFUND_REASON_MIN` at `:43`, mirrored in `frontend/src/lib/refundReason.js:9`)
    - optional `amount` (a positive integer, otherwise 400 `invalid_amount`)
    - optional `stripe_reason`, `target_user_id`, `idempotency_key`, `override_policy`
  - **Policy:** `kind:'event_ticket'` gets the default allowed path (`:175`).
  - **Response:** `{ok, refund:{id,status,amount,currency,payment_intent,charge}, policy:{kind,allowed,reason,overridden,note}, clawback}` (`:361-379`). Stripe errors return 400/502 `stripe_error` (`:284-297`).
  - **Gap:** the refund needs a PaymentIntent or charge id. The roster does not expose `payment_intent_id` (`events.ts:610-628`), so a desk "refund" handoff cannot name the payment from any current read.
- **What the cancel dialog can truthfully state:**
  - Paid tickets are not refunded automatically.
  - Only a super admin can refund them, one payment at a time, in HQ Billing.
  - Registrants with an account get an **in-app** notice. Waitlisted people are included. Email-only registrants are not notified.
  - No email is sent. There is no field for a note to registrants (the canvas has "NOTE TO REGISTRANTS · OPTIONAL" at `:400`).
  - Calendars already downloaded are not updated (public feed predicate at `events_public.ts:30`).
  - Counting the paid tickets needs a roster read (`payment_status='paid'`, sum of `amount_cents`).

---

##### 6. Frontend clients (`frontend/src/lib/api.js`)

- **`adminEvents`** (`:5659-5677`):
  - `list({status, limit=50, offset=0}={})`
  - `get(id)`
  - `approve(id)`
  - `reject(id, reason)`
  - `unpublish(id)`
  - `feature(id, featured)`
  - `cancel(id)`: sends body `{}`
  - `setCapacity(id, capacity)`
  - `analytics()`
- **`events`** (`:5600-5628`):
  - `mine()`, `get(id)`, `create(payload)`, `update(id, patch)`, `submitReview(id)`
  - `eligibility(id)`, `register(id, answers)`, `cancelRegistration(id)`
  - `invite(id, {user_ids, emails, message}={})`, `roster(id)`
  - `approveRegistration(id, rid)`, `declineRegistration(id, rid, reason)`, `promoteRegistration(id, rid)`, `checkin(id, code)`
  - `icsUrl(id)` → `'/api/events/<id>/ics'` and `exportUrl(id)` → `'/api/events/<id>/export'`. These are plain URLs; cookie auth makes `<a href>` work (`credentials:'include'` at `:618`; used this way in `EventManagePage.jsx:92`).
  - `agenda(id)`, `addAgendaItem(id, item)`, `updateAgendaItem(id, aid, patch)`, `reorderAgenda(id, item_ids)`, `deleteAgendaItem(id, aid)`
  - **No client exists** for `GET /:id/invite-suggestions` or `GET /suggested`.
- **`eventsPublic`** (`:5631-5656`): `list({limit,offset,type,from,to,q,past})`, `read(slug)`, `register(slug,{name,email,turnstile_token,answers})`, `invite(token)`, `respondInvite(token,{action,turnstile_token,name})`, `icsUrl(slug?)`.
- **On the `api` object** (`export const api = {` at `:832`):
  - `api.adminStudioGlance()` (`:3652`)
  - `api.branchApprovals()` (`:3635`)
  - `api.adminBillingRefund(body)` (`:1982-1983`)
  - `api.adminBillingRefunds()` (`:1994`)
- **Current consumers:**
  - `pages/admin/AdminEventsPage.jsx`: `:90` analytics, `:128` reject, `:147` setCapacity, `:236` approve, `:311` feature, `:320` unpublish, `:332` cancel.
  - Route: `App.jsx:2837`.

---

##### 7. Canvas needs with no Worker source today
| Canvas | Ref (`Events Console Page.dc.html`) | Status |
|---|---|---|
| "Created · Submitted" dates, "Submitted again on" | `:336`, `:340` | No `submitted_at` column, no history reader |
| "Changed after approval" attention item | `:302` | No column and no detection |
| Weekly "Registrations and check-ins" series | `:293` | No aggregate route (raw `registered_at` and `checked_in_at` exist) |
| "Paid tickets [$…] · payment pending" totals | `:319` | No aggregate. Per-event roster only |
| Cancel "note to registrants", "[n] paid tickets ([$…])" | `:400` | Cancel takes no body. Paid count needs a roster read |
| CSV "counts only, no attendee names" | `:357` | No such export. `/export` includes names and emails |
| Review notes and decision history | — | Audit rows exist, but nothing reads them |

Scratch directory `/tmp/claude-0/-home-user-StudioOS/15af0b5e-433b-5a64-8976-3264907f6945/scratchpad/evmap/` was created and left unused. No repo files were changed.

## Part C — the page today and the admin shell

### Events Console (#2368): the admin page today and the admin shell around it

Tree: branch `claude/spinout-lab-workspace-wuyyqd`, HEAD `4d79754`.

---

#### 1. `frontend/src/pages/admin/AdminEventsPage.jsx` (436 lines)

##### 1.1 Route, guard and frame
| Item | Fact | Cite |
|---|---|---|
| Lazy import | `const AdminEventsPage = lazy(() => import('./pages/admin/AdminEventsPage'));` | `frontend/src/App.jsx:131` |
| Route | `<Route path="/admin/events" element={guard(['admin'], <AdminEventsPage />)} />`. No `hqOnly`. | `App.jsx:2837` |
| `guard` | `(roles, component) => <RequireAuth {...authProps}><RoleGuard … allowedRoles={roles} …>{component}</RoleGuard></RequireAuth>` | `App.jsx:2219-2225` |
| RoleGuard | When the role is not allowed it returns `<Navigate to={defaultPath} replace />`. So a non-admin never sees a page here, and EV16 "No permission" is unreachable unless the guard changes. | `App.jsx:1819-1834` |
| `hqOnly` | `isSuperAdminUser(user) ? component : <SuperAdminOnlyNotice />`. Events does not use it. | `App.jsx:2304-2306` |
| Default export | `export default function AdminEventsPage() { return (<AdminBoardFrame workspace="Events" note="Eadwyn reads the events listed here. An event is approved or published only when you do it." data-testid="admin-board-events"><AdminEventsPageBody /></AdminBoardFrame>); }` | `AdminEventsPage.jsx:429-436` |
| AdminBoardFrame | Signature `({ workspace, note, children, 'data-testid' })`. A Super Admin gets `<WorkerRail … role="super_admin" data-testid="hq-board-rail"/>`. `user.role==='admin'` gets `role="admin" data-testid="admin-board-rail"`. Anyone else gets no rail. The result is `<RailFrame rail={rail} data-testid={testId}>`. | `pages/admin/AdminBoardFrame.jsx:25-34` |
| Canvas note | The canvas spine uses the same sentence as the frame's note. | `design/incoming/Events Console Page.dc.html:205` |

##### 1.2 What it calls
Client: `adminEvents` in `frontend/src/lib/api.js:5659-5677`, inline in `api.js` and not a `lib/api/` module.

| Page call | Client method | Worker route |
|---|---|---|
| load, `:90` | `analytics: () => request('/admin/events/analytics')` | `GET /analytics`, `routes/admin_events.ts:114-194` |
| Approve, `:236` | `approve(id)` POST `{}` | `:208`, returns `{ event }` |
| Reject, `:128` | `reject(id, reason)` sends `{ reason }` | `:252`, reason cut to 1000 chars |
| Unpublish, `:320` | `unpublish(id)` | `:276` |
| Feature, `:311` | `feature(id, featured)` sends `{ featured }` | `:291` |
| Cancel, `:332` | `cancel(id)` | `:312` |
| Capacity, `:147` | `setCapacity(id, capacity)` sends `{ capacity }` (null means unlimited) | `:341-387`. Returns `{ event, promoted: <number> }`; 400 `invalid_capacity` |
| not used | `list({status,limit,offset})`, `get(id)` | `GET /` `:95-109` returns `{ events: shapeEvent[] }`; `GET /:id` `:197` returns `{ event }` |

- **Mount:** `app.route('/api/admin/events', adminEventsRoutes)` at `cloudflare-worker/src/index.ts:999`, imported at `:310`.
- **Gate:** every handler uses `requireAdmin` (`admin_events.ts:31-38`).

**`GET /api/admin/events/analytics` response** (`admin_events.ts:120-193`):
```
{ summary: { total_events, published, pending_review, draft, cancelled,
             total_registrations, total_attended, total_waitlisted },
  events: [{ id, slug, title, status, starts_at, featured:boolean, capacity:number|null,
             registrations, attended, waitlisted, cancelled,
             capacity_util:number|null, conversion:number|null }] }   // ORDER BY starts_at DESC LIMIT 200
```
**Honesty gap in the read.** Both blocks swallow their own failure and still answer 200. On a failed summary the counts stay zero (`:151-153`); on a failed rows query the list is `[]` (`:189-191`). The page cannot tell "could not be read" from a real zero.

##### 1.3 The UI parts (line ranges)
- **State, `:77-85`:** `summary`, `rows`, `loading`, `busyId`, `rejectFor`/`rejectReason`, `capacityFor`/`capacityValue`, and `useToast()` from `components/useToast`.
- **Header, `:156-173`:** h1 "Events" with a `CalendarDays` icon, one sentence under it, and a refresh button. There is no crumb, scope chip or tabs. The body wrapper is `max-w-6xl mx-auto px-6 py-8` (`:154`).
- **Tiles, `:182-187`:** a local `SummaryCard` (`:58-74`), not `ui/Stat`. Published, Pending review, Registrations and Attended each read `summary?.x ?? 0`.
- **Chart, `:190-212`:** recharts `BarChart`. Up to 10 published or pending rows, bar = `registrations`. A bar turns red when `registrations >= capacity`. Hex colours are hard-coded (`#7c3aed`, `#dc2626`, `#e5e7eb`, `#9ca3af`) with no dark pair; they are props, not `className`, so `check-dark-mode` cannot see them.
- **Review cards, `:215-254`:** `rows.filter(status==='pending_review')`, each with Approve and Reject.
- **Table, `:257-348`:** columns Event, Status, Reg., Cap. (`?? '∞'`), Util., Conv. (`pct()` gives `'—'` for null, `:36-38`), Actions (capacity, feature toggle, Unpublish when published, Cancel through `window.confirm`).
- **Dialogs, `:353-386` and `:389-424`:** hand-rolled `fixed inset-0 z-50` overlays. No `role="dialog"`, no focus trap, not `Lightbox`.
- **Defects today.** When load fails (`:93-95`) it only toasts. The tiles then show `0`, and the table shows "No events yet." (`:262-263`). The `'—'` and `0` used for unknown values break the `ui/Honesty.jsx:21-23` rule.

##### 1.4 Tests that pin it
No test reads `AdminEventsPage.jsx` content apart from the frame shape. The tests that pin it by route or board:

| Test | What it pins |
|---|---|
| `frontend/test/rail_options_admin_d774.test.mjs:105-114` | S15 is in the framed list at `:107`. Every file in S15's `files` must have exactly one `<AdminBoardFrame workspace="Events"`, and must match `export default function \w+\(\) \{\s*return \(\s*<AdminBoardFrame\b`. |
| same file, `:93-103` | S25 (Community · Events, an alias) has the same `files`, `rail` and route as S15, and S15 comes first. |
| same file, `:209-226` and `:228-230` | Every `type="file"`, `.draft(` or `dd.generateReport(` in board files must be listed, and `ADMIN_OPTIONS` must stay `[]`. |
| `held_admin_shell_d286.test.mjs:193,216-232` | Approvals lane 11 is exactly `<Link to="/admin/events">/admin/events</Link>`. |
| same file, `:238-244` | The Community doors are exactly `['/admin/events','/admin/jobs','/admin/circles','/admin?tab=network-profiles','/admin?tab=wellbeing']`. |
| same file, `:297-306` | `/admin/events` has a literal door. |
| same file, `:327` | `adminRowFor('/admin/events','') === null`. |
| same file, `:75-100` | `match` entries are found by `routeLine()` in **App.jsx only** (`:47,67,94`). |
| `admin_placement_h35.test.mjs:49` | `/admin/events` is a legacy row. |
| same file, `:154-171` | Nothing outside the legacy set may be placed. |
| same file, `:173-188` | Placed routes must be registered. |
| `admin_route_reachability.test.mjs:425-460` | Every `/admin/*` route is reachable (breadth-first walk), with no dangling or ambiguous `/admin` links. |
| `rail_pages_d768.test.mjs:61-80` | Every rail route has a page key for each role its guard admits. |
| `airail_render_admin_d781.test.mjs` with `_airailRender.mjs` | `/admin/events` renders as the Admin member with exactly one rail keyed `Admin · Approvals · Events`, in the 503 or the `{}` state. `/admin/events` is not in `RENDER_NOT_YET` (`_airailRender.mjs:154-180`), so it must pass. |
| `admin_studio_overview.test.mjs:345` | `href="/admin/events"` on the Studio overview, through `COMMUNITY_CONSOLES`. |
| `hq_studio_figures_d555.test.mjs:81-85` | `LANE_CONSOLES.events` (`'/admin/events'`) must appear as `to="…"` on HeldApprovals. |
| `branch_programs_s4.test.mjs:226-245` | `COMMUNITY_CONSOLES` has 5 entries and each `to` is registered. |
| same file, `:247-267` | `routes/admin_events.ts` must not contain `requireHqAuthoring`, `requireSuperAdmin`, `requireSuperAdminWriteBar`, `HQ_ONLY` or `HQ_AUTHORING_ONLY`. This constrains any new Worker route added to that file. |

---

#### 2. Conventions from recently integrated admin canvases

##### 2.1 File layout
| Canvas | Files | Rail | Board row |
|---|---|---|---|
| Admin Insights, D893 (#2366/#2660) | `pages/admin/insights/`: `AdminInsights.jsx` (page), `insightsModel.js` (pure), `InsightsCharts.jsx` (SVG), `HeldInsightsRedirect.jsx`, `README.md` (`insights/README.md:1-30`) | Its own `<WorkerRail workspace="Insights" role="admin" …/>` inside `<RailFrame rail={rail} data-testid="admin-insights">` (`AdminInsights.jsx:313-327`) | S38 lists all three files with `rail: 'pages/admin/insights/AdminInsights.jsx'` (`railOptions/admin.js:80`) |
| Licences, D795/D800/D804 | `subsidiary/MyLicencePage.jsx`, `LicenceFrame.jsx` (header and tab row), `lib/licencePage.js` (`LICENCE_TABS`, `tabFor`), `subsidiary/licence/*Tab.jsx` and `licenceTabsModel.js` | `AdminBoardFrame workspace="Licences"` (`MyLicencePage.jsx:808-813`) | S39 `files: ['pages/subsidiary/MyLicencePage.jsx']`, `rail: FRAME` (`railOptions/admin.js:81`). **Only the frame file is listed**, because every listed file must contain the frame (§1.4). |
| Fund admin, D714 | `fundAdmin/FundAdminConsole.jsx`, `fundAdminModel.js`, `parts.jsx`, `README.md` | | |

Decision text: `documentation/architecture/decisions/D893.md:1-162` and `D804.md:7-20`.

**Two ways to frame the redesign:**
- **(a) Keep `AdminBoardFrame`.** S15 and S25 `files` list only the frame-bearing page file. No test edits.
- **(b) Insights-style own `RailFrame` plus `WorkerRail`.** S15 and S25 get `rail: <page file>` and may list the model and chart files. The framed-ids list at `rail_options_admin_d774.test.mjs:107` must then drop `'S15'`.

##### 2.2 Header
- **Insights:** h1 only, `"Insights"` (`AdminInsights.jsx:330`), a sentence (`:331`), then a scope chip.
  - Chip markup: `<span title={SCOPE_TITLE} className="… rounded-full border border-axal-hairline … font-mono text-[11.5px] …" data-testid="insights-scope-chip">{SCOPE_LABEL}</span>` (`:332`).
  - The test refuses "Admin Console" (`admin_insights_d893.test.mjs:359`).
- **"Admin Console"** is only `AdminPage.jsx:215`'s h1.
- **Scope strings already exported:**
  - `HELD_SCOPE = 'HQ-held accounts · axal.vc'` (`pages/admin/HeldZone.jsx:30`)
  - `SCOPE_LABEL` (same string), `SCOPE_TITLE = 'No subsidiary is deployed yet, so these are the accounts HQ holds directly.'` and `SCOPE_NOTE` (`insights/insightsModel.js:26-28`). The canvas `title` is identical (`Events Console Page.dc.html:59`).
- **Top-bar badge:** the shell already draws `HQ-held · axal.vc` (`App.jsx:1323-1327`, pinned by `held_admin_shell_d286.test.mjs:334-345`). The canvas draws it too (`dc.html:461`).

##### 2.3 Tabs with per-tab addresses (Licences pattern)
- **Routes:** `App.jsx:2713-2719`, one `guard(['admin'], <MyLicencePage />)` per sub-path.
- **Tab from path:** the body reads its tab with `tabFor(useLocation().pathname)` (`MyLicencePage.jsx:432-433`; `lib/licencePage.js:24-39`).
- **Strip:** `NavLink to=… end`, written out literally, not mapped (`LicenceFrame.jsx:50-66`, `:75-88`). The reason, in its comment: the reachability walk counts only literal `to="…"`.
- **Canvas tabs:** `[['Overview','/admin/events'],['Review','/admin/events/review','[3]'],['All events','/admin/events/all'],['Calendar','/admin/events/calendar']]` (`dc.html:449`).
- **Event pages:** EV7 opens one event, with crumb `‹ All events` → `/admin/events/all` (`:408`). EV17c (phone review) has crumb `‹ Review` → `/admin/events/review` (`:442`).

##### 2.4 Breadcrumbs
- **No shared page-crumb component exists** in admin pages. The nearest is `contracts/TemplateEditor.jsx:366-370` (an inline `' › '`). Insights has no page crumb.
- **The rail draws its own trail** from the page key: `section || workspace`, then module, then record (`ui/WorkerRail.jsx:491-494`; `ui/railCrumbs.js:61,83`). Records use `useRecordCrumb(title, type, id)` (`pages/admin/useRecordCrumb.js:11-17`, with callers listed at its use sites).
- **CONFLICT 1, dead link.** The canvas crumb is `'Community › Events'` with `crumbHref = '/admin/community'` (`dc.html:405`). That is **not a route**. The Community landing is `/admin/held/community` (`App.jsx:2726`). A `to="/admin/community"` would be flagged as a dangling link (`admin_route_reachability.test.mjs:454-460`).
- **CONFLICT 2, Approvals vs Community.** The page key is `Admin · Approvals · Events` (`railPages.js:276`). Community is an alias to it (`railPages.js:388`; `railOptions/admin.js:67`, "Approvals is listed first"). So the rail trail reads "Approvals › Events" while the canvas crumb reads "Community › Events" and the Community row lights (`sidebarConfig.js:230`). Making Community the owner fails `rail_options_admin_d774.test.mjs:93-103`.

##### 2.5 Honesty primitives
- **`Unrecorded({ children='Not recorded', reason })`** (`ui/Honesty.jsx:37-51`).
- **`Unreadable({ what, claim, onRetry })`:** renders `"{what} could not be read. {claim}"` plus Retry; `claim` is meant to be required (`:62-73`). Both are exported from `ui/index.js:87`.
- **String helpers:** `NOT_RECORDED='Not recorded'`, `text(v, fallback)`, `titleCase(v)` (`lib/absence.js:46,55-57,66-71`; re-exported at `ui/index.js:93`). Redefining them is refused (`absence_helpers_single_definition.test.mjs`).
- **The rule:** never a zero or a bare dash for an unknown value (`Honesty.jsx:21-23`).
- **D893's block states:** `ready | loading | unreadable | unrecorded`, with the Worker's per-block shape `{available:false, unreadable:true, reason}` or `{recorded:false, reason}` (`D893.md:83-88`). The page renders them itself: Tile at `AdminInsights.jsx:95-120`, Block at `:122-184`.
- **`Stat` caution:** `ui/Stat.jsx:27-62` renders `value ?? '—'` (`:51`), which is a bare dash. Pass Unrecorded or Unreadable instead of null.
- **CONFLICT 3, the EV12 dash.** The caption reads "the week with no check-ins shows a dash" (Boards grid EV12). A dash for a measured week breaks `Honesty.jsx:21-23`.

##### 2.6 Charts and colour tokens
- **recharts** is imported by 15 files in `frontend/src`. Only `branch_home_s1.test.mjs` reads it in tests.
- **`InsightsCharts.jsx` (D893)** exports `HBars, Columns, WeekLine, Bar100, Donut, Legend, ChartTable, Chart` (`:40-339`).
  - Palette: violet, sky, amber, emerald, muted. Only violet changes in dark mode: `dark:fill-[#a78bfa]` and `dark:stroke-[#a78bfa]` (`:12-33`).
  - Dark mode has the same rule in D893.md:57 and Boards EV2 ("Violet becomes #a78bfa; the other series keep their colour").
- **`components/WeeklyLineChart.jsx`** takes `{ weeks, series[{key, values, colorClass}], median, ariaLabel, emptyNote, testId }` (`:35-42`). Geometry comes from `lib/weeklyChart.js:69`. A gap is never drawn, and the current week's point is hollow (`:9-27`).
- **No chart or series tokens exist in `frontend/src/index.css`.** There is no `chart`/`series` match. D893 used arbitrary hex classes.
- **Declared `axal-*` colours:** violet, violet-deep, lavender, amber, amber-deep, lavender-edge, positive, destructive, destructive-tint, destructive-edge, ink, hairline, faint, muted, ground (`index.css:50-75`). A new undeclared `axal-*` token fails `ui_design_tokens.test.mjs:93-127`.

##### 2.7 Dialogs and phone
- **`Lightbox`:** `({ label, onClose, onEscape, children, eyebrow, title, sub, footer, initialFocus, returnFocusTo, width=560, size='fit', testId='lightbox', focusKey, pageBelow, bar, pageClass })` (`ui/Lightbox.jsx:69-71`). It provides dialog role, focus trap and inert background, and goes full-screen on a phone.
- **Footer button classes:** `ActionSheet` exports `primary`, `ghost` and `danger` (`ui/ActionSheet.jsx:30-32,46-48`).
- **`PhoneSheet({ label, title, onClose, opener, … })`** (`ui/phone/PhoneSheet.jsx:19`). Insights uses it for Filters (`AdminInsights.jsx:407-415`).
- **`usePhoneWidth()`** defaults to `PHONE_QUERY = '(max-width: 1023px)'` (`ui/phone/usePhoneWidth.js:10`; `workspaces/lens.jsx:30`). Insights switches the grid to `grid-cols-2` on a phone (`:377`).
- **The rail column** is hidden below 1024px, never unmounted (`rail_frame_d556.test.mjs:249`).

##### 2.8 Dark mode
- `scripts/check-dark-mode.mjs` scans `frontend/src/{pages,components}` `.jsx/.tsx` (`:31-34`).
- Each of `bg-white`, `text-gray-700/800/900`, `border-gray-200/300` in a **literal** `className` must have a `dark:` pair of the same family (`scripts/codemod-dark-mode.mjs:49-56`).
- Template literals containing `${…}` and constant strings are not scanned (`CLASSNAME_RE`, `:35`). The per-line opt-out is `dark-mode-exempt` (`:49-56`).

---

#### 3. Every place that names `/admin/events`, and what each needs for `/review`, `/all`, `/calendar`, `/:id`

| Place | Today | Needed for sub-routes |
|---|---|---|
| `App.jsx:2837` | single route | Add `/admin/events/review`, `/all`, `/calendar` and `/admin/events/:id`, each `guard(['admin'], <AdminEventsPage />)` as in D800. **Keep them in App.jsx at 6-space indent.** `held_admin_shell_d286` `routeLine` reads App.jsx only (`:47,67`), and the reachability parser splits on `'\n      <Route'` (`admin_route_reachability.test.mjs:81`). Static paths outrank `:id` in React Router (`route_namespace_policy.test.mjs` header). |
| `sidebarConfig.js:230` | Community row `match: ['/admin/events', …]` | **Nothing.** Matching is by prefix (`ui/SidebarNav.jsx:211-213`; `lib/mobileTabs.js:102-103`; generator `scripts/build-profile-routing.mjs:231`). Branch shell: `/branch/community` has no `match` (`:180`), so on a branch no row lights; unchanged. |
| `lib/railPages.js:276` | `own('/admin/events', key(AD,'Approvals','Events'))` | **Nothing for keys.** "A route matches itself and every path below it" (`:12-13`; `score()` `:415-423`). Optional, Licences-style: add `alias('/admin/events/review'…)`, `/all` and `/calendar` with a why longer than 10 characters (`rail_pages_d768.test.mjs:82-97`) so the D781 render draws each (D804.md:18). Do **not** alias `/:id`. **Super Admin:** no SUPER entry exists, so `pageFor` returns null for the HQ rail on these paths (`:483-490`). This is not tested; adding one would be an off-canvas key. |
| `RAIL_BOARD_ALIASES` `railPages.js:388` | Community · Events maps to Approvals · Events | Nothing. |
| `lib/railOptions/admin.js:57,67` | S15 and S25 with `files:['pages/admin/AdminEventsPage.jsx']`, `rail: FRAME` | If the page file moves or renames, update **both** rows identically. See §2.1 for (a) and (b). |
| `lib/adminPlacement.js:66-67` | `row('Event Admin','/admin/events', admin('Community','card link'), false, {also:[admin('Approvals','lane')]})` | **Do not add sub-routes.** "Nothing outside the legacy set is placed" (`admin_placement_h35.test.mjs:154-171`). |
| `lib/hqStrips.js:110-116` | `adminRowFor` returns null off `/admin` | Nothing (pinned at `held_admin_shell_d286.test.mjs:327`). No HQ strip names events. |
| `pages/admin/HeldCommunity.jsx:71-74` | `<Link to="/admin/events">Open events</Link>` plus the pending Figure | **Do not add doors.** Exactly 5 are pinned (`held_admin_shell_d286.test.mjs:131,238-244`). |
| `pages/admin/HeldApprovals.jsx:93` | lane 11 `to="/admin/events"` | **Keep it.** Pinned by value (`held_admin_shell_d286.test.mjs:193`). A `/review` target fails `laned.has(route)` (`:221-231`) and `hq_studio_figures_d555.test.mjs:81-85`. |
| `pages/branch/BranchCommunity.jsx:68-77` | `COMMUNITY_CONSOLES[0] = {key:'events', to:'/admin/events', worker:'admin_events.ts', scope:'Moderation and analytics', what:…}`. Its "does not author an event" wording conflicts with the canvas's "New studio event". | Keep `to`. Update `what` only if studio authoring ships. New Worker routes in `admin_events.ts` must avoid HQ gates (`branch_programs_s4.test.mjs:247-267`). |
| `pages/branch/BranchApprovals.jsx:620` | `events: { to:'/admin/events', label:'Events console' }` | Optional. |
| `pages/admin/adminStudioOverview.js:376` | `LANE_CONSOLES.events` | Keep. |
| `pages/admin/AdminStudioOverview.jsx:283` | maps `COMMUNITY_CONSOLES` | Keep (`admin_studio_overview.test.mjs:345`). |
| `pages/docs/sections/admin.js:137-160,186`; `guidePlacement.js:160` | "Events operations" runbook | Optional copy. Its pitfall says no `wrangler.toml` change is needed for a new page path (`admin.js:155`). |
| `scripts/build-profile-routing.mjs` and `ROUTE_MAP.md` | **No row** names `/admin/events` | Add a canvas row to the table at `ROUTE_MAP.md:856` (like Insights at `:886`), then run `node scripts/build-profile-routing.mjs` and set `recs.length` 148 → 149 with a dated comment (`profile_routing_fresh.test.mjs:100-102`). **Put `/admin/events` first, in backticks, in the "Live route today" cell.** Insights left it out, so it was generated as `/admin/held/insights` with "no nav entry" (`PROFILE_ROUTING.md:180,200`; routes come from `routesIn(rec.live)` at `:281-291`). |
| `ROUTE_MAP.md:786` | "Admin · Subsidiary" row names `admin_events.ts` | Nothing. |
| `design/incoming/README.md:149-157` | "Landed 2026-10-24" note, waiting on S1's grade | On graduation, move both files to `design/canvases/integrated/` and update the counts (`design/incoming/README.md:59`; `design/canvases/README.md:8`, 102 → 104). Both files already start with `<script src="./support.js"`, have no `@font-face` or branding, and the Boards file has `dc-import name="Events Console Page"`, as D893's test requires (`admin_insights_d893.test.mjs:434-442`). |
| `admin_route_reachability.test.mjs` | breadth-first walk from sidebar rows | Each new path needs a literal door in a reachable file: tab strip `to="/admin/events/review"` etc., and `/:id` through `to={`/admin/events/${id}`}` or `` navigate(`/admin/events/${id}`) ``. Door patterns are at `:151-190`. `toRoute` handles the template head `'/admin/events/'` as one extra segment; the only candidate is `/admin/events/:id`, so it is not ambiguous (`:194-222`). Doors in **other** files count only if `COMPOSED` (`:269-282`) credits them, and the host must import them as `from './X'` (`:619-633`). Do not import another routed page component, such as `EventEditorPage`; that trips the `SECOND_MOUNTS` parity check (`:599-614`). |

---

#### 4. Member event pages the desk links to (addresses and guards only)

`M5 = guard(['admin','founder','partner','investor','advisor'], …)`

| Address | Element and guard | Cite |
|---|---|---|
| `/events/new` | `EventEditorPage`, M5 | `App.jsx:3178` (lazy `:289`) |
| `/events/:id/edit` | `EventEditorPage`, M5 | `:3179` |
| `/events/:id/manage` and `/manage/registrations`, `/manage/agenda` | `EventManagePage`, M5 | `:3180-3182` (lazy `:290`) |
| `/my/events` | `MyEventsPage`, M5 | `:3177` |
| `/calendar` | `CalendarPage`, M5 | `:3175` |
| `/events` (public list) | `PublicEventsPage`, no guard | `:3575` |
| `/events/:slug` (public page, **slug not id**; analytics rows carry `slug`, `admin_events.ts:175`) | `PublicEventDetailPage`, no guard | `:3576` |
| `/invite/:token` | `InviteRsvpPage`, no guard | `:3579` |
| ICS and roster CSV | `events.icsUrl(id)` gives `/api/events/${id}/ics`; `exportUrl(id)` gives `/api/events/${id}/export`; `eventsPublic.icsUrl(slug)` | `api.js:5620-5621,5655` |

Worker side: `canManage(event,user)` returns `user.role === 'admin' || host`. So an admin can open and act on any event's edit or manage page (`routes/events.ts:75-77`).

---

#### 5. Checklist for passing first time

1. **Rail framing** (`rail_frame_d556.test.mjs:91-116`). Any file with `<WorkerRail` must also have `<RailFrame … rail=` in the same file. With `AdminBoardFrame`, the page mounts no rail itself.
2. **D774 board rows** (`rail_options_admin_d774.test.mjs`):
   - every `files` entry exists, and the `rail` file mounts a self-closing `<WorkerRail …/>` (`:73-90`);
   - with FRAME, each listed file has exactly one `<AdminBoardFrame workspace="Events"`, as a string literal (regex `:47-48`);
   - the default export takes no props and returns the frame directly (`:112`), so hooks go in the body;
   - S15 and S25 stay identical (`:93-103`);
   - no `type="file"`, `.draft(` or `dd.generateReport(` without a listed row (`:209-226`);
   - `ADMIN_OPTIONS` stays `[]`, so no control may run a model (`:228-230`).
3. **D781 render** (`_airailRender.mjs`). `/admin/events` (and any alias) must draw exactly one rail with its key in the 503 or `{}` state. A body that throws on `{}` loses the rail, so the model must tolerate a missing `summary` or `events`.
4. **D768 keys** (`rail_pages_d768.test.mjs:61-97`). The prefix covers it; aliases need a why and an owner key.
5. **Reachability.** Literal doors as in §3.
6. **Placement and held shell.** Do not touch `ADMIN_PLACEMENT`, the HeldCommunity doors or lane 11 (§3).
7. **Absence and Honesty.** Use `Unreadable` with `what` and `claim`, `Unrecorded` with `reason`, and import `text`/`NOT_RECORDED` from `lib/absence` or `ui`. Never `?? 0` or `'—'` for an unknown value.
8. **Dark mode.** Literal-class pairs (§2.8); only declared `axal-*` tokens (§2.6).
9. **Folder docs** (`scripts/check-folder-docs.mjs`).
   - `frontend/src/pages/admin` is listed (`:82`), so its README must mention a new `events/` subfolder (NAVIGATION, `:205-209`).
   - Every backticked filename it cites must exist (`:211-260`).
   - A folder with 8 or more source files must be added to `DOCUMENTED` (`:183-193`).
   - Insights' 5-file folder is unlisted but carries a README (`pages/admin/README.md:76-78` is the line to copy).
10. **Profile routing.** Add the ROUTE_MAP row, regenerate, and bump to 149 (§3). The generated table must stay well formed (`profile_routing_table.test.mjs`).
11. **API drift.** Any new `/api/*` client method needs a matching Worker route (`npm run test:drift`). A new domain goes in `lib/api/<x>.js` with one line in the `api.js` re-export block (`lib/api/README.md:13-37`). Extending the inline `adminEvents` (`api.js:5659`) is allowed, because existing methods stay in `api.js`.
12. **Decision file.** Use the `D<n>` the issue gives (`decisions/README.md:13-16`); checked by `node scripts/check-decision-ids.mjs`.
13. **Redirects.** None are needed unless an address moves. If one does, add it to `cloudflare-worker/src/services/redirectRoutes.ts` (D893 precedent, `admin_insights_d893.test.mjs:415`) and a `*Redirect` element (`admin_route_reachability.test.mjs:89-91`).

**Open conflicts to settle:**
- **The canvas crumb points at a missing route.** It links `/admin/community`; the real landing is `/admin/held/community`.
- **The page crumb and the rail trail disagree.** The page shows "Community › Events"; the rail reads "Approvals › Events", and Approvals has to stay the owner.
- **EV16 cannot render.** It is unreachable under `RoleGuard`.
- **EV12's dash breaks the honesty rule** (no bare dash for a measured week).
- **The analytics read hides its own failures.** `admin_events.ts:151-153` and `:189-191` turn a failed read into zeros, so the Unreadable states need a Worker change.
- **"New studio event" contradicts the console's description.** `COMMUNITY_CONSOLES.events.what` says the console "does not author an event" (`BranchCommunity.jsx:75-76`).

## Part D — the defects, re-checked

### #2368 defect verification at HEAD `4d79754` (`claude/spinout-lab-workspace-wuyyqd`)

The issue was drafted on `origin/main` at `537f646a3f`, a commit that is not in this clone (`git cat-file` reports "Not a valid object name"). Two event commits have merged since: `ae2b0ca` (#2623, closes #2394) and `0de9244` (#2626, closes #2395). Neither touched `admin_events.ts` or `AdminEventsPage.jsx`. Line numbers in those two files are unchanged. In `routes/events.ts`, lines from the create route onward have moved by about +17; the drift table is at the end.

#### Summary

| # | Defect | Verdict |
|---|---|---|
| 1 | A failed read shows zeros | **PRESENT** |
| 2 | The queue can miss events; `GET /` unused | **PRESENT** |
| 3 | "Conv." 0% for upcoming events | **PRESENT** |
| 4 | A rejected event has no bucket | **PRESENT** (one nuance on the schema comment) |
| 5 | The reject reason is lost to admins | **PRESENT** |
| 6 | Unpublish is silent | **PRESENT** |
| 7 | Cancel never refunds; uses a browser confirm | **PRESENT** |
| 8 | Approve and reject skip the state check | **PRESENT** (wider than stated) |
| 9 | Feature does nothing visible | **PRESENT** (line moved) |
| 10 | Edits after approval skip review | **PRESENT** (lines moved) |
| 11 | "Waiting since" is creation time | **PRESENT** |
| 12 | No views store for the funnel | **PRESENT** |
| A | Four of twelve types lost | **PRESENT** (lines moved) |
| B | In-person saved as online | **PRESENT**; #2623 only papered over the read side |
| C | Audience rules dropped on create | **PRESENT**, and worse than stated |
| D | Advisors cannot be an audience | **PRESENT**, mirrored in a second frontend list |

---

#### Page bugs

##### 1. A failed read shows zeros: PRESENT
- The Worker seeds zeros and only logs on failure:
  - `cloudflare-worker/src/routes/admin_events.ts:120-123`: `let summary = { total_events: 0, published: 0, pending_review: 0, draft: 0, cancelled: 0, total_registrations: 0, total_attended: 0, total_waitlisted: 0 };`
  - `:151-153`: `} catch (e) { console.warn('[admin_events] analytics summary failed:', …) }`
  - Rows: `:155` `let events: any[] = [];` and `:189-191` `console.warn('[admin_events] analytics rows failed:' …)`.
  - The reply is always 200: `:193` `return c.json({ summary, events });`.
- The page falls back to zero:
  - `frontend/src/pages/admin/AdminEventsPage.jsx:183-186`: `value={summary?.published ?? 0}`, `summary?.pending_review ?? 0`, `summary?.total_registrations ?? 0`, `summary?.total_attended ?? 0`.
  - A failed rows block reads as "No events yet." (`:262-263`).
  - A thrown request only toasts (`:93-95`), and `summary` stays `null` (`:77`), so the tiles still show 0.

##### 2. The queue can miss events: PRESENT
- The queue is filtered out of the analytics rows: `AdminEventsPage.jsx:100` `rows.filter((r) => r.status === 'pending_review')`.
- Those rows are capped and sorted by start: `admin_events.ts:165-167` `GROUP BY e.id ORDER BY e.starts_at DESC LIMIT 200`.
- The real queue read is unused:
  - Route: `admin_events.ts:95-109`, `GET /?status&limit(≤200)&offset`, `ORDER BY created_at DESC`, returning `{ events: shapeEvent(r,{includePrivate:true})[] }`.
  - Client: `frontend/src/lib/api.js:5660-5666` `adminEvents.list({status,limit=50,offset=0})`. `adminEvents.get` is at `:5667`.
  - A grep finds neither `adminEvents.list` nor `adminEvents.get` called anywhere in `frontend/src`. The page's only read is `AdminEventsPage.jsx:90` `adminEvents.analytics()`.
- The chart takes the first ten of the same DESC-by-start rows: `AdminEventsPage.jsx:102-111`. `capacity` is in its data (`:109`) but is not drawn; the only `<Bar>` is at `:203`.

##### 3. "Conv." says 0% for upcoming events: PRESENT
- `admin_events.ts:186`: `conversion: registrations > 0 ? round2(attended / registrations) : null`. There is no "ended" check, so an upcoming event with registrations gives 0.
- `AdminEventsPage.jsx:36-38`: `pct(v)` prints `0%` for 0. It is rendered at `:298`.

##### 4. A rejected event has no bucket: PRESENT (nuance on the schema comment)
- `admin_events.ts:262`: `UPDATE events SET status = 'rejected', admin_published = 0 …`.
- The summary counts only `published`, `pending_review`, `draft` and `cancelled` (`:128-131`). `total_events` (`:127`) still includes the rejected rows.
- Neither badge map has a `rejected` key:
  - Admin page: `AdminEventsPage.jsx:18-23`. It falls back to grey at `:288`.
  - Member page: `frontend/src/pages/events/MyEventsPage.jsx:16-21`.
- The schema comment `cloudflare-worker/sql/migrations/109_events_core.sql:61` reads `-- draft | pending_review | published | cancelled`. It lists no `rejected` state but does not itself say where reject goes. The spec does say draft:
  - `design/EVENT_SYSTEM.md:21` (state table: the four states);
  - `:45-46` "Admin **reject** returns to `draft` (with a reason)";
  - `:146` "**reject** (→ draft + reason)".
- `'rejected'` appears only once in all event code: `admin_events.ts:262`.

##### 5. The reject reason is lost to admins: PRESENT
- `admin_events.ts:259-260`: the reason is read with `String(body.reason).slice(0, 1000)` or `null`, and it is optional.
- It is stored only in the audit row (`:264` `extra: { reason }`, written into `filters_json` at `:69`) and sent in the host's notification (`:268` `body: reason || undefined`).
- `events` has no column for it (`109_events_core.sql:41-69`), and nothing in `cloudflare-worker/sql` or `src` runs `ALTER TABLE events`. `GET /:id` (`:197-205`) returns no history.
- The page makes the reason optional too: `AdminEventsPage.jsx:128` `rejectReason.trim() || undefined`, with the placeholder "Reason (optional)" at `:367`.

##### 6. Unpublish is silent: PRESENT
- `admin_events.ts:276-288`: `UPDATE events SET admin_published = 0, status = 'draft'` (`:284`), then an audit row (`:286`). There is no `notify` call.
- There is no state check either, so unpublishing a cancelled event would bring it back as a draft.

##### 7. Cancel never refunds and uses a browser confirm: PRESENT
- `AdminEventsPage.jsx:331`: `if (!window.confirm(\`Cancel "${ev.title}"? Registrants will be notified.\`)) return;`.
- The Worker (`admin_events.ts:312-335`):
  - sets `status='cancelled', admin_published=0` (`:320`);
  - notifies seated and waitlisted users (`:324-333`);
  - leaves every `event_registrations` row unchanged, including `payment_status`.
- The ticket service only creates and fulfils payments:
  - header `cloudflare-worker/src/services/eventTickets.ts:1-15`;
  - the payment ID is written at `:76`, `UPDATE event_registrations SET payment_intent_id = ?`.
- Nothing writes `'refunded'` to an event registration (grep over `cloudflare-worker/src`), although the schema declares it: `109_events_core.sql:130` `-- none | pending | paid | refunded`.
- The Stripe `charge.refunded` webhook calls only `aiCreditReversals.reverseRefund` (`cloudflare-worker/src/routes/billing.ts:2003-2005`).
- The only refund tool is `admin_billing.ts:201-202`, `adminBilling.post('/refund', …)` behind `requireSuperAdminWriteBar(c)`.
- No host-cancel route exists (`routes/events.ts` has none; #2387 proposes one).

##### 8. Approve and reject do not check state: PRESENT (wider than stated)
- Approve (`admin_events.ts:217-221`) loads the event, then runs `UPDATE … status='published', admin_published=1` whatever the current status or visibility. So it can resurrect a cancelled event or set `admin_published=1` on a private one.
- Reject (`:257-263`) has the same gap.
- No mutating handler checks state: unpublish (`:281-285`), feature (`:300-306`), cancel (`:317-321`) and capacity (`:346-361`) don't either.
- Only the page limits approve and reject to pending rows (`AdminEventsPage.jsx:215-254`).
- Constraint for any fix: `cloudflare-worker/test/branch_suspended_freeze.test.ts:340-342` pins the literal handler strings `adminEvents.post('/:id/reject'`, `'/:id/unpublish'`, `'/:id/cancel'` and `'/:id/capacity'` as un-gated. `:280` lists the file for the gated writes, approve (`:214`) and feature (`:297`). New 409 checks must keep those registrations verbatim.

##### 9. Feature does nothing visible: PRESENT (line moved)
- `routes/events.ts:303` (the issue said `:286`): `if (Number(e.featured) === 1) score += 3;` inside `GET /suggested` (`:265-318`).
- The public feed orders by start only:
  - `events_public.ts:75-77`: `ORDER BY starts_at ${order}`;
  - ICS feed `:85-86`: `ORDER BY starts_at ASC`.
- `featured` reaches the client through `shapeEvent` (`eventsCommon.ts:93`), but no file under `frontend/src/pages/events/` or `components/events/` reads it.
- The admin toggle (`AdminEventsPage.jsx:309-316`) says nothing about its effect.

##### 10. Edits after approval skip review: PRESENT (lines moved)
- `PATCH /:id` is at `routes/events.ts:419-484`, gated by `canManage` (`:426`; defined at `:75-77`).
- It accepts `title`, `summary`, `description`, `cover_url`, `starts_at`, `ends_at`, `timezone`, `location_text` and `location_url` (`:435-436`), `capacity`, `price_cents` and `project_id` (`:440`), and `currency` (`:441`). None of these resets `status` or `admin_published`.
- Only a switch to public re-queues, and only when the event is not yet admin-published: `:459-466`, `if ('visibility' in body && body.visibility === 'public') { … if (Number(cur.admin_published) !== 1 && cur.status === 'published') UPDATE … 'pending_review'`.
- The edit is logged as `logAdminAction(… 'event_updated', { event_id, fields })` at `:482`.

##### 11. "Waiting since" is creation time: PRESENT
- `cloudflare-worker/src/services/approvalSources.ts:221`: `SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM events WHERE status = 'pending_review'`.
- Rows use `e.created_at AS created_at … ORDER BY e.created_at ASC` (`:224`, `:226`).
- There is no `submitted_at`, `approved_at`, `review_note` or `changed_after_approval_at` column:
  - not in `109_events_core.sql:41-69`;
  - not in `services/eventsSchema.ts:25-44`;
  - no `ALTER TABLE events` anywhere.
- Submit-review writes only the status: `routes/events.ts:498-506`, then `logAdminAction(… 'event_submitted')` at `:507`.
- The newest migration is `535_dd_advisor_subject.sql`, so the next number is 536.

##### 12. No views store for the funnel: PRESENT
- `events` has no view column (`109_events_core.sql:41-69`).
- `funnel_events` (`146_funnel_events.sql:22-40`) accepts only `FUNNEL_EVENT_ALLOWLIST` (`cloudflare-worker/src/routes/track.ts:29-51`): sign-up, login and onboarding events. Nothing there is an event-page view, and no `event_view` emitter exists in `frontend/src`.
- The spec still asks for it: `design/EVENT_SYSTEM.md:152-154` "conversion (views → registrations → attended)".

---

#### Member-side bugs

##### A. Four of the twelve types are lost on create and edit: PRESENT (lines moved)
- The Worker's validation list has eight types: `cloudflare-worker/src/services/eventsCommon.ts:7-16` `EVENT_TYPES = ['meetup','workshop','webinar','demo_day','office_hours','conference','social','other']`.
- The canonical list has twelve:
  - `services/eventTypes.ts:12-25` `EVENT_TYPE_IDS`, adding `lp_briefing`, `networking`, `roundtable` and `fireside`;
  - its `isEventType` (`:32`) has no importer in `cloudflare-worker/src`;
  - frontend mirror: `frontend/src/lib/eventTypes.js:28-41`.
- Create falls back to meetup: `routes/events.ts:216` `const type = EVENT_TYPES.includes(body.type) ? body.type : 'meetup';`. `EVENT_TYPES` is imported from `eventsCommon` at `:43`.
- Edit silently ignores the four: `:437` `if ('type' in body && EVENT_TYPES.includes(body.type)) …`.
- The editor offers all twelve: `EventEditorPage.jsx:11,13`, rendered at `:195`.
- The parity test reads only `eventTypes.ts`: `frontend/test/event_types_parity.test.mjs:27-31` (`read('cloudflare-worker/src/services/eventTypes.ts')`). Its "can exist" check (`:61-74`) compares suggestion sets against the frontend list, not the creatable list.
- So the investor track suggests `'lp_briefing'` (`routes/events.ts:133`), a type `POST /` turns into `meetup`.

##### B. In-person saved as online: PRESENT; #2623 only papered over the read side
- The editor sends `in_person`: `frontend/src/pages/events/EventEditorPage.jsx:14` `const LOCATION_KINDS = ['virtual', 'in_person', 'hybrid'];`, rendered at `:242`; `:251` hides the join URL for `'in_person'`.
- The Worker accepts other values: `eventsCommon.ts:19` `LOCATION_KINDS = ['virtual', 'physical', 'hybrid']`.
- Create falls back to virtual: `routes/events.ts:218` `… ? body.location_kind : 'virtual'`. Edit ignores it: `:439`.
- The schema comment agrees with the editor, not the Worker: `109_events_core.sql:54` `-- virtual | in_person | hybrid`.
- What changed: #2623 added `isInPersonEvent` (`eventsCommon.ts:61-63`, `=== 'physical' || === 'in_person'`), and the tests accept both values on read (`cloudflare-worker/test/events_join_access_2394.test.ts:109`, `frontend/test/event_organiser_d567.test.mjs:70`). The write list is unchanged, so no new row can ever be `in_person`.
- Consequence: the public Format filter maps `virtual` to `'online'` (`PublicEventsPage.jsx:74-78`), so these events list as Online.

##### C. Audience rules dropped on create: PRESENT, and worse than stated
- The editor sends a string: `EventEditorPage.jsx:124` `audience_rules_json: JSON.stringify(rules)`. Create and edit share the same `payload()` (`:108-125`).
- Create reads only `body.audience_rules`, so the editor's payload stores `'{}'`: `routes/events.ts:220-222` `serializeAudienceRules(parseAudienceRules(body.audience_rules ? JSON.stringify(body.audience_rules) : null))`.
- Even a client that sent an `audience_rules` object would keep only the five comp flags: `serializeAudienceRules` (`services/eventAudience.ts:56-68`) drops `mode`, `roles` and `personas`, and create never calls `validateRegistrationRules`.
- The editor's create UI offers only the comp flags (`EventEditorPage.jsx:17-23`, `:296-316`), so every "Free seats for …" box ticked at create is lost.
- Edit keeps the rules: `routes/events.ts:443-449` `validateRegistrationRules(body.audience_rules_json ?? body.audience_rules)`. Submit-for-review saves first (`EventEditorPage.jsx:152`).
- What changed: since #2626 the edit path loads correctly (`EventEditorPage.jsx:80-98`: `reply.event`, `setRules(ev.audience_rules || {})`).
- Constraint: `frontend/test/event_contracts_2395.test.mjs:70-75` pins the editor payload with `audience_rules_json` as a string. The fix belongs in the Worker's create route (read `audience_rules_json ?? audience_rules` through `validateRegistrationRules`, as PATCH does), not in the editor.

##### D. Advisors cannot be chosen as an audience: PRESENT, mirrored in a second list
- `cloudflare-worker/src/services/eventOrganiser.ts:5`: `EVENT_ROLES = ['admin', 'founder', 'partner', 'investor', 'exploring'] as const`. It is enforced at `:16-17` and matched against `users.role` at `:31-32`.
- The frontend mirror has the same list: `frontend/src/pages/events/EventManagePage.jsx:13` `const roles = [...]`, rendered at `:87`.
- `advisor` is a real `users.role`: `cloudflare-worker/src/index.ts:1626` `UPDATE users SET role = 'advisor' WHERE role = 'mentor'`.
- Advisors can host: `frontend/src/App.jsx:3178-3182` guards `/events/new`, `/:id/edit` and `/:id/manage*` with `guard(['admin','founder','partner','investor','advisor'], …)`.

---

#### Open work touching these

- **Code references:** `git grep -w` for 2367, 2387 and 2390 finds nothing in code. 2368 appears only in `design/incoming/README.md:145-157` (the canvas landing note: "S1's integration lands next").
- **Open PRs** (REST `pulls?state=open`): #2689, #2686, #2685 and #2665. Only #2685 (this branch, D894 Pitch deck) touches event-related files, and only the two new `design/incoming/Events Console*.dc.html` files (it carries commit `4d79754`). None touches Worker or frontend event code.
- **Related issues:**

| Issue | State | Bearing |
|---|---|---|
| #2387 My events | open, tracking, needs-design | Shares the review fields (`submitted_at`, `approved_at`, `review_note`, `changed_after_approval_at`) and the sent-back name; #2368 owns them. Proposes host cancel and adding `advisor` to `EVENT_ROLES` |
| #2390 Approvals | open, tracking, needs-design | Same `events` lane (`approvalSources.ts:217-227`). No code yet |
| #2367 Community overview | open, tracking, needs-design | Same show-up and fill definitions. No code yet |
| #2394 | closed (PR #2623) | Join-link gating, `isInPersonEvent`. Fixed #2387 bug 10, not B |
| #2395 | closed (PR #2626) | Editor reads `reply.event`; `checkin_code`/`comp` on `GET /api/events`; `eventsApi.icsUrl` → `/ics`. Fixed #2387 bugs 2, 3, 4, 9 |

- **Decisions:**
  - Events-specific: `documentation/architecture/decisions/D567.md`, "Event organiser: audience, decisions and agenda (#1173)". It defines `mode`/`roles`/`personas` and the strict validation.
  - Mention events in passing: D560 (learning webinars, not this engine), D556:217 (rail list naming `/admin/events`), D774 (admin boards' rail; the page's `AdminBoardFrame` mount comment at `AdminEventsPage.jsx:429`).
  - No decision covers the reject state, featured, refunds or review timestamps. The newest decision is D894.

#### Chart series tokens

- `frontend/src/index.css` has **no chart or series tokens**:
  - present in the `@theme` block: `--color-axal-violet: #7c3aed` (`:50`), `--color-brand-light: #a78bfa` (`:17`), `--color-axal-muted: #6b6577` (`:74`), `--color-axal-hairline: #ececf1` (`:70`), `--color-axal-amber: #fcd34d` (`:53`, the waiting amber, not the series amber);
  - absent: `#0ea5e9`, `#f59e0b` and `#10b981` appear nowhere in the file.
- D893 (Admin Insights) put the palette in a component instead, as Tailwind arbitrary-value classes in `frontend/src/pages/admin/insights/InsightsCharts.jsx`:
  - `:11-12` comment: "COLOUR IS #2375's ONE PALETTE: violet, sky, amber, emerald, muted. Only violet changes in dark mode (#a78bfa)";
  - `:18-24` `FILL = { violet: 'fill-axal-violet dark:fill-[#a78bfa]', sky: 'fill-[#0ea5e9]', amber: 'fill-[#f59e0b]', emerald: 'fill-[#10b981]', muted: 'fill-axal-muted' }`;
  - `:29-35` `STROKE`, same keys; `:291` the Legend `bg-*` map;
  - exports: `HBars` (`:66`), `Columns` (`:111`), `WeekLine` (`:178`), `Bar100` (`:236`), `Donut` (`:255`), `Legend` (`:284`), `ChartTable` (`:307`), `Chart` (`:339`).
  - Its only importer is `pages/admin/insights/AdminInsights.jsx:9`.
- The canvas uses the same five values: `design/incoming/Events Console Page.dc.html:219` `const S = [c.vi, '#0ea5e9', '#f59e0b', '#10b981', '#6b6577'];`, with `vi` `#7c3aed` light and `#a78bfa` dark (`:216-217`).
- So the palette is reusable from `InsightsCharts.jsx` today, but it is not a CSS token. #2368's line "No chart token exists today" is still literally true of `index.css`.
- Other shared parts: `Stat`/`StatGrid` (`frontend/src/ui/Stat.jsx:27`, `:74`), `Unrecorded`/`Unreadable` (`frontend/src/ui/Honesty.jsx:37`, `:62`), `WeeklyLineChart` (`frontend/src/components/WeeklyLineChart.jsx:35`), `"recharts": "^3.10.1"` (`frontend/package.json:33`).

#### Line drift: issue cite → HEAD

| Item | Issue | HEAD |
|---|---|---|
| `canManage` | events.ts:73-75 | events.ts:75-77 |
| host = creator | :216 | :233 (`u.id` bind) |
| create type / location / audience | :199 / :201 / :203-205 | :216 / :218 / :220-222 |
| PATCH fields / type / location / audience | :418-425 / :420 / :422 / :426-432 | :435-441 / :437 / :439 / :443-449 |
| re-queue on public | :442-449 | :459-466 |
| featured +3 | :286 | :303 |
| `event_updated` / `event_submitted` | :490 / :465 | :482 / :507 |
| `/admin/events` route | App.jsx:2829 | App.jsx:2837 |
| host routes | App.jsx:3164-3168 | App.jsx:3178-3182 |
| `adminEvents` client | api.js:5650-5666 | api.js:5659-5676 |
| admin events mount | index.ts:985-987 | index.ts:997-999 |
| `Stat` | Stat.jsx:4-25 | Stat.jsx:27 |
| `WeeklyLineChart` | WeeklyLineChart.jsx:4-28 | WeeklyLineChart.jsx:35 |

Cites that have not moved: `admin_events.ts`, `AdminEventsPage.jsx`, `eventsCommon.ts:7-19`, `eventTypes.ts`/`.js`, `event_types_parity.test.mjs:28`, `eventOrganiser.ts:5`, `eventAudience.ts:56-68`, `approvalSources.ts:221`, `events_public.ts:76-78`, `eventTickets.ts:1-15,76`, `109_events_core.sql`, `EVENT_SYSTEM.md`, `admin_billing.ts:201-202`, `EventEditorPage.jsx:14,124,152`.
