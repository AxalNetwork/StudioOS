## HQ › Decks — the deck studio's admin screens (D4155, #4155)

`/admin/platform/decks` and its sub-paths, HQ only (`hqOnly`), from
`design/incoming/HQ Decks Page.dc.html` (HD1–HD6). A Platform tab after Promo
codes.

| Address | Board | Backend today |
| --- | --- | --- |
| `/admin/platform/decks` | HD1 Reports | `GET /api/admin/deck-reports`, `POST /api/admin/deck-reports/:uid/resolve` (D1540). Names, before and after wait for K1 (#4188). |
| `/admin/platform/decks/flags` | HD2 | `GET /api/admin/feature-flags` (D1509). Writes wait for K2 (#4189). |
| `/admin/platform/decks/beta` | HD3 | None yet: K3 (#4190). |
| `/admin/platform/decks/templates` | HD4 | `GET /api/decks/admin/recommend-overrides`, `GET /api/decks/methods` (D905). Writes wait for K4 (#4191). |
| `/admin/platform/decks/norms` | HD5 | `GET`/`POST /api/admin/deck-stage-norms`, `PUT /:uid`, `POST /:uid/retire`, `GET /projects/:id` (`admin_deck_stage_norms.ts`, `requireHqAdmin`, migration `202611022230`; K5 #4192, D4155 §6). |
