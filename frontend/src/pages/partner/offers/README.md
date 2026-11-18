# frontend/src/pages/partner/offers — the partner Offers bucket

The Offers zones, each the body of one `/offers/*` address on the Partner shell, and the pure rules they read.
`frontend/src/workspaces/partner/PartnerBucketRoutes.jsx` maps each address to its file. The canvas is Offers v2
(`design/incoming/Offers v2 Page.dc.html`, D4841 to D4843).

| File | What it is |
| --- | --- |
| `VisibilityZone.jsx` | `/offers/visibility` since D4843 (OF-05): "Where does our work come from?", one table of surfaces by engagements and won value, missing attribution as an action, and Views and Trend as Not measured with the reason one press away. |
| `visibilityModel.js` | D4843: the pure rules Visibility reads: row order, the caption, the missing-source notice and the reasons. |
| `ProofZone.jsx` | `/offers/proof` since D4842 (OF-03): the result cards, outcome first, each with one consent label. |
| `proofCards.js` | D4842: the pure rules a Proof card is drawn by. |
| `AudienceFitZone.jsx` | `/offers/audience-fit` since D4842 (OF-04): who we fit and who we refer elsewhere, in business language. |
| `fitRules.js` | D4842: the pure rules Audience fit reads from `partner_fit_rules`. |
| `TestingZone.jsx` | `/offers/testing`: product testing runs and their recruitment. |
| `useGuardedWrite.jsx` | #4688: one way to write a record and say whether the server accepted it. |

**Adding to Offers.** A zone reads only mounted Worker routes and draws loading, empty, "Not recorded" with its
reason and "Unreadable" with a retry. A figure the product cannot state is `NotMeasured` or `StatedLimit` from
`../kit.jsx`, never a zero. A rule a test should run alone goes in a pure module beside its zone.
