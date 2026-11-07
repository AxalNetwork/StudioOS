### Distribution Campaigns, New campaign and campaign detail (D4487, #4487; part of #3722)

`/grow/distribution/campaigns` mounts `CampaignsTab.jsx` (filters, attention rows and
counts) inside #4484's Distribution shell; a listed row (`/grow/distribution/campaigns/:uid`)
opens `CampaignSheet.jsx` as a 480px detail with explicit Activate/Pause/Resume/End and Archive
confirmations. `/grow/distribution/campaigns/new` and the editing form at
`?edit=` mount `NewCampaignPage.jsx`, a six full-page-step wizard
(`CampaignSteps.jsx`); Schedule saves a plan and never activates, posts or
spends. D4496 reads write access from the venture's own permission
(`useDistributionAccess.js`/`campaignPermission`), never inferred from a
failed read: a recorded non-writer sees the reader page, and only a genuine
read failure is Unreadable.

These screens are the UI the #4447 and #4483 sections below note as not yet
built when their routes were added; no new route is introduced here.

| Route | Purpose |
| --- | --- |
| `GET /api/cycles/grow/campaigns?project=&status=&q=` | Campaign list, filters and counts (#4447, #4483) |
| `GET /api/cycles/grow/campaigns/:uid?project=` | Campaign detail with linked items (#4483) |
| `POST /api/cycles/grow/campaigns` | Create a draft plan (#4447) |
| `PATCH /api/cycles/grow/campaigns/:uid` | Edit a plan and its status (#4447) |
| `DELETE /api/cycles/grow/campaigns/:uid` | Archive, preserving links (#4447) |
| `PUT /api/cycles/grow/campaigns/:uid/channels/:channelUid` | Link a channel and its budget (#4447) |
| `GET /api/cycles/grow/campaigns/:uid/creatives?project=` | Plain creative text (#4483) |
| `PUT /api/cycles/grow/campaigns/:uid/creatives/:placement/:field` | Upsert creative text (#4483) |
| `GET /api/cycles/grow/modules/distribution/form-options?project=&campaign=1\|permission` | Writer-gated campaign choices, and the venture's own write permission (D4496) |

Client: `frontend/src/lib/api/cycles.js`'s `cyclesWrite.grow` (D4447/D4483's
existing campaign writes). No migration or second campaign store.
