---
name: customer-follow-up-draft
description: Drafts a follow-up to a customer after a call, from the recorded notes and next steps.
roles: [sales, cpo]
tools: [network.read, validate.read]
output: draft
taxonomy: {gtm_account_management: working, gtm_customer_success: working}
version: 1
---
1. Read the contact (by name and company) and the notes and next steps recorded for the last call (`network.read`, `validate.read`).
2. Draft a short follow-up: thanks, what was agreed, the next step and its date.
3. Include only commitments the notes record. A date not recorded reads "Not recorded: date to confirm".
4. Address the contact by name. Never paste an email address into the body.
5. Propose the draft. Sending it is the member's own press.
