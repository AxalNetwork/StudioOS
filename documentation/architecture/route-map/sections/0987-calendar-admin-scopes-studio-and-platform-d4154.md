## Calendar — the admin scopes, Studio and Platform (D4154, #4154)

`/calendar?scope=studio` and `/calendar?scope=platform` (with `/calendar/week`
and `/calendar/agenda`), from `design/incoming/Calendar Admin Page.dc.html`
(CA1–CA5). Read-only.

| Address | Board | Backend today |
| --- | --- | --- |
| `/calendar` (the switcher) | CA1 | Drawn for an admin on a studio (Mine · Studio) and the Super Admin on HQ (Mine · Platform). |
| `/calendar?scope=studio` | CA2, CA4, CA5 | `GET /api/calendar/events?scope=studio` (D1206). Owner, company and the company link wait for C1 (#4196). |
| `/calendar?scope=platform` | CA3, CA3b | `GET /api/calendar/events?scope=all` (D1206). The branch filter waits for C1 (#4196). |
