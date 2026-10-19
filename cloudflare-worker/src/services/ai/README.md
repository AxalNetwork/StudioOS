# services/ai — the AI router's parts

What `../aiRouter.ts` uses to talk to Workers AI, kept pure so a test reaches
each rule without a binding. Read
[D761](../../../../documentation/architecture/decisions/D761.md) first.

| File | What it owns |
| --- | --- |
| `shapes.ts` | D761: the request and response shape for each kind of model (text and reasoning in PR 1). It also holds the rules on each attempt: the timeout class (chat 8 s, reasoning and long context 30 s, images 60 s; a stream's first chunk the same), the context-window check, failures read as a status and Workers AI's code, the paid-only refusals, `x-session-affinity`, and the `units` an attempt used, measured by the Worker. A model's kind, window and plan come from D760's catalogue through `factsFor` / `setModelFactsSource`. |
| `guard.ts` | D763 ([D763.md](../../../../documentation/architecture/decisions/D763.md)): Llama Guard 3 8B's rules. `sliceForGuard` cuts a text into slices of at most 2,000 characters (at a paragraph break, else a sentence end, else the limit) that join back exactly; `parseVerdict` reads `safe` or `unsafe` and its S-codes, and anything else is `unreadable`, never safe; the category table (S6 and S7 log, every other code blocks) with `decide` and `combine`; and the refusal copy in Eadwyn's voice, with the Wellbeing link on S11 for a founder or an admin. Part 2 hooks it into `run()`. |

**Adding here.** A file here takes plain values and returns plain values. No
`env`, no binding, no D1: `aiRouter.ts` does the calling, and these files say
how. A new kind of model is a new shape in `shapes.ts`, with its case in
`test/ai_router_shapes_d761.test.mjs`. The guard's cases are in
`test/ai_guard_d763.test.mjs`.
