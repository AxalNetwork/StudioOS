# frontend/src/pages/raise/pitch — the Pitch deck studio

The founder's Pitch deck studio at `/raise/pitch` (D894, #2434), built to the
owner's "Pitch Deck Studio" canvas: `design/incoming/Pitch Deck Studio Page.dc.html`
and `design/incoming/Pitch Deck Studio · Boards.dc.html` (PD1–PD28). Version 2
(D1604, #3716) is being built onto it from `design/incoming/Pitch Deck Studio v2 Page.dc.html`
and `Pitch Deck Studio v2 · Boards.dc.html`; its surfaces whose routes are not
on main read `deckV2Adapter.js`.

| File | What it is |
|---|---|
| `PitchStudio.jsx` | The studio's shell and the tabs whose reads exist: Decks (PD2) at `/raise/pitch` (with D900's check pills and the versions' Checks column, from `GET /api/decks/checks`), Review at `/raise/pitch/review` (`PitchReview.jsx`), Share & analytics (PD19) at `/raise/pitch/analytics`. |
| `pitchStudioModel.js` | Pure: the addresses, the words, and every derivation from the reads (views by week, seconds per slide, one version's readers and its funnel, the investor links and their pages). |
| `PitchPresent.jsx` | Present mode at `/raise/pitch/present` (D901, PD16 and PD26 frame 2): the presenter view, the audience view and the phone viewer. Reads one version; writes nothing. |
| `ExportDialog.jsx` | The export dialog (D901, PD17 and PD25): PDF, PowerPoint, HTML and (D904) Google Slides, created in the member's own Drive. It says what the export records before it runs; for Google it says to connect first, with the one link, and after, "Created in Google Slides · Open ›". |
| `presentExportModel.js` | Pure: present mode's cards, keys, timer and dots, and the export dialog's formats, sentences and ledger line. #3656: `renderableFields`, the one allowlist of what a slide may show (a template's `brandkit_*` and `meta_*` configuration, raw asset values and bare flags never are), and `fieldBlocks`, a field card's content as blocks, used by `editorModel.withFieldBlocks` the first time a card gains a block or a layout. |
| `PitchReview.jsx` | D900 (#2679), PD14: the Review tab. The current version's review (`POST /api/decks/:id/review`) with its score only when one came back, four columns each pointing to a card, and the run's cost; "Reviews per version" (`GET /api/decks/:id/reviews`) with "Score not returned"; "Review this version" behind a dialog, offered only once the reviews read answers `viewer: 'founder'` (#3657). The reviewer for an upload or pasted text (`DeckReviewerPage`, embedded) stays below it. |
| `CheckPanel.jsx` | D900 (#2679), PD13: the editor's Check tab. The panel reads first (`GET`); only when that read's `can_check` is true, the founder's, does it run the check (`POST /api/decks/:id/check`) and offer Run the check (#3657: HQ editing never makes a reader the founder). Anyone else reads the last states. Counts by state, "Last checked", each figure with its card; a Mismatch shows both figures and both sources, with "Use [X]'s figure" (a dialog, then a new version; held while edits are unsaved) and "Keep mine, with a note" (a dialog, then the check again); "Open Evidence ›" to the claim. |
| `checkModel.js` | D900: the check's words, pure: the state labels and tones, `summaryLine`, `checkPills`, `checksCell` (Not checked, never zeros), `claimLine`, `recordSource`, `useRecordLabel`, `lastChecked`, `checkNote`, and #3657's `mayRunCheck` / `isFounderOnly`. |
| `preflightModel.js` | #3661 (decision number from S1): Pitch preflight, pure. One version's deterministic checks before export or share: grid and overlap, clipped text (measured at 1920 × 1080, else "Not measured", never a pass), text density, font size, contrast, image resolution and fit, alt text, an off-theme card, unresolved placeholders, and missing or stale sources. Each finding names its card and block, says what is wrong and what to do, and is export-blocking or a dismissible warning (`exportGate`). A result is shown only beside its own version (`deckKey`, `currentResult`). No score, and it rewrites nothing. Not D900's evidence Check. No page mounts it yet: its UI waits on a board (`needs-design`), and its editor and export hooks on #3655, #3656 and #3658 |
| `preflightMeasure.js` | #3661: `measureBlocks`, what the browser measured on a card rendered at export size (clipped or not, the computed font size, an image's own pixels), for `preflightModel.js`. A value the browser did not give is left out |
| `reviewModel.js` | D900: pure words and derivations of the Review tab: the cost in dollars or "Not recorded", the score or "Score not returned", the card pointer, the history rows, the estimate and the dialog's sentence, and #3657's `mayRunReview` / `isReviewReadOnly`. |
| `PitchNotes.jsx` | D905 (#2684), PD21: the Notes tab at `/raise/pitch/notes`: the thread from the venture's admins to its founders (`GET /api/decks/:id/notes`), a card pill on each note, the composer (posting opens a dialog), and the Super Admin's default template by sector and stage. Who may post is the Worker's `viewer`. |
| `PitchBoundary.jsx` | D905, PD22: what an Advisor, an Operating Partner or an Explorer reads at `/raise/pitch`, inside their own shell. Nothing from a deck is read. |
| `sourcesModel.js` | D896 (#2675): pure words and derivations of the deck's sources — value wording by unit, chips, grouping and filters, the coverage meter, Missing, the scorecard dialog. |
| `NewDeck.jsx` | D897 (#2677), PD3–PD6: New deck at `/raise/pitch/new` — audience and round, the sources step (D896's `SourcesStep`), the outline Eadwyn proposes, then the proposal kept card by card. Every write opens a dialog with its cost; `?proposal=<id>` reopens a proposal. |
| `newDeckModel.js` | D897: pure words and derivations for New deck and PD2's fast path — AI tokens, the prompt's figure check (the Worker's word list), the round line, outline edits, chips, estimates, the dialogs' sentences, and the proposal's cards. |
| `SourcesBoards.jsx` | D896: `CoverageMeter` (PD11), `SourceChip`, `SourcesLegend` (PD10b), `ScorecardDialog`, `SourcesPanel` (PD10), `SourcesStep` (PD4) and `useDeckSources`, over `GET /api/decks/sources`. Built here, mounted by part 3 (New deck) and part 4 (the editor). |
| `PitchEditor.jsx` | D898 (#2676), PD1, PD1b, PD8, PD8c and PD24–PD27: the editor at `/raise/pitch/edit`. The rail with stale dots and reorder, the centre card on the brand kit with its blocks on the 12 × 6 grid, speaker notes, the Sources, Design and Notes tabs, Add a block, and Save, which says what it changes before it writes a version. Reads the slide model from the Worker (`GET /api/decks/model`). D1267 (#3290, VR7): beside the right panel, Evidence on this slide (`../../cycles/evidence/EvidencePart.jsx`), and `sourcesCard`, the optional Sources on Axal card kept only on Save. |
| `editorModel.js` | Pure: what a save changes, layouts that carry a card's content, placement on the grid, standard sizes, stale cards, "Saved · …", the card's colours. |
| `ChartTools.jsx` | D898 group C, PD9, PD9b and PD9c: `ChartBlock` (a chart drawn from its bound series through `frontend/src/ui/Charts.jsx`, each series' source chip always on), `ChartToolbar` (Change type, Series, Range, Data, Labels, Remove), `DataPopover` (Changed since … with Refresh and Keep as of) and `ChartLibrary` (the twelve types with their fits, the deck's charts to reuse, the series, a preview, Insert chart), over `GET /api/decks/chart-series`. Mounted by `PitchEditor.jsx`. |
| `chartModel.js` | Pure: what a chart block draws (up to its binding's as of, in its range, a missing month blank, never 0), the chips, which types and series fit, a new chart block, and Refresh. |
| `VersionCompare.jsx` | D898 group D, PD15: two versions side by side on the Decks tab, the changed cards outlined with their count, and Restore vN behind a dialog that says what it saves and what stays (the existing `POST /api/decks/:id/restore`). Mounted by `PitchStudio.jsx` from a version's Compare. |
| `compareModel.js` | Pure: which cards changed between two versions, by position; the Restore dialog's sentences; which pair a Compare opens. |
| `CardAssistBar.jsx` | D899 (#2678), PD7: Eadwyn's bar under the selected text block — Rewrite, Shorten, Expand, Change tone, Translate and Ask, each with its cost. A press shows its cost first; the result is a proposal (the before struck, the after on lavender) that Accept places on the card. A bound figure takes no tool; AI off greys it. Mounted by `PitchEditor.jsx`. |
| `AddMenu.jsx` | D899, PD7 and PD28: the Add menu — Text and Image open Add a block (PD8c), Background and Layout open Design, Chart proposes a chart, table or timeline whose series are bindings, From a connector opens `ConnectorLightbox.jsx`; the rail row's models with their catalogue prices. Mounted by `PitchEditor.jsx`. |
| `ConnectorLightbox.jsx` | D899, PD9d: each connector with its state and last sync (`GET /api/integrations`), the recorded figures it feeds, and a new card of bound tiles (free) under a headline that is the founder's or Eadwyn's with its cost. |
| `ImageLightbox.jsx` | D903 (#2682), PD12, PD12b, PD12c and PD12e: the image lightbox, opened from the Add menu's Image (a content image) and Background (a card background). Use as, the description prefilled from the card, style, palette, aspect, count, the cost line (the model, the price per image, the AI token balance, read before anything runs) and Generate; Keep and Discard; a background's overlay in the brand ink, with "Keep as background" waiting until the contrast reads 4.5:1; the refusal for a real person; an upload with the person's agreement; Options' data points (labels only) and model column. |
| `ImageToolbar.jsx` | D903, PD12d: a placed image's toolbar in place of the AI bar (Replace, Upload, Regenerate, Crop, Fit, Alt text, Remove), with the model, day and cost and the alt text under it. |
| `imageModel.js` | D903: pure words and derivations of the lightbox and the toolbar: the options, the contrast line, the description from the card without its figures, the cost line, the placed line, and where Keep places an image (`placeImage`). |
| `imageContrast.js` | D903: the overlay's worst-case contrast rule, with no imports, so the Worker's test holds it to `cloudflare-worker/src/services/decks/images.ts` figure for figure. |
| `AssistParts.jsx` | D899: what the card tools share — the press dialog with the cost, the tokens dialog (PD25), a text proposal. |
| `deckAssistModel.js` | D899: pure words and derivations of the card tools — the tools and their options, the cost line, what a press sends, why a figure takes no tool, the connector groups and their card, the rail row's models. |
| `BlockGrid.jsx` | D1112 (#2992): D898's blocks on the 12 × 6 grid, drawn one way for the editor, Present and the print page (`BlockView`, `BlockGrid`). `live` makes video, audio and link blocks real links; `sources` adds each metric tile's source line. |
| `PrintExtras.jsx` | D1112: what the headless print page (`../../PitchDeckPrintPage.jsx`, which the PDF and PowerPoint exports photograph) draws for a studio card, the speaker notes pages and the Sources appendix, each one 1920 × 1080 page. |
| `PitchWorkspaceMoved.jsx` | The old addresses. `/raise/pitch?mode=workspace` opens the editor at `/raise/pitch/edit` with `?moved=pitch-workspace`; the retired builder's `/raise/pitch/builder` opens the studio with `?moved=pitch-builder` (D898 group E). The venture and the hash are kept, and `PitchMovedNotice` draws the notice once on the page it lands on. |
| `StudioActions.jsx` | D898 group E (#2676): the retired builder's actions, now the studio's. `FillFromProject` on the Decks tab's current deck (`POST /api/decks/:id/autofill`; the proposal is reviewed at New deck's step 4), `SpinoutReadiness` for a Spin-Out deck (a read), and `BrandingCard` (the plan, the footer and the watermark, saved behind a dialog). New deck's Start from marks the recommended template. |
| `studioActionsModel.js` | D898 group E: pure words and derivations of those actions — which deck is a Spin-Out deck, a refused fill, why a template is recommended, the readiness lines, the branding lines and the watermark's dialog. |
| `PitchPage.jsx` | #3717: shared cycle gutter, one project-aware breadcrumb and the edge-docked rail for the studio, New deck and editor. D1604: the header's right side is the deck's Ask (`DeckAsk.jsx`, from the page's `ask` prop) on every width, in place of the phone-only `EadwynButton`. |
| `DeckAsk.jsx` | D1604 (#3716, pd40): the header Ask (`frontend/src/ui/AskButton.jsx`, "Ask Eadwyn", ", N waiting") and its sheet "Waiting for you": the whole-deck proposal (Review, Accept all, Discard) and the card edits a card run left (`GET /api/ai/rail/proposals`, `record=deck:<id>`). In the editor Accept places an edit on its card, held until Save; elsewhere it opens the editor. No input of any kind. A failed read draws no count. |
| `deckV2Model.js` | D1604: what every v2 surface shares, pure: "Coming later", "(pending owner)", the hold line, area labels ("c5–8 × r4–6"), the element picker's 8 groups routed to main or to the adapter, the proposal verbs, Ask's names, and a waiting card edit read from its rail row. |
| `deckV2Adapter.js` | D1604: THE SEAM. Each v2 surface whose route is not on main reads it; every method answers `{ available: false, reason, issue }`, keyed to the issue that brings the route (#3749–#3882), with no network code. `shown()` never prints a zero for an unavailable answer; `through()` is the swap when a route lands. |
| `PitchPage.css` | #3717: scopes the app-main flex height to PitchPage so its rail reaches the footer on short pages. |

The old template builder retired with D898 group E: its four actions are
`StudioActions.jsx` and New deck's Recommended mark, and `/raise/pitch/builder`
opens the studio. The editor is at `/raise/pitch/edit` (D898). New deck (D897)
at `/raise/pitch/new`, the Decks tab's standard-deck fast path and Fill from
project build proposals. Nothing they build becomes a version until the
founder saves the cards they kept.

## The rules for adding here

- **Every figure comes from a mounted read.** A read that fails says so where its
  figure would be; a value nobody recorded reads "Not recorded", never 0. No
  canvas sample (`[Northwind Labs]`, `[$16,950]`) ever reaches a page.
- **Only the Worker says nobody opened a link.** "No one has opened a link yet."
  is its own empty card; a card that could not be read is a failed read, and
  eight zero weeks is a count.
- **A figure from a capped list says so.** The engagement read sends at most
  200 views, so at the cap the views read "200+" and the viewers and the median
  say they cover the latest 200. NDA signatures are a count, never a share of
  browsers.
- **A link is live only when it has not expired and is not used up.** The
  records give the first; the engagement read's `shares` give the second for
  the current version's links. An opened link the engagement read does not
  answer for (another version's, or any while that read is running or has
  failed) says why its views left are not shown, and still offers Withdraw.
  Withdrawing one that had already been used up marks it Revoked, and the
  dialog says so.
- **A board waits for its store.** The canvas draws boards whose Worker reads do
  not exist yet: the coverage meter and source chips, the generate flow, the
  editor, card AI tools, present mode and export, the share dialog, images and
  Google Slides (D904 built it) and images (D903 built them). Each is a slot task on #2434. Build a board in the PR that
  builds its read, and add its derivation to `pitchStudioModel.js` with a test
  in `frontend/test/pitch_studio_d894.test.mjs` or its own file.
- **An admin reads, and changes nothing** (PD21). `isReadOnly` is true for an
  admin account only (viewing as a founder included) and hides New deck, New
  link and Withdraw; everyone else the route admits works here. Review draws no
  "Read only." banner: an admin reads the reviews and is told only the
  founders run one (the Worker's `viewer`, D900); the reviewer below is its own
  tool, with its own writes. The
  Worker's own refusal is #2434's fixes part. An admin leaves notes on the Notes
  tab (D905); a note is never in a share or an export.
- **The roles the studio is not for see a boundary** (PD22). An Advisor, an
  Operating Partner or an Explorer opening `/raise/pitch` reads
  `PitchBoundary`, never a bounce; the other studio addresses keep their guard.
