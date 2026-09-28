# Profiling v2

> **Status.** This file is meant to be written by Session 7 (the spec, the
> owner's decisions, the evolution model and the 16 test personas). Session 7
> had not landed when Session 9 shipped, so this file holds **only §S9, the
> skill evidence layer**. S7 owns everything else here and may restructure the
> file. Where S7's spec and this section disagree, S7's spec wins, and the
> evidence code follows it.

## S9 — Skill evidence from platform tools (D318, migration 362)

Skills reflect what people **do** on the platform as well as what they **say**.
The self-rating comes from the fit bank's `skill_axis` answers and the Skills
page (`user_skills.self_level`, 0–5). The evidence comes from the person's own
recorded actions, listed below.

### Rules

- **Own records only.** Every source filters on the column that names the
  actor. Only counts and dates are read or stored, never a title, note or
  document body.
- **Ageing.** An action in the last 12 months counts 1. An older one fades
  with a 12-month half-life: 2 years old counts 0.5, 3 years old counts 0.25.
  Lifetime totals are kept for display only.
- **Evidence score per axis** (0–5): `5 × (1 − e^(−W/3))`, where `W` is the
  sum of the axis's aged action counts, each multiplied by its source weight.
  Three fully weighted recent actions give about 3.2.
- **Blend: corroborate** (owner's decision for D318, provisional until S7
  confirms it). Evidence confirms a self-rating. It never raises one and never
  creates one.

  | Self | Evidence | Blended | Basis |
  | --- | --- | --- | --- |
  | none | none | — | `none` |
  | yes | none | self | `self_rated_only` |
  | none | yes | — | `evidence_only` |
  | yes | ≥ self | self | `corroborated` |
  | yes | < self | half-way from self to evidence | `partly_corroborated` |

- **Absent is absent.** An axis with no evidence returns `evidence: null`,
  never 0.

### The tool map

This table is the same list as `EVIDENCE_SOURCES` in
`cloudflare-worker/src/services/skillEvidence.ts`. A test fails if a source key
there is missing here. Adding a source is one entry in that list, plus one row
here.

| Role | Source key | Table · owner column | Counted | Axes | Weight |
| --- | --- | --- | --- | --- | --- |
| Founder | `deck_version` | `pitch_decks.created_by` | each deck version saved | marketing_brand, capital_network | 1 |
| Founder | `brand_site` | `brand_sites` on a project the user founded | each site | marketing_brand, design | 1 |
| Founder | `discovery_interview` | `discovery_interviews` on an own project | each interview (dated by `interview_date`) | gtm_sales, product | 1 |
| Founder | `okr_shipped` | `roadmap_okrs` on an own project, `kanban_status = 'done'` | each objective shipped | product, engineering | 1 |
| Founder | `financial_model` | `financial_models.updated_by` | each model kept | finance_ops | 1 |
| Founder | `cap_table_security` | `cap_table_securities.user_id` | each security recorded | legal_compliance, finance_ops | 1 |
| Founder | `esign_sent_completed` | `esign_envelopes.created_by`, status completed | each envelope fully signed | legal_compliance | 1 |
| Founder | `esign_signed` | `esign_recipients.user_id`, `signed_at` set | each document signed | legal_compliance | 0.5 |
| Founder | `lab_milestone` | `spinout_lab_milestones.user_id` | each skill milestone (see below) | per milestone | 0.5 |
| Investor | `dd_section_signed_off` | `dd_sections.signed_off_by` (migration 339) | each section signed off | per section (see below) | 1 |
| Investor | `commitment` | `commitments.investor_user_id`, pending or confirmed | each commitment | capital_network, finance_ops | 1 |
| Investor | `deal_worked` | `deal_stage_events.actor_user_id` | each distinct deal moved | capital_network | 0.5 |
| Partner | `office_hours_completed` | `partner_bookings` on the user's partner profile, status completed | each session held | specialization | 1 |
| Partner | `office_hours_rated_well` | `partner_booking_ratings` (361), rating ≥ 4 | each well-rated session | specialization | 0.5 |
| Partner | `office_hours_action_closed` | `partner_booking_action_items` (360) on own bookings, `done_at` set | each action item closed | specialization | 0.5 |
| Partner | `engagement_milestone` | `engagement_milestones` on own `engagements` | each milestone delivered | specialization | 1 |
| Partner | `perk_redeemed` | `perk_claims` on `perks.partner_user_id`, redeemed | each redemption | specialization | 0.5 |
| Advisor / coach | `advisor_engagement` | `advisor_engagements` on the user's advisor profile, started | each engagement | specialization | 1 |
| Advisor / coach | `expert_session_completed` | `expert_bookings` on the user's expert profile, completed | each session held | specialization | 1 |
| Advisor / coach | `expert_rated_well` | `expert_ratings`, stars ≥ 4 | each well-rated session | specialization | 0.5 |
| Advisor / coach | `guidance_answered` | `cohort_guidance.advisor_user_id`, answered, not retired | each cohort question answered | specialization | 0.5 |

**Specialization axes.** For partner and advisor sources, the axes are the
ones the person's own profile names: `partners.specialization`,
`advisors.expertise_json` and `experts.categories_json`. These are matched on
whole words against a fixed word list per axis, plus each axis's legacy labels.
If the profile names no axis, those actions are reported as `unmapped` ("not
counted: your profile's specialization names no radar axis"). They are never
guessed onto an axis.

**Lab milestones that count.**

- `pitch_deck_drafted`: marketing_brand, capital_network
- `brand_basics_filled` and `landing_page_created`: marketing_brand, design
- `icp_defined`, `discovery_followups_mapped` and `market_research_shared`:
  gtm_sales, product
- `market_sizing_completed`: gtm_sales, finance_ops
- `mvp_scoped`: product, engineering
- `okrs_created`: product
- Legal set (legal_compliance): `incorporation_completed`, `ein_received`,
  `founder_stock_issued`, `section83b_filed`, `cofounder_agreement_signed`.
  `captable_locked` also counts for finance_ops.
- Finance set (finance_ops): `use_of_funds_filled`,
  `revenue_summary_generated`. `revenue_proof_added` also counts for
  gtm_sales.
- Capital set (capital_network): `fundraise_ask_locked`,
  `investor_intros_secured`, `data_room_built`.

Milestones that record taking part rather than doing the work are not
evidence: `project_created`, `profiling_completed`, the meetings booked, and
the scoring milestones.

**Due-diligence sections.**

- legal_compliance: `corporate_legal`, `compliance_aml`, `kyb_entity`,
  `kyc_individual`, `accreditation`
- finance_ops: `financial_health`
- engineering and product: `product_tech`
- engineering: `cyber_posture`
- product: `market_position`
- product and gtm_sales: `market_traction`
- capital_network: `founder_integrity`, `reputation_press`

**Checked and left out.**

- `deal_memos` has no author column, so a memo cannot be attributed to one
  person.
- There is no follow-on table.
- `advisor_deliverables` duplicates engagements.
- `mentor_bookings` records the booker, not the mentor's work.

### Store and route

- `skill_evidence` (migration 362) holds one row per (user, axis, source):
  `count_lifetime`, `count_window`, `weighted`, `first_at`, `last_at`,
  `computed_at`. `skill_evidence_cursor` is the batch's resume point.
- **`GET /api/skills/me/evidence`** (requireAuth, caller only) is computed on
  read. It returns, per axis: `self_level`, `evidence`, `blended`, `basis`,
  `provenance` (for example "3 pitch-deck versions saved, last in August 2026
  (1 in the last 12 months)") and `lifetime_actions`. It also returns
  `engine_version`, `window_days`, `half_life_days` and `unmapped`.
- **`recomputeEvidenceBatch(env, { limit, now })`** is the entry point for
  S14's nightly cron. It walks users by id from the cursor, at most `limit`
  per run (default 25, clamped to 1–200). It rewrites a row only when its
  figures change and deletes rows whose evidence is gone, so a second pass at
  the same moment changes nothing. `recomputeUserEvidence(env, userId, now)`
  does the same for one user, after an answer, for example.
