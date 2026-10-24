# services/narrative — the Investor narrative's stores

D908 (#2692), part 2 of #2454. These are the Worker stores and reads that the narrative's pages (parts 3 to 5) draw from, behind `/api/cycles/raise/narrative/*` (`../../routes/cycle_raise.ts`).

| File | What it does |
| --- | --- |
| `adminRead.ts` | D914 (#2698): an admin and the narrative. `narrativeAdminGate` refuses an admin's narrative writes (`admin_read_only`), and their reads until they give a reason (`read_reason_required`, 8 hours). It also holds the read reasons the founder sees (`giveReason`, `listReasons`) and the notes thread (`postNote`, `listNotes`), each writing one activity row that names neither's words. Migration 545. |
| `positioningDraft.ts` | D911: Eadwyn's positioning proposal. `positioningMaterial` reads only qualitative records and holds back any with a digit; `screenAnswer` drops any answer field with a digit. The route stores each kept field as an `ai_rail_proposals` row. |
| `readers.ts` | D909 (#2693). Holds two answers for the narrative's Home, its versions table and New version. `deckReaders` says which cards of the venture's current pitch deck bind each version, through a binding whose `record_ref` is `narrative_version_meta:vN`. It also says whether the venture is a Spin-Out venture. `readBySentence` words the first: "Pitch deck v6 · cards 1, 2", or "No deck reads this version." |
| `store.ts` | Holds four things. `NARRATIVE_SECTIONS` is the story's sections and where each one's words live. `readNarrative` returns a version's meta, sections, positioning and bindings, each part either `ok` or `unreadable`. `compareNarrative` gives two versions section by section. `saveNarrativeSection` and `savePositioning` write, each logging one `raise.investor-narrative` row. |

## The rules

**One sentence has one home.** A section's words live in one of three places:
- a section with a deck key keeps them in the version's `spinout_deck_overrides` row;
- Why now keeps them in `narrative_version_meta.why_now`;
- every other section keeps them in `narrative_sections.body`.

Never copy a sentence into a second store.

**Version 0 is the live deck.** It is read here and never written here.

**A failed read is `unreadable`, never an empty list.** Words nobody wrote are `null` ("Not recorded"), never `""` or `0`.

**Eadwyn's wording carries no number.** A write whose source is `eadwyn` and whose words hold a digit is refused. A figure enters a section only as a binding, which uses D896's five fields (`source_key`, `record_ref`, `as_of`, `grade`, `snapshot_hash`).

**Provenance follows #2431's names.** `source_kind` is eadwyn, connector or module, or null for typed. `source_label` is connector, document, recorded, signed or typed. `prior_value`, `undone_at` and `undone_by` support undo.

**Read by is a binding, never a guess** (D909). A deck reads a version only when one of its current deck's cards binds that version's record. The marker's `deck_version` is the newest deck at save time, and it never counts as a reader.
