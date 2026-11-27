### Learning video on Cloudflare Stream (D4176, #4176)

- **Worker:** `routes/learning_stream.ts`, mounted by the route registry, with the logic in `services/learningStream.ts`.
- **Super Admin routes**, under `/api/admin/learning`:
  - `POST /items/:uid/stream/uploads` and `POST /items/:uid/stream/uploads/tus`;
  - `GET /items/:uid/stream`;
  - `POST /items/:uid/stream/:streamUid/abandon`;
  - `POST /items/:uid/stream/captions/generate`, and `PUT` / `DELETE /items/:uid/stream/captions/:lang`;
  - `PATCH /items/:uid/stream/thumbnail`.
- **Changed admin route:** `PATCH /items/:uid` now takes `chapters`, and a `video_url` there clears `stream_uid`.
- **Webhook:** `POST /api/learning/stream/webhook`, checked by its signature only.
- **Member read:** `GET /api/learning/items/:uid` adds `video_stream` (null, processing, error, or ready with signed URLs) and `chapters`. The token is minted only after `canSeeLearning`.
- **Store:** migration `202611022159_learning_stream.sql` adds `learning_items.stream_uid` and `chapters_json`, `learning_stream_videos` and `learning_stream_captions`.
- **Binding:** `STREAM`, in both wrangler tables. Without it every Stream route answers 503 `stream_unavailable`. The secrets are in PRODUCTION.md §4.
- **Client:** `lib/api/adminLearning.js` has `startStreamUpload`, `streamTusEndpoint`, `streamStatus`, `abandonStreamUpload`, `generateCaptions`, `uploadCaptions`, `deleteCaptions` and `setStreamThumbnail`. The player's `videoPlayback` plays a ready Stream video first.
