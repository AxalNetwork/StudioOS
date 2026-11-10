# Pricing evidence for #4656

First-party list-price snapshot retrieved 2026-11-10. Each row is one offer, with the vendor’s displayed currency. Annual equivalents are commitments only where explicitly shown or calculable from the displayed annual rate. Blank evidence is recorded as unverified.

| Offer | Buying situation | Monthly billing | Annual commitment | Scope and free access |
| --- | --- | --- | --- | --- |
| [Visible Core](https://visible.vc/pricing/) | Direct founder fundraising and investor updates | $69 | $708 ($59/mo) | Founder fundraising workflow, free Starter available |
| [Foundersuite Gold](https://foundersuite.com/pricing) | Direct active-raise investor CRM | Monthly toggle unverified | $1,069 | Free Basic available. Optional consulting advertised at $480/hour. Vendor says cancel anytime. |
| [DocSend Standard](https://www.docsend.com/pricing/) | Specialist secure multi-file sharing | $45/user | Unverified | Seat-based. Document sharing and engagement analytics. Free start advertised, enduring free tier unverified. |
| [Gamma Pro](https://gamma.app/pricing) | Specialist presentation creation | Unverified | USD $216 ($18/mo) | Free tier available. Presentation customization and AI generation. |
| [Papermark Business](https://www.papermark.com/pricing) | Specialist secure document sharing | Unverified | €708 (€59/mo) | Additional teammates advertised at €20/mo each. Free tier available. |
| [folk Standard](https://www.folk.app/pricing) | Specialist relationship CRM | $30/member | $288/member ($24/mo) | Per-member pricing. Long-term free access unverified. |

Unless stated, seat inclusions, usage caps, overages, service components, refund and cancellation terms are unverified. These offers cover different portions of the workflow. Their prices establish neither equivalent functionality nor willingness to pay for Axal.

## Funnel reconciliation

| Stage | Existing code evidence | Measurement gap |
| --- | --- | --- |
| Pricing view | PricingPage has no call to the first-party signup funnel tracker | Verify whether generic page analytics cover the pricing route under the same consent policy before counting views |
| Plan selection | Pricing-to-registration continuity exists as navigation state | A carried plan is not a recorded selection event. Verify capture of a stable plan key, interval and audience |
| Registration | RegisterPage emits register_view, register_submit and register_success | Separate magic, classic and Google. An email request succeeding is not proof of a verified account |
| Verification | VerifyEmailPage emits verify_email_result | Email verification is a distinct path. Reconcile OAuth and magic-link completion before pooling |
| Useful first output | No common milestone verified | Define an outcome per audience and count persisted successes |
| Payment | CheckoutPage has no call to the signup funnel tracker | Reconcile confirmed paid state against billing records. Checkout arrival is not payment |
| Continued use | No comparable cohort report verified | Define qualifying repeat use and an observation window before publishing retention |

The existing `frontend/src/lib/funnel.js` persists anonymous and session identifiers only with analytics consent and drops events after a decline. Report missing or unjoinable stages as unmeasured. Keep browser attribution separate from authenticated billing aggregates unless a consent-compatible join is already supported. Split cohorts by audience, plan and billing interval and show unknowns separately. No live counts were collected for this record.

## Decision

Keep the founder $20 and $100 monthly prices as hypotheses. Settle the purchase and entitlement work in #4651, #4653 and #4655 before any pricing experiment. The owner can run interviews and paid pilots separately for validating founders, active fundraisers, investors, and advisors or operating partners. Compare actual paid usage and renewal against contribution after AI, data, storage, payment, support and service costs. Treat starter allowances, annual allowance parity and activation-based provider charging as distinct decisions. This record proposes no price or entitlement change.
