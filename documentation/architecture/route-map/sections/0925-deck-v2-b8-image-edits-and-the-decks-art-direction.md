### Deck v2 B8: image edits and the deck's art direction (D1544, #3784)

- **Routes** (`deck_image_edits.ts`, mounted before `deck_images.ts`): `POST /api/decks/images/:uid/edit/quote`, `POST /api/decks/images/:uid/edit` (`{ op: vary | edit | erase | expand, instruction?, mask?, aspect? }`) and `POST /api/decks/images/:uid/revert`.
- **An edit is a child image:** a proposed `deck_images` row with `parent_uid` and `edit_op` (migration 735). The parent row never changes; revert discards the child and answers the parent.
- **Model:** DK5, FLUX.2 Klein 4B (partner switch and a paid plan), with the parent resized through the new `IMAGES` binding as its first reference and an erase's mask as its second. A vary of a drawn image redraws its own description on DK4 when DK5 cannot run.
- **Never a person:** an image showing a person is never edited (422 `person_edit_refused`), and a result showing a face is refused and not stored.
- **Art direction:** `theme.art_direction` may be `{ style, palette, seed_base, reference_uid, note }`; every image request on the deck inherits it.
- **Studio:** the adapter's `imageVary` (#3784) prices an edit; "Edit or vary" is re-keyed to it. The lightbox's references line follows the quoted model.

