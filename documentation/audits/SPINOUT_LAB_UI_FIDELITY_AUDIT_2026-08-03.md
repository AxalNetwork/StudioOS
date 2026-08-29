# Spin-Out Lab UI Fidelity Audit — 2026-08-03

Comparison of every founder-facing Spin-Out Lab page in `frontend/src/pages/` against the
original Claude Design prototypes. **Sources of truth:** the design bundle checked into
`spin-out-lab-pipeline/project/` (`Spin-Out Lab Workspace.dc.html` + per-tool `.dc.html`
files + `support.js`) — verified byte-identical to the `attached_assets/` exports of design
project `6ec1e7a0-cc8f-42ed-8ec3-51b3e6c41b59` — and the same folder on `main` (they are one
and the same directory). The claude_design import MCP was not connected in the audit session;
since the in-repo bundle *is* that project's export, it was used directly. If the remote design
changed after the export, that delta is invisible to this audit — flagged, not assumed.

Method: one read-only audit per page↔design pair (9 parallel passes), each reading the full
design markup **and** its `text/x-dc` data script (where option lists, states, and handlers
live), then the full page source. Mock content (fake companies/people/numbers) is treated as
placeholder, not a finding. A finding = element, option list, control, panel, modal, state,
interaction, layout structure, or copy wording present in the design but missing/altered.
"Needs backend" never excuses a missing control — it is recorded and flagged.

## Summary — missing per page

| Page | Missing elements | Missing options | Verdict |
|---|---|---|---|
| SpinoutLabWorkspace | 6 | 1 (17 sub-options) | Faithful structure; missing week-overview page, Week-1 summary body, interview lightboxes |
| SpinoutLabStartupPage | 5 | 0 | High fidelity (#176 verified complete); 3 affordances short |
| SpinoutLabMarketPage | 44 | 34 | **FAIL** — assumptions drawer, competitor CRUD, positioning map, source CRUD, sparkline, readiness checklist, entire MI-Signals view absent |
| SpinoutLabRoadmapPage | 6 | 1 | PASS with fixes (pill groups, modal chrome) |
| SpinoutLabDiscoveryPage | 11 | 13 | Skeleton kept; evidence model (severity/ICP-fit/WTP/format/source), add-lead, detail drawer, deck-push actions missing |
| SpinoutLabRevenuePage | 13 | 8 | Shell kept; verification grading, proof vault, investor preview, entry ledger missing |
| SpinoutLabPitchDeckPage | 14 | 3 | Grid faithful; share sheet + editor depth missing |
| SpinoutLabBrandPage | 20 | 8 | Manager faithful; inline page editor (incl. reachable Publish) + log-interview modal absent |
| SpinoutLabCapTablePage | 13 | 6 | Ledger faithful; 5 of 6 design modules gutted |
| SpinoutLabUseOfFundsPage | 12 | 2 | Allocator strong; export path, burn alert, milestone mapping, scenarios interactivity missing |
| SpinoutLabCapitalPage | 16 | 4 | ~40% of design surface; pipeline views, round overview, right rail, tracker, SAFE card missing |
| SpinoutLabCofounderAgreementPage | 19 | 3 | Generator ≠ design's negotiation/execution console |
| SpinoutLabAdvisorsPage | 12 | 3 | Detail drawer + request-match missing; breakdown data fetched but unrendered |
| SpinoutLabOfficeHoursPage | 11 | 2 | Closest port; **1 crash bug** (undefined `user` on booking success) |
| SpinoutLabProfilingPage | 8 | 2 | Skeleton faithful; archetype card + toolbar gaps |
| SpinoutLabScoringPage | 20 | 1 | Read surfaces faithful; ALL interactive surfaces missing (drawer/modal/toolbar) |
| SpinoutLabPage | 3 | 1 | Faithful; 2 modals + advisor chip + decorative jurisdiction selector |
| SpinoutLabMarketingPage | 4 | 1 | Drops jurisdiction bar, brief button; pipeline mis-rendered as all-locked |
| SpinoutLabApplyPage | 0 | 0 | **Fully faithful** ✓ |
| SpinoutLabBriefPage | 0 | 0 | Content complete; slide geometry (16:9 / 960px / gradient outcomes slide) diverges |
| **TOTAL** | **237** | **93** | |

## Priorities

**Critical (blocks Lab operation)** — Office Hours booking crash (`markMilestone(user,…)` on
undefined `user`); Brand Publish unreachable despite existing API; Use of Funds has no export
path; Cap Table ledger unsortable + advisors un-addable; Capital export/preview/pipeline views;
Co-founder Agreement clause workflow + signer/finalize + solo path; Scoring drill-down/export;
Discovery add-lead + deck-push + export summary; Revenue investor preview + entry ledger;
Pitch Deck share sheet (expiry/PIN/QR unreachable); Market Intel drawer + competitor CRUD +
positioning map; Advisors request-match + detail drawer.

**High (visual/UX fidelity)** — workspace week-overview page + Week-1 summary body + interview
lightboxes; marketing jurisdiction bar + brief download + phase statuses; brief slide geometry;
MI-Signals view; tool-chrome + quick-action rows on every tool page; per-page High rows in the
detail sections.

**Medium (copy/microcopy)** and **Low (cosmetic)** — enumerated per page in the detail sections.

## Cross-cutting findings

1. **Every tool page dropped the design's shared chrome** (3px phase stripe, tinted icon tile,
   check-in-badge, bordered week pill, module progress where applicable) **and the quick-action
   row** (Share / Export / Copy link / Preview as investor). One shared component fixes ~14 pages.
2. **Selected-state tokens**: design uses a violet (Wk1/2/4) / teal (Wk3) selected-pill system;
   pages substitute `bg-gray-900` in most places.
3. **Roboto-Mono tabular numerics** (`*-mono` class) replaced by `tabular-nums` only.
4. Several pages fetch data the design renders and then discard it (Advisors score breakdown).

## Ambiguities & conflicts (flagged, not silently resolved)

- The two Brand design variants are byte-identical in content; the non-copy variant only adds
  embedded-mode chrome. Audited against the non-copy variant (the one the page header cites).
- Scoring description: standalone design says "nine weighted dimensions"; the workspace's
  toolMeta says "all key dimensions". Page matches the workspace — kept.
- Design minimum interviews: 5 (both design files); page gates at 3 (documented in-file).
  Flagged for product decision; not changed silently.
- Print brief: `Spin-Out Lab-print.dc.html` is truncated; the `-1vkgcux` variant is canonical
  for content, the small file authoritative for print paging (letter landscape, 0.5in).
- The `analyze (python)`-style repo checks and the Replit package firewall prevent installing
  frontend deps in the audit environment — changes are verified with Bun's JSX transpiler
  (syntax) plus code review, not a full Vite build.

## Out of scope (flagged, per the requested page list)

- `Incorporate.dc.html` and `Co-founder Match.dc.html` map to `IncorporatePage.jsx` (`/incorporate`)
  and `CofounderPage.jsx` (`/cofounder`), which are not in the audited page list.
- The workspace design's inline **Studio Ops weekly-rhythm view** (`isOps`) has no owning page in
  the list; the current `/build/command-center?tab=studio-ops` surface is a different concept
  (ops-workflow Kanban). Recorded here so it is not silently skipped.
- `AxalSlide.dc.html` is a deck slide template (deck renderer, not a page).

## Restoration policy applied in the fix phase

- Restore faithfully; never simplify away design elements.
- Preserve all live backend/data integration Replit added correctly (cohort timing, milestones,
  real endpoints, guards, testids, dark mode) — merge design UI onto the live data layer.
- Where a design control has **no backend field**: ship the control disabled-with-reason or
  local-only with an honest "not saved" label when the design demands its presence; otherwise
  flag as needs-backend in this report rather than faking persistence.
- Never fabricate data (no fake investor names, fake sync states, or fake "Auto-saves" chips).

---

# Audit 9 — Workspace Hub & Startups view

## WORKSPACE HUB ↔ SpinoutLabWorkspace.jsx
MISSING ELEMENTS: 6 · MISSING OPTIONS: 1 (17 individual options in log-interview groups)

