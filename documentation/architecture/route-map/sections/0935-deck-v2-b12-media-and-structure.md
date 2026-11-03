### Deck v2 B12: media and structure (D1545, #3788)

- **Routes** (`deck_media.ts`, mounted before `decks.ts`): `POST /api/decks/:id/videos/upload` (multipart MP4, at most 50 MB), `GET /api/decks/videos/:uid/file` (Range), `POST /api/decks/:id/paste` (`{ from_deck_id, card_uids }`, saves nothing) and `GET /api/decks/:id/button-clicks`. The viewer's press is `POST /api/decks/share/:token/click` in `deck_share_actions.ts`.
- **Video:** a Loom link beside YouTube and Vimeo (oEmbed at `www.loom.com`, poster from `cdn.loom.com`), or an MP4 in R2 alone at `deck-videos/<uid>.mp4` (migration: none). The file is the venture's own until a saved version names it, then public.
- **Button:** a block kind (`{ url, label, style }`); a press on a share link is a `deck_share_conversions` row of type `button_click`, once per view per button.
- **Hidden and section:** a hidden card is in no share, Present, PDF, PowerPoint, .odp, Google Slides or HTML; notes and the heartbeat pair by uid.
- **Studio:** `deckV2Adapter.media` is swapped, with `pasteCards` and `buttonClicks`: Hide / Show and Move to section in the card ⋯, Recorded video and Button in the picker. The Cards strip virtualises past 24 cards and loads thumbnails' images lazily.
