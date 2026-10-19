# frontend/src/components/products — the Plans & Pricing storefront's pieces

What `/plans-and-pricing` (`../../pages/ProductsPage.jsx`) draws: the plan
cards, the Token packs, the add-on cards, the cart and the product slide-over.
Prices always come from the live catalog (`GET /api/catalog/products`) or from
the public plans-and-packs read; nothing here types a price.

| File | What it is |
| --- | --- |
| `productsShared.js` | The pure helpers every piece shares: money and dates, the billing cycles, VAT, the audience filters, the role badges, and the plan cards' design copy, keyed by the plan's metadata (D755 §11) with the exact product name as the fallback. |
| `BundleCard.jsx` | One subscription plan's card: the family badge, the catalog price, the features, the licence stepper, Subscribe, and its AI allowance (`PlanAi.jsx`). |
| `FreePlanCard.jsx` | A plan with no Stripe product (Founder Free, Investor Free, Exploring and other accounts): $0 and its AI allowance (D755 §11). |
| `PlanAi.jsx` | The AI part of a plan card, and "Your plan": the allowance, what it covers, when it resets, and Top up with token packs. Its words are `../../lib/plansPricing.js`'s. |
| `TokenPacksSection.jsx` | The `#token-packs` section (D755 §3, §10): one card per pack on sale with Buy, or "Top-up isn't available yet." |
| `ProductCard.jsx` | One add-on or service in the Add-ons grid. |
| `ProductSlideOver.jsx` | The product modal behind `/plans-and-pricing/:productId`, with the embedded Stripe checkout for a subscription. |
| `BillingCartBar.jsx` | The sticky billing-cycle toggle and cart bar. |
| `CartDrawer.jsx` | The one-time cart drawer, with promo validation and the VAT estimate. |
| `useCart.js` | The cart's state. |

## The rule for adding here

A piece belongs here when the storefront draws it. Words a test must read go in
`../../lib/plansPricing.js` (or `../../lib/aiTokens.js` for the top-up), not in
the component, so the desktop cards and the phone rows say the same thing.
