# Raise evidence (D1261, #2430)

The founder's Evidence view and the investor's evidence block, from the owner's canvas "Raise evidence" (VR1–VR19).

| File | What it is |
|---|---|
| `evidenceModel.js` | The address (`/raise/evidence`, `/item/:id`, `/claim/:id`), the five Source labels with SCORING's grade mapping, strengths, claim states, sharing levels, the Raise areas, and the words of every block no read carries yet |
| `RaiseEvidence.jsx` | The view in the Raise shell (VR1) and its drawers (VR2, VR3) as the shared `Sheet` over the view at 480 (D1317); it re-exports `EvidenceSummary` |
| `InvestorEvidence.jsx` | D1268: the investor's block (VR8 before the NDA, VR9 after it), one item's drawer (VR10) and the phone (VR18), on D1265's read. `EvidenceSummary` (the deal page), `SharedEvidence` (the diligence room) and `InvestorEvidence` (an investor's round call). It imports no `ui` index |

`../cycleModel.js` lights Evidence after Overview in Raise's tab rail; `../../DealRoomPage.jsx` mounts `EvidenceSummary`, `../../founder/RoundCallPage.jsx` mounts `InvestorEvidence` on an investor's call, and `../../research/DiligenceRoom.jsx` mounts `SharedEvidence`.

**Adding to it:** a Source label is set by code from the record, never by the founder or Eadwyn. A Typed-only figure is the founder's figure, never Backed. The grades are SCORING's (`../../../components/scoring/scorecard/scorecardModel.js`); this folder adds none. A block with no read says "Not read here yet", never a zero. An investor sees only what the read returned: an item it held back is absent, with no row or count saying so.
