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
| `CompanySheet.jsx` | Member company choice, creation and visit display. |
| `AccountSheet.jsx` | Identity, member account doors and sign out. |
| `usePhoneWidth.js` | One hook for the shared 1024px width rule. |

`PhoneHeader.jsx` and `HeaderForWidth` join this folder in D699's second PR,
after the first PR merges.
