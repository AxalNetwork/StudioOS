# Raise evidence (D1261, D1266, D1267, D1268, #2430)

The founder's Evidence view and the investor's evidence block, from the owner's canvas "Raise evidence" (VR1–VR19).

| File | What it is |
|---|---|
| `evidenceModel.js` | The address (`/raise/evidence`, `/review`, `/preview`, `/item/:id`, `/claim/:id`), the five Source labels with SCORING's grade mapping, strengths, claim states, sharing levels, the Raise areas, and the words the investor's block draws (D1268) |
| `evidenceView.js` | D1266: the view's model from `GET /api/cycles/raise/evidence` — the tiles, claims by area, Needs you first, the filters, coverage by source, what investors see, Accept all's cap of 50, and the words of each change |
| `RaiseEvidence.jsx` | The route in the Raise shell: one read, Look again, the page and the drawer the address names as the shared Sheet over the view at 480 (D1317); it re-exports `EvidenceSummary` from `InvestorEvidence.jsx` |
| `EvidenceView.jsx` | D1266: VR1's tiles and cards, and the empty, loading, error, partial, admin and refused states (VR12–VR16) |
| `EvidenceDrawers.jsx` | D1266: the claim drawer (VR2) and the item drawer (VR3) |
| `EvidenceReview.jsx` | D1266: Waiting for review (VR4), the Share dialog (VR5) and See as an investor (VR11) |
| `EvidenceParts.jsx` | D1266: the pills, the drawer frame (the shared Sheet at 480, D1317) and the in-page dialog every change opens |
| `moduleEvidence.js` | D1267: which surfaces and areas each Raise module shows, the newest version, a slide's claims, and the "Sources on Axal" lines |
| `EvidencePart.jsx` | D1267: the Evidence part under each Raise module's table (VR6), and "Evidence on this slide" in the deck editor (VR7) |
| `InvestorEvidence.jsx` | D1268: the investor's block (VR8 before the NDA, VR9 after it), one item's drawer (VR10) and the phone (VR18), on D1265's read. `EvidenceSummary` (the deal page), `SharedEvidence` (the diligence room) and `InvestorEvidence` (an investor's round call). It imports no `ui` index |

`../cycleModel.js` lights Evidence after Overview in Raise's tab rail; `../../DealRoomPage.jsx` mounts `EvidenceSummary`, `../../founder/RoundCallPage.jsx` mounts `InvestorEvidence` on an investor's call, and `../../research/DiligenceRoom.jsx` mounts `SharedEvidence`. `../CycleRoute.jsx` mounts `EvidencePart` on every Raise module; `../../raise/pitch/PitchEditor.jsx` mounts `SlideEvidence`. A share-link deck draws none of it.

**Adding to it:** a Source label is set by code from the record, never by the founder or Eadwyn. A Typed-only figure is the founder's figure, never Backed. A bank-derived figure (runway, revenue credits or growth, mapped spend, a bank-sourced KPI) reaches an investor only one by one, after the NDA, labelled "From the company's bank, as of [date]"; never a balance, account, line or counterparty (D1269, amending D840 §2). SCORING reads the pack through `evidencePack` only (D1265 §5, D1269 §3). The grades are SCORING's (`../../../components/scoring/scorecard/scorecardModel.js`); this folder adds none. Every change opens an in-page dialog that says what it changes. A block with no read says "Not read here yet", never a zero. A block the read could not answer says Unreadable with Try again, never a zero. An investor sees only what the read returned: an item it held back is absent, with no row or count saying so.
