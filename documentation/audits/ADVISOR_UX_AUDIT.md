# Advisor Experience — UX/UI Audit & Redesign Roadmap

**Scope**: the full advisor panel at axal.vc — the Office Hours home, profile and availability management, the booking lifecycle, the advisor directory as seen by both sides, discovery/matching, money (rates, payments, payouts), the Engagements group (Calendar, Events, Jobs, Advisor Directory, Signals, Due Diligence), the Account group, the path to *becoming* an advisor, and the constellation of parallel "advice-giver" systems the advisor sits inside — reviewed as one connected product system.
**Constraints honored** (mirroring the founder and investor audits): the advisor sidebar groups (Home / Engagements / Account) are unchanged; the advisor lifecycle is designed as a **module on the advisor home**, not a new sidebar section; simplification is preferred over new pages.
**Method**: every claim verified against the shipping code (`frontend/src/`, `cloudflare-worker/src/routes/`, `cloudflare-worker/sql/`), with the critical contract breaks re-verified line-by-line. Companion documents: `FOUNDER_UX_AUDIT.md` (merged, #133), `INVESTOR_UX_AUDIT.md` (#134).

---

## Executive summary

The founder audit found studio tools in a founder costume. The investor audit found a seat at the console with the investor product left unplugged. The advisor audit finds something starker: **a facade**. The pages exist, the tables exist, the status machine exists — but the wires between the React pages and the production worker were cut in the FastAPI→Workers port and never reconnected. No advisor can complete a single core flow end-to-end. Six systemic problems:

1. **The advisor's home cannot do its job.** `OfficeHoursPage.jsx` (the advisor's landing page) speaks a legacy DTO the deployed `advisors.ts` does not:
   - Profile save **silently drops 9 of 11 fields** — `POST /advisors/me` reads only `display_name, bio, linkedin_url, hourly_rate_usd, expertise, sectors` (`advisors.ts:134-175`) while the form sends name, headline, specialties, rate, capacity/week, timezone, Cal.com username, "Accepting bookings", "Listed in directory". Only bio and sectors persist; the rest reload blank every visit.
   - Publishing a slot **fails with a 400 every time** — the form sends `start_at` + `duration_min`; the worker requires `starts_at` + `ends_at` (`advisors.ts:319-324`). An advisor cannot create availability at all.
   - Existing slots render **"Invalid Date · undefined min"** (page reads `start_at/duration_min/location_kind/status`; `slotDto` emits `starts_at/ends_at/capacity/taken/available/is_cancelled`, `advisors.ts:57-66`), and the delete button is gated on a `status === 'open'` that never exists.
   - **An advisor can never accept a booking**: Confirm/Decline render only for status `requested`, but the worker inserts bookings as `pending` (`advisors.ts:381`).

2. **The demand side is equally broken.** On `AdvisorsPage.jsx` (the founder-facing directory): cards render blank names, no ratings, and always "Free" (`advisorDto` lacks `name/rating_avg/specialties/hourly_rate`); the Specialty / Max-$ / Free-only filters are sent but the worker reads only `q/sector/expertise` (`advisors.ts:104-123`) — they do nothing; and `AdvisorDetail` filters slots on `status==='open' && remaining>0`, fields the API never emits, so **the slot list is always empty** and native booking is unreachable. The only path that works is the external "Book via Calendly" link.

3. **No money ever flows to an advisor.** `hourly_rate_usd` is stored and displayed but never charged — the entire book/confirm/complete chain contains zero payment calls; the Growth-tier gate on booking is a platform subscription, not a session fee. There is no earnings surface. `PayoutsPage` is the *referral-commission* ledger (whose history tables have a bug rendering only their empty states — `PayoutsPage.jsx:107-119`), and the `/payouts` route excludes the advisor role anyway. Meanwhile, one door over, the **wellbeing experts** system has the complete kit — Stripe Connect Express, in-app `AxalCheckout`, a 15% platform fee, priced services, ratings — and an advisor can manage a wellbeing-expert profile **only by typing the URL** (`/wellbeing/expert-dashboard` is advisor-authorized at `App.jsx:1347`, but the `/wellbeing` directory is founder/admin-only and nothing in the advisor nav links to any of it).

4. **There is no way in.** No application flow exists. The onboarding persona literally named **"Operator / Advisor"** carries `role_alignment: 'partner'` (`cloudflare-worker/src/personas.ts:178-181`) — completing it assigns the **partner** role. The `advisor` role is granted only by an admin (`PATCH /api/admin/users/:userId/role`, `admin.ts:1031-1101`).

