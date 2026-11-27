# pages/cycles/lovable — Build in Lovable (D1082, #2947)

The "From Lovable" canvas's LV1–LV4, LV7's button and LV8a (D1311).

| File | What it is |
| --- | --- |
| `lovableModel.js` | The words (the opens line, Left out), the `n / 4,000` count, the opened day, which entry draws, and Prototype / MVP's entry from the module read's `parts.lovable`. No React. |
| `BuildInLovable.jsx` | `BuildInLovableDialog` (the editable prompt, the count, the PII row, Open in Lovable ↗ disabled until the text on screen passed the Worker's check; a full-height sheet on the phone) and `BuildInLovable`, the button plus "Opened in Lovable on [date]". The experiment rows (`RecordView.jsx`) and Prototype / MVP's Add row (`CycleRoute.jsx`) mount it. |

The rule for adding here: the page never calls Lovable. It opens the link the
Worker's launch returns, in a new tab opened on the press.
