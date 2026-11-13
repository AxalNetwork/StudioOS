### Account › Licences and the union sidebar (D4473, #4473)

Part 2 of #3704. There is no licence switcher: a member's left sidebar is the union of the licences they hold, built by `lib/licenceSidebar.js` (Studio and Spin-Out Lab once, each held licence's rows in the order Founder, Investor, Advisor, Operating Partner, then Trust, Network, Research). Portfolio and Companies are in the Account menu, never the sidebar.

| Route | Who | What it is |
| --- | --- | --- |
| `/account/licences` | every member licence and exploring (`routes/account_licences.jsx`); an admin account has no Licences item | Each held licence with its label, "Primary", when and how it was granted and its plan, from `GET /api/account/licences` (D4472); the licences it could add, each "Contact Axal VC to add this licence" to `/help`. No switch. |
| `/admin/accounts/all/:id` (Profile tab) | admins (D4472's boundary: another admin's record is the Super Admin's) | The drawer's Licences block: grant or revoke an additional licence through `POST` / `DELETE /api/admin/accounts/:id/licences`. The primary licence has no Revoke. |