5. **Seven parallel advice systems, near-zero shared parts.** Bookable advisors (`advisors.ts`, plus a permanent `/api/mentors` alias); the founder's private advisor CRM (`advisor_profiles`, migration 138); the Advisory Suite's template "AI"; the PersonalAdvisor AI (`advisor.ts`); wellbeing experts (`wellbeing.ts`); partner office hours (`partner_office_hours.ts` — a **near-verbatim copy** of `advisors.ts` keyed on `partner_id`, its own header admitting "Mirrors advisors.ts… Booking semantics are identical", minus reviews and the tier gate); and consultations ("Book with Guillaume"). That's **three independent slot/booking implementations, four review data models, four hand-rolled star widgets**, duplicated booking modals and slot forms; the only shared code across all seven is a small helper module and the calendar sync. Advisor-audience landing-page leads route **only** into founders' private CRMs — platform advisors never see them. And `GET /advisors/match` — a real matcher computing score, breakdown, reasons, watch-outs (`advisors.ts:181-279`) — has **zero callers anywhere in the SPA**.

6. **Feedback loops dead-end.** Advisors can review mentees ("Review the mentee" — copy surviving from the mentors era), but reviews *received* are never surfaced: no aggregate in any DTO, no reviews panel on the home. There is no demand signal — nothing tells an advisor "founders are looking for your expertise."

**The fix starts below the UX.** Reconnect the contract first (one worker file, three pages); then surface reputation and demand; then run payments down the rails the wellbeing system already proved; then collapse seven advice systems toward one set of parts.

---

## Section-by-section audit

### 1) Home — `/office-hours` (`OfficeHoursPage.jsx`, 394 lines)

**What's there.** "Advisor profile" card (11 fields + save), "Publish a slot" form, "Upcoming office hours" list, "Bookings" list with per-status actions (Confirm/Decline → Mark complete/No-show/Cancel → Review mentee), and a review modal. No earnings, no stats, no reviews-received. Load errors are swallowed into empty states — the page *looks* healthy while nothing works.

**The contract-break table** (frontend ↔ `advisors.ts`, all verified):

| UI expects / sends | Worker reality | Effect |
|---|---|---|
| create: `start_at` + `duration_min` | requires `starts_at` + `ends_at` (`:319-324`) | slot creation 400s — cannot publish availability |
| render: `s.start_at`, `s.duration_min`, `s.location_kind`, `s.status` | `slotDto`: `starts_at/ends_at/capacity/taken/available/is_cancelled` (`:57-66`) | "Invalid Date · undefined min"; cancel button never renders |
| actions gated on booking `status==='requested'` | inserts `'pending'` (`:381`) | Confirm/Decline never appear |
| `b.scheduled_start`, `b.questions` | booking has `topic`/`notes`; time lives on the slot | "Invalid Date"; founder questions lost |
| profile: 11 fields | POST reads 6; GET returns `display_name/expertise/…` the form doesn't map | 9 fields silently dropped; inputs blank on reload |

**Recommendation.** Fix the contract **worker-out**: extend `advisors.ts` to the richer contract the UI was designed for (add headline, specialties→expertise mapping, capacity/week, timezone, accepting/listed columns; return an `advisor_rating` aggregate; accept `duration_min` sugar or update the form to `starts_at/ends_at`; emit a booking `status` vocabulary the UI shares). Then add the two missing panels the page cries out for: **Reviews received** (aggregate + recent, from `advisor_reviews`) and a compact stats row (upcoming sessions, completed, pending requests). This one fix restores the persona.

### 2) Becoming an advisor & profile management

**What's there.** Nothing self-serve. The "Operator / Advisor" persona assigns `partner`. Admin role-grant is the only door. (`POST /advisors/me` will happily self-create the profile row for any authenticated user — but the `/office-hours` page is role-gated, so the row is unreachable without the role.)

**Recommendation.** An **"Apply to advise"** flow: a short application (expertise, LinkedIn, motivation) → admin review queue → the existing role-grant endpoint as the approval mechanism. Fix `operator_advisor.role_alignment`. This is mostly UI plus an application status — the approval backend already exists.

### 3) Getting booked — the demand side

**What's there.** The directory founders see is hollow (blank cards, dead filters, permanently empty slot lists — §2 of the summary); the one real matcher is uncalled; Calendly is the only functioning path; and advisor-audience leads captured by founders' landing pages live exclusively in those founders' private CRMs (`advisor_profiles` has no link to the `advisors` table).

