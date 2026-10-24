# frontend/src/pages/raise/pitch — the Pitch deck studio

The founder's Pitch deck studio at `/raise/pitch` (D894, #2434), built to the
owner's "Pitch Deck Studio" canvas: `design/incoming/Pitch Deck Studio Page.dc.html`
and `design/incoming/Pitch Deck Studio · Boards.dc.html` (PD1–PD28).

| File | What it is |
|---|---|
| `PitchStudio.jsx` | The studio's shell and the tabs whose reads exist: Decks (PD2) at `/raise/pitch`, Review at `/raise/pitch/review` (today's reviewer, embedded), Share & analytics (PD19) at `/raise/pitch/analytics`. |
| `pitchStudioModel.js` | Pure: the addresses, the words, and every derivation from the reads (views by week, seconds per slide, one version's readers, the investor links). |
| `PitchNotes.jsx` | D905 (#2684), PD21: the Notes tab at `/raise/pitch/notes`: the thread from the venture's admins to its founders (`GET /api/decks/:id/notes`), a card pill on each note, the composer (posting opens a dialog), and the Super Admin's default template by sector and stage. Who may post is the Worker's `viewer`. |
| `PitchBoundary.jsx` | D905, PD22: what an Advisor, an Operating Partner or an Explorer reads at `/raise/pitch`, inside their own shell. Nothing from a deck is read. |
| `sourcesModel.js` | D896 (#2675): pure words and derivations of the deck's sources — value wording by unit, chips, grouping and filters, the coverage meter, Missing, the scorecard dialog. |
| `SourcesBoards.jsx` | D896: `CoverageMeter` (PD11), `SourceChip`, `SourcesLegend` (PD10b), `ScorecardDialog`, `SourcesPanel` (PD10), `SourcesStep` (PD4) and `useDeckSources`, over `GET /api/decks/sources`. Built here, mounted by part 3 (New deck) and part 4 (the editor). |
| `PitchWorkspaceMoved.jsx` | The old `/raise/pitch?mode=workspace` address: it opens the editor at `/raise/pitch/edit` with `?moved=pitch-workspace`, the venture and the hash kept. |

The deck builder itself stays `../../PitchWorkspacePage.jsx` (with
`../../PitchDeckPage.jsx`) at `/raise/pitch/edit` until #2434's editor part
replaces it.

## The rules for adding here

- **Every figure comes from a mounted read.** A read that fails says so where its
  figure would be; a value nobody recorded reads "Not recorded", never 0. No
  canvas sample (`[Northwind Labs]`, `[$16,950]`) ever reaches a page.
- **A board waits for its store.** The canvas draws boards whose Worker reads do
  not exist yet: the coverage meter and source chips, the generate flow, the
  editor, card AI tools, present mode and export, the share dialog, images and
  Google Slides. Each is a slot task on #2434. Build a board in the PR that
  builds its read, and add its derivation to `pitchStudioModel.js` with a test
  in `frontend/test/pitch_studio_d894.test.mjs` or its own file.
- **An admin reads, and changes nothing** (PD21). `isReadOnly` hides New deck,
  New link and Withdraw. The Worker's own refusal is #2434's fixes part. An
  admin leaves notes on the Notes tab (D905); a note is never in a share or an
  export.
- **The roles the studio is not for see a boundary** (PD22). An Advisor, an
  Operating Partner or an Explorer opening `/raise/pitch` reads
  `PitchBoundary`, never a bounce; the other studio addresses keep their guard.
