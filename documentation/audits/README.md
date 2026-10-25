# documentation/audits — point-in-time findings

**An audit is a snapshot, not a spec.** Each file was accurate on its date and
is *not* maintained afterwards. Many findings have since been fixed and the
audit files do not say so.

So: never treat a finding here as a live bug without re-checking it against the
code. Reading an old audit as a to-do list is how work gets redone.

| File | Covers |
| --- | --- |
| `SCALE_1000_DAU_AUDIT_2026-09-18.md` | Worker + D1 + SPA load for the first 1,000 daily users, with a Claude Code implementation plan. |
| `PLATFORM-DELIVERY-AUDIT.md` | The most recent canvas-by-canvas delivery sweep. Start here for “what shipped.” |
| `BETA_READINESS_AUDIT_2026-05-20.md`, `BETA_READINESS_AUDIT_2026-06-03.md`, `BETA_READINESS_AUDIT_2026-07-03.md` | Three successive beta-readiness passes. |
| `BETA_READINESS_ISSUES_2026-05-20.md` | The issue list from the first of those. |
| `FOUNDER_UX_AUDIT.md`, `INVESTOR_UX_AUDIT.md`, `PARTNER_UX_AUDIT.md`, `ADVISOR_UX_AUDIT.md` | Per-persona journey audits. |
| `SECURITY_AUDIT.md`, `SECURITY_REVIEW.md` | Security passes. |
| `BROKEN_FEATURES_VERIFIED.md` | Features confirmed broken at the time of writing. |
| `DECK_AUTOFILL_AUDIT.md`, `AXAL_SPINOUT_DECK_AUDIT_2026-05-30.md` | Pitch-deck data wiring. |
| `COMMUNITY_OVERVIEW_MAP_2026-10-24.md` | Every read behind the Admin · Community canvas (CM1–CM13), board by board, and its defects on that day (D930). |
| `ADVISORS_PARTNERS_MAP_2026-10-24.md` | The Advisors & Partners canvas (AP1–AP14) read board by board against the reads that existed that day, and its defects re-checked at HEAD (D972). |
| `PROGRAM_GRANTS_MAP_2026-10-24.md` | The Program grants canvas (GR1–GR15) read board by board against the code that day: no grant store, the ledger read the grid's rows come from, and the licence page's tabs (D981). |
| `PARTNER_PROFILES_MAP_2026-10-24.md` | The Partner profiles canvas (PRF1–PRF12) read board by board against the code that day: the list read the page draws from, what it lacks, and the verify route's three defects (D989). |
| `PERSONA_SEGMENTS_MAP_2026-10-24.md` | The Persona segments canvas (SEG1–SEG14) read board by board against the code that day: the capped persona list the page draws from, the taxonomy, and the profile-mapping defects (D997). |
| `PAYMENTS_MAP_2026-10-24.md` | The Payments canvas (PAY1–PAY13) read board by board against the code that day: the four reads the page draws from, the Worker gates still open to any admin, and the webhook's required events after #2393 (D1008). |
| `CAP_TABLE_MAP_2026-10-24.md` | The Cap table canvas (CT1–CT24) read board by board against the code that day: #2432's broken items re-checked (most fixed by #2645, #2651 and #2446), the four reads the tool draws from, and why every figure on `main` is Modelled (D1015). |
| `MY_EVENTS_MAP_2026-10-25.md` | The My events canvas (MEV1–MEV18) read board by board against the code that day: #2387's eleven broken items re-checked (six fixed by #2623 and #2626), the three reads the page draws from, and what `registered` means (D1030). |
| `APPROVALS_MAP_2026-10-25.md` | The Approvals canvas (APR1–APR16) read board by board against the code that day: #2390's nine gaps re-checked (three fixed by D938 and D1038), the three reads the page draws from, and what each board waits for (D1038). |
| `VALIDATE_BUILD_MAP_2026-10-25.md` | The Validate → Build canvas (VB1–VB22) read against the code that day: #2426's four findings re-checked (all open), the one read the plan draws from, what is stored nowhere yet, and what each board waits for (D1063). |
| `TRUST_MAP_2026-10-25.md` | The Trust center canvas (TRU1–TRU20) read against the code that day: #2425's eleven findings re-checked (one fixed by D1072, the sanctions fail-open fixed on main), what each public tab can read, and what waits (D1072). |
| `DATA_ROOM_MAP_2026-10-25.md` | The Data room canvas (DR1–DR24) read against the code that day: #2456's broken items re-checked (three fixed on main, one half fixed), what each tab can read, and what waits (D1101). |
| `COMPANIES_MAP_2026-10-25.md` | The Companies and projects canvas (CMP1–CMP19) read against the code that day: #2422's eleven broken items re-checked (the Operating Partner power fixed by D889), what each tab can read, and what waits (D1134). |
| `REPORTING_MAP_2026-10-25.md` | The Reporting to investors canvas (RPT1–RPT21) read against the code that day: #2427's eight findings re-checked (three fixed by D889 and `cleanMetrics`), the reads the desk and the company page draw from, what is read nowhere yet, and what each board waits for (D1056). |
| `CHECKOUT_MAP_2026-10-25.md` | The Checkout canvas (PAYX1–PAYX21) read against the code that day: #2451's nine findings re-checked (two fixed by D892), the reads the sheet draws from, and what each board waits for (D1048). |
| `ADMIN_PAGE_HEADER_MAP_2026-10-24.md` | The Admin page header canvas (SHL1–SHL9) read against what each board can reuse that day (D936). |
| `SPINOUT_LAB_ADMIN_MAP_2026-10-24.md` | Every read behind the Spin-Out Lab admin canvas (SL1–SL21), board by board, its defects re-checked at HEAD, and production's calendar that day (D937). |
| `PITCH_DECK_WORKER_MAP_2026-10-24.md` | Every deck endpoint against the Pitch deck studio canvas's boards, and the twelve #2434 bugs on that day (D894). |
| `INVESTOR_NARRATIVE_MAP_2026-10-24.md` | The Investor narrative canvas's boards against the code, the narrative reads and writes with their shapes, and #2454's bugs on that day (D906). |
| `EVENTS_CONSOLE_MAP_2026-10-24.md` | The admin Events Console canvas's boards against the code, the event reads and writes with their shapes, the admin shell around `/admin/events`, and #2368's defects on that day (D915). |
| `PARTNER_INVITATIONS_MAP_2026-10-24.md` | The Partner invitations canvas's boards against the code, the partner reads and writes with their shapes, the admin shell around `/admin/partners`, #2370's defects on that day, and a completeness critique (D923). |
| `PROGRAMS_MAP_2026-10-24.md` | The admin Programs canvas's boards against the code, each program family's reads and writes, the landing and the admin shell around `/admin/held/programs`, #2371's defects on that day, and a completeness critique (D953). |
| `SPINOUT_LAB_UI_FIDELITY_AUDIT_2026-08-03.md` | Lab UI against its designs. |
| `SIGNUP_FRICTION_AUDIT_2026-07-08.md` | Signup funnel friction. |
| `DOCS_VISIBILITY_AUDIT.md` | Help Center coverage. |
| `MIGRATION_LFS_AUDIT.md` | Git LFS migration. |

## Adding one

Date it in the filename, state the date and the commit in the first paragraph,
and say plainly what you did *not* check. An audit that implies full coverage it
did not have is worse than a narrow one that says so.
