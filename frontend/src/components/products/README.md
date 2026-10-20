# frontend/src/components/products — the Plans and pricing storefront

The pieces of `/plans-and-pricing` (`../../pages/ProductsPage.jsx`; `/products`
redirects there): the catalogue's cards, the one-time cart and its drawer, the
product modal with Stripe's embedded checkout, and the Token packs section.
`../../pages/CheckoutPage.jsx` and `../../pages/CheckoutConfirmationPage.jsx`
reuse the cart and the shared helpers.

| File | What it owns |
| --- | --- |
| `productsShared.js` | Money and date formatting, the VAT estimate, and the billing-cycle helpers that group a product's live prices by monthly, yearly and one-time; the plan cards' design copy, keyed by plan metadata with the exact product name as the fallback (D755 §11). Pure. |
| `useCart.js` | The one-time cart: session state only, kept in `sessionStorage` for the tab. |
| `BillingCartBar.jsx` | The page's Monthly / Yearly / One-time toggle, and the cart button with its count. |
| `BundleCard.jsx` | A role bundle's card: live price, features, seats and Subscribe, and its AI allowance (`PlanAi.jsx`, D755 §11). |
| `FreePlanCard.jsx` | D755 §11: a plan with no Stripe product (Founder Free, Investor Free, Exploring and other accounts): $0 and its AI allowance. |
| `PlanAi.jsx` | D755 §11: the AI part of a plan card and "Your plan": the allowance, what it covers, when it resets, and Top up with token packs. Its words are `../../lib/plansPricing.js`'s. |
| `ProductCard.jsx` | An add-on's card: Add to Order for a one-time price, Subscribe for a recurring one. |
| `ProductSlideOver.jsx` | The product modal (the file keeps its old name), opened by a card or by `/plans-and-pricing/:productId`. |
| `CartDrawer.jsx` | The cart drawer: lines, quantities, the promo field, and the totals. |
| `TokenPacksSection.jsx` | D755: the Token packs section at `#token-packs` (`TOKEN_PACKS_PATH` in `../../lib/aiTokens.js`), and `isPackProduct`. Each pack's offer (D790: its bonus, when it ends, first purchase only) is `aiTokens.js`'s `packOfferLines`. |

## Rules

- **Every price comes from a live read.** Cards read the catalogue, and Token
  packs read the public pack list. Nothing here types a price or works one out.
  VAT is a display estimate; the server's figure is the one charged.
- **The cart holds one-time items only.** A subscription opens the embedded
  checkout instead, and a token pack never enters the cart (`isPackProduct`):
  each pack links to its own checkout.
- **A failed pack read says Unreadable**, with Retry. It never shows an empty
  list or a zero, so nobody reads a failure as "nothing on sale".
- **A failed allowance read says Unreadable** on every plan card, never "$0.00".
- **Tests:** `checkout_token_pack_d755.test.mjs` covers the Token packs section
  and its checkout; `plans_pricing_d755.test.mjs` covers the plan cards' AI.
