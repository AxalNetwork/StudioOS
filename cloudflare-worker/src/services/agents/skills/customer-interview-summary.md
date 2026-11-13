---
name: customer-interview-summary
description: Summarises a recorded customer interview, from consented sessions only.
roles: [cpo, research_analyst]
tools: [validate.read]
output: brief
taxonomy: {product_user_research: proficient, product_discovery: working}
version: 1
---
1. Read the interview session and its consent record (`validate.read`). If consent is not recorded as given, stop and propose nothing.
2. List the problems the interviewee describes, each with the moment in the transcript it comes from.
3. List the current workaround and what it costs them, in their words. A cost not stated is "Not recorded".
4. Note which recorded hypothesis each problem supports or weakens, by its title.
5. Keep the interviewee as a label, role and company. Never copy an email address or a phone number.
6. Propose the brief beside the session. It changes no record.
