# services/ai — the AI router's parts

What `../aiRouter.ts` uses to talk to Workers AI, kept pure so a test reaches
each rule without a binding.

| File | What it owns |
| --- | --- |
| `guard.ts` | D763 ([D763.md](../../../../documentation/architecture/decisions/D763.md)): Llama Guard 3 8B's rules. `sliceForGuard` cuts a text into slices of at most 2,000 characters (at a paragraph break, else a sentence end, else the limit) that join back exactly; `parseVerdict` reads `safe` or `unsafe` and its S-codes, and anything else is `unreadable`, never safe; the category table (S6 and S7 log, every other code blocks) with `decide` and `combine`; and the refusal copy in Eadwyn's voice, with the Wellbeing link on S11 for a founder or an admin. Part 2 hooks it into `run()`. |

**Adding here.** A file here takes plain values and returns plain values. No
`env`, no binding, no D1: `aiRouter.ts` does the calling, and these files say
how. The guard's cases are in `test/ai_guard_d763.test.mjs`.
