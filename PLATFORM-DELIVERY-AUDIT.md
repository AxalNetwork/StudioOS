# Platform Delivery Audit — what shipped, what did not, and why you cannot see it

**Date:** 2026-08-29 · **Audited against:** `origin/main` @ `f112784a` ("Rebuild docs/ for deploy") · **Trigger:** owner report that wired UIs are not visible and that `Axal VC platform/` is not configured into the app.

Every number below is computed from the repo (the census parse, git history, page-level grep), not recalled from prior claims. Where a prior claim of "completed" failed a spot-check, this file says so.

## 1. The verdict, in one table

| Link in the delivery chain | State | Evidence |
| --- | --- | --- |
| Work merged to `main` | **HOLDS** | Every Claude PR #308–#343 has a `merged_at` timestamp; the only unmerged closed PR in that range is #306, a superseded dependabot bump. |
| Built into the shipped bundle | **HOLDS** | `docs/assets` carries 162 page chunks (CapTablePage, MetricsPage, LiquidityPage, DealsPage, FundsPage…); Inter webfont is in the shipped CSS; the Eadwyn/AssistRail code is in the `ui-*` chunk. `check-docs-fresh` green. |
| Deployed worker serves that bundle | **UNVERIFIED from CI** | This container cannot reach `axal.vc` (proxy policy 403) and holds no Cloudflare token. **10-second check for you, below (§2).** |
| Canvas designs ported into the app | **THE GAP** | By the repo's own census (`ROUTE_MAP.md`, Aug 27): of 107 canvases, only **4 are CURRENT**. 42 UPGRADE + 23 NEW + 7 RESKIN = **72 canvases still need UI work.** Since that census, exactly **4 commits** touched `frontend/src` (AI meter, research consolidation, Eadwyn naming, deal-flow pass UI). The port queue itself never ran. |
| No mock data shown to real users | **BROKEN in 2 surfaces** | All 5 `/partner/operations/*` tabs and all 5 `/advisor/advisory/*` tabs render static fixtures with **zero API calls** — today, on main. The census flagged this ("correction 1"); it was never acted on. |

**Your three statements, answered:**

1. *"A lot of what you worked on wasn't delivered."* Partially right, and the census quantifies it: the merged work is real (§4), but the canvas-porting phases — the visible redesign — stopped after the shell (Phases 0–4). 72 of 107 canvases were graded as needing work on Aug 27 and almost none of them have been touched since. The windows after the census were spent on backend hardening and CI guards. That work was real and it found real production bugs, but it was **not the port queue**, and nobody told you the queue had stalled. That is the honest core of this audit.
2. *"I haven't seen any changes from the UIs I asked you to wire."* Three compounding reasons, ranked in §5 — the largest is (1); (2) is checkable in 10 seconds.
3. *"The folder `Axal VC platform` isn't configured in the main."* Correct observation, and it is by design **as far as serving goes**: the folder is the design source (a dc-runtime export — generated HTML, not app code); nothing imports it and nothing should. The porting mechanism is rebuilding each canvas as React in `frontend/src/`. The real measure of "configured in" is port coverage — and that is the 4/107 CURRENT number above. Your instinct is right even though the mechanism is different.

## 2. The 10-second production check (only you can run this)

The committed bundle's entry file is **`/assets/index-ZC6sOrQa.js`**.

1. Open `https://axal.vc` in a private window → View Source → find the `<script src="/assets/index-…`.
   * Says `index-ZC6sOrQa.js` → production runs the current build; everything in §4 is live for the right role.
   * Says anything else → **production is running an older build.** Fix: from Replit, `npm run deploy` (never bare `wrangler deploy`), then `npm run verify:live`.
2. While there: DevTools → Network → confirm that script loads **200**. A 404 on the apex assets is a known failure mode (GOTCHAS, apex/app.axal.vc asset split) and would make the site look unchanged or blank regardless of what merged.

## 3. Canvas scoreboard — all 107 canvases

| Status | Count | Meaning |
| --- | --- | --- |
| CURRENT | **4** | Live route matches the canvas. Done. |
| UPGRADE | **42** | Route exists; canvas evolved past it. Needs re-integration. |
| RESKIN | **7** | Backend live; UI predates the canvas. Needs the new UI. |
| NEW | **23** | No live equivalent. Needs building. |
| OUT OF SCOPE | **27** | Spin-Out Lab canvas — Lab is live and frozen by your instruction. |
| DEFERRED | **4** | Persona-hub canvas, held per /studio freeze. |

