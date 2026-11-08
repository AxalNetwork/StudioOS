## Deal commitment context (D4633, #4633)

The Worker side is `routes/deals.ts`. The screens are the deal page (`pages/DealRoomPage.jsx`, `pages/deal/DealWorkTabs.jsx`) and the Deal Flow screens that show an Ask.

| Route | Who | What changed |
| --- | --- | --- |
| `GET /api/deals/:id/commitments` (changed) | an investor the deal admits | Reads the investor's commitments under one firm: the active firm, else their only firm. The same rule applies to committing and withdrawing. An investor in several firms who chose none gets 400 `firm_required`. Each row carries:<br>- `company_id` and `company_name`;<br>- `firm_context`;<br>- `in_context`;<br>- `legacy`, for a row recorded before commitments named a firm, which is listed but offers no action. |
| `GET /api/deals/:id/commitments` (changed) | the founder, an Operating Partner, an admin | Each row now names its firm: `company_id`, `company_name` (null when not recorded). |
