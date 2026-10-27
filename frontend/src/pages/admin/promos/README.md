# Promo codes (D1270, #2381)

HQ › Platform › Promo codes at `/admin/platform/promo-codes`, from the owner's canvas "Promo codes" (PRM1–PRM13). HQ only.

| File | What it is |
|---|---|
| `promoModel.js` | The address (Codes, `/usage`, `/:id`, `?state=`, `?applies=`, `?q=`, `?sort=`, `?page=`), the state words in the Worker's order, each row's menu by state, the four tiles, and every word the list and the drawer draw (money, scope, duration, the redeemed count) |
| `promoWizard.js` | D1275: New code in five steps — the catalogue's plans and one-time products (never a token pack), each step's refusal, the create body in minor units, what a member pays, and the drafts Copy and Replace start from |
| `PromoParts.jsx` | The Usage tab's wait (PRM7, part 6) and one code's drawer at its address (PRM2): Overview, Redemptions and History |
| `PromoDialogs.jsx` | D1275: every change, each an in-page dialog saying what it does in Stripe, for members and in the record — New code, Copy, Replace, Edit, Pause, Resume and End now |

`../ConsolePages.jsx`'s `PromoCodesPage` draws the header and the Codes and Usage tabs over `../consoles/PromoCodesConsole.jsx`, which draws the list, holds the drawer the address names, and opens the dialogs.

**Adding to it:** every tab and every code is an address, and the filters live in it. A figure no read gives says "Not recorded" with its reason, never a zero; the list's Redeemed is StudioOS's count, and the drawer gives Stripe's beside it. A change opens a dialog in the page, never a browser pop-up.