*(Parse note: 107 rows parsed from ROUTE_MAP.md; its prose header says 107 canvases — the delta is rows the census itself merged or marked as stale duplicates.)*

### The work queue (72 canvases), grouped

**UPGRADE — route exists, canvas evolved past it**

- Account (shared) — `/settings`, `/settings/:section`
- Admin · Super (super-admin) — `/admin`
- Advisor Canvas (advisor) — `/advisor/advisory/*`, `/advisor/network/*`, `/advisor/research/*` + a new advisor Home and Expertise surface
- Advisor Detail · Practice (advisor) — `/advisor/advisory/*` (canvas proposes `/practice/*` — do not mint that)
- Advisory Practice (advisor) — `/office-hours`
- Auth and Onboarding (public / shared) — `/login`, `/register`, `/onboarding/persona`, `/onboarding/founder\|investor\|partner`
- Axal VC Website (public) — `/`, `/about`, `/for-founders`, `/for-investors`, `/spinout-lab/brief`, `/contact`, `/articles`, `/directory`
- BD Console (partner) — `/partner/operations/*` + `/needs`
- Cap Table Pro (founder) — `/raise/capital/cap-table` (also `/build/captable`)
- Co-marketing (partner) — `/comarketing`
- Company Settings (founder) — `/company-settings`
- Contracts · Subsidiary (admin) — `/admin` (Legal / Agreements tabs)
- Contracts · Super (super-admin) — `/admin` (Legal → Templates)
- Deal Flow (investor-LP (GP)) — `/pipeline` + `/deals/:dealId`
- Due Diligence (investor-LP (+ founder side)) — `/due-diligence`, `/due-diligence/:uid`, `/due-diligence/requests`
- Emails (shared) — — (email template layer)
- Events (shared / public) — `/events` + `/events/:slug`
- Founder Wellbeing (founder) — `/wellbeing`
- Fund Administration (admin (GP)) — `/funds`, `/funds/capital-calls`, `/funds/accounting`
- GP Application Review (admin) — `/admin/lp-applications`
- Help Center (shared) — `/docs`
- Legal & Capital Engine (shared (founder + GP/admin)) — `/legal-capital`
- Liquidity & Secondaries (shared (founder + investor)) — `/liquidity`
- Metrics (founder) — `/build/metrics`
- Navigation Shell (chrome) — — (`frontend/src/sidebarConfig.js` + `SidebarNav` in `App.jsx`)
- Notifications (shared) — `/settings/notifications` (existing prefs) + `/notifications` (new full page)
- Pages · Founder Build (founder) — `/execution` (+ `/execution/board`, `/execution/roadmap`, `/build/metrics`)
- Pages · Founder Raise (founder) — `/raise/pitch`, `/raise/capital`, `/raise/legal-engine`, `/liquidity` (existing)
- Pages · Investor Deals (investor-LP) — `/deals`, `/pipeline/screening`, `/pipeline/commit`, `/pipeline/transactions` (existing)
- Pages · Investor Fund (investor-LP) — `/funds`, `/funds/capital-calls`, `/funds/accounting`, `/lp-reports` (existing)
- Pages · Investor Portfolio (investor-LP) — `/portfolio/positions`, `/portfolio/updates` (existing)
- Pages · Partner Pipeline (partner) — `/needs` (existing; `/partner/operations/engagements` for the retainer half)
- Portfolio (investor-LP) — `/portfolio/health\|updates\|positions\|performance\|growth`
- Pricing (public) — `/pricing`
- Quarterly Report (investor-LP) — `/lp-reports`
- Refer & Earn (shared) — `/referrals`
- Round Manager (founder) — `/raise/capital/pipeline`
- Scoring Engine v2 (investor-LP / partner / admin) — `/scoring`
- Signals (founder (+ advisor mode)) — `/signals`
- Support · Subsidiary (admin) — `/tickets`
- Team (founder) — `/build/team`
- Trust Center v2 (shared) — `/trust`

**RESKIN — backend live, UI stale**

