### Licences page: Contract, Statements and Requests (D804, #2241)

These are the canvas's boards L3, L4, L5 and L8's sheet (`design/canvases/integrated/Licences Page.dc.html`). Each tab is a component under `frontend/src/pages/subsidiary/licence/`, which reads only through D798's and D799's API modules. D800 (#2233) mounts each in its tab frame: the tab's path is routed behind `guard(['admin'])` to `MyLicencePage.jsx`, whose Admin board frame draws the rail, keyed `Admin · Licences` through the page map's aliases. D804's stand-in route (`LicenceTabRoute`) and tab row are gone.

| Canvas | Live route | Component and Worker | Status |
| --- | --- | --- | --- |
| L3 Contract | `/admin/my-licence/contract` | `ContractTab.jsx` · `GET /api/licence/mine/contract`, `…/contract/:uid/pdf` | LIVE |
| L4 Statements | `/admin/my-licence/statements` | `StatementsTab.jsx` · `GET /api/licence/mine/statements`, `POST …/statements/:uid/dispute`, `POST …/usage/send` | LIVE (fee invoices wait for D802) |
| L5 Requests | `/admin/my-licence/requests` | `RequestsTab.jsx` · `GET`/`POST /api/licence/mine/requests`, `GET /api/licence/mine` | LIVE (the notice deadline waits for D797) |
| L5 and L8 "Request a change" sheet | `/admin/my-licence/requests?change=<term>` | `RequestChangeSheet.jsx` · `POST /api/licence/mine/requests` | LIVE |

