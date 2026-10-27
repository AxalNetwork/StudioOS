# Raise evidence (D1261, D1266, #2430)

The founder's Evidence view and the investor's evidence block, from the owner's canvas "Raise evidence" (VR1–VR19).

| File | What it is |
|---|---|
| `evidenceModel.js` | The address (`/raise/evidence`, `/review`, `/preview`, `/item/:id`, `/claim/:id`), the five Source labels with SCORING's grade mapping, strengths, claim states, sharing levels, the Raise areas, and the words of the block no read carries yet (the investor's) |
| `evidenceView.js` | D1266: the view's model from `GET /api/cycles/raise/evidence` — the tiles, claims by area, Needs you first, the filters, coverage by source, what investors see, Accept all's cap of 50, and the words of each change |
| `RaiseEvidence.jsx` | The route in the Raise shell: one read, Look again, the page and the drawer the address names as the shared Sheet over the view at 480 (D1317); and `EvidenceSummary`, the investor block the deal page's Evidence tab places (VR8, VR9) |
| `EvidenceView.jsx` | D1266: VR1's tiles and cards, and the empty, loading, error, partial, admin and refused states (VR12–VR16) |
| `EvidenceDrawers.jsx` | D1266: the claim drawer (VR2) and the item drawer (VR3) |
| `EvidenceReview.jsx` | D1266: Waiting for review (VR4), the Share dialog (VR5) and See as an investor (VR11) |
| `EvidenceParts.jsx` | D1266: the pills, the drawer frame (the shared Sheet at 480, D1317) and the in-page dialog every change opens |

`../cycleModel.js` lights Evidence after Overview in Raise's tab rail; `../../DealRoomPage.jsx` mounts `EvidenceSummary`.

**Adding to it:** a Source label is set by code from the record, never by the founder or Eadwyn. A Typed-only figure is the founder's figure, never Backed. A bank-derived figure (runway, revenue credits or growth, mapped spend, a bank-sourced KPI) reaches an investor only one by one, after the NDA, labelled "From the company's bank, as of [date]"; never a balance, account, line or counterparty (D1269, amending D840 §2). SCORING reads the pack through `evidencePack` only (D1265 §5, D1269 §3). The grades are SCORING's (`../../../components/scoring/scorecard/scorecardModel.js`); this folder adds none. A block with no read says "Not read here yet", never a zero.
**Adding to it:** a Source label is set by code from the record, never by the founder or Eadwyn. A Typed-only figure is the founder's figure, never Backed. The grades are SCORING's (`../../../components/scoring/scorecard/scorecardModel.js`); this folder adds none. Every change opens an in-page dialog that says what it changes. A block the read could not answer says Unreadable with Try again, never a zero.
