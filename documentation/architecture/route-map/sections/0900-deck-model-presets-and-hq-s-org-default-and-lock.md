### Deck model presets and HQ's org default and lock (D1549, #3796)

`routes/deck_model_presets.ts`: `deckModelPresets` is mounted at `/api/decks` beside `deck_element_models.ts`, before `decks`; `adminDeckModels` at `/api/admin/ai/deck-models`. Both write `deck_model_picks` (migration 717); migration: none. A preset is stored as the deck's row under key `preset`, holding the preset's name; each element runs its own #3721 job's `presets` row (`presetModelFor`). HQ's lock wins over every other level in `resolveElementModel`. Clients: `lib/api/deckModelPresets.js` (read through `deckV2Adapter.presets`, and `.orgLocks` from its `locks`) and `lib/api/adminDeckModels.js` (the table on HQ › AI usage).

| Route | Who | What it answers |
| --- | --- | --- |
| `GET /api/decks/:id/model-presets` | whoever may read the deck (`projectOwned`) | `{ deck_id, project_id, preset, stored, options, groups: [{ group, label, lead, presets: [{ preset, model, name, plan_locked }], resolved: { model, name, source, locked }, lock }], locks: [{ group, label, model, name, line: 'Set by Axal VC HQ' }] }`. `preset` is the one in force: the stored one, `custom` when the deck holds picks of its own, `balanced` when it holds neither. |
| `PUT /api/decks/:id/model-presets` `{ preset: 'fast' \| 'balanced' \| 'best' \| 'custom' }` | whoever may write the deck | Fast, Balanced or Best clears the deck's own picks (its areas' stay) and stores the preset; Custom clears the stored preset. Answers the GET's reply. 400 `invalid_preset`. |
| `GET /api/admin/ai/deck-models` | Super Admin with a recent step-up | `{ groups: [{ group, label, lead, choices: [{ id, name, lock }], catalogue_default: { id, name }, org: null \| { model, name, locked, updated_at } }] }` for each element group that runs a model. |
| `PUT /api/admin/ai/deck-models` `{ group, model \| null, locked }` | as `GET` | Stores HQ's default for the group, or its lock when `locked`; `null` clears it. Audited (`deck_model_org_default`, `deck_model_org_locked`, `deck_model_org_cleared`). 400 `invalid_group`, `invalid_lock`, `lock_needs_model`, `model_not_offered`. |

Generation: the build's words (`/generate`, `/new/quote`, regenerate-card) and the deck's images resolve each element through the lock and the preset. A model HQ locked runs pinned (`RunOptions.pinned`: that model or nothing, no fallback). A lock on a model the caller's plan cannot run refuses the run 403 `role_locked`, "Set by Axal VC HQ for this deck's <group>.", and runs nothing. The build quote and the image quote name the resolved model in `element_models`.