**Recommendation.**
- The §1 contract fix heals the directory cards, filters, and native booking in the same stroke — same file, same DTOs.
- **Wire `GET /advisors/match`** into the founder's Team → Advisors tab as a "Recommended for you" row, and build its mirror for the advisor: a **demand view** ("Founders looking for your expertise") on the home. The endpoint already computes both directions' ingredients.
- **Bridge the leads**: when a founder's landing page captures an advisor-audience signup, offer that person an opt-in to the platform directory (the founder keeps the CRM relationship; the advisor gains discoverability; the platform gains supply).

### 4) Money

**What's there.** Rates that are never charged; no earnings; a payouts page that belongs to the referral program, excludes the advisor role, and doesn't render its rows. The proof the rails work sits in the wellbeing system: Stripe Connect onboarding (`POST /experts/me/stripe/connect`), `pending_payment` bookings resolved by webhook, in-app checkout, a 15% fee, per-service pricing.

**Recommendation.** **Adopt the wellbeing payment rails for advisor sessions**: a paid slot creates a `pending_payment` booking exactly like an expert booking; an **Earnings** panel lands on the advisor home. Long-term product decision (flagged, not assumed): fold bookable advisors into the experts engine entirely — one slot model, one review model, one payment path; the experts system is the superset and the healthiest of the seven.

### 5) Engagements & Account groups

- **Advisor Directory** (`/advisors`): the advisor sees the founder-facing page — browsing peers plus "My bookings" *as a mentee*. Fine concept, broken rendering (§3). Keep after the contract fix.
- **Signals** (`/signals`): the bright spot of the persona. `mode='advisor'` reorders content with role-true copy — "signals ordered by how confidently you can point a founder toward them." This is what role-aware UX looks like here; copy the pattern.
- **Due Diligence** (`/admin/due-diligence`): the advisor is a section reviewer, correctly scoped to assigned sections (`dd.ts:207-224`) — but the URL says `/admin/*`, and an unassigned advisor sees an unexplained empty queue. De-admin the framing (same recommendation as the investor audit) and give the empty state one sentence about how assignments happen.
- **Articles**: advisors are valid authors (`articles.ts:68`) — keep and celebrate; it's their reputation channel and feeds the "Build reputation" lifecycle stage.
- **Jobs / Events / Calendar**: generic shared surfaces; fine. Calendar already receives `advisor_booking` sync events — bookings will appear there once bookings can exist.

### 6) The seven parallel advice systems

| System | Supplies | Consumes | Booking | Payment | Reviews |
|---|---|---|---|---|---|
| Bookable advisors (`advisors.ts` + `/api/mentors` alias) | advisor role | founders | capacity slots (broken FE) | none (rate decorative) | `advisor_reviews` (never shown) |
| Founder CRM (`advisor_profiles`) | promoted leads | one founder | none (CRM) | none | none |
| Advisory Suite "AI" (`/advisory/ask`) | template strings | founders | n/a | none | none |
| PersonalAdvisor AI (`advisor.ts`) | AI | everyone | n/a | none | none |
| Wellbeing experts (`wellbeing.ts`) | any role but investor | founders | internal slots or Calendly, Jitsi links | **Stripe Connect, 15% fee** | `expert_ratings` |
| Partner office hours (`partner_office_hours.ts`) | partner role | founders | capacity slots (copy of advisors) | none | none |
| Consultations (`consultations.ts`) | the platform admin | any user | request queue | none | none |

**Recommendation** (pragmatic sequence): **now** — extract shared `SlotPicker` / `BookingCard` / `StarRating` primitives (today: 4 star widgets, 3 booking modals, 2 identical slot forms); **next** — unify `advisors.ts` + `partner_office_hours.ts` into one parameterized office-hours service (they differ by a key column; partners gain reviews for free); **later** (product decision) — fold bookable advisors into the experts engine and retire the `/api/mentors` alias and "mentee" copy. Leave the PersonalAdvisor AI (genuinely different) and consultations (admin-specific) alone.

---

## The Advisor Lifecycle module (on the advisor home)

Six stages, derived entirely from existing data — the advisor twin of the founder and investor lifecycle rails, reusing the same components:

| Stage | Advisor's goal | Existing surfaces | Top action | System surfaces first |
|---|---|---|---|---|
| **Join** | Get approved to advise | Apply-to-advise (new), persona fix | Submit application | application status |
| **Set up** | Credible profile + availability | Office Hours profile & slots (fixed) | Complete profile; publish 3 slots | profile completeness |
| **Get discovered** | Appear where founders look | Directory listing, `/advisors/match`, leads bridge | Turn on directory listing | search appearances, match count |
| **Deliver** | Run sessions well | Booking lifecycle, Calendar | Confirm pending requests | pending requests, next session |
| **Build reputation** | Convert sessions into standing | Reviews received (new), Articles | Request a review; publish an article | rating trend, review count |
| **Earn** | Get paid | Stripe Connect rails (from experts) | Connect payouts | earnings, pending payouts |

