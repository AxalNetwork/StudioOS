### Distribution Ask (D4488, #4488; part of #3722)

The quoted drafting Ask behind Distribution's own "Waiting for you" header
button, campaign wizard assets step (`CampaignDraftAsk.jsx`), Inbox replies
and (#4741) Ads creatives. Distinct from #4046's channel-name and
Publish-post-text Ask placements, which predate #3722's redesign. Never
sends, schedules, posts or spends; a campaign-scoped `ad_creative` or
`campaign_fields` accept is the only kind that writes anything on Accept
(the existing creative/campaign store), and only individually, never in
bulk.

| Route | Purpose |
| --- | --- |
| `POST /api/grow/distribution/ask/quote` | Hold estimate for 1–8 requested drafts, by kind/channel/placement/field |
| `POST /api/grow/distribution/ask/run` | Drafts text against the quoted hold; stores proposals |
| `GET /api/grow/distribution/ask/proposals?project=&campaign_uid=` | The caller's own open proposals for this venture/campaign |
| `POST /api/grow/distribution/ask/accept-safe` | Bulk-accept safe kinds only (`post`, `subject_line`, `newsletter`) |
| `POST /api/grow/distribution/ask/:uid/decide` | Accept/edit/discard one proposal; `ad_creative`+`target:campaign` also writes the creative row |

Client: `frontend/src/lib/api/growDistributionAsk.js`
(`growDistributionAsk`); the panel is `DistributionAskIntent.jsx`. Worker
service: `cloudflare-worker/src/services/distributionDrafts.ts`.
