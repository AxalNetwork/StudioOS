# templates/components — landing-page blocks

The section types a persona landing page is assembled from. A template picks
blocks and supplies content; the blocks do no fetching and hold no state.

| Block | What it renders |
| --- | --- |
| `SectionHeader.jsx` | The heading above any section. |
| `OutcomeCards.jsx` | Outcome-shaped cards. |
| `ProofBar.jsx` | Logos or proof points. |
| `TestimonialBlock.jsx` | A quote. |
| `ValidationBlock.jsx` | Evidence and validation. |
| `Timeline.jsx` | A staged sequence. |
| `FAQ.jsx` | Question list. |

## The rule

**A figure or a name in `ProofBar` must be true.** These are
public marketing surfaces; a placeholder figure left in a template ships as a
claim. If the number is not available, drop the block rather than filling it.
