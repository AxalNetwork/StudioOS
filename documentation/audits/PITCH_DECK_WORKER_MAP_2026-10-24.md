# Pitch deck studio — what the Worker serves, board by board (2026-10-24)

**A snapshot, not a spec.** S1 made this map for #2434 on 2026-10-24 by reading
the code on `main` at `db73a01`, to split the Pitch deck studio's canvas
(PD1–PD28, D894) into slot tasks. It was not checked against production, and
nothing here is maintained afterwards: re-read the code before acting on a line.
One claim was checked by running code: the route order in §0.1 (an in-memory
Hono probe).

Read on `db73a01` (origin HEAD, 2026-10-24). The task began on `12e1c4d`. Between those two commits the only cited file that changed is `cloudflare-worker/src/index.ts`, which gained 2 lines for admin insights. Every line cited below was re-checked on `db73a01`.

Path short forms used below: `wk/` = `cloudflare-worker/src/`, `fe/` = `frontend/src/`, `mig/` = `cloudflare-worker/sql/migrations/`, `canvas/` = the board list of `design/incoming/Pitch Deck Studio · Boards.dc.html`. Board ids come from that file.

---

## 0. Findings in brief

1. **Two deck GET routes cannot be reached.** `GET /api/decks/methods` (`wk/routes/decks.ts:1516`) and `GET /api/decks/brand` (`:2011`) are registered after `GET /api/decks/:id` (`:1055`). Hono matches routes in the order they were registered. An in-memory probe with the repo's own hono@4.13.13 (`cloudflare-worker/package.json:19`), using the same route order, answered `/api/decks/methods` and `/api/decks/brand` with the `/:id` handler. `/recommend` (`:713`, registered earlier) and `PUT /brand/watermark` (two segments) are unaffected. The `/:id` handler then runs `getDeckRow(NaN)` and returns `404 {error:'not found'}` (`:1060`). As a result the template picker's `api.deckMethods()` (`fe/pages/PitchDeckPage.jsx:136-143`) gets no templates. PD3's 13 templates and their plan locks depend on this route. This bug is not in the issue's list of twelve.
2. **Of the issue's twelve bugs, 1 and 12 are partly fixed and 5 is fixed for the generic draft.** The other nine are still present on HEAD; see §4.
3. **Slide JSON cannot carry anything the studio needs yet.** `sanitizeSlides` and `sanitizeFields` keep only `title, subtitle, body, bullets, image_url, spec_id, method_id, appendix, fields[{key,label,kind,value,source,edited,readonly}]` (`wk/routes/decks.ts:380-444`). Any `layout`, `notes`, `binding` or theme key is silently dropped on every save.
4. **A share link is already frozen to one version.** Each `pitch_decks` row is one version (`decks.ts:513-523`). The token scope is `deck:<id>:v<version>` (`:1354`), and the read loads that row (`:837`, `:876`). So "Frozen at v4" (PD18, PD20) is true today, and live links are not possible.
5. **There are two link writers with different options.** The editor's `POST /api/decks/:id/share` sets no investor, no download or forwarding setting, and has a view limit (`decks.ts:1204-1218`). The module's `POST /api/cycles/raise/deck-links` sets an investor, download and forwarding, and has no view limit (`wk/services/raiseWriters.ts:342-359`). Its links therefore store `view_limit = 2147483647` (`decks.ts:1321`, `:1362`).

---

## 1. Mounts (`wk/index.ts`)

| Prefix | Router | Line | Note |
|---|---|---|---|
| `/api/decks` | `deckShareActions` (`routes/deck_share_actions.ts`) | 1159 | Mounted first, so `/share/:token/{context,signup,nda,feedback,deal-pack,…}` resolve here (comment at 1157-1158) |
| `/api/decks` | `decks` (`routes/decks.ts`) | 1160 | |
| `/api/deck-reviewer` | `deckReviewer` | 1165 | |
| `/api/cycles` | `cycleRecords` (record pages and actions, including the pitch-deck link record) | 1433 | |
| `/api/cycles/raise` | `cycleRaise` (`routes/cycle_raise.ts`) | 1434 | |
| `/api/ai`, `/api/ai/rail/proposals`, `/api/ai-budget` | AI pricing and rail, D780 proposals, balance | 886, 885, 887 | Adjacent; boards need them |
| `/api/brand` | brand kit, logo image generation | 1155 | Adjacent |
| `/api/integrations` (also `/api/connectors`) | connector list and sync state | 1261 (1260) | Adjacent (PD9d) |

The rate limit `deck_share_signup` allows 6 per minute per IP and fails closed (`wk/middleware/rateLimit.ts:345-351`).

---

## 2. The access rule every deck route uses: `projectOwned`