- Get Paid & Invoicing (partner (+ founder pay side)) — `/services` + `/needs` / `/build/marketplace`
- Network (shared) — `/advisor/network/{introductions,relationships,organizations}` (existing)
- Pages · Founder Grow (founder) — `/founder/growth/{talent,customers,partnerships,capital,experts}` (existing)
- Pages · Founder Network (founder) — `/advisor/network/{relationships,introductions,organizations}` (existing)
- Pages · Founder Research (founder) — `/advisor/research/{ai,market,companies,funds,documents}` (existing)
- Pages · Investor Network (investor-LP) — `/advisor/network/{relationships,introductions,organizations}` (existing)
- Pages · Investor Research (investor-LP) — `/advisor/research/{ai,market,funds,documents}` (existing) + `/market-intel`

**NEW — nothing live**

- AIRail (chrome) — — (right-rail component, no route)
- Admin · Subsidiary (admin) — `/admin/subsidiary` (new)
- AdminRail (chrome) — — (right-rail component)
- AdvRail (chrome) — — (right-rail component)
- Data Room (founder + investor-LP) — `/raise/data-room` (new)
- Detail Layer Canvas II (advisor + partner) — — (IA spec, not one screen)
- Detail Layer Canvas (founder + investor-LP) — — (IA spec, not one screen)
- DetailRail (chrome) — — (docked rail component)
- EmberRail (chrome) — — (docked rail component)
- ForgeRail (chrome) — — (docked rail component)
- Founder Journey Map (admin (internal)) — — (audit artifact, not a surface)
- Founder Workspaces Canvas (founder) — — (IA spec, 6 workspaces)
- Funds · Fabric (super-admin) — `/admin/fabric` (new); fund console reuses `/funds`
- InvRail (chrome (investor)) — — (right-rail component on investor surfaces, no route of its own)
- Messages (shared) — `/messages` (new)
- Mobile Canvas (chrome) — — (responsive spec across all authed surfaces)
- Pages · Advisor Cohorts (advisor) — `/advisor/cohorts/{founders,guidance,this-week,calendar,outcomes}` (new)
- PartnerRail (chrome) — — (component, not a route)
- Perks & Products (shared (founder + partner)) — `/perks` (new)
- Send for Signature (shared) — `/legal/send` (new)
- Support Security · Super (super-admin) — Support → `/tickets`; Security → `/admin/security` (new)
- System Sheet (chrome) — — (design-system reference)
- Team · Authority (admin / super-admin) — `/admin/team` (absorbs) + `/ic`

## 4. What IS on main and in the bundle — verified this audit, not recalled

