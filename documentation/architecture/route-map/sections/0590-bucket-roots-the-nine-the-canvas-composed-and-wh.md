## Bucket roots — the nine the canvas composed, and why the rest keep a card grid

A bucket root is one of two things and the corpus decides which. Where an
artboard draws a **composed root** — a heading and one section per zone, each
with a real count and a short table — the root renders `BucketBoard`. Where it
draws none, the root renders `BucketOverview`: the bucket's zones as link cards.
`boardFor(role, prefix)` in `frontend/src/workspaces/boards/index.js` is the
whole of the decision, keyed `role:prefix`; a key it does not hold falls through
to the grid with no condition naming it. D49 records the reasoning.

**Nine boards, seven registry files.**

| Root | Licence | Registry | Sections, in zone order |
| --- | --- | --- | --- |
| `/pipeline` | partner | `boards/partnerPipeline.js` | leads · proposals · negotiations · retainers · analytics |
| `/delivery` | partner | `boards/partnerDelivery.js` | board · deliverables · capacity · status-reports · health |
| `/offers` | partner | `boards/partnerOffers.js` | catalog · perk-deals · visibility · proof · audience-fit |
| `/practice` | advisor | `boards/advisorPractice.js` | opportunities · engagements · delivery · sessions · earnings |
| `/expertise` | advisor | `boards/advisorExpertise.js` | profile · services · proof · thinking · **visibility (gap)** |
| `/network` | partner, advisor | `boards/network.js` | relationships · introductions · **organizations (gap on both)** |
| `/research` | partner, advisor | `boards/research.js` | ask · **client-prep (gap)** · markets · companies (advisor only) · library |

`network.js` and `research.js` are each **one factory serving two licences**,
and the role decides exactly one thing per file: whether Organizations has a
store (it does not, on either — see D54), and whether Companies is a section at
all (partner has no `companies` zone).

**What keeps the grid, and it is not an oversight:** advisor `/cohorts`, and
every founder and investor bucket root. Founder and investor `/research` never
reach `ResearchWorkspace` at all — `App.jsx` branches them to
`FounderResearchDesk` and `InvestorResearchWorkspace` — which is why only the
other two licences have a `/research` board.

**A board can never be gentler than the page behind it.** A section declares
either a `source` or a `gap`, never both, and a gap is *imported* from
`frontend/src/workspaces/noStoreCopy.js` — the same object the zone page
renders. `summary`, `rows` and `footnote` take the source payload as their only
argument, so a gapped section is structurally unable to print a figure.
`frontend/test/bucket_board.test.mjs` fails the build if a registry writes an
inline gap literal instead.

**The C1 rule:** a composed root's `<h1>` is the canvas's **tagline**, not the
bucket label — `/practice` reads "Run my advisory business", not "Practice".
`frontend/test/workspace_taglines.test.mjs` re-derives them from the canvases.