`wk/middleware/projectContentAccess.ts:15-47` (#2435, rewritten in `bbd99f9`, #2633, 2026-10-23):

- No project gives `NotFound` (`:19`).
- **`admin` returns at once, for reads and writes alike** (`:20`).
- `investor` gets `NotFound` if the venture is not findable for them, and is otherwise always `Forbidden` (`:23-26`).
- Everyone else who is not the owning founder needs an accepted `project_members` role of `owner`, `cofounder` or `advisor`. An advisor is refused when `write` or `contactData` is set (`:30-34`). Then `canAccessProject` applies (`:35`).
- The owner must be in the active company, otherwise `NotFound` (`:36-37`).
- A write by a non-owner inserts an `activity_logs` row `project_content_write_authorized` first (`:38-45`).

The tier gate is `ensureTier(user, 'studio')` (`wk/middleware/requireTier.ts:101-107`). The `BYPASS_ROLES` pass it (`:69`). `studio` is "Raise + Grow" and `growth` is "Validate + Build" (`:6-12`, `:36-37`).

The Raise cycle routes use `scope()` → `canWrite`: admin, or `ownsVenture` (`wk/routes/cycle_raise.ts:81-96`; `wk/routes/_founder_validate_helpers.ts:31-39`, `:90-93`).

---

## 3. Endpoints

### 3.1 `/api/decks/*`: `wk/routes/decks.ts`

The tables are created lazily by `ensureSchema` (`:42-144`): `pitch_decks` (`:45-54`), `pitch_deck_proposals` (`:58-67`), `pitch_deck_share_tokens` (`:70-88`, plus the 463 columns at `:130-141`) and `deck_share_views` (`:91-100`). `rowToDeck` returns `{id, project_id, version, title, is_current, created_at, slides?}` (`:495-504`). `created_by` is stored (`:52`, `:519-521`) but never returned. `rowToProposal` returns `{id, project_id, base_deck_id, title, method_id, created_at, slides}` (`:486-493`).

| Method · path | Lines | Auth · roles · tier · ownership | Body | Response JSON | Reads / writes |
|---|---|---|---|---|---|
| POST `/generate` | 525-554 | auth; `ensureTier 'studio'` (528); `projectOwned write` (535) | `{project_id}` | `rowToDeck` | R `projects`, `landing_pages` (via `fetchLandingPageForProject`, 548); AI `rail_vision`, option `deck_draft` (335-345); **W `pitch_decks` directly, not a proposal** (551) |
| POST `/positioning` | 563-710 | auth; `studio` (564); `projectOwned write` (572) | `{project_id}` | `{project_id, project_name, one_liner, elevator_pitch, positioning_lines[], sourced_from{team, advisors, team_status, traction, updates, financials}}` (702-709) | R `projects`, `users`, `project_members` (587-600), `financial_models` (610-612), `portfolio_updates` (620-623); AI `rail_write`, `draft:positioning` (677-686). Errors: `refuseRun`, 503 `ai_unavailable`, 502 `ai_failed` (687-700) |
| GET `/recommend?project_id=` | 713-728 | auth; `projectOwned` read (719) | none | `{method_id, sector, stage, source:'override'\|'sector'\|'stage_default'}` (`wk/services/decks/recommend.ts:72-77`) | R `projects`, `deck_recommendation_overrides` (`recommend.ts:90-93`) |
| GET `/by-project/:pid` | 730-746 | auth; `projectOwned` read (733) | none | `{versions:[rowToDeck without slides], proposal: rowToProposal\|null}` (742-745) | R `pitch_decks`, `pitch_deck_proposals` |
| GET `/print-export/:token` | 802-822 | HMAC print token, 180-300 s (`signDeckPrintToken` 202-208, `verifyDeckPrintToken` 209-226); no user | none | `rowToDeck + {method_id, project_id, project_name, spinout_fields}` (815-821) | R `pitch_decks`, `projects`; Spin-Out bake (766-795) |
| GET `/share/:token` | 824-925 | signed share token (827-836); 410 when expired (832-834); forwarding bind (842-843); atomic view claim (848-874) | none | `rowToDeck + {view_id, method_id, project_id, project_name, spinout_fields, allow_download}` (914-924) | R/W `pitch_deck_share_tokens` (claim 848-865, bind 1421-1451); W `deck_share_views` (891-894); sets cookie `axal_deck_viewer` (1437) |
| POST `/share/:token/heartbeat` | 932-959 | token plus `shareLinkLive` (944) | `{view_id, seconds, slides:{"<idx>":seconds}}` | `{ok}` | W `deck_share_views.read_seconds` (946-951); W `deck_view_slides` through `recordSlideSeconds` (955-957) |
| GET `/:id/engagement` | 967-1053 | auth; `projectOwned` read (974) | none | `{deck_id, total_views, total_read_seconds, last_viewed_at, conversions{signups, nda_signed, feedbacks, deal_pack_opened, deals_signed}, shares[{id, created_at, expires_at, view_limit, view_count, last_viewed_at, exhausted, revoked_at}], views[{id, share_token_id, ip_hash, ua_fingerprint, read_seconds, created_at, updated_at, conversion}]}` (1017-1052) | R `pitch_deck_share_tokens` (976-983, limit 50), `deck_share_views` (984-990, limit 200), `deck_share_conversions` (1003-1008). **Not returned:** investor or prospect, `allow_*`, per-slide seconds, deck version per link |
| GET `/:id` | 1055-1064 | auth; `projectOwned` read (1061) | none | `rowToDeck` | R `pitch_decks`. **Shadows GET `/methods` and GET `/brand`** (§0.1) |
| PUT `/:id` | 1066-1179 | auth; **no tier**; `projectOwned write` (1076); premium template needs `studio`, else 402 `PAYWALL_PREMIUM_METHOD` (1078-1082); method locked (1087-1091) | `{slides[], title?}` | `rowToDeck` of the **new** version (1177-1178) | W `pitch_decks` new version (`insertVersion` 513-523); Spin-Out write-back to `projects` (1101-1175) |
| POST `/:id/restore` | 1181-1193 | auth; `projectOwned write` (1187) | none | `rowToDeck` (new version) | W `pitch_decks` |
| POST `/:id/share` | 1195-1230 | auth; `studio` (1196); `projectOwned write` (1202) | `{expires_in_hours\|ttl_hours (1..720, default 72), view_limit (1..100, default 1)}` (1205-1213) | `{id, token, expires_in_seconds, expires_at, view_limit, share_path, legacy_share_path, one_time}` (1219-1229) | W `pitch_deck_share_tokens` through `createShareLink` (1349-1379), which logs `deck_link_created` (1372-1377). **No investor, download or forwarding** |
| DELETE `/:id/shares/:shareId` | 1264-1278 | auth; **no tier** (by design, 1259-1262); `projectOwned write` (1272) | none | `{ok, id, revoked_at, expires_at, newly_revoked}` (1302-1309) | W `pitch_deck_share_tokens.revoked_at, expires_at` (1294-1298). **No `logCycleWrite`** |
| GET `/methods` | 1516-1544 | auth (unreachable, §0.1) | none | `{methods[{id, key, label, prompt_hint, best_for, slide_count, premium, category, ai_fill_hint, locked, fields_from_*, slides[{id, title, appendix, fields[{key, label, kind, optional}]}]}], premium_method_ids, user_tier, can_remove_footer, can_upload_watermark, watermark_url}` | `DECK_METHODS` (`services/decks/methods.ts:285`), 13 templates (`:287-823`), 4 premium (`:598`, `:743`, `:792`, `:828`); R `deck_brand_watermarks` |
| POST `/apply-method` | 1566-1665 | auth; **no tier** unless premium (1576-1584); `projectOwned write` (1587) | `{project_id, method_id}` | Spin-Out: `{deck, method_id, coverage_pct, coverage}` (1619-1625). Otherwise `{proposal, method_id, coverage_pct}` (1660-1664) | R `projects`, `financial_models`, `cap_table_holders` (autofill), `landing_pages`. AI `rail_vision`, option `form:deck-template` (1631). W `pitch_deck_proposals` (`proposeFill` 1672-1684; replaces any unkept proposal). The Spin-Out branch writes `pitch_decks` directly (1613) |
| POST `/proposals/:id/keep` | 1699-1710 | auth; `projectOwned write` through `ownedProposal` (1686-1692) | none | `{deck: rowToDeck}` | W `pitch_decks` new version; D `pitch_deck_proposals`. **Whole deck only; no per-slide keep** |
| DELETE `/proposals/:id` | 1713-1720 | as above | none | `{ok}` | D `pitch_deck_proposals` |
| POST `/:id/autofill` | 1737-1832 | auth; `projectOwned write` (1746); premium check (1765-1772); 409 `no_method_id` (1756-1762) | none | `{proposal, method_id, coverage_pct, slide_confidence[{index, spec_id, title, coverage_pct}]}` (1826-1831); Spin-Out adds `coverage` (1784-1793) | Same reads as `apply-method`; AI option `form:deck` (1796); W `pitch_deck_proposals` |
| POST `/:id/export` | 1848-2007 | auth; **no tier**; `projectOwned write` (1854) | `{format:'pdf'\|'pptx'}`, nothing else accepted (1857-1860) | PDF bytes (1940-1947); 503 `browser_binding_unavailable` (1898-1906); 502 `pdf_render_failed` "The PDF could not be produced. Try again in a moment." (1932, 1937); PPTX made of screenshots, one per slide (1967-2006); text-only fallback (1951-1965) | R `pitch_decks`; `BROWSER` binding; brand from the **exporter** (1884). Nothing about the export is recorded |
| GET `/brand` | 2011-2015 | auth (unreachable, §0.1) | none | `{brand{show_footer, footer_text, watermark_url, can_remove_footer}}` | R `deck_brand_watermarks` |
| PUT `/brand/watermark` | 2017-2033 | auth; `studio` inside `setStudioWatermark` (`branding.ts:64-70`) | `{watermark_url\|null}` | `{brand}` | W `deck_brand_watermarks` |
| GET / PUT / DELETE `/admin/recommend-overrides` | 2037-2067 | `role === 'admin'` only (2039, 2046, 2060). No HQ-versus-branch check | PUT `{sector, stage, method_id}`; DELETE `?sector&stage` | `{overrides[{sector, stage, method_id, updated_at}]}` | R/W `deck_recommendation_overrides` |

**Slide shapes.** The legacy shape is `{title, subtitle, body, bullets[], image_url}`. The fielded shape is `{title, subtitle, spec_id, method_id, appendix, fields[{key, label, kind, value, source, edited?, readonly?}]}`. Allowed kinds are `title, subtitle, paragraph, bullets, image, metric_grid, quote, auto` (`:405`). `source` is one of `data, ai, placeholder, auto` (`:414`). Image values must pass `sanitizeImageUrl`, which takes https only and rejects private hosts (`:460-481`), so `data:` URLs are refused. Brand kit values are injected as `brandkit_*` paragraph fields on the cover only (`wk/services/decks/branding.ts:143-194`).

### 3.2 `/api/decks/share/:token/*`: `wk/routes/deck_share_actions.ts`

`verifyShareToken` checks the signature, the `deck:<id>:v<n>` scope and `shareLinkLive`, which requires the link not revoked, not expired and, with forwarding off, opened in the bound browser (`:86-98`; `decks.ts:1405-1414`). The lazy tables are `deck_share_conversions` (`:30-40`) and `deck_share_feedback` (`:44-56`).

| Method · path | Lines | Auth | Body | Response | Reads / writes |
|---|---|---|---|---|---|
| GET `/context` | 173-185 | token | none | `{deck_id, project_id, project_name, deck_title, nda_template_key:'investor_nda_axal'}` | R `pitch_decks`, `projects`. **No `nda_required`, no NDA text** |
| POST `/signup` | 200-317 | token; Turnstile (215-233); 409 `requires_login` when the email already exists (244-254) | `{email, name, role?: investor\|partner\|founder, view_id?, turnstileToken}` | `{ok, user_id, is_new, email, name, role, csrf_token}` and session cookies (304-316) | W `users`, `activity_logs`, `onboarding_progress`, `deck_share_conversions(type='signup')` |
| POST `/nda` | 347-421 | token **plus a signed-in session** (355-358) | `{signed_by, view_id?}` | `{ok, document_id, template_key, data_room_access_granted:false, message}` (420); 409 `template_fields_unfilled`, 503 `template_unreadable` (386-393) | R the template row `investor_nda_axal` (`deckShareNdaBody` 337-345); W `documents (doc_type 'nda_acceptance', status 'signed')` (396-411), `deck_share_conversions(type 'nda_signed')` (414-418). **No pairwise NDA** |
| POST `/feedback` | 428-512 | token; session optional (437-438) | `{view_id?, slide_reactions{}, overall_note, problem_fit: strong\|mild\|none, willingness_to_pay, contact}` | `{ok, feedback_id}` | W `deck_share_feedback` (455-462), **mirrors into `discovery_interviews`** (469-503), W conversion `feedback` |
| POST `/deal-pack` | 522-589 | token plus session (527-530) | `{check_size, valuation_cap, discount, view_id?}`, all required (534-535) | `{ok, documents[{id, type, title, content}]}` (581-588) | W `documents` ×3 (`deal_pack_safe`, `_term_sheet`, `_side_letter`) (557-572), conversion `deal_pack_opened` (574-579) |
| POST `/deal-pack/sign` | 595-657 | token plus session | `{signed_by, document_ids[], view_id?}` | `{ok, signed_ids[], not_signed_ids[]}` | W `documents.status='signed'` only when the same user's `deal_pack_opened` on this token lists the document id and a completed e-sign envelope carries the same body (625-637); conversion `deal_signed` |

### 3.3 `/api/deck-reviewer/*`: `wk/routes/deck_reviewer.ts`

Every row is scoped to the caller (`user_id`), not to the venture. The tables are `deck_reviews` and `deck_review_history` (`wk/services/deckReviewSchema.ts:22-31`). Neither has `deck_id` or `deck_version`. The review shape is `{overall_score, summary, strengths[], weaknesses[], missing_sections[], red_flags[], section_suggestions[{section, suggestion}], priority_fixes[], improved_wording[{section, before, after}], fix_first}` (`wk/services/deckExtract.ts:51-62`). The record `mapRow` is `{id, project_id, source, filename, mime, size, raw_retained, extraction_status, status, title, edited, chunks, sections, review, created_at, updated_at}` (`:66-85`).

| Method · path | Lines | Body | Response | Notes |
|---|---|---|---|---|
| POST `/upload` | 132-199 | multipart `file`, `project_id?` | `mapRow`, or `{…, extraction_error, fallback:'paste'}` (186) | R2 `FILES` `deck-reviews/<user>/<id>.<ext>` (162-177); AI options `review:deck-file` (189). `project_id` is stored without a check (179-180); only the AI context read is gated by `canAccessProject` (107-113) |
| POST `/paste` | 205-228 | `{text, filename?, project_id?}` | `mapRow` | Option `review:deck-text` (219). This is the stopgap way to review a studio version: the client sends the deck's text |
| GET `/` | 231-238 | none | `{reviews[summary rows]}` | limit 100 |
| GET `/:id` | 241-247 | none | `mapRow` | |
| PATCH `/:id` | 250-276 | `{title?, sections?, review?}` | `mapRow` | |
| POST `/:id/regenerate` | 280-297 | none | `mapRow` | Option `review:deck-again` (291); appends to `deck_review_history` (294) |
| DELETE `/:id/raw`, DELETE `/:id` | 301-338 | none | `{ok, raw_retained:false}` / `{ok}` | |
| GET `/:id/export?format=json\|md` | 341-351 | none | JSON or Markdown | |

No route ever reads `deck_review_history`. It is only written (`:195`, `:225`, `:294`). No route returns the cost of a run.

### 3.4 `/api/cycles/raise/*`: deck links and the two module records

| Method · path | Lines | Auth | Body | Response | Reads / writes |
|---|---|---|---|---|---|
| POST `/deck-links?project=` | `cycle_raise.ts:212-219` → `createDeckLink` `raiseWriters.ts:342-365` | `scope` → `canWrite` (admin or owner); `studio` (343) | `{deck_id, prospect_id \| investor_label (exactly one), expires_days: 7\|14\|30\|null, allow_download?, allow_forwarding?}` (345-354) | 201 `{id, share_path, expires_at, allow_download, allow_forwarding}` (361-364); the raw link is shown only this once | W `pitch_deck_share_tokens` through `createShareLink`; checks that `pitch_decks` and `raise_prospects` belong to this venture (322-326, 346-348). **No `view_limit`** |
| PATCH `/deck-links/:id?project=` | `cycle_raise.ts:221-230` → `raiseWriters.ts:374-403` | same; `studio` (375) | investor, `allow_download`, `allow_forwarding`, an earlier `expires_days` only (393-397) | `{ok, id}` | W `pitch_deck_share_tokens`; logs `deck_link_updated` (401) |
| GET `/modules/pitch-deck?project=` | `cycle_raise.ts:127-161` | `scope` | `q, filter=status, sort=last_viewed\|newest\|views, page` | `{module, card, records{cols:[link, expires, views, time, most_read], rows, filters, sorts, add}, parts?.mercury}` | Card (`raiseCycle.ts:580-603`): `vbars` views per week over 8 weeks (564-578) plus `hbar` seconds per slide (591-600). Records (`raiseCycle.ts:608-659`): per link, investor (626-627), state, views, minutes, top slide (613-615). For the founder only, `parts.mercury` = `citableFigures` → `{figures[{key: revenue_last_month\|revenue_growth\|net_burn\|runway, label, value, unit, source, fact_id}], months[{month, cents, fact_id}]}` (`mercury/raiseFeeds.ts:493-507`, `:516`; `cycle_raise.ts:149-158`) |
| GET `/modules/investor-narrative?project=` | same | `scope` | `filter=investor_type`, `sort` | Card: versions by investor type plus mismatches (`raiseCycle.ts:499-532`). Records: `[version, investor_type, deck, mismatches, date]` (534-555) | R `spinout_deck_overrides`, `narrative_checks`, `narrative_version_meta`. The check is `checkInputs` (447-478): 3 `FIGURES` (392), read by fixed patterns (410-423) against `project_metrics` and the active `raise_rounds`. It is written by `saveNarrativeVersion` (`raiseWriters.ts:172-177`) |
| Record page and actions for one link | `routes/cycle_records.ts:113-152` (mounted at `/api/cycles`); spec `services/records/raise.ts:365-451` | `read:'write'`, `write:'write'` → `canWrite` (`records/raise.ts:123`; `cycle_records.ts:15-17`, `:71`) | `POST …/records/:id/actions/revoke` | Record: `{title, sub, pills, facts[Views, Time on deck, Most read, Expires]}` plus sections Views, Time per slide, Settings, Investor (399-433); form options `decks, prospects, expires` (441-451) | Revoke through `revokeDeckLink` (`raiseWriters.ts:666-676`), which logs `deck_link_revoked` |

`INVESTOR_TYPES` = `angel, pre_seed_fund, seed_fund, series_a_fund, strategic, grant, other` (`raiseCycle.ts:384-388`). These are the PD3 audience cards exactly.

### 3.5 Services read

- `wk/services/deckSlideDwell.ts`: `slideTotals` cleans the heartbeat's `{idx: seconds}` (29-41, indexes 0-199, at most 7200 s each). `recordSlideSeconds` upserts `deck_view_slides(view_id, slide_index, seconds)`, bounded so a view's slides never add up to more than its `read_seconds` (48-58). The table is `mig/442_raise_cycle_stores.sql:89`.
- `wk/services/decks/autofill.ts`: fill order is project column, then `financial_models`, then `cap_table_holders`, then one AI call, then `—` (1-13, 320-412). `coverage_pct` **counts AI-filled fields as covered** (392-395). `derived.runway_target` makes up "18-24 months runway" or "24+" (81-84).
- `wk/services/decks/branding.ts`: `getDeckBrand(user)` sets the footer and watermark from the exporter's tier (40-62). `fetchLandingPageForProject` reads the first `landing_pages` row (118-129). `applyBrandKitToSlides` touches the cover only (143-194). `ensureMethodAllowed` lets admin, partner, investor and advisor bypass (197-207).
- `wk/services/decks/methods.ts`: 13 specs (`DeckMethodId` 18-30; 287-823), field-source vocabulary (11-16), 4 premium (984-986).
- `wk/services/decks/pptx.ts`: `renderDeckPPTX` is text only and adds the footer when `show_footer` (173-175). Image mode ignores `brand` (465-467).
- `wk/services/decks/render.ts`: `renderDeckHTML` (104) has **no caller** and loads Tailwind from a CDN (9-11). It is not the offline, self-contained HTML export the issue plans.
- `wk/services/decks/recommend.ts`: overrides, then sector rules, then stage defaults (79-106).
- `wk/services/decks/axalSpinoutDemoDay.ts`, `spinoutDeckData.ts`, `spinoutDeckOverrides.ts`, `deckRoster.ts`: the Spin-Out template's own data path, reading Lab tables plus `score_snapshots` (`axalSpinoutDemoDay.ts:769-775`). The issue says not to collide with it.

### 3.6 Adjacent endpoints the boards need

| Endpoint | Lines | What it gives |
|---|---|---|
| GET `/api/ai/pricing` | `wk/routes/ai.ts:108-142` | `{unit, prices, audio_prices, routes{task:{model, fallback_chain, alternates}}}`, the receipt's own price table |
| GET `/api/ai/catalogue` | `ai.ts:252-255` | Models with unit prices. The image models are FLUX.1 Schnell, FLUX.2 Dev, FLUX.2 Klein 4B and 9B, Lucid Origin and Phoenix 1.0 (`services/ai/catalogue.ts:109-112`, `:150`, `:162`); most are `partner: true` |
| GET `/api/ai/rail?page=Founder · Raise · Pitch deck` | `ai.ts:482-…` | The page row offers vision models only (`services/ai/railMatrix.json:423-441`); option rows `draft:positioning`, `form:deck`, `form:deck-template`, `review:deck-file`, `review:deck-text` (`:4952-5060`). **No image model and no writing row on the page** |
| GET `/api/ai/me/spend?surface=` | `ai.ts:65-80` → `services/aiSpend.ts:473-509` | `{month{calls, spend_usd}, last_run…}` per page, not per option |
| GET `/api/ai-budget/me`, `/runs` | `wk/routes/ai_budget.ts:25`, `:56` | AI-token balance, run history |
| GET `/api/ai/rail/proposals?option&record&status`, POST `/:uid/decide` | `wk/routes/ai_rail_proposals.ts:28-58` | D780 proposals; a bound figure is refused 422 `never_fill` (51-52) |
| POST `/api/brand/logo` | `wk/routes/brand.ts:1186` (`aiLogo` 505-523) | The only image generation today: FLUX.1 Schnell, task `brand_logo`, returns a `data:` URL |
| GET `/api/brand/landing/by-project/:pid` | `brand.ts:1300-1314` | The first landing page (`ORDER BY id LIMIT 1`, 1311), archived or not |
| GET `/api/integrations`, `/:uid/sync-status`, `/:uid/fed` | `wk/routes/integrations.ts:407`, `:856-869`, `:875` | Connector state and `last_synced_at` (258, 869) |
| GET `/api/cycles/{validate,build,grow}/modules/:slug` | `cycle_validate.ts:111`, `cycle_build.ts:782`, `cycle_grow.ts:359` | Display cards. The Grow revenue card reads `project_metrics(snapshot_date, source, mrr, paying_accounts)` (`services/growCycle.ts:117`). These are card series, not source items with `as_of` and grade |

---

## 4. The twelve bugs on HEAD

| # | Bug | Status | Where now |
|---|---|---|---|
| 1 | `projectOwned` lets admin, partner and investor edit | **Partly fixed** (`bbd99f9`, #2633). Investors are refused (`projectContentAccess.ts:23-26`). Partners and other non-owners need an accepted `owner` or `cofounder` membership to write (`:30-34`). **Still present for `admin`**: `:20` returns before any write check, so admin can save (`decks.ts:1076`), restore (`:1187`), share (`:1202`), revoke (`:1272`), export (`:1854`), autofill (`:1746`), apply a template (`:1587`), generate (`:535`), keep or discard (`:1690`). The module link writers also admit admin (`_founder_validate_helpers.ts:91`). PD21 wants admin read-only. Note: an accepted **advisor** member can still read decks and engagement (`:33`), while PD22 shows advisors nothing; the UI guard (`fe/App.jsx:2906`) is the only thing keeping them out | see left |
| 2 | UI gates on Growth, Worker on `studio` | **Present.** UI: `fe/pages/PitchWorkspacePage.jsx:45` (`hasTier(user,'growth')`, upsell copy `:102-113`). Worker: `decks.ts:528` (generate), `:564` (positioning), `:1196` (share), `raiseWriters.ts:343`, `:375` (deck links). The gap runs both ways: PUT `/:id`, apply-method (non-premium), autofill and export have no tier gate at all | see left |
| 3 | The Deck Builder tab drops the workspace | **Present.** Tab `to: '/raise/pitch'` (`PitchWorkspacePage.jsx:25`), `navigate(t.to)` (`:68`). The route renders the workspace only with `?mode=workspace` (`fe/App.jsx:2906-2909`) | see left |
| 4 | A runway line nobody recorded | **Present.** `decks.ts:305`: `'18-24 months of runway to hit the next milestone.'` in the fallback Ask slide. A second copy, `derived.runway_target` → "18-24 months runway" or "24+" (`autofill.ts:81-84`), is used by every template's Ask slide (`methods.ts:227`). The prompt line "Use the scoring numbers…" is gone (`decks.ts:330-334`) | see left |
| 5 | An internal score on the deck | **Fixed for the generic draft** (`f310860`, #2636). The fallback Market and Traction slides (`decks.ts:285-295`) and the AI context (`:322-329`) carry no score. **Residual:** the Spin-Out template prints `Axal score: N/100 — tier` (`axalSpinoutDemoDay.ts:1384-1387`) from `score_snapshots` (`:769-775`), and that template is one of the 13 (`methods.ts:823`, premium `:828`) | see left |
| 6 | The reviewer makes up a score | **Present.** `deckExtract.ts:212`: `30 + present.length * 6`, clamped 20-90. A failed or refused run returns that heuristic review (`:265-268`), with a made-up `fix_first` (`:231`) | see left |
| 7 | Zeros for missing values | **Present.** `fe/pages/PitchDeckPage.jsx:421` (`${r?.coverage_pct ?? 0}% covered`); `fe/pages/founder/FounderRaisePitch.jsx:220` (`${row.view_count ?? 0} of ${row.view_limit ?? 1}`). The worker feeds it `Number(t.view_limit) || 1` (`decks.ts:1033`). Module links store 2147483647 (`decks.ts:1321`, `:1362`), so they read "0 of 2147483647" | see left |
| 8 | The editor's Share is fixed at 24 h and 1 view, with no investor | **Present.** `PitchDeckPage.jsx:541` (`{expires_in_hours: 24, view_limit: 1}`). The worker route accepts no investor, download or forwarding (`decks.ts:1204-1218`) | see left |
| 9 | Export brands with the exporter | **Present.** `decks.ts:1884` `getDeckBrand(c.env, user)`; the tier and `deck_brand_watermarks` come from `user.id` (`branding.ts:40-61`). It reaches the text PPTX footer (`pptx.ts:173-175`); image PPTX and PDF do not use it (`pptx.ts:465-467`; the print payload `decks.ts:815-821` carries no brand). `/methods` does the same (`:1533`) | see left |
| 10 | The brand kit is the first landing page ever made | **Present.** `branding.ts:120-124` `ORDER BY id LIMIT 1`, with no `archived_at IS NULL`. `voice_json` and `logo_dark_*` (`mig/399_landing_brand_voice_dark_logo_archive.sql:18-22`) are never selected (`branding.ts:121-122`). Same in `brand.ts:1311` | see left |
| 11 | An NDA on a deck link writes no pairwise NDA | **Present.** `deck_share_actions.ts:396-418` writes `documents` plus a conversion. `upsertPairwiseNda` (`wk/services/trust.ts:325`) and `hasActivePairwiseNda` (`:310`) are never called there. The response now says so (`data_room_access_granted:false`, `:420`) | see left |
| 12 | The deal pack's default SAFE terms | **Defaults removed** (`c1d41fb`, #2649). The body must carry `check_size`, `valuation_cap` and `discount` (`deck_share_actions.ts:534-538`), and the modal starts empty (`fe/components/ShareViewerSignupModal.jsx:52`). Signing now needs this user's `deal_pack_opened` on this token plus a completed e-sign envelope with the same body (`:625-637`). **Still open:** the terms are typed by the viewer rather than read from the founder's round, and every live link still offers the route (`:522`), while the issue says the studio stops offering it | see left |

---

## 5. Board → what serves it today → what is missing

The issue's planned names, used below: `DECK_SOURCES`, `GET /api/decks/sources`, `POST /outline`, `/generate` rework, `/proposals/:id/keep-slides`, `/:id/cards/:card/assist`, `/:id/refresh`, `/:id/images/quote`, `/:id/images`, `/images/:id/keep`, `/:id/check`, `/:id/review`, export `html` and `google_slides`, the tables `deck_images` and `deck_exports`, `nda_required` and `include_json` on `pitch_deck_share_tokens`, and `layout`, `notes` and `binding` in slide JSON (issue table "Stores and routes", NEW column).

| Board | Existing endpoint(s) and exact fields | Missing |
|---|---|---|
| **PD1** Editor | `GET /api/decks/:id` → `{id, version, title, is_current, created_at, slides[]}`; `PUT /api/decks/:id` `{slides, title}` makes a new version. Cover `brandkit_*` fields (`branding.ts:171-184`). The deck title "[Northwind] · Seed · v4" comes from `title` and `version`; "Saved · 2 min ago" from `created_at` | `binding{source_key, record_ref, as_of, grade, snapshot_hash}` per block, `layout`, `notes` (all dropped today, `decks.ts:380-444`); `audience`, `round_ref`, `theme_json` columns; chips need `GET /sources`; the stale dot needs the `snapshot_hash` compare or `/:id/refresh`; the Mismatch pill needs `/:id/check` |
| **PD1b** First run (`:9`) | none | A dismiss-once flag (per-viewer; browser storage or a user preference). No route needed |
| **PD2** Studio home (`:10`) | Versions: `GET /by-project/:pid` → `versions[{id, version, title, is_current, created_at}]`. Views by week and top slide: `GET /api/cycles/raise/modules/pitch-deck` card (`vbars` 8 weeks, `hbar` seconds per slide). NDA signed: `GET /:id/engagement` `conversions.nda_signed`. Shared links per version: `pitchRecords` rows | Version table columns Audience, Round, By (`created_by` is stored, never returned, `decks.ts:495-499`), Checks, link count per version; "New in your data since v4" and "Refresh the deck" (`/:id/refresh` plus bindings); coverage meter (`GET /sources`). The moved notice is UI only |
| **PD3** New · Audience and round (`:11`) | Audiences = `INVESTOR_TYPES` (`raiseCycle.ts:384-388`; exposed only as the narrative filter, `:551`). Templates: `GET /api/decks/methods` (**unreachable**, §0.1) → `methods[].{id, label, premium, locked, slide_count}`. Past versions: `GET /by-project/:pid`. Recommendation: `GET /recommend` | Fix the route order (`/methods` and `/brand` before `/:id`); an active-round read (`raise_rounds` and `round_calls` with counsel approval, giving the Reviewed chip; nothing in the deck routes reads them); length and prompt inputs on the new `POST /outline` and `/generate` |
| **PD4** Sources and coverage (`:12`) | Partly: Mercury `parts.mercury.figures[{key, label, value, unit, source, fact_id}]` (founder only) on `GET /api/cycles/raise/modules/pitch-deck`; Grow series from `project_metrics` (`growCycle.ts:117`) as a card only. `autofill` `coverage_pct` exists but counts AI fields and has no grades (`autofill.ts:392-395`) | **`DECK_SOURCES` and `GET /api/decks/sources`** returning items `{source_key, module, label, value, unit, as_of, grade, href, record_ref, snapshot_hash}` and `not_recorded` with the module that fills them; coverage by grade (Measured, Reviewed, Sourced, Stated, Not recorded); Scoring rows off by default |
| **PD5** Outline (`:13`) | `GET /api/ai/rail/proposals` (D780) stores and lists proposals; `GET /api/ai/pricing` gives the cost table; `GET /api/ai/me/spend?surface=` gives the page's month calls and spend | **`POST /api/decks/outline`** with option `deck:outline`, storing `outline_json` (new column on `pitch_deck_proposals`); "Regenerate [$0.0011]" quote; "your average over [6] runs" needs a per-option average (the spend report is per page) |
| **PD6** Building, then the proposal (`:14`) | `POST /proposals/:id/keep` (whole deck) and `DELETE /proposals/:id`; `GET /by-project/:pid` `proposal` | **`/generate` rework** (today it writes a version directly, `decks.ts:551`, and fills from `projects` only) to a `pitch_deck_proposals` row; **`/proposals/:id/keep-slides`** with `kept_slides_json`; per-card progress and cost (charged, held or estimated) need a run or progress read, either from the `run()` holds or a polled proposal status. Nothing like it exists |
| **PD7** Card AI bar (`:15`) | Refusal pattern: `never_fill` 422 (`ai_rail_proposals.ts:51-52`); price table `GET /api/ai/pricing` | **`/:id/cards/:card/assist`** with options `deck:rewrite`, `deck:shorten`, `deck:expand`, `deck:tone`, `deck:translate` (plus `deck:chart`, `deck:table`, `deck:timeline`, `deck:image` from the Add menu), each stored as an `ai_rail_proposals` row; rail matrix rows for those options (`railMatrix.json` has none) |
| **PD8** Layouts, background, themes (`:16`) | Brand kit: `GET /api/brand/landing/by-project/:pid` (first page, bug 10); cover injection `applyBrandKitToSlides` | `layout` key per slide (12 presets); `theme_json` on the version; card and deck background (a `deck_images` row with use `card` or `deck` plus overlay); voice tags and dark logo (bug 10); "Apply to all cards" (client-side, then PUT) |
| **PD8b** Slide grid (`:17`) | none | The slide JSON needs a block list with a 12 × 6 range per block (for example `blocks[{kind, grid:{c1,c2,r1,r2}, binding?}]`). This goes beyond the issue's `layout` and `notes` names, so it needs naming. `sanitizeSlides` and `sanitizeFields` must keep it |
| **PD8c** Add a block (`:18`) | `sanitizeImageUrl` (https only, `decks.ts:460-481`) for link safety | Video, audio and link-button kinds; a server check and poster fetch for YouTube or Vimeo links (new; the issue names none, and it needs an SSRF-safe fetch); the poster in PDF and PPTX export |
| **PD9** Bound chart popover (`:19`) | Series values exist in `project_metrics` (`growCycle.ts:117`; `raiseCycle.ts:465-472`) and Mercury `months[]` (`raiseFeeds.ts:506`), but no deck route returns them | `binding` with `as_of` and `snapshot_hash`; **`/:id/refresh`** (Refresh, or Keep as of [date]); series items in `GET /sources`; the Typed series beside the Stripe series |
| **PD9b** Chart library (`:20`) | none | `GET /sources` series with a count of how many fit each type; chart blocks in slide JSON; "charts already in this deck" read from the version's blocks |
| **PD9c** Chart selected (`:21`) | none (client-side) | The chart block's `type` in slide JSON |
| **PD9d** From a connector (`:22`) | `GET /api/integrations` (state, `last_synced_at`); `/:uid/sync-status`; `/:uid/fed` | `GET /sources?connector=` grouped by connector with `not_recorded` reasons; `deck:chart` or `deck:table` proposal ("headline proposed by Eadwyn", cost) through `/:id/cards/:card/assist`; a new-card insert keeps its binding |
| **PD10** Sources panel and scorecard dialog (`:23`) | Mercury figures as in PD4 | `GET /sources` with `used_on` cards (derived from bindings), grade and stale filters; scorecard band and Product-market fit band items (SCORING #2428, READINESS #2433), off by default, per version (owner question 4) |
| **PD10b** Sources and grades legend (`:24`) | none (static copy) | none |
| **PD11** Coverage meter (`:25`) | `autofill` `coverage_pct` / `slide_confidence` (not by grade) | Counts by grade from `GET /sources`; the loading and error states come from that same read |
| **PD12 / 12b / 12c / 12e** Image lightbox (`:26-28`, `:30`) | Models and prices: `GET /api/ai/catalogue` (FLUX.2 Klein 9B and the rest, `catalogue.ts:109-112`); balance: `GET /api/ai-budget/me`; only existing image run: `POST /api/brand/logo` (FLUX.1 Schnell, `data:` URL, `brand.ts:505-523`). Deck images accept https only (`decks.ts:460-481`) | **`/:id/images/quote`** (per-model price; references allowed or greyed; balance check before the hold); **`/:id/images`** (generate N proposals, refuse real people before the hold); **`/images/:id/keep`**; table **`deck_images`** (`project_id, deck_id, r2_key, prompt, style, aspect, state, ai_usage_log_id, charged_microusd, created_by`) plus R2 `FILES` and an app URL that passes `sanitizeImageUrl`; "Use as" (content, card or deck) and overlay plus contrast; data points from `DECK_SOURCES`, including data room images and consent per person; image models on the Pitch deck rail row |
| **PD12d** Content image on a card (`:29`) | none | An image block with alt text, crop and fit; `deck_images` listing for the Design tab (`GET /:id/images`); regenerate cost via `/images/quote` |
| **PD13** Check panel (`:31`) | The narrative check alone: `narrative_checks` for 3 figures (`raiseCycle.ts:392`, `:447-478`). It reads `projects.mrr`, `paying_customers` and `funding_needed` labelled "Deck · …" (`:451-454`), not the deck's slides | **`POST /api/decks/:id/check`** reading the version's bindings plus typed sentences, returning Backed, Founder's figure, Mismatch, Not backed or Stale per figure; "Use Stripe's figure" (a binding swap and a PUT) and "Keep mine, with a note" (a note store) |
| **PD14** Reviewer pass (`:32`) | `POST /api/deck-reviewer/paste` with the version's text (stopgap); review fields `{overall_score, strengths, weaknesses, red_flags, priority_fixes, …}` | **`POST /api/decks/:id/review`** with `deck_id, deck_version` columns on `deck_reviews`; fix bug 6 so a missing score stays missing ("Score not returned"); a per-card pointer in the output; run cost in the response; a history read (`deck_review_history` is never read) |
| **PD15** Versions and compare (`:33`) | `GET /:id` ×2 (diff on the client); `POST /:id/restore` | `content_hash` on the version (optional); the restore dialog copy is UI only |
| **PD16** Present mode (`:34`) | `GET /:id` | `notes` in slide JSON |
| **PD17** Export dialog (`:35`) | `POST /:id/export {format: pdf\|pptx}` (version = deck id) | Formats **`html`** and **`google_slides`**; options for speaker notes and the Sources appendix; table **`deck_exports`** (`deck_id, version, format, content_hash, external_ref, created_by`); brand from the venture, not the exporter (bug 9); the Google connection state (#2402); `renderDeckHTML` is not reusable as the offline export (CDN Tailwind, `render.ts:9-11`) |
| **PD18** Share dialog (`:36`) | `POST /api/cycles/raise/deck-links` `{deck_id, prospect_id\|investor_label, expires_days 7\|14\|30\|null, allow_download, allow_forwarding}` → `{id, share_path (once), expires_at, …}`; the editor route `POST /:id/share` has `view_limit` but no investor | `view_limit` on the one writer the studio uses; **`nda_required`** and **`include_json`** (figures with chips, Sources appendix, notes, bands, "frozen at vN as of [date]") on `pitch_deck_share_tokens`; collapse both callers onto one body (bug 8). Freezing exists already (§0.4) |
| **PD19** Share and analytics (`:37`) | Views, time and conversions: `GET /:id/engagement` (`total_views`, `views[].read_seconds`, `ip_hash` + `ua_fingerprint` for unique viewers, `conversions.nda_signed`); seconds per slide: the module card `hbar`, and per link the record section "Time per slide" (`records/raise.ts:415-421`); funnel stages from `deck_view_slides` first and last index per view (`records/raise.ts:399-414`); per investor: module records `link, expires, views, time, most_read`; Withdraw: `DELETE /:id/shares/:shareId` or the record action `revoke` | Seconds per card **by version** (today it sums over the whole project, `raiseCycle.ts:591-595`) and against the previous version; median time per viewer; NDA signed per link; engagement does not return the investor or settings per share (`decks.ts:976-983`); "Reached the ask" needs the ask card's index from the version |
| **PD20** Investor shared deck (`:38`) | `GET /api/decks/share/:token` → `{…deck, slides, view_id, allow_download, project_name}`; heartbeat; `GET /share/:token/context`; `POST /share/:token/nda` | `nda_required` on the token so the gate is enforced before `slides` are returned (today the deck is returned at once and the NDA is optional); **a read of the NDA text** (only the POST builds it, `deck_share_actions.ts:377-384`); NDA without an account (today it needs a session, `:355-358`, and signup needs Turnstile, `:216`), which is owner territory; the pairwise NDA (bug 11); chips under figures (needs bindings in the frozen slides); the deal page slot (DEAL #2421) |
| **PD21** Admin and Super Admin read only (`:39`) | `GET /:id` (admin passes, `projectContentAccess.ts:20`); Super Admin "Default template by sector and stage" = `GET/PUT/DELETE /api/decks/admin/recommend-overrides` (role `admin`, no HQ check) | **Make admin read-only** on deck writes (bug 1 residual); a **notes thread** store and routes (none exist); an HQ-only check on the overrides if the branch admin must not set them |
| **PD22** No permission (`:40`) | Expired link: `GET /share/:token` → 410 `share link has expired` (`decks.ts:832-834`) or `share link is no longer valid` (`:873`) | The worker admits accepted advisor members to deck reads (`projectContentAccess.ts:33`), so the board's "nothing shown" relies on the UI guard (`fe/App.jsx:2906`) |
| **PD23** Empty (`:41`) | `versions: []`; module card `state:'empty'` "No deck yet…" and "No one has opened a deck link yet." (`raiseCycle.ts:583`, `:588`); engagement `total_views: 0` | Empty `GET /sources` ("nothing to fill from") |
| **PD24** Loading (`:42`) | none | none |
| **PD25** Errors and limits (`:43`) | Mercury unreadable: `parts.mercury.state:'unreadable'` (`cycle_raise.ts:157`); AI off or out of tokens: `refuseRun` refusals from `run()` (`decks.ts:688`); export failed: 502 `pdf_render_failed` with the exact canvas sentence (`decks.ts:1932`, `:1937`) | "Those cards keep their last values as of [date]" needs bindings with `as_of`; the quote-then-hold shape ("needs $X, you have $Y") on the new AI routes |
| **PD26** Phone (`:44`) | Same reads as PD2, PD18, PD20 | Same gaps as those boards |
| **PD27** Editor dark (`:45`) | Same as PD1 and PD13 | Same as PD1 and PD13 |
| **PD28** Eadwyn rail open (`:46`) | `GET /api/ai/rail?page=Founder · Raise · Pitch deck` (vision models only, `railMatrix.json:423-441`); `GET /api/ai/catalogue` (Show all image models) | A writing model, two image models and a reading model on the page row; image-model picks carried into the lightbox (`ai_rail_preferences`, read at `ai.ts:496`) |

---

## 6. Other worker gaps the build parts will hit (not in the twelve)

- **Route order** (§0.1): register `GET /methods` and `GET /brand` before `GET /:id` in `decks.ts`, or constrain `/:id` to digits. Every new single-segment GET planned by the issue (`/sources`) has the same problem.
- **Audit gaps:** a `logCycleWrite` row is written only for link create (`decks.ts:1372-1377`), link edit (`raiseWriters.ts:401`) and record revoke (`raiseWriters.ts:674`). Keep (`decks.ts:1699-1710`), Save (`:1066-1179`), restore (`:1181-1193`), export (`:1848-2007`) and the editor's withdraw (`:1264-1278`) write none. The issue wants one row for each.
- **Sanitizers:** `sanitizeSlides` and `sanitizeFields` (`decks.ts:380-444`) must learn `layout`, `notes`, `binding` and blocks, or every save drops them. `source` is limited to `data, ai, placeholder, auto` (`:414`).
- **Proposals:** one unkept proposal per project; a new fill deletes the old one (`decks.ts:1674-1676`). Slide-by-slide keep needs `kept_slides_json`.
- **Coverage meaning:** `coverage_pct` treats AI-written fields as filled (`autofill.ts:392-395`). PD4 and PD11 mean "filled from records", by grade.
- **Reviewer scoping:** reviews belong to the user, not the venture (`deck_reviewer.ts:89`, `:235-236`). `project_id` is stored without an ownership check (`:179-180`, `:216-217`).
- **Feedback mirror:** `POST /share/:token/feedback` writes an anonymous viewer's reactions into `discovery_interviews` as an interview (`deck_share_actions.ts:469-503`). That counts toward Validate's interview figures, which the studio would then cite as Recorded or Measured.
