### The member's Influencer section: `/influencer` and its tabs (D4289 P7, #4296)

Frontend only; it reads the routes P1, P2, P4, P5 and P6 mount. Boards IN0–IN6 (`design/incoming/Influencer Page.dc.html`). Decision: `documentation/architecture/decisions/D4296.md`.

| SPA route | Tab | Worker reads |
| --- | --- | --- |
| `/influencer` | Overview (IN1) | `GET /api/influencer/me`, `GET /api/influencer/me/handle`, `GET /api/influencer/me/analytics` |
| `/influencer/links` | Links (IN2) | `GET\|PUT /api/influencer/me/handle`, `GET\|POST /api/influencer/me/links`, `DELETE /api/influencer/me/links/:uid`, the analytics' channels |
| `/influencer/offers` | Offers (IN3) | `GET /api/influencer/me/offers`, `POST /api/influencer/me/offers/request` |
| `/influencer/earnings` | Earnings (IN4) | the analytics, `GET /api/influencer/me/payout-readiness`, `POST /api/influencer/me/tax-form`, `POST /api/influencer/me/terms/accept`, `GET /api/influencer/tiers`, `GET /api/network/payouts/me`, `POST /api/network/payout/request` |
| `/influencer/audience` | Audience (IN5) | the analytics |
| `/influencer/resources` | Resources (IN6) | none (static) |

**Who.** Every address is `authOnly`; the page draws the section only while `/api/auth/me`'s `influencer_active` is 1 and `GET /api/influencer/me` returns an active membership. The sidebar's "Influencer" row (`withInfluencerRow`, `frontend/src/sidebarConfig.js`) shows in every role's shell on the same condition. The route module is `frontend/src/routes/influencer.jsx`; the pages are `frontend/src/pages/influencer/section/`.
