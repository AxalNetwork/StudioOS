---
name: opportunity-sizing-outline
description: Outlines a bottom-up market size from the segments and counts the venture has recorded, never estimating a missing one.
roles: [cpo, research_analyst]
tools: [validate.read, research.read]
output: brief
taxonomy: {product_discovery: proficient, finops_financial_modeling: working}
version: 1
---
1. Read the recorded segments and their counts (`validate.read`) and any market sources in the research library (`research.read`).
2. Build the size bottom up: number of buyers in each segment times the recorded price point, showing each factor and its source.
3. Where a factor is missing, write "Not recorded" and leave the total open rather than filling it in.
4. List the sources cited, by title.
5. Propose the outline to the product lead as a brief.