| Surface | Route | Verified how |
| --- | --- | --- |
| Deal Flow: pass taxonomy, SLA banding, why-we-passed | `/deals`, `/pipeline/*` | DealsPage: 818 lines, 12 API refs, 0 fixtures |
| Metrics + investor reporting | `/build/metrics` | 478 lines, 7 API refs, 0 fixtures |
| Liquidity & Secondaries (ROFR, tender, settlement) | `/liquidity` | 712 lines, 9 API refs, 0 fixtures |
| Fund admin + GP controls (institutional-tier-gated) | `/funds`, `/funds/*` | 562 lines, 11 API refs; twelve GP controls de-adminned (PR #328) |
| Cap Table incl. **409A safe-harbour panel** | `/raise/capital/cap-table` | CapitalWorkspacePage embeds CapTablePage which mounts `captable/SafeHarbourPanel.jsx` — reachable, wired |
| Fund performance/accounting on live D1 or "Not recorded" | `/funds/accounting` etc. | fundAnalytics.js fixture deleted; guard prevents fabricated fiduciary data (PR #324) |
| Referrals rebuild (submissions, no Stripe Connect) | `/settings/referrals` | PR #316; old UI deleted |
| Design shell: tokens, Inter/Roboto Mono, ui/ primitives, AssistRail (Eadwyn), SidebarNav | app-wide | Inter in shipped CSS; Eadwyn in shipped `ui-*` chunk (PRs #318/#322/#323/#332/#335) |
| Research/Network/Marketplace consolidation; Growth withdrawn | various | PRs #319–#321, #325–#326, #333 |
| E-sign origination de-adminned + rate-limited | `/legal/send` | PR #327 |
| 25+13+6 silent SQL production defects fixed; 7 CI schema guards | worker-wide | PRs #336–#343 (invisible in UI by nature) |

Backend drift cannot silently regress: `npm run test:drift` enforces that every `/api/*` method in `frontend/src/lib/api.js` has a worker route.

**Where to look, logged in as admin, once §2 confirms the build:** Deals → pass a deal (reason modal); Build → Metrics; Liquidity & Exits in the investor nav; Funds → Accounting ("Not recorded" honesty rows); Raise → Capital → Cap Table tab → 409A panel; Settings → Referrals; every page: Inter type + the Eadwyn rail.

## 5. Why it looked like nothing changed

1. **Most of what you were comparing against was never ported.** You look at the canvases; 72 of them have no faithful live counterpart. The shell changed (fonts/tokens/rail), but page-by-page the app still mostly shows its old layouts. This is the dominant cause and it is a scheduling failure, not a mystery: after Aug 27 the sessions chose hardening work over the port queue, and reported the hardening as progress without flagging that the ports had stopped.
2. **Deploy vintage is unverifiable from CI** — if the worker was last deployed before the recent merges, none of §4 is visible at axal.vc no matter what merged. §2 settles this in 10 seconds. Note the related known trap: GitHub Pages still serves apex paths the worker route table does not claim, and a stale-asset 404 there renders blank pages.
3. **Much of the merged work is deliberately invisible** — tenancy scopes, fail-closed limiters, SQL fixes, CI guards, money-cents enforcement. Real, shipped, and produces zero pixels.
4. **Some visible work is role/tier-gated** — GP controls need the institutional tier; founder Liquidity needs the studio tier; several surfaces differ per role view. An account without the tier sees the old (or no) surface.

## 6. Claims that failed the audit (naming them plainly)

- **Task #122 "Integrate BD Console — completed":** the five `/partner/operations/*` tabs are fixtures with zero API calls, today. Whatever #122 shipped, it was not these tabs. The census said so on Aug 27 ("live operations tabs are static mock data") and the correction was never acted on.
- **The `/advisor/advisory/*` cluster (5 tabs):** same — fixtures, zero API calls, flagged in the census, untouched.
- **"Remaining canvas phases blocked on user decisions":** mostly untrue by Aug 29. DECISIONS.md shows the D-series essentially all RESOLVED (one OPEN: the /marketplace + /legal route split). The queue was not blocked; it was not scheduled. The one genuinely blocked item is `/office-hours` (Advisory Practice, task #124) — blocked by **your own** do-not-touch instruction.

## 7. The plan to close the gap (proposed waves)

- **Wave 1 — stop showing users fake data (2 surfaces, 10 pages).** `/partner/operations/*` (BD Console canvas) and `/advisor/advisory/*` (Advisor Detail · Practice canvas): wire every tab a live backend supports (`needs.ts` already has RFP + quotes; `advisory.ts`, `consultations.ts`, `esign.ts` exist), build the canvas features on top, and delete `data/partner/operations.js` + `data/advisor/advisory.js` with a fixture guard so mock surfaces cannot return.
- **Wave 2 — highest-traffic founder/shared UPGRADEs:** Company Settings (member CRUD backend already live, zero UI), Account/Settings 4 new panes, Cap Table Pro remaining deltas (SAFE cap-vs-discount detail, pool burn-down), Co-marketing deltas, Notifications.
- **Wave 3 — the public face:** Axal VC Website 8-section marketing site, Pricing, Events, Help Center (these are what anyone sees first, but they carry no user-data risk, hence after Wave 1).
- **Wave 4 — NEW surfaces with clear backends:** Data Room, Messages, Perks, Send-for-Signature polish, admin Fabric/licensing tier.
- **Excluded until you lift the freezes:** `/office-hours` (Advisory Practice), `/studio`, `/founder`, `/partner-portal`, Spin-Out Lab (all your explicit do-not-touch list); the 4 DEFERRED persona hubs.

Each wave ships as its own PR train with the census row upgraded to CURRENT as the exit criterion, so ROUTE_MAP.md becomes the running scoreboard instead of a snapshot.

## 8. What I need from you

1. The §2 result (which `index-*.js` axal.vc serves, and whether it 200s).
2. Confirm Wave 1 → 2 → 3 → 4, or reorder.
3. Say whether the `/office-hours` freeze (task #124) lifts — it is the only UPGRADE canvas blocked by instruction rather than scheduling.
