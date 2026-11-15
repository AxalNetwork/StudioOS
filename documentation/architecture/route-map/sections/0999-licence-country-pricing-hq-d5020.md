### Country pricing, the HQ screens (#5020, D5020 part 2)

Licences and Contracts v2 addendum, boards L23–L28 (phone L38, states L39). HQ only (`hqOnly`); the reads are Super
Admin, mounted at `/api/admin/licence-pricing` (D5020).

| Address | Board | Reads |
| --- | --- | --- |
| `/admin/licences/pricing` | L23 catalogue | `GET /api/admin/licence-pricing/catalogue`, `/model-versions` |
| `/admin/licences/pricing/country/:code` | L24 country detail and trace | `GET /api/admin/licence-pricing/catalogue/:code` |
| `/admin/licences/pricing/models` | L25 pricing models (read-only) | `GET /api/admin/licence-pricing/model-versions` |
| `/admin/licences/pricing/reviews` | L27 annual review queue | `GET /api/admin/licence-pricing/review-queue` |
| `/admin/licences` (ledger) | L28 Needs HQ pricing chips | `GET /api/admin/licence-pricing/signals` |
| `/admin/licences/:uid/terms` | L26 Pricing & Market | `GET /api/admin/licences/:uid/pricing` (D5017) |

Nothing on these screens changes a licence's terms; model editing and activation are not drawn (D5020 part 2 §3).
