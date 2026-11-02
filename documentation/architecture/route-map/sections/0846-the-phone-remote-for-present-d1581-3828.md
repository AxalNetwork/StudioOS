### The phone remote for Present (D1581, #3828)

`routes/deck_remote.ts` mounts itself at `/api/decks` before `decks`. Present's room and the pairing live in `DeckRemote` (`durable-objects/deck-remote.ts`), bound as `DECK_REMOTE` in all three `wrangler.toml` tables. Client: `lib/api/deckRemote.js` (`deckRemoteApi`). `PitchPresent.jsx` listens on the socket. The pairing screen and the phone remote are not drawn yet (needs-design on #3828).

| Route | Who | What it answers |
| --- | --- | --- |
| `POST /api/decks/:id/remote/pair` | the deck's readers (`projectOwned`) | `{ deck_id, code, expires_at }`: six digits, ten minutes, one join. A new code ends the remote paired before. Under `deck_remote_pair` (10 a minute, failing closed). |
| `GET /api/decks/:id/remote` | the deck's readers | `{ deck_id, code_live, paired, presenting }`. |
| `DELETE /api/decks/:id/remote` | the deck's readers | `{ ok, deck_id }`: unpaired. |
| `GET /api/decks/:id/remote/ws` | the deck's readers | Present's socket (`bearer.<jwt>` subprotocol): `hello`, `paired`, `unpaired` and `step` frames. |
| `POST /api/decks/remote/join` | a reader of the code's deck | `{ code }` → `{ deck_id, remote_id, expires_at }`, good for four hours. 404 `code_not_found` for a wrong or spent code, and for a member who cannot read the deck. Under `deck_remote_join` (10 a minute, failing closed). |
| `POST /api/decks/:id/remote/step` | the deck's readers, with the paired `remote_id` | `{ remote_id, step }` → `{ ok, delivered }`. `step` is `next`, `prev`, `first`, `last` or `{ card: n }`. 409 `remote_not_paired`; 400 `invalid_step`. |

Every route answers 503 `remote_off` on a Worker without the binding.
