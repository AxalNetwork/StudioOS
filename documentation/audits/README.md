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
| `PITCH_DECK_WORKER_MAP_2026-10-24.md` | Every deck endpoint against the Pitch deck studio canvas's boards, and the twelve #2434 bugs on that day (D894). |
| `INVESTOR_NARRATIVE_MAP_2026-10-24.md` | The Investor narrative canvas's boards against the code, the narrative reads and writes with their shapes, and #2454's bugs on that day (D906). |
| `EVENTS_CONSOLE_MAP_2026-10-24.md` | The admin Events Console canvas's boards against the code, the event reads and writes with their shapes, the admin shell around `/admin/events`, and #2368's defects on that day (D915). |
| `PARTNER_INVITATIONS_MAP_2026-10-24.md` | The Partner invitations canvas's boards against the code, the partner reads and writes with their shapes, the admin shell around `/admin/partners`, #2370's defects on that day, and a completeness critique (D923). |
| `SPINOUT_LAB_UI_FIDELITY_AUDIT_2026-08-03.md` | Lab UI against its designs. |
| `SIGNUP_FRICTION_AUDIT_2026-07-08.md` | Signup funnel friction. |
| `DOCS_VISIBILITY_AUDIT.md` | Help Center coverage. |
| `MIGRATION_LFS_AUDIT.md` | Git LFS migration. |

## Adding one

Date it in the filename, state the date and the commit in the first paragraph,
and say plainly what you did *not* check. An audit that implies full coverage it
did not have is worse than a narrow one that says so.
