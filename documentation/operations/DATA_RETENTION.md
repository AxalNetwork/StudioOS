# Data retention: the deck stores

D1508 (#3759). One row per store a pitch deck keeps: what it holds, when its rows leave, and the R2 objects it names.

`scripts/check-deck-retention.mjs` (in `npm run test:guards`) fails the build when a table whose name starts `deck_` or `pitch_deck` exists after the migrations and has no row here. It also fails when a deck table created from migration 722 on has no `ON DELETE CASCADE`.

The retention periods for generated assets are owner decision W (#3716), pending counsel. The periods below are S1's §5.9.5 pick until then. Changing one is the owner's call, not a code change.

"Venture cascade" means the row goes when its venture (`projects`) row is deleted; "deck cascade", when its deck version (`pitch_decks`) row is. "No cascade" means nothing removes the row today: it stays after its deck or venture is gone, and is listed here so that gap is known.

| Store | Holds | Leaves when | R2 objects |
|---|---|---|---|
| `pitch_decks` | every saved version of a deck: its cards, theme and title, and for a build from the narrative (D1516) the narrative version it read (a number, never the words) | no cascade; a version is never deleted by the app | none (its images are `deck_images` rows) |
| `pitch_deck_cards` | the per-card autosave drafts of a deck (D1501) | deck cascade; a draft is replaced on save and cleared by Discard draft | none |
| `pitch_deck_proposals` | proposed decks from New deck and Fill from project, before Accept | no cascade | none |
| `pitch_deck_share_tokens` | share links: a token hash, its expiry and options | no cascade; an expired or withdrawn link stops opening, its row stays for its analytics | none |
| `deck_images` | uploaded, copied and generated deck images, proposed, kept or discarded | venture cascade. The daily cleanup (D1508) removes a discarded image 24 hours after Discard and a proposal nobody kept 14 days after it was made, unless a version, draft, proposal or derivative names it. A kept image stays | one per row, `deck-images/<project>/<uid>.<ext>`; deleted with its row by the cleanup |
| `deck_r2_tombstones` | one row per deck image the cleanup deleted: key, venture, bytes, reason, day (D1508) | venture cascade | none (each names an object already deleted) |
| `deck_exports` | the record of each export: version, format, hash, Drive id | no cascade | none stored (an export is sent, not kept) |
| `deck_brand_kits` | a venture's deck brand kit: font pair, palette roles, image style, reference and logo image uids (D1562) | venture cascade; one row per venture, replaced whole on save | none (it names kept `deck_images` rows by uid) |
| `deck_brand_locks` | which parts of a venture's brand kit (fonts, palette, logo) are locked, by whom and when (D1572) | venture cascade; a row is deleted when its part is unlocked | none |
| `deck_custom_layouts` | a venture's own layouts saved from a .pptx template: a name, the file's name, and the areas on the 12 × 6 grid (D1572) | venture cascade; removed one by one by a writer | none (the template file is never stored) |
| `deck_checks` | claim-check runs on a version (D900) | deck and venture cascade | none |
| `deck_notes` | notes on a version's cards (D905) | no cascade | none |
| `deck_comments` | comment threads on a deck (D1570) | deck and venture cascade | none |
| `deck_comment_mentions` | who a comment mentions | cascade from its comment | none |
| `deck_preflight_dismissals` | which preflight warnings an editor dismissed on a version: the finding's id, who and when, never its words (D4208) | deck cascade | none |
| `deck_area_batches` | a deck generation run (D1502): its areas or whole-deck build, its quote and parent hold, and its state | deck cascade | none |
| `deck_area_batch_steps` | a generation run's plan and progress, one row per quoted line (D1502) | cascade from its run | none (its images are `deck_images` rows) |
| `deck_area_proposals` | what Generate into areas proposed, one row per area of a run (D1512): its variants' words, chart blocks or image references, and the decision (Accept, Discard, superseded) | deck cascade; its run is set null when the run goes. The daily cleanup (D1512) expires a proposal nobody decided 14 days after it was made; the row stays, with its outcome, for the accept rate | none (its images are `deck_images` rows) |
| `deck_logos` | the customer logos a venture may show, each with its own permission record (D1543) | venture cascade | none (each picture is a `deck_images` row) |
| `deck_templates` | Gallery templates (D1535): HQ's, and each member's own Save as my template, text and figures already stripped | a member's own leave with their account (user cascade); HQ's are never deleted by the app | none |
| `deck_approvers` | who must approve a deck before it is shared | venture cascade | none |
| `deck_derivatives` | teasers, one-pagers and memos made from a version (D1583) | deck and venture cascade | none |
| `deck_grants` | an investor's access to a version through a deal (D1587) | no cascade; a withdrawn grant keeps its row with `revoked_at` | none |
| `deck_variants` | per-investor card orders of a deck (D1565) | deck and venture cascade | none |
| `deck_typed_values` | figures a founder typed for a deck (D1538) | venture cascade | none |
| `deck_model_picks` | model picks per deck, member and element (D1503) | no cascade | none |
| `deck_brand_watermarks` | a member's watermark choice | no cascade | none |
| `deck_recommendation_overrides` | HQ's template recommendation overrides | no cascade; HQ data, not a venture's | none |
| `deck_proposal_reports` | a member's report on an AI proposal: reason, a short note, HQ's resolution (D1540) | gone with the member who reported it; no cascade on the venture | none |
| `deck_run_quotes` | the price New deck pinned before a run: the hold, the price list, a hash of the run, when it lapses (D1540) | gone with the member who asked; no cascade on the venture | none |
| `deck_reviews` | AI reviews of an uploaded deck and their files | no cascade on the venture; gone with its member | the reviewed file (counted in storage as `deck_reviews`) |
| `deck_review_history` | the history of a deck review | cascade from its review | none |
| `deck_share_views` | each view of a share link: a hashed IP, a fingerprint, seconds read | no cascade | none |
| `deck_view_slides` | per-slide seconds of a view | cascade from its view | none |
| `deck_share_conversions` | what a viewer did after a view | no cascade | none |
| `deck_share_feedback` | feedback a viewer left on a shared deck | no cascade | none |
| `deck_qa_answers` | the answer a founder kept for each investor question: its bindings and their values when kept, a note, the version (D1559) | venture cascade; the deck is set null when its version goes | none |
| `deck_area_batches` | one generation run on a deck's areas or a whole-deck build: its state, quote, hold and what it charged (D1502) | deck cascade | none |
| `deck_area_batch_steps` | each step of a run: the area, element, model, state, charge, input and result (D1502) | cascade from its run | none |
| `deck_logos` | a venture's customer logos for the logo wall: the customer's name, the image, and the permission to show it (D1543) | venture cascade | none of its own (the image is a `deck_images` row) |
| `deck_rehearsals` | a founder’s rehearsal transcript, card timings and counted report (D1580) | deck cascade | rehearsal audio: removed after an hour unless its maker keeps it; turning Keep the audio off removes it immediately |
| `deck_rehearsal_extras` | a rehearsal’s audio size and its coaching points (D1580 part 2a) | rehearsal cascade (and so deck cascade) | none: the coaching restarts the audio’s hour, which `deck_rehearsals` removes |

## Not covered yet

- `dataroom_deck_values` (#3881, migration 753) is still on draft PR #4025. It gets a row when it lands; it does not start `deck_`, so the guard would not ask for it.
- A deck image's R2 object is not removed when its venture is deleted: the venture cascade removes the row, and the cleanup only reads rows. That is a separate sweep over `deck-images/<project>/` for ventures that no longer exist.
