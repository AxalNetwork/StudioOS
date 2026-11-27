# Pricing entitlement matrix (#4653)

This is a review record for the public offer. The Worker catalogue determines plan identity and sellability. The public plans endpoint reads Stripe products and their configured allowances. Read current values from that endpoint for cards, checkout and Help. The matrix references storage policies by name so it cannot become a second source of limits.

| Audience and plan | Purchase path | Storage policy | Catalogue offer and verification gap |
| --- | --- | --- | --- |
| Founder Free | Free | FREE | One active startup, five interviews, three OKRs and three accepted introductions per month are catalogue claims. Verify the counters and reset rules before treating these as enforced limits. |
| Validate + Build | Founder growth product | START | Unlimited startups, interviews and OKRs, venture readiness, company research and ten accepted introductions per month. Verify the introduction reset and account scope. |
| Raise + Grow | Founder studio product | POWER | Deck sharing, cap table, data room, legal tooling and booking access. The catalogue lists 25 accepted introductions per month. Confirm data-room access after downgrade and separate booking or filing fees. |
| Investor Basic | Free | FREE | Public deal index, watchlists and read-only market pulses. AI usage draws on topped-up AI tokens under the free offer. |
| Investor Plus | Investor plus product | ACTIVE | Research workspace, watchlists, notes and deal comparisons. The catalogue describes standard research usage without a measurable search or export limit. |
| Investor Pro | Investor professional product | PROFESSIONAL | Screening, analytics, memo generation, exports and integrations. The catalogue describes higher AI research usage without quantifying the research allowance. |
| Investor Institutional | Contact Axal VC | Negotiated | Team access, reporting and custom integrations. Confirm seats, usage and support in the agreement. |
| Advisor Basic | Free | FREE | Directory profile, office hours, session types and booking links. |
| Advisor Pro | Advisor plan group | START | Paid sessions, deliverables, access log and payouts. The catalogue's matching language needs a distinction between visibility and suitability. |
| Partner Basic | Free | FREE | Provider listing, founder requests and verification badges. |
| Operating Partner Pro | Partner plan group | START | Proposals, pipeline, delivery, insights and Stripe Connect payouts. Remove or substantiate the implied demand guarantee before reusing the tagline. |
| LP Access | Fund investment | LP access policy | Fund information and documents for authorized investments. The catalogue has no subscription product for LP Access. |

## Scope and enforcement

| Question | Evidence | Before publication |
| --- | --- | --- |
| Who purchases and holds an entitlement? | D4729 applies each licence's own plan to its paid features. A held licence without a plan stays free. The #3704 decision keeps existing paid licences for appointed admins, uses the union sidebar without a switcher, and routes an additional licence through an Admin at its separate list price. | Explain collaborator roles separately from purchased licences. Verify seat counts, guest controls and additional-seat terms before promising included seats. |
| Do unlimited startups imply unlimited usage? | The catalogue exposes storage separately through `storagePlans.ts`. `storageUsage.ts` aggregates usage, and `aiCredits.ts` supplies plan and pack data. | Document owner, venture and member scope with the corresponding enforcement paths. Use live plan allowances and billing periods from #4652. |
| What uses an introduction? | `routes/introductions.ts` has a separate investor request counter on the user and a quarterly reset. Its quota grant and subsequent NDA flow are separate writes. Founder catalogue bullets refer to monthly accepted introductions. | Keep the two counters separate. Reconcile consent, eligibility, decline, retry, extra charges and what counts as an acceptance with #4606. Quota is capacity and conveys no outcome guarantee. |
| What makes Plus different from Pro? | `planCatalogue.ts` lists different features. It does not define research source coverage, freshness, permitted reuse or numeric search and export limits. | Confirm enforcement and approved data terms with #3701 before publishing quantitative or source-coverage claims. |
| What happens to room access on downgrade? | A storage allowance and a data-room access policy are distinct. The catalogue alone establishes only the former. | Trace guest and share-link checks on both sides of downgrade before promising continued access. |
| What services and charges are included? | The Founder Studio card lists software workflows and booking access. Provider plans list paid-session or payout tooling. | Publish covered jurisdictions, included human sessions if any, and third-party, filing and processing fees only after verification with #3703 and the service owners. |
| What support and rollout status apply? | The catalogue describes negotiated Institutional support and offers access to features by plan. It does not establish a support SLA or production availability for each advertised feature. | Confirm onboarding, support channels and alpha labels with the owners and carry reviewed text into #4638. |

Source paths: `cloudflare-worker/src/services/{planCatalogue,storagePlans,storageUsage,aiCredits}.ts`, `cloudflare-worker/src/routes/{public,introductions}.ts`, `frontend/src/lib/{sitePricing,pricingModel,plansPricing}.js`, and `documentation/architecture/decisions/D4729.md`. This draft records source evidence. Live checkout and owner review remain pending.
