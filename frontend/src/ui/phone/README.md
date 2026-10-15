# Founder phone primitives (D699)

These components follow `design/canvases/integrated/Cycle Overview.dc.html` below
1024px. The sheet is at most 78% tall, its rows are 52px, and page rows are
56px. Every surface carries its own dark colours, checked by
`frontend/test/phone_shell_d699.test.mjs`.

| File | Purpose |
| --- | --- |
| `PhoneBar.jsx` | Back row, title, subheading and an optional page action. |
| `PhoneRows.jsx` | Group headings and 56px linked or button rows. |
| `PhoneSheet.jsx` | Modal bottom sheet, focus and scroll management, and 52px rows. |
| `CompanySheet.jsx` | Member company choice, creation and visit display. `CompanyVisits` records the last opened cycle per company (`visitToRecord`). |
| `AccountSheet.jsx` | Identity, member account doors and sign out. |
| `PhoneHeader.jsx` | The founder's 52px band: logo, company pill, Studio glyph, bell and initials. The pill opens `CompanySheet`, the initials `AccountSheet`. |
| `PhoneHeader.jsx` — `HeaderForWidth` | Mounts the band for a founder below 1024px and the shell's own header otherwise, never both. |
| `usePhoneWidth.js` | One hook for the shared 1024px width rule. |

The band is the same in light and dark mode: white type on the Lab band
illustration under the canvas's gradient (D699 decision 8).
