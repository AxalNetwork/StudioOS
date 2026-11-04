# Distribution components

The tab shell is #4484 and the campaign wizard is #4487. Their in-progress
files are not created here. These components use existing UI tokens and stores;
nothing sends, posts or starts ads.

| File | Purpose |
| --- | --- |
| `ProspectsTab.jsx` | D4492: customer pipeline, import, quiet hours and hashed suppression management. Takes projectId, ventureName and the shell's canWrite. |
| `ProspectSheet.jsx` | D4492: the individual contact email, recorded permissions and activity; explicit status/consent edits. |
| `AddProspectSheet.jsx` | D4492: manual capture, proof and a blank-note Ask; none on consent. |
| `prospectsModel.js` | D4492: seven stages, source labels, truthful counts and fixed refusal fallback. |
| `ProspectConsentSummary.jsx` | D4492: Audience slot and reusable summary hook/Review reachable label for the wizard handoff. |

Import `ProspectsTab` for the shell's Prospects slot, with its verified venture
id and read/write state. The wizard may call `useProspectConsentSummary` once,
draw `ConsentSummaryView` in Audience and `reachableLabel` in Schedule. A
segment-specific count remains Not recorded until contact membership exists.
