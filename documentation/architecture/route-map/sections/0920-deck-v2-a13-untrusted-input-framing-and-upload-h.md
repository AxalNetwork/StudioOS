### Deck v2 A13: untrusted input framing and upload hardening (D1506, #3757)

- **No page changes.** The canvas draws no screen for this (pd2, pd19 and pd20 send the text it frames).
- **Framing:** `services/ai/untrusted.ts`. Every text written outside our code reaches a model inside `BEGIN_<KIND>_<nonce>` / `END_<KIND>_<nonce>`. That covers New deck's founder note and facts (record facts, connected tools' rows, documents: `deck_new.ts`), the card tools' text, instruction and labels (`deck_assist.ts`), Fill from project's records (`decks.ts` autofill), competitor web pages and interview transcripts. A link or email address no record holds is dropped from the answer.
- **Figure guard:** `\p{Nd}` digits in every script, plus number words in the card's language.
- **Images:** `deck_images.ts` adds `POST /api/decks/:id/images/import` (`{ url, use?, card?, alt?, shows_person?, consent? }`), which copies an external image in through `services/decks/imageFetch.ts`. Upload, import and drawn images are stripped of metadata, measured from the header (413 `image_too_large` over 50 MP) and stored once per venture: a repeat upload answers 200 with `duplicate: true` (migration 718, `sha256`).
- **Export browser:** `services/browserRun.ts` `renderUrl` passes `allowRequestPattern`: the page's own origin, Google Fonts, `data:` and `blob:`.

