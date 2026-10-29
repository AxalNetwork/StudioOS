# Pitch deck studio — the Founder acceptance run (#3662)

**What this is.** The release gate for the Pitch deck studio (D894, #2434): what
has to be shown to work, how each part is shown, and the result at an exact
revision. A release is **not verified** while any export loses content, or while
the only evidence is an Admin preview. Every result names its revision; a row
nobody has run reads **Not tested**, never Pass.

**What it never does.** It uses synthetic fixtures and a test account the owner
set up and confirmed. It never publishes a real investor link, sends a message,
signs an NDA, accepts terms on anyone's behalf, or puts private production data
in evidence. Screenshots and exported files come from the test account's own
test deck only.

## The three parts

| Part | Where | Runs |
| --- | --- | --- |
| Fixtures | `frontend/test/fixtures/pitch_acceptance_decks.mjs` | Four synthetic decks: **complete** (every block kind, bound figures, a chart, an image with alt text, a link), **sparse** (a figure nobody recorded, an empty chart, no image, an empty card), **multilingual** (Japanese, Arabic, a long German compound, `< & "`), and **lossy** (one block off the grid, one overlapping), which proves the harness catches a loss. All links are on `example.test`. |
| Offline harness | `cloudflare-worker/test/pitch_acceptance_exports_3662.test.ts`, `frontend/test/pitch_acceptance_render_3662.test.mjs` | In CI. Each fixture goes the way a stored version goes (the read's `sanitizeSlides`, then the offline HTML writer and the editable PowerPoint writer, unzipped) and every word a reader should see must be in each file; the print page (`BlockGrid` at `size="print"`, what the PDF photographs) must keep the same words. |
| Live run | `scripts/pitch-acceptance-live.mjs` | By hand, from a machine that can reach the host (an agent sandbox cannot: its proxy answers `403 CONNECT` for `axal.vc`). Screenshots of the five studio pages at 1440×900 and 390×844, and with `PITCH_EXPORTS=1` the PDF, PowerPoint and HTML exports of the test deck, each checked to be the file it claims. Writes `results.json` and `matrix.md`. Exit 0 passed, 1 a step failed, **2 not configured: nothing verified, never 0**. Its pure helpers are unit-tested in `frontend/test/pitch_acceptance_live_3662.test.mjs`. |

### Running the live part

```text
PITCH_BASE_URL=https://axal.vc           # https, or localhost for a dev server
PITCH_TEST_ACCOUNT=synthetic             # the owner confirms the account is a test account
PITCH_SESSION='<cookie header>'          # the test account's session; never commit it
PITCH_PROJECT_ID=<test venture id>
PITCH_DECK_ID=<test deck id>             # required with PITCH_EXPORTS=1
PITCH_EXPORTS=1                          # optional: download the three exports
PITCH_REVISION=<the deployed sha>        # recorded in the matrix
PITCH_OUT=pitch-acceptance-out           # optional output folder
node scripts/pitch-acceptance-live.mjs
```

The screenshots prove a page drew, not that it looks right: a person compares
them with the Pitch Deck Studio boards (`design/incoming/Pitch Deck Studio ·
Boards.dc.html`, PD1–PD28) and records the result below. Opening each exported
file in its own application (Acrobat or a browser, PowerPoint or Keynote, a
browser offline) is part of the same manual step.

## The matrix

Result is Pass, Fail or Not tested. "Pass (offline)" means the CI harness passed
at that revision; it says nothing about real permissions or how the slides look.

| Area | How verified | Automated coverage | Result | Revision |
| --- | --- | --- | --- | --- |
| No content lost: HTML export | Offline harness | `pitch_acceptance_exports_3662` | Pass (offline) | the merge commit of this PR |
| No content lost: PowerPoint export | Offline harness | `pitch_acceptance_exports_3662` | Pass (offline) | the merge commit of this PR |
| No content lost: print page (what the PDF photographs) | Offline harness | `pitch_acceptance_render_3662` | Pass (offline) | the merge commit of this PR |
| A missing figure reads "Not recorded", never 0 | Offline harness | both harness tests | Pass (offline) | the merge commit of this PR |
| The harness catches a loss (lossy fixture) | Offline harness | `pitch_acceptance_exports_3662` | Pass (offline) | the merge commit of this PR |
| The same version exports the same bytes | Offline harness | `pitch_acceptance_exports_3662` | Pass (offline) | the merge commit of this PR |
| PDF, PowerPoint and HTML download and open | Live run with `PITCH_EXPORTS=1`, then opened by hand | file type only | Not tested | — |
| Actual slide rendering against PD1–PD28 | Live screenshots, compared by a person | none | Not tested | — |
| Real Founder owner and non-owner; HQ versus Founder preview; read-only roles; revoked connections | Manual, with test accounts | none | Not tested | — |
| Create, outline, generate, keep, save, reload; text, layout, notes, image, chart and diagram editing | Manual | none | Not tested | — |
| Sources and evidence check; review; versions, compare, restore | Manual | none | Not tested | — |
| Present: keyboard and phone | Manual, live screenshots at 390×844 | page draws only | Not tested | — |
| Google Slides export (authorized connection) | Manual | none | Not tested | — |
| Share lifecycle with synthetic recipients: frozen version, expiry, NDA, download and forwarding limits, revocation, analytics | Manual | none | Not tested | — |
| AI off, failed inference, sparse, stale or conflicting data, interrupted jobs, stale tabs, simultaneous proposals | Manual | sparse fixture only | Not tested | — |
| Processing and AI stay on Cloudflare; external calls are authorized source or export integrations only | Manual review of the tested revision | none | Not tested | — |

The final acceptance follows every Pitch implementation task: the revision
tested must contain all of them. Report a failure to the task that owns it,
with the fixture, the screenshot or file, and the revision.
