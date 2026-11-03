---
name: experiment-readout
description: Writes up an experiment from its recorded hypothesis, variants and results, without rounding a result into a win.
roles: [cpo, cmo]
tools: [grow.read]
output: brief
taxonomy: {product_experimentation: proficient, product_analytics: working}
version: 1
---
1. Read the experiment's hypothesis, its variants, sample sizes and results (`grow.read`).
2. State the result as recorded, with the sample size beside each figure.
3. Say whether the recorded result meets the decision rule written before the test; if no rule was recorded, write "Not recorded" and stop short of a verdict.
4. List what the team could test next.
5. Propose the readout to the product lead.
