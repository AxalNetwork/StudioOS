---
name: design-brief
description: Turn a StudioOS design-brief issue (labelled needs-design, usually on slot S01) into a copy-paste Claude Design prompt the owner can run and approve. Use when an issue needs a canvas before it can be built, when asked to write a design prompt, a Claude Design brief, or the boards for a screen no canvas draws. Grounds every screen in what the platform actually records and fixes the format so all briefs come out the same.
---

# Design brief

AGENTS.md § Missing UI, step 3: Session 1 turns a screen description into a
Claude Design canvas "from what the platform actually records". This skill
writes that prompt. The owner runs it in Claude Design, approves the result
on the issue, and `land-canvas` commits it.

The output is one comment on the brief issue, in the shape of `TEMPLATE.md`
beside this file. No code changes, no PR.

## Steps

1. **Read the issue** and every comment: the route, who sees it, what each
   part shows, the states it lists, its parent, and any owner answer.
2. **Find what the platform records.** For every value the screen shows, find
   where it comes from on `main`: the Worker route (`cloudflare-worker/src/routes/`),
   the service that reads it, the table and column (`cloudflare-worker/sql/`), and
   the client method (`frontend/src/lib/api/`). Write each as one row:
   `value | route | table.column | can be missing? | can fail to load?`.
   A value with no source is either dropped or marked **backend required** in
   the prompt. Never let the canvas draw a figure the platform cannot produce.
3. **Find the canvas to continue.** Search `design/incoming/` and
   `design/canvases/` for the route and the area name. When a canvas for the
   area exists, the new boards extend it: same prefix, next free ids, same
   frame and components. Read its boards file's `renderVals` list for the last
   id (`boardsOf` in `scripts/lib/coordinator.mjs` reads it). Name the decision
   file the landing will write, by the rule in the `land-canvas` skill: an
   addendum is a part file `D<parent>-p<k>.md` beside the canvas's decision;
   a new canvas is `D<brief issue>.md`.
4. **Take the shared rules from what is already landed.** States from Platform
   States (`design/incoming/Platform States Page.dc.html`, ST-00 to ST-14, D5129);
   the Eadwyn rail from #5130 and the area's own rail board; tokens from
   `design/tokens/tokens.json`. Name them in the prompt; do not restate them.
5. **Write the prompt** with `TEMPLATE.md`. Every board gets an id, a size
   (desktop 1440, tablet 768, phone 390) and the states it shows. Every brief
   includes, for each screen:
   - the data states: **loaded**, **empty** (nothing recorded yet, with the
     one action that fills it), **Not recorded** (an optional value left
     blank), **Unreadable** (a read failed: what still works, and Try again),
     **Refused** (no permission: who can grant it), and **loading**;
   - the **phone layout** at 390, with 44px targets and no table wider than
     the screen;
   - the **dark** theme for at least the main board;
   - what Eadwyn proposes there, and that the founder or investor accepts,
     edits or discards it;
   - the handoff to the next page.
6. **Post it** as one `S1:` comment on the brief issue, with the prompt in a
   `text` fence, ending with what the owner does next. Keep the issue
   `state:blocked` + `needs-design`. Session 1 writes `S1:` comments, not
   STATUS blocks (AGENTS.md § Slots).
7. **After the owner runs it**, they link the canvas on the issue. Land it with
   the `land-canvas` skill once they approve it.

## Rules

- Sample content only: invented ventures, people and amounts, bracketed or
  marked as samples. No real member, company or investor names.
- No route the brief did not ask for. A new route is the owner's decision; say
  so in the prompt as a question with lettered options.
- Plain words on the boards. The AI is called Eadwyn. A figure always says what
  it counts and for which period.
- A brief that would need a decision first (a money rule, who may see what)
  asks it on the issue with lettered options and a pick, and waits.
- Batch briefs for one area into one prompt when they extend the same canvas.
