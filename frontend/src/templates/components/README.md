# templates/components — landing-page blocks

The section types a persona landing page is assembled from. A template picks
blocks and supplies content; the blocks do no fetching and hold no state.

| Block | What it renders |
| --- | --- |
| `Hero.jsx` | Headline, sub, primary CTA. |
| `SectionHeader.jsx` | The heading above any section. |
| `FeatureGrid.jsx` | Feature cards. |
| `OutcomeCards.jsx` | Outcome-shaped cards. |
| `MetricsStrip.jsx` | A row of figures. |
| `ProofBar.jsx` | Logos or proof points. |
| `TestimonialBlock.jsx` | A quote. |
| `ValidationBlock.jsx` | Evidence and validation. |
| `Timeline.jsx` | A staged sequence. |
| `AccessBlock.jsx` | Who this is for / how to get in. |
| `FAQ.jsx` | Question list. |
| `CTABlock.jsx` | Closing call to action. |

## The rule

**A metric in `MetricsStrip` or a name in `ProofBar` must be true.** These are
public marketing surfaces; a placeholder figure left in a template ships as a
claim. If the number is not available, drop the block rather than filling it.
