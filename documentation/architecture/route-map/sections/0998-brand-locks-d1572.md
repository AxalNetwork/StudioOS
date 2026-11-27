### Brand locks and .pptx templates (D1572, #3819)

- **Worker, `routes/deck_brand_kit.ts`:**
  - `GET /api/decks/brand-kit/locks?project_id=` → `{ locks: { fonts, palette, logo }, can_lock, admins_only }`;
  - `PUT /api/decks/brand-kit/locks?project_id=` `{ part, locked }` is for the venture's owner only; anyone else gets 403 `admins_only`.
- **Worker, `routes/deck_layouts.ts`** (mounted before `decks.ts`):
  - `POST /api/decks/templates/import?project_id=` (the .pptx) → the mapping report; nothing is stored. It is switched by `deck:pptx_import`.
  - `GET` and `POST /api/decks/layouts?project_id=`, and `DELETE /api/decks/layouts/:uid?project_id=`.
- **Gates:**
  - a kit save that changes a locked part → 409 `brand_locked`;
  - a card save (`PATCH /cards/:uid`, `PUT /:id`) that brings in an off-palette colour while the palette is locked → 409 `brand_locked` (`saveGates.ts`).
- **Tables:** `deck_brand_locks` and `deck_custom_layouts` (migration `202611031015_deck_brand_locks.sql`).
- **Client:**
  - `lib/api/deckBrandLocks.js` (`deckBrandLocksApi.locks`, `setLock`);
  - `lib/api/deckLayouts.js` (`deckLayoutsApi.importTemplate`, `layouts`, `save`, `remove`);
  - read through `deckV2Adapter.brandLocks` and `pptxImport`.
