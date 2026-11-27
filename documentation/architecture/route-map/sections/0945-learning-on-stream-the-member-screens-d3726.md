## Learning on Stream — the member screens (D3726, #3726)

From `design/incoming/Learning Stream Page.dc.html` (LR1–LR21). The member
routes keep D562's guard (every signed-in role, behind the coming-soon gate).

| Address | Board | Backend today |
| --- | --- | --- |
| `/learning` | LR1 | New this week from `GET /api/learning/catalog`; the progress figures wait for L5 (#4180) and read "Not recorded"; Recommended waits for #3724. |
| `/learning/courses/:slug/:lesson`, `/learning/videos/:uid`, `/learning/items/:uid` | LR4, LR4b | Resume and position writes through `GET /api/learning/items/:uid` and `POST /api/learning/progress` (`position_seconds`). Stream playback, captions and chapters wait for L1 (#4176) and L3 (#4178). |
| `/learning/my-programs/:program` | LR13, LR13b | `GET /api/learning/programs/:uid` and `POST /api/learning/programs/:uid/enrol` (D558). New address. |
| `/learning/studio` (Stream upload) | LR14–LR17 | Waits for L2 (#4177). |
| Analytics | LR18–LR20 | Waits for L6 (#4181). |
