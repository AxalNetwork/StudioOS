# Promo codes (D1270, #2381)

HQ › Platform › Promo codes at `/admin/platform/promo-codes`, from the owner's canvas "Promo codes" (PRM1–PRM13). HQ only.

| File | What it is |
|---|---|
| `promoModel.js` | The address (Codes, `/usage`, `/:id`, `?state=`, `?applies=`), the state words in `promoState`'s order with paused and ended once recorded, and the words of every block no read carries yet |
| `PromoParts.jsx` | The Usage tab's wait (PRM7), one code's drawer at its address (PRM2), and the list's notes (the redeemed figure is a lower bound; plan scope waits) |

`../ConsolePages.jsx`'s `PromoCodesPage` draws the header, the Codes and Usage tabs and these parts over `../consoles/PromoCodesConsole.jsx`, whose code cell opens the drawer.

**Adding to it:** every tab and every code is an address. A figure the Worker does not read says "Not read here yet" with its reason, never a zero; Redeemed stays labelled a lower bound until subscription redemptions are recorded.
