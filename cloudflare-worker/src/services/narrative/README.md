# services/narrative — the Investor narrative's stores

D908 (#2692), part 2 of #2454. These are the Worker stores and reads that the narrative's pages (parts 3 to 5) draw from, behind `/api/cycles/raise/narrative/*` (`../../routes/cycle_raise.ts`).

| File | What it does |
| --- | --- |
| `positioningDraft.ts` | D911: Eadwyn's positioning proposal. `positioningMaterial` reads only qualitative records and holds back any with a digit; `screenAnswer` drops any answer field with a digit. The route stores each kept field as an `ai_rail_proposals` row. |
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
