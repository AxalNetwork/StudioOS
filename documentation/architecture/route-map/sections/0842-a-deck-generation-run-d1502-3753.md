### A deck generation run (D1502, #3753)

`routes/deck_batches.ts`, mounted at `/api/decks` beside `deck_grid.ts`, before `decks`, over migration 716's `deck_area_batches` and `deck_area_batch_steps`. A run is driven by the deck's `DeckGenRoom` Durable Object and throttled by the account's `AiGovernor`; it starts only through `services/decks/genRooms.ts`'s `admitDeckRun`, which A3's area routes (#3764) and the one-click build (#3768) call. Those admission paths sit under the `deck_generate` rate bucket (6 a minute, 20 an hour per member, failing closed). Client: `lib/api/deckBatches.js` (`deckBatchesApi`), read through `deckV2Adapter.batch` and `cancelBatch` (`SWAPPED` rows).

| Route | Who | What it answers |
| --- | --- | --- |
| `GET /api/decks/areas/batches/:uid` | the deck's readers (`projectOwned`) | The run: `{ uid, deck_id, class, state, quote_microusd, held_microusd, charged_microusd, created_at, started_at, settled_at, counts, steps: [{ seq, card_uid, area_id, element, kind, model_label, state, seconds, cost_microusd, fallback_used, error_code, result }] }`. A model's name or "No model · free"; `seconds` null until a step ends. A step's request is never sent. 404 `run_not_found` for a run that does not exist or whose deck the member may not read. |
| `GET /api/decks/areas/batches/:uid/events` | the deck's readers | Server-Sent Events from the room: `snapshot`, then `area_started`, `area_busy`, `step_done`, `variant_ready`, `area_failed`, `batch_done`. 503 `runtime_unavailable` where no room is bound. |
| `POST /api/decks/areas/batches/:uid/cancel` | the member who started it | Stop: the run as `GET` answers it. Steps that started are charged; the rest are released and the hold settles at what started. 403 `not_your_run` for anyone else who may read it. |
