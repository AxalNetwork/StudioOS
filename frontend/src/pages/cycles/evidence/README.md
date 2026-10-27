# Raise evidence (D1261, #2430)

The founder's Evidence view and the investor's evidence block, from the owner's canvas "Raise evidence" (VR1–VR19).

| File | What it is |
|---|---|
| `evidenceModel.js` | The address (`/raise/evidence`, `/item/:id`, `/claim/:id`), the five Source labels with SCORING's grade mapping, strengths, claim states, sharing levels, the Raise areas, and the words of every block no read carries yet |
| `RaiseEvidence.jsx` | The view in the Raise shell (VR1), its drawers (VR2, VR3), and `EvidenceSummary`, the investor block the deal page's Evidence tab places (VR8, VR9) |

`../cycleModel.js` lights Evidence after Overview in Raise's tab rail; `../../DealRoomPage.jsx` mounts `EvidenceSummary`.

**Adding to it:** a Source label is set by code from the record, never by the founder or Eadwyn. A Typed-only figure is the founder's figure, never Backed. A bank-derived figure (runway, revenue credits or growth, mapped spend, a bank-sourced KPI) reaches an investor only one by one, after the NDA, labelled "From the company's bank, as of [date]"; never a balance, account, line or counterparty (D1269, amending D840 §2). SCORING reads the pack through `evidencePack` only (D1265 §5, D1269 §3). The grades are SCORING's (`../../../components/scoring/scorecard/scorecardModel.js`); this folder adds none. A block with no read says "Not read here yet", never a zero.