Verified matching (post-#176): Studio Ops (101, Wk2 @143) + MI Signals (65, Wk3 @167) cards ✓; badges Active/Unlocked·WkN ✓; scorecard 4/4/5/7=20 ✓ (405-414, 900); scorecard rows + 3 KPIs + chevron + ordering + header pulse chip ✓.

Findings:
- 1/2 (—): Meridian sidebar + global nav = integration-adapted, DO NOT restore.
- 3 (Low): page header sticky top-0 backdrop-blur (design 82) → static (439).
- 5 (Low): preview/graduated ring should force 100% + 2-line label (95-98) → elapsed-day % (388, 471, 479-482).
- 6 (Low): segmented bar pulse dot on active label; all labels violet (109-119) → dot absent, non-active greyed (508-510).
- 7 (Low): week cards wsGlow 3s infinite + accent border on browsable + title tooltip (134) → hover shadow only (531-540).
- 8 (Med): 2A pill copy "Active week"/"Completed"/"Preview" (2367-2369) → long variants (627-631).
- 9 (Low): 2A card glow on active (160).
- 10 (Low): deliverable action button render-disabled when locked instead of omitted (202 vs 732).
- 11/12/13 (Low): tools grid xl 4-col (214); 2-col split 1fr/2fr (184); container full-width (126) vs max-w-6xl (437).
- 14 (Low): tool card "Open →" real button (225) vs span (798-802).
- 15 (Med): tool-desc copy drift ×7 vs design strings (1750-1774): Market Intel 'TAM/SAM research (read-only)', Profiling 'Skills, values, archetypes, and assessment progress', Studio Ops 'Weekly cadence and accountability', MI Signals 'Full investor intelligence', Revenue 'Real revenue & investor-ready proof', Cap Table 'Founder stock & vesting', CofA 'Signed founder terms', Capital 'Fundraise & introductions', UoF 'Allocation & budget plan'.
- 16 (Low): locked-week preview pills incl 'KYC' Wk4 / 5 pills Wk3 (1812, 1815) vs every feature + Compliance (1008-1018).
- 17 (High): "View week →" must open WEEK OVERVIEW page (349, openWeek) → currently selects + scrolls (424-427, 1002).
- 18 (High): WEEK OVERVIEW PAGE absent (1254-1290): back btn, Week N label + badge, H2 name, 3 panels What you do/What unlocks/Deliverables (content 1942-1955), "Tools in this week" auto-fill minmax(220px,1fr) grid.
- 19 (High): Week-1 summary expanded body (290-330): startup-record tile (NC initials + "Startup record created · Day N"), TAM/SAM tiles, sources line, Personal-advisor violet note, "Interviews logged · N" table (Name/Date/Key insight) → build shows deliverables checklist + tool chips (938-981). Needs market values + api.listInterviews wiring.
- 20 (Med): summary meta "Completed July 7, 2026" — derive from last milestone completed_at (286 vs 934).
- 21 (High): Interview-detail lightbox absent app-wide (1400-1456): avatar/name/title/date header, ICP chips, pain chips, quote blockquotes, insights, next-step checkboxes, "Invite to meet"/"Close"; trigger from summary table + discovery rows.
- 22/23 (High): Log Interview lightbox (1294-1398) — /build/discovery InterviewModal is smaller; add capture ×3 (Otter/AI/Manual) + Extract, Format ×4 (In-person/Video call/Phone/Async), Duration ×4 (15/30/45/60+), ICP ×6 (Strong fit/Weak fit/Wrong audience/Early adopter/Skeptic/Champion), quotes multi, next-steps checklist + add, Save as draft. Needs backend fields.

PRESERVE LIST (verbatim from audit — critical for any edit):
1. CohortDeadlineBanner (282-352) gated !graduated && !previewAllUnlocked (517-520).
2. Server-clock offset from state.server_time captured once (285-289); 1s tick (291-294).
3. timing.in_cohort gate; parseServerUtc/formatCountdown/formatLocal (260-280).
4. Frozen: timing.frozen/frozen_week, red banner, testid cohort-frozen-banner (304-316).
5. Grace: grace_until countdown, amber banner, testid cohort-grace-banner (317-329).
6. Deadline: current_deadline_at, <24h urgent switch, testids cohort-countdown-banner/-value, "midnight Delaware time · {local} your time" (330-344).
7. Next-unlock chip from timing.weeks (302, 345-349), testid cohort-next-unlock.
8. State contract: week, days_remaining, milestones (string OR {key|milestone_key,completed_at,week}), unlocked_features, cohort, started_at, is_incorporated, application.company_name.
9. graduated behaviors (357, 388, 448, 486-489); dayNum = SPRINT_DAYS - days_remaining (44, 359).
10. previewAllUnlocked path (373, 377, 479-482) — AdminSpinoutJourneyPreview consumer.
11. featureUnlocked precedence: preview → graduated → unlocked_features → ungated → unlockWeek (376-380).
12. TOOL_INFO flags uncounted/ungated/unlockWeek/comingSoon + every `to` route (49-102).
13. countDeliverables altGroup either/or + optional excluded (213-237) + "either / or" badge (704-708).
14. milestoneKeySet tolerance (239-246).
15. Exports TOOL_INFO/WEEK_DEFS/countDeliverables/milestoneKeySet — SpinoutLabStartupPage.jsx:25 imports; signatures frozen.
16. Partial progress bar keysDone/keys.length (684-685, 723-730); keyOutput (408).
17. All data-testids (spinout-workspace, workspace-cohort-chip, workspace-week-chip, workspace-company-name, preview-all-weeks-badge, workspace-days-remaining, workspace-week-card-N, workspace-active-week-title, workspace-cta-{key}, workspace-deliverable-{slug}, workspace-tool-{key}, workspace-scorecard, scorecard-status-wN, workspace-kpi-*, workspace-week-summary-N, workspace-preview-week-N).
18. A11y: locked disabled; tool cards role=link + keyboard; dark-mode pairs.

Fix specs: #17/#18 week-overview as internal view or /spinout-lab/week/:num; WEEK_DEFS[n].panels={doYou,unlocks,deliverables} seeded from design 1942-1955; auto-fill tools grid; gate weekBrowsable. #19 2-col body: left record tile + TAM/SAM + advisor note; right interviews table (listInterviews). #21 modal per design 1400-1456. #22 extend InterviewModal.

## STARTUPS VIEW ↔ SpinoutLabStartupPage.jsx
MISSING ELEMENTS: 5 · MISSING OPTIONS: 0
#176 VERIFIED COMPLETE: modal thesis (645-651 ✓ design 590-591), Team (653-662 ✓ 592-595), pre-formation note exact wording (671-675 ✓ 596). Extra data-room chip strip in modal = addition, fine.
- 1 (High): Share header button (428) — needs backend share-token.
- 2 (High): logo-upload affordance "+" badge + picker (455) — needs backend logo field.
- 3 (High): "View data room" button in card header (505) → link to /spinout-lab/capital. BUILDABLE NOW.
- 4 (Med): modal team row equity value right-aligned (594) — render "TBD". BUILDABLE NOW.
- 5 (Low): stripe + icon tile chrome; 6 (Low) "Edit" label; 7 (Low) founder bio (needs backend); 8 (—) week-gated cofounder buttons = documented, keep; 9 (Low) program-bar tooltips + status.

# Audit 8 — Market Intel (FAIL) & Roadmap (PASS w/ fixes)

## MARKET — isMarket 610-816, drawer 1458-1549, isMISignals 1093-1200 ↔ SpinoutLabMarketPage.jsx
MISSING ELEMENTS: 44 · MISSING OPTIONS: 34 (geography 5, target year 4, methodology 2, maturity 3, segment chips 3, comp category 3, comp stage 10, source type 4)

Existing API on page (bind to these): load: spinoutLab.state(); api.listProjects()→pickLabProject; miSectorCompass(); miFounderLens(); miSources(); miCitations(sector,8); miFitFounder(project.id). Mutations: updateProject({tam,sam,som}) (190); markMilestone 'market_sizing_completed' (194) + 'market_research_shared' (121). State: methodOpen, editOpen, form{tam,sam,som}, saving, saveError, shared; derived sectorMatch/picks/srcRows/liveCount/citRows/matches/fitUnavailable; gates week / deckUnlocked>=2 / advisorsUnlocked>=3. Project has NO market_category/geography/year/population/acv/sam_pct/win_rate/runway/capacity/cagr/growth_driver/maturity/segment_filter. UNUSED-but-available: api.miGeography(), api.competitors.* (2791-2803: list/analyze/addCandidate/removeCandidate), api.crunchbaseCompetitors (1482), api.deckPositioning (1610).
MUST PRESERVE: loading/error/inactive/no-project states (215-244, 283-290); shareResearch + both milestones; NDA masking + honesty copy (508, 520-523); data-testids; dark-mode; exported fmtMoney (40), matchSectorRow (53).

Build specs:
A. ASSUMPTIONS DRAWER (rows 5-24, Critical/High): fixed overlay rgba(24,24,27,.35) z-75 → right panel 400px full-height flex-col, shadow -20px 0 50px -20px → header "Edit Market Assumptions" + × (OMIT "Auto-saves" chip — would lie) → scroll body gap-22: amber deck notice → Market definition [category text, geography select ×5, target-year select ×4] → TAM [Top-down|Bottom-up toggle, population, ACV, TAM override] → SAM [% reachable, segment chips] → SOM [win rate, runway, capacity] → Growth [CAGR, driver textarea, maturity Early|Growing|Mature] → sticky footer violet "Recalculate market sizing" + caption. Selected seg style #7c3aed bg (2195-2196). Recalc math (1596-1605): tamCalc=population*acv/1e6; tam=override||tamCalc||current; sam=tam*samPct/100; som=sam*winRate/100*2.2; tween 800ms ease-out cubic 1-(1-p)^3 ~16ms ticks (1581-1595); close; PUT updateProject; markMilestone. Only tam/sam/som persist — other 12 fields LOCAL-ONLY w/ honest label (needs backend columns or project_market_assumptions table).
B. COMPETITOR GRID+FORM (rows 28-32, Critical): card header + "+ Add competitor" ghost → inline form (grid 1.4fr/1fr name+category select; note input; 1fr/1fr share+stage select; Cancel / Add) → 3-col grid cards: remove × top-right (20×20 hover #f4f4f5), title + category chip (Direct rose/Indirect amber/Adjacent gray, 2091), note, footer violet "N% share" + gray stage chip. Empty name → cancel silently; share normalization appends %; cap 6. Bind api.competitors.list()/analyze() + addCandidate(analysisId,{name,category,summary})/removeCandidate; category maps Direct→direct; share+stage → persist in candidate summary blob (no backend field); crunchbaseCompetitors(project.id,6) can seed.
C. POSITIONING MAP (rows 33-34, Critical): under grid, border-top + "Where you fit" → flex: vertical rail Broad/Narrow (h140) + SVG 220×140 #fafafa/#eeeef2 r10: gray #d4d4d8 r4 dots per competitor, violet #7c3aed r5 You dot + <text dy=-9>You</text> → below row Low-cost/Premium pl-34 → caption max-w 320. Hash placement (2094-2096): h=fold(name,h*31+cc)>>>0; x=14+(h%80)+(W-28-80)*((h>>4)%100)/100; y=14+((h>>2)%100)/100*(H-28); You=(0.72W,0.28H) fixed. Keep "Generate positioning" as secondary CTA.
D. ADD-SOURCE (rows 36-39, High): header "+ Add source" → form (#fafafa r11): title/URL input, type select Report/Interview/Article/Manual entry, Add violet / Cancel; founder rows: doc icon, title + type chip (Report violet/Interview green/Article blue/Manual gray, 2073), "Added {date}", hover-reveal ×. NO backend endpoint — local-only + "not saved yet" label; aggregator rows stay non-removable. Footer copy "Minimum 2 sources required…" (718).
E. DYNAMICS SPARKLINE (rows 41-42, High): svg viewBox 0 0 220 48 h44, path #c4b5fd w2, circle r3.5 #7c3aed at idx 2. Math (2077-2088): v_i=tam*(1+cagr/100)^(i-2), i∈0..4; pad 6; x step (220-12)/4. CAGR local until backend. Fact rows: CAGR pill ↑x%/yr, Peak window, Growth driver, Maturity chip, Tailwind.
F. READINESS PILL+POPOVER (rows 2-3, High): header chip "Market Intel {pct}% complete" clickable relative → popover 280px top-26 z-40: title, 9 rows (✓ green circle / hollow ring), violet bar, "Investor-ready threshold: 70%. You need N more item(s).", "Continue →". Checklist (2181-2192): TAM/SAM/SOM defined; Sources ≥2 (citRows or founder); CAGR added; Competitors ≥3; Positioning completed (flag); Assumptions reviewed (flag); Signals reviewed (Wk3: advisorsUnlocked && matches.length). pct=round(100*done/9); band ≥70 green/≥40 amber/rose; remaining=max(0,ceil((0.70-pct/100)*9)).
G. MI-SIGNALS VIEW (rows 45-49, High): section/tab under market. Layout 1fr/340px. Left: (1) violet profiling banner ◎ + Profiling link; (2) founder-signal chips archetype violet/sector gray/stage gray/traction green; (3) 4 stat tiles: investor count · strong (≥70) · avg % · "{n} gaps"; (4) ranked table 1.5/1.2/.9/.9/1.1fr Investor/Focus/Stage/Check/Signal + "Sorted by signal strength"; rows clickable ▸/▾, fund+partner stacked, monospace ●●●●○ by band, {score}% chip; expanded 2-col on #fbfbfd "Why it matches" ✓ / "What weakens it" –. Scoring (2154-2170): score=round(100*Σw(met)/Σw); dots=clamp(round(score/20),1,5); band ≥70 Strong green/≥45 Moderate amber/Weak gray; sort desc; single-open. miFitFounder returns only {investor_id_hash, score, nda_required} — focus/stage/check/partner/criteria NEED BACKEND; render pseudonymous w/ available data; NDA-gate names.
Also: Week-2 read-only banner (611-614, Med); "Edit Market Data" CTA copy (409); methodology 3 sub-cards + amber caveat + "Update assumptions →" (634-655, Med); right-rail cards (1183-1197, Med/Low); locked preview Focus/Stage/dots (795-812, Med, needs fit payload).

## ROADMAP ↔ SpinoutLabRoadmapPage.jsx — PASS with fixes
MISSING ELEMENTS: 6 · MISSING OPTIONS: 1 (XS)
- 1/2 (High): value High/Medium/Low + effort pill-button groups (924-930) → selects (557-568). Swap to pills: padding 6/11, r8, w600, selected #7c3aed bg/white/violet border, unselected white/#52525b/#e4e4e7. Keep Status as third group or select (ADDITIVE preserve, backed by MVP_STATUSES).
- 3 (Med): effort XS — BACKEND-GATED: MVP_EFFORTS={S,M,L,XL} (progress.py 1122 + worker mirror) rejects XS → ship S/M/L/XL + note divergence. Keep XL.
- 5/6/7/8/9/10 (Med/Low): modal subtitle "Rate its value and effort — priority is derived, not chosen" (918); Cancel button (935); save label "Add to priorities" (create case); disabled-until-title (opacity .5); "Priority reason" label; derived-priority footnote copy (932).
- 12 (Med): group header colored dot green/amber/gray (862).
- 20 (Med): milestone vertical connector line, hidden on last (904).
- Low: cycle note green when active (878); handoff card violet gradient (887); "agile" word (889); OKR count emerald (825); default effort.
PRESERVE: Week-2 locked state (287-296); OKR+feature CRUD + okrs_created ownership guard (199-203); mvp_scoped effect (263-266); Status selector + XL; Kanban link (316-318); buildTimeline honesty; exports krProgress/buildTimeline/MILESTONE_LABELS; testids; dark-mode.
API: listOkrs/createOkr/updateOkr/deleteOkr; listMvpFeatures/create/update/deleteMvpFeature; backend contract MVP_VALUES/EFFORTS/STATUSES + _mvp_derived (progress.py 1121-1140).

# Audit 5 — Customer Discovery & Revenue

Chrome: embedded chrome = stripe+back+icon+name+badge+desc; no module bar expected (mkActive). Discovery reproduces back/icon/name/badge/desc (288-296); Revenue adds week pill (326-339, 370-372). Only 3px stripe dropped in both.

## PAIR A — Customer Discovery.dc.html ↔ SpinoutLabDiscoveryPage.jsx
MISSING ELEMENTS: 11 · MISSING OPTIONS: 13

Key rows (design → build):
- A1 (High): 3-step Log Interview modal in-page (35, 256-314) → delegated to /build/discovery flat form, no stepper (DiscoveryPage 307-313, 576-696). Restore 3-step stepper (Contact / ICP & Pain / Quotes & Insights).
- A3-A11 (High/Med, cat 2): missing interview evidence fields: Company/segment (273); Format pills Call/In-person/Async (277); Source pills Warm intro/Cold outreach/Community/Existing user/Brand & Pages (278); ICP fit Strong/Partial/Not ICP (283); per-pain severity Need/Good/Nice (288); Willingness to pay (294); Must-have/blocker (295); Notable quote + Deck-eligible checkbox (301-302); Follow-up pills Invite to beta/Invite to pilot/Request intro/No further action (305). ALL need backend fields.
- A13 (High): interview detail drawer (317-339) → rows not clickable (499-530). Build read-only drawer; "Invite to meet" reuses inviteWaitlistCustomer (217-218).
- A19 (Critical): "+ Add lead" button + modal (name/role/company/email/audience/note, disabled-save) (102, 229-253) → absent everywhere. Build manual lead capture on waitlist endpoints (91, 203-227).
- A20 (High): audience filters Customers/Advisors/Co-founders/All inbound (101) → none (391-396).
- A23 (High): ICP pre-score chip Likely/Possible/Unclear/Likely non-ICP (112) → needs backend.
- A26 (High): lead actions Qualify/Add to beta/Route to Advisors/Route to Co-founder/Archive (123) → only Convert/Invite/Follow-up (427-454); PRESERVE existing 3 + milestone side effects (206-225).
- A30 (High): stacked need/good/nice pain bar (82-86) → single-colour (380-382). Needs severity.
- A32 (Critical): per-pain "Send to Problem slide" ⇄ "✓ On Problem slide" toggle (89) → absent. Deck-pin flag needs backend.
- A38 (Med): min interviews = 5 (137, 440; workspace 1945) → 3 (jsx 29, documented). Reconcile to 5.
- A39 (High): ICP fit summary panel (stacked bar, legend, confidence box, refine note) (170-184) → replaced by Hypothesis panel (542-571). ADD panel; KEEP hypothesis panel (additive).
- A44 (Critical): "Export discovery summary" button + "✓ Summary sent to Problem slide" (221-222) → replaced by link (650-666). Build export action from `derived` (181-184); enabled when 4 checks pass.
- Low/Med: severity legend (71), breakdown counts (88), funnel arrows (64), "Qualified" label (431), quote col header (149), source chips (157), data room count+View all (204), readiness labels (499-504), stripe (29), shared pill helper (chips reimplemented 5 ways).

Verdict: skeleton reproduced; evidence model stripped (severity, ICP fit, WTP, must-have, quote/deck-eligibility, format, source). Deck-facing write actions + Add-lead + detail drawer missing everywhere. /build/discovery covers logging only, narrower than design.

## PAIR B — Revenue.dc.html ↔ SpinoutLabRevenuePage.jsx
MISSING ELEMENTS: 13 · MISSING OPTIONS: 8

Key rows:
- B1 (High): mode tabs "Week 3 · Generate"/"Week 4 · Prove" + modeNote banner (42-44, 51) → absent. Pure client.
- B5-B8 (Critical/High): "Preview as investor/Exit investor view" toggle (48); hides add-source block (65), drops unverified rows (295), swaps tableNote/emptyMsg (90, 115). Pure client state.
- B9 (High): "Verified revenue %" KPI w/ threshold colour (321) → "Metric snapshots" (318). Needs backend proof status.
- B12-B13 (High): "Import revenue document" card + modal (dropzone, formats, column-mapping preview ×4, "Validate & import · attaches proof to data room") (216-227) → absent. Needs backend.
- B16-B17 (High): Stripe connect modal + scope checkboxes (recurring/one-time) (204-214) → bare Sync button (402-410). PRESERVE honest 404/stripe_not_connected handling (222-241).
- B18-B20 (Critical): per-entry revenue form — customer, amount, date + type pills Recurring/Paid pilot/One-time/Deposit/Service (235) + "Proof attached?" Yes/No (236) → snapshot form only (656-679). Needs backend.
- B23 (High): entries table Customer/Amount/Type/Date/Status/Proof (93-109) → snapshots table (documented, 3-7). Add ledger alongside snapshots.
- B25 (High): 3-state status Verified/Supported/Manual (108) → 2-state Stripe/Manual (509-511).
- B27 (High): filters All/Recurring/Pilots & deposits/Verified/Unverified (302) → All/Stripe-synced/Manual (460).
- B32 (High): Proof vault panel (pct covered chip, doc rows, proofWarn) (143-156) → absent. Needs backend.
- B33 (High): Revenue mix & confidence panel (Verified/Supported/Manual $ + % bars) (169-179) → absent.
- B36 (High): "Send to Capital" button (165) → absent; route exists (App.jsx 1356). Buildable now + feeds-into row "Capital · diligence-ready proof" + "MI — Investor Signals · monetization readiness" (364).
- Low/Med: Share (46), Export (47) actions; KPI colours; trend stacked by type (125-135); deck bullets ×3 (162-164); teal stripe; shared pill helper.

Verdict: shell kept; evidence-quality spine (verified/supported/manual grading, proof vault, confidence panel, investor preview) swapped for metrics-snapshot log (documented but removes capability). PRESERVE: snapshot table, grants/investment caution copy (680-682), Copy investor summary.

# Audit 7 — Pitch Deck Builder & Brand

## PAIR A — Pitch Deck Builder.dc.html ↔ SpinoutLabPitchDeckPage.jsx
MISSING ELEMENTS: 14 · MISSING OPTIONS: 3

Key rows:
- A1 (High): export progress modal ("Preparing your PDF…", "Rendering 11 slides · Axal VC Spin-Out", % bar) (226-240) → button spinner + toast (352-359). Overlay driven by existing `exporting` state; then done phase w/ real filename (A2 Med). PRESERVE PDF→PPTX fallback.
- A3 (Critical): share modal shell (246-282) → onShare silently copies 24h link (257-276). Build share sheet.
- A4 (High): QR panel (255) — qrcode pkg in deps ✓ buildable.
- A5 (Med): URL readout + Copy → "Copied ✓" (257-261).
- A6 (Critical): Password/PIN toggle + 4-6 digit input (264-270) → needs backend (deckShare has no pin param). Ship toggle disabled-with-reason.
- A7 (Critical): expiry segmented Never/7 days/30 days (271-278) → hardcoded expires_in_hours:24 (262). deckShare accepts hours → BUILDABLE (null|168|720).
- A8 (Med): "Shared link active · Viewed n times" (102-104) → needs backend counter.
- A9 (High): "Full size deck"/"Exit full size" toggle, rail → floating 420px overlay (145, 518-526) → absent (455-462). Pure client.
- A10 (Med): editor layout sticky sub-nav + full-bleed canvas + fixed 460px rail (139-160) → plain grid (449).
- A11 (Med): rail header = slide title + "Slide n / 11" pill (161-164).
- A12/A13 (Med): resync amber banner (166-168) + per-field "Refresh from source" (176) → needs freshness backend.
- A14 (Med): badge wording "Auto — Week 1 Validate"/"Manual entry" (175) → "Auto"/"Editable" (310-319).
- A16 (Critical): fieldSpec ~115 fields across 11 slides (376-386) → 6 editable inputs (CONFIG 64-283). Drive SpinoutSlideEditor from per-slide spec [key,label,kind,sourceWeek]; needs backend writeback for many slides.
- A17 (Low): char counter (183; 300/120 max).
- A18/A19 (Med): currency kind w/ $ prefix (186-188); list kind chips + Enter-to-add (190-197).
- A20 (High): upload dropzone kind (199-201) → documented adaptation; reuse /brand/logo/upload.
- A21 (High): "Reset to auto-data" + "Reset to source data ✓" flash (213-214) → only Save (461-471).
- A22 (Med): footer microcopy INVERTED — design promises source unchanged (216); page says updates source data (476-478). Reconcile with actual behavior.
- Low: grid card badge fill + hover overlay (110-117); dot tooltip full sentence (121); missing-status copy (453); pending week circle glyph (463); week pill "Week 2 · Cohort 3" (A27).

Verdict: grid view faithful (banner, week pills, 11 cards, status dots, progress, 6-slide export gate ✓). Real gaps: share sheet (QR/PIN/expiry unreachable) + editor rail (~115→6 fields, no reset/refresh/resync/counters/kinds). Export functionally superior (real PDF/PPTX) but loses modal feedback. PRESERVE ensureDeck() Axal-method resolution.

## PAIR B — Brand & Landing Page(.copy).dc.html ↔ SpinoutLabBrandPage.jsx
MISSING ELEMENTS: 20 · MISSING OPTIONS: 8

VARIANT AMBIGUITY (flagged): the two Brand design files are byte-identical in ALL content/options/handlers; non-copy variant only adds embedded-mode chrome (bl-embedded CSS 29-31, root class 37, header class 63, data-props 333, embeddedClass 508). Copy = older non-embeddable cut. jsx cites the non-copy variant. No finding differs between variants.

Key rows:
- B1 (Med): logo Light/Dark version toggle (84) → documented adaptation.
- B2 (High): "Brand voice · 3 max" tag chips + add input (111-117) → needs backend column; feeds B14 header.
- B3 (High): TWO typography selects (Heading, Body) × 6 fonts (Satoshi, General Sans, Instrument Serif, Cabinet Grotesk, Inter, DM Sans) (101-105) → one font_pairing × 4 presets (436-444). Expose or document.
- B4 (Low): preview should apply chosen font stacks (106-109).
- B5 (Med): page-card thumbnails derive from template kind (video hero / before-after / form) (130, 362-368) → generic bars (491-495).
- B6 (Low): "Archived" page status (395).
- B7-B17 INLINE PAGE EDITOR (Critical/High cluster): design has full second view — top bar "← Pages"+name+template (214-218); Desktop/Mobile device tabs driving 390px↔100% (220-222); Save draft (223); Publish → "Published ✓" (224) [api.brandPublishPage EXISTS, api.js 1553 — B10 Critical buildable]; published flash banner w/ live URL + copy link (227); "Page content" panel (232); 4 content blocks Headline/Subheadline/Body/CTA (234-238) [B13 Critical]; per-block "Suggest copy" AI dropdown headed w/ voice tags (236-246) [api.brandAutofillLanding exists]; Form fields chips per audience (249-252); "Apply brand colors" toggle (253); live preview pane (258-262). Page navigates to /build/brand instead (509-511). PRESERVE DUP_FIELDS allowlist discipline.
- B18 (High): template lightbox = full scaled page render (accent bar, name 26px, tagline, video hero / before-after per kind, email+CTA row) (273) → mini bar + definition list (664-670).
- B19 (Low): lightbox explicit Close button (274).
- B20 (Med): inflow "Invite to meet" per lead (196).
- B21 (Med): "View all in {route} →" per audience section (201) → customers only (641-645).
- B23 (Med): co-founder routing target "Co-Founder Match" (356) → points at cofounder-agreement (57).
- B24-B33 LOG INTERVIEW LIGHTBOX (High cluster): entire modal absent — capture methods Otter/AI/Manual (289-294), paste + "Extract insights →" (295-300), details w/ Format pills In-person/Video call/Phone/Async + Duration 15/30/45/60min+ (303-305), pain chips + Enter-add (308-310), quotes (313-315), insights (318), next-steps checklist (319), ICP pills Strong fit/Weak fit/Wrong audience/Early adopter/Skeptic/Champion (322-323), footer Save as draft / Save interview + routing note (326). Needs backend fields (capture/format/duration/ICP).
- Low: 3 independently scrolling columns (34); week pill (35); inflow slice cap 4 (36); inflow chrome (22).

Verdict: 3-column manager structurally matches (brand rail, pages grid, audience pills, template library, inflows; real 16-template catalog swap fine). TWO whole views absent: inline page editor (publish reachable NOWHERE on page despite existing API) and Log Interview lightbox (9 sub-panels).

# Audit 4 — Cap Table & Use of Funds

## PAIR A — Cap Table.dc.html ↔ SpinoutLabCapTablePage.jsx

| # | Element/Option (design lines) | Cat | In current build? (jsx lines) | Sev | Fix needed |
|---|---|---|---|---|---|
| A1 | Chrome: 3px violet topline (33), icon tile (40), check in Active badge (44), violet week pill (51) | 3 | Partial — bare PieChart 365, plain badge 367, gray text 385 | Low | Restore chrome |
| A2 | Desc "Live capitalization ledger, vesting, and dilution modeling — synced with Carta." (46) | 5 | Different (388–390) | Medium | Documented; align remaining wording |
| A3 | Module progress bar (workspace 412–420; captable modules 1894–1901) | 1 | Absent | Medium | Add to chrome |
| A4 | Carta chip w/ sync icon + green/amber out-of-sync states (50, 575) | 6 | Gray chip only when Worker responds (368–372) | Medium | Add amber state + icon |
| A5 | "Share" (57) | 1 | Absent | High | Documented, needs backend |
| A6 | Export dropdown: "Pitch Deck format" (62), "Carta CSV" (63) | 2 | Single "Export CSV" (376–384) | High | Menu + deck-format option |
| A7 | "Copy link" (67) | 1 | Absent | Medium | Documented |
| A8 | "Preview as investor" + modal: dark slide "Capitalization", FD count, donut, group bars, dilution mini-chart (337–373) | 1 | Absent | High | Whole modal missing; reuses page data — no backend |
| A9 | Ledger filter "Advisors" (476) | 2 | FILTERS 61–67 lacks Advisors | Medium | Advisor type not modeled |
| A10 | Sortable columns w/ ↑↓ (88–90, 479–481) | 4 | Static th (449–455) | Critical | Client-side sort over in-memory ledger (229–234) |
| A11 | Vesting column + per-type values/colors (111, 457–466) | 1 | Absent | High | Documented; needs vesting fields |
| A12 | Row sub-label r.role (99) | 6 | Holder name only (468) | Medium | Add role line |
| A13 | Per-row FD% micro-bar (107) | 1 | Plain % (473) | Medium | Add bar |
| A14 | Type-colored avatars + class pills (98, 430, 456–465) | 7 | Uniform violet; plain text (465, 471) | Low | Per-type color system |
| A15 | Row hover (22) | 4 | No (462) | Low | Add |
| A16 | Ledger-footer change log (127, 577) | 5 | Top dirty banner (393–408) | Low | Copy/placement |
| A17 | "Push to Carta" button (130, 597) | 1 | Absent | Critical | Documented; needs POST /captable/push; ship disabled-with-reason |
| A18 | SVG donut 4 arcs + center FD count (139–143, 417, 485) | 3 | Flat stacked bar (681–685) | High | Donut (arc helper design 417) |
| A19 | Donut legend "Advisors" + "SAFE (as-conv.)" (484, 486) | 6 | TYPE_META lacks Advisors (55–60) | Medium | Add group |
| A20 | 5 summary cards w/ 22px mono values incl. "Shares outstanding" (154–160, 490–496) | 1 | 4 stats one card 15px (699–733) | Medium | Split cards; add missing |
| A21 | Pool utilization "0 / 1.2M" + "11% reserved · 0% granted" (493) | 5 | Different (707–712) | Low | Copy |
| A22 | Founder header "Founder stock & vesting" + as-of + vest terms (167–168) | 5 | "Founder stock & 83(b)" (505–510) | Medium | Documented |
| A23 | Founder vesting bar: progress, red cliff tick, % label, axis (182–189, 499–506) | 1 | Absent (519–544) | High | Documented; needs vesting fields |
| A24 | Amber "No agreement on file" flag (179, 506) | 1 | Absent | Medium | Add |
| A25 | SAFE conversion toggle "Convert at cap"/"Next round" (200–203, 510, 583) | 2 | Absent (550–561) | Critical | Segmented control; basis param on /captable/simulate |
| A26 | SAFE row "MFN / No MFN · Jul 2026" (217, 511) | 6 | Investor only (580) | Medium | Capture MFN + date in add-SAFE modal (791–812) |
| A27 | SAFE footer two stat blocks (227–230) | 3 | One table row (598–603) | Low | Layout |
| A28 | Pool builder 32px violet % + "post-money pool" (235–236) | 3 | Small number input (737–747) | Medium | Hero display |
| A29 | Pool range slider 5–20 w/ gradient + scale labels (237–238) | 2 | number input 0–50 (739–746) | Medium | Slider + guardrails |
| A30 | 3-state pool warning (in-range/below-10/above-15 messages) (239, 520–524) | 4 | Static sentence (749–751) | High | Conditional advisory |
| A31 | "Founder dilution from pool" before→after panel (240–251, 518–519) | 1 | Absent | High | Client-side off simulate |
| A32 | Dilution sim "Seed raise" inline slider 500K–4M live (263–267, 587–588) | 2 | Modal entry instead (617–621, 813–827) | High | Inline debounced slider (keep modal for persisted) |
| A33 | Waterfall stacked-column chart 4×4, in-slice % >7% (273–286, 545) | 1 | Numeric table only (644–664) | High | Build chart from groupLedger |
| A34 | Fixed stage set + Exit view (532–542) | 6 | Founding + real rounds (265–271) | Medium | Documented |
| A35 | Dilution "Advisors" row, legend dots, red founder cells (546–547) | 6/7 | Absent (272, 655–658) | Medium | Add row + emphasis |
| A36 | Vesting accelerator clause card: Single/Double toggle, 2-para explainer (551–553), "Insert into Co-founder Agreement →", amber out-of-date warning, "If triggered today" per-founder +N sh (312–331, 593, 554–557) | 1 | Absent | Critical | Documented; needs vesting terms; unvested = shares × (1−vested fraction) |
| A37 | Add-stakeholder modal: Founder/Advisor kind toggle (385, 602), Role field w/ dynamic placeholder (390, 601), Cancel (395), sub-copy (380) | 2 | Name + Shares only (776–789) | Critical | Add toggle/role/cancel; `advisor` type in normalizeInputs (72–80) + TYPE_META (55–60) — unblocks A9/A19/A35 |
| A38 | Shared tokens: card shadow, ct-mono, qa hover, violet selected pills (17–21, 478, 581–592, 603) | 7 | CARD no shadow; gray-900 filters (35, 432) | Low | Violet selected system |

MISSING ELEMENTS: 13 · MISSING OPTIONS: 6

Verdict: ledger/SAFE/83(b)/dilution table rebuilt on real engine, header documents most omissions. Five of six modules gone/gutted: vesting accelerator, founder vesting timeline, pool builder (slider+warnings+dilution panel), waterfall, investor-preview/share/export. Two pure-frontend omissions with no backend excuse: sortable columns, Founder/Advisor kind toggle.

## PAIR B — Use of Funds.dc.html ↔ SpinoutLabUseOfFundsPage.jsx

| # | Element/Option (design lines) | Cat | In current build? (jsx lines) | Sev | Fix needed |
|---|---|---|---|---|---|
| B1 | Chrome: topline, dollar icon tile (45, 406), check badge, week pill | 3 | Wrong icon PieChart 285; no tile; plain (287–289) | Low | Dollar icon + chrome |
| B2 | Desc "…feeds the Pitch Deck and Axal VC Spin-Out export." (51) | 5 | Different (291–293) | Medium | Axal reference dropped |
| B3 | Module progress bar | 1 | Absent | Medium | Chrome |
| B4 | "Share" (59) | 1 | Absent | High | Documented |
| B5 | Export dropdown: "Pitch Deck format" (64), "Axal VC Spin-Out format" (65) | 2 | NO export control at all | Critical | Restore menu |
| B6 | "Copy link" (69) | 1 | Absent | Medium | Documented |
| B7 | "Preview as investor" + modal: dark UoF slide w/ donut + bars (237–253), milestone efficiency table (256–262), teal Axal export panel w/ 3 stats (265–273) | 1 | Absent | High | Modal reuses values/effectiveRaise/months/burnN |
| B8 | Burn alert banner — red, "Runway below N-month threshold." + driver sentence (74–79, 349–350) | 1 | Absent; band label only (370) | High | Client-side off months/threshold/largestIdx (209–211) |
| B9 | Deck-sync chip 2 states (90, 384–385) | 6 | Green "Saved" only (301–303) | Medium | Documented |
| B10 | Draggable donut boundary handles, 3% min clamp (97–100, 301–309, 331–332) | 4 | Static donut (81–110) | High | Generalize 2-handle math to 4 boundaries for 5 sections |
| B11 | Auto-rebalancing sliders — always total 100 (106–114, 295–299) | 4 | 5 fixed sliders + hard 100% gate (jsx 331; FundAllocator 61–89) | High | Documented — restore never-invalid model, keep numeric inputs |
| B12 | Slider row: dot + name + $ + % one line; per-bucket gradient tracks (108–112, 336) | 3/7 | $ in separate legend; all violet (310–319; FA 82) | Medium | Merge + color |
| B13 | Burn derived from allocation intensity (312–313) | 6 | Manual burn input (354–361) | High | Documented — recompute runway live as allocation changes; label assumption |
| B14 | Runway card border red <6mo (119, 391) | 7 | Static (347) | Low | Bind |
| B15 | Band copy Healthy/Caution 6–12/Critical under 6 (341) | 5 | "Tight · under 12" (67–71) | Medium | Wording |
| B16 | "Largest driver" (127) | 5 | "Largest bucket" (378) | Low | Copy |
| B17 | Separate "Runway timeline · alert thresholds" card (133–136) | 3 | Folded in (386–396) | Medium | Split |
| B18 | Threshold tick markers 6mo amber / 3mo red + labels (139–141, 354) | 1 | Absent | Medium | Add |
| B19 | Threshold option "12 months" (357–358) | 2 | [6,3] only (407) | Medium | Add |
| B20 | Milestone mapping per-bucket header rows w/ dollars (163–166, 367) | 1 | Absent (424–451) | High | Documented; needs cost field on roadmap items |
| B21 | Per-milestone funded/underfunded icons + cost + efficiency (167–173, 361–365) | 1 | Raw m.key list (436–445) | High | Same |
| B22 | "Underfunded · orphaned deliverable" (170, 365) | 5 | Absent | Medium | Copy |
| B23 | Unmapped-spend warning (175–177, 368) | 1 | Absent | Medium | Add |
| B24 | "Cost per milestone · from Roadmap" (159) | 5 | Truncated (427) | Low | Copy |
| B25 | Scenario meta "Same 55/30/15 split · live" (186, 394) | 5 | Generic (457–459) | Low | Live ratio |
| B26 | Raise slider end labels $250K/$3M (191) | 5 | Absent (466–473) | Low | Add |
| B27 | Scenario cards clickable → set raise (195, 377) | 4 | Inert divs (480–484) | High | Buttons setting customRaise |
| B28 | Scenario Milestones coverage "4/6" (201, 374–376) | 1 | Absent (487–496) | Medium | Add |
| B29 | Scenario runway color by runwayColor (199, 314, 376) | 7 | Always emerald (489) | Medium | Shared helper |
| B30 | "Sync targets" title (210) | 5 | "Feeds into · live" (519) | Medium | Documented |
| B31 | Pitch Deck row: icon tile, sync status strings, Sync button (212–215, 396, 402) | 1 | Link only (521–523) | High | Documented (reads live) |
| B32 | "Axal VC 30-Day Spin-Out export" row: teal tile, status, Export button (216–219, 397, 402) | 1 | Absent — Scoring row instead (524–526) | Critical | Needs Axal export endpoint; ship disabled-with-reason |
| B33 | Shared tokens: card shadow, uf-mono, uf-handle cursors, runwayColor reuse (17–27, 314) | 7 | Hardcoded per-site (34) | Low | Centralize |

MISSING ELEMENTS: 12 · MISSING OPTIONS: 2

Verdict: allocation editor strongest (canonical FundAllocator; persists real use_of_funds/funding_needed) but trades away signature interaction (drag-donut + auto-rebalance). Right of allocation everything thinner: milestone mapping = disclaimer, scenario cards inert, Axal export path + burn alert + investor preview absent. Derived-burn (B13) most consequential: design's runway reacts live to reallocation.

# Audit 1 — Capital & Co-founder Agreement

## PAIR A — Capital.dc.html ↔ SpinoutLabCapitalPage.jsx

| # | Element/Option (design lines) | Cat | In current build? (jsx lines) | Sev | Fix needed |
|---|---|---|---|---|---|
| A1 | Purple 3px `cp-topline` accent bar above header (32) | 3 | No | Low | Add violet top rule to page shell |
| A2 | Tool icon in 34px rounded violet tile + 1px vertical divider after back link (39-40) | 3 | Partial — bare 16px `Banknote`, no tile/divider (403) | Low | Wrap icon in `bg-violet-50` rounded tile; add divider |
| A3 | Week pill as violet chip w/ bg + border "Unlocked · Wk 4" (46) | 3 | Plain gray text, no chip (407) | Low | Restyle as bordered violet pill |
| A4 | Tool description "Run the round — targeting, warm intros, data room, pipeline, instruments, and pitch feedback in one workspace." (34, 43) | 5 | Different copy (409-411) | Medium | Restore design wording |
| A5 | "Share" quick action (50) | 1 | No | High | Add Share button (needs backend) |
| A6 | "Export" button + dropdown menu, options Data room export / Pipeline CSV, `exportOpen` state (52-58, 284, 387) | 1+2 | No | Critical | Add export menu + both options (needs backend) |
| A7 | "Copy link" quick action (60) | 1 | No | Medium | Add copy-link button |
| A8 | "Preview as investor" button (61) + full modal (270-280) | 1+4 | No | Critical | Add button + modal (documented adaptation) |
| A9 | `.cp-qa` hover chrome (transparent border → `#ececf1` border + white bg) (19-20) | 7 | Not reused | Low | Port hover token to quick-action buttons |
| A10 | 5th command-center stat Close confidence (`Medium`, amber) (312) | 2/6 | Only 4 stats (433-453) | Medium | Add close-confidence stat |
| A11 | Progress bar = solid committed fill + 2px black vertical soft-circled marker at `softCircledPct` (71-74, 314) | 3 | Stacked amber+violet bars, no marker (456-459) | Medium | Switch to marker encoding |
| A12 | Caption suffix "· Day 11 of process" via `targetLabel` (75, 314) | 5/6 | Absent (462) | Low | Add days-in-process counter |
| A13 | Fundraise overview · round control center card with 8 fields: Instrument, Valuation cap, Discount, Pro-rata rights, MFN, Lead profile, Target close, Min/Ideal/Max (79-90, 317-326) | 1 | No — replaced by one-line disclaimer (501-505) | Critical | Documented adaptation; needs backend |
| A14 | Per-field sync-provenance line "Synced · Cap Table" / "Default" / "Manual" w/ green/amber colors (86, 316) | 7/6 | Not reused anywhere | High | Build shared provenance-chip helper |
| A15 | Pipeline heading "Investor pipeline · ranked by fit + warm-intro probability" (98) | 5 | "Investor pipeline" + prospect count (516-517) | Medium | Restore ranking subtitle |
| A16 | Priority / Kanban / Table segmented view switcher w/ selected-state style (100-104, 377-381) | 1/4 | No — only stage filter chips (530-545) | Critical | Add 3-view switcher |
| A17 | Kanban board — 8 columns from `kanbanOrder`, per-column count, cards w/ name + check size (125-143, 304-305) | 1 | No | Critical | Build kanban view |
| A18 | Table view — Investor / Stage / Status / Check size / Next step (146-169) | 1 | No | Critical | Build table view |
| A19 | Per-investor Next step field (163, 294-299) | 6 | No | High | Add next_step field (needs backend) |
| A20 | Stage taxonomy: Identified, Researching, Intro sent, Replied, Meeting, Diligence, Term sheet, Committed, Closed, Passed (287-288, 304) | 2 | 6 stages only (53-60) | High | Extend stage enum (needs backend) |
| A21 | Conviction score + list sorted by conviction desc (118, 302) | 6/4 | No score, no sort (558) | High | Add conviction + default sort (needs backend) |
| A22 | Row meta "checkSize · {warmth} intro via {introSource} · last touch {n}" (114) | 6 | Only "check · updated date" (567-569) | Medium | Add warmth + intro-source fields |
| A23 | Separate stage pill alongside status pill on each row (113, 117) | 1 | Only one stage badge (571-573) | Medium | Render stage + status as two pills |
| A24 | Per-investor colored 38px square avatar (`avatarBg`) (111) | 3 | Uniform violet circle (560-562) | Low | Derive per-prospect color, square 10px radius |
| A25 | Right-rail card Next best actions — numbered teal squares + text (174-184, 328-332) | 1 | No | High | Documented adaptation; needs backend |
| A26 | Right-rail card Warm intro opportunities — target, "via X", Direct/Warm/Weak strength pill (185-195, 333-337) | 1 | No | High | Documented adaptation; needs backend |
| A27 | Right-rail card Missing diligence items — alert-triangle amber rows (196-203, 338) | 1 | Only inline banner inside data room (636-643) | Medium | Add rail card |
| A28 | Data room Updated column (219, 227) | 1/6 | Column absent (609-613) | Medium | Add updated-at column |
| A29 | Data room status pills with states Ready / Outdated / Missing / Pending (226, 345) | 2/7 | Icon+text; states ready/partial/missing/unknown (72-77, 626-628) | Medium | Add outdated + pending; use pill pattern |
| A30 | Data room rows Team bios, IP summary, SAFE / financing docs (341-343) | 6 | Absent (145-196) | Medium | Add 3 detectors |
| A31 | Heading "Data room · investor-ready diligence workspace" (210) | 5 | Truncated (595) | Low | Restore wording |
| A32 | Blocking copy "...both required for a 70+ score" (348) | 5 | Different (639-640) | Low | Restore score-threshold wording |
| A33 | Round tracker · weighted forecast card — "At current pace, projected first close on {date}." + Active conversations / Meetings this week / Diligence outstanding / Weighted pipeline (237-245, 350-354) | 1 | No | High | Documented adaptation; needs backend |
| A34 | SAFE generator · document workflow card — investor, terms, Countersigned/Sent status (249-257, 356-359) | 1 | No | Critical | Documented adaptation; needs backend |
| A35 | Pitch feedback · recurring objections card — theme + `×count` (258-266, 360-362) | 1 | No | High | Documented adaptation; needs backend |
| A36 | Layout: data room / tracker / SAFE+feedback are full-width sections below the 1fr-320px split (93, 208, 237, 248) | 3 | Data room nested inside the left column (509-511, 593) | Medium | Move data room out of the split |
| A37 | `cp-mono` Roboto Mono tabular numerics + `cp-card` 16px radius w/ shadow (17-18) | 7 | `tabular-nums` only (33) | Low | Add mono numeric token to CARD system |
| A38 | Embedded-mode chrome hiding (`cp-embedded`) (22-27, 31, 365) | 4 | No embedded variant | Low | Add embedded prop if tool is iframed |

MISSING ELEMENTS: 16 · MISSING OPTIONS: 4

Verdict: faithful data-honest rewrite but structurally different product — design is a read/monitor console (5 stat KPIs, three pipeline views, 8 round-term fields, three right-rail intelligence cards, tracker, SAFE workflow, pitch feedback, investor preview); JSX is a small CRUD tool keeping ~40% of surfaces. Data-room readiness improved on the design (real detectors, honest `unknown`) but lost Updated column, two status states, three rows.

### Fix specs (Critical/High)
- A6 Export menu — quick-action row button toggling 200px popover, two items ("Data room export", "Pipeline CSV"); serialize `dataroom[]`/`prospects[]` client-side; popover closes on re-click.
- A8 Investor preview — violet eye-icon button; max-640px centered modal "Investor preview · Capital & data room", ✕ close, backdrop click-close w/ stopPropagation; body = read-only data room + deck + use-of-funds + cap-table summary from existing loaders; `rgba(24,24,27,.45)` blurred scrim.
- A13/A14 Fundraise overview — 4-col grid of 8 tiles (label / mono value / colored sync line). Instrument/cap/discount/pro-rata/MFN need new round columns; Target close + Min/Ideal/Max from `raise.round.close_date` + `project.funding_needed`. Shared provenance vocab: "Synced · <tool>" / "Default" / "Manual".
- A16-A21 Pipeline views — one segmented control driving three renderers off same `prospects`: Priority (current row + conviction + warmth + next-step), Kanban (columns from stage enum, count in header, name+check cards), Table (5 cols incl. Next step). Extend `raiseProspects` rows with `conviction`,`warmth`,`intro_source`,`next_step`; widen stage enum to 10. Default sort conviction desc; selected-tab = white bg + violet text + shadow.
- A25/A26/A27 Right rail — 3 stacked cards: Next best actions (derived rules: stale intro >10d, deadlines, numbered 1..3); Warm intros (per-prospect intro_source + Direct/Warm/Weak pill); Missing diligence (missing data-room rows, amber + alert icon). Rail = 320px column beside pipeline.
- A33 Round tracker — full-width card, green projected-close sentence + 4 mono stats (active = not passed/closed; meetings this week; diligence outstanding; weighted pipeline = Σ amount × stage probability).
- A34 SAFE generator — card listing generated financing docs (investor · terms · Countersigned/Sent pill); reuse `api.listDocuments` filtered to SAFE templates.
- A35 Pitch feedback — card of objection themes with ×N counts; amber mono count right.

## PAIR B — Co-founder Agreement.dc.html ↔ SpinoutLabCofounderAgreementPage.jsx

| # | Element/Option (design lines) | Cat | In current build? (jsx lines) | Sev | Fix needed |
|---|---|---|---|---|---|
| B1 | Purple 3px `ca-topline` accent (32) | 3 | No | Low | Add violet top rule |
| B2 | Handshake icon in 34px violet tile + vertical divider (40-41) | 3 | Bare `FileSignature` (299) | Low | Wrap icon in tile |
| B3 | Module progress meter — "4 of 6 modules" mono + 120px 66% bar (51) | 1 | No | High | Add module progress to tool chrome |
| B4 | Week pill as violet chip (52) | 3 | Plain gray text (303) | Low | Restyle as pill |
| B5 | Description "Draft, negotiate, and execute the founding agreement — or document a solo-founder path." (34, 47) | 5 | Different copy (306) | Medium | Restore wording |
| B6-B9 | Quick actions Share / Export / Copy link / Preview as investor (58-61) | 1 | No | High/Medium | Add row (Share/Export/Preview need backend) |
| B10 | Multi-founder agreement / Solo-founder declaration segmented path switcher (62-65, 380-382) | 1/2/4 | No | Critical | Add path toggle |
| B11 | Solo path panel — icon tile, "Agreement path · Solo founder", Week-3 explainer, 4 checklist items, "Execute solo-founder declaration →", sync footnote (205-224, 345-350) | 1 | No — 2-line banner (403-411) | Critical | Documented adaptation; needs backend |
| B12 | Summary banner card (file icon tile, path eyebrow, founder names line) (71-89) | 1 | No | High | Build banner |
| B13 | `statusLabel` "Drafting — critical terms unresolved" / "Ready for review" (77, 367) | 6 | No | Medium | Derive + display |
| B14 | Unresolved count (red) + Signed n/2 count (green) (81-82, 297, 335) | 6 | No | High | Add counters |
| B15 | "Open execution console" smooth-scroll to `#ca-exec` (83, 384) | 4 | No | Medium | Add anchor jump |
| B16 | Blocker row: alert icon + `"X" is critical and marked "Y" — resolve before signature.` (86-88, 298-300) | 1/6 | No | High | Compute + render blocker |
| B17 | Snapshot tiles Compensation (Unresolved) + Execution (Delaware · e-sign, Needs review) (305-306) | 2 | Replaced by Governing law + Founders (391-400) | High | Restore both tiles |
| B18 | Snapshot tile status-tinted border+bg (red/amber/white) (96, 303-306) | 3/7 | Flat uniform (379-400) | Medium | Tint tiles by status |
| B19 | Snapshot per-tile status line (Accepted / Unresolved / Needs review) (99) | 6 | Provenance shown instead | Medium | Add status line |
| B20 | Heading "Clause-by-clause agreement builder" + "Prefilled from Cap Table, Incorporate, and Co-founder Match…" (109-110) | 5 | Different (415-418) | Medium | Restore wording |
| B21 | Show / Hide plain-English toggle w/ inline italic explanations per clause (112, 119, 370-371) | 1/4 | No | High | Documented adaptation — explanations are pure copy (design 262-281), no backend needed |
| B22 | Per-clause status pill Accepted / Needs review / Unresolved (122, 289-294) | 6 | No (78-89) | High | Add clause status field (needs backend) — unblocks 8 other rows |
| B23 | Clause row clickable → drawer (115, 296) | 4 | Static form rows | Critical | Make rows open detail |
| B24 | Clause drawer — 520px right panel, blurred scrim, sticky header, ✕ (228-237) | 1 | No | Critical | Build drawer |
| B25 | Drawer "Current term" boxed + "Plain-English explanation" (239-242) | 1/5 | No | High | Build both sections |
| B26 | Drawer "Negotiation note" amber block + per-clause note (243-246, 270, 280) | 6 | No | High | Add note field (needs backend) |
| B27 | Drawer actions "Needs alignment" / "Accept term" (248-249) | 1/4 | No | Critical | Add accept/flag workflow |
| B28 | Drawer meta "{source} · updated {date}" (233, 353) | 6 | No | Low | Add timestamp |
| B29 | Clause source vocab "from Cap Table"/"from Startups"/"from Incorporate"/"auto-filled default" (262-281) | 5/6 | § refs instead (425-573) | Medium | Restore provenance labels alongside § refs |
| B30 | Restrictive covenants clause (12-month non-solicit; no non-compete) (276-277) | 1/2 | Folded into Confidentiality (526-531) | Medium | Add covenants clause |
| B31 | Compensation as own clause w/ Unresolved + note (270-271) | 5/6 | Merged into "Commitment & compensation" (508-518) | Medium | Split back out |
| B32 | Role & responsibility matrix — Domain/Accountable/Supporting/Approval, 9 domains (130-151, 309-315) | 1 | No — roles clause is 2 inputs (490-506) | Critical | Build RACI matrix |
| B33 | Accountable chips colored per founder (144, 314) | 7 | Not reused | Low | Founder-color helper |
| B34 | Conflict note amber banner (dual accountability) (152, 316) | 1/5 | No | Medium | Derive + render |
| B35 | IP assignment rider card — 4 checklist items w/ status pills (157-166, 318-323) | 1 | Only exclusions textarea (483-488) | High | Build rider checklist |
| B36 | Footnote "University tech-transfer disclosure not required…" (167) | 5 | No | Low | Add derived footnote |
| B37 | Dispute resolution segmented control + single explain paragraph (173-177) | 3 | Two bordered option cards (562-569) | Low | Match segmented layout |
| B38 | Execution console heading + "Agreement v1.3 · signature gates until critical clauses are accepted" (186-187, 377) | 5/6 | Generic (339-340) | High | Add version + gating copy |
| B39 | `execReady` pill: Blocked / Ready for signature / Fully executed (189, 338-339) | 6 | No | High | 3-state readiness pill |
| B40 | Signer roster — avatar, name, role, status pill, "View copy" / "Send reminder" (192-197, 329-334) | 1 | Doc list only (347-364) | Critical | Build signer rows |
| B41 | Finalize CTA 3 gated labels + disabled + not-allowed cursor (199, 340-342) | 1/4 | No | Critical | Build gated CTA |
| B42 | Footnote "On full execution: locks v1.3, stores executed copy, syncs to Cap Table + Compliance." (200) | 5 | No | Medium | Add footnote |
| B43 | Shared `statusStyle()` helper reused across 6 surfaces (289-294) | 7 | Ad hoc (39, 359) | Medium | Extract one status-pill helper |
| B44 | `.ca-clause:hover` / `.ca-qa:hover` (22-24) | 7 | No hover | Low | Add hover tokens |
| B45 | `ca-mono` + card shadow (17, 21) | 7 | tabular-nums only (36) | Low | Mono numeric token |
| B46 | Embedded-mode chrome (`ca-embedded`) (18-20, 31, 356) | 4 | No | Low | Embedded prop |

MISSING ELEMENTS: 19 · MISSING OPTIONS: 3

Verdict: design = negotiation & execution console (clause statuses, drawer w/ plain-English + notes, RACI, IP rider, signer roster, gated finalize, solo path); page = document generator form. Generator inputs richer in places (acceleration, unanimous matters, venue) — preserve. Five Criticals: clause drawer, accept/needs-alignment workflow, RACI matrix, signer roster + gated finalize, path switcher/solo panel.

### Fix specs (Critical/High)
- B3 module progress: mono "N of M modules" over 120px rail; data from `spinoutLab.state()` milestone counts.
- B10/B11 path switcher + solo panel: segmented control right of quick-actions; solo panel = icon-tile header, Week-3 explainer, 4-item checklist (Confirmed/Confirmed/N-A/Pending execution), "Execute solo-founder declaration →" CTA. Solo status from cap-table split (one founder) + Co-founder Match decision; declaration needs one-founder template. Keep "generator requires 2+ founders" as disabled reason.
- B12/B14/B16 summary banner: file-icon tile, "Agreement path · Multi-founder" eyebrow, founder names + derived status, Unresolved (red) / Signed n/2 (green) counters, "Open execution console" button; blocker row w/ design sentence template when any Critical clause not Accepted.
- B17/B22 clause status: per-clause `accepted`/`needs_review`/`unresolved` persisted per generated version; drives pills, counters, blocker, exec gate, snapshot tiles. BUILD FIRST.
- B23-B27 clause drawer: 520px right drawer over blurred scrim; sticky header (label, "{source} · updated {date}", ✕), status pill, "Current term" tinted box, "Plain-English explanation", conditional amber note, footer "Needs alignment" (gray) + "Accept term" (violet) writing B22 status. Full-width <1080px.
- B21 plain-English toggle: header button flipping Show/Hide; italic gray `explain` text under each clause value; strings from design 262-281; NO backend.
- B32/B34 RACI: 1.2fr card; Domain/Accountable/Supporting/Approval; founder-colored accountable chip; seed 9 design domains; amber conflict note when accountable ≠ approval.
- B35 IP rider: 4 status rows (Prior inventions / Future inventions / Work-product / Open-source review) + tech-transfer footnote; first 3 derive from generated doc + PIIA presence; OSS review manual flag.
- B38-B41 execution console: version line + gating subtitle, 3-state pill, per-founder signer rows (avatar/name/role/status + "Send reminder"/"View copy"), full-width finalize button labeled by hasBlocker/signedCount; disabled `#d4d4d8` not-allowed; footnote verbatim.

# Audit 2 — Advisors & Office Hours

## PAIR A — Advisors.dc.html ↔ SpinoutLabAdvisorsPage.jsx

| # | Element/Option (design lines) | Cat | In current build? (jsx lines) | Sev | Fix needed |
|---|---|---|---|---|---|
| A1 | Quick-action row: Share / Export / Copy link (L52–55, `.ad-qa` hover L20–21) | 1 | No — header ends at L396 | High | Add 4-button chrome row; Copy link client-only |
| A2 | "Request another match" button (L56, `openReq` L492) | 1 | No | Critical | Teal `+` action opening request modal |
| A3 | Request-match modal + 3 option groups: gap chips GTM/commercial · Fundraising · Product strategy · Regulatory (L470), Specialist/Generalist (L472), Matching for: Skills · Values fit · Sector access · Archetype balance (L473), CTA "Generate new shortlist →" (L319) | 2 | No | Critical | Build modal L293–323; re-query matcher w/ criteria |
| A4 | Advisor detail drawer, 540px right slide-over (L176–265) | 1 | No — "View profile" navigates to `/advisors` (L584–590) | Critical | Build in-page drawer; card click + View profile open it |
| A5 | "Why this match · score breakdown" — 6 labelled bars (L197–206, data L346) | 1 | Data normalized L61 but never rendered; only `values_alignment` used (L86–93) | High | Render whole `breakdown` as bars w/ `bdColor` thresholds (L451) |
| A6 | Founder↔advisor complementarity heatmap (L218–232, `heatColor`/`heatLabel` L452–453) | 1 | No | High | Needs backend: per-skill team vs advisor levels |
| A7 | Weak-point coverage check/dash list (L236–241) | 1 | No | High | Render covered/not-covered from match reasons + gap keys |
| A8 | Engagement + Suggested equity two-up tiles (L244–255) | 1 | No | Medium | Needs backend |
| A9 | "Expected value-add · next 90 days" (L256–257) | 1 | No | Medium | Needs backend; drawer prose |
| A10 | Drawer Background bio + roles list (L209–215) | 1 | Bio line-clamped on card (L528) | Medium | Full bio + roles in drawer |
| A11 | Intro tone selector Warm · Direct · Investor · Mission-driven; body swaps per tone (L276–281, L466–467, L399–401) | 2 | No — single fixed draft (L119–132, L732–734) | High | Tone pills; swap opener per tone |
| A12 | Intro modal title "Intro email · {name}" + Close button (L272, L284–285) | 5 | "Intro draft · {name}", X only (L724–725) | Low | Restore Close + title copy |
| A13 | "Add advisor" ↔ "On bench" toggle (L123, L420, L424) | 4 | No — third button is "Book intro" (L599–606) | High | Needs backend: bench/shortlist relation |
| A14 | Match card clickable + hover teal border/lift (L96, L22–23) | 4 | Inert (L505) | Medium | Card opens drawer; hover affordance |
| A15 | "Likely contribution" field per card (L111) | 1 | No | Medium | Derive from top specialties or backend field |
| A16 | Gap kinds "Missing archetype" + "Values risk" (L433, L435) | 6 | Only Missing skill / Scoring weak point (L109) | Medium | Extend `buildGaps` |
| A17 | Per-kind gap icons (L73, L432–435) | 1 | No icons (L438–450) | Low | kind → lucide icon + colour |
| A18 | Gap `closedBy` — which advisor closes gap + point lift (L75) | 6 | No (L448) | High | Join gap → best-scoring match; gap↔match narrative |
| A19 | "Diagnosed from Startups, Scoring Engine, and Co-founder Match · N matches · +8 projected Team score" + 72→84 readout (L64, L67) | 5 | Single-source + `Team n/20` (L407–418) | Medium | Documented adaptation — restore multi-source wording |
| A20 | "Archetypes present" chip inventory w/ dashed "· missing" (L144–149, L441) | 1 | Single own-archetype chip (L651–664) | High | Render all 6 archetypes present/missing |
| A21 | Skill coverage 6 named skills w/ bars (L135–143) | 6 | Readiness coverage = scoring dims (L626–648) | Medium | Documented adaptation |
| A22 | Values profile 4 fixed rows (L150–155) | 6 | Top-4 numeric scores (L666–684) | Medium | Documented adaptation |
| A23 | Bench empty copy (L168) | 5 | Different (L692–694) | Low | Align once A13 exists |
| A24 | Filter taxonomy All · GTM · Fundraising · Operations · Regulatory (L409) | 2 | Derived from top-5 specialties (L255–259) | Medium | Map into fixed taxonomy |
| A25 | `tagStyle` 3-class helper skill/arch/sector (L408) | 7 | 2 classes (L522, L525) | Low | Reintroduce archetype tag class |
| A26 | `scoreColor()` thresholds (L331, L118) | 7 | Always gray-900 (L576) | Low | Shared score-colour helper |
| A27 | Selected-chip teal fill helper (L428, L467, L471–473) | 7 | `bg-gray-900` (L465, L475) | Low | Shared selected-pill class |
| A28 | Teal `#0d9488` accent + 3px topline (L16, L32) | 3/7 | Violet-600 throughout — sibling Office Hours is teal | Medium | Pick one lab accent (design says teal for Wk3 tools) |
| A29 | Header chrome: tinted icon tile, check in Active badge, teal week pill, desc "Advisor matching engine — …closes your founding-team gaps" (L37–48) | 5/3 | Bare icon, plain badge, gray pill, altered desc (L382–400) | Medium | Restore tile/badge/pill + wording |
| A30 | Per-advisor avatar colour, 48px (L98) | 7 | Fixed violet 36px (L507) | Low | Hash name → colour |

MISSING ELEMENTS: 12 · MISSING OPTIONS: 3

Verdict: data plumbing honest and hardened, but half the design surface unbuilt — the advisor detail drawer (score breakdown, heatmap, weak-point coverage, engagement/equity, 90-day value-add) replaced by a link-out; request-another-match absent; score breakdown FETCHED AND NORMALIZED but thrown away (L61). Archetype inventory w/ missing markers, gap→advisor closedBy, intro tone selector gone.

### Fix specs (Critical/High)
- A2+A3 request modal: 3 chip groups (gap / specialist-generalist / matching-for) → re-query `api.advisorsMatch()` w/ filter params; exact design labels; "Generate new shortlist →". Needs backend params.
- A4 drawer: 540px right slide-over from card click + View profile; source = normalized match object; sticky header (avatar/name/expertise·location/score/close) + sticky footer (Generate intro + Add advisor).
- A5 breakdown: render every key of `item.breakdown` as labelled bar with score; data at L61; 6 design labels; ≥85/≥70 colour thresholds.
- A6 heatmap / A7 coverage: needs backend; 3-col Skill/Team/Advisor; check-vs-dash semantics.
- A11 tones: 4 pills; `buildIntroDraft` gains `tone` arg swapping opener sentence.
- A13 bench: needs backend shortlist endpoint; toggle label + grey out; bench card lists shortlisted advisors.
- A18 closedBy: in `buildGaps` (L97) attach top-scoring match per gap; "{Name} closes {gap} · +{pts} pts".
- A20 archetypes: render full set from `archetypeMeta`, absent = dashed "· missing" chip.
- A1 quick actions: Share/Export/Copy link/Request-match row; Copy link client-only.

## PAIR B — Office Hours.dc.html ↔ SpinoutLabOfficeHoursPage.jsx

| # | Element/Option (design lines) | Cat | In current build? (jsx lines) | Sev | Fix needed |
|---|---|---|---|---|---|
| B1 | "Unlocked · Wk 3" week pill (L36) | 1 | No — Copy link at ml-auto (L422–429) | Medium | Add week pill; move Copy link into quick-action row |
| B2 | Quick actions Share / Export / Preview as investor (L41–44) | 1 | Only Copy link | High | Build row; others need backend (ship disabled w/ tooltips) |
| B3 | Summary tiles "Follow-ups pending" + "Deliverables created" (L253–255) | 6 | "Awaiting confirmation" + "Partners available" (L448–450) | Medium | Derive from action items + booking outcomes |
| B4 | Per-metric tile value colour (teal/dark/amber) (L50) | 7 | All gray (L453) | Low | Colour by semantics |
| B5 | Rec card footer "{partner} · {30/60 min}" (L63) | 6 | Only Book now (L475–485) | Medium | Resolve bookTopMatch target eagerly |
| B6 | Rec card tinted bg/border per partner type (L266–267) | 3/7 | Plain gray (L468) | Low | Tint by role |
| B7 | Upcoming row click → drawer (L74) | 4 | Inert (L503) | Medium | Open partner drawer from row |
| B8 | Session duration + large mono teal countdown (L79, L82) | 3/6 | No duration; 11px gray countdown (L515–520) | Low | Show duration_min; countdown prominence |
| B9 | "Brief complete" chip (L272) | 5 | "Brief attached" (L406) | Low | Align |
| B10 | Partner card avatar tile (L103) | 1 | No (L563–570) | Low | 40px initials tile |
| B11 | Per-filter directory note — 5 distinct strings (L286) | 5 | One hardcoded string (L551) | Medium | Restore `dirNote` map |
| B12 | Partner `useCase` one-liner (L108) | 6 | bio clamp (L578) | Low | Needs backend or keep |
| B13 | Per-partner rec reason boxed teal callout (L109) | 5/3 | Generic unboxed (L579–583) | Medium | Name actual gap/blocker; restore box |
| B14 | ★ rating + availability wording (L111) | 1/5 | capacity_status only (L585) | Low | Documented omission |
| B15 | Partner card click → drawer (L101) | 4 | Book button only (L586–594) | Low | Card clickable |
| B16 | Drawer "When to book {firstName}" (L191) | 1 | No | Medium | Needs backend field |
| B17 | Drawer "Best for stage" + "One session gets you" tiles (L192–195) | 1 | No | Medium | Needs backend |
| B18 | Drawer "Bring to the session" bullets (L196) | 1 | No | Medium | Needs backend |
| B19 | Drawer avatar + location (L186–187) | 1 | Name/headline/role (L699–708) | Low | Add tile + location |
| B20 | Objective options: design has Customer validation + Deck feedback (L328); page drops both, adds Product/Other (L74) | 2 | Altered | Medium | Restore dropped objectives |
| B21 | Length pills 30 min / 60 min (L203, L329) | 2 | No (L753) | Medium | Needs backend or filter slots by length |
| B22 | Readiness warning trigger + copy "Founder readiness low — … Weak briefs waste the session." (L206, L331) | 5/4 | Different trigger + copy (L764–768) | Medium | Include outcome in trigger; design wording |
| B23 | Confirm CTA "Confirm booking · auto-generates video link + brief" (L207) | 5 | "Request session" (L778) | Medium | Reword |
| B24 | In-drawer success line + drawer stays open (L208, L341) | 4/5 | Drawer closes; toast (L359–360) | Low | In-drawer confirmation |
| B25 | Brief status pill (L140) | 1 | Copy button in slot (L608–610) | Low | Documented omission |
| B26 | "Edit brief" button (L149) | 1 | No — brief read-only (L613–620) | High | NOT in documented omit list; make brief editable |
| B27 | "Resend to partner" (L149) | 1 | No | Medium | Documented omission |
| B28 | Brief in gray inset + separate "Questions for partner" ›-bulleted block (L142–147) | 3 | Flat; questions folded into one string (L291–294) | Low | Restore panel + questions block |
| B29 | Action items toggleable checkboxes (L158, L219, L316) | 4 | Read-only (L625–630) | Medium | Documented adaptation |
| B30 | Action item owner + due (L161) | 6 | Neither (L632) | Medium | Needs backend due dates |
| B31 | Linked-tool violet pill "→ Section 83(b)" (L161) | 7 | Plain teal link (L634) | Low | Pill styling |
| B32 | History outcome/deliverable chips (L128) | 1 | Status text only (L686–688) | Medium | Needs backend outcome records |
| B33 | Search placeholder + empty copy w/ query echo (L121, L131) | 5 | Generic (L667–676) | Low | Align |
| B34 | History in left column under directory (L119–133) | 3 | Full-width below grid (L659) | Low | Move |
| B35 | Filter set Recommended · Investors · Lawyers · Operators · All, teal selected (L283–285) | 7/2 | Derived (also "Partners"/"Finances"); gray-900 selected (L47–56, L540–546) | Medium | Fix taxonomy + teal selected |
| B36 | Booking success references undefined `user` — `markMilestone(user,…)` (L362) crashes; milestone never marked; `refreshBookings()` never runs | 4 | BROKEN | Critical | Add user state or call `spinoutLab.complete` directly; keep refresh ordering |
| B37 | `pill(active)` shared helper (L245–247) | 7 | Inline per site (L543, L716, L747) | Low | Extract |
| B38 | 3px teal topline (L30) | 3 | No | Low | Cosmetic |

MISSING ELEMENTS: 11 · MISSING OPTIONS: 2

Verdict: closest port of the two; layout/sections track design; real slots + attach-brief checkbox are improvements. Gaps concentrate in the partner drawer (advisory content) and per-filter/partner microcopy. One functional defect outranks all: B36 undefined `user` crash after successful booking.

### Fix specs (Critical/High)
- B36: `const [user, setUser] = useState(null)` + `setUser(me)` in loader (me at L181/L185), or `spinoutLab.complete('office_hours_booked')`; keep `refreshBookings()`; move `setDrawerFor(null)` after milestone call.
- B2: quick-action row Share / Export / Copy link / Preview as investor (borderless hover, design L41–44); Copy link exists; others disabled w/ tooltips; add week pill (B1).
- B26: make auto-assembled brief sections editable in place (local override) feeding briefText → booking questions/notes payload; keep "auto-generated" label + Copy.

# Audit 3 — Profiling & Scoring Engine

Note: both tools are in the workspace's `isEmbeddedTool` list (workspace L2472) → applicable chrome is the compact branch (L360–371: phase stripe, back button, icon, name, Active badge, description); week pill + module bar are notEmbeddedTool-only, so their absence is NOT a defect here. No shared tool-header component exists in frontend/src — every page rolls its own.

## PAIR A — Profiling.dc.html ↔ SpinoutLabProfilingPage.jsx

| # | Element/Option (design lines) | Cat | In current build? (jsx lines) | Sev | Fix needed |
|---|---|---|---|---|---|
| A1 | 3px violet phase stripe (L27) | 3 | No (L356–358) | Low | Add stripe |
| A2 | 34px tinted tool icon beside title | 1 | No (L359–367) | Low | Violet icon square |
| A3 | Quick actions ↗ Share, ⬇ Export report, 📋 Copy link (L37–41) | 1 | No | High | Ghost toolbar; export/share need backend |
| A4 | KPI "Questions answered" 54/79 (L238) | 5 | "Skills rated" (L430–432) | Medium | Rename or add count |
| A5 | KPI band words Reliable / Partial / 12 open Qs (L239–241) | 5 | High/Medium/Low (L438–456) | Medium | Restore vocabulary |
| A6 | "82% assessed" chip always amber (L74) | 7 | Conditional green/amber (L469–471) | Low | Align |
| A7 | "Least evidenced" heading (L79) | 5 | "Lowest self-rated" (L494) | Medium | Restore |
| A8 | Values chip "61% assessed" (L85) | 5 | "{n}% confidence" (L515) | Medium | Use "assessed" |
| A9 | "…across ten working principles" (L86) | 5 | Generic (L518) | Low | Add count |
| A10 | Archetype Secondary tile (L109) | 1 | "Confidence" tile (L560–563) | High | Needs backend (documented) |
| A11 | Blend ratio tile 62/38 (L110) | 1 | "Assessed" date tile (L564–567) | High | Needs backend (documented) |
| A12 | Strengths list w/ green + glyphs (L114) | 1 | Prose (L570–576) | High | Needs backend (documented) — or seed in assessmentMeta |
| A13 | Likely blind spots w/ amber ! (L115) | 1 | No | High | Same |
| A14 | Compatible complements chip row (L116) | 1 | No | High | Same |
| A15 | Progress rows Leadership style (48) + Working style (40) (L246) | 2 | Only Skills/Values/Archetype (L599–603) | High | Needs backend; render "No data yet" until then |
| A16 | "Next best questions · answer in Studio" (L138) | 5 | "Next best steps" (L618) | Medium | Restore heading |
| A17 | Per-question emoji glyph (L142) | 1 | Single Fingerprint (L623–624) | Low | Distinct glyphs |
| A18 | CTA "Answer 4 →" w/ count (L144) | 5 | "Answer →" (L634) | Medium | Append count |
| A19 | Implication key "Operating risk" (L258) | 5 | "Coverage gap" (L664) | Medium | Restore |
| A20 | Downstream names Scoring Engine (Team), Co-founder Match, Advisors (L259) | 5 | Genericized (L670) | Medium | Name tools |
| A21 | Evolution "Week 2 · Jul 13" prefix (L263–265) | 6 | Date only (L690) | Low | Add week |
| A22 | 3-tier evolution dot ramp (L263–265) | 7 | 2-tier (L685) | Low | Third tier |
| A23 | "Resume assessment in Studio" (L177) | 5 | "Continue your assessment…" (L707) | Medium | Restore |
| A24 | Last answered: "<question>" (L177) | 6 | No (L708–710) | Medium | Needs backend |
| A25 | pf-mono Roboto Mono numerics (L17) | 7 | tabular-nums only | Low | Mono class |

MISSING ELEMENTS: 8 · MISSING OPTIONS: 2

Verdict: skeleton faithful (ring, KPI, radar, strongest/weakest, values, progress, next actions, implications, evolution, Studio CTA). Losses concentrated in archetype card (drops Secondary/Blend/Strengths/Blind-spots/Complements → paragraph), the quick-actions toolbar, 2 progress categories. Archetype + next-question adaptations documented in header (L1–19); toolbar + progress categories undocumented.

### Fix specs (High)
- A3 quick actions: ghost toolbar between header + summary (Share / Export report / Copy link); Copy link = window.location; transparent bg, 12px/500, 7×12px padding.
- A10–A14 archetype detail: two-tile row (Secondary, Blend) + right 3-block grid (Strengths / Blind spots / Complements chips). Data: extend `ARCHETYPES` in frontend/src/lib/assessmentMeta.js (currently label/tagline/description/icon/accent) with strengths/blindspots/complements per archetype (static seed OK — design data is static per archetype); secondary/blend need /assessment/results. Preserve gradient primary card, +/! glyph colours, grid-column:1/3 complements row.
- A15: add 2 progress rows w/ existing "No data yet" state; `{pct}% · {band} confidence` label format.

## PAIR B — Scoring Engine.dc.html ↔ SpinoutLabScoringPage.jsx

| # | Element/Option (design lines) | Cat | In current build? (jsx lines) | Sev | Fix needed |
|---|---|---|---|---|---|
| B1 | 3px teal phase stripe (L34) | 3 | No (L405–407) | Low | Teal stripe |
| B2 | Gauge icon tile + divider (L42–43) | 1 | No (L408–413) | Medium | Add |
| B3 | Badge "Unlocked · Wk 3" w/ check (L47–49) | 5 | "Active" (L414) | Medium | Restore |
| B4 | Right pill "Unlocked · Wk 3" (L55) | 5 | "Diligence · Wk 3" (L416) | Low | Align |
| B5 | "nine weighted dimensions" (L51) | 5 | "all key dimensions" (L419) — matches workspace toolMeta L1847 | Low | Two design sources disagree — flag, keep workspace wording |
| B6 | Quick actions Share · Export report · Copy link · Investor view (L60–66) | 1 | No | Critical | 4-button toolbar; Export opens B7 |
| B7 | PDF export modal: "Investor-ready report", contents list ×5, Cancel / Generate PDF (L309–332) | 1 | No | Critical | Build modal; needs backend for PDF |
| B8 | Composite count-up 850ms (L336–347) | 4 | Static (L451) | Low | Animate |
| B9 | 66px composite (L76) | 3 | 44px (L451) | Low | Scale up |
| B10 | Delta chip "+6 this week" w/ trend icon (L79) | 5 | "+N since last run" (L454–456) | Low | Icon + wording |
| B11 | Evidence confidence row + band chip (L84–86) | 1 | Tier/Run type/Last run instead (L459–474) | High | Needs backend band; derive tool-connection note |
| B12 | "9 tools connected · 6 with live data" (L87) | 6 | No | Medium | Derive from unlocked_features + data presence |
| B13 | Radar legend You/Benchmark (L95–98) | 1 | No (L482–484) | Medium | Add |
| B14 | Benchmark overlay polygon dashed at 60 (L108) | 1 | Single polygon (L173) | High | Needs backend (cohort baseline); Tier-2=70 as interim |
| B15 | Concentric circular grid rings (L101–104) | 3 | Polygonal (L166–168) | Low | Circles |
| B16 | Radar footnote re Skill Coverage (L117) | 5 | No | Low | Add if sub-dims kept |
| B17 | "9 dimensions · click to drill down" (L125) | 5 | Different (L492) | Medium | Restore once B18 lands |
| B18 | Dimension row click → drawer (L128, L457) | 4 | Static div (L499) | Critical | Open drill-down drawer |
| B19 | Row hover bg/border (L22) | 4 | No | Low | Add |
| B20 | 8 per-dimension icon tints (L371) | 7 | One violet (L501) | Low | Tint map |
| B21 | Chevron-right affordance (L145) | 1 | No | Low | Add |
| B22 | Per-dimension weakLine narrative (L142) | 5 | Sub-factor string (L511–513) | Medium | Documented; consider derived narrative |
| B23 | Drawer sticky header: icon, name, "Weight x% · conf", X, score bar (L226–243) | 1 | No drawer | Critical | 460px right drawer, blurred scrim |
| B24 | Drawer Contributing evidence w/ provenance (L247–258) | 1 | No | Critical | Minimal evidence from buildDimensions sub-factors now; provenance needs backend |
| B25 | Team-only skill coverage matrix (L262–276) | 1 | No | High | Needs backend |
| B26 | Team-only critical-gap callout (L277) | 1 | No | Medium | Needs backend |
| B27 | Team-only archetype coverage chips w/ missing (L279–286) | 1 | No | High | Needs backend |
| B28 | Team-only values alignment 5 rows (L288–297) | 1 | No | High | Needs backend |
| B29 | Drawer "What's missing" prose (L301–302) | 1 | No | High | Needs backend |
| B30 | Drawer {fixLabel} → CTA (L303) | 1 | No | High | Full-width CTA |
| B31 | Weak-point effort + clock ("~6 hours") (L167) | 1 | No (L546–554) | High | Needs backend |
| B32 | Weak-point risk flag chip (L164) | 1 | No | Medium | Needs backend |
| B33 | Impact "+9 pts" w/ trend icon (L168) | 5 | Chip no icon (L548) | Low | Icon |
| B34 | Rank badge ramp by rank (L477–478) | 7 | By level (L544) | Low | Reconcile |
| B35 | Benchmark row "Cohort 3 median (Week 3)" (L490) | 2 | Tier rows only (L579–583) | High | Needs backend; documented — reconfirm |
| B36 | Black composite marker on benchmark bars (L190) | 1 | No (L589–591) | Medium | Add marker |
| B37 | Percentile footnote (L194) | 6 | Tier copy (L595–601) | Medium | Needs backend |
| B38 | "Investor-ready by Day 28" + "+6/wk" (L202–203) | 1 | No (L605–611) | High | Derivable client-side from snapshot slope in buildTrajectory (L134–143) |
| B39 | Dashed projection polyline (L209) | 1 | No (L206) | Medium | Same derivation |
| B40 | "Investor-ready · 70" threshold label (L207) | 5 | "Tier 2 threshold · 70" (L203–205) | Low | Reconcile |
| B41 | Day-based x-axis (L214–216) | 3 | Calendar dates (L213–215) | Low | Program-day axis |
| B42 | Left column 420px (L69) | 3 | 280px (L446) | Low | Widen |
| B43 | scoreColor() <40 red /<70 amber (L351) + confChip (L352–356) | 7 | levelFor 70/50 (L100–108) | Medium | Align red band 40 |

MISSING ELEMENTS: 20 · MISSING OPTIONS: 1

Verdict: read-only surfaces rebuilt on real data + practice-run form added (preserve). Drops every interactive surface: quick actions, PDF export modal, per-dimension drill-down drawer w/ evidence + Team panels. User cannot drill into a dimension, see why it scored, or export a report. Header documents 6-vs-9 dims, cohort benchmarks, projection line — NOT the drawer/modal/toolbar.

### Fix specs (Critical/High)
- B6: 4 ghost buttons under description; `.se-qa:hover` reveal; Export opens B7; Investor view = read-only presentation toggle.
- B7: centered 440px modal, blurred scrim, stopPropagation; doc icon; title "Investor-ready report"; subtitle "PDF · composite score, radar, evidence, remediation"; 5 green-checked lines verbatim (L538–544); Cancel (flex1 gray) / Generate PDF (flex2 violet).
- B18+B23–B30 drawer: click dim row → 460px right drawer (full width <1080px), blurred click-close scrim; sticky header (tinted icon, name, "Weight {max}% · {level} confidence", X, score bar + 22px score); "Contributing evidence" cards (green check / amber alert + source line) — sub-factor points from buildDimensions back a minimal list NOW; Team extras + provenance need backend; "What's missing" prose; full-width {fixLabel} → CTA. Keep Fix-it button stopPropagation (design L458).
- B11: bordered-top row in composite card: label + amber band chip + "N tools connected · M with live data".
- B14: dashed gray polygon beneath violet (stroke #a1a1aa, dasharray 4 3, w 1.5) + legend.
- B31: clock-icon effort chip beside points chip (needs backend).
- B35: third gray bar "Cohort 3 median (Week N)" (needs backend; reconfirm) + B36 black composite marker across bars.
- B38: green bold "Investor-ready by Day N" + gray "at current pace (+X/wk)" — client-side from real slope; two-span baseline-aligned layout above chart.

# Audit 6 — Entry (SpinoutLabPage), Marketing, Apply, Brief

Design split: Spin-Out Lab.dc.html single `view` state → PROGRAM VIEW (77-269) owned by SpinoutLabPage `Dashboard()` (544-729, signed-in) + SpinoutLabMarketingPage (logged-out; shares sections via exports); APPLY VIEW (273-373) → SpinoutLabApplyPage; BRIEF VIEW → SpinoutLabBriefPage vs Spin-Out Lab-print-1vkgcux.dc.html L384-463 (canonical; the small print.dc.html is truncated but authoritative for print paging: letter landscape 0.5in, break-after per slide). SpinoutLabPage switch (731-834): no user → marketing; admitted-not-started → CongratulationsScreen (ADDITIVE, preserve); active/graduated → Workspace; else Dashboard.

## SpinoutLabPage.jsx — MISSING ELEMENTS: 3 · MISSING OPTIONS: 1
- #1/#2 (High): Company profile modal on graduate cards (459-524: gradient hero, Cohort pill, 3 stat tiles, Outcome para, Founders list, milestones dot-timeline, View founder profile + Close) → cards are Links (285-292). Needs backend fields (stats/summary/founders/milestones/location) on /spinout-lab/graduates. Preserve loading/error/empty (233-256).
- #3 (High): PM ticket modal ("Request sent", Ticket #SOL-4471 · Priority Standard, Done) (527-537) → mailto (154, 481-483). Needs ticket endpoint; keep mailto fallback.
- #4 (High): tracker card Lead advisor chip w/ title tooltip (218-224) → absent (452-456). Needs advisor on cohort member.
- #5 (High): jurisdiction-derived deliverables [0]=entity, [2]=filing (656-658, 570-599) → static DELIVERABLES (126-136). BUILDABLE (static config port).
- #6 (Med): full 7-jurisdiction metadata (entity/entityDesc/filingBadge/filingName/filingInc/filingDesc) (570-599) → label+soon only (195-203). BUILDABLE.
- #7 (Med): hero outcome chips 4, jurisdiction-reactive (610) → 3 hardcoded (633-635). BUILDABLE.
- #8 (Med): hero subline `Idea → {entity} → Funded` (117) → hardcoded Delaware (631). BUILDABLE.
- #9/#10 (Med): "Cohort 3 · Applications Open" (86-88) + drop "Started …" on pre-application view (572).
- #11/#12 (Med): tracker columns Validate/Structure/Build/Pitch/Funded (682, documented adaptation); deliverable copy "Delaware C-Corp → Fully incorporated entity with EIN and registered agent." (572; brief already uses design wording).
- Low: selected jurisdiction chip solid violet fill (606); Soon chips not-allowed cursor; docIcon → FileDown; grid auto-fill; alumni copy; hover on no-uid cards.
Verdict: faithful port + live-data improvements (preserve); behavioral depth gaps = 2 modals + advisor chip + decorative jurisdiction selector.

## SpinoutLabMarketingPage.jsx — MISSING ELEMENTS: 4 · MISSING OPTIONS: 1
- #1/#2 (High): jurisdiction selector bar (98-110, 7 chips incl 5 Soon) → absent. Lift Dashboard block (596-624) into exported JurisdictionBar({value,onChange}). BUILDABLE.
- #3 (High): "Download Program Brief" header button (93) → replaced by "Talk to a Manager" (28-30). Link to /spinout-lab/brief (public route). BUILDABLE.
- #5 (High): pipeline phase status done ✓ / active pulse / future 🔒 (634-641) → ALL render Lock (73-75) — inverts design intent. Static config mirroring 623-632. BUILDABLE.
- #6 (Med): phase cards tinted per phase (146) → all white (67). Use PHASE_THEMES (imported L6). BUILDABLE.
- #7 (Med): alumni-badge microcopy line (169-172) → absent (present on Dashboard 695-698). BUILDABLE.
- #8 (Med): remove truncated header "Talk to a Manager" duplicate (CTA band owns it).
- Low: flask tile + subtitle indent; shared ProgramHero extraction; connector arrow colour. PublicNav/Footer = additive, preserve.

## SpinoutLabApplyPage.jsx — MISSING: 0 / 0 — FULLY FAITHFUL ✓
Every control/option/label/state matches (stage options, jurisdiction select format, incorporated toggle, side panel, confirmation). Additive live backend (application window, validation, pending detection, admitted redirect, preview mode) — PRESERVE. Low: applyOutcomes[2] hardcoded "83(b) Election handled" → derive from juris record; spots-remaining in sub-line needs backend.

## SpinoutLabBriefPage.jsx — MISSING: 0 / 0, but geometry Highs
- #1 (High): cover must be 16:9 slide (aspect-ratio 16/9, p-12, logo mb-auto, badges mt-auto, 64px title white→#c4b5fd gradient-clipped) (394-406) → fixed-height portrait card (84-100).
- #2 (High): column max-w 960px, gap-5 (386) → 680px (63).
- #3 (High): slide 4 = ONE violet gradient slide (linear-gradient(115deg,#5b21b6,#7c3aed)): eyebrow "Track record", 3 translucent tiles (bg-white/10 border-white/16), apply strip inside under border-t border-white/18 (445-460) → split into two white cards (144-156 + 159-167). Merge; delete standalone footer CTA.
- #4 (Med): brief binds juris.entity/outcomeBadges/deliverables — accept ?j= param and swap strings.
- #5 (Med): stats live from GET /spinout-lab/stats (page uses static STATS 52-56 while program page is live).
- #6 (Med): print paging @page {size: letter landscape; margin:.5in} + break-after per slide (pattern at PitchDeckPrintPage.jsx 654).
- Low: stat sub field inconsistency; eyebrow casing/tracking; H2 26px; phase day chips; bullet ink; Build teal #0d9488 / Fund pink #db2777; import shared DELIVERABLES (3rd copy).
Toolbar back + Save as PDF ✓ matches.
