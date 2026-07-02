# Personal Advisor / Your Profile & Fit — audit + architecture

**Status:** audit complete; profiling-completion bug fixed + values wheel added in
this change. Everything else below is the target design with concrete next steps.
**Scope:** the "Your Profile & Fit" dashboard section, the conversational advisor
that feeds it, Best-fit matches, and Brand & Landing contact routing.

Production truth (see `CLAUDE.md`): the **Cloudflare Worker is the API**
(`cloudflare-worker/src/routes/*`), **D1 is the store**, the FastAPI in
`backend/` is Replit-dev-only. All work below lands in the worker + `frontend/`.

---

## 1. Audit summary — current state

| Area | Where | Verdict |
| --- | --- | --- |
| **Profiling completion** | `advisor.ts` `GET /progress` → `ProfileFitSection.jsx` `CompletionCard` | **Was wrong (fixed here).** The card read the flat `total`/`percent`, which counted the *entire dashboard-population bank* — `existingFounder` ≈ 120, `operatingPartner` ≈ 200 (+fit), `admin` = 10. That is the "200+ / 11" the maintainer saw. |
| **Skills radar** | `radar.ts` `GET /radar/me`, `SkillRadar.jsx`, `RADAR_AXES` in `skillsTaxonomySchema.ts` | **Works.** 8 canonical axes, Recharts radar, fed by `user_skills` written from `fit.*` questions tagged `skill_axis`. |
| **Values** | `values.ts` `GET /values/me`, `value_dimensions` (Schwartz + founder) | **Backend works; visualization was a text list.** Added a radial "values wheel" (`ValuesRadial.jsx`) in this change. |
| **Archetype** | `assessment.ts` `GET /results/me`, `assessmentScoring.ts` (`computeAssessment`/`assignArchetype`), `assessment_*` tables | **Works but is a separate gamified system** (centroid match on skill+value vectors). No public "submit" route in the worker today — results come from the assessment game / admin re-score. |
| **Axal Fit & values** | `axalFit.ts` (RUBRICS, AXAL_VALUES, bands), `best_fit.ts` `GET /best-fit/me` | **Works.** Weighted rubric → 0–100 + band, 5 Axal values, red-flag probes, all driven by the `fit.*` banks. |
| **Best-fit matches** | `matches.ts` `GET /matches/summary`, `bestFit.ts`, `MatchSummaryCard` | **Works, privacy-safe.** Counts + one anonymized teaser free; full list paywalled/admin. |
| **Brand & Landing contact routing** | `brand.ts` `POST /landing/:slug/waitlist` → `ingestContact` (`contacts.ts`) | **Backbone already exists and is good.** `routeFor(audience)`: customer→`discovery`, investor→`raise`, everyone else→`network`. Single `contacts` table is the one home. |
| **Book with Guillaume** | `consultations.ts`, `BookConsultationCard` | **Works** as a booking entry point; does not yet attach a profiling snapshot. |

### The completion bug in one paragraph
`bankFor(persona)` returns the **whole dashboard-population bank** concatenated
with the persona's fit bank — that bank exists to fill *every* page (build,
capital, legal, network…), not to profile the person. `GET /progress` reported
`total = visibleBank.length` and the Profile & Fit card rendered it verbatim, so
"Profiling completion" showed the size of the page-fill questionnaire (≈200 for
partners, 10 for admin) instead of the number of questions that actually build
the four Profile & Fit dimensions.

---

## 2. The fixed, fixed-size question bank (already in the repo)

The four Profile & Fit dimensions are driven **only** by the conversational
`fit.*` banks (`services/advisor/banks/fit_*.ts`, built via `fitShared.ts`).
These are already a clean, limited, per-persona set — no 200-question test:

| Bank | Questions | Drives |
| --- | --- | --- |
| `fit_founder` | 25 | founder rubric (8 categories) + 4 skill axes + 5 founder value spectrums + 5 Axal values |
| `fit_investor` | 18 | investor rubric + skill/value/Axal tags |
| `fit_partner` | 17 | partner rubric + tags |
| `fit_mentor` | 17 | mentor rubric + tags |
| `fit_coach` | 17 | coach rubric (rides inside the mentor conversation) + tags |

Each fit question carries a `measures` map: `rubric_category` (→ Axal Fit),
`skill_axis` (→ radar), `value_dim` (→ values), `axal_value` (→ the 5 Axal
values), `red_flag` (→ diligence). Answers are `scale` (0–5), "no wrong
answers." **This is the question bank the maintainer asked to verify — it
exists.** The gap was only that *completion* counted the wrong bank.

### Profiling sections (added: `questionBank.ts`)
`profilingSectionsForBank(bank)` buckets the working bank's `fit.*` questions
into the sections the UI renders, each question in exactly one bucket:

- `skill_axis` → **Skills**
- else `value_dim` → **Work values**
- else (`rubric_category` / `axal_value` / red-flag) → **Axal Fit & values**

Founder example: Skills 4, Work values 5, Axal Fit & values 16 → **25 total**.
(Archetype is a separate assessment flow — reported on its own, not folded into
this count.)

---

## 3. What changed in this PR

1. **`cloudflare-worker/src/services/advisor/questionBank.ts`** — added
   `PROFILING_SECTIONS`, `profilingSectionFor`, `profilingSectionsForBank`.
2. **`cloudflare-worker/src/routes/advisor.ts`** — `GET /progress` now returns a
   `profiling` block `{ total, answered, percent, complete, applicable,
   sections[] }` scoped to `fit.*` questions. The full-bank `overall`/flat
   fields are **untouched** so the advisor right-rail keeps working.
3. **`frontend/src/components/profile/ProfileFitSection.jsx`** — `CompletionCard`
   reads `data.profiling` (true count + per-section bars), with a clean
   "not set up for this account type" state for admin (`applicable:false`) and a
   legacy fallback. `ValuesLeanCard` now renders the wheel.
4. **`frontend/src/components/profile/ValuesRadial.jsx`** (new) — Recharts
   `RadialBarChart` values wheel; colour + label encode the lean direction.

Verified: worker `tsc --noEmit` clean, `check-advisor-bank-drift.mjs` OK,
advisor tests green, `vite build` green.

---

## 4. Proposed data model

### 4.1 Question banks (unchanged — documenting the target)
Keep TS-authored banks (typed, testable, drift-checked). Do **not** move the
question bank into D1. Per-persona sizes stay small; extend by adding rows to a
`fit_*` bank, never by growing the page-fill bank for profiling purposes.

### 4.2 Scores (already in D1)
- `user_skills` (user_id, skill/axis, score) → radar
- `user_values` (user_id, dimension_id, score −2..+2, confidence 0..1) → wheel
- `axal_values` (user_id, value_key, score 0..5, confidence) → 5 Axal values
- `user_fit_scores` (user_id, persona, total_score, band, rubric_json,
  red_flags_json) → Axal Fit scorecard
- `assessment_results` (archetype_slug, skillVector, valueVector) → archetype

### 4.3 Contacts / Network backbone (already in D1 — keep as the one home)
`contacts` is the single primary home. Do not add parallel mini-CRMs.

```
contacts(
  id, uid, project_id,
  audience     -- customer|investor|partner|advisor|mentor|cofounder
  routed_to    -- discovery|raise|network   (derived by routeFor(audience))
  name, email, cta, message, source, landing_page_id,
  status       -- new|invited|contacted|replied|qualified|active|passed
  promoted_to, promoted_ref_id, last_activity_at, created_at, updated_at)
contact_replies(...)  contact_tasks(...)
raise_prospects(...)  -- investor promotions (stage pipeline)
```

