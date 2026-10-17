# frontend/src/pages/profile — the founder's profile pages

D702 (#1664): the four pages the Studio phone canvas draws (`Studio Mobile
Page.dc.html`, boards S6m, S7m, S9m and S10m), at every width, for founders
only. `/profile` renders You for a founder and redirects every other role to
`/account`, as D433 did.

| File | What it holds |
| --- | --- |
| `ProfileFrame.jsx` | The frame they share. Below 1024px, D699's `PhoneBar` ("‹ Studio", title, sub) with the "Open the Eadwyn menu" button, which opens #1663's `EadwynMenu`. At 1024px and up, one column with "‹ Studio", the title, the sub and the drawer's five "Your profile" links, the venture ones keeping `project_id`. Also `useProfileRead` and the section, card and text blocks in `PhoneRows`' metrics |
| `YouPage.jsx` | You, `/profile`: the person, Bio, Background, Links, Founder preferences and Archetype, from `GET /api/profile/me` and `api.bestFit.me()`. Each Edit opens the editor that owns the data |
| `VenturePage.jsx` | Your venture, `/profile/venture`: the card, the problem, Facts and the module rows, from `GET /api/profile/venture`, and the Edit form saved through `PATCH /api/profile/venture` |
| `PreviewPage.jsx` | What others see, `/profile/preview`: each audience's card, figures, notes and public addresses, from `GET /api/profile/preview`, with `?audience=` in the URL |
| `VisibilityPage.jsx` | Visibility, `/profile/visibility`: the visibility radios and the four switches, over `/api/settings/privacy` (with `?project=`) and `/api/profile/archetype-published` |
| `profileModel.js` | The pure parts: each page's title and sub, the five links, initials, the preview's figure rows, the visibility options and the Edit form's fields |

## Rules

- **Every value comes from a Worker read.** A page draws what the read
  returned and decides nothing about what an audience may see; the preview's
  figures and notes are the Worker's.
- **A missing value is Not recorded,** with its reason, never a blank or a 0.
- **The venture is `useProject`'s,** read-only, so a founder with two ventures
  keeps the one in `?project_id=`.
- **No KYC field.** The person line's city is the co-founder profile's, never
  `users.city`.
- `frontend/test/profile_pages_d702.test.mjs` holds these pages.
