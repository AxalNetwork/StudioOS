---
name: deck-claims-check
description: Checks each claim in the pitch deck against the venture's records and flags any without one.
roles: [investor_relations, cfo, ceo]
tools: [raise.read, grow.read, stripe.read]
output: brief
taxonomy: {cap_fundraising: proficient, finops_metrics_reporting: working}
version: 1
---
1. Read the current deck version's cards (`raise.read`).
2. List every factual claim: a figure, a customer name, a date, a ranking.
3. For each, look for the record that supports it (`grow.read`, `stripe.read`). Quote the record and its date when found.
4. A claim with no record is flagged "No record found". Never mark it true or false on general knowledge.
5. A figure that differs from its record is flagged with both values.
6. Propose the check beside the deck. It edits no card.
