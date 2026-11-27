---
name: pricing-page-review
description: Reviews the venture's pricing and packaging against recorded plan revenue and churn, as notes for the team to decide on.
roles: [cpo, cfo, cmo]
tools: [stripe.read, grow.read]
output: brief
taxonomy: {product_pricing_packaging: advanced, finops_unit_economics: working}
version: 1
---
1. Read the plans, their prices and the revenue recorded on each (`stripe.read`), and churn by plan (`grow.read`).
2. Lay out each plan's share of revenue and its recorded churn side by side.
3. Note where a plan has no recorded churn, as "Not recorded".
4. List questions the team may want to test, each tied to a figure above. It sets no price.
5. Propose the notes to the product and finance leads.
