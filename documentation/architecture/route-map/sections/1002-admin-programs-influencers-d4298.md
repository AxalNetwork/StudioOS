### Admin › Programs › Influencers (D4298, #4298)

The HQ desk for the influencer program (IN11), at `/admin/programs/influencer`, under `guard(['admin'])` (the Worker's `requireHqAdmin` refuses a branch admin) (`frontend/src/routes/adminInfluencers.jsx`). The page is `pages/admin/programs/InfluencerPages.jsx`, mounted by `ProgramPage.jsx`, and its client is `lib/api/adminInfluencers.js`. Money is the Super Admin's: an admin reads "HQ reads", never a zero.

| Address | What it draws | Worker routes |
| --- | --- | --- |
| `/admin/programs/influencer` | Opens Applications | (as below) |
| `/admin/programs/influencer/how-it-runs` | Part 1's playbook | `GET/PUT /api/admin/programs/influencer` |
| `/admin/programs/influencer/applications` | The queue (Waiting, Admitted, Declined, All) and the answers drawer: Admit at a tier, Decline…, Ask for more… | `GET /api/admin/influencers/applications`, `POST …/applications/:uid/decision` |
| `/admin/programs/influencer/influencers` | Members with sign-ups and commission per currency; row actions (tier, pause or resume, end, take down handle), each with a reason; Flagged sign-ups (Keep, Reverse) | `GET /api/admin/influencers` (D4298), `PATCH …/:uid`, `GET …/flags`, `POST …/flags/:uid/decision` |
| `/admin/programs/influencer/offers` | Every influencer's offers. The Super Admin links a Promos code and pauses, resumes or ends an offer, each with a reason | `GET/POST /api/admin/influencers/:userUid/offers`, `PATCH …/offers/:offerUid` (P4) |
| `/admin/programs/influencer/payouts` | Doors to Commissions on `?source=subscription_invoice` and `?source=influencer_bonus` | — |
| `/admin/programs/influencer/activity` | Part 1's activity | `GET /api/admin/programs/influencer/activity` |
| `/admin/programs/influencer/settings` | Tier defaults ("Set per agreement", "Not set"); Edit is the Super Admin's | `GET /api/admin/influencers/tier-defaults`, `PUT …/tier-defaults/:tier` |

**`GET /api/admin/influencers`** (HQ; `?status=active|paused|ended|all`, `limit` up to 500) returns `{ influencers: [{ uid, user_uid, person, handle, tier, tier_label, status, signups, visits, paid_members, revenue, commission }], counts }`.

- `commission` is `{ by_currency: [{ currency, earned_cents }] }`, net of reversals, for the Super Admin, and `{ available: false, reason: 'hq_reads' }` for an admin.
- `visits`, `paid_members` and `revenue` read `not_recorded`.
- No email is sent. A bad status is 400 `invalid_status`.