Mechanics: compact stage rail + one next-best-action on `/office-hours`; stage completion derives from the profile row, slot count, booking statuses, `advisor_reviews`, and Stripe status. No wizard, no new sidebar entries.

---

## What should be merged, removed, or relocated

| Action | What | Destination |
|---|---|---|
| **Fix** | FE↔BE contract (`advisors.ts` × OfficeHours/Advisors pages) | worker DTO extended; pages aligned |
| Surface | Reviews received + rating aggregate | Advisor home + directory cards |
| Wire | `GET /advisors/match` (zero callers) | Founder Team tab + advisor demand view |
| Bridge | Advisor-audience landing leads | Opt-in to platform directory (founder CRM preserved) |
| Adopt | Wellbeing Stripe Connect rails | Paid advisor sessions + Earnings panel |
| Add | Apply-to-advise flow | Replaces admin-only role grant; fix `operator_advisor` persona |
| Merge | `partner_office_hours.ts` into the advisors engine | One parameterized office-hours service |
| Extract | SlotPicker / BookingCard / StarRating | Shared primitives across the advice systems |
| Link | Wellbeing expert dashboard | Advisor nav (already advisor-authorized) |
| De-admin | `/admin/due-diligence` framing for advisors | Reviewer-facing route + explanatory empty state |
| Rename | "mentee" copy; retire `/api/mentors` alias (long-term) | Founder-native language |
| Fix | PayoutsPage renders only empty states | Rows render; labeled clearly as referral-only |

## Recommended advisor information architecture (sidebar unchanged)

```
Home
  Office Hours     ADVISOR DESK: lifecycle rail + pending requests + reviews received
                   + earnings + demand view · profile & slots (contract fixed)
Engagements
  Calendar         unchanged (bookings appear via existing sync)
  Events           unchanged
  Jobs             unchanged
  Advisor Directory  peers + "My bookings as mentee" (healed by contract fix)
  Signals          unchanged — the role-aware pattern to copy elsewhere
  Due Diligence    reviewer-facing framing + assignment-aware empty state
  Support          unchanged
Account
  Articles         unchanged — the reputation channel
  Activity · Docs · Settings   unchanged
```

## High-impact redesign recommendations (the short list)

1. **Reconnect the wires** — one worker file's DTO alignment restores publish → discover → book → confirm for the whole persona.
2. **Show advisors what founders say about them** — reviews exist in the database; render them.
3. **Open the front door** — an application flow instead of an admin whisper network; fix the persona that assigns the wrong role.
4. **Let the matcher match** — a built, scored, explained matching endpoint with zero callers is free product sitting in the codebase.
5. **Pay the people** — the Stripe rails are already built one system over; advice that's worth $X/hr should be able to charge it.
6. **Seven systems, one set of parts** — shared booking primitives now, one office-hours engine next, one advice engine eventually.

## Prioritized redesign roadmap

Effort: S = day-scale, M = multi-day, L = week+.

### Critical — the persona is nonfunctional without these
1. **Contract fix** across `OfficeHoursPage` / `AdvisorsPage` / `advisors.ts` — extend the worker to the designed contract (profile fields, slot fields, booking status vocabulary), align both pages; restores every core flow. *(M/L — one route file + two pages + a small migration for the missing columns)*
2. **Reviews received + rating aggregate** — `advisor_rating` in DTOs; panels on home and directory cards. *(S/M)*
3. **Apply-to-advise + persona fix** — application UI + admin queue on the existing role-grant; correct `operator_advisor.role_alignment`. *(M)*
4. **Wire the match endpoint** — "Recommended for you" in founder Team; "Founders looking for your expertise" on the advisor home. *(M)*

### Important — finish the lifecycle
5. **Payments** via the experts' Stripe Connect rails + Earnings panel. *(L)*
6. **Office-hours engine unification** (advisor + partner). *(M)*
7. **Landing-lead opt-in bridge** to the platform directory. *(M)*
8. **Advisor lifecycle rail** on the home (reuses the founder/investor rail work). *(M)*

### Nice to have
9. Shared SlotPicker / BookingCard / StarRating primitives. *(M, incremental)*
10. Wellbeing-expert nav link + "also offer wellbeing sessions?" cross-profile prompt. *(S)*
11. DD reviewer framing + assignment-aware empty state. *(S)*
12. Copy pass ("mentee" → founder-native), PayoutsPage rendering fix, retire the mentors alias. *(S)*
