# frontend/src/pages/raise/pitch — the Pitch deck studio

The founder's Pitch deck studio at `/raise/pitch` (D894, #2434), built to the
owner's "Pitch Deck Studio" canvas: `design/incoming/Pitch Deck Studio Page.dc.html`
and `design/incoming/Pitch Deck Studio · Boards.dc.html` (PD1–PD28).

| File | What it is |
|---|---|
| `PitchStudio.jsx` | The studio's shell and the tabs whose reads exist: Decks (PD2) at `/raise/pitch`, Review at `/raise/pitch/review` (today's reviewer, embedded), Share & analytics (PD19) at `/raise/pitch/analytics`. |
| `pitchStudioModel.js` | Pure: the addresses, the words, and every derivation from the reads (views by week, seconds per slide, one version's readers, the investor links). |
| `PitchPresent.jsx` | Present mode at `/raise/pitch/present` (D901, PD16 and PD26 frame 2): the presenter view, the audience view and the phone viewer. Reads one version; writes nothing. |
| `ExportDialog.jsx` | The export dialog (D901, PD17 and PD25): PDF, PowerPoint and HTML, with Google Slides drawn as unavailable. It says what the export records before it runs. |
| `presentExportModel.js` | Pure: present mode's cards, keys, timer and dots, and the export dialog's formats, sentences and ledger line. |
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
  New link and Withdraw. The Worker's own refusal is #2434's fixes part.