Rule: **every captured contact has exactly one `routed_to`.** Customer →
Customer Discovery; investor → Raise; advisor/mentor/cofounder/partner →
Network. Promotion (`POST /contacts/:uid/promote`) is the only cross-subsystem
hop and it stamps `promoted_to` + `promoted_ref_id` rather than duplicating.

### 4.4 Matches (already in D1)
`match_preferences` (opt-in) + on-demand scoring in `matches.ts`. Matches are
computed from public/opt-in profile signal (skills, values lean, Axal band,
sectors/stages) — **never** raw private answers.

---

## 5. Best-fit matches — wiring (target)

Profiling → match signal (privacy-safe projection only):

| Target | Signal used | Never exposed |
| --- | --- | --- |
| Customers | ICP tags, sector, discovery stage | contact emails until invited |
| Investors | sectors/stages, ticket band, thesis tags, Axal band | raise internals, cap table |
| Co-founders | complementary skill axes (radar gaps), value-spectrum compatibility, Axal values | free-text answers |
| Mentors / Advisors | domain axes, mentor/coach rubric, availability | fit narrative internals |
| Partners | strategic-alignment tags, network quality | commercial terms |

- `GET /matches/summary` stays the public surface: **counts + one anonymized
  teaser** free; names/scores/reasons paywalled (`openPaywall('studio')`) or
  admin. Keep this contract.
- **Send from a match:** add `POST /matches/:type/:userId/introduce` that opens
  an `introductions` request (already have `introductions.ts` + quota) — the
  founder shares a Brand & Landing page and/or deck to a matched profile via the
  platform, never leaking the counterparty's contact details before acceptance.

---

## 6. Brand & Landing contact capture (mostly built — finish the edges)

Already working: `POST /brand/landing/:slug/waitlist` validates email, writes
`waitlist_signups`, and best-effort `ingestContact(...)` into `contacts` with the
right `audience`/`routed_to`. Audience-specific templates exist (Customers,
Investors, Partners, Advisors, Mentors, Co-founders).

Concrete next steps:
1. **Frontend audience wiring** — ensure each landing template posts its
   `audience` and `cta` on the waitlist form so `routeFor` files it correctly
   (customer→discovery, rest→network, investor→raise).
2. **Customer Discovery consumption** — surface `routed_to='discovery'` contacts
   in `CustomerDiscoveryPage` (they already exist in `contacts`); dedupe against
   `waitlist_signups`.
3. **Founder invitations** — `POST /contacts/invite` exists; expose "Invite" +
   "Send landing/deck" actions from Network and from a Best-fit match.
4. **NDA + three-party intro flow** — extend `introductions.ts`:
   - Optional NDA checkbox on the landing/intro; store acceptance
     (`nda_accepted_at`, `nda_version`) on the `introductions` row.
   - Three-party state machine: `requested → axal_review → target_invited →
     accepted|declined`, parties = {Axal VC, founder, target}. Reuse `esign.ts`
     for a countersigned NDA when required.

---

## 7. Book with Guillaume (light touch)

Keep the card as a single clean entry point. One change: on
`POST /consultations` (`bookConsultation`), attach a **profiling snapshot ref**
(latest `user_fit_scores` + `assessment_results` + top values) so the admin
consultation view can open with context. Do **not** add fields to the user form.

---

## 8. Opinionated calls

- **Merge:** "Values lean" text list is now the caption under the values wheel —
  one values surface, not two.
- **Keep separate:** archetype (assessment game) stays its own flow; don't fold
  it into the fit banks — different methodology (centroid vs rubric).
- **Do not** grow the page-fill bank to change profiling completion; profiling
  completion is defined by `fit.*` only.
- **One CRM:** `contacts` is the backbone. `waitlist_signups` stays a raw
  capture log that feeds `contacts`; it is not a second CRM.
- **Admin isn't profiled:** `applicable:false` → the card says so instead of
  showing a misleading percentage.
