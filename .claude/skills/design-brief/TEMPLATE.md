# Design brief comment template

Post this as one comment on the brief issue. Replace every `<…>`. Delete a
section only when it truly does not apply, and say so in one line.

````markdown
S1: design prompt for #<issue>, ready for the owner to run in Claude Design.

**Continues:** `<Canvas name>` (`design/incoming/<file>`), boards from **<PREFIX-next>**. Decision file: `D<parent>-p<k>.md` for an addendum, `D<brief issue>.md` for a new canvas.
**Shared rules it uses:** Platform States (ST-00 to ST-14, D5129) · the Eadwyn rail (#5130) · `design/tokens/tokens.json`.

**What the platform records** (checked on main `<sha>`):

| Value on screen | Read from | Stored in | Can be missing | Can fail |
|---|---|---|---|---|
| <value> | `GET /api/<…>` | `<table>.<column>` | yes / no | yes / no |

Backend required (drawn with ◇, not built): <list, or "none">.

```text
You are designing new boards for Axal VC / StudioOS, continuing the canvas "<Canvas name>".
Keep its frame, components, type and colours. Number the new boards <PREFIX-next> onward.

SURFACE
- Route: <route>. Who sees it: <role(s)>. Reached from: <where>.
- The job: <one sentence: what the person is trying to get done here>.

WHAT IS RECORDED (draw only these; ◇ marks a value that needs backend work)
- <value>: <what it means, its unit and period>.
- ◇ <value>: <why it is not recorded yet>.

BOARDS
<PREFIX-n> · <title> · desktop 1440
  Shows: <parts, top to bottom>. Primary action: <one>. Eadwyn: <what it proposes; accept, edit or discard>.
<PREFIX-n+1> · <title> · empty state · desktop 1440
  Nothing recorded yet: <the one action that fills it, and what appears after>.
<PREFIX-n+2> · States · desktop 1440
  Loading · Not recorded (<which optional values>) · Unreadable (<which read>, what still works, Try again) · Refused (<who can grant access>) · Saving and save failed (edits kept).
<PREFIX-n+3> · Phone 390
  <order of parts>; 44px targets; tables become cards; sheets for forms.
<PREFIX-n+4> · Dark · desktop 1440
  <PREFIX-n> on the dark tokens; states keep their words and shapes.

RULES
- Every figure says what it counts and for which period. Zero, Not recorded and Unreadable never look alike.
- Colour never carries meaning alone: a word or a glyph goes with it.
- Sample content only: bracketed names and figures.
- Handoff: <where the person goes next, and what travels with them>.

QUESTIONS FOR THE OWNER (draw option A unless told otherwise)
- <question>? A) <…> B) <…>. Pick: A.
```

**Next:** the owner runs this in Claude Design and links the canvas here. On approval, S1 lands it with `land-canvas` and sets the build issues `state:ready`.
````
