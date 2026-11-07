### Distribution Ads (D4490, #4490; part of #3722; mounted by #4741)

`/grow/distribution/ads` mounts `AdsTab.jsx` inside #4484's shell: a manual
budget planner, recorded monthly spend (manual vs. Mercury, team-gated),
platform availability (all "Not offered yet" pending owner question C on
#3722) and creative drafts per placement. #4510 built the screen but no PR
wired it into `CycleRoute.jsx`'s distribution switch, so it fell through to
"Coming in this module soon" until the 2026-11-06 S1 audit (#4741) caught it.
Its creatives Ask reuses D4488/#4512's quote/run/accept contract
(`DistributionAskIntent`, `kind: 'ad_creative'`) scoped to the selected
campaign with `target: 'campaign'`; accepting a proposal writes the creative
row itself (D4483's existing store), so there is no second save path.

| Route | Purpose |
| --- | --- |
| `GET /api/grow/ads?project=&campaign=` | Campaign/channel budgets, monthly spend and 7-day leads (`grow_ads.ts`) |
| `GET /api/cycles/grow/campaigns?project=` | The campaign picker's list (#4447) |
| `GET /api/cycles/grow/campaigns/:uid/creatives?project=` | Existing creative text (#4483) |
| `PUT /api/cycles/grow/campaigns/:uid/creatives/:placement/:field` | Manual creative save (#4483) |
| `POST /api/grow/distribution/ask/quote` and `/run` | Quoted creative drafts, `kind: 'ad_creative'`, `target: 'campaign'` (D4488) |
| `POST /api/grow/distribution/ask/:uid/decide` | Accept writes the creative row directly (D4488/D4483) |

Client: `frontend/src/lib/api/growAds.js` (`growAdsApi.read`). No create,
pause, rule, connector or ad-money API; Axal never holds ad spend.
