### Learning › the Stream lesson player (D4178, #4178, L3 of #3726)

The member's lesson and video pages (LR4 to LR7, lr20b and lr21), on top of L1 (D4176).

- **Player:** `frontend/src/pages/learning/LessonPlayer.jsx`. A ready Stream video plays in Stream's own player (`@cloudflare/stream-react`, pinned exactly). Its source is the signed `iframe_url` that `GET /api/learning/items/:uid` mints after its access check.
  - Speed, quality, the captions menu and picture-in-picture are the player's own controls.
  - The player starts at `progress.position_seconds`. It writes the position at most every 15 s and on pause, through the same `positionWriter` as the uploaded-file player.
- **Chapters:** beside the player on a wide screen and below it on a tablet or phone. The current chapter is marked, and a click seeks.
- **Transcript:** below the player. A ready caption is read as timed cues: the current cue is marked, and a click seeks. A picker appears when there is more than one language.
  - With no cues, the plain transcript is shown with "No caption cues, so the plain transcript is shown."
  - When the captions cannot be read, it says so and shows the plain text.
  - With no transcript at all: "No transcript is recorded for this video."
- **States (lr6):** processing, failed, no source, and the uploaded-file fallback come from `videoPlayback`. A ready Stream video plays first, ahead of the uploaded file and then the link.
- **Hover preview (lr7):** a video card in the library reads the item once on hover and shows its signed `preview_url` when Stream has one. Nothing is drawn otherwise.

| Route | Who | What it answers |
| --- | --- | --- |
| `GET /api/learning/items/:uid/captions/:lang` | a member who may see the item | `{ language, vtt }`, `Cache-Control: private, no-store`. Errors: 400 `bad_language`; 404 for an item the member cannot see, a video not ready on Stream, or a language with no ready caption; 503 `stream_captions_unavailable` without the binding or `STREAM_API_TOKEN`; 502 `caption_unreadable` when Stream sends something that is not WebVTT |

The route is in `cloudflare-worker/src/routes/learning.ts`, beside the item read whose access check it shares. Stream's binding has no caption read, so the file comes from Stream's API with `STREAM_API_TOKEN`. The token is never sent or logged. The client method is `learningApi.itemCaption`, and `readItemCaption` parses the file into cues.
