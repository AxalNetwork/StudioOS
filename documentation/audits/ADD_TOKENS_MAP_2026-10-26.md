# Add tokens map — 2026-10-26

This audit reads the owner's "Add tokens" canvas (#2452, boards CRP1–CRP18) against the code on `origin/main` at `22343c6ddb`. It is a snapshot, true as of that date and **not maintained**. D1285 is the decision that acts on it.

## 1. The canvas

`design/incoming/Add tokens · Boards.dc.html` holds the board grid. It imports `Add Tokens Page.dc.html` by name, one variant per board.

| Boards | What they draw |
|---|---|
| CRP1 | Pricing › Models for a member: the "Your AI tokens" band (balance, plan allowance, storage, the allowance-then-tokens bar, Add tokens, auto-reload), Token packs, then the model tables |
| CRP2–CRP5 | The checkout sheet in pack mode: choose and pay, Accepted with the counting balance, landing slowly, a card refusal and the pack rules |
| CRP6 | Offers on the pack cards: plain, a bonus with its end, first purchase only |
| CRP7, CRP8 | Auto-reload's state and the History tab, both inside the sheet |
| CRP9 | The four other Add tokens: the rail, Billing's Buy tokens, Usage's top-up tile, a refused run |
| CRP10–CRP14 | Nothing on sale, loading and errors, a visitor, the profiles' bands, AI paused |
| CRP15–CRP17 | Phone and dark |
| CRP18 | HQ › AI allowances › Token packs, annotated, not redesigned |

## 2. What each board can read today

| Board · block | Read or code | Status on `main` |
|---|---|---|
| CRP1 balance | `GET /api/ai-budget/me` → `balance_microusd`, `ai_paused` (`routes/ai_budget.ts`) | built |
| CRP1 plan allowance | the same read: `plan`, `month_spend_microusd`, the caps | built; the band does not draw it yet |
| CRP1 storage line | #2449's storage read (D1166) | built; not on the band |
| CRP1, CRP6 packs and offers | `GET /api/public/plans-and-packs` → `packs[]` (`packCards`, `lib/pricingModel.js`) | built |
| CRP2 pay | `POST /api/orders/intent` with one pack line (`routes/orders.ts`) | built; today on the full `/checkout?token_pack=` page |
| CRP2 the sheet | `components/checkout/CheckoutSheet.jsx` (D1048) | built for plans only; no pack mode |
| CRP3, CRP4 landing | `GET /api/orders/:ref` → `ai_topup.state`; `purchaseState` (`lib/aiTokens.js`) | built; on `/checkout/confirmation` |
| CRP5 pack rules | `tokenPackQuote` (`services/aiCredits.ts`): `token_pack_first_purchase_only` (409 with the canvas's sentence), `token_pack_daily_limit`, `token_balance_ceiling`, `token_packs_on_hold`, `token_pack_not_on_sale`, `token_pack_alone`, `promo_not_for_token_packs` (400, code only) | built; only the first carries a sentence |
| CRP7 auto-reload | `GET /api/ai-budget/auto-reload` (D794) | built; drawn on Billing only |
| CRP8 history | `GET /api/ai-budget/history` (`runs=1` adds runs) | built; drawn on Usage |
| CRP9 entry points | `ADD_TOKENS_PATH` (`lib/aiTokens.js`) = `/pricing/products#token-packs`, read by the rail, the Assist card, Usage, AI tokens, the phone Pricing screen, Build, the narrative, the pitch deck and the session digest | built, to the old storefront |
| CRP14 paused | `/me`'s `ai_paused` (D1277) | built |
| CRP18 HQ | `/api/admin/catalog/token-packs*` on HQ › AI allowances | built; unchanged |

## 3. #2452's "broken or half-built", re-checked

1. **The Models strip hid a failed read** (`return null` when the read was not ready). Still so on `main`; **fixed by D1285**: "Token packs couldn't be read just now." with Try again.
2. **The confirmation page sends members to `/pricing/products`.** Still so (`CheckoutConfirmationPage.jsx:63`, `:66`, `:99`; `CheckoutPage.jsx:250`, `:390`, `:400`). D1288's.
3. **Two Buy buttons for one pack.** The Models Buy linked to the storefront, whose own Buy opened the checkout. **Fixed by D1285**: the Models Buy opens the pack's checkout.
4. **The webhook check missed the reversal events** (#2393). **Fixed on `main`**: `REQUIRED_EVENTS` (`routes/admin_stripe.ts`) lists `charge.refunded`, `charge.dispute.created` and `charge.dispute.closed`.

## 4. What waits, and on what

- D1286: the band's allowance, bar, storage line, auto-reload line and profiles, and phone and dark for the Models tab.
- D1287: the sheet's pack mode, after D1048's sheet. This is where Add tokens opens in place.
- D1288: one Add tokens everywhere (`openAddTokens`, `ADD_TOKENS_PATH`), the old storefront's redirects, and item 2's links.
- D1289: the Worker's part: a sentence for every pack refusal, the pack-list parity test, and the optional `add_tokens_opened` row.
- #2452's eight owner questions take their recommended answers, which is what the canvas draws (D1285 §5).
