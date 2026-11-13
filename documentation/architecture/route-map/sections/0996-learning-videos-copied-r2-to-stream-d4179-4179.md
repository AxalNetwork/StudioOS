### Learning videos copied from R2 to Stream (D4179, #4179)

- **Super Admin route:** `POST /api/admin/learning/stream/migrations { item_uid }` copies one item's uploaded file to Stream, one item per call. It answers 202 `{ copy: { stream_uid, state: 'copying' } }`. Refusals: 404, 409 `not_r2`, 409 `already_copied`, 502 `stream_copy_failed`. It lives in `routes/learning_stream.ts`.
- **Source route:** `GET /api/learning/stream/source/:token` serves the object for Stream to fetch.
  - The token is the only credential: an HMAC with its own purpose, valid for one hour, naming one item's object.
  - The object must still be the item's current upload. Anything else is 404.
- **Verification:** the existing webhook verifies a copy once it is ready with a duration above 0. The item then plays the copy, but only while it still plays the file that was copied.
- **Sweep:** `sweepLearningVideos` runs daily at 03:40 UTC.
  - It never deletes an object whose copy is not verified.
  - It deletes a verified copy's original 30 days after verification (owner step F).
  - At Stream, it deletes videos superseded for more than 30 days and upload links unused past their expiry.
- **Studio read:** `GET /api/admin/learning/items` adds `stream_copy` to each uploaded item: `none`, `copying`, `verified` or `failed`.
- **Client:** `adminLearning.migrateVideoToStream(uid)`. The Copy to Stream button and its states are L2's (#4177).
