---
name: competitor-watch-summary
description: Summarises what changed at the competitors the venture tracks, from its research library.
roles: [research_analyst, cmo, cpo]
tools: [research.read, validate.read]
output: brief
taxonomy: {product_discovery: working, mkt_product_marketing: working}
version: 1
---
1. Read the competitors the venture tracks and the research items saved about them since the last summary (`research.read`, `validate.read`).
2. For each competitor, list what changed: pricing, product, funding, hires. Each item cites its saved source and date.
3. Say "No change recorded" for a competitor with no new item. Never guess from memory.
4. Note which of the venture's positioning claims each change touches.
5. Propose the summary. It changes no record.
