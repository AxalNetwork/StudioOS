# frontend/src/pages/raise/pitch — the Pitch deck studio

The founder's Pitch deck studio at `/raise/pitch` (D894, #2434), built to the
owner's "Pitch Deck Studio" canvas: `design/incoming/Pitch Deck Studio Page.dc.html`
and `design/incoming/Pitch Deck Studio · Boards.dc.html` (PD1–PD28).

| File | What it is |
|---|---|
| `PitchStudio.jsx` | The studio's shell and the tabs whose reads exist: Decks (PD2) at `/raise/pitch`, Review at `/raise/pitch/review` (today's reviewer, embedded), Share & analytics (PD19) at `/raise/pitch/analytics`. |
| `pitchStudioModel.js` | Pure: the addresses, the words, and every derivation from the reads (views by week, seconds per slide, one version's readers and its funnel, the investor links and their pages). |
| `PitchWorkspaceMoved.jsx` | The old `/raise/pitch?mode=workspace` address: it opens the editor at `/raise/pitch/edit` with `?moved=pitch-workspace`, the venture and the hash kept. |

The deck builder itself stays `../../PitchWorkspacePage.jsx` (with
`../../PitchDeckPage.jsx`) at `/raise/pitch/edit` until #2434's editor part
replaces it.

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
  failed) says why its views left are not shown, and still offers Withdraw:
  withdrawing a link already used up does no harm.
- **A board waits for its store.** The canvas draws boards whose Worker reads do
  not exist yet: the coverage meter and source chips, the generate flow, the
  editor, card AI tools, present mode and export, the share dialog, images and
  Google Slides. Each is a slot task on #2434. Build a board in the PR that
  builds its read, and add its derivation to `pitchStudioModel.js` with a test
  in `frontend/test/pitch_studio_d894.test.mjs` or its own file.
- **An admin reads, and changes nothing** (PD21). `isReadOnly` is true for an
  admin account only (viewing as a founder included) and hides New deck, New
  link and Withdraw; everyone else the route admits works here. Review draws no
  "Read only." banner: the reviewer is its own tool, with its own writes. The
  Worker's own refusal is #2434's fixes part.
