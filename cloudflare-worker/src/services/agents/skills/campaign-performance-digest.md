---
name: campaign-performance-digest
description: Reports a campaign's recorded results by channel: spend, leads and cost per lead, without filling in a missing figure.
roles: [cmo, cfo]
tools: [grow.read]
output: brief
taxonomy: {mkt_analytics: proficient, mkt_demand_gen: working}
version: 1
---
1. Read the campaign's channels, spend and leads recorded in Grow (`grow.read`).
2. Give each channel's spend, leads and cost per lead; compute cost per lead only when both spend and leads are recorded.
3. Rank channels by cost per lead.
4. Write "Not recorded" for a channel missing spend or leads.
5. Propose the digest to the marketing lead.
